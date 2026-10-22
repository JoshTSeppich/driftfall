// Tests for command checking (spec §10) and side order on odd ticks (spec §8).
// Uses the real modules: env/commands.mjs, env/state.mjs, env/stats.mjs and env/sim.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommands } from '../env/commands.mjs';
import { createTestState, findEntity } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';

// sim.mjs pulls in every phase module; if one is not written yet, only the side-order tests should fail.
let step = () => { throw new Error('env/sim.mjs could not be loaded: ' + simLoadError?.message); };
let simLoadError = null;
try { ({ step } = await import('../env/sim.mjs')); } catch (err) { simLoadError = err; }

const unitStat = (k) => (STATS.units ?? STATS)[k];
const structStat = (k) => (STATS.structures ?? STATS)[k];
const UNIT_CAP = STATS.match.unitCap;
const QUEUE_MAX = STATS.match.queueMax;
const MAX_COMMANDS = STATS.match.maxCommandsPerTick;

// Fixed ids used by every scenario.
const ID = { core0: 1, core1: 2, w0: 3, w1: 4, g0: 5, g1: 6, forge0: 7, forge1: 8, site1: 9, site0: 10 };

function makeState(over = {}) {
  const state = createTestState({
    width: 32,
    height: 32,
    rocks: [[20, 20]],
    crystals: [
      { x: 12, y: 12, amount: 400 },
      { x: 14, y: 12, amount: 0 },
    ],
    shards: [1000, 1000],
    units: [
      { id: ID.w0, owner: 0, kind: 'worker', x: 5, y: 5, order: null },
      { id: ID.w1, owner: 1, kind: 'worker', x: 26, y: 26, order: null },
      { id: ID.g0, owner: 0, kind: 'grunt', x: 6, y: 6, order: null },
      { id: ID.g1, owner: 1, kind: 'grunt', x: 25, y: 25, order: null },
    ],
    structures: [
      { id: ID.core0, owner: 0, kind: 'core', x: 3, y: 3, complete: true, queue: [] },
      { id: ID.core1, owner: 1, kind: 'core', x: 28, y: 28, complete: true, queue: [] },
      { id: ID.forge0, owner: 0, kind: 'forge', x: 10, y: 10, complete: true, queue: [] },
      { id: ID.forge1, owner: 1, kind: 'forge', x: 20, y: 10, complete: true, queue: [] },
      { id: ID.site1, owner: 1, kind: 'turret', x: 22, y: 5, complete: false, queue: [] },
      { id: ID.site0, owner: 0, kind: 'turret', x: 8, y: 20, complete: false, queue: [] },
    ],
    ...over,
  });
  state.events = [];
  return state;
}

const rejects = (state) => state.events.filter((e) => e.e === 'reject');
const spends = (state) => state.events.filter((e) => e.e === 'spend');

// Run one command for side `player` and return the reject reasons it produced.
function run(state, player, cmd) {
  state.events = [];
  applyCommands(state, player, [cmd]);
  return rejects(state).map((r) => r.reason);
}
function expectReject(state, player, cmd, reason) {
  const got = run(state, player, cmd);
  assert.deepEqual(got, [reason], `expected one reject "${reason}" for ${JSON.stringify(cmd)}, got ${JSON.stringify(got)}`);
  const ev = rejects(state)[0];
  assert.equal(ev.player, player, 'reject event names the player');
  assert.ok('command' in ev, 'reject event carries the command');
}
function expectRejectAny(state, player, cmd, reasons) {
  const got = run(state, player, cmd);
  assert.equal(got.length, 1, `expected one reject for ${JSON.stringify(cmd)}, got ${JSON.stringify(got)}`);
  assert.ok(reasons.includes(got[0]), `reason ${got[0]} not in ${JSON.stringify(reasons)}`);
}
function expectLegal(state, player, cmd) {
  const got = run(state, player, cmd);
  assert.deepEqual(got, [], `expected no reject for ${JSON.stringify(cmd)}, got ${JSON.stringify(got)}`);
}

// ---------------------------------------------------------------- reject reasons

test('bad-command: things that are not commands', () => {
  const s = makeState();
  for (const bad of [null, undefined, 'move', 42, true, [], {}, { type: 'dance' },{ type: 123, unit: ID.w0 }]) {
    expectReject(s, 0, bad, 'bad-command');
  }
});

test('bad-command: missing or non-integer fields', () => {
  const s = makeState();
  expectReject(s, 0, { type: 'move', unit: ID.w0 }, 'bad-command');
  expectReject(s, 0, { type: 'move', unit: ID.w0, x: 'a', y: 3 }, 'bad-command');
  expectReject(s, 0, { type: 'move', unit: ID.w0, x: 1.5, y: 3 }, 'bad-command');
  expectReject(s, 0, { type: 'move', unit: ID.w0, x: NaN, y: 3 }, 'bad-command');
  // The spec does not say whether a missing or non-numeric unit id is bad-command or no-such-unit; either is fine.
  expectRejectAny(s, 0, { type: 'move', unit: 'three', x: 3, y: 3 }, ['bad-command', 'no-such-unit']);
  expectRejectAny(s, 0, { type: 'move', x: 3, y: 3 }, ['bad-command', 'no-such-unit']);
  expectRejectAny(s, 0, { type: 'move' }, ['bad-command', 'no-such-unit']);
  expectRejectAny(s, 0, { type: 'stop' }, ['bad-command', 'no-such-unit']);
  expectRejectAny(s, 0, { type: 'train', building: ID.core0 }, ['bad-command', 'wrong-kind']);
  expectRejectAny(s, 0, { type: 'build', unit: ID.w0, x: 6, y: 6 }, ['bad-command', 'wrong-kind']);
  expectRejectAny(s, 0, { type: 'attack', unit: ID.g0 }, ['bad-command', 'bad-target']);
  expectReject(s, 0, { type: 'gather', unit: ID.w0, x: 12 }, 'bad-command');
});

test('no-such-unit: the unit id does not exist', () => {
  const s = makeState();
  expectReject(s, 0, { type: 'move', unit: 999, x: 3, y: 3 }, 'no-such-unit');
  expectReject(s, 0, { type: 'stop', unit: 999 }, 'no-such-unit');
  expectReject(s, 0, { type: 'gather', unit: 999, x: 12, y: 12 }, 'no-such-unit');
  expectReject(s, 0, { type: 'build', unit: 999, kind: 'forge', x: 7, y: 7 }, 'no-such-unit');
  expectReject(s, 0, { type: 'attack', unit: 999, target: ID.g1 }, 'no-such-unit');
});

test('not-yours: commands for the enemy\'s units are rejected and change nothing', () => {
  const s = makeState();
  const before = JSON.stringify([s.units, s.structures, s.shards]);
  expectReject(s, 0, { type: 'move', unit: ID.w1, x: 3, y: 3 }, 'not-yours');
  expectReject(s, 0, { type: 'stop', unit: ID.g1 }, 'not-yours');
  expectReject(s, 0, { type: 'gather', unit: ID.w1, x: 12, y: 12 }, 'not-yours');
  expectReject(s, 0, { type: 'build', unit: ID.w1, kind: 'forge', x: 7, y: 7 }, 'not-yours');
  expectReject(s, 0, { type: 'attack', unit: ID.g1, target: ID.g0 }, 'not-yours');
  expectReject(s, 0, { type: 'train', building: ID.forge1, kind: 'grunt' }, 'not-yours');
  expectReject(s, 0, { type: 'train', building: ID.core1, kind: 'worker' }, 'not-yours');
  expectReject(s, 1, { type: 'move', unit: ID.w0, x: 3, y: 3 }, 'not-yours');
  assert.equal(JSON.stringify([s.units, s.structures, s.shards]), before);
});

test('wrong-kind: unit or building of the wrong kind for the command', () => {
  const s = makeState();
  expectReject(s, 0, { type: 'gather', unit: ID.g0, x: 12, y: 12 }, 'wrong-kind'); // grunt cannot mine
  expectReject(s, 0, { type: 'build', unit: ID.g0, kind: 'forge', x: 7, y: 7 }, 'wrong-kind'); // grunt cannot build
  expectReject(s, 0, { type: 'build', unit: ID.w0, kind: 'core', x: 7, y: 7 }, 'wrong-kind'); // cores cannot be built
  expectReject(s, 0, { type: 'build', unit: ID.w0, kind: 'banana', x: 7, y: 7 }, 'wrong-kind');
  expectReject(s, 0, { type: 'train', building: ID.core0, kind: 'grunt' }, 'wrong-kind'); // core trains workers only
  expectReject(s, 0, { type: 'train', building: ID.forge0, kind: 'worker' }, 'wrong-kind'); // forge trains combat only
  expectReject(s, 0, { type: 'train', building: ID.forge0, kind: 'banana' }, 'wrong-kind');
  // a unit is not a building; the spec does not say which reason applies
  expectRejectAny(s, 0, { type: 'train', building: ID.g0, kind: 'grunt' }, ['wrong-kind', 'bad-target']);
});

test('off-map: targets outside the 32x32 grid', () => {
  const s = makeState();
  for (const [x, y] of [[-1, 5], [5, -1], [32, 5], [5, 32], [100, 100]]) {
    expectReject(s, 0, { type: 'move', unit: ID.w0, x, y }, 'off-map');
    expectReject(s, 0, { type: 'build', unit: ID.w0, kind: 'forge', x, y }, 'off-map');
  }
  // edge tiles are inside the map
  expectLegal(s, 0, { type: 'move', unit: ID.w0, x: 0, y: 0 });
  expectLegal(s, 0, { type: 'move', unit: ID.w0, x: 31, y: 31 });
});

test('tile-taken: build on rock, crystal, a unit, a structure or an existing site', () => {
  const s = makeState();
  const b = (x, y) => ({ type: 'build', unit: ID.w0, kind: 'forge', x, y });
  expectReject(s, 0, b(20, 20), 'tile-taken'); // rock
  expectReject(s, 0, b(12, 12), 'tile-taken'); // crystal
  expectReject(s, 0, b(14, 12), 'tile-taken'); // empty crystal is still a tile you cannot build on
  expectReject(s, 0, b(6, 6), 'tile-taken'); // own grunt
  expectReject(s, 0, b(25, 25), 'tile-taken'); // enemy grunt
  expectReject(s, 0, b(3, 3), 'tile-taken'); // core
  expectReject(s, 0, b(10, 10), 'tile-taken'); // forge
  expectReject(s, 0, b(8, 20), 'tile-taken'); // site
  assert.equal(s.shards[0], 1000, 'nothing was paid');
});

test('no-shards: build and train need enough Shards', () => {
  const s = makeState({ shards: [0, 0] });
  expectReject(s, 0, { type: 'build', unit: ID.w0, kind: 'forge', x: 7, y: 7 }, 'no-shards');
  expectReject(s, 0, { type: 'build', unit: ID.w0, kind: 'turret', x: 7, y: 7 }, 'no-shards');
  expectReject(s, 0, { type: 'train', building: ID.core0, kind: 'worker' }, 'no-shards');
  expectReject(s, 0, { type: 'train', building: ID.forge0, kind: 'grunt' }, 'no-shards');
  assert.deepEqual(s.shards, [0, 0]);
});

test('no-shards: one Shard short is rejected, exactly enough is accepted', () => {
  const cost = structStat('forge').cost;
  const s = makeState({ shards: [cost - 1, cost] });
  expectReject(s, 0, { type: 'build', unit: ID.w0, kind: 'forge', x: 7, y: 7 }, 'no-shards');
  expectLegal(s, 1, { type: 'build', unit: ID.w1, kind: 'forge', x: 24, y: 24 });
  assert.equal(s.shards[1], 0);
});

test('queue-full: a building holds at most the queue limit', () => {
  const full = Array(QUEUE_MAX).fill('grunt');
  const s = makeState({
    structures: [
      { id: ID.core0, owner: 0, kind: 'core', x: 3, y: 3, complete: true, queue: [] },
      { id: ID.core1, owner: 1, kind: 'core', x: 28, y: 28, complete: true, queue: [] },
      { id: ID.forge0, owner: 0, kind: 'forge', x: 10, y: 10, complete: true, queue: full.slice() },
    ],
  });
  expectReject(s, 0, { type: 'train', building: ID.forge0, kind: 'grunt' }, 'queue-full');
  assert.equal(findEntity(s, ID.forge0).queue.length, QUEUE_MAX);
  assert.equal(s.shards[0], 1000);
});

test('queue-full: can queue up to the limit, one more is rejected', () => {
  const s = makeState();
  for (let i = 0; i < QUEUE_MAX; i++) expectLegal(s, 0, { type: 'train', building: ID.core0, kind: 'worker' });
  assert.equal(findEntity(s, ID.core0).queue.length, QUEUE_MAX);
  expectReject(s, 0, { type: 'train', building: ID.core0, kind: 'worker' }, 'queue-full');
  assert.equal(s.shards[0], 1000 - QUEUE_MAX * unitStat('worker').cost);
});

test('unit-cap: living plus queued units may not go over the cap', () => {
  // 39 living units plus 1 queued = cap. One more train must fail.
  const units = [{ id: 100, owner: 0, kind: 'worker', x: 5, y: 5, order: null }];
  for (let i = 0; i < UNIT_CAP - 2; i++) units.push({ id: 101 + i, owner: 0, kind: 'grunt', x: i % 20, y: 15 + Math.floor(i / 20), order: null });
  const structures = [
    { id: ID.core0, owner: 0, kind: 'core', x: 3, y: 3, complete: true, queue: [] },
    { id: ID.core1, owner: 1, kind: 'core', x: 28, y: 28, complete: true, queue: [] },
    { id: ID.forge0, owner: 0, kind: 'forge', x: 10, y: 10, complete: true, queue: ['grunt'] },
  ];
  const s = makeState({ units, structures });
  assert.equal(s.units.filter((u) => u.owner === 0).length, UNIT_CAP - 1);
  expectReject(s, 0, { type: 'train', building: ID.forge0, kind: 'grunt' }, 'unit-cap');
  expectReject(s, 0, { type: 'train', building: ID.core0, kind: 'worker' }, 'unit-cap');
  assert.equal(s.shards[0], 1000);
});

test('unit-cap: exactly reaching the cap with the queue is allowed', () => {
  const units = [];
  for (let i = 0; i < UNIT_CAP - 2; i++) units.push({ id: 100 + i, owner: 0, kind: 'grunt', x: i % 20, y: 15 + Math.floor(i / 20), order: null });
  const structures = [
    { id: ID.core0, owner: 0, kind: 'core', x: 3, y: 3, complete: true, queue: [] },
    { id: ID.core1, owner: 1, kind: 'core', x: 28, y: 28, complete: true, queue: [] },
    { id: ID.forge0, owner: 0, kind: 'forge', x: 10, y: 10, complete: true, queue: ['grunt'] },
  ];
  const s = makeState({ units, structures });
  expectLegal(s, 0, { type: 'train', building: ID.forge0, kind: 'grunt' }); // 38 + 1 queued + 1 = 40
  expectReject(s, 0, { type: 'train', building: ID.forge0, kind: 'grunt' }, 'unit-cap'); // would be 41
});

test('bad-target: attack and gather need a valid target', () => {
  const s = makeState();
  expectReject(s, 0, { type: 'attack', unit: ID.g0, target: 999 }, 'bad-target'); // nothing there
  expectReject(s, 0, { type: 'attack', unit: ID.g0, target: ID.w0 }, 'bad-target'); // own unit
  expectReject(s, 0, { type: 'attack', unit: ID.g0, target: ID.core0 }, 'bad-target'); // own structure
  expectReject(s, 0, { type: 'attack', unit: ID.g0, target: ID.g0 }, 'bad-target'); // itself
  expectReject(s, 0, { type: 'gather', unit: ID.w0, x: 7, y: 7 }, 'bad-target'); // open tile, no crystal
  expectReject(s, 0, { type: 'gather', unit: ID.w0, x: 14, y: 12 }, 'bad-target'); // empty crystal
  expectReject(s, 0, { type: 'gather', unit: ID.w0, x: 20, y: 20 }, 'bad-target'); // rock
});

test('not-complete: cannot train at a site that is still being built', () => {
  const s = makeState({
    structures: [
      { id: ID.core0, owner: 0, kind: 'core', x: 3, y: 3, complete: true, queue: [] },
      { id: ID.core1, owner: 1, kind: 'core', x: 28, y: 28, complete: true, queue: [] },
      { id: ID.forge0, owner: 0, kind: 'forge', x: 10, y: 10, complete: false, progress: 3, hp: 30, queue: [] },
    ],
  });
  expectReject(s, 0, { type: 'train', building: ID.forge0, kind: 'grunt' }, 'not-complete');
  assert.equal(s.shards[0], 1000);
});

test('too-many: the 101st command in a tick is rejected', () => {
  const s = makeState();
  const cmds = [];
  for (let i = 0; i < MAX_COMMANDS + 1; i++) cmds.push({ type: 'move', unit: ID.w0, x: i % 30, y: 1 });
  s.events = [];
  applyCommands(s, 0, cmds);
  const r = rejects(s);
  assert.equal(r.length, 1);
  assert.equal(r[0].reason, 'too-many');
  assert.equal(r[0].player, 0);
  // The first 100 took effect: the last accepted move was index 99.
  assert.deepEqual({ x: findEntity(s, ID.w0).order.x, y: findEntity(s, ID.w0).order.y }, { x: 99 % 30, y: 1 });
});

test('too-many: exactly 100 commands are all accepted, 150 gives 50 rejects', () => {
  let s = makeState();
  s.events = [];
  applyCommands(s, 0, Array.from({ length: MAX_COMMANDS }, () => ({ type: 'stop', unit: ID.w0 })));
  assert.equal(rejects(s).length, 0);

  s = makeState();
  s.events = [];
  applyCommands(s, 0, Array.from({ length: 150 }, () => ({ type: 'stop', unit: ID.w0 })));
  const r = rejects(s);
  assert.equal(r.length, 50);
  assert.ok(r.every((e) => e.reason === 'too-many'));
});

test('too-many: junk commands count toward the limit, and the limit is per side', () => {
  const s = makeState();
  const junk = Array(MAX_COMMANDS).fill(null);
  s.events = [];
  applyCommands(s, 0, [...junk, { type: 'move', unit: ID.w0, x: 9, y: 9 }]);
  const reasons = rejects(s).map((e) => e.reason);
  assert.equal(reasons.filter((x) => x === 'bad-command').length, MAX_COMMANDS);
  assert.equal(reasons.filter((x) => x === 'too-many').length, 1);
  assert.equal(findEntity(s, ID.w0).order, null, 'the 101st command did nothing');
  // the other side still gets its full allowance
  s.events = [];
  applyCommands(s, 1, Array.from({ length: MAX_COMMANDS }, () => ({ type: 'stop', unit: ID.w1 })));
  assert.equal(rejects(s).length, 0);
});

// ---------------------------------------------------------------- malformed input never throws

test('malformed input never throws', () => {
  const s = makeState();
  const junk = [
    null, undefined, 0, 1, -1, NaN, '', 'string', Symbol.iterator && 'sym', true, false, [], [1, 2], () => 1,
    {}, { type: null }, { type: [] }, { type: {} }, { type: 'move', unit: null, x: null, y: null },
    { type: 'move', unit: {}, x: {}, y: {} }, { type: 'move', unit: ID.w0, x: Infinity, y: -Infinity },
    { type: 'move', unit: ID.w0, x: '5', y: '5' }, { type: 'build', unit: ID.w0, kind: null, x: 1, y: 1 },
    { type: 'build', unit: ID.w0, kind: {}, x: 1, y: 1 }, { type: 'train', building: null, kind: null },
    { type: 'train', building: '1', kind: 'worker' }, { type: 'attack', unit: ID.g0, target: null },
    { type: 'attack', unit: ID.g0, target: {} }, { type: 'gather', unit: ID.w0, x: undefined, y: undefined },
    { type: '__proto__' }, { type: 'constructor' }, { type: 'toString' }, JSON.parse('{"__proto__": {"type": "move"}}'),
    Object.create(null), Object.assign(Object.create(null), { type: 'stop', unit: ID.w0 }),
    { type: 'stop', unit: -1 }, { type: 'stop', unit: 2 ** 53 }, { type: 'stop', unit: 0.5 },
    { type: 'move', unit: ID.core0, x: 1, y: 1 }, // a structure id used as a unit
    { type: 'stop', unit: ID.core0 },
    { type: 'x'.repeat(10000) },
  ];
  for (const bad of junk) {
    assert.doesNotThrow(() => applyCommands(s, 0, [bad]), `threw for ${String(typeof bad)}`);
    assert.doesNotThrow(() => applyCommands(s, 1, [bad]));
  }
  assert.doesNotThrow(() => applyCommands(s, 0, junk));
});

test('malformed command lists never throw', () => {
  const s = makeState();
  for (const list of [null, undefined, 'move', 5, {}, { length: 3 }, [[]], [[[]]], new Array(5), [undefined, null]]) {
    assert.doesNotThrow(() => applyCommands(s, 0, list));
  }
  for (const side of [undefined, null, 2, -1, 'x', 0.5]) {
    assert.doesNotThrow(() => applyCommands(s, side, [{ type: 'stop', unit: ID.w0 }]));
  }
});

test('junk commands leave the state exactly as it was', () => {
  const s = makeState();
  const snap = () => JSON.stringify([s.units, s.structures, s.shards, s.crystals, s.tick]);
  const before = snap();
  applyCommands(s, 0, [null, 'x', 5, {}, { type: 'move' }, { type: 'move', unit: 999, x: 1, y: 1 }]);
  assert.equal(snap(), before);
});

// ---------------------------------------------------------------- legal commands

test('legal move sets the order once and costs nothing', () => {
  const s = makeState();
  expectLegal(s, 0, { type: 'move', unit: ID.w0, x: 9, y: 4 });
  const u = findEntity(s, ID.w0);
  assert.equal(u.order.type, 'move');
  assert.equal(u.order.x, 9);
  assert.equal(u.order.y, 4);
  assert.deepEqual(s.shards, [1000, 1000]);
  assert.equal(spends(s).length, 0);
  // the other side's units are untouched
  assert.equal(findEntity(s, ID.w1).order, null);
});

test('legal attack sets the order for enemy units, structures and unfinished sites', () => {
  for (const target of [ID.g1, ID.core1, ID.forge1, ID.site1]) {
    const s = makeState();
    expectLegal(s, 0, { type: 'attack', unit: ID.g0, target });
    assert.equal(findEntity(s, ID.g0).order.type, 'attack');
    assert.equal(findEntity(s, ID.g0).order.target, target);
  }
  // workers may be ordered to attack too
  const s = makeState();
  expectLegal(s, 0, { type: 'attack', unit: ID.w0, target: ID.g1 });
  assert.equal(findEntity(s, ID.w0).order.type, 'attack');
});

test('legal gather sets the order and costs nothing', () => {
  const s = makeState();
  expectLegal(s, 0, { type: 'gather', unit: ID.w0, x: 12, y: 12 });
  const o = findEntity(s, ID.w0).order;
  assert.equal(o.type, 'gather');
  assert.equal(o.x, 12);
  assert.equal(o.y, 12);
  assert.deepEqual(s.shards, [1000, 1000]);
});

test('legal build spends the cost exactly once and places a site with hp 1', () => {
  for (const kind of ['forge', 'turret']) {
    const s = makeState();
    expectLegal(s, 0, { type: 'build', unit: ID.w0, kind, x: 7, y: 7 });
    const cost = structStat(kind).cost;
    assert.equal(s.shards[0], 1000 - cost, `${kind} cost paid once`);
    assert.equal(s.shards[1], 1000);
    const sp = spends(s);
    assert.equal(sp.length, 1);
    assert.equal(sp[0].player, 0);
    assert.equal(sp[0].amount, cost);
    assert.equal(sp[0].shards, 1000 - cost);
    const site = s.structures.find((t) => t.x === 7 && t.y === 7);
    assert.ok(site, 'site exists on the tile');
    assert.equal(site.kind, kind);
    assert.equal(site.owner, 0);
    assert.equal(site.hp, 1);
    assert.equal(site.progress, 0);
    assert.equal(site.complete, false);
    const w = findEntity(s, ID.w0);
    assert.equal(w.order.type, 'build');
    assert.equal(w.order.site, site.id);
    assert.ok(![ID.core0, ID.core1, ID.w0].includes(site.id), 'fresh id');
  }
});

test('building twice on the same tile pays only once', () => {
  const s = makeState();
  const forge = structStat('forge').cost;
  s.events = [];
  applyCommands(s, 0, [
    { type: 'build', unit: ID.w0, kind: 'forge', x: 7, y: 7 },
    { type: 'build', unit: ID.w0, kind: 'forge', x: 7, y: 7 },
  ]);
  assert.deepEqual(rejects(s).map((r) => r.reason), ['tile-taken']);
  assert.equal(s.shards[0], 1000 - forge);
  assert.equal(s.structures.filter((t) => t.x === 7 && t.y === 7).length, 1);
});

test('legal train spends the cost exactly once and extends the queue', () => {
  const cases = [
    [ID.core0, 'worker'],
    [ID.forge0, 'grunt'],
    [ID.forge0, 'lancer'],
    [ID.forge0, 'brute'],
  ];
  for (const [building, kind] of cases) {
    const s = makeState();
    expectLegal(s, 0, { type: 'train', building, kind });
    const cost = unitStat(kind).cost;
    assert.equal(s.shards[0], 1000 - cost, `${kind} cost paid once`);
    assert.equal(spends(s).length, 1);
    assert.equal(spends(s)[0].amount, cost);
    const q = findEntity(s, building).queue;
    assert.equal(q.length, 1);
    assert.equal(typeof q[0] === 'string' ? q[0] : q[0].kind, kind);
    assert.equal(s.units.length, 4, 'no unit appears immediately');
  }
});

test('legal stop clears the order', () => {
  const s = makeState();
  applyCommands(s, 0, [{ type: 'move', unit: ID.g0, x: 9, y: 9 }]);
  assert.equal(findEntity(s, ID.g0).order.type, 'move');
  expectLegal(s, 0, { type: 'stop', unit: ID.g0 });
  assert.equal(findEntity(s, ID.g0).order, null);
});

test('a new order replaces the old one', () => {
  const s = makeState();
  s.events = [];
  applyCommands(s, 0, [
    { type: 'gather', unit: ID.w0, x: 12, y: 12 },
    { type: 'move', unit: ID.w0, x: 2, y: 9 },
  ]);
  assert.equal(rejects(s).length, 0);
  const o = findEntity(s, ID.w0).order;
  assert.equal(o.type, 'move');
  assert.equal(o.x, 2);
  assert.equal(o.y, 9);
});

test('extra and unknown fields are ignored', () => {
  const s = makeState();
  expectLegal(s, 0, { type: 'move', unit: ID.w0, x: 9, y: 4, colour: 'red', extra: { a: 1 } });
  assert.equal(findEntity(s, ID.w0).order.type, 'move');
});

test('a rejected command does not stop the later legal ones in the same list', () => {
  const s = makeState();
  s.events = [];
  applyCommands(s, 0, [
    null,
    { type: 'move', unit: ID.w1, x: 1, y: 1 },
    { type: 'move', unit: ID.w0, x: 9, y: 4 },
    { type: 'train', building: ID.core0, kind: 'worker' },
  ]);
  assert.deepEqual(rejects(s).map((r) => r.reason), ['bad-command', 'not-yours']);
  assert.equal(findEntity(s, ID.w0).order.type, 'move');
  assert.equal(findEntity(s, ID.core0).queue.length, 1);
  assert.equal(s.shards[0], 1000 - unitStat('worker').cost);
});

test('commands inside one list see the effects of earlier ones (Shards run out)', () => {
  const cost = unitStat('worker').cost;
  const s = makeState({ shards: [cost, 0] });
  s.events = [];
  applyCommands(s, 0, [
    { type: 'train', building: ID.core0, kind: 'worker' },
    { type: 'train', building: ID.core0, kind: 'worker' },
  ]);
  assert.deepEqual(rejects(s).map((r) => r.reason), ['no-shards']);
  assert.equal(s.shards[0], 0);
  assert.equal(findEntity(s, ID.core0).queue.length, 1);
});

// ---------------------------------------------------------------- side order

function contested(tick) {
  const s = makeState({
    units: [
      { id: ID.w0, owner: 0, kind: 'worker', x: 14, y: 14, order: null },
      { id: ID.w1, owner: 1, kind: 'worker', x: 16, y: 16, order: null },
    ],
    structures: [
      { id: ID.core0, owner: 0, kind: 'core', x: 3, y: 3, complete: true, queue: [] },
      { id: ID.core1, owner: 1, kind: 'core', x: 28, y: 28, complete: true, queue: [] },
    ],
  });
  s.tick = tick;
  const forge = structStat('forge').cost;
  const events = step(s, [
    [{ type: 'build', unit: ID.w0, kind: 'forge', x: 15, y: 15 }],
    [{ type: 'build', unit: ID.w1, kind: 'turret', x: 15, y: 15 }],
  ]);
  return { s, events, forge };
}

test('odd tick: side 1 commands are applied before side 0 (both build on one tile)', () => {
  const { s, events, forge } = contested(1);
  assert.equal(s.tick, 2);
  const site = s.structures.find((t) => t.x === 15 && t.y === 15);
  assert.ok(site, 'a site was placed');
  assert.equal(site.owner, 1, 'side 1 got the tile');
  assert.equal(site.kind, 'turret');
  const r = events.filter((e) => e.e === 'reject');
  assert.equal(r.length, 1);
  assert.equal(r[0].player, 0);
  assert.equal(r[0].reason, 'tile-taken');
  assert.equal(s.shards[0], 1000, 'the loser paid nothing');
  assert.equal(s.shards[1], 1000 - structStat('turret').cost);
  assert.ok(forge > 0);
});

test('even tick: side 0 commands are applied before side 1 (both build on one tile)', () => {
  const { s, events } = contested(0);
  assert.equal(s.tick, 1);
  const site = s.structures.find((t) => t.x === 15 && t.y === 15);
  assert.ok(site, 'a site was placed');
  assert.equal(site.owner, 0, 'side 0 got the tile');
  assert.equal(site.kind, 'forge');
  const r = events.filter((e) => e.e === 'reject');
  assert.equal(r.length, 1);
  assert.equal(r[0].player, 1);
  assert.equal(r[0].reason, 'tile-taken');
  assert.equal(s.shards[1], 1000);
  assert.equal(s.shards[0], 1000 - structStat('forge').cost);
});

test('side order alternates: ticks 2 and 3 go to side 0 and side 1', () => {
  assert.equal(contested(2).s.structures.find((t) => t.x === 15 && t.y === 15).owner, 0);
  assert.equal(contested(3).s.structures.find((t) => t.x === 15 && t.y === 15).owner, 1);
});

test('reject events appear in the order the sides were handled', () => {
  const s = makeState();
  s.tick = 1; // odd: side 1 first
  const events = step(s, [
    [{ type: 'move', unit: ID.w1, x: 1, y: 1 }], // side 0 touching side 1's unit
    [{ type: 'move', unit: ID.w0, x: 1, y: 1 }], // side 1 touching side 0's unit
  ]);
  const r = events.filter((e) => e.e === 'reject');
  assert.deepEqual(r.map((e) => e.player), [1, 0]);
  assert.ok(r.every((e) => e.reason === 'not-yours'));
});
