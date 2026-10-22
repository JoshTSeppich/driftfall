import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createWorld } from '../viewer3d/world.mjs';
import { createVfx, createPool, createRegistry, planEffects, sizeOf, isHeavy, mulberry32 } from '../viewer3d/vfx.mjs';

const U = (id, owner, kind, x, y, hp = 50) => ({ id, owner, kind, x, y, hp });
const S = (id, owner, kind, x, y, hp = 400) => ({ id, owner, kind, x, y, hp, complete: true });
const state = (units, structures = []) => ({ units, structures });

function regWith(prev, next, alpha = 0) {
  const r = createRegistry();
  r.track({ prev, next, alpha });
  return r;
}

test('sizeOf covers known and unknown kinds', () => {
  assert.ok(sizeOf({ kind: 'brute' }) > sizeOf({ kind: 'worker' }));
  assert.ok(sizeOf({ kind: 'core', structure: true }) > sizeOf({ kind: 'turret', structure: true }));
  const big = sizeOf({ kind: 'titan', hp: 900, structure: false }, { units: { titan: { hp: 900 } } });
  assert.ok(big > 1.2, 'an unknown heavy unit is sized from hp');
  assert.ok(isHeavy({ kind: 'titan', structure: false }, { units: { titan: { hp: 900 } } }));
  assert.ok(!isHeavy({ kind: 'grunt', structure: false }));
});

test('registry interpolates, and remembers entities that died', () => {
  const prev = state([U(1, 0, 'grunt', 2, 2), U(2, 1, 'grunt', 5, 5)]);
  const next = state([U(1, 0, 'grunt', 3, 2)]);
  const r = regWith(prev, next, 0.5);
  assert.equal(r.get(1).x, 2.5);
  assert.equal(r.get(2).alive, false);
  assert.equal(r.get(2).x, 5);
});

test('hits become a beam for ranged and a melee spark for adjacent, plus an impact', () => {
  const st = state([U(1, 0, 'lancer', 0, 0), U(2, 1, 'grunt', 3, 0), U(3, 1, 'grunt', 1, 0)], [S(9, 1, 'turret', 6, 6)]);
  const r = regWith(st, st);
  const fx = planEffects([{ e: 'hit', id: 2, by: 1, dmg: 10, hp: 50 }, { e: 'hit', id: 3, by: 1, dmg: 10, hp: 50 }], r);
  assert.deepEqual(fx.map((f) => f.t), ['beam', 'impact', 'melee', 'impact']);
  assert.equal(fx[0].style, 'laser');
  const tur = state([U(2, 1, 'grunt', 3, 0)], [S(9, 0, 'turret', 6, 0)]);
  const t = planEffects([{ e: 'hit', id: 2, by: 9, dmg: 12, hp: 20 }], regWith(tur, tur));
  assert.equal(t[0].style, 'bolt');
  assert.ok(t[1].delay > 0, 'impact waits for the bolt');
});

test('die, deliver, mine, done, spawn are all planned; unknown ids are ignored', () => {
  const prev = state([U(1, 0, 'worker', 3, 3), U(2, 1, 'brute', 8, 8)], [S(10, 0, 'core', 2, 3, 1000)]);
  const next = state([U(1, 0, 'worker', 3, 3)], [S(10, 0, 'core', 2, 3, 1000)]);
  const r = regWith(prev, next);
  const fx = planEffects([
    { e: 'die', id: 2 }, { e: 'deliver', id: 1, amount: 10, shards: 5 }, { e: 'mine', id: 1, x: 4, y: 4, amount: 10, left: 90 },
    { e: 'done', id: 10 }, { e: 'spawn', unit: U(5, 0, 'grunt', 1, 1) }, { e: 'die', id: 999 }, { e: 'hit', id: 999, by: 1, dmg: 1, hp: 1 },
  ], r);
  assert.deepEqual(fx.map((f) => f.t), ['explosion', 'deliver', 'mine', 'built', 'spawn']);
  assert.deepEqual(fx[1].to, { x: 2, y: 3 }, 'delivery flows to the own Core');
  assert.equal(fx[0].size, sizeOf({ kind: 'brute' }));
});

test('pool: spawn, age out, swap-remove, bounce on ground, capacity', () => {
  const p = createPool(3);
  for (let i = 0; i < 5; i++) p.spawn({ life: 0.5 + i, y: 5, grav: 10, bounce: 1, s0: 0.2 });
  assert.equal(p.count, 3);
  p.step(0.6);
  assert.equal(p.count, 2, 'the short-lived one is gone');
  for (let i = 0; i < 100; i++) p.step(0.05);
  assert.equal(p.count, 0);
  const b = createPool(1);
  b.spawn({ life: 5, y: 1, grav: 10, bounce: 1, s0: 0.2 });
  for (let i = 0; i < 100; i++) b.step(0.02);
  assert.ok(b.a.y[0] >= 0.1 - 1e-6, 'never sinks through the ground');
});

test('mulberry32 is deterministic', () => {
  const a = mulberry32(5), b = mulberry32(5);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

function fakeCtx() {
  return {
    THREE, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 500), tileSize: 1,
    renderer: { domElement: { height: 1080 } }, palette: {},
    gridToWorld: (x, y) => new THREE.Vector3(x + 0.5, 0, y + 0.5),
  };
}

test('full sample match: every tick runs, effects appear, scrubbing clears, dispose works', () => {
  const log = JSON.parse(readFileSync(new URL('../matches/sample-7.json', import.meta.url)));
  const world = createWorld(log);
  const ctx = fakeCtx();
  const vfx = createVfx(ctx, { stats: log.stats });
  let peak = { glow: 0, smoke: 0, debris: 0, beams: 0 };
  const n = Math.min(world.ticks ?? 600, 600);
  for (let t = 0; t < n; t += 0.25) {
    vfx.update(world.frame(t), 1 / 60);
    const s = vfx.stats();
    for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], s[k]);
  }
  assert.ok(peak.glow > 0, 'sparks from mining / delivering');
  assert.ok(Number.isFinite(ctx.scene.children[0].children[1].geometry.attributes.position.array[0]));
  vfx.update(world.frame(3), 1 / 60); // jump back
  assert.equal(vfx.stats().debris, 0);
  vfx.setSelection([3, 4]);
  vfx.update(world.frame(3.5), 1 / 60);
  vfx.dispose();
  assert.equal(ctx.scene.children.length, 0);
});

test('a synthetic fight makes beams, explosions and debris', () => {
  const ctx = fakeCtx();
  const vfx = createVfx(ctx, {});
  const a = state([U(1, 0, 'lancer', 0, 0), U(2, 1, 'brute', 3, 0)], [S(9, 1, 'forge', 8, 8)]);
  const b = state([U(1, 0, 'lancer', 0, 0)], [S(9, 1, 'forge', 8, 8)]);
  vfx.update({ tick: 1, alpha: 0, prev: a, next: a, events: [] }, 1 / 60);
  vfx.update({ tick: 2, alpha: 0, prev: a, next: b, events: [{ e: 'hit', id: 2, by: 1, dmg: 10, hp: 0 }, { e: 'die', id: 2 }] }, 1 / 60);
  const s = vfx.stats();
  assert.ok(s.beams >= 1 && s.debris > 0 && s.glow > 10 && s.rings >= 1, JSON.stringify(s));
  for (let i = 0; i < 400; i++) vfx.update({ tick: 2, alpha: 0, prev: b, next: b, events: [] }, 1 / 60);
  const e = vfx.stats();
  assert.deepEqual([e.glow, e.smoke, e.debris, e.beams, e.rings], [0, 0, 0, 0, 0], 'everything burns out');
});
