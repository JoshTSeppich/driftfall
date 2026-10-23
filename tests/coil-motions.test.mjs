// Coil motion engine (engine/coil/motions.mjs + motion-specs.mjs): the springs, hop cadence, animation graph,
// physical events, pentagon shards and the six Toastinator motion specs. Pure node, no Three.js. Owner: sonnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createSpring, stepSpring, hopAt, advanceHop, createMotionGraph, makeShards, createShardPool, STATES,
} from '../engine/coil/motions.mjs';
import { MOTION_UNITS, UNIT_KEYS, ALIASES } from '../engine/coil/motion-specs.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const run = (g, seconds, input = {}, dt = 1 / 60) => {
  let last = null;
  for (let t = 0; t < seconds - 1e-9; t += dt) last = g.update(dt, input);
  return last;
};
const SPEC = MOTION_UNITS.popper;

test('springs settle on target, overshoot when underdamped, and never produce NaN', () => {
  const s = createSpring({ stiffness: 200, damping: 6, value: 0, target: 1 });
  let peak = 0;
  for (let i = 0; i < 600; i++) { stepSpring(s, 1 / 60); peak = Math.max(peak, s.value); }
  assert.ok(peak > 1, 'an underdamped spring overshoots');
  assert.ok(Number.isFinite(s.value) && Math.abs(s.value - 1) < 1e-3, `settled at ${s.value}`);
});

test('springs are deterministic and nearly frame-rate independent', () => {
  const a = createSpring({ stiffness: 240, damping: 14, target: 1 });
  const b = createSpring({ stiffness: 240, damping: 14, target: 1 });
  for (let i = 0; i < 60; i++) stepSpring(a, 1 / 60);
  for (let i = 0; i < 24; i++) stepSpring(b, 1 / 24);
  assert.ok(Math.abs(a.value - b.value) < 0.02, `60 fps ${a.value} vs 24 fps ${b.value}`);
});

test('a hop is airborne between contacts, lands at 0 and 1, and apexes in the middle', () => {
  assert.equal(hopAt(0).lift, 0);
  assert.equal(hopAt(1).lift, 0);
  assert.equal(hopAt(0.5).lift, 1);
  for (let p = 0.05; p < 0.95; p += 0.05) {
    const l = hopAt(p).lift;
    assert.ok(l >= 0 && l <= 1);
    if (p < 0.5) assert.ok(l >= hopAt(p - 0.05).lift, 'rises');
  }
  assert.ok(hopAt(0).squash > 0.9, 'squashes on landing');
});

test('stride planting: contacts match distance covered, so feet do not slide', () => {
  const stride = 0.8, speed = 2.4, seconds = 5;
  let phase = 0, contacts = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    const r = advanceHop(phase, speed, 1 / 60, stride);
    phase = r.phase; contacts += r.contacts;
  }
  const distance = speed * seconds;
  assert.ok(Math.abs(contacts * stride - distance) <= stride, `${contacts} contacts over ${distance} m`);
});

test('the graph blends from idle into move and reports the hop', () => {
  const g = createMotionGraph(SPEC);
  run(g, 0.5, { speed: 0 });
  assert.equal(g.state, 'idle');
  g.update(1 / 60, { speed: SPEC.topSpeed });
  assert.equal(g.state, 'move');
  const early = g.update(1 / 60, { speed: SPEC.topSpeed });
  assert.ok(early.blend < 1, 'blend starts below 1');
  const late = run(g, 1, { speed: SPEC.topSpeed });
  near(late.blend, 1);
  assert.ok(Number.isFinite(late.lift));
});

test('a strike hits on the windup frame, snaps the toast, and returns to idle', () => {
  const g = createMotionGraph(SPEC);
  g.trigger('strike');
  const { windup, snap, resolve } = SPEC.strike;
  const events = [];
  for (let t = 0; t < windup + snap + resolve + 0.1; t += 1 / 120) events.push(...g.update(1 / 120, {}).events);
  assert.equal(events.filter((e) => e.type === 'strike-hit').length, 1, 'one damage frame');
  assert.equal(g.action, null);
  assert.equal(g.state, 'idle');
});

test('strike phases each sit inside the 80 to 200 ms snappy band', () => {
  for (const key of UNIT_KEYS) {
    const { windup, snap, resolve } = MOTION_UNITS[key].strike;
    for (const s of [windup, snap, resolve]) assert.ok(s >= 0.05 && s <= 0.2, `${key}: ${s}`);
  }
});

test('a hit pushes the body off line and the spring brings it back', () => {
  const g = createMotionGraph(SPEC);
  g.trigger('hit', { dir: { x: 1, z: 0 }, strength: 1 });
  const first = g.update(1 / 60, {});
  assert.ok(first.offX > 0, 'knocked along the hit direction');
  assert.ok(first.flinch > 0.5, 'flinch starts high');
  const later = run(g, 3, {});
  assert.ok(Math.abs(later.offX) < 0.01, `back at rest: ${later.offX}`);
  assert.ok(later.flinch === 0);
});

test('death: ragdoll tilts first, shatter fires exactly once after the fall, then the unit is gone', () => {
  const g = createMotionGraph(SPEC);
  g.die({ dir: { x: 0, z: 1 }, strength: 1 });
  let shatters = 0, shardCount = 0, earliest = Infinity;
  for (let frame = 1; frame <= 72; frame++) {
    const p = g.update(1 / 60, {});
    for (const e of p.events) if (e.type === 'shatter') { shatters++; shardCount = e.shards.length; earliest = Math.min(earliest, frame / 60); }
  }
  assert.equal(shatters, 1);
  assert.equal(shardCount, SPEC.shards);
  assert.ok(earliest >= SPEC.fallSeconds - 1e-6, `shatter at ${earliest}, must follow the fall`);
  assert.equal(g.update(1 / 60, {}).visible, false);
});

test('spawn scales in over 0.2 s and rank-up emits its event', () => {
  const g = createMotionGraph(SPEC);
  g.trigger('spawn');
  assert.ok(g.update(1 / 60, {}).scale < 0.4);
  run(g, 0.3, {});
  near(g.update(1 / 60, {}).scale, 1, 0.02);
  g.trigger('rankUp');
  const ev = []; for (let t = 0; t < 0.6; t += 1 / 60) ev.push(...g.update(1 / 60, {}).events);
  assert.ok(ev.some((e) => e.type === 'rank-up'));
});

test('Quake shake is a decaying offset in the shake direction', () => {
  const g = createMotionGraph(SPEC);
  g.shake(0.25, { x: 0, z: 1 });
  const a = g.update(1 / 60, {});
  assert.ok(a.shakeZ > 0.1 && Math.abs(a.shakeX) < 1e-9, `shake ${a.shakeX},${a.shakeZ}`);
  const b = run(g, 0.6, {});
  assert.ok(Math.abs(b.shakeZ) < 0.01, 'shake decays to nothing');
});

test('shards are pentagons, deterministic per seed, and differ across seeds', () => {
  const a = makeShards(12, { seed: 7, dir: { x: 1, z: 0 }, speed: 3 });
  const b = makeShards(12, { seed: 7, dir: { x: 1, z: 0 }, speed: 3 });
  const c = makeShards(12, { seed: 8, dir: { x: 1, z: 0 }, speed: 3 });
  assert.equal(a.length, 12);
  for (const s of a) assert.equal(s.verts.length, 5, 'five facets');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('the shard pool caps at 512 and recycles the oldest', () => {
  const pool = createShardPool(512);
  for (let i = 0; i < 4; i++) pool.push(makeShards(200, { seed: i, dir: { x: 0, z: 1 }, speed: 2 }), 0);
  assert.equal(pool.size, 512);
  assert.equal(pool.shards().length, 512);
});

test('the engine uses no randomness or wall clock, so replays match', () => {
  const src = fs.readFileSync(new URL('../engine/coil/motions.mjs', import.meta.url), 'utf8');
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(src));
});

test('same inputs give the same pose sequence', () => {
  const seq = (g) => { const out = []; for (let i = 0; i < 200; i++) out.push(g.update(1 / 60, { speed: i < 100 ? 2 : 0 })); return out; };
  assert.deepEqual(seq(createMotionGraph(SPEC)), seq(createMotionGraph(SPEC)));
});

test('the six Toastinator specs exist with their old names as aliases and sane motion numbers', () => {
  assert.deepEqual([...UNIT_KEYS].sort(), ['bagel', 'broiler', 'crumb', 'four-slice', 'popper', 'zapper']);
  assert.equal(ALIASES.crumb, 'Siphoner');
  assert.equal(ALIASES.popper, 'Fang');
  assert.equal(ALIASES.zapper, 'Spitter');
  assert.equal(ALIASES['four-slice'], 'Constrictor');
  assert.equal(ALIASES.bagel, 'Hisser');
  assert.equal(ALIASES.broiler, 'Boomslang');
  for (const key of UNIT_KEYS) {
    const s = MOTION_UNITS[key];
    assert.ok(s.movingParts.length >= 3 && s.movingParts.length <= 6, `${key} parts`);
    assert.ok(s.shards >= 4 && s.shards <= 14, `${key} shards`);
    assert.ok(s.topSpeed > 0 && s.stride > 0 && s.fallSeconds > 0, `${key} motion`);
    assert.ok(STATES.includes('idle'));
  }
});
