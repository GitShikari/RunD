'use strict';
/* ============ RUN D — top-down pixel chase. Vanilla JS + Canvas ============ */

/* ---- Tunables ---- */
const MAP_W = 1536, MAP_H = 1023;     // map image size = world size (px)
const D_SPEED = 40;                    // D's normal speed (world px/s)
const RAJ_SPEED = D_SPEED * 0.8 ;         // Raj's normal speed: EXACTLY 1x D
const RAGE_SPEED = 180;               // "Mechanics Rage" speed
const RAJ_DELAY = 2.0;                 // Raj leaves the hall 2.0 s after D
const REACTION = 0.45;                 // Raj tracks where D was this many seconds ago
const CATCH_R = 9, VIS_H = 200;        // catch radius; visible world height (zoom)
const CHAR_SCALE = 0.37;               // atlas cell (64x80) -> world px

/* ---- Road graph: polylines in map pixels. Shared coordinates = junctions ---- */
const PATHS = [
 [[1338,237],[1292,263],[1243,285],[1223,293],[1197,319],[1232,340],[1256,370],[1274,408],[1274,408],[1274,408]],
 [[1274,408],[1268,485],[1231,543],[1166,576],[1106,587],[1071,579],[1042,557],[1028,539],[1029,521],[1007,506],[986,452],[975,417],[964,374],[962,318],[963,267],[987,185],[1029,134],[1076,95],[1098,89],[1113,93],[1128,82],[1128,82],[1128,82],[1140,71],[1192,67],[1244,75],[1292,84],[1332,101],[1368,123],[1412,157],[1439,194],[1465,241],[1488,302],[1503,366]],
 [[1503,366],[1508,483],[1490,567],[1475,597]],
 [[1475,597],[1422,700],[1352,771],[1258,828],[1148,855],[968,861],[887,853],[804,840],[727,824],[618,803],[525,782]],
 [[525,782],[46,662],[86,359],[114,246],[964,374]],
 [[667,814],[230,264]],
 [[86,359],[262,305],[380,287]],
 [[494,310],[489,374],[562,504],[663,447],[642,392],[648,327]],
 [[562,504],[587,521],[654,647],[750,596],[782,678],[827,701],[804,840]],
 [[663,447],[750,596]],
 [[750,596],[896,524],[842,356]],
 [[896,524],[936,554],[973,544],[1007,506]],
 [[1106,587],[1070,864]],
 [[964,374],[988,350],[1074,303],[1105,281],[1113,93]],
 [[1105,281],[1133,295],[1184,299],[1197,319]],
 [[1184,299],[1197,227],[1284,173],[1318,96]],
 [[1274,408],[1305,390],[1405,375],[1503,366]],
 [[1405,375],[1424,436],[1508,451]],
 [[1268,485],[1300,492],[1278,544],[1248,523],[1248,523]],
 [[1278,544],[1252,583],[1292,611]],
 [[1292,611],[1292,611],[1306,624],[1346,574],[1371,509],[1381,442],[1424,436],[1316,437],[1300,492]],
 [[1338,237],[1439,194]],
 [[1338,237],[1405,375]],
 [[114,246],[1,225]],
 [[1070,864],[1070,864],[1085,857]],
 [[1070,864],[1033,859]],
 [[494,310],[494,310],[513,307],[532,309]],
 [[842,356],[975,417]],
 [[1508,451],[1508,483],[1508,451],[1505,410]],
 [[1033,859],[968,861]],
 [[1085,857],[1148,855]],
 [[1508,451],[1503,366]],
 [[1505,410],[1503,366]],
];
const HALL = [1338, 237];              // snapped to nearest graph node

const N = [], adj = [], idx = new Map();
function node(p) {
  const k = p[0] + ',' + p[1];
  if (!idx.has(k)) { idx.set(k, N.length); N.push({ x: p[0], y: p[1] }); adj.push([]); }
  return idx.get(k);
}
for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) {
  const a = node(path[i]), b = node(path[i + 1]);
  if (a === b) continue;                                   // skip zero-length / duplicate points
  if (!adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); }
}
const elen = (a, b) => Math.hypot(N[a].x - N[b].x, N[a].y - N[b].y);
// All-pairs shortest path distances (Floyd–Warshall) for Raj's pathfinding
const dist = N.map((_, i) => N.map((_, j) => (i === j ? 0 : Infinity)));
adj.forEach((l, a) => l.forEach(b => { dist[a][b] = elen(a, b); }));
for (let k = 0; k < N.length; k++) for (let i = 0; i < N.length; i++) for (let j = 0; j < N.length; j++)
  if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];

/* ---- Entity on the graph: on edge a->b at distance s from a; dir=+1 toward b, -1 toward a ---- */
const pos = e => { const L = elen(e.a, e.b) || 1, t = e.s / L; return { x: N[e.a].x + (N[e.b].x - N[e.a].x) * t, y: N[e.a].y + (N[e.b].y - N[e.a].y) * t }; };
const unit = (a, b) => { const L = elen(a, b) || 1; return { x: (N[b].x - N[a].x) / L, y: (N[b].y - N[a].y) / L }; };
const heading = e => { const u = unit(e.a, e.b); return { x: u.x * e.dir, y: u.y * e.dir }; };

// Move an entity `d` px along roads; `choose(node, from)` picks the next node (or -1 to stop)
function advance(e, d, choose) {
  let moved = 0, guard = 0;
  while (d > 1e-9) {
    if (++guard > 10000) return moved;                     // safety: never spin forever
    const L = elen(e.a, e.b), toEnd = e.dir > 0 ? L - e.s : e.s;
    if (L > 1e-9 && d < toEnd) { e.s += e.dir * d; moved += d; return moved; }
    d -= Math.max(0, toEnd); moved += Math.max(0, toEnd);
    const nd = e.dir > 0 ? e.b : e.a, from = e.dir > 0 ? e.a : e.b;
    const nx = choose(nd, from);
    if (nx < 0) { e.a = from; e.b = nd; e.dir = 1; e.s = L; return moved; }  // wait at junction
    e.a = nd; e.b = nx; e.s = 0; e.dir = 1;
  }
  return moved;
}

/* ---- Input ---- */
const KEYMAP = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
let held = [], lastDir = null, lastDirT = -9;
addEventListener('keydown', ev => {
  const k = KEYMAP[ev.key] ? ev.key : ev.key.toLowerCase(), v = KEYMAP[k];
  if (!v) return; ev.preventDefault();
  held = held.filter(h => h !== k); held.push(k);
  lastDir = { x: v[0], y: v[1] }; lastDirT = G.t;
});
addEventListener('keyup', ev => { const k = KEYMAP[ev.key] ? ev.key : ev.key.toLowerCase(); held = held.filter(h => h !== k); });
addEventListener('blur', () => { held = []; });
function wantDir() {                                    // held key, or a tap buffered for 0.3s
  if (held.length) { const v = KEYMAP[held[held.length - 1]]; return { x: v[0], y: v[1] }; }
  return lastDir && G.t - lastDirT < 0.3 ? lastDir : null;
}

/* ---- Game state ---- */
const cv = document.getElementById('game'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
const img = n => { const i = new Image(); i.src = 'assets/' + n; return i; };
const MAP = img('map.png'), ATL = { d: img('d.png'), raj: img('raj.png') };
// Respawn questions: image files in assets/qns/ named <answer>.png
const QUESTIONS = [5, 33, 75, 170];
const WARNINGS = ["OIL UP D"];
const OVER_MSGS = ["BETTER LUCK NEXT LECTURE", "SEMESTER BACK!!", "CAUGHT IN 4K BY FISHY RAJ", "-5 ATTENDENCE"];
let G = { state: 'menu', t: 0 }, cam = { x: HALL[0], y: HALL[1] }, last = 0, zoom = 3, audio = null;

function startGame() {                  // resets EVERYTHING; the single rAF loop is never duplicated
  const h = idx.get(HALL.join(',')), west = adj[h][0], east = adj[h][1] != null ? adj[h][1] : adj[h][0];
  G = { state: 'play', t: 0, rajOut: false, rage: null, nextRage: 10 + Math.random() * 12, shake: 0,
        d: { a: h, b: west, s: 0, dir: 1, moving: true, face: { x: -1, y: 0 } },
        raj: { a: h, b: east, s: 0, dir: 1, moving: false, face: { x: 1, y: 0 }, speed: RAJ_SPEED },
        hist: [] };
  held = []; lastDir = null; lastDirT = -9;
  const p = pos(G.d); cam.x = p.x; cam.y = p.y;
  ['menu', 'over', 'banner', 'paused', 'offer', 'question'].forEach(i => $(i).classList.add('hidden'));
  $('hud').classList.remove('hidden'); $('flash').classList.remove('on');
  beep(520, .1, 'square'); beep(780, .12, 'square', .05, .1);
  stopAllSnd(); startBG(); playSnd('mistri');   // bg music loops; intro jingle once
}

/* ---- Audio (WebAudio, no files) ---- */
function beep(f, d, type = 'square', vol = .06, delay = 0, f2 = f) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
    o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + d);
  } catch (e) { /* audio is optional */ }
}

/* ---- File-based sound effects / music ---- */
const SND = {
  mistri:   $('aud-mistri'),
  rage:     $('aud-rage'),
  catch:    $('aud-catch'),
  question: $('aud-question'),
  respawn:  $('aud-respawn'),
  lost:     $('aud-lost'),
};
// Background music (homecoming): loops the whole game, ducks when other SFX play
const BG = $('aud-home');
const BG_FULL = 0.55, BG_DUCK = 0.12;       // normal vs. ducked volume
const playingFx = new Set();                 // currently-playing foreground sounds
function updateDuck() { BG.volume = playingFx.size ? BG_DUCK : BG_FULL; }
function startBG() { if (BG) { BG.loop = true; BG.volume = BG_FULL; BG.play().catch(() => {}); } }
function playSnd(key, loop = false) {
  const a = SND[key]; if (!a) return;
  a.loop = loop; try { a.currentTime = 0; } catch (e) {}
  a.onended = () => { playingFx.delete(a); updateDuck(); };
  playingFx.add(a); updateDuck();            // duck the background music
  a.play().catch(() => {});
}
function stopSnd(key) {
  const a = SND[key]; if (!a) return;
  a.pause(); try { a.currentTime = 0; } catch (e) {}
  playingFx.delete(a); updateDuck();         // un-duck once it stops
}
function stopAllSnd() { Object.keys(SND).forEach(stopSnd); }

/* ---- Raj's pathfinding: distance from a node to the (delayed) target point on its edge ---- */
const distTo = (n, T) => Math.min(dist[n][T.a] + T.s, dist[n][T.b] + (elen(T.a, T.b) - T.s));
function rajChoose(node, from) {
  const T = G.target; let best = -1, bc = Infinity;
  for (const m of adj[node]) { const c = elen(node, m) + distTo(m, T); if (c < bc - 1e-6) { bc = c; best = m; } }
  return best;
}
function rajPickDir(r, T) {              // mid-edge: head toward whichever end is closer to the target
  const L = elen(r.a, r.b);
  let sT = null;
  if (T.a === r.a && T.b === r.b) sT = T.s; else if (T.a === r.b && T.b === r.a) sT = L - T.s;
  if (sT !== null) { if (Math.abs(sT - r.s) > 0.5) r.dir = sT > r.s ? 1 : -1; return; }
  const cb = (L - r.s) + distTo(r.b, T), ca = r.s + distTo(r.a, T);
  if (r.dir > 0 && ca + 6 < cb) r.dir = -1; else if (r.dir < 0 && cb + 6 < ca) r.dir = 1;
}

/* ---- D's junction rules: turn only where roads really branch ---- */
function dChoose(node, from) {
  const want = wantDir(), hv = unit(from, node), best = (list, v) => {
    let b = -1, bd = -2; for (const m of list) { const u = unit(node, m), dd = u.x * v.x + u.y * v.y; if (dd > bd) { bd = dd; b = m; } } return [b, bd]; };
  if (want) { const [b, dd] = best(adj[node], want); if (dd > 0.5) return b; }   // valid chosen direction
  const others = adj[node].filter(m => m !== from);
  if (others.length === 1) return others[0];                                  // road bend: follow it
  if (others.length > 1) { const [b, dd] = best(others, hv); if (dd > 0.8) return b; }  // go straight
  return -1;                                                                  // no road: wait
}

/* ---- Update ---- */
function update(dt) {
  G.t += dt;
  const D = G.d, R = G.raj;
  // D: instant reversal mid-road if opposite key pressed; otherwise only junction turns
  const want = wantDir();
  if (want) { const h = heading(D); if (h.x * want.x + h.y * want.y < -0.6) D.dir *= -1; }
  const dp0 = pos(D);
  advance(D, D_SPEED * dt, dChoose);
  const dp = pos(D); D.moving = Math.hypot(dp.x - dp0.x, dp.y - dp0.y) > 1e-4;
  if (D.moving) D.face = heading(D);
  G.hist.push({ t: G.t, a: D.a, b: D.b, s: D.s });
  while (G.hist.length > 1 && G.hist[1].t <= G.t - REACTION) G.hist.shift();

  // Raj exits exactly 2 s after D started
  if (!G.rajOut && G.t >= RAJ_DELAY) { G.rajOut = true; beep(220, .25, 'sawtooth', .07, 0, 110); }
  // Mechanics rage scheduling
  if (G.rajOut && !G.rage && G.t >= G.nextRage) {
    G.rage = { phase: 'warn', end: G.t + 2.5 };
    $('banner').textContent = WARNINGS[Math.floor(Math.random() * WARNINGS.length)];
    $('banner').classList.remove('hidden'); $('flash').classList.add('on');
    playSnd('catch');                        // "OIL UP D" warning sting
  } else if (G.rage && G.rage.phase === 'warn' && G.t >= G.rage.end) {
    G.rage.phase = 'go'; $('banner').textContent = "FISHY RAJ'S MECHANICS RAGE!";
    G.raj.speed = RAGE_SPEED;
    playSnd('rage', true);                   // rage music on repeat
  }
  G.shake = G.rage ? (G.rage.phase === 'go' ? 6 : 2) : 0;

  // Fishy Raj is briefly off the map after a respawn, then reappears at D's respawn spot
  if (R.hidden && G.t >= G.rajRespawnAt) {
    R.a = G.caughtAt.a; R.b = G.caughtAt.b; R.s = G.caughtAt.s; R.dir = G.caughtAt.dir;
    R.hidden = false; R.moving = false;
  }

  if (G.rajOut && !R.hidden) {
    const rage = G.rage && G.rage.phase === 'go';
    R.speed = rage ? RAGE_SPEED : RAJ_SPEED;
    const steps = Math.max(1, Math.ceil(R.speed * dt / 5)), sd = dt / steps;   // sub-steps: no tunnelling
    for (let i = 0; i < steps; i++) {
      G.target = rage ? { a: D.a, b: D.b, s: D.s } : G.hist[0];
      rajPickDir(R, G.target);
      const before = pos(R);
      advance(R, R.speed * sd, rajChoose);
      const rp = pos(R), dd = Math.hypot(rp.x - before.x, rp.y - before.y);
      if (dd > 1e-4) { R.face = { x: (rp.x - before.x) / dd, y: (rp.y - before.y) / dd }; }
      R.moving = dd > 1e-4;
      const q = pos(D); if (Math.hypot(rp.x - q.x, rp.y - q.y) < CATCH_R) return caught();
    }
  }
  // Smooth follow camera (frame-rate independent)
  const k = 1 - Math.exp(-7 * dt); cam.x += (dp.x - cam.x) * k; cam.y += (dp.y - cam.y) * k;
  $('hudTime').textContent = 'TIME ' + G.t.toFixed(1) + 's';
  $('hudRaj').textContent = !G.rajOut ? 'FISHY RAJ: LEAVING IN ' + Math.max(0, RAJ_DELAY - G.t).toFixed(1) + 's'
    : G.rage && G.rage.phase === 'go' ? 'FISHY RAJ: MACH 10 !!!' : 'FISHY RAJ: ' + (R.speed / D_SPEED).toFixed(2) + 'x D SPEED';
}

function gameOver() {
  G.state = 'over'; G.shake = 8;
  $('banner').classList.add('hidden'); $('flash').classList.remove('on');
  $('offer').classList.add('hidden'); $('question').classList.add('hidden');
  $('overMsg').textContent = OVER_MSGS[Math.floor(Math.random() * OVER_MSGS.length)];
  $('overTime').textContent = 'YOU SURVIVED ' + G.t.toFixed(1) + ' SECONDS';
  $('over').classList.remove('hidden'); $('hud').classList.add('hidden');
  beep(400, .5, 'sawtooth', .1, 0, 60);
  stopAllSnd(); playSnd('lost');
}

/* ---- Pause ---- */
function togglePause() {
  if (G.state === 'play') {
    G.state = 'paused'; $('paused').classList.remove('hidden');
    if (BG) BG.pause();
    if (G.rage && G.rage.phase === 'go') SND.rage.pause();
  } else if (G.state === 'paused') {
    G.state = 'play'; $('paused').classList.add('hidden');
    if (BG) BG.play().catch(() => {});
    if (G.rage && G.rage.phase === 'go') SND.rage.play().catch(() => {});
  }
}

/* ---- Caught -> respawn offer (5s) -> question (4s) -> respawn / game over ---- */
const OFFER_SECS = 5, Q_SECS = 20;
function caught() {
  G.state = 'offer'; G.shake = 0;
  G.caughtAt = { a: G.d.a, b: G.d.b, s: G.d.s, dir: G.d.dir, face: { x: G.d.face.x, y: G.d.face.y } };
  G.offerEnd = last + OFFER_SECS * 1000;
  $('banner').classList.add('hidden'); $('flash').classList.remove('on'); $('hud').classList.add('hidden');
  stopAllSnd(); playSnd('question');         // cut rage/catch music on capture
  $('offer').classList.remove('hidden');
}
function tickOffer(now) {
  const rem = (G.offerEnd - now) / 1000;
  if (rem <= 0) return gameOver();
  $('offerTimer').textContent = 'RESPAWN IN ' + rem.toFixed(1) + 's';
}
function startQuestion() {
  if (G.state !== 'offer') return;
  G.state = 'question'; G.qEnd = last + Q_SECS * 1000;
  G.answer = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];   // random question
  $('qImg').src = 'assets/qns/' + G.answer + '.png';
  $('offer').classList.add('hidden'); $('question').classList.remove('hidden');
  const inp = $('qInput'); inp.value = ''; inp.focus();
}
function tickQuestion(now) {
  const rem = (G.qEnd - now) / 1000;
  if (rem <= 0) return gameOver();
  $('qTimer').textContent = 'ANSWER IN ' + rem.toFixed(1) + 's';
}
function submitAnswer() {
  if (G.state !== 'question') return;
  const val = parseInt($('qInput').value, 10);
  if (val === G.answer) doRespawn(); else gameOver();
}
function doRespawn() {
  const c = G.caughtAt;
  G.d = { a: c.a, b: c.b, s: c.s, dir: c.dir, moving: true, face: { x: c.face.x, y: c.face.y } };
  G.hist = [{ t: G.t, a: G.d.a, b: G.d.b, s: G.d.s }];
  G.raj.hidden = true; G.rajRespawnAt = G.t + 1.5;   // Raj reappears here 1.5s later
  // Respawn clears rage: Raj comes back in normal mode (rage can re-trigger later)
  G.rage = null; G.raj.speed = RAJ_SPEED; G.shake = 0;
  G.nextRage = G.t + 10 + Math.random() * 12;
  stopSnd('rage'); $('banner').classList.add('hidden'); $('flash').classList.remove('on');
  held = []; lastDir = null; lastDirT = -9;
  const p = pos(G.d); cam.x = p.x; cam.y = p.y;
  $('question').classList.add('hidden'); $('offer').classList.add('hidden');
  $('hud').classList.remove('hidden');
  G.state = 'play';
  stopSnd('question'); playSnd('respawn');
}

/* ---- Rendering ---- */
function drawChar(atlas, e, hurt, t) {
  const p = pos(e), f = e.face, side = Math.abs(f.x) >= Math.abs(f.y);
  const dirI = side ? 1 : (f.y < 0 ? 2 : 0);
  const run = e.moving && Math.floor(t / 0.11) % 2 === 1;
  const cell = hurt ? 6 : dirI + (e.moving && run ? 3 : 0);
  const bob = e.moving ? Math.abs(Math.sin(t * 14)) * 1.5 : 0;
  const dw = 64 * CHAR_SCALE, dh = 80 * CHAR_SCALE, x = p.x, y = p.y + 3;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x, y, 7, 2.5, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(x, y - dh - bob + 2);
  if (side && f.x < 0) ctx.scale(-1, 1);
  ctx.drawImage(atlas, cell * 64, 0, 64, 80, -dw / 2, 0, dw, dh);
  ctx.restore();
}

function render(now) {
  const W = cv.width, H = cv.height; zoom = H / VIS_H;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#16301d'; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  const vw = W / zoom, vh = H / zoom;
  let cx = Math.min(Math.max(cam.x, vw / 2), MAP_W - vw / 2), cy = Math.min(Math.max(cam.y, vh / 2), MAP_H - vh / 2);
  if (G.state === 'menu') { cx = HALL[0]; cy = HALL[1]; }
  const sx = G.shake ? (Math.random() - .5) * G.shake * zoom : 0, sy = G.shake ? (Math.random() - .5) * G.shake * zoom : 0;
  ctx.setTransform(zoom, 0, 0, zoom, Math.round(W / 2 - cx * zoom + sx), Math.round(H / 2 - cy * zoom + sy));
  ctx.drawImage(MAP, 0, 0);
  const t = now / 1000;
  if (G.state === 'menu') {             // title scene: D and Fishy Raj at the lecture hall
    const h = idx.get(HALL.join(','));
    const d = { a: h, b: adj[h][0], s: 0, dir: 1, moving: true, face: { x: -1, y: 0 } };
    const r = { a: h, b: adj[h][1] != null ? adj[h][1] : adj[h][0], s: 0, dir: 1, moving: true, face: { x: -1, y: 0 } };
    d.s = 0; r.s = 0;
    ctx.save(); ctx.translate(-30, 0); drawChar(ATL.d, d, false, t); ctx.restore();
    ctx.save(); ctx.translate(34, 0); drawChar(ATL.raj, r, false, t); ctx.restore();
  } else if (G.state !== 'menu') {
    const list = [[G.d, ATL.d, G.state === 'over' || G.state === 'offer' || G.state === 'question']];
    if (G.rajOut && !G.raj.hidden) list.push([G.raj, ATL.raj, false]);
    list.sort((a, b) => pos(a[0]).y - pos(b[0]).y);
    for (const [e, a, hurt] of list) drawChar(a, e, hurt, G.t);
    if (G.rage && G.rage.phase === 'go' && G.state === 'play') {     // speed lines
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(255,255,255,.55)';
      for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 60 + Math.random() * 200, 2);
    }
  }
}

/* ---- Main loop (requestAnimationFrame + delta time) ---- */
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
  if (G.state === 'play') update(dt);
  else if (G.state === 'offer') tickOffer(now);
  else if (G.state === 'question') tickQuestion(now);
  render(now);
  requestAnimationFrame(frame);
}
function resize() { cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', resize); resize();
$('playBtn').onclick = startGame; $('againBtn').onclick = startGame;
$('pauseBtn').onclick = togglePause; $('resumeBtn').onclick = togglePause;
$('respawnBtn').onclick = startQuestion; $('declineBtn').onclick = gameOver;
$('qSubmit').onclick = submitAnswer;
$('qInput').addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); submitAnswer(); } });
addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { togglePause(); return; }
  if (ev.key === 'Enter' && (G.state === 'menu' || G.state === 'over')) startGame();
});
requestAnimationFrame(frame);
