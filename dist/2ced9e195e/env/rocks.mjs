// Movable rocks (TERRITORY.md section 15). Owner: haiku.
//
// A push is a job, not an order. startPush (called from env/commands.mjs for a `push` command) checks the command and,
// when it is legal, queues a job on state.pushJobs. stepRocks (called from env/sim.mjs once per tick, after gathering and
// before movement) walks the unit to the side of the rock if it must, counts down the push time, then moves the rock one
// tile and the unit steps into the gap. A haul (`to`, Crumb/worker only) repeats that along a straight line.
//
// Rules: the unit pushes away from itself. The rock moves only onto open floor at the same height that no unit,
// structure, crystal, Rubble, ramp or rock occupies. A rock pushed into water becomes a ford (walkable, the rock is
// gone); three or more fords in a line across the water make a dam (the push event says dam: true).
// Deterministic: no clock, no randomness; jobs run in the order they were queued.

import { emit, isPassable } from './state.mjs';
import { heightAt } from './vision.mjs';

export const ROCKS = Object.freeze({
  pushTicks: 12, // the heavy unit (brute) pushes at this pace: half a second a tile at 24 ticks a second
  slowFactor: 3, // every other ground unit takes this many times as long
  haulMax: 8, // the longest straight haul, in tiles
  heavyKind: 'brute', // Four-Slice
  haulKind: 'worker', // Crumb: TERRITORY.md says Siphoner, but the roster has no Siphoner; the hauler is the Crumb
  airKinds: Object.freeze(['skiff', 'barge', 'seer']),
  damLine: 3, // fords in a row across the water that make a dam
});

// Tie-break order when the unit can reach more than one side of the rock.
const DIRS = Object.freeze([[1, 0], [0, -1], [-1, 0], [0, 1]]);

const keyOf = (x, y) => `${x},${y}`;
const inBounds = (state, x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < state.width && y < state.height;
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Water: a state.rockHooks.isWater hook when the wiring gives one, else a flooded Reach (as env/sim-territory.mjs reads it).
function isWaterAt(state, x, y) {
  const hook = state.rockHooks?.isWater;
  if (typeof hook === 'function') return !!hook(state, x, y);
  const t = state.territory;
  if (!t?.flooded || !t.map?.reachAt) return false;
  return t.flooded.has(t.map.reachAt(x, y));
}

// A real rock: on the rock set, and not water (flood tiles sit on the rock set too, for movement, but they are water).
export function isRockAt(state, x, y) {
  return state.rockSet.has(keyOf(x, y)) && !isWaterAt(state, x, y);
}

const fordsOf = (state) => (state.fords ||= new Set());
const jobsOf = (state) => (state.pushJobs ||= []);

/** Why a rock at (x, y) cannot move one tile in direction d, or null when it can. */
export function stepReason(state, x, y, d) {
  const tx = x + d[0], ty = y + d[1];
  if (!inBounds(state, tx, ty)) return 'off-map';
  if (state.ramps?.some((r) => (r.x === x && r.y === y) || (r.x === tx && r.y === ty))) return 'ramp';
  if (heightAt(state, tx, ty) !== heightAt(state, x, y)) return 'cliff';
  const water = isWaterAt(state, tx, ty);
  if (!water && state.rockSet.has(keyOf(tx, ty))) return 'blocked';
  if (state.crystals.some((c) => c.x === tx && c.y === ty)) return 'blocked';
  if (state.structures.some((s) => s.x === tx && s.y === ty)) return 'blocked';
  if (state.rubble?.some((r) => r.x === tx && r.y === ty)) return 'blocked';
  if (state.units.some((u) => u.x === tx && u.y === ty)) return 'blocked';
  return null;
}

// A tile a unit can stand on while it pushes: passable, and the same height as the rock.
const standable = (state, x, y, rockX, rockY) =>
  isPassable(state, x, y) && heightAt(state, x, y) === heightAt(state, rockX, rockY) && !state.ramps?.some((r) => r.x === x && r.y === y);

const pushTicksFor = (unit) => (unit.kind === ROCKS.heavyKind ? ROCKS.pushTicks : ROCKS.pushTicks * ROCKS.slowFactor);

/**
 * Check a `push` command and queue it. Returns null when the job is queued, else the reason it was refused.
 * c: { type: 'push', unit, x, y, to? }. Without `to` it is a push: the unit pushes away from itself, or walks to the
 * side of the rock nearest it that can take the push. With `to` (a worker only) it is a haul in a straight line.
 */
export function startPush(state, player, c) {
  const unit = state.units.find((u) => u.id === c.unit);
  if (!unit) return 'no-such-unit';
  if (unit.owner !== player) return 'not-yours';
  if (ROCKS.airKinds.includes(unit.kind)) return 'wrong-kind';
  if (!Number.isInteger(c.x) || !Number.isInteger(c.y)) return 'bad-command';
  const hauling = c.to !== undefined;
  if (hauling && (!isObject(c.to) || !Number.isInteger(c.to.x) || !Number.isInteger(c.to.y))) return 'bad-command';
  if (!inBounds(state, c.x, c.y)) return 'off-map';
  if (!isRockAt(state, c.x, c.y)) return 'no-rock';

  let dir, steps = 1;
  if (hauling) {
    if (unit.kind !== ROCKS.haulKind) return 'wrong-kind';
    const dx = c.to.x - c.x, dy = c.to.y - c.y;
    if ((dx !== 0) === (dy !== 0)) return 'bad-target'; // not a straight line, or the rock's own tile
    steps = Math.abs(dx) + Math.abs(dy);
    if (steps > ROCKS.haulMax) return 'too-far';
    if (!inBounds(state, c.to.x, c.to.y)) return 'off-map';
    dir = [Math.sign(dx), Math.sign(dy)];
    const reason = stepReason(state, c.x, c.y, dir);
    if (reason) return reason;
  } else {
    const adjacent = Math.abs(unit.x - c.x) + Math.abs(unit.y - c.y) === 1;
    if (adjacent) {
      dir = [c.x - unit.x, c.y - unit.y];
      const reason = stepReason(state, c.x, c.y, dir);
      if (reason) return reason;
    } else {
      // Far away: the side nearest the unit that can take the push. None: the reason from the first side.
      let best = null, firstReason = null;
      for (const d of DIRS) {
        const reason = stepReason(state, c.x, c.y, d);
        if (firstReason === null) firstReason = reason ?? 'blocked';
        if (reason !== null || !standable(state, c.x - d[0], c.y - d[1], c.x, c.y)) continue;
        const gap = Math.max(Math.abs(c.x - d[0] - unit.x), Math.abs(c.y - d[1] - unit.y));
        if (!best || gap < best.gap) best = { d, gap };
      }
      if (!best) return firstReason;
      dir = best.d;
    }
  }

  const stand = [c.x - dir[0], c.y - dir[1]];
  const jobs = jobsOf(state);
  const old = jobs.find((j) => j.unit === unit.id);
  if (old) cancel(state, old, 'replaced');
  const job = {
    id: (state.pushSeq = (state.pushSeq || 0) + 1),
    unit: unit.id, rock: [c.x, c.y], dir, steps, stand,
    phase: 'walk', ticks: 0, need: pushTicksFor(unit), order: null,
  };
  jobs.push(job);
  if (unit.x === stand[0] && unit.y === stand[1]) {
    beginPush(state, job);
  } else {
    job.order = { type: 'move', x: stand[0], y: stand[1] };
    unit.order = job.order;
    emit(state, { e: 'order', id: unit.id, order: { ...job.order } });
  }
  return null;
}

function beginPush(state, job) {
  job.phase = 'push';
  job.ticks = job.need;
  emit(state, { e: 'push-start', id: job.id, unit: job.unit, rock: [...job.rock], dir: [...job.dir], ticks: job.ticks, steps: job.steps });
}

function cancel(state, job, reason) {
  const jobs = jobsOf(state);
  const at = jobs.indexOf(job);
  if (at >= 0) jobs.splice(at, 1);
  emit(state, { e: 'push-cancel', id: job.id, unit: job.unit, reason });
}

// Ford and dam test for the water tile (x, y) just filled: the run of fords across the water, perpendicular to the push.
function fordRunAcross(state, x, y, dx, dy) {
  const fords = fordsOf(state);
  const [ax, ay] = dx !== 0 ? [0, 1] : [1, 0];
  let count = 1;
  for (const sign of [1, -1]) {
    for (let i = 1; fords.has(keyOf(x + sign * ax * i, y + sign * ay * i)); i++) count += 1;
  }
  return count;
}

function moveRock(state, unit, job) {
  const [x, y] = job.rock;
  const [dx, dy] = job.dir;
  const tx = x + dx, ty = y + dy;
  const water = isWaterAt(state, tx, ty);

  // The rock leaves its tile; the unit steps into the gap, so it is still next to the rock.
  state.rockSet.delete(keyOf(x, y));
  const at = state.rocks.findIndex(([a, b]) => a === x && b === y);
  if (at >= 0) state.rocks.splice(at, 1);
  unit.x = x;
  unit.y = y;

  let dam = false;
  if (water) {
    // A ford: walkable, and the rock is consumed. A flood may have put this tile on the rock set; it is walkable now.
    fordsOf(state).add(keyOf(tx, ty));
    state.rockSet.delete(keyOf(tx, ty));
    dam = fordRunAcross(state, tx, ty, dx, dy) >= ROCKS.damLine;
  } else {
    state.rockSet.add(keyOf(tx, ty));
    state.rocks.push([tx, ty]);
  }
  job.rock = [tx, ty];
  job.steps -= 1;
  job.stand = [x, y];
  emit(state, { e: 'push', id: job.id, unit: unit.id, from: [x, y], to: [tx, ty], ford: water, dam });

  // A rock that became a ford is gone, so a haul ends there; so does the last step of any haul.
  if (water || job.steps <= 0) {
    const jobs = jobsOf(state);
    jobs.splice(jobs.indexOf(job), 1);
    return;
  }
  job.ticks = job.need;
}

/** Advance every push job by one tick. Called by env/sim.mjs between gathering and movement. */
export function stepRocks(state) {
  const jobs = state.pushJobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return;
  for (const job of jobs.slice()) {
    const unit = state.units.find((u) => u.id === job.unit);
    if (!unit) {
      cancel(state, job, 'gone');
      continue;
    }
    if (job.phase === 'walk') {
      if (unit.x === job.stand[0] && unit.y === job.stand[1]) beginPush(state, job);
      else if (unit.order !== job.order) cancel(state, job, unit.order === null ? 'no-path' : 'interrupted');
      continue;
    }
    if (unit.order !== null) {
      cancel(state, job, 'interrupted');
      continue;
    }
    if (unit.x !== job.stand[0] || unit.y !== job.stand[1]) {
      cancel(state, job, 'moved');
      continue;
    }
    job.ticks -= 1;
    if (job.ticks > 0) continue;
    const reason = stepReason(state, job.rock[0], job.rock[1], job.dir);
    if (reason) cancel(state, job, reason);
    else moveRock(state, unit, job);
  }
}
