// Wheatfield play page, render path (owner: sonnet): the world snapshot the 3D units get must carry the power cords and
// hunger, which env/state.mjs observe() does not include. Without them the toaster cord batch never draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createToasterState, observeToaster } from '../play/toaster-play.mjs';
import { createLiveWorld } from '../play/app.mjs';
import { STATS } from '../env/stats.mjs';
import { stepPower } from '../env/power.mjs';

test('observeToaster: units carry their plugged power + cord points; the snapshot carries power points and ammo', () => {
  const s = createToasterState(7); stepPower(s);
  const snap = observeToaster(s, 0);
  const crumb = snap.units.find((u) => u.owner === 0);
  assert.ok(crumb.power, 'unit power state');
  assert.equal(crumb.power.state, 'plugged');
  const anchor = snap.power.view.points.find((p) => p.id === crumb.power.anchor);
  assert.ok(anchor, 'anchor point is in the snapshot power view');
  assert.ok(snap.ammo, 'ammo handle for hunger');
});

test('the live world frame keeps the power fields on its units', () => {
  const s = createToasterState(7); stepPower(s);
  const w = createLiveWorld(observeToaster(s, 0), STATS);
  const f = w.frame();
  assert.ok(f.units.find((u) => u.owner === 0).power);
  assert.ok(f.next.power.view.points.length > 0);
});

test('thin power lines: drawn in classic, hidden in Toaster Wars until "inspect power", then faint', async () => {
  const { drawPowerOverlay } = await import('../play/territory-wire.mjs');
  const s = createToasterState(7); stepPower(s);
  const run = (opts) => {
    const widths = [];
    const ov = new Proxy({}, { get: (t, k) => (k === 'stroke' ? () => widths.push(t.lineWidth) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
    drawPowerOverlay(ov, s, 0, [], (x, y) => ({ sx: x, sy: y }), s.tick, opts);
    return widths.length;
  };
  const classic = run({});
  assert.ok(classic > 0, 'classic draws the thin cords');
  assert.equal(run({ cords: true, faint: true }), classic, 'inspect power shows them');
  assert.ok(run({ cords: false }) < classic, 'default Toaster Wars hides them');
});

test('end to end: the live world frame from observeToaster makes the toaster cord batch draw', async () => {
  const THREE = await import('three');
  const { createInstancedUnits } = await import('../play/units-instanced.mjs');
  const s = createToasterState(7); stepPower(s);
  const w = createLiveWorld(observeToaster(s, 0), STATS);
  const ctx = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), tileSize: 1, toy: { look: {} },
    gridToWorld(x, y, z, out) { return out.set(x, z, y); } };
  const u = createInstancedUnits(ctx, { look: '3d' });
  u.update(w.frame(), 1 / 60);
  const cords = ctx.scene.getObjectByName('toaster-cords');
  assert.ok(cords && cords.visible && cords.geometry.drawRange.count > 0, 'the thick cords are drawn');
  u.dispose();
});

test('snapshot power is a copy: later sim changes do not rewrite the snapshot unit', () => {
  const s = createToasterState(7); stepPower(s);
  const snap = observeToaster(s, 0);
  const u = s.units.find((x) => x.owner === 0);
  u.power.state = 'down';
  assert.equal(snap.units.find((x) => x.id === u.id).power.state, 'plugged');
});
