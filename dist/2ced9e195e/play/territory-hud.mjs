// Glue for the territory readouts on the live page (NORTHSTAR priority 2). Pure: sim state in, HTML and Reach views out.
// Owner: sonnet (Playable Client). It only combines haiku's readouts: reach-view, drift-banner, tier-readout, flow-panel.
// Returns null when the match has no territory rules, so the plain game shows nothing new.
import { reachViews } from './reach-view.mjs';
import { driftBanner, activeCountdowns } from './drift-banner.mjs';
import { tierStatus, renderTier } from './tier-readout.mjs';
import { renderFlow } from './flow-panel.mjs';
import { flowSummary } from '../env/economy.mjs';
import { upkeepPerMinute } from '../env/budget.mjs';

export function territoryHud(state, side) {
  if (!state?.territory) return null;
  const views = reachViews(state.territory);
  const tick = state.tick;
  const events = state.drift?.events ?? [];
  const parts = [];
  const banner = driftBanner(events, tick, side);
  if (banner) parts.push(`<div class="drift ${banner.phase}"><b>${banner.title}</b></div>`);
  for (const c of activeCountdowns(events, tick, side)) parts.push(`<div class="drift timed">${c.label}${c.where ? ` ${c.where}` : ''}: ${c.secondsLeft} s left</div>`);
  const builtKinds = state.structures.filter((s) => s.owner === side && s.complete).map((s) => s.kind);
  parts.push(renderTier(tierStatus({ holds: state.territory.hold[side], builtKinds })));
  const flow = state.chain ? flowSummary(state, side) : null;
  const up = state.budget ? upkeepPerMinute(state, side) : { shards: 0, flux: 0 };
  parts.push(renderFlow({
    income: { shards: flow?.shardsPerMin ?? 0, flux: flow?.fluxPerMin ?? 0, alloy: flow?.alloyPerMin ?? 0 },
    upkeep: { shards: up.shards, flux: up.flux },
    bank: state.shards[side],
  }));
  return { views, html: parts.join('') };
}
