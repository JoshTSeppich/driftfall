// findPathCached must give exactly the path findPath gives, on random mazes, goals, `within` and blocked starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../env/path.mjs';
import { createFieldCache, findPathCached } from '../env/path-field.mjs';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('cached field paths are identical to breadth-first paths', () => {
  const r = rng(7);
  let compared = 0;
  for (let round = 0; round < 40; round++) {
    const width = 8 + Math.floor(r() * 30);
    const height = 8 + Math.floor(r() * 30);
    const density = r() * 0.4;
    const solid = new Uint8Array(width * height);
    for (let i = 0; i < solid.length; i++) solid[i] = r() < density ? 1 : 0;
    const grid = { width, height, blocked: (x, y) => solid[y * width + x] === 1 };
    const cache = createFieldCache();
    for (let q = 0; q < 60; q++) {
      const from = { x: Math.floor(r() * width), y: Math.floor(r() * height) };
      const to = { x: Math.floor(r() * width), y: Math.floor(r() * height) };
      const within = Math.floor(r() * 4);
      const want = findPath(grid, from, to, { within });
      for (let rep = 0; rep < 3; rep++) { // the 2nd and 3rd ask go through the cached field
        const got = findPathCached(cache, solid, 0, grid, from, to, within);
        assert.deepEqual(got, want, `round ${round} q ${q} rep ${rep}`);
      }
      compared++;
    }
  }
  assert.ok(compared > 2000);
});

test('the cache forgets its fields when the map changes', () => {
  let solid = new Uint8Array(100); // callers hand over a fresh array each tick
  const grid = { width: 10, height: 10, blocked: (x, y) => solid[y * 10 + x] === 1 };
  const cache = createFieldCache();
  const a = findPathCached(cache, solid, 0, grid, { x: 0, y: 0 }, { x: 9, y: 0 }, 0);
  assert.equal(a.length, 9);
  solid = solid.slice();
  for (let y = 0; y < 9; y++) solid[y * 10 + 5] = 1; // wall with a gap at the bottom
  const b = findPathCached(cache, solid, 0, grid, { x: 0, y: 0 }, { x: 9, y: 0 }, 0);
  assert.deepEqual(b, findPath(grid, { x: 0, y: 0 }, { x: 9, y: 0 }));
  assert.ok(b.length > 9);
});
