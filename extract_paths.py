#!/usr/bin/env python3
"""
Extract the red-painted road network from assets/map2.png into a clean graph of
polylines (the PATHS format used by script.js).

Pipeline: red mask -> skeletonize -> build graph from chain components
          -> prune short spurs -> merge nearby nodes -> simplify (RDP)
          -> write paths.json + paths_export.js + overlay_check.png
"""
import json, os, math
import numpy as np
from PIL import Image
from skimage.morphology import skeletonize, remove_small_objects
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
MAP = os.path.join(HERE, "assets", "map2.png")

# ---- tunables ----
SPUR_LEN = 22      # dead-end branches shorter than this (px) are deleted
MERGE_D = 16       # nodes closer than this (px) are merged
RDP_EPS = 2.5      # polyline simplification tolerance (px)
BRIDGE = 70        # auto-connect disconnected pieces whose nearest nodes are this close
CLOSE = 9          # morphological closing size to bridge small gaps in the strokes

RGB = np.asarray(Image.open(MAP).convert("RGB")).astype(np.int16)
H, W = RGB.shape[:2]
R, G, B = RGB[..., 0], RGB[..., 1], RGB[..., 2]

red = (R > 110) & (R - G > 45) & (R - B > 45)
red = remove_small_objects(red, min_size=40)
red = ndimage.binary_closing(red, structure=np.ones((CLOSE, CLOSE)))
red = ndimage.binary_fill_holes(red)
skel = skeletonize(red)
print("red px:", int(red.sum()), " skeleton px:", int(skel.sum()))

S8 = np.ones((3, 3), int)
NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

def nbrs(p):
    y, x = p
    for dy, dx in NB:
        yy, xx = y + dy, x + dx
        if 0 <= yy < H and 0 <= xx < W and skel[yy, xx]:
            yield (yy, xx)

deg = ndimage.convolve(skel.astype(np.uint8), np.array(
    [[1, 1, 1], [1, 0, 1], [1, 1, 1]]), mode="constant") * skel
node_mask = skel & (deg != 2)

# cluster node pixels into graph nodes
nlbl, nN = ndimage.label(node_mask, structure=S8)
cent = ndimage.center_of_mass(node_mask, nlbl, range(1, nN + 1))
nodes = [[float(c), float(r)] for (r, c) in cent]          # [x,y]
node_id = {}
for (r, c) in zip(*np.where(node_mask)):
    node_id[(r, c)] = nlbl[r, c] - 1

def adj_node(pix):
    for q in nbrs(pix):
        if q in node_id:
            return node_id[q]
    return None

# ---- trace each chain component (deg==2 runs) into one edge ----
chain = skel & ~node_mask
clbl, cN = ndimage.label(chain, structure=S8)
edges = []     # (a, b, [ [x,y], ... ])

def order_chain(pix_set):
    cset = set(pix_set)
    def cn(p): return [q for q in nbrs(p) if q in cset]
    ends = [p for p in pix_set if len(cn(p)) == 1]
    if not ends:                         # loop
        start = pix_set[0]
    else:
        start = ends[0]
    order, prev, cur = [start], None, start
    while True:
        nxt = [q for q in cn(cur) if q != prev]
        if not nxt:
            break
        prev, cur = cur, nxt[0]
        order.append(cur)
        if cur == start:
            break
    return order

for c in range(1, cN + 1):
    pix = list(zip(*np.where(clbl == c)))
    order = order_chain(pix)
    a = adj_node(order[0])
    b = adj_node(order[-1])
    pts = [[x, y] for (y, x) in order]
    if a is None and b is None:
        # isolated loop with no junction: synthesize a node at its start
        nodes.append([float(order[0][1]), float(order[0][0])])
        a = b = len(nodes) - 1
    if a is None:
        nodes.append([float(order[0][1]), float(order[0][0])]); a = len(nodes) - 1
    if b is None:
        nodes.append([float(order[-1][1]), float(order[-1][0])]); b = len(nodes) - 1
    poly = [nodes[a]] + pts + [nodes[b]]
    edges.append([a, b, poly])

# direct node-node adjacencies (junctions touching with no chain between)
seen_pair = set()
for (r, c), nid in node_id.items():
    for q in nbrs((r, c)):
        if q in node_id and node_id[q] != nid:
            a, b = sorted((nid, node_id[q]))
            if (a, b) not in seen_pair:
                seen_pair.add((a, b))
                edges.append([a, b, [nodes[a], nodes[b]]])

print("raw nodes:", len(nodes), " raw edges:", len(edges))

def plen(poly):
    return sum(math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1])
               for i in range(len(poly) - 1))

# ---- prune short dead-end spurs iteratively ----
def degree_map(edges, ncount):
    d = [0] * ncount
    for a, b, _ in edges:
        d[a] += 1; d[b] += 1
    return d

changed = True
while changed:
    changed = False
    d = degree_map(edges, len(nodes))
    keep = []
    for e in edges:
        a, b, poly = e
        if a != b and (d[a] == 1 or d[b] == 1) and plen(poly) < SPUR_LEN:
            changed = True       # drop this spur
            continue
        keep.append(e)
    edges = keep

# ---- merge nearby nodes (union-find) ----
parent = list(range(len(nodes)))
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]; i = parent[i]
    return i
def union(i, j):
    ri, rj = find(i), find(j)
    if ri != rj:
        parent[max(ri, rj)] = min(ri, rj)

# only merge nodes actually used by edges
used = set()
for a, b, _ in edges:
    used.update((a, b))
used = sorted(used)
for i in range(len(used)):
    for j in range(i + 1, len(used)):
        pi, pj = nodes[used[i]], nodes[used[j]]
        if (pi[0] - pj[0]) ** 2 + (pi[1] - pj[1]) ** 2 < MERGE_D ** 2:
            union(used[i], used[j])

# new node coords = centroid of merged group
groups = {}
for i in used:
    groups.setdefault(find(i), []).append(i)
newid, new_nodes = {}, []
for root, members in groups.items():
    xs = np.mean([nodes[m][0] for m in members])
    ys = np.mean([nodes[m][1] for m in members])
    newid[root] = len(new_nodes)
    new_nodes.append([int(round(xs)), int(round(ys))])

def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a = np.array(pts, float)
    s, e = a[0], a[-1]
    d = e - s
    L = math.hypot(*d) or 1.0
    dist = np.abs(d[0] * (s[1] - a[:, 1]) - (s[0] - a[:, 0]) * d[1]) / L
    i = int(np.argmax(dist))
    if dist[i] > eps:
        return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]

# rebuild edges with merged endpoints, dedup
paths, pair_seen = [], set()
for a, b, poly in edges:
    na, nb = newid[find(a)], newid[find(b)]
    if na == nb and plen(poly) < SPUR_LEN:
        continue
    # snap endpoints to merged node coords
    poly = [new_nodes[na]] + poly[1:-1] + [new_nodes[nb]]
    simp = [[int(x), int(y)] for x, y in rdp(poly, RDP_EPS)]
    # dedup consecutive duplicates
    clean = [simp[0]]
    for p in simp[1:]:
        if p != clean[-1]:
            clean.append(p)
    if len(clean) < 2:
        continue
    midx = (clean[0][0] + clean[-1][0]) // 2
    midy = (clean[0][1] + clean[-1][1]) // 2
    key = (min(na, nb), max(na, nb), midx // 25, midy // 25)
    if key in pair_seen:
        continue
    pair_seen.add(key)
    paths.append(clean)

# ---- stitch disconnected pieces, then keep the connected network ----
def build_graph(paths):
    idx, verts, adj = {}, [], []
    def nid(p):
        k = (p[0], p[1])
        if k not in idx:
            idx[k] = len(verts); verts.append(list(k)); adj.append(set())
        return idx[k]
    for path in paths:
        for i in range(len(path) - 1):
            a, b = nid(path[i]), nid(path[i + 1])
            if a != b:
                adj[a].add(b); adj[b].add(a)
    return verts, adj

def components(verts, adj):
    seen, comps = [False] * len(verts), []
    for i in range(len(verts)):
        if seen[i]:
            continue
        st, grp = [i], []
        seen[i] = True
        while st:
            n = st.pop(); grp.append(n)
            for m in adj[n]:
                if not seen[m]:
                    seen[m] = True; st.append(m)
        comps.append(grp)
    return comps

# iteratively bridge the closest cross-component node pair
while True:
    verts, adj = build_graph(paths)
    comps = components(verts, adj)
    if len(comps) <= 1:
        break
    comps.sort(key=len, reverse=True)
    main = set(comps[0])
    # nearest node in `main` to any node outside it
    best = None
    others = [i for i in range(len(verts)) if i not in main]
    marr = np.array([verts[i] for i in sorted(main)])
    msort = sorted(main)
    for o in others:
        p = verts[o]
        dd = (marr[:, 0] - p[0]) ** 2 + (marr[:, 1] - p[1]) ** 2
        j = int(np.argmin(dd))
        if best is None or dd[j] < best[0]:
            best = (dd[j], msort[j], o)
    if best is None or best[0] > BRIDGE ** 2:
        break                         # remaining pieces too far -> drop them
    paths.append([verts[best[1]], verts[best[2]]])   # straight bridge

# drop anything still not attached to the main component
verts, adj = build_graph(paths)
comps = components(verts, adj)
comps.sort(key=len, reverse=True)
main = set(comps[0])
dropped = sum(1 for c in comps[1:] for _ in c)
kept = []
for path in paths:
    vids = [(p[0], p[1]) for p in path]
    # a path is in main if all its vertices are main nodes
    ok = all(((v in dict(((tuple(verts[i]), i) for i in main)))) for v in vids) \
        if False else True
    kept.append(path)
# simpler: keep path only if its first vertex is in the main component
mainset = {tuple(verts[i]) for i in main}
paths = [p for p in paths if tuple(p[0]) in mainset and tuple(p[-1]) in mainset]
print("after stitching: kept", len(paths), "paths, dropped", dropped, "stray nodes")

# ---- HALL: node nearest the circular lecture hall (upper-right) ----
qr = red[: H // 2, W // 2:]
ry, rx = np.where(qr)
hall_guess = (int(rx.mean()) + W // 2, int(ry.mean()))
all_nodes = {tuple(p[0]) for p in paths} | {tuple(p[-1]) for p in paths}
hall = min(all_nodes, key=lambda p: (p[0] - hall_guess[0]) ** 2 + (p[1] - hall_guess[1]) ** 2)
print("hall guess:", hall_guess, "-> node:", hall)

# ---- outputs ----
data = {"map": "assets/map2.png", "w": W, "h": H,
        "hall": [int(hall[0]), int(hall[1])], "paths": paths}
json.dump(data, open(os.path.join(HERE, "paths.json"), "w"), indent=1)
lines = ["const PATHS = ["]
for p in paths:
    lines.append(" [" + ",".join("[%d,%d]" % (x, y) for x, y in p) + "],")
lines += ["];", "const HALL = [%d, %d];" % (hall[0], hall[1])]
open(os.path.join(HERE, "paths_export.js"), "w").write("\n".join(lines) + "\n")

# ---- overlay ----
ov = np.asarray(Image.open(MAP).convert("RGB")).copy()
def dot(x, y, c, s=1):
    ov[max(0, y - s):y + s + 1, max(0, x - s):x + s + 1] = c
for p in paths:
    for i in range(len(p) - 1):
        x0, y0 = p[i]; x1, y1 = p[i + 1]
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for t in np.linspace(0, 1, n):
            dot(int(x0 + (x1 - x0) * t), int(y0 + (y1 - y0) * t), (0, 255, 255))
    for x, y in p:
        dot(x, y, (255, 255, 0), 2)
dot(hall[0], hall[1], (255, 0, 255), 7)
Image.fromarray(ov).save(os.path.join(HERE, "overlay_check.png"))
print("FINAL paths:", len(paths), " nodes:", len(all_nodes))
