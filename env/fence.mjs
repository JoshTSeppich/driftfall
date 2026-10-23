// Fences: live ground fences wall off enemy ground units, and closed loops fence land
// (POWER-NETWORK.md sections 5-7 as amended by section 11, build steps 2 and 4). Owner: sonnet.
// Pure and deterministic: no clock, no randomness. Opt-in: nothing runs unless state.power.fences is true.
//
// A fence is an explicit order (setFence) that turns one ground power link into a wall made of its supercover tiles
// (4-connected, both sides at a corner), so a 4-direction mover can never slip through a diagonal gap. Your own units,
// air units and high lines pass freely. A fence on a dark network (brown-out) is passable. Everything is recomputed from
// the stations once per tick (stepFences); stepMovement reads the cache, so a new fence or a brown-out repaths units.
//
// Enclosure (every ENCLOSURE_EVERY ticks): flood from the enemy's stations over tiles your fences do not block; tiles of
// a bounded pocket (<= ENCLOSURE_CAP tiles, shut by >= 3 of your stations) that the flood cannot reach and that touch your
// fence are a candidate. A candidate must stay shut and free of enemy ground units for ENCLOSURE_HOLD ticks (6 s) before
// it counts: it is contestable. Fenced land is your territory: enemies cannot place stations in it and wheat in it gives
// ENCLOSURE_WHEAT. Softlock rule (relaxed): a fence that would cut an enemy off from every neutral Reach it could
// reach before is refused. Real encirclement of a base is allowed.

import { buildLines, liveGroundLines, stationsOf, supercover, segmentsCross, lineKey, STATION } from './power.mjs';
import { isPassable, isFree, emit } from './state.mjs';

export const ENCLOSURE_EVERY = 48;
export const ENCLOSURE_HOLD = 144; // 6 s at 24 ticks per second
export const ENCLOSURE_CAP = 400;
export const ENCLOSURE_WHEAT = 1.15;
export const FENCE_UPKEEP_TILES = 8; // 1 energy per this many fence tiles

const key = (x, y) => `${x},${y}`;
const FLYERS = new Set(['bagel']);
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Turn the fence rules on for a state that already has power. Returns true when it turned on. */
export function enableFences(state) {
  if (!state.power) return false;
  state.power.fences = true;
  if (!state.power.fenceLinks) state.power.fenceLinks = new Set();
  return true;
}

// The cache: graph, live fences and their tiles. Rebuilt whenever the stations, the fence orders or the rocks change.
function snapshot(state) {
  const P = state.power;
  const sig = stationsOf(state).map((q) => `${q.id}:${q.x},${q.y}`).join(';') + '|' + [...P.fenceLinks].join(';') + '|' + state.rockSet.size;
  if (P.fenceCache && P.fenceCache.sig === sig) return P.fenceCache;
  const graph = buildLines(state);
  const live = liveGroundLines(graph, state);
  const tiles = [new Set(), new Set()];
  const stationsOnWall = [new Set(), new Set()];
  for (const l of live) {
    for (const [x, y] of supercover(l.a, l.b)) tiles[l.owner].add(key(x, y));
    stationsOnWall[l.owner].add(l.a.id).add(l.b.id);
  }
  P.fenceCache = { sig, graph, live, tiles, stationsOnWall };
  return P.fenceCache;
}

/** { tiles: [Set side 0, Set side 1], graph, live } of the live fences right now. */
export function fenceTiles(state) {
  if (!state.power) return { tiles: [new Set(), new Set()], graph: null, live: [] };
  return snapshot(state);
}

/** Energy per tick-second the live fences of a side cost: 1 per FENCE_UPKEEP_TILES wall tiles, rounded up. */
export function fenceUpkeep(state, player) {
  return Math.ceil(fenceTiles(state).tiles[player].size / FENCE_UPKEEP_TILES);
}

/**
 * The movement hook. Returns null when no fence rules apply (the common case), else a function
 * `(unit) => ((x, y) => boolean) | null` giving the tiles this unit may not enter.
 */
export function fenceBlocker(state) {
  if (!state.power || !state.power.fences) return null;
  const { tiles } = snapshot(state);
  if (tiles[0].size + tiles[1].size === 0) return null;
  return (unit) => {
    if (FLYERS.has(unit.kind)) return null;
    const enemy = tiles[1 - unit.owner];
    if (!enemy || enemy.size === 0) return null;
    return (x, y) => enemy.has(key(x, y));
  };
}

/** True when this unit may not stand on (x, y) because of an enemy fence. For tests and the UI. */
export function fenceBlocks(state, unit, x, y) {
  const f = fenceBlocker(state);
  const blocked = f && f(unit);
  return Boolean(blocked && blocked(x, y));
}

// Terrain a 4-direction mover cannot enter: off the map, rock, cliff and water (all rocks in this engine).
const solid = (state, x, y) => x < 0 || y < 0 || x >= state.width || y >= state.height || state.rockSet.has(key(x, y));

// Flood fill over open ground from `seeds`, never entering `wall` tiles. Returns the Set of reached tile keys.
function flood(state, seeds, wall) {
  const reached = new Set();
  const queue = [];
  for (const [x, y] of seeds) {
    const k = key(x, y);
    if (!solid(state, x, y) && !reached.has(k)) { reached.add(k); queue.push([x, y]); }
  }
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (reached.has(k) || solid(state, nx, ny) || (wall && wall.has(k))) continue;
      reached.add(k);
      queue.push([nx, ny]);
    }
  }
  return reached;
}

// Neutral Reach spots a side could expand to: territory reaches nobody holds. Empty when the match has no territory.
function neutralSpots(state) {
  const t = state.territory;
  if (!t || !t.map) return [];
  const out = [];
  t.map.reaches.forEach((r, i) => {
    const spot = r.claimSpot || r.centre;
    if (spot && t.reaches[i] && t.reaches[i].holder === null) out.push([Math.round(spot.x), Math.round(spot.y)]);
  });
  return out;
}

const stripOf = (state, player) => state.structures.find((s) => s.kind === 'core' && s.owner === player && s.hp > 0);

// Can `player` still walk from their Strip to some neutral Reach with `wall` (the other side's fence tiles) in the way?
function hasOpenRoute(state, player, wall) {
  const strip = stripOf(state, player);
  const spots = neutralSpots(state);
  if (!strip || spots.length === 0) return true;
  const reached = flood(state, [[strip.x, strip.y]], wall);
  return spots.some(([x, y]) => reached.has(key(x, y)));
}

/**
 * The fence order: turn the ground power link idA-idB of `player` into a fence (on) or take it down (off).
 * Returns null on success, else a reason: 'no-power', 'no-such-link', 'not-yours', 'high-line' (high lines never block),
 * 'crosses-enemy-fence', 'cuts-off-enemy' (it would leave the enemy no route to any neutral Reach it had before).
 */
export function setFence(state, player, idA, idB, on = true) {
  const P = state.power;
  if (!P || !P.fences) return 'no-power';
  const k = lineKey(idA, idB);
  const graph = snapshot(state).graph;
  const link = graph.lines.find((l) => lineKey(l.a.id, l.b.id) === k);
  if (!link) return 'no-such-link';
  if (link.owner !== player) return 'not-yours';
  if (link.type !== 'ground') return 'high-line';
  if (!on) {
    P.fenceLinks.delete(k);
    return null;
  }
  const mine = new Set(supercover(link.a, link.b).map(([x, y]) => key(x, y)));
  const enemyLive = snapshot(state).live.filter((l) => l.owner !== player);
  for (const l of enemyLive) {
    if (segmentsCross(l.a, l.b, link.a, link.b) || supercover(l.a, l.b).some(([x, y]) => mine.has(key(x, y)))) return 'crosses-enemy-fence';
  }
  const wall = new Set([...snapshot(state).tiles[player], ...mine]);
  const before = hasOpenRoute(state, 1 - player, snapshot(state).tiles[player]);
  if (before && !hasOpenRoute(state, 1 - player, wall)) return 'cuts-off-enemy';
  P.fenceLinks.add(k);
  return null;
}

/** Placement check for a new station on tile (x, y): null when allowed, else the reason. */
export function placementVerdict(state, player, kind, x, y) {
  if (!STATION[kind]) return 'bad-kind';
  if (!Number.isInteger(x) || !Number.isInteger(y) || !isPassable(state, x, y) || !isFree(state, x, y)) return 'bad-target';
  const fenced = state.power && state.power.enclosure && state.power.enclosure.fenced;
  if (fenced && fenced[1 - player].has(key(x, y))) return 'enemy-fence';
  return null;
}

/** Wheat harvest multiplier on tile (x, y) for a side: ENCLOSURE_WHEAT inside its fenced land, else 1. */
export function fencedBonus(state, player, x, y) {
  const e = state.power && state.power.enclosure;
  return e && e.fenced[player].has(key(x, y)) ? ENCLOSURE_WHEAT : 1;
}

/** The fenced tile keys of a side right now (a Set), for the HUD and render. */
export function fencedTiles(state, player) {
  const e = state.power && state.power.enclosure;
  return e ? e.fenced[player] : new Set();
}

// Candidate pockets for one side: unreached pockets of open ground that touch its fence. Returns [{ key, tiles }].
function candidates(state, player, snap) {
  const wall = snap.tiles[player];
  if (wall.size === 0) return [];
  const seeds = [];
  for (const s of snap.graph.stations) if (s.owner !== player) seeds.push([s.x, s.y]);
  const reached = flood(state, seeds, wall);
  const seen = new Set();
  const out = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const k = key(x, y);
      if (seen.has(k) || reached.has(k) || wall.has(k) || solid(state, x, y)) continue;
      const tiles = [[x, y]];
      seen.add(k);
      let touches = false;
      for (let i = 0; i < tiles.length; i++) {
        for (const [dx, dy] of DIRS) {
          const nx = tiles[i][0] + dx, ny = tiles[i][1] + dy, nk = key(nx, ny);
          if (wall.has(nk)) { touches = true; continue; }
          if (seen.has(nk) || reached.has(nk) || solid(state, nx, ny)) continue;
          seen.add(nk);
          tiles.push([nx, ny]);
        }
      }
      if (!touches || tiles.length > ENCLOSURE_CAP) continue;
      const near = new Set(tiles.map(([tx, ty]) => key(tx, ty)));
      // Posts of the loop: your stations on the fence within two tiles of the pocket (the wall itself is a tile thick).
      const posts = snap.graph.stations.filter((s) => s.owner === player && snap.stationsOnWall[player].has(s.id)
        && [-2, -1, 0, 1, 2].some((dy) => [-2, -1, 0, 1, 2].some((dx) => near.has(key(s.x + dx, s.y + dy)))));
      if (posts.length < 3) continue;
      out.push({ key: `${x},${y}#${tiles.length}`, tiles: near });
    }
  }
  return out;
}

/**
 * One tick of the fence rules. Emits fence-up / fence-down when a live fence appears or drops (brown-out, a dead
 * station), and every ENCLOSURE_EVERY ticks runs the enclosure flood fill. Safe to call every tick.
 */
export function stepFences(state) {
  const P = state.power;
  if (!P || !P.fences) return;
  const snap = snapshot(state);
  const stats = P.fenceStats || (P.fenceStats = [{ built: 0, dropped: 0, enclosed: 0, lost: 0 }, { built: 0, dropped: 0, enclosed: 0, lost: 0 }]);
  const liveNow = [new Set(), new Set()];
  for (const l of snap.live) liveNow[l.owner].add(lineKey(l.a.id, l.b.id));
  const was = P.fenceLive || [new Set(), new Set()];
  for (const p of [0, 1]) {
    for (const k of [...liveNow[p]].sort()) if (!was[p].has(k)) { stats[p].built += 1; emit(state, { e: 'fence-up', player: p, link: k }); }
    for (const k of [...was[p]].sort()) if (!liveNow[p].has(k)) { stats[p].dropped += 1; emit(state, { e: 'fence-down', player: p, link: k }); }
  }
  P.fenceLive = liveNow;

  const enc = P.enclosure || (P.enclosure = { fenced: [new Set(), new Set()], pending: [new Map(), new Map()] });
  if (state.tick % ENCLOSURE_EVERY !== 0) return;
  for (const p of [0, 1]) {
    const pending = new Map();
    const fenced = new Set();
    for (const c of candidates(state, p, snap)) {
      const contested = state.units.some((u) => u.hp > 0 && u.owner !== p && !FLYERS.has(u.kind) && c.tiles.has(key(u.x, u.y)));
      const held = contested ? 0 : (enc.pending[p].get(c.key) || 0) + ENCLOSURE_EVERY;
      pending.set(c.key, held);
      if (held >= ENCLOSURE_HOLD) for (const t of c.tiles) fenced.add(t);
    }
    if (fenced.size > 0 && enc.fenced[p].size === 0) { stats[p].enclosed += 1; emit(state, { e: 'enclosed', player: p, tiles: fenced.size }); }
    if (fenced.size === 0 && enc.fenced[p].size > 0) { stats[p].lost += 1; emit(state, { e: 'enclosure-lost', player: p }); }
    enc.pending[p] = pending;
    enc.fenced[p] = fenced;
  }
}
