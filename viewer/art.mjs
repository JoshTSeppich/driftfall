// Driftfall art: procedural canvas drawing for the map, structures and units.
//
// Everything here is drawn from code, nothing is loaded. The look is original to Driftfall: a dark drifting
// basalt world where glowing Shard crystals have fallen, fought over by two salvage fleets. Side 0 is the
// Cobalt fleet (blue), side 1 is the Ember fleet (orange). Sprites are designed on a 20-unit grid and scaled
// to the cell size, so they stay readable at 20 px and look sharp at 48 px.
//
// Exports the viewer calls (all take a 2D canvas context and never touch the DOM):
//   drawTerrain(ctx, state, { cell, time })            ground, rocks and Shard fields for the whole map
//   drawStructure(ctx, structure, { cell, time, ... })  core, forge, turret, plus under-construction sites
//   drawUnit(ctx, unit, { cell, time, pose, facing, deathT, ... })
//   drawHpBar(ctx, px, py, cell, frac)
//   inferPose(unit) -> 'idle' | 'move' | 'attack'
//   TEAM_COLORS, teamColors(owner), KINDS, POSES, defaultFacing(owner)
//
// Nothing here uses Math.random or the clock; animation comes from the `time` you pass in (seconds).

export const ART_VERSION = 1;

export const KINDS = Object.freeze({
  units: Object.freeze(['worker', 'grunt', 'lancer', 'brute']),
  structures: Object.freeze(['core', 'forge', 'turret']),
});
export const POSES = Object.freeze(['idle', 'move', 'attack', 'die']);

// Two fleets. `main` is the body colour, `light` the highlight, `dark` the shadow, `glow` an rgba for halos.
export const TEAM_COLORS = Object.freeze([
  Object.freeze({ name: 'Cobalt', main: '#3fa9ff', light: '#aee0ff', dark: '#174e8f', deep: '#0b2a4f', glow: 'rgba(63,169,255,0.55)', css: '#3fa9ff' }),
  Object.freeze({ name: 'Ember', main: '#ff8a3d', light: '#ffd4ae', dark: '#9a3f14', deep: '#4f1f08', glow: 'rgba(255,138,61,0.55)', css: '#ff8a3d' }),
]);
const NEUTRAL = Object.freeze({ name: 'Drift', main: '#9aa3ad', light: '#d8dde3', dark: '#4e5660', deep: '#262b32', glow: 'rgba(154,163,173,0.5)', css: '#9aa3ad' });
const HIT = Object.freeze({ name: 'Hit', main: '#ffffff', light: '#ffffff', dark: '#ffd0d0', deep: '#ff8080', glow: 'rgba(255,255,255,0.8)', css: '#ffffff' });

export function teamColors(owner) {
  return TEAM_COLORS[owner] ?? NEUTRAL;
}

export const PALETTE = Object.freeze({
  ground: '#0f1318',
  groundLight: '#131920',
  groundDark: '#0d1015',
  shardFloor: 'rgba(78,242,216,0.10)',
  drift: 'rgba(120,150,180,0.06)',
  grid: 'rgba(140,160,190,0.05)',
  rock: '#3a434f',
  rockLight: '#5a6573',
  rockDark: '#20262e',
  shard: '#4ef2d8',
  shardLight: '#d9fff8',
  shardDark: '#137a6b',
  shardEmpty: '#2a3b40',
  shardGlow: 'rgba(78,242,216,0.35)',
});

// ---------- small helpers ----------

// Deterministic 2D hash in [0, 1). Same inputs always give the same number, so the ground never flickers.
export function hash(x, y, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2246822519;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function regular(ctx, cx, cy, r, sides, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * TAU) / sides;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function glow(ctx, cx, cy, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Units face the enemy by default: side 0 looks down-right, side 1 looks up-left.
export function defaultFacing(owner) {
  return owner === 1 ? -3 * Math.PI / 4 : Math.PI / 4;
}

// Pick a pose from a unit's order. Dying is the viewer's call (it knows about die events), so it is never inferred.
export function inferPose(unit) {
  const o = unit?.order;
  if (!o) return 'idle';
  if (o.type === 'attack') return 'attack';
  if (o.type === 'move' || o.type === 'build') return 'move';
  if (o.type === 'gather') return o.phase === 'mining' ? 'attack' : 'move';
  return 'idle';
}

// ---------- terrain ----------

const terrainCache = new Map();

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return null;
}

// Ground + rocks are static for a match, so they are painted once per (size, seed) onto an offscreen canvas.
function groundLayer(state, cell) {
  const W = state.width, H = state.height, seed = state.seed ?? 0;
  const key = `${W}x${H}x${cell}x${seed}x${state.rocks.length}`;
  let layer = terrainCache.get(key);
  if (layer) return layer;
  const canvas = makeCanvas(W * cell, H * cell);
  if (!canvas) return null;
  const g = canvas.getContext('2d');
  paintGround(g, state, cell);
  for (const [x, y] of state.rocks) drawRock(g, x, y, cell, seed);
  layer = canvas;
  if (terrainCache.size > 8) terrainCache.delete(terrainCache.keys().next().value);
  terrainCache.set(key, layer);
  return layer;
}

function paintGround(ctx, state, cell) {
  const W = state.width, H = state.height, seed = state.seed ?? 0;
  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(0, 0, W * cell, H * cell);
  // Mottled basalt: each tile a hair lighter or darker.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = hash(x, y, seed);
      if (n < 0.22) ctx.fillStyle = PALETTE.groundDark;
      else if (n > 0.78) ctx.fillStyle = PALETTE.groundLight;
      else continue;
      // soft-edged patch rather than a hard tile so the floor reads as stone, not a checkerboard
      const inset = cell * (0.1 + 0.15 * hash(x, y, seed + 9));
      ctx.fillRect(x * cell - inset, y * cell - inset, cell + inset * 2, cell + inset * 2);
    }
  }
  // Drift streaks: long faint diagonal bands, the "fall" the world is named for.
  ctx.save();
  ctx.strokeStyle = PALETTE.drift;
  ctx.lineWidth = Math.max(1, cell * 0.35);
  for (let i = 0; i < 14; i++) {
    const a = hash(i, 7, seed), b = hash(i, 11, seed);
    const sx = a * W * cell, sy = -cell * 2 + b * H * cell * 0.5;
    const len = (0.5 + hash(i, 13, seed)) * H * cell;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - len * 0.45, sy + len);
    ctx.stroke();
  }
  ctx.restore();
  // Specks of fallen dust.
  ctx.fillStyle = 'rgba(180,200,230,0.10)';
  const specks = Math.floor(W * H * 0.35);
  for (let i = 0; i < specks; i++) {
    const x = hash(i, 101, seed) * W * cell, y = hash(i, 103, seed) * H * cell;
    const r = 0.5 + hash(i, 107, seed) * cell * 0.06;
    ctx.fillRect(x, y, r, r);
  }
  // Faint grid so tiles can be counted.
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= W; i++) { ctx.moveTo(i * cell + 0.5, 0); ctx.lineTo(i * cell + 0.5, H * cell); }
  for (let j = 0; j <= H; j++) { ctx.moveTo(0, j * cell + 0.5); ctx.lineTo(W * cell, j * cell + 0.5); }
  ctx.stroke();
}

// A rock is a jagged boulder with a lit facet, shaped by its tile position so the same seed gives the same rocks.
export function drawRock(ctx, x, y, cell, seed = 0) {
  const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
  const n = 5 + Math.floor(hash(x, y, seed + 1) * 3);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash(x * 3 + i, y, seed + 2) * 0.5;
    const r = cell * (0.34 + hash(x, y * 3 + i, seed + 3) * 0.14);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  ctx.save();
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(cx + cell * 0.06, cy + cell * 0.12, cell * 0.42, cell * 0.3, 0, 0, TAU);
  ctx.fill();
  poly(ctx, pts);
  ctx.fillStyle = PALETTE.rock;
  ctx.fill();
  ctx.strokeStyle = PALETTE.rockDark;
  ctx.lineWidth = Math.max(1, cell * 0.06);
  ctx.stroke();
  // lit facet on the upper left
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[1 % n][0], pts[1 % n][1]);
  ctx.lineTo(cx - cell * 0.05, cy - cell * 0.05);
  ctx.closePath();
  ctx.fillStyle = PALETTE.rockLight;
  ctx.globalAlpha = 0.7;
  ctx.fill();
  ctx.restore();
}

// A Shard field tile: a cluster of crystals that glows while it still holds Shards and goes dark when mined out.
export function drawCrystal(ctx, crystal, { cell, time = 0, full = 400 } = {}) {
  const { x, y, amount = 0 } = crystal;
  const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
  const frac = clamp01(amount / (full || 1));
  const alive = amount > 0;
  const s = cell / 20;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  // the whole tile is a shard-strewn floor, so a field reads as a field even when mined out
  ctx.fillStyle = alive ? PALETTE.shardFloor : 'rgba(40,60,64,0.35)';
  ctx.fillRect(-10, -10, 20, 20);
  ctx.strokeStyle = alive ? 'rgba(78,242,216,0.25)' : 'rgba(60,80,84,0.3)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-9.5, -9.5, 19, 19);
  if (alive) glow(ctx, 0, 0, 12, PALETTE.shardGlow, 0.5 + 0.5 * frac + 0.1 * Math.sin(time * 2 + x + y));
  // one tall crystal flanked by two smaller ones, all leaning apart; they shrink as the tile empties
  const spikes = [
    { dx: -5.5, dy: 4, h: 7 + 2 * hash(x, y, 5), w: 3, lean: -0.3 },
    { dx: 0.5, dy: 5.5, h: 12 + 2 * hash(x, y, 6), w: 4.2, lean: 0.04 },
    { dx: 6, dy: 3.5, h: 6 + 2 * hash(x, y, 7), w: 2.8, lean: 0.32 },
  ];
  for (const sp of spikes) {
    const h = alive ? sp.h * (0.6 + 0.4 * frac) : sp.h * 0.3;
    const w = sp.w;
    ctx.save();
    ctx.translate(sp.dx, sp.dy);
    ctx.rotate(sp.lean);
    // right face
    poly(ctx, [[0, -h], [w, -h * 0.3], [w * 0.5, 2], [0, 1]]);
    ctx.fillStyle = alive ? PALETTE.shard : PALETTE.shardEmpty;
    ctx.fill();
    // left face darker
    poly(ctx, [[0, -h], [-w, -h * 0.3], [-w * 0.5, 2], [0, 1]]);
    ctx.fillStyle = alive ? PALETTE.shardDark : '#1b272b';
    ctx.fill();
    // bright edge
    ctx.strokeStyle = alive ? PALETTE.shardLight : '#3a4a4e';
    ctx.lineWidth = alive ? 1 : 0.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-w, -h * 0.3);
    ctx.lineTo(0, -h);
    ctx.lineTo(w, -h * 0.3);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// Whole map in one call. `state` needs width, height, rocks, crystals and (optionally) seed.
export function drawTerrain(ctx, state, { cell = 20, time = 0, fullCrystal = 400 } = {}) {
  const layer = groundLayer(state, cell);
  if (layer) ctx.drawImage(layer, 0, 0);
  else {
    paintGround(ctx, state, cell);
    for (const [x, y] of state.rocks) drawRock(ctx, x, y, cell, state.seed ?? 0);
  }
  for (const c of state.crystals) drawCrystal(ctx, c, { cell, time, full: fullCrystal });
}

// ---------- shared unit and structure bits ----------

export function drawHpBar(ctx, px, py, cell, frac, { owner } = {}) {
  frac = clamp01(frac);
  if (frac >= 1) return;
  const w = cell - 4, h = Math.max(2, Math.round(cell * 0.12));
  const x = px + 2, y = py + cell - h - 1;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = frac > 0.5 ? '#63e07a' : frac > 0.25 ? '#f0c84a' : '#ff5a5a';
  ctx.fillRect(x, y, Math.round(w * frac), h);
  if (owner !== undefined) {
    ctx.strokeStyle = teamColors(owner).dark;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  ctx.restore();
}

function shadow(ctx, rx, ry, alpha = 0.45) {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(0.6, 1.4, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Flying fragments for the death pose. `t` runs 0..1.
function fragments(ctx, col, t, count, spread, seedA) {
  ctx.save();
  ctx.globalAlpha *= 1 - t;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + hash(i, seedA, 3);
    const d = spread * (0.2 + t * 1.3) * (0.6 + hash(i, seedA, 4) * 0.6);
    const fx = Math.cos(a) * d, fy = Math.sin(a) * d + t * t * 6;
    const r = 1.2 + hash(i, seedA, 5) * 1.5;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(t * 6 + i);
    ctx.fillStyle = i % 3 === 0 ? col.light : i % 3 === 1 ? col.main : col.dark;
    ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
    ctx.restore();
  }
  ctx.restore();
}

// ---------- units ----------
// Each body is drawn in local space: origin at the tile centre, +x is the facing direction, 20 units = 1 cell.

function bodyWorker(ctx, col, pose, t, u) {
  const bob = pose === 'move' ? Math.sin(t * 14) * 0.8 : Math.sin(t * 3) * 0.3;
  shadow(ctx, 5.5, 3.2);
  ctx.save();
  ctx.translate(0, bob);
  // hover ring
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, 2.4, 5.6, 2.4, 0, 0, TAU);
  ctx.stroke();
  // pincers, open or clamping while mining (attack pose doubles as "working")
  const clamp = pose === 'attack' ? 0.5 + 0.5 * Math.sin(t * 16) : 0;
  for (const side of [-1, 1]) {
    ctx.strokeStyle = col.light;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(3, side * 2.5);
    ctx.lineTo(7, side * (3.5 - clamp * 2.5));
    ctx.stroke();
  }
  // round pod
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, TAU);
  ctx.fillStyle = col.main;
  ctx.fill();
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // visor
  ctx.beginPath();
  ctx.arc(1.5, -0.5, 2.1, 0, TAU);
  ctx.fillStyle = col.deep;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(2.2, -1.1, 0.9, 0, TAU);
  ctx.fillStyle = col.light;
  ctx.fill();
  // carried Shard, held out in front
  if (u.carrying > 0) {
    ctx.save();
    ctx.translate(7.5, 0);
    glow(ctx, 0, 0, 4, PALETTE.shardGlow, 0.9);
    poly(ctx, [[0, -3.2], [2.2, 0], [0, 3.2], [-2.2, 0]]);
    ctx.fillStyle = PALETTE.shard;
    ctx.fill();
    ctx.strokeStyle = PALETTE.shardLight;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function bodyGrunt(ctx, col, pose, t) {
  const stride = pose === 'move' ? Math.sin(t * 16) : 0;
  const lunge = pose === 'attack' ? Math.max(0, Math.sin(t * 12)) * 2.2 : 0;
  shadow(ctx, 6, 3.6);
  // legs: two stubs that scissor while moving
  ctx.strokeStyle = col.deep;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-1, side * 3.5);
    ctx.lineTo(-1 + stride * side * 2.5, side * 6.2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(lunge, 0);
  // wedge body pointing forward
  poly(ctx, [[7, 0], [1, -6], [-6, -4.5], [-6, 4.5], [1, 6]]);
  ctx.fillStyle = col.main;
  ctx.fill();
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // shield plate on the nose
  poly(ctx, [[7, 0], [2.5, -4.5], [2.5, 4.5]]);
  ctx.fillStyle = col.light;
  ctx.fill();
  // dark visor strip across the plate
  poly(ctx, [[5.2, -1.8], [5.2, 1.8], [2.8, 2.6], [2.8, -2.6]]);
  ctx.fillStyle = col.deep;
  ctx.fill();
  // back vent slit
  ctx.fillStyle = col.deep;
  ctx.fillRect(-5, -2, 2, 4);
  // blade: a short slash arc when attacking
  if (pose === 'attack') {
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * Math.max(0, Math.sin(t * 12));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(6, 0, 5.5, -1.1, 1.1);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function bodyLancer(ctx, col, pose, t) {
  const sway = pose === 'move' ? Math.sin(t * 12) * 0.6 : Math.sin(t * 2) * 0.2;
  const recoil = pose === 'attack' ? -Math.max(0, Math.sin(t * 14)) * 1.5 : 0;
  shadow(ctx, 6.5, 2.6);
  // tripod feet
  ctx.strokeStyle = col.deep;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (const [dx, dy] of [[-5, -4.5], [-5, 4.5], [1, 5.5]]) {
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(dx, dy + sway * Math.sign(dy));
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(recoil, 0);
  // slender diamond hull
  poly(ctx, [[4, 0], [-1, -3.2], [-8, -1.8], [-8, 1.8], [-1, 3.2]]);
  ctx.fillStyle = col.main;
  ctx.fill();
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 1.1;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // long lance
  ctx.strokeStyle = col.light;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.lineTo(10, 0);
  ctx.stroke();
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(5, -1.6); ctx.lineTo(5, 1.6);
  ctx.stroke();
  // eye
  ctx.beginPath();
  ctx.arc(-3, 0, 1.3, 0, TAU);
  ctx.fillStyle = col.light;
  ctx.fill();
  // bolt and muzzle flash when firing
  if (pose === 'attack') {
    const f = Math.max(0, Math.sin(t * 14));
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.7 * f;
    glow(ctx, 10, 0, 4.5, 'rgba(255,255,255,0.9)', 1);
    ctx.strokeStyle = col.light;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(10 + 10 * f, 0);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function bodyBrute(ctx, col, pose, t) {
  const stomp = pose === 'move' ? Math.abs(Math.sin(t * 7)) * 0.8 : 0;
  const clampT = pose === 'attack' ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
  shadow(ctx, 9, 5.5, 0.55);
  // four heavy feet
  ctx.fillStyle = col.deep;
  for (const [dx, dy, i] of [[-5, -7, 0], [-5, 7, 1], [3, -7.5, 2], [3, 7.5, 3]]) {
    const lift = pose === 'move' ? Math.max(0, Math.sin(t * 7 + i * 1.57)) * 1.2 : 0;
    ctx.beginPath();
    ctx.ellipse(dx, dy - lift, 2.6, 1.8, 0, 0, TAU);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(0, -stomp);
  // plated hex chassis
  regular(ctx, 0, 0, 8.6, 6, 0);
  ctx.fillStyle = col.main;
  ctx.fill();
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // plate seams
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-4.3, -7.4); ctx.lineTo(-4.3, 7.4);
  ctx.moveTo(4.3, -7.4); ctx.lineTo(4.3, 7.4);
  ctx.stroke();
  // raised dome
  ctx.beginPath();
  ctx.arc(-1, 0, 3.6, 0, TAU);
  ctx.fillStyle = col.light;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-1, 0, 1.6, 0, TAU);
  ctx.fillStyle = col.deep;
  ctx.fill();
  // two claws out front, clamping when attacking
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(7, side * 5);
    ctx.rotate(side * (0.55 - clampT * 0.8));
    poly(ctx, [[0, -2], [6, -1], [7.5, 0], [6, 1], [0, 2]]);
    ctx.fillStyle = col.light;
    ctx.fill();
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  if (pose === 'attack' && clampT > 0.8) {
    ctx.save();
    ctx.globalAlpha = (clampT - 0.8) * 5;
    ctx.fillStyle = '#ffffff';
    regular(ctx, 13, 0, 3.5, 8, t * 5);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

const BODIES = { worker: bodyWorker, grunt: bodyGrunt, lancer: bodyLancer, brute: bodyBrute };
const UNIT_RADIUS = { worker: 6, grunt: 7, lancer: 8, brute: 10 };

// Draw one unit. `unit` is a state record: { kind, owner, x, y, hp, carrying, order }.
// opts: cell (px per tile), time (seconds), pose ('idle'|'move'|'attack'|'die'; inferred from the order if absent),
//       facing (radians, 0 = right, clockwise on screen), deathT (0..1 while dying), maxHp, hit (flash white),
//       ox/oy (extra pixel offset, for smoothing between tiles), hpBar (default true).
// Also accepts haiku's live-screen form: drawUnit(ctx, unit, { x, y, size }) with a pixel box instead of a tile.
// Returns true when it drew something, false for a kind it does not know.
export function drawUnit(ctx, unit, opts = {}) {
  if (!BODIES[unit?.kind]) return false;
  opts = normalizeBox(opts);
  const { cell = 20, time = 0, deathT = 0, maxHp, hit = false, ox = 0, oy = 0, hpBar = true } = opts;
  const pose = opts.pose ?? inferPose(unit);
  const facing = opts.facing ?? defaultFacing(unit.owner);
  const body = BODIES[unit.kind];
  const col = hit ? HIT : teamColors(unit.owner);
  const px = (opts.px ?? unit.x * cell) + ox, py = (opts.py ?? unit.y * cell) + oy;
  const cx = px + cell / 2, cy = py + cell / 2;
  const s = cell / 20;
  // Per-unit phase so a crowd doesn't march in lockstep.
  const t = time + hash(unit.id ?? 0, 9, 1) * 10;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  if (pose === 'die') {
    const d = clamp01(deathT);
    ctx.save();
    ctx.globalAlpha = 1 - d * d;
    ctx.rotate(facing + d * 0.8);
    ctx.scale(1 - d * 0.5, 1 - d * 0.5);
    body(ctx, col, 'idle', t, unit);
    ctx.restore();
    fragments(ctx, teamColors(unit.owner), d, 7, UNIT_RADIUS[unit.kind] ?? 7, unit.id ?? 0);
    ctx.restore();
    return true;
  }
  if (hit) glow(ctx, 0, 0, 9, 'rgba(255,255,255,0.7)', 1);
  ctx.rotate(facing);
  body(ctx, col, pose, t, unit);
  ctx.restore();
  if (hpBar && maxHp) drawHpBar(ctx, px, py, cell, unit.hp / maxHp, { owner: unit.owner });
  return true;
}

// { x, y, size } pixel box (live screen style) -> { px, py, cell }. Plain tile-style options pass through.
function normalizeBox(opts) {
  if (opts && typeof opts.size === 'number') {
    const { x, y, size, ...rest } = opts;
    return { ...rest, px: x, py: y, cell: size };
  }
  return opts ?? {};
}

// ---------- structures ----------
// Drawn in local space with +x to the right (structures don't face anything), 20 units = 1 cell.

function bodyCore(ctx, col, t, hit) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
  shadow(ctx, 11, 6, 0.5);
  glow(ctx, 0, 0, 15, col.glow, 0.5 + 0.4 * pulse);
  // wide octagonal plinth
  regular(ctx, 0, 0.5, 12.5, 8, Math.PI / 8);
  ctx.fillStyle = col.deep;
  ctx.fill();
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  regular(ctx, 0, 0, 10.5, 8, Math.PI / 8);
  ctx.fillStyle = col.main;
  ctx.fill();
  // team-coloured ring with gaps
  ctx.save();
  ctx.strokeStyle = col.light;
  ctx.lineWidth = 2;
  ctx.setLineDash([4.5, 2.5]);
  ctx.lineDashOffset = -t * 6;
  ctx.beginPath();
  ctx.arc(0, 0, 7.5, 0, TAU);
  ctx.stroke();
  ctx.restore();
  // dark well
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0, TAU);
  ctx.fillStyle = col.deep;
  ctx.fill();
  // three floating Shards slowly turning over the well
  for (let i = 0; i < 3; i++) {
    const a = t * 0.9 + (i * TAU) / 3;
    const r = 2.8, x = Math.cos(a) * r, y = Math.sin(a) * r * 0.55 - 1.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.8, 1);
    poly(ctx, [[0, -2.6], [1.5, 0], [0, 2.6], [-1.5, 0]]);
    ctx.fillStyle = hit ? '#fff' : PALETTE.shard;
    ctx.fill();
    ctx.restore();
  }
  glow(ctx, 0, -1, 5, PALETTE.shardGlow, 0.6 + 0.4 * pulse);
}

function bodyForge(ctx, col, t) {
  const heat = 0.5 + 0.5 * Math.sin(t * 5);
  shadow(ctx, 10, 5.5, 0.5);
  // chamfered block
  poly(ctx, [[-9, -5], [-5, -9], [9, -9], [9, 6], [5, 9.5], [-9, 9.5]]);
  ctx.fillStyle = col.dark;
  ctx.fill();
  ctx.strokeStyle = col.deep;
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  poly(ctx, [[-7, -3.5], [-3.5, -7], [7, -7], [7, 4.5], [3.5, 7.5], [-7, 7.5]]);
  ctx.fillStyle = col.main;
  ctx.fill();
  // furnace mouth, glowing hot
  ctx.fillStyle = col.deep;
  ctx.fillRect(-5, 0, 10, 5.5);
  const g = ctx.createLinearGradient(-5, 0, 5, 0);
  g.addColorStop(0, `rgba(255,220,120,${0.5 + 0.5 * heat})`);
  g.addColorStop(1, `rgba(255,120,40,${0.4 + 0.5 * heat})`);
  ctx.fillStyle = g;
  ctx.fillRect(-4.2, 1, 8.4, 3.5);
  // stack with a hot tip
  ctx.fillStyle = col.light;
  ctx.fillRect(3, -11.5, 3.5, 5);
  ctx.fillStyle = `rgba(255,170,80,${0.5 + 0.5 * heat})`;
  ctx.fillRect(3.5, -12.5, 2.5, 1.5);
  // stripes on the shoulder
  ctx.strokeStyle = col.light;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-6, -4.5); ctx.lineTo(-2, -4.5);
  ctx.moveTo(-6, -2); ctx.lineTo(0, -2);
  ctx.stroke();
}

function bodyTurret(ctx, col, t, facing) {
  shadow(ctx, 8, 5, 0.45);
  // round base plate with three bolts
  ctx.beginPath();
  ctx.arc(0, 0.5, 8.5, 0, TAU);
  ctx.fillStyle = col.deep;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 7.5, 0, TAU);
  ctx.fillStyle = col.dark;
  ctx.fill();
  ctx.strokeStyle = col.main;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = col.light;
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3 + Math.PI / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 5.8, Math.sin(a) * 5.8, 1, 0, TAU);
    ctx.fill();
  }
  // rotating twin-barrel head
  ctx.save();
  ctx.rotate(facing ?? Math.sin(t * 0.7) * 0.6);
  ctx.fillStyle = col.main;
  regular(ctx, 0, 0, 4.5, 6, 0);
  ctx.fill();
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = col.light;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(2, -1.6); ctx.lineTo(9.5, -1.6);
  ctx.moveTo(2, 1.6); ctx.lineTo(9.5, 1.6);
  ctx.stroke();
  ctx.restore();
}

function scaffold(ctx, col, progress, t, kind) {
  // dashed frame marking the footprint
  ctx.save();
  ctx.strokeStyle = col.main;
  ctx.lineWidth = 1;
  ctx.setLineDash([2.5, 2]);
  ctx.lineDashOffset = -t * 4;
  ctx.globalAlpha = 0.8;
  ctx.strokeRect(-9, -9, 18, 18);
  ctx.restore();
  // corner posts rising with progress
  const h = 2 + progress * 7;
  ctx.fillStyle = col.light;
  for (const [x, y] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) ctx.fillRect(x - 1, y - h, 2, h + 1);
  // welding spark that wanders
  const sx = Math.sin(t * 3.1) * 5, sy = Math.cos(t * 2.3) * 5;
  const f = Math.max(0, Math.sin(t * 17));
  if (f > 0.3) {
    ctx.save();
    ctx.globalAlpha = f;
    ctx.fillStyle = '#fff5c0';
    regular(ctx, sx, sy, 1.6 + f, 4, t * 9);
    ctx.fill();
    ctx.restore();
  }
}

const STRUCT_BODIES = { core: bodyCore, forge: bodyForge, turret: bodyTurret };

// Draw one structure. `structure` is a state record: { kind, owner, x, y, hp, progress, complete, queue }.
// opts: cell, time, maxHp, buildTicks (needed for the site's progress fraction), hit, facing (turret head angle),
//       hpBar (default true), queuePips (default true: small dots for queued units).
// Also accepts the { x, y, size } pixel-box form. Returns true when drawn, false for an unknown kind.
export function drawStructure(ctx, structure, opts = {}) {
  if (!STRUCT_BODIES[structure?.kind]) return false;
  opts = normalizeBox(opts);
  const { cell = 20, time = 0, maxHp, buildTicks, hit = false, facing, hpBar = true, queuePips = true } = opts;
  const col = hit ? HIT : teamColors(structure.owner);
  const px = opts.px ?? structure.x * cell, py = opts.py ?? structure.y * cell;
  const cx = px + cell / 2, cy = py + cell / 2;
  const s = cell / 20;
  const t = time + hash(structure.id ?? 0, 9, 2) * 10;
  const body = STRUCT_BODIES[structure.kind];
  const complete = structure.complete !== false;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  if (complete) {
    if (hit) glow(ctx, 0, 0, 13, 'rgba(255,255,255,0.7)', 1);
    body(ctx, col, t, hit, facing);
  } else {
    const frac = buildTicks ? clamp01((structure.progress ?? 0) / buildTicks) : 0;
    // the building rises out of the ground: clip from the bottom up to the progress fraction
    ctx.save();
    ctx.beginPath();
    ctx.rect(-14, 14 - 28 * (0.15 + 0.85 * frac), 28, 28);
    ctx.clip();
    ctx.globalAlpha = 0.85;
    body(ctx, col, t, hit, 0);
    ctx.restore();
    scaffold(ctx, col, frac, t, structure.kind);
  }
  ctx.restore();
  if (!complete) {
    const frac = buildTicks ? clamp01((structure.progress ?? 0) / buildTicks) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(px + 2, py + 1, cell - 4, 2);
    ctx.fillStyle = teamColors(structure.owner).light;
    ctx.fillRect(px + 2, py + 1, (cell - 4) * frac, 2);
  } else if (hpBar && maxHp) {
    drawHpBar(ctx, px, py, cell, structure.hp / maxHp, { owner: structure.owner });
  }
  if (complete && queuePips && structure.queue?.length) {
    const n = Math.min(5, structure.queue.length);
    const r = Math.max(1, cell * 0.07);
    ctx.fillStyle = teamColors(structure.owner).light;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(px + cell - 3 - i * (r * 2 + 1.5), py + 3 + r, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
  return true;
}

// One-stop frame for a simple viewer: terrain, structures, then units in y order so nearer things overlap.
export function drawScene(ctx, state, { cell = 20, time = 0, stats, hitIds, poses, facings, deaths } = {}) {
  drawTerrain(ctx, state, { cell, time });
  const maxHpOf = (kind) => stats?.units?.[kind]?.hp ?? stats?.structures?.[kind]?.hp ?? stats?.[kind]?.hp;
  const buildOf = (kind) => stats?.structures?.[kind]?.buildTicks ?? stats?.[kind]?.buildTicks;
  for (const s of state.structures) {
    drawStructure(ctx, s, { cell, time, maxHp: maxHpOf(s.kind), buildTicks: buildOf(s.kind), hit: hitIds?.has(s.id) });
  }
  const units = [...state.units].sort((a, b) => a.y - b.y || a.id - b.id);
  for (const u of units) {
    drawUnit(ctx, u, { cell, time, maxHp: maxHpOf(u.kind), hit: hitIds?.has(u.id), pose: poses?.get?.(u.id), facing: facings?.get?.(u.id) });
  }
  if (deaths) {
    for (const d of deaths) drawUnit(ctx, d.unit, { cell, time, pose: 'die', deathT: d.t, hpBar: false });
  }
}
