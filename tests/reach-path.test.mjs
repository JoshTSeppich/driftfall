// Reach routing (env/reach-path.mjs) on the 128 x 128 map: same answers as the plain search, honours blockers,
// and 200 paths fit inside one 24 ticks-a-second budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../env/map.mjs';
import { findPath } from '../env/path.mjs';
import { createReachRouter, findPathVia } from '../env/reach-path.mjs';
import { makeRng } from '../env/rng.mjs';

const map = generateMap(7, { map: 'v4' });
const W = map.width, H = map.height;
const solid = new Uint8Array(W * H);
for (const [x, y] of map.rocks) solid[y * W + x] = 1;
for (const c of map.crystals) solid[c.y * W + c.x] = 1;
for (const r of map.rubble) solid[r.y * W + r.x] = 1;
const router = createReachRouter(map);
const gridWith = (extra = new Set()) => ({ width: W, height: H, blocked: (x, y) => solid[y * W + x] === 1 || extra.has(y * W + x) });
const open = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!solid[y * W + x] && map.reachGrid[y * W + x] > 0) open.push({ x, y });
const pick = (rng) => open[rng.int(open.length)];

function assertWalkable(grid, from, path, label) {
  let p = from;
  for (const s of path) {
    assert.equal(Math.abs(s.x - p.x) + Math.abs(s.y - p.y), 1, `${label}: one step`);
    assert.ok(!grid.blocked(s.x, s.y), `${label}: step on a blocked tile`);
    p = s;
  }
}

test('routes between random tiles: valid steps, and no longer than the plain search plus a small detour', () => {
  const rng = makeRng(11);
  const grid = gridWith();
  let extra = 0;
  for (let i = 0; i < 150; i++) {
    const a = pick(rng), b = pick(rng);
    const plain = findPath(grid, a, b), via = findPathVia(grid, router, a, b);
    assert.ok(plain && via, `a path exists ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    assertWalkable(grid, a, via, `trip ${i}`);
    assert.deepEqual(via.length ? via[via.length - 1] : a, b, 'ends on the target');
    assert.ok(via.length >= plain.length);
    extra += via.length - plain.length;
    assert.ok(via.length <= plain.length * 1.15 + 6, `trip ${i}: ${via.length} steps vs ${plain.length}`);
  }
  assert.ok(extra / 150 < 6, `average extra steps ${extra / 150}`);
});

test('within, already-there and unreachable behave like findPath', () => {
  const grid = gridWith();
  const a = map.cores[0], b = map.cores[1];
  assert.deepEqual(findPathVia(grid, router, a, a), []);
  const near = findPathVia(grid, router, a, b, { within: 3 });
  const last = near[near.length - 1];
  assert.ok(Math.max(Math.abs(last.x - b.x), Math.abs(last.y - b.y)) <= 3);
  assert.ok(near.length < findPath(grid, a, b).length + 1);
  const walled = new Set();
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) walled.add((b.y + dy) * W + b.x + dx);
  assert.equal(findPathVia(gridWith(walled), router, a, b), null);
});

test('honours dynamic blockers: a plugged gate sends units around, or falls back, never through', () => {
  const plug = new Set();
  for (const g of map.gates.filter((x) => x.a === 1 || x.b === 1)) for (const [x, y] of g.cells) plug.add(y * W + x); // seal Main
  const sealed = gridWith(plug);
  assert.equal(findPathVia(sealed, router, map.cores[0], map.cores[1]), null);
  // Plug one of the two Main gates only: the other still works and the route avoids the plug.
  const one = new Set(map.gates.find((g) => (g.a === 1 || g.b === 1) && g.axis === 'ew').cells.map(([x, y]) => y * W + x));
  const grid = gridWith(one);
  const path = findPathVia(grid, router, map.cores[0], map.cores[1]);
  assert.ok(path);
  assertWalkable(grid, map.cores[0], path, 'one gate plugged');
  assert.deepEqual(path[path.length - 1], map.cores[1]);
});

test('is deterministic: the same question gives the same path every time', () => {
  const a = open[100], b = open[open.length - 100];
  const first = JSON.stringify(findPathVia(gridWith(), router, a, b));
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(findPathVia(gridWith(), router, a, b)), first);
});

test('200 cross-map paths in one tick stay inside the 24 ticks a second budget (and beat the plain search)', () => {
  const rng = makeRng(3);
  const grid = gridWith();
  const trips = Array.from({ length: 200 }, () => [pick(rng), pick(rng)]);
  for (const [a, b] of trips.slice(0, 20)) findPathVia(grid, router, a, b); // warm up
  const time = (fn) => {
    const best = [];
    for (let rep = 0; rep < 5; rep++) {
      const t0 = performance.now();
      for (const [a, b] of trips) fn(a, b);
      best.push(performance.now() - t0);
    }
    return Math.min(...best);
  };
  const via = time((a, b) => findPathVia(grid, router, a, b));
  const plain = time((a, b) => findPath(grid, a, b));
  console.log(`200 paths: ${via.toFixed(1)} ms via Reaches, ${plain.toFixed(1)} ms plain`);
  assert.ok(via < 20, `200 paths took ${via.toFixed(1)} ms; the whole tick is 41.7 ms`);
  assert.ok(via < plain, 'the Reach router is faster than the plain search');
});
