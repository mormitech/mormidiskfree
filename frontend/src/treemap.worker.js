// Lays out the treemap off the main thread, so the window keeps answering (and the spinner keeps turning) while tens
// of thousands of blocks are placed. It keeps the last tree it was sent; later messages without one only resize it.
import {hierarchy, treemap, treemapSquarify} from 'd3-hierarchy';

let tree = null;

onmessage = (e) => {
    const {id, node, w, h} = e.data;
    if (node) tree = node;
    if (!tree) return;
    const root = hierarchy(tree, (d) => d.children).sum((d) => (d.children && d.children.length ? 0 : d.size));
    treemap().tile(treemapSquarify).size([w, h]).paddingOuter((d) => (d.depth > 0 && d.depth < 3 ? 1 : 0))(root);
    const items = [];
    root.each((d) => {
        if (d.x1 - d.x0 <= 0 || d.y1 - d.y0 <= 0) return;
        const n = d.data;
        items.push({
            x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, leaf: !d.children,
            parentPath: d.parent ? d.parent.data.path : '',
            data: {name: n.name, path: n.path, isDir: n.isDir, size: n.size, items: n.items},
        });
    });
    postMessage({id, w, h, items});
};
