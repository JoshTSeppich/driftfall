// Toast as ammo (COMBAT.md sections 1 and 2). Pure module, OFF until enableAmmo(state).
//
// Every armed unit holds slices in its slots (ARMED below). One shot spends its attack's slices (Quad Volley spends
// four). Crumbs (workers) are the carriers: an idle, powered Crumb hauls up to two slices from the Power Strip's stock
// to the neediest powered unit, along a run that other players can see and raid. Three states:
//   fed        powered and holding enough slices for its attack: moves and fires
//   hungry     powered but short of slices: moves, cannot fire until resupplied
//   unpowered  off its cord: cannot move, fire or be resupplied (the cords owner sets the power hook)
// No softlocks: the Power Strip keeps a reserve that only the lifeline may use, and with no Crumbs alive and no
// stock a free Crumb is doled out, so a side that is broke can always rebuild.
//
// Shared contract (what other files call):
//   enableAmmo(state, { stock, reserve })    creates state.ammo (idempotent); stock is the Power Strip's own store
//                                            when toast is off (toast's stack is the store when toast is on)
//   isAmmoOn(state)
//   setAmmoHooks(state, { isPowered })       isPowered(state, unit) -> bool; default is always powered
//   addStock(state, side, n) -> bool         bakes n more slices into the Power Strip's stock
//   stockOf(state, side) -> number
//   stepAmmo(state)                          once a tick, before combat: registers units, moves runs, raids, lifeline,
//                                            dole. Emits run, resupply, raid, spill, lifeline, dole events.
//   unitState(state, unit) -> 'fed' | 'hungry' | 'unpowered' | null (null when ammo is off or the unit is unarmed)
//   canMove(state, unit) -> bool             false only when unpowered
//   canFire(state, unit) -> bool             fed units only (unarmed units fire when powered)
//   spendShot(state, unit, targetId) -> bool spends the attack's slices and emits a 'shot' event with its timings
//   observeAmmo(state, side) -> { units, runs, stock } | null   what the HUD and renderer read
//   recoverable(state, side) -> bool         false only when the side has no Power Strip left
//   ticksOf(ms) -> ticks                     milliseconds of an animation beat at the sim's clock
//
// The sim decides every hit: combat still emits its 'hit' event; the 'shot' event only starts the animation, which
// plays the attack's beats (windup, impact, recover) at the timings the shot carries.
import { STATS, kindStats } from "./stats.mjs";
import { allocId, distance, emit } from "./state.mjs";
import { findSpawnTile } from "./economy.mjs";
import { isToastOn } from "./toast.mjs";

export const AMMO_TUNING = Object.freeze({
  reserve: 2, // slices the Power Strip keeps back; runs never take them, only the lifeline does
  crumbCarry: 2, // a Crumb's two slots
  raidRange: 2, // an enemy fighter this close to a run cuts it (tiles)
  lifelineSeconds: 20, // a starving side with no Crumb (or no stock above the reserve) gets one slice this often
  doleSeconds: 30, // a broke side with no Crumbs gets one free Crumb this often
});

// Armed kinds: slots (the most slices held) and the attack that spends them. Beats are in milliseconds (COMBAT.md
// section 4): impactMs is when the sim's hit lands on screen, recoverMs when the body is back at idle.
const ARMED = Object.freeze({
  // Slots are sized so one full load is about one kill (Popper: six 10-damage shots into a 60 hp Popper).
  grunt: { slots: 6, attack: { name: "Pop Shot", slices: 1, windupMs: 160, impactMs: 375, recoverMs: 520 } },
  lancer: { slots: 6, attack: { name: "Hot Coil", slices: 1, windupMs: 200, impactMs: 300, recoverMs: 480 } },
  brute: { slots: 8, attack: { name: "Quad Volley", slices: 4, windupMs: 240, impactMs: 420, recoverMs: 700 } },
  spiker: { slots: 6, attack: { name: "Crouton Flak", slices: 1, windupMs: 200, impactMs: 400, recoverMs: 520 } },
  howler: { slots: 4, attack: { name: "Bread Shell", slices: 1, windupMs: 260, impactMs: 480, recoverMs: 700 } },
  // Bagel: STATS.units.dart.ammo is false, so it needs power but no slices (see needsSlices); the row is its animation.
  dart: { slots: 1, attack: { name: "Ram", slices: 1, windupMs: 120, impactMs: 300, recoverMs: 400 } },
});
// Bagels roll on power alone: they are never "hungry", never resupplied and spend nothing.
const needsSlices = (kind) => STATS.units[kind]?.ammo !== false;
const DEFAULT_ARMED = Object.freeze({
  slots: 3,
  attack: Object.freeze({ name: "Toast Shot", slices: 1, windupMs: 200, impactMs: 360, recoverMs: 500 }),
});

const tps = () => STATS.clock.ticksPerSecond;
export const ticksOf = (ms) => Math.round((ms * tps()) / 1000);

/** The ammo row for a unit kind: { slots, attack }, or null for unarmed kinds (Crumbs, the Core, structures). */
export function ammoOf(kind) {
  if (ARMED[kind]) return ARMED[kind];
  if (kind === "worker" || kind === "core") return null;
  if (Object.prototype.hasOwnProperty.call(STATS.units, kind)) return DEFAULT_ARMED;
  return null;
}

const isCrumb = (u) => u.kind === "worker";
const isLive = (u) => u.hp > 0;
const byId = (a, b) => a.id - b.id;

export function enableAmmo(state, opts = {}) {
  if (!state.ammo) {
    const stock = Number.isInteger(opts.stock) && opts.stock > 0 ? opts.stock : 0;
    state.ammo = {
      stock: [stock, stock], // the Power Strip's own store, used when toast is off
      reserve: Number.isInteger(opts.reserve) && opts.reserve >= 0 ? opts.reserve : AMMO_TUNING.reserve,
      slices: {}, // unit id -> slices in its slots
      runs: [], // Crumb runs in flight, oldest first
      busy: {}, // Crumb id -> tick it is home again
      nextRun: 1,
      lifelineAt: [null, null], // tick the next lifeline slice is due, once the need has lasted
      doleAt: [null, null],
      isPowered: null,
    };
  }
  return state.ammo;
}

export const isAmmoOn = (state) => !!(state && state.ammo);

export function setAmmoHooks(state, { isPowered } = {}) {
  if (isAmmoOn(state)) state.ammo.isPowered = typeof isPowered === "function" ? isPowered : null;
}

const poweredOf = (state, unit) => {
  const hook = isAmmoOn(state) ? state.ammo.isPowered : null;
  return hook ? !!hook(state, unit) : true;
};

// The Power Strip's store: the toast stack when toast is on, else the ammo store.
export function stockOf(state, side) {
  if (!isAmmoOn(state)) return 0;
  return isToastOn(state) ? state.toast.stack[side] : state.ammo.stock[side];
}

function takeStock(state, side, n) {
  if (isToastOn(state)) state.toast.stack[side] -= n;
  else state.ammo.stock[side] -= n;
}

export function addStock(state, side, n) {
  if (!isAmmoOn(state) || !Number.isInteger(n) || n <= 0) return false;
  if (isToastOn(state)) state.toast.stack[side] += n;
  else state.ammo.stock[side] += n;
  return true;
}

function coreOf(state, side) {
  return state.structures.find((s) => s.kind === "core" && s.owner === side && s.hp > 0) ?? null;
}

const fightersOf = (state, side) =>
  state.units.filter((u) => u.owner === side && isLive(u) && ammoOf(u.kind) && needsSlices(u.kind)).sort(byId);

const crumbsOf = (state, side) => state.units.filter((u) => u.owner === side && isCrumb(u) && isLive(u)).sort(byId);

function slicesOf(state, unit) {
  const A = state.ammo;
  return A.slices[unit.id] ?? ammoOf(unit.kind).slots;
}

function inboundTo(state, unitId) {
  return state.ammo.runs.filter((r) => r.unit === unitId).reduce((sum, r) => sum + r.slices, 0);
}

export function unitState(state, unit) {
  if (!isAmmoOn(state)) return null;
  if (!poweredOf(state, unit)) return "unpowered";
  const row = ammoOf(unit.kind);
  if (!row) return null;
  if (!needsSlices(unit.kind)) return "fed";
  return slicesOf(state, unit) < row.attack.slices ? "hungry" : "fed";
}

export function canMove(state, unit) {
  if (!isAmmoOn(state)) return true;
  return poweredOf(state, unit);
}

export function canFire(state, unit) {
  if (!isAmmoOn(state)) return true;
  if (!poweredOf(state, unit)) return false;
  const row = ammoOf(unit.kind);
  if (!row || !needsSlices(unit.kind)) return true;
  return slicesOf(state, unit) >= row.attack.slices;
}

export function spendShot(state, unit, targetId = null) {
  if (!isAmmoOn(state)) return true;
  if (!canFire(state, unit)) return false;
  const row = ammoOf(unit.kind);
  if (!row) return true;
  const cost = needsSlices(unit.kind) ? row.attack.slices : 0;
  state.ammo.slices[unit.id] = slicesOf(state, unit) - cost;
  emit(state, {
    e: "shot", id: unit.id, player: unit.owner, kind: unit.kind, attack: row.attack.name, slices: cost,
    left: state.ammo.slices[unit.id], target: targetId,
    windupTicks: ticksOf(row.attack.windupMs), impactTicks: ticksOf(row.attack.impactMs),
    recoverTicks: ticksOf(row.attack.recoverMs),
  });
  return true;
}

// Lerp along a run's straight line at this tick, 0 at the Power Strip and 1 at the unit.
function pointOn(run, tick) {
  const p = Math.min(1, Math.max(0, (tick - run.start) / (run.arrive - run.start)));
  return { x: run.from.x + (run.to.x - run.from.x) * p, y: run.from.y + (run.to.y - run.from.y) * p, progress: p };
}

function endRun(state, run) {
  state.ammo.runs = state.ammo.runs.filter((r) => r !== run);
}

function stepRuns(state) {
  const A = state.ammo;
  const tick = state.tick;
  for (const run of [...A.runs]) {
    const crumb = state.units.find((u) => u.id === run.crumb);
    if (!crumb || !isLive(crumb)) {
      emit(state, { e: "spill", player: run.side, id: run.crumb, unit: run.unit, slices: run.slices, reason: "crumb" });
      endRun(state, run);
      continue;
    }
    if (tick >= run.arrive) {
      const target = state.units.find((u) => u.id === run.unit);
      if (target && target.owner === run.side && isLive(target) && A.slices[target.id] !== undefined) {
        A.slices[target.id] += run.slices;
        emit(state, { e: "resupply", player: run.side, id: crumb.id, unit: target.id, slices: run.slices, left: A.slices[target.id] });
      } else {
        emit(state, { e: "spill", player: run.side, id: crumb.id, unit: run.unit, slices: run.slices, reason: "unit" });
      }
      endRun(state, run);
      continue;
    }
    const here = pointOn(run, tick);
    const raider = state.units
      .filter((u) => u.owner !== run.side && isLive(u) && ammoOf(u.kind) && distance(here, u) <= AMMO_TUNING.raidRange)
      .sort(byId)[0];
    if (raider) {
      emit(state, { e: "raid", player: run.side, id: crumb.id, unit: run.unit, by: raider.id, slices: run.slices, x: here.x, y: here.y });
      A.busy[crumb.id] = tick + Math.ceil((run.arrive - run.start));
      endRun(state, run);
    }
  }
}

// Idle Crumbs haul to the neediest powered units while the store has slices above the reserve. Returns the Crumbs left.
function assignRuns(state, side) {
  const A = state.ammo;
  const tick = state.tick;
  const core = coreOf(state, side);
  if (!core) return;
  let avail = stockOf(state, side) - A.reserve;
  const idle = crumbsOf(state, side).filter((c) => !(A.busy[c.id] > tick) && !A.runs.some((r) => r.crumb === c.id));
  const needy = fightersOf(state, side)
    .filter((u) => poweredOf(state, u) && slicesOf(state, u) + inboundTo(state, u.id) < ammoOf(u.kind).slots)
    .sort((a, b) => slicesOf(state, a) - slicesOf(state, b) || a.id - b.id);
  for (const unit of needy) {
    if (avail <= 0 || idle.length === 0) break;
    const row = ammoOf(unit.kind);
    const room = row.slots - slicesOf(state, unit) - inboundTo(state, unit.id);
    const load = Math.min(AMMO_TUNING.crumbCarry, room, avail);
    if (load < 1) continue;
    const crumb = idle.shift();
    const oneWay = Math.max(1, Math.ceil(distance(core, unit) * kindStats("worker").speed));
    const run = {
      id: A.nextRun++, side, crumb: crumb.id, unit: unit.id, slices: load,
      from: { x: core.x, y: core.y }, to: { x: unit.x, y: unit.y },
      start: tick, arrive: tick + oneWay, home: tick + 2 * oneWay,
    };
    A.runs.push(run);
    A.busy[crumb.id] = run.home;
    takeStock(state, side, load);
    avail -= load;
    emit(state, { e: "run", player: side, id: run.id, crumb: crumb.id, unit: unit.id, slices: load });
  }
}

// The lifeline and the dole: the Power Strip's two guarantees. Each waits for its need to last one interval.
function stepLifeline(state, side) {
  const A = state.ammo;
  const tick = state.tick;
  const crumbs = crumbsOf(state, side).length;
  const avail = stockOf(state, side) - A.reserve;
  const needy = fightersOf(state, side).filter(
    (u) => poweredOf(state, u) && slicesOf(state, u) + inboundTo(state, u.id) < ammoOf(u.kind).slots,
  );
  const stuck = needy.length > 0 && stockOf(state, side) > 0 && (crumbs === 0 || avail <= 0);
  if (!stuck) {
    A.lifelineAt[side] = null;
    return;
  }
  if (A.lifelineAt[side] === null) {
    A.lifelineAt[side] = tick + AMMO_TUNING.lifelineSeconds * tps();
    return;
  }
  if (tick < A.lifelineAt[side]) return;
  const unit = needy.sort((a, b) => slicesOf(state, a) - slicesOf(state, b) || a.id - b.id)[0];
  takeStock(state, side, 1);
  A.slices[unit.id] = slicesOf(state, unit) + 1;
  A.lifelineAt[side] = tick + AMMO_TUNING.lifelineSeconds * tps();
  emit(state, { e: "lifeline", player: side, unit: unit.id, slices: 1 });
}

function stepDole(state, side) {
  const A = state.ammo;
  const tick = state.tick;
  const core = coreOf(state, side);
  const broke = crumbsOf(state, side).length === 0 && stockOf(state, side) <= 0 && state.shards[side] < STATS.units.worker.cost;
  if (!core || !broke) {
    A.doleAt[side] = null;
    return;
  }
  if (A.doleAt[side] === null) {
    A.doleAt[side] = tick + AMMO_TUNING.doleSeconds * tps();
    return;
  }
  if (tick < A.doleAt[side]) return;
  const tile = findSpawnTile(state, core.x, core.y);
  if (!tile) return;
  const id = allocId(state);
  state.units.push({
    id, owner: side, kind: "worker", x: tile.x, y: tile.y, hp: STATS.units.worker.hp, carrying: 0, order: null,
  });
  A.doleAt[side] = null;
  emit(state, { e: "dole", player: side, id, side });
}

export function stepAmmo(state) {
  if (!isAmmoOn(state)) return;
  const A = state.ammo;
  const alive = new Set(state.units.map((u) => u.id));
  for (const id of Object.keys(A.slices)) if (!alive.has(Number(id))) delete A.slices[id];
  for (const u of state.units) if (ammoOf(u.kind) && A.slices[u.id] === undefined) A.slices[u.id] = ammoOf(u.kind).slots;
  for (const id of Object.keys(A.busy)) if (A.busy[id] <= state.tick) delete A.busy[id];

  stepRuns(state);
  for (const side of [0, 1]) {
    assignRuns(state, side);
    stepLifeline(state, side);
    stepDole(state, side);
  }
}

export function observeAmmo(state, side) {
  if (!isAmmoOn(state)) return null;
  const A = state.ammo;
  const tick = state.tick;
  const stock = stockOf(state, side);
  return {
    units: fightersOf(state, side).map((u) => {
      const row = ammoOf(u.kind);
      return {
        id: u.id, kind: u.kind, slices: slicesOf(state, u), slots: row.slots, cost: row.attack.slices,
        attack: row.attack.name, state: unitState(state, u),
      };
    }),
    runs: A.runs.filter((r) => r.side === side).map((r) => {
      const here = pointOn(r, tick);
      return {
        id: r.id, crumb: r.crumb, unit: r.unit, slices: r.slices, from: { ...r.from }, to: { ...r.to },
        x: here.x, y: here.y, progress: here.progress,
      };
    }),
    stock: { stock, reserve: A.reserve, available: Math.max(0, stock - A.reserve) },
  };
}

// A side is never stuck: while its Power Strip stands it can always dole a Crumb (see stepDole).
export function recoverable(state, side) {
  return !!coreOf(state, side);
}
