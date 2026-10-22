// Per-match stats for the balance and live view teams.
// Reads every driftfall match log in matches/ (format: ENV-SPEC.md section 12) and writes analytics/summary.json.
// Usage: node analytics/matches.mjs [matchesDir] [outFile]
// Read-only on the logs. No Date or Math.random, so the same logs always give the same summary.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MATCHES_DIR = process.argv[2] ?? path.join(HERE, "..", "matches");
const OUT_FILE = process.argv[3] ?? path.join(HERE, "summary.json");

// ASSUMPTION: ENV-SPEC.md defines no tick rate (the sim has no clock). 8 ticks per second is the default
// playback speed in viewer3d/index.html, so "per minute" means 480 ticks. Change this if the team picks another rate.
export const TICKS_PER_MINUTE = 8 * 60;

const round1 = (n) => Math.round(n * 10) / 10;

// Add to a counter object, creating the key on first use.
function bump(obj, key, amount = 1) {
  obj[key] = (obj[key] ?? 0) + amount;
}

// Sort object keys so the JSON comes out the same every run.
function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

// Every entity the match ever had, keyed by id: its owner, kind and whether it is a unit.
function indexEntities(initial) {
  const table = new Map();
  for (const u of initial.units ?? []) table.set(u.id, { owner: u.owner, kind: u.kind, unit: true });
  for (const s of initial.structures ?? []) table.set(s.id, { owner: s.owner, kind: s.kind, unit: false });
  return table;
}

// One match log -> its stats. Counts only events the log actually contains; no combat means zero damage.
export function analyseMatch(log, name) {
  const entities = indexEntities(log.initial);
  const damageDealt = [{}, {}]; // side -> attacker kind -> hp
  const damageTaken = [{}, {}]; // side -> target kind -> hp
  const unitsLost = [{}, {}]; // side -> unit kind -> count
  const structuresLost = [{}, {}]; // side -> structure kind -> count
  const delivered = [0, 0]; // Shards delivered to a Core
  const deliveredByMinute = [{}, {}]; // side -> minute index -> Shards
  const spent = [0, 0]; // Shards spent on orders
  const lateTicks = [0, 0];
  const errorTicks = [0, 0];
  const forfeits = [];
  let unresolvedEvents = 0; // events naming an id the log never introduced

  for (const entry of log.ticks ?? []) {
    const minute = Math.floor(entry.tick / TICKS_PER_MINUTE);
    for (const e of entry.events ?? []) {
      switch (e.e) {
        case "spawn": {
          const rec = e.unit ?? e.structure;
          if (rec) entities.set(rec.id, { owner: rec.owner, kind: rec.kind, unit: Boolean(e.unit) });
          break;
        }
        case "hit": {
          const attacker = entities.get(e.by);
          const target = entities.get(e.id);
          if (!attacker || !target) {
            unresolvedEvents++;
            break;
          }
          bump(damageDealt[attacker.owner], attacker.kind, e.dmg);
          bump(damageTaken[target.owner], target.kind, e.dmg);
          break;
        }
        case "die": {
          const ent = entities.get(e.id);
          if (!ent) {
            unresolvedEvents++;
            break;
          }
          if (ent.unit) bump(unitsLost[ent.owner], ent.kind);
          else bump(structuresLost[ent.owner], ent.kind);
          break;
        }
        case "deliver": {
          const worker = entities.get(e.id);
          if (!worker) {
            unresolvedEvents++;
            break;
          }
          delivered[worker.owner] += e.amount;
          bump(deliveredByMinute[worker.owner], minute, e.amount);
          break;
        }
        case "spend":
          if (e.player === 0 || e.player === 1) spent[e.player] += e.amount;
          break;
        case "late":
          if (e.player === 0 || e.player === 1) lateTicks[e.player]++;
          break;
        case "error":
          if (e.player === 0 || e.player === 1) errorTicks[e.player]++;
          break;
        case "forfeit":
          forfeits.push({ player: e.player, reason: e.reason });
          break;
        default:
          break;
      }
    }
  }

  const result = log.result ?? {};
  const lastTick = result.tick ?? log.ticks?.at(-1)?.tick ?? 0;
  const minutes = lastTick / TICKS_PER_MINUTE;
  const perMinute = (shards) => (minutes > 0 ? round1(shards / minutes) : 0);
  const minuteBuckets = Math.floor(lastTick / TICKS_PER_MINUTE) + 1;
  const curve = (side) => Array.from({ length: minuteBuckets }, (_, m) => deliveredByMinute[side][m] ?? 0);

  return {
    file: name,
    seed: log.seed,
    players: log.players,
    winner: result.winner ?? null,
    reason: result.reason ?? "unknown",
    ticks: lastTick,
    minutes: round1(minutes),
    value: result.value ?? null,
    damageDealt: [sortKeys(damageDealt[0]), sortKeys(damageDealt[1])],
    damageTaken: [sortKeys(damageTaken[0]), sortKeys(damageTaken[1])],
    unitsLost: [sortKeys(unitsLost[0]), sortKeys(unitsLost[1])],
    structuresLost: [sortKeys(structuresLost[0]), sortKeys(structuresLost[1])],
    shardsDelivered: delivered,
    shardsSpent: spent,
    incomePerMinute: [perMinute(delivered[0]), perMinute(delivered[1])],
    incomeCurve: [curve(0), curve(1)], // Shards delivered in each minute; the last one may be partial
    lateTicks,
    errorTicks,
    forfeits,
    unresolvedEvents,
  };
}

// Add up the per-match numbers into one table for the balance and live teams.
function aggregate(matches) {
  const n = matches.length;
  const wins = [0, 0];
  let draws = 0;
  const reasons = {};
  const dealt = [{}, {}];
  const lost = [{}, {}];
  const delivered = [0, 0];
  let totalMinutes = 0;

  for (const m of matches) {
    if (m.winner === 0 || m.winner === 1) wins[m.winner]++;
    else draws++;
    bump(reasons, m.reason);
    totalMinutes += m.minutes;
    for (const side of [0, 1]) {
      for (const [k, v] of Object.entries(m.damageDealt[side])) bump(dealt[side], k, v);
      for (const [k, v] of Object.entries(m.unitsLost[side])) bump(lost[side], k, v);
      delivered[side] += m.shardsDelivered[side];
    }
  }

  const avg = (total) => (n > 0 ? round1(total / n) : 0);
  const rate = (total) => (totalMinutes > 0 ? round1(total / totalMinutes) : 0);
  return {
    matchCount: n,
    wins,
    draws,
    winReasons: sortKeys(reasons),
    totalMinutes: round1(totalMinutes),
    averageDamageDealtPerMatch: [0, 1].map((s) => sortKeys(Object.fromEntries(Object.entries(dealt[s]).map(([k, v]) => [k, avg(v)])))),
    averageUnitsLostPerMatch: [0, 1].map((s) => sortKeys(Object.fromEntries(Object.entries(lost[s]).map(([k, v]) => [k, avg(v)])))),
    incomePerMinute: [rate(delivered[0]), rate(delivered[1])],
  };
}

// Short sentences the live view can show as they are.
function findings(agg) {
  if (agg.matchCount === 0) return ["No match logs found yet."];
  const out = [];
  out.push(
    `${agg.matchCount} match${agg.matchCount === 1 ? "" : "es"} analysed: side 0 won ${agg.wins[0]}, side 1 won ${agg.wins[1]}, ${agg.draws} draw${agg.draws === 1 ? "" : "s"}.`,
  );
  const reasons = Object.entries(agg.winReasons).map(([r, c]) => `${r} ${c}`).join(", ");
  out.push(`Win reasons: ${reasons}.`);
  out.push(`Income: side 0 ${agg.incomePerMinute[0]} Shards per minute, side 1 ${agg.incomePerMinute[1]}.`);
  for (const side of [0, 1]) {
    const top = Object.entries(agg.averageDamageDealtPerMatch[side]).sort((a, b) => b[1] - a[1])[0];
    if (top) out.push(`Side ${side} deals most damage with ${top[0]}s (about ${top[1]} hp per match).`);
  }
  return out;
}

// Read every driftfall log in the folder. Anything that is not a driftfall log goes into `skipped`.
export function summariseDir(dir) {
  const matches = [];
  const skipped = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const file of files) {
    let log;
    try {
      log = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      // A log can be half-written while the live compiler saves it. Skip it and say so.
      skipped.push({ file, reason: `not readable JSON (${err.message})` });
      continue;
    }
    if (log.format !== "driftfall-log" || !Array.isArray(log.ticks)) {
      skipped.push({ file, reason: "not a driftfall-log" });
      continue;
    }
    matches.push(analyseMatch(log, file));
  }
  const agg = aggregate(matches);
  return {
    format: "driftfall-analytics-summary",
    version: 1,
    ticksPerMinute: TICKS_PER_MINUTE,
    rateNote: "ENV-SPEC.md has no tick rate; per-minute numbers assume 8 ticks per second (viewer3d default).",
    skipped,
    aggregate: agg,
    findings: findings(agg),
    matches,
  };
}

// Run as a script: write the summary file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = summariseDir(MATCHES_DIR);
  fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2) + "\n");
  console.log(`wrote ${OUT_FILE}: ${summary.aggregate.matchCount} matches, ${summary.skipped.length} skipped`);
  for (const line of summary.findings) console.log(`- ${line}`);
}
