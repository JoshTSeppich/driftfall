// Toaster Wars sim (Joshua, 09:27: "remember they're toasters?"). Owner: sonnet (env/stats.mjs ROSTER, env/bakery.mjs).
// The roster is data, old kinds are aliases, the territory match runs hunger + cords by default, and the cord and the
// hunger rules end the old 15-second melee rush on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS, UNIT_KINDS, STRUCTURE_KINDS, ROSTER, canonKind, toasterName, rowOf } from '../env/stats.mjs';
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { step } from '../env/sim.mjs';
import { isAmmoOn, unitState, stockOf } from '../env/ammo.mjs';
import { isToastOn } from '../env/toast.mjs';

const unit = (s, o) => {
  const u = { id: s.nextId++, carrying: 0, order: null, ...o };
  u.hp ??= STATS.units[u.kind].hp;
  s.units.push(u);
  return u;
};
const tick = (s, n = 1, cmds = [[], []]) => { for (let i = 0; i < n; i++) step(s, cmds); };
const strip = (s, side) => s.structures.find((x) => x.kind === 'core' && x.owner === side);

test('the roster names all seven toasters and the Power Strip, and old kinds are aliases', () => {
  const names = ROSTER.units.map((r) => r.name);
  for (const n of ['Crumb', 'Popper', 'Zapper', 'Four-Slice', 'Broiler', 'Flak Popper', 'Bagel']) assert.ok(names.includes(n), n);
  assert.equal(canonKind('crumb'), 'worker');
  assert.equal(canonKind('popper'), 'grunt');
  assert.equal(canonKind('zapper'), 'lancer');
  assert.equal(canonKind('four-slice'), 'brute');
  assert.equal(canonKind('fourslice'), 'brute');
  assert.equal(canonKind('broiler'), 'howler');
  assert.equal(canonKind('flak popper'), 'spiker');
  assert.equal(canonKind('bagel'), 'dart');
  assert.equal(canonKind('power strip'), 'core');
  assert.equal(canonKind('grunt'), 'grunt'); // old names still load
  assert.equal(canonKind('nonsense'), null);
  assert.equal(toasterName('worker'), 'Crumb');
  assert.equal(toasterName('core'), 'Power Strip');
  assert.equal(toasterName('mill'), 'Mill');
  for (const r of ROSTER.units) assert.ok(UNIT_KINDS.includes(r.kind), r.kind + ' is a sim unit');
});

test('every roster unit has a full data row, and the base is a Power Strip that costs the match', () => {
  for (const r of ROSTER.units) {
    const row = rowOf({ ammo: {} }, r.kind); // the Toaster-Wars numbers
    for (const f of ['cost', 'hp', 'damage', 'range', 'speed', 'trainTicks']) assert.ok(Number.isFinite(row[f]), r.kind + '.' + f);
    assert.ok(row.shot && row.shot.every >= 1 && row.shot.damage > 0, r.kind + ' has a shot');
  }
  for (const k of ['mill', 'well', 'toaster']) assert.ok(STRUCTURE_KINDS.includes(k), k + ' is buildable');
  assert.ok(STATS.toaster.coreHp >= 2000, 'the Power Strip is not a 15 s target');
  assert.equal(STATS.units.grunt.range, 1, 'the classic numbers are untouched for old tests and saves');
  assert.equal(STATS.units.dart.ammo, false, 'Bagel needs power but no slices');
});

test('the default territory match runs hunger, toast and cords', () => {
  const s = createTerritoryMatch(7);
  assert.ok(isAmmoOn(s), 'ammo on');
  assert.ok(isToastOn(s), 'toast on');
  assert.ok(s.power, 'cords on');
  assert.ok(stockOf(s, 0) > 0, 'each Strip starts with a little toast');
});

test('fed Popper fires, spends a slice per shot and goes hungry when empty', () => {
  const s = createTerritoryMatch(7);
  const a = strip(s, 0);
  s.units = s.units.filter((u) => u.kind !== 'worker'); // no Crumbs to resupply it mid-test
  const p = unit(s, { owner: 0, kind: 'grunt', x: a.x + 2, y: a.y + 2 });
  const dummy = unit(s, { owner: 1, kind: 'worker', x: a.x + 4, y: a.y + 2, hp: 2000 });
  tick(s, 1);
  assert.equal(unitState(s, p), 'fed');
  const slots = s.ammo.slices[p.id];
  tick(s, 60);
  assert.ok(dummy.hp < 2000, 'the Popper hit something');
  assert.ok(s.ammo.slices[p.id] < slots, 'shots cost slices');
  s.ammo.slices[p.id] = 0;
  const hpBefore = dummy.hp;
  s.ammo.stock = [0, 0]; s.toast.stack = [0, 0];
  tick(s, 24);
  assert.equal(unitState(s, p), 'hungry');
  assert.equal(dummy.hp, hpBefore, 'a hungry Popper cannot fire');
});

test('an attack is a shot, not a hit every tick: the cadence is the unit stat', () => {
  const s = createTerritoryMatch(7);
  const a = strip(s, 0);
  const p = unit(s, { owner: 0, kind: 'grunt', x: a.x + 2, y: a.y + 2 });
  const dummy = unit(s, { owner: 1, kind: 'worker', x: a.x + 3, y: a.y + 2, hp: 2000 });
  let hits = 0;
  for (let i = 0; i < 60; i++) { hits += step(s, [[], []]).filter((e) => e.e === 'hit' && e.by === p.id).length; }
  const every = rowOf(s, 'grunt').shot.every;
  assert.ok(hits >= 1 && hits <= Math.ceil(60 / every) + 1, 'hits ' + hits + ' for every ' + every);
});

test('an unpowered toaster cannot fire', () => {
  const s = createTerritoryMatch(7);
  const a = strip(s, 0);
  const p = unit(s, { owner: 0, kind: 'grunt', x: a.x + 2, y: a.y + 2 });
  const dummy = unit(s, { owner: 1, kind: 'worker', x: a.x + 3, y: a.y + 2, hp: 2000 });
  p.power = { state: 'down', anchor: null, battery: 0 };
  tick(s, 40);
  assert.equal(unitState(s, p), 'unpowered');
  assert.equal(dummy.hp, 2000);
});

test('Bagel needs power but no slices', () => {
  const s = createTerritoryMatch(7);
  const a = strip(s, 0);
  const b = unit(s, { owner: 0, kind: 'dart', x: a.x + 2, y: a.y + 2 });
  const dummy = unit(s, { owner: 1, kind: 'worker', x: a.x + 3, y: a.y + 2, hp: 2000 });
  s.ammo.stock = [0, 0]; s.toast.stack = [0, 0];
  tick(s, 40);
  assert.ok(dummy.hp < 2000, 'the Bagel bumps with an empty pantry');
  b.power = { state: 'down', anchor: null, battery: 0 };
  const hp = dummy.hp;
  tick(s, 40);
  assert.equal(dummy.hp, hp, 'an unpowered Bagel does nothing');
});

test('Broiler shell and Flak burst splash onto neighbours', () => {
  for (const kind of ['howler', 'spiker']) {
    const s = createTerritoryMatch(7);
    const a = strip(s, 0);
    unit(s, { owner: 0, kind, x: a.x + 2, y: a.y + 2 });
    const mainT = unit(s, { owner: 1, kind: 'worker', x: a.x + 4, y: a.y + 2, hp: 2000 });
    const near = unit(s, { owner: 1, kind: 'worker', x: a.x + 4, y: a.y + 3, hp: 2000 });
    tick(s, 80);
    assert.ok(mainT.hp < 2000 && near.hp < 2000, kind + ' splashed');
  }
});

test('Mill, Well and Toaster turn wheat, water and power into toast', () => {
  const s = createTerritoryMatch(7);
  const a = strip(s, 0);
  const site = (kind, dx, dy) => { s.structures.push({ id: s.nextId++, owner: 0, kind, x: a.x + dx, y: a.y + dy, hp: STATS.structures[kind].hp, progress: 0, complete: true, queue: [] }); };
  site('mill', 3, 0); site('well', 3, 2); site('toaster', 3, 4);
  s.shards[0] = 500;
  s.bakery.water = null; // this test's Well is not by the river; the dry-Well rule has its own test
  const before = stockOf(s, 0);
  tick(s, 24 * 60);
  assert.ok(stockOf(s, 0) > before, 'toast stack grew: ' + before + ' -> ' + stockOf(s, 0));
  assert.ok(s.shards[0] < 500, 'the Mill ground some wheat');
});

test('the cord and hunger end the old 15 second melee rush', () => {
  // Eight Poppers a side-length away from the enemy Strip: they run out of cord and slices long before 15 s of fighting.
  const s = createTerritoryMatch(7);
  const a = strip(s, 0), b = strip(s, 1);
  const raiders = [];
  for (let i = 0; i < 8; i++) raiders.push(unit(s, { owner: 0, kind: 'grunt', x: a.x + 1 + (i % 4), y: a.y + 3 + Math.floor(i / 4) }));
  for (const r of raiders) r.order = { type: 'move', x: b.x, y: b.y };
  tick(s, 24 * 15);
  assert.ok(strip(s, 1) && strip(s, 1).hp === STATS.toaster.coreHp, 'the Power Strip is untouched at 15 s');
  assert.equal(s.result, null);
});
