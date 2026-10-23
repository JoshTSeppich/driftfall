// Validates and applies one side's command list (spec section 10).
// A legal command takes effect at once. An illegal one changes nothing and logs a reject event with its reason.
// Malformed input is never a crash: it is rejected as bad-command. Side order is decided by sim.mjs, not here.
import { STATS, STRUCTURE_KINDS, kindStats } from "./stats.mjs";
import { findEntity, isFree, emit, allocId } from "./state.mjs";
import { startPush } from "./rocks.mjs";

export function applyCommands(state, player, commands) {
  if (!Array.isArray(commands)) return;
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    const reason = i >= STATS.match.maxCommandsPerTick ? "too-many" : applyOne(state, player, command);
    if (reason) emit(state, { e: "reject", player, command, reason });
  }
}

// Returns null when the command was applied, or the reason it was refused.
function applyOne(state, player, command) {
  try {
    if (!isObject(command)) return "bad-command";
    switch (command.type) {
      case "move":
        return doMove(state, player, command);
      case "attack":
        return doAttack(state, player, command);
      case "gather":
        return doGather(state, player, command);
      case "build":
        return doBuild(state, player, command);
      case "train":
        return doTrain(state, player, command);
      case "stop":
        return doStop(state, player, command);
      case "push":
        return startPush(state, player, command);
      default:
        return "bad-command";
    }
  } catch {
    // Every check runs before anything changes, so a stray error leaves the state as it was.
    return "bad-command";
  }
}

function doMove(state, player, c) {
  const found = ownUnit(state, player, c.unit);
  if (found.reason) return found.reason;
  const bad = tileReason(state, c.x, c.y);
  if (bad) return bad;
  setOrder(state, found.unit, { type: "move", x: c.x, y: c.y });
  return null;
}

function doAttack(state, player, c) {
  const found = ownUnit(state, player, c.unit);
  if (found.reason) return found.reason;
  const target = findEntity(state, c.target);
  if (!target || target.owner === player || kindStats(target.kind) === null) return "bad-target";
  setOrder(state, found.unit, { type: "attack", target: target.id });
  return null;
}

function doGather(state, player, c) {
  const found = ownUnit(state, player, c.unit);
  if (found.reason) return found.reason;
  if (found.unit.kind !== "worker") return "wrong-kind";
  const bad = tileReason(state, c.x, c.y);
  if (bad) return bad;
  const crystal = state.crystals.find((k) => k.x === c.x && k.y === c.y);
  if (!crystal || !(crystal.amount > 0)) return "bad-target";
  setOrder(state, found.unit, { type: "gather", x: c.x, y: c.y, phase: "toField", ticks: 0 });
  return null;
}

function doBuild(state, player, c) {
  const found = ownUnit(state, player, c.unit);
  if (found.reason) return found.reason;
  if (found.unit.kind !== "worker") return "wrong-kind";
  if (!STRUCTURE_KINDS.includes(c.kind)) return "wrong-kind";
  const bad = tileReason(state, c.x, c.y);
  if (bad) return bad;
  if (!isFree(state, c.x, c.y)) return "tile-taken";
  const cost = STATS.structures[c.kind].cost;
  if (state.shards[player] < cost) return "no-shards";

  state.shards[player] -= cost;
  emit(state, { e: "spend", player, amount: cost, shards: state.shards[player] });
  const site = { id: allocId(state), owner: player, kind: c.kind, x: c.x, y: c.y, hp: 1, progress: 0, complete: false, queue: [] };
  state.structures.push(site);
  emit(state, { e: "spawn", structure: { ...site, queue: [] } });
  setOrder(state, found.unit, { type: "build", site: site.id });
  return null;
}

function doTrain(state, player, c) {
  const building = typeof c.building === "number" ? state.structures.find((s) => s.id === c.building) : undefined;
  if (!building) return "bad-target";
  if (building.owner !== player) return "not-yours";
  const trains = kindStats(building.kind)?.trains;
  if (!Array.isArray(trains) || !trains.includes(c.kind)) return "wrong-kind";
  if (!building.complete) return "not-complete";
  if (building.queue.length >= STATS.match.queueMax) return "queue-full";
  const cost = STATS.units[c.kind].cost;
  if (state.shards[player] < cost) return "no-shards";
  if (sideUnitCount(state, player) + 1 > STATS.match.unitCap) return "unit-cap";

  state.shards[player] -= cost;
  emit(state, { e: "spend", player, amount: cost, shards: state.shards[player] });
  building.queue.push(c.kind);
  emit(state, { e: "queue", id: building.id, queue: [...building.queue] });
  return null;
}

function doStop(state, player, c) {
  const found = ownUnit(state, player, c.unit);
  if (found.reason) return found.reason;
  if (found.unit.order !== null) setOrder(state, found.unit, null);
  return null;
}

// Living units plus queued units for one side. Both count toward the unit cap.
function sideUnitCount(state, player) {
  let count = state.units.filter((u) => u.owner === player).length;
  for (const s of state.structures) if (s.owner === player) count += s.queue.length;
  return count;
}

// Returns { unit } for a living unit the player owns, or { reason } explaining why not.
function ownUnit(state, player, id) {
  const unit = typeof id === "number" ? state.units.find((u) => u.id === id) : undefined;
  if (!unit) return { reason: "no-such-unit" };
  if (unit.owner !== player) return { reason: "not-yours" };
  return { unit };
}

// Null when (x, y) is a whole number inside the map, otherwise the reason it is not.
function tileReason(state, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return "bad-command";
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return "off-map";
  return null;
}

function setOrder(state, unit, order) {
  unit.order = order;
  emit(state, { e: "order", id: unit.id, order: order && { ...order } });
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
