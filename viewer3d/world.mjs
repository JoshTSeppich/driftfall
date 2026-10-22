// Driftfall 3D world: turns a match log into smooth frames the renderer can draw at any fractional tick.
// Pure module: no DOM, no clock, no three.js. Safe to import from node tests. Built on viewer/replay.mjs.
//
// createWorld(log) -> { ticks, start, end, map, stats, players, result, stateAt(tick), frame(t), facingAt(id, tick) }
// frame(t) -> { tick, alpha, prev, next, events, groups, units, structures, dying }
//   prev/next   states at floor(t) and floor(t)+1 (read-only, shared; do not mutate)
//   events      what happened while going prev -> next, each enriched: { type, e, ...original fields, ... }
//   groups      the same events by type: groups.hit, die, deliver, mine, spawn, buildStart, buildDone,
//               progress, order, move, other
//   units       every unit alive in prev or next, with smooth x, y (tile units) and render hints (see decorate)
//   structures  every structure alive in prev or next, with the same hints
//   dying       the units and structures removed this tick (also present in the two lists above)
// Angles are grid angles: atan2(dy, dx), x east, y south. The renderer maps them onto the ground plane.
// Works for any unit/structure kind (the expanded roster needs no changes here).

import { createReplayer, lastTick, statFor } from '../viewer/replay.mjs';

const lerp = (a, b, t) => a + (b - a) * t;
const MAX_CACHE = 8;

function byId(list) {
  const m = new Map();
  for (const e of list) m.set(e.id, e);
  return m;
}

function pt(e) {
  return e ? { id: e.id, owner: e.owner, kind: e.kind, x: e.x, y: e.y } : null;
}

// Pass over the whole log once to record which way each unit faces over time (moves, then attacks).
function buildFacing(log) {
  const replayer = createReplayer(log, 1e9);
  const timeline = new Map(); // id -> [{ tick, angle }] in tick order
  const note = (id, tick, angle) => {
    let list = timeline.get(id);
    if (!list) timeline.set(id, (list = []));
    const last = list[list.length - 1];
    if (last && last.tick === tick) last.angle = angle;
    else if (!last || last.angle !== angle) list.push({ tick, angle });
  };
  const end = lastTick(log);
  const start = replayer.state.tick;
  let prev = structuredClone(replayer.state);
  for (let t = start + 1; t <= end; t++) {
    const events = replayer.eventsAt(t);
    const before = byId([...prev.units, ...prev.structures]);
    for (const ev of events) {
      if (ev.e === 'move') {
        const u = before.get(ev.id);
        if (u && (ev.x !== u.x || ev.y !== u.y)) note(ev.id, t, Math.atan2(ev.y - u.y, ev.x - u.x));
      } else if (ev.e === 'hit') {
        const a = before.get(ev.by);
        const d = before.get(ev.id);
        if (a && d && (a.x !== d.x || a.y !== d.y)) note(ev.by, t, Math.atan2(d.y - a.y, d.x - a.x));
      }
    }
    prev = structuredClone(replayer.seek(t));
  }
  return timeline;
}

export function createWorld(log) {
  const replayer = createReplayer(log, 50);
  const start = replayer.state.tick;
  const end = lastTick(log);
  const stats = log.stats ?? null;
  const facing = buildFacing(log);
  const cache = new Map(); // tick -> state clone

  function stateAt(tick) {
    tick = Math.max(start, Math.min(end, Math.round(tick)));
    let s = cache.get(tick);
    if (!s) {
      s = structuredClone(replayer.seek(tick));
      cache.set(tick, s);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    }
    return s;
  }

  function facingAt(id, tick, fallback = 0) {
    const list = facing.get(id);
    if (!list) return fallback;
    let lo = 0, hi = list.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].tick <= tick) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best < 0 ? fallback : list[best].angle;
  }

  function enrich(raw, prev, next) {
    const find = (id) => {
      for (const s of [prev, next]) {
        const e = s.units.find((u) => u.id === id) ?? s.structures.find((u) => u.id === id);
        if (e) return e;
      }
      return null;
    };
    const out = [];
    for (const ev of raw) {
      const e = { ...ev, type: ev.e };
      switch (ev.e) {
        case 'hit': {
          const from = find(ev.by), to = find(ev.id);
          e.from = pt(from);
          e.to = pt(to);
          e.dist = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
          e.ranged = e.dist > 1.5;
          break;
        }
        case 'die': {
          const ent = prev.units.find((u) => u.id === ev.id) ?? prev.structures.find((s) => s.id === ev.id);
          e.entity = ent ? structuredClone(ent) : null;
          e.isStructure = !!ent && prev.structures.includes(ent);
          if (ent) Object.assign(e, { kind: ent.kind, owner: ent.owner, x: ent.x, y: ent.y });
          break;
        }
        case 'deliver':
        case 'mine': {
          const u = find(ev.id);
          e.at = pt(u);
          e.owner = u?.owner;
          break;
        }
        case 'spawn':
          e.entity = ev.unit ?? ev.structure ?? null;
          e.isStructure = !!ev.structure;
          e.type = ev.structure && !ev.structure.complete ? 'buildStart' : 'spawn';
          break;
        case 'done':
          e.type = 'buildDone';
          e.at = pt(find(ev.id));
          break;
        default:
          break;
      }
      out.push(e);
    }
    return out;
  }

  const KNOWN = new Set(['hit', 'die', 'deliver', 'mine', 'spawn', 'buildStart', 'buildDone', 'progress', 'order', 'move']);
  function group(events) {
    const g = { hit: [], die: [], deliver: [], mine: [], spawn: [], buildStart: [], buildDone: [], progress: [], order: [], move: [], other: [] };
    for (const e of events) (KNOWN.has(e.type) ? g[e.type] : g.other).push(e);
    return g;
  }

  // Smoothly blended entities with hints the renderer would otherwise have to derive itself.
  function decorate(prev, next, alpha, tick, events) {
    const attackers = new Set();
    const struck = new Map();
    for (const e of events) {
      if (e.type !== 'hit') continue;
      attackers.add(e.by);
      struck.set(e.id, (struck.get(e.id) ?? 0) + (e.dmg ?? 0));
    }
    const dyingIds = new Set(events.filter((e) => e.type === 'die').map((e) => e.id));
    const build = (listPrev, listNext, isStructure) => {
      const pm = byId(listPrev), nm = byId(listNext);
      const out = [];
      const make = (p, n) => {
        const base = n ?? p;
        const a = p ?? n, b = n ?? p;
        const stat = statFor(stats, base.kind);
        const maxHp = stat?.hp ?? base.hp;
        const hp = lerp(a.hp ?? 0, b.hp ?? 0, alpha);
        out.push({
          ...b,
          x: lerp(a.x, b.x, alpha),
          y: lerp(a.y, b.y, alpha),
          fromX: a.x, fromY: a.y,
          hp, hpPrev: a.hp, maxHp, hpFrac: maxHp ? Math.max(0, Math.min(1, hp / maxHp)) : 1,
          facing: facingAt(base.id, tick + 1, isStructure ? 0 : Math.PI / 2),
          moving: b.x !== a.x || b.y !== a.y,
          attacking: attackers.has(base.id),
          hurt: struck.has(base.id),
          damage: struck.get(base.id) ?? 0,
          born: !p,                              // appeared this tick: scale/fade in with `t`
          dying: !n || dyingIds.has(base.id),    // removed this tick: play the death with `t`
          t: alpha,
          isStructure,
          progressFrac: isStructure
            ? (base.complete ? 1 : Math.min(1, lerp(a.progress ?? 0, b.progress ?? 0, alpha) / (stat?.buildTicks || 1)))
            : undefined,
          buildDoneNow: isStructure && !!b.complete && !!p && !p.complete,
        });
      };
      for (const n of listNext) make(pm.get(n.id), n);
      for (const p of listPrev) if (!nm.has(p.id)) make(p, null);
      return out;
    };
    return { units: build(prev.units, next.units, false), structures: build(prev.structures, next.structures, true) };
  }

  let memo = null; // frame() runs every render frame, so the same tick repeats many times
  function frame(t) {
    t = Number.isFinite(t) ? Math.max(start, Math.min(end, t)) : start;
    let tick = Math.floor(t);
    let alpha = t - tick;
    if (tick >= end) { tick = end; alpha = 0; }
    const nextTick = Math.min(end, tick + 1);
    const prev = stateAt(tick), next = stateAt(nextTick);
    if (!memo || memo.tick !== tick) {
      const events = nextTick > tick ? enrich(replayer.eventsAt(nextTick), prev, next) : [];
      memo = { tick, events, groups: group(events) };
    }
    const dec = decorate(prev, next, alpha, tick, memo.events);
    return {
      tick, alpha, prev, next,
      events: memo.events, groups: memo.groups,
      units: dec.units,
      structures: dec.structures,
      dying: [...dec.units, ...dec.structures].filter((e) => e.dying),
    };
  }

  const initial = stateAt(start);
  return {
    ticks: end - start,
    start, end,
    stats,
    players: log.players ?? null,
    result: log.result ?? null,
    map: { width: initial.width, height: initial.height, rocks: initial.rocks, crystals: initial.crystals },
    stateAt, frame, facingAt,
  };
}
