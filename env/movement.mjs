// Movement phase (ENV-SPEC §6, §8).
//
// Each tick, every unit with an order that has somewhere to go takes one step along a fresh breadth-first path.
// Units are visited one at a time in id order: lowest id first on even ticks, highest id first on odd ticks.
// Planning ignores units; the actual step is only taken if the next tile is free right now (rocks, crystals,
// structures and other units all block, and a unit that already moved this tick counts at its new tile).
// A unit whose next tile is taken simply waits this tick. Brutes (speed 2) only move on even ticks.
//
// A move order ends when the unit stands on its target tile. Any order whose destination cannot be reached
// at all (walled off by rocks, crystals or structures) is cleared and a `blocked` event is logged.

import { findPath } from './path.mjs';
import { STATS } from './stats.mjs';
import { findEntity, isPassable, isFree, distance, emit } from './state.mjs';

/** Look up the stats row for a unit kind. Tolerates the common table layouts. */
function unitStats(kind) {
  if (!STATS || typeof STATS !== 'object') return null;
  return STATS.units?.[kind] ?? STATS.unit?.[kind] ?? STATS[kind] ?? null;
}

function unitSpeed(unit) {
  const speed = unitStats(unit.kind)?.speed;
  return Number.isInteger(speed) && speed > 0 ? speed : 1;
}

function unitRange(unit) {
  const range = unitStats(unit.kind)?.range;
  return Number.isInteger(range) && range >= 0 ? range : 1;
}

/** The side's Core, or null if it has been destroyed. */
function coreOf(state, player) {
  let best = null;
  for (const s of state.structures) {
    if (s.owner === player && s.kind === 'core' && (best === null || s.id < best.id)) best = s;
  }
  return best;
}

/**
 * Where a unit wants to be for its current order.
 *
 * Returns `{ x, y, within }` meaning "any tile within distance `within` of (x, y)" (`within` 0 means the tile
 * itself), or `null` when the unit has nowhere to go (no order, a mining Worker, a target that no longer exists).
 *
 * - move:   the ordered tile, within 0.
 * - attack: the target's tile, within the unit's range.
 * - gather: next to the crystal tile while heading out or mining; next to the own Core while carrying back.
 * - build:  next to the construction site.
 */
export function destinationOf(state, unit) {
  const order = unit?.order;
  if (!order || typeof order !== 'object') return null;

  switch (order.type) {
    case 'move':
      if (!Number.isInteger(order.x) || !Number.isInteger(order.y)) return null;
      return { x: order.x, y: order.y, within: 0 };

    case 'attack': {
      const target = findEntity(state, order.target);
      if (!target) return null;
      return { x: target.x, y: target.y, within: unitRange(unit) };
    }

    case 'gather': {
      if (order.phase === 'toCore') {
        const core = coreOf(state, unit.owner);
        if (!core) return null;
        return { x: core.x, y: core.y, within: 1 };
      }
      if (!Number.isInteger(order.x) || !Number.isInteger(order.y)) return null;
      return { x: order.x, y: order.y, within: 1 };
    }

    case 'build': {
      const site = findEntity(state, order.site);
      if (!site) return null;
      return { x: site.x, y: site.y, within: 1 };
    }

    default:
      return null;
  }
}

function arrived(unit, dest) {
  return distance(unit, dest) <= dest.within;
}

function clearOrder(state, unit) {
  unit.order = null;
  emit(state, { e: 'order', id: unit.id, order: null });
}

/** Units sorted for this tick: lowest id first on even ticks, highest id first on odd ticks (§8). */
function unitsInTickOrder(state) {
  const units = state.units.slice().sort((a, b) => a.id - b.id);
  if (state.tick % 2 !== 0) units.reverse();
  return units;
}

/**
 * Run the movement phase on `state` in place. Emits `move`, `blocked` and `order` events.
 */
export function stepMovement(state) {
  const grid = {
    width: state.width,
    height: state.height,
    blocked: (x, y) => !isPassable(state, x, y),
  };

  for (const unit of unitsInTickOrder(state)) {
    // The unit may have been removed by an earlier phase; never move a ghost.
    if (!unit || unit.hp <= 0) continue;

    const dest = destinationOf(state, unit);
    if (!dest) continue;

    if (arrived(unit, dest)) {
      if (unit.order.type === 'move') clearOrder(state, unit);
      continue;
    }

    // Brutes (speed 2) only step on even ticks; everyone else every tick.
    if (state.tick % unitSpeed(unit) !== 0) continue;

    const path = findPath(grid, { x: unit.x, y: unit.y }, { x: dest.x, y: dest.y }, { within: dest.within });
    if (!path || path.length === 0) {
      // Walled off: nowhere to go, ever. Drop the order and say so.
      emit(state, { e: 'blocked', id: unit.id });
      clearOrder(state, unit);
      continue;
    }

    const next = path[0];
    if (!isFree(state, next.x, next.y)) continue; // someone is standing there: wait this tick

    unit.x = next.x;
    unit.y = next.y;
    emit(state, { e: 'move', id: unit.id, x: unit.x, y: unit.y });

    if (unit.order.type === 'move' && arrived(unit, dest)) clearOrder(state, unit);
  }
}
