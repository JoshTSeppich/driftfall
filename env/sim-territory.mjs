// Driftfall — wiring of the territory rules into the sim (TERRITORY.md section 11). Owner: sonnet.
//
// Everything here is OFF unless the state carries the rule objects (state.territory, state.budget, state.drift).
// createMatch() makes none of them, so the default game is unchanged; createTerritoryMatch() makes all three.
// sim.mjs calls: applyRuleCommands (before the normal commands), stepRulesPre (before production) and
// stepRulesPost (after combat). Pure and deterministic: no clock, no randomness.

import { createInitialState, emit, allocId, isFree, distance } from './state.mjs';
import { enableBudget, stepBudget, canProgress } from './budget.mjs';
import { buildReaches, createTerritory, updateTerritory, holdCount } from './territory.mjs';
import { enableChain, layTrack } from './economy.mjs';
import { createDrift } from './drift.mjs';
import { enableMarket, stepMarket } from './market.mjs';
import { STATS, kindStats } from './stats.mjs';
import { applyDriftEffects, doTunnel, stepTunnels } from './effects.mjs';
import { kindTier, tierReason, enableResearch, doResearch, stepTiers, stepProductionGated } from './tiers.mjs';
import { enablePower, stepPower, doPlug, doPlaceCord, snapshotPower, enforceCords } from './power.mjs';

// Claim numbers: STATS.territory when the stats owner has landed it, TERRITORY.md section 3 otherwise.
const fromStats = STATS.territory || {};
export const TERRITORY_SIM = Object.freeze({
  claimCost: fromStats.claimCost ?? 100,
  claimTicks: fromStats.claimTicks ?? 480,
  claimHp: 300,
  // The two claim structures by faction; side 0 plays the Coil, side 1 the Burrow unless opts.factions says otherwise.
  kinds: Object.freeze({ coil: 'totem', burrow: 'mound' }),
});

export const claimCommand = (unit, reach) => ({ type: 'claim', unit, reach });

// A simple layout for any map size: each Core's Main, a Natural toward the middle, and the Centre.
// Point-mirrored like the real map, so both sides are fair. The 128 x 128 map brings its own layout (opts.layout).
export function defaultLayout(state) {
  const { width: W, height: H } = state;
  const cores = state.structures.filter((s) => s.kind === 'core').sort((a, b) => a.owner - b.owner);
  const c0 = cores[0], c1 = cores[1];
  const m = Math.max(4, Math.floor(Math.min(W, H) * 0.3));
  const nat = Math.floor(Math.min(W, H) * 0.35);
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2), q = Math.floor(Math.min(W, H) * 0.12);
  const reaches = [
    { id: 0, name: 'Main', role: 'main', side: 0, mirror: 3, centre: { x: c0.x, y: c0.y }, outline: rect(0, 0, m, m) },
    { id: 1, name: 'Natural', role: 'natural', side: 0, mirror: 4, centre: { x: m + Math.floor(nat / 2), y: Math.floor(nat / 2) }, outline: rect(m, 0, m + nat, nat) },
    { id: 2, name: 'Centre', role: 'centre', side: null, mirror: 2, centre: { x: cx, y: cy }, outline: rect(cx - q, cy - q, cx + q, cy + q) },
    { id: 3, name: 'Main', role: 'main', side: 1, mirror: 0, centre: { x: c1.x, y: c1.y }, outline: rect(W - m, H - m, W, H) },
    { id: 4, name: 'Natural', role: 'natural', side: 1, mirror: 1, centre: { x: W - 1 - (m + Math.floor(nat / 2)), y: H - 1 - Math.floor(nat / 2) }, outline: rect(W - m - nat, H - nat, W - m, H) },
  ];
  return { width: W, height: H, reaches };
}

/** A match with the budget, the territory rules and the Drift all switched on. */
export function createTerritoryMatch(seed, opts = {}) {
  const state = createInitialState(seed);
  if (!Array.isArray(state.events)) state.events = [];
  if (state.result === undefined) state.result = null;
  enableBudget(state, opts.budget || {});
  createTerritory(state, buildReaches(opts.layout || defaultLayout(state)), opts.rules || {});
  state.drift = createDrift(seed);
  state.claims = [];
  enableResearch(state);
  enableChain(state, { factions: state.factions, holds: heldBy, isWater: isWaterTile });
  enableMarket(state); // prices drift with scarcity; trading itself needs a Trading House (env/market.mjs)
  enablePower(state); // the cord is the leash (TERRITORY.md section 20, env/power.mjs)
  state.factions = opts.factions || ['coil', 'burrow'];
  return state;
}

// Hooks for the mining chain: a side "holds" a tile when it holds the Reach the tile is in; water is a flooded Reach.
const reachIdAt = (state, x, y) => state.territory.map.reachAt(x, y);
function heldBy(state, owner, x, y) {
  const id = reachIdAt(state, x, y);
  return id >= 0 && state.territory.reaches[id]?.holder === owner;
}
const isWaterTile = (state, x, y) => !!state.territory.flooded && state.territory.flooded.has(reachIdAt(state, x, y));
const holdOf = (state, side) => (state.holdOverride ? state.holdOverride(state, side) : holdCount(state, side));

export const rulesOn =(state) => !!(state && state.territory);

// ---------------------------------------------------------------------------------------------
// Commands: claim
// ---------------------------------------------------------------------------------------------

function nearestFree(state, reach, spot) {
  for (let d = 0; d <= 6; d++) {
    for (let y = spot.y - d; y <= spot.y + d; y++) {
      for (let x = spot.x - d; x <= spot.x + d; x++) {
        if (Math.max(Math.abs(x - spot.x), Math.abs(y - spot.y)) !== d) continue;
        if (state.territory.map.reachAt(x, y) !== reach.id) continue;
        if (!isFree(state, x, y)) continue;
        if (state.claims.some((c) => c.x === x && c.y === y)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

// Returns null when applied, else the reject reason (same vocabulary as commands.mjs).
function doClaim(state, player, c) {
  if (!Number.isInteger(c.reach)) return 'bad-command';
  const unit = typeof c.unit === 'number' ? state.units.find((u) => u.id === c.unit) : undefined;
  if (!unit) return 'no-such-unit';
  if (unit.owner !== player) return 'not-yours';
  if (unit.kind !== 'worker') return 'wrong-kind';
  const reach = state.territory.map.reaches.find((r) => r.id === c.reach);
  if (!reach) return 'bad-target';
  if (state.territory.reaches.find((r) => r.id === c.reach)?.claimedBy !== null) return 'tile-taken';
  if (state.claims.some((k) => k.reach === reach.id && !k.dead)) return 'tile-taken';
  if (state.shards[player] < TERRITORY_SIM.claimCost) return 'no-shards';
  const spot = nearestFree(state, reach, reach.claimSpot || reach.centre);
  if (!spot) return 'tile-taken';

  state.shards[player] -= TERRITORY_SIM.claimCost;
  emit(state, { e: 'spend', player, amount: TERRITORY_SIM.claimCost, shards: state.shards[player] });
  const kind = TERRITORY_SIM.kinds[state.factions[player]] || 'totem';
  const site = {
    id: allocId(state), owner: player, kind, reach: reach.id, x: spot.x, y: spot.y,
    hp: 1, progress: 0, complete: false, builder: unit.id,
  };
  state.claims.push(site);
  emit(state, { e: 'claim-site', site: { ...site } });
  unit.order = { type: 'move', x: spot.x, y: spot.y };
  emit(state, { e: 'order', id: unit.id, order: { ...unit.order } });
  return null;
}

// Training under the budget (TERRITORY.md section 9): the same checks as commands.mjs doTrain, minus the up-front
// charge and the unit cap. The cost is drawn gradually by stepBudget, into debt if the bank is empty.
function doBudgetTrain(state, player, c) {
  const building = typeof c.building === 'number' ? state.structures.find((s) => s.id === c.building) : undefined;
  if (!building) return 'bad-target';
  if (building.owner !== player) return 'not-yours';
  const trains = kindStats(building.kind)?.trains;
  if (!Array.isArray(trains) || !trains.includes(c.kind)) return 'wrong-kind';
  if (!building.complete) return 'not-complete';
  if (building.queue.length >= STATS.match.queueMax) return 'queue-full';
  building.queue.push(c.kind);
  emit(state, { e: 'queue', id: building.id, queue: [...building.queue] });
  return null;
}

// lay-track {unit, x, y}: an own Worker standing next to the tile; Track lines need the Hold in STATS.economy.track.
function doLayTrack(state, player, c) {
  const unit = typeof c.unit === 'number' ? state.units.find((u) => u.id === c.unit) : undefined;
  if (!unit) return 'no-such-unit';
  if (unit.owner !== player) return 'not-yours';
  if (unit.kind !== 'worker') return 'wrong-kind';
  if (!Number.isInteger(c.x) || !Number.isInteger(c.y)) return 'bad-command';
  if (holdOf(state, player) < (STATS.economy?.track?.hold ?? 2)) return 'tier-locked';
  if (distance(unit, c) > 1) return 'too-far';
  const reason = layTrack(state, player, c.x, c.y);
  return reason === 'chain-off' ? 'bad-command' : reason;
}

/** Take the rule commands (claim) out of one side's list and apply them. Returns the rest for commands.mjs. */
export function applyRuleCommands(state, player, commands) {
  if (!(rulesOn(state) || state.power) || !Array.isArray(commands)) return commands;
  const rest = [];
  for (const c of commands) {
    const type = c && typeof c === 'object' ? c.type : null;
    const mine = type === 'claim' || type === 'plug' || type === 'place-power' || type === 'tunnel' || (type === 'lay-track' && state.chain) || (type === 'research' && state.research) || (type === 'train' && state.budget);
    let reason = null;
    try {
      if (!mine && (type === 'train' || type === 'build')) reason = tierReason(state, player, kindTier(c.kind));
      else if (type === 'claim') reason = doClaim(state, player, c);
      else if (type === 'plug' && state.power) reason = doPlug(state, player, c);
      else if (type === 'place-power' && state.power) reason = doPlaceCord(state, player, c);
      else if (type === 'lay-track' && state.chain) reason = doLayTrack(state, player, c);
      else if (type === 'tunnel') reason = doTunnel(state, player, c);
      else if (type === 'research' && state.research) reason = doResearch(state, player, c);
      else if (type === 'train' && state.budget) reason = tierReason(state, player, kindTier(c.kind)) || doBudgetTrain(state, player, c);
    } catch { reason = 'bad-command'; }
    if (reason) emit(state, { e: 'reject', player, command: c, reason });
    if (!mine && !reason) rest.push(c);
  }
  return rest;
}

// ---------------------------------------------------------------------------------------------
// Per-tick steps
// ---------------------------------------------------------------------------------------------

function stepClaims(state) {
  for (const site of state.claims) {
    if (site.complete) continue;
    const builder = state.units.find((u) => u.id === site.builder && u.owner === site.owner);
    if (!builder || distance(builder, site) > 1) continue;
    if (!canProgress(state, site.owner, 'build')) continue;
    site.progress += 1;
    site.hp = Math.min(TERRITORY_SIM.claimHp, Math.max(1, Math.round((TERRITORY_SIM.claimHp * site.progress) / TERRITORY_SIM.claimTicks)));
    if (site.progress >= TERRITORY_SIM.claimTicks) {
      site.complete = true;
      site.hp = TERRITORY_SIM.claimHp;
      emit(state, { e: 'done', id: site.id });
    }
  }
}

function stepDrift(state) {
  const at = state.drift.step(state.tick);
  for (const ev of at.announce) emit(state, { e: 'drift-announce', id: ev.id, kind: ev.kind, tick: ev.tick, targets: ev.targets });
  for (const ev of at.apply) emit(state, { e: 'drift-apply', id: ev.id, kind: ev.kind, targets: ev.targets });
  for (const ev of at.expire) emit(state, { e: 'drift-expire', id: ev.id, kind: ev.kind });
  applyDriftEffects(state, at);
}

/** Before production: the Drift clock, the claim sites, then the budget draw (so a finishing unit is paid for). */
export function stepRulesPre(state) {
  if (state.drift) stepDrift(state);
  if (state.claims) stepClaims(state);
  stepTunnels(state);
  if (state.research) stepTiers(state);
  if (state.budget) stepBudget(state);
  if (state.power) { snapshotPower(state); stepPower(state); }
}

/** Production for this tick: the real stepProduction, minus structures a tier gate has paused. */
export function runProduction(state, stepProduction) {
  return state.research ? stepProductionGated(state, stepProduction) : stepProduction(state);
}

/** After combat: territory hold and the territory win. Returns a result or null. */
export function stepRulesPost(state) {
  if (state.power) enforceCords(state);
  if (state.market) stepMarket(state);
  return state.territory ? updateTerritory(state) : null;
}
