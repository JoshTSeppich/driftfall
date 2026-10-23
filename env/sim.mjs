// Driftfall simulation loop (ENV-SPEC.md §8 and §9).
//
//   createMatch(seed)            -> fresh state at tick 0
//   step(state, [cmds0, cmds1])  -> the tick's events (state is mutated in place)
//   checkEnd(state)              -> { winner, reason, tick, value } or null
//
// Determinism: no Math.random, Date, timers or async here. Side order flips on
// odd ticks (§8 fairness rule); the id-order flip inside each phase is done by
// the phase module itself, reading state.tick.

import { createInitialState } from './state.mjs';
import { applyCommands } from './commands.mjs';
import { stepProduction, stepGathering } from './economy.mjs';
import { stepMovement } from './movement.mjs';
import { stepCombat } from './combat.mjs';
import { STATS, sideValue, canonKind } from './stats.mjs';
import { applyRuleCommands, stepRulesPre, stepRulesPost, runProduction } from './sim-territory.mjs';

const DEFAULT_MAX_TICKS = 2000;

/** The tick limit (§9 step 3): STATS.match.maxTicks. A test state may carry its own `maxTicks` override. */
export function maxTicksOf(state) {
  if (state && Number.isInteger(state.maxTicks) && state.maxTicks > 0) return state.maxTicks;
  const fromStats = STATS.match && STATS.match.maxTicks;
  return Number.isInteger(fromStats) && fromStats > 0 ? fromStats : DEFAULT_MAX_TICKS;
}

/** Which side acts first on the tick being computed from `tick` (§8): side 0 on even ticks, side 1 on odd. */
export function sideOrder(tick) {
  return tick % 2 === 0 ? [0, 1] : [1, 0];
}

// Toaster names are aliases (env/stats.mjs ROSTER): { type: 'train', kind: 'popper' } means 'grunt'. Anything that is not
// a known name passes through unchanged, so the normal reject reasons still apply.
function withCanonKind(command) {
  if (!command || typeof command !== 'object' || typeof command.kind !== 'string') return command;
  const kind = canonKind(command.kind);
  return kind && kind !== command.kind ? { ...command, kind } : command;
}

/** Create a new match from a seed: the initial state at tick 0. */
export function createMatch(seed) {
  const state = createInitialState(seed);
  if (!Array.isArray(state.events)) state.events = [];
  if (state.result === undefined) state.result = null;
  return state;
}

/**
 * Advance the state by one tick, running the six phases of §8 in order:
 * commands (side order flips on odd ticks), production, gathering, movement,
 * combat, then the tick counter and the end check. Returns the tick's events.
 */
export function step(state, commands) {
  state.events = [];

  const lists = Array.isArray(commands) ? commands : [];
  const perSide = [0, 1].map((p) => (Array.isArray(lists[p]) ? lists[p].map(withCanonKind) : []));

  // 1. Commands, one side then the other.
  for (const player of sideOrder(state.tick)) {
    applyCommands(state, player, applyRuleCommands(state, player, perSide[player]));
  }

  // 2. Production: training queues and construction sites. (Territory rules, only when on: Drift clock, claims, budget.)
  stepRulesPre(state);
  runProduction(state, stepProduction);

  // 3. Gathering: mining, delivery, retargeting.
  stepGathering(state);

  // 4. Movement.
  stepMovement(state);

  // 5. Combat: simultaneous damage, then deaths.
  stepCombat(state);

  // 6. Tick ends, then the end check.
  state.tick += 1;
  state.result = checkEnd(state);
  if (!state.result) state.result = stepRulesPost(state);

  return state.events;
}

function coreOf(state, player) {
  // Structures are kept in id order; the first matching Core is the one.
  for (const s of state.structures) {
    if (s.kind === 'core' && s.owner === player) return s;
  }
  return null;
}

/**
 * The match-end check of §9, in order: both Cores gone ⇒ draw (`both-cores`);
 * one Core gone ⇒ the other side wins (`core`); tick reached the limit ⇒ higher
 * value wins (`timeout`), exact tie ⇒ draw (`timeout`). Otherwise null.
 */
export function checkEnd(state) {
  const value = [sideValue(state, 0), sideValue(state, 1)];
  const tick = state.tick;
  const core0 = coreOf(state, 0);
  const core1 = coreOf(state, 1);

  if (!core0 && !core1) return { winner: null, reason: 'both-cores', tick, value };
  if (!core0) return { winner: 1, reason: 'core', tick, value };
  if (!core1) return { winner: 0, reason: 'core', tick, value };

  if (tick >= maxTicksOf(state)) {
    if (value[0] > value[1]) return { winner: 0, reason: 'timeout', tick, value };
    if (value[1] > value[0]) return { winner: 1, reason: 'timeout', tick, value };
    return { winner: null, reason: 'timeout', tick, value };
  }

  return null;
}
