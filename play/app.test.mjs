import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step } from '../env/sim.mjs';
import { observe } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import { createWorld } from '../viewer3d/world.mjs';
import { createPlayer } from '../players/sonnet/bot.mjs';
import { createLiveMatch } from '../env/live.mjs';
import * as sampleBot from '../players/sample-player.mjs';
import { createLiveWorld, createCameraRig, TICKS_PER_SECOND } from './app.mjs';
import { createInput } from './input.mjs';

// The same wiring startGame() does: the driver's tick event feeds the live world and the input controller, whose
// commands are queued for the next tick.
test('driver + input + live world: mine, build a Forge, train, with no rejected command', async () => {
  assert.equal(TICKS_PER_SECOND, 24);
  const driver = createLiveMatch({ seed: 7, human: 0, ai: sampleBot, maxTicks: 3000 });
  const input = createInput({ side: 0, stats: STATS });
  const live = createLiveWorld(observe(driver.state, 0), STATS);
  const project = (x, y) => ({ sx: x * 10, sy: y * 10 });
  let rejects = 0, trained = 0, ticks = 0;
  driver.on('tick', ({ events }) => {
    const snap = observe(driver.state, 0);
    live.push(snap, events);
    ticks++;
    for (const ev of events) {
      if (ev.e === 'reject' && ev.player === 0) rejects++;
      if (ev.e === 'spawn' && ev.unit?.kind === 'grunt' && ev.unit.owner === 0) trained++;
    }
    if (ticks === 3) {
      input.boxSelect(snap, project, { x0: 0, y0: 0, x1: 9999, y1: 9999 });
      input.rightClick(snap, { x: snap.crystals[0].x, y: snap.crystals[0].y });
    }
    if (ticks === 30) {
      driver.state.shards[0] += 300;
      input.ui.selection = [snap.units.find((u) => u.owner === 0).id];
      input.key(snap, 'f');
      const core = snap.structures.find((s) => s.owner === 0 && s.kind === 'core');
      const t = [[2, 2], [-2, 2], [2, -2], [-2, -2], [3, 0], [0, 3]].map(([dx, dy]) => ({ x: core.x + dx, y: core.y + dy })).find((p) => input.placeCheck(snap, 'forge', p.x, p.y).ok);
      input.modeClick(snap, t);
    }
    if (ticks > 100 && ticks % 10 === 0) {
      const forge = snap.structures.find((s) => s.owner === 0 && s.kind === 'forge' && s.complete);
      if (forge) { input.ui.selection = [forge.id]; input.key(snap, 'g'); }
    }
    driver.queue(input.tick(snap));
  });
  await driver.ready();
  for (let i = 0; i < 300; i++) await driver.tick();
  assert.equal(rejects, 0);
  assert.ok(trained > 0, 'grunts trained');
  assert.equal(live.frame().tick, driver.state.tick - 1);
});

test('camera rig: edge scroll, arrows, clamp, zoom limits', () => {
  const rig = createCameraRig(32, 32, { x: 16, y: 16 });
  rig.size = { width: 1000, height: 600 };
  rig.mouse = { x: 999, y: 300 };
  rig.update(1);
  assert.ok(rig.x > 16 && rig.y === 16);
  rig.mouse = null; rig.keys.add('ArrowUp'); rig.update(100);
  assert.equal(rig.y, 0);
  rig.zoomBy(0.01); assert.equal(rig.zoom, 12);
  rig.zoomBy(100); assert.equal(rig.zoom, 40);
});

// A bot on each side, recorded through the live world; the live frames must have the keys world.mjs frames have.
test('live world frames match viewer3d/world.mjs on the same match', () => {
  const state = createMatch(7);
  const bots = [createPlayer({ side: 0, seed: 7, stats: STATS }), createPlayer({ side: 1, seed: 7, stats: STATS })];
  const live = createLiveWorld(observe(state, 0), STATS);
  const log = { format: 'driftfall-log', seed: 7, stats: STATS, players: ['a', 'b'], initial: observe(state, 0), ticks: [] };
  for (let i = 0; i < 400; i++) {
    const cmds = bots.map((b, s) => b.act(observe(state, s)));
    step(state, cmds);
    live.push(observe(state, 0), state.events);
    log.ticks.push({ tick: state.tick, commands: cmds, events: state.events });
  }
  live.setAlpha(0.5);
  const f = live.frame();
  assert.equal(f.tick, 399);
  for (const k of ['tick', 'alpha', 'prev', 'next', 'events', 'groups', 'units', 'structures', 'dying']) assert.ok(k in f, k);
  const u = f.units[0];
  for (const k of ['x', 'y', 'hpFrac', 'facing', 'moving', 'attacking', 'hurt', 'born', 'dying', 'maxHp']) assert.ok(k in u, `unit.${k}`);
  assert.ok(f.structures.every((s) => typeof s.progressFrac === 'number'));
  assert.ok(f.units.every((x) => x.maxHp > 0));
  assert.ok(f.units.length > 0 && f.units.length === state.units.length);
});

test('a human-style session against the bot runs 1500 ticks without a rejected command', () => {
  const state = createMatch(7);
  state.maxTicks = 5000;
  const bot = createPlayer({ side: 1, seed: 7, stats: STATS });
  const input = createInput({ side: 0, stats: STATS });
  const project = (x, y) => ({ sx: x * 10, sy: y * 10 });
  const live = createLiveWorld(observe(state, 0), STATS);
  let rejects = 0, trained = 0;
  for (let i = 0; i < 1500; i++) {
    const o = observe(state, 0);
    if (i === 5) {
      input.boxSelect(o, project, { x0: 0, y0: 0, x1: 9999, y1: 9999 });
      input.rightClick(o, { x: o.crystals[0].x, y: o.crystals[0].y });
    }
    if (i === 60) {
      input.ui.selection = [o.units.find((u) => u.owner === 0).id];
      state.shards[0] += 300;
      input.key(o, 'f');
      const core = o.structures.find((s) => s.owner === 0 && s.kind === 'core');
      const t = [[2, 2], [-2, 2], [2, -2], [-2, -2], [3, 0], [0, 3]].map(([dx, dy]) => ({ x: core.x + dx, y: core.y + dy })).find((p) => input.placeCheck(o, 'forge', p.x, p.y).ok);
      input.modeClick(o, t);
    }
    if (i > 60 && i % 10 === 0) {
      const forge = o.structures.find((s) => s.owner === 0 && s.kind === 'forge' && s.complete);
      if (forge) { input.ui.selection = [forge.id]; input.key(o, 'g'); }
    }
    step(state, [input.tick(o), bot.act(observe(state, 1))]);
    for (const ev of state.events) {
      if (ev.e === 'reject' && ev.player === 0) rejects++;
      if (ev.e === 'spawn' && ev.unit?.kind === 'grunt' && ev.unit.owner === 0) trained++;
    }
    const snap = observe(state, 0);
    live.push(snap, state.events);
    input.noteEvents(snap, state.events);
    if (state.result) break;
  }
  assert.equal(rejects, 0, 'the client never sends an illegal command in this scenario');
  assert.ok(trained > 0, 'the human side trained grunts');
});
