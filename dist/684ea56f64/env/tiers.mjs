// Driftfall — tiers gated by territory, and research queues (TERRITORY.md sections 5 and 6). Owner: sonnet.
// Only active when the state carries the territory rules (see sim-territory.mjs). Pure and deterministic.
//
// A tier needs a building AND land: tier 2 = Foundry or Sanctum and Hold >= 3, tier 3 = Hangar and Hold >= 6.
// Buildings that the current roster does not have yet (STATS.structures lacks them) do not block a tier, so the
// game stays playable while those structures are added; the Hold still counts.
// Dropping below the Hold a tier needs PAUSES its production and research (nothing is lost, nothing is drawn);
// they resume when the Hold returns.

import { STATS, upgradeById } from './stats.mjs';
import { holdCount } from './territory.mjs';
import { emit } from './state.mjs';
import { canProgress } from './budget.mjs';

export const TIER_RULES = Object.freeze({
  buildingsInGame: (kind) => Object.prototype.hasOwnProperty.call(STATS.structures, kind),
  researchQueueMax: 3,
});

const holdOf = (state, side) => (state.holdOverride ? state.holdOverride(state, side) : holdCount(state, side));

function tierMet(state, side, tier) {
  const t = STATS.tiers[tier];
  if (!t) return false;
  if (holdOf(state, side) < t.hold) return false;
  const needs = (t.needs || []).filter(TIER_RULES.buildingsInGame);
  if (needs.length === 0) return true;
  const has = (kind) => state.structures.some((s) => s.owner === side && s.kind === kind && s.complete);
  return t.needsAny ? needs.some(has) : needs.every(has);
}

/** The highest tier this side can use right now (1 always). */
export function sideTier(state, side) {
  let tier = 1;
  for (const n of [2, 3]) if (tierMet(state, side, n)) tier = n;
  return tier;
}

/** The tier a unit or structure kind belongs to (tier 1 when STATS.tiers does not list it). */
export function kindTier(kind) {
  for (const n of [3, 2]) if ((STATS.tiers[n]?.unlocks || []).includes(kind)) return n;
  return 1;
}

/** Why this side cannot use something of this tier, or null. */
export const tierReason = (state, side, tier) => (tier > sideTier(state, side) ? 'tier-locked' : null);

// ---------------------------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------------------------

export function enableResearch(state) {
  state.research = { done: [[], []] };
  if (!Array.isArray(state.flux)) state.flux = [0, 0];
  if (!Array.isArray(state.alloy)) state.alloy = [0, 0];
}

/** Returns null when queued, else the reject reason. */
export function doResearch(state, player, c) {
  const building = typeof c.building === 'number' ? state.structures.find((s) => s.id === c.building) : undefined;
  if (!building) return 'bad-target';
  if (building.owner !== player) return 'not-yours';
  if (!building.complete) return 'not-complete';
  const up = typeof c.upgrade === 'string' ? upgradeById(c.upgrade) : null;
  if (!up) return 'bad-target';
  if (up.faction !== 'shared' && up.faction !== state.factions?.[player]) return 'wrong-faction';
  if (state.research.done[player].includes(up.id)) return 'already-done';
  const queued = state.structures.some((s) => s.owner === player && (s.research || []).some((r) => r.upgrade === up.id));
  if (queued) return 'already-queued';
  const bad = tierReason(state, player, up.tier);
  if (bad) return bad;
  if (up.requires && !state.research.done[player].includes(up.requires)) return 'needs-earlier';
  if ((building.research || []).length >= TIER_RULES.researchQueueMax) return 'queue-full';
  const cost = up.cost;
  if (state.shards[player] < cost.shards) return 'no-shards';
  if (state.flux[player] < cost.flux) return 'no-flux';
  if (state.alloy[player] < (cost.alloy || 0)) return 'no-alloy';

  state.shards[player] -= cost.shards;
  state.flux[player] -= cost.flux;
  state.alloy[player] -= cost.alloy || 0;
  emit(state, { e: 'spend', player, amount: cost.shards, shards: state.shards[player] });
  (building.research ||= []).push({ upgrade: up.id, ticksLeft: up.ticks });
  emit(state, { e: 'research-queued', id: building.id, upgrade: up.id });
  return null;
}

// ---------------------------------------------------------------------------------------------
// Per-tick: set the paused flags, count research down.
// ---------------------------------------------------------------------------------------------

/** Sets structure.paused (production) and structure.researchPaused for the HUD; they gate the steps below. */
export function stepTiers(state) {
  for (const s of state.structures) {
    const head = s.complete && Array.isArray(s.queue) ? s.queue[0] : undefined;
    s.paused = head !== undefined && kindTier(head) > sideTier(state, s.owner);
    const r = s.research && s.research[0];
    s.researchPaused = !!r && (upgradeById(r.upgrade).tier > sideTier(state, s.owner) || !canProgress(state, s.owner, 'research'));
  }
  for (const s of state.structures) {
    const r = s.research && s.research[0];
    if (!r || s.researchPaused) continue;
    r.ticksLeft -= 1;
    if (r.ticksLeft <= 0) {
      s.research.shift();
      state.research.done[s.owner].push(r.upgrade);
      emit(state, { e: 'researched', player: s.owner, upgrade: r.upgrade });
    }
  }
}

/** Production with paused structures held back: run the real stepProduction on everything else. */
export function stepProductionGated(state, stepProduction) {
  if (!state.structures.some((s) => s.paused)) return stepProduction(state);
  const all = state.structures;
  state.structures = all.filter((s) => !s.paused);
  try {
    stepProduction(state);
  } finally {
    // Anything stepProduction added (nothing today) is kept; the paused ones go back in id order.
    state.structures = all.filter((s) => s.paused || state.structures.includes(s)).concat(state.structures.filter((s) => !all.includes(s)));
    state.structures.sort((a, b) => a.id - b.id);
  }
}
