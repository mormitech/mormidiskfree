package main

import "testing"

func TestExtOf(t *testing.T) {
	for name, want := range map[string]string{"a.MOV": "mov", "x.tar.gz": "gz", ".bashrc": "", "Makefile": "", "dot.": ""} {
		if got := extOf(name); got != want {
			t.Errorf("extOf(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestFileTypesAndPruneMap(t *testing.T) {
	file := func(name string, size int64) *Node { return &Node{Name: name, Path: "/r/" + name, Size: size, Items: 1} }
	small := &Node{Name: "small", Path: "/r/small", IsDir: true, Size: 3, Items: 3,
		Children: []*Node{file("a.txt", 1), file("b.txt", 1), file("c.txt", 1)}}
	root := &Node{Name: "r", Path: "/r", IsDir: true, Size: 1003 + 3, Items: 5,
		Children: []*Node{file("big.MOV", 1000), small, file("tiny.log", 2), file("README", 1)}}

	types := fileTypes(root)
	if len(types) != 4 || types[0].Ext != "mov" || types[1].Ext != "txt" || types[1].Files != 3 {
		t.Fatalf("types = %+v", types)
	}

	p := pruneMap(root, 3)
	names := []string{}
	for _, c := range p.Children {
		names = append(names, c.Name)
	}
	// big.MOV and the folder are kept; tiny.log and README fold into one block of 3 bytes and 2 files.
	if len(p.Children) != 3 || names[0] != "big.MOV" || names[1] != "small" || names[2] != "smaller items" {
		t.Fatalf("children = %v", names)
	}
	if r := p.Children[2]; r.Size != 3 || r.Items != 2 || r.Path != "" {
		t.Fatalf("rest = %+v", r)
	}
	// every file of "small" is below the limit, so the folder stays one block
	if len(p.Children[1].Children) != 0 {
		t.Fatalf("small folder kept %d children", len(p.Children[1].Children))
	}
}
