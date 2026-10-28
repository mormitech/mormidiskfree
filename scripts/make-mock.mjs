// Generates the fictional disks for the demo mode (mock/windows.json, mock/linux.json, mock/macos.json).
// Run it from the repository root: node scripts/make-mock.mjs
// The output is deterministic (seeded), so regenerating gives the same files unless this script changes.
import {writeFileSync} from 'node:fs';

const KB = 1024, MB = KB * 1024, GB = MB * 1024, TB = GB * 1024;

let seed = 20240607;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const between = (lo, hi) => lo + rnd() * (hi - lo);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const file = (name, size) => ({name, size: Math.round(size)});
const dir = (name, ...children) => ({name, children: children.flat()});
// count numbered files like "IMG_0042.jpg", each between lo and hi bytes
const series = (count, name, lo, hi) => Array.from({length: count}, (_, i) => file(name(i + 1), between(lo, hi)));
const pad = (n, w = 4) => String(n).padStart(w, '0');
// a folder of count files with random names from words, e.g. for source trees or game assets
const blob = (count, words, ext, lo, hi) => series(count, (i) => `${pick(words)}_${pad(i, 3)}.${ext}`, lo, hi);

const WORDS = ['alpha', 'terrain', 'sky', 'props', 'audio', 'level', 'ui', 'fx', 'npc', 'weapon', 'shader', 'cache', 'town', 'forest', 'dungeon'];

const game = (name, packs, extra = []) => dir(name,
    packs.map(([n, size]) => file(n, size)),
    dir('Engine', blob(14, WORDS, 'dll', 2 * MB, 40 * MB)),
    dir('Content', blob(60, WORDS, 'pak', 20 * MB, 900 * MB)),
    dir('Saved', series(8, (i) => `slot${i}.sav`, 1 * MB, 14 * MB)),
    extra);

const photos = (years) => years.map((y) => dir(String(y),
    ...['01 January', '03 March', '05 May', '07 July', '08 August', '10 October', '12 December']
        .map((m) => dir(m, series(Math.round(between(30, 70)), (i) => `IMG_${pad(i + y)}.jpg`, 2.5 * MB, 9 * MB),
            series(3, (i) => `MVI_${pad(i + 100)}.mp4`, 60 * MB, 300 * MB)))));

const docs = () => [
    dir('Work', dir('Contracts', series(40, (i) => `contract-${pad(i, 3)}.pdf`, 200 * KB, 4 * MB)),
        dir('Presentations', series(25, (i) => `deck-${pad(i, 3)}.pptx`, 3 * MB, 60 * MB)),
        dir('Reports', series(60, (i) => `report-${pad(i, 3)}.docx`, 100 * KB, 6 * MB)),
        dir('Spreadsheets', series(45, (i) => `budget-${pad(i, 3)}.xlsx`, 50 * KB, 12 * MB))),
    dir('Taxes', series(18, (i) => `tax-return-${2005 + i}.pdf`, 400 * KB, 3 * MB)),
    dir('Books', series(70, (i) => `book-${pad(i, 3)}.epub`, 500 * KB, 30 * MB)),
    dir('Scans', series(120, (i) => `scan-${pad(i)}.pdf`, 1 * MB, 18 * MB)),
];

const music = () => ['Aurora Lane', 'The Midnight Owls', 'Static Bloom', 'Cobalt Coast', 'Velvet Engine', 'Lo-Fi Harbor', 'Paper Planes', 'Northbound']
    .map((a) => dir(a, dir(`${a} - Debut`, series(12, (i) => `${pad(i, 2)} Track.flac`, 22 * MB, 48 * MB)),
        dir(`${a} - Live`, series(14, (i) => `${pad(i, 2)} Live.mp3`, 6 * MB, 14 * MB))));

const movies = (k = 1) => [
    ...['Ocean Deep', 'Night Train', 'The Last Orchard', 'Signal Lost', 'Paper Moon', 'Redline', 'Iron Valley', 'Quiet Storm']
        .map((t, i) => file(`${t} (${2008 + i * 2}) 2160p.mkv`, between(22 * GB, 58 * GB) * k)),
    ...['Blue Planet Live', 'Harbor Lights', 'Desert Run', 'City of Glass', 'Long Way Home', 'Afterglow']
        .map((t, i) => file(`${t} (${2011 + i * 2}) 1080p.mkv`, between(6 * GB, 14 * GB) * k)),
    dir('Series', ...['Dark Water', 'The Operators', 'Kitchen Table'].map((s) =>
        dir(s, ...[1, 2, 3].map((n) => dir(`Season ${n}`, series(10, (e) => `S${pad(n, 2)}E${pad(e, 2)}.mkv`, 1.2 * GB * k, 3.8 * GB * k)))))),
];

const code = () => [
    dir('mormidiskfree', dir('src', blob(180, WORDS, 'go', 2 * KB, 40 * KB)),
        dir('node_modules', ...Array.from({length: 40}, (_, i) => dir(`pkg-${pad(i, 2)}`, blob(60, WORDS, 'js', 4 * KB, 400 * KB)))),
        dir('.git', blob(90, WORDS, 'pack', 200 * KB, 90 * MB))),
    dir('website', dir('src', blob(220, WORDS, 'tsx', 1 * KB, 30 * KB)),
        dir('node_modules', ...Array.from({length: 60}, (_, i) => dir(`dep-${pad(i, 2)}`, blob(70, WORDS, 'js', 4 * KB, 600 * KB)))),
        dir('.next', blob(120, WORDS, 'js', 20 * KB, 3 * MB))),
    dir('ml-experiments', dir('datasets', blob(30, WORDS, 'parquet', 100 * MB, 2.2 * GB)),
        dir('checkpoints', series(14, (i) => `model-step-${i * 1000}.safetensors`, 1.5 * GB, 7 * GB))),
    dir('docker', file('Docker.raw', 38 * GB)),
];

const vms = () => [
    file('ubuntu-24.04-dev.vdi', 42 * GB), file('windows-11-test.vhdx', 64 * GB), file('kali-lab.vmdk', 28 * GB),
    file('ubuntu-24.04.1-desktop-amd64.iso', 6.2 * GB), file('Win11_23H2_English_x64.iso', 6.8 * GB),
];

const downloads = () => [
    ...series(45, (i) => `installer-${pad(i, 3)}.zip`, 20 * MB, 1.8 * GB),
    ...series(30, (i) => `invoice-${pad(i, 3)}.pdf`, 80 * KB, 900 * KB),
    ...series(12, (i) => `backup-${pad(i, 2)}.tar.gz`, 800 * MB, 5 * GB),
    file('big-dataset.csv', 11 * GB),
];

// ---- Windows --------------------------------------------------------------------------------------------------------
function windows() {
    const system = dir('C:',
        dir('Windows',
            dir('System32', blob(900, WORDS, 'dll', 100 * KB, 18 * MB), blob(40, WORDS, 'exe', 500 * KB, 30 * MB)),
            dir('WinSxS', ...Array.from({length: 120}, (_, i) => dir(`amd64_component_${pad(i, 3)}`, blob(24, WORDS, 'dll', 100 * KB, 40 * MB)))),
            dir('SoftwareDistribution', blob(60, WORDS, 'cab', 5 * MB, 600 * MB)),
            dir('Installer', blob(150, WORDS, 'msi', 1 * MB, 200 * MB)),
            dir('Fonts', series(250, (i) => `font-${pad(i, 3)}.ttf`, 80 * KB, 8 * MB)),
            dir('Logs', series(80, (i) => `CBS-${pad(i, 3)}.log`, 100 * KB, 90 * MB))),
        dir('Program Files',
            dir('Microsoft Office', blob(260, WORDS, 'dll', 500 * KB, 70 * MB)),
            dir('Adobe', dir('Adobe Photoshop 2025', blob(300, WORDS, 'dll', 1 * MB, 90 * MB)), dir('Adobe Premiere Pro 2025', blob(280, WORDS, 'dll', 1 * MB, 110 * MB))),
            dir('Blender Foundation', dir('Blender 4.2', blob(220, WORDS, 'dll', 500 * KB, 60 * MB))),
            dir('JetBrains', dir('Rider 2025.1', blob(240, WORDS, 'jar', 1 * MB, 90 * MB))),
            dir('Google', dir('Chrome', blob(60, WORDS, 'dll', 1 * MB, 200 * MB))),
            dir('Docker', blob(80, WORDS, 'exe', 5 * MB, 400 * MB))),
        dir('Program Files (x86)',
            dir('Steam', dir('steamapps', game('common', [['launcher.pak', 3 * GB]]).children.slice(1, 3)), blob(40, WORDS, 'dll', 1 * MB, 80 * MB)),
            dir('Microsoft', blob(100, WORDS, 'dll', 500 * KB, 60 * MB))),
        dir('ProgramData', dir('Package Cache', blob(80, WORDS, 'exe', 5 * MB, 300 * MB)), dir('NVIDIA Corporation', blob(40, WORDS, 'bin', 20 * MB, 600 * MB))),
        dir('Users', dir('alex',
            dir('Documents', docs()),
            dir('Pictures', photos([2021, 2022, 2023, 2024])),
            dir('Videos', series(35, (i) => `screen-recording-${pad(i, 3)}.mp4`, 100 * MB, 1.5 * GB)),
            dir('Music', music()),
            dir('Downloads', downloads()),
            dir('Desktop', series(25, (i) => `notes-${pad(i, 2)}.txt`, 1 * KB, 200 * KB)),
            dir('source', code()),
            dir('AppData',
                dir('Local', dir('Google', blob(120, WORDS, 'ldb', 5 * MB, 90 * MB)), dir('Temp', blob(200, WORDS, 'tmp', 100 * KB, 400 * MB)),
                    dir('Packages', blob(160, WORDS, 'db', 1 * MB, 120 * MB)), dir('Discord', blob(70, WORDS, 'asar', 5 * MB, 200 * MB))),
                dir('Roaming', dir('Code', blob(90, WORDS, 'json', 10 * KB, 30 * MB)), dir('Spotify', blob(50, WORDS, 'file', 5 * MB, 120 * MB)))),
            dir('OneDrive', series(140, (i) => `shared-${pad(i, 3)}.docx`, 100 * KB, 20 * MB))),
            dir('Public', series(10, (i) => `public-${i}.jpg`, 1 * MB, 6 * MB))),
        file('pagefile.sys', 12 * GB), file('hiberfil.sys', 6.4 * GB), file('swapfile.sys', 256 * MB));

    const games = dir('D:',
        game('Cyberpunk 2077', [['archive.pak', 62 * GB]], dir('bin', blob(30, WORDS, 'exe', 5 * MB, 80 * MB))),
        game('Baldurs Gate 3', [['Data.pak', 84 * GB]]),
        game('Elden Ring', [['data0.bdt', 38 * GB], ['data1.bdt', 14 * GB]]),
        game('Red Dead Redemption 2', [['RDR2.exe', 80 * MB], ['x64a.rpf', 28 * GB], ['x64b.rpf', 22 * GB]]),
        game('Microsoft Flight Simulator', [['Official.pak', 118 * GB]]),
        game('Call of Duty', [['warzone.pak', 96 * GB]]),
        game('Starfield', [['Starfield - Textures.ba2', 31 * GB]]),
        game('Hades II', [['Content.pkg', 12 * GB]]),
        game('Stardew Valley', [['Content.xnb', 1.2 * GB]]),
        game('Factorio', [['base.zip', 2.8 * GB]]),
        dir('Epic Games', dir('Fortnite', file('FortniteGame-Windows.pak', 41 * GB)), dir('Rocket League', file('rl.pak', 20 * GB))),
        dir('Mods', dir('Skyrim', blob(120, WORDS, 'esp', 5 * MB, 400 * MB)), dir('Cities Skylines', blob(60, WORDS, 'crp', 10 * MB, 600 * MB))),
        dir('Screenshots', series(300, (i) => `Screenshot_${pad(i)}.png`, 3 * MB, 14 * MB)),
        dir('Installers', file('GTA V - setup.exe', 4 * GB), file('Origin ISO.iso', 55 * GB)));

    const backup = dir('E:',
        dir('FileHistory', dir('alex', series(260, (i) => `Documents-${pad(i)}.zip`, 100 * MB, 3 * GB))),
        dir('Image Backups', file('C-drive-2024-03.vhdx', 380 * GB), file('C-drive-2024-09.vhdx', 410 * GB)),
        dir('Photos Archive', photos([2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020])),
        dir('Movies', movies()), dir('VMs', vms()));

    return {
        platform: 'windows', home: 'C:\\Users\\alex', sep: '\\',
        volumes: [
            {name: 'Windows (C:)', path: 'C:\\', total: 1 * TB, tree: system, ghost: 0.07},
            {name: 'Games (D:)', path: 'D:\\', total: 2 * TB, tree: games, ghost: 0.0},
            {name: 'Backup (E:)', path: 'E:\\', total: 4 * TB, tree: backup, ghost: 0.0},
        ],
    };
}

// ---- Linux ----------------------------------------------------------------------------------------------------------
function linux() {
    const root = dir('/',
        dir('usr', dir('lib', blob(900, WORDS, 'so', 100 * KB, 40 * MB)), dir('bin', blob(600, WORDS, 'bin', 30 * KB, 12 * MB)),
            dir('share', dir('fonts', series(140, (i) => `font-${pad(i, 3)}.ttf`, 80 * KB, 8 * MB)), dir('doc', series(400, (i) => `doc-${pad(i, 3)}.gz`, 2 * KB, 800 * KB)),
                dir('icons', series(500, (i) => `icon-${pad(i, 3)}.svg`, 2 * KB, 400 * KB))),
            dir('local', blob(30, WORDS, 'bin', 1 * MB, 60 * MB))),
        dir('var',
            dir('lib', dir('docker', file('overlay2.img', 36 * GB), blob(120, WORDS, 'layer', 20 * MB, 1.5 * GB)),
                dir('snapd', blob(50, WORDS, 'snap', 50 * MB, 1 * GB)), dir('flatpak', blob(70, WORDS, 'flatpak', 20 * MB, 1.2 * GB)),
                dir('apt', blob(40, WORDS, 'deb', 1 * MB, 200 * MB)), dir('postgresql', blob(80, WORDS, 'dat', 8 * MB, 800 * MB))),
            dir('log', series(120, (i) => `syslog.${i}.gz`, 200 * KB, 400 * MB), file('journal.journal', 4 * GB)),
            dir('cache', dir('apt', blob(70, WORDS, 'deb', 1 * MB, 250 * MB)), dir('pacman', blob(60, WORDS, 'zst', 1 * MB, 400 * MB)))),
        dir('opt', dir('google', dir('chrome', blob(50, WORDS, 'so', 1 * MB, 200 * MB))), dir('jetbrains', blob(120, WORDS, 'jar', 1 * MB, 90 * MB)),
            dir('zoom', blob(40, WORDS, 'so', 1 * MB, 100 * MB))),
        dir('boot', file('vmlinuz-6.8.0', 14 * MB), file('initrd.img-6.8.0', 120 * MB), file('initrd.img-6.5.0', 118 * MB), dir('grub', blob(30, WORDS, 'mod', 10 * KB, 400 * KB))),
        dir('etc', series(900, (i) => `conf-${pad(i)}.conf`, 1 * KB, 300 * KB)),
        dir('root', series(20, (i) => `file-${i}`, 1 * KB, 4 * MB)),
        file('swapfile', 16 * GB),
        dir('home', dir('sam',
            dir('Documents', docs()), dir('Pictures', photos([2022, 2023, 2024])), dir('Music', music()), dir('Videos', movies(0.08)),
            dir('Downloads', downloads()), dir('Desktop', series(15, (i) => `todo-${i}.md`, 1 * KB, 90 * KB)),
            dir('projects', code()), dir('VirtualBox VMs', vms()),
            dir('.cache', dir('mozilla', blob(100, WORDS, 'cache', 100 * KB, 90 * MB)), dir('pip', blob(50, WORDS, 'whl', 1 * MB, 400 * MB)),
                dir('JetBrains', blob(70, WORDS, 'idx', 1 * MB, 200 * MB))),
            dir('.config', dir('Code', blob(80, WORDS, 'json', 10 * KB, 40 * MB)), dir('google-chrome', blob(120, WORDS, 'ldb', 1 * MB, 100 * MB))),
            dir('.local', dir('share', dir('Steam', dir('steamapps', game('common', [['bundle.pak', 22 * GB]]).children.slice(1, 3))), dir('Trash', blob(60, WORDS, 'old', 100 * KB, 2 * GB))))),
            dir('guest', series(10, (i) => `guest-${i}.txt`, 1 * KB, 90 * KB))));

    const games = dir('games',
        game('Counter-Strike 2', [['pak01.vpk', 28 * GB]]),
        game('Cyberpunk 2077', [['archive.pak', 62 * GB]]),
        game('Baldurs Gate 3', [['Data.pak', 84 * GB]]),
        game('Dota 2', [['pak01_dir.vpk', 36 * GB]]),
        game('Hades', [['Content.pkg', 9 * GB]]),
        game('Factorio', [['base.zip', 2.8 * GB]]),
        game('Valheim', [['assets.bundle', 3.4 * GB]]),
        dir('Lutris', dir('wine-prefixes', blob(160, WORDS, 'reg', 10 * MB, 900 * MB)), dir('runners', blob(40, WORDS, 'tar', 100 * MB, 1.2 * GB))),
        dir('ROMs', ...['nes', 'snes', 'n64', 'ps1', 'gba'].map((c) => dir(c, blob(80, WORDS, c, 200 * KB, 700 * MB)))),
        dir('ISOs', file('archlinux-2024.iso', 1.2 * GB), file('debian-12-dvd.iso', 3.9 * GB), file('fedora-40.iso', 2.2 * GB)));

    const nas = dir('nas',
        dir('Movies', movies()), dir('Music', music()), dir('Photos', photos([2015, 2016, 2017, 2018, 2019, 2020, 2021])),
        dir('Backups', dir('timeshift', ...series(8, (i) => `snapshot-${pad(i, 2)}.tar.zst`, 20 * GB, 60 * GB)), dir('restic', blob(300, WORDS, 'pack', 20 * MB, 800 * MB))));

    return {
        platform: 'linux', home: '/home/sam', sep: '/',
        volumes: [
            {name: 'root', path: '/', total: 2 * TB, tree: root, ghost: 0.04},
            {name: 'games', path: '/mnt/games', total: 2 * TB, tree: games, ghost: 0.0},
            {name: 'nas', path: '/mnt/nas', total: 8 * TB, tree: nas, ghost: 0.0},
        ],
    };
}

// ---- macOS ----------------------------------------------------------------------------------------------------------
function macos() {
    const data = dir('Data',
        dir('Applications',
            ...['Xcode', 'Final Cut Pro', 'Logic Pro', 'Adobe Photoshop 2025', 'Docker', 'Visual Studio Code', 'Blender', 'Unity Hub', 'Slack', 'Figma']
                .map((a) => dir(`${a}.app`, dir('Contents', dir('Frameworks', blob(80, WORDS, 'dylib', 500 * KB, 120 * MB)), dir('Resources', blob(120, WORDS, 'car', 100 * KB, 400 * MB)))))),
        dir('Library',
            dir('Developer', dir('CoreSimulator', dir('Devices', ...Array.from({length: 8}, (_, i) => dir(`device-${i}`, blob(40, WORDS, 'sqlite', 5 * MB, 700 * MB)))))),
            dir('Caches', blob(160, WORDS, 'cache', 100 * KB, 400 * MB)),
            dir('Application Support', dir('Steam', dir('steamapps', game('common', [['bundle.pak', 22 * GB]]).children.slice(1, 3))), blob(100, WORDS, 'db', 1 * MB, 300 * MB)),
            dir('Logs', series(60, (i) => `diag-${pad(i, 3)}.log`, 100 * KB, 90 * MB)),
            dir('Updates', file('macOS-Sequoia-15.2.pkg', 14 * GB))),
        dir('private', dir('var', dir('folders', blob(120, WORDS, 'tmp', 100 * KB, 800 * MB)), dir('vm', file('sleepimage', 16 * GB), file('swapfile0', 1 * GB)))),
        dir('opt', dir('homebrew', dir('Cellar', ...['llvm', 'node', 'python@3.12', 'ffmpeg', 'postgresql@16', 'qt', 'go', 'rust', 'openjdk']
            .map((p) => dir(p, blob(90, WORDS, 'dylib', 100 * KB, 90 * MB)))))),
        dir('Users', dir('jamie',
            dir('Desktop', series(30, (i) => `Screenshot 2024-0${1 + (i % 9)}-${pad(i, 2)}.png`, 800 * KB, 12 * MB)),
            dir('Documents', docs(), dir('Final Cut Projects', file('Wedding.fcpbundle', 52 * GB), file('Travel Vlog.fcpbundle', 31 * GB))),
            dir('Downloads', downloads(), file('Xcode_16.xip', 3.2 * GB)),
            dir('Movies', movies(0.08)), dir('Music', dir('Music', music()), dir('GarageBand', blob(40, WORDS, 'band', 20 * MB, 1.4 * GB))),
            dir('Pictures', dir('Photos Library.photoslibrary', dir('originals', ...photos([2020, 2021, 2022, 2023, 2024])), dir('resources', blob(260, WORDS, 'jpg', 100 * KB, 4 * MB)))),
            dir('Code', code()),
            dir('Library', dir('Containers', dir('com.docker.docker', file('Docker.raw', 52 * GB))), dir('Caches', blob(140, WORDS, 'cache', 100 * KB, 300 * MB)),
                dir('Mobile Documents', blob(180, WORDS, 'pdf', 100 * KB, 60 * MB)), dir('Application Support', blob(120, WORDS, 'db', 1 * MB, 250 * MB))),
            dir('Parallels', file('Windows 11.pvm', 64 * GB), file('Ubuntu.pvm', 24 * GB)),
            dir('Games', game('Baldurs Gate 3', [['Data.pak', 84 * GB]]), game('Civilization VI', [['Assets.pak', 14 * GB]]), game('Stardew Valley', [['Content.xnb', 1.2 * GB]]), game('Hades', [['Content.pkg', 9 * GB]]),
                game('Factorio', [['base.zip', 2.8 * GB]]), dir('Screenshots', series(160, (i) => `Screenshot_${pad(i)}.png`, 2 * MB, 12 * MB))),
            dir('.Trash', file('old-project.zip', 6 * GB), blob(40, WORDS, 'tmp', 100 * KB, 300 * MB)))),
        dir('Volumes-Data-Misc', blob(20, WORDS, 'bin', 1 * MB, 40 * MB)));

    const timeMachine = dir('Time Machine Backups', dir('Backups.backupdb', dir('Jamie MacBook Pro', ...series(10, (i) => `2024-0${1 + (i % 9)}-${pad(10 + i, 2)}-120000.sparsebundle`, 120 * GB, 300 * GB))));
    const media = dir('Media',
        dir('Photos Archive', photos([2013, 2014, 2015, 2016, 2017, 2018, 2019])), dir('Movies', movies()), dir('Music', music()),
        dir('Projects', dir('Raw Footage', series(90, (i) => `A001_C${pad(i, 3)}.braw`, 2 * GB, 14 * GB))));

    return {
        platform: 'macos', home: '/Users/jamie', sep: '/',
        volumes: [
            {name: 'Macintosh HD', path: '/System/Volumes/Data', total: 2 * TB, tree: data, ghost: 0.12},
            {name: 'Time Machine', path: '/Volumes/Time Machine', total: 4 * TB, tree: timeMachine, ghost: 0.0},
            {name: 'Media', path: '/Volumes/Media', total: 2 * TB, tree: media, ghost: 0.0},
        ],
    };
}

// Adds up a tree and, per volume, writes how much space is free: what the tree holds plus a share for things the scan
// would not see ("ghost"), such as system files. If the tree would not fit, the disk is enlarged to the next size up.
const sum = (n) => (n.children ? n.children.reduce((s, c) => s + sum(c), 0) : n.size);
const count = (n) => (n.children ? n.children.reduce((s, c) => s + count(c), 0) : 1);

for (const [name, make] of [['windows', windows], ['linux', linux], ['macos', macos]]) {
    const out = make();
    for (const v of out.volumes) {
        const used = sum(v.tree);
        let total = v.total;
        while (used > total * 0.93) total *= 2;
        v.total = total;
        v.free = Math.round(Math.max(total - used - total * v.ghost, total * 0.04));
        delete v.ghost;
    }
    writeFileSync(`mock/${name}.json`, JSON.stringify(out));
    console.log(name, out.volumes.map((v) => `${v.name}: ${count(v.tree)} files, ${(sum(v.tree) / GB).toFixed(0)} GB of ${(v.total / GB).toFixed(0)} GB`).join(' | '));
}
