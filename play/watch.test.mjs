import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaster, glide, createTopbar, nextSeed, isWatch, RESTART_SECONDS } from './watch.mjs';

const snap = (units = [], structures = [], territory = null) => ({ units, structures, territory });
const u = (id, owner, x, y, kind = 'grunt') => ({ id, owner, x, y, kind, hp: 10 });
const hit = (id, by, dmg = 8) => ({ e: 'hit', id, by, dmg, hp: 1 });

test('the biggest fight wins the camera', () => {
  const c = createCaster();
  const units = [u(1, 0, 20, 20), u(2, 1, 21, 20), u(3, 0, 90, 90), u(4, 1, 91, 90)];
  for (let t = 0; t < 6; t++) c.note(t, snap(units), [hit(2, 1), hit(1, 2), hit(4, 3), hit(1, 2), hit(2, 1)]);
  const p = c.pick(6);
  assert.ok(Math.hypot(p.x - 20.5, p.y - 20) < 3, `looks at the big fight, got ${p.x},${p.y}`);
  assert.equal(p.why, 'fight');
});

test('a base under attack outranks an equal skirmish and says so', () => {
  const c = createCaster();
  const units = [u(1, 0, 20, 20), u(2, 1, 21, 20)];
  const structures = [{ id: 9, owner: 0, kind: 'core', x: 100, y: 100, complete: true }];
  c.note(1, snap(units, structures), [hit(2, 1, 8), hit(9, 2, 8)]);
  const p = c.pick(1);
  assert.equal(p.why, 'base');
  assert.ok(p.x > 90);
});

test('a claim, a Drift warning and a landing are important events; they fade', () => {
  const territory = { map: { reaches: [{ id: 0, role: 'natural', side: 0, centre: { x: 30, y: 40 } }, { id: 1, role: 'centre', side: 'centre', centre: { x: 64, y: 64 } }] } };
  const c = createCaster();
  c.note(10, snap([], [], territory), [{ e: 'claimed', player: 0, reach: 0 }]);
  let p = c.pick(11);
  assert.deepEqual([p.why, p.x, p.y], ['claim', 30, 40]);
  const d = createCaster();
  d.note(20, snap([], [], territory), [{ e: 'drift-announce', id: 1, kind: 'quake', tick: 700, targets: [{ side: 'centre', role: 'centre' }] }]);
  p = d.pick(21);
  assert.equal(p.why, 'drift');
  assert.deepEqual([p.x, p.y], [64, 64]);
  assert.equal(c.pick(10 + 24 * 60), null, 'nothing left to watch after a minute of quiet');
  assert.equal(d.pick(20 + 24 * 60), null);
});

test('it does not flick between two similar fights, but moves on for a clearly bigger one', () => {
  const c = createCaster();
  const units = [u(1, 0, 20, 20), u(2, 1, 21, 20), u(3, 0, 90, 90), u(4, 1, 91, 90)];
  c.note(0, snap(units), [hit(2, 1), hit(1, 2), hit(1, 2)]);
  const first = c.pick(0);
  c.note(1, snap(units), [hit(4, 3), hit(3, 4), hit(3, 4), hit(4, 3)]);
  const again = c.pick(1);
  assert.deepEqual([again.x, again.y], [first.x, first.y], 'stays put inside the dwell time');
  const much = [];
  for (let i = 0; i < 40; i++) much.push(hit(4, 3, 20), hit(3, 4, 20));
  c.note(200, snap(units), much);
  assert.ok(c.pick(200).x > 80, 'moves on once the other fight is clearly bigger');
});

test('heat cools: an old fight stops attracting the camera', () => {
  const c = createCaster();
  c.note(0, snap([u(1, 0, 20, 20), u(2, 1, 21, 20)]), [hit(2, 1), hit(1, 2)]);
  assert.ok(c.pick(1));
  assert.equal(c.pick(24 * 40), null);
});

test('glide eases toward the target without overshooting and is frame-rate independent', () => {
  const mk = () => ({ x: 0, y: 0, centerOn(x, y) { this.x = x; this.y = y; } });
  const a = mk(); for (let i = 0; i < 60; i++) glide(a, { x: 50, y: 20 }, 1 / 60);
  const b = mk(); for (let i = 0; i < 30; i++) glide(b, { x: 50, y: 20 }, 1 / 30);
  assert.ok(a.x > 0 && a.x < 50 && a.y < 20);
  assert.ok(Math.abs(a.x - b.x) < 0.5, 'same distance after one second at 60 or 30 fps');
  for (let i = 0; i < 600; i++) glide(a, { x: 50, y: 20 }, 1 / 60);
  assert.ok(Math.abs(a.x - 50) < 0.1);
  glide(a, null, 0.1); // no target: stays
  assert.ok(Math.abs(a.x - 50) < 0.1);
});

test('top bar: income per minute from gains only, army value without workers, Reaches held', () => {
  const bar = createTopbar({ tps: 24 });
  const state = (tick, s0, s1, units, hold) => ({ tick, shards: [s0, s1], units, structures: [], territory: hold ? { hold, reaches: [1, 2, 3, 4, 5, 6, 7] } : null });
  const units = [u(1, 0, 0, 0, 'grunt'), u(2, 0, 0, 0, 'worker'), u(3, 1, 0, 0, 'brute')];
  bar.note(state(0, 100, 100, units, [1, 0]));
  bar.note(state(24, 150, 90, units, [1, 0])); // side 0 gains 50; side 1 spends 10 (not income)
  const v = bar.read(state(24, 150, 90, units, [2, 1]));
  assert.equal(v.sides[0].income, 50 * 60, 'a one second window scaled to a minute');
  assert.equal(v.sides[1].income, 0);
  assert.equal(v.sides[0].army, 50);
  assert.equal(v.sides[1].army, 150);
  assert.deepEqual([v.sides[0].reaches, v.sides[1].reaches, v.total], [2, 1, 7]);
  assert.equal(createTopbar().read({ tick: 0, shards: [0, 0], units: [], structures: [] }).total, 0);
});

test('mode flag, restart delay and next seed', () => {
  assert.equal(isWatch(new URLSearchParams('mode=watch')), true);
  assert.equal(isWatch(new URLSearchParams('')), false);
  assert.equal(isWatch(new URLSearchParams('mode=play')), false);
  assert.equal(RESTART_SECONDS, 10);
  assert.equal(nextSeed(7), 8);
  assert.equal(nextSeed('x'), 8);
});
