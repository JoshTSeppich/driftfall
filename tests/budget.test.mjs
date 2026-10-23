// budget: TERRITORY.md section 9 (no supply cap, training draws gradually into debt, upkeep, debt effects).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../env/budget.mjs';
import { createMatch, step } from '../env/sim.mjs';
import { STATS } from '../env/stats.mjs';

const TPS = B.BUDGET.tps;
const fresh = () => createMatch(7);
const forge = (state, owner = 0) => {
  const s = { id: 900 + state.structures.length, owner, kind: 'forge', x: 5, y: 5, hp: 400, progress: 40, complete: true, queue: [] };
  state.structures.push(s);
  return s;
};
const addUnit = (state, owner, kind, id) => state.units.push({ id, owner, kind, x: 1, y: 1, hp: 10, carrying: 0, order: null });
const clearUnits = (state) => { state.units = []; };

test('off by default: nothing changes and the old rules still apply', () => {
  const s = fresh();
  assert.equal(B.isEnabled(s), false);
  assert.equal(B.chargesUpfront(s), true);
  assert.equal(B.unitCapApplies(s), true);
  const before = JSON.stringify(s.shards);
  B.stepBudget(s);
  assert.equal(JSON.stringify(s.shards), before);
  assert.equal(B.canProgress(s, 0, 'build'), true);
  assert.equal(B.attackCooldownScale(s, 0), 1);
});

test('enabling removes the cap and the upfront charge', () => {
  const s = fresh();
  B.enableBudget(s);
  assert.equal(B.isEnabled(s), true);
  assert.equal(B.chargesUpfront(s), false);
  assert.equal(B.unitCapApplies(s), false);
});

test('upkeep: 10% of cost per minute per combat unit; workers pay none', () => {
  const s = fresh(); clearUnits(s); B.enableBudget(s);
  addUnit(s, 0, 'brute', 1);
  addUnit(s, 0, 'worker', 2);
  addUnit(s, 1, 'grunt', 3);
  assert.equal(B.upkeepPerMinute(s, 0).shards, STATS.units.brute.cost * 0.1);
  assert.equal(B.upkeepPerMinute(s, 1).shards, STATS.units.grunt.cost * 0.1);
  assert.equal(B.upkeepPerMinute(s, 0).flux, 0);
});

test('upkeep is drawn every tick, exactly one minute of it after 60 s', () => {
  const s = fresh(); clearUnits(s); B.enableBudget(s);
  addUnit(s, 0, 'brute', 1);
  s.shards = [1000, 1000];
  for (let i = 0; i < 60 * TPS; i++) { B.stepBudget(s); s.tick += 1; }
  assert.equal(s.shards[0], 1000 - STATS.units.brute.cost * 0.1);
  assert.equal(s.shards[1], 1000);
});

test('training draws cost gradually and exactly over trainTicks, with no upfront charge', () => {
  const s = fresh(); clearUnits(s); B.enableBudget(s);
  const f = forge(s); f.queue.push('brute');
  s.shards = [500, 0];
  const cost = STATS.units.brute.cost, tt = STATS.units.brute.trainTicks;
  const bank = [];
  for (let i = 0; i < tt; i++) {
    B.stepBudget(s);
    // mimic production: the head item counts down, spawning on the last tick
    if (f.training === null || f.training === undefined) f.training = tt;
    f.training -= 1;
    bank.push(s.shards[0]);
    if (f.training === 0) { f.queue.shift(); f.training = null; }
  }
  assert.equal(s.shards[0], 500 - cost);
  assert.ok(bank[0] > bank[bank.length - 1] && bank[0] <= 500, 'draws over time, not all at once');
});

test('training goes into debt instead of pausing', () => {
  const s = fresh(); clearUnits(s); B.enableBudget(s);
  const f = forge(s); f.queue.push('brute');
  s.shards = [0, 0];
  const tt = STATS.units.brute.trainTicks;
  for (let i = 0; i < tt; i++) {
    B.stepBudget(s);
    if (f.training === null || f.training === undefined) f.training = tt;
    f.training -= 1;
    if (f.training === 0) { f.queue.shift(); f.training = null; }
  }
  assert.equal(s.shards[0], -STATS.units.brute.cost);
  assert.equal(B.inDebt(s, 0), true);
  assert.equal(B.canProgress(s, 0, 'train'), true);
});

test('debt pauses construction and research, never training; leaving debt resumes', () => {
  const s = fresh(); B.enableBudget(s);
  s.shards = [-1, 5];
  assert.equal(B.canProgress(s, 0, 'build'), false);
  assert.equal(B.canProgress(s, 0, 'research'), false);
  assert.equal(B.canProgress(s, 0, 'train'), true);
  assert.equal(B.canProgress(s, 1, 'build'), true);
  s.shards[0] = 0;
  assert.equal(B.canProgress(s, 0, 'build'), true);
});

test('weary below -500 only: attack cooldown x4/3 (-25% attack speed)', () => {
  const s = fresh(); B.enableBudget(s);
  s.shards = [-500, -501];
  assert.equal(B.isWeary(s, 0), false);
  assert.equal(B.isWeary(s, 1), true);
  assert.equal(B.attackCooldownScale(s, 0), 1);
  assert.ok(Math.abs(B.attackCooldownScale(s, 1) - 4 / 3) < 1e-9);
});

test('held Reaches cut upkeep 3% each, capped at 30%; Mounds 2% each', () => {
  const s = fresh(); clearUnits(s); B.enableBudget(s);
  addUnit(s, 0, 'brute', 1);
  const base = STATS.units.brute.cost * 0.1;
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(B.upkeepPerMinute(s, 0, { holdCount: 2 }).shards, base * 0.94);
  near(B.upkeepPerMinute(s, 0, { holdCount: 99 }).shards, base * 0.7);
  near(B.upkeepPerMinute(s, 0, { holdCount: 4, moundCount: 3 }).shards, base * (1 - 0.12 - 0.06));
  near(B.upkeepPerMinute(s, 0, { holdCount: 99, moundCount: 99 }).shards, base * 0.4); // total cap 60%
});

test('Coil units pay 20% less while inside a held Reach', () => {
  const s = fresh(); clearUnits(s); B.enableBudget(s);
  addUnit(s, 0, 'brute', 1);
  addUnit(s, 0, 'brute', 2);
  const base = STATS.units.brute.cost * 0.1;
  const opts = { coil: true, inHeldReach: (u) => u.id === 1 };
  assert.ok(Math.abs(B.upkeepPerMinute(s, 0, opts).shards - (base * 0.8 + base)) < 1e-9);
  assert.ok(Math.abs(B.upkeepPerMinute(s, 0, { inHeldReach: () => true }).shards - 2 * base) < 1e-9, 'not Coil: no discount');
});

test('flux costs: units with a {shards, flux} cost draw flux too', () => {
  const s = fresh(); clearUnits(s); B.enableBudget(s);
  s.flux = [100, 0];
  s.units.push({ id: 1, owner: 0, kind: 'howler', x: 1, y: 1, hp: 10, carrying: 0, order: null });
  const opts = { costOf: (k) => (k === 'howler' ? { shards: 150, flux: 100 } : undefined) };
  const up = B.upkeepPerMinute(s, 0, opts);
  assert.equal(up.shards, 15);
  assert.equal(up.flux, 10);
  for (let i = 0; i < 60 * TPS; i++) B.stepBudget(s, opts);
  assert.equal(s.flux[0], 90);
});

test('debt and weary changes are announced once as events', () => {
  const s = fresh(); clearUnits(s); B.enableBudget(s);
  s.shards = [1, 1000];
  s.events = [];
  B.stepBudget(s); assert.equal(s.events.length, 0);
  s.shards[0] = -3;
  B.stepBudget(s); B.stepBudget(s);
  const debts = s.events.filter((e) => e.e === 'debt');
  assert.equal(debts.length, 1);
  assert.deepEqual([debts[0].player, debts[0].on], [0, true]);
  s.shards[0] = -600; B.stepBudget(s);
  assert.equal(s.events.filter((e) => e.e === 'weary' && e.on).length, 1);
  s.shards[0] = 50; B.stepBudget(s);
  assert.equal(s.events.filter((e) => e.e === 'debt' && !e.on).length, 1);
  assert.equal(s.events.filter((e) => e.e === 'weary' && !e.on).length, 1);
});

test('deterministic: same inputs give the same state', () => {
  const run = () => {
    const s = fresh(); B.enableBudget(s);
    const f = forge(s); f.queue.push('grunt', 'lancer');
    for (let i = 0; i < 500; i++) B.stepBudget(s, { holdCount: 2 });
    return JSON.stringify([s.shards, s.budget]);
  };
  assert.equal(run(), run());
});

test('with the real production step: a queued unit spawns and is paid for in full, even from an empty bank', async () => {
  const { stepProduction } = await import('../env/economy.mjs');
  const s = fresh(); B.enableBudget(s);
  const f = forge(s); f.queue.push('grunt', 'grunt');
  s.units = s.units.filter((u) => u.owner !== 0 || u.kind !== 'worker' || false);
  s.shards = [0, 0];
  const before = s.units.length;
  for (let i = 0; i < 200 && f.queue.length; i++) { B.stepBudget(s); stepProduction(s); s.tick += 1; }
  assert.equal(f.queue.length, 0);
  assert.equal(s.units.length, before + 2);
  const balance = s.shards[0] + s.budget.acc[0] / s.budget.scale;
  const paid = 2 * STATS.units.grunt.cost;
  assert.ok(balance <= -paid && balance > -paid - 1, `balance ${balance}: training cost plus a sliver of upkeep`);
});
