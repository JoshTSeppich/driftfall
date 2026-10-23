// Market: the Trading House of TERRITORY.md section 12 (scarcity price, per-seller dip, buy spread, stock drain,
// HUD observation). Pure module on hand-built states; sim wiring is a later, flagged step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import { enableChain, creditResource, bankAmount } from '../env/economy.mjs';
import {
  enableMarket, scarcity, sellPrice, buyPrice, quoteSell, sell, buy, stepMarket, observeMarket,
  marketCommand, TRADABLE, MARKET_TPS,
} from '../env/market.mjs';

const M = STATS.market;
const house = (owner, extra = {}) => ({ owner, kind: 'house', x: 6 + owner * 10, y: 6, hp: 400, progress: 0, complete: true, queue: [], ...extra });

function makeState({ houses = [0, 1], rare = [{}, {}] } = {}) {
  const state = createTestState({
    width: 32, height: 32, shards: [100, 100],
    structures: [
      { id: 1, owner: 0, kind: 'core', x: 3, y: 3, hp: 1500, complete: true },
      { id: 2, owner: 1, kind: 'core', x: 28, y: 28, hp: 1500, complete: true },
      ...houses.map((o) => house(o)),
    ],
  });
  enableChain(state);
  enableMarket(state);
  for (const side of [0, 1]) for (const [r, n] of Object.entries(rare[side])) creditResource(state, side, r, n);
  return state;
}
const advance = (state, seconds) => { for (let i = 0; i < seconds * MARKET_TPS; i++) { state.tick++; stepMarket(state); } };

test('off by default: no market until enableMarket', () => {
  const state = createTestState({ width: 8, height: 8 });
  assert.equal(state.market, undefined);
  stepMarket(state); // harmless
  assert.equal(state.market, undefined);
});

test('shards are not tradable; the other seven are', () => {
  assert.deepEqual([...TRADABLE].sort(), ['alloy', 'amberlight', 'flux', 'glowmoss', 'ironroot', 'quakestone', 'stormglass']);
});

test('scarcity follows the formula and is clamped to 0.25 .. 4', () => {
  const state = makeState();
  const t = STATS.resources.ironroot.target;
  assert.equal(scarcity(state, 'ironroot'), M.scarcityMax); // nobody has any: sqrt(100/1)=10 -> 4
  creditResource(state, 0, 'ironroot', t - 1);               // held+market+1 = target -> 1
  assert.equal(scarcity(state, 'ironroot'), 1);
  creditResource(state, 1, 'ironroot', 100 * t);              // a glut
  assert.equal(scarcity(state, 'ironroot'), M.scarcityMin);
  const s2 = makeState({ rare: [{ ironroot: 2 * t }, { ironroot: 2 * t - 1 }] }); // total+1 = 4x target -> 0.5
  assert.ok(Math.abs(scarcity(s2, 'ironroot') - 0.5) < 1e-9);
});

test('a scarce resource sells for more (base x scarcity)', () => {
  const state = makeState({ rare: [{ flux: 600 }, {}] });
  const flux = sellPrice(state, 0, 'flux');
  const iron = sellPrice(state, 0, 'ironroot');
  assert.ok(Math.abs(flux - 2) < 0.05, `flux ${flux}`);          // about base at its target
  assert.ok(Math.abs(iron - 10 * 4) < 1e-9, `ironroot ${iron}`); // 4x base
  const rich = makeState({ rare: [{ stormglass: 400 }, { stormglass: 400 }] });
  const poor = makeState({ rare: [{ stormglass: 3 }, { stormglass: 0 }] });
  assert.ok(sellPrice(poor, 0, 'stormglass') > 2 * sellPrice(rich, 0, 'stormglass'));
});

test('selling a hoard lowers your own price, 1% a unit, and pays the falling price', () => {
  const state = makeState({ rare: [{ glowmoss: 60 }, {}] });
  const before = sellPrice(state, 0, 'glowmoss');
  const q = quoteSell(state, 0, 'glowmoss', 50);
  const r = sell(state, 0, 'glowmoss', 50);
  assert.equal(r.ok, true);
  assert.equal(r.shards, q.shards, 'the quote is what you get');
  assert.ok(r.shards < Math.floor(before * 50), 'dumping 50 pays less than 50 at the opening price');
  const after = sellPrice(state, 0, 'glowmoss');
  assert.ok(Math.abs(after / before - 0.5) < 1e-9, `own price fell from ${before} to ${after}`);
  assert.equal(bankAmount(state, 0, 'glowmoss'), 10);
  assert.equal(bankAmount(state, 0, 'shards'), 100 + r.shards);
  assert.equal(state.market.stock.glowmoss, 50);
});

test('selling in small lots earns more than dumping once the dip has recovered', () => {
  const dump = makeState({ rare: [{ glowmoss: 60 }, {}] });
  const paced = makeState({ rare: [{ glowmoss: 60 }, {}] });
  const a = sell(dump, 0, 'glowmoss', 60).shards;
  let b = 0;
  for (let i = 0; i < 6; i++) { b += sell(paced, 0, 'glowmoss', 10).shards; advance(paced, 60); }
  assert.ok(b > a, `paced ${b} vs dumped ${a}`);
});

test('the dip is per seller: the other side still sees the full price', () => {
  const state = makeState({ rare: [{ stormglass: 40 }, {}] });
  const p1Before = sellPrice(state, 1, 'stormglass');
  sell(state, 0, 'stormglass', 30);
  const p0 = sellPrice(state, 0, 'stormglass');
  const p1 = sellPrice(state, 1, 'stormglass');
  assert.equal(p1, p1Before, 'side 1 is not dipped');
  assert.ok(Math.abs(p0 / p1 - 0.7) < 1e-9, `ratio ${p0 / p1}`);
});

test('the dip recovers over 60 seconds', () => {
  const state = makeState({ rare: [{ quakestone: 20 }, {}] });
  sell(state, 0, 'quakestone', 20);
  const ratio = () => sellPrice(state, 0, 'quakestone') / sellPrice(state, 1, 'quakestone');
  const dipped = ratio();
  assert.ok(Math.abs(dipped - 0.8) < 1e-9);
  advance(state, 30);
  assert.ok(Math.abs(ratio() - 0.9) < 1e-6, `at 30 s ${ratio()}`);
  advance(state, 31);
  assert.equal(ratio(), 1);
});

test('market stock drains 2% a second', () => {
  const state = makeState({ rare: [{ amberlight: 50 }, {}] });
  sell(state, 0, 'amberlight', 50);
  assert.equal(state.market.stock.amberlight, 50);
  advance(state, 1);
  assert.ok(Math.abs(state.market.stock.amberlight - 49) < 1e-9);
  advance(state, 59);
  assert.ok(Math.abs(state.market.stock.amberlight - 50 * Math.pow(0.98, 60)) < 1e-6);
});

test('draining the stock makes the resource scarcer, so its price climbs back', () => {
  const state = makeState({ rare: [{ ironroot: 90 }, {}] });
  const start = sellPrice(state, 1, 'ironroot');
  sell(state, 0, 'ironroot', 90);
  assert.equal(sellPrice(state, 1, 'ironroot'), start, 'moving units bank -> market keeps the total');
  advance(state, 120);
  assert.ok(sellPrice(state, 1, 'ironroot') > start);
});

test('buying costs the sell price plus 25% and draws from market stock', () => {
  const state = makeState({ rare: [{ stormglass: 20 }, {}] });
  state.shards[1] = 1000;
  sell(state, 0, 'stormglass', 20);
  const unit = buyPrice(state, 'stormglass');
  const base = sellPrice(state, 1, 'stormglass');
  assert.ok(Math.abs(unit - base * 1.25) < 1e-9);
  const r = buy(state, 1, 'stormglass', 10);
  assert.equal(r.ok, true);
  assert.equal(bankAmount(state, 1, 'stormglass'), 10);
  assert.equal(state.market.stock.stormglass, 10);
  assert.equal(bankAmount(state, 1, 'shards'), 1000 - r.shards);
  assert.equal(r.shards, Math.ceil(unit * 10));
});

test('buying then selling the same lot is never free money', () => {
  const state = makeState({ rare: [{ alloy: 40 }, {}] });
  state.shards[1] = 5000;
  sell(state, 0, 'alloy', 40);
  const spent = buy(state, 1, 'alloy', 10);
  const got = sell(state, 1, 'alloy', 10);
  assert.ok(got.shards < spent.shards);
});

test('rejections: bad resource, shards, short bank, short stock, short shards, no house, bad amount', () => {
  const state = makeState({ rare: [{ glowmoss: 5 }, {}] });
  assert.equal(sell(state, 0, 'shards', 1).reason, 'not-tradable');
  assert.equal(sell(state, 0, 'nonsense', 1).reason, 'bad-resource');
  assert.equal(sell(state, 0, 'glowmoss', 6).reason, 'short-bank');
  assert.equal(sell(state, 0, 'glowmoss', 0).reason, 'bad-amount');
  assert.equal(sell(state, 0, 'glowmoss', 1.5).reason, 'bad-amount');
  assert.equal(buy(state, 0, 'glowmoss', 1).reason, 'short-stock');
  sell(state, 0, 'glowmoss', 5);
  state.shards[1] = 0;
  assert.equal(buy(state, 1, 'glowmoss', 1).reason, 'short-shards');
  const nohouse = makeState({ houses: [1], rare: [{ flux: 10 }, {}] });
  assert.equal(sell(nohouse, 0, 'flux', 5).reason, 'no-house');
  const building = makeState({ houses: [], rare: [{ flux: 10 }, {}] });
  building.structures.push({ id: 99, owner: 0, kind: 'house', x: 5, y: 5, hp: 1, progress: 3, complete: false, queue: [] });
  assert.equal(sell(building, 0, 'flux', 5).reason, 'no-house', 'an unfinished house does not trade');
  assert.equal(bankAmount(nohouse, 0, 'flux'), 10);
  assert.equal(nohouse.market.stock.flux || 0, 0);
});

test('market commands: sell and buy by the card sizes', () => {
  const state = makeState({ rare: [{ flux: 60 }, {}] });
  assert.deepEqual(M.tradeSizes, [10, 50]);
  const r = marketCommand(state, 0, { type: 'sell', resource: 'flux', amount: 10 });
  assert.equal(r.ok, true);
  assert.equal(bankAmount(state, 0, 'flux'), 50);
  const b = marketCommand(state, 0, { type: 'buy', resource: 'flux', amount: 10 });
  assert.equal(b.ok, true);
  assert.equal(marketCommand(state, 0, { type: 'sell', resource: 'flux' }).reason, 'bad-amount');
  assert.equal(marketCommand(state, 0, { type: 'dance' }).reason, 'unknown-command');
});

test('observeMarket: price, direction and a 2-minute history for every tradable resource', () => {
  const state = makeState({ rare: [{ ironroot: 80 }, {}] });
  advance(state, 5);
  let obs = observeMarket(state, 0);
  assert.deepEqual(Object.keys(obs.resources).sort(), [...TRADABLE].sort());
  const o = obs.resources.ironroot;
  for (const k of ['price', 'buy', 'dir', 'history', 'stock', 'held', 'scarcity']) assert.ok(k in o, k);
  assert.equal(o.dir, 0);
  sell(state, 0, 'ironroot', 80);
  advance(state, 2);
  assert.equal(observeMarket(state, 0).resources.ironroot.dir, -1, 'a falling price points down');
  advance(state, 20);
  assert.equal(observeMarket(state, 0).resources.ironroot.dir, 1, 'a recovering price points up');
  advance(state, 200);
  obs = observeMarket(state, 0);
  assert.equal(obs.resources.ironroot.history.length, 120, 'two minutes of one-second samples, no more');
  assert.equal(obs.house, true);
  assert.equal(observeMarket(makeState({ houses: [1] }), 0).house, false);
});

test('observation is a copy: editing it does not touch the market', () => {
  const state = makeState();
  advance(state, 3);
  const obs = observeMarket(state, 0);
  obs.resources.flux.history.push(999);
  obs.resources.flux.price = -1;
  assert.notEqual(observeMarket(state, 0).resources.flux.price, -1);
  assert.ok(!observeMarket(state, 0).resources.flux.history.includes(999));
});

test('deterministic: the same trades on two states give identical markets', () => {
  const run = () => {
    const state = makeState({ rare: [{ ironroot: 70, flux: 300 }, { glowmoss: 40 }] });
    sell(state, 0, 'ironroot', 50);
    advance(state, 10);
    sell(state, 1, 'glowmoss', 25);
    advance(state, 7);
    state.shards[1] = 900;
    buy(state, 1, 'ironroot', 12);
    sell(state, 0, 'flux', 100);
    advance(state, 40);
    return JSON.stringify([state.market, state.shards, state.rare, observeMarket(state, 0), observeMarket(state, 1)]);
  };
  assert.equal(run(), run());
});

test('quotes and observation do not mutate', () => {
  const state = makeState({ rare: [{ glowmoss: 30 }, {}] });
  const snap = JSON.stringify(state);
  quoteSell(state, 0, 'glowmoss', 30);
  sellPrice(state, 0, 'glowmoss');
  buyPrice(state, 'glowmoss');
  observeMarket(state, 0);
  assert.equal(JSON.stringify(state), snap);
});
