import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STATS } from '../env/stats.mjs';
import {
  createInitialState,
  createTestState,
  findEntity,
  unitsOf,
  structuresOf,
  isPassable,
  isFree,
  distance,
  allocId,
  emit,
  observe,
} from '../env/state.mjs';

const mirrorPt = (p) => ({ x: 31 - p.x, y: 31 - p.y });
const pos = (e) => ({ x: e.x, y: e.y });
const key = (p) => `${p.x},${p.y}`;
const sortedKeys = (list) => list.map(key).sort();

// ---------- createInitialState (spec §2, §3, §13) ----------

test('initial state: top-level shape and starting values', () => {
  const s = createInitialState(7);
  assert.equal(s.tick, 0);
  assert.equal(s.seed, 7);
  assert.equal(s.width, 32);
  assert.equal(s.height, 32);
  assert.deepEqual(s.shards, [STATS.match.startShards, STATS.match.startShards]);
  assert.deepEqual(s.events, []);
  assert.equal(s.result, null);
  assert.ok(Array.isArray(s.rocks));
  assert.ok(s.rockSet instanceof Set);
});

test('initial state: ids follow spec §13 (cores 1,2; side 0 workers 3-6; side 1 workers 7-10)', () => {
  const s = createInitialState(1);
  const core0 = s.structures.find((c) => c.kind === 'core' && c.owner === 0);
  const core1 = s.structures.find((c) => c.kind === 'core' && c.owner === 1);
  assert.equal(core0.id, 1);
  assert.equal(core1.id, 2);
  const w0 = unitsOf(s, 0).map((u) => u.id).sort((a, b) => a - b);
  const w1 = unitsOf(s, 1).map((u) => u.id).sort((a, b) => a - b);
  assert.deepEqual(w0, [3, 4, 5, 6]);
  assert.deepEqual(w1, [7, 8, 9, 10]);
  assert.equal(s.nextId, 11);
  // all ids unique
  const all = [...s.units, ...s.structures].map((e) => e.id);
  assert.equal(new Set(all).size, all.length);
});

test('initial state: units and structures are stored in id order', () => {
  const s = createInitialState(3);
  const ids = (l) => l.map((e) => e.id);
  assert.deepEqual(ids(s.units), [...ids(s.units)].sort((a, b) => a - b));
  assert.deepEqual(ids(s.structures), [...ids(s.structures)].sort((a, b) => a - b));
});

test('initial state: cores at (3,3) and (28,28), complete, full hp, empty queue', () => {
  const s = createInitialState(1);
  assert.equal(s.structures.length, 2);
  const core0 = findEntity(s, 1);
  const core1 = findEntity(s, 2);
  assert.deepEqual(pos(core0), { x: 3, y: 3 });
  assert.deepEqual(pos(core1), { x: 28, y: 28 });
  for (const [c, owner] of [[core0, 0], [core1, 1]]) {
    assert.equal(c.kind, 'core');
    assert.equal(c.owner, owner);
    assert.equal(c.hp, STATS.core.hp);
    assert.equal(c.complete, true);
    assert.deepEqual(c.queue, []);
  }
});

test('initial state: four Workers per side at the spec tiles (side 1 mirrored)', () => {
  const s = createInitialState(5);
  const side0 = [{ x: 4, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 5 }];
  const side1 = side0.map(mirrorPt);
  assert.deepEqual(sortedKeys(unitsOf(s, 0).map(pos)), sortedKeys(side0));
  assert.deepEqual(sortedKeys(unitsOf(s, 1).map(pos)), sortedKeys(side1));
  // in listed order: id 3 at (4,3), 4 at (3,4), 5 at (4,4), 6 at (5,5)
  side0.forEach((p, i) => assert.deepEqual(pos(findEntity(s, 3 + i)), p));
  for (const u of s.units) {
    assert.equal(u.kind, 'worker');
    assert.equal(u.hp, STATS.units.worker.hp);
    assert.equal(u.carrying, 0);
    assert.equal(u.order, null);
  }
});

test('initial state: 16 crystal tiles of 400 Shards at the spec coordinates', () => {
  const s = createInitialState(2);
  const side0 = [
    [7, 2], [8, 2], [7, 3], [8, 3], // home field
    [12, 19], [13, 19], [12, 20], [13, 20], // contested field
  ].map(([x, y]) => ({ x, y }));
  const expected = [...side0, ...side0.map(mirrorPt)];
  assert.equal(s.crystals.length, 16);
  assert.deepEqual(sortedKeys(s.crystals), sortedKeys(expected));
  for (const c of s.crystals) assert.equal(c.amount, 400);
});

test('initial state: rocks are mirrored pairs, unique, off cores/workers/crystals, at most 48', () => {
  for (const seed of [1, 7, 12345]) {
    const s = createInitialState(seed);
    assert.ok(s.rocks.length <= 48, 'at most 48 rocks');
    assert.equal(s.rocks.length % 2, 0, 'rocks come in pairs');
    const keys = s.rocks.map(([x, y]) => `${x},${y}`);
    assert.equal(new Set(keys).size, keys.length, 'no duplicate rocks');
    for (const [x, y] of s.rocks) {
      assert.ok(keys.includes(`${31 - x},${31 - y}`), `mirror of ${x},${y}`);
      assert.ok(x >= 0 && x < 32 && y >= 0 && y < 32);
    }
    // nothing placed on an occupied tile
    const taken = new Set([...s.crystals, ...s.units, ...s.structures].map(key));
    for (const [x, y] of s.rocks) assert.ok(!taken.has(`${x},${y}`));
    // rockSet is a faithful cache of rocks
    assert.deepEqual([...s.rockSet].sort(), [...keys].sort());
  }
});

test('initial state: same seed twice is identical, different seeds differ in rocks', () => {
  const strip = (s) => JSON.stringify({ ...s, rockSet: [...s.rockSet].sort() });
  assert.equal(strip(createInitialState(9)), strip(createInitialState(9)));
  assert.notDeepEqual(createInitialState(9).rocks, createInitialState(10).rocks);
});

test('initial state: two calls give independent objects', () => {
  const a = createInitialState(4);
  const b = createInitialState(4);
  a.units[0].hp = 1;
  a.crystals[0].amount = 0;
  a.shards[0] = 0;
  assert.equal(b.units[0].hp, STATS.units.worker.hp);
  assert.equal(b.crystals[0].amount, 400);
  assert.equal(b.shards[0], STATS.match.startShards);
});

// ---------- allocId ----------

test('allocId: returns nextId and never repeats', () => {
  const s = createInitialState(1);
  const first = allocId(s);
  assert.equal(first, 11);
  const seen = new Set([first]);
  let prev = first;
  for (let i = 0; i < 200; i++) {
    const id = allocId(s);
    assert.ok(!seen.has(id), `id ${id} repeated`);
    assert.ok(id > prev, 'ids only go up');
    seen.add(id);
    prev = id;
  }
  assert.equal(s.nextId, prev + 1);
});

test('allocId: never hands out an id already used by an entity in a test state', () => {
  const s = createTestState({
    width: 8, height: 8,
    units: [{ id: 5, owner: 0, kind: 'grunt', x: 1, y: 1 }],
    structures: [{ id: 9, owner: 1, kind: 'core', x: 6, y: 6 }],
  });
  const used = new Set([5, 9]);
  for (let i = 0; i < 20; i++) {
    const id = allocId(s);
    assert.ok(!used.has(id), `id ${id} collides with an existing entity`);
    used.add(id);
  }
});

// ---------- distance ----------

test('distance: larger of |dx| and |dy|', () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 0, y: 0 }), 0);
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 1 }), 3);
  assert.equal(distance({ x: 0, y: 0 }, { x: 1, y: 3 }), 3);
  assert.equal(distance({ x: 5, y: 5 }, { x: 4, y: 4 }), 1); // diagonal neighbour
  assert.equal(distance({ x: 10, y: 2 }, { x: 3, y: 5 }), 7);
  assert.equal(distance({ x: 2, y: 20 }, { x: 4, y: 3 }), 17);
  assert.equal(distance({ x: 7, y: 7 }, { x: 7, y: 7 }), 0);
});

test('distance: symmetric, and works on entities with extra fields', () => {
  const a = { id: 1, x: 2, y: 9, kind: 'grunt' };
  const b = { id: 2, x: 8, y: 4, kind: 'lancer' };
  assert.equal(distance(a, b), 6);
  assert.equal(distance(b, a), 6);
});

// ---------- isPassable / isFree ----------

test('isPassable ignores units; isFree does not', () => {
  const s = createTestState({
    width: 8, height: 8,
    rocks: [[2, 2]],
    crystals: [{ x: 3, y: 3, amount: 50 }],
    units: [{ id: 1, owner: 0, kind: 'grunt', x: 5, y: 5 }],
    structures: [{ id: 2, owner: 1, kind: 'core', x: 6, y: 1 }],
  });
  // plain open tile
  assert.equal(isPassable(s, 0, 0), true);
  assert.equal(isFree(s, 0, 0), true);
  // a unit stands here: passable (units ignored) but not free
  assert.equal(isPassable(s, 5, 5), true);
  assert.equal(isFree(s, 5, 5), false);
  // rock
  assert.equal(isPassable(s, 2, 2), false);
  assert.equal(isFree(s, 2, 2), false);
  // crystal (blocks even when empty)
  assert.equal(isPassable(s, 3, 3), false);
  assert.equal(isFree(s, 3, 3), false);
  // structure
  assert.equal(isPassable(s, 6, 1), false);
  assert.equal(isFree(s, 6, 1), false);
});

test('isPassable: empty crystal still blocks; map edges are not passable outside', () => {
  const s = createTestState({
    width: 6, height: 6,
    crystals: [{ x: 1, y: 1, amount: 0 }],
  });
  assert.equal(isPassable(s, 1, 1), false);
  assert.equal(isPassable(s, -1, 0), false);
  assert.equal(isPassable(s, 0, -1), false);
  assert.equal(isPassable(s, 6, 0), false);
  assert.equal(isPassable(s, 0, 6), false);
  assert.equal(isFree(s, 6, 6), false);
  assert.equal(isPassable(s, 5, 5), true);
});

test('isFree: follows a unit when it is moved or removed', () => {
  const s = createTestState({
    width: 5, height: 5,
    units: [{ id: 1, owner: 0, kind: 'worker', x: 2, y: 2 }],
  });
  assert.equal(isFree(s, 2, 2), false);
  s.units[0].x = 3;
  assert.equal(isFree(s, 2, 2), true);
  assert.equal(isFree(s, 3, 2), false);
  s.units.length = 0;
  assert.equal(isFree(s, 3, 2), true);
});

test('isPassable / isFree on the real initial state', () => {
  const s = createInitialState(1);
  assert.equal(isPassable(s, 3, 3), false); // core
  assert.equal(isPassable(s, 7, 2), false); // crystal
  assert.equal(isPassable(s, 4, 3), true); // worker stands here
  assert.equal(isFree(s, 4, 3), false);
  const [rx, ry] = s.rocks[0];
  assert.equal(isPassable(s, rx, ry), false);
  assert.equal(isFree(s, 0, 0), true);
});

// ---------- lookup helpers ----------

test('findEntity, unitsOf, structuresOf', () => {
  const s = createInitialState(1);
  assert.equal(findEntity(s, 1).kind, 'core');
  assert.equal(findEntity(s, 7).kind, 'worker');
  assert.ok(!findEntity(s, 999));
  assert.equal(unitsOf(s, 0).length, 4);
  assert.equal(unitsOf(s, 1).length, 4);
  assert.ok(unitsOf(s, 0).every((u) => u.owner === 0));
  assert.deepEqual(structuresOf(s, 0).map((c) => c.id), [1]);
  assert.deepEqual(structuresOf(s, 1).map((c) => c.id), [2]);
});

test('emit appends the event object to state.events', () => {
  const s = createInitialState(1);
  emit(s, { e: 'blocked', id: 3 });
  emit(s, { e: 'die', id: 4 });
  assert.deepEqual(s.events, [{ e: 'blocked', id: 3 }, { e: 'die', id: 4 }]);
});

// ---------- observe ----------

test('observe: has exactly the spec §10 fields and the right `you`', () => {
  const s = createInitialState(6);
  s.tick = 12;
  for (const you of [0, 1]) {
    const o = observe(s, you);
    assert.equal(o.you, you);
    assert.equal(o.tick, 12);
    assert.equal(o.width, 32);
    assert.equal(o.height, 32);
    assert.equal(o.unitCap, STATS.match.unitCap);
    assert.equal(o.maxTicks, STATS.match.maxTicks);
    assert.deepEqual(o.rocks, s.rocks);
    assert.deepEqual(o.crystals, s.crystals);
    assert.deepEqual(o.shards, s.shards);
    assert.equal(o.units.length, 8);
    assert.equal(o.structures.length, 2);
  }
});

test('observe: no hidden state leaks (no rockSet, events, seed, nextId, result)', () => {
  const s = createInitialState(6);
  const o = observe(s, 0);
  const allowed = new Set([
    'tick', 'you', 'width', 'height', 'rocks', 'crystals', 'shards',
    'units', 'structures', 'unitCap', 'maxTicks',
  ]);
  for (const k of Object.keys(o)) assert.ok(allowed.has(k), `unexpected observation field "${k}"`);
  for (const k of ['rockSet', 'events', 'seed', 'nextId', 'result']) {
    assert.ok(!(k in o), `"${k}" must not be in the observation`);
  }
  // observations must survive JSON (sent to worker threads) unchanged
  assert.deepEqual(JSON.parse(JSON.stringify(o)), o);
});

test('observe: unit and structure records carry the spec fields', () => {
  const s = createInitialState(6);
  const o = observe(s, 1);
  for (const u of o.units) {
    for (const f of ['id', 'owner', 'kind', 'x', 'y', 'hp', 'carrying', 'order']) {
      assert.ok(f in u, `unit missing ${f}`);
    }
  }
  for (const c of o.structures) {
    for (const f of ['id', 'owner', 'kind', 'x', 'y', 'hp', 'progress', 'complete', 'queue']) {
      assert.ok(f in c, `structure missing ${f}`);
    }
    assert.ok(Array.isArray(c.queue));
  }
});

test('observe: a deep copy - mutating it never changes the state', () => {
  const s = createInitialState(6);
  s.structures[0].queue = ['worker'];
  s.units[0].order = { type: 'move', x: 9, y: 9 };
  const before = JSON.stringify({ ...s, rockSet: [...s.rockSet].sort() });
  const o = observe(s, 0);

  o.tick = 999;
  o.shards[0] = 0;
  o.shards.push(1);
  o.rocks.push([0, 0]);
  if (o.rocks.length) o.rocks[0][0] = -5;
  o.crystals[0].amount = 0;
  o.crystals.pop();
  o.units[0].hp = 1;
  o.units[0].x = 20;
  o.units[0].order.x = 0;
  o.units.pop();
  o.structures[0].queue.push('grunt');
  o.structures[0].hp = 1;
  o.structures.pop();

  assert.equal(JSON.stringify({ ...s, rockSet: [...s.rockSet].sort() }), before);
});

test('observe: later changes to the state do not show up in an old observation', () => {
  const s = createInitialState(6);
  const o = observe(s, 0);
  const snapshot = JSON.stringify(o);
  s.tick = 50;
  s.shards[0] = 3;
  s.units[0].hp = 2;
  s.crystals[0].amount = 1;
  s.rocks.push([1, 1]);
  s.structures[0].queue.push('worker');
  assert.equal(JSON.stringify(o), snapshot);
});

test('observe: two calls return separate objects', () => {
  const s = createInitialState(6);
  const a = observe(s, 0);
  const b = observe(s, 0);
  assert.notEqual(a, b);
  assert.notEqual(a.units, b.units);
  assert.notEqual(a.units[0], b.units[0]);
  assert.notEqual(a.crystals[0], b.crystals[0]);
  assert.notEqual(a.shards, b.shards);
  assert.deepEqual(a, b);
});

// ---------- createTestState ----------

test('createTestState: builds exactly what it is given', () => {
  const s = createTestState({
    width: 10,
    height: 7,
    rocks: [[1, 1], [8, 5]],
    crystals: [{ x: 4, y: 4, amount: 123 }],
    shards: [30, 40],
    units: [
      { id: 3, owner: 0, kind: 'grunt', x: 2, y: 2, hp: 17, carrying: 0, order: { type: 'move', x: 5, y: 5 } },
      { id: 8, owner: 1, kind: 'worker', x: 6, y: 3, hp: 40, carrying: 10, order: null },
    ],
    structures: [
      { id: 1, owner: 0, kind: 'core', x: 0, y: 0, hp: 500, progress: 0, complete: true, queue: ['worker'] },
      { id: 12, owner: 1, kind: 'turret', x: 9, y: 6, hp: 1, progress: 0, complete: false, queue: [] },
    ],
  });
  assert.equal(s.width, 10);
  assert.equal(s.height, 7);
  assert.equal(s.tick, 0);
  assert.deepEqual(s.rocks, [[1, 1], [8, 5]]);
  assert.deepEqual([...s.rockSet].sort(), ['1,1', '8,5']);
  assert.deepEqual(s.crystals, [{ x: 4, y: 4, amount: 123 }]);
  assert.deepEqual(s.shards, [30, 40]);
  assert.deepEqual(s.events, []);
  assert.equal(s.result, null);

  assert.equal(s.units.length, 2);
  assert.equal(s.structures.length, 2);
  const g = findEntity(s, 3);
  assert.equal(g.kind, 'grunt');
  assert.equal(g.owner, 0);
  assert.deepEqual(pos(g), { x: 2, y: 2 });
  assert.equal(g.hp, 17);
  assert.deepEqual(g.order, { type: 'move', x: 5, y: 5 });
  const w = findEntity(s, 8);
  assert.equal(w.carrying, 10);
  const core = findEntity(s, 1);
  assert.equal(core.hp, 500);
  assert.deepEqual(core.queue, ['worker']);
  assert.equal(core.complete, true);
  const site = findEntity(s, 12);
  assert.equal(site.complete, false);
  assert.equal(site.hp, 1);

  // no extra entities invented
  assert.deepEqual(s.units.map((u) => u.id).sort((a, b) => a - b), [3, 8]);
  assert.deepEqual(s.structures.map((c) => c.id).sort((a, b) => a - b), [1, 12]);
  assert.deepEqual(unitsOf(s, 0).map((u) => u.id), [3]);
  assert.deepEqual(structuresOf(s, 1).map((c) => c.id), [12]);
});

test('createTestState: an empty description gives an empty world, not the real map', () => {
  const s = createTestState({ width: 5, height: 5 });
  assert.equal(s.width, 5);
  assert.equal(s.height, 5);
  assert.deepEqual(s.units, []);
  assert.deepEqual(s.structures, []);
  assert.deepEqual(s.rocks, []);
  assert.deepEqual(s.crystals, []);
  assert.equal(s.rockSet.size, 0);
  assert.equal(s.shards.length, 2);
  assert.ok(s.nextId >= 1);
});

test('createTestState: omitted units are not given extra rocks or crystals', () => {
  const s = createTestState({ width: 12, height: 12, units: [{ id: 1, owner: 0, kind: 'lancer', x: 1, y: 1 }] });
  assert.equal(s.rocks.length, 0);
  assert.equal(s.crystals.length, 0);
  assert.equal(s.structures.length, 0);
  assert.equal(s.units.length, 1);
  assert.equal(s.units[0].kind, 'lancer');
  assert.ok(s.units[0].hp > 0, 'hp should be filled from the stats table if not given');
});

test('createTestState: later changes to the description do not leak into the state', () => {
  const desc = {
    width: 6, height: 6,
    rocks: [[1, 1]],
    crystals: [{ x: 2, y: 2, amount: 10 }],
    shards: [5, 6],
    units: [{ id: 1, owner: 0, kind: 'grunt', x: 0, y: 0, hp: 60, carrying: 0, order: null }],
  };
  const s = createTestState(desc);
  desc.rocks.push([3, 3]);
  desc.crystals[0].amount = 999;
  desc.shards[0] = 999;
  desc.units[0].hp = 1;
  assert.equal(s.rocks.length, 1);
  assert.equal(s.crystals[0].amount, 10);
  assert.equal(s.shards[0], 5);
  assert.equal(s.units[0].hp, 60);
});

test('createTestState: allocId continues after the highest given id', () => {
  const s = createTestState({
    width: 6, height: 6,
    units: [{ id: 2, owner: 0, kind: 'grunt', x: 0, y: 0 }, { id: 40, owner: 1, kind: 'grunt', x: 5, y: 5 }],
  });
  assert.ok(allocId(s) > 40);
});
