// Opening pacing (FANATICS.md Council #1): a match cannot be lost in the first three minutes, and the Core is
// hard to kill early. Attack cadence and the hardened Core live in env/combat.mjs; the numbers live in env/stats.mjs.
// Real modules only; the match tests run the real referee in-process against the rush bot.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATS } from "../env/stats.mjs";
import { createTestState, findEntity } from "../env/state.mjs";
import { stepCombat } from "../env/combat.mjs";
import { runMatch } from "../env/referee.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bot = (rel) => path.join(here, "..", rel);
const U = STATS.units;
const TICKS_PER_MINUTE = 24 * 60;
const SAFE_OPENING_TICKS = 3 * TICKS_PER_MINUTE;

function unit(id, owner, kind, x, y, extra = {}) {
  return { id, owner, kind, x, y, hp: U[kind].hp, carrying: 0, order: null, ...extra };
}

function core(id, owner, x, y) {
  return { id, owner, kind: "core", x, y, hp: STATS.core.hp, progress: 0, complete: true, queue: [] };
}

function makeState(units, structures = []) {
  const state = createTestState({
    width: 24,
    height: 24,
    rocks: [],
    crystals: [],
    shards: [0, 0],
    units,
    structures,
  });
  state.tick = 0;
  state.events = [];
  return state;
}

test("every combat unit has an attack cadence, and no unit attacks more than once a cadence", () => {
  for (const kind of ["grunt", "lancer", "brute"]) {
    assert.ok(Number.isInteger(U[kind].attackTicks) && U[kind].attackTicks >= 1, `${kind} needs attackTicks`);
  }
  const every = U.grunt.attackTicks;
  const state = makeState([unit(1, 0, "grunt", 5, 5, { order: { type: "attack", target: 2 } }), unit(2, 1, "worker", 6, 5)]);
  const hitTicks = [];
  for (let t = 0; t < every * 3; t += 1) {
    state.events = [];
    stepCombat(state);
    if (state.events.some((e) => e.e === "hit")) hitTicks.push(state.tick);
    state.tick += 1;
  }
  assert.deepEqual(hitTicks, [0, every, every * 2], "one hit at once, then one every attackTicks");
});

test("a Core takes quarter damage before the hardened window ends and full damage after it", () => {
  assert.equal(STATS.core.hardenedTicks, 3 * TICKS_PER_MINUTE, "the window is three minutes");
  const mult = STATS.core.hardenedMultiplier;
  assert.ok(mult > 0 && mult < 1, "the multiplier is a fraction");

  const early = makeState([unit(1, 0, "brute", 5, 5, { order: { type: "attack", target: 2 } })], [core(2, 1, 6, 5)]);
  early.tick = 0;
  stepCombat(early);
  assert.equal(findEntity(early, 2).hp, STATS.core.hp - Math.round(U.brute.damage * mult * U.brute.structureMultiplier));

  const late = makeState([unit(1, 0, "brute", 5, 5, { order: { type: "attack", target: 2 } })], [core(2, 1, 6, 5)]);
  late.tick = STATS.core.hardenedTicks;
  stepCombat(late);
  assert.equal(findEntity(late, 2).hp, STATS.core.hp - U.brute.damage * U.brute.structureMultiplier);
});

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

test("no rush match ends before three minutes on any of 20 seeds, either side", async () => {
  const rush = bot("players/fanatic-fable/bot.mjs");
  const rival = bot("players/fanatic-sonnet/bot.mjs");
  const ends = [];
  for (const seed of SEEDS) {
    for (const players of [[rush, rival], [rival, rush]]) {
      const { result } = await runMatch({ seed, players, maxTicks: 15 * TICKS_PER_MINUTE });
      ends.push({ seed, reason: result.reason, tick: result.tick });
    }
  }
  const early = ends.filter((e) => e.tick < SAFE_OPENING_TICKS);
  assert.deepEqual(early, [], "no match may end before 3:00");
});

test("the built-in AI mirror does not end before three minutes", async () => {
  const ai = bot("players/builtin/ai.mjs");
  const { result } = await runMatch({ seed: 3, players: [ai, ai], maxTicks: 15 * TICKS_PER_MINUTE });
  assert.ok(result.tick >= SAFE_OPENING_TICKS, `ended at tick ${result.tick}`);
});
