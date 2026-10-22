// Balance harness (team haiku, Balance / Multiplayer Tester).
// Runs many seeded matches through env/referee.mjs, reads every match log, and writes analytics/balance-report.md.
// It only runs player modules it is given by path. It never opens players/ source.
//
// Usage:
//   node analytics/balance.mjs                          sample vs sample, 200 matches
//   node analytics/balance.mjs --matches 400 --jobs 3
//   node analytics/balance.mjs --pair players/a.mjs+players/b.mjs --matches 100
//       --pair can repeat; each pairing gets --matches matches; the two modules swap sides on alternate seeds
//   --seed0 <n>     first seed (default 1)
//   --out <file>    report path (default analytics/balance-report.md)
//   --keep-late     keep matches where a player ran late (default: drop them and say how many)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from '../env/referee.mjs';
import { STATS, UNIT_KINDS, STRUCTURE_KINDS } from '../env/stats.mjs';
import { initialState, applyTick, valueOf as replayValue } from '../viewer/replay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = 'players/sample-player.mjs';
const SAMPLE_TICKS = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000];

function parseArgs(argv) {
  const opts = { matches: 200, seed0: 1, jobs: 2, pairs: [], out: 'analytics/balance-report.md', keepLate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--matches') opts.matches = Number(next());
    else if (a === '--seed0') opts.seed0 = Number(next());
    else if (a === '--jobs') opts.jobs = Number(next());
    else if (a === '--pair') opts.pairs.push(next().split('+'));
    else if (a === '--out') opts.out = next();
    else if (a === '--keep-late') opts.keepLate = true;
    else throw new Error('unknown option ' + a);
  }
  if (!Number.isInteger(opts.matches) || opts.matches < 1) throw new Error('--matches needs a whole number of at least 1');
  if (!Number.isInteger(opts.jobs) || opts.jobs < 1) throw new Error('--jobs needs a whole number of at least 1');
  if (!opts.pairs.length) opts.pairs.push([SAMPLE, SAMPLE]);
  for (const pair of opts.pairs) if (pair.length !== 2) throw new Error('--pair needs two modules joined by +');
  return opts;
}

const bump = (obj, key, n = 1) => {
  obj[key] = (obj[key] ?? 0) + n;
};

// Reduce one match log to the numbers the report needs. Keeps no events, so memory stays flat across hundreds of runs.
function summarise(log, result) {
  const kindOf = new Map();
  const ownerOf = new Map();
  const remember = (rec) => {
    kindOf.set(rec.id, rec.kind);
    ownerOf.set(rec.id, rec.owner);
  };
  for (const u of log.initial.units) remember(u);
  for (const s of log.initial.structures) remember(s);

  const start = [{}, {}]; // units present at tick 0, by kind
  for (const u of log.initial.units) bump(start[u.owner], u.kind);

  const s = {
    trained: [{}, {}], // units spawned after tick 0, by kind
    built: [{}, {}], // structures completed, by kind
    lost: [{}, {}], // units destroyed, by kind
    kills: {}, // attacker kind -> victim kind -> kill credit (split evenly when several attackers hit the same tick)
    dealt: {}, // attacker kind -> victim kind -> damage
    mined: [0, 0],
    delivered: [0, 0],
    spent: [0, 0],
    rejects: [{}, {}],
    late: [0, 0],
    errors: [0, 0],
    forfeits: [],
    firstFight: null,
  };

  for (const entry of log.ticks) {
    const hitters = new Map(); // target id -> [attacker ids] this tick
    for (const ev of entry.events) {
      switch (ev.e) {
        case 'spawn': {
          const rec = ev.unit ?? ev.structure;
          if (!rec) break;
          remember(rec);
          if (ev.unit) bump(s.trained[rec.owner], rec.kind);
          break;
        }
        case 'done':
          bump(s.built[ownerOf.get(ev.id)], kindOf.get(ev.id));
          break;
        case 'hit': {
          const att = kindOf.get(ev.by);
          const vic = kindOf.get(ev.id);
          if (!hitters.has(ev.id)) hitters.set(ev.id, []);
          hitters.get(ev.id).push(ev.by);
          if (att && vic) {
            bump(s.dealt, att) ;
            s.dealt[att] = s.dealt[att] ?? {};
            bump(s.dealt[att], vic, ev.dmg);
          }
          if (s.firstFight === null) s.firstFight = entry.tick;
          break;
        }
        case 'mine':
          s.mined[ownerOf.get(ev.id)] += ev.amount;
          break;
        case 'deliver':
          s.delivered[ownerOf.get(ev.id)] += ev.amount;
          break;
        case 'spend':
          s.spent[ev.player] += ev.amount;
          break;
        case 'reject':
          bump(s.rejects[ev.player], ev.reason);
          break;
        case 'late':
          s.late[ev.player] += 1;
          break;
        case 'error':
          s.errors[ev.player] += 1;
          break;
        case 'forfeit':
          s.forfeits.push({ player: ev.player, reason: ev.reason });
          break;
        default:
          break;
      }
    }
    // Deaths come after the hits of the same tick, so the attackers are known by now.
    for (const ev of entry.events) {
      if (ev.e !== 'die') continue;
      const vic = kindOf.get(ev.id);
      const owner = ownerOf.get(ev.id);
      const attackers = [...new Set(hitters.get(ev.id) ?? [])].map((id) => kindOf.get(id)).filter(Boolean);
      if (vic && UNIT_KINDS.includes(vic)) bump(s.lost[owner], vic);
      for (const att of attackers) {
        s.kills[att] = s.kills[att] ?? {};
        bump(s.kills[att], vic, 1 / attackers.length);
      }
    }
  }

  // Value curve: replay the log and sample every 250 ticks. Uses the same rule as the referee's value.
  const curve = [];
  const state = initialState(log);
  const sampleAt = new Map();
  const sample = () => ({
    shards: [state.shards[0], state.shards[1]],
    value: [replayValue(state, 0, log.stats), replayValue(state, 1, log.stats)],
  });
  sampleAt.set(0, sample());
  log.ticks.forEach((entry, i) => {
    applyTick(state, entry, log.stats);
    state.tick = i + 1;
    if (SAMPLE_TICKS.includes(state.tick) && state.tick > 0) sampleAt.set(state.tick, sample());
  });
  for (const t of SAMPLE_TICKS) if (sampleAt.has(t)) curve.push({ tick: t, ...sampleAt.get(t) });

  return {
    seed: log.seed,
    players: log.players,
    winner: result.winner,
    reason: result.reason,
    length: result.tick,
    value: result.value,
    start,
    curve,
    ...s,
    lateMatch: s.late[0] + s.late[1] + s.errors[0] + s.errors[1] > 0 || s.forfeits.length > 0,
  };
}

// Run one match and summarise it. Side 0 is the first module unless `swap` is true.
async function playOne(seed, moduleA, moduleB, swap) {
  const players = swap ? [moduleB, moduleA] : [moduleA, moduleB];
  const { log, result } = await runMatch({ seed, players: players.map((p) => path.resolve(ROOT, p)) });
  const summary = summarise(log, result);
  return { ...summary, modules: players, swap };
}

// Pool of workers over the job list; keeps results in job order.
async function runAll(jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
      if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${jobs.length} matches done`);
    }
  });
  await Promise.all(lanes);
  return results;
}

// Wilson 95% interval for a proportion.
function wilson(k, n) {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const pct = (x) => (100 * x).toFixed(1) + '%';
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const sumOver = (matches, get) => matches.reduce((acc, m) => acc + (get(m) ?? 0), 0);

// Per-kind summary across matches of one pairing (both sides together; per side = total / (2 * matches)).
function unitRows(matches, kinds) {
  const n = matches.length;
  const rows = [];
  for (const kind of kinds) {
    const cost = STATS.units[kind]?.cost ?? STATS.structures[kind]?.cost ?? 0;
    const trained = sumOver(matches, (m) => (m.trained[0][kind] ?? 0) + (m.trained[1][kind] ?? 0));
    const startCount = sumOver(matches, (m) => (m.start[0][kind] ?? 0) + (m.start[1][kind] ?? 0));
    const matchesWith = matches.filter((m) => (m.trained[0][kind] ?? 0) + (m.trained[1][kind] ?? 0) + (m.start[0][kind] ?? 0) + (m.start[1][kind] ?? 0) > 0).length;
    const lost = sumOver(matches, (m) => (m.lost[0][kind] ?? 0) + (m.lost[1][kind] ?? 0));
    const kills = sumOver(matches, (m) => Object.values(m.kills).reduce((a, v) => a + (v[kind] ?? 0), 0));
    const dealt = sumOver(matches, (m) => Object.values(m.dealt).reduce((a, v) => a + (v[kind] ?? 0), 0));
    const dealtBy = sumOver(matches, (m) => Object.values(m.dealt[kind] ?? {}).reduce((a, b) => a + b, 0));
    const killsBy = sumOver(matches, (m) => Object.values(m.kills[kind] ?? {}).reduce((a, b) => a + b, 0));
    const spentOn = trained * cost;
    if (trained + startCount + dealt + lost === 0) continue;
    rows.push([
      kind,
      fmt(trained / n, 2),
      pct(matchesWith / n),
      fmt(startCount / n, 2),
      fmt(lost / n, 2),
      fmt(killsBy / n, 2),
      fmt(dealtBy / n, 0),
      spentOn > 0 ? fmt(dealtBy / spentOn, 2) : '–',
    ]);
  }
  return rows;
}

function killMatrix(matches) {
  const attackers = [...new Set(matches.flatMap((m) => Object.keys(m.kills)))].sort();
  const victims = [...new Set(matches.flatMap((m) => Object.values(m.kills).flatMap((v) => Object.keys(v))))].sort();
  if (!attackers.length) return 'No kills in these matches.';
  const n = matches.length;
  const rows = attackers.map((a) => [
    a,
    ...victims.map((v) => fmt(sumOver(matches, (m) => m.kills[a]?.[v] ?? 0) / n, 2)),
  ]);
  return table(['attacker \\ victim', ...victims], rows);
}

function damageMatrix(matches) {
  const attackers = [...new Set(matches.flatMap((m) => Object.keys(m.dealt)))].sort();
  const victims = [...new Set(matches.flatMap((m) => Object.values(m.dealt).flatMap((v) => Object.keys(v))))].sort();
  if (!attackers.length) return 'No damage in these matches.';
  const n = matches.length;
  const rows = attackers.map((a) => [
    a,
    ...victims.map((v) => fmt(sumOver(matches, (m) => m.dealt[a]?.[v] ?? 0) / n, 0)),
  ]);
  return table(['attacker \\ victim', ...victims], rows);
}

// Economy curve: average Shards and value per side at each sampled tick.
function economyTable(matches) {
  const rows = [];
  for (const t of SAMPLE_TICKS) {
    const at = matches.map((m) => m.curve.find((c) => c.tick === t)).filter(Boolean);
    if (!at.length) continue;
    rows.push([
      String(t),
      fmt(mean(at.map((c) => c.shards[0])), 0),
      fmt(mean(at.map((c) => c.shards[1])), 0),
      fmt(mean(at.map((c) => c.value[0])), 0),
      fmt(mean(at.map((c) => c.value[1])), 0),
    ]);
  }
  return table(['tick', 'side 0 Shards', 'side 1 Shards', 'side 0 value', 'side 1 value'], rows);
}

// `pair` is [module0, module1] for one pairing; `modulesLine` overrides the description for the combined section.
function pairingSection(title, matches, pair, modulesLine) {
  const n = matches.length;
  if (!n) return `## ${title}\n\nNo matches kept.\n`;
  const lengths = matches.map((m) => m.length);
  const w0 = matches.filter((m) => m.winner === 0).length;
  const w1 = matches.filter((m) => m.winner === 1).length;
  const draws = n - w0 - w1;
  const reasons = {};
  for (const m of matches) bump(reasons, m.reason);
  const [lo0, hi0] = wilson(w0, n);
  const coreEnds = matches.filter((m) => m.reason === 'core').length;

  const lines = [];
  lines.push(`## ${title}`, '');
  lines.push(`Modules: ${pair[0]} (side 0 first) vs ${pair[1]}. Matches kept: **${n}**.`, '');
  lines.push(
    `- Side 0 wins ${w0} (${pct(w0 / n)}, 95% CI ${pct(lo0)} to ${pct(hi0)}). Side 1 wins ${w1} (${pct(w1 / n)}). Draws ${draws} (${pct(draws / n)}).`,
  );
  lines.push(
    `- Game length: mean ${fmt(mean(lengths), 0)} ticks, median ${fmt(median(lengths), 0)}, shortest ${Math.min(...lengths)}, longest ${Math.max(...lengths)}.`,
  );
  lines.push(
    `- Endings: ${Object.entries(reasons)
      .map(([r, c]) => `${r} ${c}`)
      .join(', ')}. Core kills ended ${pct(coreEnds / n)} of matches.`,
  );
  lines.push(`- First fight: mean tick ${fmt(mean(matches.filter((m) => m.firstFight !== null).map((m) => m.firstFight)), 0)} (${matches.filter((m) => m.firstFight !== null).length} of ${n} matches had any hit).`);
  lines.push('');

  if (pair[0] !== pair[1]) {
    const per = {};
    for (const m of matches) {
      for (const side of [0, 1]) {
        const name = m.modules[side];
        per[name] = per[name] ?? { w: 0, l: 0, d: 0 };
        if (m.winner === side) per[name].w++;
        else if (m.winner === null) per[name].d++;
        else per[name].l++;
      }
    }
    lines.push('Per module (both sides counted, so the seat swap cancels out):', '');
    lines.push(
      table(
        ['module', 'wins', 'losses', 'draws', 'win rate'],
        Object.entries(per).map(([name, r]) => [name, String(r.w), String(r.l), String(r.d), pct(r.w / (r.w + r.l + r.d))]),
      ),
    );
    lines.push('');
  }

  lines.push('### Unit usage (per match, both sides together unless stated)', '');
  lines.push(
    table(
      ['kind', 'trained per match', 'matches using it', 'starting per match', 'lost per match', 'kills per match', 'damage dealt per match', 'damage per Shard spent'],
      unitRows(matches, [...UNIT_KINDS, ...STRUCTURE_KINDS.filter((k) => matches.some((m) => m.built[0][k] || m.built[1][k]))]),
    ),
  );
  lines.push('');
  lines.push('Structure rows: "trained" counts structures that completed (build orders are not in the log as a kind), and damage per Shard spent uses build cost.', '');

  lines.push('### Counters: kills per match (attacker row, victim column; shared kills split evenly)', '');
  lines.push(killMatrix(matches), '');
  lines.push('### Damage per match (attacker row, victim column)', '');
  lines.push(damageMatrix(matches), '');

  lines.push('### Economy curve (average across matches)', '');
  lines.push(economyTable(matches), '');
  lines.push(
    `Shards mined per match: side 0 ${fmt(mean(matches.map((m) => m.mined[0])), 0)}, side 1 ${fmt(mean(matches.map((m) => m.mined[1])), 0)}. Delivered: side 0 ${fmt(mean(matches.map((m) => m.delivered[0])), 0)}, side 1 ${fmt(mean(matches.map((m) => m.delivered[1])), 0)}. Spent: side 0 ${fmt(mean(matches.map((m) => m.spent[0])), 0)}, side 1 ${fmt(mean(matches.map((m) => m.spent[1])), 0)}.`,
    '',
  );

  const rejectTotals = {};
  for (const m of matches) for (const side of [0, 1]) for (const [r, c] of Object.entries(m.rejects[side])) bump(rejectTotals, r, c);
  lines.push(
    `Rejected commands per match: ${Object.keys(rejectTotals).length ? Object.entries(rejectTotals).map(([r, c]) => `${r} ${fmt(c / n, 1)}`).join(', ') : 'none'}.`,
    '',
  );
  return lines.join('\n');
}

function render(opts, kept, dropped, total, startedAt, elapsedS, dropWhy) {
  const head = [
    '# Balance report',
    '',
    `Generated by \`node analytics/balance.mjs${opts.pairs.length ? '' : ''} --matches ${opts.matches} --seed0 ${opts.seed0}${opts.pairs.some((p) => p[0] !== SAMPLE || p[1] !== SAMPLE) ? ' --pair ' + opts.pairs.map((p) => p.join('+')).join(' --pair ') : ''}\`` +
      ` on ${startedAt}, ${elapsedS} s wall clock.`,
    '',
    `Matches run: ${total}. Kept: ${kept}. Dropped: ${dropped}${opts.keepLate ? ' (none dropped, --keep-late)' : ''}` +
      ` (a player ran late in ${dropWhy.late}, threw in ${dropWhy.error}, forfeited in ${dropWhy.forfeit}; a late reply discards that tick's commands, so those matches are not what the rules would give on a quiet machine).`,
    '',
    'Caveat: the sample player is a stand-in, not a competitor. These numbers describe what the rules do under sample play, not the best play. Balance advice from them needs a second look against real player modules.',
    '',
  ];
  return head.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const t0 = Date.now();
  console.log(`Running ${opts.matches} matches per pairing, ${opts.pairs.length} pairing(s), ${opts.jobs} at a time.`);

  const pairingResults = [];
  for (const pair of opts.pairs) {
    const jobs = [];
    for (let i = 0; i < opts.matches; i++) {
      const seed = opts.seed0 + i;
      const swap = i % 2 === 1;
      jobs.push(() => playOne(seed, pair[0], pair[1], swap));
    }
    console.log(`Pairing ${pair[0]} vs ${pair[1]}`);
    const all = await runAll(jobs, opts.jobs);
    pairingResults.push({ pair, all });
  }

  let total = 0;
  let dropped = 0;
  const dropWhy = { late: 0, error: 0, forfeit: 0 };
  const sections = [];
  const everything = [];
  for (const { pair, all } of pairingResults) {
    total += all.length;
    const kept = opts.keepLate ? all : all.filter((m) => !m.lateMatch);
    for (const m of all) {
      if (opts.keepLate || !m.lateMatch) continue;
      if (m.late[0] + m.late[1] > 0) dropWhy.late++;
      else if (m.errors[0] + m.errors[1] > 0) dropWhy.error++;
      else dropWhy.forfeit++;
    }
    dropped += all.length - kept.length;
    everything.push(...kept);
    const label = pair[0] === pair[1] ? `Pairing: ${pair[0]} vs itself` : `Pairing: ${pair[0]} vs ${pair[1]}`;
    sections.push(pairingSection(label, kept, pair));
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  const body = [render(opts, everything.length, dropped, total, startedAt, elapsed, dropWhy), ...sections];
  if (pairingResults.length > 1) body.push(pairingSection('All pairings together', everything, [SAMPLE, SAMPLE]));

  const out = path.resolve(ROOT, opts.out);
  fs.writeFileSync(out, body.join('\n') + '\n');
  console.log(`Wrote ${opts.out}: ${everything.length} matches kept, ${dropped} dropped, ${elapsed} s.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
