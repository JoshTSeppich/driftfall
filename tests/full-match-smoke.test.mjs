// Full-match smoke test (owner: fable).
//
// Runs one complete sample-player versus sample-player match through env/run-match.mjs as a
// real child process, exactly the way a person would from the command line (ENV-SPEC.md §11):
//
//   node env/run-match.mjs --seed 7 --p0 players/sample-player.mjs --p1 players/sample-player.mjs --out match.json
//
// and then checks, in separate tests so a failure names the broken piece:
//   - the process exits 0 and prints the result,
//   - the log file it wrote parses and passes env/log.mjs validateLog,
//   - the result has a winner (0 or 1) or a draw (null) with a reason from §9,
//   - the sample player never forfeits or throws (it is meant to be a minimal legal player),
//   - no two units ever share a tile in any replayed state (viewer/replay.mjs),
//   - no unit ever stands on a rock, crystal or structure in any replayed state,
//   - the whole child process finishes in under 5 seconds.
//
// Nothing is stubbed: the real CLI, referee, simulation, log and replay modules are used.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_MATCH = path.join(ROOT, "env", "run-match.mjs");
const SAMPLE_PLAYER = path.join(ROOT, "players", "sample-player.mjs");
const LOG_MODULE = pathToFileURL(path.join(ROOT, "env", "log.mjs")).href;
const REPLAY_MODULE = pathToFileURL(path.join(ROOT, "viewer", "replay.mjs")).href;

const SEED = 7;
const TIME_LIMIT_MS = 5000;
// Match end reasons from ENV-SPEC.md §9 and §11.
const KNOWN_REASONS = new Set(["core", "both-cores", "timeout", "forfeit"]);
// Reasons that can go with a draw (winner null): both Cores falling at once, or an exact value tie.
const DRAW_REASONS = new Set(["both-cores", "timeout"]);

// Shared between tests. Filled once in `before` so the match runs exactly one time.
let tmpDir;
let outFile;
let run; // { status, signal, stdout, stderr, elapsedMs }
let log; // parsed JSON log, or undefined if the file is missing / unparsable

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "driftfall-smoke-"));
  outFile = path.join(tmpDir, "match.json");

  const args = [
    RUN_MATCH,
    "--seed", String(SEED),
    "--p0", SAMPLE_PLAYER,
    "--p1", SAMPLE_PLAYER,
    "--out", outFile,
    "--classic", // CLI and log plumbing test; the default territory match cannot finish inside the 5 s limit
  ];
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    // Hard safety net so a hung referee cannot wedge the whole test run. The real
    // assertion is the 5 s limit below; this is only there to guarantee we return.
    timeout: 60_000,
  });
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  run = { status: r.status, signal: r.signal, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error, elapsedMs };

  if (fs.existsSync(outFile)) {
    try {
      log = JSON.parse(fs.readFileSync(outFile, "utf8"));
    } catch {
      log = undefined;
    }
  }
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function describeRun() {
  const tail = (s) => (s.length > 2000 ? "…" + s.slice(-2000) : s);
  return [
    `exit status: ${run.status}${run.signal ? ` (signal ${run.signal})` : ""}`,
    run.error ? `spawn error: ${run.error.message}` : null,
    `elapsed: ${run.elapsedMs.toFixed(0)} ms`,
    `stdout:\n${tail(run.stdout)}`,
    `stderr:\n${tail(run.stderr)}`,
  ].filter(Boolean).join("\n");
}

function requireLog() {
  assert.ok(fs.existsSync(RUN_MATCH), `env/run-match.mjs is missing (module not written yet)`);
  assert.ok(fs.existsSync(SAMPLE_PLAYER), `players/sample-player.mjs is missing (module not written yet)`);
  assert.ok(fs.existsSync(outFile), `run-match.mjs did not write the --out file\n${describeRun()}`);
  assert.ok(log && typeof log === "object", `the --out file is not valid JSON\n${describeRun()}`);
  return log;
}

// Replays the log tick by tick and hands every state (tick 0 through the last tick) to `visit`.
// Prefers the incremental applyTick API; falls back to replayTo per tick if applyTick is absent.
async function forEachReplayedState(theLog, visit) {
  const replay = await import(REPLAY_MODULE);
  assert.ok(
    typeof replay.replayTo === "function",
    "viewer/replay.mjs must export replayTo(log, tick)",
  );
  const initial = replay.replayTo(theLog, 0);
  assert.ok(initial && Array.isArray(initial.units), "replayTo(log, 0) should return a state with a units array");
  visit(initial, 0);

  if (typeof replay.applyTick === "function") {
    // applyTick may mutate in place or return a new state; support both.
    let state = structuredClone(initial);
    for (const entry of theLog.ticks) {
      const next = replay.applyTick(state, entry, theLog.stats);
      if (next && typeof next === "object") state = next;
      visit(state, entry.tick);
    }
    // Cross-check the incremental path against replayTo at the end so the two agree.
    const viaReplayTo = replay.replayTo(theLog, theLog.ticks.length);
    assert.deepEqual(
      tilesOf(state.units),
      tilesOf(viaReplayTo.units),
      "applyTick step by step and replayTo(log, last) disagree about final unit tiles",
    );
  } else {
    for (let t = 1; t <= theLog.ticks.length; t++) {
      visit(replay.replayTo(theLog, t), t);
    }
  }
}

function tilesOf(units) {
  return [...units].sort((a, b) => a.id - b.id).map((u) => [u.id, u.x, u.y]);
}

test("run-match.mjs exits 0 for a sample-player versus sample-player match", () => {
  assert.ok(fs.existsSync(RUN_MATCH), "env/run-match.mjs is missing (module not written yet)");
  assert.ok(fs.existsSync(SAMPLE_PLAYER), "players/sample-player.mjs is missing (module not written yet)");
  assert.equal(run.error, undefined, `could not start the child process\n${describeRun()}`);
  assert.equal(run.signal, null, `the child process was killed by a signal\n${describeRun()}`);
  assert.equal(run.status, 0, `run-match.mjs should exit 0\n${describeRun()}`);
});

test("run-match.mjs prints the result", () => {
  const theLog = requireLog();
  assert.ok(run.stdout.trim().length > 0, `run-match.mjs printed nothing on stdout\n${describeRun()}`);
  // §11: "runs one match and writes the log and prints the result". At minimum the printed text
  // should mention the reason the match ended.
  assert.ok(
    run.stdout.includes(String(theLog.result.reason)),
    `stdout should mention the end reason "${theLog.result.reason}"\n${describeRun()}`,
  );
});

test("the written log file validates with env/log.mjs", async () => {
  const theLog = requireLog();
  const { validateLog } = await import(LOG_MODULE);
  assert.equal(typeof validateLog, "function", "env/log.mjs must export validateLog");
  const problems = validateLog(theLog);
  assert.ok(Array.isArray(problems), "validateLog must return an array of problems");
  assert.deepEqual(problems, [], `validateLog reported problems:\n - ${problems.join("\n - ")}`);

  // A few headline fields from §12, checked directly so a weak validateLog can't hide them.
  assert.equal(theLog.format, "driftfall-log");
  assert.equal(theLog.version, 1);
  assert.equal(theLog.seed, SEED, "log.seed should be the --seed given on the command line");
  assert.ok(Array.isArray(theLog.players) && theLog.players.length === 2, "log.players should list two names");
  assert.ok(theLog.players.every((n) => typeof n === "string" && n.length > 0), "player names should be non-empty strings");
  assert.ok(Array.isArray(theLog.ticks) && theLog.ticks.length > 0, "log.ticks should be a non-empty list");
  assert.ok(Array.isArray(theLog.timing), "log.timing should be a top-level list");
  assert.equal(theLog.timing.length, theLog.ticks.length, "one timing pair per tick");
});

test("the result has a winner or a draw with a known reason", () => {
  const theLog = requireLog();
  const result = theLog.result;
  assert.ok(result && typeof result === "object", "log.result is missing");
  assert.ok(
    result.winner === 0 || result.winner === 1 || result.winner === null,
    `result.winner should be 0, 1 or null, got ${JSON.stringify(result.winner)}`,
  );
  assert.ok(
    KNOWN_REASONS.has(result.reason),
    `result.reason should be one of ${[...KNOWN_REASONS].join(", ")}, got ${JSON.stringify(result.reason)}`,
  );
  if (result.winner === null) {
    assert.ok(
      DRAW_REASONS.has(result.reason),
      `a draw can only end with reason both-cores or timeout, got ${JSON.stringify(result.reason)}`,
    );
  }
  assert.ok(Number.isInteger(result.tick) && result.tick > 0, `result.tick should be a positive integer, got ${result.tick}`);
  assert.equal(result.tick, theLog.ticks.length, "result.tick should equal the number of recorded ticks");
  assert.ok(
    Array.isArray(result.value) && result.value.length === 2 && result.value.every((v) => Number.isFinite(v) && v >= 0),
    `result.value should be two non-negative numbers, got ${JSON.stringify(result.value)}`,
  );
  if (result.reason === "timeout") {
    const [v0, v1] = result.value;
    const expected = v0 > v1 ? 0 : v1 > v0 ? 1 : null;
    assert.equal(result.winner, expected, `on timeout the higher value wins (values ${v0} vs ${v1})`);
  }
});

test("the sample player never forfeits or throws", () => {
  // The sample player is meant to be a minimal *legal* player, so a forfeit or error here is a
  // real bug in the player, the worker wrapper or the referee, not a rules outcome.
  const theLog = requireLog();
  assert.notEqual(theLog.result.reason, "forfeit", `the match ended by forfeit: ${JSON.stringify(theLog.result)}`);
  const bad = [];
  for (const entry of theLog.ticks) {
    for (const ev of entry.events ?? []) {
      if (ev.e === "forfeit" || ev.e === "error") bad.push({ tick: entry.tick, ...ev });
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `found ${bad.length} forfeit/error event(s); first few shown`);
});

test("no two units ever share a tile in the replayed states", async () => {
  const theLog = requireLog();
  const collisions = [];
  await forEachReplayedState(theLog, (state, tick) => {
    const seen = new Map();
    for (const u of state.units) {
      const key = `${u.x},${u.y}`;
      if (seen.has(key)) collisions.push({ tick, tile: key, ids: [seen.get(key), u.id] });
      else seen.set(key, u.id);
    }
  });
  assert.deepEqual(
    collisions.slice(0, 10),
    [],
    `${collisions.length} tick(s) with two units on one tile; first few shown`,
  );
});

test("no unit ever stands on a rock, crystal or structure in the replayed states", async () => {
  const theLog = requireLog();
  const problems = [];
  await forEachReplayedState(theLog, (state, tick) => {
    const blocked = new Map();
    for (const [x, y] of state.rocks ?? []) blocked.set(`${x},${y}`, "rock");
    for (const c of state.crystals ?? []) blocked.set(`${c.x},${c.y}`, "crystal");
    for (const s of state.structures ?? []) blocked.set(`${s.x},${s.y}`, `${s.kind} #${s.id}`);
    for (const u of state.units) {
      const key = `${u.x},${u.y}`;
      if (blocked.has(key)) problems.push({ tick, unit: u.id, tile: key, on: blocked.get(key) });
      if (u.x < 0 || u.y < 0 || u.x >= state.width || u.y >= state.height) {
        problems.push({ tick, unit: u.id, tile: key, on: "off-map" });
      }
    }
  });
  assert.deepEqual(problems.slice(0, 10), [], `${problems.length} unit(s) on an impassable tile; first few shown`);
});

test(`the whole match finishes in under ${TIME_LIMIT_MS / 1000} seconds`, () => {
  requireLog();
  assert.equal(run.status, 0, `the match did not finish cleanly, so its time is meaningless\n${describeRun()}`);
  assert.ok(
    run.elapsedMs < TIME_LIMIT_MS,
    `run-match.mjs took ${run.elapsedMs.toFixed(0)} ms for ${log.ticks.length} ticks; limit is ${TIME_LIMIT_MS} ms`,
  );
});
