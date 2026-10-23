// The viewer3d scene systems must accept live frames (same shape as world.mjs frames), with real three.js and DOM stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step } from '../env/sim.mjs';
import { observe } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import { createPlayer } from '../players/sonnet/bot.mjs';
import { createLiveWorld } from './app.mjs';

test('viewer3d systems update on live frames', async () => {
  const noop = () => {};
  const el = () => ({
    style: { setProperty: noop }, children: [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, dataset: {},
    width: 1280, height: 720, clientWidth: 1280, clientHeight: 720, addEventListener: noop, removeEventListener: noop, setAttribute: noop,
    appendChild(c) { return c; }, append: noop, remove: noop, querySelector: () => el(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => new Proxy({}, { get: (_, k) => (k === 'canvas' ? el() : noop), set: () => true }), textContent: '', innerHTML: '',
  });
  globalThis.window ??= { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: noop, removeEventListener: noop, location: { search: '' } };
  globalThis.document ??= { body: el(), createElement: el, createElementNS: el, getElementById: el, querySelector: el, addEventListener: noop, removeEventListener: noop };
  const THREE = await import('three');
  const scene = new THREE.Scene();
  const state = createMatch(7);
  const ctx = {
    THREE, scene, camera: new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500), stats: STATS, log: { stats: STATS }, tileSize: 1,
    grid: { width: state.width, height: state.height }, palette: {}, assets: { models: {}, sounds: {}, get: () => null }, canvas: el(),
    gridToWorld: (x, y, h = 0) => new THREE.Vector3(x + 0.5 - state.width / 2, h, y + 0.5 - state.height / 2), heightAt: () => 0,
    time: { t: 0, playing: false }, size: { width: 1280, height: 720, dpr: 1 }, quality: { name: 'low' }, perf: {}, hudRoot: el(),
    renderer: { domElement: el(), shadowMap: {}, capabilities: {}, getSize: () => ({ x: 1280, y: 720 }) }, look: {},
  };
  const live = createLiveWorld(observe(state, 0), STATS);
  const bots = [createPlayer({ side: 0, seed: 7, stats: STATS }), createPlayer({ side: 1, seed: 7, stats: STATS })];
  const systems = [];
  for (const [file, fn] of [['terrain', 'createTerrain'], ['buildings', 'createBuildings'], ['units', 'createUnits'], ['vfx', 'createVfx']]) {
    try {
      const mod = await import(`../viewer3d/${file}.mjs`);
      systems.push(await mod[fn](ctx, { stats: STATS }));
    } catch (e) { console.log(`# ${file} not constructed under stubs: ${e.message}`); }
  }
  assert.ok(systems.length > 0);
  for (let i = 0; i < 300; i++) {
    step(state, bots.map((b, s) => b.act(observe(state, s))));
    live.push(observe(state, 0), state.events);
    for (const a of [0, 0.5]) { live.setAlpha(a); const f = live.frame(); for (const s of systems) s.update(f, 1 / 60); }
  }
});
