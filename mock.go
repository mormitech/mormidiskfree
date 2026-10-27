package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"mormidiskfree/internal/disk"
)

// Demo mode (--mock <platform>, or --demo): the app shows a made-up set of disks instead of the real ones, so
// screenshots and demos do not show anyone's files. The disks live in mock/<platform>.json, written by
// scripts/make-mock.mjs. Nothing is read from or written to the real disk: no scan, no cache, no session, no Trash.

//go:embed mock/*.json
var mockFiles embed.FS

// mockPlatforms maps the names accepted on the command line to the file and to the runtime.GOOS value the UI expects.
var mockPlatforms = map[string]struct{ file, goos string }{
	"windows": {"windows", "windows"},
	"win":     {"windows", "windows"},
	"linux":   {"linux", "linux"},
	"macos":   {"macos", "darwin"},
	"mac":     {"macos", "darwin"},
	"darwin":  {"macos", "darwin"},
}

// mockSavedAgo is how old the pretend "saved scan" of every disk is, so the start screen looks lived-in.
const mockSavedAgo = 2 * time.Hour

type mockNode struct {
	Name     string      `json:"name"`
	Size     int64       `json:"size"`
	Children []*mockNode `json:"children"`
}

type mockVolume struct {
	Name  string    `json:"name"`
	Path  string    `json:"path"`
	Total uint64    `json:"total"`
	Free  uint64    `json:"free"`
	Tree  *mockNode `json:"tree"`
}

type mockFile struct {
	Home    string       `json:"home"`
	Sep     string       `json:"sep"`
	Volumes []mockVolume `json:"volumes"`
}

// mockFS is the fictional file system: one scanned tree per volume, with an index to look folders up by path.
type mockFS struct {
	goos    string
	home    string
	volumes []disk.Volume
	roots   map[string]*Node // volume path -> tree
	index   map[string]*Node // path -> node, for every node of every tree
	parent  map[*Node]*Node
	volOf   map[*Node]string // root node -> volume path
	savedAt int64
}

// loadMock reads the fictional disks of platform (windows, linux, macos).
func loadMock(platform string) (*mockFS, error) {
	p, ok := mockPlatforms[strings.ToLower(platform)]
	if !ok {
		return nil, fmt.Errorf("unknown mock platform %q (use windows, linux or macos)", platform)
	}
	data, err := mockFiles.ReadFile("mock/" + p.file + ".json")
	if err != nil {
		return nil, err
	}
	var f mockFile
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, err
	}
	m := &mockFS{
		goos: p.goos, home: f.Home,
		roots:   map[string]*Node{},
		index:   map[string]*Node{},
		parent:  map[*Node]*Node{},
		volOf:   map[*Node]string{},
		savedAt: time.Now().Add(-mockSavedAgo).Unix(),
	}
	for _, v := range f.Volumes {
		root := m.build(v.Tree, v.Path, nil, f.Sep)
		m.roots[v.Path] = root
		m.volOf[root] = v.Path
		m.volumes = append(m.volumes, disk.Volume{Name: v.Name, Path: v.Path, Total: v.Total, Free: v.Free})
	}
	return m, nil
}

// build turns a JSON node into a scanner Node (paths, sizes and item counts filled in, biggest first) and indexes it.
func (m *mockFS) build(j *mockNode, path string, parent *Node, sep string) *Node {
	n := &Node{Name: j.Name, Path: path, IsDir: j.Children != nil}
	m.index[path] = n
	m.parent[n] = parent
	if !n.IsDir {
		n.Size, n.Items = j.Size, 1
		return n
	}
	for _, c := range j.Children {
		cp := path + sep + c.Name
		if strings.HasSuffix(path, sep) {
			cp = path + c.Name
		}
		child := m.build(c, cp, n, sep)
		n.Children = append(n.Children, child)
		n.Size += child.Size
		n.Items += child.Items
	}
	sort.SliceStable(n.Children, func(i, k int) bool { return n.Children[i].Size > n.Children[k].Size })
	return n
}

// volumeOf returns the volume (disk.Volume index) that holds path: the one with the longest matching root.
func (m *mockFS) volumeOf(path string) (int, bool) {
	best, found := -1, false
	for i, v := range m.volumes {
		if strings.HasPrefix(path, v.Path) && (!found || len(v.Path) > len(m.volumes[best].Path)) {
			best, found = i, true
		}
	}
	return best, found
}

func (m *mockFS) usage(path string) (disk.Usage, error) {
	i, ok := m.volumeOf(path)
	if !ok {
		return disk.Usage{}, errors.New("not a mock disk: " + path)
	}
	return disk.Usage{Total: m.volumes[i].Total, Free: m.volumes[i].Free}, nil
}

// remove takes the node at path out of its tree (like the real Trash does after the file is gone) and gives its space
// back to the volume.
func (m *mockFS) remove(path string) bool {
	n := m.index[path]
	if n == nil || m.parent[n] == nil {
		return false
	}
	p := m.parent[n]
	for i, c := range p.Children {
		if c == n {
			p.Children = append(p.Children[:i], p.Children[i+1:]...)
			break
		}
	}
	for a := p; a != nil; a = m.parent[a] {
		a.Size -= n.Size
		a.Items -= n.Items
	}
	if i, ok := m.volumeOf(path); ok {
		m.volumes[i].Free += uint64(n.Size)
	}
	m.unindex(n)
	return true
}

func (m *mockFS) unindex(n *Node) {
	delete(m.index, n.Path)
	delete(m.parent, n)
	for _, c := range n.Children {
		m.unindex(c)
	}
}

// lookupLocked finds path in the current tree. The caller holds a.mu.
func (a *App) lookupLocked(path string) *Node {
	if a.mock != nil {
		if n := a.mock.index[path]; n != nil && a.root != nil && a.mock.rootOf(n) == a.root {
			return n
		}
		return nil
	}
	return find(a.root, path)
}

// rootOf is the top of the tree n belongs to.
func (m *mockFS) rootOf(n *Node) *Node {
	for m.parent[n] != nil {
		n = m.parent[n]
	}
	return n
}

// mockOpen makes the fictional disk at path the scanned tree. With savedOnly it behaves like a cache hit.
func (a *App) mockOpen(path string, saved bool) (*ScanResult, error) {
	root := a.mock.roots[path]
	if root == nil {
		if saved {
			return nil, nil
		}
		return nil, errors.New("not a mock disk: " + path)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	at := time.Now().Unix()
	if saved {
		at = a.mock.savedAt
	}
	a.root, a.scanAt = root, at
	return &ScanResult{Node: prune(root, viewDepth), At: at, Cached: saved}, nil
}

// mockRescan has nothing to walk, so it shows the folder as it is.
func (a *App) mockRescan(path string) (*ScanResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	n := a.lookupLocked(path)
	if n == nil || !n.IsDir {
		return nil, errors.New("not a scanned folder: " + path)
	}
	return &ScanResult{Node: prune(n, viewDepth), At: a.scanAt}, nil
}

// mockTrash removes the paths from the fictional tree; nothing real is touched.
func (a *App) mockTrash(paths []string) TrashResult {
	var res TrashResult
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, p := range paths {
		if a.root == nil || p == a.root.Path || a.lookupLocked(p) == nil || !a.mock.remove(p) {
			res.Failed = append(res.Failed, p+": not inside the scanned folder")
			continue
		}
		res.Trashed = append(res.Trashed, p)
	}
	return res
}
