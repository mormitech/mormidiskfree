import './style.css';
import {hierarchy, partition} from 'd3-hierarchy';
import {arc} from 'd3-shape';
import {Home, ChooseFolder, Scan, Cancel, View, Reveal, Volumes, FreeSpace, Trash, Version, CachedScan, CacheTime, RescanFolder, Platform, SaveSession, LoadSession, Mode} from '../wailsjs/go/main/App';
import {EventsOn, BrowserOpenURL} from '../wailsjs/runtime/runtime';
import logo from './assets/mormitech-mark.svg';

const $ = (id) => document.getElementById(id);
const DEPTH = 4;

// What each file manager calls "show this file in its folder"; on Linux the helper opens the containing folder.
const REVEAL = {darwin: 'Show in Finder', windows: 'Show in Explorer', linux: 'Open containing folder'};
let revealLabel = 'Show in folder';
let onMac = false;
Platform().then((p) => { revealLabel = REVEAL[p] || revealLabel; onMac = p === 'darwin'; });
const FULL_DISK_ACCESS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

let scanRoot = '';    // folder that was scanned
let current = null;   // node shown now
let scanAt = 0;       // unix seconds of the full scan on screen (it may come from the cache)
let usage = null;     // size and free space of the scanned folder's volume
let volumes = [];
let busy = false;
const basket = new Map();   // path -> {name, size}
let basketState = 'idle';   // idle | confirm | working
let basketError = '';

function bytes(n) {
    const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + u[i];
}

function ago(sec) {
    const s = Math.max(0, Date.now() / 1000 - sec);
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 129600) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const sepOf = (p) => (p.includes('\\') ? '\\' : '/');
const isUnder = (p, dir) => p.startsWith(dir.endsWith(sepOf(dir)) ? dir : dir + sepOf(dir));

// ---- start screen: all disks ------------------------------------------------------------------------------------

async function showStart() {
    if (busy) return;
    // only "All disks" (already selected) and "Choose folder" make sense here; the rest belong to a loaded disk
    document.body.classList.add('start');
    $('disks').disabled = true;
    SaveSession('', '');   // so the next start comes back to this list
    // the age of the scan and the free space belong to the disk that was on screen, not to this list
    $('cache').hidden = true;
    $('space').hidden = true;
    $('rescanfolder').hidden = true;
    volumes = (await Volumes()) || [];
    const times = await Promise.all(volumes.map((v) => CacheTime(v.path)));
    $('splash').hidden = false;
    $('splash').innerHTML = `<div id="start"><h2>Disks</h2>` + volumes.map((v, i) => {
        const used = v.total - v.free;
        const pct = v.total ? (used / v.total) * 100 : 0;
        return `<div class="disk" data-i="${i}"><div class="t"><b>${esc(v.name)}</b><span>${bytes(used)} used</span></div>` +
            `<div class="p">${esc(v.path)}</div><div class="meter"><i class="${pct > 90 ? 'full' : ''}" style="width:${pct}%"></i></div>` +
            `<div class="f">${bytes(v.free)} free of ${bytes(v.total)}${times[i] ? ' · scanned ' + ago(times[i]) : ''}</div></div>`;
    }).join('') + `<p>Click a disk to scan it, or use “Choose folder…” for just one folder.</p></div>`;
    $('splash').onclick = (e) => {
        const d = e.target.closest('.disk');
        if (d) openTarget(volumes[+d.dataset.i].path);
    };
}

// ---- colours and chart --------------------------------------------------------------------------------------------

function colour(d, hue) {
    if (!d.data.path) return 'hsl(215 10% 45%)';
    const l = 52 + (d.depth - 1) * 6;
    return d.data.isDir ? `hsl(${hue} 62% ${l}%)` : `hsl(${hue} 22% ${l - 4}%)`;
}

function topHue(d, tops) {
    let t = d;
    while (t.depth > 1) t = t.parent;
    return (tops.indexOf(t.data) * 137.5 + 210) % 360;
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// anim: 'open' (rings sweep out one after the other), 'in' (went into a folder), 'out' (went up), or nothing.
function render(node, anim) {
    leaveStart();
    current = node;
    subtrees.clear();
    $('splash').hidden = true;
    drawCrumbs(node.path);
    drawChart(node, anim);
    drawList(node, anim);
    drawBasket();
    drawSpace();
    drawCacheNote();
    SaveSession(scanRoot, node.path);   // so the next start can open the same view
}

// At the top of a whole-disk scan the chart also shows the free space as a dashed slice, and the used space the scan
// did not see (other volumes of the container, folders it may not read, purgeable space) as a faded one, so that the
// whole circle is the disk and every share is a share of the disk.
function withFree(node) {
    const wholeDisk = node.path === scanRoot && volumes.some((v) => v.path === scanRoot);
    if (!wholeDisk || !usage || !usage.free) return node;
    const extra = [];
    const unseen = usage.total - usage.free - node.size;
    if (unseen > 0) {
        extra.push({name: 'Not scanned', path: '', isDir: false, unscanned: true, size: unseen, items: 0,
            note: 'Why: this space is used, but outside the scanned volume. It is other volumes of the same disk (system, VM, recovery), folders macOS did not let the scan read (Full Disk Access), and purgeable space or snapshots.'});
    }
    extra.push({name: 'Free space', path: '', isDir: false, free: true, size: usage.free, items: 0});
    return {...node, size: node.size + extra.reduce((n, e) => n + e.size, 0), children: [...(node.children || []), ...extra]};
}

function drawChart(node, anim) {
    const shown = withFree(node);
    const box = $('stage').getBoundingClientRect();
    const R = (Math.min(box.width, box.height) - 16) / 2;
    const hole = R * 0.26;
    const ring = (R - hole) / DEPTH;
    const svg = $('sun');
    svg.setAttribute('viewBox', `${-box.width / 2} ${-box.height / 2} ${box.width} ${box.height}`);

    const root = hierarchy(shown, (d) => d.children).sum((d) => (d.children ? 0 : d.size));
    partition().size([2 * Math.PI, 1])(root);
    const tops = shown.children || [];
    const gen = arc()
        .startAngle((d) => d.x0).endAngle((d) => d.x1)
        .padAngle(0.002)
        .innerRadius((d) => hole + (d.depth - 1) * ring)
        .outerRadius((d) => hole + d.depth * ring - 1);

    const arcs = root.descendants().filter((d) => d.depth > 0 && d.depth <= DEPTH && d.x1 - d.x0 > 0.003);
    // One group per ring, so the rings can move one after the other.
    const rings = Array.from({length: DEPTH}, () => '');
    arcs.forEach((d, i) => {
        const cls = d.data.free ? 'free' : d.data.unscanned ? 'unscanned' : d.data.isDir ? 'dir' : d.data.path ? 'file' : 'rest';
        const gone = basket.has(d.data.path) ? ' style="opacity:.35"' : '';
        rings[d.depth - 1] += `<path data-i="${i}" class="${cls}" d="${gen(d)}" fill="${colour(d, topHue(d, tops))}"${gone}/>`;
    });
    svg.innerHTML = rings.map((r) => `<g class="ring">${r}</g>`).join('');

    svg.onmousemove = (e) => {
        const p = e.target.closest('path');
        if (!p) return hideTip();
        showTip(e, arcs[+p.dataset.i].data, shown.size);
    };
    svg.onmouseleave = hideTip;
    svg.onclick = (e) => {
        const p = e.target.closest('path');
        if (!p) return;
        const d = arcs[+p.dataset.i].data;
        if (d.unscanned) { if (onMac) BrowserOpenURL(FULL_DISK_ACCESS); }
        else if (e.shiftKey && d.path) toggleBasket(d);
        else if (d.isDir) open(d.path);
    };
    svg.oncontextmenu = (e) => { e.preventDefault(); goUp(); };

    const up = node.path !== scanRoot;
    $('center').innerHTML = `<div class="name">${esc(node.name || node.path)}</div><div class="size">${bytes(node.size)}</div>` +
        (usage && node.path === scanRoot ? `<div class="size">${bytes(usage.free)} free</div>` : '') +
        (up ? '<div class="up">↑ Up</div>' : '');
    const hit = document.getElementById('hit') || document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hit.id = 'hit';
    hit.setAttribute('r', hole);
    hit.setAttribute('fill', 'transparent');
    hit.style.cursor = up ? 'pointer' : 'default';
    hit.onclick = goUp;
    svg.appendChild(hit);

    if (anim && !reduceMotion) animateChart(svg, anim);
    if (anim && !reduceMotion) $('center').animate([{opacity: 0}, {opacity: 1}], {duration: 260, easing: 'ease-out'});
}

// Going into a folder zooms the new rings in from slightly smaller, going up from slightly larger; a fresh open sweeps
// the rings out from the centre one by one.
function animateChart(svg, anim) {
    const from = {open: 0.55, in: 0.8, out: 1.2}[anim];
    const step = anim === 'open' ? 80 : 35;
    svg.querySelectorAll('g.ring').forEach((g, i) => {
        g.animate([{opacity: 0, transform: `scale(${from})`}, {opacity: 1, transform: 'scale(1)'}], {
            duration: anim === 'open' ? 480 : 320,
            delay: i * step,
            easing: 'cubic-bezier(.2,.8,.2,1)',
            fill: 'backwards',
        });
    });
}

function drawCacheNote() {
    const el = $('cache');
    el.hidden = !scanAt;
    el.textContent = 'scanned ' + ago(scanAt);
    el.title = new Date(scanAt * 1000).toLocaleString();
    $('rescanfolder').hidden = !current || current.path === scanRoot;
}

function drawSpace() {
    const el = $('space');
    if (!usage || !usage.total) { el.hidden = true; return; }
    const pct = ((usage.total - usage.free) / usage.total) * 100;
    el.hidden = false;
    el.innerHTML = `${bytes(usage.free)} free of ${bytes(usage.total)}<div class="meter"><i class="${pct > 90 ? 'full' : ''}" style="width:${pct}%"></i></div>`;
}

// ---- list ---------------------------------------------------------------------------------------------------------

// Folders opened with the triangle in the list; their contents are fetched once per view and kept in `subtrees`.
const expanded = new Set();
const subtrees = new Map();   // path -> node with children
let listRows = [];            // the rows on screen, in order

function flatten(node, depth, hueIndex, out) {
    (node.children || []).forEach((c, i) => {
        const hi = depth === 0 ? i : hueIndex;
        out.push({c, depth, hueIndex: hi, parentSize: node.size});
        if (c.isDir && c.path && expanded.has(c.path) && subtrees.has(c.path)) flatten(subtrees.get(c.path), depth + 1, hi, out);
    });
    return out;
}

// Fetch what the opened folders contain, then redraw the list.
function loadExpanded() {
    for (const path of [...expanded]) {
        if (subtrees.has(path)) continue;
        View(path).then((n) => { subtrees.set(path, n); drawList(current); }).catch(() => expanded.delete(path));
    }
}

function drawList(node, anim) {
    $('list').classList.toggle('enter', !!anim && !reduceMotion);
    listRows = flatten(node, 0, 0, []);
    $('list').innerHTML = listRows.map(({c, depth, hueIndex, parentSize}, i) => {
        const pct = parentSize ? (c.size / parentSize) * 100 : 0;
        const hue = c.path ? (hueIndex * 137.5 + 210) % 360 : 215;
        const inBasket = basket.has(c.path);
        const open = c.isDir && expanded.has(c.path);
        const tri = c.isDir && c.path ? `<span class="tri${open ? ' open' : ''}" data-a="toggle">▸</span>` : '<span class="tri sp">▸</span>';
        return `<div class="row${inBasket ? ' in-basket' : ''}" data-i="${i}" style="--i:${Math.min(i, 14)};padding-left:${8 + depth * 18}px"><span class="n">${tri}${esc(c.name)}</span><span class="s">${bytes(c.size)}</span>` +
            (c.path ? `<div class="acts"><button data-a="reveal">${revealLabel}</button><button data-a="basket">${inBasket ? 'Remove' : '+ Basket'}</button></div>` : '') +
            `<div class="bar"><i style="width:${pct}%;background:hsl(${hue} 62% 55%)"></i></div></div>`;
    }).join('');
    $('list').onclick = (e) => {
        const row = e.target.closest('.row');
        if (!row) return;
        const c = listRows[+row.dataset.i].c;
        if (!c.path) return;
        const act = e.target.dataset.a;
        if (act === 'toggle') {
            if (expanded.has(c.path)) expanded.delete(c.path); else expanded.add(c.path);
            loadExpanded();
            drawList(current);
        } else if (act === 'reveal') Reveal(c.path);
        else if (act === 'basket') toggleBasket(c);
        else if (c.isDir) open(c.path);
        else Reveal(c.path);
    };
    loadExpanded();
}

// ---- basket and delete-to-Trash -------------------------------------------------------------------------------------

function toggleBasket(n) {
    if (basket.has(n.path)) {
        basket.delete(n.path);
    } else if (![...basket.keys()].some((p) => isUnder(n.path, p))) {   // a parent folder is already in
        for (const p of [...basket.keys()]) if (isUnder(p, n.path)) basket.delete(p);   // drop what it now contains
        basket.set(n.path, {name: n.name, size: n.size});
    }
    basketState = 'idle';
    basketError = '';
    drawList(current);
    drawBasket();
    drawChart(current);
}

function drawBasket() {
    const el = $('basket');
    if (!basket.size) { el.hidden = true; return; }
    el.hidden = false;
    const total = [...basket.values()].reduce((s, b) => s + b.size, 0);
    const items = [...basket].map(([p, b]) => `<div class="it"><span title="${esc(p)}">${esc(b.name)}</span><span>${bytes(b.size)} <a data-rm="${esc(p)}">×</a></span></div>`).join('');
    let btns;
    if (basketState === 'confirm') {
        btns = `<div class="note">Move ${basket.size} item${basket.size > 1 ? 's' : ''} (${bytes(total)}) to the Trash? You can still put them back from there.</div>` +
            `<div class="btns"><button class="danger" data-b="yes">Yes, move to Trash</button><button data-b="no">Cancel</button></div>`;
    } else if (basketState === 'working') {
        btns = '<div class="note">Moving to the Trash…</div>';
    } else {
        btns = `<div class="btns"><button class="danger" data-b="ask">Move to Trash</button><button data-b="clear">Clear</button></div>`;
    }
    el.innerHTML = `<div class="h"><span>Basket · ${basket.size}</span><span>${bytes(total)}</span></div>${items}${btns}` +
        (basketError ? `<div class="err">${esc(basketError)}</div>` : '');
    el.onclick = async (e) => {
        if (e.target.dataset.rm) { basket.delete(e.target.dataset.rm); basketError = ''; return refreshBasketViews(); }
        const b = e.target.dataset.b;
        if (b === 'clear') { basket.clear(); basketError = ''; refreshBasketViews(); }
        else if (b === 'ask') { basketState = 'confirm'; drawBasket(); }
        else if (b === 'no') { basketState = 'idle'; drawBasket(); }
        else if (b === 'yes') await moveToTrash();
    };
}

function refreshBasketViews() {
    basketState = 'idle';
    drawList(current);
    drawBasket();
    drawChart(current);
}

async function moveToTrash() {
    basketState = 'working';
    drawBasket();
    const res = await Trash([...basket.keys()]);
    for (const p of res.trashed || []) basket.delete(p);
    basketState = 'idle';
    basketError = (res.failed || []).join('\n');
    try { usage = await FreeSpace(scanRoot); } catch (_) { /* keep the old numbers */ }
    await open(current.path);
}

// ---- navigation -----------------------------------------------------------------------------------------------------

function drawCrumbs(path) {
    const sep = sepOf(scanRoot);
    const rel = path.slice(scanRoot.length).split(/[\\/]/).filter(Boolean);
    let acc = scanRoot;
    const parts = [`<span data-p="${esc(scanRoot)}">${esc(scanRoot)}</span>`];
    for (const r of rel) {
        acc += (acc.endsWith(sep) ? '' : sep) + r;
        parts.push(`<span data-p="${esc(acc)}">${esc(r)}</span>`);
    }
    $('crumbs').innerHTML = parts.join('<span class="sep">→</span>');
    $('up').disabled = path === scanRoot;
    $('root').disabled = path === scanRoot;
}
$('crumbs').onclick = (e) => { if (e.target.dataset.p) open(e.target.dataset.p); };

async function open(path) {
    try {
        const node = await View(path);
        let anim;
        if (!current) anim = 'open';
        else if (path === current.path) anim = undefined;   // same folder, e.g. refreshed after a delete
        else if (isUnder(path, current.path)) anim = 'in';
        else if (isUnder(current.path, path)) anim = 'out';
        else anim = 'open';
        render(node, anim);
    } catch (err) { console.error(err); }
}

function goUp() {
    if (!current || current.path === scanRoot) return;
    const sep = sepOf(current.path);
    const cut = current.path.lastIndexOf(sep);
    const up = cut <= 0 ? sep : current.path.slice(0, cut);
    // Cutting D:\GAMES leaves "D:", which Windows reads as a relative path; the scan root "D:\" is what the tree knows.
    open(up.length < scanRoot.length ? scanRoot : up);
}

function showTip(e, n, total) {
    const t = $('tip');
    t.hidden = false;
    t.innerHTML = `<div><b>${esc(n.name)}</b></div><div>${bytes(n.size)} · ${total ? ((n.size / total) * 100).toFixed(1) : 0}%` +
        (n.isDir ? ` · ${n.items.toLocaleString()} files` : '') + `</div>` + (n.path ? `<div class="p">${esc(n.path)}</div>` : '') + (n.note ? `<div class="p">${esc(n.note)}</div>` : '') + (n.unscanned && onMac ? '<div class="p">click: open Full Disk Access settings</div>' : '') +
        (n.path ? '<div class="p">shift-click: add to basket</div>' : '');
    t.style.left = Math.min(e.clientX + 14, innerWidth - 380) + 'px';
    t.style.top = Math.min(e.clientY + 14, innerHeight - 110) + 'px';
}
function hideTip() { $('tip').hidden = true; }

function showScanning(path) {
    $('splash').hidden = false;
    $('splash').onclick = null;
    $('splash').innerHTML = `<div><div class="spin"></div>Scanning ${esc(path)}…<br><span id="count">0</span> files<br><br><button id="stop">Stop</button></div>`;
    $('stop').onclick = () => Cancel();
}

function showLoading(text) {
    const s = $('splash');
    s.hidden = false;
    s.onclick = null;
    s.innerHTML = `<div class="fade"><div class="spin"></div>${esc(text)}</div>`;
}

function showError(err) {
    $('splash').hidden = false;
    $('splash').innerHTML = `<div>${esc(String(err))}<br><br><button id="back">Back</button></div>`;
    $('back').onclick = () => { if (current) render(current); else showStart(); };
}

function leaveStart() {
    document.body.classList.remove('start');
    $('disks').disabled = false;
}

function resetFor(path) {
    leaveStart();
    scanRoot = path;
    expanded.clear();
    current = null;
    scanAt = 0;
    basket.clear();
    basketError = '';
    $('sun').innerHTML = '';
    $('cache').hidden = true;
    $('space').hidden = true;   // both come back when the disk has loaded (render)
    $('rescanfolder').hidden = true;
}

// Opens the saved scan of path at once if there is one, otherwise scans it (unless cachedOnly). With focus, it then
// goes to that folder. Returns whether something was opened.
async function openTarget(path, {cachedOnly = false, focus = ''} = {}) {
    if (!path || busy) return false;
    resetFor(path);
    volumes = (await Volumes()) || [];
    // Reading a big saved scan can take a second or two; show a spinner if it does, but not a flash if it is quick.
    const timer = setTimeout(() => showLoading(`Opening the saved scan of ${path}…`), 150);
    let cached;
    try { cached = await CachedScan(path); } finally { clearTimeout(timer); }
    if (!cached) {
        if (cachedOnly) return false;
        await scan(path);
        return true;
    }
    usage = await FreeSpace(path).catch(() => null);
    scanAt = cached.at;
    $('rescan').disabled = false;
    render(cached.node, 'open');
    if (focus && focus !== path) await open(focus);
    return true;
}

// At start, open what was shown last time, if its saved scan is still there.
async function restore() {
    const s = await LoadSession();
    if (s && s.root && (await openTarget(s.root, {cachedOnly: true, focus: s.path}))) return;
    showStart();
}

async function scan(path) {
    if (!path || busy) return;
    busy = true;
    const keep = current;
    resetFor(path);
    showScanning(path);
    try {
        volumes = (await Volumes()) || [];
        usage = await FreeSpace(path).catch(() => null);
        const res = await Scan(path);
        scanAt = res.at;
        $('rescan').disabled = false;
        render(res.node, 'open');
    } catch (err) {
        current = keep;
        showError(err);
    } finally {
        busy = false;
    }
}

async function rescanFolder() {
    if (!current || busy) return;
    busy = true;
    const path = current.path;
    showScanning(path);
    try {
        const res = await RescanFolder(path);
        usage = await FreeSpace(scanRoot).catch(() => usage);
        render(res.node, 'open');
    } catch (err) {
        showError(err);
    } finally {
        busy = false;
    }
}

EventsOn('progress', (n) => { const c = $('count'); if (c) c.textContent = n.toLocaleString(); });
$('disks').onclick = showStart;
$('choose').onclick = async () => { const p = await ChooseFolder(); if (p) openTarget(p); };
$('up').onclick = goUp;
$('root').onclick = () => { if (current && current.path !== scanRoot) open(scanRoot); };
$('rescan').onclick = () => scan(scanRoot);
$('rescanfolder').onclick = rescanFolder;
addEventListener('resize', () => { if (current) drawChart(current); });
// ---- About window -----------------------------------------------------------------------------------------------
// The program started with --about shows this instead of the app. Links open in the system's browser.

const COFFEE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9.5h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM16.5 11h1.5a2.5 2.5 0 0 1 0 5h-1.8M8 3.5c-.9 1 .9 1.8 0 2.8M12 3.5c-.9 1 .9 1.8 0 2.8"/></svg>';
const REPO = 'https://github.com/mormitech/mormidiskfree';

async function showAbout() {
    document.body.classList.add('about-mode');
    $('about').hidden = false;
    $('about').innerHTML = `<img class="logo" src="${logo}" alt="" width="132">
        <h1><span class="wm-mormi">mormi</span><span class="wm-diskfree">DiskFree</span></h1>
        <p class="muted">Version ${esc(await Version())}</p>
        <p>See what is eating your disk: a disk space analyzer with an interactive sunburst chart, for macOS, Windows and Linux.</p>
        <p class="muted">Free and open source under the MIT license: use, modify, distribute and sell it, privately or commercially. No accounts, no ads, no telemetry.</p>
        <p class="links"><a href="${REPO}">Website and source code</a><a href="${REPO}/issues">Report a problem</a><a href="${REPO}/blob/main/LICENSE">License</a><a class="coffee" href="https://mormitech.com/support-us/">${COFFEE}Buy me a coffee</a></p>
        <details class="disclaimer"><summary>Disclaimer</summary>
        <p>mormiDiskFree is free software provided by Mormitech "as is" and "as available", without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, accuracy and non-infringement.</p>
        <p>You use it at your own risk. You are responsible for your data and for keeping current backups. Review everything in the basket before you move it to the Trash. Scan results and sizes may be incomplete or differ from what your system reports.</p>
        <p>To the maximum extent permitted by applicable law, Mormitech and the contributors exclude all liability for any loss or damage arising out of or in connection with the software or its use, including data loss, corruption, system instability or any other direct, indirect, incidental or consequential side effect, even if advised of the possibility of such damage. Nothing here excludes liability that cannot be excluded by law.</p>
        <p>This notice supplements the MIT license, whose terms apply in full.</p></details>`;
}

document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href^="http"]');
    if (a) { ev.preventDefault(); BrowserOpenURL(a.href); }
});

Mode().then((mode) => { if (mode === 'about') showAbout(); else restore(); });
