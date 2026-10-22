// Performance budgets for the simulation and pathfinding (owner: haiku, Performance / Optimization Engineer).
//
// Every metric is measured with the real env modules, timed as the median of several repeats, and divided by a
// fixed calibration workload that runs on the same machine in the same process. That makes the numbers roughly
// machine-independent, so the Mac mini and the MacBook Air can share one baseline.
//
// The baseline lives in PERF.md, inside the fenced block between the perf-baseline markers. A change passes when
// no metric is more than GATE times slower than its recorded baseline. To record a new baseline after a deliberate
// speed-up or a balance change that adds real work:
//
//   node tests/perf.test.mjs --record
//
// Recording rewrites that block in PERF.md; say so in the chat and in the PR. Nothing else is written.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PERF_MD = path.join(ROOT, "PERF.md");
const RECORD = process.argv.includes("--record") || process.env.PERF_RECORD === "1";
// A change may make any metric at most this many times slower than its baseline.
const GATE = 2;
const REPEATS = 5;
const MARK_START = "<!-- perf-baseline:start -->";
const MARK_END = "<!-- perf-baseline:end -->";

const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
const sim = await import(url("env/sim.mjs"));
const state = await import(url("env/state.mjs"));
const pathMod = await import(url("env/path.mjs"));
const { STATS } = await import(url("env/stats.mjs"));

// ---- measuring helpers -------------------------------------------------------------------------

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Median wall-clock time of `fn` over REPEATS runs. `fn` returns the time it measured, in ms.
function measure(fn) {
  const times = [];
  for (let i = 0; i < REPEATS; i++) times.push(fn());
  return median(times);
}

// A fixed integer workload, used only to normalise the other numbers. It never changes.
function calibrationWork() {
  let h = 0x9e3779b9;
  for (let i = 0; i < 4_000_000; i++) {
    h = Math.imul(h ^ i, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
  }
  return h;
}

const calibrationMs = measure(() => {
  const t0 = nowMs();
  const sink = calibrationWork();
  const t = nowMs() - t0;
  if (sink === -1) throw new Error("unreachable"); // keeps the loop from being optimised away
  return t;
});

// ---- scenarios ---------------------------------------------------------------------------------

const SEED = 7;
const WIDTH = 32;
const HEIGHT = 32;
const ARMY_SIZE = STATS.match.unitCap; // 40 per side, the worst case the spec allows
const ARMY_TICKS = 100;
const IDLE_TICKS = STATS.match.maxTicks;

// Two full armies on the seed-7 map, 40 Grunts each, left half against right half.
// `orderFor(unitIndex, side, enemyIds)` gives each unit its order.
function buildArmies(orderFor) {
  const base = sim.createMatch(SEED);
  const sides = [[], []];
  let nextId = 1000;
  const probe = state.createTestState({ width: WIDTH, height: HEIGHT, rocks: base.rocks, crystals: base.crystals, shards: [0, 0] });
  for (const side of [0, 1]) {
    for (let y = 0; y < HEIGHT && sides[side].length < ARMY_SIZE; y++) {
      for (let x = 0; x < WIDTH && sides[side].length < ARMY_SIZE; x++) {
        const onSide = side === 0 ? x < WIDTH / 2 : x >= WIDTH / 2;
        if (onSide && state.isFree(probe, x, y)) {
          sides[side].push({ id: nextId++, owner: side, kind: "grunt", x, y, hp: STATS.units.grunt.hp, carrying: 0, order: null });
        }
      }
    }
  }
  const enemyIds = [sides[1].map((u) => u.id), sides[0].map((u) => u.id)];
  for (const side of [0, 1]) {
    sides[side].forEach((u, i) => { u.order = orderFor(u, i, side, enemyIds); });
  }
  return state.createTestState({
    width: WIDTH, height: HEIGHT, rocks: base.rocks, crystals: base.crystals, shards: [0, 0],
    units: [...sides[0], ...sides[1]],
  });
}

// Every unit walks to the mirror of its tile: maximum pathing, everyone crossing the middle.
const marchAcross = (u) => ({ type: "move", x: WIDTH - 1 - u.x, y: HEIGHT - 1 - u.y });
// Every unit attacks the enemy with the same index: maximum combat and re-pathing.
const engage = (u, i, side, enemyIds) => ({ type: "attack", target: enemyIds[side][i] });

// Median over REPEATS fresh armies of the average tick time over ARMY_TICKS.
function armyTickMs(orderFor) {
  return measure(() => {
    const s = buildArmies(orderFor);
    const t0 = nowMs();
    for (let i = 0; i < ARMY_TICKS; i++) sim.step(s, [[], []]);
    return (nowMs() - t0) / ARMY_TICKS;
  });
}

// Median time per tick of a full 2000-tick match with no commands on the seed-7 map.
function idleTickMs() {
  return measure(() => {
    const s = sim.createMatch(SEED);
    const t0 = nowMs();
    for (let i = 0; i < IDLE_TICKS; i++) sim.step(s, [[], []]);
    return (nowMs() - t0) / IDLE_TICKS;
  });
}

// An open 32x32 grid, corner to corner: the usual long search.
const openGrid = { width: WIDTH, height: HEIGHT, blocked: () => false };
function pathOpenMs() {
  const calls = 500;
  return measure(() => {
    const t0 = nowMs();
    for (let i = 0; i < calls; i++) pathMod.findPath(openGrid, { x: 0, y: 0 }, { x: WIDTH - 1, y: HEIGHT - 1 });
    return (nowMs() - t0) / calls;
  });
}

// Goal walled in by rocks: the search has to explore every reachable tile before it returns null.
const SEALED = { x: 16, y: 16 };
const sealedGrid = {
  width: WIDTH,
  height: HEIGHT,
  blocked: (x, y) => Math.max(Math.abs(x - SEALED.x), Math.abs(y - SEALED.y)) === 1,
};
function pathSealedMs() {
  const calls = 200;
  return measure(() => {
    const t0 = nowMs();
    for (let i = 0; i < calls; i++) {
      const r = pathMod.findPath(sealedGrid, { x: 0, y: 0 }, SEALED);
      if (r !== null) throw new Error("the sealed goal should be unreachable");
    }
    return (nowMs() - t0) / calls;
  });
}

// Each metric: its unit, how to measure it, and what it is compared against. Values are in
// microseconds (or the unit named) divided by the calibration time, so they are unit-free ratios.
const METRICS = {
  "idle-tick": { unit: "us per tick, seed 7, no commands", run: () => idleTickMs() * 1000 },
  "army-40v40-march": { unit: "us per tick, 40 v 40 all moving across", run: () => armyTickMs(marchAcross) * 1000 },
  "army-40v40-engage": { unit: "us per tick, 40 v 40 all attacking", run: () => armyTickMs(engage) * 1000 },
  "findpath-open-32": { unit: "us per call, open 32x32, corner to corner", run: () => pathOpenMs() * 1000 },
  "findpath-sealed-32": { unit: "us per call, goal sealed by rocks", run: () => pathSealedMs() * 1000 },
};

// ---- baseline file ----------------------------------------------------------------------------

function readBaseline() {
  if (!fs.existsSync(PERF_MD)) return null;
  const text = fs.readFileSync(PERF_MD, "utf8");
  const start = text.indexOf(MARK_START);
  const end = text.indexOf(MARK_END);
  if (start < 0 || end < 0 || end < start) return null;
  const block = text.slice(start + MARK_START.length, end);
  const json = block.match(/```json\s*([\s\S]*?)```/);
  if (!json) return null;
  return JSON.parse(json[1]);
}

function writeBaseline(baseline) {
  const text = fs.readFileSync(PERF_MD, "utf8");
  const start = text.indexOf(MARK_START);
  const end = text.indexOf(MARK_END);
  assert.ok(start >= 0 && end > start, `PERF.md needs the ${MARK_START} and ${MARK_END} markers`);
  const block = `${MARK_START}\n\`\`\`json\n${JSON.stringify(baseline, null, 2)}\n\`\`\`\n${MARK_END}`;
  fs.writeFileSync(PERF_MD, text.slice(0, start) + block + text.slice(end + MARK_END.length));
}

// ---- tests ------------------------------------------------------------------------------------

// Measure everything once, so each metric's test reports the same run.
const measured = {};
for (const [name, metric] of Object.entries(METRICS)) {
  const raw = metric.run();
  measured[name] = { raw, normalized: raw / calibrationMs };
}

if (RECORD) {
  const baseline = {
    note: "Normalised by the calibration workload (see tests/perf.test.mjs). Limit is 2x each value.",
    calibrationMs: Number(calibrationMs.toFixed(3)),
    metrics: Object.fromEntries(Object.entries(measured).map(([name, m]) => [name, {
      unit: METRICS[name].unit,
      normalized: Number(m.normalized.toFixed(4)),
      rawAtRecord: Number(m.raw.toFixed(3)),
    }])),
  };
  writeBaseline(baseline);
}

test("PERF.md holds a baseline for every metric", () => {
  const baseline = readBaseline();
  assert.ok(baseline, "PERF.md has no perf-baseline block; record one with PERF_RECORD=1");
  for (const name of Object.keys(METRICS)) {
    assert.ok(baseline.metrics[name], `PERF.md has no baseline for ${name}; record one with PERF_RECORD=1`);
    assert.ok(baseline.metrics[name].normalized > 0, `baseline for ${name} must be positive`);
  }
});

for (const name of Object.keys(METRICS)) {
  test(`${name} is no more than ${GATE}x its baseline`, () => {
    const baseline = readBaseline();
    assert.ok(baseline && baseline.metrics[name], `no baseline for ${name} in PERF.md`);
    const { raw, normalized } = measured[name];
    const limit = GATE * baseline.metrics[name].normalized;
    const ratio = normalized / baseline.metrics[name].normalized;
    assert.ok(
      normalized <= limit,
      `${name} is ${ratio.toFixed(2)}x its baseline (${raw.toFixed(3)} ${METRICS[name].unit}; ` +
        `baseline ${baseline.metrics[name].rawAtRecord} on the recording machine). Limit is ${GATE}x. ` +
        `If this is a deliberate change, record a new baseline (see PERF.md).`,
    );
  });
}
