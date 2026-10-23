// Classic command card: a 4 by 3 grid of buttons, each with its hotkey, cost and a tooltip. Pure helpers, no DOM.
// Owner: haiku (Classic HUD). The card entries come from input.commandCard(snap); this file only lays them out.
import { kindName } from './hud.mjs';
import { iconHtml } from './icons.mjs';
import { describe } from './teach.mjs';

// The classic grid. A button whose hotkey is in the grid sits on that key's cell, so muscle memory works.
export const GRID = Object.freeze([
  Object.freeze(['q', 'w', 'e', 'r']),
  Object.freeze(['a', 's', 'd', 'f']),
  Object.freeze(['z', 'x', 'c', 'v']),
]);
export const GRID_KEYS = Object.freeze(GRID.flat());

/**
 * Put each card entry on its grid cell. Entries whose key is not on the grid take the first free cell, so nothing is lost.
 * Returns 12 cells, each { key, entry } or null for an empty cell.
 */
export function layoutCard(card) {
  const cells = new Array(GRID_KEYS.length).fill(null);
  const loose = [];
  for (const entry of card) {
    const at = GRID_KEYS.indexOf(entry.key);
    if (at >= 0 && cells[at] === null) cells[at] = entry;
    else loose.push(entry);
  }
  for (const entry of loose) {
    const free = cells.indexOf(null);
    if (free >= 0) cells[free] = entry;
  }
  return cells.map((entry, i) => (entry ? { key: GRID_KEYS[i], entry } : null));
}

/** Tooltip text for one entry: what it does, what it costs, its hotkey. */
export function tooltip(entry, opts) {
  return describe({ ...entry, label: entry.kind ? kindName(entry.kind) : entry.label }, opts).title;
}

/**
 * The card as HTML: twelve cells, empty ones blank. shards and mode come from the live state and input.ui.mode.
 * Buttons carry data-action, data-kind and data-key, so one click handler serves the whole card.
 */
export function renderCard(card, { shards = 0, mode = null } = {}) {
  return layoutCard(card).map((cell) => {
    if (!cell) return '<span class="cc empty" aria-hidden="true"></span>';
    const { key: cellKey, entry } = cell;
    const key = entry.key ?? cellKey; // show the key that really works, even when the button sits on another cell
    const poor = entry.cost !== undefined && shards < entry.cost;
    const active = !!mode && (mode.type === entry.action || (mode.type === 'place' && mode.kind === entry.kind));
    const name = entry.kind ? kindName(entry.kind) : entry.label; // once, in the proper name (the sim keeps 'forge' as an id)
    const pic = iconHtml(entry.kind ?? entry.action, name);
    const icon = pic.startsWith('<img') ? pic : ''; // no art: the label below is the button; never print it twice
    const cost = entry.cost !== undefined ? `<small>${entry.cost}</small>` : '';
    return `<button class="cc${poor ? ' poor' : ''}${active ? ' on' : ''}" data-action="${entry.action}" data-kind="${entry.kind ?? ''}" data-key="${key}" style="position:relative" title="${tooltip({ ...entry, key })}">`
      + `<kbd style="position:absolute;top:2px;right:2px">${key.toUpperCase()}</kbd>${icon}<span class="lbl">${name}</span>${cost}</button>`;
  }).join('');
}

/** A string that changes whenever the card's look changes; use it to skip re-rendering an unchanged card. */
export function cardSignature(card, { shards = 0, mode = null } = {}) {
  return JSON.stringify([card, shards, mode]);
}
