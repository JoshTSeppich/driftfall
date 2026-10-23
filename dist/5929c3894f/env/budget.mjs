// Driftfall — the army budget (TERRITORY.md section 9): no supply cap, training always runs and draws its cost
// gradually (into debt if needed), every combat unit pays upkeep per second, and debt pauses building and research
// but never training. Deep debt makes units weary.
//
// OFF BY DEFAULT. Nothing here changes a match until enableBudget(state) is called, so the 40-unit cap and
// pay-up-front training of the current rules stay exactly as they are. Callers (sim, commands, economy, combat)
// ask: chargesUpfront / unitCapApplies / canProgress / attackCooldownScale.
//
// Exact arithmetic: money is whole Shards in state.shards plus a remainder in state.budget.acc, counted in
// 1/scale of a Shard (scale = 60 * tps * 100 * 10000), so a minute of upkeep adds up to the exact number with no
// rounding drift. No randomness, no clock.
//
// Territory and faction facts are passed in through `opts`, because they live in modules that do not exist yet:
//   holdCount, moundCount  numbers (Reaches the side holds; Burrow Mounds it owns)
//   coil, inHeldReach(unit) Coil units pay less while inside a held Reach
//   costOf(kind)           number (Shards) or { shards, flux }; defaults to env/stats.mjs

import { STATS, kindStats } from "./stats.mjs";
import { emit } from "./state.mjs";

export const BUDGET = Object.freeze({
  tps: 24,
  upkeepPercentPerMinute: 10, // of a unit's cost
  holdReductionPercent: 3, // per held Reach...
  holdReductionMax: 30, // ...up to this
  moundReductionPercent: 2, // per Burrow Mound
  totalReductionMax: 60, // assumption: held land and Mounds together never remove more than this
  coilInReachPercent: 20, // extra discount for Coil units inside a held Reach
  wearyBelow: -500,
  wearyAttackSpeedPercent: 75, // attack speed while weary
});

const NO_UPKEEP = new Set(["worker"]);
const cfg = () => ({ ...BUDGET, ...(STATS.budget || {}) });

// ---------------------------------------------------------------------------------------------
// Switch and state
// ---------------------------------------------------------------------------------------------

export function enableBudget(state, options = {}) {
  const tps = Number.isFinite(options.tps) && options.tps > 0 ? options.tps : cfg().tps;
  state.budget = {
    scale: 60 * tps * 100 * 10000,
    acc: [0, 0],
    fluxAcc: [0, 0],
    drawn: {},
    debt: [false, false],
    weary: [false, false],
  };
  return state;
}

export const isEnabled = (state) => !!(state && state.budget);
export const chargesUpfront = (state) => !isEnabled(state);
export const unitCapApplies = (state) => !isEnabled(state);

// ---------------------------------------------------------------------------------------------
// Costs and upkeep
// ---------------------------------------------------------------------------------------------

function costParts(kind, opts) {
  let c = opts && opts.costOf ? opts.costOf(kind) : undefined;
  if (c === undefined) c = kindStats(kind)?.cost;
  if (typeof c === "number") return { shards: c, flux: 0 };
  if (c && typeof c === "object") return { shards: c.shards ?? c.s ?? 0, flux: c.flux ?? c.f ?? 0 };
  return { shards: 0, flux: 0 };
}

function reductionPercent(opts) {
  const c = cfg();
  const holds = Math.max(0, (opts && opts.holdCount) || 0);
  const mounds = Math.max(0, (opts && opts.moundCount) || 0);
  const r = Math.min(c.holdReductionMax, holds * c.holdReductionPercent) + mounds * c.moundReductionPercent;
  return Math.min(c.totalReductionMax, r);
}

// Upkeep of one unit, per minute, in units of 1/1e6 of its percent math: (cost * pct * (100-red) * (100-coil)).
function unitWeight(unit, red, opts) {
  const coil = opts && opts.coil && opts.inHeldReach && opts.inHeldReach(unit) ? cfg().coilInReachPercent : 0;
  return cfg().upkeepPercentPerMinute * (100 - red) * (100 - coil);
}

function upkeepSums(state, player, opts) {
  const red = reductionPercent(opts);
  let shards = 0;
  let flux = 0;
  for (const u of state.units) {
    if (u.owner !== player || NO_UPKEEP.has(u.kind)) continue;
    const cost = costParts(u.kind, opts);
    const w = unitWeight(u, red, opts);
    shards += cost.shards * w;
    flux += cost.flux * w;
  }
  return { shards, flux }; // each sum / 1e6 is the per-minute amount
}

/** Upkeep per minute for one side: { shards, flux } (fractions allowed; for the HUD flow panel). */
export function upkeepPerMinute(state, player, opts = {}) {
  const sums = upkeepSums(state, player, opts);
  return { shards: sums.shards / 1e6, flux: sums.flux / 1e6 };
}

// ---------------------------------------------------------------------------------------------
// Debt effects
// ---------------------------------------------------------------------------------------------

export const inDebt = (state, player) => state.shards[player] < 0;
export const isWeary = (state, player) => isEnabled(state) && state.shards[player] < cfg().wearyBelow;

/** Can this kind of work advance? Training always can; building and research stop in debt. */
export function canProgress(state, player, what) {
  if (!isEnabled(state) || what === "train") return true;
  return !inDebt(state, player);
}

/** Multiply an attack cooldown by this: 1 normally, 4/3 when weary (-25% attack speed). */
export function attackCooldownScale(state, player) {
  return isWeary(state, player) ? 100 / cfg().wearyAttackSpeedPercent : 1;
}

// ---------------------------------------------------------------------------------------------
// The per-tick step. Call it BEFORE stepProduction, so the tick a unit finishes is still paid for.
// ---------------------------------------------------------------------------------------------

function settle(state, player, amountOwed, key, bank) {
  const b = state.budget;
  const total = b[key][player] - amountOwed;
  const whole = Math.floor(total / b.scale);
  b[key][player] = total - whole * b.scale;
  if (whole !== 0) bank[player] += whole;
}

export function stepBudget(state, opts = {}) {
  const b = state.budget;
  if (!b) return;
  const S = b.scale;
  const owed = [0, 0];
  const owedFlux = [0, 0];

  // Upkeep this tick: per-minute sum / (1e6 per cent math) / (60 * tps) per tick, in 1/S units.
  // sum is cost*pct*(100-red)*(100-coil); S = 60*tps*1e6, so one tick of upkeep is exactly sum.
  for (const p of [0, 1]) {
    const sums = upkeepSums(state, p, opts);
    owed[p] += sums.shards;
    owedFlux[p] += sums.flux;
  }

  // Training draw: cost / trainTicks each tick the head item is counting down; the last tick takes the remainder.
  for (const s of state.structures) {
    if (!s.complete || !Array.isArray(s.queue) || s.queue.length === 0) continue;
    if (s.paused) continue; // a tier gate has paused this building: nothing is drawn
    if (s.training === 0) continue; // finished, waiting for a free tile: already paid
    const kind = s.queue[0];
    const trainTicks = kindStats(kind)?.trainTicks;
    if (!(trainTicks > 0)) continue;
    const fresh = s.training === null || s.training === undefined;
    if (fresh) b.drawn[s.id] = { shards: 0, flux: 0 };
    const d = b.drawn[s.id] || (b.drawn[s.id] = { shards: 0, flux: 0 });
    const left = fresh ? trainTicks : s.training;
    const cost = costParts(kind, opts);
    const totalS = cost.shards * S;
    const totalF = cost.flux * S;
    const dS = left <= 1 ? totalS - d.shards : Math.floor(totalS / trainTicks);
    const dF = left <= 1 ? totalF - d.flux : Math.floor(totalF / trainTicks);
    d.shards += dS;
    d.flux += dF;
    owed[s.owner] += dS;
    owedFlux[s.owner] += dF;
    if (left <= 1) delete b.drawn[s.id];
  }

  const fluxBank = Array.isArray(state.flux) ? state.flux : null;
  for (const p of [0, 1]) {
    settle(state, p, owed[p], "acc", state.shards);
    if (fluxBank) settle(state, p, owedFlux[p], "fluxAcc", fluxBank);
  }

  // Announce changes once.
  for (const p of [0, 1]) {
    const debt = state.shards[p] < 0;
    if (debt !== b.debt[p]) {
      b.debt[p] = debt;
      emit(state, { e: "debt", player: p, on: debt, shards: state.shards[p] });
    }
    const weary = state.shards[p] < cfg().wearyBelow;
    if (weary !== b.weary[p]) {
      b.weary[p] = weary;
      emit(state, { e: "weary", player: p, on: weary });
    }
  }
}
