// Driftfall 3D effects: lasers, melee sparks, impacts, explosions with debris, Shard delivery sparkles, Brute dust,
// build-complete pulses, selection rings. Everything is driven by frame.events (+ prev/next states for positions).
//
// Shape (see VISUAL-3D.md): createVfx(ctx, opts?) -> { update(frame, dt), dispose(), setSelection(ids), stats() }
//   ctx  = { THREE, scene, camera, renderer, gridToWorld(x, y) -> Vector3, tileSize, palette }
//   opts = { stats (log.stats, optional: used for hp/range-based sizing), quality (0.25..2, default 1) }
// GPU side: two Points clouds with a soft-sprite shader (additive glow + normal-blended smoke), one InstancedMesh of
// debris chunks, small pools of beam quads and ground rings. No allocation per frame after startup.
//
// The pure parts (entity registry, planEffects, particle pool) import nothing and are tested in node.

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers

export const KIND_SIZE = { worker: 0.7, grunt: 0.85, lancer: 0.85, brute: 1.35, core: 2.4, forge: 1.7, turret: 1.1 };

export function statRow(stats, kind) {
  if (!stats) return null;
  return stats.units?.[kind] ?? stats.structures?.[kind] ?? stats[kind] ?? null;
}

// Visual size class in tiles-ish. Unknown kinds (the expanded roster) are sized from hp, so nothing is skipped.
export function sizeOf(ent, stats) {
  if (!ent) return 1;
  if (KIND_SIZE[ent.kind]) return KIND_SIZE[ent.kind];
  const hp = statRow(stats, ent.kind)?.hp ?? ent.maxHp ?? ent.hp ?? 80;
  return ent.structure ? 1.2 + Math.min(hp, 1000) / 1000 * 1.2 : 0.6 + Math.min(hp, 300) / 300 * 0.8;
}

export function isHeavy(ent, stats) {
  if (!ent || ent.structure) return false;
  return ent.kind === 'brute' || sizeOf(ent, stats) >= 1.2;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (a) => (a < 0 ? 0 : a > 1 ? 1 : a);

// Remembers the last visual position of every entity ever seen, so a unit that died this tick still has a spot.
export function createRegistry() {
  const map = new Map();
  return {
    map,
    get: (id) => map.get(id) ?? null,
    track(frame) {
      const prev = frame?.prev, next = frame?.next;
      const alpha = clamp01(frame?.alpha ?? 0);
      const prevMap = new Map();
      for (const s of [prev]) {
        if (!s) continue;
        for (const u of s.units ?? []) prevMap.set(u.id, u);
        for (const u of s.structures ?? []) prevMap.set(u.id, u);
      }
      const put = (e, structure) => {
        const p = prevMap.get(e.id);
        const x = p && !structure ? lerp(p.x, e.x, alpha) : e.x;
        const y = p && !structure ? lerp(p.y, e.y, alpha) : e.y;
        map.set(e.id, { id: e.id, x, y, tx: e.x, ty: e.y, px: p ? p.x : e.x, py: p ? p.y : e.y, kind: e.kind, owner: e.owner, structure, hp: e.hp, complete: e.complete, alive: true });
      };
      for (const e of next?.units ?? []) put(e, false);
      for (const e of next?.structures ?? []) put(e, true);
      // entities only in prev (died / removed this tick) keep their previous spot
      const nextIds = new Set();
      for (const e of next?.units ?? []) nextIds.add(e.id);
      for (const e of next?.structures ?? []) nextIds.add(e.id);
      for (const [id, e] of prevMap) {
        if (nextIds.has(id)) continue;
        const structure = !!(prev.structures ?? []).find((s) => s.id === id);
        map.set(id, { id, x: e.x, y: e.y, tx: e.x, ty: e.y, px: e.x, py: e.y, kind: e.kind, owner: e.owner, structure, hp: 0, alive: false });
      }
    },
    clear: () => map.clear(),
  };
}

// events -> effect descriptors, positions in grid tiles. Pure and deterministic.
export function planEffects(events, reg, stats) {
  const out = [];
  const find = (id) => reg.get(id);
  const nearestCore = (owner, from) => {
    let best = null, bd = Infinity;
    for (const e of reg.map.values()) {
      if (!e.structure || e.kind !== 'core' || e.owner !== owner || e.alive === false) continue;
      const d = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };
  for (const ev of events ?? []) {
    switch (ev?.e) {
      case 'hit': {
        const tgt = find(ev.id);
        if (!tgt) break;
        const att = find(ev.by);
        const dist = att ? Math.hypot(att.x - tgt.x, att.y - tgt.y) : 0;
        const dmg = ev.dmg ?? 1;
        const killing = (ev.hp ?? 1) <= 0;
        if (att && dist > 1.6) {
          out.push({ t: 'beam', style: att.structure ? 'bolt' : 'laser', from: { x: att.x, y: att.y }, to: { x: tgt.x, y: tgt.y }, owner: att.owner, size: sizeOf(att, stats), dmg, id: ev.id });
        } else {
          out.push({ t: 'melee', from: att ? { x: att.x, y: att.y } : null, to: { x: tgt.x, y: tgt.y }, owner: att?.owner ?? 0, heavy: isHeavy(att, stats), size: sizeOf(att, stats), dmg, id: ev.id });
        }
        out.push({ t: 'impact', at: { x: tgt.x, y: tgt.y }, owner: tgt.owner, structure: tgt.structure, size: sizeOf(tgt, stats), dmg, killing, delay: att && dist > 1.6 && att.structure ? 0.12 : 0, id: ev.id });
        break;
      }
      case 'die': {
        const e = find(ev.id);
        if (!e) break;
        out.push({ t: 'explosion', at: { x: e.x, y: e.y }, owner: e.owner, structure: e.structure, kind: e.kind, size: sizeOf(e, stats), id: ev.id });
        break;
      }
      case 'deliver': {
        const w = find(ev.id);
        if (!w) break;
        const core = nearestCore(w.owner, w);
        out.push({ t: 'deliver', from: { x: w.x, y: w.y }, to: core ? { x: core.x, y: core.y } : null, owner: w.owner, amount: ev.amount ?? 10, id: ev.id });
        break;
      }
      case 'mine':
        out.push({ t: 'mine', at: { x: ev.x, y: ev.y }, amount: ev.amount ?? 10, left: ev.left, id: ev.id });
        break;
      case 'done': {
        const e = find(ev.id);
        if (e) out.push({ t: 'built', at: { x: e.x, y: e.y }, owner: e.owner, size: sizeOf(e, stats), id: ev.id });
        break;
      }
      case 'spawn': {
        const e = ev.unit ?? ev.structure;
        if (e && !ev.structure) out.push({ t: 'spawn', at: { x: e.x, y: e.y }, owner: e.owner, size: sizeOf({ ...e, structure: false }, stats), id: e.id });
        break;
      }
      default:
    }
  }
  return out;
}

// Struct-of-arrays particle pool, swap-remove compacted so the live range is always [0, count).
const F = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'r0', 'g0', 'b0', 'r1', 'g1', 'b1', 'a0', 'drag', 'grav', 'rx', 'ry', 'rz', 'wx', 'wy', 'wz', 'bounce'];
export function createPool(cap) {
  const a = {};
  for (const k of F) a[k] = new Float32Array(cap);
  let count = 0;
  const copy = (to, from) => { for (const k of F) a[k][to] = a[k][from]; };
  return {
    a,
    cap,
    get count() { return count; },
    spawn(p) {
      if (count >= cap) return -1;
      const i = count++;
      for (const k of F) a[k][i] = p[k] ?? 0;
      a.life[i] = Math.max(p.life ?? 1, 1e-3);
      a.bounce[i] = p.bounce ?? 0;
      return i;
    },
    step(dt, groundY = 0) {
      for (let i = count - 1; i >= 0; i--) {
        a.age[i] += dt;
        if (a.age[i] >= a.life[i]) { count--; if (i !== count) copy(i, count); continue; }
        const damp = Math.exp(-a.drag[i] * dt);
        a.vx[i] *= damp; a.vy[i] *= damp; a.vz[i] *= damp;
        a.vy[i] -= a.grav[i] * dt;
        a.x[i] += a.vx[i] * dt; a.y[i] += a.vy[i] * dt; a.z[i] += a.vz[i] * dt;
        a.rx[i] += a.wx[i] * dt; a.ry[i] += a.wy[i] * dt; a.rz[i] += a.wz[i] * dt;
        if (a.bounce[i] && a.y[i] < groundY + a.s0[i] * 0.5) {
          a.y[i] = groundY + a.s0[i] * 0.5;
          a.vy[i] = Math.abs(a.vy[i]) * 0.3;
          a.vx[i] *= 0.6; a.vz[i] *= 0.6;
          a.wx[i] *= 0.5; a.wy[i] *= 0.5; a.wz[i] *= 0.5;
          if (a.vy[i] < 0.4) a.vy[i] = 0;
        }
      }
    },
    clear() { count = 0; },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// GPU system

const DEFAULT_TEAM = [0x37e6ff, 0xffb02e];

const POINT_VERT = `
attribute float size;
attribute vec4 color;
uniform float scale;
varying vec4 vC;
void main() {
  vC = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(size * scale / max(-mv.z, 0.01), 0.0);
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = `
varying vec4 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0 || vC.a <= 0.001) discard;
  float f = pow(1.0 - d, 1.7);
  float core = pow(1.0 - d, 6.0);
  gl_FragColor = vec4(vC.rgb * (f + core * 1.5), f * vC.a);
}`;
const SMOKE_FRAG = `
varying vec4 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0 || vC.a <= 0.001) discard;
  float f = smoothstep(1.0, 0.15, d);
  gl_FragColor = vec4(vC.rgb, f * vC.a);
}`;

function pointsCloud(THREE, cap, frag, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const size = new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.BufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos);
  geo.setAttribute('size', size);
  geo.setAttribute('color', col);
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { scale: { value: 500 } },
    vertexShader: POINT_VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
  const obj = new THREE.Points(geo, mat);
  obj.frustumCulled = false;
  obj.renderOrder = additive ? 20 : 10;
  return { obj, geo, mat, pos, size, col };
}

export function createVfx(ctx, opts = {}) {
  const { THREE, scene } = ctx;
  const stats = opts.stats ?? ctx.stats ?? ctx.log?.stats ?? null;
  const Q = Math.max(0.25, Math.min(2, opts.quality ?? 1));
  const ts = ctx.tileSize ?? 1;
  const reg = createRegistry();

  const teamCol = [0, 1].map((o) => {
    const c = ctx.palette?.team?.[o] ?? ctx.palette?.teams?.[o] ?? DEFAULT_TEAM[o];
    return new THREE.Color(c);
  });
  const shardCol = new THREE.Color(ctx.palette?.shard ?? ctx.palette?.crystal ?? 0x46dcc8);
  const dustCol = new THREE.Color(ctx.palette?.dust ?? 0x8c7b66);
  const hot = new THREE.Color(0xfff0c0), fire = new THREE.Color(0xff7a1c), ember = new THREE.Color(0x4a1608);
  const team = (o) => teamCol[o === 1 ? 1 : 0];

  const group = new THREE.Group();
  group.name = 'vfx';
  scene.add(group);

  const glowPool = createPool(Math.round(6000 * Q));
  const smokePool = createPool(Math.round(900 * Q));
  const debrisPool = createPool(Math.round(500 * Q));
  const glow = pointsCloud(THREE, glowPool.cap, GLOW_FRAG, true);
  const smoke = pointsCloud(THREE, smokePool.cap, SMOKE_FRAG, false);
  group.add(smoke.obj, glow.obj);

  // debris: lit chunks that tumble, bounce and cool from glowing orange to dark
  const debrisGeo = new THREE.BoxGeometry(1, 0.6, 0.8);
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.2 });
  const debris = new THREE.InstancedMesh(debrisGeo, debrisMat, debrisPool.cap);
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debris.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(debrisPool.cap * 3), 3);
  debris.instanceColor.setUsage(THREE.DynamicDrawUsage);
  debris.count = 0;
  debris.frustumCulled = false;
  debris.castShadow = true;
  group.add(debris);

  // beams: crossed quads, length 1 along +x, soft gradient across the width
  const gradData = new Uint8Array(32 * 4);
  for (let i = 0; i < 32; i++) {
    const d = Math.abs((i + 0.5) / 32 * 2 - 1);
    const v = Math.round(255 * (Math.pow(1 - d, 1.4) * 0.8 + Math.pow(1 - d, 7) * 0.9));
    gradData.set([v, v, v, 255], i * 4);
  }
  const gradTex = new THREE.DataTexture(gradData, 1, 32, THREE.RGBAFormat);
  gradTex.minFilter = gradTex.magFilter = THREE.LinearFilter;
  gradTex.needsUpdate = true;
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0,
    0, 0, -0.5, 1, 0, -0.5, 1, 0, 0.5, 0, 0, 0.5,
  ]), 3));
  beamGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]), 2));
  beamGeo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const beams = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: gradTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, fog: false }));
    m.visible = false; m.frustumCulled = false; m.renderOrder = 21;
    group.add(m);
    beams.push({ m, on: false, age: 0, life: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), width: 0.1, bolt: false, boost: 2 });
  }

  // ground rings (shockwaves, spawn / build pulses) and selection rings
  const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const mkRing = () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, fog: false }));
    m.visible = false; m.frustumCulled = false; m.renderOrder = 19;
    group.add(m);
    return m;
  };
  const rings = [];
  for (let i = 0; i < 28; i++) rings.push({ m: mkRing(), on: false, age: 0, life: 1, r0: 0, r1: 1, op: 1 });
  const selRings = [];
  let selection = new Set();

  const pending = []; // { at (seconds from now), fn }
  let lastTick = null;
  let clock = 0;
  let dustAcc = new Map();
  let smokeAcc = new Map();
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), mtx = new THREE.Matrix4(), sc = new THREE.Vector3(), col = new THREE.Color();
  const X = new THREE.Vector3(1, 0, 0);

  const ground = (p) => ctx.gridToWorld(p.x, p.y);
  const worldPoint = (p, h = 0) => { const w = ground(p); return new THREE.Vector3(w.x, w.y + h * ts, w.z); };

  // ---- emit helpers (all sizes in world units, scaled by tile size) ----
  const dir = (rng, up = 0) => {
    const th = rng() * Math.PI * 2, y = rng() * 2 - 1 + up;
    const r = Math.sqrt(Math.max(0, 1 - Math.min(1, y * y)));
    return [Math.cos(th) * r, y, Math.sin(th) * r];
  };
  function spark(p, rng, speed, life, size, c0, c1, o = {}) {
    const [dx, dy, dz] = dir(rng, o.up ?? 0.3);
    const sp = speed * (0.4 + rng() * 0.8);
    glowPool.spawn({ x: p.x, y: p.y, z: p.z, vx: dx * sp, vy: Math.abs(dy) * sp * (o.lift ?? 1), vz: dz * sp, life: life * (0.6 + rng() * 0.7), s0: size, s1: size * 0.2, r0: c0.r, g0: c0.g, b0: c0.b, r1: c1.r, g1: c1.g, b1: c1.b, a0: o.a ?? 1, drag: o.drag ?? 1.5, grav: o.grav ?? 9 * ts });
  }
  function puff(p, rng, c, size, life, rise = 0.6, spread = 0.5, a = 0.5) {
    const [dx, , dz] = dir(rng);
    smokePool.spawn({ x: p.x, y: p.y, z: p.z, vx: dx * spread * ts, vy: (rise + rng() * 0.5) * ts, vz: dz * spread * ts, life: life * (0.7 + rng() * 0.6), s0: size, s1: size * 2.6, r0: c.r, g0: c.g, b0: c.b, r1: c.r * 0.8, g1: c.g * 0.8, b1: c.b * 0.8, a0: a, drag: 1.2, grav: -0.2 * ts });
  }
  function chunk(p, rng, size, speed, o = {}) {
    const [dx, dy, dz] = dir(rng, 0.8);
    const sp = speed * (0.4 + rng() * 0.8);
    const dark = 0.12 + rng() * 0.12;
    debrisPool.spawn({ x: p.x, y: p.y, z: p.z, vx: dx * sp, vy: Math.abs(dy) * sp + speed * 0.3, vz: dz * sp, life: 1.6 + rng() * 1.2, s0: size * (0.5 + rng()), s1: dark, r0: o.r ?? 1, g0: o.g ?? 0.45, b0: o.b ?? 0.12, r1: dark, g1: dark * 0.95, b1: dark * 0.9, drag: 0.4, grav: 16 * ts, bounce: 1, rx: rng() * 6, ry: rng() * 6, rz: rng() * 6, wx: (rng() - 0.5) * 18, wy: (rng() - 0.5) * 18, wz: (rng() - 0.5) * 18 });
  }
  function ring(p, c, r0, r1, life, op = 1) {
    const r = rings.find((x) => !x.on);
    if (!r) return;
    Object.assign(r, { on: true, age: 0, life, r0: r0 * ts, r1: r1 * ts, op });
    r.m.material.color.copy(c);
    r.m.position.set(p.x, p.y + 0.04 * ts, p.z);
    r.m.visible = true;
  }
  function beam(a, b, c, width, life, bolt, boost = 2.2) {
    const s = beams.find((x) => !x.on);
    if (!s) return;
    Object.assign(s, { on: true, age: 0, life, width: width * ts, bolt, boost });
    s.a.copy(a); s.b.copy(b);
    s.m.material.color.copy(c).multiplyScalar(boost);
    s.m.visible = true;
  }
  const later = (sec, fn) => { if (sec <= 0) fn(); else pending.push({ at: clock + sec, fn }); };

  // ---- realise one planned effect ----
  function realise(fx) {
    const rng = mulberry32((fx.id ?? 0) * 2654435761 + lastTick * 97 + (fx.t.length * 131));
    switch (fx.t) {
      case 'beam': {
        const big = fx.style === 'bolt';
        const a = worldPoint(fx.from, 0.7 * Math.min(fx.size, 1.4) + (big ? 0.35 : 0));
        const b = worldPoint(fx.to, 0.45);
        const c = team(fx.owner);
        const white = new THREE.Color(1, 1, 1);
        beam(a, b, c.clone().lerp(white, 0.25), big ? 0.16 : 0.07, big ? 0.32 : 0.16, big);
        for (let i = 0, n = Math.round(5 * Q) + 1; i < n; i++) spark(a, rng, 3.5 * ts, 0.18, 0.2 * ts, white, c, { drag: 4, grav: 0 });
        glowPool.spawn({ x: a.x, y: a.y, z: a.z, life: 0.1, s0: 0.7 * ts, s1: 0.2 * ts, r0: c.r * 2, g0: c.g * 2, b0: c.b * 2, r1: c.r, g1: c.g, b1: c.b, a0: 1 });
        break;
      }
      case 'melee': {
        const c = team(fx.owner);
        const at = worldPoint(fx.to, 0.5);
        const n = Math.round((fx.heavy ? 14 : 7) * Q) + 2;
        for (let i = 0; i < n; i++) spark(at, rng, (fx.heavy ? 6 : 4) * ts, 0.35, (fx.heavy ? 0.2 : 0.13) * ts, hot, c, { drag: 3 });
        if (fx.from) { // a quick arc slash from the attacker towards the target
          const a = worldPoint(fx.from, 0.6), b = at.clone();
          v.copy(b).sub(a);
          a.addScaledVector(v, 0.15); b.addScaledVector(v, 0.0);
          beam(a, b, c.clone().lerp(new THREE.Color(1, 1, 1), 0.5), fx.heavy ? 0.22 : 0.12, 0.1, false, 1.8);
        }
        break;
      }
      case 'impact': {
        later(fx.delay ?? 0, () => {
          const at = worldPoint(fx.at, 0.5 * Math.min(fx.size, 1.4));
          const big = fx.dmg >= 12 || fx.structure;
          const n = Math.round((big ? 10 : 5) * Q) + 1;
          for (let i = 0; i < n; i++) spark(at, rng, 4 * ts, 0.3, 0.12 * ts, hot, fire, { drag: 3 });
          glowPool.spawn({ x: at.x, y: at.y, z: at.z, life: 0.14, s0: (big ? 0.9 : 0.55) * ts, s1: 0.2 * ts, r0: 2.2, g0: 1.7, b0: 1.1, r1: 1, g1: 0.5, b1: 0.2, a0: 1 });
          if (fx.structure) puff(at, rng, dustCol, 0.5 * ts, 0.9, 0.5, 0.5, 0.35);
        });
        break;
      }
      case 'explosion': {
        const s = fx.size;
        const at = worldPoint(fx.at, 0.45 * s);
        const big = fx.structure;
        const nS = Math.round((big ? 70 : 22) * Q * Math.max(0.7, s * 0.6));
        for (let i = 0; i < nS; i++) spark(at, rng, (big ? 9 : 5.5) * ts, big ? 1.0 : 0.6, (big ? 0.28 : 0.2) * ts, hot, fire, { drag: 1.6, up: 0.4 });
        for (let i = 0, n = Math.round((big ? 14 : 5) * Q) + 2; i < n; i++) {
          const p = at.clone(); p.x += (rng() - 0.5) * s * ts * 0.5; p.z += (rng() - 0.5) * s * ts * 0.5;
          puff(p, rng, new THREE.Color(0.16, 0.14, 0.13), (0.7 + rng() * 0.6) * s * ts, big ? 2.6 : 1.4, 0.8, 0.7, 0.55);
        }
        const nD = Math.round((big ? 26 : 8) * Q) + 1;
        const tc = team(fx.owner);
        for (let i = 0; i < nD; i++) chunk(at, rng, (big ? 0.2 : 0.11) * ts, (big ? 8 : 5) * ts, i % 4 === 0 ? { r: tc.r * 1.5, g: tc.g * 1.5, b: tc.b * 1.5 } : {});
        glowPool.spawn({ x: at.x, y: at.y, z: at.z, life: 0.28, s0: 1.4 * s * ts, s1: 3.2 * s * ts, r0: 2.6, g0: 2.0, b0: 1.2, r1: 1.2, g1: 0.45, b1: 0.12, a0: 1 });
        ring(worldPoint(fx.at, 0), fire.clone(), 0.2 * s, (big ? 3.2 : 1.6) * s, big ? 0.7 : 0.45, 0.9);
        if (big) ring(worldPoint(fx.at, 0), team(fx.owner), 0.1, 4.5 * s, 1.0, 0.6);
        break;
      }
      case 'deliver': {
        const a = worldPoint(fx.from, 0.7);
        const b = fx.to ? worldPoint(fx.to, 1.5) : worldPoint(fx.from, 2.2);
        const n = Math.round(Math.min(26, 8 + fx.amount * 1.2) * Q);
        for (let i = 0; i < n; i++) {
          const k = i / n, life = 0.55 + rng() * 0.45;
          const tx = lerp(a.x, b.x, 0.7 + rng() * 0.3), ty = lerp(a.y, b.y, 1), tz = lerp(a.z, b.z, 0.7 + rng() * 0.3);
          const gold = i % 3 === 0;
          glowPool.spawn({ x: a.x + (rng() - 0.5) * 0.3 * ts, y: a.y, z: a.z + (rng() - 0.5) * 0.3 * ts, vx: (tx - a.x) / life + (rng() - 0.5) * ts, vy: (ty - a.y) / life + (0.8 + k) * ts, vz: (tz - a.z) / life + (rng() - 0.5) * ts, life, s0: (0.22 + rng() * 0.12) * ts, s1: 0.04 * ts, r0: gold ? 1.8 : shardCol.r * 1.6, g0: gold ? 1.5 : shardCol.g * 1.6, b0: gold ? 0.6 : shardCol.b * 1.6, r1: shardCol.r, g1: shardCol.g, b1: shardCol.b, a0: 1, drag: 0.8, grav: 2 * ts });
        }
        ring(worldPoint(fx.to ?? fx.from, 0), shardCol.clone(), 0.3, 1.2, 0.5, 0.7);
        break;
      }
      case 'mine': {
        const at = worldPoint(fx.at, 0.4);
        for (let i = 0, n = Math.round(10 * Q) + 2; i < n; i++) spark(at, rng, 3 * ts, 0.5, 0.1 * ts, new THREE.Color(1.6, 2, 2), shardCol, { drag: 2, grav: 6 * ts });
        break;
      }
      case 'built': {
        const base = worldPoint(fx.at, 0);
        const c = team(fx.owner);
        ring(base, c, 0.3, 2.8 * fx.size, 0.8, 0.9);
        for (let i = 0, n = Math.round(20 * Q) + 3; i < n; i++) puff(worldPoint(fx.at, 0.1), rng, dustCol, 0.5 * fx.size * ts, 1.2, 0.3, 1.1, 0.4);
        for (let i = 0, n = Math.round(18 * Q) + 2; i < n; i++) spark(worldPoint(fx.at, 0.4), rng, 5 * ts, 0.9, 0.14 * ts, new THREE.Color(1.8, 1.8, 1.8), c, { drag: 1.5, grav: 3 * ts });
        break;
      }
      case 'spawn': {
        const c = team(fx.owner);
        ring(worldPoint(fx.at, 0), c, 0.1, 0.9 * Math.max(0.8, fx.size), 0.45, 0.8);
        for (let i = 0, n = Math.round(6 * Q) + 1; i < n; i++) spark(worldPoint(fx.at, 0.1), rng, 2 * ts, 0.5, 0.1 * ts, new THREE.Color(1.5, 1.5, 1.5), c, { drag: 2, grav: -1 * ts, lift: 1.4 });
        break;
      }
      default:
    }
  }

  // ---- per-frame continuous effects: dust under heavy walkers, smoke from badly hurt buildings ----
  function continuous(dt) {
    for (const [id, r] of reg.map) {
      if (!r.alive) continue;
      if (!r.structure) {
        const moving = r.px !== r.tx || r.py !== r.ty;
        if (!moving) continue;
        const heavy = isHeavy(r, stats);
        const rate = (heavy ? 16 : 3) * Q;
        let acc = (dustAcc.get(id) ?? 0) + rate * dt;
        const rng = mulberry32((id * 7919 + Math.floor(clock * 60)) | 0);
        while (acc >= 1) {
          acc -= 1;
          const p = worldPoint(r, 0.08);
          p.x += (rng() - 0.5) * 0.5 * ts; p.z += (rng() - 0.5) * 0.5 * ts;
          puff(p, rng, dustCol, (heavy ? 0.55 : 0.28) * ts, heavy ? 1.1 : 0.7, heavy ? 0.4 : 0.25, heavy ? 0.7 : 0.35, heavy ? 0.45 : 0.22);
        }
        dustAcc.set(id, acc);
      } else if (r.complete !== false) {
        const max = statRow(stats, r.kind)?.hp;
        if (!max || !(r.hp > 0) || r.hp / max > 0.5) continue;
        const sev = 1 - r.hp / max * 2; // 0..1
        let acc = (smokeAcc.get(id) ?? 0) + (2 + sev * 6) * Q * dt;
        const rng = mulberry32((id * 104729 + Math.floor(clock * 30)) | 0);
        while (acc >= 1) {
          acc -= 1;
          const p = worldPoint(r, 0.6 * sizeOf(r, stats));
          p.x += (rng() - 0.5) * 0.6 * ts; p.z += (rng() - 0.5) * 0.6 * ts;
          puff(p, rng, new THREE.Color(0.12, 0.11, 0.1), 0.45 * ts, 1.8, 0.9, 0.15, 0.45);
          if (rng() < 0.5 * sev) spark(p, rng, 1.5 * ts, 0.8, 0.09 * ts, hot, ember, { drag: 1, grav: 2 * ts });
        }
        smokeAcc.set(id, acc);
      }
    }
  }

  function writeClouds() {
    const fill = (pool, cl, puffy) => {
      const a = pool.a, n = pool.count;
      const P = cl.pos.array, S = cl.size.array, C = cl.col.array;
      for (let i = 0; i < n; i++) {
        const t = a.age[i] / a.life[i];
        P[i * 3] = a.x[i]; P[i * 3 + 1] = a.y[i]; P[i * 3 + 2] = a.z[i];
        S[i] = lerp(a.s0[i], a.s1[i], t) ;
        C[i * 4] = lerp(a.r0[i], a.r1[i], t); C[i * 4 + 1] = lerp(a.g0[i], a.g1[i], t); C[i * 4 + 2] = lerp(a.b0[i], a.b1[i], t);
        C[i * 4 + 3] = a.a0[i] * (puffy ? Math.min(1, t * 8) * (1 - t) : (1 - t) * (1 - t));
      }
      cl.geo.setDrawRange(0, n);
      cl.pos.needsUpdate = cl.size.needsUpdate = cl.col.needsUpdate = true;
    };
    fill(glowPool, glow, false);
    fill(smokePool, smoke, true);
    const a = debrisPool.a, n = debrisPool.count;
    for (let i = 0; i < n; i++) {
      const t = a.age[i] / a.life[i];
      const k = Math.min(1, t * 2.2); // cool down
      const s = a.s0[i] * (t > 0.8 ? (1 - t) / 0.2 : 1) * ts;
      e.set(a.rx[i], a.ry[i], a.rz[i]);
      q.setFromEuler(e);
      mtx.compose(v.set(a.x[i], a.y[i], a.z[i]), q, sc.set(s, s, s));
      debris.setMatrixAt(i, mtx);
      debris.instanceColor.setXYZ(i, lerp(a.r0[i], a.r1[i], k), lerp(a.g0[i], a.g1[i], k), lerp(a.b0[i], a.b1[i], k));
    }
    debris.count = n;
    debris.instanceMatrix.needsUpdate = true;
    debris.instanceColor.needsUpdate = true;
  }

  function updateBeams(dt) {
    for (const s of beams) {
      if (!s.on) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) { s.on = false; s.m.visible = false; continue; }
      let f0 = 0, f1 = 1;
      if (s.bolt) { // a short streak that travels from the muzzle to the target
        const head = clamp01(s.age / (s.life * 0.45)), tail = clamp01((s.age - s.life * 0.12) / (s.life * 0.45));
        f0 = tail; f1 = head;
      }
      v.copy(s.b).sub(s.a);
      const len = v.length();
      if (len < 1e-4 || f1 - f0 < 1e-3) { s.m.visible = false; continue; }
      s.m.visible = true;
      v.multiplyScalar(1 / len);
      q.setFromUnitVectors(X, v);
      s.m.quaternion.copy(q);
      s.m.position.copy(s.a).addScaledVector(v, len * f0);
      const w = s.width * (s.bolt ? 1 : 1 - t * 0.6);
      s.m.scale.set(len * (f1 - f0), w, w);
      s.m.material.opacity = s.bolt ? 1 : (1 - t) * (1 - t);
    }
    for (const r of rings) {
      if (!r.on) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) { r.on = false; r.m.visible = false; continue; }
      const e1 = 1 - (1 - t) * (1 - t);
      const s = lerp(r.r0, r.r1, e1);
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = r.op * (1 - t) * (1 - t);
    }
  }

  function updateSelection() {
    let i = 0;
    for (const id of selection) {
      const r = reg.get(id);
      if (!r || !r.alive) continue;
      let s = selRings[i];
      if (!s) { s = { m: mkRing() }; s.m.material.blending = THREE.AdditiveBlending; selRings.push(s); }
      i++;
      const size = sizeOf(r, stats);
      const pulse = 1 + Math.sin(clock * 5 + id) * 0.06;
      const p = worldPoint(r, 0.03);
      s.m.position.copy(p);
      s.m.scale.set(size * 0.62 * ts * pulse, 1, size * 0.62 * ts * pulse);
      s.m.material.color.copy(team(r.owner)).multiplyScalar(1.6);
      s.m.material.opacity = 0.8;
      s.m.visible = true;
    }
    for (; i < selRings.length; i++) selRings[i].m.visible = false;
  }

  function clearAll() {
    glowPool.clear(); smokePool.clear(); debrisPool.clear();
    pending.length = 0;
    for (const s of beams) { s.on = false; s.m.visible = false; }
    for (const r of rings) { r.on = false; r.m.visible = false; }
    dustAcc.clear(); smokeAcc.clear();
  }

  function update(frame, dt = 1 / 60) {
    if (!frame) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    clock += dt;
    reg.track(frame);
    const tick = frame.tick;
    if (lastTick !== null && tick !== lastTick) {
      if (tick < lastTick || tick > lastTick + 12) { clearAll(); lastTick = tick; } // scrubbed: restart from clean
      else {
        lastTick = tick;
        for (const fx of planEffects(frame.events, reg, stats)) realise(fx);
      }
    } else if (lastTick === null) {
      lastTick = tick;
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].at <= clock) { const p = pending.splice(i, 1)[0]; p.fn(); }
    }
    continuous(dt);
    // glow fades faster than smoke; both integrate with the same dt
    const y0 = ctx.gridToWorld(0, 0).y;
    glowPool.step(dt, y0); smokePool.step(dt, y0); debrisPool.step(dt, y0);
    const cam = ctx.camera, h = ctx.renderer?.domElement?.height ?? 1080;
    const scale = cam?.isOrthographicCamera ? h / Math.max(cam.top - cam.bottom, 1e-3) * 10 : h * 0.5 / Math.tan((cam?.fov ?? 45) * Math.PI / 360);
    glow.mat.uniforms.scale.value = smoke.mat.uniforms.scale.value = scale;
    writeClouds();
    updateBeams(dt);
    updateSelection();
  }

  return {
    update,
    setSelection(ids) { selection = new Set(ids ?? []); },
    stats: () => ({ glow: glowPool.count, smoke: smokePool.count, debris: debrisPool.count, beams: beams.filter((b) => b.on).length, rings: rings.filter((r) => r.on).length }),
    dispose() {
      scene.remove(group);
      for (const o of [glow, smoke]) { o.geo.dispose(); o.mat.dispose(); }
      debrisGeo.dispose(); debrisMat.dispose(); debris.dispose();
      beamGeo.dispose(); ringGeo.dispose(); gradTex.dispose();
      for (const b of beams) b.m.material.dispose();
      for (const r of [...rings, ...selRings]) r.m.material.dispose();
    },
  };
}
