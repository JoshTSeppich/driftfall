// The cord view (play/power-view.mjs): what the player sees of cord power. Owner: sonnet. Tests first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { step } from '../env/sim.mjs';
import { enablePower, POWER, stepPower } from '../env/power.mjs';
import { powerView, pentagon } from '../play/power-view.mjs';

function world(units) {
  const s = createTestState({
    width: 40, height: 40, shards: [100, 100],
    structures: [{ id: 1, owner: 0, kind: 'core', x: 5, y: 5 }, { id: 2, owner: 1, kind: 'core', x: 34, y: 34 }],
    units,
  });
  s.claims = [];
  enablePower(s);
  return s;
}

test('pentagon: five vertices on a circle of the given radius', () => {
  const v = pentagon(10, 10, 12);
  assert.equal(v.length, 5);
  for (const p of v) assert.ok(Math.abs(Math.hypot(p.x - 10, p.y - 10) - 12) < 1e-9);
});

test('a state without power gives an empty view', () => {
  const s = createTestState({ width: 10, height: 10, units: [{ id: 3, owner: 0, kind: 'worker', x: 2, y: 2 }] });
  assert.deepEqual(powerView(s, 0), { cords: [], glows: [], rings: [], sparks: [], dark: [] });
});

test('your plugged units get a faint cord to their anchor; selected or ordered ones are bright', () => {
  const s = world([
    { id: 10, owner: 0, kind: 'worker', x: 9, y: 5, hp: 40, order: null, carrying: 0 },
    { id: 11, owner: 0, kind: 'worker', x: 7, y: 7, hp: 40, order: { type: 'move', x: 8, y: 8 }, carrying: 0 },
    { id: 12, owner: 0, kind: 'worker', x: 6, y: 6, hp: 40, order: null, carrying: 0 },
  ]);
  stepPower(s);
  const v = powerView(s, 0, [12]);
  const byUnit = Object.fromEntries(v.cords.map((c) => [c.id, c]));
  assert.equal(byUnit[10].bright, false);
  assert.equal(byUnit[11].bright, true, 'a move order lights the cord');
  assert.equal(byUnit[12].bright, true, 'selection lights the cord');
  assert.equal(byUnit[10].x1, 5);
  assert.equal(byUnit[10].y1, 5, 'the cord runs to the Power Strip');
});

test('the Power Strip glows with its reach and whether it is lit', () => {
  const s = world([]);
  stepPower(s);
  const v = powerView(s, 0);
  assert.equal(v.glows.length, 1);
  assert.equal(v.glows[0].range, POWER.range.strip);
  assert.equal(v.glows[0].lit, true, 'the Strip network is always lit');
  assert.equal(powerView(s, 1).glows.length, 1, 'side 1 sees its own Strip');
});

test('the cord-limit ring shows on selection, at the unit cord length', () => {
  const s = world([{ id: 10, owner: 0, kind: 'worker', x: 9, y: 5, hp: 40, order: null, carrying: 0 }]);
  stepPower(s);
  const v = powerView(s, 0, [10]);
  assert.equal(v.rings.length, 1);
  assert.equal(v.rings[0].vertices.length, 5);
  const r = Math.hypot(v.rings[0].vertices[0].x - 9, v.rings[0].vertices[0].y - 5);
  assert.ok(Math.abs(r - POWER.cord.worker) < 1e-9);
  assert.equal(powerView(s, 0, []).rings.length, 0);
});

test('a cut shows sparks for a while, and the cut unit is listed as dark', () => {
  const s = world([
    { id: 10, owner: 0, kind: 'worker', x: 10, y: 5, hp: 40, order: null, carrying: 0 },
    { id: 11, owner: 1, kind: 'worker', x: 7, y: 5, hp: 40, order: null, carrying: 0 },
  ]);
  step(s, [[], []]);
  let v = powerView(s, 0);
  assert.equal(v.sparks.length, 1);
  assert.ok(v.sparks[0].age < 0.1, 'a fresh spark');
  assert.deepEqual(v.dark.map((d) => [d.id, d.state]), [[10, 'battery']]);
  assert.equal(v.cords.length, 0, 'a cut cord is not drawn');
  for (let i = 0; i < POWER.sparkTicks; i++) step(s, [[], []]);
  v = powerView(s, 0);
  assert.equal(v.sparks.length, 0, 'sparks fade out');
});
