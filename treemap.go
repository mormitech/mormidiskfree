package main

import (
	"errors"
	"path/filepath"
	"sort"
	"strings"
)

// The treemap view shows every file as a block, coloured by its type. A disk holds far more files than there are
// pixels, so the tree sent to the frontend keeps only what is big enough to see: about mapBlocks blocks, the rest of
// each folder folded into one "smaller items" block.
const mapBlocks = 20000

// FileType is how much space the files with one extension take ("" for files without one).
type FileType struct {
	Ext   string `json:"ext"`
	Size  int64  `json:"size"`
	Files int64  `json:"files"`
}

// MapResult is what the treemap view of a folder needs: the blocks and the file types of everything under it.
type MapResult struct {
	Node  *Node      `json:"node"`
	Types []FileType `json:"types"`
}

// MapView returns the treemap of the folder at path, from the scan already done.
func (a *App) MapView(path string) (*MapResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.root == nil {
		return nil, errors.New("nothing scanned yet")
	}
	n := a.lookupLocked(path)
	if n == nil {
		return nil, errors.New("not in the scanned tree: " + path)
	}
	return &MapResult{Node: pruneMap(n, max(n.Size/mapBlocks, 1)), Types: fileTypes(n)}, nil
}

// extOf is the lower-case extension of a file name without the dot; a name like ".bashrc" has none.
func extOf(name string) string {
	e := filepath.Ext(name)
	if len(e) <= 1 || e == name {
		return ""
	}
	return strings.ToLower(e[1:])
}

// fileTypes adds up the files under n by extension, biggest first.
func fileTypes(n *Node) []FileType {
	by := map[string]*FileType{}
	var walk func(*Node)
	walk = func(n *Node) {
		if n.IsDir {
			for _, c := range n.Children {
				walk(c)
			}
			return
		}
		e := extOf(n.Name)
		t := by[e]
		if t == nil {
			t = &FileType{Ext: e}
			by[e] = t
		}
		t.Size += n.Size
		t.Files += n.Items
	}
	walk(n)
	out := make([]FileType, 0, len(by))
	for _, t := range by {
		out = append(out, *t)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Size != out[j].Size {
			return out[i].Size > out[j].Size
		}
		return out[i].Ext < out[j].Ext
	})
	return out
}

// pruneMap copies n with every entry of at least min bytes; the smaller entries of each folder become one block.
func pruneMap(n *Node, min int64) *Node {
	out := &Node{Name: n.Name, Path: n.Path, Size: n.Size, IsDir: n.IsDir, Items: n.Items}
	var rest *Node
	for _, c := range n.Children {
		if c.Size >= min {
			out.Children = append(out.Children, pruneMap(c, min))
			continue
		}
		if rest == nil {
			rest = &Node{Name: "smaller items"}
		}
		rest.Size += c.Size
		rest.Items += c.Items
	}
	// A folder of only small things stays one block of its own.
	if rest != nil && rest.Size > 0 && len(out.Children) > 0 {
		out.Children = append(out.Children, rest)
	}
	return out
}
