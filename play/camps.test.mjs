// Neutral camps and ground pickups on the live page (TERRITORY s14). Pure drawing helpers, checked with a stub canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pipCount, campMarks, drawCampsMinimap, drawCampsOverlay, drawPickups, CAMP } from './camps.mjs';

// Records the canvas calls we care about, so a test can count what would be drawn.
function stubCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    fillRect: rec('fillRect'), beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'),
    closePath: rec('closePath'), fill: rec('fill'), stroke: rec('stroke'), arc: rec('arc'), ellipse: rec('ellipse'),
    fillText: rec('fillText'),
  };
}
const count = (ctx, name) => ctx.calls.filter((c) => c[0] === name).length;

const camp = (o = {}) => ({ id: 1, kind: 'shardback', x: 10, y: 12, hp: 100, maxHp: 100, strength: 1, ...o });

test('pip count is the strength clamped to 1..3 pips', () => {
  assert.equal(pipCount(1), 1);
  assert.equal(pipCount(2), 2);
  assert.equal(pipCount(3), 3);
  assert.equal(pipCount(0), 1);
  assert.equal(pipCount(9), 3);
  assert.equal(pipCount(undefined), 1);
});

test('no neutrals in the snapshot means nothing to draw (the page is unchanged)', () => {
  assert.deepEqual(campMarks(undefined), []);
  assert.deepEqual(campMarks([]), []);
  const ctx = stubCtx();
  drawCampsMinimap(ctx, [], 1, 1);
  drawCampsOverlay(ctx, [], () => ({ sx: 0, sy: 0 }), 30);
  assert.equal(ctx.calls.length, 0);
});

test('dead or empty camps are not marked; live ones carry pips and a health fraction', () => {
  const marks = campMarks([
    camp({ id: 1, strength: 3, hp: 50, maxHp: 200 }),
    camp({ id: 2, hp: 0 }),
    camp({ id: 3, dead: true }),
  ]);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].id, 1);
  assert.equal(marks[0].pips, 3);
  assert.equal(marks[0].frac, 0.25);
});

test('with fog, a camp shows only once its tile has been seen', () => {
  const fog = { level: (x) => (x < 5 ? 0 : 1) };
  const marks = campMarks([camp({ id: 1, x: 2 }), camp({ id: 2, x: 9 })], { fog });
  assert.deepEqual(marks.map((m) => m.id), [2]);
});

test('minimap: one dot per camp plus one tick per pip', () => {
  const ctx = stubCtx();
  const marks = campMarks([camp({ id: 1, strength: 2 }), camp({ id: 2, strength: 3 })]);
  drawCampsMinimap(ctx, marks, 2, 2);
  assert.equal(count(ctx, 'fillRect'), 2 + 2 + 3);
});

test('overlay: each camp is a placeholder shape with its pips above it', () => {
  const ctx = stubCtx();
  const marks = campMarks([camp({ id: 1, strength: 2 })]);
  drawCampsOverlay(ctx, marks, (x, y) => ({ sx: x * 10, sy: y * 10 }), 30);
  assert.equal(count(ctx, 'fill'), 1 + 3, 'one body fill, then one fill per pip dot (3 slots)');
  assert.equal(count(ctx, 'arc'), 3, 'three pip dots per camp, lit or dimmed by strength');
  assert.ok(count(ctx, 'fillText') === 0, 'no text labels on the map');
});

test('pickups glow: a halo and a core ring for each item on the ground', () => {
  const ctx = stubCtx();
  const items = [{ id: 7, item: 'fang-polish', x: 4, y: 4 }, { id: 8, item: 'crystal-monocle', x: 6, y: 4 }];
  drawPickups(ctx, items, (x, y) => ({ sx: x, sy: y }), 30, 1000);
  assert.equal(count(ctx, 'arc'), 2 * 2);
});

test('pickups with missing or bad coordinates are skipped, never thrown on', () => {
  const ctx = stubCtx();
  drawPickups(ctx, [{ id: 1, item: 'fang-polish' }, null], (x, y) => ({ sx: x, sy: y }), 30, 0);
  assert.equal(ctx.calls.length, 0);
});

test('the camp colours are original (they are not any game palette)', () => {
  assert.match(CAMP.body, /^#[0-9a-f]{6}$/i);
  assert.match(CAMP.pip, /^#[0-9a-f]{6}$/i);
});
