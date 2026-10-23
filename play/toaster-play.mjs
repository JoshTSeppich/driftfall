// Toaster Wars on the play page (Joshua 10-23: "I want to SEE Toaster Wars"). Owner: sonnet (Playable Client).
// Pure helpers, no DOM. The default page is the territory match on Wheatfield Valley with power, ammo, bakery, fences
// and wrap on; ?classic=1 keeps the old Driftfall Classic page. The top bar names the kitchen: Wheat, Flour, Water, Toast,
// Power. An ingredient that is missing (and would stop the Toaster) blinks. No Trading House goods panel: TERRITORY.md
// sections 18-20 have no toaster market, so the side panel is the tier readout only.
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { enableFences } from '../env/fence.mjs';
import { reachViews } from './reach-view.mjs';
import { driftBanner, activeCountdowns } from './drift-banner.mjs';
import { tierStatus, renderTier } from './tier-readout.mjs';
import { STATS } from '../env/stats.mjs';
import { observe } from '../env/state.mjs';
import { generateMap } from '../env/map.mjs';

export const PAGE_TITLE = 'TOASTER WARS';

/** Toaster Wars unless the page asks for ?classic=1. */
export const toasterMode = (q) => q.get('classic') !== '1';

/** The ready territory match: power cords, ammo, bakery on (createTerritoryMatch), plus fences and wrap. */
export function createToasterState(seed) {
  const state = createTerritoryMatch(seed);
  enableFences(state);
  state.power.wrap = true;
  return state;
}

/** { on, createState } for a page query. createState(seed) goes to createLiveMatch; undefined keeps the old match. */
export function toasterOptions(q) {
  const on = toasterMode(q);
  return { on, createState: on ? createToasterState : undefined };
}

/**
 * Hotkeys by toaster name, none on A S H M R P Q (Attack, Stop, Hold, Move, Rally, Pause). Buildings: F = Assembly Line
 * (the toaster production building), L = Heat Lamp, I = Mill, W = Well, T = Toaster. Trainees: C Crumb, O Popper, Z Zapper,
 * F Four-Slice, B Broiler, K Flak Popper, E Bagel.
 */
export const TOASTER_HOTKEYS = Object.freeze({
  forge: 'f', turret: 'l', mill: 'i', well: 'w', toaster: 't',
  worker: 'c', grunt: 'o', lancer: 'z', brute: 'f', howler: 'b', spiker: 'k', dart: 'e',
});
/** Extra createInput options for Toaster Wars. */
export const toasterInputOptions = () => ({ hotkeys: TOASTER_HOTKEYS });

/** The Wheatfield Valley map data for the terrain and the minimap, or null when the page runs another map (?map=). */
export function wheatfieldMap(seed, q) {
  const name = q.get('map') ?? 'wheatfield';
  return name === 'wheatfield' ? generateMap(seed, { map: 'wheatfield' }) : null;
}

const INGREDIENTS = Object.freeze([['flour', 'Flour'], ['water', 'Water']]);

/** Ingredients (flour, water) the side has none of in its pantry; the Toaster cannot bake without them. */
export function missingIngredients(state, side) {
  const p = state?.toast?.pantry?.[side];
  if (!p) return [];
  return INGREDIENTS.filter(([k]) => !(p[k] > 0)).map(([k]) => k);
}

const clockOf = (tick, tps) => { const s = Math.floor(tick / tps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Units of this side on a cord: plugged or on battery count as powered, 'down' is cut off.
function powerCount(state, side) {
  let on = 0, total = 0;
  for (const u of state.units) {
    if (u.owner !== side || !u.power) continue;
    total++;
    if (u.power.state !== 'down') on++;
  }
  return { on, total };
}

/**
 * The top strip: Wheat, Flour, Water, Toast, Power, Supply, clock, alert. Works on the live state (or an observation
 * with the same toast / power fields). A missing ingredient is `class="res blink"` with a title that says what to build.
 */
export function toasterTopBar(state, { side = 0, stats = STATS, tps = 24, alert = null, alertTicks = 6 * 24 } = {}) {
  const used = state.units.filter((u) => u.owner === side).length
    + state.structures.reduce((n, s) => n + (s.owner === side ? s.queue.length : 0), 0);
  const cap = stats.match.unitCap;
  const p = state.toast?.pantry?.[side] ?? { flour: 0, water: 0 };
  const stack = state.toast?.stack?.[side] ?? 0;
  const missing = new Set(missingIngredients(state, side));
  const hint = { flour: 'Build a Mill and haul wheat to it.', water: 'Build a Well near the river.' };
  const chip = (id, label, value, { blink = false, title = '' } = {}) =>
    `<span class="res${blink ? ' blink' : ''}" title="${esc(title)}">${label} <b id="${id}">${value}</b></span>`;
  const pw = powerCount(state, side);
  const cut = pw.total - pw.on;
  const fresh = alert && state.tick - alert.tick < alertTicks;
  return chip('shards', 'Wheat', state.shards[side], { title: 'Wheat: haul it with Crumbs; the Mill grinds it into flour.' })
    + chip('flour', 'Flour', p.flour, { blink: missing.has('flour'), title: missing.has('flour') ? `Flour is out. ${hint.flour}` : 'Flour from the Mill.' })
    + chip('water', 'Water', p.water, { blink: missing.has('water'), title: missing.has('water') ? `Water is out. ${hint.water}` : 'Water from the Well.' })
    + chip('toast', 'Toast', stack, { blink: stack <= 0, title: 'Toast is ammo: hungry toasters cannot fire.' })
    + chip('power', 'Power', pw.total ? `${pw.on}/${pw.total}` : 'on', { blink: cut > 0, title: cut > 0 ? `${cut} toaster(s) cut off from power; re-plug them with a Crumb.` : 'Every toaster is plugged in.' })
    + `<span class="res${used >= cap ? ' warn' : ''}" title="Supply: units and queued units / cap">Supply <b id="supply">${used}/${cap}</b></span>`
    + `<span class="res"><b id="clock">${clockOf(state.tick, tps)}</b></span>`
    + `<span id="alert">${fresh ? `${esc(alert.text)} (Space)` : ''}</span>`;
}

/** The side panel: Drift warnings and the tier readout. No flow rows in Flux/Alloy, no Trading House. */
export function toasterPanel(state, side) {
  if (!state?.territory) return '';
  reachViews(state.territory);
  const parts = [];
  const banner = driftBanner(state.drift?.events ?? [], state.tick, side);
  if (banner) parts.push(`<div class="drift ${banner.phase}"><b>${banner.title}</b></div>`);
  for (const c of activeCountdowns(state.drift?.events ?? [], state.tick, side)) parts.push(`<div class="drift timed">${c.label}${c.where ? ` ${c.where}` : ''}: ${c.secondsLeft} s left</div>`);
  const builtKinds = state.structures.filter((s) => s.owner === side && s.complete).map((s) => s.kind);
  parts.push(renderTier(tierStatus({ holds: state.territory.hold[side], builtKinds })));
  return parts.join('');
}

/**
 * observe() plus what the 3D toasters need to draw: each unit's power state and cord corners, the power points and the
 * ammo handle (hunger). observe() leaves these out, so without this the thick cords never reach the cord batch.
 */
export function observeToaster(state, side) {
  const snap = observe(state, side);
  if (!state.power) return snap;
  const byId = new Map(state.units.map((u) => [u.id, u]));
  for (const u of snap.units) {
    const p = byId.get(u.id)?.power;
    if (p) u.power = { state: p.state, anchor: p.anchor, cord: p.cord ? { pts: p.cord.pts.map((q) => ({ x: q.x, y: q.y })) } : undefined };
  }
  const view = state.power.view;
  snap.power = { view: view ? { points: view.points } : null, points: view?.points ?? state.power.points };
  snap.ammo = state.ammo;
  return snap;
}
