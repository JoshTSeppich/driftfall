// Tests for viewer3d/units.mjs (owner: fable). Pure logic first, then the real system driven with real Three.js in
// node: every roster kind builds, the sample match plays through, and a hand-made fight exercises walk, attack,
// hit flash, health bar, death and scrub-back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  createUnits, normalizeEvents, choosePose, yawBetween, turnToward, healthBarState, lerpTile, resolveKind,
  buildUnitModel, UNIT_SPECS, UNIT_KINDS_3D,
} from '../viewer3d/units.mjs';
import { createWorld } from '../viewer3d/world.mjs';
import { createTestState } from '../env/state.mjs';
import { step } from '../env/sim.mjs';
import { STATS, UNIT_KINDS } from '../env/stats.mjs';

const log = JSON.parse(readFileSync(new URL('../matches/sample-7.json', import.meta.url), 'utf8'));

function makeCtx(extra = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
  camera.position.set(10, 20, 20);
  camera.lookAt(0, 0, 0);
  const tileSize = 1;
  const gridToWorld = (x, y, h = 0, target = new THREE.Vector3()) => target.set((x + 0.5 - 16) * tileSize, h, (y + 0.5 - 16) * tileSize);
  return { THREE, scene, camera, gridToWorld, tileSize, stats: STATS, ...extra };
}

// ---------- pure logic ----------

test('normalizeEvents: raw log events, world.mjs enriched events and grouped objects all work', () => {
  const raw = normalizeEvents([{ e: 'hit', id: 5, by: 9, dmg: 8, hp: 32 }, { e: 'die', id: 5 }, { e: 'spawn', unit: { id: 12 } }, { e: 'mine', id: 3, amount: 10 }, { e: 'deliver', id: 3 }, { e: 'move', id: 3 }]);
  assert.equal(raw.hits.length, 1);
  assert.deepEqual(raw.deaths, [5]);
  assert.deepEqual(raw.spawns, [12]);
  assert.equal(raw.mines.length, 1);
  assert.equal(raw.delivers.length, 1);
  const enriched = normalizeEvents([{ type: 'hit', id: 5, by: 9 }, { type: 'die', id: 5 }]);
  assert.equal(enriched.hits.length, 1);
  assert.deepEqual(enriched.deaths, [5]);
  const grouped = normalizeEvents({ hits: [{ id: 1, by: 2 }], deaths: [{ id: 1 }, 7] });
  assert.equal(grouped.hits.length, 1);
  assert.deepEqual(grouped.deaths, [1, 7]);
  assert.deepEqual(normalizeEvents(null).hits, []);
});

test('choosePose: die beats attack beats walk; grace keeps slow walkers walking; workers mine', () => {
  const a = { id: 1, kind: 'grunt', x: 1, y: 1, order: null };
  const b = { ...a, x: 2 };
  assert.equal(choosePose({ id: 1, prev: a, next: undefined }), 'die');
  assert.equal(choosePose({ id: 1, prev: a, next: b, deaths: [1] }), 'die');
  assert.equal(choosePose({ id: 1, prev: a, next: b, hits: [{ by: 1, id: 2 }] }), 'attack');
  assert.equal(choosePose({ id: 1, prev: a, next: b }), 'walk');
  assert.equal(choosePose({ id: 1, prev: a, next: a }), 'idle');
  const ordered = { ...a, order: { type: 'move', x: 5, y: 5 } };
  assert.equal(choosePose({ id: 1, prev: ordered, next: ordered, tick: 10, lastMoveTick: 9, graceTicks: 1 }), 'walk');
  assert.equal(choosePose({ id: 1, prev: ordered, next: ordered, tick: 10, lastMoveTick: 7, graceTicks: 1 }), 'idle');
  const mining = { ...a, kind: 'worker', order: { type: 'gather', x: 7, y: 2, phase: 'mining', ticks: 3 } };
  assert.equal(choosePose({ id: 1, prev: mining, next: mining }), 'mine');
  assert.equal(choosePose({ id: 1, prev: a, next: a, mines: [{ id: 1 }] }), 'mine');
  assert.equal(choosePose({ id: 1, prev: undefined, next: b }), 'idle');
});

test('yawBetween and turnToward take the short way round', () => {
  assert.equal(yawBetween({ x: 0, z: 0 }, { x: 0, z: 1 }), 0);
  assert.ok(Math.abs(yawBetween({ x: 0, z: 0 }, { x: 1, z: 0 }) - Math.PI / 2) < 1e-9);
  assert.equal(yawBetween({ x: 2, z: 2 }, { x: 2, z: 2 }), null);
  const near = turnToward(0.1, 2 * Math.PI - 0.1, 10, 1);          // the short way is negative
  assert.ok(near < 0.1 && near > -0.2, `turned the long way: ${near}`);
  assert.ok(Math.abs(turnToward(0, 1, 2, 0.1) - 0.2) < 1e-9);      // rate-limited
});

test('lerpTile and healthBarState', () => {
  assert.deepEqual(lerpTile({ x: 0, y: 0 }, { x: 2, y: 4 }, 0.5), { x: 1, y: 2 });
  assert.deepEqual(lerpTile(undefined, { x: 2, y: 4 }, 0.5), { x: 2, y: 4 });
  assert.equal(healthBarState({ hp: 60, maxHp: 60 }).visible, false);         // hidden at full health
  assert.equal(healthBarState({ hp: 60, maxHp: 60, sinceHit: 0.2 }).visible, true);
  assert.equal(healthBarState({ hp: 60, maxHp: 60, sinceHit: 5 }).visible, false);
  assert.equal(healthBarState({ hp: 40, maxHp: 60 }).level, 'good');
  assert.equal(healthBarState({ hp: 30, maxHp: 60 }).level, 'warn');
  assert.equal(healthBarState({ hp: 10, maxHp: 60 }).level, 'bad');
  assert.ok(Math.abs(healthBarState({ hp: 15, maxHp: 60 }).ratio - 0.25) < 1e-9);
  assert.equal(healthBarState({ hp: 10, maxHp: 0 }).ratio, 1);               // unknown max: never a broken bar
});

test('resolveKind: agreed v3 names, earlier draft names and odd spellings all land on a model', () => {
  for (const k of UNIT_KINDS) assert.ok(UNIT_SPECS[resolveKind(k)], `env kind ${k} has no spec`);
  assert.equal(resolveKind('skyspike'), 'spiker');
  assert.equal(resolveKind('Bombard'), 'howler');
  assert.equal(resolveKind('gale'), 'skiff');
  assert.equal(resolveKind('ferry'), 'barge');
  assert.equal(resolveKind('lumen'), 'seer');
  assert.equal(resolveKind('hexer'), 'conduit');
  assert.equal(resolveKind('Sky Spike'), 'spiker');
  assert.equal(resolveKind('mystery'), 'mystery');
});

// ---------- models ----------

test('every roster kind builds an original model: a body, a team strip, shadows, feet on the ground, right size', () => {
  const kinds = [...UNIT_KINDS_3D, 'mystery'];
  for (const kind of kinds) {
    for (const owner of [0, 1]) {
      const r = buildUnitModel(THREE, kind, owner, null);
      assert.ok(r.group.isObject3D, `${kind}: no group`);
      assert.ok(r.parts.body, `${kind}: no body pivot`);
      assert.ok(r.parts.strips.length >= 1, `${kind}: no team glow strip`);
      let meshes = 0;
      r.group.traverse((o) => { if (o.isMesh) { meshes++; assert.ok(o.castShadow, `${kind}: a mesh without a shadow`); } });
      assert.ok(meshes >= 2 && meshes <= 14, `${kind}: ${meshes} meshes after baking, want 2..14 draw calls per unit`);
      const raw = buildUnitModel(THREE, kind, owner, null, undefined, { bake: false });
      let rawMeshes = 0;
      raw.group.traverse((o) => { if (o.isMesh) rawMeshes++; });
      assert.ok(rawMeshes >= 4, `${kind}: only ${rawMeshes} parts, that is a plain primitive`);
      assert.ok(meshes <= rawMeshes, `${kind}: baking added meshes (${rawMeshes} -> ${meshes})`);
      const box = new THREE.Box3().setFromObject(r.group);
      const size = box.getSize(new THREE.Vector3());
      const spec = UNIT_SPECS[resolveKind(kind)] ?? { size: 0.5, height: 0.8 };
      const floor = spec.altitude ? -spec.size / 2 : -0.08;            // air units are built around their centre
      assert.ok(box.min.y > floor, `${kind}: feet below the ground (${box.min.y.toFixed(2)})`);
      assert.ok(size.y <= spec.height * 1.25 + 0.05, `${kind}: taller (${size.y.toFixed(2)}) than its spec height ${spec.height}`);
      assert.ok(size.y >= spec.height * 0.5, `${kind}: much shorter (${size.y.toFixed(2)}) than its spec height ${spec.height}`);
      const foot = Math.max(size.x, size.z);
      const allow = (spec.shape === 'needle' || spec.shape === 'barrel' || spec.shape === 'trident') ? 1.5 : 1.25;
      assert.ok(foot <= spec.size * allow + 0.05, `${kind}: footprint ${foot.toFixed(2)} is wider than ${spec.size} x ${allow}`);
    }
  }
});

test('the four agreed kinds keep their shape words and parts', () => {
  const w = buildUnitModel(THREE, 'worker', 0, null);
  assert.ok(w.parts.carry && w.parts.carry.visible === false, 'Worker holds a hidden Shard until it carries');
  assert.equal(w.parts.arms.length, 2, 'Worker has two pincers');
  const g = buildUnitModel(THREE, 'grunt', 0, null);
  assert.equal(g.parts.legs.length, 2);
  assert.ok(g.parts.weapon, 'Grunt has a blade arm');
  const l = buildUnitModel(THREE, 'lancer', 1, null);
  assert.equal(l.parts.legs.length, 3, 'Lancer stands on a tripod');
  const lanceBox = new THREE.Box3().setFromObject(l.parts.weapon);
  const bodyBox = new THREE.Box3().setFromObject(l.group);
  assert.ok(lanceBox.max.z - lanceBox.min.z > (bodyBox.max.y - bodyBox.min.y) * 0.8, 'the lance is about as long as the body is tall or longer');
  const b = buildUnitModel(THREE, 'brute', 1, null);
  assert.equal(b.parts.legs.length, 2, 'Brute walks on two alternating tripods (six legs)');
  let bruteLegMeshes = 0;
  for (const l of b.parts.legs) l.traverse((o) => { if (o.isMesh) bruteLegMeshes++; });
  assert.ok(bruteLegMeshes <= 4, `six Brute legs bake into at most 4 meshes, got ${bruteLegMeshes}`);
  assert.equal(b.parts.arms.length, 2, 'Brute has two claws');
  const shade = buildUnitModel(THREE, 'shade', 0, null);
  let ghost = 0;
  shade.group.traverse((o) => { if (o.isMesh && o.material.transparent && o.material.opacity < 0.6) ghost++; });
  assert.ok(ghost >= 2, 'Shade is drawn at half opacity');
});

test('team colours come from ctx.palette when it is there, with sensible defaults when it is not', () => {
  const r0 = buildUnitModel(THREE, 'grunt', 0, null);
  const r1 = buildUnitModel(THREE, 'grunt', 1, null);
  assert.notEqual(r0.materials.body.color.getHex(), r1.materials.body.color.getHex());
  const palette = { team: [{ main: '#112233', light: '#aabbcc', dark: '#000000', strip: '#ff00ff' }, { main: '#445566', light: '#ddeeff', dark: '#000000', strip: '#00ff00' }], emissive: { strip: 3 } };
  const p0 = buildUnitModel(THREE, 'grunt', 0, palette);
  assert.equal(p0.materials.body.color.getHexString(), '112233');
  assert.equal(p0.materials.strip.emissive.getHexString(), 'ff00ff');
  assert.equal(p0.materials.strip.emissiveIntensity, 3);
});

// ---------- the system on the sample match ----------

test('sample match: units appear, move smoothly between ticks, carry Shards, and dispose cleanly', () => {
  const world = createWorld(log);
  const ctx = makeCtx();
  const units = createUnits(ctx, { stats: log.stats });
  const f0 = world.frame(0);
  units.update(f0, 1 / 60);
  assert.equal(units.count, f0.next.units.length);
  assert.equal(units.count, 8);
  // find a tick where some unit moves, then check the half-way position
  let t = 1;
  while (t < 200) {
    const f = world.frame(t);
    const moved = f.next.units.find((u) => { const p = f.prev.units.find((q) => q.id === u.id); return p && (p.x !== u.x || p.y !== u.y); });
    if (moved) {
      units.update(world.frame(t), 1 / 60);
      units.update(world.frame(t + 0.5), 1 / 60);
      const p = f.prev.units.find((q) => q.id === moved.id);
      const want = ctx.gridToWorld((p.x + moved.x) / 2, (p.y + moved.y) / 2);
      const got = units.positionOf(moved.id);
      assert.ok(got.distanceTo(want) < 1e-6, `unit ${moved.id} at ${got.toArray()} not half-way to ${want.toArray()}`);
      break;
    }
    t++;
  }
  assert.ok(t < 200, 'no unit moved in the first 200 ticks');
  // play on until a Worker carries Shards and check the Shard shows
  let carried = false;
  for (let tt = t; tt < 400 && !carried; tt += 0.5) {
    const f = world.frame(tt);
    units.update(f, 1 / 30);
    const c = f.next.units.find((u) => (u.carrying ?? 0) > 0);
    if (c) {
      const v = units._views.get(c.id);
      assert.ok(v.parts.carry.visible, 'carrying Worker shows its Shard');
      carried = true;
    }
  }
  assert.ok(carried, 'no Worker carried anything by tick 400');
  // a far seek keeps the count right (no ghosts, nothing missing)
  units.update(world.frame(1500), 1 / 60);
  units.update(world.frame(1500), 1 / 60);
  assert.equal(units.count, world.frame(1500).next.units.length);
  assert.ok(ctx.scene.children.some((c) => c.name === 'units'));
  units.dispose();
  assert.equal(units.count, 0);
  assert.ok(!ctx.scene.children.some((c) => c.name === 'units'));
});

test('sample match: a full play-through at 4 frames per tick stays cheap', () => {
  const world = createWorld(log);
  const ctx = makeCtx();
  const units = createUnits(ctx, { stats: log.stats });
  const t0 = performance.now();
  let frames = 0;
  for (let t = 0; t <= world.end; t += 0.25) { units.update(world.frame(t), 1 / 32); frames++; }
  const ms = performance.now() - t0;
  assert.ok(ms / frames < 1.0, `units.update averages ${(ms / frames).toFixed(3)} ms per frame, want under 1 ms on the CPU`);
  units.dispose();
});

// ---------- a hand-made fight: walk, attack, flash, health bar, death, scrub-back ----------

function fightFrames() {
  // Two Grunts of side 1 attack a side 0 Worker that stands still; a Lancer of side 0 shoots back.
  const state = createTestState({
    width: 12, height: 12, shards: [100, 100],
    units: [
      { id: 1, owner: 0, kind: 'worker', x: 2, y: 2 },
      { id: 2, owner: 0, kind: 'lancer', x: 1, y: 3 },
      { id: 3, owner: 1, kind: 'grunt', x: 6, y: 2 },
      { id: 4, owner: 1, kind: 'grunt', x: 6, y: 3 },
    ],
  });
  const states = [structuredClone(state)];
  const events = [];
  const cmds = [[{ type: 'attack', unit: 2, target: 3 }], [{ type: 'attack', unit: 3, target: 1 }, { type: 'attack', unit: 4, target: 1 }]];
  for (let i = 0; i < 24; i++) {
    const ev = step(state, i === 0 ? cmds : [[], []]);
    events.push(structuredClone(ev));
    states.push(structuredClone(state));
  }
  const frame = (t) => {
    const tick = Math.floor(t);
    const alpha = t - tick;
    return { tick, alpha, prev: states[tick], next: states[Math.min(tick + 1, states.length - 1)], events: events[tick] ?? [] };
  };
  return { states, events, frame };
}

test('fight: the Grunts walk facing the Worker, hit it (white flash, health bar), it dies with an animation', () => {
  const { states, events, frame } = fightFrames();
  const ctx = makeCtx();
  const units = createUnits(ctx, { stats: STATS });
  units.update(frame(0), 1 / 60);
  const grunt = units._views.get(3);
  const worker = units._views.get(1);
  assert.ok(grunt && worker);
  // walking: the Grunt moves left (toward -x), so after a few frames it faces -x (yaw ~ -PI/2) and its legs swing
  for (let t = 0; t < 2; t += 0.1) units.update(frame(t), 1 / 30);
  assert.ok(Math.abs(turnToward(grunt.yaw, -Math.PI / 2, 100, 1) - grunt.yaw) < 0.2, `Grunt yaw ${grunt.yaw.toFixed(2)} does not face its walk direction`);
  assert.ok(grunt.walkAmount > 0.5, 'Grunt is in its walk cycle');
  assert.notEqual(grunt.parts.legs[0].rotation.x, 0, 'legs swing while walking');
  // first hit on the Worker
  const hitTick = events.findIndex((evs) => evs.some((e) => e.e === 'hit' && e.id === 1));
  assert.ok(hitTick >= 0, 'the Worker gets hit');
  units.update(frame(hitTick + 0.05), 1 / 60);
  assert.ok(worker.flashing, 'the whole Worker flashes white on the hit');
  assert.ok(worker.meshes.every((o) => o.material === worker.materials.hit), 'every mesh uses the hit material while flashing');
  const attacker = units._views.get(events[hitTick].find((e) => e.e === 'hit' && e.id === 1).by);
  units.update(frame(hitTick + 0.3), 1 / 60);                                  // the lunge peaks at 0.3 of the tick
  assert.ok(attacker.parts.weapon.rotation.x < -0.8, `the attacking Grunt swings its blade (${attacker.parts.weapon.rotation.x.toFixed(2)})`);
  for (let i = 0; i < 20; i++) units.update(frame(hitTick + 0.3 + i * 0.02), 1 / 60);
  assert.ok(!worker.flashing, 'the flash ends');
  assert.ok(worker.meshes.every((o) => o.material !== worker.materials.hit), 'materials are restored after the flash');
  assert.ok(worker.bar.group.visible, 'the health bar shows once hurt');
  assert.ok(worker.bar.fill.scale.x < worker.bar.bg.scale.x * 0.9, 'the bar is partly drained');
  // death: the Worker is gone from some later state; its view lingers and animates, then is removed
  const dieTick = states.findIndex((s) => !s.units.some((u) => u.id === 1)) - 1;
  assert.ok(dieTick > hitTick, 'the Worker dies after being hit');
  units.update(frame(dieTick + 0.1), 1 / 60);
  assert.ok(worker.dying, 'death starts on the tick the Worker is removed');
  assert.ok(!worker.bar.group.visible, 'no health bar on a dying unit');
  units.update(frame(dieTick + 0.5), 0.1);
  assert.ok(worker.model.rotation.x > 0.1 && worker.model.position.y < 0, 'the Worker topples and sinks');
  units.update(frame(dieTick + 3), 0.1);          // playback has moved on two ticks; still mid-animation
  assert.ok(units._views.has(1), 'the dying Worker lingers while its animation plays');
  for (let i = 0; i < 12; i++) units.update(frame(dieTick + 3), 0.1);
  assert.ok(!units._views.has(1), 'the Worker is removed once the death animation ends');
  assert.equal(units.count, states[dieTick + 3].units.length);
  units.dispose();
});

test('fight: scrubbing back before a death brings the unit back whole; the Lancer recoils when it fires', () => {
  const { states, events, frame } = fightFrames();
  const ctx = makeCtx();
  const units = createUnits(ctx, { stats: STATS });
  const dieTick = states.findIndex((s) => !s.units.some((u) => u.id === 1)) - 1;
  units.update(frame(0), 1 / 60);
  units.update(frame(dieTick + 0.2), 1 / 60);
  assert.ok(units._views.get(1).dying);
  units.update(frame(1), 1 / 60);                  // scrub back
  const w = units._views.get(1);
  assert.ok(w && !w.dying, 'the Worker is alive again after scrubbing back');
  assert.ok(w.meshes.every((o) => !o.material.transparent || o.material.opacity >= 1), 'no leftover fade');
  const shot = events.findIndex((evs) => evs.some((e) => e.e === 'hit' && e.by === 2));
  if (shot >= 0) {
    units.update(frame(shot + 0.15), 1 / 60);
    const lancer = units._views.get(2);
    assert.ok(lancer.parts.weapon.position.z < 0.02, 'the lance recoils on firing');
  }
  units.dispose();
});

test('units are drawn at UNIT_SCALE so they read at TV distance; opts.scale overrides', async () => {
  const { UNIT_SCALE } = await import('../viewer3d/units.mjs');
  const { frame } = fightFrames();
  const a = createUnits(makeCtx(), {});
  a.update(frame(0), 1 / 60);
  assert.ok(UNIT_SCALE >= 1.2, 'bigger than the tile fraction, per Joshua');
  assert.ok(Math.abs(a._views.get(3).model.scale.x - UNIT_SCALE) < 1e-9);
  const box = new THREE.Box3().setFromObject(a._views.get(3).model);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.max(size.x, size.z) > 0.7, `a Grunt spans ${Math.max(size.x, size.z).toFixed(2)} of a tile, want over 0.7`);
  a.dispose();
  const b = createUnits(makeCtx(), { scale: 2 });
  b.update(frame(0), 1 / 60);
  assert.ok(Math.abs(b._views.get(3).model.scale.x - 2) < 1e-9);
  b.dispose();
});

test('ctx.assets models are ignored unless opts.useAssetModels is set (procedural art is the default)', () => {
  let asked = 0;
  const assets = { models: { get() { asked++; const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())); return g; } } };
  const { frame } = fightFrames();
  const a = createUnits(makeCtx({ assets }), {});
  a.update(frame(0), 1 / 60);
  assert.equal(asked, 0);
  a.dispose();
  const b = createUnits(makeCtx({ assets }), { useAssetModels: true });
  b.update(frame(0), 1 / 60);
  assert.equal(asked, 4);
  assert.ok(b._views.get(1).parts.strips.length === 1, 'a loaded model still gets a team glow ring');
  b.dispose();
});
