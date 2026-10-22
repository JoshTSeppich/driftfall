// Economy: gathering Shards. Written against ENV-SPEC.md sections 3, 8 and 12.
// Runs the real sim (env/sim.mjs) on hand-built maps from env/state.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState, findEntity } from '../env/state.mjs';
import { step } from '../env/sim.mjs';
import { STATS } from '../env/stats.mjs';

// Every number comes from the stats table. If these key names differ, change only this block.
const CARRY = STATS.worker.carry;
const MINE_TICKS = STATS.worker.mineTicks;
const START_SHARDS = STATS.startShards;
const WORKER_HP = STATS.worker.hp;
const CORE_HP = STATS.core.hp;

const CORE = 1;     // side 0's Core, id 1 (spec section 13)
const WORKER = 3;   // side 0's first Worker, id 3
const NO_CMDS = [[], []];

// Side 0 Core at (3,3), one Worker at (4,3) next to it. Crystal fields are passed in by each test.
function makeState(crystals) {
  return createTestState({
    width: 32,
    height: 32,
    rocks: [],
    crystals,
    shards: [START_SHARDS, START_SHARDS],
    units: [
      { id: WORKER, owner: 0, kind: 'worker', x: 4, y: 3, hp: WORKER_HP, carrying: 0, order: null },
    ],
    structures: [
      { id: CORE, owner: 0, kind: 'core', x: 3, y: 3, hp: CORE_HP, progress: 0, complete: true, queue: [] },
    ],
  });
}

// Runs `ticks` steps. The first step carries `first` commands; the rest are empty.
// Before each step it records the Worker's position, order and load, and the side's Shards,
// because mining and delivery are decided from the state at the start of the tick.
function play(state, first, ticks) {
  const frames = [];
  for (let i = 0; i < ticks; i++) {
    const worker = findEntity(state, WORKER);
    const order = worker.order;
    const before = {
      tick: state.tick,
      x: worker.x,
      y: worker.y,
      orderType: order ? order.type : null,
      phase: order ? order.phase : null,
      target: order ? { x: order.x, y: order.y } : null,
      carrying: worker.carrying,
      shards: state.shards[0],
    };
    const events = step(state, i === 0 ? first : NO_CMDS);
    frames.push({ before, events });
  }
  return frames;
}

const allEvents = (frames) => frames.flatMap((f) => f.events);
const eventsOf = (frames, kind) => allEvents(frames).filter((e) => e.e === kind);
const crystalAt = (state, x, y) => state.crystals.find((c) => c.x === x && c.y === y);
const distance = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const gather = (x, y) => ({ type: 'gather', unit: WORKER, x, y });

test('gather: walks next to the tile, mines a load, and the tile amount falls by it', () => {
  const state = makeState([{ x: 8, y: 3, amount: 400 }]);
  const frames = play(state, [gather(8, 3)], 120);

  const mines = eventsOf(frames, 'mine');
  assert.ok(mines.length >= 1, 'at least one load was picked up');
  assert.deepEqual(
    { e: mines[0].e, id: mines[0].id, x: mines[0].x, y: mines[0].y, amount: mines[0].amount, left: mines[0].left },
    { e: 'mine', id: WORKER, x: 8, y: 3, amount: CARRY, left: 400 - CARRY },
  );

  const picked = mines.reduce((sum, e) => sum + e.amount, 0);
  assert.equal(crystalAt(state, 8, 3).amount, 400 - picked, 'tile amount fell by exactly what was picked up');
});

test('gather: mining takes the table number of ticks, always next to the tile', () => {
  const state = makeState([{ x: 8, y: 3, amount: 400 }]);
  const frames = play(state, [gather(8, 3)], 60);

  const m = frames.findIndex((f) => f.events.some((e) => e.e === 'mine'));
  assert.ok(m > 0, 'a mine event happened');

  // Walk back from the pickup tick over every tick that was spent in the mining phase.
  let start = m;
  while (start > 0 && frames[start - 1].before.phase === 'mining') start--;
  assert.equal(m - start + 1, MINE_TICKS, 'mining lasted the table number of ticks, pickup tick included');

  for (let i = start; i <= m; i++) {
    const b = frames[i].before;
    assert.equal(distance(b.x, b.y, 8, 3), 1, `tick ${b.tick}: Worker is next to the tile while mining`);
  }
});

test('gather: delivery happens next to the Core and the side Shards rise by the load', () => {
  const state = makeState([{ x: 8, y: 3, amount: 400 }]);
  const frames = play(state, [gather(8, 3)], 120);

  const d = frames.findIndex((f) => f.events.some((e) => e.e === 'deliver'));
  assert.ok(d > 0, 'a deliver event happened');
  const b = frames[d].before;
  assert.equal(distance(b.x, b.y, 3, 3), 1, 'Worker was next to its Core when it delivered');
  assert.equal(b.carrying, CARRY, 'Worker was carrying a full load');

  const deliver = frames[d].events.find((e) => e.e === 'deliver');
  assert.equal(deliver.id, WORKER);
  assert.equal(deliver.amount, CARRY);
  assert.equal(deliver.shards, b.shards + CARRY, 'event shows the side total after the delivery');
  assert.equal(frames[d + 1].before.shards, deliver.shards, 'the next tick starts with the credited Shards');
});

test('gather: a tile running dry gives a partial load, then the Worker retargets the nearest tile with Shards', () => {
  // A has 4 Shards: a partial load. B is 3 tiles below A. C is far away.
  const state = makeState([
    { x: 8, y: 3, amount: 4 },
    { x: 8, y: 6, amount: 400 },
    { x: 20, y: 20, amount: 400 },
  ]);
  const frames = play(state, [gather(8, 3)], 200);

  const first = eventsOf(frames, 'mine')[0];
  assert.equal(first.x, 8);
  assert.equal(first.y, 3);
  assert.equal(first.amount, 4, 'partial load: only the 4 left on the tile');
  assert.equal(first.left, 0, 'the tile is now empty');
  assert.equal(crystalAt(state, 8, 3).amount, 0);

  // Once the partial load is delivered, the Worker must be heading for B.
  const deliveredIdx = frames.findIndex((f) => f.events.some((e) => e.e === 'deliver'));
  assert.ok(deliveredIdx > 0, 'the partial load was delivered');
  const later = frames.slice(deliveredIdx + 1).find((f) => f.before.target !== null);
  assert.ok(later, 'the Worker has a gather order after the partial load');
  assert.deepEqual(later.before.target, { x: 8, y: 6 }, 'retargeted to the nearest tile that still has Shards');

  // B gets mined; the far tile C is never touched.
  const mines = eventsOf(frames, 'mine');
  assert.ok(mines.some((e) => e.x === 8 && e.y === 6), 'tile B was mined');
  assert.ok(!mines.some((e) => e.x === 20 && e.y === 20), 'far tile C was not touched');
  assert.equal(crystalAt(state, 20, 20).amount, 400);
});

test('gather: a Worker with no tiles left goes idle', () => {
  // One tile with 15 Shards: a full load of 10, then 5 left. After that there is nothing to gather.
  const state = makeState([{ x: 8, y: 3, amount: 15 }]);
  const frames = play(state, [gather(8, 3)], 300);

  const mines = eventsOf(frames, 'mine');
  assert.deepEqual(mines.map((e) => e.amount), [10, 5]);
  assert.equal(crystalAt(state, 8, 3).amount, 0);

  const worker = findEntity(state, WORKER);
  assert.equal(worker.order, null, 'order cleared: the Worker is idle');
  assert.equal(worker.carrying, 0, 'nothing left in its hands');

  // After the last delivery there is no more mining or delivering.
  const lastDeliver = frames.findLastIndex((f) => f.events.some((e) => e.e === 'deliver'));
  const tail = frames.slice(lastDeliver + 1);
  assert.ok(tail.every((f) => f.events.every((e) => e.e !== 'mine' && e.e !== 'deliver')));
});

test('gather: mine and deliver events match each other and the Shards that changed', () => {
  // 25 Shards on the tile: loads of 10, 10 and 5. Then the Worker goes idle.
  const state = makeState([{ x: 8, y: 3, amount: 25 }]);
  const frames = play(state, [gather(8, 3)], 400);

  const mines = eventsOf(frames, 'mine');
  const delivers = eventsOf(frames, 'deliver');

  assert.equal(mines.length, delivers.length, 'one delivery for every pickup');
  const picked = mines.reduce((sum, e) => sum + e.amount, 0);
  const delivered = delivers.reduce((sum, e) => sum + e.amount, 0);
  assert.equal(picked, 25, 'all 25 Shards were picked up');
  assert.equal(delivered, 25, 'all 25 Shards were delivered');
  assert.equal(state.shards[0], START_SHARDS + delivered, 'side Shards rose by exactly what was delivered');
  assert.equal(crystalAt(state, 8, 3).amount, 0);

  // Each mine event's `left` is the tile amount after that pickup.
  let left = 25;
  for (const m of mines) {
    left -= m.amount;
    assert.equal(m.left, left);
  }

  // Each deliver event's `shards` is the side's running total after that delivery.
  let total = START_SHARDS;
  for (const d of delivers) {
    total += d.amount;
    assert.equal(d.shards, total);
  }
});
