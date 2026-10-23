// Wrapped cords inside the power rules (state.power.wrap). Owner: sonnet. A cliff makes the far side cost more reach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { step } from '../env/sim.mjs';
import { enablePower } from '../env/power.mjs';

const NONE = [[], []];
// A cliff wall x 10..12, y 0..10 (the map edge closes the top), a Strip at (5,5), a Crumb with cord 12.
const cliffs = [];
for (let x = 10; x <= 12; x++) for (let y = 0; y <= 10; y++) cliffs.push([x, y]);
function world(wrap) {
  const state = createTestState({
    width: 40, height: 40, rocks: cliffs,
    structures: [{ id: 1, owner: 0, kind: 'core', x: 5, y: 5 }, { id: 2, owner: 1, kind: 'core', x: 34, y: 34 }],
    units: [{ id: 10, owner: 0, kind: 'worker', x: 6, y: 5, hp: 40, order: { type: 'move', x: 14, y: 5 }, carrying: 0 }],
  });
  enablePower(state);
  state.power.wrap = wrap;
  return state;
}
const run = (state, n) => { for (let i = 0; i < n; i++) step(state, NONE); return state.units[0]; };

test('without wrap the straight line ignores the cliff (old rule)', () => {
  const u = run(world(false), 60);
  assert.deepEqual([u.x, u.y], [14, 5]);
});

test('with wrap the long way round the cliff uses up the cord and the Crumb stops short', () => {
  const s = world(true);
  const u = run(s, 80);
  assert.ok(u.x < 14 || u.y > 11, 'it could not get to the far side with the cord it has');
  assert.ok(u.power.state === 'plugged', 'stopped by the leash, not unplugged');
});

test('the same walk is deterministic', () => {
  const a = world(true), b = world(true);
  run(a, 50); run(b, 50);
  assert.deepEqual(a.units[0].power.cord, b.units[0].power.cord);
  assert.deepEqual([a.units[0].x, a.units[0].y], [b.units[0].x, b.units[0].y]);
});
