// Watch mode (play/index.html?mode=watch): the built-in AI plays both sides and a caster camera follows the action.
// Pure helpers, no DOM, so node tests cover them. The page wiring is a small block in play/app.mjs.
//   createCaster()  -> note(tick, snap, events) each tick; pick(tick) -> {x, y, why, key, score} | null
//   glide(rig, target, dt)   eases the camera rig toward a target (frame-rate independent, speed capped)
//   createTopbar()  -> note(state) each tick; read(state) -> { sides: [{income, army, reaches}, ...], total }
// `snap` is the sim state (or any object with units, structures and territory); events are the tick's sim events.
import { valueOf } from '../env/stats.mjs';

export const TPS = 24;
export const RESTART_SECONDS = 10;
export const isWatch = (query) => query.get('mode') === 'watch';
export const nextSeed = (seed) => (Number(seed) || 7) + 1;

const CELL = 6; // tiles; hits this close together count as one fight
const HALF_LIFE = 3 * TPS; // a fight's heat halves every 3 s
const DWELL = 3 * TPS; // keep a look at least this long...
const SWITCH_RATIO = 1.35; // ...and only leave it early for something clearly bigger
const MIN_HEAT = 2;
const BASE_WEIGHT = 1.5, CORE_WEIGHT = 3; // damage to a structure draws the eye more than to a unit

// Important events: how much they pull the camera and for how many seconds.
const EVENTS = {
  claimed: { why: 'claim', score: 40, secs: 5 },
  contested: { why: 'claim', score: 45, secs: 5 },
  'hold-lost': { why: 'claim', score: 30, secs: 5 },
  'countdown-start': { why: 'claim', score: 70, secs: 8 },
  'drift-announce': { why: 'drift', score: 50, secs: 5 },
  'drift-apply': { why: 'drift', score: 90, secs: 6 },
};

function reachSpot(territory, ev) {
  const reaches = territory?.map?.reaches;
  if (!reaches) return null;
  let r = null;
  if (Number.isInteger(ev.reach)) r = reaches.find((x) => x.id === ev.reach) ?? reaches[ev.reach];
  else if (ev.targets?.length) {
    const t = ev.targets[0];
    r = reaches.find((x) => x.role === t.role && (x.side ?? 'centre') === t.side) ?? reaches.find((x) => x.role === t.role);
  }
  const c = r && (r.claimSpot || r.centre);
  return c ? { x: c.x, y: c.y } : null;
}

export function createCaster() {
  const cells = new Map(); // key -> { heat, wx, wy, tick, base }
  const spots = []; // important events: { key, why, score, x, y, until }
  let current = null; // { key, since }
  let seq = 0;

  const heatOf = (c, tick) => c.heat * 0.5 ** (Math.max(0, tick - c.tick) / HALF_LIFE);

  function note(tick, snap, events = []) {
    const byId = new Map();
    for (const u of snap.units ?? []) byId.set(u.id, { e: u, structure: false });
    for (const s of snap.structures ?? []) byId.set(s.id, { e: s, structure: true });
    for (const ev of events) {
      if (ev.e === 'hit') {
        const hit = byId.get(ev.id);
        if (!hit) continue;
        const { e, structure } = hit;
        const w = ev.dmg * (structure ? (e.kind === 'core' ? CORE_WEIGHT : BASE_WEIGHT) : 1);
        const key = `fight:${Math.floor(e.x / CELL)},${Math.floor(e.y / CELL)}`;
        let c = cells.get(key);
        if (!c) { c = { heat: 0, wx: 0, wy: 0, tick, base: false }; cells.set(key, c); }
        const old = heatOf(c, tick), k = c.heat > 0 ? old / c.heat : 0; // decay the sums to now, then add
        c.wx = c.wx * k + e.x * w; c.wy = c.wy * k + e.y * w;
        c.heat = old + w; c.tick = tick; c.base ||= structure;
      } else if (EVENTS[ev.e]) {
        const spot = reachSpot(snap.territory, ev);
        if (!spot) continue;
        const d = EVENTS[ev.e];
        spots.push({ key: `${d.why}:${ev.e}:${seq++}`, why: d.why, score: d.score, x: spot.x, y: spot.y, until: tick + d.secs * TPS });
      }
    }
  }

  function candidates(tick) {
    const out = [];
    for (const [key, c] of cells) {
      const heat = heatOf(c, tick);
      if (heat < MIN_HEAT) { cells.delete(key); continue; }
      out.push({ key, why: c.base ? 'base' : 'fight', score: heat, x: c.wx / c.heat, y: c.wy / c.heat });
    }
    for (let i = spots.length - 1; i >= 0; i--) {
      if (tick >= spots[i].until) { spots.splice(i, 1); continue; }
      out.push({ ...spots[i] });
    }
    return out;
  }

  function pick(tick) {
    const list = candidates(tick);
    if (!list.length) { current = null; return null; }
    const best = list.reduce((a, b) => (b.score > a.score ? b : a));
    const stay = current && list.find((c) => c.key === current.key);
    if (stay && best.key !== stay.key && (tick - current.since < DWELL || best.score < stay.score * SWITCH_RATIO)) return stay;
    if (!stay || best.key !== current.key) current = { key: best.key, since: tick };
    return best;
  }

  return { note, pick };
}

// Ease the rig toward the target: exponential approach (same distance per second at any frame rate), capped speed.
export function glide(rig, target, dt, { rate = 1.8, maxSpeed = 30 } = {}) {
  if (!target || !(dt > 0)) return;
  const k = 1 - Math.exp(-rate * dt);
  let dx = (target.x - rig.x) * k, dy = (target.y - rig.y) * k;
  const len = Math.hypot(dx, dy), cap = maxSpeed * dt;
  if (len > cap) { dx *= cap / len; dy *= cap / len; }
  rig.centerOn(rig.x + dx, rig.y + dy);
}

// Income is what each side gained in shards over the last minute (spending is not income); army is the cost of
// every finished fighting unit; Reaches come from the territory state when the rules are on.
export function createTopbar({ tps = TPS } = {}) {
  const window = 60 * tps;
  const gains = [[], []];
  let last = null, first = null;

  function note(state) {
    if (first === null) first = state.tick;
    if (last) {
      for (const s of [0, 1]) {
        const d = state.shards[s] - last[s];
        if (d > 0) gains[s].push([state.tick, d]);
      }
    }
    last = [state.shards[0], state.shards[1]];
    for (const g of gains) while (g.length && g[0][0] <= state.tick - window) g.shift();
  }

  function read(state) {
    const elapsed = Math.max(tps, Math.min(window, state.tick - (first ?? state.tick)));
    const t = state.territory;
    const sides = [0, 1].map((s) => ({
      income: Math.round(gains[s].reduce((n, g) => n + g[1], 0) * window / elapsed),
      army: state.units.filter((u) => u.owner === s && u.kind !== 'worker').reduce((n, u) => n + valueOf(u), 0),
      reaches: t?.hold?.[s] ?? 0,
    }));
    return { sides, total: t?.reaches?.length ?? 0 };
  }
  return { note, read };
}
