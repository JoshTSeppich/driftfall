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

// GPT's per-instance edge shader (research/TOY-EDGES-GPT.md). Needs centred unit BoxGeometry + an instanced aHalf
// attribute (half-size per instance, see createToyBoxInstances). A mesh WITHOUT aHalf gets no edges (toyHas = 0)
// instead of the whole surface lighting up. Albedo tint in linear space before PBR, params are uniforms.
export function applyToyEdges(material, { band = 0.025, intensity = 0.18, tint = 0xfff0d5, inset = 0.07, THREE = THREE_NS } = {}) {
  if (!material.isMeshStandardMaterial) throw new TypeError('applyToyEdges requires THREE.MeshStandardMaterial');
  if (material.userData.toyEdges) throw new Error('Toy edges already applied to this material');
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const uniforms = {
    uToyBand: { value: Math.max(0.0001, band) }, uToyIntensity: { value: clamp01(intensity) },
    uToyTint: { value: new THREE.Color(tint) }, uToyInset: { value: clamp01(inset) },
  };
  const prevCompile = material.onBeforeCompile, prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aHalf;\nvarying vec3 vToyPos;\nvarying vec3 vToyHalf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vToyHalf = aHalf;\n  vToyPos = position * (2.0 * aHalf);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
      varying vec3 vToyPos; varying vec3 vToyHalf;
      uniform float uToyBand; uniform float uToyIntensity; uniform vec3 uToyTint; uniform float uToyInset;
      vec2 toyEdgeMasks(vec3 p, vec3 h) {
        vec3 d = max(h - abs(p), vec3(0.0));
        vec3 aa = max(fwidth(d), vec3(0.00001));
        vec3 nearEdge = 1.0 - smoothstep(vec3(uToyBand) - aa, vec3(uToyBand) + aa, d);
        float hi = max(nearEdge.x * nearEdge.y, max(nearEdge.x * nearEdge.z, nearEdge.y * nearEdge.z));
        float inner = uToyBand * 2.5;
        vec3 ip = 1.0 - smoothstep(vec3(inner) - aa, vec3(inner) + aa, d);
        float ie = max(ip.x * ip.y, max(ip.x * ip.z, ip.y * ip.z));
        return vec2(hi, max(0.0, ie - hi));
      }`);
    const marker = '#include <color_fragment>';
    if (!shader.fragmentShader.includes(marker)) throw new Error('applyToyEdges: color_fragment chunk not found');
    shader.fragmentShader = shader.fragmentShader.replace(marker, /* glsl */`${marker}
      float toyHas = step(0.001, vToyHalf.x);
      vec2 toyMasks = toyEdgeMasks(vToyPos, max(vToyHalf, vec3(0.0001))) * toyHas;
      diffuseColor.rgb *= 1.0 - toyMasks.y * uToyInset;
      diffuseColor.rgb = mix(diffuseColor.rgb, uToyTint, toyMasks.x * uToyIntensity);`);
  };
  material.customProgramCacheKey = () => prevKey() + '|toy-edges-r169-v1';
  material.userData.toyEdges = uniforms;
  material.needsUpdate = true;
  return {
    material,
    setBand(v) { uniforms.uToyBand.value = Math.max(0.0001, v); },
    setIntensity(v) { uniforms.uToyIntensity.value = clamp01(v); },
    setTint(v) { uniforms.uToyTint.value.set(v); },
    setInset(v) { uniforms.uToyInset.value = clamp01(v); },
  };
}

// dimensions: [{ x, y, z, width, height, depth, quaternion? }] -> one InstancedMesh of unit boxes with aHalf set.
export function createToyBoxInstances(dimensions, material, THREE = THREE_NS) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const halves = new Float32Array(dimensions.length * 3);
  const mesh = new THREE.InstancedMesh(geometry, material, dimensions.length);
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), rot = new THREE.Quaternion();
  dimensions.forEach((it, i) => {
    const { width, height, depth } = it;
    if (!(width > 0 && height > 0 && depth > 0)) throw new Error('Box dimensions must be positive');
    halves.set([width / 2, height / 2, depth / 2], i * 3);
    pos.set(it.x ?? 0, it.y ?? 0, it.z ?? 0); scale.set(width, height, depth);
    if (it.quaternion) rot.copy(it.quaternion); else rot.identity();
    mesh.setMatrixAt(i, m.compose(pos, rot, scale));
  });
  geometry.setAttribute('aHalf', new THREE.InstancedBufferAttribute(halves, 3));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// The live game's units (play/units-instanced.mjs) bake vertex-coloured shapes into one geometry per kind, so the
// aHalf edge shader cannot apply to them. They get the satin-enamel feel (RENDERING.md chassis row) and receive the key
// shadow instead. Returns how many materials were changed; a second pass over the same root changes none.
export function applyToyToUnits(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mat = o.material;
    if (mat?.isMeshStandardMaterial && mat.vertexColors && !mat.userData.toyUnit) {
      mat.roughness = TOY_MATERIALS.chassis.roughness; mat.metalness = 0.06;
      mat.userData.toyUnit = true; mat.needsUpdate = true; n++;
    }
    if (mat?.userData?.toyUnit) o.receiveShadow = true;
  });
  return n;
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
  const want = Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) / 2 + margin;
  const half = Math.max(min, Math.min(max, Math.ceil(want / 2) * 2));   // steps of 2: the texel size changes rarely
  return { cx, cy, half };
}

// Snap the shadow-box centre to whole shadow-map texels along the light's right/up axes, so the shadow edges stay put
// while the camera pans (no shimmer). dir is the sun offset direction; texel is world units per shadow texel.
export function snapShadowCentre(centre, dir, texel, THREE = THREE_NS) {
  const f = dir.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f).normalize();
  const up = new THREE.Vector3().crossVectors(f, right).normalize();
  const a = Math.round(centre.dot(right) / texel) * texel, b = Math.round(centre.dot(up) / texel) * texel;
  return new THREE.Vector3().addScaledVector(right, a).addScaledVector(up, b).addScaledVector(f, centre.dot(f));
}

// ----- contact shadows (item 2) -----
// 64 px gaussian, 0 at the edge; DataTexture so it also builds in node. ONE texture shared by every decal.
function radialAlphaTexture(THREE, n = 64) {
  const data = new Uint8Array(n * n * 4);
  const c = (n - 1) / 2, r = n / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const d = Math.hypot((i - c) / r, (j - c) / r);
    const edge = Math.min(1, Math.max(0, (d - 0.7) / 0.3));
    const a = Math.exp(-5 * d * d) * (1 - edge * edge * (3 - 2 * edge));
    data[(j * n + i) * 4 + 3] = Math.round(255 * a);
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
// list items: { x, y (ground height), z, radius } or { x, y, z, width, depth }. The plane is rotated flat once, so
// footprint depth lives in scale.z (the note in TOY-EDGES-GPT.md was right).
export function createContactShadows(ctx, { capacity = 512, opacity = 0.26, widen = 1.12 } = {}) {
  const { THREE = THREE_NS } = ctx;
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const map = radialAlphaTexture(THREE);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x18242b, map, transparent: true, opacity, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, toneMapped: false, fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.name = 'toy-contact-shadows'; mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 2;
  mesh.castShadow = mesh.receiveShadow = false;
  ctx.scene.add(mesh);
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  return {
    mesh,
    set(list) {
      const n = Math.min(list.length, capacity);
      for (let i = 0; i < n; i++) {
        const u = list[i];
        const w = (u.width ?? u.radius * 2) * widen, d = (u.depth ?? u.radius * 2) * widen;
        m.compose(pos.set(u.x, u.y + 0.012, u.z), q, s.set(w, 1, d));
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
  // samples is read when three allocates the target's GL storage (first use, and again after every setSize), so setting
  // it here, before the first frame, takes effect; dispose() drops any storage that was already allocated at 1x.
  for (const t of [comp?.renderTarget1, comp?.renderTarget2]) if (t) { t.samples = 4; t.dispose?.(); }
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
      const snapped = snapShadowCentre(centre, offset, (2 * f.half) / sun.shadow.mapSize.x, THREE);   // no shimmer on pans
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).add(offset);
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
// Idempotent: createPlayRenderer and startGame may both call it, the second call returns ctx.toy. With no query it reads
// the page URL, so ?toy=0 works whoever installs. result.missing lists engine pieces the ctx lacked (warned once).
export function installToy(ctx, engine, { query, governor = true } = {}) {
  if (ctx.toy) return ctx.toy;
  query ??= globalThis.location ? new URLSearchParams(globalThis.location.search) : undefined;
  if (!toyEnabled(query)) return null;
  const missing = ['quality', 'composer', 'gridToWorld', 'worldToGrid'].filter((k) => !ctx[k]);
  if (missing.length) console.warn('[toy] ctx lacks', missing.join(', '), '- those parts of the toy look are skipped');
  const look = applyToyLook(ctx, { engine });
  let unitsDone = false;
  const system = {
    name: 'toy',
    update(_frame, dt) {
      if (ctx.gridToWorld && ctx.worldToGrid && ctx.camera) look.follow(viewBoundsOf(ctx));
      if (governor && dt > 0 && dt < 1) look.governor.push(dt * 1000);
      if (!unitsDone) {   // the units system is added after us; satin-finish its materials once its group exists
        const g = ctx.scene.getObjectByName('units-instanced');
        if (g) { applyToyToUnits(g); unitsDone = true; }
      }
    },
  };
  engine.add(system);
  return (ctx.toy = { look, system, missing, tier: () => look.governor.tier });
}
