#!/usr/bin/env python3
"""
RUN D - Path Painter
====================
Paint the road network that D and Fishy Raj are allowed to run on, directly on
top of the game map, then export it in the exact PATHS format used by script.js.

Requirements:
    pip install pillow            # (Tkinter ships with standard CPython)

Run:
    python3 path_editor.py

Coordinates are stored/exported in MAP PIXEL space (same as the game world),
so what you paint maps 1:1 onto the JS `PATHS` array.

------------------------------------------------------------------- CONTROLS
  Left click            Add a point to the current path.
                        Snaps to a nearby existing point so paths share
                        junctions (shared coordinates = a junction in game).
  Right click / Enter   Finish the current path, start a new one.
  Backspace / Ctrl+Z    Undo last point (or remove last finished path if the
                        current path is empty).
  h                     Toggle: mark the NEXT click as the HALL (start) point.
  Mouse wheel           Zoom in / out (towards cursor).
  Middle drag           Pan.
  g                     Toggle snap-to-grid.
  [ / ]                 Decrease / increase snap radius.
  s  or  Ctrl+S         Save  -> paths.json  +  paths_export.js
  o                     Open / reload paths.json
  c                     Clear everything.
  q / Esc               Quit.
---------------------------------------------------------------------------
"""

import json
import os
import sys
import tkinter as tk
from tkinter import messagebox

try:
    from PIL import Image, ImageTk
except ImportError:
    print("This tool needs Pillow:  pip install pillow")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(HERE, "paths.json")
JS_PATH = os.path.join(HERE, "paths_export.js")
DEFAULT_MAP = os.path.join(HERE, "assets", "map.png")

SNAP_DEFAULT = 14          # map-pixels; snap to an existing point within this
GRID = 5                   # grid step (map px) when snap-to-grid is on


class PathEditor:
    def __init__(self, root):
        self.root = root
        root.title("RUN D - Path Painter")
        # Open filling the screen (not limited to the image's native size)
        try:
            root.state("zoomed")          # Windows / some Linux WMs
        except tk.TclError:
            pass
        try:
            root.attributes("-zoomed", True)  # most Linux WMs
        except tk.TclError:
            pass
        root.geometry("%dx%d+0+0" % (root.winfo_screenwidth(),
                                     root.winfo_screenheight()))

        # ---- load map image -------------------------------------------------
        map_rel = "assets/map.png"
        hall = [1478, 497]
        paths = []
        if os.path.exists(JSON_PATH):
            try:
                data = json.load(open(JSON_PATH))
                map_rel = data.get("map", map_rel)
                hall = data.get("hall", hall)
                paths = [[list(p) for p in path] for path in data.get("paths", [])]
            except Exception as e:
                print("Could not read paths.json:", e)

        map_path = os.path.join(HERE, map_rel)
        if not os.path.exists(map_path):
            map_path = DEFAULT_MAP
        self.src = Image.open(map_path).convert("RGB")
        self.MAP_W, self.MAP_H = self.src.size

        # ---- state ----------------------------------------------------------
        self.paths = paths            # list[list[[x,y]]]  finished + current
        self.current = []             # points of path being drawn (map coords)
        self.hall = hall
        self.scale = self._fit_scale()
        self.snap = SNAP_DEFAULT
        self.snap_grid = False
        self.set_hall_next = False
        self._tkimg = None
        self._img_cache = (None, None)   # (scale, PhotoImage) - avoid re-resizing
        self._pan_start = None

        # ---- UI -------------------------------------------------------------
        self.canvas = tk.Canvas(root, bg="#101010", highlightthickness=0,
                                cursor="crosshair")
        self.canvas.pack(fill="both", expand=True)
        self.status = tk.Label(root, anchor="w", font=("Courier", 11),
                               bg="#1b1b2f", fg="#ffd23f")
        self.status.pack(fill="x", side="bottom")

        # mouse
        self.canvas.bind("<Button-1>", self.on_left)
        self.canvas.bind("<Button-3>", lambda e: self.finish_path())
        self.canvas.bind("<Motion>", self.on_motion)
        self.canvas.bind("<Button-2>", self.on_pan_start)
        self.canvas.bind("<B2-Motion>", self.on_pan_move)
        # wheel (Linux uses Button-4/5)
        self.canvas.bind("<MouseWheel>", self.on_wheel)
        self.canvas.bind("<Button-4>", lambda e: self.on_wheel(e, 1))
        self.canvas.bind("<Button-5>", lambda e: self.on_wheel(e, -1))
        # keys
        root.bind("<Return>", lambda e: self.finish_path())
        root.bind("<BackSpace>", lambda e: self.undo())
        root.bind("<Control-z>", lambda e: self.undo())
        root.bind("<Control-s>", lambda e: self.save())
        root.bind("s", lambda e: self.save())
        root.bind("o", lambda e: self.reload())
        root.bind("c", lambda e: self.clear())
        root.bind("h", lambda e: self.toggle_hall())
        root.bind("g", lambda e: self.toggle_grid())
        root.bind("[", lambda e: self.change_snap(-2))
        root.bind("]", lambda e: self.change_snap(+2))
        root.bind("q", lambda e: root.destroy())
        root.bind("<Escape>", lambda e: root.destroy())

        self._offset = [0, 0]   # pan offset in canvas pixels
        self.redraw()

    # ------------------------------------------------------------------ helpers
    def _fit_scale(self):
        # Fit the map to the screen (fill as much as possible, up or down).
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight() - 40   # leave room for status bar
        return min(sw / self.MAP_W, sh / self.MAP_H)

    def to_canvas(self, x, y):
        return x * self.scale + self._offset[0], y * self.scale + self._offset[1]

    def to_map(self, cx, cy):
        return ((cx - self._offset[0]) / self.scale,
                (cy - self._offset[1]) / self.scale)

    def all_points(self):
        for path in self.paths:
            for p in path:
                yield p
        for p in self.current:
            yield p

    def snap_point(self, mx, my):
        """Snap to nearest existing node within radius, else optional grid."""
        best, bd = None, self.snap ** 2
        for p in self.all_points():
            d = (p[0] - mx) ** 2 + (p[1] - my) ** 2
            if d < bd:
                bd, best = d, p
        if best is not None:
            return [best[0], best[1]], True
        if self.snap_grid:
            return [round(mx / GRID) * GRID, round(my / GRID) * GRID], False
        return [round(mx), round(my)], False

    # ------------------------------------------------------------------ events
    def on_left(self, e):
        mx, my = self.to_map(self.canvas.canvasx(e.x), self.canvas.canvasy(e.y))
        mx = max(0, min(self.MAP_W, mx))
        my = max(0, min(self.MAP_H, my))
        pt, snapped = self.snap_point(mx, my)
        if self.set_hall_next:
            self.hall = pt
            self.set_hall_next = False
        else:
            self.current.append(pt)
        self.redraw()

    def on_motion(self, e):
        mx, my = self.to_map(self.canvas.canvasx(e.x), self.canvas.canvasy(e.y))
        self._cursor = (mx, my)
        self.update_cursor()   # lightweight: only moves the preview line

    def on_pan_start(self, e):
        self._pan_start = (e.x, e.y, self._offset[0], self._offset[1])

    def on_pan_move(self, e):
        if not self._pan_start:
            return
        x0, y0, ox, oy = self._pan_start
        self._offset[0] = ox + (e.x - x0)
        self._offset[1] = oy + (e.y - y0)
        self.redraw()

    def on_wheel(self, e, direction=None):
        if direction is None:
            direction = 1 if e.delta > 0 else -1
        factor = 1.1 if direction > 0 else 1 / 1.1
        # zoom toward cursor
        cx, cy = e.x, e.y
        mx, my = self.to_map(cx, cy)
        self.scale = max(0.1, min(6.0, self.scale * factor))
        self._offset[0] = cx - mx * self.scale
        self._offset[1] = cy - my * self.scale
        self.redraw()

    # ------------------------------------------------------------------ actions
    def finish_path(self):
        if len(self.current) >= 2:
            self.paths.append(self.current)
        elif len(self.current) == 1:
            self.status.config(text="A path needs at least 2 points - discarded.")
        self.current = []
        self.redraw()

    def undo(self):
        if self.current:
            self.current.pop()
        elif self.paths:
            self.current = self.paths.pop()  # reopen last path for editing
        self.redraw()

    def clear(self):
        if messagebox.askyesno("Clear", "Delete ALL paths?"):
            self.paths, self.current = [], []
            self.redraw()

    def toggle_hall(self):
        self.set_hall_next = not self.set_hall_next
        self.redraw()

    def toggle_grid(self):
        self.snap_grid = not self.snap_grid
        self.redraw()

    def change_snap(self, d):
        self.snap = max(2, self.snap + d)
        self.redraw()

    def reload(self):
        if not os.path.exists(JSON_PATH):
            return
        data = json.load(open(JSON_PATH))
        self.paths = [[list(p) for p in path] for path in data.get("paths", [])]
        self.hall = data.get("hall", self.hall)
        self.current = []
        self.redraw()
        self.status.config(text="Reloaded paths.json")

    def save(self):
        # flush any in-progress path first
        if len(self.current) >= 2:
            self.paths.append(self.current)
            self.current = []
        data = {
            "map": "assets/map.png",
            "hall": [int(self.hall[0]), int(self.hall[1])],
            "paths": [[[int(p[0]), int(p[1])] for p in path] for path in self.paths],
        }
        json.dump(data, open(JSON_PATH, "w"), indent=2)

        # JS-ready snippet
        lines = ["const PATHS = ["]
        for path in data["paths"]:
            pts = ",".join("[%d,%d]" % (p[0], p[1]) for p in path)
            lines.append(" [%s]," % pts)
        lines.append("];")
        lines.append("const HALL = [%d, %d];" % (data["hall"][0], data["hall"][1]))
        open(JS_PATH, "w").write("\n".join(lines) + "\n")

        self.redraw()
        self.status.config(
            text="Saved %d paths -> paths.json  +  paths_export.js" % len(self.paths))

    # ------------------------------------------------------------------ drawing
    def _get_tkimg(self):
        """Resize the map only when the zoom level changes (expensive op)."""
        if self._img_cache[0] != self.scale:
            dw, dh = int(self.MAP_W * self.scale), int(self.MAP_H * self.scale)
            resized = self.src.resize((max(1, dw), max(1, dh)), Image.NEAREST)
            self._img_cache = (self.scale, ImageTk.PhotoImage(resized))
        return self._img_cache[1]

    def update_cursor(self):
        """Only redraw the dashed preview line - cheap, safe on every mousemove."""
        c = self.canvas
        c.delete("preview")
        if self.current and hasattr(self, "_cursor"):
            lx, ly = self.to_canvas(*self.current[-1])
            cx, cy = self.to_canvas(*self._cursor)
            c.create_line(lx, ly, cx, cy, fill="#ffd23f", dash=(4, 3),
                          tags="preview")

    def redraw(self, cursor=False):
        c = self.canvas
        c.delete("all")

        self._tkimg = self._get_tkimg()
        c.create_image(self._offset[0], self._offset[1], anchor="nw",
                       image=self._tkimg)

        # finished paths
        for path in self.paths:
            self._draw_poly(path, "#36d1ff", "#0a84a8")
        # current path (highlighted)
        if self.current:
            self._draw_poly(self.current, "#ffd23f", "#b8860b", current=True)

        # hall marker
        hx, hy = self.to_canvas(*self.hall)
        c.create_rectangle(hx - 7, hy - 7, hx + 7, hy + 7,
                           outline="#ff4d3d", width=3)
        c.create_text(hx, hy - 14, text="HALL", fill="#ff4d3d",
                      font=("Courier", 9, "bold"))

        self.update_cursor()

        mode = "  [CLICK = set HALL]" if self.set_hall_next else ""
        grid = "on" if self.snap_grid else "off"
        self.status.config(
            text="paths:%d  current pts:%d  zoom:%.2fx  snap:%dpx  grid:%s%s   "
                 "(L-click add | R-click/Enter finish | Backspace undo | s save | h hall | wheel zoom)"
                 % (len(self.paths), len(self.current), self.scale, self.snap, grid, mode))

    def _draw_poly(self, path, color, node_fill, current=False):
        c = self.canvas
        pts = [self.to_canvas(*p) for p in path]
        for i in range(len(pts) - 1):
            c.create_line(*pts[i], *pts[i + 1], fill=color, width=3)
        r = 4 if not current else 5
        for (x, y) in pts:
            c.create_oval(x - r, y - r, x + r, y + r, fill=node_fill,
                          outline=color, width=2)


def main():
    root = tk.Tk()
    PathEditor(root)
    root.mainloop()


if __name__ == "__main__":
    main()
