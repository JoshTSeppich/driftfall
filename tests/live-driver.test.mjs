// Live driver (env/live.mjs, CLASSIC.md): 24 ticks per second on a fake clock, human commands applied on the
// next tick, the AI under the referee rules of ENV-SPEC §11, deterministic and replayable logs.
// Everything runs the real sim and the real team bot in process; only the clock is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLiveMatch, rerun, simEvents, DEFAULTS, DIFFICULTY } from '../env/live.mjs';
import { validateLog, comparable } from '../env/log.mjs';
import { STATS } from '../env/stats.mjs';

const BOT = new URL('../players/haiku/bot.mjs', import.meta.url).href;
const TICK_MS = 1000 / 24;

// ---- a fake clock: now() and timers that only move when the test says so ----

function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  const yieldTurns = async (n = 4) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
  };
  const clock = {
    get t() {
      return t;
    },
    now: () => t,
    setTimer(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: t + Math.max(0, ms), fn, id });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    pendingTimers: () => timers.size,
    // Advance the clock by `ms`, firing due timers in order and letting async ticks finish between them.
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        await yieldTurns();
        let next = null;
        for (const tm of timers.values()) {
          if (tm.at <= target && (next === null || tm.at < next.at || (tm.at === next.at && tm.id < next.id))) next = tm;
        }
        if (!next) break;
        timers.delete(next.id);
        t = Math.max(t, next.at);
        next.fn();
        await yieldTurns();
      }
      t = target;
      await yieldTurns();
    },
    // Step the clock forward in small slices so timers set during the advance also get their turn.
    async run(ms, slice = TICK_MS) {
      const start = t;
      const end = start + ms;
      for (let k = 1; t < end; k++) {
        const target = Math.min(end, start + k * slice); // computed, not accumulated, so the end is exact
        await this.advance(target - t);
      }
    },
    jump(ms) {
      t += ms;
    },
  };
  return clock;
}

const scripted = (name, act) => ({ name, act });
const idle = () => scripted('idle', () => []);

function live(opts = {}) {
  const clock = fakeClock();
  const driver = createLiveMatch({
    seed: 7,
    human: 0,
    ai: idle(),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    aiStartTick: 0, // these tests exercise the AI from tick 0; the default peace period has its own test below
    ...opts,
  });
  return { clock, driver };
}

const ownUnits = (driver, side) => driver.state.units.filter((u) => u.owner === side);

// ---- clock ----

test('runs 24 ticks in one second of clock time, each tick 1000/24 ms apart', async () => {
  const { clock, driver } = live();
  const seen = [];
  driver.on('tick', ({ tick }) => seen.push({ tick, at: clock.t }));
  assert.equal(driver.tps, 24);
  assert.equal(driver.interval, TICK_MS);
  driver.start();
  await clock.run(1000);
  assert.equal(driver.state.tick, 24);
  assert.equal(driver.clock.ticks, 24);
  assert.deepEqual(seen.map((s) => s.tick), [...Array(24).keys()]);
  for (let i = 1; i < seen.length; i++) assert.ok(Math.abs(seen[i].at - seen[i - 1].at - TICK_MS) < 1e-6, 'ticks are evenly spaced');
  driver.stop();
});

test('a long stall is dropped, not fast-forwarded: at most maxCatchUp ticks run on one wake-up', async () => {
  const { clock, driver } = live({ maxCatchUp: 6 });
  driver.start();
  await clock.run(100); // 2 ticks at 41.7 ms
  const before = driver.state.tick;
  clock.jump(5000); // the tab was hidden for five seconds
  await clock.advance(0);
  assert.equal(driver.state.tick, before + 6, 'six catch-up ticks, no more');
  assert.ok(driver.clock.dropped > 50, 'the rest of the lag is dropped: ' + driver.clock.dropped);
  await clock.run(1000);
  assert.equal(driver.state.tick, before + 6 + 24, 'then back to 24 per second');
  assert.equal(driver.clock.behindMs, 0);
  driver.stop();
});

test('pause stops the clock, resume continues without catch-up', async () => {
  const { clock, driver } = live();
  driver.start();
  await clock.run(500);
  const at = driver.state.tick;
  assert.equal(at, 12);
  assert.equal(driver.pause(), true);
  assert.equal(driver.running, false);
  await clock.run(3000);
  assert.equal(driver.state.tick, at, 'no ticks while paused');
  assert.equal(driver.resume(), true);
  await clock.run(500);
  assert.equal(driver.state.tick, at + 12, 'no catch-up for the paused time');
  driver.stop();
  await clock.run(500);
  assert.equal(driver.state.tick, at + 12, 'nothing after stop');
  assert.equal(driver.start(), false);
});

test('tick() by hand advances exactly one tick without the clock', async () => {
  const { driver } = live();
  const a = await driver.tick();
  assert.equal(a.tick, 0);
  assert.equal(driver.state.tick, 1);
  await driver.tick();
  assert.equal(driver.state.tick, 2);
  assert.equal(driver.log.ticks.length, 2);
});

// ---- human commands ----

test('a queued human command is applied on the next tick and recorded in the log', async () => {
  const { driver } = live();
  const worker = ownUnits(driver, 0)[0];
  assert.equal(driver.queue({ type: 'move', unit: worker.id, x: 10, y: 10 }), true);
  assert.equal(driver.pending().length, 1);
  const { commands, events } = await driver.tick();
  assert.deepEqual(commands[0], [{ type: 'move', unit: worker.id, x: 10, y: 10 }]);
  assert.equal(driver.pending().length, 0);
  assert.ok(events.some((e) => e.e === 'order' && e.id === worker.id), 'the sim set the order');
  assert.deepEqual(driver.log.ticks[0].commands[0], [{ type: 'move', unit: worker.id, x: 10, y: 10 }]);
  const u = driver.state.units.find((x) => x.id === worker.id);
  assert.equal(u.order.type, 'move');
});

test('queue takes a list too, refuses non-objects, and carries extras over 100 to the next tick', async () => {
  const { driver } = live();
  const worker = ownUnits(driver, 0)[0];
  assert.equal(driver.queue('nope'), false);
  assert.equal(driver.queue(null), false);
  const cmds = Array.from({ length: 150 }, () => ({ type: 'stop', unit: worker.id }));
  assert.equal(driver.queue(cmds), true);
  const first = await driver.tick();
  assert.equal(first.commands[0].length, STATS.match.maxCommandsPerTick);
  assert.equal(driver.pending().length, 50);
  assert.ok(!first.events.some((e) => e.e === 'reject' && e.reason === 'too-many'), 'nothing hits the too-many rule');
  const second = await driver.tick();
  assert.equal(second.commands[0].length, 50);
  assert.equal(driver.pending().length, 0);
});

test('a command queued inside the tick listener lands on the very next tick, even while the AI is slow to answer', async () => {
  const { clock, driver } = live({ ai: scripted('async', () => new Promise((r) => clock.setTimer(() => r([]), 5))) });
  const worker = ownUnits(driver, 0)[0];
  driver.on('tick', ({ tick }) => {
    if (tick === 0) driver.queue({ type: 'stop', unit: worker.id });
  });
  driver.start();
  await clock.run(200);
  assert.ok(driver.state.tick >= 3);
  assert.deepEqual(driver.log.ticks[0].commands[0], []);
  assert.deepEqual(driver.log.ticks[1].commands[0], [{ type: 'stop', unit: worker.id }], 'queued after tick 0, applied on tick 1');
  driver.stop();
});

test('time() is the fractional tick for a renderer: between T-1 and T, frozen while paused, 0 before the first tick', async () => {
  const { clock, driver } = live();
  assert.equal(driver.time(), 0);
  assert.equal(driver.now, driver.time, 'now is the engine-facing alias');
  driver.start();
  await clock.run(TICK_MS); // tick 0 applied, state.tick is 1
  assert.equal(driver.state.tick, 1);
  assert.equal(driver.time(), 0);
  await clock.advance(TICK_MS / 2);
  assert.ok(Math.abs(driver.time() - 0.5) < 1e-9, 'half an interval later: ' + driver.time());
  await clock.run(TICK_MS * 10);
  assert.equal(driver.state.tick, 11);
  driver.pause();
  const frozen = driver.time();
  assert.equal(frozen, 11, 'paused shows the latest state (tick 11) whole, alpha 1');
  await clock.run(1000);
  assert.equal(driver.time(), frozen);
  driver.stop();
});

test('a live match defaults to about 15 minutes at 24 tps, and maxTicks overrides it', () => {
  assert.equal(DEFAULTS.maxTicks, 24 * 60 * 15);
  assert.equal(live().driver.state.maxTicks, 21600);
  assert.equal(live({ maxTicks: 10 }).driver.state.maxTicks, 10);
});

test('illegal human commands are rejected by the sim, not by the driver', async () => {
  const { driver } = live();
  const enemy = ownUnits(driver, 1)[0];
  driver.queue({ type: 'move', unit: enemy.id, x: 1, y: 1 });
  const { events } = await driver.tick();
  const reject = events.find((e) => e.e === 'reject');
  assert.ok(reject);
  assert.equal(reject.player, 0);
  assert.equal(reject.reason, 'not-yours');
});

test('the human can play side 1', async () => {
  const { driver } = live({ human: 1 });
  assert.equal(driver.human, 1);
  assert.equal(driver.ai, 0);
  const worker = ownUnits(driver, 1)[0];
  driver.queue({ type: 'stop', unit: worker.id });
  const { commands } = await driver.tick();
  assert.equal(commands[1].length, 1);
  assert.equal(commands[0].length, 0);
  assert.equal(driver.log.players[1], 'human');
  assert.equal(driver.observe().you, 1);
  assert.equal(driver.observe(0).you, 0);
});

// ---- the AI ----

test('the real team bot plays the AI side: it gathers and trains within the first second', async () => {
  const { clock, driver } = live({ ai: BOT });
  const info = await driver.ready();
  assert.equal(info.ok, true);
  assert.equal(driver.aiName, driver.log.players[1]);
  driver.start();
  await clock.run(1000);
  assert.equal(driver.state.tick, 24);
  const aiCommands = driver.log.ticks.flatMap((t) => t.commands[1]);
  assert.ok(aiCommands.some((c) => c.type === 'gather'), 'the bot sent gather orders');
  assert.ok(aiCommands.some((c) => c.type === 'train'), 'the bot queued training');
  assert.equal(driver.log.ticks.filter((t) => t.commands[0].length).length, 0, 'the human side sent nothing');
  assert.equal(driver.clock.late, 0);
  assert.equal(driver.clock.errors, 0);
  driver.stop();
});

test('createPlayer is told the difficulty, and aiEvery makes the AI think only every N ticks', async () => {
  let told = null;
  const easy = live({ difficulty: 'easy', ai: ({ difficulty }) => ((told = difficulty), { name: 'e', act: () => [] }) });
  await easy.driver.ready();
  assert.equal(told, 'easy');
  assert.equal(easy.driver.difficulty, 'easy');
  assert.equal(easy.driver.aiEvery, 1, 'difficulty is the AI module\'s job, not a throttle');
  assert.equal(DIFFICULTY.easy, 1);
  const normal = live({ ai: ({ difficulty }) => ((told = difficulty), { name: 'n', act: () => [] }) });
  await normal.driver.ready();
  assert.equal(told, 'normal');

  let asked = 0;
  const { driver } = live({ aiEvery: 4, ai: scripted('counter', () => (asked++, [])) });
  for (let i = 0; i < 8; i++) await driver.tick();
  assert.equal(asked, 2);
  assert.equal(driver.aiEvery, 4);
  assert.equal(driver.log.timing.length, 8);
});

test('a reply slower than the think limit is late: its commands are discarded and a late event is logged', async () => {
  const { clock, driver } = live({
    thinkMs: 50,
    ai: scripted('slow', (obs) => {
      const mine = obs.units.filter((u) => u.owner === obs.you);
      if (obs.tick === 1) clock.jump(80); // thinking took 80 ms on this tick
      return [{ type: 'stop', unit: mine[0].id }];
    }),
  });
  const a = await driver.tick();
  assert.equal(a.commands[1].length, 1);
  assert.equal(a.late, false);
  const b = await driver.tick();
  assert.equal(b.late, true);
  assert.deepEqual(b.commands[1], []);
  assert.ok(b.events.some((e) => e.e === 'late' && e.player === 1));
  assert.equal(driver.log.timing[1][1], 80);
  assert.equal(driver.clock.late, 1);
  assert.equal(driver.clock.errors, 0, 'late is not a strike');
});

test('a throw, a non-array and an oversized reply are errors with empty commands; 50 strikes forfeit', async () => {
  let mode = 'throw';
  const { driver } = live({
    maxErrors: 50,
    maxCommandChars: 200,
    ai: scripted('bad', (obs) => {
      if (mode === 'throw') throw new Error('boom');
      if (mode === 'object') return { nope: true };
      if (mode === 'many') return Array.from({ length: 50 }, () => ({ type: 'stop', unit: 7 })); // long list, small commands: fine
      if (mode === 'big') return [{ type: 'stop', unit: 7, note: 'x'.repeat(300) }];
      if (mode === 'cycle') {
        const c = { type: 'stop', unit: 7 };
        c.self = c;
        return [c];
      }
      return [];
    }),
  });
  mode = 'many';
  const many = await driver.tick();
  assert.equal(many.commands[1].length, 50, 'a long list of small commands is not oversized (the sim caps at 100)');
  assert.ok(!many.events.some((e) => e.e === 'error'));
  const kinds = [];
  for (const m of ['throw', 'object', 'big', 'cycle']) {
    mode = m;
    const r = await driver.tick();
    const err = r.events.find((e) => e.e === 'error');
    assert.ok(err, m + ' gives an error event');
    assert.equal(err.player, 1);
    kinds.push(err.message);
    assert.deepEqual(r.commands[1], []);
  }
  assert.match(kinds[0], /boom/);
  assert.match(kinds[1], /not an array/);
  assert.match(kinds[2], /command 0 is \d+ characters of JSON, more than the 200 allowed/);
  assert.match(kinds[3], /not plain JSON/);
  assert.equal(driver.clock.errors, 4);

  mode = 'throw';
  const ended = [];
  driver.on('end', (r) => ended.push(r));
  while (!driver.result) await driver.tick();
  assert.equal(driver.clock.errors, 50);
  assert.equal(driver.result.reason, 'forfeit');
  assert.equal(driver.result.winner, 0, 'the human wins by forfeit');
  assert.equal(ended.length, 1);
  const last = driver.log.ticks.at(-1);
  assert.ok(last.events.some((e) => e.e === 'forfeit' && e.player === 1 && e.reason === 'errors'));
  assert.equal(driver.state.tick, 50, 'the forfeiting tick is not stepped');
  assert.deepEqual(validateLog(driver.log), []);
  assert.equal(driver.queue({ type: 'stop', unit: 3 }), false, 'no commands after the end');
  assert.equal(await driver.tick(), null);
});

test('an AI that never answers forfeits at the hard cut-off', async () => {
  const { clock, driver } = live({ hardMs: 1000, ai: scripted('hang', () => new Promise(() => {})) });
  driver.start();
  await clock.run(100);
  assert.equal(driver.state.tick, 0, 'the first tick waits for the reply');
  await clock.run(1000);
  assert.ok(driver.result, 'forfeited');
  assert.equal(driver.result.reason, 'forfeit');
  assert.equal(driver.result.winner, 0);
  assert.ok(driver.log.ticks[0].events.some((e) => e.e === 'forfeit' && e.reason === 'timeout'));
  assert.equal(driver.running, false);
  assert.deepEqual(validateLog(driver.log), []);
});

test('an AI module that fails to load forfeits at tick 0', async () => {
  const { driver } = live({ ai: new URL('../players/does-not-exist.mjs', import.meta.url).href });
  const info = await driver.ready();
  assert.equal(info.ok, false);
  assert.ok(driver.result);
  assert.equal(driver.result.reason, 'forfeit');
  assert.equal(driver.result.tick, 0);
  assert.equal(driver.result.winner, 0);
  assert.equal(driver.log.ticks.length, 1);
  assert.equal(driver.log.ticks[0].events[0].reason, 'load');
  assert.deepEqual(validateLog(driver.log), []);
  assert.equal(driver.start(), false);
});

test('ai accepts a module with createPlayer and a bare createPlayer function', async () => {
  const mod = { createPlayer: ({ side, seed, stats }) => ({ name: 'mod-' + side + '-' + seed + '-' + stats.match.unitCap, act: () => [] }) };
  const a = live({ ai: mod });
  await a.driver.ready();
  assert.equal(a.driver.aiName, 'mod-1-7-40');
  const b = live({ ai: mod.createPlayer });
  await b.driver.ready();
  assert.equal(b.driver.aiName, 'mod-1-7-40');
});

test('the AI gets a fresh observation each tick that it cannot use to change the state', async () => {
  const { driver } = live({
    ai: scripted('vandal', (obs) => {
      obs.shards[0] = 0;
      obs.units.length = 0;
      obs.units.push({ id: 999 });
      return [];
    }),
  });
  await driver.tick();
  assert.equal(driver.state.shards[0], STATS.match.startShards);
  assert.equal(driver.state.units.length, 8);
});

// ---- match end, resign ----

test('the match ends when a Core dies: end fires once, the log is finished and valid', async () => {
  const { driver } = live({ maxTicks: 60 });
  const ends = [];
  driver.on('end', (r) => ends.push(r));
  const enemyCore = driver.state.structures.find((s) => s.kind === 'core' && s.owner === 1);
  enemyCore.hp = 3; // nearly dead already
  const worker = ownUnits(driver, 0)[0];
  worker.x = enemyCore.x - 1;
  worker.y = enemyCore.y;
  driver.queue({ type: 'attack', unit: worker.id, target: enemyCore.id });
  const r1 = await driver.tick();
  const r2 = r1.result ? r1 : await driver.tick();
  assert.ok(r2.result, 'the second tick ends it');
  assert.equal(r2.result.reason, 'core');
  assert.equal(r2.result.winner, 0);
  assert.equal(ends.length, 1);
  assert.deepEqual(driver.log.result, r2.result);
  assert.deepEqual(validateLog(driver.log), []);
  assert.equal(await driver.tick(), null);
});

test('the match ends on the tick limit by value', async () => {
  const { clock, driver } = live({ maxTicks: 10 });
  driver.start();
  await clock.run(2000);
  assert.ok(driver.result);
  assert.equal(driver.result.reason, 'timeout');
  assert.equal(driver.result.tick, 10);
  assert.equal(driver.state.tick, 10);
  assert.equal(driver.running, false);
  assert.equal(clock.pendingTimers(), 0, 'no timer left behind');
});

test('resign gives the AI the win by forfeit and finishes the log', async () => {
  const { clock, driver } = live();
  driver.start();
  await clock.run(200);
  const r = driver.resign();
  assert.equal(r.reason, 'forfeit');
  assert.equal(r.winner, 1);
  assert.equal(driver.running, false);
  assert.ok(driver.log.ticks.at(-1).events.some((e) => e.e === 'forfeit' && e.player === 0 && e.reason === 'quit'));
  assert.deepEqual(validateLog(driver.log), []);
  assert.equal(driver.resign(), r, 'resigning twice changes nothing');
});

test('resign while the AI is still thinking does not step or log that tick (haiku\'s catch)', async () => {
  const { clock, driver } = live({ ai: scripted('slow', () => new Promise((r) => clock.setTimer(() => r([]), 20))) });
  const ticks = [];
  driver.on('tick', (p) => ticks.push(p.tick));
  driver.start();
  await clock.advance(TICK_MS); // tick 0 is now waiting on the AI
  assert.equal(driver.state.tick, 0);
  const r = driver.resign();
  assert.equal(r.reason, 'forfeit');
  await clock.run(500); // the AI's reply arrives into a finished match
  assert.equal(driver.state.tick, 0, 'the in-flight tick was not stepped');
  assert.equal(driver.log.ticks.length, 1, 'only the forfeit entry');
  assert.equal(driver.log.ticks[0].events[0].e, 'forfeit');
  assert.deepEqual(driver.log.result, r);
  assert.deepEqual(ticks, [], 'no tick event after the end');
  assert.deepEqual(validateLog(driver.log), []);
});

test('a forfeit tick fires a tick event carrying the result before the end event', async () => {
  const { driver } = live({ maxErrors: 1, ai: scripted('bad', () => { throw new Error('x'); }) });
  const order = [];
  driver.on('tick', (p) => order.push(['tick', p.tick, p.result?.reason ?? null]));
  driver.on('end', (r) => order.push(['end', r.tick, r.reason]));
  await driver.tick();
  assert.deepEqual(order, [['tick', 0, 'forfeit'], ['end', 0, 'forfeit']]);
});

test('a sim failure stops the clock and reports through clock.failure and the error listener, without crashing', async () => {
  const { clock, driver } = live();
  const quiet = console.error;
  console.error = () => {};
  try {
    const errors = [];
    driver.on('error', (m) => errors.push(m));
    driver.start();
    await clock.run(100);
    assert.ok(driver.state.tick >= 2);
    driver.state.units = null; // a corrupted state makes step throw
    await clock.run(200);
    assert.equal(driver.running, false, 'the clock stopped');
    assert.equal(typeof driver.clock.failure, 'string');
    assert.equal(errors.length, 1);
    assert.equal(errors[0], driver.clock.failure);
    assert.equal(driver.result, null, 'no result was invented');
  } finally {
    console.error = quiet;
  }
});

test('a listener that throws does not stop the match', async () => {
  const { driver } = live();
  const quiet = console.error;
  console.error = () => {};
  try {
    driver.on('tick', () => {
      throw new Error('ui bug');
    });
    let seen = 0;
    driver.on('tick', () => seen++);
    await driver.tick();
    await driver.tick();
    assert.equal(seen, 2);
    assert.equal(driver.state.tick, 2);
  } finally {
    console.error = quiet;
  }
});

// ---- determinism and replay ----

async function playScripted(seed, ticks) {
  const { driver } = live({ seed, ai: BOT, maxTicks: ticks });
  await driver.ready();
  const core = driver.state.structures.find((s) => s.kind === 'core' && s.owner === 0);
  let n = 0;
  driver.on('tick', ({ tick }) => {
    n += 1;
    const mine = driver.state.units.filter((u) => u.owner === 0);
    if (tick === 0) for (const u of mine) driver.queue({ type: 'gather', unit: u.id, x: 7, y: 2 });
    if (tick % 7 === 3) driver.queue({ type: 'train', building: core.id, kind: 'worker' });
    if (tick === 40 && mine[0]) driver.queue({ type: 'build', unit: mine[0].id, kind: 'forge', x: 6, y: 6 });
  });
  while (!driver.result) await driver.tick();
  assert.equal(n, ticks);
  return driver;
}

test('same seed and commands give the same game: two live runs produce byte-identical logs', async () => {
  const a = await playScripted(11, 120);
  const b = await playScripted(11, 120);
  assert.ok(a.log.ticks.some((t) => t.commands[0].length && t.commands[1].length), 'both sides sent commands');
  assert.equal(JSON.stringify(comparable(a.log)), JSON.stringify(comparable(b.log)));
  assert.deepEqual(validateLog(a.log), []);
});

test('rerun(log) replays a live game from its command log and reaches the same state', async () => {
  const played = await playScripted(5, 150);
  const again = rerun(played.log, { maxTicks: 150 });
  assert.equal(again.ticks.length, played.log.ticks.length);
  for (let i = 0; i < again.ticks.length; i++) {
    assert.deepEqual(again.ticks[i].events, simEvents(played.log.ticks[i].events), 'tick ' + i + ' events match');
  }
  const strip = (s) => JSON.stringify({ tick: s.tick, shards: s.shards, units: s.units, structures: s.structures, crystals: s.crystals, result: s.result });
  assert.equal(strip(again.state), strip(played.state));
  assert.deepEqual(again.state.result, played.result);
});

test('rerun reproduces a live game that ran past the stats table 2000-tick limit', async () => {
  const limit = STATS.match.maxTicks + 100;
  const { driver } = live({ seed: 3, maxTicks: limit });
  while (!driver.result) await driver.tick();
  assert.equal(driver.result.reason, 'timeout');
  assert.equal(driver.result.tick, limit);
  const again = rerun(driver.log);
  assert.equal(again.ticks.length, limit, 'the replay does not stop at 2000');
  assert.deepEqual(again.state.result, driver.result);
});

test('defaults follow the stats table', () => {
  assert.equal(DEFAULTS.tps, 24);
  assert.equal(DEFAULTS.thinkMs, STATS.referee.thinkMs);
  assert.equal(DEFAULTS.hardMs, STATS.referee.hardMs);
  assert.equal(DEFAULTS.maxErrors, STATS.referee.throwLimit);
  assert.equal(DEFAULTS.maxCommandChars, STATS.referee.commandChars);
  assert.equal(DEFAULTS.maxCommandsPerTick, STATS.match.maxCommandsPerTick);
});

test('peace period: by default the AI is not asked to act for the first 3 minutes; aiStartTick: 0 lifts it', async () => {
  let asked = 0;
  const counting = scripted('counter', () => { asked++; return []; });
  const { driver } = live({ ai: counting, aiStartTick: undefined });
  assert.equal(driver.aiStartTick, 24 * 180);
  for (let i = 0; i < 50; i++) await driver.tick();
  assert.equal(asked, 0);
  const free = live({ ai: counting, aiStartTick: 0 }).driver;
  await free.tick();
  assert.equal(asked, 1);
});
