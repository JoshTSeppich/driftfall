// Wheatfield Valley, the 256 x 256 map of maps/WHEATFIELD.md. Owner: sonnet.
//
// Drawn in code, not by hand tile by tile: the land is cut into 31 Reaches by nearest-seed (Voronoi) regions, so the
// shapes are organic like the wheat fields they hold. Side 0 (bottom-left) is laid out from 15 seeds; side 1 is its point
// mirror (x, y) -> (255 - x, 255 - y), and the Mill Dam is the one centre Reach (id 31). Ids: 1..15 side 0, 16..30 side 1
// (id + 15), 31 the Dam. Gate ids start at 32 and take two base-64 digits in the file (idDigits 2).
//
// Crumb Creek is a band of water tiles '~' from the top-left corner to the bottom-right one, bent by a gentle sine so
// it is not a ruler line, and point-symmetric (its centre line passes through (128, 128)). Water is impassable: env/map.mjs
// puts it in the rock list. Two bridges ('B') and two fords ('f') cross it as mirror pairs; they are walkable.
// The Mill Dam gap is four water tiles on the anti-diagonal through the centre, with six movable rocks on the banks. Push
// them in and three fords in a row close the gap (env/rocks.mjs makes the dam). The lowered stretch of river downstream
// is data (extras.dam.lowered): when the dam is built those tiles stop being water (riverWhenDammed).
//
// Legend, on top of maps/layout-v4.mjs: '~' creek water, 'B' bridge, 'f' ford, 'U' well, 'G' generator socket,
// 'k' Grudge Kettle camp, 'X' the Old Windmill ruin (one, on the north-east bank: the centre line has no room for a pair).
// Wheat is 'S', golden wheat 'R', dairy meadows 'L' (Flux), rock lines '#'. Pure: no fs, no clock, no randomness.

export const W = 256;
export const H = 256;
export const PER_SIDE = 15;
export const DAM_ID = 31;
export const GATE_BASE = 32;

const CREEK_HALF = 5; // tiles either side of the centre line
const BEND = { amp: 10, freq: (2 * Math.PI * 2) / 256 }; // two gentle bends across the map

/** Spec-like record for encodeV4: the name, size and id layout (the same fields STANDARD and the sizes carry). */
export const WHEATFIELD = Object.freeze({ name: 'wheatfield', w: W, h: H, gateBase: GATE_BASE, idDigits: 2 });

/** The creek's centre line at (continuous) coordinate p along the map. Point-symmetric: c(256 - p) = 256 - c(p). */
export const creekCentre = (p) => p + BEND.amp * Math.sin(BEND.freq * (p - 128));
const centreY = (x) => creekCentre(x + 0.5);
const inCreekXY = (x, y) => Math.abs(y + 0.5 - centreY(x)) <= CREEK_HALF;
const landBelow = (x, y) => y + 0.5 - centreY(x) > CREEK_HALF; // side 0
const inDamBox = (x, y) => Math.abs(x + 0.5 - 128) <= 7 && Math.abs(y + 0.5 - centreY(x)) <= 9;

// Crossings: a strip of three columns that crosses the creek. The second of each mirror pair is the point mirror.
const BRIDGE_X = [52, 201];
const FORD_X = [88, 165];
const STRIP = 3;
// The lowered stretch of river: three columns downstream of the dam that stop being water once the dam is built.
const LOWERED_X0 = 180;

// Side 0 Reaches, one seed each, in id order (id = index + 1). kind: the role; h: 1 for a plateau.
const SEEDS = [
  { key: 'home', name: 'Home Plateau', kind: 'main', h: 1, at: [24, 232] },
  { key: 'lowerFarm', name: 'Lower Farm', kind: 'natural', h: 0, at: [34, 176] },
  { key: 'goldenA', name: 'Golden Field A', kind: 'golden', h: 0, at: [92, 150] },
  { key: 'goldenB', name: 'Golden Field B', kind: 'golden', h: 0, at: [156, 206] },
  { key: 'butterA', name: 'Butter Meadow A', kind: 'butter', h: 0, at: [30, 96] },
  { key: 'butterB', name: 'Butter Meadow B', kind: 'butter', h: 0, at: [236, 246] },
  { key: 'genA', name: 'Generator Hill A', kind: 'generator', h: 1, at: [66, 206] },
  { key: 'genB', name: 'Generator Hill B', kind: 'generator', h: 1, at: [192, 228] },
  { key: 'creekA', name: 'Creek Bank A', kind: 'creek', h: 0, at: [50, 64] },
  { key: 'creekB', name: 'Creek Bank B', kind: 'creek', h: 0, at: [212, 222] },
  { key: 'wild1', name: 'Wild Edge 1', kind: 'wild', h: 0, at: [120, 244] },
  { key: 'wild2', name: 'Wild Edge 2', kind: 'wild', h: 0, at: [12, 150] },
  { key: 'wild3', name: 'Wild Edge 3', kind: 'wild', h: 0, at: [8, 118] },
  { key: 'wild4', name: 'Wild Edge 4', kind: 'wild', h: 0, at: [150, 250] },
  { key: 'wild5', name: 'Wild Edge 5', kind: 'wild', h: 0, at: [84, 124] },
];
const DAM = { key: 'dam', name: 'Mill Dam', kind: 'dam', h: 0, side: null };

// Features on side 0, painted and mirrored. [x, y, w, h] blocks or [x, y] points, per legend letter.
const FEATURES = [
  ['core', [18, 232]],
  ['workers', [[19, 232], [18, 233], [19, 233], [20, 234], [20, 232], [18, 234]]],
  ['S', [24, 226, 4, 2]], ['U', [14, 226]],
  ['S', [34, 170, 4, 4]],
  ['R', [86, 140, 6, 4]],
  ['R', [150, 200, 6, 4]],
  ['L', [26, 92]], ['L', [34, 100]], ['k', [30, 104]],
  ['L', [230, 240]], ['L', [240, 250]], ['k', [236, 236]],
  ['G', [60, 200]], ['G', [72, 210]],
  ['G', [186, 222]], ['G', [196, 232]],
  ['S', [44, 66, 4, 2]],
  ['S', [206, 214, 4, 2]],
  ['#', [106, 236, 3, 1]],
  ['#', [16, 140, 1, 3]],
  ['#', [125, 130]], ['#', [124, 131]], ['#', [123, 132]], // the Mill Dam's rock piles, south-west bank (mirrored)
];

/** The dam gap: four water tiles on the anti-diagonal through (128, 128). Symmetric, so two pairs. */
const DAM_GAP = [[126, 129], [127, 128], [128, 127], [129, 126]];

const mx = (x) => W - 1 - x;
const my = (y) => H - 1 - y;

// Monotone-chain convex hull of tile corners: the outline the play layer strokes around a Reach.
function hull(points) {
  const pts = [...new Map(points.map((p) => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Draw Wheatfield Valley: the base in the same shape drawV4 returns (see encodeV4), plus `extras`. */
export function drawWheatfield() {
  const tiles = Array.from({ length: H }, () => Array(W).fill('.'));
  const heights = Array.from({ length: H }, () => Array(W).fill(0));
  const rid0 = Array.from({ length: H }, () => Array(W).fill(0)); // Reach per tile before the gates

  // Reach ids: side 0 seeds 1..15, side 1 16..30, the Dam 31. Land is cut by nearest seed, on side 0 only, so the
  // result is exactly point-symmetric; side 1 copies side 0 through the mirror.
  const seedAt = SEEDS.map((s) => s.at);
  const nearest = (x, y) => {
    let best = 0, bd = Infinity;
    seedAt.forEach(([sx, sy], i) => {
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best + 1;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (inCreekXY(x, y)) tiles[y][x] = '~';
    if (inDamBox(x, y)) { rid0[y][x] = DAM_ID; continue; }
    if (inCreekXY(x, y)) continue;
    if (landBelow(x, y)) rid0[y][x] = nearest(x, y);
    else rid0[y][x] = nearest(mx(x), my(y)) + PER_SIDE;
  }
  // The creek and its crossings. Bridges and fords take their own strip, walkable; the lowered river stays water.
  for (const x0 of BRIDGE_X) for (let x = x0; x < x0 + STRIP; x++) for (let y = 0; y < H; y++) if (tiles[y][x] === '~' && inCreekXY(x, y)) tiles[y][x] = 'B';
  for (const x0 of FORD_X) for (let x = x0; x < x0 + STRIP; x++) for (let y = 0; y < H; y++) if (tiles[y][x] === '~' && inCreekXY(x, y)) tiles[y][x] = 'f';

  const reaches = [];
  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i];
    for (const side of [0, 1]) {
      reaches.push({ id: i + 1 + side * PER_SIDE, key: side ? `${s.key}@1` : s.key, name: s.name, kind: s.kind, side, h: s.h, gates: [] });
    }
  }
  reaches.push({ id: DAM_ID, key: DAM.key, name: DAM.name, kind: DAM.kind, side: null, h: 0, gates: [] });
  const byId = new Map(reaches.map((r) => [r.id, r]));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const id = rid0[y][x];
    if (id && byId.get(id).h) heights[y][x] = 1;
  }

  // Features, painted for side 0 and its mirror. A feature must land on open ground.
  const cores = [], workers = [[], []];
  // Paint a block on side 0 and, when mirrored, its point mirror. Only open ground takes a feature.
  const paint = (ch, x, y, w = 1, h = 1, mirrored = true) => {
    const put = (a, b) => {
      if (tiles[b][a] !== '.') throw new Error(`feature ${ch} at ${a},${b} is on ${tiles[b][a]}`);
      tiles[b][a] = ch;
    };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      put(x + i, y + j);
      if (mirrored) put(mx(x + i), my(y + j));
    }
  };
  // The mirror of a point is at (255 - x, 255 - y), so the side 0 coordinates given above are used as they are.
  for (const [what, v] of FEATURES) {
    if (what === 'core') { cores.push({ x: v[0], y: v[1] }, { x: mx(v[0]), y: my(v[1]) }); continue; }
    if (what === 'workers') { workers[0] = v.map(([x, y]) => ({ x, y })); workers[1] = v.map(([x, y]) => ({ x: mx(x), y: my(y) })); continue; }
    const [x, y, w = 1, h = 1] = v;
    paint(what, x, y, w, h);
  }
  // The Old Windmill: a single ruin on the north-east bank, near the dam.
  const ruin = { x: 134, y: 122 };
  paint('X', ruin.x, ruin.y, 1, 1, false);

  // Gates: a boundary between two Reaches is open ground both ways (a gate). Plateaus get one ramp each, to their
  // longest lowland neighbour; any other height step stays a cliff.
  const pairs = new Map();
  // Walkable ground for gates: everything but water, rock and crystal (crystals block units, as in env/map.mjs).
  const walk = (x, y) => !'~#SR'.includes(tiles[y][x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = rid0[y][x];
    if (!a || !walk(x, y)) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= W || ny >= H) continue;
      const b = rid0[ny][nx];
      if (!b || b === a || !walk(nx, ny)) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!pairs.has(key)) pairs.set(key, { a: Math.min(a, b), b: Math.max(a, b), tiles: [], across: 0 });
      const p = pairs.get(key);
      p.tiles.push([x, y], [nx, ny]);
      p.across += dx === 1 ? 1 : -1; // > 0: the boundary runs north-south, so the ramp runs east-west
    }
  }
  // Ramps are chosen on side 0 and copied to side 1 through the mirror, so a tie can never break the symmetry.
  const lowlandBorder = new Map(); // plateau id -> Map(neighbour id -> boundary length)
  for (const p of pairs.values()) {
    const ha = byId.get(p.a).h, hb = byId.get(p.b).h;
    if (ha === hb) continue;
    const plateau = ha ? p.a : p.b, low = ha ? p.b : p.a;
    if (!lowlandBorder.has(plateau)) lowlandBorder.set(plateau, new Map());
    lowlandBorder.get(plateau).set(low, (lowlandBorder.get(plateau).get(low) || 0) + p.tiles.length / 2);
  }
  const rampFor = new Map();
  for (const [plateau, m] of lowlandBorder) {
    let best = null;
    for (const [low, len] of m) if (!best || len > best.len || (len === best.len && low < best.low)) best = { low, len };
    rampFor.set(plateau, best.low);
  }
  for (const [plateau, low] of [...rampFor]) if (plateau <= PER_SIDE) rampFor.set(plateau + PER_SIDE, low + PER_SIDE);
  for (const [plateau, low] of [...rampFor]) if (plateau > PER_SIDE) rampFor.set(plateau - PER_SIDE, low - PER_SIDE);
  const cell = rid0.map((row) => row.slice()); // the Reach of each tile before any gate took it
  const gates = [];
  const sorted = [...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [, p] of sorted) {
    const ha = byId.get(p.a).h, hb = byId.get(p.b).h;
    const ramp = ha !== hb;
    if (ramp && !(rampFor.get(p.a) === p.b || rampFor.get(p.b) === p.a)) continue; // a cliff, not a gate
    const id = GATE_BASE + gates.length;
    const cells = [...new Map(p.tiles.map((t) => [t.join(','), t])).values()];
    for (const [x, y] of cells) {
      rid0[y][x] = id; // the gate tile now belongs to the gate
      heights[y][x] = 0;
      if (ramp && tiles[y][x] === '.') tiles[y][x] = p.across >= 0 ? '=' : '|';
    }
    const g = { id, a: p.a, b: p.b, type: ramp ? 'ramp' : 'floor', axis: p.across >= 0 ? 'ew' : 'ns', cells, center: null };
    g.center = [Math.round(cells.reduce((s, c) => s + c[0], 0) / cells.length), Math.round(cells.reduce((s, c) => s + c[1], 0) / cells.length)];
    gates.push(g);
    byId.get(p.a).gates.push(id);
    byId.get(p.b).gates.push(id);
  }
  // Crossings: each bridge and ford strip joins the Reach just above the creek to the one just below it.
  const crossing = (x0, ch) => {
    const xm = x0 + 1;
    const cells = [];
    for (let x = x0; x < x0 + STRIP; x++) for (let y = 0; y < H; y++) if (tiles[y][x] === ch) cells.push([x, y]);
    const ys = cells.filter(([x]) => x === xm).map(([, y]) => y);
    const top = Math.min(...ys) - 1, bottom = Math.max(...ys) + 1;
    const a = cell[bottom][xm], b = cell[top][xm];
    const id = GATE_BASE + gates.length;
    for (const [x, y] of cells) rid0[y][x] = id;
    const g = { id, a, b, type: 'floor', axis: 'ns', cells, center: [xm, Math.round((top + bottom) / 2)] };
    gates.push(g);
    byId.get(a).gates.push(id);
    byId.get(b).gates.push(id);
  };
  for (const x0 of BRIDGE_X) crossing(x0, 'B');
  for (const x0 of FORD_X) crossing(x0, 'f');

  // The Reach outlines, rects and centres, from the tiles each Reach kept (gates excluded).
  for (const r of reaches) {
    const own = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rid0[y][x] === r.id) own.push([x, y]);
    const pts = own.flatMap(([x, y]) => [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]);
    if (r.id === DAM_ID) for (const [x, y] of DAM_GAP) pts.push([x, y]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    r.rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - 1, Math.max(...ys) - 1];
    r.chamfer = 0;
    r.center = [Math.round(own.reduce((s, [x]) => s + x, 0) / own.length), Math.round(own.reduce((s, [, y]) => s + y, 0) / own.length)];
    r.outline = hull(pts);
  }

  const extras = {
    dam: {
      gap: DAM_GAP,
      rockSlots: [[125, 130], [124, 131], [123, 132], [130, 125], [131, 124], [132, 123]],
      lowered: loweredTiles(),
    },
    ruins: [[ruin.x, ruin.y]],
    crossings: { bridges: BRIDGE_X, fords: FORD_X },
  };
  reaches.sort((p, q) => p.id - q.id);
  return { tiles, heights, reachId: rid0, reaches, gates, spec: WHEATFIELD, cores, workers, extras };
}

// Creek tiles in the lowered stretch, as [x, y] pairs. Pure, from the same band test as the creek itself.
function loweredTiles() {
  const out = [];
  for (let x = LOWERED_X0; x < LOWERED_X0 + STRIP; x++) for (let y = 0; y < H; y++) if (inCreekXY(x, y)) out.push([x, y]);
  return out;
}

/** The water tiles as "x,y" keys. With the Mill Dam built the lowered stretch is no longer water (TERRITORY section 15). */
export function riverWhenDammed(map, built) {
  const water = new Set();
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.tiles[y][x] === '~') water.add(`${x},${y}`);
  if (built) for (const [x, y] of map.extras.dam.lowered) water.delete(`${x},${y}`);
  return water;
}
