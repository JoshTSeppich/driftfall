// Combat phase (spec section 7). Step 5 of a tick, after movement.
// Every attack in a tick is decided from positions and hp at the start of the phase, damage is summed per target,
// then applied together. Only after that are hits reported and dead entities removed.
import { UNIT_KINDS, STRUCTURE_KINDS, PACING, rowOf } from "./stats.mjs";
import { distance, emit } from "./state.mjs";
import { canFire, spendShot } from "./ammo.mjs";

// Idle units that fight on their own (spec section 7). Workers (Crumbs) only fight when ordered.
const AUTO_KINDS = ["grunt", "lancer", "brute", "howler", "spiker", "dart"];

const isUnit = (e) => UNIT_KINDS.includes(e.kind);
const isStructure = (e) => e.kind === "core" || STRUCTURE_KINDS.includes(e.kind);
const byId = (a, b) => a.id - b.id;

// Stats row for a unit or buildable structure. The Core has no row with damage, so it never attacks.
// With hunger on (state.ammo) this is the Toaster-Wars overlay row: toaster ranges and shots.
function statsOf(entity, state) {
  return rowOf(state, entity.kind);
}

// Every unit and structure (sites included), lowest id first.
function everything(state) {
  return [...state.units, ...state.structures].sort(byId);
}

// Can this entity attack at all this tick? Units need an attack order, or no order and an auto-fighting kind.
// Turrets need to be complete.
// With hunger on a shot also needs power and slices (fed) and waits out the unit's cadence (its `shot.every`).
function canAttack(entity, state) {
  const row = statsOf(entity, state);
  if (!row || row.damage === undefined) return false;
  if (state.ammo) {
    if (state.tick < (entity.nextShot ?? 0)) return false;
    if (isUnit(entity) && !canFire(state, entity)) return false;
  }
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
  if (!canAttack(attacker, state)) return null;
  const range = statsOf(attacker, state).range;
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

function removeFrom(list, entity) {
  const i = list.indexOf(entity);
  if (i >= 0) list.splice(i, 1);
}

// Runs the whole combat phase on the state in place.
export function stepCombat(state) {
  // 1. Decide every attack from the start-of-phase positions.
  const attacks = [];
  const all = everything(state);
  for (const attacker of all.filter((e) => canAttack(e, state))) {
    const target = chooseTarget(state, attacker);
    if (!target) continue;
    // Opening pace: a paced Core takes no damage until its 3:00 shield is down (env/stats.mjs PACING).
    if (state.pacing && target.kind === "core" && state.tick < PACING.coreShieldTicks) continue;
    const row = statsOf(attacker, state);
    let dmg = state.ammo && row.shot ? row.shot.damage : row.damage;
    if (isStructure(target)) dmg *= row.structureMultiplier;
    if (state.ammo) {
      if (isUnit(attacker)) spendShot(state, attacker, target.id);
      attacker.nextShot = state.tick + (row.shot ? row.shot.every : 1);
    }
    attacks.push({ attacker, target, dmg });
    // Broiler shell and Flak burst: enemy neighbours of the target take half.
    if (state.ammo && row.splash) {
      for (const near of all) {
        if (near === target || near.owner === attacker.owner || distance(near, target) > row.splash) continue;
        attacks.push({ attacker, target: near, dmg: Math.max(1, Math.floor(dmg / 2)) });
      }
    }
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
