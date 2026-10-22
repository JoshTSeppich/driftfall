// Combat damage tests (spec section 7), run on hand-built states from createTestState.
// Real modules only; nothing here is stubbed. Every number is read from env/stats.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATS } from "../env/stats.mjs";
import { createTestState, findEntity } from "../env/state.mjs";
import { stepCombat } from "../env/combat.mjs";

const U = STATS.units;
const S = STATS.structures;

// Full unit record so the test does not depend on createTestState filling in defaults.
function unit(id, owner, kind, x, y, extra = {}) {
  return { id, owner, kind, x, y, hp: U[kind].hp, carrying: 0, order: null, ...extra };
}

// Full structure record. Complete by default; pass complete:false and hp for a site.
function structure(id, owner, kind, x, y, extra = {}) {
  const maxHp = kind === "core" ? STATS.core.hp : S[kind].hp;
  const buildTicks = kind === "core" ? 0 : S[kind].buildTicks;
  return { id, owner, kind, x, y, hp: maxHp, progress: buildTicks, complete: true, queue: [], ...extra };
}

const attack = (target) => ({ type: "attack", target });

// Small open map, no rocks, no crystals. tick 0 so id order runs ascending.
function makeState({ units = [], structures = [] }) {
  const state = createTestState({
    width: 16,
    height: 16,
    rocks: [],
    crystals: [],
    shards: [STATS.match.startShards, STATS.match.startShards],
    units,
    structures,
  });
  state.tick = 0;
  state.events = [];
  return state;
}

const hits = (state) => state.events.filter((e) => e.e === "hit");
const dies = (state) => state.events.filter((e) => e.e === "die");

test("an ordered attacker in range deals exactly its table damage", () => {
  // Target is a Worker with no order: Workers never fight back unless ordered.
  const state = makeState({
    units: [unit(1, 0, "grunt", 5, 5, { order: attack(2) }), unit(2, 1, "worker", 6, 5)],
  });
  stepCombat(state);
  const target = findEntity(state, 2);
  assert.equal(target.hp, U.worker.hp - U.grunt.damage);
  assert.equal(findEntity(state, 1).hp, U.grunt.hp, "the Worker had no order, so it must not hit back");
  const h = hits(state);
  assert.equal(h.length, 1);
  assert.deepEqual(
    { id: h[0].id, by: h[0].by, dmg: h[0].dmg, hp: h[0].hp },
    { id: 2, by: 1, dmg: U.grunt.damage, hp: U.worker.hp - U.grunt.damage },
  );
});

test("an ordered attacker out of range deals no damage and logs no hit", () => {
  // Lancer range is 4; the target sits at distance range+1.
  const state = makeState({
    units: [unit(1, 0, "lancer", 2, 2, { order: attack(2) }), unit(2, 1, "worker", 2 + U.lancer.range + 1, 2)],
  });
  stepCombat(state);
  assert.equal(findEntity(state, 2).hp, U.worker.hp);
  assert.equal(hits(state).length, 0);
  assert.equal(dies(state).length, 0);
  // The attack order stays: walking toward the target is the movement phase's job, not combat's.
  assert.deepEqual(findEntity(state, 1).order, attack(2));
});

test("ordered attacker at exactly its range still hits", () => {
  const state = makeState({
    units: [unit(1, 0, "lancer", 2, 2, { order: attack(2) }), unit(2, 1, "worker", 2 + U.lancer.range, 2 + U.lancer.range)],
  });
  stepCombat(state);
  assert.equal(findEntity(state, 2).hp, U.worker.hp - U.lancer.damage, "distance is max(|dx|,|dy|), so a diagonal at range counts");
});

test("an idle combat unit in range attacks the enemy on its own", () => {
  const state = makeState({
    units: [unit(1, 0, "grunt", 5, 5), unit(2, 1, "worker", 6, 6)],
  });
  stepCombat(state);
  assert.equal(findEntity(state, 2).hp, U.worker.hp - U.grunt.damage);
  assert.equal(hits(state).length, 1);
  assert.equal(findEntity(state, 1).order, null, "auto-attacking does not give the unit an order");
});

test("an idle combat unit out of range does nothing and stays put", () => {
  const state = makeState({
    units: [unit(1, 0, "grunt", 5, 5), unit(2, 1, "worker", 5 + U.grunt.range + 1, 5)],
  });
  stepCombat(state);
  const g = findEntity(state, 1);
  assert.deepEqual([g.x, g.y], [5, 5]);
  assert.equal(findEntity(state, 2).hp, U.worker.hp);
  assert.equal(state.events.length, 0, "no events at all when nothing is in range");
});

test("two units can kill each other on the same tick", () => {
  // Each Grunt has exactly one hit of hp left. Damage is simultaneous, so both die.
  const state = makeState({
    units: [
      unit(1, 0, "grunt", 5, 5, { hp: U.grunt.damage, order: attack(2) }),
      unit(2, 1, "grunt", 6, 5, { hp: U.grunt.damage, order: attack(1) }),
    ],
  });
  stepCombat(state);
  assert.equal(state.units.length, 0, "both Grunts must be removed");
  assert.ok(!findEntity(state, 1) && !findEntity(state, 2), "findEntity must not find dead units");
  const h = hits(state);
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((e) => [e.id, e.by, e.hp]), [[2, 1, 0], [1, 2, 0]], "hits in attacker id order, hp 0 after the tick");
  assert.deepEqual(dies(state).map((e) => e.id), [1, 2]);
});

test("damage from several attackers adds up and every hit shows the hp after all damage that tick", () => {
  // Three Grunts around one Worker. The Worker has no order so nothing confuses the count.
  const state = makeState({
    units: [
      unit(1, 0, "grunt", 4, 5, { order: attack(10) }),
      unit(2, 0, "grunt", 6, 5), // idle, in range: attacks on its own
      unit(3, 0, "grunt", 5, 4, { order: attack(10) }),
      unit(10, 1, "worker", 5, 5),
    ],
  });
  stepCombat(state);
  const expected = U.worker.hp - 3 * U.grunt.damage;
  assert.ok(expected > 0, "test setup: the Worker must survive three Grunt hits");
  assert.equal(findEntity(state, 10).hp, expected);
  const h = hits(state);
  assert.equal(h.length, 3);
  assert.deepEqual(h.map((e) => e.by), [1, 2, 3], "one hit per attacker, in attacker id order");
  for (const e of h) {
    assert.equal(e.id, 10);
    assert.equal(e.dmg, U.grunt.damage);
    assert.equal(e.hp, expected, "each hit carries the final hp of the tick, not a running total");
  }
});

test("a Brute deals double damage to a complete structure", () => {
  // A Forge rather than a Turret so nothing shoots back and muddies the numbers.
  const state = makeState({
    units: [unit(1, 0, "brute", 5, 5, { order: attack(2) })],
    structures: [structure(2, 1, "forge", 6, 5)],
  });
  stepCombat(state);
  assert.equal(findEntity(state, 2).hp, S.forge.hp - 2 * U.brute.damage);
  const h = hits(state);
  assert.equal(h.length, 1);
  assert.equal(h[0].dmg, 2 * U.brute.damage, "the hit event reports the doubled damage");
});

test("a Brute deals double damage to an unfinished site", () => {
  const siteHp = 2 * U.brute.damage + 7;
  const state = makeState({
    units: [unit(1, 0, "brute", 5, 5, { order: attack(2) })],
    structures: [structure(2, 1, "turret", 6, 5, { hp: siteHp, progress: 3, complete: false })],
  });
  stepCombat(state);
  assert.equal(findEntity(state, 2).hp, 7);
  assert.equal(hits(state)[0].dmg, 2 * U.brute.damage);
  assert.equal(findEntity(state, 1).hp, U.brute.hp, "an unfinished Turret never shoots");
});

test("a Brute deals normal damage to a unit", () => {
  const state = makeState({
    units: [unit(1, 0, "brute", 5, 5, { order: attack(2) }), unit(2, 1, "worker", 6, 5)],
  });
  stepCombat(state);
  assert.equal(findEntity(state, 2).hp, U.worker.hp - U.brute.damage);
  assert.equal(hits(state)[0].dmg, U.brute.damage);
});

test("a Brute deals double damage to the enemy Core", () => {
  const state = makeState({
    units: [unit(3, 0, "brute", 5, 5, { order: attack(2) })],
    structures: [structure(2, 1, "core", 6, 5)],
  });
  stepCombat(state);
  assert.equal(findEntity(state, 2).hp, STATS.core.hp - 2 * U.brute.damage);
});

test("a non-Brute deals its normal damage to a structure", () => {
  const state = makeState({
    units: [unit(1, 0, "grunt", 5, 5, { order: attack(2) })],
    structures: [structure(2, 1, "forge", 6, 5)],
  });
  stepCombat(state);
  assert.equal(findEntity(state, 2).hp, S.forge.hp - U.grunt.damage);
});

test("an unfinished site can be attacked and destroyed", () => {
  const state = makeState({
    units: [unit(1, 0, "grunt", 5, 5, { order: attack(2) })],
    structures: [structure(2, 1, "forge", 6, 5, { hp: U.grunt.damage - 1, progress: 2, complete: false })],
  });
  stepCombat(state);
  assert.equal(state.structures.length, 0, "the destroyed site is removed");
  assert.ok(!findEntity(state, 2));
  assert.equal(hits(state).length, 1);
  assert.ok(hits(state)[0].hp <= 0);
  assert.deepEqual(dies(state).map((e) => e.id), [2]);
  assert.equal(state.shards[1], STATS.match.startShards, "nothing is refunded for a destroyed site");
  assert.equal(findEntity(state, 1).order, null, "the attack order clears when its target dies");
});

test("a complete Turret auto-attacks and can be destroyed by a Brute", () => {
  const state = makeState({
    units: [unit(1, 0, "brute", 5, 5, { order: attack(2) })],
    structures: [structure(2, 1, "turret", 6, 5, { hp: 2 * U.brute.damage })],
  });
  stepCombat(state);
  assert.ok(!findEntity(state, 2), "the Turret dies");
  // Simultaneous: the Turret still fired this tick before it was removed.
  assert.equal(findEntity(state, 1).hp, U.brute.hp - S.turret.damage);
  const h = hits(state);
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((e) => e.by), [1, 2], "hits in attacker id order, Turret included");
});

test("dead units are removed and their orders go with them; the killer's attack order clears", () => {
  // The victim has a move order, carries Shards, and dies in one hit.
  const state = makeState({
    units: [
      unit(1, 0, "brute", 5, 5, { order: attack(2) }),
      unit(2, 1, "worker", 6, 5, { hp: U.brute.damage, carrying: 10, order: { type: "move", x: 15, y: 15 } }),
      unit(3, 1, "worker", 15, 15, { order: { type: "move", x: 14, y: 14 } }),
    ],
  });
  stepCombat(state);
  assert.deepEqual(state.units.map((u) => u.id), [1, 3]);
  assert.ok(!findEntity(state, 2));
  assert.equal(findEntity(state, 1).order, null, "attack order clears because the target died");
  assert.deepEqual(findEntity(state, 3).order, { type: "move", x: 14, y: 14 }, "unrelated orders are untouched");
  assert.equal(state.shards[1], STATS.match.startShards, "carried Shards are lost, not credited");
  assert.deepEqual(dies(state).map((e) => e.id), [2]);
});

test("a destroyed structure takes its training queue with it", () => {
  const state = makeState({
    units: [unit(1, 0, "brute", 5, 5, { order: attack(2) })],
    structures: [structure(2, 1, "forge", 6, 5, { hp: 2 * U.brute.damage, queue: ["grunt", "lancer"] })],
  });
  stepCombat(state);
  assert.equal(state.structures.length, 0);
  assert.ok(!findEntity(state, 2));
  assert.ok(
    state.structures.every((s) => s.id !== 2) && state.units.every((u) => u.id !== 2),
    "no entity with the dead id remains anywhere",
  );
  assert.deepEqual(dies(state).map((e) => e.id), [2]);
});

test("the attack order of every unit targeting a dead entity clears", () => {
  const state = makeState({
    units: [
      unit(1, 0, "grunt", 5, 5, { order: attack(9) }),
      unit(2, 0, "grunt", 7, 5, { order: attack(9) }),
      unit(3, 0, "lancer", 1, 1, { order: attack(9) }), // out of range, never hit, but its target still dies
      unit(9, 1, "worker", 6, 5, { hp: U.grunt.damage }),
    ],
  });
  stepCombat(state);
  assert.ok(!findEntity(state, 9));
  for (const id of [1, 2, 3]) assert.equal(findEntity(state, id).order, null, `unit ${id} order should clear`);
});

test("die events follow all hit events and are in id order", () => {
  // Two victims die, one attacker survives with damage. Ids chosen so a sloppy ordering would show.
  const state = makeState({
    units: [
      unit(2, 0, "grunt", 5, 5, { order: attack(7) }),
      unit(4, 1, "grunt", 6, 6, { hp: U.grunt.damage, order: attack(2) }),
      unit(7, 1, "worker", 6, 5, { hp: 1 }),
      unit(9, 0, "grunt", 7, 6, { order: attack(4) }),
    ],
  });
  stepCombat(state);
  const kinds = state.events.map((e) => e.e);
  const lastHit = kinds.lastIndexOf("hit");
  const firstDie = kinds.indexOf("die");
  assert.ok(lastHit >= 0 && firstDie >= 0);
  assert.ok(lastHit < firstDie, `every hit comes before every die, got ${kinds.join(",")}`);
  assert.deepEqual(hits(state).map((e) => e.by), [2, 4, 9], "hits in attacker id order");
  assert.deepEqual(dies(state).map((e) => e.id), [4, 7], "dies in id order");
  assert.equal(findEntity(state, 2).hp, U.grunt.hp - U.grunt.damage, "the surviving attacker still took the dead unit's hit");
  assert.deepEqual(state.units.map((u) => u.id), [2, 9]);
});

test("hp never goes negative in the surviving state and overkill hits report hp at or below 0", () => {
  const state = makeState({
    units: [
      unit(1, 0, "brute", 5, 5, { order: attack(3) }),
      unit(2, 0, "brute", 7, 5, { order: attack(3) }),
      unit(3, 1, "worker", 6, 5, { hp: 1 }),
    ],
  });
  stepCombat(state);
  assert.ok(!findEntity(state, 3));
  for (const e of hits(state)) assert.ok(e.hp <= 0);
  assert.equal(hits(state)[0].hp, hits(state)[1].hp, "both hits report the same final hp");
  for (const u of state.units) assert.ok(u.hp > 0);
});
