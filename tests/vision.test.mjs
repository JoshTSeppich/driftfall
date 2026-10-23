import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState, createInitialState } from '../env/state.mjs';
import { visionOf, isSeen, sightOf, createExplored, updateExplored, filterVisible } from '../env/vision.mjs';

const count = (v) => v.join('').split('1').length - 1;

test('a grunt sees a Chebyshev square of radius 6, clipped to the map', () => {
  const s = createTestState({ width: 20, height: 20, units: [{ owner: 0, kind: 'grunt', x: 10, y: 10 }] });
  const v = visionOf(s, 0);
  assert.equal(count(v), 13 * 13);
  assert.ok(isSeen(v, 4, 16) && !isSeen(v, 3, 10));
  const c = createTestState({ width: 20, height: 20, units: [{ owner: 0, kind: 'grunt', x: 0, y: 0 }] });
  assert.equal(count(visionOf(c, 0)), 7 * 7);
});

test('rows are width characters of 0/1 and the other side does not share vision', () => {
  const s = createTestState({ width: 12, height: 9, units: [{ owner: 1, kind: 'worker', x: 6, y: 4 }] });
  const v = visionOf(s, 0);
  assert.equal(v.length, 9);
  assert.ok(v.every((r) => /^[01]{12}$/.test(r)));
  assert.equal(count(v), 0);
});

test('sites see 2, dead units see nothing', () => {
  const s = createTestState({ width: 30, height: 30, structures: [{ owner: 0, kind: 'forge', x: 5, y: 5, complete: false }],
    units: [{ owner: 0, kind: 'grunt', x: 20, y: 20, hp: 0 }] });
  assert.equal(count(visionOf(s, 0)), 5 * 5);
  assert.equal(sightOf({ kind: 'mast', complete: true }), 10);
});

function plateau(extra) {
  const s = createTestState({ width: 20, height: 5, ...extra });
  s.heights = Array.from({ length: 5 }, () => Array.from({ length: 20 }, (_, x) => (x >= 10 ? 1 : 0)));
  s.ramps = [];
  return s;
}

test('high ground blocks sight from below; the 2-tile ring, height-above and air still see', () => {
  const low = plateau({ units: [{ owner: 0, kind: 'lancer', x: 7, y: 2 }] });
  const v = visionOf(low, 0);
  assert.ok(isSeen(v, 9, 2), 'within 2 always seen');
  assert.ok(!isSeen(v, 10, 2) && !isSeen(v, 12, 2), 'plateau beyond 2 hidden');
  assert.ok(isSeen(v, 3, 2));
  const high = plateau({ units: [{ owner: 0, kind: 'lancer', x: 12, y: 2 }] });
  assert.ok(isSeen(visionOf(high, 0), 7, 2), 'high sees low');
  const air = plateau({ units: [{ owner: 0, kind: 'skiff', x: 7, y: 2, hp: 90 }] });
  assert.ok(isSeen(visionOf(air, 0), 12, 2), 'air sees the plateau');
});

test('ramps count as low', () => {
  const s = plateau({ units: [{ owner: 0, kind: 'lancer', x: 7, y: 2 }] });
  s.ramps = [{ x: 11, y: 2, axis: 'ew' }];
  assert.ok(isSeen(visionOf(s, 0), 11, 2));
});

test('cargo inside a Barge sees nothing', () => {
  const s = createTestState({ width: 10, height: 10, units: [{ owner: 0, kind: 'grunt', x: 5, y: 5 }] });
  s.units[0].inside = 9;
  assert.equal(count(visionOf(s, 0)), 0);
});

test('explored memory only grows; filterVisible hides unseen enemies', () => {
  const s = createTestState({ width: 20, height: 20, units: [
    { owner: 0, kind: 'worker', x: 2, y: 2 }, { owner: 1, kind: 'grunt', x: 3, y: 3 }, { owner: 1, kind: 'grunt', x: 15, y: 15 }] });
  let ex = updateExplored(createExplored(20, 20), visionOf(s, 0));
  s.units[0].x = 10; s.units[0].y = 10;
  ex = updateExplored(ex, visionOf(s, 0));
  assert.ok(isSeen(ex, 0, 0) && isSeen(ex, 14, 14));
  assert.equal(filterVisible(s, 0).units.filter((u) => u.owner === 1).length, 1);
});

test('deterministic; a real match start shows own core, hides the enemy core', () => {
  const s = createInitialState(7);
  const a = visionOf(s, 0);
  assert.deepEqual(a, visionOf(s, 0));
  const c1 = s.structures.find((x) => x.owner === 1), c0 = s.structures.find((x) => x.owner === 0);
  assert.ok(isSeen(a, c0.x, c0.y) && !isSeen(a, c1.x, c1.y));
});

// ---- play/camera.mjs, play/fog.mjs, play/minimap.mjs ----
import { createCameraRig, CAMERA } from '../play/camera.mjs';
import { createFog, fogMask, fogPixels, FOG, hiddenTiles } from '../play/fog.mjs';
import { minimapToTile, tileToMinimap, drawMinimap } from '../play/minimap.mjs';

test('camera: arrow keys and screen edges scroll, diagonal is not faster, clamps to the map', () => {
  const rig = createCameraRig(100, 100, { x: 50, y: 50 });
  rig.keys.add('ArrowRight');
  rig.update(1);
  assert.ok(Math.abs(rig.x - (50 + CAMERA.speed * rig.zoom / 24)) < 1e-9); // pan speed scales with zoom
  const r2 = createCameraRig(100, 100, { x: 50, y: 50 });
  r2.keys.add('ArrowRight'); r2.keys.add('ArrowDown');
  const v = r2.velocity();
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - CAMERA.speed * r2.zoom / 24) < 1e-9);
  const r3 = createCameraRig(100, 100, { x: 50, y: 50 });
  r3.setMouse(0, 300);
  assert.ok(r3.velocity().x < 0 && r3.velocity().y === 0);
  r3.setMouse(640, 360);
  assert.equal(r3.velocity().x, 0);
  r3.setMouse(NaN, NaN);
  assert.equal(r3.mouse, null);
  r3.centerOn(-5, 500);
  assert.deepEqual([r3.x, r3.y], [0, 99]);
});

test('minimap: pixel/tile conversion round-trips and clamps', () => {
  const t = minimapToTile(80, 80, 160, 160, 32, 32);
  const p = tileToMinimap(t.x, t.y, 160, 160, 32, 32);
  assert.ok(Math.abs(p.px - 80) < 1e-9 && Math.abs(p.py - 80) < 1e-9);
  assert.deepEqual(minimapToTile(-10, 999, 160, 160, 32, 32), { x: 0, y: 31 });
});

test('fog: unexplored, explored and visible levels; mask and pixels agree', () => {
  const s = createTestState({ width: 20, height: 20, units: [{ owner: 0, kind: 'worker', x: 2, y: 2 }] });
  const fog = createFog(s, 0);
  assert.equal(fog.level(2, 2), 2);
  assert.equal(fog.level(15, 15), 0);
  s.units[0].x = 15; s.units[0].y = 15;
  fog.update(s);
  assert.equal(fog.level(2, 2), 1, 'left behind = explored');
  assert.equal(fog.level(15, 15), 2);
  assert.equal(fog.level(8, 8), 0);
  const mask = fogMask(fog, 20, 20);
  assert.equal(mask[2 * 20 + 2], FOG.explored);
  assert.equal(mask[15 * 20 + 15], FOG.visible);
  assert.equal(fogPixels(fog, 20, 20)[(8 * 20 + 8) * 4 + 3], FOG.unexplored);
  assert.equal(hiddenTiles(fog, 20, 20).length, mask.filter((a) => a > 0).length);
});

test('minimap draw hides enemies in the fog and shows them in sight', () => {
  const s = createTestState({ width: 20, height: 20, units: [
    { owner: 0, kind: 'worker', x: 2, y: 2 }, { owner: 1, kind: 'grunt', x: 4, y: 4 }, { owner: 1, kind: 'grunt', x: 18, y: 18 }] });
  const fog = createFog(s, 0);
  const rects = [];
  const ctx = { canvas: { width: 100, height: 100 }, fillRect: (...a) => rects.push([ctx.fillStyle, ...a]), beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {} };
  drawMinimap(ctx, s, { side: 0, fog });
  const foes = rects.filter((r) => r[0] === '#ff8a3d');
  assert.equal(foes.length, 1);
  assert.deepEqual(foes[0].slice(1, 3), [20, 20]);
});
