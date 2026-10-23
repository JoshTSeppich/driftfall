import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UNIT_KINDS } from '../env/stats.mjs';
import { DRAWN_KINDS, spriteFor, billboardSize } from '../play/drawn-units.mjs';

test('every spawn kind explicitly maps to art or a 3D fallback', () => {
  for (const kind of UNIT_KINDS) assert.ok(Object.hasOwn(DRAWN_KINDS, kind), kind);
  assert.equal(spriteFor('unknown'), null);
});
test('six mapped sprites are 512 tall RGBA PNGs', () => {
  assert.equal(Object.values(DRAWN_KINDS).filter(Boolean).length, 6);
  for (const kind of Object.keys(DRAWN_KINDS)) {
    const path = spriteFor(kind); if (!path) continue;
    const png = readFileSync(new URL(path, import.meta.url));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(20), 512);
    assert.equal(png[25], 6);
  }
});
test('workers are smallest and constrictors largest', () => {
  assert.ok(billboardSize('worker') < billboardSize('grunt'));
  for (const k of ['grunt', 'lancer', 'spiker', 'howler']) assert.ok(billboardSize(k) < billboardSize('brute'));
});

import * as THREE from 'three';
import { UNIT_KINDS_3D } from '../viewer3d/units.mjs';
import { createDrawnUnits } from '../play/drawn-units.mjs';
import { createInstancedUnits } from '../play/units-instanced.mjs';

test('complete renderer roster has explicit art or fallback', () => {
  for (const kind of UNIT_KINDS_3D) assert.ok(Object.hasOwn(DRAWN_KINDS, kind), kind);
});
function fixture() {
  const callbacks = [];
  const ctx = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), tileSize: 1,
    gridToWorld(x, y, z, out) { return out.set(x, z, y); } };
  const loadTexture = (url, ok) => {
    const texture = new THREE.Texture({ width: 384, height: 512 });
    callbacks.push(() => ok(texture)); return texture;
  };
  return { ctx, loadTexture, ready() { callbacks.forEach((f) => f()); } };
}
test('200 units grow batches, face the camera, flip, and use one draw per kind plus rings', () => {
  const f = fixture(), layer = createDrawnUnits(f.ctx, { loadTexture: f.loadTexture });
  const v = { kind: 'grunt', pos: new THREE.Vector3(2, 0, 3), spec: { size: 0.65 }, yaw: Math.PI / 2, owner: 0 };
  const tr = { dy: 0, scale: 1 };
  assert.equal(layer.emit(v, tr), false);
  f.ready(); layer.begin();
  for (let i = 0; i < 200; i++) assert.equal(layer.emit(v, tr), true);
  layer.end();
  assert.equal(layer.kinds.get('grunt').batch.mesh.count, 200);
  assert.equal(layer.draws, 2);
  const matrix = new THREE.Matrix4(); layer.kinds.get('grunt').batch.mesh.getMatrixAt(0, matrix);
  assert.ok(matrix.elements[0] < 0, 'rightward motion mirrors the left-facing source');
  assert.equal(matrix.elements[13], 0, 'bottom of billboard stands at ground');
  v.yaw = -Math.PI / 2; layer.begin(); layer.emit(v, tr); layer.end();
  layer.kinds.get('grunt').batch.mesh.getMatrixAt(0, matrix); assert.ok(matrix.elements[0] > 0);
  assert.equal(layer.emit({ ...v, kind: 'dart' }, tr), false);
  layer.dispose(); assert.equal(f.ctx.scene.children.length, 0);
});
test('renderer retains health/selection, omits replaced bodies, and ?look=3d restores them', () => {
  for (const look of ['drawn', '3d']) {
    const f = fixture();
    const renderer = createInstancedUnits(f.ctx, { look, loadTexture: f.loadTexture, prebake: ['grunt'], side: 0 });
    f.ready(); renderer.setSelection([1]);
    const state = { tick: 3, units: [{ id: 1, kind: 'grunt', owner: 0, hp: 40, x: 2, y: 3 }] };
    renderer.update({ prev: state, next: state, alpha: 1, tick: 3 }, 0.016);
    assert.equal(renderer._batches.kinds.get('grunt').batch.mesh.count, look === '3d' ? 1 : 0);
    assert.equal(renderer._batches.bars.mesh.count, 1);
    assert.equal(renderer._batches.rings.mesh.count, 1);
    renderer.setVisibility(() => false);
    renderer.update({ prev: state, next: state, alpha: 1, tick: 3 }, 0.016);
    assert.equal(renderer.draws, 0);
    renderer.dispose(); assert.equal(f.ctx.scene.children.length, 0);
  }
});
