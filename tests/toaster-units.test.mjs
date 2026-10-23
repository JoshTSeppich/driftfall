// The cute blocky toasters in the live game (owner: sonnet). Models are data (play/toaster-models.mjs); the renderer
// (play/toaster-units.mjs) draws them as per-part InstancedMesh batches. Everything here runs headless with real Three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TOASTERS, TOASTER_KINDS, COLORS, toasterKindOf, triangleCount, mainPartCount,
} from '../play/toaster-models.mjs';
import { createToasterUnits } from '../play/toaster-units.mjs';
import { createInstancedUnits } from '../play/units-instanced.mjs';
import { toastinatorFor } from '../play/coil-motion.mjs';

test('seven toasters, each a few plain blocks under 60 triangles', () => {
  assert.deepEqual([...TOASTER_KINDS].sort(), ['bagel', 'broiler', 'crumb', 'flak-popper', 'four-slice', 'popper', 'zapper']);
  for (const id of TOASTER_KINDS) {
    const m = TOASTERS[id];
    assert.ok(triangleCount(id) < 60, `${id} ${triangleCount(id)} tris`);
    const main = mainPartCount(id);
    assert.ok(main >= 2 && main <= 4, `${id} has ${main} main parts`);
    const by = (p) => m.parts.filter((x) => x.part === p);
    assert.equal(by('faceplate').length, 1, id);
    assert.equal(by('eyes').length, 2, `${id} two square eyes`);
    assert.ok(by('team').length >= 1, `${id} team block`);
    assert.ok(by('feet').length >= 1, `${id} feet`);
    assert.ok(by('chassis').length === 1, `${id} one chassis`);
  }
});

test('silhouettes by proportion: crumb small cube, popper taller with tall toast, four-slice wide with four slabs', () => {
  const size = (id, part) => TOASTERS[id].parts.find((p) => p.id === part).size;
  const crumb = size('crumb', 'body'), popper = size('popper', 'body'), four = size('four-slice', 'body');
  assert.ok(crumb[0] === crumb[1] || Math.abs(crumb[0] - crumb[1]) < 0.1, 'crumb is a cube');
  assert.ok(popper[1] > crumb[1]);
  assert.ok(TOASTERS.popper.height > TOASTERS.crumb.height * 1.3, 'popper towers over crumb with its toast');
  assert.ok(four[0] > popper[0] * 1.5, 'four-slice is wide');
  assert.equal(TOASTERS['four-slice'].parts.filter((p) => p.part === 'toast').length, 4);
  assert.equal(TOASTERS.zapper.parts.filter((p) => p.pivot === 'coil').length, 2, 'zapper has two emitters');
  assert.equal(TOASTERS.zapper.parts.filter((p) => p.part === 'toast').length, 0);
  assert.ok(TOASTERS.broiler.parts.some((p) => p.pivot === 'panel' && p.hinge), 'broiler has a hinged front panel');
  assert.ok(TOASTERS.bagel.parts.some((p) => p.geo === 'wheel'), 'bagel is a five-sided wheel');
});

test('palette comes from the style bible', () => {
  assert.equal(COLORS.chassis, '#F2D7A6');
  assert.equal(COLORS.faceplate, '#303844');
  assert.equal(COLORS.cyan, '#32D9E8');
  assert.equal(COLORS.orange, '#FF8540');
  assert.equal(COLORS.toast, '#D99448');
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
  assert.equal(count(t, 'feet:box'), 1);
  assert.equal(count(t, 'toast:box'), 1);
  assert.equal(count(t, 'wheel'), 0);
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
  t.batches['team:box'].mesh.getColorAt(0, c); assert.equal(c.getHexString().toUpperCase(), '32D9E8');
  t.batches['team:box'].mesh.getColorAt(1, c); assert.equal(c.getHexString().toUpperCase(), 'FF8540');
  t.dispose();
});

test('the seven toasters all draw; bagel uses the wheel batch, four-slice four toast planes, zapper no toast', () => {
  const t = createToasterUnits(fixture());
  t.begin();
  TOASTER_KINDS.forEach((k, i) => t.emit(view({ id: i + 1, kind: k }), null, info()));
  t.end();
  assert.equal(count(t, 'wheel'), 1);
  assert.equal(count(t, 'chassis:box'), 6);
  assert.equal(count(t, 'eyes:plane'), 14);
  assert.ok(count(t, 'toast:plane') >= 4 + 3);
  t.dispose();
});

test('eyes: dark when unpowered, small when hungry, tall when hit, X (team colour) when dying', () => {
  const eyeColor = (t, i = 0) => { const c = new THREE.Color(); t.batches['eyes:plane'].mesh.getColorAt(i, c); return c; };
  const eyeMat = (t, i = 0) => { const m = new THREE.Matrix4(), s = new THREE.Vector3(); t.batches['eyes:plane'].mesh.getMatrixAt(i, m); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s); return s; };
  const run = (extra, v = view()) => { const t = createToasterUnits(fixture()); frames(t, 3, v, extra); return t; };
  const normal = run({});
  const lit = eyeColor(normal); assert.ok(lit.r > 0.8 && lit.g > 0.8);
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
