// Driftfall — economy phases: production (training queues, construction sites), gathering
// (mining, delivery, retargeting) and, when switched on, the mining chain of TERRITORY.md §8
// (hand mining at 5 a trip, Drills and Siphons with buffers, Depots, Track lines, the Press and Alloy,
// the flow summary). See ENV-SPEC.md §3, §4 and §8 steps 2 and 3 for the v2 rules.
//
// Every export mutates `state` in place and logs through `emit`. There is no randomness, no clock and
// no async; entities are visited strictly in id order (reversed on odd ticks, §8).
//
// The chain is OFF by default: nothing below "Mining chain" runs until enableChain(state) has added
// `state.chain`, so the v2 game and every green build behave exactly as before.

import { STATS, kindStats, rowOf } from "./stats.mjs";
import { distance, isFree, allocId, emit, structuresOf, unitsOf } from "./state.mjs";

// ---------------------------------------------------------------------------------------------
// Stats lookup (every number comes from env/stats.mjs; chain kinds fall back to CHAIN_DEFAULTS
// until the stats owner adds them to STATS)
// ---------------------------------------------------------------------------------------------

function statsFor(kind, state) {
  const s = rowOf(state, kind) || (state && state.chain ? chainStats(state).structures[kind] : null);
  if (!s) throw new Error(`economy: no stats for kind '${kind}'`);
  return s;
}

const unitStats = statsFor;
const structureStats = statsFor;
const maxHpOf = (s) => s.hp;
const mineTicks = () => STATS.crystal.mineTicks;
const carryMax = (state) => (state.chain ? chainStats(state).handCarry : STATS.crystal.carry);

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
    structure.training = unitStats(kind, state).trainTicks;
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
    hp: maxHpOf(unitStats(kind, state)),
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

  const stats = structureStats(site.kind, state);
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
  if (state.chain) stepChain(state);
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

// Where a Worker drops its load: the own Core in v2; with the chain on, the nearest own complete
// Core or Depot (ties by lower id).
function dropOff(state, unit) {
  if (!state.chain) return ownCore(state, unit.owner);
  let best = null;
  let bestD = Infinity;
  for (const s of state.structures) {
    if (s.owner !== unit.owner || !s.complete || !isDropOffKind(s.kind)) continue;
    const d = distance(unit, s);
    if (d < bestD || (d === bestD && s.id < best.id)) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

const isDropOffKind = (kind) => kind === "core" || kind === "depot";

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
  const carry = carryMax(state);
  const flux = unit.carryingFlux || 0;
  const rare = unit.carryingRare && unit.carryingRare.amount > 0 ? unit.carryingRare.amount : 0;

  if (order.phase === "toCore") {
    if (!(unit.carrying > 0 || flux > 0 || rare > 0)) {
      order.phase = "toField";
      order.ticks = 0;
      return;
    }
    const sink = dropOff(state, unit);
    if (!sink) {
      setOrder(state, unit, null);
      return;
    }
    if (distance(unit, sink) > 1) return; // still walking
    deliverByHand(state, unit, sink);
    order.phase = "toField";
    order.ticks = 0;
    const tile = crystalAt(state, order.x, order.y);
    const source = state.chain ? chainSourceAt(state, unit.owner, order.x, order.y) : null;
    if (source) {
      // Hauling from a Drill or Siphon: keep going back while it can still produce or has stock.
      if (!(source.buffer > 0) && !(sourceTile(state, source)?.amount > 0)) retarget(state, unit);
      return;
    }
    if (order.resource && RARE_RESOURCES.includes(order.resource)) {
      // Picking up a rare deposit: go back while it has any left, else find another pile of the same kind.
      const deposit = depositAt(state, order.x, order.y);
      if (!deposit) retargetDeposit(state, unit, order.resource);
      return;
    }
    if (!tile || !(tile.amount > 0)) retarget(state, unit);
    return;
  }

  // toField, waiting or mining
  if (unit.carrying >= carry || flux >= carry || rare >= carry) {
    // Already full (for example re-ordered while carrying): deliver first.
    order.phase = "toCore";
    order.ticks = 0;
    return;
  }

  if (state.chain) {
    const source = chainSourceAt(state, unit.owner, order.x, order.y);
    if (source) {
      tickHaul(state, unit, order, source, carry);
      return;
    }
    const deposit = depositAt(state, order.x, order.y);
    if (deposit) {
      tickPick(state, unit, order, deposit, carry);
      return;
    }
    if (rare > 0) {
      order.phase = "toCore"; // holding a rare load with nowhere to pick more: bring it home
      order.ticks = 0;
      return;
    }
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

// A Worker next to its Core or Depot hands over what it carries (Shards or Flux, never both).
function deliverByHand(state, unit, sink) {
  if (!state.chain) {
    const amount = unit.carrying;
    state.shards[unit.owner] += amount;
    unit.carrying = 0;
    emit(state, { e: "deliver", id: unit.id, amount, shards: state.shards[unit.owner] });
    return;
  }
  const flux = unit.carryingFlux || 0;
  const rare = unit.carryingRare;
  let resource = "shards";
  let amount = unit.carrying;
  if (rare && rare.amount > 0) {
    resource = rare.resource;
    amount = rare.amount;
    delete unit.carryingRare;
  } else if (flux > 0) {
    resource = "flux";
    amount = flux;
    unit.carryingFlux = 0;
  } else {
    unit.carrying = 0;
  }
  credit(state, unit.owner, resource, amount);
  emit(state, {
    e: "deliver", id: unit.id, amount, resource, to: sink.kind,
    shards: state.shards[unit.owner], flux: state.flux[unit.owner],
    ...(RARE_RESOURCES.includes(resource) ? { rare: bankAmount(state, unit.owner, resource) } : {}),
  });
}

// Nearest deposit of one rare resource with anything left (ties lower y, then lower x), else idle.
function retargetDeposit(state, unit, resource) {
  let best = null;
  let bestD = Infinity;
  for (const d of state.chain.deposits) {
    if (d.resource !== resource || !(d.amount > 0)) continue;
    const dist = distance(unit, d);
    if (dist < bestD || (dist === bestD && (d.y < best.y || (d.y === best.y && d.x < best.x)))) {
      best = d;
      bestD = dist;
    }
  }
  if (!best) {
    setOrder(state, unit, null);
    return false;
  }
  setOrder(state, unit, { type: "gather", x: best.x, y: best.y, resource, phase: "toField", ticks: 0 });
  return true;
}

// A Worker picking a rare deposit off the ground: the same walk, mine and carry rhythm as Shards, with the load in
// unit.carryingRare = { resource, amount }. A Worker holding Shards or Flux drops those first.
function tickPick(state, unit, order, deposit, carry) {
  order.resource = deposit.resource;
  const rare = unit.carryingRare && unit.carryingRare.amount > 0 ? unit.carryingRare : null;
  if (unit.carrying > 0 || (unit.carryingFlux || 0) > 0 || (rare && rare.resource !== deposit.resource)) {
    order.phase = "toCore";
    order.ticks = 0;
    return;
  }
  if (distance(unit, deposit) > 1) {
    order.phase = "toField";
    order.ticks = 0;
    return;
  }
  if (order.phase !== "mining") {
    order.phase = "mining";
    order.ticks = 0;
    return;
  }
  order.ticks += 1;
  if (order.ticks < mineTicks()) return;
  const have = rare ? rare.amount : 0;
  const take = Math.min(carry - have, deposit.amount);
  deposit.amount -= take;
  unit.carryingRare = { resource: deposit.resource, amount: have + take };
  emit(state, { e: "mine", id: unit.id, x: deposit.x, y: deposit.y, resource: deposit.resource, amount: take, left: deposit.amount });
  if (deposit.amount <= 0) {
    removeDeposit(state, deposit);
    emit(state, { e: "deposit", id: deposit.id, x: deposit.x, y: deposit.y, resource: deposit.resource, amount: 0 });
  }
  order.phase = "toCore";
  order.ticks = 0;
}

// =============================================================================================
// Mining chain (TERRITORY.md §8). Everything below runs only when state.chain exists.
// =============================================================================================
//
//   enableChain(state, { factions, numbers, holds, isWater })   switch the chain on
//   stepChain(state)              one tick: Drills and Siphons mine, Tracks move loads, Presses make Alloy
//   layTrack(state, owner, x, y, { pay })   -> null or a reject reason
//   removeTrack(state, x, y) / breakTracksAt(state, tiles) / damageTrack(state, id, amount)   cuts, Quakes, combat
//   trackAt, drillStatus, trackStatus, pressStatus              for the HUD
//   flowSummary(state, side)      income per minute over the last 60 s (every resource) plus totals
//   bankAmount / creditResource   the one door to every bank (Drift drops, the Trading House)
//   addDeposit / depositAt        rare resources on the ground that Workers pick up (§12)
//   setChainMod(state, side, key, value)   research effects: drillSpeed, trackSpeed, buffer, pressOut
//   observeChain(state, player, { visible })   the copy an observation can embed
//
// Model. Drills (on a Shard tile) and Siphons (on a Vent) mine one unit every `drillTicks` ticks into a
// buffer (`buffer`, or `burrowBuffer` for the Burrow, whose Diggers compact ore into cubes). Workers given
// `gather` on the Drill's tile haul from the buffer instead of mining. A Drill next to an own Track tile
// that has a route pushes a load of `loadSize` onto it. Tracks live in state.chain.tracks (not in
// state.structures, so they never block movement); each tile passes one load every `tileTicks` ticks
// toward the nearest sink by hop count (Depot, Core or Press next to the line; ties by lower id). A tile
// the owner does not hold (opts.holds) takes twice as long. Coil Coils cross water at half speed; Burrow
// Runs stop under water but, being underground, are not cut by an enemy standing on them. A Press takes
// Shard and Flux loads into input buffers and turns `pressIn` (2 S + 1 F) into 1 Alloy every `pressTicks`.

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Fallback numbers (TERRITORY.md §8), used only for anything STATS.economy / STATS.factions does not give.
// chainStats() reads the stats table first, so balance lives in env/stats.mjs.
export const CHAIN_DEFAULTS = deepFreeze({
  ticksPerSecond: 24,
  handCarry: 5,          // a Worker's hand-mining load (was 10 in v2)
  loadSize: 5,           // one load on a Track line
  drillTicks: 12,        // a Drill or Siphon mines one unit every 12 ticks: 2 a second
  buffer: 20,            // a Drill or Siphon holds this much
  burrowBuffer: 30,      // the Burrow's cube buffers
  tileTicks: 24,         // a Track tile passes one load per second
  unheldSpeed: 0.5,      // a line through a Reach you don't hold
  waterSpeed: 0.5,       // a Snakenator Coil over Flood water
  pressTicks: 48,        // one Alloy every 2 seconds
  pressIn: { shards: 2, flux: 1 },
  pressOut: 1,           // Alloy per cycle (Twin Press makes 2)
  pressBuffer: 20,       // each Press input buffer
  flowWindowSeconds: 60,
  structures: {
    drill: { cost: 75, flux: 0, hp: 200, buildTicks: 30 },
    siphon: { cost: 75, flux: 0, hp: 300, buildTicks: 30 },
    depot: { cost: 100, flux: 0, hp: 300, buildTicks: 30 },
    press: { cost: 200, flux: 100, hp: 400, buildTicks: 50 },
    track: { cost: 5, flux: 0, hp: 50 },
  },
});

// The resources a bank can hold (TERRITORY.md §12): the basics, the refined one and the rare five. Shards, Flux and
// Alloy keep their own state arrays (state.shards, state.flux, state.alloy); the rare five live in state.rare[side].
export const BASIC_RESOURCES = Object.freeze(["shards", "flux", "alloy"]);
export const RARE_RESOURCES = Object.freeze(["glowmoss", "stormglass", "quakestone", "ironroot", "amberlight"]);
export const RESOURCES = Object.freeze([...BASIC_RESOURCES, ...RARE_RESOURCES]);

export const CHAIN_KINDS = Object.freeze(Object.keys(CHAIN_DEFAULTS.structures));
const SOURCE_KINDS = new Set(["drill", "siphon"]);
const SINK_KINDS = new Set(["core", "depot", "press"]);

// Reads the stats owner's tables (STATS.economy, STATS.factions, STATS.clock) into the chain's flat shape.
// Anything missing there falls back to CHAIN_DEFAULTS.
function statsNumbers() {
  const eco = STATS.economy;
  if (!eco) return {};
  const tps = STATS.clock?.ticksPerSecond;
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null);
  const recipe = eco.press?.recipe;
  const out = {
    ticksPerSecond: tps,
    handCarry: eco.hand?.carry,
    loadSize: eco.track?.loadSize,
    drillTicks: eco.drill?.mineEveryTicks,
    buffer: pick(STATS.factions?.coil?.buffer, eco.drill?.buffer),
    burrowBuffer: STATS.factions?.burrow?.buffer,
    tileTicks: eco.track?.passEveryTicks,
    unheldSpeed: eco.track?.unheldSpeed,
    waterSpeed: STATS.factions?.coil?.trackWaterSpeed,
    pressTicks: recipe && tps ? Math.max(1, Math.round(recipe.seconds * tps)) : undefined,
    pressIn: recipe ? { shards: recipe.shards, flux: recipe.flux } : undefined,
    pressOut: recipe?.alloy,
    structures: {
      drill: structureRow(eco.drill),
      siphon: structureRow(eco.siphon),
      depot: structureRow(eco.depot),
      press: structureRow(eco.press),
      track: eco.track ? structureRow({ ...eco.track, cost: eco.track.costPerTile }) : undefined,
    },
  };
  return stripUndefined(out);
}

function structureRow(row) {
  if (!row) return undefined;
  return stripUndefined({ cost: row.cost, flux: row.flux, hp: row.hp, buildTicks: row.buildTicks });
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = stripUndefined(v);
      if (Object.keys(inner).length) out[k] = inner;
    } else out[k] = v;
  }
  return out;
}

// Hooks live outside the state so the state stays plain data: holds(state, owner, x, y) -> bool,
// isWater(state, x, y) -> bool. Defaults: everything held, nothing water.
const HOOKS = new WeakMap();
const DEFAULT_HOOKS = Object.freeze({ holds: () => true, isWater: () => false });
const hooksOf = (state) => HOOKS.get(state) || DEFAULT_HOOKS;

function mergeNumbers(base, over) {
  if (!over || typeof over !== "object") return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object"
      ? mergeNumbers(base[k], v)
      : v;
  }
  return out;
}

// The chain's numbers: CHAIN_DEFAULTS, overridden by the stats table (STATS.economy, STATS.factions, STATS.clock),
// overridden by the per-match `numbers` given to enableChain (tests and balance experiments).
let statsCache = null;
export function chainStats(state) {
  if (!statsCache) statsCache = mergeNumbers(CHAIN_DEFAULTS, statsNumbers());
  let s = statsCache;
  if (state && state.chain && state.chain.numbers && Object.keys(state.chain.numbers).length) {
    s = mergeNumbers(s, state.chain.numbers);
  }
  return s;
}

// The match's factions by default: STATS.factions.sides (a Snakenator mirror while the Burrow is parked), else the
// two-faction pairing. The sim wiring's state.factions overrides this at read time (factionOf).
function defaultFactions() {
  const sides = STATS.factions && STATS.factions.sides;
  return Array.isArray(sides) && sides.length >= 2 ? [sides[0], sides[1]] : ["coil", "burrow"];
}

// Where a chain structure may go, for the 'build' intercept (sim-territory) and the page's placement preview:
// null when (x, y) is fine for `kind`, else the reject reason. A Drill needs a Shard tile with Shards left, a Siphon
// a Vent with Flux left, a Depot or Press an open tile; none may sit on a unit, structure, Track or deposit.
export function placeReason(state, kind, x, y) {
  if (!state.chain) return "chain-off";
  if (!CHAIN_KINDS.includes(kind) || kind === "track") return "wrong-kind";
  if (!Number.isInteger(x) || !Number.isInteger(y)) return "bad-command";
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return "off-map";
  if (state.structures.some((s) => s.x === x && s.y === y)) return "tile-taken";
  if (state.units.some((u) => u.x === x && u.y === y && u.layer !== "air" && !u.inside)) return "tile-taken";
  if (trackAt(state, x, y) || depositAt(state, x, y)) return "tile-taken";
  const crystal = crystalAt(state, x, y);
  const vent = Array.isArray(state.vents) ? state.vents.find((v) => v.x === x && v.y === y) : null;
  if (kind === "drill") return crystal && crystal.amount > 0 ? null : "bad-target";
  if (kind === "siphon") return vent && vent.amount > 0 ? null : "bad-target";
  if (crystal || vent || state.rockSet.has(`${x},${y}`)) return "tile-taken";
  if (Array.isArray(state.obstacles) && state.obstacles.some((o) => o.x === x && o.y === y)) return "tile-taken";
  return null;
}

export function enableChain(state, opts = {}) {
  if (!state.chain) {
    state.chain = {
      factions: defaultFactions(),
      numbers: {},
      tracks: [],
      deposits: [],
      mods: [{}, {}],
      ledger: [newLedger(state), newLedger(state)],
    };
  }
  if (Array.isArray(opts.factions)) state.chain.factions = [opts.factions[0], opts.factions[1]];
  if (opts.numbers) state.chain.numbers = mergeNumbers(state.chain.numbers, opts.numbers);
  if (!Array.isArray(state.flux)) state.flux = [0, 0];
  if (!Array.isArray(state.alloy)) state.alloy = [0, 0];
  if (!Array.isArray(state.rare)) state.rare = [emptyRare(), emptyRare()];
  if (opts.holds || opts.isWater) setChainHooks(state, opts);
  return state.chain;
}

function emptyRare() {
  const bank = {};
  for (const r of RARE_RESOURCES) bank[r] = 0;
  return bank;
}

// Per-side multipliers the research owner sets when an upgrade finishes: drillSpeed (Drill Speed 1/2/3: 1.25,
// 1.5, 1.75), trackSpeed (Track Speed: 2), buffer (Bigger Buffers / Cube Press: 1.25), pressOut (Twin Press: 2).
export function setChainMod(state, side, key, value) {
  if (!state.chain) return;
  if (!state.chain.mods) state.chain.mods = [{}, {}];
  state.chain.mods[side][key] = value;
}
const modOf = (state, side, key) => {
  const v = state.chain.mods && state.chain.mods[side] ? state.chain.mods[side][key] : undefined;
  return typeof v === "number" && v > 0 ? v : 1;
};

export function setChainHooks(state, { holds, isWater } = {}) {
  const current = hooksOf(state);
  HOOKS.set(state, {
    holds: typeof holds === "function" ? holds : current.holds,
    isWater: typeof isWater === "function" ? isWater : current.isWater,
  });
}

// The match's factions win (state.factions, set by the sim wiring); the chain's own copy is the fallback.
const factionOf = (state, owner) =>
  (Array.isArray(state.factions) && state.factions[owner]) || (state.chain.factions && state.chain.factions[owner]) || "coil";
const bufferCap = (state, owner, cs) =>
  Math.round((factionOf(state, owner) === "burrow" ? cs.burrowBuffer : cs.buffer) * modOf(state, owner, "buffer"));
const secondOf = (state, cs) => Math.floor(state.tick / cs.ticksPerSecond);

// --- the flow ledger ---------------------------------------------------------------------------

function zeroPerResource() {
  const out = {};
  for (const r of RESOURCES) out[r] = 0;
  return out;
}

function newLedger(state) {
  const cs = chainStats(state);
  return { startSec: Math.floor((state.tick || 0) / cs.ticksPerSecond), total: zeroPerResource(), buckets: [] };
}

const isResource = (name) => RESOURCES.includes(name);

// How much of a resource one side holds (any of RESOURCES). Works whether or not the chain is on.
export function bankAmount(state, owner, resource) {
  if (resource === "shards") return state.shards[owner];
  if (resource === "flux") return Array.isArray(state.flux) ? state.flux[owner] : 0;
  if (resource === "alloy") return Array.isArray(state.alloy) ? state.alloy[owner] : 0;
  return Array.isArray(state.rare) && state.rare[owner] ? state.rare[owner][resource] || 0 : 0;
}

// Adds (or with a negative amount, takes) `amount` of a resource in a side's bank. Income (positive) is also written
// to the flow ledger. This is the one door for Drift drops (Glowmoss after a Flood, Ironroot from a held Mesa) and
// for the Trading House. Returns false for an unknown resource or an overdraw; nothing changes then.
export function creditResource(state, owner, resource, amount) {
  if (!state.chain || !isResource(resource) || !Number.isFinite(amount) || amount === 0) return false;
  if (amount < 0 && bankAmount(state, owner, resource) + amount < 0) return false;
  if (resource === "shards") state.shards[owner] += amount;
  else if (resource === "flux") state.flux[owner] += amount;
  else if (resource === "alloy") state.alloy[owner] += amount;
  else state.rare[owner][resource] += amount;
  if (amount > 0) recordIncome(state, owner, resource, amount);
  return true;
}

const credit = (state, owner, resource, amount) => creditResource(state, owner, resource, amount);

// One bucket per second of game time, kept for the flow window.
function recordIncome(state, owner, resource, amount) {
  const cs = chainStats(state);
  const ledger = state.chain.ledger[owner];
  ledger.total[resource] = (ledger.total[resource] || 0) + amount;
  const sec = secondOf(state, cs);
  const i = sec % cs.flowWindowSeconds;
  let bucket = ledger.buckets[i];
  if (!bucket || bucket.sec !== sec) {
    bucket = { sec };
    ledger.buckets[i] = bucket;
  }
  bucket[resource] = (bucket[resource] || 0) + amount;
}

// Income per minute over the last `flowWindowSeconds`, plus totals since the chain came on. `perMin` has every
// resource (the rare five included) and the three named rates are kept for the HUD. Rates are rounded whole
// numbers; `seconds` is how much of the window has elapsed.
export function flowSummary(state, side) {
  const zero = {
    shardsPerMin: 0, fluxPerMin: 0, alloyPerMin: 0, perMin: zeroPerResource(), total: zeroPerResource(), seconds: 0,
  };
  if (!state.chain) return zero;
  const cs = chainStats(state);
  const ledger = state.chain.ledger[side];
  const sec = secondOf(state, cs);
  const seconds = Math.max(0, Math.min(cs.flowWindowSeconds, sec - ledger.startSec));
  const sum = zeroPerResource();
  for (const b of ledger.buckets) {
    if (!b || b.sec < sec - (cs.flowWindowSeconds - 1)) continue;
    for (const r of RESOURCES) sum[r] += b[r] || 0;
  }
  const rate = (v) => (seconds > 0 ? Math.round((v / seconds) * 60) : 0);
  const perMin = {};
  for (const r of RESOURCES) perMin[r] = rate(sum[r]);
  return {
    shardsPerMin: perMin.shards,
    fluxPerMin: perMin.flux,
    alloyPerMin: perMin.alloy,
    perMin,
    total: { ...zeroPerResource(), ...ledger.total },
    seconds,
  };
}

// --- deposits: rare resources lying on the ground (TERRITORY.md §12) ---------------------------------

// A pile of a rare resource on a tile that Workers gather by hand like Shards (walk next to it, mine, carry
// `handCarry`, deliver to a Depot or Core). The Drift owner adds them: Stormglass along a Squall's path, Quakestone on
// the tiles a Quake changed, Glowmoss in a drained lowland, Amberlight in the Centre. A deposit on a tile that
// already has one of the same resource tops it up. Returns the deposit, or null for a bad tile or resource.
export function addDeposit(state, { x, y, resource, amount }) {
  if (!state.chain || !RARE_RESOURCES.includes(resource) || !(amount > 0)) return null;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
  let d = state.chain.deposits.find((p) => p.x === x && p.y === y);
  if (d && d.resource !== resource) return null;
  if (!d) {
    d = { id: allocId(state), x, y, resource, amount: 0 };
    state.chain.deposits.push(d);
  }
  d.amount += amount;
  emit(state, { e: "deposit", id: d.id, x, y, resource, amount: d.amount });
  return d;
}

export function depositAt(state, x, y) {
  if (!state.chain) return null;
  return state.chain.deposits.find((p) => p.x === x && p.y === y) || null;
}

function removeDeposit(state, deposit) {
  const i = state.chain.deposits.indexOf(deposit);
  if (i >= 0) state.chain.deposits.splice(i, 1);
}

// --- tracks ------------------------------------------------------------------------------------

export function trackAt(state, x, y) {
  if (!state.chain) return null;
  return state.chain.tracks.find((t) => t.x === x && t.y === y) || null;
}

function tileTaken(state, x, y) {
  if (state.rockSet.has(`${x},${y}`)) return true;
  if (state.crystals.some((c) => c.x === x && c.y === y)) return true;
  if (Array.isArray(state.vents) && state.vents.some((v) => v.x === x && v.y === y)) return true;
  if (state.structures.some((s) => s.x === x && s.y === y)) return true;
  if (Array.isArray(state.obstacles) && state.obstacles.some((o) => o.x === x && o.y === y)) return true;
  return trackAt(state, x, y) !== null;
}

// Lays one Track tile for `owner`. Instant and walkable; the caller (commands.mjs) checks that an own
// Worker stands next to it. Returns null when laid, else 'chain-off', 'off-map', 'tile-taken' or
// 'no-shards'. Pays the Track cost unless { pay: false }.
export function layTrack(state, owner, x, y, { pay = true } = {}) {
  if (!state.chain) return "chain-off";
  if (!Number.isInteger(x) || !Number.isInteger(y)) return "bad-command";
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return "off-map";
  if (tileTaken(state, x, y)) return "tile-taken";
  const cs = chainStats(state);
  const cost = cs.structures.track.cost;
  if (pay) {
    if (state.shards[owner] < cost) return "no-shards";
    state.shards[owner] -= cost;
    emit(state, { e: "spend", player: owner, amount: cost, shards: state.shards[owner] });
  }
  const track = { id: allocId(state), owner, x, y, hp: cs.structures.track.hp, load: null };
  state.chain.tracks.push(track);
  emit(state, { e: "track", id: track.id, owner, x, y });
  return null;
}

// Removes the Track at (x, y); any load on it is lost. Returns true when something was removed.
export function removeTrack(state, x, y) {
  if (!state.chain) return false;
  const i = state.chain.tracks.findIndex((t) => t.x === x && t.y === y);
  if (i < 0) return false;
  const [track] = state.chain.tracks.splice(i, 1);
  emit(state, { e: "track-cut", id: track.id, owner: track.owner, x, y, lost: track.load ? track.load.amount : 0 });
  return true;
}

// For Quakes, Floods that turn to rock, and combat: removes every Track on the given [x, y] tiles.
export function breakTracksAt(state, tiles) {
  let n = 0;
  for (const t of tiles || []) {
    const [x, y] = Array.isArray(t) ? t : [t.x, t.y];
    if (removeTrack(state, x, y)) n += 1;
  }
  return n;
}

// Damage a Track (combat owner's hook). At 0 hp it is removed. Returns the hp left, or 0.
export function damageTrack(state, id, amount) {
  if (!state.chain) return 0;
  const track = state.chain.tracks.find((t) => t.id === id);
  if (!track) return 0;
  track.hp -= amount;
  if (track.hp > 0) return track.hp;
  removeTrack(state, track.x, track.y);
  return 0;
}

const key = (x, y) => `${x},${y}`;
const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Routes for one owner's Track network: a Map from "x,y" to { dist, next, sink } where `next` is the
// track to move to (null when the load leaves the line into `sink`). Multi-source breadth-first search
// from every own track tile next to an own complete sink, sinks in id order so ties go to the lower id.
function routesFor(state, owner) {
  const own = new Map();
  for (const t of state.chain.tracks) if (t.owner === owner) own.set(key(t.x, t.y), t);
  const routes = new Map();
  const queue = [];
  const sinks = state.structures
    .filter((s) => s.owner === owner && s.complete && SINK_KINDS.has(s.kind))
    .sort((a, b) => a.id - b.id);
  for (const sink of sinks) {
    for (const [dx, dy] of NEIGHBOURS) {
      const k = key(sink.x + dx, sink.y + dy);
      const t = own.get(k);
      if (!t || routes.has(k)) continue;
      routes.set(k, { dist: 1, next: null, sink });
      queue.push(t);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    const here = routes.get(key(t.x, t.y));
    for (const [dx, dy] of NEIGHBOURS) {
      const k = key(t.x + dx, t.y + dy);
      const n = own.get(k);
      if (!n || routes.has(k)) continue;
      routes.set(k, { dist: here.dist + 1, next: t, sink: here.sink });
      queue.push(n);
    }
  }
  return routes;
}

// How one tile treats a load this tick: { ticks, speed, blocked, flooded }. Speed 1 is one load per second; a tile
// in a Reach the owner does not hold runs at cs.unheldSpeed, a Snakenator Coil over water at cs.waterSpeed; the
// Track Speed upgrade (mods.trackSpeed) multiplies the whole thing.
function tileRule(state, track, cs) {
  const hooks = hooksOf(state);
  const faction = factionOf(state, track.owner);
  let speed = modOf(state, track.owner, "trackSpeed");
  if (!hooks.holds(state, track.owner, track.x, track.y)) speed *= cs.unheldSpeed;
  const water = hooks.isWater(state, track.x, track.y);
  let flooded = false;
  if (water) {
    if (faction === "coil") speed *= cs.waterSpeed;
    else flooded = true;
  }
  let blocked = false;
  if (faction === "coil") {
    blocked = state.units.some((u) => u.owner !== track.owner && u.x === track.x && u.y === track.y && u.layer !== "air" && !u.inside);
  }
  return { ticks: Math.max(1, Math.round(cs.tileTicks / speed)), speed, blocked, flooded };
}

// Can `sink` take `amount` of `resource` right now? Returns how much it accepts. Depots and the Core take any
// resource; a Press takes only what its recipe uses.
function sinkAccepts(state, sink, resource, amount, cs) {
  if (sink.kind !== "press") return amount;
  if (!(cs.pressIn[resource] > 0)) return 0;
  pressInit(sink, cs);
  return Math.max(0, Math.min(amount, cs.pressBuffer - (sink.in[resource] || 0)));
}

function depositAtSink(state, track, sink, cs) {
  const load = track.load;
  const accepted = sinkAccepts(state, sink, load.resource, load.amount, cs);
  if (accepted <= 0) return false;
  if (sink.kind === "press") {
    sink.in[load.resource] += accepted;
  } else {
    credit(state, sink.owner, load.resource, accepted);
    emit(state, {
      e: "deliver", id: sink.id, amount: accepted, resource: load.resource, to: sink.kind, via: "track",
      shards: state.shards[sink.owner], flux: state.flux[sink.owner],
    });
  }
  load.amount -= accepted;
  if (load.amount <= 0) track.load = null;
  return true;
}

// --- sources: Drills and Siphons ---------------------------------------------------------------

function chainSourceAt(state, owner, x, y) {
  const s = state.structures.find((t) => t.x === x && t.y === y && SOURCE_KINDS.has(t.kind));
  return s && s.owner === owner && s.complete ? s : null;
}

// The resource tile a Drill or Siphon stands on (crystal for a Drill, vent for a Siphon), or null.
function sourceTile(state, source) {
  if (source.kind === "drill") return crystalAt(state, source.x, source.y);
  return Array.isArray(state.vents) ? state.vents.find((v) => v.x === source.x && v.y === source.y) || null : null;
}

const sourceResource = (source) => (source.kind === "siphon" ? "flux" : "shards");

// A Worker hauling from a Drill or Siphon: waits beside it until a full hand load is ready (or the
// tile is dry and the buffer holds what is left), then takes it in one go.
function tickHaul(state, unit, order, source, carry) {
  const resource = sourceResource(source);
  const flux = unit.carryingFlux || 0;
  if ((resource === "flux" && unit.carrying > 0) || (resource === "shards" && flux > 0)) {
    order.phase = "toCore"; // carrying the other resource: drop it first
    order.ticks = 0;
    return;
  }
  if (distance(unit, source) > 1) {
    order.phase = "toField";
    order.ticks = 0;
    return;
  }
  if (typeof source.buffer !== "number") source.buffer = 0;
  const have = resource === "flux" ? flux : unit.carrying;
  const want = carry - have;
  const tile = sourceTile(state, source);
  const dry = !(tile && tile.amount > 0);
  if (source.buffer <= 0 && dry) {
    retarget(state, unit);
    return;
  }
  if (source.buffer < want && !dry) {
    order.phase = "waiting";
    order.ticks += 1;
    return;
  }
  const take = Math.min(want, source.buffer);
  source.buffer -= take;
  if (resource === "flux") unit.carryingFlux = flux + take;
  else unit.carrying += take;
  emit(state, { e: "haul", id: unit.id, from: source.id, amount: take, resource, buffer: source.buffer });
  order.phase = "toCore";
  order.ticks = 0;
}

function tickSource(state, source, cs, routes) {
  if (!source.complete) return;
  if (typeof source.buffer !== "number") source.buffer = 0;
  if (typeof source.work !== "number") source.work = 0;
  const cap = bufferCap(state, source.owner, cs);
  const tile = sourceTile(state, source);
  const resource = sourceResource(source);

  // Mine one unit every drillTicks (faster with Drill Speed) while there is room and the tile has something left.
  if (tile && tile.amount > 0 && source.buffer < cap) {
    source.work += 1;
    if (source.work >= Math.max(1, Math.round(cs.drillTicks / modOf(state, source.owner, "drillSpeed")))) {
      source.work = 0;
      tile.amount -= 1;
      source.buffer += 1;
      emit(state, { e: "drill", id: source.id, resource, buffer: source.buffer, left: tile.amount });
    }
  }

  // Push a load onto the best adjacent own Track with a route and no load.
  const dry = !(tile && tile.amount > 0);
  if (source.buffer <= 0 || (source.buffer < cs.loadSize && !dry)) return;
  let best = null;
  let bestRoute = null;
  for (const [dx, dy] of NEIGHBOURS) {
    const x = source.x + dx, y = source.y + dy;
    const t = trackAt(state, x, y);
    if (!t || t.owner !== source.owner || t.load) continue;
    const r = routes.get(key(x, y));
    if (!r) continue;
    if (!best || r.dist < bestRoute.dist || (r.dist === bestRoute.dist && (y < best.y || (y === best.y && x < best.x)))) {
      best = t;
      bestRoute = r;
    }
  }
  if (!best) return;
  const amount = Math.min(cs.loadSize, source.buffer);
  source.buffer -= amount;
  best.load = { resource, amount, wait: 0 };
  emit(state, { e: "push", id: source.id, x: best.x, y: best.y, amount, resource });
}

// --- the Press ---------------------------------------------------------------------------------

function pressInit(press, cs) {
  if (!press.in || typeof press.in !== "object") press.in = {};
  for (const r of Object.keys(cs.pressIn)) if (typeof press.in[r] !== "number") press.in[r] = 0;
  if (typeof press.work !== "number") press.work = 0;
}

const pressShort = (press, cs) => Object.entries(cs.pressIn).filter(([r, n]) => (press.in[r] || 0) < n).map(([r]) => r);

function tickPress(state, press, cs) {
  if (!press.complete) return;
  pressInit(press, cs);
  if (pressShort(press, cs).length) return;
  press.work += 1;
  if (press.work < cs.pressTicks) return;
  press.work = 0;
  for (const [r, n] of Object.entries(cs.pressIn)) press.in[r] -= n;
  const made = Math.max(1, Math.round(cs.pressOut * modOf(state, press.owner, "pressOut")));
  credit(state, press.owner, "alloy", made);
  emit(state, { e: "press", id: press.id, made, alloy: state.alloy[press.owner], in: { ...press.in } });
}

// --- one tick ----------------------------------------------------------------------------------

export function stepChain(state) {
  if (!state.chain) return;
  const cs = chainStats(state);
  const routes = [routesFor(state, 0), routesFor(state, 1)];

  // 1. Loads move, nearest to the sink first so a touching chain of loads advances together. This runs
  //    before the sources push, so a load spends exactly `tileTicks` full ticks on the tile it lands on.
  for (const owner of state.tick % 2 === 0 ? [0, 1] : [1, 0]) {
    const r = routes[owner];
    const tracks = state.chain.tracks
      .filter((t) => t.owner === owner && t.load && r.has(key(t.x, t.y)))
      .map((t) => ({ t, route: r.get(key(t.x, t.y)) }))
      .sort((a, b) => a.route.dist - b.route.dist || (state.tick % 2 === 1 ? b.t.id - a.t.id : a.t.id - b.t.id));
    for (const { t, route } of tracks) {
      const rule = tileRule(state, t, cs);
      if (rule.blocked || rule.flooded) continue;
      t.load.wait += 1;
      if (t.load.wait < rule.ticks) continue;
      if (route.next === null) {
        depositAtSink(state, t, route.sink, cs);
        continue;
      }
      const next = route.next;
      if (next.load) continue;
      const nextRule = tileRule(state, next, cs);
      if (nextRule.blocked || nextRule.flooded) continue;
      next.load = { resource: t.load.resource, amount: t.load.amount, wait: 0 };
      t.load = null;
    }
  }

  // 2. Drills and Siphons mine and push loads (id order, flipped on odd ticks).
  for (const s of inIdOrder(state, state.structures)) {
    if (SOURCE_KINDS.has(s.kind) && s.owner >= 0 && s.owner <= 1) tickSource(state, s, cs, routes[s.owner]);
  }

  // 3. Presses refine.
  for (const s of inIdOrder(state, state.structures)) {
    if (s.kind === "press") tickPress(state, s, cs);
  }
}

// --- status for the HUD ------------------------------------------------------------------------

// { buffer, cap, resource, state } with state: incomplete | dry | full | mining.
export function drillStatus(state, id) {
  if (!state.chain) return null;
  const s = state.structures.find((t) => t.id === id && SOURCE_KINDS.has(t.kind));
  if (!s) return null;
  const cs = chainStats(state);
  const cap = bufferCap(state, s.owner, cs);
  const buffer = s.buffer || 0;
  const tile = sourceTile(state, s);
  let status = "mining";
  if (!s.complete) status = "incomplete";
  else if (buffer >= cap) status = "full";
  else if (!(tile && tile.amount > 0)) status = "dry";
  return { id, buffer, cap, resource: sourceResource(s), left: tile ? tile.amount : 0, state: status };
}

// { owner, load, dist, speed, state } with state: no-route | blocked | flooded | full | running.
export function trackStatus(state, x, y) {
  const t = trackAt(state, x, y);
  if (!t) return null;
  const cs = chainStats(state);
  const route = routesFor(state, t.owner).get(key(x, y)) || null;
  const rule = tileRule(state, t, cs);
  let status = "running";
  if (!route) status = "no-route";
  else if (rule.blocked) status = "blocked";
  else if (rule.flooded) status = "flooded";
  else if (t.load && t.load.wait >= rule.ticks) {
    const stuck = route.next === null
      ? sinkAccepts(state, route.sink, t.load.resource, t.load.amount, cs) <= 0
      : route.next.load !== null;
    if (stuck) status = "full";
  }
  return {
    id: t.id, owner: t.owner, x, y, hp: t.hp, load: t.load ? { ...t.load } : null,
    dist: route ? route.dist : null, speed: rule.speed, state: status,
  };
}

// { in, work, state, missing } with state: incomplete | starved | running.
export function pressStatus(state, id) {
  if (!state.chain) return null;
  const press = state.structures.find((s) => s.id === id && s.kind === "press");
  if (!press) return null;
  const cs = chainStats(state);
  pressInit(press, cs);
  const short = pressShort(press, cs);
  let status = "running";
  let missing = null;
  if (!press.complete) status = "incomplete";
  else if (short.length) {
    status = "starved";
    missing = short.length === Object.keys(cs.pressIn).length ? "both" : short[0];
  }
  return { id, in: { ...press.in }, work: press.work, ticks: cs.pressTicks, state: status, missing };
}

// --- observation -------------------------------------------------------------------------------

// The chain as one player may see it: a deep copy. Own Tracks always; enemy Tracks only where
// `visible(x, y)` says so (default: all). Own sources and presses carry their buffers and status.
export function observeChain(state, player, { visible = () => true } = {}) {
  if (!state.chain) return null;
  const tracks = state.chain.tracks
    .filter((t) => t.owner === player || visible(t.x, t.y))
    .map((t) => ({ id: t.id, owner: t.owner, x: t.x, y: t.y, hp: t.hp, load: t.owner === player && t.load ? { ...t.load } : null }));
  const sources = state.structures
    .filter((s) => s.owner === player && SOURCE_KINDS.has(s.kind))
    .map((s) => drillStatus(state, s.id));
  const presses = state.structures
    .filter((s) => s.owner === player && s.kind === "press")
    .map((s) => pressStatus(state, s.id));
  const deposits = state.chain.deposits
    .filter((d) => visible(d.x, d.y))
    .map((d) => ({ id: d.id, x: d.x, y: d.y, resource: d.resource, amount: d.amount }));
  return {
    factions: [factionOf(state, 0), factionOf(state, 1)],
    flux: [state.flux[0], state.flux[1]],
    alloy: [state.alloy[0], state.alloy[1]],
    rare: [{ ...state.rare[0] }, { ...state.rare[1] }],
    tracks,
    deposits,
    sources,
    presses,
    flow: flowSummary(state, player),
  };
}
