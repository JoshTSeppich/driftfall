#!/usr/bin/env node
// Team sonnet's match simulator and tuning harness.
//
// Runs REAL Driftfall matches (env/sim.mjs, env/state.mjs observe(), the same rules as the referee) with both
// players in this process, so a 2000-tick match takes tens of milliseconds instead of the referee's worker-thread
// round trip. Matches fan out over a pool of worker threads. Nothing here changes the rules: if you doubt the
// harness, run `--check-referee` and it replays seeds through env/referee.mjs and compares results.
//
//   node players/sonnet/sim.mjs --a bot --b sample --seeds 1-100
//   node players/sonnet/sim.mjs --a bot --b sample,snap:v1,git:HEAD~3 --seeds 1-200 --save "baseline"
//   node players/sonnet/sim.mjs --snapshot v1                      freeze the current players/sonnet as "snap:v1"
//   node players/sonnet/sim.mjs --a bot --b sample --sweep aggro=0.3,0.5,0.8 --sweep expand=0,1 --seeds 1-60
//   node players/sonnet/sim.mjs --a bot --b snap:v1 --seeds 7 --out matches/sonnet-test.json   (log for the viewer)
//   node players/sonnet/sim.mjs --check-referee --seeds 1-3
//
// Player specs (for --a / --b, comma-separated list allowed for --b):
//   bot            players/sonnet/bot.mjs            sample    players/sample-player.mjs
//   <path>         any player module                 snap:NAME a frozen copy made with --snapshot NAME
//   git:REV        players/sonnet at git revision REV (bot.mjs entry), e.g. git:HEAD~2
// Frozen copies live in node_modules/.cache/driftfall-sim/ (git-ignored). Each gets a symlink to the repo's env/.
//
// Tuning knobs: --a-params '{"k":1}' / --b-params, or --sweep key=v1,v2,... (repeatable, cartesian product).
// The bot receives them as createPlayer({ side, seed, stats, params }); a bot that wants to be tunable just reads
// `params` (undefined or {} when nothing is passed) and falls back to its defaults. Values parse as JSON when they
// can (numbers, true/false, null), otherwise stay strings.
//
// Options:
//   --seeds 1-100 | 3,7,9      seeds to play (default 1-20)
//   --seats both|0|1           which seat A takes (default both: every seed is played twice, A as side 0 and 1)
//   --jobs N                   worker threads (default cores-1)
//   --max-ticks N              shorter matches for quick looks
//   --think MS                 think limit; default 50. Slow acts are always counted; with --enforce-think their
//                              commands are also thrown away, like the referee does (makes results timing-dependent)
//   --label TEXT --save        append this experiment to players/sonnet/results.json
//   --out FILE                 write the match log of the first match (viewer format, spec section 12)
//   --verbose                  one line per match
//   --json                     print the summary as JSON
//
// Metrics per matchup (A is the player under test): wins/draws/losses, score (win 1, draw 0.5), Wilson 95% interval,
// win rate by seat, how matches ended, mean end tick, mean final value margin (A - B), mean econ and army numbers
// (Shards delivered, units trained by kind, kills, losses, first fight tick, peak army) and per-act think time.
//
// New units in v3 need no change here: kinds, costs and the observation all come from env/stats.mjs and
// env/state.mjs observe(); statistics count by whatever kind names show up in the event stream.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SELF = fileURLToPath(import.meta.url);
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'driftfall-sim');
const RESULTS = path.join(HERE, 'results.json');

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// ---------------------------------------------------------------------------------------------------------------
// Player specs

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'results.json' || entry.name === 'node_modules') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function newCacheDir(id) {
  const dir = path.join(CACHE, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'players'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'env'), path.join(dir, 'env'), 'dir');
  return dir;
}

export function snapshot(name) {
  const dir = newCacheDir('snap-' + name);
  copyDir(HERE, path.join(dir, 'players', 'sonnet'));
  return dir;
}

function fromGit(rev) {
  const id = 'git-' + execFileSync('git', ['rev-parse', '--short', rev], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dir = path.join(CACHE, id);
  if (!fs.existsSync(path.join(dir, 'players', 'sonnet', 'bot.mjs'))) {
    newCacheDir(id);
    const tarball = execFileSync('git', ['archive', rev, 'players/sonnet'], { cwd: ROOT, maxBuffer: 1 << 28 });
    execFileSync('tar', ['-x', '-C', dir], { input: tarball });
  }
  return dir;
}

/** Turn a spec into { label, file } (file is an absolute path to a player module). */
export function resolveSpec(spec) {
  if (spec === 'bot') return { label: 'bot', file: path.join(HERE, 'bot.mjs') };
  if (spec === 'sample') return { label: 'sample', file: path.join(ROOT, 'players', 'sample-player.mjs') };
  if (spec.startsWith('snap:')) {
    const file = path.join(CACHE, 'snap-' + spec.slice(5), 'players', 'sonnet', 'bot.mjs');
    if (!fs.existsSync(file)) throw new Error(`no snapshot "${spec.slice(5)}": make one with --snapshot ${spec.slice(5)}`);
    return { label: spec, file };
  }
  if (spec.startsWith('git:')) {
    return { label: spec, file: path.join(fromGit(spec.slice(4)), 'players', 'sonnet', 'bot.mjs') };
  }
  const file = path.resolve(spec);
  if (!fs.existsSync(file)) throw new Error('player not found: ' + spec);
  return { label: path.basename(file, '.mjs'), file };
}

// ---------------------------------------------------------------------------------------------------------------
// One match, in process

const bump = (obj, key, by = 1) => {
  obj[key] = (obj[key] ?? 0) + by;
};

/**
 * Play one match. task = { seed, files: [fileSide0, fileSide1], params: [p0, p1], maxTicks, thinkMs, enforceThink,
 * wantLog }. Returns { result, stats, log? }. Never throws for a player's own failures: those become `error`
 * counts and, at 50 thrown ticks, a forfeit (as in the referee).
 */
export async function playMatch(task) {
  const { createMatch, step } = await load('env/sim.mjs');
  const { observe } = await load('env/state.mjs');
  const { STATS, sideValue } = await load('env/stats.mjs');

  const state = createMatch(task.seed);
  if (task.maxTicks) state.maxTicks = task.maxTicks;
  const thinkMs = task.thinkMs ?? STATS.referee.thinkMs;
  const throwLimit = STATS.referee.throwLimit;

  const players = [];
  const forfeit = [null, null];
  for (const side of [0, 1]) {
    try {
      const mod = await import(pathToFileURL(task.files[side]).href);
      const made = await mod.createPlayer({ side, seed: task.seed, stats: STATS, params: task.params?.[side] ?? {} });
      if (!made || typeof made.act !== 'function') throw new Error('createPlayer returned no act()');
      players.push(made);
    } catch (err) {
      players.push(null);
      forfeit[side] = 'load: ' + (err && err.message);
    }
  }

  const m = {
    delivered: [0, 0], trained: [{}, {}], built: [{}, {}], kills: [0, 0], losses: [0, 0], lostKinds: [{}, {}],
    firstHit: null, peakArmy: [0, 0], errors: [0, 0], late: [0, 0], actMs: [0, 0], actMax: [0, 0], acts: [0, 0],
    rejects: [0, 0], rejectReasons: [{}, {}], blocked: [0, 0],
  };
  const log = task.wantLog ? { ticks: [] } : null;
  const owners = new Map(); // id -> { owner, kind }; filled as things appear
  const track = (e) => owners.set(e.id, { owner: e.owner, kind: e.kind });
  for (const e of [...state.units, ...state.structures]) track(e);
  const initial = log ? JSON.parse(JSON.stringify({ ...state, rockSet: undefined, events: undefined })) : null;

  const errTicks = [0, 0];
  while (!state.result && !forfeit[0] && !forfeit[1]) {
    const lists = [[], []];
    for (const side of [0, 1]) {
      if (!players[side]) continue;
      const obs = observe(state, side);
      const t0 = performance.now();
      let cmds;
      try {
        cmds = await players[side].act(obs);
        if (!Array.isArray(cmds)) throw new Error('act returned a non-array');
        cmds = structuredClone(cmds);
      } catch (err) {
        cmds = [];
        errTicks[side]++;
        m.errors[side]++;
        if (errTicks[side] >= throwLimit) forfeit[side] = 'errors: ' + (err && err.message);
      }
      const ms = performance.now() - t0;
      m.acts[side]++;
      m.actMs[side] += ms;
      if (ms > m.actMax[side]) m.actMax[side] = ms;
      if (ms > thinkMs) {
        m.late[side]++;
        if (task.enforceThink) cmds = [];
      }
      lists[side] = cmds;
    }
    if (forfeit[0] || forfeit[1]) break;

    const events = step(state, lists);
    for (const e of events) {
      switch (e.e) {
        case 'spawn': {
          const ent = e.unit ?? e.structure;
          if (ent) {
            track(ent);
            if (e.unit && state.tick > 1) bump(m.trained[ent.owner], ent.kind);
          }
          break;
        }
        case 'done': {
          const o = owners.get(e.id);
          if (o) bump(m.built[o.owner], o.kind);
          break;
        }
        case 'deliver': {
          const o = owners.get(e.id);
          if (o) m.delivered[o.owner] += e.amount;
          break;
        }
        case 'hit':
          if (m.firstHit === null) m.firstHit = state.tick;
          break;
        case 'die': {
          const o = owners.get(e.id);
          if (o) {
            m.losses[o.owner]++;
            m.kills[1 - o.owner]++;
            bump(m.lostKinds[o.owner], o.kind);
          }
          break;
        }
        case 'reject':
          m.rejects[e.player]++;
          bump(m.rejectReasons[e.player], e.reason);
          break;
        case 'blocked': {
          const o = owners.get(e.id);
          if (o) m.blocked[o.owner]++;
          break;
        }
      }
    }
    for (const side of [0, 1]) {
      const army = state.units.filter((u) => u.owner === side && u.kind !== 'worker').length;
      if (army > m.peakArmy[side]) m.peakArmy[side] = army;
    }
    if (log) log.ticks.push({ tick: state.tick, commands: lists, events });
  }

  let result = state.result;
  if (!result) {
    const winner = forfeit[0] && forfeit[1] ? null : forfeit[0] ? 1 : 0;
    result = { winner, reason: 'forfeit', tick: state.tick, value: [sideValue(state, 0), sideValue(state, 1)] };
  }
  m.forfeit = forfeit;
  m.finalUnits = [0, 1].map((s) => state.units.filter((u) => u.owner === s).length);
  const out = { result, stats: m };
  if (log) out.log = { format: 'driftfall-log', version: 1, seed: task.seed, initial, ticks: log.ticks, result };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Worker pool

if (!isMainThread && workerData && workerData.simWorker) {
  parentPort.on('message', async (task) => {
    try {
      parentPort.postMessage({ id: task.id, ...(await playMatch(task)) });
    } catch (err) {
      parentPort.postMessage({ id: task.id, error: String((err && err.stack) || err) });
    }
  });
}

async function runTasks(tasks, jobs) {
  const results = new Array(tasks.length);
  if (jobs <= 1) {
    for (let i = 0; i < tasks.length; i++) results[i] = await playMatch(tasks[i]);
    return results;
  }
  let next = 0;
  let done = 0;
  const workers = [];
  await new Promise((resolve, reject) => {
    const feed = (w) => {
      if (next >= tasks.length) return;
      const id = next++;
      w.postMessage({ ...tasks[id], id });
    };
    for (let i = 0; i < Math.min(jobs, tasks.length); i++) {
      const w = new Worker(SELF, { workerData: { simWorker: true } });
      workers.push(w);
      w.on('message', (msg) => {
        if (msg.error) return reject(new Error(msg.error));
        results[msg.id] = msg;
        if (++done === tasks.length) resolve();
        else feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
  await Promise.all(workers.map((w) => w.terminate()));
  return results;
}

// ---------------------------------------------------------------------------------------------------------------
// Statistics

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Wilson 95% interval for a proportion k/n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const sumKinds = (list) => {
  const out = {};
  for (const k of list) for (const [kind, n] of Object.entries(k)) out[kind] = (out[kind] ?? 0) + n;
  return out;
};
const perMatch = (obj, n) => Object.fromEntries(Object.entries(obj).sort().map(([k, v]) => [k, round(v / n)]));

/** rows: [{ seed, seat, result, stats }] where seat = the side A played. Everything is reported from A's view. */
export function summarize(rows) {
  const n = rows.length;
  let w = 0, d = 0, l = 0;
  const seat = [{ n: 0, w: 0, d: 0 }, { n: 0, w: 0, d: 0 }];
  const reasons = {};
  const mine = (r, pair) => pair[r.seat];
  const theirs = (r, pair) => pair[1 - r.seat];
  for (const r of rows) {
    const win = r.result.winner === r.seat;
    const draw = r.result.winner === null;
    if (win) w++;
    else if (draw) d++;
    else l++;
    seat[r.seat].n++;
    if (win) seat[r.seat].w++;
    if (draw) seat[r.seat].d++;
    bump(reasons, (win ? 'W:' : draw ? 'D:' : 'L:') + r.result.reason);
  }
  const [lo, hi] = wilson(w + d / 2, n);
  const coreWins = rows.filter((r) => r.result.winner === r.seat && r.result.reason === 'core');
  return {
    n, wins: w, draws: d, losses: l,
    score: round((w + d / 2) / Math.max(1, n), 3),
    winRate: round(w / Math.max(1, n), 3),
    ci95: [round(lo, 3), round(hi, 3)],
    bySeat: seat.map((s) => ({ n: s.n, wins: s.w, draws: s.d })),
    reasons,
    meanEndTick: round(mean(rows.map((r) => r.result.tick)), 0),
    meanCoreWinTick: coreWins.length ? round(mean(coreWins.map((r) => r.result.tick)), 0) : null,
    meanValueMargin: round(mean(rows.map((r) => mine(r, r.result.value) - theirs(r, r.result.value))), 0),
    meanValue: [round(mean(rows.map((r) => mine(r, r.result.value))), 0), round(mean(rows.map((r) => theirs(r, r.result.value))), 0)],
    econ: {
      deliveredA: round(mean(rows.map((r) => mine(r, r.stats.delivered))), 0),
      deliveredB: round(mean(rows.map((r) => theirs(r, r.stats.delivered))), 0),
    },
    trainedA: perMatch(sumKinds(rows.map((r) => mine(r, r.stats.trained))), n),
    trainedB: perMatch(sumKinds(rows.map((r) => theirs(r, r.stats.trained))), n),
    builtA: perMatch(sumKinds(rows.map((r) => mine(r, r.stats.built))), n),
    builtB: perMatch(sumKinds(rows.map((r) => theirs(r, r.stats.built))), n),
    killsA: round(mean(rows.map((r) => mine(r, r.stats.kills))), 1),
    killsB: round(mean(rows.map((r) => theirs(r, r.stats.kills))), 1),
    peakArmyA: round(mean(rows.map((r) => mine(r, r.stats.peakArmy))), 1),
    peakArmyB: round(mean(rows.map((r) => theirs(r, r.stats.peakArmy))), 1),
    firstFightTick: rows.some((r) => r.stats.firstHit !== null) ? round(mean(rows.filter((r) => r.stats.firstHit !== null).map((r) => r.stats.firstHit)), 0) : null,
    rejectsA: rows.reduce((a, r) => a + mine(r, r.stats.rejects), 0),
    rejectReasonsA: sumKinds(rows.map((r) => mine(r, r.stats.rejectReasons))),
    think: {
      meanMsA: round(mean(rows.map((r) => mine(r, r.stats.actMs) / Math.max(1, mine(r, r.stats.acts)))), 3),
      maxMsA: round(Math.max(0, ...rows.map((r) => mine(r, r.stats.actMax))), 2),
      lateA: rows.reduce((a, r) => a + mine(r, r.stats.late), 0),
      errorsA: rows.reduce((a, r) => a + mine(r, r.stats.errors), 0),
      errorsB: rows.reduce((a, r) => a + theirs(r, r.stats.errors), 0),
    },
    forfeits: rows.filter((r) => r.stats.forfeit.some(Boolean)).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Experiments

/**
 * Play A against B over seeds and seats. a, b = { label, file, params }. Returns { summary, rows }.
 * `seats`: 'both' plays each seed twice (A on side 0, then A on side 1), which cancels map and side bias.
 */
export async function runMatchup({ a, b, seeds, seats = 'both', jobs = 1, maxTicks, thinkMs, enforceThink, wantLog = false }) {
  const plan = [];
  for (const seed of seeds) {
    for (const seat of seats === 'both' ? [0, 1] : [Number(seats)]) plan.push({ seed, seat });
  }
  const tasks = plan.map(({ seed, seat }) => ({
    seed, maxTicks, thinkMs, enforceThink,
    wantLog: wantLog && plan[0].seed === seed && plan[0].seat === seat,
    files: seat === 0 ? [a.file, b.file] : [b.file, a.file],
    params: seat === 0 ? [a.params, b.params] : [b.params, a.params],
  }));
  const out = await runTasks(tasks, jobs);
  const rows = out.map((o, i) => ({ seed: plan[i].seed, seat: plan[i].seat, result: o.result, stats: o.stats, log: o.log }));
  return { summary: summarize(rows), rows };
}

const parseValue = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

function parseSeeds(text) {
  const seeds = [];
  for (const part of text.split(',')) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m) for (let s = Number(m[1]); s <= Number(m[2]); s++) seeds.push(s);
    else if (part !== '') seeds.push(Number(part));
  }
  if (!seeds.length || seeds.some((s) => !Number.isFinite(s))) throw new Error('bad --seeds ' + text);
  return seeds;
}

function parseArgs(argv) {
  const o = { a: 'bot', b: 'sample', seeds: '1-20', seats: 'both', jobs: Math.max(1, os.cpus().length - 1), sweeps: [], aParams: {}, bParams: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw new Error('missing value after ' + arg);
      return argv[++i];
    };
    switch (arg) {
      case '--a': o.a = val(); break;
      case '--b': o.b = val(); break;
      case '--seeds': o.seeds = val(); break;
      case '--seats': o.seats = val(); break;
      case '--jobs': o.jobs = Number(val()); break;
      case '--max-ticks': o.maxTicks = Number(val()); break;
      case '--think': o.thinkMs = Number(val()); break;
      case '--enforce-think': o.enforceThink = true; break;
      case '--a-params': o.aParams = JSON.parse(val()); break;
      case '--b-params': o.bParams = JSON.parse(val()); break;
      case '--sweep': {
        const [key, list] = val().split('=');
        if (!key || !list) throw new Error('--sweep wants key=v1,v2,...');
        o.sweeps.push({ key, values: list.split(',').map(parseValue) });
        break;
      }
      case '--label': o.label = val(); break;
      case '--save': o.save = true; break;
      case '--out': o.out = val(); break;
      case '--snapshot': o.snapshot = val(); break;
      case '--check-referee': o.checkReferee = true; break;
      case '--verbose': o.verbose = true; break;
      case '--json': o.json = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error('unknown argument ' + arg);
    }
  }
  return o;
}

const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';

function formatSummary(title, s) {
  const lines = [];
  lines.push(`${title}`);
  lines.push(
    `  ${s.wins}W ${s.draws}D ${s.losses}L of ${s.n}   win ${pct(s.winRate)}   score ${pct(s.score)}  95% CI [${pct(s.ci95[0]).trim()}, ${pct(s.ci95[1]).trim()}]` +
      `   as side0 ${s.bySeat[0].wins}/${s.bySeat[0].n}, side1 ${s.bySeat[1].wins}/${s.bySeat[1].n}`,
  );
  lines.push(`  ends: ${Object.entries(s.reasons).sort().map(([k, v]) => `${k}=${v}`).join(' ')}   mean end tick ${s.meanEndTick}` + (s.meanCoreWinTick ? `, mean core-win tick ${s.meanCoreWinTick}` : ''));
  lines.push(`  value A vs B ${s.meanValue[0]} vs ${s.meanValue[1]} (margin ${s.meanValueMargin >= 0 ? '+' : ''}${s.meanValueMargin})   delivered ${s.econ.deliveredA} vs ${s.econ.deliveredB}   kills ${s.killsA} vs ${s.killsB}   peak army ${s.peakArmyA} vs ${s.peakArmyB}   first hit ~tick ${s.firstFightTick}`);
  lines.push(`  trained A ${JSON.stringify(s.trainedA)}  B ${JSON.stringify(s.trainedB)}   built A ${JSON.stringify(s.builtA)}  B ${JSON.stringify(s.builtB)}`);
  lines.push(`  A think ${s.think.meanMsA} ms mean / ${s.think.maxMsA} ms max, late ${s.think.lateA}, errors ${s.think.errorsA}; B errors ${s.think.errorsB}; rejects(A) ${s.rejectsA} ${JSON.stringify(s.rejectReasonsA)}; forfeits ${s.forfeits}`);
  return lines.join('\n');
}

function gitRev() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function saveResult(entry) {
  let data = { format: 'driftfall-sonnet-results', version: 1, experiments: [] };
  try {
    data = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  } catch {
    /* first save */
  }
  data.experiments.push(entry);
  fs.writeFileSync(RESULTS, JSON.stringify(data, null, 2) + '\n');
}

// Re-run seeds through the real referee (worker threads) and make sure the in-process harness agrees.
async function checkReferee(o, aSpec, bSpec) {
  const { runMatch } = await load('env/referee.mjs');
  let bad = 0;
  for (const seed of parseSeeds(o.seeds)) {
    const fast = await playMatch({ seed, files: [aSpec.file, bSpec.file], params: [o.aParams, o.bParams], maxTicks: o.maxTicks });
    const slow = await runMatch({ seed, players: [aSpec.file, bSpec.file], maxTicks: o.maxTicks });
    const same = JSON.stringify(fast.result) === JSON.stringify(slow.result);
    if (!same) bad++;
    console.log(`seed ${seed}: harness ${JSON.stringify(fast.result)}\n         referee ${JSON.stringify(slow.result)}  ${same ? 'SAME' : 'DIFFERENT'}`);
  }
  console.log(bad ? `${bad} seed(s) differ (a bot that is slow under the referee's 50 ms limit can legitimately differ)` : 'harness and referee agree on every seed');
  return bad ? 1 : 0;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(fs.readFileSync(SELF, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    return 0;
  }
  if (o.snapshot) {
    console.log('snapshot written to ' + snapshot(o.snapshot) + ` (use as snap:${o.snapshot})`);
    return 0;
  }
  const aBase = resolveSpec(o.a);
  const bSpecs = o.b.split(',').map(resolveSpec);
  if (o.checkReferee) return checkReferee(o, aBase, bSpecs[0]);

  const seeds = parseSeeds(o.seeds);
  // cartesian product over the sweeps (one empty combination when there are none)
  let combos = [{}];
  for (const sw of o.sweeps) combos = combos.flatMap((c) => sw.values.map((v) => ({ ...c, [sw.key]: v })));

  const report = [];
  const common = { seeds, seats: o.seats, jobs: o.jobs, maxTicks: o.maxTicks, thinkMs: o.thinkMs, enforceThink: o.enforceThink };
  for (const combo of combos) {
    for (const bSpec of bSpecs) {
      const a = { ...aBase, params: { ...o.aParams, ...combo } };
      const b = { ...bSpec, params: o.bParams };
      const t0 = performance.now();
      const { summary, rows } = await runMatchup({ a, b, ...common, wantLog: Boolean(o.out) && report.length === 0 });
      const secs = round((performance.now() - t0) / 1000, 1);
      const paramText = Object.keys(a.params).length ? ' ' + JSON.stringify(a.params) : '';
      const title = `${a.label}${paramText}  vs  ${b.label}   (${seeds.length} seeds, seats ${o.seats}, ${secs}s)`;
      if (!o.json) console.log(formatSummary(title, summary) + '\n');
      if (o.verbose) {
        for (const r of rows) {
          const win = r.result.winner === r.seat ? 'WIN ' : r.result.winner === null ? 'DRAW' : 'LOSS';
          console.log(`  seed ${r.seed} A=side${r.seat} ${win} ${r.result.reason} t${r.result.tick} value ${r.result.value}`);
        }
      }
      if (o.out && report.length === 0 && rows[0].log) {
        rows[0].log.players = rows[0].seat === 0 ? [a.label, b.label] : [b.label, a.label];
        fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
        fs.writeFileSync(o.out, JSON.stringify(rows[0].log) + '\n');
        console.log('log of seed ' + rows[0].seed + ' written to ' + o.out + ' (stats table omitted; add via referee if the viewer needs it)');
      }
      report.push({
        a: a.label, aParams: a.params, b: b.label, bParams: b.params, summary,
        perSeed: rows.map((r) => [r.seed, r.seat, r.result.winner === r.seat ? 'W' : r.result.winner === null ? 'D' : 'L', r.result.reason, r.result.tick, r.result.value[r.seat] - r.result.value[1 - r.seat]]),
      });
    }
  }
  if (combos.length > 1 && !o.json) {
    console.log('sweep summary (win rate / score vs ' + o.b + '):');
    for (const r of report) {
      console.log(`  ${JSON.stringify(r.aParams).padEnd(40)} vs ${r.b.padEnd(10)} win ${pct(r.summary.winRate)} score ${pct(r.summary.score)} [${pct(r.summary.ci95[0]).trim()}, ${pct(r.summary.ci95[1]).trim()}] margin ${r.summary.meanValueMargin}`);
    }
  }
  if (o.json) console.log(JSON.stringify(report, null, 2));
  if (o.save) {
    saveResult({
      label: o.label ?? 'unlabelled', date: new Date().toISOString(), gitHead: gitRev(), seeds: o.seeds, seats: o.seats,
      maxTicks: o.maxTicks ?? null, matchups: report,
    });
    console.log('saved to ' + path.relative(ROOT, RESULTS));
  }
  return 0;
}

if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error('sim failed:', err && err.message ? err.message : err);
      process.exitCode = 2;
    },
  );
}
