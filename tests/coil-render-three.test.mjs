// Coil Engine GPU skinned renderer (owner: sonnet). Headless: no WebGL, so these pin geometry, packing, LOD,
// springs and CPU cost. GPU frame time is NOT measured here.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PART_SHAPES, buildKindGeometry, KIND_SPECS, restJoints, packJoints, lodFor, stepSpring,
  createCoilRenderer, stubPose,
} from '../engine/coil/render-three.mjs';

test('every kind is 3-6 parts, under 300 triangles, five-sided rounds', () => {
  for (const [name, spec] of Object.entries(KIND_SPECS)) {
    assert.ok(spec.parts.length >= 3 && spec.parts.length <= 6, name);
    const g = buildKindGeometry(spec, 0);
    assert.ok(g.attributes.position.count / 3 <= 300, name + ' tris');
    assert.ok(g.attributes.aJoint && g.attributes.aTint && g.attributes.aSmooth);
  }
  assert.equal(PART_SHAPES.prism5.sides, 5);
  assert.equal(PART_SHAPES.cone5.sides, 5);
  // a prism5 has 5 side quads (10 tris) + 2 caps (3 tris each) = 16
  const g = buildKindGeometry({ parts: [{ shape: 'prism5', size: [1, 1, 1], joint: 0 }], joints: [{}] }, 0);
  assert.equal(g.attributes.position.count / 3, 16);
});

test('joint packing is 8 floats per joint and rest pose is identity-rotated', () => {
  const spec = KIND_SPECS.crumb;
  const n = spec.joints.length;
  const rest = restJoints(spec);
  assert.equal(rest.length, n * 8);
  assert.equal(rest[7], 1); // qw
  const tex = new Float32Array(n * 8 * 4);
  packJoints(tex, 2, n, rest);
  assert.deepEqual(Array.from(tex.slice(2 * n * 8, 3 * n * 8)), Array.from(rest));
});

test('LOD: near full, far uses at most 4 joints and no more triangles', () => {
  assert.equal(lodFor(10, 60), 0);
  assert.equal(lodFor(90, 60), 1);
  const far = buildKindGeometry(KIND_SPECS.fourslice, 1);
  let max = 0;
  const a = far.attributes.aJoint.array;
  for (let i = 0; i < a.length; i++) max = Math.max(max, a[i]);
  assert.ok(max <= 3, 'far joints <= 4');
  assert.ok(far.attributes.position.count <= buildKindGeometry(KIND_SPECS.fourslice, 0).attributes.position.count);
});

test('spring lags then settles, and stays stable at big dt', () => {
  const s = { x: 0, v: 0 };
  stepSpring(s, 1, 1 / 60, 120, 14);
  assert.ok(s.x > 0 && s.x < 1);
  for (let i = 0; i < 300; i++) stepSpring(s, 1, 1 / 60, 120, 14);
  assert.ok(Math.abs(s.x - 1) < 0.01);
  const t = { x: 0, v: 0 };
  stepSpring(t, 1, 1, 400, 2);
  assert.ok(Number.isFinite(t.x) && Math.abs(t.x) < 10);
});

test('renderer: instanced meshes per kind per LOD, draw calls bounded, 200 units cheap on CPU', () => {
  const r = createCoilRenderer(THREE, { maxPerKind: 256, camera: new THREE.PerspectiveCamera() });
  const kinds = Object.keys(KIND_SPECS);
  const units = [];
  for (let i = 0; i < 200; i++) units.push(stubPose(kinds[i % kinds.length], i, 0, i));
  r.update(units, 1 / 60, 0);
  const st = r.stats();
  assert.ok(st.drawCalls <= kinds.length * 3, 'draw calls ' + st.drawCalls);
  assert.equal(st.instances, 200);
  assert.ok(st.triangles > 0);
  const t0 = performance.now();
  for (let f = 0; f < 120; f++) r.update(units.map((u, i) => stubPose(u.kind, u.id, f / 60, i)), 1 / 60, f / 60);
  const per = (performance.now() - t0) / 120;
  assert.ok(per < 4, 'CPU ms/frame ' + per.toFixed(2));
  r.dispose();
});

test('far units go to LOD1; vanished units are dropped', () => {
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 20, 0);
  cam.updateMatrixWorld();
  const r = createCoilRenderer(THREE, { maxPerKind: 8, camera: cam, lodDistance: 50 });
  const near = stubPose('crumb', 1, 0, 0);
  near.x = 0; near.z = 0;
  const far = stubPose('crumb', 2, 0, 0);
  far.x = 200; far.z = 0;
  r.update([near, far], 1 / 60, 0);
  const s = r.stats();
  assert.equal(s.perLod[0], 1);
  assert.equal(s.perLod[1], 1);
  r.update([near], 1 / 60, 0.1);
  assert.equal(r.stats().instances, 1);
});

test('attachment spring: sudden yaw swings the helmet, then it settles', () => {
  const r = createCoilRenderer(THREE, { maxPerKind: 4 });
  const u = stubPose('crumb', 1, 0, 0);
  r.update([u], 1 / 60, 0);
  const rest = r.debugJoint('crumb', 1, 'helmet');
  u.yaw = 1.5;
  r.update([u], 1 / 60, 1 / 60);
  const kicked = r.debugJoint('crumb', 1, 'helmet');
  assert.notDeepEqual(kicked.slice(4), rest.slice(4));
  for (let i = 0; i < 240; i++) r.update([u], 1 / 60, 1 + i / 60);
  const settled = r.debugJoint('crumb', 1, 'helmet');
  for (let k = 4; k < 8; k++) assert.ok(Math.abs(settled[k] - rest[k]) < 0.02);
});
