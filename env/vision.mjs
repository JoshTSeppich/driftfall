// Vision / fog of war: ENV-SPEC-v3-draft.md §7. Pure and deterministic: same state in, same rows out.
// Works on today's v2 state (flat map, no heights) and on v3 maps (state.heights rows of ints, state.ramps).
import { kindStats } from './stats.mjs';

// Sight in tiles, from the v3 tables. A `sight` field in env/stats.mjs wins over these when it exists.
export const DEFAULT_SIGHT = Object.freeze({
  core: 8, quarters: 5, forge: 6, siphon: 6, turret: 7, mast: 10, foundry: 6, hangar: 6, sanctum: 6,
  worker: 5, grunt: 6, lancer: 6, brute: 6, spiker: 7, howler: 7, dart: 7, mender: 6, shade: 6, conduit: 6,
  skiff: 7, barge: 6, seer: 8,
});
export const SITE_SIGHT = 2; // an unfinished structure
export const NEAR_SIGHT = 2; // anything within this is always seen, whatever its height
const AIR_KINDS = new Set(['skiff', 'barge', 'seer']);

export function sightOf(piece) {
  if (piece.complete === false) return SITE_SIGHT;
  const own = kindStats(piece.kind)?.sight;
  return own ?? DEFAULT_SIGHT[piece.kind] ?? 5;
}

const isAir = (p) => p.layer === 'air' || AIR_KINDS.has(p.kind);

// Height of a tile for sight. Ramps count as 0. Off-map and flat maps are 0.
export function heightAt(state, x, y) {
  const row = state.heights?.[y];
  if (!row) return 0;
  const h = typeof row === 'string' ? Number(row[x]) : row[x];
  if (!(h > 0)) return 0;
  if (state.ramps?.some((r) => r.x === x && r.y === y)) return 0;
  return h;
}

// Mark every tile a piece sees. `rows` is an array of Uint8Array(width).
function mark(state, rows, piece) {
  if (piece.inside != null) return; // cargo in a Barge sees nothing
  const r = sightOf(piece);
  const air = isAir(piece);
  const own = heightAt(state, piece.x, piece.y);
  const x0 = Math.max(0, piece.x - r), x1 = Math.min(state.width - 1, piece.x + r);
  const y0 = Math.max(0, piece.y - r), y1 = Math.min(state.height - 1, piece.y + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const near = Math.max(Math.abs(x - piece.x), Math.abs(y - piece.y)) <= NEAR_SIGHT;
      if (air || near || heightAt(state, x, y) <= own) rows[y][x] = 1;
    }
  }
}

// Rows of `width` characters per tile row: '1' seen, '0' unseen (spec §7 form).
export function visionOf(state, player) {
  const rows = Array.from({ length: state.height }, () => new Uint8Array(state.width));
  for (const s of state.structures) if (s.owner === player) mark(state, rows, s);
  for (const u of state.units) if (u.owner === player && u.hp > 0) mark(state, rows, u);
  return rows.map((row) => Array.from(row, (v) => (v ? '1' : '0')).join(''));
}

export const isSeen = (vision, x, y) => vision[y]?.[x] === '1';

// Explored memory: a side remembers every tile it has ever seen. Plain data (rows of '1'/'0').
export function createExplored(width, height) {
  return Array.from({ length: height }, () => '0'.repeat(width));
}
export function updateExplored(explored, vision) {
  return explored.map((row, y) => {
    let out = '';
    for (let x = 0; x < row.length; x++) out += row[x] === '1' || vision[y][x] === '1' ? '1' : '0';
    return out;
  });
}

// Pieces the side may know about: its own, plus the other side's only on seen tiles.
export function filterVisible(state, player, vision = visionOf(state, player)) {
  const ok = (e) => e.owner === player || isSeen(vision, e.x, e.y);
  return { units: state.units.filter(ok), structures: state.structures.filter(ok) };
}
