// Referee: runs one match between two player modules (spec section 11).
//
// This is the only env module allowed to use the clock, timers and async. It never changes the rules: it feeds
// commands into `step`, records what the simulation reports, and adds only the four things the spec gives it:
// `late`, `error` and `forfeit` events plus the per-tick `timing` list kept apart from the deterministic log.
//
// A reply is accepted only when its commands are an array in which every command, written as JSON, is at most
// `maxCommandChars` characters long (STATS.referee.commandChars). A reply with a bigger command, or one that is not
// plain JSON at all (BigInt, cycles), counts as an `error` like a throw or a non-array: empty commands for that tick.
// So no oversized command field reaches `step` or the log. The count of commands is not limited here: spec section
// 10 has the simulation reject every command past the 100th as `too-many`.
//
//   runMatch({ seed, players: [path0, path1], thinkMs, hardMs, maxTicks, maxErrors, maxCommandChars })
//     -> Promise<{ log, result }>
//
// Each player lives in its own child process (env/player-worker.mjs) so a player that never answers can be killed.
// The child runs under Node's permission model with an empty environment: it can read only its own player file
// (and the wrapper), and cannot write files, spawn processes, start workers or load native addons.

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';

import { createMatch, step, checkEnd } from './sim.mjs';
import { createTerritoryMatch } from './sim-territory.mjs';
import { observe } from './state.mjs';
import { STATS, sideValue } from './stats.mjs';
import { createLog, appendTick, finishLog } from './log.mjs';

const WORKER_FILE = fileURLToPath(new URL('./player-worker.mjs', import.meta.url));

// The section 11 numbers live in env/stats.mjs (STATS.referee and STATS.match).
export const DEFAULTS = Object.freeze({
  thinkMs: STATS.referee.thinkMs,
  hardMs: STATS.referee.hardMs,
  maxErrors: STATS.referee.throwLimit,
  maxTicks: STATS.match.maxTicks,
  maxCommandChars: STATS.referee.commandChars,
});

// Length of `value` as JSON, or null when it cannot be turned into JSON (BigInt, cycles, hostile getters).
// The log is JSON, so a reply that cannot be written there is refused before it reaches the simulation.
function jsonLength(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text.length : null;
  } catch {
    return null;
  }
}

// Null when every command in `list` fits in `limit` characters of JSON, otherwise a plain-English reason.
// The whole list is measured first, so the usual small reply costs one JSON.stringify; only a big list is walked.
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

// The permission model matches real paths (macOS /tmp is a symlink), so grant access to the resolved file.
const realPath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p; // missing file: the player then fails to load, as before
  }
};

const describe = (err) => (err instanceof Error ? err.message || err.name : String(err));

// One player's thread plus the bookkeeping the referee needs about it.
class PlayerHandle {
  constructor(side, modulePath, seed) {
    this.side = side;
    this.path = realPath(path.resolve(String(modulePath)));
    this.name = path.basename(this.path);
    this.errors = 0; // ticks on which act threw or returned a non-array
    this.alive = true;
    this.exitInfo = null;
    this.pending = null; // { tick, resolve } for the reply we are waiting on
    this.worker = fork(WORKER_FILE, [], {
      env: {},
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: ['--permission', '--allow-fs-read=' + WORKER_FILE, '--allow-fs-read=' + this.path],
    });
    this.worker.on('message', (msg) => this.onMessage(msg));
    this.worker.on('error', (err) => this.onExit('crashed: ' + describe(err)));
    this.worker.on('exit', (code, signal) => this.onExit('exited with ' + (signal ?? 'code ' + code)));
    this.worker.send({ type: 'init', path: this.path, side, seed, stats: STATS });
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
        this.worker.send({ type: 'observe', tick, observation });
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
      this.worker.kill('SIGKILL');
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

const TERRITORY_MATCH_TICKS = 24 * 60 * 15; // env/live.mjs DEFAULTS.maxTicks

export async function runMatch(options = {}) {
  const { seed = 1, players } = options;
  if (!Array.isArray(players) || players.length !== 2) throw new Error('runMatch needs players: [path0, path1]');
  const thinkMs = options.thinkMs ?? DEFAULTS.thinkMs;
  const hardMs = options.hardMs ?? DEFAULTS.hardMs;
  const maxErrors = options.maxErrors ?? DEFAULTS.maxErrors;
  const maxTicks = options.maxTicks ?? DEFAULTS.maxTicks;
  const maxCommandChars = options.maxCommandChars ?? DEFAULTS.maxCommandChars;

  // Toaster Wars: options.territory plays the territory match (hunger, cords, kitchen, Wheatfield). options.createState
  // lets a caller bring its own state; the default stays the classic match so the referee's own tests keep their numbers.
  const state = typeof options.createState === 'function' ? options.createState(seed)
    : options.territory ? createTerritoryMatch(seed, options.territoryOpts || {}) : createMatch(seed);
  // A shorter match than the stats table (tests use this): sim.mjs reads state.maxTicks in its own end check,
  // so the timeout rule stays in one place.
  if (options.maxTicks !== undefined) state.maxTicks = maxTicks;
  else if (state.territory) state.maxTicks = TERRITORY_MATCH_TICKS; // a Toaster Wars match runs the live 15 minutes
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
          const problem = oversizedCommand(reply.commands, maxCommandChars);
          if (problem) {
            handle.errors += 1;
            events.push({ e: 'error', player: side, message: problem });
          } else {
            commands[side] = reply.commands;
          }
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
