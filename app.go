package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"
	"mormidiskfree/internal/disk"
)

// App is bound to the frontend: every exported method can be called from JavaScript.
type App struct {
	ctx    context.Context
	mu     sync.Mutex
	root   *Node
	scanAt int64 // unix seconds of the full scan the tree comes from
	cancel context.CancelFunc
	mock   *mockFS // set in demo mode: fictional disks instead of the real ones
	mode   string  // "" for the app, "about" for the About window
	wins   map[string]*exec.Cmd
}

func NewApp(mock *mockFS) *App { return &App{mock: mock} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.mode == "" {
		fitWindow(ctx, windowW, windowH)
	}
}

// Home is the folder the app offers to scan first.
func (a *App) Home() string {
	if a.mock != nil {
		return a.mock.home
	}
	h, _ := os.UserHomeDir()
	return h
}

// ChooseFolder opens the OS folder picker. It returns "" when the user cancels.
func (a *App) ChooseFolder() (string, error) {
	if a.mock != nil {
		return "", nil
	}
	return wr.OpenDirectoryDialog(a.ctx, wr.OpenDialogOptions{Title: "Folder to scan", DefaultDirectory: a.Home()})
}

// ScanResult is a tree for the UI. At is when the scan it came from was made (unix seconds).
type ScanResult struct {
	Node   *Node `json:"node"`
	At     int64 `json:"at"`
	Cached bool  `json:"cached"`
}

// walkWithProgress scans path, sending "progress" events (files seen so far), and can be stopped with Cancel.
func (a *App) walkWithProgress(path string) (*Node, error) {
	a.Cancel()
	ctx, cancel := context.WithCancel(a.ctx)
	a.mu.Lock()
	a.cancel = cancel
	a.mu.Unlock()
	defer cancel()

	s := &scanner{ctx: ctx, sem: make(chan struct{}, 32)}
	if info, err := os.Lstat(path); err == nil {
		s.device = deviceOf(info)
	}
	done := make(chan struct{})
	defer close(done)
	go func() {
		t := time.NewTicker(150 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				wr.EventsEmit(a.ctx, "progress", s.scanned.Load())
			}
		}
	}()

	root := s.walk(path, filepath.Base(path))
	if ctx.Err() != nil {
		return nil, errors.New("scan cancelled")
	}
	return root, nil
}

// persistLocked saves the current tree to the cache in the background. The caller holds a.mu.
func (a *App) persistLocked() {
	if a.root == nil || a.mock != nil {
		return
	}
	root, at, tree := a.root.Path, a.scanAt, compact(a.root)
	go func() {
		if err := writeSnapshot(root, at, tree); err != nil {
			println("cache not saved:", err.Error())
		}
	}()
}

// Scan walks path in full, replaces the cached result and returns the top of the tree.
func (a *App) Scan(path string) (*ScanResult, error) {
	if a.mock != nil {
		return a.mockOpen(path, false)
	}
	root, err := a.walkWithProgress(path)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.root, a.scanAt = root, time.Now().Unix()
	a.persistLocked()
	return &ScanResult{Node: prune(root, viewDepth), At: a.scanAt}, nil
}

// CachedScan loads the last saved scan of path. It returns nil when there is none.
func (a *App) CachedScan(path string) *ScanResult {
	if a.mock != nil {
		res, _ := a.mockOpen(path, true)
		return res
	}
	s, err := loadSnapshot(path)
	if err != nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.root, a.scanAt = s.Tree, s.At
	return &ScanResult{Node: prune(s.Tree, viewDepth), At: s.At, Cached: true}
}

// CacheTime is when path was last scanned in full (unix seconds), or 0 when it never was.
func (a *App) CacheTime(path string) int64 {
	if a.mock != nil {
		if a.mock.roots[path] == nil {
			return 0
		}
		return a.mock.savedAt
	}
	return cacheTime(path)
}

// RescanFolder walks only path, merges the result into the scanned tree (sizes above it are corrected) and saves it.
func (a *App) RescanFolder(path string) (*ScanResult, error) {
	if a.mock != nil {
		return a.mockRescan(path)
	}
	a.mu.Lock()
	n := (*Node)(nil)
	if a.root != nil {
		n = find(a.root, path)
	}
	atRoot := a.root != nil && a.root.Path == path
	a.mu.Unlock()
	if n == nil || !n.IsDir {
		return nil, errors.New("not a scanned folder: " + path)
	}
	if atRoot {
		return a.Scan(path)
	}
	fresh, err := a.walkWithProgress(path)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !replaceNode(a.root, path, fresh) {
		return nil, errors.New("folder vanished from the tree: " + path)
	}
	a.persistLocked()
	return &ScanResult{Node: prune(find(a.root, path), viewDepth), At: a.scanAt}, nil
}

// Cancel stops a running scan.
func (a *App) Cancel() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cancel != nil {
		a.cancel()
	}
}

// View returns the part of the scanned tree at path (from the scan already done, so it is instant).
func (a *App) View(path string) (*Node, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.root == nil {
		return nil, errors.New("nothing scanned yet")
	}
	n := a.lookupLocked(path)
	if n == nil {
		return nil, errors.New("not in the scanned tree: " + path)
	}
	return prune(n, viewDepth), nil
}

// Children returns what the folder at path holds, one level deep: all the folder list needs to open a folder, and
// much less to send than View's four levels.
func (a *App) Children(path string) (*Node, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.root == nil {
		return nil, errors.New("nothing scanned yet")
	}
	n := a.lookupLocked(path)
	if n == nil {
		return nil, errors.New("not in the scanned tree: " + path)
	}
	return prune(n, 1), nil
}

// Reveal shows path in the OS file manager.
func (a *App) Reveal(path string) error {
	if a.mock != nil {
		return nil
	}
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	case "windows":
		return exec.Command("explorer", "/select,", path).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(path)).Start()
	}
}

// OpenFile opens path with the app the OS uses for it.
func (a *App) OpenFile(path string) error {
	if a.mock != nil {
		return nil
	}
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path).Start()
	case "windows":
		// not "cmd /c start", which reads & and ^ in the path as its own syntax
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", path).Start()
	default:
		return exec.Command("xdg-open", path).Start()
	}
}

// Volumes lists the disks that can be scanned as a whole, with their free space.
func (a *App) Volumes() []disk.Volume {
	if a.mock != nil {
		return a.mock.volumes
	}
	return disk.Volumes()
}

// FreeSpace reports the size and free space of the volume that holds path.
func (a *App) FreeSpace(path string) (disk.Usage, error) {
	if a.mock != nil {
		return a.mock.usage(path)
	}
	return disk.UsageOf(path)
}

// TrashResult says which paths were moved to the Trash and why the others were not.
type TrashResult struct {
	Trashed []string `json:"trashed"`
	Failed  []string `json:"failed"`
}

// Trash moves paths from the scanned tree to the Trash / Recycle Bin (never a permanent delete) and takes them out of
// the tree. Only paths inside the scanned folder are accepted, never the scanned folder itself.
func (a *App) Trash(paths []string) TrashResult {
	if a.mock != nil {
		return a.mockTrash(paths)
	}
	var res TrashResult
	for _, p := range paths {
		a.mu.Lock()
		ok := a.root != nil && p != a.root.Path && find(a.root, p) != nil
		a.mu.Unlock()
		if !ok {
			res.Failed = append(res.Failed, p+": not inside the scanned folder")
			continue
		}
		if err := disk.Trash(p); err != nil {
			res.Failed = append(res.Failed, err.Error())
			continue
		}
		a.mu.Lock()
		removeFromTree(a.root, p)
		a.mu.Unlock()
		res.Trashed = append(res.Trashed, p)
	}
	if len(res.Trashed) > 0 {
		a.mu.Lock()
		a.persistLocked()
		a.mu.Unlock()
	}
	return res
}

// Version is the app version from wails.json.
func (a *App) Version() string { return version() }

// Platform is the operating system the app runs on ("darwin", "windows" or "linux"), so the UI can use its own words.
func (a *App) Platform() string {
	if a.mock != nil {
		return a.mock.goos
	}
	return runtime.GOOS
}

// Mode tells the UI what to show: "" for the app, "about" for the About window.
func (a *App) Mode() string { return a.mode }

// openWindow opens a window of its own: a second copy of this program, started with the given arguments, because
// Wails v2 has one window per process. A window that is already open (same key) is not opened twice.
func (a *App) openWindow(key string, args ...string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.wins == nil {
		a.wins = map[string]*exec.Cmd{}
	}
	if c := a.wins[key]; c != nil && c.ProcessState == nil {
		return nil
	}
	cmd := exec.Command(exe, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	a.wins[key] = cmd
	go func() {
		cmd.Wait()
		a.mu.Lock()
		delete(a.wins, key)
		a.mu.Unlock()
	}()
	return nil
}

// showAbout opens the About window.
func (a *App) showAbout() { a.openWindow("about", "--about") }

// shutdown closes the About window together with the app.
func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, c := range a.wins {
		if c.Process != nil {
			c.Process.Kill()
		}
	}
}
