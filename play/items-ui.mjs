// Items, ranks and Recall on the live page (TERRITORY s14). Pure HTML helpers: data in, HTML string out. No DOM.
// Owner: haiku (Classic HUD). Item numbers live in env/stats.mjs; the words here are display text only.

export const SLOT_COUNT = 2;
const RECALL_KEYS = Object.freeze(['x', 'c', 'v']);

// The nine item ids from TERRITORY s14, with the names and one-line tooltips a player reads.
export const ITEMS = Object.freeze({
  'fang-polish': { name: 'Fang Polish', text: 'Sharper claws: more damage on every hit.' },
  'scale-plating': { name: 'Scale Plating', text: 'Plates over the hide: more armour.' },
  'crystal-monocle': { name: 'Crystal Monocle', text: 'A lens that sees further and reaches further.' },
  'rattle-bell': { name: 'Rattle Bell', text: 'Nearby allies attack faster while it rings.' },
  'molting-charm': { name: 'Molting Charm', text: 'The first Recall of this unit costs nothing.' },
  'glowmoss-pouch': { name: 'Glowmoss Pouch', text: 'Slowly heals its carrier when it is out of a fight.' },
  'stormglass-shard': { name: 'Stormglass Shard', text: 'The first hit of each fight stuns the target for half a second.' },
  'ironroot-brace': { name: 'Ironroot Brace', text: 'Its carrier cannot be pushed or slowed.' },
  'amberlight-tooth': { name: 'Amberlight Tooth', text: 'A rare tooth: adds one rank at once.' },
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** What a player reads about an item. An unknown id still shows, so a new item never breaks the panel. */
export function itemInfo(id) {
  return ITEMS[id] ?? { name: String(id), text: 'Unknown item.' };
}

/**
 * The two item slots on a unit's portrait. A filled slot shows the item's initial, and its tooltip gives the name and
 * sentence. An empty slot says how to fill it.
 */
export function slotsHtml(unit) {
  const items = unit?.items ?? [];
  const cells = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const id = items[i];
    if (id) {
      const info = itemInfo(id);
      cells.push(`<button class="slot" data-slot="${i}" data-item="${esc(id)}" title="${esc(info.name)}: ${esc(info.text)}">${esc(info.name.slice(0, 1))}</button>`);
    } else {
      cells.push(`<span class="slot empty" data-slot="${i}" title="Empty slot. Walk over an item on the ground to pick it up.">+</span>`);
    }
  }
  return `<div class="item-slots">${cells.join('')}</div>`;
}

/** Rank as stars: nothing at rank 0, one to three stars at ranks 1 to 3. */
export function rankStars(rank) {
  const r = Math.max(0, Math.min(3, Math.floor(Number(rank)) || 0));
  return r ? `<span class="rank" title="Rank ${r} of 3: earned from kills and fights survived">${'★'.repeat(r)}</span>` : '';
}

/**
 * Recall buttons for the command card: one per Shed Skin of mine waiting at the Nest, up to three. Each costs half
 * the unit's price. Empty when nothing waits, so the card looks as it always did.
 */
export function recallEntries(state, side) {
  const waiting = Array.isArray(state?.shedSkins) ? state.shedSkins.filter((s) => s && s.owner === side) : [];
  return waiting.slice(0, RECALL_KEYS.length).map((s, i) => ({
    key: RECALL_KEYS[i], label: 'Recall', action: 'recall', shed: s.id, cost: Math.ceil((s.cost ?? 0) / 2),
  }));
}

/** Add the Recall buttons to a card when the selection includes my Nest (the Core). Returns a new array. */
export function cardWithRecall(card, state, side, picked) {
  const atNest = picked.some((e) => e.kind === 'core' && e.owner === side);
  return atNest ? [...card, ...recallEntries(state, side)] : card;
}
