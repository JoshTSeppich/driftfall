// Driftfall v4 map (128 x 128, 21 Reaches), owned by sonnet (TERRITORY.md section 2).
// Hand-drawn at the Reach level: ten Reaches are listed for side 0, the point mirror (x, y) -> (127 - x, 127 - y)
// makes side 1, and the neutral Centre sits on the mirror point. The seed only scatters rocks and rubble inside
// Reaches (see scatterV4); the drawn base has none.
//
// This file is pure (no fs, no clock) so env/map.mjs can import it in node and in the browser.
// `node maps/build-v4.mjs` prints the map and writes maps/driftfall-v4.json.
//
// Legend: # rock  . floor  = ramp east-west  | ramp north-south  S shard (400)  R rich shard (800)  L Flux vent
//         o rubble (scatter only)
// Reach ids: 1..10 side 0 (Main, Natural, Vent A, Vent B, Flank, Mesa, Pocket, Rich, Outer A, Outer B),
// 11..20 the same for side 1 (id + 10), 21 the Centre. Gate tiles carry id GATE_BASE + gate index.
import { makeRng } from '../env/rng.mjs';

export const W = 128;
export const H = 128;
export const GATE_BASE = 32;
export const CENTRE_ID = 21;

const mx = (x) => W - 1 - x;
const my = (y) => H - 1 - y;

// Side 0 Reaches. rect = [x0, y0, x1, y1] inclusive; chamfer rounds the corners; h = height (1 = plateau).
const SIDE0 = [
  { key: 'main',    name: 'Main',    kind: 'main',    rect: [2, 2, 25, 25],     h: 1, chamfer: 4 },
  { key: 'natural', name: 'Natural', kind: 'natural', rect: [2, 30, 25, 53],    h: 0, chamfer: 3 },
  { key: 'ventA',   name: 'Vent A',  kind: 'vent',    rect: [30, 2, 53, 25],    h: 0, chamfer: 3 },
  { key: 'ventB',   name: 'Vent B',  kind: 'vent',    rect: [30, 34, 49, 57],   h: 0, chamfer: 3 },
  { key: 'flank',   name: 'Flank',   kind: 'flank',   rect: [58, 2, 83, 25],    h: 0, chamfer: 3 },
  { key: 'mesa',    name: 'Mesa',    kind: 'mesa',    rect: [58, 30, 83, 47],   h: 1, chamfer: 3 },
  { key: 'pocket',  name: 'Pocket',  kind: 'pocket',  rect: [88, 2, 107, 19],   h: 0, chamfer: 3 },
  { key: 'rich',    name: 'Rich',    kind: 'rich',    rect: [88, 24, 107, 41],  h: 0, chamfer: 3 },
  { key: 'outerA',  name: 'Outer A', kind: 'outer',   rect: [112, 2, 125, 45],  h: 0, chamfer: 3 },
  { key: 'outerB',  name: 'Outer B', kind: 'outer',   rect: [2, 60, 41, 79],    h: 0, chamfer: 3 },
];
const CENTRE = { key: 'centre', name: 'Centre', kind: 'centre', rect: [54, 52, 73, 75], h: 0, chamfer: 2 };

// Gates, side 0 and the cross-map links: [a, b, centre line, type]. A ref is 'key' (side 0), 'key@1' (side 1) or
// 'centre'. A gate is 3 tiles wide and crosses the rock between two Reaches (centre line = row for an east-west
// gate, column for a north-south one); a ramp joins a plateau (Main, Mesa) to lowland. Main has two ramps so a
// Quake can close one. Every gate is also drawn mirrored (refs swap sides, line -> 127 - line).
const GATES0 = [
  ['main', 'ventA', 12, 'ramp'], ['main', 'natural', 12, 'ramp'],
  ['natural', 'ventB', 44, 'floor'], ['natural', 'outerB', 12, 'floor'],
  ['ventA', 'ventB', 40, 'floor'], ['ventA', 'flank', 12, 'floor'],
  ['flank', 'mesa', 70, 'ramp'], ['flank', 'pocket', 10, 'floor'],
  ['pocket', 'rich', 98, 'floor'], ['pocket', 'outerA', 10, 'floor'],
  ['rich', 'outerA', 32, 'floor'], ['rich', 'mesa', 35, 'ramp'],
  ['ventB', 'centre', 54, 'floor'], ['mesa', 'centre', 65, 'ramp'],
  ['outerB', 'centre', 66, 'floor'],
];
// Outer A of side 0 meets Outer B of side 1 across the right edge; its mirror is the left-edge link.
const CROSS = [['outerA', 'outerB@1', 118, 'floor']];

// Features per Reach (side 0; the mirror is painted automatically). [x, y, w, h] blocks or [x, y] points.
const FEATURES = {
  main:    { core: [7, 7], workers: [[8, 7], [7, 8], [8, 8], [9, 9], [9, 7], [7, 9]], S: [[13, 5, 4, 2]] },
  natural: { S: [[12, 46, 4, 2]], L: [[22, 48]] },
  ventA:   { L: [[36, 6], [48, 20]] },
  ventB:   { L: [[34, 52], [46, 40]] },
  flank:   { S: [[66, 10, 4, 2]] },
  mesa:    { R: [[69, 36, 2, 2]], L: [[62, 44], [79, 34]] },
  pocket:  { S: [[94, 8, 4, 2]], L: [[104, 14]] },
  rich:    { R: [[94, 30, 4, 2]] },
  outerA:  { S: [[118, 10, 4, 2]] },
  outerB:  { S: [[10, 66, 4, 2]], L: [[40, 72]] },
  centre:  { R: [[62, 62, 4, 4]], L: [[58, 57]] },
};

function reachList(spec) {
  const { w, h, side0, centre } = spec;
  const n = side0.length;
  const list = [];
  side0.forEach((r, i) => list.push({ ...r, id: i + 1, side: 0 }));
  side0.forEach((r, i) => {
    const [x0, y0, x1, y1] = r.rect;
    list.push({ ...r, id: i + 1 + n, side: 1, rect: [w - 1 - x1, h - 1 - y1, w - 1 - x0, h - 1 - y0] });
  });
  list.push({ ...centre, id: 2 * n + 1, side: null });
  return list;
}

/**
 * A map spec: size, gate id base, digits per Reach id in the file, the side-0 Reaches, the Centre, the gate list, the
 * cross-map links and the features. This is the 128 x 128 Standard map; maps/layout-sizes.mjs adds Large and Huge.
 */
export const STANDARD = {
  name: 'standard', w: W, h: H, gateBase: GATE_BASE, idDigits: 1,
  side0: SIDE0, centre: CENTRE, gates0: GATES0, cross: CROSS, features: FEATURES,
};

// A rect with its corners cut: a tile is in when it is at least `chamfer - 1` steps from the nearest corner.
const inShape = (r, x, y) => {
  const [x0, y0, x1, y1] = r.rect;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.min(x - x0, x1 - x), dy = Math.min(y - y0, y1 - y);
  return dx + dy >= r.chamfer - 1 || dx >= r.chamfer || dy >= r.chamfer;
};

/** Draw the hand-made base: tiles (chars), heights, reach ids, the Reach list and the gate list. */
export function drawV4(spec = STANDARD) {
  const { w: W, h: H, gateBase: GATE_BASE } = spec;
  const mx = (x) => W - 1 - x, my = (y) => H - 1 - y;
  const CENTRE_ID = spec.side0.length * 2 + 1;
  const tiles = Array.from({ length: H }, () => Array(W).fill('#'));
  const heights = Array.from({ length: H }, () => Array(W).fill(0));
  const reachId = Array.from({ length: H }, () => Array(W).fill(0));
  const reaches = reachList(spec);
  const ref = (s) => {
    if (s === 'centre') return reaches.find((r) => r.id === CENTRE_ID);
    const [key, side = '0'] = s.split('@');
    return reaches.find((r) => r.key === key && r.side === Number(side));
  };
  const flip = (s) => (s === 'centre' ? s : s.includes('@') ? s.split('@')[0] : `${s}@1`);

  for (const r of reaches) {
    const [x0, y0, x1, y1] = r.rect;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!inShape(r, x, y)) continue;
      tiles[y][x] = '.';
      heights[y][x] = r.h;
      reachId[y][x] = r.id;
    }
    r.center = [Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2)];
    r.gates = [];
  }

  const gates = [];
  const isHorizontal = (a, b) => a.rect[2] < b.rect[0] || b.rect[2] < a.rect[0];
  const addGate = (sa, sb, line, type) => {
    const a = ref(sa), b = ref(sb);
    const horizontal = isHorizontal(a, b);
    const g = { id: GATE_BASE + gates.length, a: a.id, b: b.id, type, axis: horizontal ? 'ew' : 'ns', cells: [] };
    const lo = (horizontal ? Math.min(a.rect[2], b.rect[2]) : Math.min(a.rect[3], b.rect[3])) + 1;
    const hi = (horizontal ? Math.max(a.rect[0], b.rect[0]) : Math.max(a.rect[1], b.rect[1])) - 1;
    for (let k = -1; k <= 1; k++) for (let t = lo; t <= hi; t++) g.cells.push(horizontal ? [t, line + k] : [line + k, t]);
    for (const [x, y] of g.cells) {
      tiles[y][x] = type === 'ramp' ? (horizontal ? '=' : '|') : '.';
      heights[y][x] = 0;
      reachId[y][x] = g.id;
    }
    g.center = horizontal ? [Math.floor((lo + hi) / 2), line] : [line, Math.floor((lo + hi) / 2)];
    gates.push(g);
    a.gates.push(g.id);
    b.gates.push(g.id);
  };
  for (const [a, b, line, type] of spec.gates0) {
    addGate(a, b, line, type);
    addGate(flip(a), flip(b), isHorizontal(ref(a), ref(b)) ? my(line) : mx(line), type);
  }
  for (const [a, b, line, type] of spec.cross) {
    addGate(a, b, line, type);
    addGate(flip(a), flip(b), mx(line), type);
  }

  // Features, painted for side 0 and mirrored.
  const out = { cores: [], workers: [[], []] };
  for (const [key, f] of Object.entries(spec.features)) {
    for (const mirror of [false, true]) {
      const X = (x, w = 1) => (mirror ? mx(x + w - 1) : x);
      const Y = (y, h = 1) => (mirror ? my(y + h - 1) : y);
      for (const ch of ['S', 'R']) for (const [x, y, w, h] of f[ch] || []) {
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tiles[Y(y, h) + j][X(x, w) + i] = ch;
      }
      for (const [x, y] of f.L || []) tiles[Y(y)][X(x)] = 'L';
      if (f.core) out.cores.push({ x: X(f.core[0]), y: Y(f.core[1]) });
      if (f.workers) out.workers[mirror ? 1 : 0] = f.workers.map(([x, y]) => ({ x: X(x), y: Y(y) }));
    }
  }
  return { tiles, heights, reachId, reaches, gates, spec, ...out };
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/';

/** Compact JSON form (what maps/driftfall-v4.json holds): char rows for tiles, heights and ids. */
export function encodeV4(base) {
  const { w: W, h: H, gateBase, idDigits, name } = base.spec || STANDARD;
  const idText = (v) => (idDigits === 2 ? DIGITS[v >> 6] + DIGITS[v & 63] : DIGITS[v]);
  return {
    format: 'driftfall-map', version: 4, width: W, height: H,
    // Only the bigger maps say so; the Standard file keeps its original shape.
    ...(name && name !== 'standard' ? { size: name, gateBase, idDigits } : {}),
    legend: { '#': 'rock', '.': 'floor', '=': 'ramp east-west', '|': 'ramp north-south', S: 'shard 400', R: 'rich shard 800', L: 'vent 600', o: 'rubble 200 hp' },
    ids: 'reachIds: one base-64 digit per tile; 0 none, 1..21 Reach id, 32 + n = gate n',
    tiles: base.tiles.map((r) => r.join('')),
    heights: base.heights.map((r) => r.join('')),
    reachIds: base.reachId.map((r) => r.map(idText).join('')),
    reaches: base.reaches.map(({ id, key, name, kind, side, rect, h, chamfer, center, gates, outline }) => ({ id, key, name, kind, side, rect, height: h, chamfer, center, gates, ...(outline ? { outline } : {}) })),
    gates: base.gates.map(({ id, a, b, type, axis, center, cells }) => ({ id, a, b, type, axis, center, cells })),
    cores: base.cores, workers: base.workers,
    ...(base.extras ? { extras: base.extras } : {}),
  };
}

/** Decode a v4 JSON (or encodeV4 output): tiles become char arrays, reachGrid a Uint8Array of W * H ids. */
export function decodeV4(json) {
  const w = json.width, h = json.height;
  const reachGrid = new Uint8Array(w * h);
  const heights = [];
  const tiles = [];
  const two = json.idDigits === 2;
  for (let y = 0; y < h; y++) {
    heights.push([...json.heights[y]].map(Number));
    tiles.push([...json.tiles[y]]);
    const row = json.reachIds[y];
    for (let x = 0; x < w; x++) {
      reachGrid[y * w + x] = two ? DIGITS.indexOf(row[2 * x]) * 64 + DIGITS.indexOf(row[2 * x + 1]) : DIGITS.indexOf(row[x]);
    }
  }
  // Facts the other modules read: the first gate id, the Centre's id and the Reaches on each side.
  const perSide = (json.reaches.length - 1) / 2;
  return { ...json, tiles, heights, reachGrid, gateBase: json.gateBase ?? GATE_BASE, perSide, centreId: 2 * perSide + 1 };
}

/**
 * The Reach list in the shape env/territory.mjs buildReaches reads: ids 0..20 (= reachGrid id - 1), role, side,
 * mirror (the other side's id), centre, claimSpot (open tile nearest the centre) and an octagon outline in tile
 * coordinates (corners cut like the drawn shape; edges on tile boundaries, so a tile belongs when its centre is in).
 */
export function territoryLayoutV4(decoded) {
  const w = decoded.width;
  const open = (x, y) => x >= 0 && y >= 0 && x < w && y < decoded.height && decoded.tiles[y][x] === '.';
  const reaches = decoded.reaches.map((r) => {
    const [x0, y0, x1, y1] = r.rect;
    const X1 = x1 + 1, Y1 = y1 + 1, cut = (r.chamfer ?? 3) - 0.5;
    // A Reach may bring its own outline (Wheatfield's organic cells); the others get the cut rectangle.
    const outline = r.outline ?? [[x0 + cut, y0], [X1 - cut, y0], [X1, y0 + cut], [X1, Y1 - cut], [X1 - cut, Y1], [x0 + cut, Y1], [x0, Y1 - cut], [x0, y0 + cut]];
    let claimSpot = { x: r.center[0], y: r.center[1] };
    search: for (let d = 0; d < 30; d++) {
      for (let j = -d; j <= d; j++) for (let i = -d; i <= d; i++) {
        const x = r.center[0] + i, y = r.center[1] + j;
        if (Math.max(Math.abs(i), Math.abs(j)) === d && open(x, y) && decoded.reachGrid[y * w + x] === r.id) {
          claimSpot = { x, y };
          break search;
        }
      }
    }
    const n = decoded.perSide;
    const mirror = r.id === decoded.centreId ? r.id : r.id <= n ? r.id + n : r.id - n;
    const name = r.side === null ? r.name : `${r.name} ${r.side === 0 ? 'N' : 'S'}`;
    return { id: r.id - 1, name, role: r.kind, side: r.side, mirror: mirror - 1, centre: { x: r.center[0], y: r.center[1] }, claimSpot, outline };
  });
  return { width: decoded.width, height: decoded.height, reaches };
}

const solidChar = (c) => c === '#' || c === 'o' || c === 'S' || c === 'R' || c === '~';

/**
 * Seeded scatter: rocks and rubble in small mirrored blobs inside Reaches, away from fields, vents, cores, workers
 * and gates, never cutting any open tile off from the rest. Returns a new decoded map with `tiles` changed.
 */
export function scatterV4(decoded, seed, { density = 0.025 } = {}) {
  const w = decoded.width, h = decoded.height;
  const GATE_BASE = decoded.gateBase ?? 32;
  const mx = (x) => w - 1 - x, my = (y) => h - 1 - y;
  const tiles = decoded.tiles.map((r) => r.slice());
  const grid = decoded.reachGrid;
  const keep = new Uint8Array(w * h);
  const mark = (x, y, r) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const a = x + i, b = y + j;
      if (a >= 0 && b >= 0 && a < w && b < h) keep[b * w + a] = 1;
    }
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = tiles[y][x];
    if (c !== '.' && c !== '#') mark(x, y, 3);
    if (grid[y * w + x] >= GATE_BASE) mark(x, y, 3);
  }
  for (const c of decoded.cores) mark(c.x, c.y, 5);
  for (const side of decoded.workers) for (const p of side) mark(p.x, p.y, 2);

  const open = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !solidChar(tiles[y][x]);
  const connected = () => {
    let start = -1, total = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (open(x, y)) { total++; if (start < 0) start = y * w + x; }
    const seen = new Uint8Array(w * h);
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    while (stack.length) {
      const i = stack.pop();
      count++;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const a = x + dx, b = y + dy;
        if (!open(a, b) || seen[b * w + a]) continue;
        seen[b * w + a] = 1;
        stack.push(b * w + a);
      }
    }
    return count === total;
  };

  const floors = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = grid[y * w + x];
    if (id > 0 && id < GATE_BASE && tiles[y][x] === '.' && !keep[y * w + x]) floors.push([x, y]);
  }
  const rng = makeRng(seed ^ 0x5eed);
  const blobs = Math.floor(floors.length * density / 2);
  const result = { rocks: 0, rubble: 0 };
  for (let n = 0, tries = 0; n < blobs && tries < blobs * 8; tries++) {
    const [sx, sy] = floors[rng.int(floors.length)];
    const ch = rng.int(10) < 3 ? 'o' : '#';
    const cells = [[sx, sy]];
    for (let k = 1, size = 1 + rng.int(3); k < size; k++) {
      const [px, py] = cells[cells.length - 1];
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rng.int(4)];
      cells.push([px + dx, py + dy]);
    }
    const all = new Map();
    let ok = true;
    for (const [x, y] of cells) {
      for (const [a, b] of [[x, y], [mx(x), my(y)]]) {
        if (a < 0 || b < 0 || a >= w || b >= h) { ok = false; continue; }
        const id = grid[b * w + a];
        if (tiles[b][a] !== '.' || keep[b * w + a] || id === 0 || id >= GATE_BASE) ok = false;
        all.set(b * w + a, [a, b]);
      }
    }
    // A blob that meets its own mirror (near the centre point) would break the point symmetry: skip it.
    if (!ok || all.size !== cells.length * 2) continue;
    for (const [a, b] of all.values()) tiles[b][a] = ch;
    if (!connected()) { for (const [a, b] of all.values()) tiles[b][a] = '.'; continue; }
    n++;
    result[ch === '#' ? 'rocks' : 'rubble'] += all.size;
  }
  return { ...decoded, tiles, scatter: result };
}
