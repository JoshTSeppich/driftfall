// Cord wrap-point list (POWER-NETWORK.md section 4, build step 3). Owner: sonnet. Pure and deterministic.
//
// A unit's cord is a list of points: the anchor (its station), then the corners it bends around, then the unit (the
// "tip", not stored). Corners are tile corners (half-tile coordinates), so they are exact in floating point.
//   wrap:   when the straight line from the last point to the tip would cut through a blocked tile, bend the cord round
//           the nearest usable corner of the tile it hits, and repeat until every segment is clear;
//   unwrap: when the tip swings back across a corner (the cross product of the segment into the corner and the segment
//           out of it flips sign), that corner is dropped; a final pull drops any corner the cord no longer needs;
//   length: the sum of the segment lengths (Chebyshev, like every other distance here, so a straight cord costs exactly
//           what the plain cord leash costs). Moves stop when the length would exceed the cord.
// blocked(x, y) says which tiles the cord cannot pass through (cliffs, rocks, water, enemy walls).

const EPS = 1e-9;
export const MAX_BENDS = 3; // POWER-NETWORK.md section 11: at most 3 wrap points per cord
const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const euclid = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** A taut cord with no bends, anchored at (x, y). */
export const newCord = (anchor) => ({ pts: [{ x: anchor.x, y: anchor.y, side: 0 }] });

// The first blocked tile the open segment p to q passes through, as { x, y, t }, or null. Touching only a tile's edge or
// corner does not count, so the cord can hug a cliff corner.
export function segmentBlockedBy(p, q, blocked) {
  const x0 = Math.round(Math.min(p.x, q.x)) - 1, x1 = Math.round(Math.max(p.x, q.x)) + 1;
  const y0 = Math.round(Math.min(p.y, q.y)) - 1, y1 = Math.round(Math.max(p.y, q.y)) + 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  let best = null;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!blocked(x, y)) continue;
      let t0 = 0, t1 = 1, hit = true;
      for (const [o, d, c] of [[p.x, dx, x], [p.y, dy, y]]) {
        const lo = c - 0.5, hi = c + 0.5;
        if (Math.abs(d) < EPS) {
          if (!(o > lo + EPS && o < hi - EPS)) { hit = false; break; }
        } else {
          let a = (lo - o) / d, b = (hi - o) / d;
          if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, b);
        }
      }
      if (hit && t1 - t0 > EPS && (!best || t0 < best.t - EPS)) best = { x, y, t: t0 };
    }
  }
  return best;
}

// The corner the cord should bend round for the blocked segment a to b. The obstacle is the connected cluster of blocked
// tiles around the tile hit; on each side of the segment take its farthest corner that touches free space (skipping
// corners the cord already holds), then keep the side with the shorter detour. Concave clusters just take another pass.
function bendCorner(a, b, hit, blocked, held) {
  const seen = new Set([hit.x + ',' + hit.y]);
  const queue = [[hit.x, hit.y]];
  for (let i = 0; i < queue.length && queue.length < 400; i++) {
    const [x, y] = queue[i];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = (x + dx) + ',' + (y + dy);
        if ((dx || dy) && !seen.has(k) && blocked(x + dx, y + dy)) { seen.add(k); queue.push([x + dx, y + dy]); }
      }
    }
  }
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const best = { '-1': null, 1: null };
  for (const [x, y] of queue) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (blocked(x, y + sy) && blocked(x + sx, y) && blocked(x + sx, y + sy)) continue; // inside the cluster
      const c = { x: x + sx * 0.5, y: y + sy * 0.5 };
      if (held.some((p) => p.x === c.x && p.y === c.y)) continue;
      const d = ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / len;
      if (Math.abs(d) < EPS) continue;
      const side = Math.sign(d);
      const cur = best[side];
      if (!cur || Math.abs(d) > Math.abs(cur.d) + EPS || (Math.abs(d) > Math.abs(cur.d) - EPS && (c.y < cur.c.y || (c.y === cur.c.y && c.x < cur.c.x)))) best[side] = { c, d };
    }
  }
  let pick = null;
  for (const side of [1, -1]) {
    const o = best[side];
    if (!o) continue;
    const detour = euclid(a, o.c) + euclid(o.c, b);
    if (!pick || detour < pick.detour - EPS) pick = { c: o.c, detour };
  }
  return pick && pick.c;
}

const withTip = (pts, tip) => [...pts, tip];
const sides = (pts, tip) => {
  const all = withTip(pts, tip);
  for (let i = 1; i < pts.length; i++) pts[i].side = Math.sign(cross(all[i - 1], all[i], all[i + 1]));
};

// Drop every corner whose neighbours already see each other (a taut cord keeps only the corners it needs).
function pull(pts, tip, blocked) {
  for (let i = pts.length - 1; i >= 1; i--) {
    const next = i + 1 < pts.length ? pts[i + 1] : tip;
    if (!segmentBlockedBy(pts[i - 1], next, blocked)) pts.splice(i, 1);
  }
}

/** The cord after the tip moved to `tip`. Returns a new cord; the old one is untouched. */
export function updateCord(cord, tip, blocked) {
  const pts = cord.pts.map((p) => ({ ...p }));
  // Unwrap: the tip swung back across the last corner.
  while (pts.length > 1) {
    const k = pts.length - 1;
    if (Math.sign(cross(pts[k - 1], pts[k], tip)) === -pts[k].side) pts.pop();
    else break;
  }
  pull(pts, tip, blocked);
  // Wrap: bend round corners until every segment is clear.
  let tangled = false;
  for (let guard = 0; guard < 24; guard++) {
    const all = withTip(pts, tip);
    let at = -1, hit = null;
    for (let i = 0; i + 1 < all.length && !hit; i++) {
      hit = segmentBlockedBy(all[i], all[i + 1], blocked);
      at = i;
    }
    if (!hit) break;
    if (pts.length > MAX_BENDS) { tangled = true; break; } // more than 3 wrap points: too tangled to route
    const c = bendCorner(all[at], all[at + 1], hit, blocked, all);
    if (!c) { tangled = true; break; } // nothing new to bend round
    pts.splice(at + 1, 0, { x: c.x, y: c.y, side: 0 });
  }
  pull(pts, tip, blocked);
  sides(pts, tip);
  return tangled ? { pts, tangled: true } : { pts };
}

/** Length used: the sum of the segments from the anchor through every corner to the tip. */
export function cordUsed(cord, tip) {
  let total = 0;
  const all = withTip(cord.pts, tip);
  for (let i = 0; i + 1 < all.length; i++) total += dist(all[i], all[i + 1]);
  return total;
}

/**
 * Try to move the tip to `tip`. { ok: true, cord, used } when the new cord fits in maxLen; otherwise
 * { ok: false, cord: <the old cord, unchanged>, used } and the unit's move must stop.
 */
export function cordMove(cord, tip, blocked, maxLen) {
  const next = updateCord(cord, tip, blocked);
  const used = cordUsed(next, tip);
  return !next.tangled && used <= maxLen ? { ok: true, cord: next, used } : { ok: false, cord, used };
}

/** Re-anchor the cord at a peg: a rock or Extension Box on tile `peg` that one of the corners touches. Null if none. */
export function pegAt(cord, peg) {
  for (let k = 1; k < cord.pts.length; k++) {
    const p = cord.pts[k];
    if (Math.abs(Math.abs(p.x - peg.x) - 0.5) < EPS && Math.abs(Math.abs(p.y - peg.y) - 0.5) < EPS) {
      return { pts: cord.pts.slice(k).map((q, i) => ({ ...q, side: i === 0 ? 0 : q.side })) };
    }
  }
  return null;
}
