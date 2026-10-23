// Toaster Wars buildings (owner: sonnet): the Power Strip, Mill, Well and Toaster as blocky toys, hooked into
// viewer3d/buildings.mjs through ctx.buildingLook. Real Three.js, headless.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildToasterBody, TOASTER_BUILDING_KINDS, toasterBuildingLook } from '../play/toaster-buildings.mjs';
import { createBuildings } from '../viewer3d/buildings.mjs';

const tris = (g) => { let n = 0; g.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return n; };
const meshes = (g) => { const a = []; g.traverse((o) => { if (o.isMesh) a.push(o); }); return a; };

test('four kinds: Power Strip (core), Mill, Well, Toaster; others are left to the old builders', () => {
  assert.deepEqual([...TOASTER_BUILDING_KINDS].sort(), ['core', 'mill', 'toaster', 'well']);
  assert.equal(buildToasterBody(THREE, 'forge', 0), null);
  assert.equal(buildToasterBody(THREE, 'turret', 0), null);
});

test('each model is a small blocky toy: under a tile and a half wide, cheap, team colour on it, casts shadows', () => {
  for (const k of TOASTER_BUILDING_KINDS) {
    const p = buildToasterBody(THREE, k, 0);
    assert.equal(p.kind, k);
    assert.ok(p.body.isGroup);
    const box = new THREE.Box3().setFromObject(p.body), size = box.getSize(new THREE.Vector3());
    assert.ok(size.x <= 1.5 && size.z <= 1.5, `${k} footprint ${size.x.toFixed(2)} x ${size.z.toFixed(2)}`);
    assert.ok(size.y > 0.3 && size.y < 1.4, `${k} height ${size.y.toFixed(2)}`);
    assert.ok(box.min.y >= -0.001, `${k} sits on the ground`);
    assert.ok(tris(p.body) < 400, `${k} triangles ${tris(p.body)}`);
    assert.ok(meshes(p.body).some((m) => m.castShadow), `${k} casts a shadow`);
    // the contract of viewer3d/buildings.mjs
    for (const f of ['spin', 'pulse', 'barrels']) assert.ok(Array.isArray(p[f]), f);
    const col = (o) => meshes(o.body).map((m) => m.material.color.getHex());
    assert.notDeepEqual(col(p), col(buildToasterBody(THREE, k, 1)), `${k}: the two teams differ`);
  }
});

test('the Power Strip has five sockets and a face; the Toaster has two slices of toast that bob; the Mill has four blades that turn', () => {
  const strip = buildToasterBody(THREE, 'core', 0);
  assert.equal(strip.body.getObjectByName('sockets').children.length, 5);
  assert.ok(strip.body.getObjectByName('eye-left') && strip.body.getObjectByName('eye-right'));
  const t = buildToasterBody(THREE, 'toaster', 0);
  const slices = [t.body.getObjectByName('toast-left'), t.body.getObjectByName('toast-right')];
  assert.ok(slices.every(Boolean));
  const y0 = slices.map((s) => s.position.y);
  t.tick(0.4, 1 / 60);
  assert.ok(slices.some((s, i) => Math.abs(s.position.y - y0[i]) > 0.005), 'toast bobs');
  const m = buildToasterBody(THREE, 'mill', 0);
  assert.equal(m.body.getObjectByName('blades').children.length, 4);
  assert.ok(m.spin.length >= 1 && m.spin[0].speed > 0);
});

test('createBuildings uses ctx.buildingLook for these kinds and still builds forge and turret the old way', () => {
  const ctx = { THREE, scene: new THREE.Scene(), tileSize: 1, palette: null, gridToWorld: (x, y, h = 0, o = new THREE.Vector3()) => o.set(x - 128, h, y - 128) };
  ctx.buildingLook = toasterBuildingLook;
  const b = createBuildings(ctx);
  const mk = (id, kind, x) => ({ id, owner: 0, kind, x, y: 5, hp: 100, progress: 0, complete: true, queue: [] });
  const next = { tick: 1, units: [], structures: [mk(1, 'core', 3), mk(2, 'mill', 6), mk(3, 'well', 9), mk(4, 'toaster', 12), mk(5, 'forge', 15), mk(6, 'turret', 18)] };
  b.update({ tick: 1, alpha: 1, prev: next, next, events: [] }, 1 / 60);
  b.update({ tick: 2, alpha: 1, prev: next, next: { ...next, tick: 2 }, events: [] }, 1 / 60);
  const root = ctx.scene.getObjectByName('buildings');
  const names = root.children.map((c) => c.name);
  assert.equal(names.length, 6);
  assert.ok(root.children[0].getObjectByName('sockets'), 'the core is a Power Strip');
  assert.ok(root.children[1].getObjectByName('blades'), 'the mill has blades');
  assert.ok(root.children[4].getObjectByProperty('type', 'Mesh'), 'the forge is still drawn');
  b.dispose();
});
