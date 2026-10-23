// Driftfall replay: rebuilds the game state tick by tick from a match log (ENV-SPEC.md §12).
// Pure module: no DOM, no clock, no randomness. Safe to import from node tests.
//
// Replay promises: every entity's id, owner, kind, tile, hp, carrying; structure progress, complete and queue;
// both sides' Shards; every crystal tile's amount. Orders are best-effort.

const clone = (v) => (v === undefined ? v : structuredClone(v));

// The stats table is written by another module, so look costs up in the shapes it could reasonably have.
export function statFor(stats, kind) {
  if (!stats || typeof stats !== 'object') return null;
  for (const group of [stats, stats.units, stats.structures, stats.UNITS, stats.STRUCTURES, stats.unit, stats.structure]) {
    const row = group && typeof group === 'object' ? group[kind] : null;
    if (row && typeof row === 'object') return row;
  }
  return null;
}

export function costOf(stats, kind) {
  const row = statFor(stats, kind);
  return row && typeof row.cost === 'number' ? row.cost : 0;
}

// Value = Shards + cost of living units + cost of complete structures (Core and unfinished sites count 0).
export function valueOf(state, player, stats) {
  let v = state.shards[player] ?? 0;
  for (const u of state.units) if (u.owner === player) v += costOf(stats, u.kind);
  for (const s of state.structures) {
    if (s.owner === player && s.complete && s.kind !== 'core') v += costOf(stats, s.kind);
  }
  return v;
}

// Counts per side, e.g. { worker: 4, grunt: 2, ... , structures: { core: 1, forge: 1 }, sites: 1, total: 6 }.
export function countsOf(state, player) {
  const out = { units: {}, structures: {}, sites: 0, totalUnits: 0 };
  for (const u of state.units) {
    if (u.owner !== player) continue;
    out.units[u.kind] = (out.units[u.kind] ?? 0) + 1;
    out.totalUnits++;
  }
  for (const s of state.structures) {
    if (s.owner !== player) continue;
    if (s.complete) out.structures[s.kind] = (out.structures[s.kind] ?? 0) + 1;
    else out.sites++;
  }
  return out;
}

export function initialState(log) {
  const s = clone(log.initial);
  delete s.you;
  s.tick = s.tick ?? 0;
  s.rocks ??= [];
  s.crystals ??= [];
  s.shards ??= [0, 0];
  s.units ??= [];
  s.structures ??= [];
  s.result = null;
  return s;
}

function findUnit(state, id) {
  return state.units.find((u) => u.id === id);
}
function findStructure(state, id) {
  return state.structures.find((s) => s.id === id);
}
function findEntity(state, id) {
  return findUnit(state, id) ?? findStructure(state, id);
}

function removeEntity(state, id) {
  let i = state.units.findIndex((u) => u.id === id);
  if (i >= 0) return void state.units.splice(i, 1);
  i = state.structures.findIndex((s) => s.id === id);
  if (i >= 0) state.structures.splice(i, 1);
}

function insertSorted(list, item) {
  const old = list.findIndex((e) => e.id === item.id);
  if (old >= 0) list.splice(old, 1);
  let i = list.length;
  while (i > 0 && list[i - 1].id > item.id) i--;
  list.splice(i, 0, item);
}

function applyEvent(state, ev, stats) {
  if (!ev || typeof ev !== 'object') return;
  switch (ev.e) {
    case 'spawn': {
      if (ev.unit) {
        const u = clone(ev.unit);
        u.carrying ??= 0;
        u.order ??= null;
        insertSorted(state.units, u);
      } else if (ev.structure) {
        const s = clone(ev.structure);
        s.queue ??= [];
        s.progress ??= 0;
        s.complete ??= false;
        insertSorted(state.structures, s);
      }
      if (state.nextId !== undefined) {
        const id = (ev.unit ?? ev.structure)?.id;
        if (typeof id === 'number' && id >= state.nextId) state.nextId = id + 1;
      }
      break;
    }
    case 'move': {
      const u = findUnit(state, ev.id);
      if (u) { u.x = ev.x; u.y = ev.y; }
      break;
    }
    case 'hit': {
      const t = findEntity(state, ev.id);
      if (t) t.hp = ev.hp;
      break;
    }
    case 'die':
      removeEntity(state, ev.id);
      break;
    case 'mine': {
      const c = state.crystals.find((c) => c.x === ev.x && c.y === ev.y);
      if (c) c.amount = ev.left;
      const u = findUnit(state, ev.id);
      if (u) u.carrying = (u.carrying ?? 0) + ev.amount;
      break;
    }
    case 'deliver': {
      const u = findUnit(state, ev.id);
      if (u) {
        state.shards[u.owner] = ev.shards;
        u.carrying = 0;
      }
      break;
    }
    case 'spend':
      state.shards[ev.player] = ev.shards;
      break;
    case 'progress': {
      const s = findStructure(state, ev.id);
      if (s) { s.progress = ev.progress; s.hp = ev.hp; }
      break;
    }
    case 'done': {
      const s = findStructure(state, ev.id);
      if (s) {
        s.complete = true;
        const ticks = statFor(stats, s.kind)?.buildTicks;
        if (typeof ticks === 'number') s.progress = ticks;
      }
      break;
    }
    case 'queue': {
      const s = findStructure(state, ev.id);
      if (s) s.queue = clone(ev.queue);
      break;
    }
    case 'order': {
      const e = findUnit(state, ev.id);
      if (e) e.order = clone(ev.order ?? null);
      break;
    }
    case 'forfeit':
      state.forfeits = [...(state.forfeits ?? []), { player: ev.player, reason: ev.reason }];
      break;
    default:
      break; // blocked, reject, late, error and anything unknown change nothing
  }
}

// Apply the events of one tick entry { tick, commands, events } to the state, in place. Returns the state.
// It leaves state.tick alone: replayTo and createReplayer advance the tick by counting entries.
// `stats` is optional (the log's stats table); it only makes `done` set progress exactly.
export function applyTick(state, tickEntry, stats) {
  for (const ev of tickEntry?.events ?? []) applyEvent(state, ev, stats);
  return state;
}

// Rebuild the state as it stands after `tick` ticks (tick 0 = the initial state). The log is never modified.
// Entries are counted by position, so it does not matter whether a log numbers an entry by the tick it starts
// from or the tick it produces: after n entries the state is at tick (initial tick + n).
export function replayTo(log, tick) {
  const state = initialState(log);
  const start = state.tick;
  const entries = log.ticks ?? [];
  const n = Math.max(0, Math.min(tick - start, entries.length));
  for (let i = 0; i < n; i++) applyTick(state, entries[i], log.stats);
  state.tick = start + n;
  attachResult(state, log);
  return state;
}

export function lastTick(log) {
  return (log.initial?.tick ?? 0) + (log.ticks?.length ?? 0);
}

function attachResult(state, log) {
  state.result = log.result && state.tick >= lastTick(log) ? clone(log.result) : null;
}

// Fast seeking for a viewer: keeps a snapshot every `every` ticks so scrubbing backwards is cheap.
export function createReplayer(log, every = 50) {
  const entries = log.ticks ?? [];
  const first = initialState(log);
  const start = first.tick;
  const snaps = new Map([[start, first]]);
  let state = clone(first);

  function seek(tick) {
    tick = Math.max(start, Math.min(tick, lastTick(log)));
    if (tick < state.tick) {
      let best = start;
      for (const t of snaps.keys()) if (t <= tick && t > best) best = t;
      state = clone(snaps.get(best));
    }
    while (state.tick < tick) {
      const at = state.tick;
      applyTick(state, entries[at - start], log.stats);
      state.tick = at + 1;
      if ((state.tick - start) % every === 0 && !snaps.has(state.tick)) snaps.set(state.tick, clone(state));
    }
    attachResult(state, log);
    return state;
  }

  return {
    seek,
    get state() { return state; },
    get last() { return lastTick(log); },
    // Events that produced the state at `tick` (none for the initial state).
    eventsAt(tick) { return entries[tick - start - 1]?.events ?? []; },
  };
}
