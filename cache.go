package main

import (
	"compress/gzip"
	"crypto/sha1"
	"encoding/gob"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sort"
)

// The scan result of every root folder is kept in the user's cache directory (gob, gzip-compressed, standard library
// only), so reopening a disk or folder shows the last result at once and a rescan is the user's choice.
//
// A directory's modification time cannot be used to skip work: it does not change when a file inside it grows or when
// something deep below changes, so a reused size could be wrong. Instead the cache is explicit about its age, and a
// single folder can be rescanned (and merged into the cached tree) without walking the whole disk again.
const (
	cacheFormat = 1   // bump when Node or the file layout changes; older files are then ignored
	keepPerDir  = 100 // entries kept per folder in the cache; the rest is folded into one "smaller items" entry
)

type snapshot struct {
	Format int
	Root   string
	At     int64 // unix seconds of the full scan
	Tree   *Node
}

// cacheDir is a variable so tests can point it at a temporary folder.
var cacheDir = func() string {
	d, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(d, "mormidiskfree")
}

func cacheFile(root string) string {
	dir := cacheDir()
	if dir == "" {
		return ""
	}
	sum := sha1.Sum([]byte(root))
	return filepath.Join(dir, hex.EncodeToString(sum[:6])+".gob.gz")
}

// compact copies n keeping the biggest keepPerDir entries of each folder; the view only ever shows the top ones anyway.
func compact(n *Node) *Node {
	out := &Node{Name: n.Name, Path: n.Path, Size: n.Size, IsDir: n.IsDir, Items: n.Items}
	var rest *Node
	kept := 0
	for _, c := range n.Children {
		if c.Path != "" && kept < keepPerDir { // an earlier "smaller items" entry has no path and is folded again
			out.Children = append(out.Children, compact(c))
			kept++
			continue
		}
		if rest == nil {
			rest = &Node{Name: "smaller items"}
		}
		rest.Size += c.Size
		rest.Items += c.Items
	}
	if rest != nil && rest.Size > 0 {
		out.Children = append(out.Children, rest)
		sort.SliceStable(out.Children, func(i, j int) bool { return out.Children[i].Size > out.Children[j].Size })
	}
	return out
}

// writeSnapshot saves tree (already compacted) for root. It writes to a temporary file first, so a crash never leaves
// a half-written cache behind.
func writeSnapshot(root string, at int64, tree *Node) error {
	file := cacheFile(root)
	if file == "" {
		return errors.New("no cache directory")
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(file), "write-*")
	if err != nil {
		return err
	}
	zw := gzip.NewWriter(tmp)
	err = gob.NewEncoder(zw).Encode(snapshot{Format: cacheFormat, Root: root, At: at, Tree: tree})
	if err == nil {
		err = zw.Close()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), file)
}

// loadSnapshot returns the saved scan of root, or an error when there is none or it is unusable.
func loadSnapshot(root string) (*snapshot, error) {
	file := cacheFile(root)
	if file == "" {
		return nil, errors.New("no cache directory")
	}
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	var s snapshot
	if err := gob.NewDecoder(zr).Decode(&s); err != nil {
		return nil, err
	}
	if s.Format != cacheFormat || s.Root != root || s.Tree == nil {
		return nil, errors.New("cache is from another version")
	}
	return &s, nil
}

// cacheTime is when root was last scanned in full (unix seconds), or 0. It only looks at the file's date, so it is cheap.
func cacheTime(root string) int64 {
	file := cacheFile(root)
	if file == "" {
		return 0
	}
	info, err := os.Stat(file)
	if err != nil {
		return 0
	}
	return info.ModTime().Unix()
}
