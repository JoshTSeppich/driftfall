// In-game teaching (TERRITORY.md section 13): button text, idle workers, first-3-minutes coach, alerts, hotkey grid.
// Owner: sonnet. Pure helpers, no DOM: app.mjs / command-card.mjs / hud.mjs call these and place the strings.
import { STATS } from '../env/stats.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// One plain sentence per thing you can press. Unknown kinds fall back to a safe line, never to "undefined".
const KIND_LINE = Object.freeze({
  worker: 'Hauls wheat and builds your buildings.',
  grunt: 'A cheap, sturdy fighter for the front line.',
  lancer: 'Hits from a distance, so keep it behind your grunts.',
  brute: 'A slow heavy hitter that is good against buildings.',
  forge: 'The Assembly Line: trains your fighting toasters.',
  mill: 'Grinds wheat into flour for the Toaster.',
  well: 'Draws water for the Toaster. Build it near the river.',
  toaster: 'Turns flour + water + power into toast, the ammo your toasters fire.',
  turret: 'Guards a spot by shooting enemies that come near.',
  core: 'Your Power Strip: home base, it trains Crumbs and takes in wheat.',
  depot: 'Drop-off point so Workers walk less.',
  drill: 'Mines a wheat patch by itself.',
  siphon: 'Pulls Flux from a vent by itself.',
  press: 'Presses wheat into plates.',
  tradinghouse: 'Buy and sell resources at prices that follow scarcity.',
});
const ACTION_LINE = Object.freeze({
  amove: 'Walk to a spot and fight anything on the way; then click it.',
  stop: 'Stop all orders.',
  hold: 'Stand still and only shoot what comes in range.',
  move: 'Walk to a spot without fighting; then click it.',
  rally: 'New units walk to the spot you click.',
  idle: 'Select the next Worker that has nothing to do.',
  recall: 'Bring a fallen veteran back from the Nest with its rank and items.',
});

/** Everything a button shows: { key, cost, sentence, title }. prices: live market prices by kind, overrides entry.cost. */
export function describe(entry, { prices = {} } = {}) {
  const key = String(entry.key ?? '').toUpperCase();
  const cost = prices[entry.kind] ?? entry.cost;
  const name = cap(entry.label ?? entry.kind ?? entry.action);
  const sentence = (entry.kind && KIND_LINE[entry.kind])
    || ACTION_LINE[entry.action]
    || (entry.action === 'build' ? `Build a ${name}.` : entry.action === 'train' ? `Train a ${name}.` : `${name}.`);
  const verb = entry.action === 'build' ? 'Build ' : entry.action === 'train' ? 'Train ' : '';
  const price = cost !== undefined ? `, ${cost} Wheat` : '';
  const how = entry.action === 'build' ? ' Then click a free spot.' : '';
  return { key, cost, sentence, title: `${verb}${name} (${key})${price}. ${sentence}${how}` };
}

// Idle workers ----------------------------------------------------------------------------------------------------
export const IDLE_KEY = '.';

export function idleWorkers(snap, side) {
  return snap.units.filter((u) => u.owner === side && u.kind === 'worker' && !u.order);
}

/** The next idle Worker after the one picked last (memo.last); wraps. Null when none. */
export function nextIdleWorker(snap, side, memo = {}) {
  const idle = idleWorkers(snap, side).sort((a, b) => a.id - b.id);
  if (!idle.length) return null;
  const pick = idle.find((u) => u.id > (memo.last ?? -Infinity)) ?? idle[0];
  memo.last = pick.id;
  return pick;
}

export function idleButtonHtml(count) {
  if (!count) return '';
  return `<button class="idle-btn" data-action="idle" title="${esc(`Idle Crumbs: ${count}. ${ACTION_LINE.idle} (${IDLE_KEY})`)}">`
    + `<kbd>${IDLE_KEY}</kbd> Idle Crumbs <b>${count}</b> (${IDLE_KEY})</button>`;
}

// First-3-minutes coach ---------------------------------------------------------------------------------------------
export const COACH_WINDOW_TICKS = 180 * 24;

const mine = (list, side) => list.filter((e) => e.owner === side);
const ARMY = new Set(['grunt', 'lancer', 'brute']);
const key = (c, kind, fallback) => String(c.ctx.keys?.[kind] ?? fallback).toUpperCase();

// Ordered; the first rule that is not finished and wants to show wins. finished() latches the rule off for good.
const RULES = [
  { id: 'select-worker', finished: (c) => c.ctx.selected?.some((e) => e.kind === 'worker'),
    show: () => true, text: () => 'Click a Crumb, or drag a box around your units, to select them.' },
  { id: 'train-worker', finished: (c) => c.workers.length >= 4 || c.cores.some((s) => s.queue.length),
    show: (c) => c.cores.some((s) => s.complete && !s.queue.length) && c.snap.shards[c.side] >= (STATS.units.worker?.cost ?? 50),
    text: (c) => `Click your Power Strip, then press ${key(c, 'worker', 'W')} to train a Crumb.` },
  { id: 'build-forge', finished: (c) => c.structs.some((s) => s.kind === 'forge'),
    show: (c) => c.snap.shards[c.side] >= (STATS.structures.forge?.cost ?? 100),
    text: (c) => `Select a Worker, press ${key(c, 'forge', 'F')}, then click open ground to build an Assembly Line.` },
  { id: 'train-army', finished: (c) => c.army.length >= 4,
    show: (c) => c.structs.some((s) => s.kind === 'forge' && s.complete) && c.army.length < 4 && c.snap.shards[c.side] >= (STATS.units.grunt?.cost ?? 50),
    text: () => 'Click your Assembly Line and train toasters; they defend your base. They need toast to fire.' },
  { id: 'idle-worker', finished: () => false,
    show: (c) => c.snap.tick >= 30 * c.tps && idleWorkers(c.snap, c.side).length > 0,
    text: () => `A Crumb is idle. Press ${IDLE_KEY} to select it, then right-click wheat to haul it.` },
  { id: 'attack', finished: () => false,
    show: (c) => c.snap.tick >= 100 * c.tps && c.army.length >= 4,
    text: () => 'Select your army, press A, then click the enemy base to attack.' },
];

/**
 * Short contextual prompts for the first 3 minutes, one at a time, never a tutorial screen.
 * next(snap, ctx) returns { id, text } or null; ctx = { selected: entities, keys: { worker:'w', forge:'f' } }.
 * The page calls done(id) once the prompt has been up long enough; a done prompt never returns.
 */
export function createCoach({ side = 0, tps = 24 } = {}) {
  const finished = new Set();
  return {
    next(snap, ctx = {}) {
      if (snap.tick > COACH_WINDOW_TICKS) return null;
      const structs = mine(snap.structures, side);
      const units = mine(snap.units, side);
      const c = { snap, ctx, side, tps, structs, cores: structs.filter((s) => s.kind === 'core'),
        workers: units.filter((u) => u.kind === 'worker'), army: units.filter((u) => ARMY.has(u.kind)) };
      for (const r of RULES) {
        if (finished.has(r.id)) continue;
        if (r.finished(c)) { finished.add(r.id); continue; }
        if (r.show(c)) return { id: r.id, text: r.text(c) };
      }
      return null;
    },
    done(id) { finished.add(id); },
  };
}

// Alerts with a jump-to key ----------------------------------------------------------------------------------------
export const JUMP_KEY = 'Space';

/** Recent alerts. Space jumps to the newest, Shift-Space walks back through older ones (wraps). */
export function createAlerts({ tps = 24, keep = 8, freshSecs = 8, mergeSecs = 3, mergeTiles = 6 } = {}) {
  const items = [];
  let cursor = -1;
  return {
    push(a) {
      const last = items.find((x) => x.text === a.text && a.tick - x.tick <= mergeSecs * tps && Math.hypot(a.x - x.x, a.y - x.y) <= mergeTiles);
      if (last) Object.assign(last, a); else items.push({ ...a });
      items.sort((p, q) => p.tick - q.tick);
      while (items.length > keep) items.shift();
      cursor = -1;
    },
    list() { return items.map((x) => ({ ...x })); },
    jump({ older = false } = {}) {
      if (!items.length) return null;
      cursor = older ? (cursor + 1) % items.length : 0;
      return { ...items[items.length - 1 - cursor] };
    },
    html(tick) {
      const fresh = items.filter((x) => tick - x.tick < freshSecs * tps).slice(-3).reverse();
      return fresh.map((x, i) => `<span class="alert">${esc(x.text)}${i === 0 ? ` (${JUMP_KEY})` : ''}</span>`).join('');
    },
  };
}

// Fixed hotkey grid -------------------------------------------------------------------------------------------------
// Same cells as GRID in command-card.mjs (a test pins the two together); copied so the files do not import each other.
export const GRID_CELLS = Object.freeze('qwerasdfzxcv'.split(''));

/** Check a command card against the fixed 4x3 grid: keys that are off it, and keys used twice. */
export function gridAudit(card) {
  const off = [], dupes = [], seen = new Set();
  for (const e of card) {
    if (!GRID_CELLS.includes(e.key)) off.push(e.key);
    if (seen.has(e.key)) dupes.push(e.key);
    seen.add(e.key);
  }
  return { ok: !off.length && !dupes.length, off, dupes };
}
