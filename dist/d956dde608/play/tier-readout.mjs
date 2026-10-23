// The tier and Hold readout (TERRITORY.md section 5). Pure: the caller passes the Hold count and the building kinds
// that stand. Owner: haiku (Classic play UI). The building comes first: a tier whose building stands is open, and
// while its Hold is short it is paused, shown in amber, until you hold enough again.
import { HEALTH } from '../viewer3d/palette.mjs';
import { STATS } from '../env/stats.mjs';

// The needs, read from STATS.tiers (TERRITORY.md section 5): a building (any of the list) and a Hold count.
export const TIER_NEEDS = Object.freeze(Object.fromEntries(
  Object.entries(STATS.tiers).map(([t, row]) => [t, Object.freeze({ hold: row.hold, buildings: Object.freeze([...row.needs]), anyOf: !!row.needsAny })]),
));

// A tier's building need: any one of the list when anyOf, else every one of them. No list means no building needed.
function hasBuildings({ buildings, anyOf }, builtKinds) {
  if (buildings.length === 0) return true;
  return anyOf ? buildings.some((k) => builtKinds.includes(k)) : buildings.every((k) => builtKinds.includes(k));
}

/**
 * tierStatus({ holds, builtKinds }) -> { tier, holds, paused, next }.
 * tier: the highest tier whose building stands (tier 1 always). paused: tiers unlocked but below their Hold.
 * next: the next tier with what it still needs { tier, hold, holdsLeft, buildings }, or null at the top.
 * waitingOn: the Hold the readout is waiting for (the highest paused tier's, else the next tier's), or null.
 */
export function tierStatus({ holds = 0, builtKinds = [], needs = TIER_NEEDS } = {}) {
  const tiers = Object.keys(needs).map(Number).sort((a, b) => a - b);
  const unlocked = tiers.filter((t) => hasBuildings(needs[t], builtKinds));
  const tier = unlocked.length ? unlocked[unlocked.length - 1] : 1;
  const paused = unlocked.filter((t) => holds < needs[t].hold);
  const above = tiers.find((t) => t > tier);
  const next = above === undefined ? null : {
    tier: above,
    hold: needs[above].hold,
    holdsLeft: Math.max(0, needs[above].hold - holds),
    buildings: needs[above].buildings,
  };
  const waitingOn = paused.length ? needs[paused[paused.length - 1]].hold : next?.hold ?? null;
  return { tier, holds, paused, next, waitingOn };
}

/** The readout line as HTML: "Tier 2  Hold 4 / 6 for Tier 3", with "paused" in amber when Hold has dropped. */
export function renderTier(status) {
  const { tier, holds, paused, next, waitingOn } = status;
  const hold = next ? `Hold ${holds} / ${next.hold} for Tier ${next.tier}` : waitingOn !== null ? `Hold ${holds} / ${waitingOn}` : `Hold ${holds}`;
  const pause = paused.length
    ? ` <span class="amber" style="color:${HEALTH.warn}">Tier ${paused.join(', ')} paused: Hold below its need</span>`
    : '';
  return `<div class="tier"><b>Tier ${tier}</b> <span class="hold">${hold}</span>${pause}</div>`;
}
