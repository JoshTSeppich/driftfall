// Movement edge cases (ENV-SPEC section 6 and 8). Owner of this file: haiku (Pathfinding / Movement edge cases).
// Uses the real env modules through step(); nothing is stubbed.
//
// These tests stress crowds, chokepoints, one-tile meetings, a crowd of Workers on one crystal tile and Brute
// pacing. Where the spec leaves a case open, the test only checks safety (no shared tiles, no illegal steps,
// no freeze), not an exact outcome. Failures are reported to the movement owner, not patched here.
//
// Tick parity: a tick value is the `state.tick` seen before step() runs (same as movement-order.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState, createInitialState, findEntity, isPassable } from '../env/state.mjs';
import { step } from '../env/sim.mjs';
import { STATS } from '../env/stats.mjs';

const NO_COMMANDS = [[], []];

function unit(id, kind, x, y, order = null, owner = 0) {
  return { id, owner, kind, x, y, hp: STATS.units[kind].hp, carrying: 0, order };
}

function at(state, id) {
  const e = findEntity(state, id);
  return e ? { x: e.x, y: e.y } : null;
}

function positionsOf(state) {
  return new Map(state.units.map((u) => [u.id, { x: u.x, y: u.y }]));
}

function assertNoSharedTiles(state, label) {
  const seen = new Map();
  for (const u of state.units) {
    const key = `${u.x},${u.y}`;
    assert.ok(!seen.has(key), `${label}: units ${seen.get(key)} and ${u.id} share tile ${key}`);
    seen.set(key, u.id);
  }
}

// Every move event in one tick must be a single 4-directional step onto a passable tile, from where the unit was.
function assertLegalMoves(state, before, events, label) {
  for (const ev of events) {
    if (ev.e !== 'move') continue;
    const prev = before.get(ev.id);
    assert.ok(prev, `${label}: move event for unknown unit ${ev.id}`);
    const steps = Math.abs(ev.x - prev.x) + Math.abs(ev.y - prev.y);
    assert.equal(steps, 1, `${label}: unit ${ev.id} moved ${steps} tiles from ${prev.x},${prev.y} to ${ev.x},${ev.y}`);
    assert.ok(isPassable(state, ev.x, ev.y), `${label}: unit ${ev.id} stepped onto a blocked tile ${ev.x},${ev.y}`);
  }
}

// Run `ticks` steps with no commands. After each step, check the safety rules and call `after(events, tick)`.
function runChecked(state, ticks, label, after) {
  for (let i = 0; i < ticks; i++) {
    const before = positionsOf(state);
    const tick = state.tick;
    const events = step(state, NO_COMMANDS);
    assertLegalMoves(state, before, events, `${label} tick ${tick}`);
    assertNoSharedTiles(state, `${label} after tick ${tick}`);
    if (after) after(events, tick);
  }
}

test('a head-on pair in a one-tile gap frees up once one unit steps into a side pocket', () => {
  // Corridor on row 1. Row 0 is rock except a one-tile pocket at (3,0). Row 2 is all rock.
  const rocks = [];
  for (let x = 0; x < 8; x++) {
    if (x !== 3) rocks.push([x, 0]);
    rocks.push([x, 2]);
  }
  const state = createTestState({
    width: 8,
    height: 3,
    rocks,
    crystals: [],
    shards: [0, 0],
    units: [
      unit(3, 'grunt', 2, 1, { type: 'move', x: 5, y: 1 }),
      // Unit 4 is the one that gives way: it is ordered into the pocket.
      unit(4, 'grunt', 3, 1, { type: 'move', x: 3, y: 0 }),
    ],
  });
  runChecked(state, 12, 'pocket');
  assert.deepEqual(at(state, 4), { x: 3, y: 0 }, 'unit 4 should have stepped into the pocket');
  assert.deepEqual(at(state, 3), { x: 5, y: 1 }, 'unit 3 should pass the gap once unit 4 is out of it');
});

test('two Grunts swapping ends of an open room both arrive within 30 ticks', () => {
  // Open 9x3 room. Each Grunt's straight path runs through the other, so they must detour.
  const state = createTestState({
    width: 9,
    height: 3,
    rocks: [],
    crystals: [],
    shards: [0, 0],
    units: [
      unit(3, 'grunt', 2, 1, { type: 'move', x: 6, y: 1 }),
      unit(4, 'grunt', 6, 1, { type: 'move', x: 2, y: 1 }),
    ],
  });
  runChecked(state, 30, 'swap');
  assert.deepEqual(at(state, 3), { x: 6, y: 1 }, 'unit 3 should reach its target');
  assert.deepEqual(at(state, 4), { x: 2, y: 1 }, 'unit 4 should reach its target');
});

test('a crowd of six Grunts through a one-tile chokepoint all gets through within 300 ticks', () => {
  // Wall at x=4 with a single gap at (4,3). Six Grunts on the left, one target each on the right.
  const rocks = [];
  for (const y of [0, 1, 2, 4, 5, 6]) rocks.push([4, y]);
  const starts = [[1, 0], [1, 1], [1, 2], [1, 4], [1, 5], [1, 6]];
  const targets = [[7, 0], [7, 1], [7, 2], [7, 4], [7, 5], [7, 6]];
  const state = createTestState({
    width: 8,
    height: 7,
    rocks,
    crystals: [],
    shards: [0, 0],
    units: starts.map(([x, y], i) => unit(3 + i, 'grunt', x, y, { type: 'move', x: targets[i][0], y: targets[i][1] })),
  });
  runChecked(state, 300, 'chokepoint');
  targets.forEach(([x, y], i) => {
    assert.deepEqual(at(state, 3 + i), { x, y }, `grunt ${3 + i} should have reached ${x},${y}`);
  });
});

test('six Workers ordered onto one crystal tile keep mining and delivering without freezing', () => {
  // Open 9x7 room. One crystal tile at (5,3) with 400 Shards and a side 0 Core at (1,1). Six Workers
  // all want the crystal. Paths ignore units, so this is the crowd that used to freeze.
  const starts = [[2, 2], [2, 3], [2, 4], [3, 2], [3, 3], [3, 4]];
  const state = createTestState({
    width: 9,
    height: 7,
    rocks: [],
    crystals: [{ x: 5, y: 3, amount: 400 }],
    shards: [0, 0],
    structures: [{ id: 1, owner: 0, kind: 'core', x: 1, y: 1 }],
    units: starts.map(([x, y], i) => unit(3 + i, 'worker', x, y)),
  });
  const gather = starts.map((_, i) => ({ type: 'gather', unit: 3 + i, x: 5, y: 3 }));
  step(state, [gather, []]);
  runChecked(state, 200, 'crystal crowd');

  assert.ok(state.shards[0] >= 60, `side 0 should bank at least 60 Shards, has ${state.shards[0]}`);
  const crystal = state.crystals.find((c) => c.x === 5 && c.y === 3);
  assert.equal(400 - crystal.amount, state.shards[0] + state.units.reduce((n, u) => n + u.carrying, 0),
    'Shards taken from the crystal should equal Shards banked plus Shards still carried');
});

test('a Brute routes around a standing Grunt wall and moves only on even ticks', () => {
  // 8x7 room. Three idle Grunts stand across row 3 at x=3..5; rows 2 and 4 are open, so a detour exists.
  // Idle units never move on their own, so the Brute must go around them.
  const state = createTestState({
    width: 8,
    height: 7,
    rocks: [],
    crystals: [],
    shards: [0, 0],
    units: [
      unit(3, 'brute', 0, 3, { type: 'move', x: 7, y: 3 }),
      unit(4, 'grunt', 3, 3, null),
      unit(5, 'grunt', 4, 3, null),
      unit(6, 'grunt', 5, 3, null),
    ],
  });
  const bruteMoveTicks = [];
  runChecked(state, 60, 'brute wall', (events, tick) => {
    if (events.some((ev) => ev.e === 'move' && ev.id === 3)) bruteMoveTicks.push(tick);
  });
  assert.ok(bruteMoveTicks.length > 0, 'the Brute should have moved');
  for (const tick of bruteMoveTicks) {
    assert.equal(tick % 2, 0, `the Brute moved on odd tick ${tick}`);
  }
  assert.deepEqual(at(state, 3), { x: 7, y: 3 }, 'the Brute should get around the wall and reach its target');
  for (const id of [4, 5, 6]) {
    assert.ok(at(state, id), `grunt ${id} should still exist`);
  }
});

test('a Grunt whose target is occupied by an idle unit never steps onto that unit', () => {
  // The spec leaves this open (the target is not "unreachable" in the walled-off sense). Safety only:
  // the moving unit must never share the idle unit's tile and the idle unit must not move.
  const state = createTestState({
    width: 5,
    height: 3,
    rocks: [],
    crystals: [],
    shards: [0, 0],
    units: [
      unit(3, 'grunt', 0, 1, { type: 'move', x: 3, y: 1 }),
      unit(4, 'grunt', 3, 1, null),
    ],
  });
  runChecked(state, 20, 'occupied target');
  assert.deepEqual(at(state, 4), { x: 3, y: 1 }, 'the idle unit should not be moved');
  assert.notDeepEqual(at(state, 3), { x: 3, y: 1 }, 'the moving unit must never enter the idle unit\'s tile');
});

test('on every real map seed, Workers swapping sides never share a tile or step onto a blocked tile', () => {
  // Side 0's Workers head for side 1's start tiles and the reverse, on the real generated maps.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const state = createInitialState(seed);
    const side0 = state.units.filter((u) => u.owner === 0);
    const side1 = state.units.filter((u) => u.owner === 1);
    const cmds0 = side0.map((u, i) => ({ type: 'move', unit: u.id, x: side1[i].x, y: side1[i].y }));
    const cmds1 = side1.map((u, i) => ({ type: 'move', unit: u.id, x: side0[i].x, y: side0[i].y }));
    assertNoSharedTiles(state, `seed ${seed} start`);
    step(state, [cmds0, cmds1]);
    runChecked(state, 300, `seed ${seed}`);
  }
});

test('the same crowd run twice gives the same movement events', () => {
  const build = () => createTestState({
    width: 8,
    height: 7,
    rocks: [[4, 0], [4, 1], [4, 2], [4, 4], [4, 5], [4, 6]],
    crystals: [],
    shards: [0, 0],
    units: [1, 2, 3, 4, 5, 6].map((i) => unit(2 + i, 'grunt', 1, i === 1 ? 0 : i <= 3 ? i - 1 : i, { type: 'move', x: 7, y: 6 - i + 1 })),
  });
  const runOnce = () => {
    const state = build();
    const log = [];
    for (let t = 0; t < 120; t++) log.push(step(state, NO_COMMANDS).map((ev) => ({ ...ev })));
    return JSON.stringify(log);
  };
  assert.equal(runOnce(), runOnce());
});
