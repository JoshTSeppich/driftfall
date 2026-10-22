import { makeRng } from './rng.mjs';

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

export function generateMap(seed) {
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
