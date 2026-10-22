// Log format tests (ENV-SPEC.md §12, PLAN.json test area "log-format").
//
// What is checked, all against the real modules (nothing is stubbed):
//   1. A log from a real match passes validateLog, both one driven straight through env/sim.mjs with two small
//      in-test players and one run by env/referee.mjs with players/sample-player.mjs in worker threads.
//   2. Breaking any required field makes validateLog name the problem in plain English.
//   3. Every tick entry has the tick number, both command lists and an events array; entries count up by one.
//   4. timing is a top-level list with one pair of non-negative numbers per tick, and comparable() drops it.
//   5. Replaying every event with viewer/replay.mjs ends with the same ids, owners, kinds, tiles, hp, carrying,
//      structure progress/complete/queue, Shards and crystal amounts as the simulation's final state.
//      Orders are not compared.
//
// Modules are loaded lazily so a missing module fails only the tests that need it, with a clear message.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------------------------
// Lazy module loading

const here = (rel) => new URL(rel, import.meta.url);
const loads = new Map();
function load(rel) {
  if (!loads.has(rel)) {
    loads.set(
      rel,
      import(here(rel)).catch((err) => {
        throw new Error(`cannot load ${rel} (module missing or broken): ${err.message}`);
      }),
    );
  }
  return loads.get(rel);
}
async function fn(rel, name) {
  const mod = await load(rel);
  if (typeof mod[name] !== 'function') throw new Error(`${rel} does not export a function named ${name}`);
  return mod[name];
}
async function value(rel, name) {
  const mod = await load(rel);
  if (!(name in mod)) throw new Error(`${rel} does not export ${name}`);
  return mod[name];
}

const EVENT_KINDS = new Set([
  'spawn', 'move', 'hit', 'die', 'mine', 'deliver', 'spend', 'progress', 'done', 'queue', 'order',
  'blocked', 'reject', 'late', 'error', 'forfeit',
]);
const RESULT_REASONS = new Set(['core', 'both-cores', 'timeout', 'forfeit']);

// ---------------------------------------------------------------------------------------------------------------
// Two small deterministic in-test players. They exist only to make a match that touches most event kinds
// (spawn, move, mine, deliver, spend, queue, order, progress, done, hit, die, reject, blocked). Not competitors.

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function nearestCrystal(obs, unit) {
  const live = obs.crystals.filter((c) => c.amount > 0);
  live.sort((a, b) => chebyshev(a, unit) - chebyshev(b, unit) || a.y - b.y || a.x - b.x);
  return live[0] ?? null;
}

// First open, empty tile at distance 2..4 of the core, lower y then lower x within a distance ring.
function buildTileNear(obs, core) {
  const taken = new Set();
  for (const [x, y] of obs.rocks) taken.add(`${x},${y}`);
  for (const c of obs.crystals) taken.add(`${c.x},${c.y}`);
  for (const u of obs.units) taken.add(`${u.x},${u.y}`);
  for (const s of obs.structures) taken.add(`${s.x},${s.y}`);
  for (let d = 2; d <= 4; d++) {
    for (let y = core.y - d; y <= core.y + d; y++) {
      for (let x = core.x - d; x <= core.x + d; x++) {
        if (Math.max(Math.abs(x - core.x), Math.abs(y - core.y)) !== d) continue;
        if (x < 0 || y < 0 || x >= obs.width || y >= obs.height) continue;
        if (!taken.has(`${x},${y}`)) return { x, y };
      }
    }
  }
  return null;
}

function makeTestPlayer(side, role, STATS) {
  const forgeCost = STATS.structures.forge.cost;
  const turretCost = STATS.structures.turret.cost;
  const workerCost = STATS.units.worker.cost;
  const gruntCost = STATS.units.grunt.cost;
  return {
    name: `${role}-${side}`,
    act(obs) {
      const cmds = [];
      let shards = obs.shards[side];
      const mine = obs.units.filter((u) => u.owner === side);
      const myStructures = obs.structures.filter((s) => s.owner === side);
      const core = myStructures.find((s) => s.kind === 'core');
      const forge = myStructures.find((s) => s.kind === 'forge');
      const turret = myStructures.find((s) => s.kind === 'turret');
      const workers = mine.filter((u) => u.kind === 'worker');
      const idleWorkers = workers.filter((u) => u.order === null);
      const enemyCore = obs.structures.find((s) => s.owner !== side && s.kind === 'core');

      // One deliberate move + stop early on, so the log holds move and stop commands and an order event or two.
      // The move target is picked blind, so it may also produce a blocked event.
      // The last Worker is used so a builder (always the first Worker) is never pulled off its site.
      const roamer = workers[workers.length - 1];
      if (obs.tick === 3 && roamer && core) {
        cmds.push({ type: 'move', unit: roamer.id, x: core.x + 3, y: core.y });
      }
      if (obs.tick === 5 && roamer) cmds.push({ type: 'stop', unit: roamer.id });
      // One command that is certainly illegal, so the log also holds a reject event.
      if (obs.tick === 7) cmds.push({ type: 'train', building: -1, kind: 'worker' });

      // Build one structure when affordable: the attacker builds a Forge, the defender a Turret.
      const wantKind = role === 'attacker' ? 'forge' : 'turret';
      const have = role === 'attacker' ? forge : turret;
      const wantCost = role === 'attacker' ? forgeCost : turretCost;
      // Gathering Workers are never idle, so when nobody is idle the first Worker is pulled off its field.
      if (!have && core && shards >= wantCost && workers.length > 0) {
        const tile = buildTileNear(obs, core);
        if (tile) {
          const builder = idleWorkers.length > 0 ? idleWorkers.shift() : workers[0];
          cmds.push({ type: 'build', unit: builder.id, kind: wantKind, x: tile.x, y: tile.y });
          shards -= wantCost;
        }
      }

      // Every other idle Worker gathers from the nearest crystal tile with Shards left.
      for (const w of idleWorkers) {
        const c = nearestCrystal(obs, w);
        if (c) cmds.push({ type: 'gather', unit: w.id, x: c.x, y: c.y });
      }

      // The Core trains Workers up to a small number.
      const wantWorkers = role === 'attacker' ? 6 : 8;
      if (core && core.complete && core.queue.length === 0 && workers.length < wantWorkers && shards >= workerCost) {
        cmds.push({ type: 'train', building: core.id, kind: 'worker' });
        shards -= workerCost;
      }

      // The attacker trains Grunts from a complete Forge and sends every idle Grunt at the enemy Core.
      if (role === 'attacker') {
        if (forge && forge.complete && forge.queue.length === 0 && shards >= gruntCost) {
          cmds.push({ type: 'train', building: forge.id, kind: 'grunt' });
          shards -= gruntCost;
        }
        if (enemyCore) {
          for (const g of mine) {
            if (g.kind === 'grunt' && g.order === null) cmds.push({ type: 'attack', unit: g.id, target: enemyCore.id });
          }
        }
      }
      return cmds;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Match builders (memoised: each match runs once per test file)

const SIM_SEED = 11;
const REFEREE_SEED = 7;

let simMatchPromise = null;
function simMatch() {
  simMatchPromise ??= (async () => {
    const [createMatch, step, checkEnd] = await Promise.all([
      fn('../env/sim.mjs', 'createMatch'), fn('../env/sim.mjs', 'step'), fn('../env/sim.mjs', 'checkEnd'),
    ]);
    const observe = await fn('../env/state.mjs', 'observe');
    const STATS = await value('../env/stats.mjs', 'STATS');
    const [createLog, appendTick, finishLog] = await Promise.all([
      fn('../env/log.mjs', 'createLog'), fn('../env/log.mjs', 'appendTick'), fn('../env/log.mjs', 'finishLog'),
    ]);

    const players = [makeTestPlayer(0, 'attacker', STATS), makeTestPlayer(1, 'defender', STATS)];
    const state = createMatch(SIM_SEED);
    const initial = observe(state, 0);
    delete initial.you;
    const log = createLog({ seed: SIM_SEED, players: players.map((p) => p.name), stats: STATS, initial });
    const givenCommands = []; // what the players returned, tick by tick, kept apart from the log
    let result = null;
    let guard = 0;
    while (!result) {
      const tick = state.tick;
      const cmds = [players[0].act(observe(state, 0)), players[1].act(observe(state, 1))];
      givenCommands.push(structuredClone(cmds));
      const events = step(state, structuredClone(cmds));
      appendTick(log, { tick, commands: cmds, events }, [0, 0]);
      result = state.result ?? checkEnd(state);
      if (++guard > 5000) throw new Error('the simulated match never ended (guard tripped after 5000 steps)');
    }
    finishLog(log, result);
    return { log, state, result, givenCommands };
  })();
  return simMatchPromise;
}

let refereeMatchPromise = null;
function refereeMatch() {
  refereeMatchPromise ??= (async () => {
    const runMatch = await fn('../env/referee.mjs', 'runMatch');
    const samplePath = fileURLToPath(here('../players/sample-player.mjs'));
    await load('../players/sample-player.mjs'); // clear message if the sample player is missing
    return runMatch({ seed: REFEREE_SEED, players: [samplePath, samplePath] });
  })();
  return refereeMatchPromise;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

const byId = (a, b) => a.id - b.id;
const byYX = (a, b) => a.y - b.y || a.x - b.x;

// The part of a state that replay promises to reproduce (orders left out on purpose).
function snapshot(state) {
  return {
    units: [...state.units].sort(byId).map((u) => ({
      id: u.id, owner: u.owner, kind: u.kind, x: u.x, y: u.y, hp: u.hp, carrying: u.carrying,
    })),
    structures: [...state.structures].sort(byId).map((s) => ({
      id: s.id, owner: s.owner, kind: s.kind, x: s.x, y: s.y, hp: s.hp,
      progress: s.progress, complete: s.complete, queue: [...(s.queue ?? [])],
    })),
    shards: [state.shards[0], state.shards[1]],
    crystals: [...state.crystals].sort(byYX).map((c) => ({ x: c.x, y: c.y, amount: c.amount })),
  };
}

const pickFields = (list, fields) => list.map((e) => Object.fromEntries(fields.map((f) => [f, e[f]])));

function eventKinds(log) {
  const counts = {};
  for (const entry of log.ticks) for (const ev of entry.events) counts[ev.e] = (counts[ev.e] ?? 0) + 1;
  return counts;
}

function checkTickEntries(log) {
  assert.ok(Array.isArray(log.ticks), 'log.ticks must be an array');
  assert.ok(log.ticks.length > 0, 'a finished match must have at least one tick entry');
  log.ticks.forEach((entry, i) => {
    assert.ok(entry && typeof entry === 'object', `tick entry ${i} must be an object`);
    assert.ok(Number.isInteger(entry.tick), `tick entry ${i} must carry a whole-number tick (got ${entry.tick})`);
    if (i > 0) assert.equal(entry.tick, log.ticks[i - 1].tick + 1, `tick entry ${i} must count up by one`);
    assert.ok(Array.isArray(entry.commands), `tick entry ${i} must have a commands array`);
    assert.equal(entry.commands.length, 2, `tick entry ${i} must have exactly two command lists`);
    assert.ok(Array.isArray(entry.commands[0]), `tick entry ${i}: side 0's commands must be a list`);
    assert.ok(Array.isArray(entry.commands[1]), `tick entry ${i}: side 1's commands must be a list`);
    assert.ok(Array.isArray(entry.events), `tick entry ${i} must have an events array`);
    entry.events.forEach((ev, j) => {
      assert.ok(ev && typeof ev === 'object', `tick entry ${i} event ${j} must be an object`);
      assert.ok(EVENT_KINDS.has(ev.e), `tick entry ${i} event ${j} has unknown kind "${ev.e}"`);
    });
  });
  const first = log.ticks[0].tick;
  assert.ok(first === 0 || first === 1, `the first tick entry must be numbered 0 or 1 (got ${first})`);
  assert.equal(log.ticks.length, log.result.tick, 'there must be exactly result.tick tick entries');
}

function checkTiming(log) {
  assert.ok(Array.isArray(log.timing), 'timing must be a top-level list');
  assert.equal(log.timing.length, log.ticks.length, 'timing must have one entry per tick');
  log.timing.forEach((pair, i) => {
    assert.ok(Array.isArray(pair) && pair.length === 2, `timing[${i}] must be a pair`);
    for (const ms of pair) {
      assert.equal(typeof ms, 'number', `timing[${i}] must hold numbers`);
      assert.ok(Number.isFinite(ms) && ms >= 0, `timing[${i}] must hold non-negative finite numbers`);
    }
  });
  for (const entry of log.ticks) assert.equal('timing' in entry, false, 'tick entries must not carry timing');
}

function checkTopLevel(log, STATS) {
  assert.equal(log.format, 'driftfall-log');
  assert.equal(log.version, 1);
  assert.ok(Number.isFinite(log.seed), 'seed must be a number');
  assert.ok(Array.isArray(log.players) && log.players.length === 2, 'players must be two names');
  for (const p of log.players) assert.ok(typeof p === 'string' && p.length > 0, 'player names must be non-empty strings');
  assert.deepEqual(JSON.parse(JSON.stringify(log.stats)), JSON.parse(JSON.stringify(STATS)), 'log.stats must be the stats table');
  assert.ok(log.initial && typeof log.initial === 'object', 'initial must be an object');
  assert.equal('you' in log.initial, false, 'initial must not carry the per-player "you" field');
  assert.equal(log.initial.tick, 0, 'initial must be the state at tick 0');
  for (const k of ['width', 'height', 'rocks', 'crystals', 'shards', 'units', 'structures']) {
    assert.ok(k in log.initial, `initial must have "${k}"`);
  }
  assert.ok(log.result && typeof log.result === 'object', 'result must be an object');
  assert.ok([0, 1, null].includes(log.result.winner), 'result.winner must be 0, 1 or null');
  assert.ok(RESULT_REASONS.has(log.result.reason), `result.reason "${log.result.reason}" must be a known reason`);
  assert.ok(Number.isInteger(log.result.tick) && log.result.tick > 0, 'result.tick must be a positive whole number');
  assert.ok(Array.isArray(log.result.value) && log.result.value.length === 2, 'result.value must be a pair');
}

// ---------------------------------------------------------------------------------------------------------------
// 1. A real match, driven straight through the simulation and env/log.mjs

describe('log from a match driven through env/sim.mjs', () => {
  test('the match ran and touched the event kinds that gathering, building and fighting produce', async (t) => {
    const { log, result } = await simMatch();
    const kinds = eventKinds(log);
    t.diagnostic(`sim match: ${result.tick} ticks, winner ${result.winner}, reason ${result.reason}, events ${JSON.stringify(kinds)}`);
    for (const k of ['spawn', 'move', 'mine', 'deliver', 'spend', 'queue', 'order', 'reject', 'progress', 'done', 'hit', 'die']) {
      assert.ok(kinds[k] > 0, `expected at least one "${k}" event in the match log`);
    }
  });

  test('passes validateLog with no problems', async () => {
    const validateLog = await fn('../env/log.mjs', 'validateLog');
    const { log } = await simMatch();
    const problems = validateLog(log);
    assert.ok(Array.isArray(problems), 'validateLog must return a list');
    assert.deepEqual(problems, [], `validateLog reported: ${problems.join(' | ')}`);
  });

  test('has the top-level fields of spec section 12', async () => {
    const STATS = await value('../env/stats.mjs', 'STATS');
    const { log } = await simMatch();
    checkTopLevel(log, STATS);
    assert.equal(log.seed, SIM_SEED);
    assert.deepEqual(log.players, ['attacker-0', 'defender-1']);
    assert.deepEqual(log.result, (await simMatch()).result);
  });

  test('every tick entry has the tick number, two command lists and an events array', async () => {
    const { log } = await simMatch();
    checkTickEntries(log);
    assert.equal(log.ticks[0].tick, 0, 'the first entry describes the step out of tick 0');
  });

  test('tick entries keep both sides’ commands exactly as given', async () => {
    const { log, givenCommands } = await simMatch();
    assert.equal(log.ticks.length, givenCommands.length);
    for (const i of [0, 3, 5, 7, Math.floor(log.ticks.length / 2), log.ticks.length - 1]) {
      assert.deepEqual(log.ticks[i].commands, givenCommands[i], `commands of tick entry ${i} differ from what the players returned`);
    }
  });

  test('timing is a top-level list with one pair per tick and is not inside tick entries', async () => {
    const { log } = await simMatch();
    checkTiming(log);
  });

  test('comparable(log) is the log without timing and leaves the log untouched', async () => {
    const comparable = await fn('../env/log.mjs', 'comparable');
    const { log } = await simMatch();
    const before = JSON.stringify(log);
    const cmp = comparable(log);
    assert.equal('timing' in cmp, false, 'comparable must drop timing');
    assert.equal(JSON.stringify(log), before, 'comparable must not change the log');
    const expected = { ...log };
    delete expected.timing;
    assert.deepEqual(JSON.parse(JSON.stringify(cmp)), JSON.parse(JSON.stringify(expected)));
    assert.ok(Array.isArray(log.timing), 'the original log keeps its timing');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Breaking any required field makes validateLog name the problem

const BREAKS = [
  ['format missing', ['format'], (l) => { delete l.format; }],
  ['format wrong', ['format'], (l) => { l.format = 'some-other-log'; }],
  ['version missing', ['version'], (l) => { delete l.version; }],
  ['version not a number', ['version'], (l) => { l.version = '1'; }],
  ['seed missing', ['seed'], (l) => { delete l.seed; }],
  ['players missing', ['players'], (l) => { delete l.players; }],
  ['players has one name', ['players'], (l) => { l.players = ['solo']; }],
  ['players are not strings', ['players'], (l) => { l.players = [1, 2]; }],
  ['stats missing', ['stats'], (l) => { delete l.stats; }],
  ['initial missing', ['initial'], (l) => { delete l.initial; }],
  ['initial has no units list', ['initial', 'units'], (l) => { delete l.initial.units; }],
  ['ticks missing', ['ticks'], (l) => { delete l.ticks; }],
  ['ticks not a list', ['ticks'], (l) => { l.ticks = {}; }],
  ['a tick entry is null', ['tick'], (l, k) => { l.ticks[k] = null; }],
  ['a tick entry has no tick number', ['tick'], (l, k) => { delete l.ticks[k].tick; }],
  ['a tick number is a string', ['tick'], (l, k) => { l.ticks[k].tick = String(l.ticks[k].tick); }],
  ['tick numbers skip', ['tick'], (l, k) => { l.ticks[k].tick += 5; }],
  ['a tick entry has no commands', ['command'], (l, k) => { delete l.ticks[k].commands; }],
  ['a tick entry has one command list', ['command'], (l, k) => { l.ticks[k].commands = [[]]; }],
  ['commands are not lists', ['command'], (l, k) => { l.ticks[k].commands = ['a', 'b']; }],
  ['a tick entry has no events', ['event'], (l, k) => { delete l.ticks[k].events; }],
  ['events is not a list', ['event'], (l, k) => { l.ticks[k].events = {}; }],
  ['an event has an unknown kind', ['event'], (l, k) => { l.ticks[k].events.push({ e: 'teleport', id: 3 }); }],
  ['an event has no kind', ['event'], (l, k) => { l.ticks[k].events.push({ id: 3 }); }],
  ['a hit event lacks its hp', ['hit', 'hp', 'event'], (l, k) => { l.ticks[k].events.push({ e: 'hit', id: 3, by: 7, dmg: 8 }); }],
  ['result missing', ['result'], (l) => { delete l.result; }],
  ['result null', ['result'], (l) => { l.result = null; }],
  ['result winner is 7', ['winner'], (l) => { l.result.winner = 7; }],
  ['result has no reason', ['reason'], (l) => { delete l.result.reason; }],
  ['result has no tick', ['tick'], (l) => { delete l.result.tick; }],
  ['result value is not a pair', ['value'], (l) => { l.result.value = [1]; }],
  ['timing missing', ['timing'], (l) => { delete l.timing; }],
  ['timing not a list', ['timing'], (l) => { l.timing = 'fast'; }],
  ['timing one short', ['timing'], (l) => { l.timing.pop(); }],
  ['timing one too long', ['timing'], (l) => { l.timing.push([0, 0]); }],
  ['a timing entry is not a pair', ['timing'], (l, k) => { l.timing[k] = [1]; }],
  ['a timing entry is negative', ['timing'], (l, k) => { l.timing[k] = [-1, 0]; }],
  ['a timing entry holds strings', ['timing'], (l, k) => { l.timing[k] = ['1', '2']; }],
];

describe('validateLog names the problem when a required field is broken', () => {
  for (const [label, keywords, mutate] of BREAKS) {
    test(label, async () => {
      const validateLog = await fn('../env/log.mjs', 'validateLog');
      const { log } = await simMatch();
      const broken = structuredClone(log);
      const k = Math.floor(broken.ticks.length / 2);
      mutate(broken, k);
      const problems = validateLog(broken);
      assert.ok(Array.isArray(problems), 'validateLog must return a list');
      assert.ok(problems.length > 0, `validateLog accepted a log whose ${label}`);
      for (const p of problems) assert.ok(typeof p === 'string' && p.trim().length > 0, 'each problem must be a non-empty string');
      const named = problems.some((p) => keywords.some((w) => p.toLowerCase().includes(w)));
      assert.ok(named, `no problem names the broken field (expected one of ${keywords.join('/')}): ${problems.join(' | ')}`);
    });
  }

  test('does not change the log it checks', async () => {
    const validateLog = await fn('../env/log.mjs', 'validateLog');
    const { log } = await simMatch();
    const before = JSON.stringify(log);
    validateLog(log);
    assert.equal(JSON.stringify(log), before);
  });

  test('never throws on garbage and reports a problem for it', async () => {
    const validateLog = await fn('../env/log.mjs', 'validateLog');
    for (const junk of [null, undefined, 0, 'log', [], {}, { format: 'driftfall-log' }]) {
      let problems;
      assert.doesNotThrow(() => { problems = validateLog(junk); }, `validateLog threw on ${JSON.stringify(junk)}`);
      assert.ok(Array.isArray(problems) && problems.length > 0, `validateLog must reject ${JSON.stringify(junk)}`);
      for (const p of problems) assert.equal(typeof p, 'string');
    }
  });

  test('a half-built log (no result yet) is reported, a finished one is clean', async () => {
    const [createLog, appendTick, finishLog, validateLog] = await Promise.all([
      fn('../env/log.mjs', 'createLog'), fn('../env/log.mjs', 'appendTick'),
      fn('../env/log.mjs', 'finishLog'), fn('../env/log.mjs', 'validateLog'),
    ]);
    const { log: real } = await simMatch();
    const log = createLog({ seed: 3, players: ['a', 'b'], stats: real.stats, initial: structuredClone(real.initial) });
    appendTick(log, { tick: 0, commands: [[], []], events: [] }, [1, 2]);
    appendTick(log, { tick: 1, commands: [[{ type: 'stop', unit: 3 }], []], events: [{ e: 'order', id: 3, order: null }] }, [0.5, 0]);
    const unfinished = validateLog(log);
    assert.ok(unfinished.length > 0, 'a log without a result must not validate');
    assert.ok(unfinished.some((p) => p.toLowerCase().includes('result')), `expected a problem naming the result: ${unfinished.join(' | ')}`);
    finishLog(log, { winner: null, reason: 'timeout', tick: 2, value: [100, 100] });
    assert.deepEqual(validateLog(log), []);
    assert.deepEqual(log.timing, [[1, 2], [0.5, 0]]);
    assert.equal(log.ticks.length, 2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Replaying all events reproduces the simulation's final state

describe('replaying every event with viewer/replay.mjs reaches the simulation final state', () => {
  async function replayedAndFinal() {
    const replayTo = await fn('../viewer/replay.mjs', 'replayTo');
    const { log, state } = await simMatch();
    const replayed = replayTo(log, log.result.tick);
    assert.ok(replayed && typeof replayed === 'object', 'replayTo must return a state');
    for (const k of ['units', 'structures', 'shards', 'crystals']) {
      assert.ok(k in replayed, `replayed state must have "${k}"`);
    }
    return { got: snapshot(replayed), want: snapshot(state) };
  }

  test('the match made the comparison meaningful (units came and went, Shards moved)', async (t) => {
    const { log, state } = await simMatch();
    const kinds = eventKinds(log);
    t.diagnostic(`final units ${state.units.length}, structures ${state.structures.length}, shards ${state.shards.join('/')}`);
    assert.ok(state.units.length > 8 || kinds.die > 0, 'expected units to be trained or killed during the match');
    assert.ok(log.initial.units.length === 8, 'the match starts with the eight spec Workers');
    assert.notDeepEqual(snapshot(state).crystals, snapshot(log.initial).crystals, 'crystal amounts should have changed');
  });

  test('same entity ids', async () => {
    const { got, want } = await replayedAndFinal();
    assert.deepEqual(got.units.map((u) => u.id), want.units.map((u) => u.id), 'unit ids differ');
    assert.deepEqual(got.structures.map((s) => s.id), want.structures.map((s) => s.id), 'structure ids differ');
  });

  test('same owners and kinds', async () => {
    const { got, want } = await replayedAndFinal();
    const f = ['id', 'owner', 'kind'];
    assert.deepEqual(pickFields(got.units, f), pickFields(want.units, f), 'unit owner/kind differ');
    assert.deepEqual(pickFields(got.structures, f), pickFields(want.structures, f), 'structure owner/kind differ');
  });

  test('same tiles', async () => {
    const { got, want } = await replayedAndFinal();
    const f = ['id', 'x', 'y'];
    assert.deepEqual(pickFields(got.units, f), pickFields(want.units, f), 'unit tiles differ');
    assert.deepEqual(pickFields(got.structures, f), pickFields(want.structures, f), 'structure tiles differ');
  });

  test('same hp', async () => {
    const { got, want } = await replayedAndFinal();
    const f = ['id', 'hp'];
    assert.deepEqual(pickFields(got.units, f), pickFields(want.units, f), 'unit hp differs');
    assert.deepEqual(pickFields(got.structures, f), pickFields(want.structures, f), 'structure hp differs');
  });

  test('same carrying', async () => {
    const { got, want } = await replayedAndFinal();
    const f = ['id', 'carrying'];
    assert.deepEqual(pickFields(got.units, f), pickFields(want.units, f), 'carried Shards differ');
  });

  test('same structure progress, complete flag and queues', async () => {
    const { got, want } = await replayedAndFinal();
    const f = ['id', 'progress', 'complete', 'queue'];
    assert.deepEqual(pickFields(got.structures, f), pickFields(want.structures, f), 'structure progress/complete/queue differ');
  });

  test('same Shards for both sides', async () => {
    const { got, want } = await replayedAndFinal();
    assert.deepEqual(got.shards, want.shards, 'Shards differ');
  });

  test('same crystal amounts', async () => {
    const { got, want } = await replayedAndFinal();
    assert.deepEqual(got.crystals, want.crystals, 'crystal amounts differ');
  });

  test('everything together, and folding applyTick over the log gives the same answer', async () => {
    const [applyTick, replayTo] = await Promise.all([fn('../viewer/replay.mjs', 'applyTick'), fn('../viewer/replay.mjs', 'replayTo')]);
    const { log, state } = await simMatch();
    const before = JSON.stringify(log);
    let s = structuredClone(log.initial);
    s.units ??= [];
    s.structures ??= [];
    for (const entry of log.ticks) s = applyTick(s, entry, log.stats) ?? s;
    assert.deepEqual(snapshot(s), snapshot(state), 'applyTick over every entry must reach the final state');
    assert.deepEqual(snapshot(replayTo(log, log.result.tick)), snapshot(state), 'replayTo must reach the final state');
    assert.equal(JSON.stringify(log), before, 'replay must not modify the log');
  });

  test('the replayed final value matches the result value', async () => {
    const replayTo = await fn('../viewer/replay.mjs', 'replayTo');
    const sideValue = await fn('../env/stats.mjs', 'sideValue');
    const { log } = await simMatch();
    const replayed = replayTo(log, log.result.tick);
    assert.deepEqual([sideValue(replayed, 0), sideValue(replayed, 1)], log.result.value);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. A log from a referee-run match (worker threads, sample player on both sides)

describe('log from a match run by env/referee.mjs with the sample player', () => {
  test('passes validateLog with no problems', async (t) => {
    const validateLog = await fn('../env/log.mjs', 'validateLog');
    const { log, result } = await refereeMatch();
    t.diagnostic(`referee match: ${result.tick} ticks, winner ${result.winner}, reason ${result.reason}, events ${JSON.stringify(eventKinds(log))}`);
    const problems = validateLog(log);
    assert.deepEqual(problems, [], `validateLog reported: ${problems.join(' | ')}`);
  });

  test('has the spec top-level fields, two player names and the stats table', async () => {
    const STATS = await value('../env/stats.mjs', 'STATS');
    const { log, result } = await refereeMatch();
    checkTopLevel(log, STATS);
    assert.equal(log.seed, REFEREE_SEED);
    assert.deepEqual(log.result, result, 'the returned result and the one in the log must agree');
  });

  test('every tick entry has the tick number, two command lists and an events array', async () => {
    const { log } = await refereeMatch();
    checkTickEntries(log);
  });

  test('timing is a top-level list with one pair of milliseconds per tick', async () => {
    const { log } = await refereeMatch();
    checkTiming(log);
  });

  test('no late, error or forfeit events for a well-behaved sample player', async () => {
    const { log } = await refereeMatch();
    const kinds = eventKinds(log);
    for (const k of ['error', 'forfeit']) assert.equal(kinds[k] ?? 0, 0, `unexpected "${k}" events`);
    // A slow machine may be late once or twice; a flood of late events means the timing is wrong.
    assert.ok((kinds.late ?? 0) < log.ticks.length / 10, `too many late events: ${kinds.late}`);
  });

  test('replaying the whole log gives a state whose value matches the result', async () => {
    const replayTo = await fn('../viewer/replay.mjs', 'replayTo');
    const sideValue = await fn('../env/stats.mjs', 'sideValue');
    const { log } = await refereeMatch();
    const replayed = replayTo(log, log.result.tick);
    assert.deepEqual([sideValue(replayed, 0), sideValue(replayed, 1)], log.result.value);
    const ids = [...replayed.units, ...replayed.structures].map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'replayed ids must be unique');
  });

  test('writing the log to JSON and reading it back validates and replays the same', async () => {
    const validateLog = await fn('../env/log.mjs', 'validateLog');
    const replayTo = await fn('../viewer/replay.mjs', 'replayTo');
    const { log } = await refereeMatch();
    const roundTripped = JSON.parse(JSON.stringify(log));
    assert.deepEqual(validateLog(roundTripped), []);
    assert.deepEqual(snapshot(replayTo(roundTripped, log.result.tick)), snapshot(replayTo(log, log.result.tick)));
  });
});
