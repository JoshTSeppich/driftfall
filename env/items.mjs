// Items for recurring troops: TERRITORY.md section 14. Pure module, OFF until enableItems(state) is called.
//
// Any combat unit carries up to 2 items. Items lie on the ground as pickups (dropped by cleared camps), are collected
// by walking over them or by a right-click (pickUp), and can be dropped or swapped. Kills earn Ranks 1-3; a ranked
// unit that dies leaves a Shed Skin at the Nest (its side's Core) and Recall rebuilds it for half its price and its
// train time, keeping rank and items. Every number comes from STATS.items.
//
// Shared contract (what other files call):
//   enableItems(state)                        creates state.items = { pickups, shed, recalls, nextId } (idempotent)
//   dropPickup(state, item, x, y) -> id|null  put an item on the ground
//   pickUp(state, unitId, pickupId, {replaceSlot}) / dropFromUnit(state, unitId, slot) -> {ok} or {ok:false, reason}
//   unitMods(unit, state?) -> {damageMul, hpMul, armour, range, sight, attackSpeed}   for combat/vision to read
//   effectiveRank(unit)  awardKill(state, killer)  isRooted(unit)  stunOnHit(state, attacker) -> stun ticks
//   onUnitDeath(state, unit) -> shed skin|null   call when a unit dies, before it is removed
//   recall(state, side, skinId) -> {ok, cost, readyTick} or {ok:false, reason}
//   stepItems(state)                          call once a tick: pickups, healing, Recall arrivals
//   shedSkins(state, side)  itemsOf(unit)  observeItems(state, side)
// Reject reasons: no-items, cannot-carry, too-far, full, bad-slot, empty-slot, no-such-pickup, no-such-unit,
// no-such-skin, not-yours, short-shards, no-nest.
import { STATS, kindStats } from './stats.mjs';
import { distance, allocId, emit } from './state.mjs';

const rules = () => STATS.items;
export const ITEM_IDS = Object.freeze(Object.keys(STATS.items.list));
const TPS = STATS.clock.ticksPerSecond;

export function enableItems(state) {
  if (!state.items) state.items = { pickups: [], shed: [], recalls: [], nextId: 1 };
  return state.items;
}

export const itemsOf = (unit) => (unit.items ? unit.items.slice() : []);
const findUnit = (state, id) => state.units.find((u) => u.id === id && u.hp > 0) || null;
const canCarry = (unit) => !rules().noItemKinds.includes(unit.kind);

export function dropPickup(state, item, x, y) {
  if (!state.items || !STATS.items.list[item]) return null;
  const id = state.items.nextId++;
  state.items.pickups.push({ id, item, x, y });
  return id;
}

export function pickUp(state, unitId, pickupId, opts = {}) {
  if (!state.items) return { ok: false, reason: 'no-items' };
  const unit = findUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'no-such-unit' };
  if (!canCarry(unit)) return { ok: false, reason: 'cannot-carry' };
  const p = state.items.pickups.find((q) => q.id === pickupId);
  if (!p) return { ok: false, reason: 'no-such-pickup' };
  if (distance(unit, p) > rules().pickupRadius) return { ok: false, reason: 'too-far' };
  const have = (unit.items ||= []);
  const swap = opts.replaceSlot;
  if (have.length >= rules().slots) {
    if (!Number.isInteger(swap)) return { ok: false, reason: 'full' };
    if (swap < 0 || swap >= have.length) return { ok: false, reason: 'bad-slot' };
    const out = have[swap];
    have[swap] = p.item;
    state.items.pickups.splice(state.items.pickups.indexOf(p), 1);
    dropPickup(state, out, unit.x, unit.y);
  } else {
    have.push(p.item);
    state.items.pickups.splice(state.items.pickups.indexOf(p), 1);
  }
  emit(state, { e: 'item-picked', unit: unit.id, item: p.item });
  return { ok: true, item: p.item };
}

export function dropFromUnit(state, unitId, slot) {
  if (!state.items) return { ok: false, reason: 'no-items' };
  const unit = findUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'no-such-unit' };
  if (!unit.items || !unit.items[slot]) return { ok: false, reason: 'empty-slot' };
  const [item] = unit.items.splice(slot, 1);
  dropPickup(state, item, unit.x, unit.y);
  emit(state, { e: 'item-dropped', unit: unit.id, item });
  return { ok: true, item };
}

export function effectiveRank(unit) {
  const needs = rules().rank.killsFor;
  let rank = 0;
  for (const n of needs) if ((unit.kills || 0) >= n) rank++;
  for (const id of unit.items || []) rank += STATS.items.list[id].rankBonus || 0;
  return Math.min(needs.length, rank);
}

export function awardKill(state, killer) {
  if (!killer) return;
  const before = effectiveRank(killer);
  killer.kills = (killer.kills || 0) + 1;
  const after = effectiveRank(killer);
  if (after > before) emit(state, { e: 'rank-up', unit: killer.id, rank: after });
}

export function unitMods(unit, state = null) {
  const m = { damageMul: 1, hpMul: 1, armour: 0, range: 0, sight: 0, attackSpeed: 1 };
  const rank = effectiveRank(unit);
  m.damageMul += rank * rules().rank.damagePerRank;
  m.hpMul += rank * rules().rank.hpPerRank;
  for (const id of unit.items || []) {
    const it = STATS.items.list[id];
    m.damageMul += it.damageMul || 0;
    m.armour += it.armour || 0;
    m.range += it.range || 0;
    m.sight += it.sight || 0;
  }
  if (state) {
    for (const b of state.units) {
      if (b.hp <= 0 || b.owner !== unit.owner || !b.items || b.inside) continue;
      for (const id of b.items) {
        const it = STATS.items.list[id];
        if (it.auraRadius && distance(b, unit) <= it.auraRadius) m.attackSpeed += it.auraAttackSpeed;
      }
    }
  }
  return m;
}

export const isRooted = (unit) => (unit.items || []).some((id) => STATS.items.list[id].rooted);

// Stun ticks the first hit of a fight deals. A fight ends once the bearer has not hit for fightGapTicks.
export function stunOnHit(state, attacker) {
  let stun = 0;
  for (const id of attacker.items || []) {
    const it = STATS.items.list[id];
    if (!it.stunTicks) continue;
    const last = attacker.lastHitTick;
    if (last === undefined || state.tick - last >= it.fightGapTicks) stun = Math.max(stun, it.stunTicks);
  }
  attacker.lastHitTick = state.tick;
  return stun;
}

const nestOf = (state, side) => state.structures.find((s) => s.owner === side && s.kind === 'core' && s.hp > 0) || null;

export function onUnitDeath(state, unit) {
  if (!state.items || !canCarry(unit) || effectiveRank(unit) < 1) return null;
  const nest = nestOf(state, unit.owner);
  if (!nest) return null;
  const skin = {
    id: state.items.nextId++, owner: unit.owner, kind: unit.kind, kills: unit.kills || 0,
    rank: effectiveRank(unit), items: itemsOf(unit), x: nest.x, y: nest.y, diedTick: state.tick,
  };
  state.items.shed.push(skin);
  emit(state, { e: 'shed-skin', player: unit.owner, skin: skin.id, kind: unit.kind, rank: skin.rank });
  return skin;
}

export const shedSkins = (state, side) => (state.items ? state.items.shed.filter((s) => s.owner === side) : []);

const recallCost = (skin) => (skin.items.includes('molting') ? 0 : Math.floor(kindStats(skin.kind).cost * rules().recall.costFraction));

export function recall(state, side, skinId) {
  if (!state.items) return { ok: false, reason: 'no-items' };
  const skin = state.items.shed.find((s) => s.id === skinId);
  if (!skin) return { ok: false, reason: 'no-such-skin' };
  if (skin.owner !== side) return { ok: false, reason: 'not-yours' };
  if (!nestOf(state, side)) return { ok: false, reason: 'no-nest' };
  const cost = recallCost(skin);
  if (state.shards[side] < cost) return { ok: false, reason: 'short-shards' };
  state.shards[side] -= cost;
  state.items.shed.splice(state.items.shed.indexOf(skin), 1);
  const readyTick = state.tick + kindStats(skin.kind).trainTicks;
  const items = skin.items.includes('molting') ? skin.items.filter((i) => i !== 'molting') : skin.items;
  state.items.recalls.push({ owner: side, kind: skin.kind, kills: skin.kills, items, readyTick });
  emit(state, { e: 'recall-started', player: side, kind: skin.kind, readyTick });
  return { ok: true, cost, readyTick };
}

// Nearest free tile around the Nest, scanning rings outward in a fixed order.
function spawnSpot(state, nest) {
  const taken = new Set(state.units.filter((u) => u.hp > 0).map((u) => `${u.x},${u.y}`));
  for (let r = 1; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = nest.x + dx;
        const y = nest.y + dy;
        if (x < 0 || y < 0 || x >= state.width || y >= state.height) continue;
        if (state.rockSet.has(`${x},${y}`) || taken.has(`${x},${y}`)) continue;
        if (state.structures.some((s) => s.x === x && s.y === y)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

export function stepItems(state) {
  const it = state.items;
  if (!it) return;
  // Walk-over pickups, in unit id then pickup id order.
  for (const u of state.units) {
    if (u.hp <= 0 || u.inside || !canCarry(u)) continue;
    for (const p of it.pickups.slice()) {
      if ((u.items || []).length >= rules().slots) break;
      if (u.x === p.x && u.y === p.y) pickUp(state, u.id, p.id);
    }
  }
  // Glowmoss: heal on the second.
  if (state.tick % TPS === 0) {
    for (const u of state.units) {
      if (u.hp <= 0 || !u.items) continue;
      const heal = u.items.reduce((n, id) => n + (STATS.items.list[id].healPerSecond || 0), 0);
      if (!heal) continue;
      const max = Math.floor(kindStats(u.kind).hp * unitMods(u).hpMul);
      u.hp = Math.min(max, u.hp + heal);
    }
  }
  // Recall arrivals.
  if (it.recalls.length) {
    const waiting = [];
    for (const r of it.recalls) {
      const nest = nestOf(state, r.owner);
      const spot = r.readyTick <= state.tick && nest ? spawnSpot(state, nest) : null;
      if (!spot) { waiting.push(r); continue; }
      const unit = {
        id: allocId(state), owner: r.owner, kind: r.kind, x: spot.x, y: spot.y,
        hp: 0, carrying: 0, order: null, kills: r.kills, items: r.items.slice(),
      };
      unit.hp = Math.floor(kindStats(r.kind).hp * unitMods(unit).hpMul);
      state.units.push(unit);
      emit(state, { e: 'recalled', player: r.owner, unit: unit.id, kind: r.kind, rank: effectiveRank(unit) });
    }
    it.recalls = waiting;
  }
}

export function observeItems(state, side) {
  if (!state.items) return { pickups: [], shed: [] };
  return {
    pickups: state.items.pickups.map((p) => ({ ...p, name: STATS.items.list[p.item].name, line: STATS.items.list[p.item].line })),
    shed: shedSkins(state, side).map((s) => ({ id: s.id, kind: s.kind, rank: s.rank, items: s.items.slice(), cost: recallCost(s) })),
  };
}
