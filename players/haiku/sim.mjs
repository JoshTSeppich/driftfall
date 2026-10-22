#!/usr/bin/env node
// Haiku's match simulator and tuning harness.
//
// Plays real matches through env/referee.mjs (same rules, same worker threads, same 50 ms think limit) between our
// bot and one or more opponents over many seeds. Each seed is played twice, bot on side 0 and then on side 1, because
// odd and even ticks give the sides different priority (spec section 8).
//
//   node players/haiku/sim.mjs --bot players/haiku/bot.mjs --seeds 1-100
//   node players/haiku/sim.mjs --bot old.mjs --bot new.mjs --opp players/sample-player.mjs --seeds 1-50
//   node players/haiku/sim.mjs --bot players/haiku/bot.mjs --seeds 1-20 --determinism 3 --out /tmp/test.json
//
// Options: --bot FILE (repeatable), --opp FILE (repeatable, default the sample player), --seeds SPEC (e.g. 1-100 or
// 1,5,9 or 1-20,40), --concurrency N (default 1), --max-ticks N, --determinism N (replays the first N seeds twice and
// compares the logs), --out FILE (default players/haiku/results.json), --quiet.
//
// Numbers you will quote should come from --concurrency 1. The referee measures think time on the wall clock, so a
// busy machine can make a reply late and drop it. Every run counts late, error and forfeit events, and a run with any
// of them is marked unreliable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMatch } from '../../env/referee.mjs';
import { comparable } from '../../env/log.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RESULTS_FILE = path.join(HERE, 'results.json');
const SAMPLE_PLAYER = path.join(ROOT, 'players', 'sample-player.mjs');
const FORMAT = 'haiku-tuning-results';

const USAGE = 'usage: node players/haiku/sim.mjs --bot FILE [--bot FILE ...] [--opp FILE ...] [--seeds 1-100] ' +
  '[--concurrency N] [--max-ticks N] [--determinism N] [--out FILE] [--quiet]';

// ---------- seeds and arguments ----------

// "1-100", "7", "1,5,9" or any mix of those. Returns a sorted-as-written list of integers.
export function parseSeeds(spec) {
  const seeds = [];
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d+)(?:-(\d+))?\s*$/.exec(part);
    if (!m) throw new Error('bad seed spec: ' + part);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (to < from) throw new Error('seed range runs backwards: ' + part);
    for (let s = from; s <= to; s++) seeds.push(s);
  }
  if (!seeds.length) throw new Error('no seeds given');
  return seeds;
}

export function parseArgs(argv) {
  const opts = {
    bots: [], opps: [], seeds: '1-20', concurrency: 1, maxTicks: undefined,
    determinism: 0, out: RESULTS_FILE, quiet: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error('missing value after ' + arg);
      return argv[++i];
    };
    const num = () => {
      const n = Number(next());
      if (!Number.isFinite(n)) throw new Error(arg + ' must be a number');
      return n;
    };
    switch (arg) {
      case '--bot': opts.bots.push(next()); break;
      case '--opp': opts.opps.push(next()); break;
      case '--seeds': opts.seeds = next(); break;
      case '--concurrency': opts.concurrency = num(); break;
      case '--max-ticks': opts.maxTicks = num(); break;
      case '--determinism': opts.determinism = num(); break;
      case '--out': opts.out = path.resolve(next()); break;
      case '--quiet': opts.quiet = true; break;
      case '--help':
      case '-h': opts.help = true; break;
      default: throw new Error('unknown argument ' + arg);
    }
  }
  return opts;
}

// ---------- one game and its tallies ----------

const bump = (obj, key, by = 1) => {
  obj[key] = (obj[key] || 0) + by;
};

const addInto = (dst, src) => {
  for (const key of Object.keys(src)) bump(dst, key, src[key]);
};

// Counts what the match log says about each side. "bot" is the side our bot plays; "opp" is the other side.
// Units and structures are keyed by kind, so new roster entries show up here with no code change.
export function tallyLog(log, botSide) {
  const role = (side) => (side === botSide ? 'bot' : 'opp');
  const owners = new Map(); // entity id -> { owner, kind }
  const lastHitter = new Map(); // entity id -> id of the entity that last hit it
  const t = {
    late: { bot: 0, opp: 0 },
    errors: { bot: 0, opp: 0 },
    forfeits: { bot: null, opp: null },
    built: { bot: {}, opp: {} }, // spawned during the match (units trained, sites placed)
    lost: { bot: {}, opp: {} }, // units and structures that died
    kills: { bot: {}, opp: {} }, // "attacker>victim" kinds, credited to the last hitter
    maxMs: { bot: 0, opp: 0 },
    sumMs: { bot: 0, opp: 0 },
  };

  for (const entity of [...(log.initial.units || []), ...(log.initial.structures || [])]) {
    owners.set(entity.id, { owner: entity.owner, kind: entity.kind });
  }

  for (const entry of log.ticks) {
    for (const ev of entry.events) {
      switch (ev.e) {
        case 'late': bump(t.late, role(ev.player)); break;
        case 'error': bump(t.errors, role(ev.player)); break;
        case 'forfeit': t.forfeits[role(ev.player)] = ev.reason; break;
        case 'spawn': {
          const rec = ev.unit || ev.structure;
          if (!rec) break;
          owners.set(rec.id, { owner: rec.owner, kind: rec.kind });
          bump(t.built[role(rec.owner)], rec.kind);
          break;
        }
        case 'hit':
          lastHitter.set(ev.id, ev.by);
          break;
        case 'die': {
          const victim = owners.get(ev.id);
          if (!victim) break;
          bump(t.lost[role(victim.owner)], victim.kind);
          const by = lastHitter.get(ev.id);
          const attacker = by === undefined ? undefined : owners.get(by);
          if (attacker) bump(t.kills[role(attacker.owner)], attacker.kind + '>' + victim.kind);
          break;
        }
        default:
          break;
      }
    }
  }

  for (const entry of log.timing || []) {
    for (const side of [0, 1]) {
      const r = role(side);
      const ms = entry[side] || 0;
      t.maxMs[r] = Math.max(t.maxMs[r], ms);
      t.sumMs[r] += ms;
    }
  }
  const ticks = Math.max(1, (log.timing || []).length);
  t.meanMs = { bot: round(t.sumMs.bot / ticks, 3), opp: round(t.sumMs.opp / ticks, 3) };
  delete t.sumMs;
  return t;
}

// Plays one game. botSide says which side the bot takes; the opponent takes the other.
export async function playGame({ seed, bot, opponent, botSide, maxTicks }) {
  const players = botSide === 0 ? [bot, opponent] : [opponent, bot];
  const { log, result } = await runMatch({ seed, players, maxTicks });
  const oppSide = 1 - botSide;
  const outcome = result.winner === null ? 'draw' : result.winner === botSide ? 'win' : 'loss';
  return {
    seed,
    botSide,
    outcome,
    reason: result.reason,
    tick: result.tick,
    value: { bot: result.value[botSide], opp: result.value[oppSide] },
    tally: tallyLog(log, botSide),
  };
}

// Plays every seed on both sides. Results come back in job order: seed 1 side 0, seed 1 side 1, seed 2 side 0, ...
export async function runSeries({ bot, opponent, seeds, concurrency = 1, maxTicks, onGame }) {
  const jobs = [];
  for (const seed of seeds) for (const botSide of [0, 1]) jobs.push({ seed, botSide });
  const out = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      out[index] = await playGame({ ...jobs[index], bot, opponent, maxTicks });
      if (onGame) onGame(out[index], index, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out;
}

// Replays the first `count` seeds twice each with the same players and compares the logs (timing is left out).
export async function checkDeterminism({ bot, opponent, seeds, maxTicks }) {
  const mismatches = [];
  const checked = seeds.slice(0, Math.max(0, count(seeds)));
  for (const seed of checked) {
    const players = [bot, opponent];
    const a = await runMatch({ seed, players, maxTicks });
    const b = await runMatch({ seed, players, maxTicks });
    if (JSON.stringify(comparable(a.log)) !== JSON.stringify(comparable(b.log))) mismatches.push(seed);
  }
  return { checked: checked.length, identical: checked.length - mismatches.length, mismatches };
  function count(list) {
    return list.length;
  }
}

// ---------- summaries ----------

const round = (x, places = 3) => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};

// Wilson score interval for a proportion p over n trials at ~95% confidence. Draws count as half a win, so this is
// approximate for the score; good enough to tell a real gap from noise at these sample sizes.
export function wilson(score, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = score / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function summarize(games) {
  const n = games.length;
  const s = {
    games: n, wins: 0, losses: 0, draws: 0, winRate: 0, ci95: [0, 1], meanValueDiff: 0,
    reasons: {}, forfeitGames: 0, late: { bot: 0, opp: 0 }, errors: { bot: 0, opp: 0 },
    built: { bot: {}, opp: {} }, lost: { bot: {}, opp: {} }, kills: { bot: {}, opp: {} },
    maxMs: { bot: 0, opp: 0 }, meanMs: { bot: 0, opp: 0 }, unreliable: false,
  };
  let valueSum = 0;
  let msSum = { bot: 0, opp: 0 };
  for (const g of games) {
    if (g.outcome === 'win') s.wins++;
    else if (g.outcome === 'loss') s.losses++;
    else s.draws++;
    valueSum += g.value.bot - g.value.opp;
    bump(s.reasons, g.reason);
    if (g.tally.forfeits.bot || g.tally.forfeits.opp) s.forfeitGames++;
    for (const side of ['bot', 'opp']) {
      s.late[side] += g.tally.late[side];
      s.errors[side] += g.tally.errors[side];
      for (const key of ['built', 'lost', 'kills']) addInto(s[key][side], g.tally[key][side]);
      s.maxMs[side] = Math.max(s.maxMs[side], g.tally.maxMs[side]);
      msSum[side] += g.tally.meanMs[side];
    }
  }
  const score = s.wins + s.draws / 2;
  s.winRate = n ? round(score / n) : 0;
  s.ci95 = wilson(score, n).map((x) => round(x));
  s.meanValueDiff = n ? round(valueSum / n, 1) : 0;
  s.meanMs = { bot: n ? round(msSum.bot / n, 3) : 0, opp: n ? round(msSum.opp / n, 3) : 0 };
  s.unreliable = s.late.bot + s.late.opp + s.errors.bot + s.errors.opp + s.forfeitGames > 0;
  return s;
}

// ---------- saving ----------

function loadResults(file) {
  if (!fs.existsSync(file)) return { format: FORMAT, version: 1, runs: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// One entry per (bot, opponent, seed spec, max ticks). Rerunning the same setup replaces the old entry.
export function saveRun(file, run) {
  const doc = loadResults(file);
  doc.runs = doc.runs.filter((r) => r.key !== run.key);
  doc.runs.push(run);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

const rel = (p) => path.relative(ROOT, p);
const pct = (x) => (100 * x).toFixed(1) + '%';

function printRow(label, oppLabel, s) {
  const flag = s.unreliable ? '  UNRELIABLE (late/error/forfeit seen)' : '';
  console.log(
    `${label} vs ${oppLabel}: ${s.wins}W ${s.losses}L ${s.draws}D over ${s.games} games | ` +
    `win rate ${pct(s.winRate)} (95% CI ${pct(s.ci95[0])} to ${pct(s.ci95[1])}) | ` +
    `mean value diff ${s.meanValueDiff} | late ${s.late.bot}/${s.late.opp} errors ${s.errors.bot}/${s.errors.opp}` +
    ` forfeit games ${s.forfeitGames}${flag}`,
  );
}

// ---------- command line ----------

export async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    return 1;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (!opts.bots.length) {
    console.error('at least one --bot FILE is required');
    console.error(USAGE);
    return 1;
  }

  let seeds;
  try {
    seeds = parseSeeds(opts.seeds);
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  const opps = opts.opps.length ? opts.opps : [SAMPLE_PLAYER];
  const bots = opts.bots.map((p) => path.resolve(p));
  const oppPaths = opps.map((p) => path.resolve(p));
  for (const file of [...bots, ...oppPaths]) {
    if (!fs.existsSync(file)) {
      console.error('no such player file: ' + file);
      return 1;
    }
  }

  for (const bot of bots) {
    for (const opp of oppPaths) {
      if (opts.determinism > 0) {
        const det = await checkDeterminism({
          bot, opponent: opp, seeds: seeds.slice(0, opts.determinism), maxTicks: opts.maxTicks,
        });
        console.log(`determinism ${rel(bot)} vs ${rel(opp)}: ${det.identical}/${det.checked} seeds replay identically` +
          (det.mismatches.length ? ' (mismatched seeds: ' + det.mismatches.join(', ') + ')' : ''));
      }

      const games = await runSeries({
        bot,
        opponent: opp,
        seeds,
        concurrency: opts.concurrency,
        maxTicks: opts.maxTicks,
        onGame: opts.quiet ? undefined : (g, i, total) => {
          if ((i + 1) % 10 === 0 || i + 1 === total) process.stderr.write(`  ${i + 1}/${total} games\n`);
        },
      });

      const summary = summarize(games);
      const botLabel = rel(bot);
      const oppLabel = rel(opp);
      const seedSpec = opts.seeds;
      const run = {
        key: `${botLabel} vs ${oppLabel} seeds ${seedSpec} ticks ${opts.maxTicks ?? 'default'}`,
        bot: botLabel,
        opponent: oppLabel,
        seeds: seedSpec,
        maxTicks: opts.maxTicks ?? null,
        concurrency: opts.concurrency,
        runAt: new Date().toISOString(),
        summary,
        perGame: games.map((g) => [g.seed, g.botSide, g.outcome, g.reason, g.tick, g.value.bot, g.value.opp]),
      };
      saveRun(opts.out, run);
      printRow(botLabel, oppLabel, summary);
    }
  }
  if (!opts.quiet) console.log(`saved to ${rel(opts.out)}`);
  return 0;
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error('sim failed:', err && err.stack ? err.stack : err);
      process.exitCode = 2;
    },
  );
}
