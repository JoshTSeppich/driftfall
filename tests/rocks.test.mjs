// Movable rocks (TERRITORY.md section 15): a ground unit pushes a rock one tile, a Crumb (worker) hauls it along a
// straight line, a rock pushed into water makes a ford, and a line of three fords makes a dam.
// Owner: haiku. Real modules, nothing stubbed. Tests first: env/rocks.mjs is written to pass these.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState, isPassable } from '../env/state.mjs';
import { applyCommands } from '../env/commands.mjs';
import { startPush, stepRocks, ROCKS } from '../env/rocks.mjs';

// A flat 12 x 12 field with no heights, ramps or water unless a test adds them.
function field({ rocks = [], units = [], structures = [], crystals = [] } = {}) {
  const state = createTestState({ width: 12, height: 12, rocks, units, structures, crystals });
  state.heights = Array.from({ length: 12 }, () => new Array(12).fill(0));
  state.ramps = [];
  return state;
}

// Runs stepRocks until `ticks` have passed (the rock module only; movement is tested in the sim wiring test).
function tickRocks(state, ticks) {
  const events = [];
  for (let i = 0; i < ticks; i++) {
    state.events = [];
    stepRocks(state);
    events.push(...state.events);
  }
  return events;
}

const rockAt = (state, x, y) => state.rockSet.has(`${x},${y}`);
const unitOf = (state, id) => state.units.find((u) => u.id === id);

describe('push: a ground unit next to a rock', () => {
  test('a brute pushes the rock one tile away from itself and steps into the gap', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 }), null);
    tickRocks(state, ROCKS.pushTicks);
    assert.equal(rockAt(state, 5, 5), false, 'the old tile is clear');
    assert.equal(rockAt(state, 6, 5), true, 'the rock is one tile further east');
    assert.deepEqual(state.rocks, [[6, 5]]);
    assert.deepEqual([unitOf(state, 1).x, unitOf(state, 1).y], [5, 5], 'the brute stepped into the gap, still next to the rock');
  });

  test('a brute takes ROCKS.pushTicks; any other ground unit takes three times as long', () => {
    assert.equal(ROCKS.pushTicks, 12);
    const heavy = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    startPush(heavy, 0, { type: 'push', unit: 1, x: 5, y: 5 });
    tickRocks(heavy, ROCKS.pushTicks - 1);
    assert.equal(rockAt(heavy, 5, 5), true, 'not yet after one tick short');
    tickRocks(heavy, 1);
    assert.equal(rockAt(heavy, 6, 5), true);

    const light = field({ rocks: [[5, 5]], units: [{ id: 2, owner: 0, kind: 'grunt', x: 4, y: 5 }] });
    startPush(light, 0, { type: 'push', unit: 2, x: 5, y: 5 });
    tickRocks(light, ROCKS.pushTicks * 3 - 1);
    assert.equal(rockAt(light, 5, 5), true, 'still pushing before 3x the heavy time');
    tickRocks(light, 1);
    assert.equal(rockAt(light, 6, 5), true);
  });

  test('a unit far from the rock is sent to a side that can take the push', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 0, y: 0 }] });
    // Far away: the unit is sent to the nearest side that can take the push (move order set, job waiting).
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 }), null);
    assert.equal(state.pushJobs.length, 1);
    assert.equal(state.pushJobs[0].phase, 'walk');
    assert.equal(unitOf(state, 1).order.type, 'move');
  });
});

describe('push: what refuses it', () => {
  test('a rock with no rock on the tile is refused', () => {
    const state = field({ units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'no-rock');
  });

  test('a unit that is not yours is refused', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 1, kind: 'brute', x: 4, y: 5 }] });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'not-yours');
  });

  test('an air unit cannot push', () => {
    // Air kinds are not in the v3 stats table yet, so the test turns a brute into a skiff by hand.
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    state.units[0].kind = 'skiff';
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'wrong-kind');
  });

  test('a rock cannot be pushed onto a unit', () => {
    const state = field({
      rocks: [[5, 5]],
      units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }, { id: 2, owner: 1, kind: 'grunt', x: 6, y: 5 }],
    });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'blocked');
    assert.equal(rockAt(state, 5, 5), true);
  });

  test('a rock cannot be pushed onto a structure or a crystal', () => {
    const wall = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }], structures: [{ id: 9, owner: 1, kind: 'turret', x: 6, y: 5 }] });
    assert.equal(startPush(wall, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'blocked');
    const ore = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }], crystals: [{ x: 6, y: 5, amount: 10 }] });
    assert.equal(startPush(ore, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'blocked');
  });

  test('a rock cannot be pushed onto another rock', () => {
    const state = field({ rocks: [[5, 5], [6, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'blocked');
  });

  test('a rock cannot be pushed onto a different height (no pushing off a cliff)', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    state.heights[5][6] = 1; // the high ground starts one tile to the east of the rock: the rock is on low ground
    state.heights[5][5] = 0;
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'cliff');
  });

  test('a rock cannot be pushed onto a ramp, and a rock on a ramp cannot be pushed', () => {
    const onto = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    onto.ramps = [{ x: 6, y: 5, axis: 'ew' }];
    assert.equal(startPush(onto, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'ramp');
    const from = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    from.ramps = [{ x: 5, y: 5, axis: 'ew' }];
    assert.equal(startPush(from, 0, { type: 'push', unit: 1, x: 5, y: 5 }), 'ramp');
  });

  test('a rock cannot be pushed off the map', () => {
    const state = field({ rocks: [[11, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 10, y: 5 }] });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 11, y: 5 }), 'off-map');
  });

  test('a command with non-numbers is bad-command, never a crash', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: '5', y: 5 }), 'bad-command');
  });

  test('a push that becomes blocked while the unit is pushing is cancelled and the rock stays', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 });
    state.units.push({ id: 2, owner: 1, kind: 'grunt', x: 6, y: 5, hp: 60, carrying: 0, order: null });
    const events = tickRocks(state, ROCKS.pushTicks);
    assert.equal(rockAt(state, 5, 5), true);
    assert.ok(events.some((e) => e.e === 'push-cancel' && e.reason === 'blocked'));
  });

  test('a unit given a new order mid-push stops pushing and the rock stays', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5 });
    tickRocks(state, 2);
    unitOf(state, 1).order = { type: 'move', x: 0, y: 0 };
    const events = tickRocks(state, ROCKS.pushTicks);
    assert.equal(rockAt(state, 5, 5), true);
    assert.ok(events.some((e) => e.e === 'push-cancel' && e.reason === 'interrupted'));
  });
});

describe('haul: a Crumb (worker) drags a rock along a straight line', () => {
  test('a worker hauls a rock three tiles east in three steps of the slow pace', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'worker', x: 4, y: 5 }] });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5, to: { x: 8, y: 5 } }), null);
    tickRocks(state, ROCKS.pushTicks * 3 * 3);
    assert.deepEqual(state.rocks, [[8, 5]]);
    assert.deepEqual([unitOf(state, 1).x, unitOf(state, 1).y], [7, 5], 'the worker ends next to the rock');
  });

  test('only workers haul; a brute cannot', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }] });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5, to: { x: 8, y: 5 } }), 'wrong-kind');
  });

  test('a haul must go in a straight line, no further than 8 tiles', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'worker', x: 4, y: 5 }] });
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5, to: { x: 7, y: 7 } }), 'bad-target');
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5, to: { x: 5, y: 5 } }), 'bad-target');
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5, to: { x: 5 + ROCKS.haulMax + 1, y: 5 } }), 'too-far');
  });

  test('a haul stops at the first blocked tile and the rock is left where it stopped', () => {
    const state = field({
      rocks: [[5, 5]],
      units: [{ id: 1, owner: 0, kind: 'worker', x: 4, y: 5 }, { id: 2, owner: 1, kind: 'grunt', x: 8, y: 5 }],
    });
    startPush(state, 0, { type: 'push', unit: 1, x: 5, y: 5, to: { x: 9, y: 5 } });
    tickRocks(state, ROCKS.pushTicks * 3 * 6);
    assert.deepEqual(state.rocks, [[7, 5]]);
  });
});

describe('water: fords and dams', () => {
  // A river runs down column x = 5. Rocks sit on the west bank (x = 4) and are pushed east into the water.
  const river = () => {
    const state = field({
      rocks: [[4, 2], [4, 3], [4, 4]],
      units: [{ id: 1, owner: 0, kind: 'brute', x: 3, y: 2 }, { id: 2, owner: 0, kind: 'brute', x: 3, y: 3 }, { id: 3, owner: 0, kind: 'brute', x: 3, y: 4 }],
    });
    state.rockHooks = { isWater: (s, x, y) => x === 5 && y >= 0 && y <= 9 };
    return state;
  };

  test('a rock pushed into a water tile makes a walkable ford and the rock is gone', () => {
    const state = river();
    startPush(state, 0, { type: 'push', unit: 1, x: 4, y: 2 });
    const events = tickRocks(state, ROCKS.pushTicks);
    assert.equal(state.rocks.some(([x, y]) => x === 4 && y === 2), false, 'the rock left the bank');
    assert.equal(rockAt(state, 5, 2), false, 'the water tile is not a rock');
    assert.equal(isPassable(state, 5, 2), true, 'the ford can be walked on');
    assert.ok(events.some((e) => e.e === 'push' && e.ford === true && e.dam === false));
  });

  test('a single ford is not a dam; a line of three fords across the river is a dam', () => {
    const state = river();
    startPush(state, 0, { type: 'push', unit: 1, x: 4, y: 2 });
    startPush(state, 0, { type: 'push', unit: 2, x: 4, y: 3 });
    tickRocks(state, ROCKS.pushTicks);
    assert.equal(state.fords.has('5,2') && state.fords.has('5,3'), true);
    startPush(state, 0, { type: 'push', unit: 3, x: 4, y: 4 });
    const events = tickRocks(state, ROCKS.pushTicks);
    assert.equal(state.fords.size, 3);
    assert.ok(events.some((e) => e.e === 'push' && e.ford === true && e.dam === true));
  });

  test('a rock pushed onto dry floor beside a river just moves', () => {
    const state = field({ rocks: [[4, 2]], units: [{ id: 1, owner: 0, kind: 'brute', x: 3, y: 2 }] });
    state.rockHooks = { isWater: () => false };
    assert.equal(startPush(state, 0, { type: 'push', unit: 1, x: 4, y: 2 }), null);
    tickRocks(state, ROCKS.pushTicks);
    assert.deepEqual(state.rocks, [[5, 2]]);
    assert.equal(state.fords, undefined);
  });
});

describe('commands: push goes through the normal command list', () => {
  test('applyCommands routes a push and reports a refusal with a reason', () => {
    const state = field({ rocks: [[5, 5]], units: [{ id: 1, owner: 0, kind: 'brute', x: 4, y: 5 }, { id: 2, owner: 0, kind: 'worker', x: 0, y: 0 }] });
    applyCommands(state, 0, [{ type: 'push', unit: 1, x: 5, y: 5 }, { type: 'push', unit: 1, x: 2, y: 2 }]);
    assert.equal(state.pushJobs.length, 1);
    const rejects = state.events.filter((e) => e.e === 'reject');
    assert.equal(rejects.length, 1);
    assert.equal(rejects[0].reason, 'no-rock');
  });
});
