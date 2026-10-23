// Movement order tests (ENV-SPEC section 6 and 8).
// Uses the real env modules. Nothing here is stubbed.
//
// Tick parity: "even tick" means the state.tick value before step() runs.
// So a state with tick 0 is an even tick: side 0 goes first and lowest ids move first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState, findEntity } from '../env/state.mjs';
import { step } from '../env/sim.mjs';
import { STATS } from '../env/stats.mjs';

const NO_COMMANDS = [[], []];

// A flat open room with optional rocks, no crystals, no structures.
function room({ width = 8, height = 8, rocks = [], units = [] }) {
  return createTestState({ width, height, rocks, crystals: [], shards: [100, 100], units, structures: [] });
}

function unit(id, kind, x, y, order = null, owner = 0) {
  return { id, owner, kind, x, y, hp: STATS.units[kind].hp, carrying: 0, order };
}

function at(state, id) {
  const e = findEntity(state, id);
  return e ? { x: e.x, y: e.y } : null;
}

function moveEvents(events) {
  return events.filter((ev) => ev.e === 'move');
}

function assertNoSharedTiles(state, label) {
  const seen = new Map();
  for (const u of state.units) {
    const key = `${u.x},${u.y}`;
    assert.ok(!seen.has(key), `${label}: units ${seen.get(key)} and ${u.id} share tile ${key}`);
    seen.set(key, u.id);
  }
}

test('on an even tick the lower id wins a contested tile, the other waits', () => {
  // Units 3 and 4 both want tile (2,1) as their next step, coming from opposite sides.
  const state = room({
    units: [
      unit(3, 'grunt', 2, 0, { type: 'move', x: 2, y: 2 }),
      unit(4, 'grunt', 2, 2, { type: 'move', x: 2, y: 0 }),
    ],
  });
  state.tick = 0;
  const events = step(state, NO_COMMANDS);
  assert.deepEqual(at(state, 3), { x: 2, y: 1 }, 'lower id 3 should take the contested tile');
  assert.deepEqual(at(state, 4), { x: 2, y: 2 }, 'higher id 4 should wait this tick');
  assert.deepEqual(moveEvents(events), [{ e: 'move', id: 3, x: 2, y: 1 }]);
});

test('on an odd tick the higher id wins the same contested tile', () => {
  const state = room({
    units: [
      unit(3, 'grunt', 2, 0, { type: 'move', x: 2, y: 2 }),
      unit(4, 'grunt', 2, 2, { type: 'move', x: 2, y: 0 }),
    ],
  });
  state.tick = 1;
  const events = step(state, NO_COMMANDS);
  assert.deepEqual(at(state, 4), { x: 2, y: 1 }, 'higher id 4 should take the tile on an odd tick');
  assert.deepEqual(at(state, 3), { x: 2, y: 0 }, 'lower id 3 should wait this tick');
  assert.deepEqual(moveEvents(events), [{ e: 'move', id: 4, x: 2, y: 1 }]);
});

test('a Brute moves only on even ticks; a Grunt moves every tick', () => {
  // A 12-wide room: the Grunt's target is 11 steps away, so it is still walking after the 8 ticks checked below.
  const state = room({
    width: 12,
    units: [
      unit(3, 'brute', 0, 0, { type: 'move', x: 6, y: 0 }),
      unit(4, 'grunt', 0, 4, { type: 'move', x: 11, y: 4 }),
    ],
  });
  assert.equal(STATS.units.brute.speed, 2, 'spec says a Brute has speed 2');
  state.tick = 0;

  const brutePositions = [];
  const gruntPositions = [];
  for (let t = 0; t < 8; t++) {
    assert.equal(state.tick, t);
    const before = at(state, 3);
    const gruntBefore = at(state, 4);
    step(state, NO_COMMANDS);
    const moved = at(state, 3).x !== before.x || at(state, 3).y !== before.y;
    const gruntMoved = at(state, 4).x !== gruntBefore.x || at(state, 4).y !== gruntBefore.y;
    brutePositions.push(moved);
    gruntPositions.push(gruntMoved);
  }
  // Ticks 0,2,4,6 are even: the Brute moves on the step that starts from them.
  assert.deepEqual(brutePositions, [true, false, true, false, true, false, true, false]);
  assert.deepEqual(gruntPositions, [true, true, true, true, true, true, true, true]);
  assert.deepEqual(at(state, 3), { x: 4, y: 0 }, 'Brute should have made 4 steps in 8 ticks');
});

test('a unit routes around a standing unit on the next tick', () => {
  // Unit 3 wants to go from (0,1) to (2,1). Unit 4 stands on (1,1) and is idle.
  // There is an equal-length detour through row 0 that avoids (1,1), so
  // the blocked unit should take the detour rather than wait forever.
  const state = room({
    width: 3,
    height: 3,
    units: [
      unit(3, 'grunt', 0, 1, { type: 'move', x: 2, y: 1 }),
      unit(4, 'grunt', 1, 1, null),
    ],
  });
  state.tick = 0;
  step(state, NO_COMMANDS);
  // Tick 0: the shortest path goes through the standing unit, so unit 3 waits.
  assert.deepEqual(at(state, 3), { x: 0, y: 1 }, 'first tick: the next tile is taken, so wait');

  // Tick 1: the path is recomputed around the standing unit.
  step(state, NO_COMMANDS);
  const after = at(state, 3);
  assert.notDeepEqual(after, { x: 0, y: 1 }, 'second tick: unit 3 should have routed around');
  assert.notDeepEqual(after, { x: 1, y: 1 }, 'unit 3 must never step onto the standing unit');
  assertNoSharedTiles(state, 'after routing around');
});

test('two units head-on in a one-tile gap both wait', () => {
  // A one-tile-wide corridor along row 1. Rocks on rows 0 and 2.
  const rocks = [];
  for (let x = 0; x < 8; x++) {
    rocks.push([x, 0], [x, 2]);
  }
  const state = room({
    width: 8,
    height: 3,
    rocks,
    units: [
      unit(3, 'grunt', 2, 1, { type: 'move', x: 5, y: 1 }),
      unit(4, 'grunt', 3, 1, { type: 'move', x: 0, y: 1 }),
    ],
  });
  for (let t = 0; t < 10; t++) {
    const events = step(state, NO_COMMANDS);
    assert.deepEqual(at(state, 3), { x: 2, y: 1 }, `tick ${state.tick}: unit 3 should still wait`);
    assert.deepEqual(at(state, 4), { x: 3, y: 1 }, `tick ${state.tick}: unit 4 should still wait`);
    assert.deepEqual(moveEvents(events), [], 'nobody should move in a head-on deadlock');
  }
});

test('a move order ends on arrival and the unit stops there', () => {
  const state = room({
    units: [unit(3, 'grunt', 0, 0, { type: 'move', x: 3, y: 0 })],
  });
  for (let i = 0; i < 3; i++) step(state, NO_COMMANDS);
  assert.deepEqual(at(state, 3), { x: 3, y: 0 });
  assert.equal(findEntity(state, 3).order, null, 'order should clear on arrival');

  const events = step(state, NO_COMMANDS);
  assert.deepEqual(at(state, 3), { x: 3, y: 0 }, 'arrived unit should not keep moving');
  assert.deepEqual(moveEvents(events), []);
  assert.equal(events.filter((ev) => ev.e === 'blocked').length, 0, 'arrival is not a blocked event');
});

test('an unreachable target clears the order and logs a blocked event', () => {
  // Tile (6,6) is open but walled in on all four sides, so nothing can reach it.
  const rocks = [
    [5, 6],
    [7, 6],
    [6, 5],
    [6, 7],
  ];
  const state = room({
    rocks,
    units: [unit(3, 'grunt', 0, 0, { type: 'move', x: 6, y: 6 })],
  });
  const events = step(state, NO_COMMANDS);
  assert.equal(findEntity(state, 3).order, null, 'order should be cleared');
  assert.deepEqual(at(state, 3), { x: 0, y: 0 }, 'unit should not move toward an unreachable target');
  const blocked = events.filter((ev) => ev.e === 'blocked');
  assert.deepEqual(blocked, [{ e: 'blocked', id: 3 }]);
});

test('no two units share a tile after any step, even in a crowd', () => {
  // Six units start in a 3x3 pocket and all want the same far corner.
  const state = room({
    width: 10,
    height: 10,
    units: [
      unit(3, 'grunt', 0, 0, { type: 'move', x: 8, y: 8 }),
      unit(4, 'lancer', 1, 0, { type: 'move', x: 8, y: 8 }),
      unit(5, 'worker', 0, 1, { type: 'move', x: 8, y: 8 }),
      unit(6, 'grunt', 1, 1, { type: 'move', x: 8, y: 8 }),
      unit(7, 'brute', 2, 0, { type: 'move', x: 8, y: 8 }),
      unit(8, 'grunt', 0, 2, { type: 'move', x: 8, y: 8 }),
    ],
  });
  assertNoSharedTiles(state, 'start');
  for (let t = 0; t < 40; t++) {
    step(state, NO_COMMANDS);
    assertNoSharedTiles(state, `tick ${state.tick}`);
  }
});
