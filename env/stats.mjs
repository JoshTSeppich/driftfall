// The one stats table. Every number from spec sections 3, 4, 5 and 11 lives here.
// Balance changes are one-line edits in this file.
//
// Shape: STATS.units and STATS.structures are keyed by kind and hold the same fields for every kind, so tests can loop
// over UNIT_KINDS and STRUCTURE_KINDS. The Core is kept apart in STATS.core because it can't be built and has no cost.

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const STATS = deepFreeze({
  // Whole-match rules (spec sections 3, 4, 9).
  match: {
    startShards: 100,
    maxTicks: 2000,
    unitCap: 40,
    queueMax: 5,
    maxCommandsPerTick: 100,
  },

  // Crystal tiles and gathering (spec sections 2 and 3).
  crystal: {
    amount: 400,
    mineTicks: 8,
    carry: 10,
  },

  // Map generation (spec section 2).
  map: {
    width: 32,
    height: 32,
    rockPairs: 24,
    rockClearance: 2,
    rockAttempts: 2000,
  },

  // Referee limits (spec section 11).
  referee: {
    thinkMs: 50,
    hardMs: 1000,
    throwLimit: 50,
  },

  // The Core (spec section 4). Can't be built, so it has no cost.
  core: {
    hp: 1000,
    trains: ["worker"],
  },

  // Buildable structures (spec section 4). Cost is paid when the build command is accepted.
  structures: {
    forge: { cost: 150, hp: 400, buildTicks: 40, trains: ["grunt", "lancer", "brute"] },
    turret: { cost: 100, hp: 150, buildTicks: 30, damage: 12, range: 5 },
  },

  // Units (spec section 5). speed is ticks per step: 1 moves every tick, 2 moves on even ticks only.
  units: {
    worker: { cost: 50, hp: 40, damage: 2, range: 1, speed: 1, trainTicks: 20 },
    grunt: { cost: 50, hp: 60, damage: 8, range: 1, speed: 1, trainTicks: 15 },
    lancer: { cost: 75, hp: 40, damage: 10, range: 4, speed: 1, trainTicks: 20 },
    brute: { cost: 150, hp: 240, damage: 25, range: 1, speed: 2, trainTicks: 40 },
  },
});

export const UNIT_KINDS = Object.freeze(Object.keys(STATS.units));
export const STRUCTURE_KINDS = Object.freeze(Object.keys(STATS.structures));

// Returns the stats entry for any kind (unit, buildable structure or core), or null for an unknown kind.
export function kindStats(kind) {
  if (kind === "core") return STATS.core;
  if (Object.prototype.hasOwnProperty.call(STATS.units, kind)) return STATS.units[kind];
  if (Object.prototype.hasOwnProperty.call(STATS.structures, kind)) return STATS.structures[kind];
  return null;
}

// Value of one entity, in Shards (spec sections 5 and 9). Units and complete buildable structures count their cost.
// The Core, unfinished sites (complete !== true) and anything unknown count 0.
export function valueOf(entity) {
  if (!entity || typeof entity !== "object") return 0;
  if (UNIT_KINDS.includes(entity.kind)) return STATS.units[entity.kind].cost;
  if (STRUCTURE_KINDS.includes(entity.kind) && entity.complete === true) return STATS.structures[entity.kind].cost;
  return 0;
}

// Value of one side: its Shards plus the value of its living units and complete structures.
// Reads the state shape from spec section 14 directly, so this module has no dependency on state.mjs.
export function sideValue(state, player) {
  const shards = state.shards[player];
  const units = state.units.filter((u) => u.owner === player);
  const structures = state.structures.filter((s) => s.owner === player);
  return shards + units.reduce((sum, u) => sum + valueOf(u), 0) + structures.reduce((sum, s) => sum + valueOf(s), 0);
}
