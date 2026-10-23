// Wrapped cords inside the power rules (state.power.wrap). Owner: sonnet. A cliff makes the far side cost more reach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { step } from '../env/sim.mjs';
import { enablePower, lineKey, supercover } from '../env/power.mjs';
import { enableFences } from '../env/fence.mjs';

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

// An enemy fence is a wall for the cord too (cord-wrap.mjs: blocked(x, y) covers rocks, cliffs, water AND enemy walls).
// Side 1 walls x=12 from its Core at (12,12) to its extension at (12,18), a live fence. Our Crumb walks round the end.
const WALL = new Set();
for (let y = 12; y <= 18; y++) WALL.add(`12,${y}`);
function enemyWall(wrap) {
  const state = createTestState({
    width: 40, height: 40, rocks: [],
    structures: [{ id: 1, owner: 0, kind: 'core', x: 5, y: 5 }, { id: 2, owner: 1, kind: 'core', x: 34, y: 34 }, { id: 3, owner: 1, kind: 'core', x: 12, y: 12 }],
    units: [{ id: 10, owner: 0, kind: 'worker', x: 6, y: 5, hp: 40, order: { type: 'move', x: 14, y: 22 }, carrying: 0 }],
  });
  enablePower(state);
  state.power.wrap = wrap;
  state.power.points.push({ id: 21, owner: 1, kind: 'extension', x: 12, y: 18, range: 0 });
  enableFences(state);
  state.power.fenceLinks.add(lineKey(3, 21));
  return state;
}
// does the cord's last leg, from its last bend (or the anchor) to the unit, pass through a wall tile?
const legCrossesWall = (u) => {
  const pts = u.power.cord.pts;
  const last = pts[pts.length - 1];
  return supercover(last, { x: u.x, y: u.y }).slice(1, -1).some(([x, y]) => WALL.has(`${x},${y}`));
};

test('an enemy fence blocks the cord: no tick leaves the cord running straight through an enemy wall', () => {
  const state = enemyWall(true);
  let crossed = false;
  for (let i = 0; i < 160; i++) {
    step(state, NONE);
    const u = state.units[0];
    if (u.power && u.power.cord && u.power.state === 'plugged' && legCrossesWall(u)) crossed = true;
  }
  assert.equal(crossed, false, 'the cord crossed an enemy wall');
});
