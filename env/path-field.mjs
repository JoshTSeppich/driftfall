// Cached goal distance fields: the same answers as findPath in env/path.mjs, much cheaper when units share a goal.
//
// findPath is a breadth-first search from the unit with neighbours tried up, right, down, left. Its path is therefore the
// shortest route whose sequence of directions is smallest (up < right < down < left): the queue order is the order of
// those direction strings, and each tile keeps the earliest parent. Given D(x) = steps from tile x to the nearest goal
// tile, that route is a greedy walk: from each tile take the first direction whose neighbour has D one lower.
//
// D comes from a multi-source search out of the goal tiles. It is built only as far as the asking unit needs, kept, and
// continued when a farther unit asks, so every unit and every tick that heads for the same goal shares the work. The
// cache belongs to one match and is dropped whenever the blocked tiles change.

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const UNSEEN = 65535;
const MAX_FIELDS = 32;

/** A cache bound to one match. */
export function createFieldCache() {
  return { solid: null, solidRef: null, fields: new Map() };
}

function newField(width, height, blocked, to, within) {
  const size = width * height;
  const f = { width, height, blocked, dist: new Uint16Array(size).fill(UNSEEN), queue: new Int32Array(size), head: 0, tail: 0 };
  const x0 = Math.max(0, to.x - within), x1 = Math.min(width - 1, to.x + within);
  const y0 = Math.max(0, to.y - within), y1 = Math.min(height - 1, to.y + within);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (blocked(x, y)) continue;
      f.dist[y * width + x] = 0;
      f.queue[f.tail++] = y * width + x;
    }
  }
  return f;
}

// Advance the search by one tile. False when it has nothing left to expand.
function expandOne(f) {
  if (f.head >= f.tail) return false;
  const { width, height, dist, queue, blocked } = f;
  const cur = queue[f.head++];
  const cx = cur % width;
  const cy = (cur - cx) / width;
  const nd = dist[cur] + 1;
  for (let d = 0; d < 4; d++) {
    const nx = cx + DX[d];
    const ny = cy + DY[d];
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const n = ny * width + nx;
    if (dist[n] !== UNSEEN || blocked(nx, ny)) continue;
    dist[n] = nd;
    queue[f.tail++] = n;
  }
  return true;
}

// Smallest D among the tile's neighbours that is already known, or UNSEEN.
function nearest(f, x, y) {
  let best = UNSEEN;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d];
    const ny = y + DY[d];
    if (nx < 0 || ny < 0 || nx >= f.width || ny >= f.height) continue;
    const v = f.dist[ny * f.width + nx];
    if (v < best) best = v;
  }
  return best;
}

/**
 * findPath(grid, from, to, { within }) with identical results. `solid` is the Uint8Array behind grid.blocked; the cache
 * is emptied whenever its bytes change. `wallsId` names any extra per-unit walls in grid.blocked (0 for none): equal ids
 * must mean equal walls.
 */
export function findPathCached(cache, solid, wallsId, grid, from, to, within = 0) {
  const { width, height, blocked } = grid;
  if (from.x < 0 || from.y < 0 || from.x >= width || from.y >= height) return null;
  if (Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) <= within) return [];

  if (cache.solidRef !== solid) {
    cache.solidRef = solid;
    if (!cache.solid || cache.solid.length !== solid.length || Buffer.compare(cache.solid, solid) !== 0) {
      cache.solid = solid.slice();
      cache.fields.clear();
    }
  }
  const key = `${to.x},${to.y},${within},${wallsId}`;
  let f = cache.fields.get(key);
  if (f) {
    cache.fields.delete(key); // refresh recency
  } else {
    f = newField(width, height, blocked, to, within);
    if (cache.fields.size >= MAX_FIELDS) cache.fields.delete(cache.fields.keys().next().value);
  }
  cache.fields.set(key, f);
  f.blocked = blocked; // equal walls ids mean equal walls; keep the closure current

  // Search until every tile at least as near the goal as the unit's best neighbour is known.
  let best = nearest(f, from.x, from.y);
  while (best === UNSEEN ? f.head < f.tail : f.head < f.tail && f.dist[f.queue[f.head]] < best) {
    expandOne(f);
    if (best === UNSEEN) best = nearest(f, from.x, from.y);
  }
  if (best === UNSEEN) return null;

  const path = [];
  let cx = from.x, cy = from.y, want = best;
  for (;;) {
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || f.dist[ny * width + nx] !== want) continue;
      cx = nx;
      cy = ny;
      break;
    }
    path.push({ x: cx, y: cy });
    if (want === 0) return path;
    want--;
  }
}
