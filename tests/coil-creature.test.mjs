// coil-creature: the Coil Engine rig (engine/coil/creature.mjs + specs.mjs). Owner: fable.
// Headless, deterministic, no Three.js. Checks the things Joshua would notice: no sliding, weight, action poses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCreature } from '../engine/coil/creature.mjs';
import { SPEC_IDS, KIND_TO_SPEC, makeSpec } from '../engine/coil/specs.mjs';
import { createInterpolator } from '../engine/coil/interpolate.mjs';

const close = (a, b, e, m) => assert.ok(Math.abs(a - b) <= e, `${m ?? ''} ${a} vs ${b} (±${e})`);
const finiteDeep = (o, path = '') => {
  if (typeof o === 'number') assert.ok(Number.isFinite(o), `non-finite at ${path}`);
  else if (o && typeof o === 'object') for (const k of Object.keys(o)) if (k !== 'events') finiteDeep(o[k], `${path}.${k}`);
};

// Run a creature along a straight line at `speed` for `seconds`; returns per-frame root samples.
function run(id, { speed = 2.2, seconds = 4, dt = 1 / 60, action = 'move', opts } = {}) {
  const c = createCreature(id, opts), frames = [];
  let x = 0, z = 0, prev = null;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    z += speed * dt;
    const j = c.update(dt, { x, z, heading: 0 }, { action });
    const r = j.root;
    if (prev) frames.push({ vx: (r.x - prev.x) / dt, vz: (r.z - prev.z) / dt, planted: j.planted, pl: prev.planted, y: r.y, sy: r.sy, ev: j.events.map(e => e.type) });
    prev = { x: r.x, z: r.z, planted: j.planted };
  }
  return { c, frames, z };
}

test('every spec builds and survives 600 hostile frames with finite output', () => {
  assert.ok(SPEC_IDS.length >= 10);
  for (const id of SPEC_IDS) {
    const c = createCreature(id, { seed: 3 });
    let s = 12345, x = 0, z = 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 600; i++) {
      const dt = [1 / 24, 1 / 60, 1 / 144, 0.5, 0, 5][Math.floor(rnd() * 6)];
      x += (rnd() - 0.5) * 0.2; z += rnd() * 0.15;
      const action = i % 97 === 96 ? 'spawn' : ['idle', 'move', 'attack', 'gather', 'deliver', 'hit', 'siege'][Math.floor(rnd() * 7)];
      const j = c.update(dt, { x, z, aim: { x: 5, z: 5 } }, { action });
      finiteDeep(j, id);
    }
  }
  assert.equal(KIND_TO_SPEC.worker, 'crumb');
  for (const id of Object.values(KIND_TO_SPEC)) assert.ok(SPEC_IDS.includes(id), id);
  assert.throws(() => createCreature('nope'));
});

test('deterministic: same inputs, same joints', () => {
  const a = run('popper', { seed: 1, opts: { seed: 9 } }), b = run('popper', { opts: { seed: 9 } });
  assert.deepEqual(a.frames, b.frames);
});

test('hopping creatures plant their base: no sliding while planted, average speed matches the path', () => {
  for (const id of ['crumb', 'popper', 'four-slice']) {
    const { frames } = run(id, { speed: 1.2, seconds: 5 });
    let planted = 0, bad = 0, sum = 0;
    for (const f of frames) {
      sum += f.vz;
      if (f.planted && f.pl) { planted++; if (Math.abs(f.vx) + Math.abs(f.vz) > 0.08) bad++; }
    }
    assert.ok(planted > 20, `${id} has planted frames (${planted})`);
    assert.ok(bad <= 2, `${id} slid in ${bad} planted frames`);
    close(sum / frames.length, 1.2, 0.12, `${id} average speed`);
  }
});

test('hops leave the ground and the body squashes on landing and stretches on take-off', () => {
  const { frames } = run('crumb', { speed: 2.2, seconds: 3 });
  assert.ok(Math.max(...frames.map(f => f.y)) > 0.1, 'airborne');
  assert.ok(Math.min(...frames.map(f => f.y)) >= -1e-9, 'never below ground');
  assert.ok(Math.min(...frames.map(f => f.sy)) < 0.95, 'squash');
  assert.ok(Math.max(...frames.map(f => f.sy)) > 1.02, 'stretch');
  const types = frames.flatMap(f => f.ev);
  assert.ok(types.includes('land') && types.includes('takeoff'));
});

test('the Four-Slice lands with a thump, the Crumb does not', () => {
  assert.ok(run('four-slice', { speed: 1.2 }).frames.some(f => f.ev.includes('thump')));
  assert.ok(!run('crumb', { speed: 1.2 }).frames.some(f => f.ev.includes('thump')));
});

test('stopping: the hop finishes, the body lands on the sim position and rests planted', () => {
  const c = createCreature('crumb');
  let z = 0;
  for (let i = 0; i < 90; i++) { z += 2.2 / 60; c.update(1 / 60, { x: 0, z, heading: 0 }, { action: 'move' }); }
  let j;
  for (let i = 0; i < 90; i++) j = c.update(1 / 60, { x: 0, z, heading: 0 }, { action: 'idle' });
  close(j.root.z, z, 1e-6); close(j.root.x, 0, 1e-6); assert.equal(j.planted, true);
  assert.ok(j.root.y < 0.05);
});

test('frame-rate independence: 24, 60 and 144 fps end at nearly the same pose', () => {
  const ends = [24, 60, 144].map(fps => { const { c } = run('popper', { speed: 2, seconds: 3, dt: 1 / fps }); const r = c.joints().root; return r; });
  for (const r of ends.slice(1)) { close(r.z, ends[0].z, 0.35); close(r.yaw, ends[0].yaw, 0.05); }
});

test('bagel rolls: spin follows distance, it stays on the ground', () => {
  const { c, frames } = run('bagel', { speed: 3, seconds: 2 });
  assert.ok(c.joints().root.spin > 10);
  assert.ok(Math.max(...frames.map(f => f.y)) < 0.01);
});

test('flying units hover above the ground and bob', () => {
  const { frames } = run('flying-toast', { speed: 2, seconds: 3 });
  const ys = frames.map(f => f.y);
  assert.ok(Math.min(...ys) > 0.9 && Math.max(...ys) - Math.min(...ys) > 0.05);
  assert.ok(frames.every(f => !f.planted));
});

test('banks into turns and leans into acceleration', () => {
  const c = createCreature('bagel');
  let x = 0, z = 0, a = 0, maxRoll = 0;
  for (let i = 0; i < 120; i++) { a += 0.03; x += Math.sin(a) * 3 / 60; z += Math.cos(a) * 3 / 60; maxRoll = Math.max(maxRoll, Math.abs(c.update(1 / 60, { x, z }, { action: 'move' }).root.roll)); }
  assert.ok(maxRoll > 0.05, `roll ${maxRoll}`);
  const k = createCreature('popper'); let zz = 0, minPitch = 0, maxPitch = 0;
  for (let i = 0; i < 40; i++) { zz += Math.min(i, 20) * 0.01; const p = k.update(1 / 60, { x: 0, z: zz, heading: 0 }, { action: 'move' }).root.pitch; maxPitch = Math.max(maxPitch, p); minPitch = Math.min(minPitch, p); }
  assert.ok(maxPitch > 0.02, 'tips forward while speeding up');
});

test('turning left (toward +x) rolls the body toward the turn (negative roll, +x side down)', () => {
  const c = createCreature('bagel'); let x = 0, z = 0, a = 0, sum = 0;
  for (let i = 0; i < 90; i++) { a += 0.03; x += Math.sin(a) * 3 / 60; z += Math.cos(a) * 3 / 60; sum += c.update(1 / 60, { x, z }, { action: 'move' }).root.roll; }
  assert.ok(sum < 0, `sum ${sum}`);
});

test('Popper attack: windup dip, toast snaps up, one strike event per cycle, then back to rest', () => {
  const c = createCreature('popper');
  let strikes = 0, peak = 0, dip = 0, t = 0;
  for (; t < 2.3; t += 1 / 60) {
    const j = c.update(1 / 60, { x: 0, z: 0, aim: { x: 3, z: 0 } }, { action: 'attack' });
    strikes += j.events.filter(e => e.type === 'strike').length; peak = Math.max(peak, j.parts.toast.y); dip = Math.min(dip, j.parts.toast.y);
    if (strikes === 1 && t < 0.3) assert.ok(t >= 0.08, 'strike not before windup');
  }
  assert.equal(strikes, 3, 'strikes in 2.3 s at a 1.1 s period (t=0.09, 1.19, 2.29)');
  assert.ok(peak > 0.6 && dip < -0.03, `peak ${peak} dip ${dip}`);
  let j; for (let i = 0; i < 120; i++) j = c.update(1 / 60, { x: 0, z: 0 }, { action: 'idle' });
  close(j.parts.toast.y, 0, 0.02);
});

test('whole-body aim: a stationary attacker turns to face its target', () => {
  const c = createCreature('zapper'); let j;
  for (let i = 0; i < 60; i++) j = c.update(1 / 60, { x: 0, z: 0, aim: { x: 5, z: 0 } }, { action: 'attack' });
  close(j.root.yaw, Math.PI / 2, 0.05);
});

test('Zapper: coil heats up before it fires, fires once per cycle, then cools', () => {
  const c = createCreature('zapper'); let fired = -1, glowAtFire = 0, peak = 0;
  for (let t = 0; t < 1.0; t += 1 / 120) {
    const j = c.update(1 / 120, { x: 0, z: 0, aim: { x: 5, z: 0 } }, { action: 'attack' });
    peak = Math.max(peak, j.parts.coil.glow);
    if (fired < 0 && j.events.some(e => e.type === 'fire')) { fired = t; glowAtFire = j.parts.coil.glow; }
  }
  assert.ok(fired >= 0.19 && fired < 0.3, `fires at ${fired}`);
  assert.ok(glowAtFire > 0.7 && peak > 0.9, `hot before the shot: ${glowAtFire}/${peak}`);
});

test('Flak Popper leans back to launch; Four-Slice and Popper do not', () => {
  const lean = id => { const c = createCreature(id); let min = 0; for (let i = 0; i < 60; i++) min = Math.min(min, c.update(1 / 60, { x: 0, z: 0, aim: { x: 0, z: 5 } }, { action: 'attack' }).root.pitch); return min; };
  assert.ok(lean('flak-popper') < -0.25 && lean('four-slice') > -0.2);
});

test('gather heats the body and loads the slots; deliver pops the slices out and emits an event', () => {
  const c = createCreature('crumb'); let j;
  for (let i = 0; i < 70; i++) j = c.update(1 / 60, { x: 0, z: 0 }, { action: 'gather' });
  assert.ok(j.parts.toast.glow > 0.5 && j.parts.toast.y > 0.2, `glow ${j.parts.toast.glow} y ${j.parts.toast.y}`);
  const seen = [];
  for (let i = 0; i < 90; i++) { j = c.update(1 / 60, { x: 0, z: 0 }, { action: 'deliver' }); seen.push(...j.events.map(e => e.type)); }
  assert.equal(seen.filter(t => t === 'deliver').length, 1);
  close(j.parts.toast.glow, 0, 0.05);
});

test('hit: impulse tilts and flashes, then settles within a second', () => {
  const c = createCreature('popper'); let j, maxFlash = 0, maxTilt = 0;
  for (let i = 0; i < 10; i++) c.update(1 / 60, { x: 0, z: 0 }, { action: 'idle' });
  c.hit(1, 0, 1);
  for (let i = 0; i < 90; i++) { j = c.update(1 / 60, { x: 0, z: 0 }, { action: 'idle' }); maxFlash = Math.max(maxFlash, j.root.flash); maxTilt = Math.max(maxTilt, Math.abs(j.root.pitch) + Math.abs(j.root.roll)); }
  assert.ok(maxFlash > 0.5 && maxTilt > 0.05);
  close(j.root.roll, 0, 0.01); close(j.root.pitch, 0, 0.01); close(j.root.flash, 0, 1e-9);
});

test('death: sparks, then one shatter event, then the creature is hidden for good', () => {
  const c = createCreature('crumb', { seed: 7 }); const types = []; let j;
  for (let i = 0; i < 6; i++) c.update(1 / 60, { x: 2, z: 3 }, { action: 'idle' });
  for (let i = 0; i < 90; i++) { j = c.update(1 / 60, { x: 2, z: 3 }, { action: 'die' }); types.push(...j.events.map(e => e.type)); }
  assert.deepEqual(types.filter(t => t === 'sparks' || t === 'shatter'), ['sparks', 'shatter']);
  assert.equal(j.visible, false); assert.equal(j.alive, false);
  const s = c.update(1 / 60, { x: 2, z: 3 }, { action: 'idle' }); assert.equal(s.visible, false);
});

test('spawn: pops in from nothing with a little overshoot', () => {
  const c = createCreature('popper'); let max = 0, first;
  for (let i = 0; i < 60; i++) { const r = c.update(1 / 60, { x: 0, z: 0 }, { action: 'spawn' }).root; if (i === 0) first = r.sy; max = Math.max(max, r.sy); }
  assert.ok(first < 0.2 && max > 1.0, `first ${first} max ${max}`);
  close(c.joints().root.sy, 1, 0.05);
});

test('Broiler siege: the door swings open on a spring and closes again', () => {
  const c = createCreature('broiler'); let j, minOpen = 0;
  for (let i = 0; i < 90; i++) { j = c.update(1 / 60, { x: 0, z: 0 }, { action: 'siege' }); minOpen = Math.min(minOpen, j.parts.door.rx); }
  close(j.parts.door.rx, -1.4, 0.05); assert.ok(minOpen < -1.4, 'overshoots a little (spring)');
  for (let i = 0; i < 120; i++) j = c.update(1 / 60, { x: 0, z: 0 }, { action: 'idle' });
  close(j.parts.door.rx, 0, 0.02);
});

test('Crumb cord trails behind and stays attached', () => {
  const { c } = run('crumb', { speed: 1.5, seconds: 3 });
  const j = c.joints(), cord = j.cord;
  assert.ok(cord && cord.length === 18);
  assert.ok(Math.hypot(cord[0] - j.root.x, cord[2] - j.root.z) < 0.35, 'head of cord at the body');
  assert.ok(cord[17] < j.root.z - 0.1, 'tail trails behind (moving +z)');
  assert.equal(createCreature('popper').joints().cord, null);
});

test('teleport: a spawn far away does not stretch or streak', () => {
  const c = createCreature('crumb');
  c.update(1 / 60, { x: 0, z: 0 }, { action: 'idle' });
  const j = c.update(1 / 60, { x: 80, z: 80 }, { action: 'idle' });
  close(j.root.x, 80, 1e-6); assert.equal(j.speed, 0);
});

test('works on top of the 24 tps interpolator at 60 fps (nothing steppy)', () => {
  const it = createInterpolator(24), c = createCreature('popper'), out = {};
  let simTick = 0, maxJump = 0, last = null;
  for (let f = 0; f < 240; f++) {
    const tickF = f / 60 * 24;
    while (simTick <= Math.floor(tickF)) { it.push(simTick, { x: 0, z: simTick * 2 / 24 }); simTick++; }
    it.sample(tickF - 1, out);
    const r = c.update(1 / 60, { x: out.x ?? 0, z: out.z ?? 0, heading: 0 }, { action: 'move' }).root;
    if (last !== null) maxJump = Math.max(maxJump, Math.abs(r.z - last));
    last = r.z;
  }
  assert.ok(maxJump < 0.12, `largest per-frame move ${maxJump}`);
});

test('200 creatures at 60 fps worth of updates cost well under a frame budget', () => {
  const ids = SPEC_IDS, cs = Array.from({ length: 200 }, (_, i) => createCreature(ids[i % ids.length], { seed: i }));
  const t0 = performance.now();
  for (let f = 0; f < 60; f++) cs.forEach((c, i) => c.update(1 / 60, { x: i % 20 + f * 0.03, z: Math.floor(i / 20) + f * 0.02, aim: { x: 0, z: 0 } }, { action: i % 5 ? 'move' : 'attack' }));
  const per = (performance.now() - t0) / 60;
  assert.ok(per < 8, `200 creatures took ${per.toFixed(2)} ms per frame`);
});

test('makeSpec reads sonnet\'s motion numbers when the id matches', () => {
  const s = makeSpec('four-slice');
  assert.equal(s.gait, 'stomp'); assert.ok(s.stride > 1); assert.ok(s.attack.snap >= 0.09);
});
