// Driftfall — economy phases: production (training queues, construction sites) and gathering
// (mining, delivery, retargeting). See ENV-SPEC.md §3, §4 and §8 steps 2 and 3.
//
// Both exports mutate `state` in place and log through `emit`. They contain no randomness, no
// clock and no async, and visit entities strictly in id order (reversed on odd ticks, §8).

import { STATS, kindStats } from "./stats.mjs";
import { distance, isFree, allocId, emit, structuresOf, unitsOf } from "./state.mjs";

// ---------------------------------------------------------------------------------------------
// Stats lookup (every number comes from env/stats.mjs)
// ---------------------------------------------------------------------------------------------

function statsFor(kind) {
  const s = kindStats(kind);
  if (!s) throw new Error(`economy: no stats for kind '${kind}'`);
  return s;
}

const unitStats = statsFor;
const structureStats = statsFor;
const maxHpOf = (s) => s.hp;
const mineTicks = () => STATS.crystal.mineTicks;
const carryMax = () => STATS.crystal.carry;

// ---------------------------------------------------------------------------------------------
// Ordering helpers (§8 fairness rule)
// ---------------------------------------------------------------------------------------------

// Lowest id first on even ticks, highest id first on odd ticks. Returns a fresh array so the
// caller can add or remove entities while iterating.
function inIdOrder(state, list) {
  const sorted = list.slice().sort((a, b) => a.id - b.id);
  return state.tick % 2 === 1 ? sorted.reverse() : sorted;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function setOrder(state, unit, order) {
  unit.order = order;
  emit(state, { e: "order", id: unit.id, order: order === null ? null : copy(order) });
}

// ---------------------------------------------------------------------------------------------
// Production (§4 Building and Training, §8 step 2)
// ---------------------------------------------------------------------------------------------

export function stepProduction(state) {
  for (const structure of inIdOrder(state, state.structures)) {
    // The structure may have been removed earlier in this same loop? Nothing removes structures
    // here, but a cheap identity check keeps us safe against stale snapshots.
    if (!state.structures.includes(structure)) continue;
    if (structure.complete) tickTraining(state, structure);
    else tickConstruction(state, structure);
  }
}

// Nearest free tile around (bx, by): ring distance 1, then 2, then 3; inside a ring lower y
// first, then lower x. Returns null when every tile within distance 3 is taken.
export function findSpawnTile(state, bx, by, maxRange = 3) {
  for (let d = 1; d <= maxRange; d++) {
    for (let y = by - d; y <= by + d; y++) {
      if (y < 0 || y >= state.height) continue;
      for (let x = bx - d; x <= bx + d; x++) {
        if (x < 0 || x >= state.width) continue;
        if (Math.max(Math.abs(x - bx), Math.abs(y - by)) !== d) continue;
        if (isFree(state, x, y)) return { x, y };
      }
    }
  }
  return null;
}

function tickTraining(state, structure) {
  const queue = structure.queue;
  if (!Array.isArray(queue) || queue.length === 0) {
    structure.training = null;
    return;
  }
  const kind = queue[0];
  if (structure.training === null || structure.training === undefined) {
    structure.training = unitStats(kind).trainTicks;
  }
  if (structure.training > 0) structure.training -= 1;
  if (structure.training > 0) return;

  // Countdown finished: spawn if there is room, otherwise wait (and retry next tick).
  const tile = findSpawnTile(state, structure.x, structure.y);
  if (!tile) {
    structure.training = 0;
    return;
  }
  const unit = {
    id: allocId(state),
    owner: structure.owner,
    kind,
    x: tile.x,
    y: tile.y,
    hp: maxHpOf(unitStats(kind)),
    carrying: 0,
    order: null,
  };
  state.units.push(unit);
  queue.shift();
  structure.training = null;
  emit(state, { e: "spawn", unit: copy(unit) });
  emit(state, { e: "queue", id: structure.id, queue: queue.slice() });
}

function tickConstruction(state, site) {
  const builder = unitsOf(state, site.owner).find(
    (u) => u.kind === "worker" && u.order && u.order.type === "build" && u.order.site === site.id && distance(u, site) <= 1,
  );
  if (!builder) return;

  const stats = structureStats(site.kind);
  const maxHp = maxHpOf(stats);
  const buildTicks = stats.buildTicks;
  site.progress = (site.progress ?? 0) + 1;
  site.hp = Math.min(maxHp, site.hp + Math.round(maxHp / buildTicks));
  emit(state, { e: "progress", id: site.id, progress: site.progress, hp: site.hp });

  if (site.progress >= buildTicks) {
    site.complete = true;
    if (!Array.isArray(site.queue)) site.queue = [];
    emit(state, { e: "done", id: site.id });
    for (const u of inIdOrder(state, unitsOf(state, site.owner))) {
      if (u.order && u.order.type === "build" && u.order.site === site.id) setOrder(state, u, null);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Gathering (§3, §8 step 3)
// ---------------------------------------------------------------------------------------------

export function stepGathering(state) {
  for (const unit of inIdOrder(state, state.units)) {
    if (unit.kind !== "worker") continue;
    const order = unit.order;
    if (!order || order.type !== "gather") continue;
    tickGather(state, unit, order);
  }
}

function crystalAt(state, x, y) {
  return state.crystals.find((c) => c.x === x && c.y === y) || null;
}

// Nearest crystal tile with Shards left, measured from `from` (§6 distance); ties by lower y,
// then lower x. Returns null when every tile is empty.
export function nearestCrystalWithShards(state, from) {
  let best = null;
  let bestD = Infinity;
  for (const c of state.crystals) {
    if (!(c.amount > 0)) continue;
    const d = distance(from, c);
    if (d < bestD || (d === bestD && (c.y < best.y || (c.y === best.y && c.x < best.x)))) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function ownCore(state, player) {
  const cores = structuresOf(state, player).filter((s) => s.kind === "core");
  cores.sort((a, b) => a.id - b.id);
  return cores[0] || null;
}

// Point the order at the nearest tile with Shards, or go idle when none is left.
function retarget(state, unit) {
  const next = nearestCrystalWithShards(state, unit);
  if (!next) {
    setOrder(state, unit, null);
    return false;
  }
  setOrder(state, unit, { type: "gather", x: next.x, y: next.y, phase: "toField", ticks: 0 });
  return true;
}

function tickGather(state, unit, order) {
  if (order.phase === undefined) order.phase = "toField";
  if (typeof order.ticks !== "number") order.ticks = 0;
  const carry = carryMax();

  if (order.phase === "toCore") {
    if (!(unit.carrying > 0)) {
      order.phase = "toField";
      order.ticks = 0;
      return;
    }
    const core = ownCore(state, unit.owner);
    if (!core) {
      setOrder(state, unit, null);
      return;
    }
    if (distance(unit, core) > 1) return; // still walking
    const amount = unit.carrying;
    state.shards[unit.owner] += amount;
    unit.carrying = 0;
    emit(state, { e: "deliver", id: unit.id, amount, shards: state.shards[unit.owner] });
    order.phase = "toField";
    order.ticks = 0;
    const tile = crystalAt(state, order.x, order.y);
    if (!tile || !(tile.amount > 0)) retarget(state, unit);
    return;
  }

  // toField or mining
  if (unit.carrying >= carry) {
    // Already full (for example re-ordered while carrying): deliver first.
    order.phase = "toCore";
    order.ticks = 0;
    return;
  }
  const tile = crystalAt(state, order.x, order.y);
  if (!tile || !(tile.amount > 0)) {
    retarget(state, unit);
    return;
  }
  if (distance(unit, tile) > 1) {
    // Not there yet (or no longer there): keep walking, mining progress resets.
    order.phase = "toField";
    order.ticks = 0;
    return;
  }
  if (order.phase !== "mining") {
    // Arrived: mining starts now and counts from the next tick, so a load takes exactly
    // mineTicks full ticks in the mining phase.
    order.phase = "mining";
    order.ticks = 0;
    return;
  }
  order.ticks += 1;
  if (order.ticks < mineTicks()) return;

  const take = Math.min(carry - unit.carrying, tile.amount);
  tile.amount -= take;
  unit.carrying += take;
  emit(state, { e: "mine", id: unit.id, x: tile.x, y: tile.y, amount: take, left: tile.amount });
  order.phase = "toCore";
  order.ticks = 0;
}
