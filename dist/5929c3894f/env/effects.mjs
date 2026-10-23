// Driftfall — Drift effects that touch the world (Flood) and Burrow Tunnels (TERRITORY.md sections 4 and 6).
// Owner: sonnet. Called from sim-territory.mjs; pure and deterministic, nothing runs unless the rules are on.
//
// Flood: the Reach's tiles join state.rockSet for 60 s (so movement, building and pathing already treat them as
// blocked), units standing in it are pushed to the nearest dry tile and take damage (never below 1 hp: a Flood hurts,
// it does not kill), and claims inside stop holding (territory.flooded). Swimmers research: pushed out, not hurt.
// The tiles added are remembered so real rocks are never removed.

import { emit, isFree, distance } from './state.mjs';
import { findSpawnTile } from './economy.mjs';

export const EFFECTS = Object.freeze({
  floodDamage: 10, // assumption: TERRITORY.md gives no number
  tunnelTicks: 72, // 3 s at 24 ticks a second
  tunnelReach: 2, // a unit must be this close to the Mound it enters
});

/** Resolve a Drift target { side, role, index } to a territory Reach (the Centre has side null in the map). */
export function reachOfTarget(state, target) {
  const side = target.side === 'centre' ? null : target.side;
  const list = state.territory.map.reaches.filter((r) => r.role === target.role && (r.side ?? null) === side);
  return list[target.index || 0] || null;
}

const keyOf = (x, y) => `${x},${y}`;

function startFlood(state, ev) {
  const reaches = ev.targets.map((t) => reachOfTarget(state, t)).filter(Boolean);
  for (const reach of reaches) {
    const map = state.territory.map;
    const inReach = (x, y) => map.reachAt(x, y) === reach.id;
    // Push first, while the destination search still sees the Reach as dry ground.
    for (const u of state.units.slice()) {
      if (u.inside || !inReach(u.x, u.y)) continue;
      const to = nearestDryOutside(state, u, inReach);
      if (to) {
        u.x = to.x; u.y = to.y;
        u.order = null;
        emit(state, { e: 'flood-push', id: u.id, x: to.x, y: to.y });
      }
      const swims = (state.research?.done[u.owner] || []).includes('swimmers');
      if (!swims) u.hp = Math.max(1, u.hp - EFFECTS.floodDamage);
    }
    const added = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!inReach(x, y)) continue;
        const k = keyOf(x, y);
        if (!state.rockSet.has(k)) { state.rockSet.add(k); added.push(k); }
      }
    }
    (state.floods ||= []).push({ event: ev.id, reach: reach.id, added });
    (state.territory.flooded ||= new Set()).add(reach.id);
    emit(state, { e: 'flood-start', reach: reach.id });
  }
}

function endFlood(state, ev) {
  const keep = [];
  for (const f of state.floods || []) {
    if (f.event !== ev.id) { keep.push(f); continue; }
    for (const k of f.added) state.rockSet.delete(k);
    state.territory.flooded?.delete(f.reach);
    emit(state, { e: 'flood-end', reach: f.reach });
  }
  state.floods = keep;
}

function nearestDryOutside(state, unit, inReach) {
  const max = Math.max(state.width, state.height);
  for (let d = 1; d <= max; d++) {
    for (let y = unit.y - d; y <= unit.y + d; y++) {
      for (let x = unit.x - d; x <= unit.x + d; x++) {
        if (Math.max(Math.abs(x - unit.x), Math.abs(y - unit.y)) !== d) continue;
        if (inReach(x, y) || !isFree(state, x, y)) continue;
        if (state.units.some((o) => o !== unit && o.x === x && o.y === y)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

/** Apply the effects of the events that start or end on this tick. */
export function applyDriftEffects(state, at) {
  for (const ev of at.expire) if (ev.kind === 'flood') endFlood(state, ev);
  for (const ev of at.apply) if (ev.kind === 'flood') startFlood(state, ev);
}

// ---------------------------------------------------------------------------------------------
// Tunnels (Burrow, research 'tunnels'): walk into one Mound, come out of another 3 s later.
// ---------------------------------------------------------------------------------------------

const mound = (state, player, id) => (state.claims || []).find((c) => c.id === id && c.owner === player && c.kind === 'mound' && c.complete);

/** Returns null when the unit goes underground, else the reject reason. */
export function doTunnel(state, player, c) {
  const unit = typeof c.unit === 'number' ? state.units.find((u) => u.id === c.unit) : undefined;
  if (!unit) return 'no-such-unit';
  if (unit.owner !== player) return 'not-yours';
  if (state.factions?.[player] !== 'burrow') return 'wrong-faction';
  if (!(state.research?.done[player] || []).includes('tunnels')) return 'not-researched';
  const from = mound(state, player, c.from);
  const to = mound(state, player, c.to);
  if (!from || !to || from.id === to.id) return 'bad-target';
  if (state.tunnelDown && state.tunnelDown[from.reach] > state.tick) return 'bad-target';
  if (distance(unit, from) > EFFECTS.tunnelReach) return 'too-far';
  state.units.splice(state.units.indexOf(unit), 1);
  (state.tunnels ||= []).push({ unit, owner: player, from: from.id, to: to.id, ticksLeft: EFFECTS.tunnelTicks });
  emit(state, { e: 'tunnel-enter', id: unit.id, mound: from.id });
  return null;
}

/** A Quake collapses one Reach's tunnel for `ticks`. */
export function collapseTunnel(state, reach, ticks) {
  (state.tunnelDown ||= {})[reach] = state.tick + ticks;
}

export function stepTunnels(state) {
  if (!state.tunnels || state.tunnels.length === 0) return;
  const stay = [];
  for (const t of state.tunnels) {
    t.ticksLeft -= 1;
    if (t.ticksLeft > 0) { stay.push(t); continue; }
    // Exit at the chosen Mound; if it is gone, any other own Mound; if none, where the unit went in.
    const exit = mound(state, t.owner, t.to) || (state.claims || []).find((c) => c.owner === t.owner && c.kind === 'mound' && c.complete);
    const at = exit || { x: t.unit.x, y: t.unit.y };
    const tile = findSpawnTile(state, at.x, at.y, 6) || { x: at.x, y: at.y };
    t.unit.x = tile.x; t.unit.y = tile.y; t.unit.order = null;
    state.units.push(t.unit);
    state.units.sort((a, b) => a.id - b.id);
    emit(state, { e: 'tunnel-exit', id: t.unit.id, x: tile.x, y: tile.y });
  }
  state.tunnels = stay;
}
