// Driftfall cord power (TERRITORY.md section 20: "the cord is the leash"). Owner: sonnet.
//
// Opt-in: nothing here runs unless state.power exists (enablePower; createTerritoryMatch turns it on).
// Pure and deterministic: no clock, no randomness.
//
// Power points: a Core is the Power Strip (its network is always lit: that is the reserve, so the base can always
// rebuild); a completed claim is an Outlet; place-power adds Extension Boxes (reach further) and Generators (energy
// that lights an island). Two points link when they are within the larger of their two ranges; a linked group is a
// network. A plugged unit may stand anywhere within its cord length of one of its owner's points. Past that its move
// stops (stepVerdict, called by movement.mjs). A network without a Strip or a Generator browns out: its units are stuck.
// A cord is cut when an enemy unit stands on the line between a plugged unit and its anchor: the unit runs on a
// battery (free to move) for POWER.batteryTicks, then powers down. A Crumb (worker) standing next to it for
// POWER.plugTicks re-plugs it.
//
// The sim calls: enablePower (createTerritoryMatch), doPlug / doPlaceCord (applyRuleCommands), stepPower (stepRulesPre).

import { distance, isFree, isPassable, allocId, emit } from './state.mjs';
import { STATS } from './stats.mjs';

// Numbers from TERRITORY.md section 20. Cord lengths are in tiles, Chebyshev like every other distance here.
// Unit kinds are the engine's; the Toastinator names are a presentation layer (worker = Crumb, grunt = Popper,
// lancer = Zapper, brute = Four-Slice). Bagel (air) is not in the sim yet.
export const POWER = Object.freeze({
  cord: Object.freeze({ worker: 12, grunt: 8, lancer: 10, brute: 6 }),
  range: Object.freeze({ strip: 14, outlet: 10, extension: 8, generator: 0 }),
  cost: Object.freeze({ extension: 30, generator: 60 }),
  batteryTicks: 240, // 10 s at 24 ticks per second
  plugTicks: 24, // 1 s next to a cut unit to plug it back in
  reserveCooldown: 720, // 30 s between free emergency Crumbs
  sparkTicks: 24, // how long a cut stays visible
});

const cordOf = (kind) => POWER.cord[kind] ?? 8;
const unitById = (state, id) => (typeof id === 'number' ? state.units.find((u) => u.id === id) : undefined);

/** Turn the power rules on for a state. Every unit gets its power record on the first tick it is seen. */
export function enablePower(state) {
  state.power = { points: [], plugging: new Map(), cuts: [], reserveCd: [0, 0], view: null };
  return state.power;
}

// All points of every side right now: Strips (Cores), Outlets (completed claims), then the boxes and generators.
function allPoints(state) {
  const points = [];
  for (const s of state.structures) {
    if (s.kind === 'core' && s.hp > 0) points.push({ id: s.id, owner: s.owner, kind: 'strip', x: s.x, y: s.y, range: POWER.range.strip });
  }
  for (const c of state.claims || []) {
    if (c.complete && c.hp > 0 && !c.dead) points.push({ id: c.id, owner: c.owner, kind: 'outlet', x: c.x, y: c.y, range: POWER.range.outlet });
  }
  for (const p of state.power.points) points.push(p);
  return points;
}

// Networks: groups of points linked by range. Returns Map point id -> { owner, strip, energy, lit }.
function networksOf(points) {
  const netOf = new Map();
  for (const p of points) {
    if (netOf.has(p.id)) continue;
    const members = [p];
    netOf.set(p.id, null);
    for (let i = 0; i < members.length; i++) {
      for (const q of points) {
        if (netOf.get(q.id) !== undefined) continue;
        if (q.owner !== members[i].owner || distance(members[i], q) > Math.max(members[i].range, q.range)) continue;
        netOf.set(q.id, null);
        members.push(q);
      }
    }
    const strip = members.some((m) => m.kind === 'strip');
    const energy = members.filter((m) => m.kind === 'generator').length;
    const net = { owner: p.owner, strip, energy, lit: strip || energy > 0 };
    for (const m of members) netOf.set(m.id, net);
  }
  return netOf;
}

function refresh(state) {
  const points = allPoints(state);
  state.power.view = { points, netOf: networksOf(points) };
  return state.power.view;
}

// The nearest point of this owner within `cord` tiles of (x, y), or null. Ties go to the earlier point in list order.
function nearestPoint(points, owner, x, y, cord) {
  let best = null;
  let bestD = Infinity;
  for (const p of points) {
    if (p.owner !== owner) continue;
    const d = distance(p, { x, y });
    if (d <= cord && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

// Tiles strictly between a and b on a Bresenham line (the cord's path). Empty when a and b are the same tile.
function between(a, b) {
  const tiles = [];
  if (a.x === b.x && a.y === b.y) return tiles;
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (x === b.x && y === b.y) break;
    tiles.push([x, y]);
  }
  return tiles;
}

/**
 * The movement hook. Returns null when unit may step to (x, y), else the reason it may not:
 * 'down' (powered down), 'stuck' (its network is browned out), 'cord' (past the cord limit).
 * Battery units are free to move. Units without a power record (not seen yet) are free too.
 */
export function stepVerdict(state, unit, x, y) {
  const st = unit && unit.power;
  if (!state.power || !st) return null;
  if (st.state === 'down') return 'down';
  if (st.state !== 'plugged') return null;
  const view = state.power.view || refresh(state);
  const net = view.netOf.get(st.anchor);
  if (!net) return 'cord';
  if (!net.lit) return 'stuck';
  const reach = view.points.some((p) => p.owner === unit.owner && distance(p, { x, y }) <= cordOf(unit.kind));
  return reach ? null : 'cord';
}

/** The plug command: a Crumb next to a cut unit starts plugging it back in. Returns null or a reject reason. */
export function doPlug(state, player, c) {
  const w = unitById(state, c.unit);
  if (!w) return 'no-such-unit';
  if (w.owner !== player) return 'not-yours';
  if (w.kind !== 'worker') return 'wrong-kind';
  const t = unitById(state, c.target);
  if (!t) return 'bad-target';
  if (t.owner !== player) return 'not-yours';
  if (!t.power || (t.power.state !== 'battery' && t.power.state !== 'down')) return 'not-cut';
  if (distance(w, t) > 1) return 'too-far';
  state.power.plugging.set(w.id, { target: t.id, ticks: 0 });
  emit(state, { e: 'plug-start', id: w.id, target: t.id });
  return null;
}

/** The place-power command: an Extension Box or a Generator on a free tile, next to a plugged Crumb, inside the cord. */
export function doPlaceCord(state, player, c) {
  const w = unitById(state, c.unit);
  if (!w) return 'no-such-unit';
  if (w.owner !== player) return 'not-yours';
  if (w.kind !== 'worker') return 'wrong-kind';
  if (w.power && w.power.state !== 'plugged') return 'unplugged';
  if (!Number.isInteger(c.x) || !Number.isInteger(c.y)) return 'bad-command';
  if (!(c.kind in POWER.cost)) return 'bad-command';
  if (distance(w, c) > 1) return 'too-far';
  if (!isPassable(state, c.x, c.y) || !isFree(state, c.x, c.y)) return 'bad-target';
  const cost = POWER.cost[c.kind];
  if (state.shards[player] < cost) return 'no-shards';
  const range = POWER.range[c.kind];
  const linked = allPoints(state).some((p) => p.owner === player && distance(p, c) <= Math.max(p.range, range));
  if (!linked) return 'out-of-cord';

  state.shards[player] -= cost;
  emit(state, { e: 'spend', player, amount: cost, shards: state.shards[player] });
  const point = { id: allocId(state), owner: player, kind: c.kind, x: c.x, y: c.y, range };
  state.power.points.push(point);
  emit(state, { e: 'place-power', point: { ...point } });
  return null;
}

// One tick of the rules. Order: unit records and anchors, cuts, battery countdown, re-plugs, the reserve.
export function stepPower(state) {
  const P = state.power;
  if (!P) return;
  const view = refresh(state);
  const { points } = view;
  const ticks = state.tick;

  // 1. Each unit: a plugged unit keeps the nearest point in its cord (or drops to battery); batteries count down.
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    const st = u.power || (u.power = { state: 'plugged', anchor: null, battery: 0 });
    if (st.state === 'plugged') {
      const p = nearestPoint(points, u.owner, u.x, u.y, cordOf(u.kind));
      if (p) st.anchor = p.id;
      else {
        st.state = 'battery';
        st.anchor = null;
        st.battery = POWER.batteryTicks;
        emit(state, { e: 'power-battery', id: u.id });
      }
    } else if (st.state === 'battery') {
      st.battery -= 1;
      if (st.battery <= 0) {
        st.state = 'down';
        st.battery = 0;
        if (u.order) { u.order = null; emit(state, { e: 'order', id: u.id, order: null }); }
        emit(state, { e: 'power-down', id: u.id });
      }
    }
  }

  // 2. Cuts: an enemy standing on the line between a plugged unit and its anchor severs that cord.
  const onLine = new Map();
  for (const u of state.units) {
    if (u.hp <= 0 || !u.power || u.power.state !== 'plugged') continue;
    const anchor = points.find((p) => p.id === u.power.anchor);
    if (!anchor) continue;
    for (const [x, y] of between(u, anchor)) {
      const key = `${x},${y}`;
      if (!onLine.has(key)) onLine.set(key, []);
      onLine.get(key).push(u);
    }
  }
  for (const e of state.units) {
    if (e.hp <= 0) continue;
    for (const u of onLine.get(`${e.x},${e.y}`) || []) {
      if (u.owner === e.owner || u.power.state !== 'plugged') continue;
      u.power.state = 'battery';
      u.power.anchor = null;
      u.power.battery = POWER.batteryTicks;
      P.cuts.push({ id: u.id, x: e.x, y: e.y, tick: ticks });
      emit(state, { e: 'cord-cut', id: u.id, by: e.id, x: e.x, y: e.y });
    }
  }
  P.cuts = P.cuts.filter((c) => c.tick > ticks - POWER.sparkTicks);

  // 3. Re-plugs: a Crumb next to its cut unit for plugTicks plugs it into the nearest point in cord.
  for (const wid of [...P.plugging.keys()].sort((a, b) => a - b)) {
    const job = P.plugging.get(wid);
    const w = unitById(state, wid);
    const t = unitById(state, job.target);
    const valid = w && t && w.hp > 0 && t.hp > 0 && w.owner === t.owner && t.power
      && (t.power.state === 'battery' || t.power.state === 'down') && distance(w, t) <= 1;
    if (!valid) {
      P.plugging.delete(wid);
      emit(state, { e: 'plug-fail', id: wid, target: job.target });
      continue;
    }
    job.ticks += 1;
    if (job.ticks < POWER.plugTicks) continue;
    P.plugging.delete(wid);
    const p = nearestPoint(points, t.owner, t.x, t.y, cordOf(t.kind));
    if (!p) {
      emit(state, { e: 'plug-fail', id: wid, target: t.id });
      continue;
    }
    t.power = { state: 'plugged', anchor: p.id, battery: 0 };
    emit(state, { e: 'plugged', id: t.id, anchor: p.id });
  }

  // 4. Reserve: a side with no Crumbs and too few Shards to train one gets a free emergency Crumb at its Core.
  for (const side of [0, 1]) {
    if (P.reserveCd[side] > 0) P.reserveCd[side] -= 1;
    const core = state.structures.find((s) => s.kind === 'core' && s.owner === side && s.hp > 0);
    if (!core) continue;
    const crumbs = state.units.filter((u) => u.owner === side && u.kind === 'worker' && u.hp > 0).length;
    if (crumbs > 0 || state.shards[side] >= STATS.units.worker.cost || P.reserveCd[side] > 0) continue;
    const spot = freeTileNear(state, core);
    if (!spot) continue;
    const unit = {
      id: allocId(state), owner: side, kind: 'worker', x: spot.x, y: spot.y, hp: STATS.units.worker.hp,
      carrying: 0, order: null, power: { state: 'plugged', anchor: core.id, battery: 0 },
    };
    state.units.push(unit);
    state.units.sort((a, b) => a.id - b.id);
    P.reserveCd[side] = POWER.reserveCooldown;
    emit(state, { e: 'reserve-crumb', id: unit.id, owner: side });
  }
}

// Movement runs between the two rule steps, so the cord limit is enforced around it: snapshotPower records where
// every unit stands before movement; enforceCords sends any unit that ended a move somewhere its cord forbids back to
// its last legal tile and drops its order (cord-limit). Movement itself is untouched.
export function snapshotPower(state) {
  if (!state.power) return;
  state.power.before = new Map(state.units.map((u) => [u.id, { x: u.x, y: u.y }]));
}

export function enforceCords(state) {
  const before = state.power && state.power.before;
  if (!before) return;
  state.power.before = null;
  for (const u of state.units) {
    const was = before.get(u.id);
    if (!was || (was.x === u.x && was.y === u.y)) continue;
    const reason = stepVerdict(state, u, u.x, u.y);
    if (!reason) continue;
    if (isFree(state, was.x, was.y)) { u.x = was.x; u.y = was.y; }
    if (u.order) { u.order = null; emit(state, { e: 'order', id: u.id, order: null }); }
    emit(state, { e: 'cord-limit', id: u.id, reason });
  }
}

// The nearest free, passable tile next to a structure (rings 1 then 2), or null.
function freeTileNear(state, s) {
  for (let d = 1; d <= 2; d++) {
    for (let y = s.y - d; y <= s.y + d; y++) {
      for (let x = s.x - d; x <= s.x + d; x++) {
        if (Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) !== d) continue;
        if (isPassable(state, x, y) && isFree(state, x, y)) return { x, y };
      }
    }
  }
  return null;
}
