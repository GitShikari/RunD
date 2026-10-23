# RUN D

A top-down pixel chase game built with vanilla JavaScript and HTML5 Canvas — no frameworks, no build step. Play **D**, a student with 3% attendance, and outrun **Fishy Raj** through the campus roads.

> Mechanics lecture. Attendance: 3%. Backlogs: yes.

## Play

Open `index.html` in a browser (serve it over a local HTTP server so the audio and question images load):

```bash
# from the project root
python3 -m http.server 8000
# then visit http://localhost:8000
```

## How it works

- D and Fishy Raj move along a **road graph** — a set of polylines (`PATHS` in `script.js`) whose shared coordinates form junctions.
- You can only turn at junctions. Raj leaves the lecture hall shortly after you and pathfinds toward where you *were* a fraction of a second ago (Floyd–Warshall all-pairs shortest paths).
- Periodically Raj enters **Mechanics Rage** — a huge speed burst announced by the "OIL UP D" warning.

## Controls

| Action | Keys |
|---|---|
| Move | `WASD` / Arrow keys (turn only at junctions) |
| Pause / resume | `Esc` or the ❚❚ button |
| Start / restart | `Enter` (on menu / game-over) |

## Respawn system

When Fishy Raj catches D, before the game-over screen you get a chance to respawn:

1. A **5-second offer** appears — "Answer these questions to respawn" — with RESPAWN / GIVE UP.
2. Click RESPAWN and a random **physics question** (image) from `assets/qns/` appears with a countdown.
3. Type the numerical answer. Correct → D respawns where he was caught, and Raj reappears 1.5s later (in normal mode). Wrong or time-out → game over.

The question images are named `<answer>.png` (e.g. `5.png` means the answer is 5). Add more by dropping files into `assets/qns/` and adding the number to the `QUESTIONS` array in `script.js`.

## Audio

| Sound | When |
|---|---|
| `homecoming.mpeg` | Background music, loops the whole game (auto-ducks when other sounds play) |
| `mistri.mpeg` | Once at the start of a run |
| `catch.mpeg` | On the "OIL UP D" rage warning |
| `rage.mpeg` | Looping during rage mode |
| `question.mpeg` | On the respawn / question screen |
| `respawn.mpeg` | When D respawns |
| `lost.mpeg` | On game over |

## Tuning

Key constants live at the top of `script.js`:

- `D_SPEED`, `RAJ_SPEED`, `RAGE_SPEED` — movement speeds
- `RAJ_DELAY`, `REACTION` — how Raj chases
- `OFFER_SECS`, `Q_SECS` — respawn offer and question timers
- `BG_FULL`, `BG_DUCK` — background music volume (normal vs. ducked)

## Map / path tools

The road network is painted on the map image and exported to the `PATHS` array:

- **`path_editor.py`** — a Tkinter GUI to paint paths directly on the map (click to add points, snap to junctions) and export to `paths.json` / `paths_export.js`.
- **`extract_paths.py`** — extracts a red-drawn path network from a map image via skeletonization and vectorization (requires `pillow`, `scikit-image`, `scipy`, `numpy`).
- `overlay_check.png` — a verification render of the extracted network over the map.

## Files

```
index.html        markup + audio elements
style.css         UI / screens styling
script.js         game logic, rendering, audio, respawn flow
assets/           map, sprites, audio, question images (qns/)
path_editor.py    GUI path painter
extract_paths.py  red-path extractor
paths.json        saved path data
```

## Credits

Made with vanilla JS + Canvas. Game assets under `assets/`.
