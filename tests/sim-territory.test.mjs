// sim wiring for the territory rules (TERRITORY.md s11): flag-gated, default game untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step } from '../env/sim.mjs';
import { createTerritoryMatch, claimCommand, TERRITORY_SIM } from '../env/sim-territory.mjs';
import { holdCount } from '../env/territory.mjs';

const run = (state, n) => { for (let i = 0; i < n; i++) step(state, [[], []]); };
const hash = (s) => JSON.stringify([s.tick, s.shards, s.units, s.structures, s.result]);
const natural = (s, side = 0) => s.territory.map.reaches.find((r) => r.role === 'natural' && r.side === side);
const worker = (s, side = 0, n = 0) => s.units.filter((u) => u.owner === side && u.kind === 'worker')[n];

test('default createMatch is unchanged: no territory, budget or drift', () => {
  const s = createMatch(5);
  assert.equal(s.territory, undefined);
  assert.equal(s.budget, undefined);
  assert.equal(s.drift, undefined);
  const a = createMatch(5), b = createMatch(5);
  run(a, 60); run(b, 60);
  assert.equal(hash(a), hash(b));
});

test('flagged match is deterministic and turns the rules on', () => {
  const a = createTerritoryMatch(5), b = createTerritoryMatch(5);
  assert.ok(a.territory && a.budget && a.drift);
  run(a, 80); run(b, 80);
  assert.equal(hash(a), hash(b));
});

test('Cores claim their Mains at once: Hold 1 each', () => {
  const s = createTerritoryMatch(5);
  run(s, 2);
  assert.equal(holdCount(s, 0), 1);
  assert.equal(holdCount(s, 1), 1);
});

test('training draws gradually into debt instead of stalling, and ignores the unit cap', () => {
  const s = createTerritoryMatch(5);
  const core = s.structures.find((x) => x.kind === 'core' && x.owner === 0);
  s.shards[0] = 0;
  step(s, [[{ type: 'train', building: core.id, kind: 'worker' }], []]);
  assert.equal(core.queue.length, 1, 'accepted with an empty bank');
  run(s, 40);
  assert.ok(s.units.filter((u) => u.owner === 0).length > 4, 'the worker came out');
  assert.ok(s.shards[0] < 0, 'debt, not a stall');
});

test('claim: a worker walks to the Reach and builds a claim; Hold goes up', () => {
  // The classic map keeps the Natural inside the first cord; on Wheatfield the Lower Farm is past it (cord-limit).
  const s = createTerritoryMatch(5, { map: 'legacy' });
  const reach = natural(s);
  s.shards[0] = 500;
  run(s, 1);
  const before = holdCount(s, 0);
  step(s, [[claimCommand(worker(s).id, reach.id)], []]);
  assert.equal(s.events.find((e) => e.e === 'reject'), undefined);
  assert.ok(s.shards[0] < 500, 'cost is charged');
  assert.equal(s.claims.length, 1);
  assert.equal(s.claims[0].complete, false);
  run(s, 600);
  assert.equal(s.claims[0].complete, true, 'claim finishes');
  assert.equal(holdCount(s, 0), before + 1);
});

test('claim rejections: unknown unit, bad reach, no shards, taken, not yours', () => {
  const s = createTerritoryMatch(5);
  const reach = natural(s);
  const w = worker(s);
  const rej = (cmd, player = 0) => {
    step(s, player === 0 ? [[cmd], []] : [[], [cmd]]);
    return s.events.find((e) => e.e === 'reject')?.reason;
  };
  assert.equal(rej({ type: 'claim', unit: 9999, reach: reach.id }), 'no-such-unit');
  assert.equal(rej({ type: 'claim', unit: w.id, reach: 99 }), 'bad-target');
  assert.equal(rej({ type: 'claim', unit: w.id, reach: 'x' }), 'bad-command');
  s.shards[0] = 10;
  assert.equal(rej({ type: 'claim', unit: w.id, reach: reach.id }), 'no-shards');
  s.shards[0] = 500;
  assert.equal(rej({ type: 'claim', unit: w.id, reach: reach.id }), undefined);
  assert.equal(rej({ type: 'claim', unit: worker(s, 0, 1).id, reach: reach.id }), 'tile-taken');
  assert.equal(rej({ type: 'claim', unit: w.id, reach: reach.id }, 1), 'not-yours');
});

test('claim is a bad-command when the territory rules are off', () => {
  const s = createMatch(5);
  step(s, [[{ type: 'claim', unit: 3, reach: 1 }], []]);
  assert.equal(s.events.find((e) => e.e === 'reject')?.reason, 'bad-command');
});

test('debt pauses claim building', () => {
  const s = createTerritoryMatch(5);
  s.shards[0] = 500;
  step(s, [[claimCommand(worker(s).id, natural(s).id)], []]);
  s.shards[0] = -50;
  run(s, 600);
  assert.equal(s.claims[0].complete, false);
});

test('the territory win ends the match with reason territory', () => {
  const s = createTerritoryMatch(5, { rules: { winCount: 1, winTicks: 5 } });
  run(s, 20);
  assert.equal(s.result?.reason, 'territory');
});

test('drift events fire on their ticks and land in the log', () => {
  const s = createTerritoryMatch(5);
  const ev = s.drift.events[0];
  s.tick = ev.announceTick;
  step(s, [[], []]);
  assert.ok(s.events.some((e) => e.e === 'drift-announce' && e.id === ev.id));
  s.tick = ev.tick;
  step(s, [[], []]);
  assert.ok(s.events.some((e) => e.e === 'drift-apply' && e.id === ev.id));
});

test('lay-track: a Worker lays Track on a free tile next to it, at Hold 2 or more, paying 5 Shards', () => {
  const s = createTerritoryMatch(5);
  const w = worker(s);
  s.shards[0] = 100;
  const spot = { x: w.x + 1, y: w.y };
  const cmd = (x, y, unit = w.id) => ({ type: 'lay-track', unit, x, y });
  const rej = (c, p = 0) => { step(s, p === 0 ? [[c], []] : [[], [c]]); return s.events.find((e) => e.e === 'reject')?.reason; };
  s.holdOverride = () => 1;
  assert.equal(rej(cmd(spot.x, spot.y)), 'tier-locked', 'needs Hold 2');
  s.holdOverride = () => 2;
  assert.equal(rej(cmd(w.x + 5, w.y)), 'too-far');
  assert.equal(rej(cmd(spot.x, spot.y, 9999)), 'no-such-unit');
  assert.equal(rej(cmd(spot.x, spot.y), 1), 'not-yours');
  const bank = s.shards[0];
  assert.equal(rej(cmd(spot.x, spot.y)), undefined);
  assert.equal(s.shards[0], bank - 5);
  assert.equal(s.chain.tracks.length, 1);
  assert.equal(rej(cmd(spot.x, spot.y)), 'tile-taken');
});

test('lay-track is a bad-command when the rules are off', () => {
  const s = createMatch(5);
  step(s, [[{ type: 'lay-track', unit: 3, x: 5, y: 5 }], []]);
  assert.equal(s.events.find((e) => e.e === 'reject')?.reason, 'bad-command');
});

test('TERRITORY_SIM carries the claim numbers', () => {
  assert.equal(TERRITORY_SIM.claimCost, 100);
  assert.equal(TERRITORY_SIM.claimTicks, 480);
});
