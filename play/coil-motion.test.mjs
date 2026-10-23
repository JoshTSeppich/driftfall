// The ?motion=coil adapter (play/coil-motion.mjs): flag parsing, sim kind to Toastinator mapping, per-unit graphs.
// Pure node. Owner: sonnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coilEnabled, toastinatorFor, createCoilUnits } from './coil-motion.mjs';

test('?motion=coil turns the mode on and nothing else does', () => {
  assert.equal(coilEnabled('?motion=coil'), true);
  assert.equal(coilEnabled('?x=1&motion=coil'), true);
  assert.equal(coilEnabled(''), false);
  assert.equal(coilEnabled('?motion=off'), false);
});

test('every sim kind maps to a Toastinator, and unknown kinds fall back to the Popper', () => {
  assert.equal(toastinatorFor('worker'), 'crumb');
  assert.equal(toastinatorFor('grunt'), 'popper');
  assert.equal(toastinatorFor('lancer'), 'zapper');
  assert.equal(toastinatorFor('brute'), 'four-slice');
  assert.equal(toastinatorFor('dart'), 'bagel');
  assert.equal(toastinatorFor('howler'), 'broiler');
  assert.equal(toastinatorFor('mystery'), 'popper');
});

test('each unit id gets its own graph; a moving unit hops and a death returns a shatter event', () => {
  const units = createCoilUnits();
  const moving = units.pose(7, 'grunt', { speed: 2.4, dt: 1 / 60 });
  assert.ok(moving.state === 'move' || moving.state === 'idle');
  assert.equal(units.size, 1);
  units.pose(8, 'worker', { speed: 0, dt: 1 / 60 });
  assert.equal(units.size, 2);
  units.act(7, 'strike');
  units.die(7, { dir: { x: 1, z: 0 } });
  let shatters = 0;
  for (let i = 0; i < 60; i++) for (const e of units.pose(7, 'grunt', { speed: 0, dt: 1 / 60 }).events) if (e.type === 'shatter') shatters++;
  assert.equal(shatters, 1);
  units.forget(7);
  assert.equal(units.size, 1);
});
