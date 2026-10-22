// Combat targeting: who attacks whom (spec section 7).
// Real modules only: env/state.mjs, env/combat.mjs, env/stats.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS } from '../env/stats.mjs';
import { createTestState, findEntity as lookup } from '../env/state.mjs';
import { stepCombat, chooseTarget } from '../env/combat.mjs';

// STATS shape is agreed informally as STATS.units[kind] / STATS.structures[kind]; accept a flat STATS[kind] too.
const stat = (kind) => STATS.units?.[kind] ?? STATS.structures?.[kind] ?? STATS[kind];

// findEntity returns null for a missing id; treat null and undefined alike.
const findEntity = (state, id) => lookup(state, id) ?? undefined;
const unit = (id, owner, kind, x, y, order = null, extra = {}) =>
  ({ id, owner, kind, x, y, hp: stat(kind).hp, carrying: 0, order, ...extra });
const structure = (id, owner, kind, x, y, extra = {}) =>
  ({ id, owner, kind, x, y, hp: stat(kind).hp, progress: 0, complete: true, queue: [], ...extra });

function world({ units = [], structures = [] }) {
  return createTestState({ width: 20, height: 20, rocks: [], crystals: [], shards: [0, 0], units, structures });
}
const hpOf = (state, id) => findEntity(state, id)?.hp;
const hitsBy = (state, by) => state.events.filter((e) => e.e === 'hit' && e.by === by);
const idOf = (r) => (r && typeof r === 'object' ? r.id : r);

// ---------- idle combat units ----------

test('idle Grunt hits an enemy next to it, including diagonally', () => {
  const s = world({ units: [unit(1, 0, 'grunt', 5, 5), unit(2, 1, 'brute', 6, 6)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp - stat('grunt').damage);
});

test('idle Grunt does not hit an enemy outside its range', () => {
  const s = world({ units: [unit(1, 0, 'grunt', 5, 5), unit(2, 1, 'brute', 7, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp);
  assert.equal(hitsBy(s, 1).length, 0);
});

test('idle Lancer hits at its full range and not one tile further', () => {
  const r = stat('lancer').range;
  const s = world({ units: [unit(1, 0, 'lancer', 2, 5), unit(2, 1, 'brute', 2 + r, 5), unit(3, 1, 'brute', 2, 5 + r + 1)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp - stat('lancer').damage);
  assert.equal(hpOf(s, 3), stat('brute').hp);
});

test('idle Brute attacks too', () => {
  const s = world({ units: [unit(1, 0, 'brute', 5, 5), unit(2, 1, 'brute', 5, 6)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp - stat('brute').damage);
});

test('idle units never move on their own', () => {
  const s = world({ units: [unit(1, 0, 'grunt', 2, 2), unit(2, 1, 'brute', 12, 12)] });
  stepCombat(s);
  assert.deepEqual([findEntity(s, 1).x, findEntity(s, 1).y], [2, 2]);
  assert.deepEqual([findEntity(s, 2).x, findEntity(s, 2).y], [12, 12]);
  assert.equal(findEntity(s, 1).order, null);
});

test('idle units never hit their own side', () => {
  const s = world({ units: [unit(1, 0, 'grunt', 5, 5), unit(2, 0, 'brute', 5, 6)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp);
  assert.equal(hitsBy(s, 1).length, 0);
});

test('idle unit with no enemy in range makes no hit events', () => {
  const s = world({ units: [unit(1, 0, 'lancer', 5, 5)] });
  stepCombat(s);
  assert.equal(s.events.filter((e) => e.e === 'hit').length, 0);
});

test('idle unit can hit an enemy structure in range', () => {
  const s = world({ units: [unit(1, 0, 'grunt', 5, 5)], structures: [structure(2, 1, 'forge', 6, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('forge').hp - stat('grunt').damage);
});

// ---------- nearest, then lower id ----------

test('idle Lancer picks the nearer of two enemies, even when the farther one has the lower id', () => {
  const s = world({ units: [unit(1, 0, 'lancer', 5, 5), unit(3, 1, 'brute', 8, 5), unit(9, 1, 'brute', 6, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 9), stat('brute').hp - stat('lancer').damage);
  assert.equal(hpOf(s, 3), stat('brute').hp);
});

test('nearest uses max(|dx|,|dy|): a diagonal enemy counts as distance 1', () => {
  const s = world({ units: [unit(1, 0, 'lancer', 5, 5), unit(2, 1, 'brute', 7, 5), unit(8, 1, 'brute', 6, 6)] });
  stepCombat(s);
  assert.equal(hpOf(s, 8), stat('brute').hp - stat('lancer').damage);
  assert.equal(hpOf(s, 2), stat('brute').hp);
});

test('equal distance: the lower enemy id is hit, whatever order the arrays are in', () => {
  // listed with the higher id first on purpose
  const s = world({ units: [unit(8, 1, 'brute', 7, 5), unit(1, 0, 'lancer', 5, 5), unit(6, 1, 'brute', 3, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 6), stat('brute').hp - stat('lancer').damage);
  assert.equal(hpOf(s, 8), stat('brute').hp);
});

test('equal distance between a unit and a structure: lower id wins', () => {
  const s = world({
    units: [unit(1, 0, 'lancer', 5, 5), unit(7, 1, 'brute', 7, 5)],
    structures: [structure(4, 1, 'forge', 3, 5)],
  });
  stepCombat(s);
  assert.equal(hpOf(s, 4), stat('forge').hp - stat('lancer').damage);
  assert.equal(hpOf(s, 7), stat('brute').hp);
});

test('chooseTarget agrees: nearest first, lower id on a tie', () => {
  const s = world({ units: [unit(1, 0, 'lancer', 5, 5), unit(8, 1, 'brute', 7, 5), unit(6, 1, 'brute', 5, 7), unit(9, 1, 'brute', 6, 5)] });
  assert.equal(idOf(chooseTarget(s, findEntity(s, 1))), 9);
  s.units = s.units.filter((u) => u.id !== 9);
  assert.equal(idOf(chooseTarget(s, findEntity(s, 1))), 6);
});

test('each attacker chooses its own nearest target', () => {
  const s = world({
    units: [unit(1, 0, 'grunt', 2, 2), unit(2, 0, 'grunt', 10, 10), unit(3, 1, 'brute', 3, 2), unit(4, 1, 'brute', 11, 10)],
  });
  stepCombat(s);
  assert.equal(hpOf(s, 3), stat('brute').hp - stat('grunt').damage);
  assert.equal(hpOf(s, 4), stat('brute').hp - stat('grunt').damage);
});

// ---------- Workers and non-combat orders ----------

test('an idle Worker never attacks', () => {
  const s = world({ units: [unit(1, 0, 'worker', 5, 5), unit(2, 1, 'brute', 6, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp);
  assert.equal(hitsBy(s, 1).length, 0);
});

test('a Worker with an attack order does attack', () => {
  const s = world({ units: [unit(1, 0, 'worker', 5, 5, { type: 'attack', target: 2 }), unit(2, 1, 'brute', 6, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp - stat('worker').damage);
});

const quietOrders = {
  move: { type: 'move', x: 15, y: 15 },
  gather: { type: 'gather', x: 15, y: 15, phase: 'toField', ticks: 0 },
  build: { type: 'build', site: 50 },
};
for (const kind of ['grunt', 'lancer', 'brute', 'worker']) {
  for (const [name, order] of Object.entries(quietOrders)) {
    test(`a ${kind} with a ${name} order does not auto-attack an adjacent enemy`, () => {
      const s = world({ units: [unit(1, 0, kind, 5, 5, { ...order }), unit(2, 1, 'brute', 6, 5)] });
      stepCombat(s);
      assert.equal(hpOf(s, 2), stat('brute').hp);
      assert.equal(hitsBy(s, 1).length, 0);
      assert.deepEqual(findEntity(s, 1).order, order, 'combat must not touch a non-attack order');
    });
  }
}

test('an attack order beats a nearer enemy: only the ordered target is hit', () => {
  const s = world({ units: [unit(1, 0, 'lancer', 5, 5, { type: 'attack', target: 3 }), unit(2, 1, 'brute', 6, 5), unit(3, 1, 'brute', 8, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 3), stat('brute').hp - stat('lancer').damage);
  assert.equal(hpOf(s, 2), stat('brute').hp);
});

test('an attack order with the target out of range deals no damage in the combat phase', () => {
  const s = world({ units: [unit(1, 0, 'grunt', 5, 5, { type: 'attack', target: 2 }), unit(2, 1, 'brute', 12, 5), unit(3, 1, 'brute', 5, 6)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp);
  assert.equal(hpOf(s, 3), stat('brute').hp, 'ordered units do not fall back to a nearer bystander');
  assert.ok(findEntity(s, 1).order, 'order stays while the target lives');
});

// ---------- Turrets ----------

test('a complete Turret hits an enemy within its range for its damage', () => {
  const t = stat('turret');
  const s = world({ structures: [structure(1, 0, 'turret', 5, 5)], units: [unit(2, 1, 'brute', 5 + t.range, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp - t.damage);
});

test('a Turret does not hit an enemy one tile outside its range', () => {
  const t = stat('turret');
  const s = world({ structures: [structure(1, 0, 'turret', 5, 5)], units: [unit(2, 1, 'brute', 5 + t.range + 1, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp);
});

test('an unfinished Turret (a site) does not attack', () => {
  const s = world({
    structures: [structure(1, 0, 'turret', 5, 5, { hp: 1, complete: false, progress: 0 })],
    units: [unit(2, 1, 'brute', 6, 5)],
  });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp);
  assert.equal(hitsBy(s, 1).length, 0);
});

test('a half-built Turret still does not attack', () => {
  const half = Math.floor(stat('turret').buildTicks / 2);
  const s = world({
    structures: [structure(1, 0, 'turret', 5, 5, { hp: 70, complete: false, progress: half })],
    units: [unit(2, 1, 'brute', 6, 5)],
  });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp);
});

test('a Turret picks the nearest enemy, and the lower id on a tie', () => {
  const t = stat('turret');
  const s = world({
    structures: [structure(1, 0, 'turret', 8, 8)],
    units: [unit(9, 1, 'brute', 10, 8), unit(5, 1, 'brute', 8, 10), unit(7, 1, 'brute', 8, 4), unit(6, 1, 'brute', 11, 8)],
  });
  stepCombat(s);
  assert.equal(hpOf(s, 5), stat('brute').hp - t.damage, 'ids 5 and 9 tie at distance 2; 5 is lower');
  assert.equal(hpOf(s, 9), stat('brute').hp);
  assert.equal(hpOf(s, 7), stat('brute').hp);
  assert.equal(hpOf(s, 6), stat('brute').hp);
});

test('a Turret ignores friendly units', () => {
  const s = world({ structures: [structure(1, 0, 'turret', 5, 5)], units: [unit(2, 0, 'brute', 6, 5)] });
  stepCombat(s);
  assert.equal(hpOf(s, 2), stat('brute').hp);
});

test('a Turret can shoot an enemy construction site', () => {
  const t = stat('turret');
  const s = world({
    structures: [structure(1, 0, 'turret', 5, 5), structure(2, 1, 'forge', 7, 5, { hp: 100, complete: false, progress: 10 })],
  });
  stepCombat(s);
  assert.equal(hpOf(s, 2), 100 - t.damage);
});

test('Turrets and units all fire in the same tick (damage is summed)', () => {
  const t = stat('turret');
  const s = world({
    structures: [structure(1, 0, 'turret', 5, 5)],
    units: [unit(2, 0, 'grunt', 6, 6), unit(3, 1, 'brute', 6, 5)],
  });
  stepCombat(s);
  assert.equal(hpOf(s, 3), stat('brute').hp - t.damage - stat('grunt').damage);
});

// ---------- attack orders clear on target death ----------

test('an attack order clears when its target dies', () => {
  const s = world({
    units: [unit(1, 0, 'grunt', 5, 5, { type: 'attack', target: 2 }), unit(2, 1, 'worker', 6, 5, null, { hp: 1 })],
  });
  stepCombat(s);
  assert.equal(findEntity(s, 2), undefined, 'target removed');
  assert.equal(findEntity(s, 1).order, null);
  assert.ok(s.events.some((e) => e.e === 'die' && e.id === 2));
});

test('an attacker clears its order even when someone else killed the target', () => {
  const s = world({
    units: [
      unit(1, 0, 'grunt', 2, 2, { type: 'attack', target: 3 }),
      unit(2, 0, 'grunt', 6, 6),
      unit(3, 1, 'worker', 7, 6, null, { hp: 1 }),
    ],
  });
  stepCombat(s);
  assert.equal(findEntity(s, 3), undefined);
  assert.equal(findEntity(s, 1).order, null);
});

test('an attack order on a structure clears when it is destroyed', () => {
  const s = world({
    units: [unit(1, 0, 'brute', 5, 5, { type: 'attack', target: 2 })],
    structures: [structure(2, 1, 'turret', 6, 5, { hp: 10 })],
  });
  stepCombat(s);
  assert.equal(findEntity(s, 2), undefined);
  assert.equal(findEntity(s, 1).order, null);
});

test('an attack order on an unfinished site works and clears when the site falls', () => {
  const s = world({
    units: [unit(1, 0, 'grunt', 5, 5, { type: 'attack', target: 2 })],
    structures: [structure(2, 1, 'forge', 6, 5, { hp: 1, complete: false })],
  });
  stepCombat(s);
  assert.equal(findEntity(s, 2), undefined);
  assert.equal(findEntity(s, 1).order, null);
});

test('an attack order stays while the target survives', () => {
  const order = { type: 'attack', target: 2 };
  const s = world({ units: [unit(1, 0, 'grunt', 5, 5, { ...order }), unit(2, 1, 'brute', 6, 5)] });
  stepCombat(s);
  assert.deepEqual(findEntity(s, 1).order, order);
});

test('after its target dies, a former attacker is idle and picks the nearest enemy next tick', () => {
  const s = world({
    units: [unit(1, 0, 'grunt', 5, 5, { type: 'attack', target: 2 }), unit(2, 1, 'worker', 6, 5, null, { hp: 1 }), unit(3, 1, 'brute', 4, 5)],
  });
  stepCombat(s);
  assert.equal(findEntity(s, 1).order, null);
  assert.equal(hpOf(s, 3), stat('brute').hp, 'the order, not the bystander, was served on the kill tick');
  stepCombat(s);
  assert.equal(hpOf(s, 3), stat('brute').hp - stat('grunt').damage);
});

test('dead units are removed at the end of the phase and mutual kills are possible', () => {
  const s = world({ units: [unit(1, 0, 'grunt', 5, 5, null, { hp: 1 }), unit(2, 1, 'grunt', 6, 5, null, { hp: 1 })] });
  stepCombat(s);
  assert.equal(findEntity(s, 1), undefined);
  assert.equal(findEntity(s, 2), undefined);
  assert.deepEqual(s.events.filter((e) => e.e === 'die').map((e) => e.id), [1, 2]);
});
