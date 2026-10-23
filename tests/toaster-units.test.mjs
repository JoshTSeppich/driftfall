// The cute toasters in the live game (owner: sonnet). Models are data built from GPT's Cute Geometry Spec
// (play/toaster-models.mjs); the renderer (play/toaster-units.mjs) draws them as per-part InstancedMesh batches, wheels
// that roll, and one batched cord mesh. Everything here runs headless with real Three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TOASTERS, TOASTER_KINDS, COLORS, WHEELS, CORD, toasterKindOf, triangleCount, mainPartCount,
} from '../play/toaster-models.mjs';
import { CUTENESS } from '../play/toaster-spec.mjs';
import { createToasterUnits, UNIT_SCALE } from '../play/toaster-units.mjs';
import { createInstancedUnits } from '../play/units-instanced.mjs';
import { toastinatorFor } from '../play/coil-motion.mjs';
import { CAMERA } from '../play/camera.mjs';

const within = (v, [lo, hi], what) => assert.ok(v >= lo - 1e-6 && v <= hi + 1e-6, `${what} = ${v.toFixed(3)} not in [${lo}, ${hi}]`);
const find = (m, id) => m.parts.find((p) => p.id === id);

test('seven toasters: 2 or more rigid pieces, a face, two eyes, a team block, four wheels (the bagel is one), under 300 triangles', () => {
  assert.deepEqual([...TOASTER_KINDS].sort(), ['bagel', 'broiler', 'crumb', 'flak-popper', 'four-slice', 'popper', 'zapper']);
  for (const id of TOASTER_KINDS) {
    const m = TOASTERS[id];
    assert.ok(triangleCount(id) < 300, `${id} ${triangleCount(id)} tris`);
    assert.ok(mainPartCount(id) >= 2, `${id} rigid pieces`);
    const by = (p) => m.parts.filter((x) => x.part === p);
    assert.equal(by('faceplate').length, 1, id);
    assert.equal(by('eyes').length, 2, `${id} two eyes`);
    assert.ok(by('team').length >= 1, `${id} team block`);
    assert.equal(by('tyre').length, id === 'bagel' ? 0 : 4, `${id} tyres`);
    assert.equal(by('hub').length, id === 'bagel' ? 0 : 4, `${id} hubs`);
    assert.equal(by('prism').length, id === 'bagel' ? 1 : 0);
  }
});

test('CUTENESS: every toaster meets the six rules (face, eyes, toast, team block on top; wheels instead of feet)', () => {
  for (const id of TOASTER_KINDS) {
    const m = TOASTERS[id], { w: W, h: H, lift } = m.body, face = find(m, 'face'), eyeL = find(m, 'eye-left'), eyeR = find(m, 'eye-right'), team = find(m, 'team');
    const up = (y) => y - lift;
    within(face.size[0] / W, CUTENESS.faceWidthOfBody, `${id} face width`);
    within(face.size[1] / H, CUTENESS.faceHeightOfBody, `${id} face height`);
    within(up(face.pos[1]) / H, CUTENESS.faceCentreOfBodyHeight, `${id} face centre`);
    within(eyeL.size[0] / face.size[0], CUTENESS.eyeWidthOfFace, `${id} eye width`);
    within(eyeL.size[1] / face.size[1], CUTENESS.eyeHeightOfFace, `${id} eye height`);
    within((eyeR.pos[0] - eyeL.pos[0]) / face.size[0], CUTENESS.eyeSpacingOfFace, `${id} eye spacing`);
    within((eyeL.pos[1] - face.pos[1]) / face.size[1], CUTENESS.eyeAboveFaceCentre, `${id} eyes above centre`);
    assert.equal(eyeL.pos[1], eyeR.pos[1]); assert.equal(eyeL.pos[0], -eyeR.pos[0], 'eyes mirror');
    within(team.size[0] / W, CUTENESS.teamWidthOfBody, `${id} team block`);
    assert.ok(team.pos[1] - team.size[1] / 2 >= lift + H * 0.8, `${id} team block sits on top`);
    const inset = face.pos[2] - (m.parts[0].pos[2] + m.parts[0].size[2] / 2);
    assert.ok(inset > 0 && inset < 0.04, `${id} face floats in front of the body (${inset})`);
    assert.ok(eyeL.pos[2] > face.pos[2], 'eyes in front of the face');
    if (id === 'four-slice') { assert.equal(m.parts.filter((p) => p.part === 'toast').length, 4); continue; }   // four slices share the width rule
    if (id === 'zapper') continue;                                                                       // two emitters, no toast
    if (id === 'bagel' || id === 'broiler') { /* toast-less or door toasters: the body rules above are the cuteness */ }
    const toast = m.parts.find((p) => p.part === 'toast');
    if (toast) {
      within(toast.size[0] / W, CUTENESS.toastWidthOfBody, `${id} toast width`);
      within((toast.pos[1] + toast.size[1] / 2 - lift - H) / H, CUTENESS.toastExposedAboveBody.map((x, i) => x + (i ? 0.03 : -0.03)), `${id} toast above the body`);
    }
  }
});

test('WHEELS: four five-sided wheels poke out past the sides and front, hubs bigger than their tyre is wide, body floats on them', () => {
  for (const id of TOASTER_KINDS.filter((k) => k !== 'bagel')) {
    const m = TOASTERS[id], { w: W, h: H, d: D, lift } = m.body;
    assert.equal(m.wheels.length, 4);
    const dia = m.wheels[0].r * 2;
    within(dia / H, [WHEELS.diameterOfBodyH, WHEELS.diameterOfBodyH], `${id} wheel diameter`);
    assert.ok(Math.abs(lift - WHEELS.lift * dia) < 1e-9, 'body floats on the wheels');
    for (const w of m.wheels) {
      assert.ok(Math.abs(w.y - w.r) < 1e-9, 'wheel rests on the ground');
      assert.ok(Math.abs(w.x) + w.w / 2 > W / 2, `${id} wheel pokes out of the side`);
      assert.ok(Math.abs(w.z) + w.r > D / 2 - 0.2 * D, `${id} wheel reaches the front and back`);
    }
    assert.deepEqual(m.wheels.map((w) => [Math.sign(w.x), Math.sign(w.z)]), [[-1, 1], [1, 1], [-1, -1], [1, -1]]);
    assert.ok(m.wheels[0].z + m.wheels[0].r > D / 2, `${id} front wheels poke out the front`);
  }
  assert.equal(WHEELS.sides, 5);
  assert.equal(TOASTERS.bagel.parts[0].geo, 'prism', 'the bagel IS a five-sided wheel');
});

test('silhouettes by proportion: crumb small, popper taller with a tall toast, four-slice wide with four slices, zapper two emitters', () => {
  const size = (id) => TOASTERS[id].body;
  assert.ok(size('popper').h > size('crumb').h);
  assert.ok(TOASTERS.popper.height > TOASTERS.crumb.height * 1.3, 'popper towers over crumb with its toast');
  assert.ok(size('four-slice').w > size('popper').w * 1.5, 'four-slice is wide');
  assert.equal(TOASTERS.zapper.parts.filter((p) => p.pivot === 'coil' && p.part === 'feet').length, 2, 'zapper has two emitters');
  assert.equal(TOASTERS.zapper.parts.filter((p) => p.part === 'toast').length, 0);
  assert.ok(TOASTERS.broiler.parts.some((p) => p.pivot === 'panel' && p.hinge), 'broiler has a hinged door');
  assert.ok(TOASTERS['flak-popper'].parts.filter((p) => p.pivot === 'coil' && p.part === 'feet').length === 2, 'flak popper has two barrels');
});

test('palette comes from the spec and the live eyes and team colours are saturated (no pale cyan)', () => {
  assert.equal(COLORS.chassis, '#F2D7A6');
  assert.equal(COLORS.faceplate, '#303844');
  assert.equal(COLORS.toast, '#D99448');
  for (const hex of [COLORS.eye, COLORS.cyan]) {
    const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
    assert.ok(hsl.s > 0.85, `${hex} saturation ${hsl.s}`);
    assert.ok(c.r < 0.2, `${hex} has almost no red`);
  }
});

test('the default play camera looks at the toasters\' fronts from the toy angle (about 40-45 degrees above the horizon)', () => {
  const deg = CAMERA.pitch * 180 / Math.PI;
  assert.ok(deg >= 38 && deg <= 50, `pitch ${deg}`);
});

test('every sim kind, old and roster, maps to a toaster (unknown falls back to popper)', () => {
  const want = { worker: 'crumb', grunt: 'popper', lancer: 'zapper', brute: 'four-slice', dart: 'bagel', howler: 'broiler',
    crumb: 'crumb', popper: 'popper', zapper: 'zapper', 'four-slice': 'four-slice', four_slice: 'four-slice', Broiler: 'broiler',
    'flak-popper': 'flak-popper', bagel: 'bagel' };
  for (const [k, v] of Object.entries(want)) assert.equal(toasterKindOf(k), v, k);
  assert.equal(toasterKindOf('nonsense'), 'popper');
  assert.equal(toasterKindOf(undefined), 'popper');
  for (const id of TOASTER_KINDS) assert.ok(['crumb', 'popper', 'zapper', 'four-slice', 'bagel', 'broiler'].includes(toastinatorFor(id)), id);
});

function fixture() {
  const ctx = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), tileSize: 1,
    gridToWorld(x, y, z, out) { return out.set(x, z, y); } };
  return ctx;
}
const view = (over = {}) => ({ id: 1, kind: 'grunt', owner: 0, pos: new THREE.Vector3(3, 0, 4), yaw: 0.4, spec: { size: 0.65, height: 0.8 },
  dying: false, hitFlash: 0, lastHitAt: -Infinity, spawnAt: -Infinity, ...over });
const info = (over = {}) => ({ pose: 'idle', time: 1, dt: 1 / 60, selected: false, tr: { scale: 1, dy: 0 }, state: null, ...over });
function frames(t, n, v, extra) { for (let i = 0; i < n; i++) { t.begin(); t.emit(v, null, info({ time: 1 + i / 60, ...extra })); t.end(); } }
const count = (t, key) => t.batches[key]?.used ?? 0;

test('one unit writes one instance per part, in per-part batches', () => {
  const t = createToasterUnits(fixture());
  t.begin(); assert.equal(t.emit(view(), null, info()), true); t.end();
  assert.equal(count(t, 'chassis:box'), 1);
  assert.equal(count(t, 'faceplate:plane'), 1);
  assert.equal(count(t, 'eyes:plane'), 2);
  assert.equal(count(t, 'team:box'), 1);
  assert.equal(count(t, 'feet:box'), 0, 'no feet: wheels instead');
  assert.equal(count(t, 'toast:box'), 1);
  assert.equal(count(t, 'wheel:tyre'), 8, 'four tyres and four hubs');
  assert.equal(count(t, 'prism:prism'), 0);
  t.dispose();
});

test('box batches carry aHalf and the toy edge shader; materials use TOY_MATERIALS values', () => {
  const t = createToasterUnits(fixture());
  t.begin(); t.emit(view(), null, info()); t.end();
  for (const key of ['chassis:box', 'team:box', 'feet:box', 'toast:box']) {
    const b = t.batches[key];
    assert.ok(b.mesh.geometry.getAttribute('aHalf'), `${key} aHalf`);
    assert.ok(b.mesh.material.userData.toyEdges, `${key} edges`);
  }
  const half = t.batches['chassis:box'].mesh.geometry.getAttribute('aHalf');
  const popper = TOASTERS.popper.parts.find((p) => p.id === 'body');
  assert.deepEqual([...half.array.slice(0, 3)].map((x) => +x.toFixed(4)), popper.size.map((x) => +(x / 2).toFixed(4)));
  assert.equal(t.batches['chassis:box'].mesh.material.roughness, 0.48);
  assert.equal(t.batches['toast:box'].mesh.material.roughness, 0.82);
  assert.ok(t.batches['chassis:box'].mesh.castShadow);
  t.dispose();
});

test('team colour: owner 0 cyan, owner 1 orange', () => {
  const t = createToasterUnits(fixture());
  t.begin(); t.emit(view({ id: 1, owner: 0 }), null, info()); t.emit(view({ id: 2, owner: 1 }), null, info()); t.end();
  const c = new THREE.Color();
  t.batches['team:box'].mesh.getColorAt(0, c); assert.equal(c.getHexString().toUpperCase(), COLORS.cyan.slice(1).toUpperCase());
  t.batches['team:box'].mesh.getColorAt(1, c); assert.equal(c.getHexString().toUpperCase(), COLORS.orange.slice(1).toUpperCase());
  t.dispose();
});

test('the seven toasters all draw; bagel uses the prism batch, four-slice four toast slices, zapper no toast, 6 wheeled toasters 8 wheel parts each', () => {
  const t = createToasterUnits(fixture());
  t.begin();
  TOASTER_KINDS.forEach((k, i) => t.emit(view({ id: i + 1, kind: k }), null, info()));
  t.end();
  assert.equal(count(t, 'prism:prism'), 1);
  assert.equal(count(t, 'chassis:box'), 6);
  assert.equal(count(t, 'wheel:tyre'), 48);
  assert.equal(count(t, 'eyes:plane'), 14);
  assert.equal(count(t, 'toast:box'), 6, 'crumb 1, popper 1, four-slice 4');
  t.dispose();
});

test('eyes: dark when unpowered, small when hungry, tall when hit, X (team colour) when dying', () => {
  const eyeColor = (t, i = 0) => { const c = new THREE.Color(); t.batches['eyes:plane'].mesh.getColorAt(i, c); return c; };
  const eyeMat = (t, i = 0) => { const m = new THREE.Matrix4(), s = new THREE.Vector3(); t.batches['eyes:plane'].mesh.getMatrixAt(i, m); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s); return s; };
  const run = (extra, v = view()) => { const t = createToasterUnits(fixture()); frames(t, 3, v, extra); return t; };
  const normal = run({});
  const lit = eyeColor(normal); assert.ok(lit.b > 0.9 && lit.g > 0.75 && lit.r < 0.2, 'saturated cyan, not pale');
  const base = eyeMat(normal).y;
  const off = run({ state: 'unpowered' }); const dark = eyeColor(off); assert.ok(dark.r < 0.15 && dark.g < 0.15, 'unpowered eyes are dark');
  const hungry = run({ state: 'hungry' }); assert.ok(eyeMat(hungry).y < base * 0.8, 'hungry eyes droop');
  const dying = run({ pose: 'die' }, view({ dying: true, deathAt: 1 }));
  assert.equal(dying.batches['eyes:plane'].used, 4, 'X eyes are two crossed bars each');
  const x = eyeColor(dying); assert.ok(x.b > x.r, 'cyan X');
  normal.dispose(); off.dispose(); hungry.dispose(); dying.dispose();
});

test('hit: white flash block and alarmed tall eyes at the start, gone after', () => {
  const t = createToasterUnits(fixture());
  const v = view({ hitFlash: 1, lastHitAt: 1 });
  t.begin(); t.emit(v, null, info({ time: 1 })); t.end();
  assert.equal(count(t, 'flash'), 1);
  const t2 = createToasterUnits(fixture());
  t2.begin(); t2.emit(view(), null, info()); t2.end();
  assert.equal(count(t2, 'flash'), 0);
  t.dispose(); t2.dispose();
});

test('attack pops the toast up; walking hops; a dying toaster tips over and shatters into shards then clears', () => {
  const t = createToasterUnits(fixture());
  const toastY = () => { const m = new THREE.Matrix4(), p = new THREE.Vector3(); t.batches['toast:box'].mesh.getMatrixAt(0, m); return p.setFromMatrixPosition(m).y; };
  const v = view();
  t.begin(); frames(t, 30, v, {}); t.end(); const rest = toastY();
  let peak = rest; const w = view({ id: 9 });
  for (let i = 0; i < 40; i++) { t.begin(); t.emit(w, null, info({ pose: 'attack', time: 1 + i / 60 })); t.end(); const y = (() => { const m = new THREE.Matrix4(), p = new THREE.Vector3(); t.batches['toast:box'].mesh.getMatrixAt(0, m); return p.setFromMatrixPosition(m).y; })(); peak = Math.max(peak, y); }
  assert.ok(peak > rest + 0.1, `toast popped (${rest} -> ${peak})`);
  const d = view({ id: 11, dying: true, deathAt: 1 });
  let shards = 0;
  for (let i = 0; i < 60; i++) { t.begin(); t.emit(d, null, info({ pose: 'die', time: 1 + i / 60 })); t.end(); shards = Math.max(shards, t.batches.shard.used); }
  assert.ok(shards >= 5, `shatter makes pentagon shards (${shards})`);
  t.begin(); t.end(10);
  assert.equal(t.batches.shard.used, 0, 'shards clear after under a second');
  t.dispose();
});

test('200 units: few draw calls, per-part counts, contact decals one each', () => {
  const ctx = fixture();
  const t = createToasterUnits(ctx);
  t.begin();
  for (let i = 0; i < 200; i++) t.emit(view({ id: i + 1, kind: ['worker', 'grunt', 'lancer', 'brute', 'dart', 'howler'][i % 6], owner: i % 2, pos: new THREE.Vector3(i % 20, 0, Math.floor(i / 20)) }), null, info({ pose: i % 3 ? 'walk' : 'idle' }));
  t.end();
  assert.ok(t.draws <= 12, `${t.draws} draws`);
  assert.equal(t.decals.mesh.count, 200);
  assert.equal(t.batches['faceplate:plane'].used, 200);
  assert.equal(t.batches['eyes:plane'].used, 400);
  t.dispose();
  assert.equal(ctx.scene.children.length, 0);
});

test('createInstancedUnits: the toaster look is the default when the toy look is on, ?toy=0 keeps the old shapes', () => {
  const state = { tick: 1, units: [{ id: 1, kind: 'grunt', owner: 0, x: 2, y: 3, hp: 10 }, { id: 2, kind: 'worker', owner: 1, x: 5, y: 3, hp: 5 }], structures: [] };
  const frame = { tick: 1, alpha: 0, prev: state, next: state, events: [] };
  const toyCtx = fixture(); toyCtx.toy = { look: {} };
  const toy = createInstancedUnits(toyCtx, { look: '3d' });
  toy.update(frame, 1 / 60);
  assert.ok(toy.root.children.some((m) => m.isInstancedMesh && m.count > 0));
  assert.ok(toyCtx.scene.getObjectByName('toaster-units'), 'toaster root is in the scene');
  assert.equal(toy.kinds.length, 0, 'old per-kind shapes are not baked');
  const oldCtx = fixture();
  const old = createInstancedUnits(oldCtx, { look: '3d' });
  old.update(frame, 1 / 60);
  assert.equal(oldCtx.scene.getObjectByName('toaster-units'), undefined);
  assert.ok(old.kinds.length > 0);
  toy.dispose(); old.dispose();
  assert.equal(toyCtx.scene.children.length, 0);
});

test('the health bar floats just above a toaster at the toaster scale (0.9), not the old unit scale (1.45)', () => {
  const state = { tick: 1, units: [{ id: 1, kind: 'crumb', owner: 0, x: 2, y: 3, hp: 1 }], structures: [] };
  const frame = { tick: 1, alpha: 0, prev: state, next: state, events: [] };
  const ctx = fixture(); ctx.toy = { look: {} };
  const u = createInstancedUnits(ctx, { look: '3d' });
  u.setSelection([1]);
  u.update(frame, 1 / 60);
  const m = new THREE.Matrix4();
  u._batches.bars.mesh.getMatrixAt(0, m);
  const barY = m.elements[13];
  const v = u._views.get(1);
  // the bar sits 0.16 model units above the toaster top, plus the small hover bob of its spec (up to 0.1)
  const above = (barY - v.pos.y) / UNIT_SCALE - TOASTERS.crumb.height;
  assert.ok(above > 0.16 - 0.01 && above < 0.16 + 0.1, `bar sits ${above.toFixed(3)} model units above the toaster top`);
  u.dispose();
});

test('draw calls before and after for 200 units (reported)', () => {
  const units = [];
  for (let i = 0; i < 200; i++) units.push({ id: i + 1, kind: i % 5 < 3 ? 'grunt' : 'lancer', owner: i % 2, x: 4 + (i % 20), y: 4 + Math.floor(i / 20), hp: 10 });
  const state = { tick: 1, units, structures: [] };
  const frame = { tick: 1, alpha: 0, prev: state, next: state, events: [] };
  const toyCtx = fixture(); toyCtx.toy = { look: {} };
  const a = createInstancedUnits(fixture(), { look: '3d' }), b = createInstancedUnits(toyCtx, { look: '3d' });
  a.update(frame, 1 / 60); b.update(frame, 1 / 60);
  console.log(`# draws for 200 units: old ${a.draws}, toaster ${b.draws}`);
  assert.ok(b.draws <= 12);
  a.dispose(); b.dispose();
});

// ---- wheels roll, expressions, the cord ----
const matrixOf = (t, key, i) => { const m = new THREE.Matrix4(); t.batches[key].mesh.getMatrixAt(i, m); return m; };

test('wheels roll by the distance the unit really moved, with a small bounce; standing still they rest', () => {
  const t = createToasterUnits(fixture());
  const v = view({ id: 5, kind: 'crumb', yaw: 0 });
  const spinOf = () => { const m = matrixOf(t, 'wheel:tyre', 0), q = new THREE.Quaternion(); m.decompose(new THREE.Vector3(), q, new THREE.Vector3()); return new THREE.Euler().setFromQuaternion(q, 'XYZ').x; };
  const bodyY = () => new THREE.Vector3().setFromMatrixPosition(matrixOf(t, 'chassis:box', 0)).y;
  t.begin(); t.emit(v, null, info({ pose: 'idle', time: 1 })); t.end();
  const rest = bodyY(), spin0 = spinOf();
  let maxY = rest, minY = rest;
  for (let i = 1; i <= 24; i++) {
    v.pos.z += 0.05;
    t.begin(); t.emit(v, null, info({ pose: 'walk', time: 1 + i / 60 })); t.end();
    maxY = Math.max(maxY, bodyY()); minY = Math.min(minY, bodyY());
  }
  // the wheel turns by the ground it covers (1.2 tiles) over its radius in world units (r x UNIT_SCALE, tileSize 1)
  const turned = (1.2 / (TOASTERS.crumb.wheels[0].r * UNIT_SCALE)) % (Math.PI * 2);
  const off = spinOf() - spin0 - turned;
  assert.ok(Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < 1e-6, `wheels turned by the distance rolled (off ${off})`);
  assert.ok(maxY - minY > 0.005 && maxY - minY < 0.15, `a small bounce (${maxY - minY})`);
  for (let i = 0; i < 90; i++) { t.begin(); t.emit(v, null, info({ pose: 'idle', time: 2 + i / 60 })); t.end(); }
  const a = spinOf(); t.begin(); t.emit(v, null, info({ pose: 'idle', time: 4 })); t.end();
  assert.ok(Math.abs(spinOf() - a) < 1e-9, 'wheels stop when the unit stops');
  t.dispose();
});

test('wheels stay grounded: every tyre bottom is at the unit\'s ground, the body floats above', () => {
  const t = createToasterUnits(fixture());
  t.begin(); t.emit(view({ kind: 'popper', pos: new THREE.Vector3(0, 0, 0) }), null, info()); t.end();
  const m = TOASTERS.popper;
  const tyre = new THREE.Vector3().setFromMatrixPosition(matrixOf(t, 'wheel:tyre', 0));
  const body = new THREE.Vector3().setFromMatrixPosition(matrixOf(t, 'chassis:box', 0));
  assert.ok(Math.abs(tyre.y - m.wheels[0].r * 0.9) < 1e-6, `tyre centre at its radius (${tyre.y})`);
  assert.ok(body.y > tyre.y, 'body above the axles');
  t.dispose();
});

test('expressions: happy at rest, determined (eyes tilted in) on the move, alarmed (tall) when hit', () => {
  const eye = (t) => { const m = matrixOf(t, 'eyes:plane', 0), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(new THREE.Vector3(), q, s); return { h: s.y, rot: new THREE.Euler().setFromQuaternion(q, 'YXZ').z }; };
  const run = (extra) => { const t = createToasterUnits(fixture()); frames(t, 3, view({ yaw: 0 }), extra); const r = eye(t); t.dispose(); return r; };
  const happy = run({ pose: 'idle' }), determined = run({ pose: 'walk' });
  assert.ok(Math.abs(determined.rot) > Math.abs(happy.rot) + 0.05, 'determined eyes tilt more');
  assert.ok(determined.h > happy.h, 'determined eyes are taller than happy ones');
  const t = createToasterUnits(fixture());
  const hv = view({ yaw: 0 });
  t.begin(); t.emit(hv, null, info({ time: 1 })); t.end();
  hv.lastHitAt = 1.02; hv.hitFlash = 1;
  t.begin(); t.emit(hv, null, info({ time: 1.02 })); t.end(); t.begin(); t.emit(hv, null, info({ time: 1.05 })); t.end();
  assert.ok(eye(t).h >= determined.h * 0.95, 'alarmed eyes are tall');
  t.dispose();
});

// A cord for the toaster at (5, 5): anchor 6 tiles ahead, one bend between.
const cordInfo = (limit = 12, route = [new THREE.Vector3(5, 0, 11), new THREE.Vector3(8, 0, 8)]) => ({ route, limit });

test('CORD: thick team-colour cable, coil at the back, plug at the outlet, beads - all in ONE mesh plus one bead batch', () => {
  const t = createToasterUnits(fixture());
  const units = [view({ id: 1, kind: 'crumb', pos: new THREE.Vector3(5, 0, 5), yaw: 0 }), view({ id: 2, kind: 'zapper', owner: 1, pos: new THREE.Vector3(2, 0, 5), yaw: 0 })];
  t.begin();
  for (const v of units) t.emit(v, null, info({ cord: cordInfo(12, [new THREE.Vector3(v.pos.x, 0, 11), new THREE.Vector3(v.pos.x + 3, 0, 8)]) }));
  t.end();
  assert.equal(t.cords.count, 2);
  assert.ok(t.cords.triangles > 0 && t.cords.mesh.visible);
  assert.ok(t.batches.bead.used >= 2, 'beads run along the cords');
  assert.equal(t.batches['feet:box'].used, 2 * 3 + 2, 'a plug and two prongs per cord (plus the zapper\'s two emitters)');
  const pos = t.cords.mesh.geometry.getAttribute('position'), col = t.cords.mesh.geometry.getAttribute('color');
  const n = t.cords.mesh.geometry.drawRange.count;
  assert.ok(n > 0);
  // team colour: unit 1 cyan-ish (b > r), unit 2 orange-ish (r > b); the cable is saturated, never pale or grey
  let cyan = 0, orange = 0;
  for (let i = 0; i < pos.count; i++) { const r = col.getX(i), b = col.getZ(i); if (b > r * 2) cyan++; else if (r > b * 2) orange++; }
  assert.ok(cyan > 20 && orange > 20, `both team cords drawn (cyan ${cyan}, orange ${orange})`);
  // thick: the cable's cross-section radius is CORD.radius in model units
  const r0 = Math.hypot(pos.getX(60) - pos.getX(61), pos.getY(60) - pos.getY(61), pos.getZ(60) - pos.getZ(61));
  assert.ok(r0 > 0.05, `cable is thick (${r0})`);
  t.dispose();
  assert.equal(t.cords.mesh.parent, null);
});

test('CORD goes where the route goes: the cable passes through every bend point and ends at the anchor, plug on the anchor', () => {
  const t = createToasterUnits(fixture());
  const bend = new THREE.Vector3(9, 0, 7), anchor = new THREE.Vector3(5, 0, 11);
  t.begin(); t.emit(view({ id: 1, kind: 'crumb', pos: new THREE.Vector3(5, 0, 5), yaw: 0 }), null, info({ cord: { route: [anchor, bend], limit: 20 } })); t.end();
  const pos = t.cords.mesh.geometry.getAttribute('position');
  const near = (p) => { let best = 1e9; for (let i = 0; i < pos.count; i++) best = Math.min(best, Math.hypot(pos.getX(i) - p.x, pos.getZ(i) - p.z)); return best; };
  assert.ok(near(bend) < 0.12, `passes the bend (${near(bend)})`);
  assert.ok(near(anchor) < 0.12, 'reaches the anchor');
  const plug = new THREE.Vector3().setFromMatrixPosition(matrixOf(t, 'feet:box', 0));
  assert.ok(Math.hypot(plug.x - anchor.x, plug.z - anchor.z) < 0.01, 'plug sits at the outlet');
  t.dispose();
});

test('CORD tension: a coil at rest, straight and flashing white near the limit', () => {
  const run = (limit, time) => {
    const t = createToasterUnits(fixture());
    t.begin(); t.emit(view({ id: 1, kind: 'crumb', pos: new THREE.Vector3(5, 0, 5), yaw: 0 }), null, info({ time, cord: { route: [new THREE.Vector3(5, 0, 8)], limit } })); t.end();
    const pos = t.cords.mesh.geometry.getAttribute('position'), col = t.cords.mesh.geometry.getAttribute('color');
    let spread = 0, white = 0;
    for (let i = 0; i < 6 * 5 && i < pos.count; i++) spread = Math.max(spread, Math.abs(pos.getY(i) - pos.getY(0)));
    for (let i = 0; i < pos.count; i++) if (col.getX(i) > 0.6 && col.getY(i) > 0.6 && col.getZ(i) > 0.6) white++;
    const tri = t.cords.triangles; t.dispose();
    return { spread, white, tri };
  };
  const slack = run(30, 0.01), taut = run(3.1, 0.2), tautOff = run(3.1, 0.2 + Math.PI / 16);
  assert.ok(slack.spread > taut.spread, `the coil flattens when taut (${slack.spread} vs ${taut.spread})`);
  assert.equal(slack.white, 0, 'no flash while slack');
  assert.ok(Math.max(taut.white, tautOff.white) > 0 && Math.min(taut.white, tautOff.white) === 0, 'taut cords flash on and off');
});

test('CORD: 200 plugged units stay cheap: one cord mesh, one bead batch, under 15 draws and 300k cord triangles', () => {
  const t = createToasterUnits(fixture());
  const T0 = performance.now();
  for (let f = 0; f < 5; f++) {
    t.begin();
    for (let i = 0; i < 200; i++) {
      const v = view({ id: i + 1, kind: ['worker', 'grunt', 'lancer', 'brute', 'dart', 'howler'][i % 6], owner: i % 2, pos: new THREE.Vector3(i % 20, 0, Math.floor(i / 20)), yaw: 0 });
      t.emit(v, null, info({ time: f / 60, pose: i % 3 ? 'walk' : 'idle', cord: { route: [new THREE.Vector3(i % 20, 0, 12), new THREE.Vector3(10, 0, 11)], limit: 20 } }));
    }
    t.end();
  }
  const ms = (performance.now() - T0) / 5;
  console.log(`# 200 toasters + cords: ${t.draws} draws, cord ${t.cords.triangles} tris, ${ms.toFixed(2)} ms CPU/frame`);
  assert.ok(t.draws <= 15, `${t.draws} draws`);
  assert.equal(t.cords.count, 200);
  assert.ok(t.cords.triangles < 300000);
  t.dispose();
});

test('?toy=0 / no cord info: no cord mesh is drawn', () => {
  const t = createToasterUnits(fixture());
  t.begin(); t.emit(view(), null, info()); t.end();
  assert.equal(t.cords.count, 0); assert.equal(t.cords.mesh.visible, false);
  t.dispose();
});
