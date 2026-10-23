// Combat phase (spec section 7). Step 5 of a tick, after movement.
// Every attack in a tick is decided from positions and hp at the start of the phase, damage is summed per target,
// then applied together. Only after that are hits reported and dead entities removed.
import { STATS, UNIT_KINDS, STRUCTURE_KINDS } from "./stats.mjs";
import { distance, emit } from "./state.mjs";

// Idle units that fight on their own (spec section 7). Workers only fight when ordered.
const AUTO_KINDS = ["grunt", "lancer", "brute"];

const isUnit = (e) => UNIT_KINDS.includes(e.kind);
const isStructure = (e) => e.kind === "core" || STRUCTURE_KINDS.includes(e.kind);
const byId = (a, b) => a.id - b.id;

// Stats row for a unit or buildable structure. The Core has no row with damage, so it never attacks.
function statsOf(entity) {
  return isUnit(entity) ? STATS.units[entity.kind] : STATS.structures[entity.kind];
}

// Every unit and structure (sites included), lowest id first.
function everything(state) {
  return [...state.units, ...state.structures].sort(byId);
}

// Can this entity attack at all this tick? Units need an attack order, or no order and an auto-fighting kind.
// Turrets need to be complete.
function canAttack(entity) {
  const row = statsOf(entity);
  if (!row || row.damage === undefined) return false;
  if (isUnit(entity)) {
    if (!entity.order) return AUTO_KINDS.includes(entity.kind);
    return entity.order.type === "attack";
  }
  return entity.complete === true;
}

// The target this attacker hits this tick, or null (spec section 7).
// An attack order only ever hits its ordered target, and only when that target is in range.
// Otherwise the nearest living enemy in range is chosen, lower id winning ties.
export function chooseTarget(state, attacker) {
  if (!canAttack(attacker)) return null;
  const range = statsOf(attacker).range;
  const candidates = everything(state).filter((e) => e.owner !== attacker.owner);
  if (isUnit(attacker) && attacker.order) {
    const target = candidates.find((e) => e.id === attacker.order.target);
    return target && distance(attacker, target) <= range ? target : null;
  }
  let best = null;
  for (const e of candidates) {
    if (distance(attacker, e) > range) continue;
    if (!best || distance(attacker, e) < distance(attacker, best)) best = e;
  }
  return best;
}

// Attack cadence (opening pacing): an entity whose stats set attackTicks hits once, then waits that many ticks. An
// entity with no cooldown yet (or a row without attackTicks) is ready at once, so the first hit never waits.
function attackReady(state, entity) {
  const every = statsOf(entity).attackTicks;
  return !(every > 1) || !(entity.nextAttack > state.tick);
}

function startCooldown(state, entity) {
  const every = statsOf(entity).attackTicks;
  if (every > 1) entity.nextAttack = state.tick + every;
}

function removeFrom(list, entity) {
  const i = list.indexOf(entity);
  if (i >= 0) list.splice(i, 1);
}

// Runs the whole combat phase on the state in place.
export function stepCombat(state) {
  // 1. Decide every attack from the start-of-phase positions.
  const attacks = [];
  for (const attacker of everything(state).filter(canAttack)) {
    if (!attackReady(state, attacker)) continue;
    const target = chooseTarget(state, attacker);
    if (!target) continue;
    startCooldown(state, attacker);
    let dmg = statsOf(attacker).damage;
    if (isStructure(target)) dmg *= statsOf(attacker).structureMultiplier;
    // Opening pacing: a Core takes only a fraction of the damage until its hardened window ends.
    if (target.kind === "core" && state.tick < STATS.core.hardenedTicks) {
      dmg = Math.max(1, Math.round(dmg * STATS.core.hardenedMultiplier));
    }
    attacks.push({ attacker, target, dmg });
  }

  // 2. Sum damage per target, then apply it all at once. Hp never goes below 0.
  const total = new Map();
  for (const a of attacks) total.set(a.target, (total.get(a.target) ?? 0) + a.dmg);
  for (const [target, dmg] of total) target.hp = Math.max(0, target.hp - dmg);

  // 3. One hit per attack, in attacker id order. Each shows the target's hp after all damage this tick.
  for (const a of attacks) {
    emit(state, { e: "hit", id: a.target.id, by: a.attacker.id, dmg: a.dmg, hp: a.target.hp });
  }

  // 4. Remove everything at 0 hp and report the deaths in id order, right after the hits.
  const dead = everything(state).filter((e) => e.hp <= 0);
  for (const e of dead) removeFrom(isUnit(e) ? state.units : state.structures, e);
  for (const e of dead) emit(state, { e: "die", id: e.id });

  // 5. Orders that pointed at a removed entity clear (attack target gone, or build site gone).
  const gone = new Set(dead.map((e) => e.id));
  for (const unit of [...state.units].sort(byId)) {
    const order = unit.order;
    if (!order) continue;
    const pointsAtGone =
      (order.type === "attack" && gone.has(order.target)) || (order.type === "build" && gone.has(order.site));
    if (!pointsAtGone) continue;
    unit.order = null;
    emit(state, { e: "order", id: unit.id, order: null });
  }
}
