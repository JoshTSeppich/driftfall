// Driftfall — the Toast Economy (TERRITORY.md sections 17 and 18). Pure module, OFF until enableToast(state) is called.
//
// Toast is baked at the Power Strip (your Core) from Flour + Water + Energy. Every fighting unit eats one Toast a minute.
// What it eats decides its mood:
//   happy   it got what it wants (plain for rank 0, butter, jam, then a gourmet topping) — attacks 10% faster
//   grumpy  it got plain toast when it wanted a topping, or the topping was not in the bank — attacks 15% slower
//   strike  no Toast at all — it sits down with a picket sign and cannot attack until fed
// Toppings are the existing bank resources (the Trading House sells them): butter = flux, jam = glowmoss, honey =
// amberlight, salt = quakestone, sugar = stormglass, nut butter = ironroot. Eating a topping pays it from the bank.
// Workers do not eat (they are the economy, and carry no upkeep, as in env/budget.mjs).
//
// Shared contract (what other files call):
//   enableToast(state)                  creates state.toast (idempotent)
//   isToastOn(state)
//   addIngredient(state, side, name, n) -> bool   name is flour, water or energy; the Power Strip's pantry
//   stepToast(state)                    call once a tick (uses state.tick): bakes, then feeds, then forgets old logs
//   canAttack(state, unit)              false only while the unit is on strike
//   toastAttackScale(state, unit)       multiply the unit's attack cooldown by this (1 unless happy or grumpy)
//   observeToast(state, side) -> { stack, pantry, perMinute: {in, eaten}, units: [{id, kind, rank, mood, wants}] } | null
//   wantedTopping(unit) -> 'butter' | 'jam' | 'honey' | 'salt' | 'sugar' | 'nutbutter' | null (plain)
//
// Numbers come from STATS.toast when it is set, else from TOAST below. No randomness, no clock.
import { STATS } from "./stats.mjs";
import { emit } from "./state.mjs";
import { effectiveRank } from "./items.mjs";
import { creditResource } from "./economy.mjs";

export const TOAST = Object.freeze({
  mealSeconds: 60, // one Toast each minute, per fighting unit
  bakeSeconds: 5, // the Power Strip bakes one Toast this often, when its pantry is full
  windowSeconds: 60, // the HUD's "per minute" looks back this far
  happyAttackPercent: 10, // happy units attack 10% faster
  grumpyAttackPercent: 15, // grumpy units attack 15% slower
});

export const INGREDIENTS = Object.freeze(["flour", "water", "energy"]);

// Topping -> the existing bank resource it is paid from. Every value is a tradable resource (see env/market.mjs).
export const TOPPINGS = Object.freeze({
  butter: "flux",
  jam: "glowmoss",
  honey: "amberlight",
  salt: "quakestone",
  sugar: "stormglass",
  nutbutter: "ironroot",
});

// Rank 3 (gourmet) picks one of these, by unit id, so the same unit always wants the same topping.
export const GOURMET = Object.freeze(["honey", "salt", "sugar", "nutbutter"]);

const NON_FIGHTERS = new Set(["worker"]);
const cfg = () => ({ ...TOAST, ...(STATS.toast || {}) });
const tps = () => STATS.clock.ticksPerSecond;

export function enableToast(state) {
  if (!state.toast) {
    state.toast = {
      stack: [0, 0],
      pantry: [0, 1].map(() => ({ flour: 0, water: 0, energy: 0 })),
      cooldown: [0, 0], // the tick each side may bake again
      made: [[], []], // ticks of recent bakes (for the HUD window)
      eaten: [[], []], // ticks of recent meals (for the HUD window)
      units: {}, // unit id -> { side, mood, nextMeal }
    };
  }
  return state.toast;
}

export const isToastOn = (state) => !!(state && state.toast);

export function addIngredient(state, side, name, n) {
  if (!isToastOn(state) || !INGREDIENTS.includes(name)) return false;
  if (!Number.isInteger(n) || n <= 0) return false;
  state.toast.pantry[side][name] += n;
  return true;
}

/** The topping a unit wants (its taste), or null for plain toast. */
export function wantedTopping(unit) {
  const rank = Math.min(3, effectiveRank(unit));
  if (rank === 0) return null;
  if (rank === 1) return "butter";
  if (rank === 2) return "jam";
  return GOURMET[Math.abs(Number(unit.id) || 0) % GOURMET.length];
}

const isFighter = (unit) => unit.hp > 0 && !NON_FIGHTERS.has(unit.kind);
const hasPowerStrip = (state, side) => state.structures.some((s) => s.kind === "core" && s.owner === side && s.hp > 0);

function setMood(state, id, side, entry, mood) {
  if (entry.mood === mood) return;
  entry.mood = mood;
  emit(state, { e: "mood", id, player: side, mood });
}

function bake(state, side, tick) {
  const T = state.toast;
  const pantry = T.pantry[side];
  if (tick < T.cooldown[side] || !hasPowerStrip(state, side)) return;
  if (!INGREDIENTS.every((name) => pantry[name] >= 1)) return;
  for (const name of INGREDIENTS) pantry[name] -= 1;
  T.stack[side] += 1;
  T.made[side].push(tick);
  T.cooldown[side] = tick + cfg().bakeSeconds * tps();
}

function feed(state, side, unit, entry, tick) {
  const T = state.toast;
  if (T.stack[side] < 1) {
    setMood(state, unit.id, side, entry, "strike");
    entry.nextMeal = tick + 1; // a striker checks again every tick
    return;
  }
  T.stack[side] -= 1;
  T.eaten[side].push(tick);
  entry.nextMeal = tick + cfg().mealSeconds * tps();
  const wanted = wantedTopping(unit);
  // Plain toast fed to a unit that wants a topping is grumpy; so is a topping the side cannot pay for.
  const pleased = !wanted || creditResource(state, side, TOPPINGS[wanted], -1);
  setMood(state, unit.id, side, entry, pleased ? "happy" : "grumpy");
}

export function stepToast(state) {
  const T = state.toast;
  if (!T) return;
  const tick = state.tick;
  const fighters = state.units.filter(isFighter);
  const alive = new Set(fighters.map((u) => String(u.id)));

  for (const id of Object.keys(T.units)) if (!alive.has(id)) delete T.units[id];

  for (const side of [0, 1]) bake(state, side, tick);

  for (const unit of fighters) {
    const side = unit.owner;
    let entry = T.units[unit.id];
    if (!entry) entry = T.units[unit.id] = { side, mood: "happy", nextMeal: tick };
    if (tick >= entry.nextMeal) feed(state, side, unit, entry, tick);
  }

  const cutoff = tick - cfg().windowSeconds * tps();
  for (const side of [0, 1]) {
    T.made[side] = T.made[side].filter((t) => t > cutoff);
    T.eaten[side] = T.eaten[side].filter((t) => t > cutoff);
  }
}

export function canAttack(state, unit) {
  const entry = isToastOn(state) ? state.toast.units[unit.id] : undefined;
  return !(entry && entry.mood === "strike");
}

export function toastAttackScale(state, unit) {
  const entry = isToastOn(state) ? state.toast.units[unit.id] : undefined;
  if (!entry) return 1;
  if (entry.mood === "happy") return 100 / (100 + cfg().happyAttackPercent);
  if (entry.mood === "grumpy") return 100 / (100 - cfg().grumpyAttackPercent);
  return 1;
}

export function observeToast(state, side) {
  if (!isToastOn(state)) return null;
  const T = state.toast;
  const cutoff = state.tick - cfg().windowSeconds * tps();
  const units = state.units
    .filter((u) => u.owner === side && isFighter(u))
    .map((u) => ({
      id: u.id,
      kind: u.kind,
      rank: Math.min(3, effectiveRank(u)),
      mood: T.units[u.id] ? T.units[u.id].mood : "happy",
      wants: wantedTopping(u) || "plain",
    }));
  return {
    stack: T.stack[side],
    pantry: { ...T.pantry[side] },
    perMinute: {
      in: T.made[side].filter((t) => t > cutoff).length,
      eaten: T.eaten[side].filter((t) => t > cutoff).length,
    },
    units,
  };
}
