// Driftfall — the Drift: a seeded, deterministic schedule of land events (TERRITORY.md section 4).
// Same seed, same Drift. The whole schedule is built once from the seed; step(tick) only looks it up, so
// asking for the same tick twice, in any order, gives the same answer. Every event is announced 30 s
// (ANNOUNCE_TICKS) before it applies. Targets are (side, role, index) in TERRITORY.md section 2 terms; the map
// maps them to Reach ids, so this file never needs the map. No clock or timers: every draw comes from makeRng.
import { makeRng } from './rng.mjs';

export const TICKS_PER_SECOND = 24;
export const ANNOUNCE_TICKS = 30 * TICKS_PER_SECOND;
export const MAP_SIZE = 128; // tiles per side of the 128 x 128 map (TERRITORY.md section 2)
export const DRIFT_KINDS = ['bloom', 'dry-out', 'flood', 'quake', 'squall', 'fall'];

const FLOOD_TICKS = 60 * TICKS_PER_SECOND;
const SQUALL_TICKS = 45 * TICKS_PER_SECOND;
const FALL_GAP = 20 * TICKS_PER_SECOND;
const SALT = 0x44524946; // 'DRIF': keeps the Drift stream apart from any other use of the seed
const RANDOM_WIDTH = 16; // width of a random Squall band, in tiles
const CENTRE_BAND = { axis: 'ew', start: 52, width: 24, direction: 1, speed: 0 }; // 52..75, centred on 64

const at = (minutes, seconds = 0) => (minutes * 60 + seconds) * TICKS_PER_SECOND;

// Random slots: every 2:00 after the 9:00 Quake, up to The Fall at 14:00.
const RANDOM_SLOTS = [at(11), at(13)];
// Weighted toward Dry-outs: 3 in 7.
const RANDOM_WEIGHTS = [
  ['dry-out', 3],
  ['bloom', 1],
  ['flood', 1],
  ['quake', 1],
  ['squall', 1],
];
// Roles a random event may pick, per kind. Lowlands only for Floods; Mesa and Pocket are high ground.
const POOL = {
  bloom: ['pocket', 'flank', 'mesa', 'rich'],
  'dry-out': ['main', 'natural', 'vent', 'flank', 'pocket', 'rich', 'mesa'],
  flood: ['natural', 'flank', 'pocket'],
  'ramp-closes': ['main', 'natural', 'flank'],
};
const DOUBLED = new Set(['vent', 'outer']); // two of these per side, so the index matters

const pick = (rng, list) => list[rng.int(list.length)];
const target = (side, role, index = 0) => ({ side, role, index });

// The Drift's fixed clock (TERRITORY.md section 4). Seeded choices: which side floods first, which side's main
// ramp closes, and the order The Fall takes the Outer Reaches.
function fixedEvents(rng) {
  const out = [];
  out.push({ kind: 'bloom', tick: at(3), targets: [target(0, 'flank'), target(1, 'flank')] });
  out.push({ kind: 'squall', tick: at(5), targets: [], band: CENTRE_BAND });
  out.push({ kind: 'bloom', tick: at(5), targets: [target('centre', 'centre')] });
  const first = rng.int(2);
  out.push({ kind: 'flood', tick: at(7), targets: [target(first, 'natural')] });
  out.push({ kind: 'flood', tick: at(8), targets: [target(1 - first, 'natural')] });
  const closing = rng.int(2);
  out.push({ kind: 'quake', tick: at(9), targets: [target(closing, 'main'), target(1 - closing, 'mesa')] });
  const outer = [target(0, 'outer', 0), target(0, 'outer', 1), target(1, 'outer', 0), target(1, 'outer', 1)];
  for (let i = outer.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [outer[i], outer[j]] = [outer[j], outer[i]];
  }
  outer.forEach((reach, i) => out.push({ kind: 'fall', tick: at(14) + i * FALL_GAP, targets: [reach] }));
  return out;
}

// One random slot: kind from the weighted table, then its place, all drawn in a fixed order.
function randomEvent(rng, tick) {
  const total = RANDOM_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  let kind = RANDOM_WEIGHTS[0][0];
  for (const [name, weight] of RANDOM_WEIGHTS) {
    if (roll < weight) { kind = name; break; }
    roll -= weight;
  }
  if (kind === 'squall') {
    const axis = rng.int(2) ? 'ew' : 'ns';
    const start = rng.int(MAP_SIZE - RANDOM_WIDTH + 1);
    const direction = rng.int(2) ? 1 : -1;
    return { kind, tick, targets: [], band: { axis, start, width: RANDOM_WIDTH, direction, speed: 1 } };
  }
  if (kind === 'quake') {
    const closeSide = rng.int(2);
    const closeRole = pick(rng, POOL['ramp-closes']);
    const openSide = rng.int(2);
    return { kind, tick, targets: [target(closeSide, closeRole), target(openSide, 'mesa')] };
  }
  const side = rng.int(2);
  const role = pick(rng, POOL[kind]);
  return { kind, tick, targets: [target(side, role, DOUBLED.has(role) ? rng.int(2) : 0)] };
}

// Build the whole Drift for one seed. Returns the events and a step() that is a pure lookup.
export function createDrift(seed) {
  const rng = makeRng((Number(seed) | 0) ^ SALT);
  const raw = fixedEvents(rng);
  for (const tick of RANDOM_SLOTS) raw.push(randomEvent(rng, tick));
  raw.sort((a, b) => a.tick - b.tick); // stable: fixed events keep their order within a tick

  const events = raw.map((ev, i) => ({
    id: i + 1,
    kind: ev.kind,
    tick: ev.tick,
    announceTick: ev.tick - ANNOUNCE_TICKS,
    expireTick: ev.kind === 'flood' ? ev.tick + FLOOD_TICKS : ev.kind === 'squall' ? ev.tick + SQUALL_TICKS : null,
    targets: ev.targets,
    detail: ev.band ? { band: ev.band } : {},
  }));

  const byAnnounce = new Map();
  const byApply = new Map();
  const byExpire = new Map();
  const push = (map, tick, ev) => map.set(tick, (map.get(tick) || []).concat(ev));
  for (const ev of events) {
    push(byAnnounce, ev.announceTick, ev);
    push(byApply, ev.tick, ev);
    if (ev.expireTick !== null) push(byExpire, ev.expireTick, ev);
  }

  return {
    seed,
    events,
    // What happens on this exact tick: announcements (30 s out), events that apply now, and timed events that end now.
    step(tick) {
      return {
        announce: (byAnnounce.get(tick) || []).slice(),
        apply: (byApply.get(tick) || []).slice(),
        expire: (byExpire.get(tick) || []).slice(),
      };
    },
    // Events in force at this tick: applied and not yet expired.
    active(tick) {
      return events.filter((ev) => tick >= ev.tick && (ev.expireTick === null || tick < ev.expireTick));
    },
  };
}

// Where a Squall band is at this tick, as tile bounds [lo, hi) along its axis. null when it is not in force.
// Movement is whole tiles, rounded toward zero, so the same tick always gives the same band.
export function squallBand(ev, tick) {
  if (ev.kind !== 'squall' || tick < ev.tick || (ev.expireTick !== null && tick >= ev.expireTick)) return null;
  const { axis, start, width, direction, speed } = ev.detail.band;
  const lo = start + Math.trunc((direction * speed * (tick - ev.tick)) / TICKS_PER_SECOND);
  return { axis, lo, hi: lo + width };
}
