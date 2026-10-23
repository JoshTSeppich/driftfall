// Driftfall Classic: input -> commands (owner: sonnet, Playable Client).
// Pure module: no DOM, no three.js, no clock. The page (play/app.mjs) feeds it clicks, boxes and keys in tile and
// screen terms; it keeps the selection, control groups, modes and per-unit order plans, and each tick returns the
// list of sim commands for this side (tick(state) -> commands).
//
// The sim understands only move / attack / gather / build / train / stop (ENV-SPEC section 10). The classic
// extras are done here, on top of those six, so they work today and can move into the sim later without the page
// changing:
//   attack-move (A, click)  walk to the point, attack anything that comes within ACQUIRE tiles, then carry on
//   hold position (H)       never chases: attacks only what is already in range, stops if it walks out of range
//   Shift-queue             orders after the current one; each starts when the unit goes idle
//   rally points            new units walk (or Workers mine) where the building's rally points
//
// `state` everywhere is an observation-shaped object: { tick, width, height, rocks, crystals, shards, units,
// structures }, as observe() in env/state.mjs returns. `stats` is the STATS table.

import { edgeVector } from './camera.mjs';

export const MAX_SELECT = 12;
export const ACQUIRE = 6;          // attack-move notices enemies this many tiles away
export const DOUBLE_MS = 400;      // double-click / double-tap window
const RESERVED_KEYS = new Set(['a', 's', 'h', 'm', 'r', 'p', 'q']);

const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const byId = (a, b) => a.id - b.id;

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------------

export function entityMap(state) {
  const m = new Map();
  for (const u of state.units) m.set(u.id, u);
  for (const s of state.structures) m.set(s.id, s);
  return m;
}

export function isStructure(state, e) {
  return state.structures.includes(e);
}

/** Hotkey letters for a list of kinds: first unused letter of the name, never one of the reserved command keys. */
export function assignHotkeys(kinds) {
  const used = new Set(RESERVED_KEYS);
  const out = {};
  for (const kind of kinds) {
    const pick = [...kind.toLowerCase()].find((c) => /[a-z]/.test(c) && !used.has(c))
      ?? 'abcdefghijklmnopqrstuvwxyz'.split('').find((c) => !used.has(c));
    used.add(pick);
    out[kind] = pick;
  }
  return out;
}

/** The entity under a screen point: the nearest projected unit/structure within `radius` px. Units beat structures. */
export function pickEntity(state, project, sx, sy, { radius = 22, structureRadius = 34 } = {}) {
  let best = null, bestD = Infinity;
  const consider = (e, r, bias) => {
    const p = project(e.x, e.y);
    const d = Math.hypot(p.sx - sx, p.sy - sy) + bias;
    if (d <= r + bias && d < bestD) { best = e; bestD = d; }
  };
  for (const s of state.structures) consider(s, structureRadius, 12);
  for (const u of state.units) consider(u, radius, 0);
  return best;
}

/** Own units whose projected centre falls inside the rectangle (sorted by id, capped at `max`). */
export function boxEntities(state, project, rect, side, max = MAX_SELECT) {
  const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
  const inside = state.units.filter((u) => {
    if (u.owner !== side) return false;
    const p = project(u.x, u.y);
    return p.sx >= x0 && p.sx <= x1 && p.sy >= y0 && p.sy <= y1;
  }).sort(byId);
  return inside.slice(0, max);
}

/** Free tiles around (x, y), nearest first, for spreading a group so units do not pile onto one tile. */
export function spreadTiles(state, x, y, count) {
  const taken = new Set(state.structures.map((s) => `${s.x},${s.y}`));
  const rocks = new Set(state.rocks.map(([rx, ry]) => `${rx},${ry}`));
  for (const c of state.crystals) taken.add(`${c.x},${c.y}`);
  const ok = (tx, ty) => tx >= 0 && ty >= 0 && tx < state.width && ty < state.height && !rocks.has(`${tx},${ty}`) && !taken.has(`${tx},${ty}`);
  const out = [];
  for (let r = 0; r < 12 && out.length < count; r++) {
    const ring = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && ok(x + dx, y + dy)) ring.push({ x: x + dx, y: y + dy });
    }
    ring.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || a.y - b.y || a.x - b.x);
    for (const t of ring) if (out.length < count) out.push(t);
  }
  return out;
}

/** Give each unit the nearest still-unused tile (greedy, in id order after sorting by distance to the target). */
export function assignTiles(units, tiles) {
  const free = tiles.slice();
  const out = new Map();
  for (const u of [...units].sort((a, b) => a.id - b.id)) {
    let bi = 0, bd = Infinity;
    free.forEach((t, i) => { const d = Math.hypot(t.x - u.x, t.y - u.y); if (d < bd) { bd = d; bi = i; } });
    out.set(u.id, free.splice(bi, 1)[0] ?? tiles[0]);
  }
  return out;
}

export function crystalAt(state, x, y) {
  return state.crystals.find((c) => c.x === x && c.y === y && c.amount > 0) ?? null;
}

/** Can `kind` be placed on (x, y) right now? { ok, reason }. Mirrors the sim's build checks (one tile). */
export function placeCheck(state, stats, side, kind, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.width || y >= state.height) return { ok: false, reason: 'off-map' };
  if (state.rocks.some(([rx, ry]) => rx === x && ry === y)) return { ok: false, reason: 'blocked' };
  if (state.crystals.some((c) => c.x === x && c.y === y)) return { ok: false, reason: 'blocked' };
  if (state.structures.some((s) => s.x === x && s.y === y)) return { ok: false, reason: 'blocked' };
  if (state.units.some((u) => u.x === x && u.y === y)) return { ok: false, reason: 'unit in the way' };
  const cost = stats.structures[kind]?.cost ?? Infinity;
  if (state.shards[side] < cost) return { ok: false, reason: 'not enough Shards' };
  return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------------------------------------------
// The input controller
// ---------------------------------------------------------------------------------------------------------------

export function createInput({ side = 0, stats }) {
  const trainable = (s) => stats.structures[s.kind]?.trains ?? (s.kind === 'core' ? stats.core?.trains : null) ?? [];
  const buildKinds = Object.keys(stats.structures).filter((k) => stats.structures[k].cost !== undefined && k !== 'core');
  const buildKeys = assignHotkeys(buildKinds);
  const keyForKind = (kinds) => assignHotkeys(kinds);

  const ui = {
    side,
    selection: [],                    // ids, in the order selected
    groups: {},                       // '1'..'9' -> [ids]
    mode: null,                       // null | { type: 'amove' | 'move' | 'rally' } | { type: 'place', kind }
    lastGroupKey: null, lastGroupAt: -Infinity,
    lastClickId: null, lastClickAt: -Infinity,
    alert: null,                      // { x, y, text, tick } for Space
    message: null,                    // { text, until } short toast for the page
    plans: new Map(),                 // unit id -> { queue, cur, hold, issuedAt, tries }
    rally: new Map(),                 // structure id -> { type: 'move' | 'gather', x, y }
    known: null,                      // unit ids seen so far (for rally)
    outbox: [],                       // one-shot commands (train, build) sent on the next tick
  };

  const toast = (text) => { ui.message = { text }; };

  function mine(state) {
    const m = entityMap(state);
    ui.selection = ui.selection.filter((id) => m.has(id));
    return ui.selection.map((id) => m.get(id));
  }
  function selectedUnits(state) { return mine(state).filter((e) => !isStructure(state, e) && e.owner === side); }
  function selectedStructures(state) { return mine(state).filter((e) => isStructure(state, e) && e.owner === side); }

  // Selection --------------------------------------------------------------------------------------------------
  function setSelection(ids, add = false) {
    const next = add ? [...ui.selection] : [];
    for (const id of ids) if (!next.includes(id)) next.push(id);
    ui.selection = next.slice(0, MAX_SELECT);
  }

  /** Left click on the world. `target` is the entity under the cursor or null. dblKey is `now` for double-click. */
  function clickSelect(state, project, size, target, { shift = false, now = 0 } = {}) {
    if (!target) { if (!shift) ui.selection = []; return; }
    const double = ui.lastClickId === target.id && now - ui.lastClickAt < DOUBLE_MS;
    ui.lastClickId = target.id; ui.lastClickAt = now;
    if (double && target.owner === side && !isStructure(state, target)) {
      const rect = { x0: 0, y0: 0, x1: size.width, y1: size.height };
      const same = boxEntities(state, project, rect, side, 999).filter((u) => u.kind === target.kind);
      setSelection(same.map((u) => u.id).slice(0, MAX_SELECT), shift);
      return;
    }
    if (shift && target.owner === side && !isStructure(state, target)) {
      const has = ui.selection.includes(target.id);
      ui.selection = has ? ui.selection.filter((id) => id !== target.id) : [...ui.selection, target.id].slice(0, MAX_SELECT);
      return;
    }
    setSelection([target.id]);
  }

  function boxSelect(state, project, rect, { shift = false } = {}) {
    const found = boxEntities(state, project, rect, side);
    if (!found.length && !shift) { ui.selection = []; return; }
    setSelection(found.map((u) => u.id), shift);
  }

  // Control groups ---------------------------------------------------------------------------------------------
  function setGroup(n, state) { ui.groups[n] = selectedUnits(state).concat(selectedStructures(state)).map((e) => e.id); }
  function recallGroup(n, state, now) {
    const m = entityMap(state);
    const ids = (ui.groups[n] ?? []).filter((id) => m.has(id));
    ui.groups[n] = ids;
    if (!ids.length) return null;
    ui.selection = ids.slice(0, MAX_SELECT);
    const twice = ui.lastGroupKey === n && now - ui.lastGroupAt < DOUBLE_MS;
    ui.lastGroupKey = n; ui.lastGroupAt = now;
    if (!twice) return null;
    const es = ids.map((id) => m.get(id));
    return { x: es.reduce((a, e) => a + e.x, 0) / es.length, y: es.reduce((a, e) => a + e.y, 0) / es.length };
  }

  // Orders (plans) ---------------------------------------------------------------------------------------------
  function planOf(id) {
    let p = ui.plans.get(id);
    if (!p) ui.plans.set(id, (p = { queue: [], cur: null, hold: false, issuedAt: -1, tries: 0 }));
    return p;
  }
  function give(ids, orderFor, shift) {
    for (const id of ids) {
      const order = orderFor(id);
      if (!order) continue;
      const p = planOf(id);
      p.hold = false;
      if (shift && (p.cur || p.queue.length)) p.queue.push(order);
      else { p.queue = [order]; p.cur = null; p.tries = 0; }
    }
  }

  /** Right click. `target` = { x, y (tile), entity?: picked entity }. Shift queues instead of replacing. */
  function rightClick(state, target, { shift = false } = {}) {
    ui.mode = null;
    const units = selectedUnits(state);
    const structs = selectedStructures(state);
    const e = target.entity ?? null;
    if (!units.length && structs.length) { // buildings: right-click sets the rally point
      for (const s of structs) setRally(state, s, target);
      return { kind: 'rally' };
    }
    if (!units.length) return { kind: 'none' };
    const ids = units.map((u) => u.id);
    if (e && e.owner !== side) { give(ids, () => ({ type: 'attack', target: e.id }), shift); return { kind: 'attack', target: e.id }; }
    const crystal = crystalAt(state, target.x, target.y);
    if (crystal) {
      const m = new Map(units.map((u) => [u.id, u]));
      give(ids, (id) => (m.get(id).kind === 'worker' ? { type: 'gather', x: crystal.x, y: crystal.y } : { type: 'move', x: target.x, y: target.y }), shift);
      return { kind: 'gather' };
    }
    spreadMove(state, units, target, 'move', shift);
    return { kind: 'move' };
  }

  function spreadMove(state, units, target, type, shift) {
    const tiles = assignTiles(units, spreadTiles(state, target.x, target.y, units.length));
    give(units.map((u) => u.id), (id) => { const t = tiles.get(id) ?? target; return { type, x: t.x, y: t.y }; }, shift);
  }

  function setRally(state, s, target) {
    const crystal = crystalAt(state, target.x, target.y);
    ui.rally.set(s.id, crystal ? { type: 'gather', x: crystal.x, y: crystal.y } : { type: 'move', x: target.x, y: target.y });
    toast(crystal ? 'Rally: mine here' : 'Rally point set');
  }

  /** Left click while a mode is armed (attack-move, move, rally, place). Returns true when it used the click. */
  function modeClick(state, target, { shift = false } = {}) {
    const mode = ui.mode;
    if (!mode) return false;
    if (mode.type === 'place') return place(state, target, shift);
    ui.mode = shift && mode.type !== 'rally' ? mode : null;
    const units = selectedUnits(state);
    if (mode.type === 'rally') { for (const s of selectedStructures(state)) setRally(state, s, target); return true; }
    if (!units.length) return true;
    if (mode.type === 'amove') {
      if (target.entity && target.entity.owner !== side) { give(units.map((u) => u.id), () => ({ type: 'attack', target: target.entity.id }), shift); return true; }
      spreadMove(state, units, target, 'amove', shift);
    } else spreadMove(state, units, target, 'move', shift);
    return true;
  }

  function place(state, target, shift) {
    const { kind } = ui.mode;
    const chk = placeCheck(state, stats, side, kind, target.x, target.y);
    if (!chk.ok) { toast(`Cannot build here: ${chk.reason}`); return true; }
    const workers = selectedUnits(state).filter((u) => u.kind === 'worker');
    if (!workers.length) { ui.mode = null; return true; }
    workers.sort((a, b) => dist(a, target) - dist(b, target) || a.id - b.id);
    const w = workers[0];
    const p = planOf(w.id);
    const order = { type: 'build', kind, x: target.x, y: target.y };
    p.hold = false;
    if (shift && (p.cur || p.queue.length)) p.queue.push(order); else { p.queue = [order]; p.cur = null; }
    if (!shift) ui.mode = null;
    return true;
  }

  // Keys -------------------------------------------------------------------------------------------------------
  function queueTrain(state, kind) {
    const structs = selectedStructures(state).filter((s) => s.complete && trainable(s).includes(kind));
    if (!structs.length) return false;
    structs.sort((a, b) => a.queue.length - b.queue.length || a.id - b.id); // shortest queue first
    // Check what the sim would check, so the player gets a reason instead of a silent reject.
    const cost = stats.units[kind]?.cost ?? 0;
    const pending = ui.outbox.filter((c) => c.type === 'train').reduce((n, c) => n + (c.kind === kind ? cost : (stats.units[c.kind]?.cost ?? 0)), 0);
    const supply = state.units.filter((u) => u.owner === side).length + state.structures.reduce((n, s) => n + (s.owner === side ? s.queue.length : 0), 0)
      + ui.outbox.filter((c) => c.type === 'train').length;
    if (state.shards[side] - pending < cost) { toast('Not enough Shards'); return true; }
    if (structs[0].queue.length >= (stats.match?.queueMax ?? 5)) { toast('Queue is full'); return true; }
    if (supply + 1 > (stats.match?.unitCap ?? 40)) { toast('Unit cap reached'); return true; }
    ui.outbox.push({ type: 'train', building: structs[0].id, kind });
    return true;
  }

  /** The command card for the current selection: [{ key, label, kind, action, cost }]. */
  function commandCard(state) {
    const units = selectedUnits(state), structs = selectedStructures(state);
    const card = [];
    if (units.length) {
      card.push({ key: 'a', label: 'Attack', action: 'amove' }, { key: 's', label: 'Stop', action: 'stop' },
        { key: 'h', label: 'Hold', action: 'hold' }, { key: 'm', label: 'Move', action: 'move' });
      if (units.some((u) => u.kind === 'worker')) {
        for (const kind of buildKinds) card.push({ key: buildKeys[kind], label: kind, kind, action: 'build', cost: stats.structures[kind].cost });
      }
    } else if (structs.length) {
      const kinds = [...new Set(structs.flatMap((s) => (s.complete ? trainable(s) : [])))];
      const keys = keyForKind(kinds);
      for (const kind of kinds) card.push({ key: keys[kind], label: kind, kind, action: 'train', cost: stats.units[kind]?.cost });
      card.push({ key: 'r', label: 'Rally', action: 'rally' });
    }
    return card;
  }

  /** Run a command-card action (also what a button click does). Returns an effect for the page or null. */
  function act(state, action, kind) {
    const units = selectedUnits(state);
    switch (action) {
      case 'amove': if (units.length) ui.mode = { type: 'amove' }; return null;
      case 'move': if (units.length) ui.mode = { type: 'move' }; return null;
      case 'rally': if (selectedStructures(state).length) ui.mode = { type: 'rally' }; return null;
      case 'stop':
        for (const u of units) { const p = planOf(u.id); p.queue = []; p.cur = null; p.hold = false; ui.outbox.push({ type: 'stop', unit: u.id }); }
        return null;
      case 'hold':
        for (const u of units) { const p = planOf(u.id); p.queue = []; p.cur = null; p.hold = true; ui.outbox.push({ type: 'stop', unit: u.id }); }
        return null;
      case 'build':
        if (!units.some((u) => u.kind === 'worker')) return null;
        if (state.shards[side] < stats.structures[kind].cost) { toast('Not enough Shards'); return null; }
        ui.mode = { type: 'place', kind }; return null;
      case 'train':
        if (!queueTrain(state, kind)) toast('Cannot train that here');
        return null;
      default: return null;
    }
  }

  /** A key press. Returns { center: {x, y} } when the camera should move, else null. */
  function key(state, k, { ctrl = false, shift = false, now = 0 } = {}) {
    k = k.length === 1 ? k.toLowerCase() : k;
    if (k === 'Escape') { ui.mode = null; return null; }
    if (/^[1-9]$/.test(k)) {
      if (ctrl) { setGroup(k, state); toast(`Group ${k} set`); return null; }
      const c = recallGroup(k, state, now);
      return c ? { center: c } : null;
    }
    if (k === ' ') return ui.alert ? { center: { x: ui.alert.x, y: ui.alert.y } } : null;
    const card = commandCard(state);
    const hit = card.find((c) => c.key === k);
    if (hit) return act(state, hit.action, hit.kind);
    return null;
  }

  // Alerts ---------------------------------------------------------------------------------------------------------
  function noteEvents(state, events) {
    const m = entityMap(state);
    for (const ev of events) {
      if (ev.e === 'hit') {
        const t = m.get(ev.id);
        if (t && t.owner === side) ui.alert = { x: t.x, y: t.y, text: 'Under attack', tick: state.tick };
      } else if (ev.e === 'done') {
        const t = m.get(ev.id);
        if (t && t.owner === side) ui.alert = { x: t.x, y: t.y, text: 'Construction complete', tick: state.tick };
      }
    }
  }

  // Per-tick driver --------------------------------------------------------------------------------------------
  function nearestEnemy(state, u, radius, { threatsFirst = true } = {}) {
    let best = null, bd = Infinity;
    const consider = (e, bias) => {
      if (e.owner === side) return;
      const d = dist(u, e);
      if (d > radius) return;
      if (d + bias < bd) { best = e; bd = d + bias; }
    };
    for (const e of state.units) consider(e, threatsFirst && e.kind === 'worker' ? 3 : 0);
    for (const e of state.structures) consider(e, 6);
    return best;
  }

  function cmdFor(u, order) {
    switch (order.type) {
      case 'move': case 'amove': return { type: 'move', unit: u.id, x: order.x, y: order.y };
      case 'attack': return { type: 'attack', unit: u.id, target: order.target };
      case 'gather': return { type: 'gather', unit: u.id, x: order.x, y: order.y };
      case 'build': return { type: 'build', unit: u.id, kind: order.kind, x: order.x, y: order.y };
      default: return null;
    }
  }

  function tick(state) {
    const out = ui.outbox.splice(0);
    const m = entityMap(state);
    const rangeOf = (u) => stats.units[u.kind]?.range ?? 1;

    // Rally: units that appeared since the last tick head for their building's rally point.
    if (ui.known === null) {
      ui.known = new Set(state.units.map((u) => u.id));
      for (const s of state.structures) {
        if (s.owner === side && s.kind === 'core' && !ui.rally.has(s.id)) {
          const c = [...state.crystals].filter((k) => k.amount > 0).sort((a, b) => dist(a, s) - dist(b, s) || a.y - b.y || a.x - b.x)[0];
          if (c) ui.rally.set(s.id, { type: 'gather', x: c.x, y: c.y });
        }
      }
    }
    for (const u of state.units) {
      if (ui.known.has(u.id)) continue;
      ui.known.add(u.id);
      if (u.owner !== side) continue;
      const home = state.structures.filter((s) => s.owner === side && ui.rally.has(s.id) && dist(s, u) <= 2).sort((a, b) => dist(a, u) - dist(b, u) || a.id - b.id)[0];
      const r = home && ui.rally.get(home.id);
      if (!r) continue;
      if (r.type === 'gather' && u.kind === 'worker') give([u.id], () => ({ type: 'gather', x: r.x, y: r.y }), false);
      else if (r.type === 'move' || r.type === 'gather') give([u.id], () => ({ type: 'move', x: r.x, y: r.y }), false);
    }

    for (const [id, p] of [...ui.plans]) {
      const u = m.get(id);
      if (!u || isStructure(state, u)) { ui.plans.delete(id); continue; }
      const idle = u.order === null && p.issuedAt < state.tick;
      if (p.hold) {
        const r = rangeOf(u);
        if (u.order === null) {
          const foe = nearestEnemy(state, u, r);
          if (foe) { out.push(cmdFor(u, { type: 'attack', target: foe.id })); p.issuedAt = state.tick; }
        } else if (u.order.type === 'attack') {
          const t = m.get(u.order.target);
          if (!t || dist(u, t) > r) { out.push({ type: 'stop', unit: id }); p.issuedAt = state.tick; }
        }
        continue;
      }
      // Finish the current order when its unit goes idle.
      if (p.cur && idle) {
        if (p.cur.type === 'amove') {
          if (dist(u, p.cur) <= 0 || p.tries >= 4) { p.cur = null; }
        } else p.cur = null;
      }
      if (p.cur && p.cur.type === 'amove') {
        // Attack-move: look for enemies each tick; otherwise keep walking to the destination.
        const attacking = u.order && u.order.type === 'attack';
        if (!attacking) {
          const foe = nearestEnemy(state, u, Math.max(ACQUIRE, rangeOf(u) + 2));
          if (foe) { out.push(cmdFor(u, { type: 'attack', target: foe.id })); p.issuedAt = state.tick; p.tries = 0; continue; }
          if (idle) { out.push(cmdFor(u, p.cur)); p.issuedAt = state.tick; p.tries++; }
        }
        continue;
      }
      if (!p.cur && p.queue.length) {
        p.cur = p.queue.shift();
        p.tries = 0;
        const c = cmdFor(u, p.cur);
        if (c) { out.push(c); p.issuedAt = state.tick; }
        if (p.cur.type === 'amove') p.tries = 1;
      }
      if (!p.cur && !p.queue.length && idle) ui.plans.delete(id);
    }
    return out.slice(0, stats.match?.maxCommandsPerTick ?? 100);
  }

  return {
    ui, commandCard, act, key, tick, noteEvents, mine,
    clickSelect, boxSelect, rightClick, modeClick, setGroup, recallGroup, selectedUnits, selectedStructures,
    setMode: (mode) => { ui.mode = mode; },
    placeCheck: (state, kind, x, y) => placeCheck(state, stats, side, kind, x, y),
    takeMessage: () => { const m = ui.message; ui.message = null; return m; },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pointer feel: click-in capture (Pointer Lock) with an in-game cursor, edge pushing that survives leaving the window,
// middle-drag pan, and a fullscreen toggle (F11 or the corner button). Everything is injected (win, doc, overlay, rig)
// so node tests run it against fakes. Returns { rel(e), toggleFullscreen }: rel(e) is the cursor in overlay pixels
// (the virtual cursor while locked), so the page's click handlers keep working unchanged.
// ---------------------------------------------------------------------------------------------------------------
export function installPointerControls({ win, doc, overlay, rig, lock = true }) {
  let last = { x: 0, y: 0 };
  let panning = false;
  let downEl = null;
  const rel = (e) => {
    if (rig.locked && rig.cursor) return { x: rig.cursor.x, y: rig.cursor.y };
    const r = overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // The in-game cursor, shown only while the pointer is locked (the system cursor is hidden then).
  const cursorEl = doc.createElement('div');
  Object.assign(cursorEl.style, { position: 'fixed', left: '0', top: '0', width: '24px', height: '24px', pointerEvents: 'none', zIndex: '60', display: 'none' });
  cursorEl.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M2 2 L2 19 L7 14.5 L10.5 22 L13.5 20.6 L10.2 13.4 L17 13 Z" fill="#33e0ff" stroke="#0b0918" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  doc.body.append(cursorEl);
  const placeCursor = () => { if (rig.cursor) cursorEl.style.transform = `translate(${rig.cursor.x}px, ${rig.cursor.y}px)`; };

  // Fullscreen: F11 or the corner button.
  const toggleFullscreen = () => {
    const p = doc.fullscreenElement ? doc.exitFullscreen?.() : doc.documentElement.requestFullscreen?.();
    p?.catch?.(() => {});
  };
  const fsButton = doc.createElement('button');
  fsButton.textContent = '⛶';
  fsButton.title = 'Fullscreen (F11)';
  Object.assign(fsButton.style, { position: 'fixed', right: '10px', top: '8px', zIndex: '40', font: 'inherit', color: '#e8e4f4', background: '#26223ccc', border: '1px solid #4a4568', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' });
  fsButton.addEventListener('click', toggleFullscreen);
  doc.body.append(fsButton);
  win.addEventListener('keydown', (e) => {
    if (e.key !== 'F11') return;
    e.preventDefault();
    toggleFullscreen();
  });

  // Click-in capture; Esc is the browser's own release.
  doc.addEventListener('pointerlockchange', () => {
    if (doc.pointerLockElement === overlay) { rig.lock(last.x, last.y); cursorEl.style.display = 'block'; placeCursor(); }
    else { rig.unlock(); cursorEl.style.display = 'none'; }
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.button === 1) { e.preventDefault?.(); panning = true; return; }
    last = rel(e);
    if (e.button === 0 && lock && !rig.locked) {
      try { overlay.requestPointerLock?.()?.catch?.(() => {}); } catch { /* the browser refused; try again on the next click */ }
    }
  });

  win.addEventListener('mousemove', (e) => {
    if (rig.locked) { rig.moveCursor(e.movementX || 0, e.movementY || 0); placeCursor(); }
    else { last = rel(e); rig.setMouse(last.x, last.y); }
    if (panning) rig.dragBy(e.movementX || 0, e.movementY || 0);
  });
  win.addEventListener('mouseup', (e) => { if (e.button === 1) panning = false; });
  win.addEventListener('blur', () => { panning = false; });

  // Leaving the window while pushing against an edge keeps the pan going from the exit point until the pointer returns.
  doc.documentElement.addEventListener('mouseleave', (e) => {
    if (rig.locked || panning) return;
    const m = { x: Math.max(0, Math.min(rig.size.width - 1, e.clientX)), y: Math.max(0, Math.min(rig.size.height - 1, e.clientY)) };
    const v = edgeVector(m, rig.size);
    rig.mouse = v.x || v.y ? m : null;
  });

  // While locked, real clicks land on the overlay; hand them to whatever HUD element is under the virtual cursor
  // (minimap, command card, buttons) as synthetic mouse events.
  const forward = (e) => {
    if (!rig.locked || !rig.cursor || e.isTrusted === false) return;
    if (e.type === 'mousedown') {
      const el = doc.elementFromPoint?.(rig.cursor.x, rig.cursor.y);
      downEl = el && el !== overlay ? el : null;
    }
    const target = downEl;
    if (!target) return;
    e.stopPropagation();
    const send = (type) => target.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: rig.cursor.x, clientY: rig.cursor.y, button: e.button, buttons: e.buttons, view: win }));
    send(e.type);
    if (e.type === 'mouseup') { send('click'); downEl = null; }
  };
  win.addEventListener('mousedown', forward, true);
  win.addEventListener('mouseup', forward, true);

  return { rel, toggleFullscreen };
}
