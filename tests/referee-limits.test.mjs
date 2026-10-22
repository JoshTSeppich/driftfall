// Referee limits (ENV-SPEC.md §11): late replies, throws, hangs, load failures, garbage replies and
// observation isolation. Every test runs the real env/referee.mjs against tiny player modules that this
// file writes into a temp folder. Nothing under test is stubbed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SEED = 7;
const THINK_MS = 200; // generous so a busy machine doesn't make the idle side late
const HARD_MS = 1000; // the spec default

let runMatch;
let comparable;
let dir;

before(async () => {
  ({ runMatch } = await import('../env/referee.mjs'));
  ({ comparable } = await import('../env/log.mjs'));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftfall-referee-'));
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- tiny player modules ----------

function writePlayer(name, source) {
  const file = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(file, source);
  return file;
}

const IDLE = `
export function createPlayer({ side }) {
  return { name: 'idle-' + side, act() { return []; } };
}
`;

// Answers with one harmless legal command every tick, but sleeps past the think limit on tick 2.
const LATE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function createPlayer({ side }) {
  return {
    name: 'late-' + side,
    async act(obs) {
      const mine = obs.units.filter((u) => u.owner === obs.you);
      const cmd = { type: 'stop', unit: mine[0].id };
      if (obs.tick === 2) await sleep(${THINK_MS + 250});
      return [cmd];
    },
  };
}
`;

const THROWS_SOMETIMES = `
export function createPlayer({ side }) {
  return {
    name: 'thrower-' + side,
    act(obs) {
      if (obs.tick === 1 || obs.tick === 3) throw new Error('boom at tick ' + obs.tick);
      return [];
    },
  };
}
`;

const THROWS_ALWAYS = `
export function createPlayer({ side }) {
  return { name: 'always-throws-' + side, act() { throw new Error('boom'); } };
}
`;

const HANGS_SYNC = `
export function createPlayer({ side }) {
  return {
    name: 'hang-sync-' + side,
    act(obs) {
      if (obs.tick === 1) { for (;;) { /* never returns */ } }
      return [];
    },
  };
}
`;

const HANGS_ASYNC = `
export function createPlayer({ side }) {
  return {
    name: 'hang-async-' + side,
    act(obs) {
      if (obs.tick === 1) return new Promise(() => {});
      return [];
    },
  };
}
`;

const SYNTAX_ERROR = `
export function createPlayer({ side } {
  return { name: 'broken', act() { return []; } };
}
`;

const NO_FACTORY = `
export const notAPlayer = true;
`;

const FACTORY_THROWS = `
export function createPlayer() { throw new Error('cannot be born'); }
`;

// Returns something that is not an array on every tick.
const GARBAGE = `
export function createPlayer({ side }) {
  const junk = ['nope', 42, null, undefined, { type: 'stop' }, true];
  return { name: 'garbage-' + side, act(obs) { return junk[obs.tick % junk.length]; } };
}
`;

// Returns a real array whose entries are junk.
const GARBAGE_INSIDE_ARRAY = `
export function createPlayer({ side }) {
  return {
    name: 'junk-array-' + side,
    act() { return [null, 'x', 7, { type: 'fly' }, { type: 'move' }, { type: 'train', building: 'core' }]; },
  };
}
`;

// Wrecks every observation it gets, and throws if any wreckage shows up on the next tick.
const MUTATOR = `
export function createPlayer({ side }) {
  let expectTick = 0;
  return {
    name: 'mutator-' + side,
    act(obs) {
      if (obs.marker !== undefined) throw new Error('observation carried a mutation from an earlier tick');
      if (obs.tick !== expectTick) throw new Error('expected tick ' + expectTick + ' but got ' + obs.tick);
      if (obs.shards[0] !== obs.shards[1]) throw new Error('shards were changed by a mutation');
      if (obs.units.length === 0) throw new Error('units vanished after a mutation');
      expectTick = obs.tick + 1;
      obs.marker = 'mutated';
      obs.tick = 999;
      obs.you = 1 - obs.you;
      obs.shards[0] = 999999;
      obs.shards[1] = 0;
      obs.units.length = 0;
      for (const s of obs.structures) { s.hp = 0; s.owner = 1 - s.owner; s.queue.push('brute'); }
      obs.structures.length = 0;
      obs.crystals.length = 0;
      obs.rocks.length = 0;
      obs.width = 1; obs.height = 1;
      return [];
    },
  };
}
`;

// ---------- helpers ----------

function allEvents(log) {
  return log.ticks.flatMap((t) => t.events ?? []);
}

function eventsOf(log, kind, player) {
  return allEvents(log).filter((e) => e.e === kind && (player === undefined || e.player === player));
}

async function play(p0, p1, opts = {}) {
  return runMatch({ seed: SEED, players: [p0, p1], thinkMs: THINK_MS, hardMs: HARD_MS, maxTicks: 6, ...opts });
}

// ---------- tests ----------

test('baseline: two idle players finish a short match with one timing pair per tick', { timeout: 20000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const { log, result } = await play(idle, idle);
  assert.equal(result.reason, 'timeout');
  assert.equal(result.tick, 6);
  assert.equal(result.winner, null, 'two idle sides have equal value, so a draw');
  assert.equal(log.ticks.length, 6);
  assert.equal(log.timing.length, log.ticks.length);
  for (const pair of log.timing) {
    assert.equal(pair.length, 2);
    assert.ok(pair.every((ms) => typeof ms === 'number' && ms >= 0));
  }
  assert.equal(eventsOf(log, 'late').length, 0);
  assert.equal(eventsOf(log, 'error').length, 0);
  assert.equal(eventsOf(log, 'forfeit').length, 0);
});

test('a late reply loses that tick\'s commands, logs a late event, and the match continues', { timeout: 20000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const late = writePlayer('late', LATE);
  const { log, result } = await play(idle, late);

  assert.equal(result.reason, 'timeout', 'being late once is not a forfeit');
  assert.equal(log.ticks.length, 6, 'the match ran to the end');

  const lateEvents = eventsOf(log, 'late', 1);
  assert.equal(lateEvents.length, 1, 'exactly one late event for side 1');
  assert.equal(eventsOf(log, 'late', 0).length, 0, 'the idle side was never late');
  assert.ok(!('ms' in lateEvents[0]), 'late events carry no millisecond numbers (they live in timing)');

  const idx = log.ticks.findIndex((t) => t.events.some((e) => e.e === 'late' && e.player === 1));
  assert.deepEqual(log.ticks[idx].commands[1], [], 'the late side\'s commands for that tick were discarded');
  assert.ok(log.timing[idx][1] >= THINK_MS, `timing shows the slow reply (${log.timing[idx][1]} ms)`);

  const otherTicks = log.ticks.filter((_, i) => i !== idx);
  assert.ok(otherTicks.length > 0);
  for (const t of otherTicks) {
    assert.equal(t.commands[1].length, 1, `tick entry ${t.tick}: the on-time command was kept`);
    assert.equal(t.commands[1][0].type, 'stop');
  }
});

test('a player that throws gets an empty tick with an error event, and the match continues', { timeout: 20000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const thrower = writePlayer('thrower', THROWS_SOMETIMES);
  const { log, result } = await play(thrower, idle);

  assert.equal(result.reason, 'timeout', 'two throws are far below the forfeit limit');
  assert.equal(log.ticks.length, 6);

  const errors = eventsOf(log, 'error', 0);
  assert.equal(errors.length, 2, 'one error event per throwing tick');
  for (const e of errors) {
    assert.equal(typeof e.message, 'string');
    assert.match(e.message, /boom/);
  }
  assert.equal(eventsOf(log, 'error', 1).length, 0);

  const errorTicks = log.ticks.filter((t) => t.events.some((e) => e.e === 'error' && e.player === 0));
  assert.equal(errorTicks.length, 2, 'the two throws happened on two different ticks');
  for (const t of errorTicks) assert.deepEqual(t.commands[0], [], 'the throwing side\'s commands are empty');
  assert.equal(eventsOf(log, 'forfeit').length, 0);
});

test('a player that throws on 50 ticks forfeits with reason errors', { timeout: 30000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const always = writePlayer('always-throws', THROWS_ALWAYS);
  const { log, result } = await play(idle, always, { maxTicks: 120 });

  assert.equal(result.reason, 'forfeit');
  assert.equal(result.winner, 0);
  assert.ok(result.tick < 120, 'the forfeit happened before the match would have timed out');
  const forfeits = eventsOf(log, 'forfeit');
  assert.equal(forfeits.length, 1);
  assert.equal(forfeits[0].player, 1);
  assert.equal(forfeits[0].reason, 'errors');
  assert.equal(eventsOf(log, 'error', 1).length, 50, 'exactly 50 error events before the forfeit');
});

test('a player stuck in a busy loop is terminated and forfeits within about a second', { timeout: 20000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const hang = writePlayer('hang-sync', HANGS_SYNC);
  const t0 = Date.now();
  const { log, result } = await play(idle, hang, { maxTicks: 50 });
  const elapsed = Date.now() - t0;

  assert.equal(result.reason, 'forfeit');
  assert.equal(result.winner, 0);
  const forfeits = eventsOf(log, 'forfeit');
  assert.equal(forfeits.length, 1);
  assert.equal(forfeits[0].player, 1);
  assert.equal(forfeits[0].reason, 'timeout');
  assert.ok(elapsed >= HARD_MS - 50, `the referee waited for the hard limit (${elapsed} ms)`);
  assert.ok(elapsed < HARD_MS + 2500, `the referee gave up soon after the hard limit (${elapsed} ms)`);
  assert.ok(log.ticks.length < 50, 'the match stopped at the forfeit');
});

test('a player whose promise never settles is also terminated and forfeits', { timeout: 20000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const hang = writePlayer('hang-async', HANGS_ASYNC);
  const t0 = Date.now();
  const { log, result } = await play(hang, idle, { hardMs: 300, maxTicks: 50 });
  const elapsed = Date.now() - t0;

  assert.equal(result.reason, 'forfeit');
  assert.equal(result.winner, 1);
  const forfeits = eventsOf(log, 'forfeit');
  assert.equal(forfeits.length, 1);
  assert.equal(forfeits[0].player, 0);
  assert.equal(forfeits[0].reason, 'timeout');
  assert.ok(elapsed < 3000, `gave up well within the test budget (${elapsed} ms)`);
});

for (const [label, side, make] of [
  ['a path that does not exist', 1, () => path.join(dir, 'does-not-exist.mjs')],
  ['a module with a syntax error', 0, () => writePlayer('syntax-error', SYNTAX_ERROR)],
  ['a module without createPlayer', 1, () => writePlayer('no-factory', NO_FACTORY)],
  ['a createPlayer that throws', 0, () => writePlayer('factory-throws', FACTORY_THROWS)],
]) {
  test(`${label} forfeits at tick 0 with reason load`, { timeout: 20000 }, async () => {
    const idle = writePlayer('idle', IDLE);
    const bad = make();
    const players = side === 0 ? [bad, idle] : [idle, bad];
    const { log, result } = await runMatch({ seed: SEED, players, thinkMs: THINK_MS, hardMs: HARD_MS, maxTicks: 6 });

    assert.equal(result.reason, 'forfeit');
    assert.equal(result.tick, 0);
    assert.equal(result.winner, 1 - side);
    const forfeits = eventsOf(log, 'forfeit');
    assert.equal(forfeits.length, 1, 'one forfeit event somewhere in the log');
    assert.equal(forfeits[0].player, side);
    assert.equal(forfeits[0].reason, 'load');
    assert.equal(eventsOf(log, 'spawn').length, 0, 'no simulation tick ran');
  });
}

test('a reply that is not an array is treated as an empty tick with an error event', { timeout: 20000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const garbage = writePlayer('garbage', GARBAGE);
  const { log, result } = await play(idle, garbage);

  assert.equal(result.reason, 'timeout', 'garbage replies are not a forfeit');
  assert.equal(log.ticks.length, 6);
  for (const t of log.ticks) {
    assert.deepEqual(t.commands[1], [], `tick entry ${t.tick}: garbage became an empty command list`);
    assert.ok(t.events.some((e) => e.e === 'error' && e.player === 1), `tick entry ${t.tick}: an error event was logged`);
  }
  assert.equal(eventsOf(log, 'error', 0).length, 0);
});

test('junk inside a real command array never crashes the match', { timeout: 20000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const junk = writePlayer('junk-array', GARBAGE_INSIDE_ARRAY);
  const { log, result } = await play(junk, idle);

  assert.equal(result.reason, 'timeout');
  assert.equal(log.ticks.length, 6);
  assert.equal(eventsOf(log, 'error').length, 0, 'an array is a valid reply, even if its entries are junk');
  assert.ok(eventsOf(log, 'reject', 0).length > 0, 'the simulation rejected the junk commands');
  assert.equal(eventsOf(log, 'reject', 1).length, 0);
});

test('observations are copies: a player that wrecks its observation changes nothing', { timeout: 20000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const mutator = writePlayer('mutator', MUTATOR);
  const clean = await play(idle, idle);
  const dirty = await play(mutator, idle);

  assert.equal(eventsOf(dirty.log, 'error').length, 0, 'the mutator never saw its own wreckage on a later tick');
  assert.deepEqual(dirty.result, clean.result, 'the result matches an idle-versus-idle match');
  assert.equal(dirty.result.winner, null, 'the mutated hp and ownership never reached the simulation');

  const strip = (log) => {
    const c = comparable(log);
    const { players, ...rest } = c;
    return JSON.stringify(rest);
  };
  assert.equal(strip(dirty.log), strip(clean.log), 'the logs are identical apart from timing and player names');
  assert.deepEqual(dirty.log.initial.shards, clean.log.initial.shards);
  assert.ok(dirty.log.initial.units.length > 0, 'the initial state still has its units');
});
