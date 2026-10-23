// Classic bottom HUD, pure render helpers: data in, HTML string out. No DOM access, so node can test them.
// Owner: haiku (Classic HUD). app.mjs decides where the strings go; the look is in play/index.html.
// Colours come from viewer3d/palette.mjs so the HUD matches the 3D world (TEAM, NEUTRAL, HEALTH).
import { TEAM, NEUTRAL, HEALTH } from '../viewer3d/palette.mjs';
import { portraitFor } from './icons.mjs';
import { slotsHtml, rankStars } from './items-ui.mjs';
import { STATS, toasterName } from '../env/stats.mjs';

// Toaster Wars names (TERRITORY.md section 16): the sim keeps its stable kind ids, the roster in env/stats.mjs names them.
export const KIND_NAME = Object.freeze(Object.fromEntries(
  ['worker', 'grunt', 'lancer', 'brute', 'howler', 'spiker', 'dart', 'core', 'forge', 'turret', 'mill', 'well', 'toaster']
    .map((k) => [k, toasterName(k)]),
));
export const kindName = (kind) => KIND_NAME[kind] ?? toasterName(kind);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isStructure = (kind, stats = STATS) => kind === 'core' || kind in stats.structures;

/** Max hp for a kind (units, structures and the Core). */
export function maxHp(kind, stats = STATS) {
  if (kind === 'core' && stats.toaster?.coreHp) return stats.toaster.coreHp; // the Power Strip of a Toaster Wars match
  return stats.units[kind]?.hp ?? stats.structures[kind]?.hp ?? stats.core?.hp ?? 0;
}

/** Health bar colour: green, then amber below warnBelow, then red below badBelow (palette HEALTH). */
export function hpColour(frac) {
  return frac < HEALTH.badBelow ? HEALTH.bad : frac < HEALTH.warnBelow ? HEALTH.warn : HEALTH.good;
}

/** A health bar as HTML. `small` is the compact bar used in multi-select cells. */
export function hpBar(hp, max, { small = false } = {}) {
  const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  return `<div class="bar${small ? ' sm' : ''}"><i style="width:${(frac * 100).toFixed(1)}%;background:${hpColour(frac)}"></i></div>`;
}

/**
 * Original portrait art: one simple shape per kind, team colour on top, drawn as inline SVG.
 * Nothing here is copied from any other game; it is our own silhouettes.
 */
export function portraitSvg(kind, owner, { size = 56, label } = {}) {
  const url = portraitFor(kind, owner);
  if (url) return `<svg class="portrait" viewBox="0 0 256 256" width="${size}" height="${size}" role="img" aria-label="${esc(label ?? kindName(kind))}"><image href="${esc(url)}" width="256" height="256"/></svg>`;
  const team = TEAM[owner] ?? NEUTRAL;
  const c = { main: team.main, dark: team.dark, light: team.light, deep: team.deep };
  const body = {
    worker: `<circle cx="32" cy="20" r="9" fill="${c.light}"/><rect x="21" y="32" width="22" height="20" rx="8" fill="${c.main}"/><path d="M43 42 L52 34" stroke="${c.dark}" stroke-width="4" stroke-linecap="round"/>`,
    grunt: `<rect x="13" y="13" width="38" height="40" rx="7" fill="${c.main}"/><rect x="21" y="23" width="8" height="6" fill="${c.dark}"/><rect x="35" y="23" width="8" height="6" fill="${c.dark}"/><rect x="18" y="38" width="28" height="4" fill="${c.dark}"/>`,
    lancer: `<path d="M22 54 L32 16 L42 54 Z" fill="${c.main}"/><path d="M32 16 L56 6" stroke="${c.light}" stroke-width="4" stroke-linecap="round"/>`,
    brute: `<polygon points="32,6 55,20 55,44 32,58 9,44 9,20" fill="${c.main}"/><polygon points="32,18 44,26 44,40 32,48 20,40 20,26" fill="${c.dark}"/>`,
    core: `<rect x="10" y="22" width="44" height="34" rx="4" fill="${c.main}"/><path d="M14 22 Q32 0 50 22 Z" fill="${c.light}"/><rect x="26" y="38" width="12" height="18" fill="${c.dark}"/>`,
    forge: `<rect x="10" y="26" width="40" height="30" fill="${c.main}"/><rect x="40" y="10" width="8" height="20" fill="${c.dark}"/><circle cx="26" cy="41" r="6" fill="${c.light}"/>`,
    turret: `<circle cx="32" cy="38" r="16" fill="${c.main}"/><rect x="30" y="31" width="24" height="9" fill="${c.light}"/><circle cx="32" cy="38" r="5" fill="${c.dark}"/>`,
  }[kind] ?? `<rect x="12" y="12" width="40" height="40" fill="${c.main}"/>`;
  const name = label ?? kindName(kind);
  return `<svg class="portrait" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${esc(name)}"><rect width="64" height="64" fill="${c.deep}"/>${body}</svg>`;
}

/**
 * The top strip: Shards, supply, clock and the alert line.
 * snap: the live state, alert: input.ui.alert or null, tick: current tick.
 */
export function renderTopBar(snap, { side, stats = STATS, tps = 24, alert = null, alertTicks = 6 * 24 } = {}) {
  const used = snap.units.filter((u) => u.owner === side).length
    + snap.structures.reduce((n, s) => n + (s.owner === side ? s.queue.length : 0), 0);
  const cap = stats.match.unitCap;
  const secs = Math.floor(snap.tick / tps);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const fresh = alert && snap.tick - alert.tick < alertTicks;
  return `<span class="res">Shards <b id="shards">${snap.shards[side]}</b></span>`
    + `<span class="res${used >= cap ? ' warn' : ''}" title="Supply: units and queued units / cap">Supply <b id="supply">${used}/${cap}</b></span>`
    + `<span class="res"><b id="clock">${clock}</b></span>`
    + `<span id="alert">${fresh ? `${esc(alert.text)} (Space)` : ''}</span>`;
}

/** The selection panel: nothing, one entity (portrait, hp, status, queue) or a grid of several units. */
export function renderSelectionPanel(snap, picked, { side, stats = STATS } = {}) {
  if (!picked.length) return '<span class="dim">Nothing selected. Drag a box, or click a unit.</span>';
  if (picked.length > 1) return renderMulti(picked, { side, stats });
  const e = picked[0];
  const max = maxHp(e.kind, stats);
  const foe = e.owner === side ? '' : ' <span class="foe">(enemy)</span>';
  const structure = isStructure(e.kind, stats);
  let status = '';
  let queue = '';
  if (structure && !e.complete) {
    const total = stats.structures[e.kind]?.buildTicks || 1;
    status = `Building ${Math.min(100, Math.floor((e.progress / total) * 100))}%`;
  } else if (structure) {
    status = e.queue.length ? `Training ${esc(kindName(e.queue[0]))}${e.queue.length > 1 ? ` (+${e.queue.length - 1} queued)` : ''}` : 'Idle';
    queue = e.queue.length ? `<div class="chips">${e.queue.map((k, i) => `<span${i === 0 ? ' class="on"' : ''}>${esc(kindName(k))}</span>`).join('')}</div>` : '';
  } else {
    status = e.carrying ? `Carrying ${e.carrying} wheat` : 'Idle';
  }
  // Units show their rank stars and two item slots; structures carry neither.
  const gear = structure ? '' : slotsHtml(e);
  return `<div class="sel-single">${portraitSvg(e.kind, e.owner, { size: 72 })}`
    + `<div class="sel-info"><b>${esc(kindName(e.kind))}</b>${foe}${structure ? '' : rankStars(e.rank)}`
    + `${hpBar(e.hp, max)}<span>${e.hp}/${max} HP</span>`
    + `<div class="status dim">${status}</div>${queue}${gear}</div></div>`;
}

function renderMulti(picked, { side, stats }) {
  const counts = {};
  for (const e of picked) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const chips = Object.entries(counts).map(([k, n]) => `<span>${esc(kindName(k))} ×${n}</span>`).join('');
  const cells = picked.map((e) => {
    const max = maxHp(e.kind, stats);
    const name = kindName(e.kind);
    const foe = e.owner === side ? '' : ' (enemy)';
    return `<button class="pick" data-pick="${e.id}" title="${esc(name + foe)} · ${e.hp}/${max} HP. Click to select only this one.">`
      + `${portraitSvg(e.kind, e.owner, { size: 40, label: name })}${hpBar(e.hp, max, { small: true })}</button>`;
  }).join('');
  return `<div class="sel-multi"><div><b>${picked.length} selected</b><div class="chips">${chips}</div></div>`
    + `<div class="picks">${cells}</div></div>`;
}
