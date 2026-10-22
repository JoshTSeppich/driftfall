#!/usr/bin/env node
// Team fable's match simulator and tuning harness.
//
// Runs many REAL Driftfall matches (the same env/sim.mjs `step`, `observe` and `checkEnd` the referee uses) between
// our bot and an opponent, over many seeds and with the sides swapped, in a pool of worker threads. Prints win
// rates with confidence intervals, value margins, end reasons, think-time stats and the seeds we lost, and appends
// one honest record per experiment to players/fable/results.json.
//
//   node players/fable/sim.mjs                              bot vs sample player, seeds 1-40, both sides
//   node players/fable/sim.mjs --seeds 1-100 --vs sample    more seeds
//   node players/fable/sim.mjs --vs versions                bot vs every older copy in players/fable/versions/
//   node players/fable/sim.mjs --vs self                    bot vs itself (mirror)
//   node players/fable/sim.mjs --vs players/fable/versions/v1.mjs --vs sample
//   node players/fable/sim.mjs --param aggression=0.7       pass tuning knobs to createPlayer({..., params})
//   node players/fable/sim.mjs --sweep aggression=0.3,0.5,0.7 --sweep rush=0,1   grid of experiments
//   node players/fable/sim.mjs --referee --seeds 1-8        through env/referee.mjs (worker threads, real 50 ms limit)
//   node players/fable/sim.mjs --check --seeds 3            prove in-process == referee for a seed
//   node players/fable/sim.mjs --out players/fable/logs --save losses   write viewer logs of lost matches
//
// Options
//   --bot <path>         our player module (default players/fable/bot.mjs)
//   --vs <what>          opponent: sample | self | versions | <path>. Repeatable. Default sample.
//   --seeds <spec>       "1-40", "1,5,9", or "40" (= 1-40). Default 1-40.
//   --sides both|0|1     which side the bot plays (default both: every seed is played twice)
//   --jobs N             worker threads (default cpus - 1)
//   --max-ticks N        shorter matches (default from stats, 2000)
//   --think MS           think limit to emulate in-process (default stats, 50)
//   --param k=v          tuning knob for the bot (repeatable; numbers and true/false are parsed)
//   --sweep k=a,b,c      run one experiment per value (repeatable; combined as a grid)
//   --label <text>       name for this experiment in results.json
//   --referee            run through env/referee.mjs instead of in-process (slower, real timing)
//   --check              compare in-process and referee runs on the given seeds; no results written
//   --out <dir>          where to write match logs; --save all|losses|none (default losses when --out is set)
//   --no-record          do not append to results.json
//   --quiet              only the summary tables
//
// Player contract used here: createPlayer({ side, seed, stats, params }) -> { name, act(obs) }. `params` is extra
// (the referee never sends it); a bot should treat it as optional. Referee mode passes the same knobs through the
// FABLE_PARAMS environment variable (a JSON object) because the referee loads players by path.
//
// Honesty rules: every number printed comes from matches actually run in this process; in-process timings
// understate the referee's (no message passing), so finish tuning with a --referee run before trusting the
// think-time margin. New unit kinds need no change here: every per-kind count is keyed from the stats table.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ENV = (file) => pathToFileURL(path.join(ROOT, 'env', file)).href;
const DEFAULT_BOT = path.join(HERE, 'bot.mjs');
const SAMPLE = path.join(ROOT, 'players', 'sample-player.mjs');
const VERSIONS_DIR = path.join(HERE, 'versions');
const RESULTS = path.join(HERE, 'results.json');

// ---------------------------------------------------------------------------------------------------------------
// Running one match in-process (the fast path). Mirrors env/referee.mjs tick for tick: observe both sides, ask
// both players, discard a reply slower than the think limit (`late`), count throws and non-arrays (`error`),
// forfeit after the throw limit, then `step`. The 1000 ms hard cut-off cannot interrupt synchronous code, so a
// reply slower than that ends the match as a forfeit after the fact.
// ---------------------------------------------------------------------------------------------------------------

const moduleCache = new Map();
async function loadPlayerModule(file) {
  const abs = path.resolve(file);
  if (!moduleCache.has(abs)) {
    const url = pathToFileURL(abs).href + '?v=' + fileHash(abs); // fresh copy when the file changes
    moduleCache.set(abs, import(url));
  }
  const mod = await moduleCache.get(abs);
  if (typeof mod.createPlayer !== 'function') throw new Error(file + ' does not export createPlayer');
  return mod;
}

function fileHash(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  } catch {
    return 'missing';
  }
}

let envModules = null;
async function env() {
  if (!envModules) {
    const [sim, state, stats, log] = await Promise.all([
      import(ENV('sim.mjs')),
      import(ENV('state.mjs')),
      import(ENV('stats.mjs')),
      import(ENV('log.mjs')),
    ]);
    envModules = { sim, state, stats, log };
  }
  return envModules;
}

// Counts of living units and complete structures by kind for one side (keys come from the entities, so any kind
// the roster grows to is counted without a code change).
function countKinds(list, side) {
  const out = {};
  for (const e of list) {
    if (e.owner !== side) continue;
    if ('complete' in e && !e.complete) continue;
    out[e.kind] = (out[e.kind] ?? 0) + 1;
  }
  return out;
}

const describe = (err) => (err instanceof Error ? err.message || err.name : String(err));

/**
 * Play one match in this thread. `players` are two { file, params } entries for sides 0 and 1.
 * Returns { result, perSide: [{ name, ms: {max, mean, n}, late, errors, rejects, commands }], end: {...}, log? }.
 */
async function playInProcess({ seed, players, maxTicks, thinkMs, hardMs, keepLog }) {
  const { sim, state: stateMod, stats: statsMod, log: logMod } = await env();
  const { STATS } = statsMod;
  const think = thinkMs ?? STATS.referee.thinkMs;
  const hard = hardMs ?? STATS.referee.hardMs;
  const throwLimit = STATS.referee.throwLimit;

  const made = [];
  for (const side of [0, 1]) {
    const mod = await loadPlayerModule(players[side].file);
    const p = await mod.createPlayer({ side, seed, stats: STATS, params: players[side].params ?? {} });
    if (!p || typeof p.act !== 'function') throw new Error(players[side].file + ': createPlayer did not return { act }');
    made.push({
      player: p,
      name: typeof p.name === 'string' && p.name ? p.name : path.basename(players[side].file),
      msMax: 0,
      msSum: 0,
      n: 0,
      late: 0,
      errors: 0,
      rejects: 0,
      commands: 0,
      slowTicks: 0, // ticks over the think limit, including the ones only slightly over
    });
  }

  const state = sim.createMatch(seed);
  if (maxTicks) state.maxTicks = maxTicks;
  const log = keepLog
    ? logMod.createLog({ seed, players: made.map((m) => m.name), stats: STATS, initial: stripYou(stateMod.observe(state, 0)) })
    : null;

  let result = null;
  while (!result) {
    const tick = state.tick;
    const observations = [stateMod.observe(state, 0), stateMod.observe(state, 1)];
    const commands = [[], []];
    const events = [];
    const timing = [0, 0];
    const forfeited = [false, false];

    for (const side of [0, 1]) {
      const m = made[side];
      const t0 = performance.now();
      let reply;
      let error = null;
      try {
        reply = await m.player.act(observations[side]);
      } catch (err) {
        error = describe(err);
      }
      const ms = performance.now() - t0;
      timing[side] = ms;
      m.n += 1;
      m.msSum += ms;
      if (ms > m.msMax) m.msMax = ms;
      if (ms > hard) {
        forfeited[side] = true;
        events.push({ e: 'forfeit', player: side, reason: 'timeout' });
        continue;
      }
      const late = ms > think;
      if (late) {
        m.late += 1;
        events.push({ e: 'late', player: side });
      }
      if (error !== null) {
        m.errors += 1;
        events.push({ e: 'error', player: side, message: error });
      } else if (!Array.isArray(reply)) {
        m.errors += 1;
        events.push({ e: 'error', player: side, message: 'act returned a non-array' });
      } else if (!late) {
        commands[side] = reply;
      }
      if (m.errors >= throwLimit) {
        forfeited[side] = true;
        events.push({ e: 'forfeit', player: side, reason: 'errors' });
      }
    }

    if (forfeited[0] || forfeited[1]) {
      if (log) logMod.appendTick(log, { tick, commands: [[], []], events }, timing);
      const winner = forfeited[0] && forfeited[1] ? null : forfeited[0] ? 1 : 0;
      result = { winner, reason: 'forfeit', tick: state.tick, value: [statsMod.sideValue(state, 0), statsMod.sideValue(state, 1)] };
      break;
    }

    made[0].commands += commands[0].length;
    made[1].commands += commands[1].length;
    const stepEvents = sim.step(state, commands);
    for (const ev of stepEvents) if (ev.e === 'reject') made[ev.player].rejects += 1;
    if (log) logMod.appendTick(log, { tick, commands, events: events.concat(stepEvents) }, timing);
    result = state.result ?? sim.checkEnd(state);
  }
  if (log) logMod.finishLog(log, result);

  return {
    result,
    perSide: made.map((m) => ({
      name: m.name,
      ms: { max: round3(m.msMax), mean: round3(m.n ? m.msSum / m.n : 0), n: m.n },
      late: m.late,
      errors: m.errors,
      rejects: m.rejects,
      commands: m.commands,
    })),
    end: {
      shards: [state.shards[0], state.shards[1]],
      units: [countKinds(state.units, 0), countKinds(state.units, 1)],
      structures: [countKinds(state.structures, 0), countKinds(state.structures, 1)],
    },
    log,
  };
}

function stripYou(observation) {
  const copy = { ...observation };
  delete copy.you;
  return copy;
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/** The same match through the real referee (worker threads, wall-clock limits). */
async function playWithReferee({ seed, players, maxTicks, thinkMs, hardMs, keepLog }) {
  const { runMatch } = await import(ENV('referee.mjs'));
  const options = { seed, players: players.map((p) => p.file) };
  if (maxTicks) options.maxTicks = maxTicks;
  if (thinkMs !== undefined && thinkMs !== null) options.thinkMs = thinkMs;
  if (hardMs !== undefined && hardMs !== null) options.hardMs = hardMs;
  // The referee cannot take params; the bot may read them from this variable instead.
  const params = players.map((p) => p.params ?? {});
  process.env.FABLE_PARAMS = JSON.stringify(params[0]);
  process.env.FABLE_PARAMS_SIDE0 = JSON.stringify(params[0]);
  process.env.FABLE_PARAMS_SIDE1 = JSON.stringify(params[1]);
  const { log, result } = await runMatch(options);
  const perSide = [0, 1].map((side) => {
    let msMax = 0;
    let msSum = 0;
    let late = 0;
    let errors = 0;
    let rejects = 0;
    let commands = 0;
    log.timing.forEach((pair) => {
      msSum += pair[side];
      if (pair[side] > msMax) msMax = pair[side];
    });
    for (const t of log.ticks) {
      commands += t.commands[side].length;
      for (const ev of t.events) {
        if (ev.e === 'late' && ev.player === side) late += 1;
        else if (ev.e === 'error' && ev.player === side) errors += 1;
        else if (ev.e === 'reject' && ev.player === side) rejects += 1;
      }
    }
    return {
      name: log.players[side],
      ms: { max: round3(msMax), mean: round3(log.timing.length ? msSum / log.timing.length : 0), n: log.timing.length },
      late,
      errors,
      rejects,
      commands,
    };
  });
  // End-of-match counts are rebuilt from the log's final state via the viewer replayer when available.
  let end = null;
  try {
    const { replayTo } = await import(pathToFileURL(path.join(ROOT, 'viewer', 'replay.mjs')).href);
    const final = replayTo(log, log.ticks.length);
    end = {
      shards: [final.shards[0], final.shards[1]],
      units: [countKinds(final.units, 0), countKinds(final.units, 1)],
      structures: [countKinds(final.structures, 0), countKinds(final.structures, 1)],
    };
  } catch {
    end = { shards: null, units: [{}, {}], structures: [{}, {}] };
  }
  return { result, perSide, end, log: keepLog ? log : null };
}

// ---------------------------------------------------------------------------------------------------------------
// Worker side: each worker thread plays the matches it is handed and posts back a compact summary.
// ---------------------------------------------------------------------------------------------------------------

if (!isMainThread && workerData && workerData.role === 'fable-sim-worker') {
  parentPort.on('message', async (job) => {
    if (!job || job.type !== 'play') return;
    try {
      const play = job.spec.referee ? playWithReferee : playInProcess;
      const out = await play(job.spec);
      parentPort.postMessage({ type: 'done', id: job.id, out: { ...out, log: out.log ? JSON.stringify(out.log) : null } });
    } catch (err) {
      parentPort.postMessage({ type: 'done', id: job.id, error: (err && err.stack) || String(err) });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Main side: argument parsing, the job pool, aggregation, printing and recording.
// ---------------------------------------------------------------------------------------------------------------

export function parseSeeds(spec) {
  const s = String(spec).trim();
  if (/^\d+$/.test(s)) return range(1, Number(s));
  const seeds = [];
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(-?\d+)\s*-\s*(-?\d+)$/);
    if (m) seeds.push(...range(Number(m[1]), Number(m[2])));
    else if (/^-?\d+$/.test(part.trim())) seeds.push(Number(part));
    else throw new Error('bad --seeds value: ' + spec);
  }
  return seeds;
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && Number.isFinite(Number(raw))) return Number(raw);
  return raw;
}

export function parseArgs(argv) {
  const o = {
    bot: DEFAULT_BOT,
    vs: [],
    seeds: '1-40',
    sides: 'both',
    jobs: Math.max(1, os.cpus().length - 1),
    maxTicks: null,
    think: null,
    hard: null,
    params: {},
    sweep: [],
    label: null,
    referee: false,
    check: false,
    out: null,
    save: null,
    record: true,
    quiet: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error('missing value after ' + a);
      return argv[++i];
    };
    switch (a) {
      case '--bot': o.bot = path.resolve(next()); break;
      case '--vs': o.vs.push(next()); break;
      case '--seeds': o.seeds = next(); break;
      case '--sides': o.sides = next(); break;
      case '--jobs': o.jobs = Math.max(1, Number(next()) | 0); break;
      case '--max-ticks': o.maxTicks = Number(next()); break;
      case '--think': o.think = Number(next()); break;
      case '--hard': o.hard = Number(next()); break;
      case '--param': {
        const [k, ...rest] = next().split('=');
        o.params[k] = parseValue(rest.join('='));
        break;
      }
      case '--sweep': {
        const [k, ...rest] = next().split('=');
        o.sweep.push({ key: k, values: rest.join('=').split(',').map(parseValue) });
        break;
      }
      case '--label': o.label = next(); break;
      case '--referee': o.referee = true; break;
      case '--check': o.check = true; break;
      case '--out': o.out = path.resolve(next()); break;
      case '--save': o.save = next(); break;
      case '--no-record': o.record = false; break;
      case '--quiet': o.quiet = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error('unknown argument ' + a);
    }
  }
  if (!o.vs.length) o.vs = ['sample'];
  if (!['both', '0', '1'].includes(o.sides)) throw new Error('--sides must be both, 0 or 1');
  if (o.out && !o.save) o.save = 'losses';
  if (o.save && !['all', 'losses', 'none'].includes(o.save)) throw new Error('--save must be all, losses or none');
  return o;
}

/** Turn --vs words into opponent entries { label, file }. */
function resolveOpponents(words, botFile) {
  const out = [];
  for (const w of words) {
    if (w === 'sample') out.push({ label: 'sample', file: SAMPLE });
    else if (w === 'self') out.push({ label: 'self', file: botFile });
    else if (w === 'versions') {
      if (!fs.existsSync(VERSIONS_DIR)) {
        console.error(`no ${path.relative(ROOT, VERSIONS_DIR)} folder yet; copy older bots there as v1.mjs, v2.mjs, ...`);
        continue;
      }
      const files = fs.readdirSync(VERSIONS_DIR).filter((f) => f.endsWith('.mjs')).sort();
      for (const f of files) out.push({ label: 'versions/' + f.replace(/\.mjs$/, ''), file: path.join(VERSIONS_DIR, f) });
    } else {
      const file = path.resolve(w);
      out.push({ label: path.relative(ROOT, file), file });
    }
  }
  return out;
}

// Cartesian product of the sweep values: [{k1: v, k2: v}, ...]; a single empty object when there is no sweep.
function sweepGrid(sweep) {
  let grid = [{}];
  for (const { key, values } of sweep) {
    const next = [];
    for (const g of grid) for (const v of values) next.push({ ...g, [key]: v });
    grid = next;
  }
  return grid;
}

/** A small pool of worker threads running this very file. */
class Pool {
  constructor(size) {
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    for (let i = 0; i < size; i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { role: 'fable-sim-worker' } });
      w.on('message', (msg) => this.onMessage(w, msg));
      w.on('error', (err) => this.failAll('worker crashed: ' + describe(err)));
      this.workers.push(w);
      this.idle.push(w);
    }
  }
  run(spec) {
    return new Promise((resolve, reject) => {
      this.queue.push({ spec, resolve, reject });
      this.pump();
    });
  }
  pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const job = this.queue.shift();
      const id = this.nextId++;
      this.pending.set(id, { ...job, w });
      w.postMessage({ type: 'play', id, spec: job.spec });
    }
  }
  onMessage(w, msg) {
    if (!msg || msg.type !== 'done') return;
    const job = this.pending.get(msg.id);
    if (!job) return;
    this.pending.delete(msg.id);
    this.idle.push(w);
    if (msg.error) job.reject(new Error(msg.error));
    else job.resolve(msg.out);
    this.pump();
  }
  failAll(message) {
    for (const [, job] of this.pending) job.reject(new Error(message));
    this.pending.clear();
  }
  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

// Wilson 95% interval for a proportion (draws count as half a win in the headline rate).
export function wilson(successes, n) {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

const pct = (x) => (100 * x).toFixed(1) + '%';
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Build the per-opponent summary from a list of match rows. */
function summarise(rows) {
  const wins = rows.filter((r) => r.outcome === 'win').length;
  const losses = rows.filter((r) => r.outcome === 'loss').length;
  const draws = rows.length - wins - losses;
  const score = wins + draws / 2;
  const [lo, hi] = wilson(score, rows.length);
  const bySide = {};
  for (const side of [0, 1]) {
    const sub = rows.filter((r) => r.botSide === side);
    if (!sub.length) continue;
    bySide[side] = {
      n: sub.length,
      wins: sub.filter((r) => r.outcome === 'win').length,
      losses: sub.filter((r) => r.outcome === 'loss').length,
      draws: sub.filter((r) => r.outcome === 'draw').length,
      meanValueDiff: Math.round(mean(sub.map((r) => r.valueDiff))),
    };
  }
  const reasons = {};
  for (const r of rows) {
    const key = r.outcome + ':' + r.reason;
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  const coreWins = rows.filter((r) => r.outcome === 'win' && r.reason === 'core');
  const unitsEnd = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.botUnits)) unitsEnd[k] = (unitsEnd[k] ?? 0) + v;
  for (const k of Object.keys(unitsEnd)) unitsEnd[k] = round3(unitsEnd[k] / rows.length);
  return {
    matches: rows.length,
    wins,
    losses,
    draws,
    winRate: round3(score / rows.length),
    ci95: [round3(lo), round3(hi)],
    bySide,
    meanValueDiff: Math.round(mean(rows.map((r) => r.valueDiff))),
    meanBotValue: Math.round(mean(rows.map((r) => r.botValue))),
    meanOppValue: Math.round(mean(rows.map((r) => r.oppValue))),
    meanTick: Math.round(mean(rows.map((r) => r.tick))),
    meanCoreWinTick: coreWins.length ? Math.round(mean(coreWins.map((r) => r.tick))) : null,
    reasons,
    timing: {
      maxMs: round3(Math.max(0, ...rows.map((r) => r.botMs.max))),
      meanMs: round3(mean(rows.map((r) => r.botMs.mean))),
      lateTicks: rows.reduce((a, r) => a + r.late, 0),
      errorTicks: rows.reduce((a, r) => a + r.errors, 0),
      rejects: rows.reduce((a, r) => a + r.rejects, 0),
    },
    botUnitsAtEndMean: unitsEnd,
    lostSeeds: rows.filter((r) => r.outcome === 'loss').map((r) => `${r.seed}/s${r.botSide}`),
    drawSeeds: rows.filter((r) => r.outcome === 'draw').map((r) => `${r.seed}/s${r.botSide}`),
  };
}

function rowFrom(spec, out) {
  const bs = spec.botSide;
  const os_ = 1 - bs;
  const { result } = out;
  const outcome = result.winner === null ? 'draw' : result.winner === bs ? 'win' : 'loss';
  return {
    seed: spec.seed,
    botSide: bs,
    outcome,
    reason: result.reason,
    tick: result.tick,
    botValue: result.value[bs],
    oppValue: result.value[os_],
    valueDiff: result.value[bs] - result.value[os_],
    botMs: out.perSide[bs].ms,
    late: out.perSide[bs].late,
    errors: out.perSide[bs].errors,
    rejects: out.perSide[bs].rejects,
    commands: out.perSide[bs].commands,
    oppMs: out.perSide[os_].ms,
    botUnits: out.end.units[bs],
    botStructures: out.end.structures[bs],
    oppUnits: out.end.units[os_],
    botShards: out.end.shards ? out.end.shards[bs] : null,
  };
}

function fmtRow(opp, r) {
  const sign = r.valueDiff >= 0 ? '+' : '';
  const flags = [r.late ? `late×${r.late}` : '', r.errors ? `err×${r.errors}` : '', r.rejects ? `rej×${r.rejects}` : ''].filter(Boolean).join(' ');
  return `  seed ${String(r.seed).padStart(4)} side ${r.botSide} vs ${opp.padEnd(16)} ${r.outcome.toUpperCase().padEnd(4)} ${r.reason.padEnd(7)} @${String(r.tick).padStart(4)}  value ${r.botValue} vs ${r.oppValue} (${sign}${r.valueDiff})  max ${r.botMs.max.toFixed(1)} ms ${flags}`;
}

function printSummary(label, s) {
  const side = (k) => (s.bySide[k] ? `${s.bySide[k].wins}-${s.bySide[k].losses}-${s.bySide[k].draws} (Δ${s.bySide[k].meanValueDiff >= 0 ? '+' : ''}${s.bySide[k].meanValueDiff})` : '—');
  console.log(`\n== ${label} ==`);
  console.log(`  matches ${s.matches}: ${s.wins} won, ${s.losses} lost, ${s.draws} drawn  →  win rate ${pct(s.winRate)} (95% CI ${pct(s.ci95[0])}–${pct(s.ci95[1])})`);
  console.log(`  as side 0: ${side(0)}   as side 1: ${side(1)}`);
  console.log(`  mean value ${s.meanBotValue} vs ${s.meanOppValue} (Δ${s.meanValueDiff >= 0 ? '+' : ''}${s.meanValueDiff}); mean end tick ${s.meanTick}` + (s.meanCoreWinTick !== null ? `; core kills on average at tick ${s.meanCoreWinTick}` : ''));
  console.log(`  ends: ${Object.entries(s.reasons).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  think time: max ${s.timing.maxMs} ms, mean ${s.timing.meanMs} ms; late ticks ${s.timing.lateTicks}, error ticks ${s.timing.errorTicks}, rejected commands ${s.timing.rejects}`);
  const units = Object.entries(s.botUnitsAtEndMean).map(([k, v]) => `${k} ${v}`).join(', ');
  if (units) console.log(`  bot units alive at the end (mean): ${units}`);
  if (s.lostSeeds.length) console.log(`  lost: ${s.lostSeeds.join(' ')}`);
  if (s.drawSeeds.length) console.log(`  drew: ${s.drawSeeds.join(' ')}`);
}

function readResults() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendResult(record) {
  const all = readResults();
  all.push(record);
  fs.writeFileSync(RESULTS, JSON.stringify(all, null, 1) + '\n');
}

function saveLog(dir, name, logJson) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof logJson === 'string' ? logJson + '\n' : JSON.stringify(logJson) + '\n');
  return file;
}

/** Run one experiment (one params setting) against every opponent; returns { summaries, rows }. */
async function runExperiment(o, pool, opponents, seeds, params) {
  const sides = o.sides === 'both' ? [0, 1] : [Number(o.sides)];
  const specs = [];
  for (const opp of opponents) {
    for (const seed of seeds) {
      for (const botSide of sides) {
        const bot = { file: o.bot, params };
        const other = { file: opp.file, params: opp.label === 'self' ? params : {} };
        specs.push({
          opp: opp.label,
          seed,
          botSide,
          players: botSide === 0 ? [bot, other] : [other, bot],
          maxTicks: o.maxTicks ?? undefined,
          thinkMs: o.think ?? undefined,
          hardMs: o.hard ?? undefined,
          keepLog: o.save === 'all' || o.save === 'losses',
          referee: o.referee,
        });
      }
    }
  }

  const rowsByOpp = new Map(opponents.map((opp) => [opp.label, []]));
  let done = 0;
  const started = performance.now();
  await Promise.all(
    specs.map((spec) =>
      pool.run(spec).then((out) => {
        done += 1;
        const row = rowFrom(spec, out);
        rowsByOpp.get(spec.opp).push(row);
        if (!o.quiet) console.log(fmtRow(spec.opp, row) + `   [${done}/${specs.length}]`);
        if (out.log && o.out && (o.save === 'all' || (o.save === 'losses' && row.outcome !== 'win'))) {
          const name = `${spec.opp.replace(/[\/\\]/g, '_')}-seed${spec.seed}-side${spec.botSide}-${row.outcome}.json`;
          row.log = path.relative(ROOT, saveLog(o.out, name, out.log));
        }
      }),
    ),
  );
  const elapsed = Math.round(performance.now() - started);

  const summaries = {};
  for (const [label, rows] of rowsByOpp) {
    rows.sort((a, b) => a.seed - b.seed || a.botSide - b.botSide);
    summaries[label] = summarise(rows);
  }
  return { summaries, rowsByOpp, elapsed, matches: specs.length };
}

/** --check: the same seeds through both paths must give the same result and the same comparable log. */
async function runCheck(o, opponents, seeds) {
  const { log: logMod } = await env();
  let ok = true;
  for (const opp of opponents) {
    for (const seed of seeds) {
      const players = [{ file: o.bot, params: o.params }, { file: opp.file, params: {} }];
      const a = await playInProcess({ seed, players, maxTicks: o.maxTicks ?? undefined, keepLog: true });
      const b = await playWithReferee({ seed, players, maxTicks: o.maxTicks ?? undefined, keepLog: true });
      const sameResult = JSON.stringify(a.result) === JSON.stringify(b.result);
      const sameLog = JSON.stringify(logMod.comparable(a.log)) === JSON.stringify(logMod.comparable(b.log));
      const lateA = a.perSide[0].late + a.perSide[1].late;
      const lateB = b.perSide[0].late + b.perSide[1].late;
      console.log(`seed ${seed} vs ${opp.label}: result ${sameResult ? 'same' : 'DIFFERENT'}, log ${sameLog ? 'identical' : 'DIFFERENT'}; late ticks in-process ${lateA}, referee ${lateB}; in-process ${JSON.stringify(a.result)}` + (sameResult ? '' : `; referee ${JSON.stringify(b.result)}`));
      if (!sameResult || !sameLog) ok = false;
    }
  }
  console.log(ok ? '\nin-process and referee runs agree.' : '\nMISMATCH: in-process and referee runs differ (late ticks are the usual cause; try --referee for the real numbers).');
  return ok ? 0 : 1;
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error('see the header of players/fable/sim.mjs for usage');
    return 1;
  }
  if (o.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 45).map((l) => l.slice(3)).join('\n'));
    return 0;
  }
  if (!fs.existsSync(o.bot)) {
    console.error(`bot not found: ${path.relative(ROOT, o.bot)} (pass --bot <path>, or --bot players/sample-player.mjs to test the harness)`);
    return 1;
  }
  const opponents = resolveOpponents(o.vs, o.bot);
  if (!opponents.length) {
    console.error('no opponents to play');
    return 1;
  }
  for (const opp of opponents) {
    if (!fs.existsSync(opp.file)) {
      console.error(`opponent not found: ${opp.file}`);
      return 1;
    }
  }
  const seeds = parseSeeds(o.seeds);

  if (o.check) return runCheck(o, opponents, seeds);

  const botHash = fileHash(o.bot);
  const grid = sweepGrid(o.sweep);
  const jobs = Math.min(o.jobs, seeds.length * (o.sides === 'both' ? 2 : 1) * opponents.length);
  console.log(`bot ${path.relative(ROOT, o.bot)} (${botHash}) vs ${opponents.map((x) => x.label).join(', ')}; seeds ${o.seeds} (${seeds.length}), sides ${o.sides}, ${o.referee ? 'referee' : 'in-process'} mode, ${jobs} worker${jobs === 1 ? '' : 's'}` + (grid.length > 1 ? `, sweep of ${grid.length} settings` : ''));

  const pool = new Pool(jobs);
  const sweepTable = [];
  try {
    for (const point of grid) {
      const params = { ...o.params, ...point };
      if (grid.length > 1) console.log(`\n--- params ${JSON.stringify(params)} ---`);
      const { summaries, elapsed, matches } = await runExperiment(o, pool, opponents, seeds, params);
      for (const [label, s] of Object.entries(summaries)) printSummary(`${path.basename(o.bot)} vs ${label}` + (grid.length > 1 ? ' ' + JSON.stringify(point) : ''), s);
      console.log(`  (${matches} matches in ${(elapsed / 1000).toFixed(1)} s)`);

      if (o.record) {
        appendResult({
          at: new Date().toISOString(),
          label: o.label,
          mode: o.referee ? 'referee' : 'in-process',
          bot: path.relative(ROOT, o.bot),
          botHash,
          params,
          seeds: o.seeds,
          sides: o.sides,
          maxTicks: o.maxTicks,
          opponents: Object.fromEntries(
            Object.entries(summaries).map(([label, s]) => [label, { file: path.relative(ROOT, opponents.find((x) => x.label === label).file), hash: fileHash(opponents.find((x) => x.label === label).file), ...s }]),
          ),
          elapsedMs: elapsed,
        });
      }
      for (const [label, s] of Object.entries(summaries)) sweepTable.push({ params: point, opp: label, s });
    }
  } finally {
    await pool.close();
  }

  if (grid.length > 1) {
    console.log('\n== sweep ==');
    for (const { params, opp, s } of sweepTable) {
      console.log(`  ${JSON.stringify(params).padEnd(40)} vs ${opp.padEnd(16)} win ${pct(s.winRate).padStart(6)} (${pct(s.ci95[0])}–${pct(s.ci95[1])})  Δvalue ${s.meanValueDiff >= 0 ? '+' : ''}${s.meanValueDiff}  core@${s.meanCoreWinTick ?? '—'}  max ${s.timing.maxMs} ms`);
    }
  }
  if (o.record) console.log(`\nrecorded in ${path.relative(ROOT, RESULTS)}`);
  return 0;
}

const isEntry = isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error('sim failed:', err && err.stack ? err.stack : err);
      process.exitCode = 2;
    },
  );
}

export { playInProcess, playWithReferee, summarise };
