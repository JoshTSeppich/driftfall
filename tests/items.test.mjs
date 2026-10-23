// Items for recurring troops (TERRITORY.md section 14): pickups, 2 slots, ranks from kills, Shed Skin + Recall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import {
  enableItems, ITEM_IDS, dropPickup, pickUp, dropFromUnit, stepItems, unitMods, effectiveRank, awardKill,
  onUnitDeath, recall, shedSkins, itemsOf, observeItems, isRooted, stunOnHit,
} from '../env/items.mjs';

const mk = (units = []) => {
  const state = createTestState({
    width: 32, height: 32, shards: [500, 500],
    structures: [{ id: 1, owner: 0, kind: 'core', x: 3, y: 3, hp: 1000 }, { id: 2, owner: 1, kind: 'core', x: 28, y: 28, hp: 1000 }],
    units: [{ id: 10, owner: 0, kind: 'grunt', x: 10, y: 10 }, { id: 11, owner: 0, kind: 'worker', x: 11, y: 10 }, ...units],
  });
  enableItems(state);
  return state;
};
const unit = (s, id) => s.units.find((u) => u.id === id);

test('the nine items exist and every one has a one-line tooltip', () => {
  assert.equal(ITEM_IDS.length, 9);
  for (const id of ITEM_IDS) assert.ok(STATS.items.list[id].line.length > 5, id);
});

test('walking over a pickup collects it; two slots fill, the third stays on the ground', () => {
  const s = mk();
  for (const id of ['fangPolish', 'scalePlating', 'rattleBell']) dropPickup(s, id, 10, 10);
  stepItems(s);
  assert.deepEqual(itemsOf(unit(s, 10)), ['fangPolish', 'scalePlating']);
  assert.equal(s.items.pickups.length, 1);
});

test('workers never carry items; unknown item ids are refused', () => {
  const s = mk();
  const p = dropPickup(s, 'fangPolish', 11, 10);
  stepItems(s);
  assert.equal(s.items.pickups.length, 1);
  assert.equal(pickUp(s, 11, p).reason, 'cannot-carry');
  assert.equal(dropPickup(s, 'nope', 1, 1), null);
});

test('right-click pickup works within the radius only; a full unit can swap a slot', () => {
  const s = mk();
  const far = dropPickup(s, 'crystalMonocle', 20, 20);
  assert.equal(pickUp(s, 10, far).reason, 'too-far');
  const near = dropPickup(s, 'fangPolish', 11, 11);
  assert.equal(pickUp(s, 10, near).ok, true);
  pickUp(s, 10, dropPickup(s, 'scalePlating', 10, 11));
  const third = dropPickup(s, 'rattleBell', 10, 10);
  assert.equal(pickUp(s, 10, third).reason, 'full');
  const r = pickUp(s, 10, third, { replaceSlot: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(itemsOf(unit(s, 10)), ['rattleBell', 'scalePlating']);
  assert.ok(s.items.pickups.some((p) => p.item === 'fangPolish'), 'the swapped-out item lies on the ground');
});

test('dropFromUnit puts the item back on the ground at its feet', () => {
  const s = mk();
  pickUp(s, 10, dropPickup(s, 'fangPolish', 10, 10));
  assert.equal(dropFromUnit(s, 10, 0).ok, true);
  assert.deepEqual(itemsOf(unit(s, 10)), []);
  assert.deepEqual([s.items.pickups[0].x, s.items.pickups[0].y], [10, 10]);
  assert.equal(dropFromUnit(s, 10, 0).reason, 'empty-slot');
});

test('unitMods adds item effects and rank bonuses', () => {
  const s = mk();
  const u = unit(s, 10);
  assert.equal(unitMods(u).damageMul, 1);
  u.items = ['fangPolish', 'crystalMonocle'];
  u.kills = 3;
  const m = unitMods(u);
  assert.ok(Math.abs(m.damageMul - (1 + 0.15 + 0.1)) < 1e-9);
  assert.equal(m.range, 1);
  assert.equal(m.sight, 2);
  assert.ok(Math.abs(m.hpMul - 1.1) < 1e-9);
});

test('ranks come from kills at 3, 8 and 15 and stop at 3; the Amberlight Tooth adds one', () => {
  const s = mk();
  const u = unit(s, 10);
  for (let i = 0; i < 2; i++) awardKill(s, u);
  assert.equal(effectiveRank(u), 0);
  awardKill(s, u);
  assert.equal(effectiveRank(u), 1);
  assert.ok(s.events.some((e) => e.e === 'rank-up' && e.unit === 10 && e.rank === 1));
  for (let i = 0; i < 40; i++) awardKill(s, u);
  assert.equal(effectiveRank(u), 3);
  assert.equal(effectiveRank({ kills: 3, items: ['amberlightTooth'] }), 2);
  assert.equal(effectiveRank({ kills: 15, items: ['amberlightTooth'] }), 3);
});

test('Glowmoss Pouch heals once a second up to full health', () => {
  const s = mk();
  const u = unit(s, 10);
  u.items = ['glowmossPouch'];
  u.hp = 20;
  for (let i = 0; i < 24 * 5; i++) { s.tick++; stepItems(s); }
  assert.equal(u.hp, 25);
  u.hp = 60;
  for (let i = 0; i < 48; i++) { s.tick++; stepItems(s); }
  assert.equal(u.hp, 60);
});

test('Rattle Bell speeds up allies near the bearer, not enemies or far allies', () => {
  const s = mk([{ id: 12, owner: 0, kind: 'grunt', x: 12, y: 10 }, { id: 13, owner: 0, kind: 'grunt', x: 25, y: 10 }, { id: 14, owner: 1, kind: 'grunt', x: 11, y: 11 }]);
  unit(s, 10).items = ['rattleBell'];
  assert.equal(unitMods(unit(s, 12), s).attackSpeed, 1.15);
  assert.equal(unitMods(unit(s, 13), s).attackSpeed, 1);
  assert.equal(unitMods(unit(s, 14), s).attackSpeed, 1);
});

test('Stormglass stuns on the first hit of a fight, then not again until the fight has gone quiet', () => {
  const s = mk();
  unit(s, 10).items = ['stormglassShard'];
  s.tick = 100;
  assert.equal(stunOnHit(s, unit(s, 10)), 12);
  s.tick = 110;
  assert.equal(stunOnHit(s, unit(s, 10)), 0);
  s.tick = 400;
  assert.equal(stunOnHit(s, unit(s, 10)), 12);
});

test('Ironroot Brace roots its bearer', () => {
  const s = mk();
  unit(s, 10).items = ['ironrootBrace'];
  assert.equal(isRooted(unit(s, 10)), true);
  assert.equal(isRooted(unit(s, 11)), false);
});

test('a ranked unit leaves a Shed Skin with its items; an unranked one leaves nothing', () => {
  const s = mk();
  const u = unit(s, 10);
  u.kills = 8; u.items = ['fangPolish'];
  assert.equal(onUnitDeath(s, unit(s, 11)), null);
  const sk = onUnitDeath(s, u);
  assert.equal(sk.rank, 2);
  assert.deepEqual(sk.items, ['fangPolish']);
  assert.equal(shedSkins(s, 0).length, 1);
  assert.equal(shedSkins(s, 1).length, 0);
  assert.deepEqual([sk.x, sk.y], [3, 3], 'at the Nest (the Core)');
});

test('Recall costs half the price, takes the train time, and returns the unit with rank and items', () => {
  const s = mk();
  const u = unit(s, 10);
  u.kills = 15; u.items = ['fangPolish', 'scalePlating'];
  const sk = onUnitDeath(s, u);
  s.units = s.units.filter((x) => x.id !== 10);
  const before = s.shards[0];
  const r = recall(s, 0, sk.id);
  assert.equal(r.ok, true);
  assert.equal(before - s.shards[0], 25);
  assert.equal(r.readyTick, s.tick + STATS.units.grunt.trainTicks);
  assert.equal(shedSkins(s, 0).length, 0, 'the skin is spent');
  while (s.tick < r.readyTick - 1) { s.tick++; stepItems(s); }
  assert.equal(s.units.filter((x) => x.kind === 'grunt').length, 0);
  s.tick++; stepItems(s);
  const back = s.units.find((x) => x.kind === 'grunt');
  assert.ok(back);
  assert.equal(effectiveRank(back), 3);
  assert.deepEqual(back.items, ['fangPolish', 'scalePlating']);
  assert.equal(back.owner, 0);
  assert.ok(s.events.some((e) => e.e === 'recalled' && e.unit === back.id));
});

test('Recall refuses without shards, for the wrong side, for a missing skin; Molting Charm makes it free once', () => {
  const s = mk();
  const u = unit(s, 10);
  u.kills = 3;
  const sk = onUnitDeath(s, u);
  assert.equal(recall(s, 1, sk.id).reason, 'not-yours');
  assert.equal(recall(s, 0, 999).reason, 'no-such-skin');
  s.shards[0] = 10;
  assert.equal(recall(s, 0, sk.id).reason, 'short-shards');
  assert.equal(shedSkins(s, 0).length, 1, 'a refused Recall keeps the skin');

  const t = mk();
  const w = unit(t, 10);
  w.kills = 3; w.items = ['molting', 'fangPolish'];
  const k = onUnitDeath(t, w);
  t.units = t.units.filter((x) => x.id !== 10);
  t.shards[0] = 0;
  const r = recall(t, 0, k.id);
  assert.equal(r.ok, true);
  assert.equal(r.cost, 0);
  while (t.tick < r.readyTick) { t.tick++; stepItems(t); }
  const back = t.units.find((x) => x.kind === 'grunt');
  assert.deepEqual(itemsOf(back), ['fangPolish'], 'the charm is used up');
});

test('the same inputs always produce the same state', () => {
  const run = () => {
    const s = mk();
    dropPickup(s, 'fangPolish', 10, 10);
    for (let i = 0; i < 60; i++) { s.tick++; stepItems(s); }
    const u = unit(s, 10);
    for (let i = 0; i < 9; i++) awardKill(s, u);
    return JSON.stringify([s.items, s.events, s.units]);
  };
  assert.equal(run(), run());
});

test('observeItems shows a side its pickups with tooltips and its own skins', () => {
  const s = mk();
  dropPickup(s, 'fangPolish', 20, 20);
  const o = observeItems(s, 0);
  assert.equal(o.pickups.length, 1);
  assert.equal(o.pickups[0].line, STATS.items.list.fangPolish.line);
  assert.deepEqual(o.shed, []);
});
