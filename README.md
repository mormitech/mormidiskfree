<h1 align="center">mormiDiskFree</h1>

<p align="center">
  <b>See what is eating your disk.</b><br>
  A free, open-source disk space analyzer for macOS, Windows and Linux.
</p>

<p align="center">
  <a href="https://github.com/mormitech/mormidiskfree/actions/workflows/build.yml"><img alt="build" src="https://github.com/mormitech/mormidiskfree/actions/workflows/build.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg">
  <img alt="status" src="https://img.shields.io/badge/status-early%20preview-orange.svg">
</p>

<p align="center">
  <a href="https://mormitech.com/mctools/mcdiskfree/"><img alt="mormiDiskFree showing a whole disk as an interactive sunburst chart" src="https://mormitech.com/mctools/mcdiskfree/assets/mcdiskfree_02-whole-disk.png" width="820"></a>
</p>

---

## Our goal

> **A disk analyzer that is free, forever, on every platform, and installed the way you install everything else.**

```
brew install mormitech/tap/mormidiskfree          # macOS, Apple silicon     (available now)
scoop bucket add mormitech https://github.com/mormitech/scoop-bucket && scoop install mormidiskfree   # Windows (available now)
winget install mormitech.mormidiskfree               # Windows                  (coming: submitted to Microsoft)
brew install mormitech/tap/mormidiskfree          # Linux x64                (available now)
```

Good disk analyzers exist, but the best ones are paid and tied to one operating system. mormiDiskFree is an attempt to
build the same experience (a clear, interactive picture of where your space went) as a small native app that costs
nothing, has no accounts, no ads, no telemetry and no upsell, and is installable with the package manager you already use.

## What it does

mormiDiskFree scans a folder or a whole disk and draws it as an interactive **sunburst chart**: every ring is a folder
level, every slice is sized by the space it takes on disk.

- **Click to drill in.** Click a slice to open the folder, the centre (or **↑ Up**, or right-click) to go back, **⌂ Root** to jump to the top.
- **Whole-disk view.** The start screen lists your disks with their usage; scan one and the free space shows up as a dashed slice.
- **Free space always visible.** Size and free space of the disk you are looking at, in the header and in the centre of the chart.
- **A tree next to the chart.** Open folders with the triangle without leaving your place in the chart; every row shows its share.
- **A basket, and a safe delete.** Collect files and folders (hover a row → **+ Basket**, or shift-click a slice), then **Move to Trash**.
  Things only ever go to the Trash / Recycle Bin, never a permanent delete, and only from inside the folder you scanned.
- **Instant reopen.** Scans are cached; opening a disk you scanned before shows it at once ("scanned 2 h ago"). Rescan everything, or just one folder.
- **Picks up where you left off.** Restarting restores the disk and folder you were looking at.
- **Native window, one small binary.** Not a browser tab, not a 200 MB Electron app.

## Install

mormiDiskFree is an **early preview** (version 0.6). Pick your system:

**macOS** (Apple silicon), with [Homebrew](https://brew.sh):

```
brew install mormitech/tap/mormidiskfree
```

**Windows**: with [Scoop](https://scoop.sh): `scoop bucket add mormitech https://github.com/mormitech/scoop-bucket` then `scoop install mormidiskfree`. `winget install mormitech.mormidiskfree` is coming; the package is submitted and waits for Microsoft's approval. Or
download `mormidiskfree-setup-<version>-windows-x64.exe` from the [latest release](https://github.com/mormitech/mormidiskfree/releases/latest)
and run it (no admin rights needed; `/VERYSILENT` installs without any window).

**Linux** (x64), with [Homebrew](https://brew.sh) (a current version, which installs casks on Linux too): `brew install mormitech/tap/mormidiskfree`. You still need GTK 3 and WebKitGTK 4.1 from your distribution (see below). Or download `mormidiskfree-<version>-linux-x64.tar.gz` from the latest release, extract it and run `mormidiskfree`.
You need GTK 3 and WebKitGTK 4.1 installed (`libgtk-3-0` and `libwebkit2gtk-4.1-0` on Debian and Ubuntu).

**From source**, it takes a minute:

```
git clone https://github.com/mormitech/mormidiskfree
cd mormidiskfree/frontend && npm install && cd ..
wails build            # the app ends up in build/bin
```

You need [Go](https://go.dev), Node and the [Wails](https://wails.io) CLI
(`go install github.com/wailsapp/wails/v2/cmd/wails@latest`). On Linux also `libgtk-3-dev libwebkit2gtk-4.1-dev`, and
build with `-tags webkit2_41`.

### Platform status

| | macOS | Windows | Linux |
|---|---|---|---|
| Builds and tests in CI | ✅ | ✅ (installer installed, started and uninstalled on a runner) | ✅ |
| Used and tried by hand | ✅ (Apple silicon) | ⏳ not yet | ⏳ not yet |
| Install | `brew install mormitech/tap/mormidiskfree` ✅ | installer on the release ✅, `scoop install mormidiskfree` ✅, winget ⏳ (submitted) | tar.gz on the release ✅, `brew install mormitech/tap/mormidiskfree` ✅ |
| Move to Trash | Finder (so "Put Back" works) | Recycle Bin (untested) | `gio trash` or `trash-put` (untested) |

Releases are not code-signed yet. The Homebrew cask clears the macOS download flag, so brew installs open without a
warning; if you download the zip yourself, use **Open Anyway** in System Settings → Privacy & Security. On Windows,
SmartScreen shows **More info → Run anyway**. Free signing for Windows is planned (see the roadmap).

## Privacy

mormiDiskFree makes no network connections and sends nothing anywhere. The only thing it writes is its cache: a
compressed copy of your last scans (file and folder names and sizes) in your user cache folder
(`~/Library/Caches/mormidiskfree`, `%LocalAppData%\mormidiskfree`, `~/.cache/mormidiskfree`). Delete that folder any time.

## How it works

- **Scanner (Go).** Walks the tree in parallel, counts the space files take **on disk** (allocated blocks, not nominal
  size), skips symlinks and does not cross into other mounted volumes.
- **Chart and UI (vanilla JS + d3).** A webview inside a native window (Wails); `d3-hierarchy` and `d3-shape` draw the sunburst.
- **Cache.** Each full scan is saved as a gzip-compressed file, standard library only, no database. The biggest 100
  entries per folder are kept, the rest becomes "smaller items". A folder's modification time is deliberately **not**
  used to skip work: it does not change when a file inside grows, so a cached size could silently be wrong. Instead the
  age is always shown and one folder can be rescanned and merged in.
- **OS specifics** (volume list, free space, Trash) live in [`internal/disk`](internal/disk), one small file per platform.

## Roadmap

Next, in this order:

1. **Finish shipping.** ✅ Homebrew cask and release builds. Next: winget approval, signing
   (free open-source signing for Windows; macOS notarization costs money), first real tests on Windows and Linux. *(This is the goal.)*
2. **Honest numbers.** Detect folders it may not read (macOS Full Disk Access) and say so; show purgeable space and
   snapshots so the chart adds up to the disk; handle APFS clones, hard links and iCloud placeholders.
3. **Live scan.** Watch the chart grow while it scans.
4. **Quality of life.** App icon, search, keyboard navigation, drag a folder onto the window, file-type colours,
   Quick Look, short explanations for system folders, units and theme settings.
5. **Real change detection** with file-system events, for instant incremental updates.

Have an idea or found a bug? [Open an issue](https://github.com/mormitech/mormidiskfree/issues).

## Develop

```
cd frontend && npm install && cd ..
wails dev          # live-reloading window
go test ./...
```

| Path | What |
|---|---|
| `scan.go` | parallel scanner, tree helpers |
| `cache.go`, `session.go` | saved scans and the last session |
| `app.go` | the methods the UI calls |
| `mock.go`, `mock/` | demo mode: fictional disks (`scripts/make-mock.mjs` regenerates them) |
| `internal/disk` | volumes, free space, Trash, per OS (cross-compiles on its own) |
| `frontend/` | the UI |
| `.github/workflows/build.yml` | builds and tests on macOS, Windows and Linux |

**Demo mode** shows made-up disks instead of yours, handy for screenshots. Nothing real is scanned, cached or deleted:

```
mormidiskfree --mock windows      # or linux, macos; --mock=windows and --demo work too
```

The version lives in one place, `wails.json`.

Changes to `main` go through a pull request. A release is cut by pushing a `v*` tag that matches the version in `wails.json`.

## Disclaimer

mormiDiskFree is free software, provided by Mormitech **"as is" and "as available"**, without warranty of any kind, express
or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, accuracy and
non-infringement.

By installing or using mormiDiskFree you acknowledge and agree that:

- **Your data is your responsibility.** The app can move files and folders to the Trash or Recycle Bin. You decide what
  is selected and removed. Keep current backups of everything you care about, and review the basket before you confirm.
- **Results may be incomplete or inaccurate.** Sizes, free space and scan results can differ from what your operating
  system reports (for example because of permissions, purgeable space, snapshots, clones, hard links or files that
  change during a scan). Do not rely on them as the only basis for decisions.
- **No liability.** To the maximum extent permitted by applicable law, Mormitech and the contributors to this project
  exclude all liability for any loss or damage of any kind arising out of or in connection with the software or its use,
  including data loss, corruption, system instability, downtime, loss of profit or any direct, indirect, incidental,
  special, consequential or other side effect, even if advised of the possibility of such damage.
- **Use at your own risk.** Nothing here excludes or limits liability that cannot be excluded or limited by law.

This notice supplements the [MIT license](LICENSE), whose warranty disclaimer and limitation of liability apply in full.

## License

[MIT](LICENSE): use it, copy it, change it, distribute it, even sell it, for personal, commercial and corporate use,
free of charge. The only condition is that the copyright and license notice stay with the software. In return, the
software comes without any warranty and the authors are not liable for anything (see the Disclaimer above).
