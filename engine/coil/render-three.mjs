// Coil Engine renderer (owner: sonnet). Presentation only; env/ stays the authority.
//
// Faceted, flat-shaded rigid-part meshes (3-6 parts per kind, ART-DIRECTION.md: five-facet rounds) skinned on the
// GPU: every vertex is bound to ONE joint, and the joint transforms (8 floats each: pos xyz, scale, quat xyzw) live
// in a float data texture, one row per unit. One InstancedMesh per kind per LOD, plus an inverted-hull ink outline
// of constant screen width (near LOD only). Far LOD binds everything to at most 4 joints and drops detail parts.
//
// Input (a stub of the Lead's rig API, swap when it lands): update(units, dt, time) where each unit is
//   { id, kind, side, x, y, z, yaw, scale?, joints?: Float32Array(8 * jointCount) }   (joints in unit space)
// Missing joints = rest pose. Attachment joints (helmet, tank, hose) are driven here by damped springs that lag
// the unit's yaw and height, so they wobble even when the rig supplies nothing for them.
//
// THREE is passed in (createCoilRenderer(THREE, opts)) so the module imports nothing and runs in node tests.

export const PART_SHAPES = {
  box: { sides: 4 },
  prism5: { sides: 5, profile: [[1, -0.5], [1, 0.5]] },
  cone5: { sides: 5, profile: [[1, -0.5], [0, 0.5]] },
  dome5: { sides: 5, profile: [[1, -0.5], [0.6, 0.5]] },
};

const SLOT = { body: 0, team: 1, accent: 2 };
const BODY = '#5b6470';       // gunmetal
const ACCENT = '#b6ff3b';     // signal lime
const INK = '#14121c';
const TEAM = [[0.22, 0.88, 1.0], [1.0, 0.54, 0.16]]; // cyan, orange (ART-DIRECTION palette)

// ---------------------------------------------------------------------------------------------------------------
// Kind specs. joints[i].pos is the rest pivot in unit space; parts are built around their joint's pivot.
// attach: spring params (stiffness k, damping d, swing = how much of the lag shows).
// ---------------------------------------------------------------------------------------------------------------
export const KIND_SPECS = {
  crumb: { // worker: hops, carries a tank, wears a wobbly helmet
    joints: [
      { name: 'body', pos: [0, 0.55, 0] },
      { name: 'feet', pos: [0, 0.12, 0] },
      { name: 'helmet', pos: [0, 1.05, 0], attach: { k: 160, d: 9, swing: 1 } },
      { name: 'tank', pos: [0, 0.7, -0.38], attach: { k: 90, d: 6, swing: 0.8 } },
    ],
    parts: [
      { shape: 'box', size: [0.7, 0.8, 0.6], joint: 0, tint: 'team' },
      { shape: 'box', size: [0.8, 0.24, 0.7], joint: 1, tint: 'body' },
      { shape: 'dome5', size: [0.7, 0.3, 0.7], joint: 2, tint: 'accent' },
      { shape: 'prism5', size: [0.3, 0.6, 0.3], joint: 3, tint: 'accent' },
      { shape: 'box', size: [0.14, 0.3, 0.14], joint: 0, offset: [0.42, 0.05, 0], tint: 'accent', detail: true },
    ],
  },
  popper: { // light soldier: toast pops up on attack
    joints: [
      { name: 'body', pos: [0, 0.6, 0] },
      { name: 'feet', pos: [0, 0.14, 0] },
      { name: 'toast', pos: [0, 1.15, 0], attach: { k: 220, d: 8, swing: 1.2 } },
      { name: 'cord', pos: [0, 0.4, -0.45], attach: { k: 70, d: 5, swing: 1 } },
    ],
    parts: [
      { shape: 'box', size: [0.8, 0.9, 0.55], joint: 0, tint: 'team' },
      { shape: 'box', size: [0.9, 0.28, 0.65], joint: 1, tint: 'body' },
      { shape: 'prism5', size: [0.5, 0.1, 0.4], joint: 2, tint: 'accent' },
      { shape: 'cone5', size: [0.14, 0.5, 0.14], joint: 3, tint: 'body' },
    ],
  },
  fourslice: { // heavy: stomping hops, hose and cord on springs
    joints: [
      { name: 'body', pos: [0, 0.95, 0] },
      { name: 'footL', pos: [-0.55, 0.2, 0] },
      { name: 'footR', pos: [0.55, 0.2, 0] },
      { name: 'lever', pos: [0.82, 1.1, 0] },
      { name: 'toast', pos: [0, 1.8, 0], attach: { k: 200, d: 8, swing: 1.2 } },
      { name: 'hose', pos: [0, 1.0, -0.8], attach: { k: 60, d: 4, swing: 1 } },
    ],
    parts: [
      { shape: 'box', size: [1.7, 1.4, 1.1], joint: 0, tint: 'team' },
      { shape: 'prism5', size: [0.6, 0.4, 0.6], joint: 1, tint: 'body' },
      { shape: 'prism5', size: [0.6, 0.4, 0.6], joint: 2, tint: 'body', detail: true },
      { shape: 'box', size: [0.2, 0.2, 0.5], joint: 3, tint: 'accent', detail: true },
      { shape: 'box', size: [1.1, 0.14, 0.7], joint: 4, tint: 'accent' },
      { shape: 'prism5', size: [0.24, 0.9, 0.24], joint: 5, tint: 'body' },
    ],
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------------
export function restJoints(spec) {
  const out = new Float32Array(spec.joints.length * 8);
  spec.joints.forEach((j, i) => {
    const p = j.pos || [0, 0, 0];
    out.set([p[0], p[1], p[2], 1, 0, 0, 0, 1], i * 8);
  });
  return out;
}

/** Copy one unit's joints into row `row` of the CPU side of the joint texture (RGBA float, 2 texels per joint). */
export function packJoints(texData, row, jointCount, joints) {
  texData.set(joints.subarray ? joints.subarray(0, jointCount * 8) : joints.slice(0, jointCount * 8), row * jointCount * 8);
}

export function lodFor(dist, lodDistance) { return dist > lodDistance ? 1 : 0; }

/** Damped spring toward `target`, semi-implicit Euler with substeps so any dt stays stable. */
export function stepSpring(s, target, dt, k, d) {
  dt = Math.min(Math.max(dt, 0), 0.25);
  const n = Math.max(1, Math.ceil(dt * 120));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (k * (target - s.x) - d * s.v) * h;
    s.x += s.v * h;
  }
}

// Joint a vertex is bound to at a given LOD (far: walk up to a joint index < 4). Parent defaults to the root.
function lodJoint(spec, j, lod) {
  if (lod === 0) return j;
  let guard = 8;
  while (j >= 4 && guard--) j = spec.joints[j].parent ?? 0;
  return j;
}

/** Non-indexed, flat geometry with aJoint, aTint (0 body / 1 team / 2 accent), aColor, aSmooth (outline normal). */
export function buildKindGeometry(spec, lod = 0, THREE = null) {
  const pos = [], joint = [], tint = [], smoothKey = [], flatN = [];
  const parts = spec.parts.filter((p) => lod === 0 || !p.detail);

  parts.forEach((part, pi) => {
    const [sx, sy, sz] = part.size;
    const jIdx = part.joint;
    const pivot = spec.joints[jIdx].pos || [0, 0, 0];
    const bound = lodJoint(spec, jIdx, lod);
    const bpivot = spec.joints[bound].pos || [0, 0, 0];
    const off = part.offset || [0, 0, 0];
    // center of the part in the bound joint's local space
    const cx = pivot[0] - bpivot[0] + off[0], cy = pivot[1] - bpivot[1] + off[1], cz = pivot[2] - bpivot[2] + off[2];
    const tt = SLOT[part.tint || 'body'];
    const shape = PART_SHAPES[part.shape];
    const pt = (x, y, z) => [cx + x, cy + y, cz + z];

    const tri = (a, b, c) => {
      // orient outward (parts are convex): flip when the normal faces the part centre
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const m = [(a[0] + b[0] + c[0]) / 3 - cx, (a[1] + b[1] + c[1]) / 3 - cy, (a[2] + b[2] + c[2]) / 3 - cz];
      if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) { const t = b; b = c; c = t; n = [-n[0], -n[1], -n[2]]; }
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / len, n[1] / len, n[2] / len];
      for (const p of [a, b, c]) {
        pos.push(p[0], p[1], p[2]); joint.push(bound); tint.push(tt);
        smoothKey.push(pi + ':' + p.map((x) => x.toFixed(3)).join(','));
        flatN.push(n[0], n[1], n[2]);
      }
    };
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };

    if (part.shape === 'box') {
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const c = [];
      for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) c.push(pt(x, y, z));
      // index = x*4 + y*2 + z
      quad(c[0], c[1], c[3], c[2]); quad(c[4], c[5], c[7], c[6]);
      quad(c[0], c[1], c[5], c[4]); quad(c[2], c[3], c[7], c[6]);
      quad(c[0], c[2], c[6], c[4]); quad(c[1], c[3], c[7], c[5]);
    } else {
      const N = shape.sides;
      const ring = (r, y) => {
        const out = [];
        for (let k = 0; k < N; k++) {
          const a = Math.PI / 2 + (k / N) * Math.PI * 2;
          out.push(pt(Math.cos(a) * r * sx / 2, y * sy, Math.sin(a) * r * sz / 2));
        }
        return out;
      };
      const rings = shape.profile.map(([r, y]) => ({ r, y, pts: ring(r, y) }));
      for (let i = 0; i + 1 < rings.length; i++) {
        const A = rings[i], B = rings[i + 1];
        for (let k = 0; k < N; k++) {
          const k2 = (k + 1) % N;
          if (B.r === 0) tri(A.pts[k], A.pts[k2], pt(0, B.y * sy, 0));
          else quad(A.pts[k], A.pts[k2], B.pts[k2], B.pts[k]);
        }
      }
      for (const R of [rings[0], rings[rings.length - 1]]) {
        if (R.r === 0) continue;
        for (let k = 1; k < N - 1; k++) tri(R.pts[0], R.pts[k], R.pts[k + 1]);
      }
    }
  });

  // smooth normals for the ink outline: average flat normals of vertices sharing a position within a part
  const acc = new Map();
  for (let i = 0; i < smoothKey.length; i++) {
    const a = acc.get(smoothKey[i]) || [0, 0, 0];
    a[0] += flatN[i * 3]; a[1] += flatN[i * 3 + 1]; a[2] += flatN[i * 3 + 2];
    acc.set(smoothKey[i], a);
  }
  const smooth = new Float32Array(smoothKey.length * 3);
  for (let i = 0; i < smoothKey.length; i++) {
    const a = acc.get(smoothKey[i]);
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    smooth.set([a[0] / l, a[1] / l, a[2] / l], i * 3);
  }

  const T = THREE || globalThis.__COIL_THREE__;
  const BufferGeometry = T ? T.BufferGeometry : class { constructor() { this.attributes = {}; } setAttribute(k, v) { this.attributes[k] = v; } };
  const Attr = T ? T.BufferAttribute : class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } };
  const g = new BufferGeometry();
  g.setAttribute('position', new Attr(new Float32Array(pos), 3));
  g.setAttribute('aJoint', new Attr(new Float32Array(joint), 1));
  g.setAttribute('aTint', new Attr(new Float32Array(tint), 1));
  g.setAttribute('aSmooth', new Attr(smooth, 3));
  return g;
}

// Deterministic placeholder pose for tests and the stress scene until the Lead's rig lands: hop + squash.
export function stubPose(kind, id, t, i = 0) {
  const spec = KIND_SPECS[kind];
  const joints = restJoints(spec);
  const hop = Math.abs(Math.sin(t * 6 + id)) * 0.18;
  joints[1] += hop;                  // body rises
  joints[3] = 1 + (0.18 - hop) * 0.3; // squash on landing
  return { id, kind, side: id % 2, x: (i % 20) * 2.5, y: 0, z: Math.floor(i / 20) * 2.5, yaw: 0, scale: 1, joints };
}

// ---------------------------------------------------------------------------------------------------------------
// GPU renderer
// ---------------------------------------------------------------------------------------------------------------
const VERT = `
precision highp float;
precision highp sampler2D;
uniform sampler2D uJoints;
uniform vec2 uRes;
uniform float uOutlinePx;
attribute float aJoint; attribute float aTint; attribute vec3 aSmooth; attribute float aUnit; attribute vec3 aTeam;
varying vec3 vView; varying vec3 vCol;
uniform vec3 uBody; uniform vec3 uAccent;
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  int row = int(aUnit); int j = int(aJoint);
  vec4 a = texelFetch(uJoints, ivec2(j * 2, row), 0);
  vec4 b = texelFetch(uJoints, ivec2(j * 2 + 1, row), 0);
  vec3 p = a.xyz + a.w * qrot(b, position);
  vCol = aTint < 0.5 ? uBody : (aTint < 1.5 ? aTeam : uAccent);
  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec4 view = viewMatrix * world;
  vView = view.xyz;
  vec4 clip = projectionMatrix * view;
#ifdef OUTLINE
  vec3 n = mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * qrot(b, aSmooth);
  vec2 dir = normalize(n.xy + 1e-5);
  clip.xy += dir * uOutlinePx * (2.0 / uRes) * clip.w;
#endif
  gl_Position = clip;
}`;
const FRAG_FILL = `
precision highp float;
varying vec3 vView; varying vec3 vCol;
void main() {
  vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
  float l = 0.45 + 0.55 * max(dot(n, normalize(vec3(0.4, 0.8, 0.5))), 0.0);
  gl_FragColor = vec4(vCol * l, 1.0);
}`;
const FRAG_INK = `
precision highp float;
uniform vec3 uInk;
void main() { gl_FragColor = vec4(uInk, 1.0); }`;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function createCoilRenderer(THREE, opts = {}) {
  globalThis.__COIL_THREE__ = THREE;
  const maxPerKind = opts.maxPerKind ?? 256;
  const lodDistance = opts.lodDistance ?? 60;
  const outlinePx = opts.outlinePx ?? 2;
  const camera = opts.camera || null;
  const group = new THREE.Group();
  const uRes = { value: new THREE.Vector2(opts.width ?? 1280, opts.height ?? 720) };
  const kinds = {};
  const states = new Map(); // `${kind}:${id}` -> spring state
  let last = { drawCalls: 0, instances: 0, triangles: 0, perLod: [0, 0] };

  const common = () => ({
    uRes, uOutlinePx: { value: outlinePx },
    uBody: { value: new THREE.Vector3(...hexToRgb(opts.bodyColor || BODY)) },
    uAccent: { value: new THREE.Vector3(...hexToRgb(opts.accentColor || ACCENT)) },
    uInk: { value: new THREE.Vector3(...hexToRgb(INK)) },
  });

  for (const [name, spec] of Object.entries(KIND_SPECS)) {
    const jc = spec.joints.length;
    const data = new Float32Array(jc * 8 * maxPerKind);
    const tex = new THREE.DataTexture(data, jc * 2, maxPerKind, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const k = { name, spec, jc, data, tex, rest: restJoints(spec), slotOf: new Map(), lods: [], outline: null,
      names: Object.fromEntries(spec.joints.map((j, i) => [j.name, i])) };
    for (let lod = 0; lod < 2; lod++) {
      const geo = buildKindGeometry(spec, lod, THREE);
      const aUnit = new THREE.InstancedBufferAttribute(new Float32Array(maxPerKind), 1);
      const aTeam = new THREE.InstancedBufferAttribute(new Float32Array(maxPerKind * 3), 3);
      aUnit.setUsage(THREE.DynamicDrawUsage); aTeam.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aUnit', aUnit); geo.setAttribute('aTeam', aTeam);
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG_FILL,
        uniforms: { ...common(), uJoints: { value: tex } },
      });
      const mesh = new THREE.InstancedMesh(geo, mat, maxPerKind);
      mesh.count = 0; mesh.frustumCulled = false; mesh.name = name + ':lod' + lod;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
      k.lods.push({ mesh, aUnit, aTeam, tris: geo.attributes.position.count / 3 });
      if (lod === 0) {
        const omat = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG_INK, side: THREE.BackSide,
          defines: { OUTLINE: 1 }, uniforms: { ...common(), uJoints: { value: tex } },
        });
        const om = new THREE.InstancedMesh(geo, omat, maxPerKind); // shares geometry + instance attributes
        om.count = 0; om.frustumCulled = false; om.name = name + ':ink';
        om.instanceMatrix = mesh.instanceMatrix;
        group.add(om);
        k.outline = om;
      }
    }
    kinds[name] = k;
  }

  function springState(key, unit) {
    let s = states.get(key);
    if (!s) { s = { yaw: { x: unit.yaw || 0, v: 0 }, y: { x: unit.y || 0, v: 0 }, seen: 0 }; states.set(key, s); }
    return s;
  }

  let frameNo = 0;
  function update(units, dt = 1 / 60, time = 0) {
    frameNo++;
    for (const k of Object.values(kinds)) { k.slotOf.clear(); k.n = [0, 0]; k.total = 0; }
    const cam = camera ? camera.position : null;
    const lodCount = [0, 0];
    // first pass: count per kind to assign slots; lods fill their own instance arrays
    for (const u of units) {
      const k = kinds[u.kind];
      if (!k || k.total >= maxPerKind) continue;
      const slot = k.total++;
      k.slotOf.set(u.id, slot);
      const key = u.kind + ':' + u.id;
      const st = springState(key, u);
      st.seen = frameNo;

      // joints: copy supplied or rest, then drive attachment joints by springs
      const row = k.data.subarray(slot * k.jc * 8, (slot + 1) * k.jc * 8);
      if (u.joints && u.joints.length >= k.jc * 8) row.set(u.joints.subarray ? u.joints.subarray(0, k.jc * 8) : u.joints.slice(0, k.jc * 8));
      else row.set(k.rest);
      const yaw = u.yaw || 0;
      const tgt = yaw + Math.PI * 2 * Math.round((st.yaw.x - yaw) / (Math.PI * 2));
      stepSpring(st.yaw, tgt, dt, 140, 10);
      stepSpring(st.y, u.y || 0, dt, 120, 8);
      const lag = Math.max(-0.7, Math.min(0.7, st.yaw.x - tgt));
      const bob = Math.max(-0.4, Math.min(0.4, st.y.x - (u.y || 0)));
      for (let j = 0; j < k.jc; j++) {
        const at = k.spec.joints[j].attach;
        if (!at) continue;
        const ang = lag * at.swing * (at.k > 100 ? 1 : 1.4); // softer springs show more swing
        const o = j * 8;
        row[o + 4] = 0; row[o + 5] = Math.sin(ang / 2); row[o + 6] = 0; row[o + 7] = Math.cos(ang / 2);
        row[o + 1] = k.rest[o + 1] + bob * at.swing;
      }

      // instance transform (translate + yaw + uniform scale) written straight into the matrix array
      const d = cam ? Math.hypot(u.x - cam.x, (u.y || 0) - cam.y, u.z - cam.z) : 0;
      const lod = cam ? lodFor(d, lodDistance) : 0;
      const L = k.lods[lod];
      const i = k.n[lod]++;
      const s = u.scale ?? 1, c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
      L.mesh.instanceMatrix.array.set([c, 0, -sn, 0, 0, s, 0, 0, sn, 0, c, 0, u.x, u.y || 0, u.z, 1], i * 16);
      L.aUnit.array[i] = slot;
      const tc = TEAM[(u.side || 0) % TEAM.length];
      L.aTeam.array.set(tc, i * 3);
      lodCount[lod]++;
    }
    let draws = 0, tris = 0, inst = 0;
    for (const k of Object.values(kinds)) {
      k.tex.needsUpdate = true;
      k.lods.forEach((L, lod) => {
        L.mesh.count = k.n[lod];
        L.mesh.instanceMatrix.needsUpdate = true; L.aUnit.needsUpdate = true; L.aTeam.needsUpdate = true;
        if (k.n[lod]) { draws++; tris += k.n[lod] * L.tris; inst += k.n[lod]; }
      });
      k.outline.count = k.n[0];
      if (k.n[0]) draws++;
    }
    for (const [key, s] of states) if (s.seen !== frameNo) states.delete(key);
    last = { drawCalls: draws, instances: inst, triangles: tris, perLod: lodCount };
  }

  return {
    group,
    update,
    stats: () => ({ ...last }),
    setSize(w, h) { uRes.value.set(w, h); },
    /** Test hook: the 8 floats last written for a unit's named joint. */
    debugJoint(kind, id, jointName) {
      const k = kinds[kind];
      const slot = k.slotOf.get(id);
      const o = (slot * k.jc + k.names[jointName]) * 8;
      return Array.from(k.data.slice(o, o + 8));
    },
    dispose() {
      for (const k of Object.values(kinds)) {
        k.tex.dispose();
        k.lods.forEach((L) => { L.mesh.geometry.dispose(); L.mesh.material.dispose(); });
        k.outline.material.dispose();
      }
    },
  };
}
