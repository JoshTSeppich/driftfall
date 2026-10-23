// Track laying by click-drag (TERRITORY.md section 8). Pure: a drag becomes a path of tiles, each tile green (can place)
// or red (blocked), and releasing on an all-green path returns the lay-track command. Owner: haiku (Classic play UI).
// The app decides what canPlace means (rock, Reach, Drift, the money check is ours here).

export const TRACK_COST = 5; // Shards a tile (TERRITORY.md section 8)

/**
 * The tiles from a to b, both included: an L with the across leg first, or down first when the across leg is blocked
 * and the other is clear. A tile is a [x, y] pair.
 */
export function trackPath(a, b, canPlace = () => true) {
  const across = lPath(a, b, true);
  const down = lPath(a, b, false);
  const clear = (p) => p.every(([x, y]) => canPlace(x, y));
  if (!clear(across) && clear(down)) return down;
  return across;
}

function lPath(a, b, acrossFirst) {
  const corner = acrossFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [...straight(a, corner), ...straight(corner, b).slice(1)];
}

// One straight leg (horizontal or vertical), both ends included.
function straight(p, q) {
  const dx = Math.sign(q.x - p.x);
  const dy = Math.sign(q.y - p.y);
  const out = [[p.x, p.y]];
  let { x, y } = p;
  while (x !== q.x || y !== q.y) {
    if (x !== q.x) x += dx;
    else y += dy;
    out.push([x, y]);
  }
  return out;
}

/**
 * The preview for a path: each tile { x, y, ok }, the total cost, and ok (all tiles placeable, money enough, at least
 * two tiles). reason is the first thing wrong: 'short', 'blocked' or 'cost', or null when ok.
 */
export function trackPreview(path, canPlace = () => true, { money = Infinity, costPerTile = TRACK_COST } = {}) {
  const tiles = path.map(([x, y]) => ({ x, y, ok: !!canPlace(x, y) }));
  const cost = path.length * costPerTile;
  let reason = null;
  if (path.length < 2) reason = 'short';
  else if (tiles.some((t) => !t.ok)) reason = 'blocked';
  else if (cost > money) reason = 'cost';
  return { path, tiles, cost, ok: reason === null, reason };
}

/**
 * The drag: start(tile) on mouse down, move(tile) while held (returns the preview), end() on release (returns the
 * lay-track command when the preview is green, else null), cancel() to drop it.
 */
export function createTrackDrag({ canPlace = () => true, money = Infinity, costPerTile = TRACK_COST } = {}) {
  let from = null;
  let last = null;
  const reset = () => { from = null; last = null; };
  return {
    active: () => from !== null,
    preview: () => last,
    start(tile) { from = { x: tile.x, y: tile.y }; last = null; },
    move(tile) {
      if (!from) return null;
      const path = trackPath(from, tile, canPlace);
      last = trackPreview(path, canPlace, { money, costPerTile });
      return last;
    },
    end() {
      const p = last;
      reset();
      return p && p.ok ? { type: 'lay-track', path: p.path.map(([x, y]) => [x, y]) } : null;
    },
    cancel: reset,
  };
}
