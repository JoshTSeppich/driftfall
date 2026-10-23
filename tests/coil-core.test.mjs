// coil-core: the Coil Engine's pure maths (engine/coil/springs, interpolate, spine, gaits, ik). Owner: fable.
// No Three.js anywhere: everything here runs headless and is deterministic for the same inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpring, stepSpring, kickSpring, springFromHz } from '../engine/coil/springs.mjs';
import { createInterpolator, lerpAngle } from '../engine/coil/interpolate.mjs';
import { createChain } from '../engine/coil/spine.mjs';
import { GAITS, createGaitState, advanceGait, sampleGait } from '../engine/coil/gaits.mjs';
import { shortestAngle, yawTo, pitchTo, createAimer, solveTwoBone } from '../engine/coil/ik.mjs';

const close = (a, b, e, m) => assert.ok(Math.abs(a - b) <= e, `${m ?? ''} ${a} vs ${b} (±${e})`);

test('spring converges to its target and settles', () => {
  const s = createSpring(0, 150, 18);
  for (let i = 0; i < 120; i++) stepSpring(s, 1, 1 / 60);
  close(s.x, 1, 0.01); close(s.v, 0, 0.05);
});

test('spring stays finite at any frame rate, including absurd dt', () => {
  for (const dt of [0.0001, 0.001, 1 / 144, 1 / 60, 1 / 24, 0.1, 0.5, 5, 1e6]) {
    const s = createSpring(0, 450, 19);
    for (let i = 0; i < 200; i++) stepSpring(s, 1, dt);
    assert.ok(Number.isFinite(s.x) && Math.abs(s.x) < 5, `dt ${dt} -> ${s.x}`);
  }
  const s = createSpring(0.3); stepSpring(s, 1, NaN); stepSpring(s, 1, -1); stepSpring(s, 1, 0);
  assert.equal(s.x, 0.3);
});

test('spring result is nearly frame-rate independent', () => {
  const run = dt => { const s = createSpring(0, 230, 12); kickSpring(s, 3); for (let t = 0; t < 0.5 - 1e-9; t += dt) stepSpring(s, 0.2, dt); return s.x; };
  close(run(1 / 24), run(1 / 144), 0.03); close(run(1 / 60), run(1 / 144), 0.01);
});

test('springFromHz gives a critically damped spring with no overshoot', () => {
  const { k, d } = springFromHz(4, 1);
  const s = createSpring(0, k, d); let max = 0;
  for (let i = 0; i < 240; i++) { stepSpring(s, 1, 1 / 120); max = Math.max(max, s.x); }
  assert.ok(max < 1.01, `overshoot ${max}`); close(s.x, 1, 0.01);
});

test('interpolator lerps between ticks, wraps angles the short way, never extrapolates', () => {
  const it = createInterpolator(24);
  it.push(10, { x: 0, z: 0, yaw: 350 * Math.PI / 180 });
  it.push(11, { x: 2, z: 4, yaw: 10 * Math.PI / 180 });
  const out = {};
  assert.equal(it.sample(10.5, out), out);
  close(out.x, 1, 1e-9); close(out.z, 2, 1e-9); close(Math.abs(shortestAngle(out.yaw, 0)), 0, 1e-9);
  it.sample(12.7, out); close(out.x, 2, 1e-9);
  it.sample(5, out); close(out.x, 0, 1e-9);
  it.push(9, { x: 99, z: 99, yaw: 0 }); it.sample(11, out); close(out.x, 2, 1e-9, 'late tick ignored');
  close(Math.abs(lerpAngle(3.1, -3.1, 0.5)), Math.PI, 0.05);
});

test('chain keeps its spacing and follows the head', () => {
  const c = createChain({ count: 8, spacing: 0.2, gravity: 0 });
  let hx = 0;
  for (let i = 0; i <= 240; i++) { const t = i / 60; hx = Math.sin(t * 2) * 2; c.step(1 / 60, hx, 0.4, t * 1.5); }
  const p = c.positions;
  for (let j = 1; j < 8; j++) {
    const d = Math.hypot(p[j * 3] - p[j * 3 - 3], p[j * 3 + 1] - p[j * 3 - 2], p[j * 3 + 2] - p[j * 3 - 1]);
    close(d, 0.2, 0.2 * 0.05, `segment ${j}`);
  }
  close(p[0], hx, 0.01, 'head pinned');
});

test('chain is finite on huge dt and on teleports, and rests on the floor', () => {
  const c = createChain({ count: 6, spacing: 0.15, gravity: -9, floor: 0 });
  for (const dt of [0.5, 5, 1 / 24]) c.step(dt, 0, 1, 0);
  c.step(1 / 60, 500, 1, -500);
  for (let i = 0; i < 300; i++) c.step(1 / 60, 500, 1, -500);
  for (const v of c.positions) assert.ok(Number.isFinite(v));
  for (let j = 0; j < 6; j++) assert.ok(c.positions[j * 3 + 1] >= -1e-6, 'above floor');
  close(c.positions[0], 500, 1e-6);
  const seg = Math.hypot(c.positions[3] - c.positions[0], c.positions[4] - c.positions[1], c.positions[5] - c.positions[2]);
  close(seg, 0.15, 0.01);
});

test('chain shape does not depend much on the frame rate', () => {
  const run = fps => { const c = createChain({ count: 6, spacing: 0.2, gravity: -9 }); for (let i = 0; i <= 2 * fps; i++) { const t = i / fps; c.step(1 / fps, Math.sin(t * 3), 1, t); } return [...c.positions.slice(-3)]; };
  const a = run(24), b = run(144);
  for (let i = 0; i < 3; i++) close(a[i], b[i], 0.15);
});

function walk(gaitName, speed, seconds, dt = 1 / 120) {
  const g = GAITS[gaitName], st = createGaitState(), s = {}, frames = [];
  let pos = 0;
  for (let t = 0; t < seconds; t += dt) {
    advanceGait(st, g, speed, dt); pos += speed * dt; sampleGait(g, st, speed, s);
    frames.push({ ground: pos + s.offset * g.stride, lift: s.lift, planted: s.planted, phase: st.phase });
  }
  return { frames, g, st, pos };
}

test('hop gait: planted frames do not slide, average speed matches the sim, apex is the hop height', () => {
  const { frames, g } = walk('hop', 2.5, 4);
  let planted = 0, maxLift = 0;
  for (let i = 1; i < frames.length; i++) {
    const v = (frames[i].ground - frames[i - 1].ground) * 120;
    if (frames[i].planted && frames[i - 1].planted) { planted++; close(v, 0, 0.02, 'planted velocity'); assert.equal(frames[i].lift, 0); }
    maxLift = Math.max(maxLift, frames[i].lift);
  }
  assert.ok(planted > 30, 'has planted frames');
  const f = frames[frames.length - 1]; close((f.ground - frames[0].ground) / 4, 2.5, 0.1);
  close(maxLift, g.height, g.height * 0.1);
});

test('stomp is slower, lower and longer-stride than hop', () => {
  assert.ok(GAITS.stomp.height < GAITS.hop.height && GAITS.stomp.stride > GAITS.hop.stride);
});

test('gait finishes its hop when the unit stops and lands exactly on the sim position', () => {
  const g = GAITS.hop, st = createGaitState(), s = {};
  for (let i = 0; i < 77; i++) advanceGait(st, g, 2.5, 1 / 60);
  for (let i = 0; i < 120; i++) advanceGait(st, g, 0, 1 / 60);
  sampleGait(g, st, 0, s);
  close(st.phase % 1, 0, 1e-9); close(s.offset, 0, 1e-9); assert.equal(s.lift, 0); assert.equal(s.planted, true);
});

test('roll gait spins by distance over radius and never leaves the ground', () => {
  const g = GAITS.roll, st = createGaitState(), s = {};
  for (let i = 0; i < 240; i++) advanceGait(st, g, 3, 1 / 60);
  sampleGait(g, st, 3, s); close(s.spin, 12 / g.radius, 0.2); assert.equal(s.lift, 0);
});

test('fly gait bobs and is never planted; waddle sways', () => {
  const st = createGaitState(), s = {}; let lo = 9, hi = -9, sw = 0;
  for (let i = 0; i < 240; i++) { advanceGait(st, GAITS.fly, 2, 1 / 60); sampleGait(GAITS.fly, st, 2, s); lo = Math.min(lo, s.lift); hi = Math.max(hi, s.lift); assert.equal(s.planted, false); }
  assert.ok(hi - lo > 0.05);
  const w = createGaitState();
  for (let i = 0; i < 240; i++) { advanceGait(w, GAITS.waddle, 1.5, 1 / 60); sampleGait(GAITS.waddle, w, 1.5, s); sw = Math.max(sw, Math.abs(s.sway)); }
  assert.ok(sw > 0.05);
});

test('ik: shortest angle, yawTo/pitchTo, aimer turns the short way and settles', () => {
  close(shortestAngle(3, -3), 2 * Math.PI - 6, 1e-9); close(yawTo(1, 0), Math.PI / 2, 1e-9); close(yawTo(0, 1), 0, 1e-9);
  close(pitchTo(0, 1, 1), Math.atan2(1, 1), 1e-9);
  const a = createAimer(Math.PI - 0.1, 120, 20);
  for (let i = 0; i < 120; i++) a.step(-Math.PI + 0.1, 1 / 60);
  close(shortestAngle(a.angle, -Math.PI + 0.1), 0, 0.01);
});

test('two-bone ik reaches reachable targets and clamps unreachable ones', () => {
  const r = solveTwoBone(1, 1, 1.2, 0.8, {});
  const ex = Math.cos(r.a1) + Math.cos(r.a1 + r.a2), ey = Math.sin(r.a1) + Math.sin(r.a1 + r.a2);
  close(ex, 1.2, 1e-6); close(ey, 0.8, 1e-6); assert.equal(r.reached, true);
  const far = solveTwoBone(1, 1, 10, 0, {});
  assert.equal(far.reached, false); close(Math.cos(far.a1) + Math.cos(far.a1 + far.a2), 2, 1e-6);
});
