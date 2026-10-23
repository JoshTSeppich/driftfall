// Fences: live ground lines wall off enemy ground units (POWER-NETWORK.md step 2). Owner: sonnet. Tests first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { enablePower, lineKey } from '../env/power.mjs';
import { enableFences, fenceBlocks, fenceTiles } from '../env/fence.mjs';
import { stepMovement } from '../env/movement.mjs';

const pt = (id, owner, kind, x, y) => ({ id, owner, kind, x, y, range: 0 });
const unitAt = (id, owner, kind, x, y, order = null) => ({ id, owner, kind, x, y, hp: 40, order, carrying: 0 });

// Side 0's Strip at (10,10); a box at (10,16) makes a wall x=10, y 10..16. Side 1's Strip is far away.
function world({ points = [pt(20, 0, 'extension', 10, 16)], units = [], rocks = [], fences = true } = {}) {
  const state = createTestState({
    width: 40, height: 40, rocks, units,
    structures: [{ id: 1, owner: 0, kind: 'core', x: 10, y: 10 }, { id: 2, owner: 1, kind: 'core', x: 35, y: 35 }],
  });
  enablePower(state);
  state.power.points.push(...points);
  if (fences) {
    enableFences(state);
    for (const p of points) state.power.fenceLinks.add(lineKey(1, p.id)); // the order: wall every link to the Strip
  }
  return state;
}
// ticks x4 because unit speeds are being retuned by the roster work; tests only care where units end up.
const walk = (state, id, ticks) => {
  const u = state.units.find((q) => q.id === id);
  const seen = [];
  for (let i = 0; i < ticks * 4; i++) { state.tick += 1; stepMovement(state); seen.push(`${u.x},${u.y}`); }
  return { u, seen };
};

test('an enemy walks around a live ground line, never through it', () => {
  const s = world({ units: [unitAt(5, 1, 'grunt', 8, 13, { type: 'move', x: 12, y: 13 })] });
  const { u, seen } = walk(s, 5, 40);
  assert.deepEqual([u.x, u.y], [12, 13], 'it arrives by the long way');
  const wall = fenceTiles(s).tiles[0];
  assert.ok(wall.has('10,13'));
  assert.ok(seen.every((p) => !wall.has(p)), 'no step ever lands on the wire');
  assert.ok(seen.some((p) => Number(p.split(',')[1]) > 16 || Number(p.split(',')[1]) < 10), 'it went round an end');
});

test('your own units and air units cross your own line', () => {
  const s = world({ units: [unitAt(5, 0, 'grunt', 8, 13, { type: 'move', x: 12, y: 13 }), unitAt(6, 1, 'bagel', 8, 14, { type: 'move', x: 12, y: 14 })] });
  walk(s, 5, 6);
  assert.deepEqual([s.units[0].x, s.units[0].y], [12, 13], 'straight across in 4 steps');
  assert.equal(fenceBlocks(s, s.units[0], 10, 13), false);
  assert.equal(fenceBlocks(s, s.units[1], 10, 14), false, 'a Bagel flies over');
  assert.equal(fenceBlocks(s, { owner: 1, kind: 'grunt' }, 10, 13), true);
});

test('a line with nowhere to go round blocks the order (walled off)', () => {
  const s = world({ units: [unitAt(5, 1, 'grunt', 9, 13, { type: 'move', x: 11, y: 13 })], rocks: [[9, 9], [9, 10], [9, 11], [9, 12], [9, 14], [9, 15], [9, 16], [9, 17], [9, 18]] });
  const events = [];
  for (let i = 0; i < 4; i++) { s.tick += 1; stepMovement(s); events.push(...s.events); }
  assert.ok(s.units[0].x <= 9, 'it never crosses');
});

test('brown-out drops the wall: a dark network is passable', () => {
  const s = world({ points: [pt(20, 0, 'extension', 10, 16)], units: [unitAt(5, 1, 'grunt', 8, 13, { type: 'move', x: 12, y: 13 })] });
  s.structures[0].hp = 0; // the Strip dies: no energy anywhere on side 0
  assert.equal(fenceTiles(s).tiles[0].size, 0);
  const { u } = walk(s, 5, 6);
  assert.deepEqual([u.x, u.y], [12, 13], 'straight through, no detour');
});

test('a power link that was never ordered as a fence blocks nobody', () => {
  const s = world({ units: [unitAt(5, 1, 'grunt', 8, 13, { type: 'move', x: 12, y: 13 })] });
  s.power.fenceLinks.clear();
  assert.equal(fenceTiles(s).tiles[0].size, 0);
  const { u } = walk(s, 5, 6);
  assert.deepEqual([u.x, u.y], [12, 13]);
});

test('fences are off by default and cost nothing', () => {
  const s = world({ fences: false, units: [unitAt(5, 1, 'grunt', 8, 13, { type: 'move', x: 12, y: 13 })] });
  const { u } = walk(s, 5, 4);
  assert.deepEqual([u.x, u.y], [12, 13]);
});

test('a line lit later repaths a walking unit on its next step', () => {
  const s = world({ points: [], units: [unitAt(5, 1, 'grunt', 8, 13, { type: 'move', x: 12, y: 13 })] });
  walk(s, 5, 1);
  s.power.points.push(pt(20, 0, 'extension', 10, 16));
  s.power.fenceLinks.add(lineKey(1, 20));
  const { seen } = walk(s, 5, 30);
  const wall = fenceTiles(s).tiles[0];
  assert.ok(seen.every((p) => !wall.has(p)));
  assert.equal(seen.at(-1), '12,13');
});
