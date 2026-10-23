// Toast as ammo: COMBAT.md sections 1 and 2. Each armed unit holds slices in its slots; one shot spends its attack's
// slices. Idle Crumbs haul slices from the Power Strip's stock to the neediest powered unit along a visible run that
// enemies can raid. Three states: Powered+Fed, Powered+Hungry (moves, cannot fire), Unpowered (cannot move or fire).
// Pure module on hand-built states, OFF until enableAmmo(state). Owner: sonnet (env/ammo.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import { enableToast, addIngredient } from '../env/toast.mjs';
import {
  AMMO_TUNING, ammoOf, enableAmmo, isAmmoOn, setAmmoHooks, addStock, stockOf, stepAmmo, unitState, canMove,
  canFire, spendShot, observeAmmo, recoverable, ticksOf,
} from '../env/ammo.mjs';

const TPS = STATS.clock.ticksPerSecond;
const ARMED = ['grunt', 'lancer', 'brute', 'spiker', 'howler', 'dart'];

function makeState(units = [], extra = {}) {
  return createTestState({
    width: 64, height: 64, shards: [0, 0],
    structures: [
      { id: 1, owner: 0, kind: 'core', x: 3, y: 3, hp: 1500, complete: true },
      { id: 2, owner: 1, kind: 'core', x: 60, y: 60, hp: 1500, complete: true },
    ],
    units,
    ...extra,
  });
}

const crumb = (id, owner, x, y, extra = {}) => ({ id, owner, kind: 'worker', x, y, order: null, ...extra });
const unit = (id, owner, kind, x, y, extra = {}) => ({ id, owner, kind, x, y, order: null, ...extra });

function run(state, ticks) {
  for (let i = 0; i < ticks; i++) {
    stepAmmo(state);
    state.tick += 1;
  }
}

test('ammo is off by default: every check passes and nothing is spent', () => {
  const state = makeState([unit(10, 0, 'grunt', 5, 5)]);
  assert.equal(isAmmoOn(state), false);
  stepAmmo(state);
  assert.equal(unitState(state, state.units[0]), null);
  assert.equal(canFire(state, state.units[0]), true);
  assert.equal(spendShot(state, state.units[0], 99), true);
  assert.equal(observeAmmo(state, 0), null);
});

test('every armed kind holds at least as many slices as its attack costs, so a full unit can always fire', () => {
  for (const kind of ARMED) {
    const row = ammoOf(kind);
    assert.ok(row, `${kind} is armed`);
    assert.ok(row.slots >= row.attack.slices, `${kind}: ${row.slots} slots for a ${row.attack.slices}-slice attack`);
    assert.ok(row.attack.impactMs > 0 && row.attack.impactMs < row.attack.recoverMs, `${kind} impact before recover`);
  }
  assert.equal(ammoOf('grunt').attack.name, 'Pop Shot');
  assert.equal(ammoOf('brute').attack.slices, 4, 'Quad Volley spends four slices');
  assert.equal(ammoOf('worker'), null, 'Crumbs are carriers, not armed');
  assert.equal(ammoOf('core'), null);
});

test('armed units start with full slots and one shot spends one slice', () => {
  const state = makeState([unit(10, 0, 'grunt', 5, 5)]);
  enableAmmo(state, { stock: 0 });
  stepAmmo(state);
  const g = state.units[0];
  assert.equal(observeAmmo(state, 0).units[0].slices, ammoOf('grunt').slots);
  assert.equal(unitState(state, g), 'fed');
  assert.equal(spendShot(state, g, 11), true);
  assert.equal(observeAmmo(state, 0).units[0].slices, ammoOf('grunt').slots - 1);
});

test('a unit that runs out is Powered+Hungry: it can move but cannot fire', () => {
  const state = makeState([unit(10, 0, 'grunt', 5, 5)]);
  enableAmmo(state, { stock: 0 });
  stepAmmo(state);
  const g = state.units[0];
  for (let i = 0; i < ammoOf('grunt').slots; i++) assert.equal(spendShot(state, g, 11), true);
  assert.equal(unitState(state, g), 'hungry');
  assert.equal(canMove(state, g), true);
  assert.equal(canFire(state, g), false);
  assert.equal(spendShot(state, g, 11), false, 'a refused shot spends nothing');
  assert.equal(observeAmmo(state, 0).units[0].slices, 0);
});

test('Quad Volley needs four slices in hand: three is not enough, and a refused volley spends nothing', () => {
  const state = makeState([unit(20, 0, 'brute', 5, 5)]);
  enableAmmo(state, { stock: 0 });
  stepAmmo(state);
  const b = state.units[0];
  state.ammo.slices[20] = 3;
  assert.equal(unitState(state, b), 'hungry');
  assert.equal(spendShot(state, b, 99), false);
  assert.equal(state.ammo.slices[20], 3);
  state.ammo.slices[20] = 4;
  assert.equal(spendShot(state, b, 99), true);
  assert.equal(state.ammo.slices[20], 0);
});

test('an unpowered unit cannot move, fire or be resupplied', () => {
  const state = makeState([crumb(5, 0, 3, 4), unit(10, 0, 'grunt', 5, 5, { order: null })]);
  enableAmmo(state, { stock: 9, reserve: 0 });
  setAmmoHooks(state, { isPowered: (s, u) => u.id !== 10 });
  stepAmmo(state);
  const g = state.units[1];
  state.ammo.slices[10] = 0;
  assert.equal(unitState(state, g), 'unpowered');
  assert.equal(canMove(state, g), false);
  assert.equal(canFire(state, g), false);
  assert.equal(spendShot(state, g, 99), false);
  run(state, 200);
  assert.equal(state.ammo.slices[10], 0, 'nothing is delivered to an unpowered unit');
  assert.equal(observeAmmo(state, 0).runs.length, 0);
});

test('a Crumb hauls slices from the Power Strip to the neediest unit along a visible run', () => {
  const state = makeState([
    crumb(5, 0, 3, 4),
    unit(10, 0, 'grunt', 9, 3),
    unit(11, 0, 'grunt', 9, 9),
  ]);
  enableAmmo(state, { stock: 10, reserve: 2 });
  stepAmmo(state);
  state.ammo.slices[10] = 0; // the first grunt is empty, the second is full
  state.ammo.slices[11] = 0;
  stepAmmo(state);
  const view = observeAmmo(state, 0);
  assert.equal(view.runs.length, 1, 'one idle Crumb, one run');
  const r = view.runs[0];
  assert.equal(r.crumb, 5);
  assert.equal(r.unit, 10, 'lowest id wins a tie on slices');
  assert.equal(r.slices, AMMO_TUNING.crumbCarry);
  assert.deepEqual(r.from, { x: 3, y: 3 }, 'runs start at the Power Strip');
  assert.deepEqual(r.to, { x: 9, y: 3 });
  assert.equal(view.stock.stock, 10 - AMMO_TUNING.crumbCarry, 'the load leaves the stock at pickup');
  assert.equal(view.stock.available, 10 - AMMO_TUNING.crumbCarry - 2);
  assert.ok(r.progress >= 0 && r.progress <= 1);
  const arrive = state.ammo.runs[0].arrive;
  assert.ok(arrive > state.tick, 'the trip takes time');
  while (state.ammo.runs.length) {
    stepAmmo(state);
    state.tick += 1;
  }
  assert.equal(state.ammo.slices[10], AMMO_TUNING.crumbCarry, 'delivered on arrival');
  assert.equal(state.tick - 1, arrive, 'delivered on the tick the run says');
  assert.ok(state.events.some((e) => e.e === 'resupply' && e.unit === 10 && e.slices === AMMO_TUNING.crumbCarry));
});

test('the reserve is never handed out by runs: a stock at the reserve sends nothing', () => {
  const state = makeState([crumb(5, 0, 3, 4), unit(10, 0, 'grunt', 9, 3)]);
  enableAmmo(state, { stock: 2, reserve: 2 });
  stepAmmo(state);
  state.ammo.slices[10] = 0;
  stepAmmo(state);
  assert.equal(observeAmmo(state, 0).runs.length, 0);
  assert.equal(stockOf(state, 0), 2);
});

test('an enemy fighter standing on a run raids it: the load is lost and the Crumb goes home', () => {
  // The lancer stands on the straight line from the Power Strip (3,3) to the grunt at (40,3).
  const state = makeState([crumb(5, 0, 3, 4), unit(10, 0, 'grunt', 40, 3), unit(30, 1, 'lancer', 20, 3)]);
  enableAmmo(state, { stock: 10, reserve: 0 });
  stepAmmo(state);
  state.ammo.slices[10] = 0;
  stepAmmo(state);
  assert.equal(state.ammo.runs.length, 1, 'a run exists');
  let ticks = 0;
  while (state.ammo.runs.length && ticks < 200) {
    stepAmmo(state);
    state.tick += 1;
    ticks += 1;
  }
  assert.equal(state.ammo.runs.length, 0, 'the run is cut');
  assert.equal(state.ammo.slices[10], 0, 'the lost load never arrives');
  const raid = state.events.find((e) => e.e === 'raid');
  assert.ok(raid, 'a raid event is emitted');
  assert.equal(raid.by, 30);
  assert.equal(raid.slices, AMMO_TUNING.crumbCarry);
  assert.ok(state.ammo.busy[5] > state.tick, 'the Crumb is walking home before it can haul again');
});

test('a Crumb killed mid-run spills its load and the run ends', () => {
  const state = makeState([crumb(5, 0, 3, 4), unit(10, 0, 'grunt', 40, 3)]);
  enableAmmo(state, { stock: 10, reserve: 0 });
  stepAmmo(state);
  state.ammo.slices[10] = 0;
  stepAmmo(state);
  state.units = state.units.filter((u) => u.id !== 5);
  state.tick += 1;
  stepAmmo(state);
  assert.equal(state.ammo.runs.length, 0);
  assert.ok(state.events.some((e) => e.e === 'spill' && e.slices === AMMO_TUNING.crumbCarry));
});

test('with no Crumbs alive, a hungry unit gets one reserve slice every lifeline interval', () => {
  const state = makeState([unit(10, 0, 'grunt', 9, 3)]);
  enableAmmo(state, { stock: 2, reserve: 2 });
  stepAmmo(state);
  state.ammo.slices[10] = 0;
  run(state, AMMO_TUNING.lifelineSeconds * TPS + 1);
  assert.equal(state.ammo.slices[10], 1, 'one lifeline slice, once the need has lasted one interval');
  assert.equal(stockOf(state, 0), 1);
  const hit = state.events.find((e) => e.e === 'lifeline');
  assert.ok(hit && hit.unit === 10);
  run(state, AMMO_TUNING.lifelineSeconds * TPS);
  assert.equal(state.ammo.slices[10], 2, 'the next lifeline slice arrives after the interval');
});

test('a broke side with no Crumbs and no toast is doled a Crumb, so it can always rebuild', () => {
  const state = makeState([unit(10, 0, 'grunt', 9, 3)]);
  enableAmmo(state, { stock: 0, reserve: 0 });
  state.ammo.slices[10] = 0;
  assert.equal(recoverable(state, 0), true, 'the Power Strip can dole a Crumb');
  run(state, AMMO_TUNING.doleSeconds * TPS + 1);
  const crumbs = state.units.filter((u) => u.owner === 0 && u.kind === 'worker');
  assert.equal(crumbs.length, 1, 'a dole Crumb appears');
  assert.ok(state.events.some((e) => e.e === 'dole' && e.side === 0));
});

test('no dole while the side can afford a Crumb from its shards', () => {
  const state = makeState([unit(10, 0, 'grunt', 9, 3)], { shards: [STATS.units.worker.cost, 0] });
  enableAmmo(state, { stock: 0, reserve: 0 });
  state.ammo.slices[10] = 0;
  run(state, AMMO_TUNING.doleSeconds * TPS + 1);
  assert.equal(state.units.filter((u) => u.owner === 0 && u.kind === 'worker').length, 0);
});

test('the toast stack is the stock when toast is on, and a player-specific stock otherwise', () => {
  const state = makeState([crumb(5, 0, 3, 4)]);
  enableAmmo(state, { stock: 0 });
  addStock(state, 0, 3);
  assert.equal(stockOf(state, 0), 3);
  assert.equal(state.ammo.stock[0], 3);
  const withToast = makeState([crumb(5, 0, 3, 4)]);
  enableToast(withToast);
  enableAmmo(withToast);
  withToast.toast.stack[0] = 4;
  assert.equal(stockOf(withToast, 0), 4, 'reads the bakery stack');
  assert.equal(addIngredient(withToast, 0, 'flour', 1), true, 'toast still bakes from ingredients');
});

test('a shot emits an attack event with its timing in ticks; impact lands inside the 340-410 ms beat', () => {
  const state = makeState([unit(10, 0, 'grunt', 5, 5)]);
  enableAmmo(state, { stock: 0 });
  stepAmmo(state);
  state.events = [];
  spendShot(state, state.units[0], 99);
  const shot = state.events.find((e) => e.e === 'shot');
  assert.ok(shot, 'a shot event');
  assert.equal(shot.id, 10);
  assert.equal(shot.target, 99);
  assert.equal(shot.attack, 'Pop Shot');
  assert.equal(shot.slices, 1);
  assert.equal(shot.impactTicks, ticksOf(375));
  assert.equal(shot.recoverTicks, ticksOf(520));
  assert.equal(ticksOf(520), Math.round(520 * TPS / 1000));
  assert.ok(shot.impactTicks >= ticksOf(340) && shot.impactTicks <= ticksOf(410));
});

test('the same state and the same inputs give the same runs and events', () => {
  const build = () => {
    const s = makeState([crumb(5, 0, 3, 4), crumb(6, 0, 4, 4), unit(10, 0, 'grunt', 9, 3), unit(11, 0, 'brute', 9, 9)]);
    enableAmmo(s, { stock: 20, reserve: 2 });
    for (let i = 0; i < 300; i++) {
      if (i === 1) {
        s.ammo.slices[10] = 0;
        s.ammo.slices[11] = 0;
      }
      stepAmmo(s);
      s.tick += 1;
    }
    return { runs: s.ammo.runs, events: s.ammo.events, slices: s.ammo.slices, stock: s.ammo.stock };
  };
  assert.deepEqual(build(), build());
});

test('recoverable: a side with any fed unit, a Crumb, toast, or the means to dole can always rebuild', () => {
  const state = makeState([unit(10, 0, 'grunt', 5, 5)]);
  enableAmmo(state, { stock: 0, reserve: 0 });
  stepAmmo(state);
  assert.equal(recoverable(state, 0), true, 'a full unit is fed');
  state.ammo.slices[10] = 0;
  assert.equal(recoverable(state, 0), true, 'the Power Strip can still dole');
  state.structures = state.structures.filter((s) => s.owner !== 0);
  assert.equal(recoverable(state, 0), false, 'no Power Strip, no recovery');
});
