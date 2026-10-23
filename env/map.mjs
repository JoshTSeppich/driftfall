import { makeRng } from './rng.mjs';
import { drawV4, encodeV4, decodeV4, scatterV4, territoryLayoutV4 } from '../maps/layout-v4.mjs';
import { loadMapSize, winCountFor } from '../maps/layout-sizes.mjs';

const SIZE = 32;
const PAIRS = 24;
const ATTEMPTS = 2000;
const AMOUNT = 400;
const KEEP_OUT = 2;

export function mirror(x, y) {
  return { x: SIZE - 1 - x, y: SIZE - 1 - y };
}

const SIDE0 = {
  core: { x: 3, y: 3 },
  workers: [{ x: 4, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 5 }],
  home: [{ x: 7, y: 2 }, { x: 8, y: 2 }, { x: 7, y: 3 }, { x: 8, y: 3 }],
  contested: [{ x: 12, y: 19 }, { x: 13, y: 19 }, { x: 12, y: 20 }, { x: 13, y: 20 }],
};

// True when every tile that is neither rock nor crystal can reach every other one (4-directional).
export function isConnected(map) {
  const w = map.width, h = map.height;
  const solid = new Uint8Array(w * h);
  for (const [x, y] of map.rocks) solid[y * w + x] = 1;
  for (const c of map.crystals) solid[c.y * w + c.x] = 1;
  let total = 0, start = -1;
  for (let i = 0; i < w * h; i++) if (!solid[i]) { total++; if (start < 0) start = i; }
  if (total === 0) return true;
  const seen = new Uint8Array(w * h);
  const stack = [start];
  seen[start] = 1;
  let count = 0;
  while (stack.length) {
    const i = stack.pop();
    count++;
    const x = i % w, y = (i / w) | 0;
    if (y > 0 && !solid[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
    if (x < w - 1 && !solid[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
    if (y < h - 1 && !solid[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    if (x > 0 && !solid[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
  }
  return count === total;
}

// Which map a match uses when the caller does not say. 'legacy' is the 32 x 32 map the live sim and stats are tuned
// for; 'v4' is the 128 x 128 territory map (maps/layout-v4.mjs). Flip DEFAULT_MAP when the sim plays v4 well.
// A page or script can still opt in with ?map=v4 (browser) or DRIFTFALL_MAP=v4 (node).
export const DEFAULT_MAP = 'legacy';

export function chosenMap() {
  const q = globalThis.location?.search ? new URLSearchParams(globalThis.location.search).get('map') : null;
  return q || globalThis.process?.env?.DRIFTFALL_MAP || DEFAULT_MAP;
}

// Map names a page or script may ask for: standard (128 x 128, 21 Reaches; 'v4' is the older name for it), large
// (192, 31 Reaches, watch mode's default) and huge (256, 41 Reaches). TERRITORY.md section 14.
export const MAP_SIZES = Object.freeze(['standard', 'large', 'huge']);
const sizeOf = (map) => (map === 'v4' ? 'standard' : map);
export const isTerritoryMap = (map) => MAP_SIZES.includes(sizeOf(map));

let v4Base = null;
/** The hand-drawn v4 map, decoded once (tiles as char rows, reachGrid as a Uint8Array). Same as maps/driftfall-v4.json. */
export function loadMapV4(size = 'standard') {
  const name = sizeOf(size);
  if (name !== 'standard') return loadMapSize(name);
  if (!v4Base) v4Base = { ...decodeV4(encodeV4(drawV4())), size: 'standard', winCount: winCountFor(21) };
  return v4Base;
}

/** The v4 Reaches in the shape env/territory.mjs buildReaches wants (ids 0..n-1; its grid id = reachGrid id - 1). */
export function reachLayoutV4(size = 'standard') {
  return territoryLayoutV4(loadMapV4(size));
}

/**
 * v4 in the shape the sim already reads (rocks, crystals, cores, workers) plus the new layers: heights, tiles,
 * ramps, vents, rubble, reaches, gates and reachGrid (Uint8Array, row-major, Reach id per tile, 0 = none).
 */
export function generateMapV4(seed, size = 'standard') {
  const m = scatterV4(loadMapV4(size), seed);
  const rocks = [], crystals = [], vents = [], rubble = [], ramps = [];
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const c = m.tiles[y][x];
    if (c === '#') rocks.push([x, y]);
    else if (c === 'S') crystals.push({ x, y, amount: AMOUNT });
    else if (c === 'R') crystals.push({ x, y, amount: AMOUNT * 2, rich: true });
    else if (c === 'L') vents.push({ x, y, amount: 600 });
    else if (c === 'o') rubble.push({ x, y, hp: 200 });
    else if (c === '=' || c === '|') ramps.push({ x, y, axis: c === '=' ? 'ew' : 'ns' });
  }
  return {
    version: 4, width: m.width, height: m.height, rocks, crystals, cores: m.cores, workers: m.workers,
    heights: m.heights, tiles: m.tiles, ramps, vents, rubble, reaches: m.reaches, gates: m.gates, reachGrid: m.reachGrid,
    scatter: m.scatter, size: m.size, gateBase: m.gateBase, reachCount: m.reaches.length, winCount: m.winCount,
  };
}

export function generateMap(seed, { map = chosenMap() } = {}) {
  if (isTerritoryMap(map)) return generateMapV4(seed, sizeOf(map));
  if (map !== 'legacy') throw new Error(`unknown map "${map}" (legacy, standard, large or huge)`);
  return generateLegacyMap(seed);
}

function generateLegacyMap(seed) {
  const m = (p) => mirror(p.x, p.y);
  const cores = [{ ...SIDE0.core }, m(SIDE0.core)];
  const workers = [SIDE0.workers.map((p) => ({ ...p })), SIDE0.workers.map(m)];
  const crystals = [
    ...SIDE0.home, ...SIDE0.contested, ...SIDE0.home.map(m), ...SIDE0.contested.map(m),
  ].map((p) => ({ x: p.x, y: p.y, amount: AMOUNT }));

  const keep = [...cores, ...workers[0], ...workers[1], ...crystals];
  const nearKeep = (x, y) => keep.some((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= KEEP_OUT);

  const map = { width: SIZE, height: SIZE, rocks: [], crystals, cores, workers };
  const taken = new Set(crystals.map((c) => c.y * SIZE + c.x));
  const rng = makeRng(seed);
  let pairs = 0;
  for (let attempt = 0; attempt < ATTEMPTS && pairs < PAIRS; attempt++) {
    const x = rng.int(SIZE), y = rng.int(SIZE);
    const o = mirror(x, y);
    if (taken.has(y * SIZE + x) || taken.has(o.y * SIZE + o.x)) continue;
    if (nearKeep(x, y) || nearKeep(o.x, o.y)) continue;
    map.rocks.push([x, y], [o.x, o.y]);
    if (!isConnected(map)) { map.rocks.length -= 2; continue; }
    taken.add(y * SIZE + x);
    taken.add(o.y * SIZE + o.x);
    pairs++;
  }
  return map;
}
