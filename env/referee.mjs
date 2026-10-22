// Referee: runs one match between two player modules (spec section 11).
//
// This is the only env module allowed to use the clock, timers and async. It never changes the rules: it feeds
// commands into `step`, records what the simulation reports, and adds only the four things the spec gives it:
// `late`, `error` and `forfeit` events plus the per-tick `timing` list kept apart from the deterministic log.
//
//   runMatch({ seed, players: [path0, path1], thinkMs, hardMs, maxTicks, maxErrors }) -> Promise<{ log, result }>
//
// Each player lives in its own worker thread (env/player-worker.mjs) so a player that never answers can be cut off.

import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { createMatch, step, checkEnd } from './sim.mjs';
import { observe } from './state.mjs';
import { STATS, sideValue } from './stats.mjs';
import { createLog, appendTick, finishLog } from './log.mjs';

const WORKER_FILE = new URL('./player-worker.mjs', import.meta.url);

// The section 11 numbers live in env/stats.mjs; these lookups accept the obvious spellings and fall back to the
// spec values so the referee keeps working while the table settles.
const pick = (...candidates) => candidates.find((v) => typeof v === 'number' && Number.isFinite(v));
const limits = STATS?.referee ?? STATS?.limits ?? {};
export const DEFAULTS = Object.freeze({
  thinkMs: pick(limits.thinkMs, STATS?.thinkMs, STATS?.thinkLimitMs, 50),
  hardMs: pick(limits.hardMs, STATS?.hardMs, STATS?.hardLimitMs, 1000),
  maxErrors: pick(limits.maxErrors, STATS?.maxErrors, STATS?.errorLimit, 50),
  maxTicks: pick(limits.maxTicks, STATS?.maxTicks, 2000),
});

const describe = (err) => (err instanceof Error ? err.message || err.name : String(err));

// One player's thread plus the bookkeeping the referee needs about it.
class PlayerHandle {
  constructor(side, modulePath, seed) {
    this.side = side;
    this.path = path.resolve(String(modulePath));
    this.name = path.basename(this.path);
    this.errors = 0; // ticks on which act threw or returned a non-array
    this.alive = true;
    this.exitInfo = null;
    this.pending = null; // { tick, resolve } for the reply we are waiting on
    this.worker = new Worker(WORKER_FILE, { workerData: { path: this.path, side, seed, stats: STATS } });
    this.worker.on('message', (msg) => this.onMessage(msg));
    this.worker.on('error', (err) => this.onExit('crashed: ' + describe(err)));
    this.worker.on('exit', (code) => this.onExit('exited with code ' + code));
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      if (typeof msg.name === 'string' && msg.name.length) this.name = msg.name;
      this.readyResolve({ ok: true });
    } else if (msg.type === 'load-error') {
      this.readyResolve({ ok: false, message: msg.message });
    } else if (msg.type === 'commands') {
      if (this.pending && this.pending.tick === msg.tick) {
        const { resolve } = this.pending;
        this.pending = null;
        resolve(msg);
      }
      // replies for other ticks are stale (should not happen) and are ignored
    }
  }

  onExit(info) {
    if (!this.alive) return;
    this.alive = false;
    this.exitInfo = info;
    this.readyResolve({ ok: false, message: 'worker ' + info });
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = null;
      resolve({ type: 'gone' });
    }
  }

  // Wait for the module to load; a module that takes longer than hardMs counts as failing to load.
  async ready(hardMs) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, message: 'did not finish loading within ' + hardMs + ' ms' }), hardMs);
    });
    const outcome = await Promise.race([this.readyPromise, timeout]);
    clearTimeout(timer);
    if (!outcome.ok) await this.terminate();
    return outcome;
  }

  // Send one observation and wait for the commands. Resolves with
  //   { status: 'ok', commands, ms } | { status: 'error', message, ms } | { status: 'timeout', ms }
  // `late` is decided by the caller from `ms` so the hard cut-off and the think limit stay independent.
  ask(tick, observation, hardMs) {
    if (!this.alive) return Promise.resolve({ status: 'timeout', ms: 0, message: this.exitInfo });
    return new Promise((resolve) => {
      const t0 = performance.now();
      let timer;
      const finish = (reply) => {
        clearTimeout(timer);
        const ms = performance.now() - t0;
        if (reply.type === 'commands' && !('error' in reply)) resolve({ status: 'ok', commands: reply.commands, ms });
        else if (reply.type === 'commands') resolve({ status: 'error', message: String(reply.error), ms });
        else resolve({ status: 'timeout', ms });
      };
      this.pending = { tick, resolve: finish };
      timer = setTimeout(() => {
        if (this.pending && this.pending.tick === tick) {
          this.pending = null;
          this.terminate().finally(() => finish({ type: 'timeout' }));
        }
      }, hardMs);
      try {
        this.worker.postMessage({ type: 'observe', tick, observation });
      } catch (err) {
        this.pending = null;
        clearTimeout(timer);
        resolve({ status: 'error', message: 'observation could not be sent: ' + describe(err), ms: performance.now() - t0 });
      }
    });
  }

  async terminate() {
    if (!this.alive) return;
    this.alive = false;
    try {
      await this.worker.terminate();
    } catch {
      /* already gone */
    }
  }
}

const valuesOf = (state) => [sideValue(state, 0), sideValue(state, 1)];

function resultFromForfeits(state, forfeited) {
  const winner = forfeited[0] && forfeited[1] ? null : forfeited[0] ? 1 : 0;
  return { winner, reason: 'forfeit', tick: state.tick, value: valuesOf(state) };
}

function stripYou(observation) {
  const copy = { ...observation };
  delete copy.you;
  return copy;
}

export async function runMatch(options = {}) {
  const { seed = 1, players } = options;
  if (!Array.isArray(players) || players.length !== 2) throw new Error('runMatch needs players: [path0, path1]');
  const thinkMs = options.thinkMs ?? DEFAULTS.thinkMs;
  const hardMs = options.hardMs ?? DEFAULTS.hardMs;
  const maxErrors = options.maxErrors ?? DEFAULTS.maxErrors;
  const maxTicks = options.maxTicks ?? DEFAULTS.maxTicks;

  const state = createMatch(seed);
  const handles = [new PlayerHandle(0, players[0], seed), new PlayerHandle(1, players[1], seed)];

  try {
    const loaded = await Promise.all(handles.map((h) => h.ready(hardMs)));
    const log = createLog({
      seed,
      players: [handles[0].name, handles[1].name],
      stats: STATS,
      initial: stripYou(observe(state, 0)),
    });

    // A module that failed to load forfeits at tick 0, before any step.
    const loadForfeit = loaded.map((l) => !l.ok);
    if (loadForfeit[0] || loadForfeit[1]) {
      const events = [];
      for (const side of [0, 1]) if (loadForfeit[side]) events.push({ e: 'forfeit', player: side, reason: 'load' });
      appendTick(log, { tick: state.tick, commands: [[], []], events }, [0, 0]);
      const result = resultFromForfeits(state, loadForfeit);
      finishLog(log, result);
      return { log, result };
    }

    let result = null;
    while (!result) {
      const tick = state.tick;
      const observations = [observe(state, 0), observe(state, 1)];
      const replies = await Promise.all([
        handles[0].ask(tick, observations[0], hardMs),
        handles[1].ask(tick, observations[1], hardMs),
      ]);

      const events = [];
      const commands = [[], []];
      const timing = [0, 0];
      const forfeited = [false, false];
      for (const side of [0, 1]) {
        const reply = replies[side];
        const handle = handles[side];
        timing[side] = Math.round(reply.ms * 1000) / 1000;
        if (reply.status === 'timeout') {
          forfeited[side] = true;
          events.push({ e: 'forfeit', player: side, reason: 'timeout' });
          continue;
        }
        const late = reply.ms > thinkMs;
        if (late) events.push({ e: 'late', player: side });
        if (reply.status === 'error') {
          handle.errors += 1;
          events.push({ e: 'error', player: side, message: reply.message });
        } else if (!Array.isArray(reply.commands)) {
          handle.errors += 1;
          events.push({ e: 'error', player: side, message: 'act returned ' + describeValue(reply.commands) + ', not an array' });
        } else if (!late) {
          commands[side] = reply.commands;
        }
        if (handle.errors >= maxErrors) {
          forfeited[side] = true;
          events.push({ e: 'forfeit', player: side, reason: 'errors' });
        }
      }

      if (forfeited[0] || forfeited[1]) {
        appendTick(log, { tick, commands: [[], []], events }, timing);
        result = resultFromForfeits(state, forfeited);
        break;
      }

      const stepEvents = step(state, commands);
      appendTick(log, { tick, commands, events: events.concat(stepEvents) }, timing);

      result = state.result ?? checkEnd(state);
      if (!result && state.tick >= maxTicks) {
        // Only reachable when the caller asks for a shorter match than the stats table; same rule as spec section 9.
        const value = valuesOf(state);
        const winner = value[0] === value[1] ? null : value[0] > value[1] ? 0 : 1;
        result = { winner, reason: 'timeout', tick: state.tick, value };
      }
    }

    finishLog(log, result);
    return { log, result };
  } finally {
    await Promise.all(handles.map((h) => h.terminate()));
  }
}

function describeValue(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'object') return 'an object';
  return 'a ' + typeof v;
}
