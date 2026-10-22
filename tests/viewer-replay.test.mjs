// Tests for viewer/replay.mjs: applyTick and replayTo (spec sections 12 and 14).
// Runs with: node --test tests/viewer-replay.test.mjs
// The module under test is imported for real. Nothing is stubbed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyTick, replayTo } from '../viewer/replay.mjs';

// ---- helpers -------------------------------------------------------------

const clone = (v) => structuredClone(v);

// A hand-built state in the shape from spec section 14.
function makeState(overrides = {}) {
  return {
    tick: 5,
    seed: 1,
    width: 32,
    height: 32,
    rocks: [[10, 10]],
    rockSet: new Set(['10,10']),
    crystals: [
      { x: 7, y: 2, amount: 400 },
      { x: 8, y: 2, amount: 400 },
    ],
    shards: [100, 100],
    nextId: 20,
    units: [
      { id: 3, owner: 0, kind: 'worker', x: 4, y: 3, hp: 40, carrying: 0, order: null },
      { id: 7, owner: 1, kind: 'grunt', x: 20, y: 20, hp: 60, carrying: 0, order: null },
    ],
    structures: [
      { id: 1, owner: 0, kind: 'core', x: 3, y: 3, hp: 1000, progress: 0, complete: true, queue: [] },
      { id: 12, owner: 0, kind: 'forge', x: 9, y: 6, hp: 1, progress: 0, complete: false, queue: [] },
    ],
    events: [],
    result: null,
    ...overrides,
  };
}

// Wrap events in a tick entry as stored in a log (spec section 12).
const entry = (...events) => ({ tick: 6, commands: [[], []], events });

// applyTick may change the state in place or hand back a new one; accept either.
const apply = (state, ...events) => applyTick(state, entry(...events)) ?? state;

const byId = (list, id) => list.find((e) => e.id === id);

// Fields that replay promises to rebuild (spec section 12), used when comparing whole states.
const promised = (s) => ({
  tick: s.tick,
  width: s.width,
  height: s.height,
  rocks: s.rocks,
  crystals: s.crystals,
  shards: s.shards,
  units: s.units,
  structures: s.structures,
});

// A small match log written by hand in the section 12 format. Tick numbers are the tick each entry produces.
function makeLog() {
  return {
    format: 'driftfall-log',
    version: 1,
    seed: 7,
    players: ['alpha', 'beta'],
    stats: {},
    initial: {
      tick: 0,
      width: 32,
      height: 32,
      rocks: [[5, 5]],
      crystals: [{ x: 7, y: 2, amount: 400 }],
      shards: [100, 100],
      units: [{ id: 3, owner: 0, kind: 'worker', x: 4, y: 3, hp: 40, carrying: 0, order: null }],
      structures: [
        { id: 1, owner: 0, kind: 'core', x: 3, y: 3, hp: 1000, progress: 0, complete: true, queue: [] },
      ],
      unitCap: 40,
      maxTicks: 2000,
    },
    ticks: [
      {
        tick: 1,
        commands: [[{ type: 'gather', unit: 3, x: 7, y: 2 }], []],
        events: [{ e: 'order', id: 3, order: { type: 'gather', x: 7, y: 2, phase: 'toField', ticks: 0 } }],
      },
      {
        tick: 2,
        commands: [[{ type: 'train', building: 1, kind: 'worker' }], []],
        events: [
          { e: 'spend', player: 0, amount: 50, shards: 50 },
          { e: 'spawn', unit: { id: 9, owner: 0, kind: 'worker', x: 3, y: 4, hp: 40, carrying: 0, order: null } },
          { e: 'move', id: 3, x: 6, y: 2 },
        ],
      },
      {
        tick: 3,
        commands: [[], []],
        events: [
          { e: 'mine', id: 3, x: 7, y: 2, amount: 10, left: 390 },
          { e: 'move', id: 3, x: 5, y: 3 },
          { e: 'deliver', id: 3, amount: 10, shards: 60 },
        ],
      },
    ],
    result: null,
    timing: [[0, 0], [0, 0], [0, 0]],
  };
}

// ---- applyTick: one test per event kind ------------------------------------

describe('applyTick: spawn', () => {
  test('adds a unit record with every field it was given', () => {
    const next = apply(makeState(), {
      e: 'spawn',
      unit: { id: 30, owner: 1, kind: 'lancer', x: 27, y: 28, hp: 40, carrying: 0, order: null },
    });
    assert.deepEqual(byId(next.units, 30), { id: 30, owner: 1, kind: 'lancer', x: 27, y: 28, hp: 40, carrying: 0, order: null });
    assert.equal(next.units.length, 3);
  });

  test('adds a structure record, including a construction site', () => {
    const site = { id: 31, owner: 1, kind: 'turret', x: 22, y: 25, hp: 1, progress: 0, complete: false, queue: [] };
    const next = apply(makeState(), { e: 'spawn', structure: site });
    assert.deepEqual(byId(next.structures, 31), site);
    assert.equal(next.structures.length, 3);
  });
});

describe('applyTick: move', () => {
  test('relocates the unit and leaves its other fields alone', () => {
    const before = makeState();
    const next = apply(before, { e: 'move', id: 3, x: 5, y: 3 });
    const worker = byId(next.units, 3);
    assert.equal(worker.x, 5);
    assert.equal(worker.y, 3);
    assert.equal(worker.hp, 40);
    assert.equal(worker.owner, 0);
    assert.equal(worker.kind, 'worker');
  });
});

describe('applyTick: hit', () => {
  test('sets the target hp to the value in the event', () => {
    const next = apply(makeState(), { e: 'hit', id: 7, by: 3, dmg: 2, hp: 58 });
    assert.equal(byId(next.units, 7).hp, 58);
  });

  test('sets structure hp too', () => {
    const next = apply(makeState(), { e: 'hit', id: 1, by: 7, dmg: 25, hp: 975 });
    assert.equal(byId(next.structures, 1).hp, 975);
  });
});

describe('applyTick: die', () => {
  test('removes a unit', () => {
    const next = apply(makeState(), { e: 'die', id: 7 });
    assert.equal(byId(next.units, 7), undefined);
    assert.equal(next.units.length, 1);
  });

  test('removes a structure', () => {
    const next = apply(makeState(), { e: 'die', id: 12 });
    assert.equal(byId(next.structures, 12), undefined);
    assert.equal(next.structures.length, 1);
  });
});

describe('applyTick: mine and deliver', () => {
  test('mine sets the crystal amount left and loads the unit', () => {
    const next = apply(makeState(), { e: 'mine', id: 3, x: 7, y: 2, amount: 10, left: 390 });
    assert.equal(next.crystals.find((c) => c.x === 7 && c.y === 2).amount, 390);
    assert.equal(next.crystals.find((c) => c.x === 8 && c.y === 2).amount, 400, 'other crystals untouched');
    assert.equal(byId(next.units, 3).carrying, 10);
    assert.deepEqual(next.shards, [100, 100], 'mining does not pay out Shards');
  });

  test('deliver credits the unit owner with the Shards in the event and empties the unit', () => {
    const loaded = makeState();
    byId(loaded.units, 3).carrying = 10;
    const next = apply(loaded, { e: 'deliver', id: 3, amount: 10, shards: 110 });
    assert.deepEqual(next.shards, [110, 100]);
    assert.equal(byId(next.units, 3).carrying, 0);
  });
});

describe('applyTick: spend', () => {
  test('sets that side Shards to the value in the event', () => {
    const next = apply(makeState(), { e: 'spend', player: 1, amount: 75, shards: 25 });
    assert.deepEqual(next.shards, [100, 25]);
  });
});

describe('applyTick: progress and done', () => {
  test('progress sets the site progress and hp', () => {
    const next = apply(makeState(), { e: 'progress', id: 12, progress: 10, hp: 120 });
    const site = byId(next.structures, 12);
    assert.equal(site.progress, 10);
    assert.equal(site.hp, 120);
    assert.equal(site.complete, false);
  });

  test('done marks the structure complete', () => {
    const next = apply(makeState(), { e: 'done', id: 12 });
    assert.equal(byId(next.structures, 12).complete, true);
  });
});

describe('applyTick: queue and order', () => {
  test('queue replaces the structure queue', () => {
    const next = apply(makeState(), { e: 'queue', id: 1, queue: ['worker', 'worker'] });
    assert.deepEqual(byId(next.structures, 1).queue, ['worker', 'worker']);
  });

  test('queue can be emptied', () => {
    const start = makeState();
    byId(start.structures, 1).queue = ['worker'];
    const next = apply(start, { e: 'queue', id: 1, queue: [] });
    assert.deepEqual(byId(next.structures, 1).queue, []);
  });

  test('order replaces the unit order', () => {
    const order = { type: 'attack', target: 7 };
    const next = apply(makeState(), { e: 'order', id: 3, order });
    assert.deepEqual(byId(next.units, 3).order, order);
  });

  test('order can clear the unit order with null', () => {
    const start = makeState();
    byId(start.units, 3).order = { type: 'move', x: 1, y: 1 };
    const next = apply(start, { e: 'order', id: 3, order: null });
    assert.equal(byId(next.units, 3).order, null);
  });
});

describe('applyTick: events that do not change replayed state', () => {
  for (const ev of [
    { e: 'blocked', id: 3 },
    { e: 'reject', player: 0, command: { type: 'move', unit: 3, x: 99, y: 99 }, reason: 'off-map' },
    { e: 'late', player: 1 },
    { e: 'error', player: 1, message: 'boom' },
    { e: 'forfeit', player: 1, reason: 'timeout' },
  ]) {
    test(`${ev.e} leaves the state as it was`, () => {
      const before = makeState();
      const expected = clone(promised(before));
      const next = apply(before, ev);
      assert.deepEqual(promised(next), expected);
    });
  }

  test('an unknown event kind is ignored', () => {
    const before = makeState();
    const expected = clone(promised(before));
    const next = apply(before, { e: 'teleport-everyone', id: 3, x: 0, y: 0 });
    assert.deepEqual(promised(next), expected);
  });
});

describe('applyTick: several events in one tick', () => {
  test('events apply in the order they are listed', () => {
    const next = apply(
      makeState(),
      { e: 'move', id: 3, x: 5, y: 3 },
      { e: 'hit', id: 3, by: 7, dmg: 8, hp: 32 },
      { e: 'die', id: 3 },
    );
    assert.equal(byId(next.units, 3), undefined);
    assert.equal(next.units.length, 1);
  });
});

// ---- replayTo ----------------------------------------------------------------

describe('replayTo', () => {
  test('replayTo(log, 0) equals the initial state in the log', () => {
    const log = makeLog();
    const state = replayTo(log, 0);
    assert.deepEqual(promised(state), promised(log.initial));
  });

  test('replayTo(log, 0) keeps the tick at 0', () => {
    assert.equal(replayTo(makeLog(), 0).tick, 0);
  });

  test('replayTo applies every tick up to and including the target', () => {
    const log = makeLog();
    const state = replayTo(log, 2);
    assert.equal(state.tick, 2);
    assert.deepEqual(state.shards, [50, 100], 'the tick 3 deliver is not applied yet');
    assert.equal(byId(state.units, 9).x, 3, 'spawned worker is present');
    assert.equal(byId(state.units, 3).x, 6, 'tick 2 move is applied');
  });

  test('replayTo gives the expected state at the last tick', () => {
    const state = replayTo(makeLog(), 3);
    assert.equal(state.tick, 3);
    assert.deepEqual(state.shards, [60, 100]);
    assert.equal(state.crystals.find((c) => c.x === 7 && c.y === 2).amount, 390);
    assert.equal(byId(state.units, 3).carrying, 0, 'deliver empties the load');
    assert.equal(byId(state.units, 3).x, 5);
    assert.equal(byId(state.units, 9).owner, 0);
  });

  test('replayTo applies the order event and leaves it set on the unit', () => {
    const state = replayTo(makeLog(), 1);
    assert.deepEqual(byId(state.units, 3).order, { type: 'gather', x: 7, y: 2, phase: 'toField', ticks: 0 });
  });

  test('replayTo never mutates the log', () => {
    const log = makeLog();
    const original = clone(log);
    replayTo(log, 3);
    assert.deepEqual(log, original);
  });

  test('replaying twice gives the same result', () => {
    const log = makeLog();
    assert.deepEqual(promised(replayTo(log, 3)), promised(replayTo(log, 3)));
  });

  test('an earlier replay does not leak changes into a later one', () => {
    const log = makeLog();
    replayTo(log, 3);
    assert.deepEqual(promised(replayTo(log, 0)), promised(log.initial));
  });
});
