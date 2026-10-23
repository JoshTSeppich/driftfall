// Live driver (CLASSIC.md): a human plays one side in real time, the built-in AI plays the other.
//
//   const driver = createLiveMatch({ seed, human: 0, ai: '../players/haiku/bot.mjs' })
//   await driver.ready()        // loads the AI (a module that fails to load forfeits at tick 0, like the referee)
//   driver.on('tick', ({ tick, events, commands, late, result }) => render())   // one per logged tick
//   driver.on('end', (result) => showBanner(result))     // once; a load failure ends before any tick
//   driver.on('error', (message) => ...)                 // the sim threw: the clock has stopped, see clock.failure
//   driver.queue({ type: 'move', unit: 3, x: 10, y: 10 })   // applied on the next tick
//   driver.start()              // 24 ticks per second until the match ends
//
// What this file promises:
//   - The sim (env/sim.mjs) stays the only source of truth; this file only feeds it commands on a fixed clock.
//   - Human commands are queued and applied on the next tick, at most STATS.match.maxCommandsPerTick per tick;
//     extras carry over in order (so an order is never silently lost, it is at worst one tick later).
//   - The AI runs under the referee rules of ENV-SPEC §11, in process: a reply slower than thinkMs is `late`
//     and discarded; a throw, a non-array, a reply that is not plain JSON or holds a command longer than
//     maxCommandChars is an `error` (empty commands, one strike); maxErrors strikes, or no reply within hardMs,
//     is a `forfeit`. Same option names and messages as env/referee.mjs, so the two drivers judge alike.
//   - driver.log is a standard driftfall-log (env/log.mjs), so every live game is a replay for free, and
//     rerun(log) steps the same seed through the same commands and gives the same events and state.
//   - The clock is injectable (now, setTimer, clearTimer) so tests run with a fake clock and stay deterministic.
//     Nothing here is random. The clock never touches the sim: it only decides *when* tick() is called.
//
// Clock rules: fixed timestep of 1000 / tps ms (24 tps ≈ 41.7 ms). When the page stalls (hidden tab, slow AI)
// at most maxCatchUp ticks run per wake-up and any lag beyond that is dropped, never fast-forwarded. pause()
// stops the clock with no catch-up on resume().
//
// Where it runs: node (tests, a future server) and the browser (play/index.html imports the bot file directly;
// every team bot is a single self-contained file by the §11 rule).

import { createMatch, step, checkEnd } from './sim.mjs';
import { observe } from './state.mjs';
import { STATS, sideValue } from './stats.mjs';
import { createLog, appendTick, finishLog } from './log.mjs';

export const DEFAULTS = Object.freeze({
  tps: 24,
  human: 0,
  thinkMs: STATS.referee.thinkMs,
  hardMs: STATS.referee.hardMs,
  maxErrors: STATS.referee.throwLimit,
  maxCommandChars: STATS.referee.commandChars,
  maxCommandsPerTick: STATS.match.maxCommandsPerTick,
  maxCatchUp: 6,
  // CLASSIC.md: a full match is about 10 to 15 minutes of real time. The stats table's 2000-tick limit was set
  // for bot-versus-bot runs and is only 83 seconds at 24 tps (sonnet's finding), so a live match defaults to
  // 15 minutes; pass maxTicks to change it. The AI still sees STATS.match.maxTicks in its observation.
  maxTicks: 24 * 60 * 15,
  // Peace period: the AI is not asked to act before this tick, so a new player is never rushed before 3:00
  // (Joshua saw DEFEAT at 0:10; the stats are still tuned for 83-second bot matches). aiStartTick: 0 removes it.
  aiStartTick: 24 * 180,
  aiEvery: 1, // the AI thinks every tick; a caller may raise it (see DIFFICULTY for why easy does not)
  humanName: 'human',
});

// The "easy" setting from CLASSIC.md belongs to the AI module: createPlayer receives `difficulty` and tunes itself
// (players/builtin/ai.mjs does). The driver can also make the AI think only every N ticks (`aiEvery`), but
// measured against the team bots that changes almost nothing because orders persist between thinks (sonnet bot
// kills an idle Core at tick 259 thinking every tick, 271 thinking every 4th), so no difficulty maps to a throttle
// by default. The log records exactly the commands applied either way, so replays stay exact.
export const DIFFICULTY = Object.freeze({ normal: 1, easy: 1 });

const describe = (err) => (err instanceof Error ? err.message || err.name : String(err));

function describeValue(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'object') return 'an object';
  return 'a ' + typeof v;
}

// Length of `value` as JSON, or null when it cannot be turned into JSON (BigInt, cycles, hostile getters).
function jsonLength(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text.length : null;
  } catch {
    return null;
  }
}

// The referee's size rule (env/referee.mjs oversizedCommand): the whole list is measured once; only when it is
// over the limit is each command measured, and one command over the limit (or anything that is not plain
// JSON) is the problem. Returns the error message, or null when the reply is fine.
function oversizedCommand(list, limit) {
  const notJson = 'act returned commands that are not plain JSON';
  const whole = jsonLength(list);
  if (whole === null) return notJson;
  if (whole <= limit) return null;
  for (let i = 0; i < list.length; i++) {
    const size = jsonLength(list[i]);
    if (size === null) return notJson;
    if (size > limit) return 'command ' + i + ' is ' + size + ' characters of JSON, more than the ' + limit + ' allowed';
  }
  return null;
}

const defaultNow = () => (globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : Date.now());

function stripYou(observation) {
  const copy = { ...observation };
  delete copy.you;
  return copy;
}

/**
 * Turn whatever the caller gave as `ai` into a player object { name, act }.
 *   - a string: module path or URL, imported dynamically (node resolves relative to the working directory via
 *     the caller's URL when it is already absolute; the browser resolves it against the page)
 *   - a module (or object) with createPlayer
 *   - a player object with act
 * Throws when the result does not have an act function.
 */
export async function loadAi(ai, { side, seed, difficulty = 'normal' }) {
  let candidate = ai;
  if (typeof ai === 'string') {
    candidate = await import(ai);
  } else if (typeof ai === 'function') {
    candidate = { createPlayer: ai };
  }
  if (candidate && typeof candidate.createPlayer === 'function') {
    // `difficulty` is extra to the §10 player API; bots that know it (players/builtin) tune themselves, the rest
    // ignore it.
    candidate = await candidate.createPlayer({ side, seed, stats: STATS, difficulty });
  }
  if (!candidate || typeof candidate.act !== 'function') throw new Error('the AI did not give an object with an act function');
  return candidate;
}

/**
 * Re-run a log's commands through the simulation from its seed. Returns { state, ticks } where each entry of
 * `ticks` is { tick, commands, events } with the sim's own events (the referee-style late/error/forfeit markers
 * are not produced by the sim, so compare against sim events only, see simEvents()). This is the lockstep
 * promise of CLASSIC.md: the same seed and commands give the same game.
 */
export function rerun(log, { maxTicks } = {}) {
  const state = createMatch(log.seed);
  // The log does not record the live match's tick limit, and a live game may run far past the stats table's
  // 2000 (see DEFAULTS.maxTicks). The log's own length is the limit that reproduces it: a game that ended by
  // timeout at tick N ends by timeout at N again, and one that ended earlier by a Core kill is unaffected
  // because the Core check comes before the tick check (§9).
  const inferred = Math.max(log.ticks.length, STATS.match.maxTicks);
  state.maxTicks = Number.isInteger(maxTicks) && maxTicks > 0 ? maxTicks : inferred;
  const ticks = [];
  for (const entry of log.ticks) {
    if (state.result) break;
    const commands = [entry.commands?.[0] ?? [], entry.commands?.[1] ?? []];
    const events = step(state, commands);
    ticks.push({ tick: entry.tick, commands, events: events.map((e) => ({ ...e })) });
  }
  return { state, ticks };
}

const REFEREE_EVENTS = new Set(['late', 'error', 'forfeit']);

/** The events of one log tick entry without the referee markers (late, error, forfeit). */
export function simEvents(events) {
  return (events || []).filter((e) => !REFEREE_EVENTS.has(e.e));
}

export function createLiveMatch(options = {}) {
  const seed = options.seed ?? 1;
  const human = options.human === 1 ? 1 : 0;
  const aiSide = 1 - human;
  const tps = Number.isFinite(options.tps) && options.tps > 0 ? options.tps : DEFAULTS.tps;
  const interval = 1000 / tps;
  const thinkMs = options.thinkMs ?? DEFAULTS.thinkMs;
  const hardMs = options.hardMs ?? DEFAULTS.hardMs;
  const maxErrors = options.maxErrors ?? DEFAULTS.maxErrors;
  const maxCommandChars = options.maxCommandChars ?? DEFAULTS.maxCommandChars;
  const maxCommandsPerTick = options.maxCommandsPerTick ?? DEFAULTS.maxCommandsPerTick;
  const maxCatchUp = Math.max(1, options.maxCatchUp ?? DEFAULTS.maxCatchUp);
  const difficulty = typeof options.difficulty === 'string' && options.difficulty ? options.difficulty : 'normal';
  const aiEvery = Math.max(1, options.aiEvery ?? DIFFICULTY[difficulty] ?? DEFAULTS.aiEvery);
  const aiStartTick = Math.max(0, options.aiStartTick ?? DEFAULTS.aiStartTick);
  const humanName = options.humanName ?? DEFAULTS.humanName;
  const now = options.now ?? defaultNow;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));

  const state = createMatch(seed);
  state.maxTicks = options.maxTicks ?? DEFAULTS.maxTicks;

  const names = [];
  names[human] = humanName;
  names[aiSide] = typeof options.ai === 'string' ? options.ai.split('/').pop() : 'ai';
  const log = createLog({ seed, players: [names[0], names[1]], stats: STATS, initial: stripYou(observe(state, 0)) });

  const listeners = { tick: [], end: [], error: [] };
  const clock = { ticks: 0, late: 0, errors: 0, dropped: 0, behindMs: 0, lastTickMs: 0, failure: null };

  let ai = null; // the player object once ready()
  let readyPromise = null;
  let loadFailure = null;
  let aiAlive = true; // false after a hard timeout (the referee would have killed the process)
  let aiErrors = 0;
  let pending = []; // human commands waiting for the next tick
  let result = null;
  let running = false;
  let timer = null;
  // Tick n of the current run is due at origin + n * interval (computed, not accumulated, so 24 ticks land on
  // exactly 1000 ms with no floating-point drift).
  let origin = 0;
  let due = 0;
  const nextAt = () => origin + due * interval;
  const restartClock = () => {
    origin = now();
    due = 1; // the first tick comes one interval after the start, never on the same instant
  };
  let ticking = null; // the promise of the tick in progress, so ticks never overlap
  let lastTickAt = 0; // clock time when the latest tick finished (for time())
  let stopped = false;

  const emitTo = (kind, payload) => {
    for (const fn of listeners[kind].slice()) {
      try {
        fn(payload);
      } catch (err) {
        // a listener's bug must not stop the match
        if (typeof console !== 'undefined' && console.error) console.error('live listener failed:', describe(err));
      }
    }
  };

  function finish(res) {
    result = res;
    state.result = res;
    finishLog(log, res);
    halt();
    emitTo('end', res);
  }

  function halt() {
    running = false;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  const valuesOf = () => [sideValue(state, 0), sideValue(state, 1)];

  // ---- the AI, under the referee rules ----

  // Resolves with { status: 'ok', commands, ms } | { status: 'error', message, ms } | { status: 'timeout', ms }.
  function askAi(observation) {
    if (!aiAlive) return Promise.resolve({ status: 'timeout', ms: 0 });
    const t0 = now();
    let replied;
    try {
      replied = Promise.resolve(ai.act(observation));
    } catch (err) {
      return Promise.resolve({ status: 'error', message: describe(err), ms: now() - t0 });
    }
    return new Promise((resolve) => {
      let done = false;
      const settle = (reply) => {
        if (done) return;
        done = true;
        clearTimer(hardTimer);
        resolve({ ...reply, ms: now() - t0 });
      };
      const hardTimer = setTimer(() => {
        aiAlive = false; // the referee kills the process here; in process we can only stop listening to it
        settle({ status: 'timeout' });
      }, hardMs);
      replied.then(
        (commands) => settle({ status: 'ok', commands }),
        (err) => settle({ status: 'error', message: describe(err) }),
      );
    });
  }

  // Applies the referee's verdict on one reply: returns the commands to use and pushes the marker events.
  function judgeReply(reply, events) {
    if (reply.status === 'timeout') {
      events.push({ e: 'forfeit', player: aiSide, reason: 'timeout' });
      return { commands: [], forfeit: true };
    }
    let commands = [];
    const late = reply.ms > thinkMs;
    if (late) {
      clock.late += 1;
      events.push({ e: 'late', player: aiSide });
    }
    const strike = (message) => {
      aiErrors += 1;
      clock.errors += 1;
      events.push({ e: 'error', player: aiSide, message });
    };
    if (reply.status === 'error') strike(reply.message);
    else if (!Array.isArray(reply.commands)) strike('act returned ' + describeValue(reply.commands) + ', not an array');
    else if (!late) {
      const problem = oversizedCommand(reply.commands, maxCommandChars);
      if (problem) strike(problem);
      else commands = reply.commands;
    }
    if (aiErrors >= maxErrors) {
      events.push({ e: 'forfeit', player: aiSide, reason: 'errors' });
      return { commands: [], forfeit: true };
    }
    return { commands, forfeit: false };
  }

  // ---- one tick ----

  async function runTick() {
    const tick = state.tick;
    const events = [];
    const timing = [0, 0];
    const commands = [[], []];

    // AI first: ask under the referee rules (only on its thinking ticks). The reply may take a while.
    let forfeit = false;
    if (tick >= aiStartTick && tick % aiEvery === 0) {
      const reply = await askAi(observe(state, aiSide));
      timing[aiSide] = Math.round(reply.ms * 1000) / 1000;
      const verdict = judgeReply(reply, events);
      commands[aiSide] = verdict.commands;
      forfeit = verdict.forfeit;
    }

    // stop() or resign() landed while the AI was thinking: nothing is applied or logged (haiku's catch).
    if (stopped || result) return null;

    // Human last, right before the step: everything queued up to this instant (including inside the previous
    // tick's listener) lands on this tick, so a client needs no "before step" hook.
    commands[human] = pending.slice(0, maxCommandsPerTick);
    pending = pending.slice(maxCommandsPerTick);

    if (forfeit) {
      // The forfeiting tick is logged but not stepped (as in the referee). It still fires a tick event, carrying
      // the result, so a renderer sees every logged tick before the end event.
      appendTick(log, { tick, commands: [[], []], events }, timing);
      const end = { winner: human, reason: 'forfeit', tick: state.tick, value: valuesOf() };
      const payload = { tick, events, commands: [[], []], late: events.some((e) => e.e === 'late'), result: end };
      emitTo('tick', payload);
      finish(end);
      return payload;
    }

    const stepEvents = step(state, commands);
    const all = events.concat(stepEvents);
    appendTick(log, { tick, commands, events: all }, timing);
    clock.ticks += 1;
    const payload = { tick, events: all, commands, late: events.some((e) => e.e === 'late'), result: null };
    const end = state.result ?? checkEnd(state);
    if (end) {
      payload.result = end;
      emitTo('tick', payload);
      finish(end);
    } else {
      emitTo('tick', payload);
    }
    return payload;
  }

  // Advance exactly one tick. Serialised: a second call while one is in flight waits for it.
  async function tick() {
    if (result || stopped) return null;
    if (ticking) await ticking;
    if (result || stopped) return null;
    if (!ai) await ready();
    if (result) return null;
    const t0 = now();
    ticking = runTick();
    try {
      return await ticking;
    } finally {
      ticking = null;
      lastTickAt = now();
      clock.lastTickMs = lastTickAt - t0;
    }
  }

  // The fractional tick for a renderer (viewer3d/engine.mjs reads world.now()): the state the driver holds is
  // tick T, so the picture shown is between T - 1 and T, with the fraction being how much of one interval has
  // passed since tick T was applied. That is one tick (42 ms) of display latency, the classic trade for smooth
  // motion. Frozen while paused, never past T, and 0 before the first tick.
  function time() {
    if (state.tick === 0) return 0;
    const fraction = running ? Math.min(1, Math.max(0, (now() - lastTickAt) / interval)) : 1;
    return state.tick - 1 + fraction;
  }

  // ---- the clock ----

  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      await pumpTicks();
    } catch (err) {
      // A bug in the sim threw: stop the clock instead of ticking into a broken state, and report it through
      // clock.failure and the error listeners. Not rethrown: the caller is a timer, so a rethrow would be an
      // unhandled rejection that kills a node process (haiku's note).
      clock.failure = describe(err);
      halt();
      if (typeof console !== 'undefined' && console.error) console.error('live driver stopped:', clock.failure);
      emitTo('error', clock.failure);
    } finally {
      pumping = false;
    }
  }

  async function pumpTicks() {
    let ran = 0;
    while (running && !result && now() >= nextAt() && ran < maxCatchUp) {
      await tick();
      due += 1;
      ran += 1;
    }
    if (!running || result) return;
    const lag = now() - nextAt();
    if (lag > interval * maxCatchUp) {
      // Too far behind (hidden tab, a long AI stall): drop the lag instead of fast-forwarding the game.
      clock.dropped += Math.floor(lag / interval);
      clock.behindMs = 0;
      restartClock();
    } else {
      clock.behindMs = Math.max(0, lag);
    }
    schedule();
  }

  function schedule() {
    if (!running || result) return;
    if (timer !== null) clearTimer(timer);
    const wait = Math.max(0, nextAt() - now());
    timer = setTimer(() => {
      timer = null;
      pump();
    }, wait);
  }

  // ---- public ----

  function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        try {
          ai = await loadAi(options.ai, { side: aiSide, seed, difficulty });
          if (typeof ai.name === 'string' && ai.name.length) {
            names[aiSide] = ai.name;
            log.players = [names[0], names[1]];
          }
        } catch (err) {
          loadFailure = describe(err);
          ai = { name: names[aiSide], act: () => [] };
          aiAlive = false;
          // A module that failed to load forfeits at tick 0, before any step (§11).
          appendTick(log, { tick: state.tick, commands: [[], []], events: [{ e: 'forfeit', player: aiSide, reason: 'load' }] }, [0, 0]);
          finish({ winner: human, reason: 'forfeit', tick: state.tick, value: valuesOf() });
        }
        return { ok: !loadFailure, message: loadFailure, name: names[aiSide] };
      })();
    }
    return readyPromise;
  }

  function queue(command) {
    if (result || stopped) return false;
    if (Array.isArray(command)) {
      let ok = true;
      for (const c of command) ok = queue(c) && ok;
      return ok;
    }
    if (!command || typeof command !== 'object') return false;
    pending.push(command);
    return true;
  }

  function start() {
    if (result || stopped || running) return false;
    running = true;
    ready().then(() => {
      if (!running || result) return;
      restartClock(); // the clock starts once the AI is loaded, so loading time is never "caught up"
      schedule();
    });
    return true;
  }

  function pause() {
    if (!running) return false;
    halt();
    return true;
  }

  function resume() {
    if (result || stopped || running) return false;
    running = true;
    restartClock(); // no catch-up for the paused time
    schedule();
    return true;
  }

  // Stops the clock for good without finishing the log (the page is closing, or a test is done).
  function stop() {
    stopped = true;
    halt();
  }

  // The human gives up: the AI wins by forfeit (reason 'quit' in the log), like leaving a classic match.
  function resign() {
    if (result || stopped) return result;
    appendTick(log, { tick: state.tick, commands: [[], []], events: [{ e: 'forfeit', player: human, reason: 'quit' }] }, [0, 0]);
    finish({ winner: aiSide, reason: 'forfeit', tick: state.tick, value: valuesOf() });
    return result;
  }

  function on(kind, fn) {
    if (!listeners[kind]) throw new Error('unknown event: ' + kind + ' (use tick, end or error)');
    listeners[kind].push(fn);
    return () => off(kind, fn);
  }

  function off(kind, fn) {
    if (!listeners[kind]) return;
    listeners[kind] = listeners[kind].filter((f) => f !== fn);
  }

  return {
    state,
    log,
    seed,
    human,
    ai: aiSide,
    difficulty,
    aiEvery,
    aiStartTick,
    tps,
    interval,
    clock,
    ready,
    queue,
    pending: () => pending.slice(),
    tick,
    start,
    pause,
    resume,
    stop,
    resign,
    on,
    off,
    observe: (side = human) => observe(state, side),
    time,
    now: time, // the name viewer3d/engine.mjs looks for on a live world
    get result() {
      return result;
    },
    get running() {
      return running;
    },
    get aiName() {
      return names[aiSide];
    },
  };
}
