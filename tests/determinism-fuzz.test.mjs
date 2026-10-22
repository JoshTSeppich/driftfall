// Determinism fuzzing (ENV-SPEC §13). Owner: Network Programmer.
//
// Random seeds, and random-but-mostly-legal command streams from a seeded generator. Each match is played twice from
// scratch, and once more by replaying the commands recorded from the first run. The logs, without timing, must be
// byte-identical every time. A mismatch fails with the seed, the first tick that differs, and the commands sent up to
// that tick, which is enough to reproduce it by hand.
//
// Knobs (environment variables, so a failing run can be rerun exactly):
//   DRIFTFALL_FUZZ_META_SEED  picks the list of match seeds (default 20261022)
//   DRIFTFALL_FUZZ_SEEDS      how many match seeds to try (default 12)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../env/rng.mjs';
import { STATS, UNIT_KINDS, STRUCTURE_KINDS } from '../env/stats.mjs';
import { createMatch, step } from '../env/sim.mjs';
import { observe } from '../env/state.mjs';
import { createLog, appendTick, finishLog, comparable, validateLog } from '../env/log.mjs';

const META_SEED = Number(process.env.DRIFTFALL_FUZZ_META_SEED ?? 20261022);
const SEED_COUNT = Number(process.env.DRIFTFALL_FUZZ_SEEDS ?? 12);
const MAX_TICKS = STATS.match.maxTicks;
const MAP_W = STATS.map.width;
const MAP_H = STATS.map.height;

// Match seeds come from a fixed stream, so the same META_SEED always tries the same matches.
const seedRng = makeRng(META_SEED);
const SEEDS = Array.from({ length: SEED_COUNT }, () => seedRng.int(2 ** 31));

// Commands the sim must reject without crashing (spec §10: malformed input is bad-command).
const JUNK = [
  null,
  42,
  'move',
  [],
  {},
  { type: 'move' },
  { type: 'nope', unit: 1 },
  { type: 'move', unit: 'x', x: 1.5, y: 2 },
];

const pickOf = (rng, list) => list[rng.int(list.length)];

// One command from what this side can see. Mostly legal for the side's own units, with some illegal ones mixed in
// (enemy units, off-map tiles, missing targets, no-shards) so reject events are fuzzed too.
function randomCommand(obs, side, rng) {
  const mine = obs.units.filter((u) => u.owner === side);
  const foes = obs.units.filter((u) => u.owner !== side);
  const enemyTargets = [...foes, ...obs.structures.filter((s) => s.owner !== side)];
  const workers = mine.filter((u) => u.kind === 'worker');
  const fields = obs.crystals.filter((c) => c.amount > 0);
  const buildings = obs.structures.filter((s) => s.owner === side);
  const roll = rng();

  if (roll < 0.03 || mine.length === 0) return pickOf(rng, JUNK);

  if (roll < 0.2) {
    return { type: 'move', unit: pickOf(rng, mine).id, x: rng.int(MAP_W + 2) - 1, y: rng.int(MAP_H + 2) - 1 };
  }
  if (roll < 0.35 && workers.length && fields.length) {
    const c = pickOf(rng, fields);
    return { type: 'gather', unit: pickOf(rng, workers).id, x: c.x, y: c.y };
  }
  if (roll < 0.5 && workers.length) {
    const w = pickOf(rng, workers);
    return {
      type: 'build', unit: w.id, kind: pickOf(rng, STRUCTURE_KINDS),
      x: w.x + rng.int(7) - 3, y: w.y + rng.int(7) - 3,
    };
  }
  if (roll < 0.62 && buildings.length) {
    return { type: 'train', building: pickOf(rng, buildings).id, kind: pickOf(rng, UNIT_KINDS) };
  }
  if (roll < 0.85) {
    const target = rng() < 0.8 && enemyTargets.length ? pickOf(rng, enemyTargets) : pickOf(rng, mine);
    return { type: 'attack', unit: pickOf(rng, movable).id, target: target.id };
  }
  return { type: 'stop', unit: pickOf(rng, rng() < 0.9 ? movable : [...foes, ...mine]).id };
}

// Commands for one side this tick: usually 0 to 3, and about once in 200 ticks exactly one over the cap (§10, too-many).
function commandsFor(obs, side, rng) {
  const many = rng() < 0.005;
  const count = many ? STATS.match.maxCommandsPerTick + 1 : rng.int(4);
  const out = [];
  for (let i = 0; i < count; i++) out.push(randomCommand(obs, side, rng));
  return out;
}

// Plays one match from `seed`. `decide(index, observations)` returns [commands0, commands1] for the tick.
// Returns the log (spec §12), the commands sent each tick, and the result.
function runMatch(seed, decide) {
  const state = createMatch(seed);
  const initial = observe(state, 0);
  delete initial.you;
  const log = createLog({ seed, players: ['fuzz-0', 'fuzz-1'], stats: STATS, initial });

  const sent = [];
  let result = null;
  while (!result) {
    assert.ok(state.tick < MAX_TICKS, `seed ${seed}: no result before tick ${MAX_TICKS}`);
    const tick = state.tick;
    const observations = [observe(state, 0), observe(state, 1)];
    const commands = decide(sent.length, observations);
    sent.push(commands);
    const events = step(state, commands);
    appendTick(log, { tick, commands, events }, [0, 0]);
    result = state.result;
  }
  finishLog(log, result);
  return { log, sent, result };
}

// Fresh generator per run, derived from the match seed, so every run of one seed sees the same random stream.
const fuzzDecider = (seed) => {
  const rng = makeRng((seed ^ Math.imul(META_SEED, 0x9e3779b1)) >>> 0);
  return (index, observations) => [commandsFor(observations[0], 0, rng), commandsFor(observations[1], 1, rng)];
};

// Coverage across the fuzzed matches, filled in by the per-seed tests (which run first, in order).
const seen = { events: new Set(), rejects: new Set() };

function firstDifferingTick(a, b) {
  const n = Math.max(a.ticks.length, b.ticks.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(a.ticks[i]) !== JSON.stringify(b.ticks[i])) return i;
  }
  return -1;
}

function mismatchReport(seed, label, a, b) {
  const i = firstDifferingTick(a.log, b.log);
  const lines = [`seed ${seed}: the ${label} log differs from the first run.`];
  if (i < 0) {
    const keys = Object.keys(comparable(a.log)).filter(
      (k) => JSON.stringify(a.log[k]) !== JSON.stringify(b.log[k]),
    );
    lines.push(`Fields that differ outside the tick list: ${keys.join(', ') || '(none found; check key order)'}.`);
  } else {
    const ta = a.log.ticks[i];
    const tb = b.log.ticks[i];
    lines.push(`First difference at tick entry ${i} (tick ${ta?.tick ?? '?'}).`);
    lines.push(`Commands sent that tick, side 0: ${JSON.stringify(a.sent[i][0])}`);
    lines.push(`Commands sent that tick, side 1: ${JSON.stringify(a.sent[i][1])}`);
    lines.push(`First run events:  ${JSON.stringify(ta?.events ?? null)}`);
    lines.push(`Other run events:  ${JSON.stringify(tb?.events ?? null)}`);
    lines.push(`Repro: runMatch(${seed}) with commands ${JSON.stringify(a.sent.slice(0, i + 1))}`);
  }
  return lines.join('\n');
}

function assertSameLog(seed, label, a, b) {
  if (JSON.stringify(comparable(a.log)) === JSON.stringify(comparable(b.log))) return;
  assert.fail(mismatchReport(seed, label, a, b));
}

for (const seed of SEEDS) {
  test(`seed ${seed}: two fuzzed runs and a replay of the same commands give identical logs`, () => {
    const first = runMatch(seed, fuzzDecider(seed));
    const second = runMatch(seed, fuzzDecider(seed));
    const replay = runMatch(seed, (index) => first.sent[index]);

    assert.deepEqual(validateLog(first.log), [], `seed ${seed}: the fuzzed log should validate`);
    assertSameLog(seed, 'second', first, second);
    assertSameLog(seed, 'replayed', first, replay);

    for (const t of first.log.ticks) {
      for (const ev of t.events) {
        seen.events.add(ev.e);
        if (ev.e === 'reject') seen.rejects.add(ev.reason);
      }
    }
  });
}

test('the fuzzed matches exercise the main event kinds and reject reasons', () => {
  const needed = ['spawn', 'move', 'hit', 'die', 'mine', 'deliver', 'spend', 'progress', 'done', 'queue', 'order', 'reject'];
  for (const kind of needed) assert.ok(seen.events.has(kind), `no "${kind}" event in any fuzzed match`);
  for (const reason of ['bad-command', 'not-yours', 'off-map', 'no-shards', 'too-many']) {
    assert.ok(seen.rejects.has(reason), `no "${reason}" rejection in any fuzzed match`);
  }
});
