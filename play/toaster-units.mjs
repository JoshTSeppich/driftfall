// The cute toasters, drawn live (owner: sonnet). play/units-instanced.mjs hands each visible unit to emit(); this turns it
// into a few instances in per-PART InstancedMesh batches (chassis, faceplate, eyes, team, dark blocks, toast, heat glows,
// WHEELS) sharing TOY_MATERIALS with the toy edge shader (applyToyEdges and a per-instance aHalf) and one contact-shadow
// decal per unit. Poses come from the Coil motion graph (toast pop on attack, recoil, hit flinch, knock-back, shatter);
// the wheels roll by the distance the unit really moved with a small bounce. Every unit's thick team-colour CORD (a springy
// coil at the back, a five-sided cable along its real route, a charcoal plug at the power point, glowing beads running
// toward the toaster, straight and flashing near the limit) is ONE rebuilt mesh plus one bead batch for all units.
// Eyes and cords are drawn unlit in saturated cyan/orange so the tone mapping cannot wash them pale.
// Presentation only: nothing here reads or writes the sim.
//
//   createToasterUnits(ctx, { scale, capacity }) -> { begin(), emit(v, u, info), end(time?), height(kind), dispose(),
//                                                      draws, root, batches, decals, cords }
//   info = { pose: 'idle'|'walk'|'attack'|'mine'|'die', time, dt, selected, tr: { scale }, state: 'fed'|'hungry'|'unpowered'|null,
//            cord?: { route: [{x,y,z} world points, the anchor first then the bend points], limit: world length of the leash } }
//
// Model: play/toaster-models.mjs (ground at y = 0, front +Z, model units; the unit scale turns them into world units).

import * as THREE from 'three';
import { TOASTERS, COLORS, EXPRESSIONS, CORD, toasterKindOf } from './toaster-models.mjs';
import { TOY_MATERIALS, applyToyEdges, createContactShadows } from './toy-render.mjs';
import { createCoilUnits } from './coil-motion.mjs';
import { shardAt } from '../engine/coil/motions.mjs';

export const UNIT_SCALE = 0.9;            // tiles per model unit (the spec's crumb is 1 wide); same footprint as the old shapes
const START_CAPACITY = 32;
const SHARD_SECONDS = 0.8;
const SHARD_SCALE = 3.2;                  // shard radii are ~0.06-0.12 m; blow them up so they read from the RTS camera
const HUNGRY_DROOP = 0.35;                // radians the toast leans forward when the unit is hungry
const FLASH_ON = 0.4;                     // v.hitFlash above this draws the white block (the first ~85 ms of a hit)
const WHEELED_HOP = 0.1;                  // wheeled toasters keep this share of the Coil hop: a small bounce, not a walk
const MAX_BEADS = 24;
const CORD_SIDES = 5;                     // five facets, like the wheels
const TYRE = '#303844', HUB = '#F2D7A6';

export function createToasterUnits(ctx, { scale = UNIT_SCALE, capacity = 512 } = {}) {
  const unitScale = scale * (ctx.tileSize ?? 1);
  const root = new THREE.Group();
  root.name = 'toaster-units';
  ctx.scene.add(root);

  // ----- materials: the RENDERING.md table, plus unlit ones for the things that must stay saturated -----
  const mats = {};
  for (const name of ['chassis', 'faceplate', 'team', 'feet', 'toast']) {
    const t = TOY_MATERIALS[name];
    // team is white here: the instance colour is the side's cyan/orange
    mats[name] = new THREE.MeshStandardMaterial({ color: name === 'team' ? '#ffffff' : t.color, roughness: t.roughness, metalness: t.metalness });
    mats[name].name = `toaster-${name}`;
  }
  mats.toast.side = THREE.DoubleSide;
  mats.bagel = new THREE.MeshStandardMaterial({ color: COLORS.toast, roughness: TOY_MATERIALS.toast.roughness, metalness: 0 });
  mats.wheel = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.62, metalness: 0 });   // charcoal tyre / cream hub by instance colour
  // Eyes, glows, cords and beads: unlit and not tone mapped, so cyan stays CYAN (a dark instance colour is a dark eye).
  const unlit = (name, extra = {}) => { const m = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, ...extra }); m.name = `toaster-${name}`; return m; };
  mats.eyes = unlit('eyes');
  mats.glow = unlit('glow');
  mats.cord = unlit('cord', { vertexColors: true, side: THREE.DoubleSide });
  mats.bead = unlit('bead');
  mats.flash = new THREE.MeshBasicMaterial({ color: COLORS.flash, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false });
  mats.shard = new THREE.MeshStandardMaterial({ color: COLORS.chassis, roughness: 0.5, flatShading: true });
  const edges = ['chassis', 'team', 'feet', 'toast'].map((n) => applyToyEdges(mats[n]));

  // ----- geometry: unit boxes (aHalf attached per batch), planes facing +Z, five-sided prisms (wheel axis x, bagel axis z) -----
  const geos = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    plane: () => new THREE.PlaneGeometry(1, 1),
    tyre: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 5).rotateZ(Math.PI / 2),
    prism: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 5).rotateX(Math.PI / 2),
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
  makeBatch('prism:prism', geos.prism(), mats.bagel, { cast: true, receive: true });
  makeBatch('faceplate:plane', geos.plane(), mats.faceplate, { receive: true });
  makeBatch('eyes:plane', geos.plane(), mats.eyes, { order: 1 });
  makeBatch('team:box', geos.box(), mats.team, solid);
  makeBatch('feet:box', geos.box(), mats.feet, solid);          // dark blocks: emitters, barrels, the broiler door, plugs
  makeBatch('toast:box', geos.box(), mats.toast, solid);
  makeBatch('glow:box', geos.box(), mats.glow, { order: 1 });
  makeBatch('wheel:tyre', geos.tyre(), mats.wheel, { cast: true, receive: true });
  makeBatch('bead', geos.box(), mats.bead, { order: 2 });
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

  // ----- ONE cord mesh for every unit: rebuilt each frame into growable typed arrays -----
  const cordGeo = new THREE.BufferGeometry();
  let cordCap = { v: 4096, i: 12288 };
  let cordPos = new Float32Array(cordCap.v * 3), cordCol = new Float32Array(cordCap.v * 3), cordIdx = new Uint32Array(cordCap.i);
  let cordV = 0, cordI = 0, cordCount = 0;
  const cordMesh = new THREE.Mesh(cordGeo, mats.cord);
  cordMesh.frustumCulled = false; cordMesh.name = 'toaster-cords'; cordMesh.renderOrder = 1; cordMesh.castShadow = false;
  root.add(cordMesh);
  function bindCord() {
    cordGeo.setAttribute('position', new THREE.BufferAttribute(cordPos, 3).setUsage(THREE.DynamicDrawUsage));
    cordGeo.setAttribute('color', new THREE.BufferAttribute(cordCol, 3).setUsage(THREE.DynamicDrawUsage));
    cordGeo.setIndex(new THREE.BufferAttribute(cordIdx, 1).setUsage(THREE.DynamicDrawUsage));
  }
  bindCord();
  function cordRoom(nv, ni) {
    if (cordV + nv <= cordCap.v && cordI + ni <= cordCap.i) return;
    while (cordV + nv > cordCap.v) cordCap.v *= 2;
    while (cordI + ni > cordCap.i) cordCap.i *= 2;
    const np = new Float32Array(cordCap.v * 3), nc = new Float32Array(cordCap.v * 3), ni2 = new Uint32Array(cordCap.i);
    np.set(cordPos.subarray(0, cordV * 3)); nc.set(cordCol.subarray(0, cordV * 3)); ni2.set(cordIdx.subarray(0, cordI));
    cordPos = np; cordCol = nc; cordIdx = ni2;
    bindCord();
  }
  // A five-sided tube through pts (objects with x,y,z; n of them), radius rad[i], colour col (r,g,b) scaled by shade.
  const tT = new THREE.Vector3(), tS = new THREE.Vector3(), tN = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function tube(pts, n, rad, colAt) {
    if (n < 2) return;
    cordRoom(n * CORD_SIDES, (n - 1) * CORD_SIDES * 6);
    const base = cordV;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      tT.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      tS.crossVectors(tT, UP);
      if (tS.lengthSq() < 1e-6) tS.set(1, 0, 0); else tS.normalize();
      tN.crossVectors(tS, tT);
      const r = rad(i), c = colAt(i);
      for (let k = 0; k < CORD_SIDES; k++) {
        const ang = (k / CORD_SIDES) * Math.PI * 2 + Math.PI / 2, cs = Math.cos(ang), sn = Math.sin(ang);
        const j = cordV * 3;
        cordPos[j] = pts[i].x + (tS.x * cs + tN.x * sn) * r;
        cordPos[j + 1] = pts[i].y + (tS.y * cs + tN.y * sn) * r;
        cordPos[j + 2] = pts[i].z + (tS.z * cs + tN.z * sn) * r;
        const shade = 0.68 + 0.32 * Math.max(0, tS.y * cs + tN.y * sn);   // baked top light so the cable reads round
        cordCol[j] = c[0] * shade; cordCol[j + 1] = c[1] * shade; cordCol[j + 2] = c[2] * shade;
        cordV++;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < CORD_SIDES; k++) {
        const a = base + i * CORD_SIDES + k, b = base + i * CORD_SIDES + (k + 1) % CORD_SIDES;
        const c = a + CORD_SIDES, d = b + CORD_SIDES;
        cordIdx[cordI++] = a; cordIdx[cordI++] = b; cordIdx[cordI++] = c;
        cordIdx[cordI++] = b; cordIdx[cordI++] = d; cordIdx[cordI++] = c;
      }
    }
  }
  const ptPool = [];
  let ptUsed = 0;
  const pt = (x, y, z) => { const o = ptPool[ptUsed++] ?? (ptPool[ptUsed - 1] = { x: 0, y: 0, z: 0 }); o.x = x; o.y = y; o.z = z; return o; };
  const scratch = [];

  const coil = createCoilUnits();
  const anim = new Map();          // unit id -> { seen, hitAt, dead, shattered, roll, mv, lx, lz }
  const shards = [];               // { s, t0, ox, oy, oz }
  let now = 0;

  const teamColor = [new THREE.Color(COLORS.cyan), new THREE.Color(COLORS.orange)];
  const eyeOn = new THREE.Color(COLORS.eye), eyeOff = new THREE.Color(COLORS.eyeOff);
  const heat = new THREE.Color(COLORS.heat), tyreCol = new THREE.Color(TYRE), hubCol = new THREE.Color(HUB);
  const beadOf = [teamColor[0].clone().lerp(new THREE.Color('#ffffff'), 0.6), teamColor[1].clone().lerp(new THREE.Color('#ffffff'), 0.6)];
  const plugCol = new THREE.Color('#ffffff');

  // scratch
  const q = new THREE.Quaternion(), yawQ = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const F = new THREE.Matrix4(), B = new THREE.Matrix4(), P = new THREE.Matrix4(), L = new THREE.Matrix4(), M = new THREE.Matrix4(), T = new THREE.Matrix4(), R = new THREE.Matrix4();
  const quatIdentity = new THREE.Quaternion(), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1), dirV = new THREE.Vector3(), exitV = new THREE.Vector3();

  function begin() {
    for (const b of Object.values(batches)) b.used = 0;
    decalList.length = 0;
    cordV = 0; cordI = 0; cordCount = 0; ptUsed = 0;
    for (const a of anim.values()) a.seen = false;
  }

  // Expression decides the eyes (EXPRESSIONS): happy at rest, determined on the move, alarmed when hit, hungry droop, X dead.
  function eyeMode(poseName, pose, hunger) {
    if (poseName === 'die' || pose.state === 'die') return 'x';
    if (pose.flinch > 0.05 || pose.state === 'hit') return 'alarmed';
    if (hunger === 'hungry') return 'hungry';
    return poseName === 'idle' ? 'happy' : 'determined';
  }

  function emit(v, u, info = {}) {
    const poseName = info.pose ?? 'idle';
    const model = TOASTERS[toasterKindOf(v.kind)];
    const dt = Math.max(0, Math.min(0.1, info.dt ?? 1 / 60));
    now = Math.max(now, info.time ?? now);
    const hunger = info.state ?? null;
    const powered = hunger !== 'unpowered';

    let a = anim.get(v.id);
    if (!a) { a = { seen: true, hitAt: v.lastHitAt, dead: false, shattered: false, state: 'idle', roll: 0, mv: 0, lx: v.pos.x, lz: v.pos.z }; anim.set(v.id, a); coil.pose(v.id, model.id, { dt: 0 }); }   // the graph must exist before it is triggered
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
    // wheels roll by the ground they really cover; the bounce rides the roll and fades in and out with motion
    const moved = Math.hypot(v.pos.x - a.lx, v.pos.z - a.lz);
    a.lx = v.pos.x; a.lz = v.pos.z;
    const rollR = (model.wheels ? model.wheels[0].r : model.body.h * 0.5) * sc;
    if (moved < 3) a.roll += (moved / rollR) * (model.wheels ? 1 : -1);
    a.mv += ((moved > 1e-4 ? 1 : 0) - a.mv) * Math.min(1, dt * 12);
    const bounce = model.wheels ? Math.abs(Math.sin(a.roll * 2.5)) * 0.035 * a.mv : 0;
    const hop = model.wheels ? pose.lift * WHEELED_HOP : pose.lift;

    const wx = v.pos.x + (pose.offX + pose.shakeX) * unitScale;
    const wz = v.pos.z + (pose.offZ + pose.shakeZ) * unitScale;
    // lean is world-space; turn it into the unit's own axes (tip toward +x = roll about z, toward +z = pitch about x)
    const lx = pose.leanX * cos - pose.leanZ * sin, lz = pose.leanX * sin + pose.leanZ * cos;
    const recoil = pose.toastPop * 0.07;
    e.set(lz - pose.flinch * 0.35 - pose.toastPop * 0.12 + (hunger === 'hungry' ? 0.06 : 0), 0, -lx, 'XYZ');
    q.setFromEuler(e);
    q.premultiply(yawQ.setFromAxisAngle(AXIS_Y, yaw));
    F.compose(p.set(wx, v.pos.y, wz), q, s.setScalar(sc));
    // the body hops and bounces on its wheels (the wheels stay on the ground), recoil slides it back along the facing
    B.copy(F).multiply(T.makeTranslation(0, hop + bounce, -recoil));
    // squash and stretch about the feet
    const sxz = 1 + 0.5 * pose.squash - 0.15 * pose.stretch, sy = 1 - pose.squash + pose.stretch - (hunger === 'hungry' ? 0.06 : 0);
    B.multiply(T.makeScale(sxz, sy, sxz));

    // pivots
    const toastY = pose.toastPop * 0.46 + pose.slotOpen * 0.05 + pose.flinch * 0.12 - (hunger === 'hungry' ? 0.06 : 0);
    const mode = eyeMode(poseName, pose, hunger);
    const team = teamColor[v.owner === 1 ? 1 : 0];
    const pivotMatrix = (part, out) => {
      switch (part.pivot) {
        case 'body': return out.copy(B);
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
        case 'roll': {           // the bagel: rolls about its own z through its centre
          const c = part.pos;
          out.copy(B).multiply(T.makeTranslation(c[0], c[1], c[2]));
          out.multiply(R.makeRotationZ(-a.roll));
          return out.multiply(T.makeTranslation(-c[0], -c[1], -c[2]));
        }
        case 'axle': {           // a wheel: grounded (F), spins about its own x
          const c = part.pos;
          out.copy(F).multiply(T.makeTranslation(c[0], c[1], c[2]));
          out.multiply(R.makeRotationX(a.roll));
          return out.multiply(T.makeTranslation(-c[0], -c[1], -c[2]));
        }
        default: return out.copy(B);
      }
    };

    const expr = EXPRESSIONS[mode] ?? EXPRESSIONS.determined, base = EXPRESSIONS.determined, fit = model.fit;
    for (const part of model.parts) {
      pivotMatrix(part, P);
      const pos = part.pos;
      let size = part.size;
      let py = pos[1], rot = part.rotZ ?? 0;
      let color = null;
      if (part.part === 'eyes') {
        let [w, h, d] = size;
        if (mode === 'x') {
          // X eyes: two crossed bars per eye in the team colour
          for (const ang of [Math.PI / 4, -Math.PI / 4]) {
            L.compose(p.set(pos[0], py, pos[2]), q.setFromAxisAngle(AXIS_Z, ang), s.set(w * 1.5, h * 0.3, 1));
            M.multiplyMatrices(P, L);
            put(batches['eyes:plane'], M, team);
          }
          continue;
        }
        w *= expr.w / base.w; h *= expr.h / base.h;
        py += (expr.y - base.y) * fit.faceH;
        if (mode === 'hungry') { w *= 1.1; h *= 0.5; py -= h * 0.5; }
        size = [w, h, d];
        rot = part.eye * (expr.rot * Math.PI / 180);
        color = !powered ? eyeOff : eyeOn;
      } else if (part.part === 'team') color = team;
      else if (part.part === 'glow') color = heat;
      else if (part.part === 'tyre') color = tyreCol;
      else if (part.part === 'hub') color = hubCol;
      L.compose(p.set(pos[0], py, pos[2]), rot ? q.setFromAxisAngle(AXIS_Z, rot) : quatIdentity, s.set(size[0], size[1], size[2]));
      M.multiplyMatrices(P, L);
      const key = part.part === 'tyre' || part.part === 'hub' ? 'wheel:tyre' : `${part.part}:${part.geo}`;
      put(batches[key], M, color, part.geo === 'box' ? part.size : null);
    }

    // hit flash: a white block just over the chassis for the first frames of a hit
    if (v.hitFlash > FLASH_ON) {
      const body = model.parts[0];
      pivotMatrix(body, P);
      L.compose(p.set(body.pos[0], body.pos[1], body.pos[2]), quatIdentity, s.set(body.size[0] * 1.06, body.size[1] * 1.06, body.size[2] * 1.06));
      put(batches.flash, M.multiplyMatrices(P, L));
    }

    if (!v.dying) {
      if (info.cord) cord(v, model, info.cord, B, yaw, sc, owner(v), a);
      // contact decal on the ground
      decalList.push(decalFor(decalList.length, v.pos.x, v.pos.y, v.pos.z, model.radius * 2 * sc * 1.02));
    }
    return true;
  }
  const owner = (v) => (v.owner === 1 ? 1 : 0);

  // The cord: coil at the back of the body -> a short drop to the ground -> the route (bend points) -> the plug at the outlet.
  function cord(v, model, c, Bm, yaw, sc, side, a) {
    const route = c.route;
    if (!route || !route.length) return;
    const anchor = route[0];
    const r = CORD.radius * unitScale;
    // how far the leash is stretched: the walked length from the unit through the bends to the anchor
    let len = 0, px = v.pos.x, pz = v.pos.z;
    for (let i = route.length - 1; i >= 0; i--) { len += Math.hypot(route[i].x - px, route[i].z - pz); px = route[i].x; pz = route[i].z; }
    const tension = c.limit > 0 ? Math.min(1.2, len / c.limit) : 0;
    const taut = tension >= CORD.tautAt;
    const stretch = Math.max(0, Math.min(1, (tension - 0.45) / (CORD.tautAt - 0.45)));
    const turns = CORD.coilTurns * (1 - stretch);
    const bx = -Math.sin(yaw), bz = -Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);   // back and right of the unit
    exitV.set(0, model.body.lift + CORD.exitHeightOfBodyH * model.body.h, -model.body.d / 2 - 0.02).applyMatrix4(Bm);
    const coilLen = CORD.coilLength * sc * (1 + 0.6 * stretch);
    const rc = CORD.coilRadius * sc * (1 - 0.8 * stretch);
    const flashOn = taut && Math.sin(now * 16) > 0;
    const col = flashOn ? [1, 1, 1] : (side ? [1, 0.48, 0.18] : [0.07, 0.85, 0.94]);
    const dark = [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8];
    // coil: a helix along the back direction (a straight pair of points once stretched taut)
    let n = 0;
    scratch.length = 0;
    const steps = Math.max(2, Math.round(CORD.coilTurns * 6));
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, ang = Math.PI * 2 * turns * t, rr = rc * Math.min(1, t * 5);   // flares out of the body
      const al = coilLen * t;
      const off = turns > 0.05 ? Math.cos(ang) * rr : 0, up = turns > 0.05 ? Math.sin(ang) * rr : 0;
      scratch[n++] = pt(exitV.x + bx * al + sx * off, exitV.y + up, exitV.z + bz * al + sz * off);
    }
    const coilEnd = scratch[n - 1];
    const gy = (rt) => rt.y + r;
    tube(scratch, n, () => r * 0.62, (i) => (i % 2 ? col : dark));
    // cable: the coil end, a drop to the ground, then the real route to the plug
    n = 0; scratch.length = 0;
    scratch[n++] = pt(coilEnd.x, coilEnd.y, coilEnd.z);
    scratch[n++] = pt(coilEnd.x + bx * 0.12 * sc, v.pos.y + r, coilEnd.z + bz * 0.12 * sc);
    for (let i = route.length - 1; i >= 0; i--) {
      const rt = route[i], prev = scratch[n - 1];
      const d = Math.hypot(rt.x - prev.x, rt.z - prev.z);
      if (d > 1.6) for (let k = 1; k < Math.ceil(d / 1.2); k++) { const f = k / Math.ceil(d / 1.2); scratch[n++] = pt(prev.x + (rt.x - prev.x) * f, gy(prev) + (gy(rt) - gy(prev)) * f, prev.z + (rt.z - prev.z) * f); }
      scratch[n++] = pt(rt.x, gy(rt), rt.z);
    }
    tube(scratch, n, () => r, () => col);
    cordCount++;
    // beads: glowing bits running along the cable toward the toaster
    let total = 0;
    const cum = [0];
    for (let i = 1; i < n; i++) { total += Math.hypot(scratch[i].x - scratch[i - 1].x, scratch[i].y - scratch[i - 1].y, scratch[i].z - scratch[i - 1].z); cum.push(total); }
    const spacing = CORD.pulseSpacing * unitScale, speed = (taut ? CORD.pulseSpeed * 2 : CORD.pulseSpeed) * unitScale;
    const phase = (now * speed) % spacing;
    let seg = 1;
    const bead = batches.bead;
    let placed = 0;
    for (let s0 = total - phase; s0 > 0.05 * unitScale && placed < MAX_BEADS; s0 -= spacing, placed++) {
      // the point at arc length s0 from the coil end; segments are walked from the near end each time (short polylines)
      seg = 1;
      while (seg < n - 1 && cum[seg] < s0) seg++;
      const a0 = scratch[seg - 1], b0 = scratch[seg], f = (s0 - cum[seg - 1]) / ((cum[seg] - cum[seg - 1]) || 1);
      dirV.set(b0.x - a0.x, b0.y - a0.y, b0.z - a0.z).normalize();
      q.setFromUnitVectors(AXIS_Z, dirV);
      L.compose(p.set(a0.x + (b0.x - a0.x) * f, a0.y + (b0.y - a0.y) * f + r * 0.2, a0.z + (b0.z - a0.z) * f), q, s.set(r * 2.7, r * 2.7, CORD.pulseLength * unitScale));
      put(bead, L, flashOn ? plugCol : beadOf[side]);
    }
    // plug: a chunky charcoal block at the outlet, lying along the cable's last stretch, with two prongs
    const pa = scratch[n - 1], pb = scratch[Math.max(0, n - 2)];
    dirV.set(pa.x - pb.x, 0, pa.z - pb.z);
    if (dirV.lengthSq() < 1e-8) dirV.set(bx, 0, bz);
    dirV.normalize();
    q.setFromUnitVectors(AXIS_Z, dirV);
    const [pw, ph, pd] = CORD.plug.size;
    L.compose(p.set(pa.x, pa.y + ph * unitScale * 0.35, pa.z), q, s.set(pw * unitScale, ph * unitScale, pd * unitScale));
    put(batches['feet:box'], L, plugCol, [pw * unitScale, ph * unitScale, pd * unitScale]);
    for (const sd of [-1, 1]) {
      L.compose(p.set(pa.x + dirV.x * pd * unitScale * 0.75 + -dirV.z * sd * pw * unitScale * 0.2, pa.y + ph * unitScale * 0.35, pa.z + dirV.z * pd * unitScale * 0.75 + dirV.x * sd * pw * unitScale * 0.2), q, s.set(0.04 * unitScale, 0.04 * unitScale, 0.14 * unitScale));
      put(batches['feet:box'], L, plugCol, [0.04 * unitScale, 0.04 * unitScale, 0.14 * unitScale]);
    }
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
    cordGeo.attributes.position.needsUpdate = true;
    cordGeo.attributes.color.needsUpdate = true;
    cordGeo.index.needsUpdate = true;
    cordGeo.setDrawRange(0, cordI);
    cordMesh.visible = cordI > 0;
    decals.set(decalList);
  }

  function dispose() {
    for (const b of Object.values(batches)) { root.remove(b.mesh); b.mesh.dispose(); b.geo.dispose(); }
    root.remove(cordMesh); cordGeo.dispose();
    for (const m of Object.values(mats)) m.dispose();
    decals.dispose();
    ctx.scene.remove(root);
    anim.clear(); shards.length = 0;
  }

  return {
    name: 'toaster-units', begin, emit, end, dispose, root, batches, decals, edges,
    cords: { mesh: cordMesh, get count() { return cordCount; }, get triangles() { return cordI / 3; } },
    height: (kind) => TOASTERS[toasterKindOf(kind)].height,
    get draws() { return Object.values(batches).filter((b) => b.used).length + (decals.mesh.count ? 1 : 0) + (cordI > 0 ? 1 : 0); },
    get shardCount() { return shards.length; },
  };
}

export default createToasterUnits;
