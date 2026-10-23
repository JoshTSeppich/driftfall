// The research card (TERRITORY.md section 6): one cell per upgrade with its cost, time and state. Pure helpers.
// Owner: haiku (Classic play UI). Upgrades come from STATS.upgrades once env/stats.mjs has the table; the card only
// lays them out. A click is handled by the app with data-research.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The upgrades a player can see: the shared ones and their own faction's. */
export function researchFor(upgrades, faction) {
  return upgrades.filter((u) => u.faction === 'shared' || u.faction === faction);
}

/**
 * 'done', 'busy' (researching now), 'locked' (its tier is not open, or the level below it is not done), 'poor' (not
 * enough Shards, Flux or Alloy) or 'ready'. ctx: { tier, shards, flux, alloy, done: [ids], busy: id or null }.
 */
export function researchState(u, { tier = 1, shards = 0, flux = 0, alloy = 0, done = [], busy = null } = {}) {
  if (done.includes(u.id)) return 'done';
  if (busy === u.id) return 'busy';
  if (u.tier > tier) return 'locked';
  if (u.requires && !done.includes(u.requires)) return 'locked';
  const c = u.cost ?? {};
  if (shards < (c.shards ?? 0) || flux < (c.flux ?? 0) || alloy < (c.alloy ?? 0)) return 'poor';
  return 'ready';
}

// "100/100" or "200/200/50A": Shards, Flux, and Alloy only when it is part of the cost.
export function costText(cost = {}) {
  const parts = [cost.shards ?? 0, cost.flux ?? 0].join('/');
  return cost.alloy ? `${parts}/${cost.alloy}A` : parts;
}

/** The card as HTML: one button per upgrade. Empty list gives an empty string. */
export function renderResearchCard(upgrades, ctx = {}) {
  return upgrades.map((u) => {
    const state = researchState(u, ctx);
    return `<button class="rs ${state}" data-research="${esc(u.id)}" title="${esc(u.effect ?? u.name)}">`
      + `<span class="rs-name">${esc(u.name)}</span>`
      + `<small>Tier ${u.tier} · ${costText(u.cost)} · ${u.seconds} s</small></button>`;
  }).join('');
}
