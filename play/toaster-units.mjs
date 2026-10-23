// The cute blocky toasters, drawn live (owner: sonnet). play/units-instanced.mjs hands each visible unit to emit(); this
// turns it into a few instances in per-PART InstancedMesh batches (chassis, faceplate, eyes, team, feet, toast, plus the
// bagel wheel, the hit-flash block, death shards) sharing five TOY_MATERIALS with the toy edge shader (applyToyEdges and a
// per-instance aHalf) and one contact-shadow decal per unit. Poses come from the Coil motion graph (hop walk, toast pop on
// attack, recoil, hit flinch, spring knock-back, fall and shatter). Presentation only: nothing here reads or writes the sim.
//
//   createToasterUnits(ctx, { scale, capacity }) -> { begin(), emit(v, u, info), end(time?), height(kind), dispose(),
//                                                      draws, root, batches, decals }
//   info = { pose: 'idle'|'walk'|'attack'|'mine'|'die', time, dt, selected, tr: { scale }, state: 'fed'|'hungry'|'unpowered'|null }
//
// Model: play/toaster-models.mjs (feet at y = 0, front +Z, model units; the unit scale turns them into world units).

import * as THREE from 'three';
import { TOASTERS, COLORS, toasterKindOf } from './toaster-models.mjs';
import { TOY_MATERIALS, applyToyEdges, createContactShadows } from './toy-render.mjs';
import { createCoilUnits } from './coil-motion.mjs';
import { shardAt } from '../engine/coil/motions.mjs';

export const UNIT_SCALE = 1.45;           // tiles per model unit, same as the old shapes so footprints and bars still fit
const START_CAPACITY = 32;
const SHARD_SECONDS = 0.8;
const SHARD_SCALE = 3.2;                  // shard radii are ~0.06-0.12 m; blow them up so they read from the RTS camera
const HUNGRY_DROOP = 0.35;                // radians the toast leans forward when the unit is hungry
const FLASH_ON = 0.4;                     // v.hitFlash above this draws the white block (the first ~85 ms of a hit)

const MATERIAL_FOR = { chassis: 'chassis', faceplate: 'faceplate', eyes: 'faceplate', team: 'team', feet: 'feet', toast: 'toast', wheel: 'chassis' };
const EDGED = new Set(['chassis', 'team', 'feet', 'toast']);

export function createToasterUnits(ctx, { scale = UNIT_SCALE, capacity = 512 } = {}) {
  const unitScale = scale * (ctx.tileSize ?? 1);
  const root = new THREE.Group();
  root.name = 'toaster-units';
  ctx.scene.add(root);

  // ----- materials: five shared, straight from the RENDERING.md table -----
  const mats = {};
  for (const name of ['chassis', 'faceplate', 'team', 'feet', 'toast']) {
    const t = TOY_MATERIALS[name];
    // team is white here: the instance colour is the side's cyan/orange
    mats[name] = new THREE.MeshStandardMaterial({ color: name === 'team' ? '#ffffff' : t.color, roughness: t.roughness, metalness: t.metalness });
    mats[name].name = `toaster-${name}`;
  }
  mats.toast.side = THREE.DoubleSide;
  // Eyes glow: emissive follows the instance colour, so a dark instance is a dark (unpowered) eye.
  mats.eyes = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0, emissive: '#ffffff', emissiveIntensity: 1.6 });
  mats.eyes.name = 'toaster-eyes';
  mats.eyes.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;');
  };
  mats.eyes.customProgramCacheKey = () => 'toaster-eyes-v1';
  mats.flash = new THREE.MeshBasicMaterial({ color: COLORS.flash, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false });
  mats.shard = new THREE.MeshStandardMaterial({ color: COLORS.chassis, roughness: 0.5, flatShading: true });
  const edges = ['chassis', 'team', 'feet', 'toast'].map((n) => applyToyEdges(mats[n]));

  // ----- geometry: unit boxes (aHalf attached per batch), planes facing +Z, a five-sided prism for the wheel -----
  const geos = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    plane: () => new THREE.PlaneGeometry(1, 1),
    wheel: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 5).rotateX(Math.PI / 2),
    shard: () => new THREE.CylinderGeometry(0.5, 0.5, 0.3, 5),
  };

  // ----- batches: one InstancedMesh each, doubling when full, rewritten every frame -----
  const batches = {};
  function makeBatch(key, geo, material, { half = false, cast = false, receive = false, order = 0 } = {}) {
    const b = { key, geo, material, half, cast, receive, order, mesh: null, cap: 0, used: 0, halfAttr: null };
    grow(b, START_CAPACITY);
    batches[key] = b;
    return b;
  }
  function grow(b, cap) {
    const old = b.mesh;
    const mesh = new THREE.InstancedMesh(b.geo, b.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (b.half) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      a.setUsage(THREE.DynamicDrawUsage);
      if (b.halfAttr) a.array.set(b.halfAttr.array.subarray(0, b.used * 3));
      b.geo.setAttribute('aHalf', a);
      b.halfAttr = a;
    }
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, b.used * 16));
      mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, b.used * 3));
      root.remove(old); old.dispose();
    }
    mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
    mesh.frustumCulled = false; mesh.renderOrder = b.order; mesh.count = 0; mesh.name = `toaster-${b.key}`;
    root.add(mesh);
    b.mesh = mesh; b.cap = cap;
  }
  const solid = { cast: true, receive: true, half: true };
  makeBatch('chassis:box', geos.box(), mats.chassis, solid);
  makeBatch('wheel', geos.wheel(), mats.chassis, { cast: true, receive: true });
  makeBatch('faceplate:plane', geos.plane(), mats.faceplate, { receive: true });
  makeBatch('eyes:plane', geos.plane(), mats.eyes, { order: 1 });
  makeBatch('team:box', geos.box(), mats.team, solid);
  makeBatch('feet:box', geos.box(), mats.feet, solid);
  makeBatch('toast:box', geos.box(), mats.toast, solid);
  makeBatch('toast:plane', geos.plane(), mats.toast, { cast: true, receive: true });
  makeBatch('flash', geos.box(), mats.flash, { order: 3 });
  makeBatch('shard', geos.shard(), mats.shard, { cast: true });
  const decals = createContactShadows(ctx, { capacity });
  const decalList = [];

  function put(b, matrix, color, size) {
    if (b.used >= b.cap) grow(b, b.cap * 2);
    const i = b.used++;
    b.mesh.setMatrixAt(i, matrix);
    if (color) b.mesh.setColorAt(i, color);
    if (b.half && size) b.halfAttr.setXYZ(i, size[0] / 2, size[1] / 2, size[2] / 2);
  }

  const coil = createCoilUnits();
  const anim = new Map();          // unit id -> { seen, strikeSeen, hitAt, dead, shattered }
  const shards = [];               // { s, t0, ox, oy, oz }
  let now = 0;

  const teamColor = [new THREE.Color(COLORS.cyan), new THREE.Color(COLORS.orange)];
  const eyeOn = new THREE.Color(COLORS.eye), eyeOff = new THREE.Color(COLORS.eyeOff);
  const tmpCol = new THREE.Color();

  // scratch
  const q = new THREE.Quaternion(), yawQ = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const F = new THREE.Matrix4(), B = new THREE.Matrix4(), P = new THREE.Matrix4(), L = new THREE.Matrix4(), M = new THREE.Matrix4(), T = new THREE.Matrix4(), R = new THREE.Matrix4();
  const quatIdentity = new THREE.Quaternion(), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);

  function begin() {
    for (const b of Object.values(batches)) b.used = 0;
    decalList.length = 0;
    for (const a of anim.values()) a.seen = false;
  }

  // Expression decides the eye boxes: normal, alarmed (tall), hungry (low and half-shut), dead (X), unpowered (dark).
  function eyeMode(poseName, pose, hunger) {
    if (poseName === 'die' || pose.state === 'die') return 'x';
    if (pose.flinch > 0.05 || pose.state === 'hit') return 'alarmed';
    if (hunger === 'hungry') return 'hungry';
    return 'normal';
  }

  function emit(v, u, info = {}) {
    const poseName = info.pose ?? 'idle';
    const model = TOASTERS[toasterKindOf(v.kind)];
    const dt = Math.max(0, Math.min(0.1, info.dt ?? 1 / 60));
    now = Math.max(now, info.time ?? now);
    const hunger = info.state ?? null;
    const powered = hunger !== 'unpowered';

    let a = anim.get(v.id);
    if (!a) { a = { seen: true, hitAt: v.lastHitAt, dead: false, shattered: false, state: 'idle' }; anim.set(v.id, a); coil.pose(v.id, model.id, { dt: 0 }); }   // the graph must exist before it is triggered
    a.seen = true;
    const yaw = v.yaw ?? 0;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const facing = { x: sin, z: cos };

    // sim -> motion graph events (edge triggered)
    if (v.dying && !a.dead) { a.dead = true; coil.die(v.id, { dir: { x: -sin, z: -cos } }); }
    else if (!v.dying) {
      if (poseName === 'attack' && a.state !== 'strike') coil.act(v.id, 'strike', { dir: facing });
      if (v.lastHitAt !== a.hitAt) { a.hitAt = v.lastHitAt; coil.act(v.id, 'hit', { dir: { x: -sin, z: -cos } }); }
    }
    const walking = poseName === 'walk';
    const pose = coil.pose(v.id, model.id, { speed: walking ? 1.7 : 0, dt, gathering: poseName === 'mine', carrying: (u?.carrying ?? 0) > 0 });
    a.state = pose.state;
    for (const ev of pose.events) {
      if (ev.type === 'shatter' && !a.shattered) {
        a.shattered = true;
        for (const sh of ev.shards) shards.push({ s: sh, t0: info.time ?? now, ox: v.pos.x, oy: v.pos.y, oz: v.pos.z });
      }
    }
    if (pose.visible === false) return true;   // shattered: only shards remain

    // ----- the unit transform -----
    const sc = unitScale * (info.tr?.scale ?? 1) * pose.scale;
    const wx = v.pos.x + (pose.offX + pose.shakeX) * unitScale;
    const wz = v.pos.z + (pose.offZ + pose.shakeZ) * unitScale;
    // lean is world-space; turn it into the unit's own axes (tip toward +x = roll about z, toward +z = pitch about x)
    const lx = pose.leanX * cos - pose.leanZ * sin, lz = pose.leanX * sin + pose.leanZ * cos;
    const recoil = pose.toastPop * 0.07;
    e.set(lz - pose.flinch * 0.35 - pose.toastPop * 0.12 + (hunger === 'hungry' ? 0.06 : 0), 0, -lx, 'XYZ');
    q.setFromEuler(e);
    q.premultiply(yawQ.setFromAxisAngle(AXIS_Y, yaw));
    F.compose(p.set(wx, v.pos.y + pose.lift * unitScale, wz), q, s.setScalar(sc));
    // recoil: slide back along the facing
    F.multiply(T.makeTranslation(0, 0, -recoil));
    // squash and stretch about the feet
    const sxz = 1 + 0.5 * pose.squash - 0.15 * pose.stretch, sy = 1 - pose.squash + pose.stretch - (hunger === 'hungry' ? 0.06 : 0);
    B.copy(F).multiply(T.makeScale(sxz, sy, sxz));

    // pivots
    const toastY = pose.toastPop * 0.46 + pose.slotOpen * 0.05 + pose.flinch * 0.12 - (hunger === 'hungry' ? 0.06 : 0);
    const mode = eyeMode(poseName, pose, hunger);
    const team = teamColor[v.owner === 1 ? 1 : 0];
    const pivotMatrix = (part, out) => {
      switch (part.pivot) {
        case 'body': return out.copy(B);
        case 'feet': return out.copy(F);
        case 'toast': {
          out.copy(B).multiply(T.makeTranslation(0, model.top, 0));
          out.multiply(R.makeRotationX(hunger === 'hungry' ? HUNGRY_DROOP : -pose.flinch * 0.2));
          return out.multiply(T.makeTranslation(0, toastY - model.top, 0));
        }
        case 'coil': return out.copy(B).multiply(T.makeTranslation(0, pose.toastPop * 0.12 + pose.glow * 0.02, 0));
        case 'panel': {
          const h = part.hinge, open = Math.min(1.2, pose.slotOpen * 0.5 + pose.toastPop * 0.9);
          out.copy(B).multiply(T.makeTranslation(h[0], h[1], h[2]));
          out.multiply(R.makeRotationX(-open));
          return out.multiply(T.makeTranslation(-h[0], -h[1], -h[2]));
        }
        case 'wheel': {
          const c = part.pos;
          out.copy(B).multiply(T.makeTranslation(c[0], c[1], c[2]));
          out.multiply(R.makeRotationZ(-pose.spin));
          return out.multiply(T.makeTranslation(-c[0], -c[1], -c[2]));
        }
        default: return out.copy(B);
      }
    };

    for (const part of model.parts) {
      pivotMatrix(part, P);
      const pos = part.pos;
      let size = part.size;
      let py = pos[1];
      let color = null;
      if (part.part === 'eyes') {
        const [w, h, d] = size;
        if (mode === 'alarmed') size = [w * 0.85, h * 2, d];
        else if (mode === 'hungry') { size = [w * 1.1, h * 0.5, d]; py -= h * 0.5; }
        if (mode === 'x') {
          // X eyes: two crossed bars per eye in the team colour
          for (const ang of [Math.PI / 4, -Math.PI / 4]) {
            L.compose(p.set(pos[0], py, pos[2]), q.setFromAxisAngle(AXIS_Z, ang), s.set(w * 1.5, h * 0.3, 1));
            M.multiplyMatrices(P, L);
            put(batches['eyes:plane'], M, team);
          }
          continue;
        }
        color = !powered ? eyeOff : eyeOn;
      } else if (part.part === 'team') color = team;
      L.compose(p.set(pos[0], py, pos[2]), part.rotZ ? q.setFromAxisAngle(AXIS_Z, part.rotZ) : quatIdentity, s.set(size[0], size[1], size[2]));
      M.multiplyMatrices(P, L);
      const key = part.geo === 'wheel' ? 'wheel' : `${part.part}:${part.geo}`;
      put(batches[key], M, color, part.geo === 'box' ? part.size : null);
    }

    // hit flash: a white block just over the chassis for the first frames of a hit
    if (v.hitFlash > FLASH_ON) {
      const body = model.parts.find((x) => x.pivot === 'body' && x.part === 'chassis') ?? model.parts.find((x) => x.part === 'chassis');
      pivotMatrix(body, P);
      L.compose(p.set(body.pos[0], body.pos[1], body.pos[2]), quatIdentity, s.set(body.size[0] * 1.06, body.size[1] * 1.06, body.size[2] * 1.06));
      put(batches.flash, M.multiplyMatrices(P, L));
    }

    // contact decal on the ground
    if (!v.dying) decalList.push(decalFor(decalList.length, v.pos.x, v.pos.y, v.pos.z, model.radius * 2 * sc * 1.02));
    return true;
  }

  const decalPool = [];
  function decalFor(i, x, y, z, d) {
    const o = decalPool[i] ?? (decalPool[i] = { x: 0, y: 0, z: 0, width: 0, depth: 0 });
    o.x = x; o.y = y; o.z = z; o.width = d; o.depth = d;
    return o;
  }

  function end(time) {
    if (time !== undefined) now = Math.max(now, time);
    // shards: pentagon prisms flying on their ballistic arcs, cleared after SHARD_SECONDS
    for (let i = shards.length - 1; i >= 0; i--) if (now - shards[i].t0 > SHARD_SECONDS) shards.splice(i, 1);
    for (const sh of shards) {
      const age = Math.max(0, now - sh.t0);
      const o = shardAt(sh.s, age);
      const r = Math.hypot(sh.s.verts[0].x, sh.s.verts[0].y) * SHARD_SCALE * 2 * unitScale * (1 - age / SHARD_SECONDS * 0.4);
      e.set(o.angle * 0.7, o.angle, o.angle * 0.5);
      L.compose(p.set(sh.ox + o.x * unitScale, Math.max(sh.oy + 0.02, sh.oy + (0.3 + o.y) * unitScale), sh.oz + o.z * unitScale), q.setFromEuler(e), s.setScalar(r));
      put(batches.shard, L);
    }
    // forget graphs of units that are gone (their shards live on in the pool)
    for (const [id, a] of anim) if (!a.seen) { anim.delete(id); coil.forget(id); }
    for (const b of Object.values(batches)) {
      b.mesh.count = b.used;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.instanceColor.needsUpdate = true;
      if (b.halfAttr) b.halfAttr.needsUpdate = true;
    }
    decals.set(decalList);
  }

  function dispose() {
    for (const b of Object.values(batches)) { root.remove(b.mesh); b.mesh.dispose(); b.geo.dispose(); }
    for (const m of Object.values(mats)) m.dispose();
    decals.dispose();
    ctx.scene.remove(root);
    anim.clear(); shards.length = 0;
  }

  return {
    name: 'toaster-units', begin, emit, end, dispose, root, batches, decals, edges,
    height: (kind) => TOASTERS[toasterKindOf(kind)].height,
    get draws() { return Object.values(batches).filter((b) => b.used).length + (decals.mesh.count ? 1 : 0); },
    get shardCount() { return shards.length; },
  };
}

export default createToasterUnits;
