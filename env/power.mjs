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
import { newCord, cordMove } from './cord-wrap.mjs';

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
  state.power = { points: [], plugging: new Map(), cuts: [], reserveCd: [0, 0], view: null, fenceLinks: new Set() };
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

// Wrap mode (state.power.wrap, off by default): the cord bends round cliffs, rocks and water, and every bend costs
// length (env/cord-wrap.mjs). Returns the cordMove result for stepping to (x, y), or null when the unit has no anchor.
function wrapTrial(state, unit, view, x, y) {
  const st = unit.power;
  const anchor = view.points.find((p) => p.id === st.anchor);
  if (!anchor) return null;
  const cord = st.cord && st.cord.anchorId === anchor.id ? st.cord : { ...newCord(anchor), anchorId: anchor.id };
  const walls = enemyWallTiles(state, unit.owner);
  const blocked = (bx, by) => state.rockSet.has(`${bx},${by}`) || walls.has(`${bx},${by}`);
  const move = cordMove(cord, { x, y }, blocked, cordOf(unit.kind));
  if (move.ok) move.cord.anchorId = anchor.id;
  return move;
}

// Tiles an enemy's live fences wall off from this owner's cords (same walls fence.mjs stops ground units at).
// Cached on state.power and rebuilt when the stations, the fence orders or the rocks change.
function enemyWallTiles(state, owner) {
  const P = state.power;
  if (!P.fences) return EMPTY_TILES;
  const sig = stationsOf(state).map((q) => `${q.id}:${q.x},${q.y}`).join(';') + '|' + [...P.fenceLinks].join(';') + '|' + state.rockSet.size;
  if (!P.wallCache || P.wallCache.sig !== sig) {
    const graph = buildLines(state);
    const tiles = [new Set(), new Set()];
    for (const l of liveGroundLines(graph, state)) {
      for (const [x, y] of supercover(l.a, l.b)) tiles[l.owner].add(`${x},${y}`);
    }
    P.wallCache = { sig, tiles };
  }
  return P.wallCache.tiles[1 - owner];
}
const EMPTY_TILES = new Set();

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
  if (state.power.wrap) {
    const trial = wrapTrial(state, unit, view, x, y);
    if (trial) return trial.ok ? null : 'cord';
  }
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
      let p = nearestPoint(points, u.owner, u.x, u.y, cordOf(u.kind));
      // A wrapped cord keeps its anchor while the anchor stands, however far the bends have stretched it.
      if (P.wrap && st.cord && st.anchor === st.cord.anchorId) p = points.find((q) => q.id === st.anchor) || p;
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
    if (!reason) {
      if (state.power.wrap && u.power && u.power.state === 'plugged') {
        const trial = wrapTrial(state, u, state.power.view, u.x, u.y);
        if (trial && trial.ok) u.power.cord = trial.cord;
      }
      continue;
    }
    if (isFree(state, was.x, was.y)) { u.x = was.x; u.y = was.y; }
    if (u.order) { u.order = null; emit(state, { e: 'order', id: u.id, order: null }); }
    emit(state, { e: 'cord-limit', id: u.id, reason });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Power Stations and lines (POWER-NETWORK.md sections 3 and 5, build step 1). Opt-in on top of the cord rules above:
// buildLines() reads the same points but never changes how plugs or networks behave. Pure and deterministic.
//
// Every station has a link reach (how far its wire goes), a plug radius (units plug in), a line type and an energy
// flag. A link spans the SMALLER reach of its two ends. A Relay Pylon's long reach only works pylon to pylon; its
// links to anything else use the short reach. Any line with a pylon at an end is a high line (never blocks).

export const STATION = Object.freeze({
  strip: Object.freeze({ link: 10, plug: 14, line: 'ground', energy: true }),
  outlet: Object.freeze({ link: 10, plug: 10, line: 'ground', energy: false }),
  extension: Object.freeze({ link: 8, plug: 8, line: 'ground', energy: false }),
  pylon: Object.freeze({ link: 16, plug: 4, line: 'high', energy: false, shortLink: 8 }),
  generator: Object.freeze({ link: 6, plug: 0, line: 'ground', energy: true }),
  windmill: Object.freeze({ link: 6, plug: 0, line: 'ground', energy: true }),
  dam: Object.freeze({ link: 6, plug: 0, line: 'ground', energy: true }),
});

/** The spec of a station kind, or null. Unknown kinds are not stations. */
export const stationSpec = (kind) => STATION[kind] ?? null;

// Toaster-roster renames unit kinds; cord lengths are looked up through this so both names work.
const CORD_ALIAS = Object.freeze({ crumb: 'worker', popper: 'grunt', zapper: 'lancer', four_slice: 'brute', 'four-slice': 'brute' });
/** Cord length in tiles for a unit kind (engine kind or Toastinator name). */
export const cordLength = (kind) => POWER.cord[kind] ?? POWER.cord[CORD_ALIAS[kind]] ?? 8;

/** Every station of every side, id order. Strips come from Cores, outlets from complete claims. */
export function stationsOf(state) {
  const out = [];
  for (const s of state.structures) {
    if (s.kind === 'core' && s.hp > 0) out.push({ id: s.id, owner: s.owner, kind: 'strip', x: s.x, y: s.y });
  }
  for (const c of state.claims || []) {
    if (c.complete && c.hp > 0 && !c.dead) out.push({ id: c.id, owner: c.owner, kind: 'outlet', x: c.x, y: c.y });
  }
  for (const p of (state.power && state.power.points) || []) {
    if (STATION[p.kind] && !(p.hp <= 0)) out.push({ id: p.id, owner: p.owner, kind: p.kind, x: p.x, y: p.y });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Tiles on the straight line a to b, grid supercover (every tile the segment touches). Both ends included. */
export function supercover(a, b) {
  const tiles = [[a.x, a.y]];
  const nx = Math.abs(b.x - a.x), ny = Math.abs(b.y - a.y);
  const sx = b.x > a.x ? 1 : -1, sy = b.y > a.y ? 1 : -1;
  let x = a.x, y = a.y;
  for (let ix = 0, iy = 0; ix < nx || iy < ny;) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx; // which edge the segment crosses next
    if (decision === 0) { x += sx; y += sy; ix++; iy++; tiles.push([x - sx, y], [x, y - sy]); }
    else if (decision < 0) { x += sx; ix++; }
    else { y += sy; iy++; }
    tiles.push([x, y]);
  }
  return tiles;
}

/** True when a ground line a to b has line of sight: no rock, cliff or water tile on the supercover (ends excluded). */
export function lineOfSight(state, a, b) {
  for (const [x, y] of supercover(a, b)) {
    if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue;
    if (state.rockSet.has(`${x},${y}`)) return false;
  }
  return true;
}

/** Reach of a link between two stations, or 0 when their kinds may not link at all. */
export function linkReach(a, b) {
  const sa = STATION[a.kind], sb = STATION[b.kind];
  if (!sa || !sb) return 0;
  const pa = a.kind === 'pylon', pb = b.kind === 'pylon';
  const ra = pa && !pb ? sa.shortLink : sa.link;
  const rb = pb && !pa ? sb.shortLink : sb.link;
  return Math.min(ra, rb);
}

const lineKind = (a, b) => (STATION[a.kind].line === 'high' || STATION[b.kind].line === 'high' ? 'high' : 'ground');

// Do segments p1p2 and p3p4 properly cross (integer tile centres; touching at a shared end does not count)?
const orient = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
export function segmentsCross(p1, p2, p3, p4) {
  const same = (p, q) => p.x === q.x && p.y === q.y;
  if (same(p1, p3) || same(p1, p4) || same(p2, p3) || same(p2, p4)) return false;
  const d1 = orient(p1, p2, p3), d2 = orient(p1, p2, p4), d3 = orient(p3, p4, p1), d4 = orient(p3, p4, p2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** How many nearest stations each station links to (POWER-NETWORK.md section 11, item 1). */
export const LINK_NEAREST = 3;

/**
 * The power graph of every side. Each station picks the nearest LINK_NEAREST own stations in reach (ties by id) that it
 * can legally link to (kind rules, and line of sight for ground links); a link exists when either end picks it, so
 * cycles are fine. Power links never block anything: only a fence (env/fence.mjs, an explicit order) is a wall.
 * Returns { stations, lines: [{a, b, owner, type}], lit: Set of station ids on a lit network }. A network is lit when
 * it holds a Strip or an energy station (generator, windmill, dam); brown-out is per network, so it is local.
 */
export function buildLines(state) {
  const stations = stationsOf(state);
  const byId = new Map(stations.map((s) => [s.id, s]));
  const neighbours = new Map(stations.map((s) => [s.id, new Set()]));
  const lines = [];
  for (const s of stations) {
    const near = [];
    for (const q of stations) {
      if (q.owner !== s.owner || q.id === s.id) continue;
      const d = distance(s, q);
      if (d > 0 && d <= linkReach(s, q) && (lineKind(s, q) === 'high' || lineOfSight(state, s, q))) near.push({ q, d });
    }
    near.sort((u, v) => u.d - v.d || u.q.id - v.q.id);
    for (const { q } of near.slice(0, LINK_NEAREST)) {
      if (neighbours.get(s.id).has(q.id)) continue;
      neighbours.get(s.id).add(q.id);
      neighbours.get(q.id).add(s.id);
      const [a, b] = s.id < q.id ? [s, q] : [q, s];
      lines.push({ a: { id: a.id, x: a.x, y: a.y }, b: { id: b.id, x: b.x, y: b.y }, owner: s.owner, type: lineKind(s, q) });
    }
  }
  lines.sort((u, v) => u.a.id - v.a.id || u.b.id - v.b.id);
  const lit = new Set();
  const seen = new Set();
  for (const s of stations) {
    if (seen.has(s.id)) continue;
    const members = [s];
    seen.add(s.id);
    for (let k = 0; k < members.length; k++) {
      for (const n of neighbours.get(members[k].id)) {
        if (!seen.has(n)) { seen.add(n); members.push(byId.get(n)); }
      }
    }
    if (members.some((m) => STATION[m.kind].energy)) for (const m of members) lit.add(m.id);
  }
  return { stations, lines, lit };
}

/** The key of a link between two station ids, smaller id first. */
export const lineKey = (idA, idB) => (idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`);

/**
 * Fences that stand right now: ground links a player activated (state.power.fenceLinks, a Set of lineKey) whose network
 * is lit. A fence on a dark network (brown-out) is passable, so it is not listed.
 */
export function liveGroundLines(graph, state) {
  const on = state && state.power && state.power.fenceLinks;
  return graph.lines.filter((l) => l.type === 'ground' && on && on.has(lineKey(l.a.id, l.b.id)) && graph.lit.has(l.a.id));
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
