import './style.css';
import {hierarchy, partition} from 'd3-hierarchy';
import {arc} from 'd3-shape';
import {Home, ChooseFolder, Scan, Cancel, View, Reveal, Volumes, FreeSpace, Trash, Version, CachedScan, CacheTime, RescanFolder, Platform, SaveSession, LoadSession, Mode, MapView, OpenFile, Children} from '../wailsjs/go/main/App';
import {EventsOn, BrowserOpenURL, WindowSetTitle} from '../wailsjs/runtime/runtime';
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
    WindowSetTitle('mormiDiskFree');
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
    drawViews(node, anim);
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
    svg.oncontextmenu = (e) => {
        const p = e.target.closest('path');
        showMenu(e, p ? arcs[+p.dataset.i].data : null);
    };

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
        Children(path).then((n) => { subtrees.set(path, n); drawRows(); }).catch(() => expanded.delete(path));
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
            drawRows();
        } else if (act === 'reveal') Reveal(c.path);
        else if (act === 'basket') toggleBasket(c);
        else if (c.isDir) open(c.path);
        else Reveal(c.path);
    };
    $('list').oncontextmenu = (e) => {
        const row = e.target.closest('.row');
        showMenu(e, row ? listRows[+row.dataset.i].c : null);
    };
    loadExpanded();
}

// ---- treemap view ---------------------------------------------------------------------------------------------------
// The other way to look at a folder: its tree with sizes on the top left, the file types on the top right, and every
// file as a block below, the bigger the file the bigger the block, coloured by type. The header switch picks the view.

let view = 'sunburst';
try { view = localStorage.getItem('view') === 'treemap' ? 'treemap' : 'sunburst'; } catch (_) { /* no storage: sunburst */ }
const wds = () => view === 'treemap';
let mapData = null;       // {path, node, types} from MapView, for the folder on screen
let mapLayout = null;     // {w, h, items}: every block and folder as the worker laid them out
let mapLeaves = [];       // the blocks of mapLayout, for finding the one under the pointer
let mapAnim = null;       // how the next layout should appear
let layoutId = 0;         // only the answer to the latest request is drawn
const layoutWorker = new Worker(new URL('./treemap.worker.js', import.meta.url), {type: 'module'});
let selected = '';        // path picked in the tree or the map
let selectedExt = null;   // file type picked in the list; the map dims the others
let treeRows = [];

// The biggest types get a colour each; the rest share a grey.
const TYPE_COLOURS = ['#5aa9ff', '#f29a4a', '#4fc9a4', '#c792ea', '#e5c76b', '#ef6f8a', '#7fd1e8', '#a3c25a', '#9a8ff0', '#d98f6c',
    '#6c8bd9', '#e08bd0', '#5fcf8e', '#c9a46a', '#4f9fa8', '#e3a7c0'];
const OTHER = '#8a94a3';
const SMALL = '#69727f';   // "smaller items" and folders of only small files
const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : ''; };
let typeColour = new Map();

function setView(v) {
    view = v;
    try { localStorage.setItem('view', v); } catch (_) { /* remembered for this run only */ }
    document.body.classList.toggle('wds', wds());
    const t = $('viewtoggle');
    t.setAttribute('aria-checked', String(wds()));
    t.dataset.tip = wds() ? 'Switch to the sunburst view' : 'Switch to the treemap view: folders, file types and every file as a block';
    hideTip();
    if (current) drawViews(current);
}

function drawViews(node, anim) {
    if (wds()) {
        drawTree(node);
        loadMap(node, anim);
    } else {
        drawChart(node, anim);
        drawList(node, anim);
    }
}
const drawRows = () => { if (current) (wds() ? drawTree(current) : drawList(current)); };
const redrawPicture = () => { if (current) (wds() ? drawMap(true) : drawChart(current)); };

// Fetching the blocks and laying them out takes a moment on a big disk, so a spinner turns over the map meanwhile.
async function loadMap(node, anim) {
    $('mapbusy').hidden = false;
    let res;
    try { res = await MapView(node.path); } catch (err) { console.error(err); $('mapbusy').hidden = true; return; }
    if (current !== node) return;   // went elsewhere meanwhile
    mapData = {path: node.path, node: res.node, types: res.types || []};
    typeColour = new Map(mapData.types.map((t, i) => [t.ext, TYPE_COLOURS[i] || OTHER]));
    if (selectedExt !== null && !typeColour.has(selectedExt)) selectedExt = null;
    drawTypes();
    drawTree(node);   // the file rows take their colours from the types
    mapAnim = anim;
    layoutMap(true);
}

function layoutMap(withTree) {
    const box = $('map').getBoundingClientRect();
    if (!mapData || !box.width || !box.height) { $('mapbusy').hidden = true; return; }
    layoutWorker.postMessage({id: ++layoutId, node: withTree ? mapData.node : null, w: box.width, h: box.height});
}

layoutWorker.onmessage = (e) => {
    if (e.data.id !== layoutId) return;
    mapLayout = e.data;
    mapLeaves = mapLayout.items.filter((d) => d.leaf);
    paintMap();
    $('mapbusy').hidden = true;
    if (mapAnim && !reduceMotion) $('map').animate([{opacity: 0}, {opacity: 1}], {duration: 260, easing: 'ease-out'});
    mapAnim = null;
};

const colourOf = (n) => (n.isDir || !n.path ? SMALL : typeColour.get(extOf(n.name)) || OTHER);
const inBasket = (p) => !!p && [...basket.keys()].some((b) => p === b || isUnder(p, b));

function drawTree(node) {
    treeRows = flatten(node, 0, 0, []);
    const head = '<div class="trow thead"><span>Name</span><span>Share of folder</span><span class="num">%</span><span class="num">Size</span><span class="num">Files</span></div>';
    $('tree').innerHTML = head + treeRows.map(({c, depth, hueIndex, parentSize}, i) => {
        const pct = parentSize ? (c.size / parentSize) * 100 : 0;
        const bar = c.isDir ? `hsl(${(hueIndex * 137.5 + 210) % 360} 62% 55%)` : colourOf(c);
        const open = c.isDir && expanded.has(c.path);
        const tri = c.isDir && c.path ? `<span class="tri${open ? ' open' : ''}" data-a="toggle">▸</span>` : '<span class="tri sp">▸</span>';
        const cls = (c.path && c.path === selected ? ' sel' : '') + (basket.has(c.path) ? ' in-basket' : '');
        return `<div class="trow${cls}" data-i="${i}"><span style="padding-left:${depth * 18}px">${tri}<span class="nm">${esc(c.name)}</span></span>` +
            `<span class="share"><i style="width:${pct}%;background:${bar}"></i></span><span class="num">${pct.toFixed(1)}%</span>` +
            `<span class="num sz">${bytes(c.size)}</span><span class="num">${c.isDir ? c.items.toLocaleString() : ''}</span>` +
            (c.path ? `<div class="acts"><button data-a="reveal">${revealLabel}</button><button data-a="basket">${basket.has(c.path) ? 'Remove' : '+ Basket'}</button></div>` : '') + '</div>';
    }).join('');
    const rowOf = (e) => { const r = e.target.closest('.trow:not(.thead)'); return r ? treeRows[+r.dataset.i].c : null; };
    $('tree').onclick = (e) => {
        const c = rowOf(e);
        if (!c || !c.path) return;
        const act = e.target.dataset.a;
        if (act === 'toggle') {
            if (expanded.has(c.path)) expanded.delete(c.path); else expanded.add(c.path);
            loadExpanded();
            drawTree(current);
        } else if (act === 'reveal') Reveal(c.path);
        else if (act === 'basket') toggleBasket(c);
        else select(c.path);
    };
    $('tree').oncontextmenu = (e) => showMenu(e, rowOf(e));
    loadExpanded();
}

function drawTypes() {
    if (!mapData) { $('types').innerHTML = ''; return; }
    const total = mapData.node.size || 1;
    $('types').innerHTML = '<div class="ty thead"><span></span><span>Type</span><span class="num">Files</span><span class="num">Size</span><span class="num">%</span></div>' +
        mapData.types.map((t, i) => `<div class="ty${t.ext === selectedExt ? ' sel' : ''}" data-i="${i}" title="click: show only these in the map">` +
            `<span class="sw" style="background:${typeColour.get(t.ext)}"></span><span>${t.ext ? '.' + esc(t.ext) : '(no extension)'}</span>` +
            `<span class="num">${t.files.toLocaleString()}</span><span class="num sz">${bytes(t.size)}</span><span class="num">${((t.size / total) * 100).toFixed(1)}%</span></div>`).join('');
    $('types').onclick = (e) => {
        const r = e.target.closest('.ty:not(.thead)');
        if (!r) return;
        const ext = mapData.types[+r.dataset.i].ext;
        selectedExt = selectedExt === ext ? null : ext;
        drawTypes();
        drawMap(true);
    };
}

// Redraws the map; a new size (the window, or the basket panel coming or going) needs a new layout first.
// Redraws the map; a new size (the window, or the basket panel coming or going) needs a new layout first. With
// animate, the map blends over when it goes from nothing picked to a pick, or back; moving from one pick to another
// is instant.
function drawMap(animate) {
    const box = $('map').getBoundingClientRect();
    if (!mapLayout || !box.width || !box.height) return;
    if (Math.abs(mapLayout.w - box.width) > 0.5 || Math.abs(mapLayout.h - box.height) > 0.5) layoutMap(false);
    paintMap(animate);
}

let mapBase = null;    // {layout, colours, canvas}: every block in full colour, for the layout and colours it was made for
let mapFrame = null;   // the blocks as last drawn (without the selection frame), to blend from
let mapFocus = null;   // what the map last showed in focus (null for nothing)
let mapAnimFrame = 0;

function paintMap(animate) {
    const canvas = $('map');
    const box = canvas.getBoundingClientRect();
    if (!mapLayout || !box.width || !box.height) return;
    const dpr = devicePixelRatio || 1;
    const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

    // Every block in full colour is painted once (the costly part: tens of thousands of shaded blocks) and kept;
    // fading is then the background colour laid over the faded parts at 75%, which looks the same as painting those
    // blocks at a quarter strength, and costs a few rectangles.
    if (!mapBase || mapBase.layout !== mapLayout || mapBase.colours !== typeColour || mapBase.canvas.width !== W || mapBase.canvas.height !== H) {
        mapBase = {layout: mapLayout, colours: typeColour, canvas: paintBlocks(W, H, dpr)};
    }
    const next = document.createElement('canvas');
    next.width = W;
    next.height = H;
    const ctx = next.getContext('2d');
    ctx.drawImage(mapBase.canvas, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg');
    ctx.globalAlpha = 0.75;

    // With something picked, everything outside it fades, so the pick stands out wherever it is. Its rectangle holds
    // all of it, the "smaller items" of a folder included.
    const focus = selected && mapLayout.items.find((d) => d.data.path === selected);
    if (focus) {
        const bw = W / dpr, bh = H / dpr;
        ctx.fillRect(0, 0, bw, focus.y0);
        ctx.fillRect(0, focus.y1, bw, bh - focus.y1);
        ctx.fillRect(0, focus.y0, focus.x0, focus.y1 - focus.y0);
        ctx.fillRect(focus.x1, focus.y0, bw - focus.x1, focus.y1 - focus.y0);
    }
    // A type picked in the list, and what is in the basket, fade block by block (inside the pick only, so nothing
    // fades twice).
    if (selectedExt !== null || basket.size) {
        for (const d of mapLeaves) {
            if (focus && (d.x0 < focus.x0 || d.y0 < focus.y0 || d.x1 > focus.x1 || d.y1 > focus.y1)) continue;
            const n = d.data;
            if ((selectedExt !== null && (n.isDir || !n.path || extOf(n.name) !== selectedExt)) || inBasket(n.path)) {
                ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
            }
        }
    }
    ctx.globalAlpha = 1;

    const focusToggled = !!focus !== !!mapFocus;
    const from = animate && focusToggled && !reduceMotion && mapFrame && mapFrame.width === W && mapFrame.height === H ? mapFrame : null;
    mapFrame = next;
    mapFocus = focus;
    const sel = focus;
    const out = canvas.getContext('2d');
    const draw = (t) => {
        out.setTransform(1, 0, 0, 1, 0, 0);
        out.globalAlpha = 1;
        out.clearRect(0, 0, W, H);
        if (from && t < 1) {
            out.drawImage(from, 0, 0);
            out.globalAlpha = t;
        }
        out.drawImage(next, 0, 0);
        out.globalAlpha = 1;
        out.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (sel) drawSelection(out, sel);
    };
    cancelAnimationFrame(mapAnimFrame);
    if (!from) return draw(1);
    // The clock starts at the first frame on screen, not at the click: drawing the new picture and the tree can take
    // longer than the fade itself, which would otherwise be over before it was ever shown.
    let start = null;
    const duration = 260;
    const step = (now) => {
        if (start === null) start = now;
        const t = Math.min((now - start) / duration, 1);
        draw(1 - Math.pow(1 - t, 3));   // ease out
        if (t < 1) mapAnimFrame = requestAnimationFrame(step);
    };
    mapAnimFrame = requestAnimationFrame(step);
}

// Paints every block in full colour, with its shading and, where it fits, its name.
function paintBlocks(W, H, dpr) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.font = '11px -apple-system, "Segoe UI", system-ui, sans-serif';
    for (const d of mapLeaves) {
        const w = d.x1 - d.x0, h = d.y1 - d.y0;
        const n = d.data;
        ctx.fillStyle = colourOf(n);
        // a gap of a pixel between blocks once they are big enough to have one
        ctx.fillRect(d.x0, d.y0, w > 3 ? w - 1 : w, h > 3 ? h - 1 : h);
        if (w > 6 && h > 6) {   // a little shading, so neighbouring blocks of one colour still read as separate files
            const g = ctx.createLinearGradient(d.x0, d.y0, d.x1, d.y1);
            g.addColorStop(0, '#ffffff38');
            g.addColorStop(0.5, '#ffffff00');
            g.addColorStop(1, '#00000040');
            ctx.fillStyle = g;
            ctx.fillRect(d.x0, d.y0, w - 1, h - 1);
        }
        if (w > 80 && h > 16 && n.path) {
            ctx.fillStyle = '#0d1522';
            ctx.save();
            ctx.beginPath();
            ctx.rect(d.x0, d.y0, w - 1, h - 1);
            ctx.clip();
            ctx.fillText(n.name, d.x0 + 4, d.y0 + 13);
            ctx.restore();
        }
    }
    return c;
}

// A white frame between a dark edge and an accent ring, so it shows on any colour; at least 16 px across so that the
// mouse pointer resting on a small block does not hide it.
function drawSelection(ctx, sel) {
    const w = Math.max(sel.x1 - sel.x0, 16), h = Math.max(sel.y1 - sel.y0, 16);
    const x = (sel.x0 + sel.x1 - w) / 2, y = (sel.y0 + sel.y1 - h) / 2;
    ctx.lineWidth = 6;
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent');
    ctx.strokeRect(x - 1, y - 1, w + 1, h + 1);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000000b0';
    ctx.strokeRect(x + 1, y + 1, w - 3, h - 3);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(x + 1, y + 1, w - 3, h - 3);
}

function leafAt(e) {
    const r = $('map').getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return mapLeaves.find((d) => x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1);
}

// Picks path in both halves: the block is outlined, and the tree opens down to the row and scrolls to it.
function select(path) {
    selected = path;
    if (current && path && isUnder(path, current.path)) {
        const sep = sepOf(path);
        let dir = path.slice(0, path.lastIndexOf(sep));
        while (dir.length > current.path.length && isUnder(dir, current.path)) {
            expanded.add(dir);
            dir = dir.slice(0, dir.lastIndexOf(sep));
        }
    }
    drawMap(true);
    // the tree (and the folders it opens) waits for the first frame of the map, so the map answers the click at once
    requestAnimationFrame(() => setTimeout(() => { drawTree(current); scrollToSelected(); }, 0));
}

// The rows of folders just opened arrive a moment later, so try again for a short while.
function scrollToSelected(tries = 10) {
    if (!selected) return;
    const i = treeRows.findIndex((r) => r.c.path === selected);
    if (i >= 0) { $('tree').querySelector(`.trow[data-i="${i}"]`)?.scrollIntoView({block: 'nearest'}); return; }
    if (tries > 0) setTimeout(() => scrollToSelected(tries - 1), 60);
}

// After a click the tooltip steps aside, so it does not cover the outline of what was just picked; it comes back
// once the pointer moves on.
let tipQuietAt = null;
$('map').onmousemove = (e) => {
    const d = leafAt(e);
    $('map').style.cursor = d && d.data.path ? 'pointer' : 'default';   // a block that can be picked
    if (tipQuietAt && Math.hypot(e.clientX - tipQuietAt[0], e.clientY - tipQuietAt[1]) < 12) return;
    tipQuietAt = null;
    if (!d) return hideTip();
    showTip(e, d.data, mapData.node.size);
};
$('map').onmouseleave = hideTip;
$('map').onclick = (e) => {
    const d = leafAt(e);
    if (!d || !d.data.path || e.detail > 1) return;   // the second click of a double click changes nothing
    hideTip();
    tipQuietAt = [e.clientX, e.clientY];
    if (e.shiftKey) toggleBasket(d.data);
    else select(d.data.path === selected ? '' : d.data.path);   // a second click lets go
};
$('map').oncontextmenu = (e) => { const d = leafAt(e); showMenu(e, d ? d.data : null); };

// ---- the bar between the top and the map ---------------------------------------------------------------------------
// It shares the height of the treemap view between the tree with the types and the map. The share is kept as a
// fraction of the view, so it scales with the window, and remembered for the next start.

const SPLIT_KEY = 'treemapSplit', SPLIT_DEFAULT = 0.4, SPLIT_MIN_PX = 90;
let split = SPLIT_DEFAULT;
try { const v = parseFloat(localStorage.getItem(SPLIT_KEY)); if (v > 0 && v < 1) split = v; } catch (_) { /* default */ }

function applySplit(save) {
    const total = $('wds').clientHeight;
    // both parts keep some room, however small the window
    const lo = total ? Math.min(SPLIT_MIN_PX / total, 0.5) : 0.1;
    split = Math.max(lo, Math.min(1 - lo, split));
    $('wtop').style.height = (split * 100).toFixed(2) + '%';
    $('wsplit').setAttribute('aria-valuenow', Math.round(split * 100));
    if (save) {
        try { localStorage.setItem(SPLIT_KEY, String(split)); } catch (_) { /* remembered for this run only */ }
        redrawPicture();
    }
}

$('wsplit').onpointerdown = (e) => {
    e.preventDefault();
    const bar = $('wsplit');
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('drag');
    document.body.classList.add('splitting');
    hideTip();
    const top = $('wds').getBoundingClientRect().top;
    // while dragging only the layout moves (the map stretches for a moment); it is drawn anew on release
    bar.onpointermove = (ev) => { split = (ev.clientY - top) / $('wds').clientHeight; applySplit(false); };
    bar.onpointerup = bar.onpointercancel = () => {
        bar.onpointermove = bar.onpointerup = bar.onpointercancel = null;
        bar.classList.remove('drag');
        document.body.classList.remove('splitting');
        applySplit(true);
    };
};
$('wsplit').ondblclick = () => { split = SPLIT_DEFAULT; applySplit(true); };
$('wsplit').onkeydown = (e) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    if (e.key === 'ArrowUp') split -= step;
    else if (e.key === 'ArrowDown') split += step;
    else return;
    e.preventDefault();
    applySplit(true);
};
applySplit(false);
addEventListener('resize', () => applySplit(false));

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
    drawRows();
    drawBasket();
    redrawPicture();
}

function drawBasket() {
    const el = $('basket');
    document.body.classList.toggle('basket-on', basket.size > 0);
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
    drawRows();
    drawBasket();
    redrawPicture();
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
    if (!$('menu').hidden) return;   // the menu is open: the tooltip would only get in its way
    const t = $('tip');
    t.hidden = false;
    t.innerHTML = `<div><b>${esc(n.name)}</b></div><div>${bytes(n.size)} · ${total ? ((n.size / total) * 100).toFixed(1) : 0}%` +
        (n.isDir ? ` · ${n.items.toLocaleString()} files` : '') + `</div>` + (n.path ? `<div class="p">${esc(n.path)}</div>` : '') + (n.note ? `<div class="p">${esc(n.note)}</div>` : '') + (n.unscanned && onMac ? '<div class="p">click: open Full Disk Access settings</div>' : '') +
        (n.path ? '<div class="p">right-click: menu · shift-click: add to basket</div>' : '');
    placeNear(t, e.clientX, e.clientY);
}

// Puts a floating box next to the pointer: inside the window, and never over the pointer itself (a box under the
// pointer would flicker as the mouse moves). Below or above the pointer if it fits there, sliding sideways as
// needed; otherwise to its right or left, sliding up or down.
function placeNear(el, x, y) {
    const gap = 16, edge = 6, W = innerWidth, H = innerHeight;
    el.style.left = '0px';   // measure at full width, not squeezed against the window's right edge
    el.style.top = '0px';
    const w = el.offsetWidth, h = el.offsetHeight;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    const below = y + gap + h <= H - edge, above = y - gap - h >= edge;
    const right = x + gap + w <= W - edge, left = x - gap - w >= edge;
    let l, t;
    if (below || above) {
        t = below ? y + gap : y - gap - h;
        l = clamp(right ? x + gap : left ? x - gap - w : x - w / 2, edge, W - w - edge);
    } else if (right || left) {
        l = right ? x + gap : x - gap - w;
        t = clamp(y - h / 2, edge, H - h - edge);
    } else {   // a window too small for the box anywhere around the pointer
        l = clamp(x + gap, edge, W - w - edge);
        t = clamp(y + gap, edge, H - h - edge);
    }
    el.style.left = l + 'px';
    el.style.top = t + 'px';
}
function hideTip() { $('tip').hidden = true; }

// ---- right-click menu ---------------------------------------------------------------------------------------------
// The same menu on a slice, a block and a row: open it (a folder in the chart, a file in its own app), add it to the
// basket, show it in the file manager, or go one folder up as right-click did before.

let menuItems = [];

function showMenu(e, n) {
    e.preventDefault();
    hideTip();
    const real = n && n.path;
    menuItems = [];
    if (real) {
        const here = current && n.path === current.path;
        menuItems.push({label: 'Open', off: here, run: () => (n.isDir ? open(n.path) : OpenFile(n.path))});
        menuItems.push({label: basket.has(n.path) ? 'Remove from basket' : 'Add to basket', run: () => toggleBasket(n)});
        menuItems.push({label: revealLabel, run: () => Reveal(n.path)});
        menuItems.push(null);
    }
    menuItems.push({label: 'One folder up', off: !current || current.path === scanRoot, run: goUp});
    const m = $('menu');
    m.innerHTML = (real ? `<div class="mh">${esc(n.name)}</div>` : '') + menuItems.map((it, i) => (it ?
        `<button data-i="${i}"${it.off ? ' disabled' : ''}>${esc(it.label)}</button>` : '<hr>')).join('');
    m.hidden = false;
    placeNear(m, e.clientX - 14, e.clientY - 14);   // the menu opens right at the pointer
}
function hideMenu() { $('menu').hidden = true; }
$('menu').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    hideMenu();
    menuItems[+b.dataset.i].run();
};
$('menu').oncontextmenu = (e) => e.preventDefault();
addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) hideMenu(); }, true);
// Escape closes the menu, or else lets go of what is picked in the treemap.
addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('menu').hidden) hideMenu();
    else if (wds() && selected) select('');
});
addEventListener('blur', hideMenu);
addEventListener('wheel', hideMenu, {passive: true});

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

// The window title names what is open: the disk's name, or the folder's for a folder scan.
function showTitle(path) {
    const disk = volumes.find((v) => v.path === path);
    const name = disk ? disk.name : path.split(/[\\/]/).filter(Boolean).pop() || path;
    WindowSetTitle(`mormiDiskFree – ${name}`);
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
    mapData = null;
    mapLayout = null;
    mapLeaves = [];
    selected = '';
    selectedExt = null;
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
    showTitle(path);
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
        showTitle(path);
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
addEventListener('resize', () => { if (current) redrawPicture(); });
$('viewtoggle').onclick = () => setView(view === 'treemap' ? 'sunburst' : 'treemap');
setView(view);
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
