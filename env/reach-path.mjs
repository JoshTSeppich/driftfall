// Coarse Reach routing for the 128 x 128 map (TERRITORY.md section 2, "Performance").
// A plain breadth-first search floods up to 16 384 tiles for every path; with 200 units that is too slow for a 24 tick
// second. Here the question is asked in two steps: first which Reaches and gates to pass through (a tiny graph of about
// 30 gates), then an A* search on tiles that may only use those Reaches and gates. The caller's blocked(x, y) still
// decides every tile, so buildings, rubble and units are honoured. If the corridor search fails (a gate is plugged),
// the plain search runs, so an answer exists whenever one did before.
//
//   const router = createReachRouter(map);          // map: generateMap(seed, { map: 'v4' }) or loadMapV4()
//   findPathVia(grid, router, from, to, { within }) // same contract as findPath in env/path.mjs
import { findPath } from './path.mjs';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function createReachRouter(map) {
  const { width, height, reachGrid, gates, reaches } = map;
  const GATE_BASE = map.gateBase ?? 32; // Large and Huge start their gate ids higher (maps/layout-sizes.mjs)
  const gateById = new Map(gates.map((g) => [g.id, g]));
  const reachById = new Map(reaches.map((r) => [r.id, r]));
  const regionAt = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : reachGrid[y * width + x]);
  const manhattan = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

  // Gate graph: two gates are linked when they open into the same Reach; cost is the distance between their centres.
  const links = new Map(gates.map((g) => [g.id, []]));
  for (const r of reaches) {
    for (const a of r.gates) for (const b of r.gates) {
      if (a !== b) links.get(a).push({ to: b, via: r.id, cost: manhattan(gateById.get(a).center, gateById.get(b).center) });
    }
  }
  // Open nodes for a tile: the gates of its Reach (cost = distance to each), or the gate itself when standing in one.
  const nodesFor = (x, y) => {
    const id = regionAt(x, y);
    if (id >= GATE_BASE) return gateById.has(id) ? [{ gate: id, cost: 0 }] : null;
    const r = reachById.get(id);
    return r ? r.gates.map((g) => ({ gate: g, cost: manhattan([x, y], gateById.get(g).center) })) : null;
  };

  /** Allowed-region mask for a trip, or null when there is no route (the caller then uses the plain search). */
  function corridor(from, to) {
    const a = regionAt(from.x, from.y), b = regionAt(to.x, to.y);
    const allowed = new Uint8Array(GATE_BASE + gates.length + 1);
    if (a === 0 || b === 0) return null;
    if (a === b) { allowed[a] = 1; return allowed; }
    const starts = nodesFor(from.x, from.y), goals = nodesFor(to.x, to.y);
    if (!starts || !goals) return null;
    // Dijkstra over about 30 gates; O(n^2) selection keeps it deterministic and allocation-free.
    const dist = new Map(), prev = new Map(), done = new Set();
    for (const s of starts) { dist.set(s.gate, s.cost); prev.set(s.gate, null); }
    const goalCost = new Map(goals.map((g) => [g.gate, g.cost]));
    let best = Infinity, bestGate = null;
    for (;;) {
      let cur = null, cd = Infinity;
      for (const [g, d] of dist) if (!done.has(g) && (d < cd || (d === cd && g < cur))) { cur = g; cd = d; }
      if (cur === null || cd >= best) break;
      done.add(cur);
      if (goalCost.has(cur) && cd + goalCost.get(cur) < best) { best = cd + goalCost.get(cur); bestGate = cur; }
      for (const l of links.get(cur)) {
        const nd = cd + l.cost;
        if (!dist.has(l.to) || nd < dist.get(l.to)) { dist.set(l.to, nd); prev.set(l.to, { gate: cur, via: l.via }); }
      }
    }
    if (bestGate === null) return null;
    allowed[a] = 1;
    allowed[b] = 1;
    for (let g = bestGate; g !== null;) {
      allowed[g] = 1;
      const p = prev.get(g);
      if (p) allowed[p.via] = 1;
      g = p ? p.gate : null;
    }
    return allowed;
  }

  return { width, height, regionAt, corridor, gates, reaches, work: { stamp: 0, seen: new Uint32Array(width * height), g: new Int32Array(width * height), prev: new Int32Array(width * height) } };
}

// A* on tiles inside the corridor. 4-way unit steps, consistent heuristic, so it is as short as a plain search
// restricted to the same tiles. Bucket queue by f; the neighbour order and FIFO buckets keep it deterministic.
function corridorSearch(router, grid, from, to, within, allowed) {
  const { width, height } = router;
  const w = router.work;
  const stamp = ++w.stamp;
  const h = (x, y) => Math.max(0, Math.abs(x - to.x) - within) + Math.max(0, Math.abs(y - to.y) - within);
  const start = from.y * width + from.x;
  w.seen[start] = stamp;
  w.g[start] = 0;
  w.prev[start] = -1;
  const buckets = [];
  const push = (f, i) => { (buckets[f] || (buckets[f] = [])).push(i); };
  push(h(from.x, from.y), start);
  const reg = router.regionAt;
  for (let f = 0; f < buckets.length; f++) {
    const bucket = buckets[f];
    if (!bucket) continue;
    for (let k = 0; k < bucket.length; k++) {
      const cur = bucket[k];
      const cx = cur % width, cy = (cur - cx) / width;
      const g = w.g[cur];
      if (g + h(cx, cy) !== f) continue; // stale entry: a shorter way to this tile was found later
      if (Math.max(Math.abs(cx - to.x), Math.abs(cy - to.y)) <= within) {
        const path = [];
        for (let i = cur; i !== start; i = w.prev[i]) path.push({ x: i % width, y: Math.floor(i / width) });
        return path.reverse();
      }
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        const ng = g + 1;
        if (w.seen[n] === stamp && w.g[n] <= ng) continue;
        if (!allowed[reg(nx, ny)] || grid.blocked(nx, ny)) continue;
        w.seen[n] = stamp;
        w.g[n] = ng;
        w.prev[n] = cur;
        push(ng + h(nx, ny), n);
      }
    }
  }
  return null;
}

/**
 * Same answer shape as findPath(grid, from, to, { within }): the steps after `from`, [] when already there, null when
 * unreachable. Falls back to the plain search when the corridor is plugged or the tiles lie outside every Reach.
 */
export function findPathVia(grid, router, from, to, { within = 0 } = {}) {
  if (grid.width !== router.width || grid.height !== router.height) return findPath(grid, from, to, { within });
  if (Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) <= within) return [];
  const allowed = router.corridor(from, to);
  if (allowed) {
    const path = corridorSearch(router, grid, from, to, within, allowed);
    if (path) return path;
  }
  return findPath(grid, from, to, { within });
}
