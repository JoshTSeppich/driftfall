// Engine pure logic (owner: fable): grid mapping, playback clock, fps meter, resize math, quality, palette defaults.
// The WebGL parts need a browser; these run in node with the real three.js module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGridToWorld, makeWorldToGrid, advanceTime, createFpsMeter, fitSize, pickQuality, defaultCameraPose,
  DEFAULT_PALETTE, VignetteShader, QUALITY,
} from '../viewer3d/engine.mjs';

test('gridToWorld centres the map on the origin, y up, grid y along +z', () => {
  const g = makeGridToWorld(32, 32, 1);
  const c = g(15.5, 15.5);
  assert.deepEqual([c.x, c.y, c.z], [0, 0, 0]);
  const tl = g(0, 0);
  assert.deepEqual([tl.x, tl.y, tl.z], [-15.5, 0, -15.5]);
  const br = g(31, 31, 2);
  assert.deepEqual([br.x, br.y, br.z], [15.5, 2, 15.5]);
});

test('gridToWorld scales by tileSize and writes into a given target', () => {
  const g = makeGridToWorld(4, 2, 3);
  const target = { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
  const out = g(0, 0, 1, target);
  assert.equal(out, target);
  assert.deepEqual([out.x, out.y, out.z], [-4.5, 1, -1.5]);
});

test('worldToGrid inverts gridToWorld', () => {
  const g = makeGridToWorld(32, 32, 2), w = makeWorldToGrid(32, 32, 2);
  for (const [x, y] of [[0, 0], [31, 31], [7, 2], [12.5, 19.25]]) {
    const back = w(g(x, y));
    assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9, `${x},${y} -> ${back.x},${back.y}`);
  }
});

test('advanceTime moves by ticksPerSecond * speed * dt and stops at the end when not looping', () => {
  const t = { t: 0, speed: 2, playing: true, duration: 10, loop: false, ticksPerSecond: 8 };
  advanceTime(t, 0.25);
  assert.equal(t.t, 4);
  advanceTime(t, 1);
  assert.equal(t.t, 10);
  assert.equal(t.playing, false);
  assert.equal(t.ended, true);
});

test('advanceTime wraps when looping and ignores paused or bad dt', () => {
  const t = { t: 9, speed: 1, playing: true, duration: 10, loop: true, ticksPerSecond: 8 };
  advanceTime(t, 0.25); // +2 -> 11 -> wraps to 1
  assert.equal(t.t, 1);
  assert.equal(t.playing, true);
  t.playing = false;
  advanceTime(t, 1);
  assert.equal(t.t, 1);
  t.playing = true;
  advanceTime(t, NaN);
  advanceTime(t, -1);
  assert.equal(t.t, 1);
});

test('fps meter averages over its window', () => {
  const m = createFpsMeter(0.5);
  for (let i = 0; i < 40; i++) m.tick(1 / 60);
  assert.ok(Math.abs(m.fps - 60) < 0.5, `fps ${m.fps}`);
  assert.ok(Math.abs(m.ms - 16.67) < 0.2, `ms ${m.ms}`);
});

test('fitSize caps the device pixel ratio and never returns zero', () => {
  assert.deepEqual(fitSize(1920, 1080, 3, 2), { width: 1920, height: 1080, dpr: 2, pixelWidth: 3840, pixelHeight: 2160 });
  assert.deepEqual(fitSize(0, 0, 1, 2), { width: 1, height: 1, dpr: 1, pixelWidth: 1, pixelHeight: 1 });
  assert.equal(fitSize(100, 100, undefined, 2).dpr, 1);
  assert.equal(fitSize(100, 100, 2, 1).dpr, 1);
});

test('pickQuality falls back to high and keeps every tier complete', () => {
  assert.equal(pickQuality('nonsense').name, 'high');
  assert.equal(pickQuality('low').shadows, false);
  for (const tier of Object.values(QUALITY)) {
    for (const k of ['dprCap', 'shadowMapSize', 'shadows', 'bloom', 'bloomScale']) assert.ok(k in tier, k);
  }
});

test('default camera pose is a tilted three-quarter view that can see the whole map', () => {
  const p = defaultCameraPose(32, 32, 1);
  assert.ok(p.position.y > 0 && p.position.z > 0, 'above and in front');
  assert.ok(p.far > 32 * 1.5 && p.near > 0 && p.near < 1);
  assert.ok(p.fov > 30 && p.fov < 60);
});

test('default palette has both team colours and the shader has its uniforms', () => {
  assert.equal(DEFAULT_PALETTE.teams.length, 2);
  assert.equal(DEFAULT_PALETTE.teams[0], 0x33e0ff);
  assert.equal(DEFAULT_PALETTE.teams[1], 0xffb13b);
  for (const k of ['tDiffuse', 'strength', 'softness', 'aspect']) assert.ok(k in VignetteShader.uniforms, k);
  assert.match(VignetteShader.fragmentShader, /gl_FragColor/);
});
