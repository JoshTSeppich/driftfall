// Toast Economy: TERRITORY.md sections 17 and 18. Toast is baked at the Power Strip from Flour + Water + Energy; every
// combat unit eats one Toast a minute; an unfed unit goes on strike; a unit that wants a topping and gets plain toast
// is grumpy; a unit fed what it wants is happy. Pure module on hand-built states, OFF until enableToast(state).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import { enableChain, creditResource, bankAmount } from '../env/economy.mjs';
import { TRADABLE } from '../env/market.mjs';
import {
  enableToast, isToastOn, addIngredient, stepToast, canAttack, toastAttackScale, observeToast,
  wantedTopping, TOPPINGS, GOURMET, TOAST,
} from '../env/toast.mjs';

const TPS = STATS.clock.ticksPerSecond;
const MEAL = TOAST.mealSeconds * TPS;
const BAKE = TOAST.bakeSeconds * TPS;

function makeState({ chain = false, units = [], core = true } = {}) {
  const state = createTestState({
    width: 32, height: 32, shards: [100, 100],
    structures: core ? [
      { id: 1, owner: 0, kind: 'core', x: 3, y: 3, hp: 1500, complete: true },
      { id: 2, owner: 1, kind: 'core', x: 28, y: 28, hp: 1500, complete: true },
    ] : [],
    units,
  });
  // createTestState keeps only the basic unit fields, so kills (rank) are copied across here.
  for (const u of units) if (u.kills !== undefined) state.units.find((x) => x.id === u.id).kills = u.kills;
  if (chain) enableChain(state);
  enableToast(state);
  return state;
}

const unit = (id, owner, kind = 'grunt', extra = {}) => ({ id, owner, kind, x: 5, y: 5, hp: 60, ...extra });
const tickOnce = (state) => { stepToast(state); state.tick += 1; };
const advance = (state, n) => { for (let i = 0; i < n; i++) tickOnce(state); };
const bake = (state, side = 0) => { addIngredient(state, side, 'flour', 1); addIngredient(state, side, 'water', 1); addIngredient(state, side, 'energy', 1); };

test('off by default: no toast state until enableToast, and every hook is neutral', () => {
  const state = createTestState({ width: 8, height: 8, units: [unit(100, 0)] });
  assert.equal(isToastOn(state), false);
  assert.equal(state.toast, undefined);
  stepToast(state); // harmless
  assert.equal(addIngredient(state, 0, 'flour', 1), false);
  assert.equal(canAttack(state, state.units[0]), true);
  assert.equal(toastAttackScale(state, state.units[0]), 1);
  assert.equal(observeToast(state, 0), null);
});

test('the topping table maps every topping onto a tradable market resource, one each', () => {
  const resources = Object.values(TOPPINGS);
  assert.equal(new Set(resources).size, resources.length);
  for (const r of resources) assert.ok(TRADABLE.includes(r), `${r} is tradable`);
  assert.deepEqual(TOPPINGS, { butter: 'flux', jam: 'glowmoss', honey: 'amberlight', salt: 'quakestone', sugar: 'stormglass', nutbutter: 'ironroot' });
  assert.deepEqual([...GOURMET].sort(), ['honey', 'nutbutter', 'salt', 'sugar']);
});

test('taste rises with rank: plain, butter, jam, then a gourmet topping', () => {
  const needs = STATS.items.rank.killsFor;
  assert.equal(needs.length, 3, 'three ranks above plain');
  const at = (rank, id = 100) => {
    const kills = rank === 0 ? 0 : needs[rank - 1];
    return unit(id, 0, 'grunt', { kills });
  };
  assert.equal(wantedTopping(at(0)), null);
  assert.equal(wantedTopping(at(1)), 'butter');
  assert.equal(wantedTopping(at(2)), 'jam');
  assert.ok(GOURMET.includes(wantedTopping(at(3))));
});

test('addIngredient takes only flour, water and energy, whole positive amounts', () => {
  const state = makeState();
  assert.equal(addIngredient(state, 0, 'flour', 2), true);
  assert.equal(state.toast.pantry[0].flour, 2);
  assert.equal(addIngredient(state, 0, 'shards', 1), false);
  assert.equal(addIngredient(state, 0, 'water', 0), false);
  assert.equal(addIngredient(state, 0, 'water', 1.5), false);
  assert.equal(state.toast.pantry[0].water, 0);
});

test('the Power Strip bakes one Toast when all three ingredients are in, then waits for its cadence', () => {
  const state = makeState();
  addIngredient(state, 0, 'flour', 2);
  addIngredient(state, 0, 'water', 2);
  advance(state, 1);
  assert.equal(state.toast.stack[0], 0, 'energy missing: nothing baked');
  addIngredient(state, 0, 'energy', 2);
  advance(state, 1);
  assert.equal(state.toast.stack[0], 1);
  assert.deepEqual(state.toast.pantry[0], { flour: 1, water: 1, energy: 1 });
  advance(state, BAKE - 1);
  assert.equal(state.toast.stack[0], 1, 'the next bake waits for the cadence');
  advance(state, 1);
  assert.equal(state.toast.stack[0], 2);
});

test('no Power Strip, no baking', () => {
  const state = makeState({ core: false });
  bake(state, 0);
  advance(state, BAKE + 2);
  assert.equal(state.toast.stack[0], 0);
});

test('a unit eats one Toast on its first step and then once a minute', () => {
  const state = makeState({ units: [unit(100, 0)] });
  bake(state, 0); advance(state, 1); // tick 0: one Toast is baked and the grunt eats it on the same tick
  assert.equal(state.toast.stack[0], 0, 'the grunt ate it');
  assert.equal(state.toast.units[100].mood, 'happy', 'plain toast is what a rank-0 unit wants');
  assert.equal(state.toast.eaten[0].length, 1);
  bake(state, 0); // ingredients for the next Toast; it bakes at its cadence, well before the next meal
  advance(state, MEAL - 2); // ticks 1 .. MEAL-2
  assert.equal(state.toast.stack[0], 1, 'baked, but not yet hungry again');
  advance(state, 1); // tick MEAL-1: still not due
  assert.equal(state.toast.stack[0], 1);
  advance(state, 1); // tick MEAL: due, so it eats
  assert.equal(state.toast.stack[0], 0, 'fed again after one minute');
});

test('an unfed unit goes on strike, cannot attack, and ends the strike the moment toast arrives', () => {
  const state = makeState({ units: [unit(100, 0)] });
  advance(state, 2);
  assert.equal(state.toast.units[100].mood, 'strike');
  assert.equal(canAttack(state, state.units[0]), false);
  assert.equal(toastAttackScale(state, state.units[0]), 1, 'a striker has no speed change, it does not attack');
  bake(state, 0); advance(state, 1);
  assert.equal(state.toast.units[100].mood, 'happy');
  assert.equal(canAttack(state, state.units[0]), true);
});

test('a rank-1 unit fed plain toast when it wants butter is grumpy: attacks 15% slower', () => {
  const kills = STATS.items.rank.killsFor[0];
  const state = makeState({ units: [unit(100, 0, 'grunt', { kills })] });
  bake(state, 0); advance(state, 1);
  assert.equal(state.toast.units[100].mood, 'grumpy');
  assert.equal(canAttack(state, state.units[0]), true, 'grumpy still fights');
  assert.ok(Math.abs(toastAttackScale(state, state.units[0]) - 100 / 85) < 1e-9);
});

test('a rank-1 unit fed buttered toast is happy: 10% faster, and the butter is paid from the bank', () => {
  const kills = STATS.items.rank.killsFor[0];
  const state = makeState({ chain: true, units: [unit(100, 0, 'grunt', { kills })] });
  creditResource(state, 0, TOPPINGS.butter, 3);
  bake(state, 0); advance(state, 1);
  assert.equal(state.toast.units[100].mood, 'happy');
  assert.ok(Math.abs(toastAttackScale(state, state.units[0]) - 100 / 110) < 1e-9);
  assert.equal(bankAmount(state, 0, TOPPINGS.butter), 2, 'one butter paid for one meal');
});

test('a unit with no bank for its topping is grumpy even on a chain-enabled side', () => {
  const kills = STATS.items.rank.killsFor[0];
  const state = makeState({ chain: true, units: [unit(100, 0, 'grunt', { kills })] });
  bake(state, 0); advance(state, 1);
  assert.equal(state.toast.units[100].mood, 'grumpy');
  assert.equal(bankAmount(state, 0, TOPPINGS.butter), 0);
});

test('workers never eat toast and never strike', () => {
  const state = makeState({ units: [unit(100, 0, 'worker')] });
  advance(state, MEAL * 2);
  assert.equal(state.toast.units[100], undefined);
  assert.equal(canAttack(state, state.units[0]), true);
  assert.equal(state.toast.eaten[0].length, 0);
});

test('dead units leave the registry', () => {
  const state = makeState({ units: [unit(100, 0), unit(101, 0)] });
  advance(state, 1);
  state.units = state.units.filter((u) => u.id !== 100);
  advance(state, 1);
  assert.equal(state.toast.units[100], undefined);
  assert.ok(state.toast.units[101]);
});

test('observeToast reports the stack, per-minute flow, and each unit\'s mood and wanted topping', () => {
  const kills = STATS.items.rank.killsFor[1];
  const state = makeState({ units: [unit(100, 0, 'grunt', { kills }), unit(101, 0), unit(200, 1)] });
  bake(state, 0); advance(state, 1); // one Toast: the first unit in id order eats it, the other goes on strike
  const view = observeToast(state, 0);
  assert.equal(view.stack, 0);
  assert.equal(view.perMinute.in, 1);
  assert.equal(view.perMinute.eaten, 1);
  assert.deepEqual(view.units.map((u) => u.id), [100, 101]);
  assert.equal(view.units[0].wants, 'jam');
  assert.equal(view.units[0].rank, 2);
  assert.equal(view.units[0].mood, 'grumpy');
  assert.equal(view.units[1].wants, 'plain');
  assert.equal(view.units[1].mood, 'strike');
  assert.deepEqual(view.pantry, { flour: 0, water: 0, energy: 0 });
});

test('the per-minute counters look back one minute only', () => {
  const state = makeState({ units: [unit(100, 0)] });
  bake(state, 0); advance(state, 1);
  advance(state, TOAST.mealSeconds * TPS + 1);
  assert.equal(observeToast(state, 0).perMinute.in, 0);
  assert.equal(observeToast(state, 0).perMinute.eaten, 0);
});

test('deterministic: the same inputs give the same HUD after a long run', () => {
  const run = () => {
    const state = makeState({ chain: true, units: [unit(100, 0), unit(101, 0, 'brute', { kills: 2 }), unit(200, 1)] });
    creditResource(state, 0, TOPPINGS.jam, 1);
    for (let t = 0; t < 10 * MEAL; t++) {
      if (t % (BAKE / 2) === 0) bake(state, 0);
      tickOnce(state);
    }
    return JSON.stringify(observeToast(state, 0));
  };
  assert.equal(run(), run());
});
