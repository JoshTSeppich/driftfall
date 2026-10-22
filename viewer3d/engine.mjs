// Driftfall 3D engine (owner: fable). See VISUAL-3D.md for the shared contract.
//
//   createEngine(canvas, opts) -> { ctx, add(system), remove(system), start(), stop(), resize(), dispose(), setWorld(world) }
//   ctx = { THREE, scene, camera, renderer, composer, clock, palette, assets, gridToWorld(x, y, h) -> Vector3, tileSize,
//           grid: { width, height }, time: { t, speed, playing, duration, loop, ticksPerSecond },
//           size: { width, height, dpr }, lights: { sun, hemi, rim, ambient }, quality, world,
//           stats (the game's stats table from the log), perf: { fps, ms, calls, triangles },
//           heightAt(x, y) (terrain surface height, set by index.html from terrain.mjs), look (resolved colours) }
//
// Each render frame the engine advances ctx.time (fixed ticks per second times speed), asks the world for
// frame(t) and calls every system's update(frame, dt). A system that throws is switched off for the rest of the
// match (logged once) so one broken module never blanks the whole scene.
//
// Pure helpers are exported below createEngine so node tests can cover them without WebGL.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------------------------------------------
// Defaults. palette.mjs overrides any of these when it is loaded; the engine only needs these few keys.
// ---------------------------------------------------------------------------------------------------------------

export const DEFAULT_PALETTE = {
  teams: [0x33e0ff, 0xffb13b], // side 0 cyan, side 1 amber
  background: 0x171326,       // dusk sky behind the plateau
  fog: 0x241c3a,
  fogDensity: 0.018,
  ground: 0x2a2633,
  rock: 0x4a4556,
  crystal: 0x4ef0d8,
  crystalEmissive: 0x19b09a,
  sun: 0xffb07a,              // low warm sun
  sunIntensity: 2.6,
  sky: 0x6a5fb8,              // hemisphere top
  groundBounce: 0x2b1d14,     // hemisphere bottom
  hemiIntensity: 0.55,
  rim: 0x6fc6ff,              // cool rim light from behind
  rimIntensity: 1.1,
  exposure: 1.05,
  bloom: { strength: 0.55, radius: 0.6, threshold: 0.82 },
  vignette: { strength: 0.42, softness: 0.55 },
};

export const QUALITY = {
  high:   { dprCap: 2,    shadowMapSize: 2048, shadows: true,  bloom: true,  bloomScale: 1 },
  medium: { dprCap: 1.5,  shadowMapSize: 1024, shadows: true,  bloom: true,  bloomScale: 0.5 },
  low:    { dprCap: 1,    shadowMapSize: 512,  shadows: false, bloom: false, bloomScale: 0.5 },
};

export function pickQuality(name) {
  return { name: QUALITY[name] ? name : 'high', ...(QUALITY[name] ?? QUALITY.high) };
}

// The engine accepts either the rich object from palette.mjs (createPalette: team[i].main, world.ground,
// fog.color, lights.sun...) or the flat DEFAULT_PALETTE shape. resolveLook() reduces both to the handful of
// values the renderer, lights and placeholder need. Colours stay as whatever THREE.Color accepts (hex int or css).
export function resolveLook(p = {}) {
  const d = DEFAULT_PALETTE;
  const team = (i) => p.team?.[i]?.main ?? p.team?.[i] ?? p.teams?.[i] ?? d.teams[i];
  const strip = (i) => p.team?.[i]?.strip ?? p.team?.[i]?.light ?? team(i);
  const fogColor = p.fog?.color ?? (typeof p.fog === 'number' || typeof p.fog === 'string' ? p.fog : d.fog);
  const L = p.lights ?? {};
  return {
    teams: [team(0), team(1)],
    strips: [strip(0), strip(1)],
    background: p.background ?? p.sky?.mid ?? fogColor,
    fog: { color: fogColor, density: p.fog?.density ?? p.fogDensity ?? d.fogDensity },
    ground: p.world?.ground ?? p.ground ?? d.ground,
    rock: p.world?.rock ?? p.rock ?? d.rock,
    crystal: p.world?.shard ?? p.shard ?? p.crystal ?? d.crystal,
    crystalEmissive: p.world?.shardDark ?? p.crystalEmissive ?? d.crystalEmissive,
    sun: { color: L.sun?.color ?? p.sun ?? d.sun, intensity: L.sun?.intensity ?? p.sunIntensity ?? d.sunIntensity,
      position: L.sun?.position ?? null, shadowRadius: L.sun?.shadowRadius ?? 4 },
    hemi: { sky: L.sky?.skyColor ?? p.sky ?? d.sky, ground: L.sky?.groundColor ?? p.groundBounce ?? d.groundBounce,
      intensity: L.sky?.intensity ?? p.hemiIntensity ?? d.hemiIntensity },
    rim: { color: L.rim?.color ?? p.rim ?? d.rim, intensity: L.rim?.intensity ?? p.rimIntensity ?? d.rimIntensity,
      position: L.rim?.position ?? null },
    ambient: L.ambient ? { color: L.ambient.color, intensity: L.ambient.intensity ?? 0.4 } : null,
    exposure: L.exposure ?? p.exposure ?? d.exposure,
    bloom: { ...d.bloom, ...(L.bloom ?? p.bloom ?? {}) },
    vignette: { ...d.vignette, ...(p.vignette ?? {}) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested in tests/viewer3d-engine.test.mjs)
// ---------------------------------------------------------------------------------------------------------------

// Grid (x right, y down) -> world (x right, z toward the viewer, y up). The map is centred on the origin so the
// camera can orbit around (0, 0, 0). `h` is height above the ground plane in world units.
export function makeGridToWorld(width, height, tileSize = 1) {
  return function gridToWorld(x, y, h = 0, target = new THREE.Vector3()) {
    return target.set((x + 0.5 - width / 2) * tileSize, h, (y + 0.5 - height / 2) * tileSize);
  };
}

// Inverse of gridToWorld: world position -> fractional grid coordinates (useful for picking and the minimap).
export function makeWorldToGrid(width, height, tileSize = 1) {
  return function worldToGrid(v) {
    return { x: v.x / tileSize - 0.5 + width / 2, y: v.z / tileSize - 0.5 + height / 2 };
  };
}

// Playback clock. `time` is mutated and returned. Returns the same object so callers can chain.
export function advanceTime(time, dt) {
  if (!time.playing || !(dt > 0)) return time;
  const step = dt * (time.ticksPerSecond ?? 8) * (time.speed ?? 1);
  let t = time.t + step;
  if (t >= time.duration) {
    if (time.loop) t = time.duration > 0 ? t % time.duration : 0;
    else { t = time.duration; time.playing = false; time.ended = true; }
  }
  if (t < 0) t = 0;
  time.t = t;
  return time;
}

// Rolling fps meter: average over the last `window` seconds. tick(dt) returns { fps, ms }.
export function createFpsMeter(window = 0.5) {
  let acc = 0, frames = 0, fps = 0, ms = 0;
  return {
    tick(dt) {
      acc += dt; frames++;
      if (acc >= window) { fps = frames / acc; ms = (acc / frames) * 1000; acc = 0; frames = 0; }
      return { fps, ms };
    },
    get fps() { return fps; },
    get ms() { return ms; },
  };
}

// Pixel size for a canvas that fills `cssWidth` x `cssHeight` CSS pixels with the device pixel ratio capped.
export function fitSize(cssWidth, cssHeight, devicePixelRatio = 1, dprCap = 2) {
  const dpr = Math.max(0.5, Math.min(devicePixelRatio || 1, dprCap));
  const width = Math.max(1, Math.round(cssWidth));
  const height = Math.max(1, Math.round(cssHeight));
  return { width, height, dpr, pixelWidth: Math.round(width * dpr), pixelHeight: Math.round(height * dpr) };
}

// Default three-quarter dusk camera pose for a map of the given size: from the south-west, tilted down.
export function defaultCameraPose(width, height, tileSize = 1) {
  const span = Math.max(width, height) * tileSize;
  return {
    position: { x: -span * 0.28, y: span * 0.78, z: span * 0.78 },
    target: { x: 0, y: 0, z: 0 },
    fov: 42,
    near: 0.5,
    far: span * 6,
  };
}

// Vignette: darkens the corners. Runs in linear HDR space before OutputPass applies tone mapping and sRGB.
export const VignetteShader = {
  name: 'DriftfallVignette',
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.42 },
    softness: { value: 0.55 },
    aspect: { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float softness;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
      float d = length(p) / length(vec2(aspect, 1.0));
      float v = smoothstep(1.0, 1.0 - softness, d);
      c.rgb *= mix(1.0 - strength, 1.0, v);
      gl_FragColor = c;
    }`,
};

// ---------------------------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------------------------

export function createEngine(canvas, opts = {}) {
  const width = opts.width ?? 32;
  const height = opts.height ?? 32;
  const tileSize = opts.tileSize ?? 1;
  const palette = opts.palette ?? { ...DEFAULT_PALETTE };
  const look = resolveLook(palette);
  const quality = pickQuality(opts.quality ?? 'high');
  const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
  const doc = hasDOM ? document : null;

  // Renderer -----------------------------------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = look.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality.shadows && opts.shadows !== false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(new THREE.Color(look.background), 1);

  // Scene, fog, camera. terrain.mjs (sky and fog owner) may replace background and fog; these are the defaults.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(look.background);
  scene.fog = new THREE.FogExp2(new THREE.Color(look.fog.color), look.fog.density);

  const pose = defaultCameraPose(width, height, tileSize);
  const camera = new THREE.PerspectiveCamera(pose.fov, 16 / 9, pose.near, pose.far);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);

  // Lights (Lighting Artist: tune here or through palette.mjs) ---------------------------------------------------
  const span = Math.max(width, height) * tileSize;
  const sun = new THREE.DirectionalLight(new THREE.Color(look.sun.color), look.sun.intensity);
  if (look.sun.position) sun.position.set(...look.sun.position.map((v) => v * tileSize)); // palette: tile units
  else sun.position.set(-span * 0.55, span * 0.45, span * 0.35); // low in the west, warm dusk
  sun.target.position.set(0, 0, 0);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -span * 0.62; sc.right = span * 0.62; sc.top = span * 0.62; sc.bottom = -span * 0.62;
  sc.near = 1; sc.far = span * 2.5;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = look.sun.shadowRadius;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(new THREE.Color(look.hemi.sky), new THREE.Color(look.hemi.ground), look.hemi.intensity);
  scene.add(hemi);

  const rim = new THREE.DirectionalLight(new THREE.Color(look.rim.color), look.rim.intensity);
  if (look.rim.position) rim.position.set(...look.rim.position.map((v) => v * tileSize));
  else rim.position.set(span * 0.5, span * 0.3, -span * 0.6); // from behind, cool, no shadow
  scene.add(rim);

  let ambient = null;
  if (look.ambient) { ambient = new THREE.AmbientLight(new THREE.Color(look.ambient.color), look.ambient.intensity); scene.add(ambient); }

  // Post-processing ---------------------------------------------------------------------------------------------
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const b = { ...look.bloom, ...(typeof opts.bloom === 'object' ? opts.bloom : {}) };
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1280, 720), b.strength, b.radius, b.threshold);
  bloomPass.enabled = quality.bloom && opts.bloom !== false;
  composer.addPass(bloomPass);
  const vg = { ...look.vignette, ...(typeof opts.vignette === 'object' ? opts.vignette : {}) };
  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.uniforms.strength.value = vg.strength;
  vignettePass.uniforms.softness.value = vg.softness;
  vignettePass.enabled = opts.vignette !== false;
  composer.addPass(vignettePass);
  composer.addPass(new OutputPass());

  // Shared context ----------------------------------------------------------------------------------------------
  const clock = new THREE.Clock(false);
  const gridToWorld = makeGridToWorld(width, height, tileSize);
  const worldToGrid = makeWorldToGrid(width, height, tileSize);
  const time = { t: 0, speed: opts.speed ?? 1, playing: opts.autoplay !== false, duration: 0, loop: !!opts.loop,
    ticksPerSecond: opts.ticksPerSecond ?? 8, ended: false };
  const size = { width: 1, height: 1, dpr: 1 };
  const perf = { fps: 0, ms: 0, calls: 0, triangles: 0, systems: 0, failed: 0 };
  const ctx = {
    THREE, scene, camera, renderer, composer, clock, palette, look, assets: opts.assets ?? {},
    gridToWorld, worldToGrid, tileSize, grid: { width, height }, time, size, perf, quality,
    stats: opts.stats ?? null,          // the game's stats table (log.stats); vfx and units read it
    heightAt: () => 0,                  // terrain.mjs replaces this with the real surface height per tile
    lights: { sun, hemi, rim, ambient }, passes: { render: renderPass, bloom: bloomPass, vignette: vignettePass },
    canvas, world: null, engine: null,
  };

  // Systems -----------------------------------------------------------------------------------------------------
  const systems = [];
  const failed = new Set();
  function add(system) {
    if (!system || typeof system.update !== 'function') throw new Error('engine.add: a system needs update(frame, dt)');
    systems.push(system);
    perf.systems = systems.length;
    return system;
  }
  function remove(system) {
    const i = systems.indexOf(system);
    if (i >= 0) systems.splice(i, 1);
    failed.delete(system);
    perf.systems = systems.length;
  }

  // World (frame source). setWorld(null) clears it. ---------------------------------------------------------------
  function setWorld(world) {
    ctx.world = world ?? null;
    time.duration = world ? (world.ticks ?? 0) : 0;
    time.t = 0;
    time.ended = false;
  }
  if (opts.world) setWorld(opts.world);

  // Resize --------------------------------------------------------------------------------------------------------
  function resize() {
    const cssW = canvas.clientWidth || opts.cssWidth || 1280;
    const cssH = canvas.clientHeight || opts.cssHeight || 720;
    const dprIn = hasDOM ? window.devicePixelRatio : 1;
    const fit = fitSize(cssW, cssH, dprIn, opts.dprCap ?? quality.dprCap);
    size.width = fit.width; size.height = fit.height; size.dpr = fit.dpr;
    renderer.setPixelRatio(fit.dpr);
    renderer.setSize(fit.width, fit.height, false);
    composer.setPixelRatio(fit.dpr);
    composer.setSize(fit.width, fit.height);
    bloomPass.resolution.set(Math.round(fit.width * quality.bloomScale), Math.round(fit.height * quality.bloomScale));
    vignettePass.uniforms.aspect.value = fit.width / fit.height;
    camera.aspect = fit.width / fit.height;
    camera.updateProjectionMatrix();
  }
  let ro = null;
  if (hasDOM) {
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      ro = new ResizeObserver(() => resize());
      ro.observe(canvas.parentElement);
    }
    window.addEventListener('resize', resize);
  }
  resize();

  // Debug overlay (press ` to toggle) ----------------------------------------------------------------------------
  const fpsMeter = createFpsMeter();
  let overlay = null, overlayOn = !!opts.debug, overlayAcc = 0;
  if (doc) {
    overlay = doc.createElement('pre');
    overlay.className = 'engine-debug';
    overlay.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;font:12px/1.35 ui-monospace,Menlo,monospace;' +
      'color:#dff;background:rgba(10,8,20,.6);border:1px solid rgba(120,200,255,.25);border-radius:6px;z-index:50;' +
      'pointer-events:none;white-space:pre;';
    overlay.hidden = !overlayOn;
    (canvas.parentElement ?? doc.body).appendChild(overlay);
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' && !e.metaKey && !e.ctrlKey) { overlayOn = !overlayOn; overlay.hidden = !overlayOn; }
    });
  }
  function debugText() {
    const f = ctx.lastFrame;
    return [
      `fps ${perf.fps.toFixed(0)}  ${perf.ms.toFixed(1)} ms  ${size.width}x${size.height}@${size.dpr.toFixed(2)}`,
      `draw ${perf.calls}  tris ${perf.triangles}  quality ${quality.name}` +
        `  shadows ${renderer.shadowMap.enabled ? 'on' : 'off'}  bloom ${bloomPass.enabled ? 'on' : 'off'}`,
      `tick ${time.t.toFixed(1)}/${time.duration}  x${time.speed}  ${time.playing ? 'playing' : 'paused'}` +
        (f ? `  events ${f.events?.length ?? 0}` : '  (no world)'),
      `systems ${systems.length}${failed.size ? `  FAILED ${failed.size}` : ''}  objects ${sceneObjectCount()}`,
    ].join('\n');
  }
  function sceneObjectCount() { let n = 0; scene.traverse(() => n++); return n; }

  // Render loop ---------------------------------------------------------------------------------------------------
  let running = false, raf = 0, lastFrame = null;
  function step(dt) {
    advanceTime(time, dt);
    let frame = null;
    if (ctx.world) {
      try { frame = ctx.world.frame(time.t); }
      catch (err) { if (!ctx.worldFailed) { ctx.worldFailed = true; console.error('[engine] world.frame threw', err); } }
    }
    ctx.lastFrame = lastFrame = frame;
    if (typeof palette.update === 'function') palette.update(frame, dt); // shared emissives breathe in step
    for (const s of systems) {
      if (failed.has(s)) continue;
      try { s.update(frame, dt); }
      catch (err) {
        failed.add(s); perf.failed = failed.size;
        console.error('[engine] system switched off after an error:', s.name ?? s, err);
      }
    }
    renderer.info.reset();
    composer.render(dt);
    perf.calls = renderer.info.render.calls;
    perf.triangles = renderer.info.render.triangles;
    const m = fpsMeter.tick(dt);
    perf.fps = m.fps; perf.ms = m.ms;
    if (overlay && overlayOn) { overlayAcc += dt; if (overlayAcc > 0.2) { overlayAcc = 0; overlay.textContent = debugText(); } }
  }
  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1); // a long tab-switch pause never becomes one giant step
    step(dt);
  }
  function start() {
    if (running) return;
    running = true;
    clock.start();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clock.stop();
  }
  function dispose() {
    stop();
    for (const s of systems) { try { s.dispose?.(); } catch (err) { console.error('[engine] dispose', err); } }
    systems.length = 0;
    ro?.disconnect();
    if (hasDOM) window.removeEventListener('resize', resize);
    overlay?.remove();
    composer.dispose?.();
    renderer.dispose();
  }

  const engine = { ctx, add, remove, start, stop, resize, dispose, setWorld, step, get running() { return running; } };
  ctx.engine = engine;
  return engine;
}

// ---------------------------------------------------------------------------------------------------------------
// Placeholder system: draws the plateau and simple pieces for anything the real modules have not covered yet,
// so the page is never empty while terrain, units, buildings and vfx land. index.html adds it only for the
// modules that are missing (opts.parts = { terrain, units, structures }).
// ---------------------------------------------------------------------------------------------------------------

export function createPlaceholder(ctx, opts = {}) {
  const parts = { terrain: true, units: true, structures: true, ...(opts.parts ?? {}) };
  const { scene, gridToWorld, tileSize, grid } = ctx;
  const palette = ctx.look ?? resolveLook(ctx.palette);
  const group = new THREE.Group();
  group.name = 'placeholder';
  scene.add(group);
  const geoms = [], mats = [];
  const track = (g, m) => { if (g) geoms.push(g); if (m) mats.push(m); };

  if (parts.terrain) {
    const g = new THREE.PlaneGeometry(grid.width * tileSize, grid.height * tileSize);
    const m = new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 0.95, metalness: 0.05 });
    const ground = new THREE.Mesh(g, m);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);
    track(g, m);
    const gridHelper = new THREE.GridHelper(grid.width * tileSize, grid.width, 0x3a3550, 0x2f2b42);
    gridHelper.position.y = 0.01;
    group.add(gridHelper);
  }

  const rockGeom = new THREE.DodecahedronGeometry(tileSize * 0.42, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: palette.rock, roughness: 0.9, flatShading: true });
  const crystalGeom = new THREE.OctahedronGeometry(tileSize * 0.38, 0);
  const crystalMat = new THREE.MeshStandardMaterial({ color: palette.crystal, emissive: palette.crystalEmissive,
    emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.1, flatShading: true });
  track(rockGeom, rockMat); track(crystalGeom, crystalMat);
  const unitGeom = { worker: new THREE.SphereGeometry(tileSize * 0.22, 10, 8), default: new THREE.BoxGeometry(tileSize * 0.5, tileSize * 0.5, tileSize * 0.5) };
  const structGeom = { core: new THREE.CylinderGeometry(tileSize * 0.45, tileSize * 0.5, tileSize * 0.9, 8),
    default: new THREE.BoxGeometry(tileSize * 0.8, tileSize * 0.7, tileSize * 0.8) };
  for (const g of Object.values(unitGeom)) track(g); for (const g of Object.values(structGeom)) track(g);
  const teamMats = palette.teams.map((c, i) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(c), emissive: new THREE.Color(palette.strips[i]),
      emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.3 });
    track(null, m); return m;
  });

  const staticDone = { rocks: false, crystals: new Map() };
  const meshes = new Map(); // entity id -> mesh
  const seen = new Set();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  function ensureStatic(state) {
    if (!parts.terrain || !state) return;
    if (!staticDone.rocks) {
      staticDone.rocks = true;
      for (const [x, y] of state.rocks ?? []) {
        const m = new THREE.Mesh(rockGeom, rockMat);
        gridToWorld(x, y, tileSize * 0.3, m.position);
        m.rotation.set((x * 7) % 3, (y * 5) % 3, 0);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
      }
    }
    for (const c of state.crystals ?? []) {
      const key = `${c.x},${c.y}`;
      let m = staticDone.crystals.get(key);
      if (!m) {
        m = new THREE.Mesh(crystalGeom, crystalMat);
        gridToWorld(c.x, c.y, tileSize * 0.35, m.position);
        m.castShadow = true;
        group.add(m);
        staticDone.crystals.set(key, m);
      }
      const full = Math.max(0.12, Math.min(1, (c.amount ?? 0) / 400));
      m.scale.setScalar(0.4 + 0.6 * full);
      m.visible = true;
    }
  }

  function placeEntity(e, prevE, alpha, isUnit) {
    let m = meshes.get(e.id);
    if (!m) {
      const geom = isUnit ? (unitGeom[e.kind] ?? unitGeom.default) : (structGeom[e.kind] ?? structGeom.default);
      m = new THREE.Mesh(geom, teamMats[e.owner] ?? teamMats[0]);
      m.castShadow = m.receiveShadow = true;
      m.userData.id = e.id;
      group.add(m);
      meshes.set(e.id, m);
    }
    const h = isUnit ? tileSize * 0.28 : (e.kind === 'core' ? tileSize * 0.45 : tileSize * 0.35);
    gridToWorld(e.x, e.y, h, tmpB);
    if (prevE && (prevE.x !== e.x || prevE.y !== e.y)) {
      gridToWorld(prevE.x, prevE.y, h, tmpA);
      m.position.lerpVectors(tmpA, tmpB, alpha);
    } else m.position.copy(tmpB);
    if (!isUnit && !e.complete) m.scale.set(1, Math.max(0.1, (e.progress ?? 0) / 40), 1);
    else m.scale.setScalar(1);
    seen.add(e.id);
  }

  function update(frame) {
    if (!frame) return;
    const next = frame.next ?? frame.prev;
    const prev = frame.prev ?? next;
    const alpha = frame.alpha ?? 0;
    ensureStatic(next);
    seen.clear();
    const prevById = new Map();
    if (prev && prev !== next) { for (const u of prev.units ?? []) prevById.set(u.id, u); }
    if (parts.units) for (const u of next?.units ?? []) placeEntity(u, prevById.get(u.id), alpha, true);
    if (parts.structures) for (const s of next?.structures ?? []) placeEntity(s, null, alpha, false);
    for (const [id, m] of meshes) if (!seen.has(id)) { group.remove(m); meshes.delete(id); }
  }

  function dispose() {
    scene.remove(group);
    for (const g of geoms) g.dispose();
    for (const m of mats) m.dispose();
    meshes.clear();
  }

  return { name: 'placeholder', update, dispose };
}
