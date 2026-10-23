// Driftfall Classic renderer (owner: fable, Classic renderer). See CLASSIC.md principle 4: a fixed tilted camera
// over the grid, instanced units so 200 hold 60 fps, big silhouettes, team colours, selection circles, health bars,
// short crisp effects, fog of war. Reuses viewer3d's engine, terrain, buildings and vfx as they are; units come from
// play/units-instanced.mjs.
//
//   createPlayRenderer(canvas, opts) -> renderer
//   opts: { width, height (map tiles), stats, palette, side (the human's side, 0|1), tilt (deg, 55), viewTiles (16),
//           quality ('high'|'medium'|'low'), shadows, terrain, buildings, vfx (each true unless false), debug }
//   renderer = {
//     engine, ctx, units,                     the viewer3d engine, its ctx, the instanced units system
//     setWorld(world)                         world.frame(t) as viewer3d/world.mjs; a live world may give now()
//                                             (fractional tick from the 24 tps driver) and the clock follows it
//     setSelection(ids), setFog(Uint8Array W*H: 0 unexplored, 1 explored, 2 visible), clearFog(),
//     camera: { center(x, y), pan(dxTiles, dyTiles), zoom(factor), setZoom(viewTiles), position() -> {x, y},
//               centreOnBase() (also done automatically on the first frame unless opts.startCentred === false),
//               screenToGrid(px, py) -> {x, y} (fractional tiles), gridToScreen(x, y) -> {x, y} (CSS px),
//               viewBounds() -> {x0, y0, x1, y1} (tiles) },
//     pickUnit(px, py) -> id | null, unitsInRect(x0, y0, x1, y1) -> [id], live() -> drawn units,
//     start(), stop(), dispose(), perf, failures }
//   Pixel coordinates are CSS pixels relative to the canvas.
//
// Pure helpers (cameraPose, clampCenter, fogAlpha) are exported for tests/play-render.test.mjs.

import * as THREE from 'three';
import { createEngine } from '../viewer3d/engine.mjs';
import { createInstancedUnits } from './units-instanced.mjs';
import { installToy } from './toy-render.mjs';

export const DEFAULTS = { tilt: 55, viewTiles: 16, minViewTiles: 8, maxViewTiles: 40, margin: 1.5 };

// Camera position for a fixed tilt over the ground point (cx, cz): straight from the south, `tilt` degrees down.
export function cameraPose(cx, cz, tiltDeg = DEFAULTS.tilt, dist = 60) {
  const t = (tiltDeg * Math.PI) / 180;
  return { x: cx, y: dist * Math.sin(t), z: cz + dist * Math.cos(t) };
}

// Keep the view centre on the map: the visible ground rectangle (viewTiles tall on screen, stretched by 1/sin(tilt)
// on the ground) may leave at most `margin` tiles of void past the edge.
export function clampCenter(cx, cy, { width, height, viewTiles, aspect, tiltDeg = DEFAULTS.tilt, margin = DEFAULTS.margin }) {
  const halfH = (viewTiles / 2) / Math.sin((tiltDeg * Math.PI) / 180);
  const halfW = (viewTiles * aspect) / 2;
  const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  return { x: clamp(cx, halfW - margin, width - halfW + margin), y: clamp(cy, halfH - margin, height - halfH + margin) };
}

// Fog overlay alpha for a sampled fog value in 0..1 (0 unexplored, 0.5 explored, 1 visible).
export function fogAlpha(v) {
  if (v < 0.5) return 1 - (v / 0.5) * 0.45;        // black to 55 % dark
  return 0.55 * (1 - (v - 0.5) / 0.5);              // 55 % dark to clear
}

const FOG_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FOG_FRAG = /* glsl */`
  uniform sampler2D uFog; uniform vec3 uColor; uniform vec2 uTexel;
  varying vec2 vUv;
  float at(vec2 d) { return texture2D(uFog, vUv + d * uTexel).r; }
  void main() {
    float v = (at(vec2(0.0)) * 2.0 + at(vec2(1.0, 0.0)) + at(vec2(-1.0, 0.0)) + at(vec2(0.0, 1.0)) + at(vec2(0.0, -1.0))) / 6.0;
    float a = v < 0.5 ? 1.0 - (v / 0.5) * 0.45 : 0.55 * (1.0 - (v - 0.5) / 0.5);
    gl_FragColor = vec4(uColor, a);
  }`;

// Fog of war: a ground-sized quad drawn over everything (no depth test) from a W x H texture. Soft edges come from
// bilinear sampling plus a small cross blur. setFog(grid) with 0/1/2 per tile.
export function createFogOfWar(ctx, { width, height }) {
  const data = new Uint8Array(width * height).fill(255);     // starts fully visible until setFog is called
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    vertexShader: FOG_VERT, fragmentShader: FOG_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uFog: { value: tex }, uColor: { value: new THREE.Color('#05070c') }, uTexel: { value: new THREE.Vector2(1 / width, 1 / height) } },
  });
  const geo = new THREE.PlaneGeometry(width * ctx.tileSize, height * ctx.tileSize);
  // the plane's uv (0,0) is its bottom-left; after lying flat (rotate -90° about X) that is the far-left corner
  // (grid y = 0 is the far edge, toward -z), so uv.y runs with grid y: texture row 0 = grid row 0.
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fog-of-war';
  mesh.position.y = 0.03;
  mesh.renderOrder = 900;
  mesh.frustumCulled = false;
  mesh.visible = false;
  ctx.scene.add(mesh);
  let grid = null;
  return {
    name: 'fog', mesh, data,
    get grid() { return grid; },
    setFog(g) {
      if (!g) { grid = null; mesh.visible = false; return; }
      grid = g;
      for (let i = 0; i < data.length; i++) data[i] = g[i] >= 2 ? 255 : g[i] === 1 ? 128 : 0;
      tex.needsUpdate = true;
      mesh.visible = true;
    },
    visibleAt(x, y) { return !grid || grid[Math.round(y) * width + Math.round(x)] >= 2; },
    update() {},
    dispose() { ctx.scene.remove(mesh); geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}

export function createPlayRenderer(canvas, opts = {}) {
  const width = opts.width ?? 32, height = opts.height ?? 32;
  const side = opts.side ?? 0;
  const tilt = opts.tilt ?? DEFAULTS.tilt;
  let viewTiles = opts.viewTiles ?? DEFAULTS.viewTiles;
  const engine = createEngine(canvas, {
    width, height, tileSize: 1, ortho: true, orthoHeight: viewTiles, ticksPerSecond: 24, loop: false, autoplay: true,
    palette: opts.palette, stats: opts.stats ?? null, quality: opts.quality ?? 'high', shadows: opts.shadows,
    debug: !!opts.debug, cssWidth: opts.cssWidth, cssHeight: opts.cssHeight,
  });
  const { ctx } = engine;
  ctx.side = side;
  // Premium toy look (play/toy-render.mjs, RENDERING.md); opts.toy === false or ?toy=0 keeps the old look.
  if (opts.toy !== false) ctx.toy = installToy(ctx, engine, { query: opts.query });
  const cam = ctx.camera;
  const center = { x: width / 2, y: height / 2 };
  const target = new THREE.Vector3();
  const failures = [];

  // ----- camera: fixed tilt, pans only -----
  function aspect() { return (ctx.size.width || 16) / (ctx.size.height || 9); }
  function applyCamera() {
    const c = clampCenter(center.x, center.y, { width, height, viewTiles, aspect: aspect(), tiltDeg: tilt });
    center.x = c.x; center.y = c.y;
    ctx.gridToWorld(center.x - 0.5, center.y - 0.5, 0, target);
    const p = cameraPose(target.x, target.z, tilt, Math.max(60, Math.max(width, height) * 2));
    cam.position.set(p.x, p.y, p.z);
    cam.lookAt(target);
    cam.updateMatrixWorld();
  }
  const ndc = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPt = new THREE.Vector3();
  function screenToGrid(px, py) {
    const w = canvas.clientWidth || ctx.size.width, h = canvas.clientHeight || ctx.size.height;
    ndc.set((px / w) * 2 - 1, -(py / h) * 2 + 1, 0);
    ray.setFromCamera(ndc, cam);
    if (!ray.ray.intersectPlane(groundPlane, hitPt)) return null;
    let g = ctx.worldToGrid(hitPt);
    // one refinement for raised ground: re-intersect at the tile's own height
    const hh = ctx.heightAt(Math.round(g.x), Math.round(g.y));
    if (hh) {
      groundPlane.constant = -hh;
      if (ray.ray.intersectPlane(groundPlane, hitPt)) g = ctx.worldToGrid(hitPt);
      groundPlane.constant = 0;
    }
    return { x: g.x, y: g.y };
  }
  const proj = new THREE.Vector3();
  function worldToScreen(v) {
    proj.copy(v).project(cam);
    const w = canvas.clientWidth || ctx.size.width, h = canvas.clientHeight || ctx.size.height;
    return { x: (proj.x + 1) / 2 * w, y: (1 - proj.y) / 2 * h };
  }
  function gridToScreen(x, y) {
    ctx.gridToWorld(x, y, ctx.heightAt(Math.round(x), Math.round(y)), proj);
    return worldToScreen(proj);
  }
  function viewBounds() {
    const w = canvas.clientWidth || ctx.size.width, h = canvas.clientHeight || ctx.size.height;
    const pts = [screenToGrid(0, 0), screenToGrid(w, 0), screenToGrid(0, h), screenToGrid(w, h)].filter(Boolean);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  const camera = {
    center(x, y) { center.x = x; center.y = y; applyCamera(); },
    pan(dx, dy) { center.x += dx; center.y += dy; applyCamera(); },
    zoom(factor) { camera.setZoom(viewTiles * factor); },
    setZoom(tiles) {
      viewTiles = Math.max(opts.minViewTiles ?? DEFAULTS.minViewTiles, Math.min(opts.maxViewTiles ?? DEFAULTS.maxViewTiles, tiles));
      ctx.orthoHeight = viewTiles;
      engine.resize();
      applyCamera();
    },
    position() { return { x: center.x, y: center.y }; },
    centreOnBase: () => centreOnBase((ctx.lastFrame?.next ?? ctx.lastFrame?.prev) ?? null),
    get viewTiles() { return viewTiles; },
    get tilt() { return tilt; },
    screenToGrid, gridToScreen, viewBounds,
  };

  // ----- systems in draw order: terrain, buildings, units, vfx, fog -----
  const made = {};
  function tryMake(name, make) {
    if (opts[name] === false) return null;
    try {
      const sys = make();
      if (sys?.update) { sys.name ??= name; made[name] = sys; engine.add(sys); }
      return sys;
    } catch (err) {
      failures.push({ name, message: String(err?.message ?? err) });
      console.error(`[play/render] ${name} failed to start`, err);
      return null;
    }
  }
  const units = createInstancedUnits(ctx, { stats: opts.stats, side, scale: opts.unitScale });
  ctx.units = units;
  let fog = null;
  const ready = (async () => {
    const terrainMod = opts.terrain === false ? null : await import('../viewer3d/terrain.mjs').catch((e) => { failures.push({ name: 'terrain', message: String(e) }); return null; });
    const buildingsMod = opts.buildings === false ? null : await import('../viewer3d/buildings.mjs').catch((e) => { failures.push({ name: 'buildings', message: String(e) }); return null; });
    const vfxMod = opts.vfx === false ? null : await import('../viewer3d/vfx.mjs').catch((e) => { failures.push({ name: 'vfx', message: String(e) }); return null; });
    if (terrainMod?.createTerrain) {
      const t = tryMake('terrain', () => terrainMod.createTerrain(ctx));
      if (typeof t?.heightAt === 'function') ctx.heightAt = t.heightAt;
    }
    if (buildingsMod?.createBuildings) tryMake('buildings', () => buildingsMod.createBuildings(ctx));
    engine.add(units);
    if (vfxMod?.createVfx) tryMake('vfx', () => vfxMod.createVfx(ctx, { stats: opts.stats, quality: opts.quality === 'low' ? 0.5 : 1 }));
    fog = tryMake('fog', () => createFogOfWar(ctx, { width, height }));
    applyCamera();
    return renderer;
  })();

  // ----- fog + visibility -----
  let fogGrid = null;
  // Accepts levels (0 unexplored, 1 explored, 2 visible) or play/fog.mjs's fogMask alphas (255, 140, 0).
  function setFog(grid) {
    if (grid && grid.length === width * height) {
      let alphaMask = false;
      for (let i = 0; i < grid.length; i++) if (grid[i] > 2) { alphaMask = true; break; }
      if (alphaMask) { const g = new Uint8Array(grid.length); for (let i = 0; i < g.length; i++) g[i] = grid[i] === 0 ? 2 : grid[i] >= 200 ? 0 : 1; grid = g; }
    }
    fogGrid = grid ?? null;
    fog?.setFog(fogGrid);
    units.setVisibility(fogGrid ? (u) => u.owner === side || fogGrid[Math.round(u.y) * width + Math.round(u.x)] >= 2 : null);
  }

  // ----- world / clock -----
  function setWorld(world) {
    if (!world) { engine.setWorld(null); return; }
    const live = typeof world.now === 'function' || !Number.isFinite(world.ticks);
    const wrapped = live
      ? { ticks: Infinity, frame: (t) => world.frame(typeof world.now === 'function' ? world.now() : t), source: world }
      : world;
    engine.setWorld(wrapped);
    if (live) { ctx.time.duration = Infinity; ctx.time.playing = true; }
  }

  // ----- picking -----
  function pxPerTile() { return (canvas.clientHeight || ctx.size.height) / viewTiles; }
  function pickUnit(px, py) {
    let best = null, bestD = Infinity;
    const k = pxPerTile();
    for (const u of units.live()) {
      proj.copy(u.pos); proj.y += u.height * 0.5;
      const s = worldToScreen(proj);
      const r = Math.max(14, u.radius * k * 1.2);
      const d = Math.hypot(s.x - px, s.y - py);
      if (d <= r && d < bestD) { bestD = d; best = u.id; }
    }
    return best;
  }
  function unitsInRect(x0, y0, x1, y1) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    const out = [];
    for (const u of units.live()) {
      proj.copy(u.pos); proj.y += u.height * 0.4;
      const s = worldToScreen(proj);
      if (s.x >= lx && s.x <= hx && s.y >= ly && s.y <= hy) out.push(u.id);
    }
    return out;
  }

  // The engine's own resize (window and ResizeObserver) changes the aspect, so re-clamp the view when the size moved.
  let lastW = 0, lastH = 0, centred = opts.startCentred === false;
  // The first frame opens on the human's own Core (a playtest found the map-centre start showed mostly dark void).
  function centreOnBase(state) {
    const core = state?.structures?.find((s) => s.kind === 'core' && s.owner === side) ?? state?.structures?.find((s) => s.kind === 'core');
    if (!core) return false;
    camera.center(core.x + 0.5, core.y + 0.5);
    return true;
  }
  engine.add({ name: 'play-camera', update(frame) {
    if (ctx.size.width !== lastW || ctx.size.height !== lastH) { lastW = ctx.size.width; lastH = ctx.size.height; applyCamera(); }
    if (!centred && frame) centred = centreOnBase(frame.next ?? frame.prev);
  } });
  applyCamera();

  const renderer = {
    engine, ctx, units, camera, ready, failures, made,
    setWorld, setSelection: (ids) => units.setSelection(ids), setFog, clearFog: () => setFog(null),
    pickUnit, unitsInRect, live: () => units.live(),
    get fog() { return fogGrid; },
    get perf() { return ctx.perf; },
    start: () => engine.start(), stop: () => engine.stop(),
    dispose() { engine.dispose(); },
  };
  return renderer;
}

export default createPlayRenderer;
