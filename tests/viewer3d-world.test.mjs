import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld } from '../viewer3d/world.mjs';
import { replayTo } from '../viewer/replay.mjs';

const log = JSON.parse(readFileSync(new URL('../matches/sample-7.json', import.meta.url), 'utf8'));
const world = createWorld(log);

// A tiny hand-made fight so hits, deaths and builds are covered whatever the sample match contains.
const base = {
  stats: { units: { grunt: { hp: 60 }, lancer: { hp: 40 } }, structures: { forge: { hp: 400, buildTicks: 40 } } },
  initial: {
    tick: 0, width: 8, height: 8, rocks: [], crystals: [], shards: [0, 0],
    units: [
      { id: 1, owner: 0, kind: 'grunt', x: 2, y: 2, hp: 60, carrying: 0, order: null },
      { id: 2, owner: 1, kind: 'lancer', x: 5, y: 2, hp: 40, carrying: 0, order: null },
    ],
    structures: [],
  },
  ticks: [
    { tick: 0, commands: [[], []], events: [
      { e: 'move', id: 1, x: 3, y: 2 },
      { e: 'spawn', structure: { id: 3, owner: 0, kind: 'forge', x: 1, y: 1, hp: 10, progress: 0, complete: false, queue: [] } },
    ] },
    { tick: 1, commands: [[], []], events: [
      { e: 'hit', id: 1, by: 2, dmg: 10, hp: 50 },
      { e: 'hit', id: 2, by: 1, dmg: 8, hp: 32 },
      { e: 'progress', id: 3, progress: 20, hp: 200 },
    ] },
    { tick: 2, commands: [[], []], events: [
      { e: 'hit', id: 2, by: 1, dmg: 40, hp: 0 },
      { e: 'die', id: 2 },
      { e: 'progress', id: 3, progress: 40, hp: 400 },
      { e: 'done', id: 3 },
    ] },
  ],
  result: { winner: 0, reason: 'test', tick: 3 },
};
const mini = createWorld(base);

test('tick count and map come from the log', () => {
  assert.equal(world.ticks, log.ticks.length);
  assert.equal(world.map.width, log.initial.width);
  assert.equal(world.map.crystals.length, log.initial.crystals.length);
  assert.equal(world.result.tick, log.result.tick);
});

test('stateAt matches replayTo at several ticks, forwards and backwards', () => {
  for (const t of [0, 1, 37, 400, 1999, 2000, 120, 5, 0]) {
    assert.deepEqual(world.stateAt(t), replayTo(log, t), `tick ${t}`);
  }
  assert.equal(world.stateAt(-5).tick, 0);
  assert.equal(world.stateAt(99999).tick, 2000);
});

test('frame(t) returns prev at floor and next at the following tick, with alpha', () => {
  const f = world.frame(10.25);
  assert.equal(f.tick, 10);
  assert.equal(f.alpha, 0.25);
  assert.equal(f.prev.tick, 10);
  assert.equal(f.next.tick, 11);
  const exact = world.frame(10);
  assert.equal(exact.alpha, 0);
});

test('frame clamps at both ends and survives junk', () => {
  const first = world.frame(-3);
  assert.equal(first.tick, 0);
  const last = world.frame(5000);
  assert.equal(last.tick, 2000);
  assert.equal(last.alpha, 0);
  assert.deepEqual(last.events, []);
  assert.equal(world.frame(NaN).tick, 0);
});

test('unit positions interpolate between ticks', () => {
  let checked = 0;
  for (let t = 0; t < 400 && checked < 5; t++) {
    const a = world.stateAt(t), b = world.stateAt(t + 1);
    for (const ub of b.units) {
      const ua = a.units.find((u) => u.id === ub.id);
      if (!ua || (ua.x === ub.x && ua.y === ub.y)) continue;
      const f = world.frame(t + 0.5).units.find((u) => u.id === ub.id);
      assert.ok(Math.abs(f.x - (ua.x + ub.x) / 2) < 1e-9);
      assert.ok(Math.abs(f.y - (ua.y + ub.y) / 2) < 1e-9);
      assert.equal(f.moving, true);
      checked++;
      break;
    }
  }
  assert.ok(checked >= 3, 'found moving units in the sample match');
});

test('frame events equal the log events of the next tick, in order', () => {
  for (const t of [3, 20, 150, 800]) {
    const f = world.frame(t + 0.4);
    const raw = log.ticks[t].events;
    assert.equal(f.events.length, raw.length);
    f.events.forEach((e, i) => assert.equal(e.e, raw[i].e));
  }
});

test('sample match: deliveries carry the unit position and owner', () => {
  let found = 0;
  for (let t = 0; t < 600 && !found; t++) {
    for (const e of world.frame(t).groups.deliver) {
      assert.ok(e.at && Number.isFinite(e.at.x));
      assert.ok(e.owner === 0 || e.owner === 1);
      assert.ok(e.amount > 0);
      found++;
    }
  }
  assert.ok(found > 0);
});

test('every unit has a finite facing and a health fraction in 0..1', () => {
  for (const t of [0, 100, 700, 1500]) {
    for (const u of world.frame(t + 0.5).units) {
      assert.ok(Number.isFinite(u.facing));
      assert.ok(u.hpFrac >= 0 && u.hpFrac <= 1);
    }
  }
});

test('structures: a finished Core is full progress', () => {
  const core = world.frame(5).structures.find((s) => s.kind === 'core');
  assert.ok(core);
  assert.equal(core.progressFrac, 1);
});

test('fight: hits know who hit whom, ranged hits are flagged, deaths keep the dead entity', () => {
  const f1 = mini.frame(1.5);
  assert.equal(f1.groups.hit.length, 2);
  const hit = f1.groups.hit.find((h) => h.by === 2);
  assert.equal(hit.id, 1);
  assert.equal(hit.ranged, true);
  assert.equal(hit.from.kind, 'lancer');
  assert.equal(hit.to.x, 3);
  const g = f1.units.find((u) => u.id === 1);
  assert.equal(g.hurt, true);
  assert.equal(g.damage, 10);
  assert.equal(f1.units.find((u) => u.id === 2).attacking, true);

  const f2 = mini.frame(2.5);
  const die = f2.groups.die[0];
  assert.equal(die.id, 2);
  assert.equal(die.kind, 'lancer');
  assert.equal(die.owner, 1);
  assert.equal(die.entity.hp, 32);
  assert.equal(f2.dying.length, 1);
  assert.equal(f2.dying[0].id, 2);
  assert.equal(f2.next.units.length, 1);
  assert.equal(f2.units.length, 2, 'the dying unit is still drawn this tick');
});

test('fight: attackers face their target and movers face where they went', () => {
  const east = 0;
  assert.ok(Math.abs(mini.facingAt(1, 1) - east) < 1e-9, 'moved east');
  assert.ok(Math.abs(mini.facingAt(2, 2) - Math.PI) < 1e-9, 'lancer hit a unit to its west');
  assert.equal(mini.facingAt(999, 2, 7), 7, 'unknown ids use the fallback');
});

test('builds: start, progress fraction and finish are reported', () => {
  const f0 = mini.frame(0.5);
  assert.equal(f0.groups.buildStart.length, 1);
  const site = f0.structures.find((s) => s.id === 3);
  assert.equal(site.born, true);
  assert.equal(site.progressFrac, 0);

  const f1 = mini.frame(1.5);
  const mid = f1.structures.find((s) => s.id === 3);
  assert.ok(Math.abs(mid.progressFrac - (10 / 40)) < 1e-9, 'halfway between 0 and 20 of 40');

  const f2 = mini.frame(2.5);
  assert.equal(f2.groups.buildDone.length, 1);
  const done = f2.structures.find((s) => s.id === 3);
  assert.equal(done.progressFrac, 1);
  assert.equal(done.buildDoneNow, true);
});

test('unknown kinds and unknown events pass through without throwing', () => {
  const odd = createWorld({
    ...base,
    initial: { ...base.initial, units: [{ id: 1, owner: 0, kind: 'wraith', x: 1, y: 1, hp: 5 }] },
    ticks: [{ tick: 0, commands: [[], []], events: [{ e: 'mystery', id: 1 }, { e: 'move', id: 1, x: 2, y: 1 }] }],
  });
  const f = odd.frame(0.5);
  assert.equal(f.groups.other.length, 1);
  assert.equal(f.units[0].kind, 'wraith');
  assert.equal(f.units[0].x, 1.5);
});

test('scrubbing every 97th tick back and forth stays consistent', () => {
  const order = [];
  for (let t = 0; t <= 2000; t += 97) order.push(t);
  for (const t of [...order, ...order.reverse()]) {
    assert.equal(world.frame(t).prev.tick, Math.min(t, 2000));
  }
});
