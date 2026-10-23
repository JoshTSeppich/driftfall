// Anti-cheat (ENV-SPEC.md §10, §11): hostile player modules run through the real env/referee.mjs.
// Every test says what the cheater tries and what must still be true afterwards: the other side is unharmed,
// the match log is valid and the referee finishes in bounded time. Players are written to a temp folder.
//
// Tests marked `todo` describe a protection the referee does not give yet. They run and print their result but
// do not fail the suite; the reason is in the test name. Remove `todo` once the referee closes the hole.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEED = 7;
const THINK_MS = 200; // generous so a busy machine does not make the honest side late
const HARD_MS = 1000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let runMatch;
let STATS;
let validateLog;
let replayTo;
let dir;

before(async () => {
  ({ runMatch } = await import('../env/referee.mjs'));
  ({ STATS } = await import('../env/stats.mjs'));
  ({ validateLog } = await import('../env/log.mjs'));
  ({ replayTo } = await import('../viewer/replay.mjs'));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftfall-anticheat-'));
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function writePlayer(name, source) {
  const file = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(file, source);
  return file;
}

const IDLE = `export function createPlayer({ side }) { return { name: 'idle-' + side, act() { return []; } }; }`;

const allEvents = (log) => log.ticks.flatMap((t) => t.events ?? []);
const eventsOf = (log, kind, player) => allEvents(log).filter((e) => e.e === kind && (player === undefined || e.player === player));

async function play(p0, p1, opts = {}) {
  return runMatch({ seed: SEED, players: [p0, p1], thinkMs: THINK_MS, hardMs: HARD_MS, maxTicks: 6, ...opts });
}

// The honest side must come out untouched: no events about it, and its units still alive.
function assertHonestSideUnharmed(log, honest) {
  assert.equal(eventsOf(log, 'error', honest).length, 0, 'no error event for the honest side');
  assert.equal(eventsOf(log, 'late', honest).length, 0, 'no late event for the honest side');
  assert.equal(eventsOf(log, 'forfeit', honest).length, 0, 'no forfeit for the honest side');
  assert.equal(eventsOf(log, 'reject', honest).length, 0, 'no reject for the honest side');
  assert.equal(eventsOf(log, 'die').length, 0, 'nothing died');
}

function assertSaneFinalState(log) {
  assert.deepEqual(validateLog(log), [], 'the log validates');
  const state = replayTo(log, log.ticks.length);
  const seen = new Set();
  for (const u of state.units) {
    assert.ok(Number.isInteger(u.x) && Number.isInteger(u.y), `unit ${u.id} is on an integer tile`);
    assert.ok(u.x >= 0 && u.y >= 0 && u.x < state.width && u.y < state.height, `unit ${u.id} is on the map`);
    const key = u.x + ',' + u.y;
    assert.ok(!seen.has(key), 'no two units share a tile');
    seen.add(key);
  }
  for (const s of state.shards) assert.ok(Number.isFinite(s) && s >= 0, 'Shards are finite and never negative');
}

// ---------- 1. mutating what the referee hands out ----------

test('mutating, freezing and hoarding observations and stats changes nothing outside the player', { timeout: 20000 }, async () => {
  const statsBefore = JSON.stringify(STATS);
  const protoBefore = Object.keys(Object.prototype).length + Object.keys(Array.prototype).length;
  const tamper = writePlayer('tamper', `
let kept = null;
export function createPlayer({ side, stats }) {
  // rewrite the rules table the referee gave us, then keep going
  stats.units.grunt.damage = 9999; stats.units.worker.cost = 0; stats.match.maxTicks = 1;
  Object.prototype.polluted = true;
  Array.prototype.polluted = true;
  return {
    name: 'tamper',
    act(obs) {
      if (kept) { kept.units.length = 0; kept.shards[0] = 1e9; } // old observation from last tick
      kept = obs;
      obs.shards = [1e9, 1e9]; obs.you = 1 - obs.you; obs.units.forEach((u) => { u.owner = 1 - u.owner; u.hp = 1e9; });
      Object.freeze(obs.units); obs.units.push = null;
      return [];
    },
  };
}`);
  const idle = writePlayer('idle', IDLE);
  const clean = await play(idle, idle);
  const dirty = await play(tamper, idle);

  assert.equal(JSON.stringify(STATS), statsBefore, 'the referee STATS table is untouched');
  assert.equal(Object.keys(Object.prototype).length + Object.keys(Array.prototype).length, protoBefore, 'no prototype pollution reached the main thread');
  assert.equal({}.polluted, undefined);
  assert.deepEqual(dirty.result, clean.result);
  assert.deepEqual(dirty.log.stats, clean.log.stats, 'the log carries the real stats table');
  assertHonestSideUnharmed(dirty.log, 1);
  assertSaneFinalState(dirty.log);
});

test('the observation holds exactly the spec §10 fields and no internal state', { timeout: 20000 }, async () => {
  const spy = writePlayer('spy', `
import { parentPort } from 'node:worker_threads';
export function createPlayer({ side }) {
  return { name: 'spy', act(obs) {
    const shape = { top: Object.keys(obs).sort(), unit: Object.keys(obs.units[0]).sort(), structure: Object.keys(obs.structures[0]).sort(), crystal: Object.keys(obs.crystals[0]).sort(), you: obs.you, side };
    return [{ type: 'shape-report', shape }];
  } };
}`);
  const idle = writePlayer('idle', IDLE);
  const { log } = await play(spy, idle, { maxTicks: 1 });
  const first = log.ticks[0].commands[0][0];
  const { shape } = first;
  assert.deepEqual(shape.top, ['crystals', 'height', 'maxTicks', 'rocks', 'shards', 'structures', 'tick', 'unitCap', 'units', 'width', 'you']);
  assert.deepEqual(shape.unit, ['carrying', 'hp', 'id', 'kind', 'order', 'owner', 'x', 'y']);
  assert.deepEqual(shape.structure, ['complete', 'hp', 'id', 'kind', 'owner', 'progress', 'queue', 'x', 'y']);
  assert.deepEqual(shape.crystal, ['amount', 'x', 'y']);
  assert.equal(shape.you, shape.side, 'you matches the side the player was started as');
});

// ---------- 2. calling outside the API ----------

test('a forged reply, a flood of messages and early replies cannot change the match', { timeout: 30000 }, async () => {
  const forger = writePlayer('forger', `
// The player runs in a child process now, so the channel to the referee is process.send (was parentPort).
export function createPlayer() {
  // pretend to be ready again, answer ticks that have not been asked yet, and flood the referee
  process.send({ type: 'ready', name: 'definitely-not-the-forger' });
  for (let t = 0; t < 50; t++) process.send({ type: 'commands', tick: t, commands: [{ type: 'stop', unit: 1 }] });
  return { name: 'forger', act(obs) {
    for (let i = 0; i < 20000; i++) process.send({ type: 'commands', tick: obs.tick + 1 + (i % 5), commands: [] });
    return [];
  } };
}`);
  const idle = writePlayer('idle', IDLE);
  const t0 = performance.now();
  const { log, result } = await play(forger, idle);
  const elapsed = performance.now() - t0;
  assert.equal(result.reason, 'timeout');
  assert.equal(log.ticks.length, 6);
  assertHonestSideUnharmed(log, 1);
  assertSaneFinalState(log);
  assert.ok(elapsed < 15000, `message flood was absorbed in ${Math.round(elapsed)} ms`);
});

test('process.exit, an uncaught error and a crash in a timer each cost only that player the match', { timeout: 30000 }, async () => {
  const cases = {
    exit: `export function createPlayer() { return { act() { process.exit(3); } }; }`,
    'uncaught-timer': `export function createPlayer() { return { act() { setTimeout(() => { throw new Error('boom'); }, 0); return []; } }; }`,
    'unhandled-rejection': `export function createPlayer() { return { act() { Promise.reject(new Error('nope')); return []; } }; }`,
  };
  const idle = writePlayer('idle', IDLE);
  for (const [label, source] of Object.entries(cases)) {
    const bad = writePlayer('crash-' + label, source);
    const t0 = performance.now();
    const { log, result } = await play(bad, idle, { maxTicks: 20 });
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 5000, `${label}: finished in ${Math.round(elapsed)} ms`);
    assert.equal(result.reason === 'forfeit' ? result.winner : 1, 1, `${label}: the honest side wins a forfeit, or the cheater only lost its own thread`);
    assertHonestSideUnharmed(log, 1);
    assert.deepEqual(validateLog(log), [], `${label}: the log validates`);
  }
});

test('thrown values of every shape (null, symbols, objects with hostile toString) are errors, not crashes', { timeout: 30000 }, async () => {
  const thrower = writePlayer('shape-thrower', `
const values = [() => null, () => undefined, () => Symbol('s'), () => ({ toString() { throw new Error('inner'); } }),
  () => Object.create(null), () => 42n, () => new Proxy({}, { get() { throw new Error('trap'); } })];
let i = 0;
export function createPlayer() { return { act() { const v = values[i++ % values.length](); throw v; } }; }`);
  const idle = writePlayer('idle', IDLE);
  const { log, result } = await play(thrower, idle, { maxTicks: 14 });
  assert.equal(result.reason, 'timeout', 'fewer than 50 throws is not a forfeit');
  assert.equal(eventsOf(log, 'error', 0).length, 14, 'every throw became exactly one error event');
  for (const e of eventsOf(log, 'error', 0)) assert.equal(typeof e.message, 'string');
  assertHonestSideUnharmed(log, 1);
  assertSaneFinalState(log);
});

test('a player cannot read the other player\'s source or any file outside its own folder', { timeout: 20000 }, async () => {
  const secret = path.join(dir, 'opponent-secret.txt');
  fs.writeFileSync(secret, 'opponent plan');
  const reader = writePlayer('reader', `
import fs from 'node:fs';
let result = 'blocked';
try { result = fs.readFileSync(${JSON.stringify(secret)}, 'utf8'); } catch (e) { result = 'blocked'; }
export function createPlayer() { return { name: 'reader', act() { return [{ type: 'read-report', result }]; } }; }`);
  const idle = writePlayer('idle', IDLE);
  const { log } = await play(reader, idle, { maxTicks: 1 });
  assert.equal(log.ticks[0].commands[0][0].result, 'blocked', 'file reads from a player must fail');
});

test('a player cannot spawn processes, open sockets or write files', { timeout: 20000 }, async () => {
  const marker = path.join(dir, 'written-by-player.txt');
  const writer = writePlayer('writer', `
import fs from 'node:fs';
import cp from 'node:child_process';
let outcome = [];
try { fs.writeFileSync(${JSON.stringify(marker)}, 'x'); outcome.push('wrote'); } catch { outcome.push('write-blocked'); }
try { cp.execSync('echo hi'); outcome.push('spawned'); } catch { outcome.push('spawn-blocked'); }
export function createPlayer() { return { name: 'writer', act() { return [{ type: 'report', outcome }]; } }; }`);
  const idle = writePlayer('idle', IDLE);
  const { log } = await play(writer, idle, { maxTicks: 1 });
  assert.deepEqual(log.ticks[0].commands[0][0].outcome, ['write-blocked', 'spawn-blocked']);
  assert.equal(fs.existsSync(marker), false);
});

// ---------- 3. huge, hostile and malformed command lists ----------

test('a huge command list is cut to 100 per tick and the rest are rejected as too-many', { timeout: 30000 }, async () => {
  const spammer = writePlayer('spammer', `
export function createPlayer() { return { name: 'spammer', act(obs) {
  const own = obs.units.filter((u) => u.owner === obs.you)[0];
  return Array.from({ length: 50000 }, () => ({ type: 'move', unit: own.id, x: 1, y: 1 }));
} }; }`);
  const idle = writePlayer('idle', IDLE);
  const t0 = performance.now();
  const { log, result } = await play(spammer, idle, { maxTicks: 4 });
  const elapsed = performance.now() - t0;
  assert.equal(result.reason, 'timeout');
  assert.equal(eventsOf(log, 'forfeit').length, 0);
  assertHonestSideUnharmed(log, 1);
  for (let i = 0; i < 4; i++) {
    const tooMany = log.ticks[i].events.filter((e) => e.e === 'reject' && e.player === 0 && e.reason === 'too-many');
    assert.equal(tooMany.length, 50000 - 100, `tick ${i}: every command past the 100th is rejected as too-many`);
  }
  assert.ok(elapsed < 20000, `50000-command lists finished in ${Math.round(elapsed)} ms`);
});

test('hostile values in commands (NaN, huge, negative, strings, getters, __proto__) never break the simulation', { timeout: 30000 }, async () => {
  const fuzzer = writePlayer('fuzzer', `
const odd = [NaN, Infinity, -Infinity, -1, 0.5, 2 ** 53, -(2 ** 53), 1e308, '3', '', null, undefined, true, [], {}, [1], 'constructor', '__proto__'];
const types = ['move', 'attack', 'gather', 'build', 'train', 'stop', 'cast', '__proto__', 'constructor', '', 7, null];
let n = 0;
export function createPlayer() { return { name: 'fuzzer', act(obs) {
  const own = obs.units.filter((u) => u.owner === obs.you).map((u) => u.id);
  const core = obs.structures.find((s) => s.owner === obs.you).id;
  const out = [];
  for (let i = 0; i < 90; i++) {
    const pick = () => odd[(n++ * 7 + i) % odd.length];
    const c = { type: types[(n + i) % types.length], unit: i % 3 ? pick() : own[i % own.length], building: i % 2 ? core : pick(),
      kind: ['forge', 'turret', 'worker', 'grunt', 'brute', pick()][i % 6], x: pick(), y: pick(), target: i % 4 ? pick() : 1 };
    out.push(c);
  }
  out.push(JSON.parse('{"type":"move","__proto__":{"unit":1},"unit":' + own[0] + ',"x":2,"y":2}'));
  out.push({ type: 'move', get unit() { return own[0]; }, x: 3, y: 3 });
  out.push(null, 5, 'move', [], () => 1);
  return out.slice(0, 95).concat([{ type: 'move', unit: own[0], x: 3, y: 3 }]);
} }; }`);
  const idle = writePlayer('idle', IDLE);
  const { log, result } = await play(fuzzer, idle, { maxTicks: 40 });
  assert.ok(['timeout', 'forfeit'].includes(result.reason));
  if (result.reason === 'forfeit') assert.equal(result.winner, 1, 'only the fuzzer may lose');
  assertHonestSideUnharmed(log, 1);
  assertSaneFinalState(log);
  for (const e of eventsOf(log, 'reject', 0)) {
    assert.ok(['bad-command', 'not-yours', 'no-such-unit', 'wrong-kind', 'off-map', 'tile-taken', 'no-shards', 'queue-full', 'unit-cap', 'bad-target', 'not-complete', 'too-many'].includes(e.reason), `known reject reason, got ${e.reason}`);
  }
});

test('commands for the enemy\'s units, Core and buildings are rejected and change nothing', { timeout: 20000 }, async () => {
  const thief = writePlayer('thief', `
export function createPlayer() { return { name: 'thief', act(obs) {
  const enemy = obs.units.filter((u) => u.owner !== obs.you);
  const enemyCore = obs.structures.find((s) => s.owner !== obs.you);
  return [...enemy.map((u) => ({ type: 'move', unit: u.id, x: 0, y: 0 })), ...enemy.map((u) => ({ type: 'stop', unit: u.id })),
    { type: 'train', building: enemyCore.id, kind: 'worker' }];
} }; }`);
  const idle = writePlayer('idle', IDLE);
  const idleRun = await play(idle, idle);
  const { log } = await play(thief, idle);
  assert.ok(eventsOf(log, 'reject', 0).length > 0);
  assert.ok(eventsOf(log, 'reject', 0).every((e) => e.reason === 'not-yours'), 'every theft attempt is not-yours');
  assert.equal(eventsOf(log, 'order').length, 0, 'no order was set');
  assert.equal(eventsOf(log, 'spend').length, 0, 'no Shards were spent');
  assert.deepEqual(log.initial, idleRun.log.initial);
  assert.equal(JSON.stringify(replayTo(log, 6).units), JSON.stringify(replayTo(idleRun.log, 6).units), 'enemy units are exactly where an idle match leaves them');
});

test('commands that cannot be sent back (functions, symbols) are an error event, never a crash', { timeout: 20000 }, async () => {
  const bad = writePlayer('unsendable', `
export function createPlayer() { return { act() { return [{ type: 'move', unit: 1, f() {} }]; } }; }`);
  const idle = writePlayer('idle', IDLE);
  const { log } = await play(bad, idle, { maxTicks: 3 });
  assert.equal(eventsOf(log, 'error', 0).length, 3);
  assert.ok(log.ticks.every((t) => t.commands[0].length === 0), 'nothing from a failed send reaches the simulation');
  assertHonestSideUnharmed(log, 1);
});

test('an enormous reply (a 50 MB string in one command) does not stall or crash the match', { timeout: 30000 }, async () => {
  const fat = writePlayer('fat', `
const big = 'A'.repeat(50 * 1024 * 1024);
export function createPlayer() { return { name: 'fat', act(obs) { return [{ type: 'move', unit: 3, x: 1, y: 1, note: big }]; } }; }`);
  const idle = writePlayer('idle', IDLE);
  const t0 = performance.now();
  const { log, result } = await play(fat, idle, { maxTicks: 3 });
  const elapsed = performance.now() - t0;
  assert.ok(['timeout', 'forfeit'].includes(result.reason));
  assertHonestSideUnharmed(log, 1);
  const bytes = JSON.stringify(log).length;
  assert.ok(bytes < 5 * 1024 * 1024, `the match log stayed small (${bytes} bytes): unknown command fields must not be copied into it wholesale`);
  assert.ok(elapsed < 10000, `finished in ${Math.round(elapsed)} ms`);
});

// ---------- 4. hanging, slowing, hogging ----------

test('a player that spins forever while loading, or inside createPlayer, forfeits at tick 0 within about a second', { timeout: 20000 }, async () => {
  const idle = writePlayer('idle', IDLE);
  const cases = {
    'top-level loop': `while (true) {}\nexport function createPlayer() { return { act() { return []; } }; }`,
    'createPlayer loop': `export function createPlayer() { for (;;) {} }`,
    'top-level await forever': `await new Promise(() => {});\nexport function createPlayer() { return { act() { return []; } }; }`,
  };
  for (const [label, source] of Object.entries(cases)) {
    const bad = writePlayer('load-' + label.replace(/\W+/g, '-'), source);
    const t0 = performance.now();
    const { log, result } = await play(idle, bad);
    const elapsed = performance.now() - t0;
    assert.equal(result.reason, 'forfeit', label);
    assert.equal(result.winner, 0, label);
    assert.equal(result.tick, 0, label);
    assert.ok(elapsed < HARD_MS + 3000, `${label}: ended in ${Math.round(elapsed)} ms`);
    assert.deepEqual(validateLog(log), [], label);
  }
});

test('two players that both hang are cut off together, not one after the other', { timeout: 20000 }, async () => {
  const hang = writePlayer('hang', `export function createPlayer() { return { act() { for (;;) {} } }; }`);
  const t0 = performance.now();
  const { result } = await play(hang, hang);
  const elapsed = performance.now() - t0;
  assert.equal(result.reason, 'forfeit');
  assert.equal(result.winner, null, 'both forfeiting is a draw');
  assert.ok(elapsed < HARD_MS * 1.8 + 1500, `ended in ${Math.round(elapsed)} ms, roughly one hard limit and not two`);
});

test('a player that is slow but answers inside the hard limit is late every tick and never forfeits', { timeout: 30000 }, async () => {
  const slow = writePlayer('slow', `
export function createPlayer() { return { name: 'slow', act() { const end = performance.now() + 120; while (performance.now() < end) {} return [{ type: 'train', building: 1, kind: 'worker' }]; } }; }`);
  const idle = writePlayer('idle', IDLE);
  const { log, result } = await play(slow, idle, { maxTicks: 5, thinkMs: 50 });
  assert.equal(result.reason, 'timeout');
  assert.equal(eventsOf(log, 'late', 0).length, 5);
  assert.ok(log.ticks.every((t) => t.commands[0].length === 0), 'late commands never reach the simulation');
  assert.equal(eventsOf(log, 'spend').length, 0);
  assertHonestSideUnharmed(log, 1);
});

test('a player that answers after the hard limit has its worker terminated and cannot act later', { timeout: 20000 }, async () => {
  const marker = path.join(dir, 'late-marker.txt');
  const late = writePlayer('very-late', `
import fs from 'node:fs';
export function createPlayer() { return { act() { return new Promise((resolve) => setTimeout(() => { fs.writeFileSync(${JSON.stringify(marker)}, 'still alive'); resolve([]); }, 2500)); } }; }`);
  const idle = writePlayer('idle', IDLE);
  const { result } = await play(idle, late);
  assert.equal(result.reason, 'forfeit');
  assert.equal(result.winner, 0);
  await new Promise((r) => setTimeout(r, 2800));
  assert.equal(fs.existsSync(marker), false, 'the terminated worker never ran its delayed code');
});

test('a player that hogs memory dies alone: the referee process survives and reports a forfeit', { timeout: 60000 }, async () => {
  // Run in a child process: if the worker takes the whole process down this test must report that, not die with it.
  const hog = writePlayer('mem-hog', `
const hoard = [];
export function createPlayer() { return { name: 'hog', act() { for (;;) hoard.push(new Array(1e6).fill(Math.random())); } }; }`);
  const idle = writePlayer('idle', IDLE);
  const runner = path.join(dir, 'run-hog.mjs');
  fs.writeFileSync(runner, `
import { runMatch } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'env/referee.mjs')).href)};
const { result } = await runMatch({ seed: 7, players: [${JSON.stringify(hog)}, ${JSON.stringify(idle)}], maxTicks: 5 });
console.log('RESULT ' + JSON.stringify(result));`);
  const run = spawnSync(process.execPath, [runner], { encoding: 'utf8', timeout: 45000 });
  const line = (run.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, `the referee survived and printed a result (exit ${run.status}, signal ${run.signal}, stderr: ${(run.stderr || '').slice(-300)})`);
  const result = JSON.parse(line.slice(7));
  assert.equal(result.reason, 'forfeit');
  assert.equal(result.winner, 1);
});

test('console spam from a player does not slow the match past a bound', { timeout: 30000 }, async () => {
  const chatty = writePlayer('chatty', `
export function createPlayer() { return { name: 'chatty', act() { for (let i = 0; i < 2000; i++) console.log('x'.repeat(200)); return []; } }; }`);
  const idle = writePlayer('idle', IDLE);
  const t0 = performance.now();
  const { log, result } = await play(chatty, idle, { maxTicks: 4, thinkMs: 5000 });
  const elapsed = performance.now() - t0;
  assert.equal(result.reason, 'timeout');
  assertHonestSideUnharmed(log, 1);
  assert.ok(elapsed < 15000, `console spam finished in ${Math.round(elapsed)} ms`);
});

test('a hostile player run never leaves a worker thread alive after the match', { timeout: 30000 }, async () => {
  const hang = writePlayer('hang2', `export function createPlayer() { return { act() { for (;;) {} } }; }`);
  const idle = writePlayer('idle', IDLE);
  const runner = path.join(dir, 'run-and-exit.mjs');
  fs.writeFileSync(runner, `
import { runMatch } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'env/referee.mjs')).href)};
await runMatch({ seed: 7, players: [${JSON.stringify(hang)}, ${JSON.stringify(idle)}], maxTicks: 5 });
console.log('DONE');`);
  const t0 = performance.now();
  const run = spawnSync(process.execPath, [runner], { encoding: 'utf8', timeout: 20000 });
  const elapsed = performance.now() - t0;
  assert.equal(run.status, 0, 'the process exits by itself, so no worker thread or timer is left holding it open');
  assert.match(run.stdout, /DONE/);
  assert.ok(elapsed < 10000, `exited after ${Math.round(elapsed)} ms`);
});
