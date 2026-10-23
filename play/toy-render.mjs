// Premium toy renderer (owner: sonnet). RENDERING.md "THE FIVE TO BUILD FIRST", visuals only: nothing here reads or
// writes the sim. play/render.mjs calls applyToyLook(ctx) unless the page has ?toy=0.
//
//   toyEnabled(query)                      false only for ?toy=0
//   applyToyLook(ctx, { engine }) -> look  key/fill/rim/hemisphere rig, AgX + sRGB, PCF-soft shadow on the key only,
//                                          4x MSAA on the composer targets, pixel ratio capped at 1.5;
//                                          look = { fill, follow(viewBounds), setTier(tier), governor, dispose() }
//   TOY_MATERIALS / makeToyMaterials(THREE)  shared satin-enamel materials (RENDERING.md table), edge highlight baked in
//   injectEdgeHighlight(shader, opts)      onBeforeCompile body: object-space box-edge band, fwidth AA, no new geometry
//   planBatches(parts, chunk)              part list -> instanced batches per (part type, map chunk) for frustum culling
//   fitShadowFrustum(bounds, opts)         tight ortho shadow box centred on the visible ground
//   createContactShadows(ctx, opts)        one InstancedMesh of radial-alpha decals under units
//   QUALITY_TIERS / createGovernor(opts)   High / Balanced / Performance on rolling frame time with hysteresis
//
// Pure helpers are exercised by tests/toy-render.test.mjs in node with real Three.js.

import * as THREE_NS from 'three';

export function toyEnabled(query) {
  return !(query && typeof query.get === 'function' && query.get('toy') === '0');
}

// ----- materials (RENDERING.md item 3) -----
export const TOY_MATERIALS = {
  chassis:   { color: '#F2D7A6', roughness: 0.48, metalness: 0 },
  faceplate: { color: '#303844', roughness: 0.35, metalness: 0.08 },
  team:      { color: '#32D9E8', roughness: 0.38, metalness: 0.05 },
  toast:     { color: '#D99448', roughness: 0.82, metalness: 0 },
  feet:      { color: '#434A52', roughness: 0.65, metalness: 0.10 },
};

// Edge band: where the two nearest of the box's three face-pair distances are both inside the band, add a warm ivory
// highlight. Plain object-space maths on the vertex position, so it works on instanced boxes with a shared geometry.
export function injectEdgeHighlight(shader, { halfExtents = [0.5, 0.5, 0.5], band = 0.02, intensity = 0.18, inset = 0.06, THREE = THREE_NS } = {}) {
  if (shader.uniforms.uToyHalf) return shader;
  if (!shader.vertexShader.includes('#include <begin_vertex>') || !shader.fragmentShader.includes('#include <opaque_fragment>')) {
    throw new Error('injectEdgeHighlight: shader has no begin_vertex / opaque_fragment chunk');
  }
  shader.uniforms.uToyHalf = { value: new THREE.Vector3(...halfExtents) };
  shader.uniforms.uToyBand = { value: band };
  shader.uniforms.uToyIntensity = { value: intensity };
  shader.uniforms.uToyInset = { value: inset };
  shader.vertexShader = 'varying vec3 vToyPos;\n' + shader.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vToyPos = position;');
  shader.fragmentShader = `varying vec3 vToyPos; uniform vec3 uToyHalf; uniform float uToyBand, uToyIntensity, uToyInset;\n` + shader.fragmentShader
    .replace('#include <opaque_fragment>', /* glsl */`
  {
    vec3 d = max(uToyHalf - abs(vToyPos), 0.0);
    float lo = min(d.x, min(d.y, d.z));
    float hi = max(d.x, max(d.y, d.z));
    float mid = d.x + d.y + d.z - lo - hi;
    float w = uToyBand * min(uToyHalf.x, min(uToyHalf.y, uToyHalf.z)) * 2.0;
    float aa = max(fwidth(mid), 1e-5);
    float edge = 1.0 - smoothstep(w - aa, w + aa, mid);       // two boundaries meet: a box edge
    float rim = smoothstep(0.0, w * 1.6, lo) * edge;           // dark inset just inside, light on the crest
    outgoingLight += vec3(1.0, 0.96, 0.86) * uToyIntensity * edge * (1.0 - rim) - vec3(uToyInset) * rim * edge;
  }
  #include <opaque_fragment>`);
  return shader;
}

export function makeToyMaterials(THREE = THREE_NS, { halfExtents = [0.5, 0.5, 0.5] } = {}) {
  const out = {};
  for (const [name, m] of Object.entries(TOY_MATERIALS)) {
    const mat = new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness });
    mat.name = `toy-${name}`;
    mat.onBeforeCompile = (shader) => injectEdgeHighlight(shader, { halfExtents, THREE });
    mat.customProgramCacheKey = () => `toy-edge-${halfExtents.join('_')}`;
    out[name] = mat;
  }
  return out;
}

// ----- batching (item 4) -----
export const BATCH_TYPES = ['chassis', 'faceplate', 'team', 'feet', 'toast', 'eyes', 'decal'];
export function planBatches(parts, chunk = 16) {
  const map = new Map();
  for (const p of parts) {
    const ti = BATCH_TYPES.indexOf(p.type);
    if (ti < 0) throw new Error(`planBatches: unknown part type ${p.type}`);
    const cx = Math.floor(p.x / chunk), cy = Math.floor(p.y / chunk);
    const key = `${ti}/${cx}/${cy}`;
    let b = map.get(key);
    if (!b) map.set(key, b = { type: p.type, cx, cy, items: [], ti });
    b.items.push(p);
  }
  return [...map.values()].sort((a, b) => a.ti - b.ti || a.cy - b.cy || a.cx - b.cx).map(({ ti, ...b }) => b);
}

// ----- shadow frustum (item 2) -----
export function fitShadowFrustum(bounds, { margin = 3, min = 12, max = 28 } = {}) {
  const cx = (bounds.x0 + bounds.x1) / 2, cy = (bounds.y0 + bounds.y1) / 2;
  const half = Math.max(min, Math.min(max, Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) / 2 + margin));
  return { cx, cy, half };
}

// ----- contact shadows (item 2) -----
function radialAlphaTexture(THREE, n = 32) {
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const r = Math.hypot((i + 0.5) / n - 0.5, (j + 0.5) / n - 0.5) * 2;
    const a = Math.max(0, 1 - r); data[(j * n + i) * 4 + 3] = Math.round(255 * a * a * (3 - 2 * a));
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
export function createContactShadows(ctx, { capacity = 512, opacity = 0.26, widen = 1.1 } = {}) {
  const { THREE = THREE_NS } = ctx;
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const map = radialAlphaTexture(THREE);
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, map, transparent: true, opacity, depthWrite: false, fog: false });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.name = 'toy-contact-shadows'; mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 2;
  ctx.scene.add(mesh);
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  return {
    mesh,
    set(list) {
      const n = Math.min(list.length, capacity);
      for (let i = 0; i < n; i++) {
        const u = list[i], d = u.radius * 2 * widen;
        m.compose(pos.set(u.x, u.y + 0.02, u.z), q, s.set(d, 1, d));
        mesh.setMatrixAt(i, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { ctx.scene.remove(mesh); geo.dispose(); mat.dispose(); map.dispose(); },
  };
}

// ----- quality governor (item 14) -----
export const QUALITY_TIERS = [
  { name: 'high',        pixelRatio: 1.5,  shadowMap: 2048 },
  { name: 'balanced',    pixelRatio: 1.25, shadowMap: 1024 },
  { name: 'performance', pixelRatio: 1.0,  shadowMap: 1024 },
];
export function createGovernor({ window = 90, downMs = 20, upMs = 13, cooldown = 240, onTier = null } = {}) {
  let i = 0, since = Infinity;
  const buf = [];
  const sorted = () => [...buf].sort((a, b) => a - b);
  const q = (p) => { const s = sorted(); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const g = {
    get tier() { return QUALITY_TIERS[i]; },
    stats: () => ({ median: q(0.5), p95: q(0.95), frames: buf.length }),
    push(ms) {
      buf.push(ms); if (buf.length > window) buf.shift();
      since++;
      if (buf.length < window || since < cooldown) return g.tier;
      const med = q(0.5);
      let next = i;
      if (med > downMs && i < QUALITY_TIERS.length - 1) next = i + 1;
      else if (med < upMs && i > 0) next = i - 1;
      if (next !== i) { i = next; since = 0; buf.length = 0; onTier?.(g.tier); }
      return g.tier;
    },
  };
  return g;
}

// ----- the look (items 1, 2, 5) -----
export function applyToyLook(ctx, { engine = null } = {}) {
  const { THREE = THREE_NS, scene, renderer, lights } = ctx;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const { sun, rim, hemi } = lights;
  sun.color.set(0xffedd7); sun.intensity = 2.6; sun.position.set(-8, 14, 9);
  sun.castShadow = renderer.shadowMap.enabled;
  Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 0.5, far: 65 });
  sun.shadow.camera.updateProjectionMatrix?.();
  sun.shadow.bias = -0.00015; sun.shadow.normalBias = 0.025;
  rim.color.set(0xffffff); rim.intensity = 0.9; rim.position.set(4, 9, -10); rim.castShadow = false;
  hemi.color.set(0xe8f5ff); hemi.groundColor.set(0x65727d); hemi.intensity = 0.85;
  if (lights.ambient) lights.ambient.intensity = 0;
  const fill = new THREE.DirectionalLight(0xd7edff, 0.65);
  fill.position.set(7, 5, -4); fill.castShadow = false;
  scene.add(fill);

  // 4x MSAA on the composer targets and a pixel ratio capped at 1.5
  const comp = ctx.composer;
  for (const t of [comp?.renderTarget1, comp?.renderTarget2]) if (t) t.samples = 4;
  if (ctx.quality) ctx.quality.dprCap = 1.5;
  engine?.resize?.();

  const offset = new THREE.Vector3(-8, 14, 9).multiplyScalar(1.6);
  const centre = new THREE.Vector3();
  const look = {
    fill,
    follow(bounds) {
      if (!bounds || !Number.isFinite(bounds.x0)) return;
      const f = fitShadowFrustum(bounds);
      ctx.gridToWorld(f.cx, f.cy, 0, centre);
      sun.target.position.copy(centre);
      sun.position.copy(centre).add(offset);
      const c = sun.shadow.camera;
      c.left = -f.half; c.right = f.half; c.top = f.half; c.bottom = -f.half;
      c.updateProjectionMatrix?.();
      sun.target.updateMatrixWorld?.();
    },
    setTier(tier) {
      if (ctx.quality) ctx.quality.dprCap = tier.pixelRatio;
      if (sun.shadow.mapSize.x !== tier.shadowMap) {
        sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
        sun.shadow.map?.dispose?.(); sun.shadow.map = null;
      }
      engine?.resize?.();
    },
    governor: null,
    dispose() { scene.remove(fill); },
  };
  look.governor = createGovernor({ onTier: (t) => look.setTier(t) });
  return look;
}

// Ground rectangle (grid tiles) the camera sees, from the four screen corners hitting y = 0.
export function viewBoundsOf(ctx) {
  const { THREE = THREE_NS, camera } = ctx;
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const xs = [], ys = [];
  for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ray.setFromCamera({ x: nx, y: ny }, camera);
    if (!ray.ray.intersectPlane(plane, hit)) continue;
    const g = ctx.worldToGrid(hit); xs.push(g.x); ys.push(g.y);
  }
  return xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : null;
}

// One call from the page or play/render.mjs: look + an engine system that keeps the shadow box on the view and
// feeds frame times to the governor. Returns null when ?toy=0.
export function installToy(ctx, engine, { query, governor = true } = {}) {
  if (!toyEnabled(query)) return null;
  const look = applyToyLook(ctx, { engine });
  const system = {
    name: 'toy',
    update(_frame, dt) {
      look.follow(viewBoundsOf(ctx));
      if (governor && dt > 0 && dt < 1) look.governor.push(dt * 1000);
    },
  };
  engine.add(system);
  return { look, system, tier: () => look.governor.tier };
}
