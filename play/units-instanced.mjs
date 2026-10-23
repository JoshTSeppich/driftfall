// Driftfall Classic: instanced units (owner: fable, Classic renderer). See CLASSIC.md principle 4.
//
//   createInstancedUnits(ctx, opts) -> { name: 'units', update(frame, dt), dispose(), positionOf(id),
//                                        setSelection(ids), setVisibility(fn | null), live(), count, draws, kinds }
//
// Every unit kind is drawn by ONE THREE.InstancedMesh: the silhouette comes from viewer3d/units.mjs
// (buildUnitModel, the 3D units owner's shapes, never edited here) baked once per kind into a single geometry with
// vertex colours. Team colour is the instance colour (hull parts ignore it through a per-vertex mix weight), the
// glow strips are per-vertex emissive, the hit flash is a per-instance attribute, and walking, attacking, spawning
// and dying are instance matrices. Health bars are one instanced quad, selection circles one instanced ring and
// air-unit ground shadows one instanced disc. 200 units on screen cost about 17 draw calls plus the shadow pass.
//
// With the toy look on (ctx.toy, the default; ?toy=0 turns it off) units are the cute blocky toasters of
// play/toaster-units.mjs instead of these baked shapes or the drawn sprites; pass opts.toaster = false to force the old look.
//
// Frame shape is viewer3d/world.mjs's: { tick, alpha, prev, next, events }. Pure helpers (bakeKind, unitPose,
// instanceTransform) are exported so tests/play-units-instanced.test.mjs can run them in node with real Three.js.

import * as THREE from 'three';
import { createDrawnUnits } from './drawn-units.mjs';
import { createToasterUnits } from './toaster-units.mjs';
import { POWER } from '../env/power.mjs';
import { unitState } from '../env/ammo.mjs';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  buildUnitModel, resolveKind, UNIT_SPECS, UNIT_KINDS_3D, normalizeEvents, choosePose, yawBetween, turnToward,
  healthBarState, maxHpOf,
} from '../viewer3d/units.mjs';

// ---------------------------------------------------------------------------------------------------------------
// Look (the shared palette wins when present; these are viewer3d/units.mjs's own defaults so both agree)
// ---------------------------------------------------------------------------------------------------------------
const DEFAULT_TEAM = [
  { main: '#3fa9ff', light: '#aee0ff', dark: '#174e8f', strip: '#7fd4ff' },   // side 0
  { main: '#ff8a3d', light: '#ffd4ae', dark: '#9a3f14', strip: '#ffb070' },   // side 1
];
const HULL = '#8f98a3', HULL_LIGHT = '#c4ccd4', HULL_DARK = '#4e5660', VISOR = '#e8fbff', SHARD = '#4ef2d8';
const HEALTH = { good: '#63e07a', warn: '#f0c84a', bad: '#ff5a5a', warnBelow: 0.5, badBelow: 0.25 };
const SELECT = { own: '#63e07a', enemy: '#ff5a5a', other: '#f0c84a' };

export const UNIT_SCALE = 1.45;          // tiles per model unit: big silhouettes (CLASSIC.md), a Grunt spans ~0.9 tile
const DEATH_SECONDS = 0.5;               // short and crisp: tip over, sink, gone
const SPAWN_SECONDS = 0.3;
const HIT_FLASH_SECONDS = 0.14;
const BAR_HOLD_SECONDS = 1.6;
const START_CAPACITY = 32;

// ---------------------------------------------------------------------------------------------------------------
// Baking: one geometry per kind with colour (vec3), aMix (1 = tinted by the team colour), aEmit (emissive level)
// ---------------------------------------------------------------------------------------------------------------

// Marker materials: buildUnitModel paints each part with one of these slots; the bake turns the slot into vertex data.
// Team parts carry a grey tint in `color` that the shader multiplies by the instance (team) colour.
const SLOTS = {
  body:      { mix: 1, tint: 1.0,  emit: 0 },
  accent:    { mix: 1, tint: 0.5,  emit: 0 },
  trim:      { mix: 1, tint: 0.5,  emit: 0 },
  light:     { mix: 1, tint: 1.4,  emit: 0 },
  ghost:     { mix: 1, tint: 1.0,  emit: 0 },
  strip:     { mix: 1, tint: 1.3,  emit: 1.6 },
  hull:      { mix: 0, color: HULL },
  hullLight: { mix: 0, color: HULL_LIGHT },
  hullDark:  { mix: 0, color: HULL_DARK },
  visor:     { mix: 0, color: VISOR, emit: 1.1 },
  shard:     { mix: 0, color: SHARD, emit: 1.3 },
  hit:       { mix: 0, color: '#ffffff' },
};

function makeMarkerMaterials() {
  const mats = { own: [], colors: DEFAULT_TEAM[0], stripLevel: 1.6 };
  for (const [slot, s] of Object.entries(SLOTS)) {
    const m = new THREE.MeshStandardMaterial({ color: s.color ?? '#ffffff' });
    m.userData.slot = slot;
    mats[slot] = m;
    mats.own.push(m);
  }
  return mats;
}

function slotData(material, hexOverride) {
  const s = SLOTS[material?.userData?.slot] ?? SLOTS.hull;
  // team parts store a grey tint the shader multiplies by the team colour (a number to THREE.Color would be a hex)
  const c = s.mix && hexOverride == null ? new THREE.Color().setScalar(s.tint) : new THREE.Color(hexOverride ?? s.color);
  return { r: c.r, g: c.g, b: c.b, mix: s.mix, emit: s.emit ?? 0 };
}

// Bake `kind` into { geom, cargo, spec, kind }. geom has position, normal, color, aMix, aEmit; cargo is the Worker's
// carried Shard (or null) as its own small geometry so loaded Workers can show it. Both are in model units: the
// model faces +Z with its feet at y = 0; the caller scales by UNIT_SCALE * tileSize.
export function bakeKind(kind, { markers = makeMarkerMaterials() } = {}) {
  const k = resolveKind(kind);
  const model = buildUnitModel(THREE, k, 0, null, markers, { bake: false });
  model.group.updateMatrixWorld(true);
  const parts = [], cargo = [];
  model.group.traverse((o) => {
    if (!o.isMesh) return;
    const isCarry = o === model.parts.carry;
    if (!o.visible && !isCarry) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const n = g.attributes.position.count;
    const d = slotData(o.material);
    const color = new Float32Array(n * 3), mix = new Float32Array(n), emit = new Float32Array(n);
    for (let i = 0; i < n; i++) { color[i * 3] = d.r; color[i * 3 + 1] = d.g; color[i * 3 + 2] = d.b; mix[i] = d.mix; emit[i] = d.emit; }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aMix', new THREE.BufferAttribute(mix, 1));
    g.setAttribute('aEmit', new THREE.BufferAttribute(emit, 1));
    g.deleteAttribute('uv');
    if (g.index) { const ng = g.toNonIndexed(); g.dispose(); (isCarry ? cargo : parts).push(ng); }
    else (isCarry ? cargo : parts).push(g);
  });
  const merge = (list) => {
    if (!list.length) return null;
    const m = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) for (const g of list) g.dispose();
    m.computeBoundingSphere();
    return m;
  };
  for (const g of model.geometries ?? []) g.dispose();
  return { kind: k, spec: model.spec, geom: merge(parts), cargo: merge(cargo), triangles: parts.reduce((s, g) => s + g.attributes.position.count / 3, 0) };
}

// The unit material: MeshStandardMaterial with vertex colours; the team colour (instanceColor) is mixed in by aMix,
// strips and visors glow by aEmit, and a per-instance aState = (flash, glow) whitens a hit unit for a few frames.
export function makeUnitMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3, ...opts });
  m.customProgramCacheKey = () => 'driftfall-instanced-units';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aMix; attribute float aEmit; attribute vec2 aState;
        varying float vEmit; varying vec2 vState;`)
      .replace('#include <color_vertex>', `
        vColor = vec3(1.0);
        #ifdef USE_COLOR
          vColor *= color.rgb;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor = mix(vColor, vColor * instanceColor.rgb, aMix);
        #endif
        vEmit = aEmit; vState = aState;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vEmit; varying vec2 vState;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vState.x);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor * (vEmit * (1.0 + vState.y)) + vec3(vState.x * 1.5);`);
  };
  return m;
}

// Health bar: one quad per unit, uv.x under the ratio is the level colour, the rest is the dark back.
const BAR_VERT = /* glsl */`
  attribute vec3 aBar; varying vec2 vUv; varying vec3 vBar;
  void main() { vUv = uv; vBar = aBar; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const BAR_FRAG = /* glsl */`
  uniform vec3 uGood; uniform vec3 uWarn; uniform vec3 uBad; uniform vec3 uBack;
  varying vec2 vUv; varying vec3 vBar;
  void main() {
    float fill = step(vUv.x, vBar.x);
    vec3 level = vBar.y < 0.5 ? uGood : (vBar.y < 1.5 ? uWarn : uBad);
    float edge = step(0.08, vUv.y) * step(vUv.y, 0.92);
    vec3 c = mix(uBack, level, fill * edge);
    gl_FragColor = vec4(c, mix(0.7, 1.0, fill) * vBar.z);
  }`;

// ---------------------------------------------------------------------------------------------------------------
// Pure per-unit maths (tested in node)
// ---------------------------------------------------------------------------------------------------------------
const easeOutBack = (x) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
const strike = (x) => (x < 0.3 ? x / 0.3 : Math.max(0, 1 - (x - 0.3) / 0.5));

// Instance transform for one unit, all in model-relative terms the caller scales: returns
// { dy (lift in tiles), pitch, roll, lunge (tiles forward), scale }.
export function instanceTransform({ pose, spec, phase = 0, walkPhase = 0, time = 0, seed = 0, sinceSpawn = Infinity, death = null, flash = 0, size = 0.5 }) {
  let dy = 0, pitch = 0, roll = 0, lunge = 0, scale = 1;
  const rig = spec.rig;
  if (rig === 'air') dy += (spec.altitude ?? 1.5) + Math.sin(time * 2.3 + seed) * 0.05;
  else if (rig === 'hover' || rig === 'float') dy += 0.04 + Math.sin(time * 3.1 + seed) * 0.025;
  if (pose === 'walk') {
    if (spec.heavy) { dy += Math.abs(Math.sin(walkPhase)) * 0.05 * size; roll = Math.sin(walkPhase) * 0.05; }
    else if (rig === 'air' || rig === 'skim') { roll = Math.sin(walkPhase * 0.5) * 0.12; pitch = 0.08; }
    else { dy += Math.abs(Math.sin(walkPhase)) * 0.08 * size; roll = Math.sin(walkPhase) * 0.07; pitch = 0.06; }
  } else if (pose === 'attack') {
    const s = strike(phase);
    lunge = s * 0.16 * size; pitch = -s * 0.18;
  } else if (pose === 'mine') {
    pitch = Math.sin(time * 9) * 0.06; lunge = Math.max(0, Math.sin(time * 9)) * 0.03;
  }
  if (sinceSpawn < SPAWN_SECONDS) scale *= Math.max(0.01, easeOutBack(sinceSpawn / SPAWN_SECONDS));
  if (death !== null) {
    const d = Math.max(0, Math.min(1, death));
    pitch = d * (rig === 'air' ? 0.8 : 1.25); roll = d * 0.45;
    dy = rig === 'air' ? (spec.altitude ?? 1.5) * (1 - d * d) - d * 0.2 : -d * (spec.height ?? 0.8) * 0.45;
    scale *= 1 - d * 0.35;
  }
  if (flash > 0) { dy += Math.sin(time * 97 + seed) * 0.015 * flash; roll += Math.cos(time * 83 + seed) * 0.03 * flash; }
  return { dy, pitch, roll, lunge, scale };
}

// ---------------------------------------------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------------------------------------------
export function createInstancedUnits(ctx, opts = {}) {
  const scene = ctx.scene;
  const look = opts.look ?? new URLSearchParams(globalThis.location?.search ?? '').get('look');
  const toaster = opts.toaster !== false && ctx.toy ? createToasterUnits(ctx, { scale: opts.scale }) : null;
  const drawn = !toaster && look !== '3d' && (opts.loadTexture || typeof document !== 'undefined')
    ? createDrawnUnits(ctx, opts) : null;
  const tileSize = ctx.tileSize ?? 1;
  const palette = ctx.palette ?? null;
  const stats = opts.stats ?? ctx.stats ?? null;
  const side = opts.side ?? null;                                   // the human's side: own selections are green
  const unitScale = (opts.scale ?? UNIT_SCALE) * tileSize;
  const healthColors = palette?.health ?? HEALTH;
  let isVisible = typeof opts.isVisible === 'function' ? opts.isVisible : null;

  const root = new THREE.Group();
  root.name = 'units-instanced';
  scene.add(root);

  const teamColor = [0, 1].map((o) => {
    const p = palette?.team?.[o] ?? palette?.teams?.[o];
    return new THREE.Color(p?.main ?? p?.hex ?? (typeof p === 'number' || typeof p === 'string' ? p : null) ?? DEFAULT_TEAM[o].main);
  });
  const markers = makeMarkerMaterials();
  const unitMat = makeUnitMaterial();
  const cargoMat = new THREE.MeshStandardMaterial({ color: SHARD, emissive: SHARD, emissiveIntensity: 1.3, roughness: 0.2, flatShading: true });
  const barMat = new THREE.ShaderMaterial({
    vertexShader: BAR_VERT, fragmentShader: BAR_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uGood: { value: new THREE.Color(healthColors.good) }, uWarn: { value: new THREE.Color(healthColors.warn) },
      uBad: { value: new THREE.Color(healthColors.bad) }, uBack: { value: new THREE.Color('#06080c') } },
  });
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false });
  const quad = new THREE.PlaneGeometry(1, 1);
  const ringGeo = new THREE.RingGeometry(0.42, 0.5, 28).rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(0.5, 14).rotateX(-Math.PI / 2);

  // One batch = one InstancedMesh with a per-instance attribute; grows by doubling (every frame rewrites it all).
  function makeBatch(geom, material, { attr = null, cast = false, order = 0 } = {}) {
    const b = { geom, material, attr, cast, order, mesh: null, cap: 0, used: 0 };
    grow(b, START_CAPACITY);
    return b;
  }
  function grow(b, cap) {
    const old = b.mesh;
    if (old) { root.remove(old); old.dispose(); }
    const mesh = new THREE.InstancedMesh(b.geom, b.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (old) {   // growing mid-frame (haiku's review): keep the instances already written this frame
      mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, b.used * 16));
      if (old.instanceColor) mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, b.used * 3));
    }
    if (b.attr) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * b.attr.size), b.attr.size);
      a.setUsage(THREE.DynamicDrawUsage);
      if (b.attrBuf) a.array.set(b.attrBuf.array.subarray(0, b.used * b.attr.size));
      b.geom.setAttribute(b.attr.name, a);
      b.attrBuf = a;
    }
    mesh.castShadow = b.cast; mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = b.order;
    mesh.count = 0;
    root.add(mesh);
    b.mesh = mesh; b.cap = cap;            // b.used is kept: begin() resets it each frame, growth mid-frame must not
  }
  function begin(b) { b.used = 0; }
  function slot(b) {
    if (b.used >= b.cap) grow(b, b.cap * 2);
    return b.used++;
  }
  function end(b) {
    b.mesh.count = b.used;
    b.mesh.instanceMatrix.needsUpdate = true;
    if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    if (b.attrBuf) b.attrBuf.needsUpdate = true;
  }

  const kinds = new Map();          // kind -> { baked, batch, cargo }
  function kindEntry(kind) {
    let e = kinds.get(kind);
    if (e) return e;
    const baked = bakeKind(kind, { markers });
    e = { baked, spec: baked.spec, batch: makeBatch(baked.geom, unitMat, { attr: { name: 'aState', size: 2 }, cast: true }),
      cargo: baked.cargo ? makeBatch(baked.cargo, cargoMat, { cast: false }) : null };
    kinds.set(kind, e);
    return e;
  }
  if (!toaster) for (const k of opts.prebake ?? UNIT_KINDS_3D) kindEntry(k);

  const bars = makeBatch(quad, barMat, { attr: { name: 'aBar', size: 3 }, order: 1000 });
  const rings = makeBatch(ringGeo, ringMat, { order: 5 });
  const shadows = makeBatch(discGeo, shadowMat, { order: 4 });

  const views = new Map();          // id -> per-unit state
  const lastKnown = new Map();      // id -> last record (attack targets, dying units)
  let selection = new Set();
  let time = 0;
  const dummy = new THREE.Object3D();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpCol = new THREE.Color();
  const heightAt = (x, y) => (typeof ctx.heightAt === 'function' ? ctx.heightAt(x, y) : 0);

  function worldOf(x, y, out) {
    const w = ctx.gridToWorld(x, y, 0, out);
    if (w !== out) out.set(w.x, w.y ?? 0, w.z);
    out.y += heightAt(x, y);
    return out;
  }

  function makeView(u) {
    const kind = resolveKind(u.kind);
    const owner = u.owner === 1 ? 1 : 0;
    const v = {
      id: u.id, kind, owner, entry: toaster ? null : kindEntry(kind), spec: UNIT_SPECS[kind] ?? { rig: 'hover', size: 0.5, height: 0.8, stride: 1.2 },
      pos: new THREE.Vector3(), yaw: owner === 0 ? 0.35 : -0.35,   // idle toasters face the camera so their cute faces show
      lastMoveTick: -Infinity, lastHitTick: null, lastHitAt: -Infinity, hitFlash: 0,
      spawnAt: time, dying: false, deathAt: 0, dead: false, maxHp: maxHpOf(kind, stats) || u.hp, hp: u.hp,
      seed: (u.id * 7.13) % 6.28, visible: true,
    };
    views.set(u.id, v);
    return v;
  }

  function findEntity(state, id) {
    if (!state) return null;
    return state.units.find((u) => u.id === id) ?? state.structures?.find((s) => s.id === id) ?? null;
  }

  // Write one unit's instances (body, cargo, bar, ring, shadow) for this frame.
  let frameDt = 1 / 60, frameState = null;
  function hungerOf(u) {
    if (!u || !frameState?.ammo) return null;
    try { return unitState(frameState, u); } catch { return null; }
  }

  // The unit's real cord for the toasters: the anchor first, then the corners it bends round (env/cord-wrap pts), in world
  // coordinates, and the leash length in world units. Pooled per unit so a 200-unit frame allocates nothing.
  const cordPool = new Map();
  function cordOf(u) {
    const st = u?.power;
    if (!toaster || !st || st.state !== 'plugged') return null;
    const points = frameState?.power?.view?.points ?? frameState?.power?.points;
    const anchor = points?.find((p) => p.id === st.anchor);
    const pts = st.cord?.pts?.length ? st.cord.pts : anchor ? [anchor] : null;
    if (!pts) return null;
    let c = cordPool.get(u.id);
    if (!c) { c = { route: [], limit: 0 }; cordPool.set(u.id, c); }
    for (let i = 0; i < pts.length; i++) {
      const w = c.route[i] ?? (c.route[i] = new THREE.Vector3());
      worldOf(pts[i].x, pts[i].y, w);
    }
    c.route.length = pts.length;
    c.limit = (POWER.cord[u.kind] ?? 8) * (ctx.tileSize ?? 1);
    return c;
  }

  function emit(v, u, pose, alpha, tick) {
    const spec = v.spec, size = spec.size ?? 0.5;
    const walkPhase = spec.heavy ? alpha * Math.PI : (tick + alpha) * Math.PI * (spec.stride ?? 1.2);
    const death = v.dying ? Math.min(1, (time - v.deathAt) / DEATH_SECONDS) : null;
    if (death !== null && death >= 1) { v.dead = true; return; }
    const tr = instanceTransform({ pose, spec, phase: alpha, walkPhase, time, seed: v.seed, sinceSpawn: time - v.spawnAt, death, flash: v.hitFlash, size });
    dummy.position.copy(v.pos);
    dummy.position.y += tr.dy * unitScale;
    dummy.rotation.set(0, v.yaw, 0, 'YXZ');
    dummy.rotation.x = tr.pitch; dummy.rotation.z = tr.roll;
    if (tr.lunge) dummy.position.add(tmpC.set(Math.sin(v.yaw), 0, Math.cos(v.yaw)).multiplyScalar(tr.lunge * unitScale));
    dummy.scale.setScalar(unitScale * tr.scale);
    dummy.updateMatrix();
    const selected = selection.has(v.id);
    const toasted = toaster?.emit(v, u, { pose, time, dt: frameDt, selected, tr: v.dying ? { scale: 1 } : tr, state: hungerOf(u), cord: cordOf(u) });
    if (!(toaster ? toasted : drawn?.emit(v, tr))) {
      const b = v.entry.batch;
      const i = slot(b);
      b.mesh.setMatrixAt(i, dummy.matrix);
      b.mesh.setColorAt(i, teamColor[v.owner]);
      b.attrBuf.setXY(i, v.hitFlash, selected ? 0.35 : 0);
      if (v.entry.cargo && (u?.carrying ?? 0) > 0 && !v.dying) {
        const c = v.entry.cargo, j = slot(c);
        c.mesh.setMatrixAt(j, dummy.matrix);
      }
    } // drawn silhouettes share the existing health and selection overlays
    if (v.dying) return;
    // selection circle on the ground (own = green, enemy = red), air shadow, health bar
    const groundY = v.pos.y + 0.02;
    if (selected) {
      const j = slot(rings);
      dummy.position.set(v.pos.x, groundY, v.pos.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(size * 1.35 * unitScale); dummy.updateMatrix();
      rings.mesh.setMatrixAt(j, dummy.matrix);
      rings.mesh.setColorAt(j, tmpCol.set(side === null ? SELECT.other : v.owner === side ? SELECT.own : SELECT.enemy));
    }
    if (spec.rig === 'air') {
      const j = slot(shadows);
      dummy.position.set(v.pos.x + 0.18 * tileSize, groundY, v.pos.z + 0.18 * tileSize); dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(size * 0.8 * unitScale); dummy.updateMatrix();
      shadows.mesh.setMatrixAt(j, dummy.matrix);
    }
    const hb = healthBarState({ hp: v.hp, maxHp: v.maxHp, sinceHit: time - v.lastHitAt, hold: BAR_HOLD_SECONDS, thresholds: healthColors });
    const showBar = selected || hb.visible;
    if (showBar) {
      const j = slot(bars);
      const barScale = toaster ? toaster.unitScale : unitScale;   // the toasters draw at their own scale
      const w = (spec.bar ?? Math.max(0.42, Math.min(0.7, size * 0.9))) * barScale;
      dummy.position.set(v.pos.x, v.pos.y + (tr.dy + (toaster?.height(v.kind) ?? drawn?.height(v.kind) ?? spec.height ?? 0.8) + 0.16) * barScale, v.pos.z);
      if (ctx.camera) dummy.quaternion.copy(ctx.camera.quaternion); else dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w, w * 0.14, 1); dummy.updateMatrix();
      bars.mesh.setMatrixAt(j, dummy.matrix);
      bars.attrBuf.setXYZ(j, hb.ratio, hb.level === 'bad' ? 2 : hb.level === 'warn' ? 1 : 0, selected ? 1 : hb.opacity);
    }
  }

  function update(frame, dt) {
    dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0.016));
    time += dt;
    frameDt = dt;
    frameState = frame?.next ?? frame?.prev ?? null;
    drawn?.begin();
    toaster?.begin();
    for (const e of kinds.values()) { begin(e.batch); if (e.cargo) begin(e.cargo); }
    begin(bars); begin(rings); begin(shadows);
    const prev = frame?.prev ?? frame?.next ?? null;
    const next = frame?.next ?? frame?.prev ?? null;
    if (prev || next) {
      const alpha = Math.max(0, Math.min(1, frame.alpha ?? 0));
      const tick = frame.tick ?? prev?.tick ?? 0;
      const ev = normalizeEvents(frame.events);
      const hitsBy = new Map(), hitsOn = new Map();
      for (const h of ev.hits) { if (!hitsBy.has(h.by)) hitsBy.set(h.by, h); hitsOn.set(h.id, h); }
      const prevById = new Map(), nextById = new Map();
      for (const u of prev?.units ?? []) prevById.set(u.id, u);
      for (const u of next?.units ?? []) nextById.set(u.id, u);
      const seen = new Set();

      const handle = (id) => {
        if (seen.has(id)) return;
        seen.add(id);
        const pu = prevById.get(id), nu = nextById.get(id);
        const u = nu ?? pu;
        let v = views.get(id);
        if (!v) {
          if (!nu) return;
          v = makeView(u);
          if (pu) v.spawnAt = -Infinity;
        } else if (v.kind !== resolveKind(u.kind) || v.owner !== (u.owner === 1 ? 1 : 0)) {
          views.delete(id); v = makeView(u);
        }
        lastKnown.set(id, u);
        const pose = choosePose({ id, prev: pu, next: nu, hits: ev.hits, deaths: ev.deaths, mines: ev.mines, lastMoveTick: v.lastMoveTick, tick, graceTicks: v.spec.heavy ? 2 : 1 });
        if (pu && nu && (pu.x !== nu.x || pu.y !== nu.y)) v.lastMoveTick = tick;
        if (pose === 'die') { if (!v.dying) { v.dying = true; v.deathAt = time; v.hitFlash = 0; } }
        else if (v.dying) { v.dying = false; v.dead = false; }      // scrubbed back before the death: stand up again
        const a = pu ?? nu, b = nu ?? pu;
        worldOf(a.x, a.y, tmpA); worldOf(b.x, b.y, tmpB);
        v.pos.lerpVectors(tmpA, tmpB, pose === 'die' ? 0 : alpha);
        v.hp = u.hp;
        if (u.hp > v.maxHp) v.maxHp = u.hp;
        // facing: the way it walks, else its target, else keep heading
        let targetYaw = null;
        if (pu && nu && (pu.x !== nu.x || pu.y !== nu.y)) targetYaw = yawBetween(tmpA, tmpB);
        if (targetYaw === null) {
          const hit = hitsBy.get(id);
          const tid = hit ? hit.id : (u.order?.type === 'attack' ? u.order.target : null);
          const target = tid !== null && tid !== undefined ? findEntity(next, tid) ?? findEntity(prev, tid) ?? lastKnown.get(tid) : null;
          if (target) targetYaw = yawBetween(v.pos, worldOf(target.x, target.y, tmpC));
        }
        if (targetYaw !== null) v.yaw = turnToward(v.yaw, targetYaw, 10, dt);
        const hit = hitsOn.get(id);
        if (hit && v.lastHitTick !== tick) { v.lastHitTick = tick; v.lastHitAt = time; v.hitFlash = 1; }
        v.hitFlash = Math.max(0, v.hitFlash - dt / HIT_FLASH_SECONDS);
        v.visible = isVisible ? !!isVisible(u, v) : true;
        if (v.visible) emit(v, u, pose, alpha, tick);
        if (v.dead) views.delete(id);
      };
      for (const u of next?.units ?? []) handle(u.id);
      for (const u of prev?.units ?? []) handle(u.id);
      // not in either state: a dying unit finishes falling, anything else is gone at once
      for (const v of [...views.values()]) {
        if (seen.has(v.id)) continue;
        if (!v.dying || v.dead) { views.delete(v.id); continue; }
        if (v.visible) emit(v, null, 'die', 0, tick);
        if (v.dead) views.delete(v.id);
      }
    }
    for (const e of kinds.values()) { end(e.batch); if (e.cargo) end(e.cargo); }
    end(bars); end(rings); end(shadows);
    drawn?.end();
    toaster?.end(time);
  }

  function dispose() {
    drawn?.dispose();
    toaster?.dispose();
    for (const e of kinds.values()) {
      root.remove(e.batch.mesh); e.batch.mesh.dispose(); e.baked.geom?.dispose();
      if (e.cargo) { root.remove(e.cargo.mesh); e.cargo.mesh.dispose(); e.baked.cargo?.dispose(); }
    }
    for (const b of [bars, rings, shadows]) { root.remove(b.mesh); b.mesh.dispose(); }
    quad.dispose(); ringGeo.dispose(); discGeo.dispose();
    unitMat.dispose(); cargoMat.dispose(); barMat.dispose(); ringMat.dispose(); shadowMat.dispose();
    for (const m of markers.own) m.dispose();
    scene.remove(root);
    views.clear(); lastKnown.clear(); kinds.clear();
  }

  function positionOf(id) {
    const v = views.get(id);
    return v ? v.pos.clone() : null;
  }
  function setSelection(ids) { selection = new Set(ids ?? []); }
  function setVisibility(fn) { isVisible = typeof fn === 'function' ? fn : null; }
  // Every drawn unit this frame: { id, kind, owner, pos, radius (world), hp, maxHp, dying } for picking and the HUD.
  function live() {
    const out = [];
    for (const v of views.values()) if (v.visible && !v.dying) out.push({ id: v.id, kind: v.kind, owner: v.owner, pos: v.pos, radius: (v.spec.size ?? 0.5) * 0.6 * unitScale, height: (v.spec.height ?? 0.8) * unitScale, hp: v.hp, maxHp: v.maxHp });
    return out;
  }

  return {
    name: 'units', update, dispose, positionOf, setSelection, setVisibility, live, root,
    get count() { return views.size; },
    // draw calls this frame: one per non-empty batch
    get draws() {
      let n = (drawn?.draws ?? 0) + (toaster?.draws ?? 0);
      for (const e of kinds.values()) { if (e.batch.used) n++; if (e.cargo?.used) n++; }
      for (const b of [bars, rings, shadows]) if (b.used) n++;
      return n;
    },
    get kinds() { return [...kinds.keys()]; },
    get selection() { return selection; },
    _views: views, _batches: { kinds, bars, rings, shadows },
  };
}

export default createInstancedUnits;
