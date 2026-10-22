// Driftfall 3D assets: loads the CC0 models and sounds the scouts listed in assets/models/MANIFEST.json and
// assets/audio/MANIFEST.json, re-paints models to the Driftfall palette per team, scales them to the tile, and
// hands out an original procedural placeholder for anything missing, broken or not yet modelled. Nothing in the
// scene should ever be blank because a file is absent.
//
// Usage (engine does the first line; everyone else reads ctx.assets):
//   ctx.assets = await loadAssets(ctx)                       // never throws; see assets.report for what happened
//   const obj = ctx.assets.get('grunt', { owner: 1 })        // loaded model re-painted Ember, or a placeholder
//   ctx.assets.models.get('core', { owner: 0 })              // null when no model (no placeholder)
//   ctx.assets.placeholder('turret', { owner: 0 })           // always the procedural one
//   ctx.assets.sounds.url('ranged_shot')                     // string url or null
//   await ctx.assets.sounds.load('melee_hit', audioContext)  // AudioBuffer or null (cached)
//
// Every returned Object3D is a fresh clone with its base at y = 0, centred on x/z, footprint = lookFor(kind).size
// tiles (times ctx.tileSize), facing +x (grid east) at yaw 0. userData: { kind, owner, source: 'model'|'placeholder' }.
// Meshes carry stable names so owners can find them: 'body', 'strip', 'trim', 'glass', 'barrel', 'crystal'.
//
// Pure helpers (node-testable, no three.js needed): normalizeModelManifest, normalizeAudioManifest, resolveModel,
// resolveSound, modelUrl, soundUrl, MATERIAL_ROLES, roleForMaterial.

import { TEAM, NEUTRAL, WORLD, EMISSIVE, lookFor, kindKey, makeMaterials, hexToInt } from './palette.mjs';

export const ASSETS_VERSION = 1;

// Repo root (viewer3d/../). Works both served over http and in node (file:).
export const ASSET_ROOT = new URL('../', import.meta.url).href;
export const MODEL_MANIFEST_URL = new URL('assets/models/MANIFEST.json', ASSET_ROOT).href;
export const AUDIO_MANIFEST_URL = new URL('assets/audio/MANIFEST.json', ASSET_ROOT).href;

// ---------- manifests ----------

const SECTION_CATEGORY = { units: 'unit', unit: 'unit', buildings: 'structure', structures: 'structure', structure: 'structure', terrain: 'terrain', tiles: 'terrain', props: 'prop', prop: 'prop', models: null };
const META_KEYS = new Set(['version', 'note', 'unit', 'root', 'license', 'format']);

function entryFrom(key, raw, category) {
  if (raw == null) return null;
  const e = typeof raw === 'string' ? { file: raw } : { ...raw };
  if (!e.file || typeof e.file !== 'string') return null;
  const k = kindKey(key);
  const cat = category ?? lookFor(k, 'unit').category ?? 'unit';
  return {
    key: k, category: cat, file: e.file, fit: e.fit ?? 'fit', note: e.note ?? '',
    size: Array.isArray(e.size) && e.size.length === 3 ? e.size.map(Number) : null,
    scale: Number.isFinite(e.scale) ? Number(e.scale) : null,       // explicit scale beats fit-to-tile
    yaw: Number.isFinite(e.yaw) ? Number(e.yaw) : 0,                // radians, model's forward relative to +x
    offset: Array.isArray(e.offset) && e.offset.length === 3 ? e.offset.map(Number) : [0, 0, 0],
    parts: e.parts ?? null,                                         // { materialName: role } overrides
    anims: e.anims ?? null,                                         // { idle, walk, attack, die } clip names
    attach: Array.isArray(e.attach) ? e.attach : [],                // extra props to glue on, e.g. ['rifle']
  };
}

// Accepts the scout's shape (top-level kind: path strings plus units/buildings/terrain/props sections with
// { file, fit, note, size }) and simpler shapes ({ models: { kind: file } } or a bare { kind: file } map).
export function normalizeModelManifest(json) {
  const out = { version: Number(json?.version) || 1, root: json?.root ?? 'assets/models', unit: json?.unit ?? '', note: json?.note ?? '', entries: {}, files: new Set() };
  if (!json || typeof json !== 'object') return out;
  const sectioned = new Set();
  for (const [section, category] of Object.entries(SECTION_CATEGORY)) {
    const block = json[section];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    sectioned.add(section);
    for (const [key, raw] of Object.entries(block)) {
      const e = entryFrom(key, raw, category);
      if (e) { out.entries[e.key] = e; out.files.add(e.file); }
    }
  }
  for (const [key, raw] of Object.entries(json)) {
    if (META_KEYS.has(key) || sectioned.has(key)) continue;
    if (typeof raw !== 'string' && !(raw && typeof raw === 'object' && typeof raw.file === 'string')) continue;
    const e = entryFrom(key, raw, null);
    if (e && !out.entries[e.key]) { out.entries[e.key] = e; out.files.add(e.file); }
  }
  return out;
}

export function normalizeAudioManifest(json) {
  const out = { version: Number(json?.version) || 1, root: json?.root ?? 'assets/audio', note: json?.note ?? '', events: {}, files: new Set() };
  const block = json?.events && typeof json.events === 'object' ? json.events : (json && typeof json === 'object' ? json : {});
  for (const [name, raw] of Object.entries(block)) {
    if (META_KEYS.has(name) || name === 'events') continue;
    const e = typeof raw === 'string' ? { file: raw } : raw;
    if (!e || typeof e.file !== 'string') continue;
    out.events[name] = { name, file: e.file, kind: e.kind ?? 'sfx', loop: !!e.loop, gain: Number.isFinite(e.gain) ? Number(e.gain) : 1 };
    out.files.add(e.file);
  }
  return out;
}

// Aliases so sim names, manifest names and palette names all meet: 'rich_shard' = 'rich-shard' = 'richShard'.
const MODEL_ALIASES = { open: 'floor', 'shard-field': 'crystal', flakspire: 'flak-spire', 'flak-spire': 'flakspire', richshard: 'rich-shard', 'rich-shard': 'rich_shard' };

export function resolveModel(manifest, kind) {
  if (!manifest?.entries) return null;
  const k = kindKey(kind);
  const tries = [k, k.replace(/-/g, '_'), k.replace(/-/g, ''), MODEL_ALIASES[k], kindKey(MODEL_ALIASES[k] ?? '')].filter(Boolean);
  for (const t of tries) { const e = manifest.entries[t] ?? manifest.entries[kindKey(t)]; if (e) return e; }
  return null;
}

export function resolveSound(manifest, event) {
  return manifest?.events?.[event] ?? null;
}

const stripSlashes = (s) => String(s).replace(/^\/+|\/+$/g, '');

export function modelUrl(manifest, entry, base = ASSET_ROOT) {
  if (!entry?.file) return null;
  return new URL(`${stripSlashes(manifest?.root ?? 'assets/models')}/${entry.file}`, base).href;
}

export function soundUrl(manifest, entry, base = ASSET_ROOT) {
  if (!entry?.file) return null;
  return new URL(`${stripSlashes(manifest?.root ?? 'assets/audio')}/${entry.file}`, base).href;
}

// ---------- re-painting loaded models ----------
// The CC0 kits use a handful of named flat materials. Each name maps to a Driftfall role; the role picks one of the
// shared palette materials, so a loaded rover and a procedural Grunt wear exactly the same paint.
export const MATERIAL_ROLES = Object.freeze({
  metalred: 'team', red: 'team', accent: 'team', team: 'team', paint: 'team',
  metal: 'hull', metallight: 'hullLight', white: 'hullLight', grey: 'hull', gray: 'hull',
  metaldark: 'hullDark', darkmetal: 'hullDark',
  dark: 'dark', black: 'dark',
  crystal: 'shard', crystals: 'shard', gem: 'shard',
  rock: 'rock', rocktrack: 'rockDark', rockdark: 'rockDark', stone: 'rock', dirt: 'rockDark', ground: 'ground',
  glass: 'glass', window: 'glass', light: 'strip', glow: 'strip', emissive: 'strip', strip: 'strip',
  skin: 'trim', colormap: 'keep', texture: 'keep',
});

export function roleForMaterial(name, overrides = null) {
  const n = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (overrides) {
    const o = overrides[name] ?? overrides[n];
    if (o) return o;
  }
  if (MATERIAL_ROLES[n]) return MATERIAL_ROLES[n];
  for (const [key, role] of Object.entries(MATERIAL_ROLES)) if (n.includes(key)) return role;
  return 'keep';
}

function paletteMaterialFor(role, owner, materials) {
  const team = materials.forOwner(owner);
  switch (role) {
    case 'team': return team.body;
    case 'teamDark': return team.bodyDark;
    case 'strip': return team.strip;
    case 'glass': return team.glass;
    case 'trim': return team.trim;
    case 'hull': return materials.hull;
    case 'hullLight': return materials.hullLight;
    case 'hullDark': return materials.hullDark;
    case 'dark': return materials.dark;
    case 'shard': return materials.shard;
    case 'rock': return materials.rock;
    case 'rockDark': return materials.rockDark;
    case 'ground': return materials.ground;
    default: return null;
  }
}

// ---------- the loader ----------

async function defaultFetchJson(url) {
  if (url.startsWith('file:')) {
    const fs = await import('node:fs/promises');
    return JSON.parse(await fs.readFile(new URL(url), 'utf8'));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

let gltfModulePromise = null;
function gltfModule() {
  if (!gltfModulePromise) {
    gltfModulePromise = Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/utils/SkeletonUtils.js'),
    ]).then(([g, s]) => ({ GLTFLoader: g.GLTFLoader, cloneSkinned: s.clone }));
  }
  return gltfModulePromise;
}

async function defaultLoadGLTF(url) {
  const { GLTFLoader } = await gltfModule();
  const loader = new GLTFLoader();
  if (url.startsWith('file:')) {
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(new URL(url));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const dir = url.slice(0, url.lastIndexOf('/') + 1);
    return new Promise((resolve, reject) => loader.parse(ab, dir, resolve, reject));
  }
  return loader.loadAsync(url);
}

function boxOf(THREE, object) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

// Scale so the footprint (max of x/z) equals `footprint` world units, put the base on y = 0 and centre x/z.
export function fitToFootprint(THREE, object, footprint, { scale = null, offset = [0, 0, 0], yaw = 0, maxHeight = null } = {}) {
  const wrapper = new THREE.Group();
  object.rotation.y = yaw;
  wrapper.add(object);
  const box0 = boxOf(THREE, wrapper);
  const size0 = box0.getSize(new THREE.Vector3());
  let s = scale;
  if (s == null) {
    const base = Math.max(size0.x, size0.z) || 1;
    s = footprint / base;
    if (maxHeight && size0.y * s > maxHeight) s = maxHeight / size0.y;
  }
  object.scale.setScalar(s);
  const box1 = boxOf(THREE, wrapper);
  const centre = box1.getCenter(new THREE.Vector3());
  object.position.set(-centre.x + offset[0], -box1.min.y + offset[1], -centre.z + offset[2]);
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

export async function loadAssets(ctx = {}, opts = {}) {
  const THREE = opts.THREE ?? ctx.THREE ?? null;
  const tileSize = ctx.tileSize ?? opts.tileSize ?? 1;
  const base = opts.base ?? ASSET_ROOT;
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const loadGLTF = opts.loadGLTF ?? defaultLoadGLTF;
  const log = opts.log ?? (() => {});
  const materials = THREE ? (ctx.palette?.materials ?? makeMaterials(THREE)) : null;

  const report = {
    models: { manifest: null, loaded: [], missing: [], failed: [] },
    sounds: { manifest: null, listed: [], failed: [] },
  };

  // --- manifests (a missing manifest is a report line, not an error) ---
  let modelManifest = normalizeModelManifest(null);
  let audioManifest = normalizeAudioManifest(null);
  try {
    const raw = typeof opts.modelManifest === 'object' && opts.modelManifest ? opts.modelManifest : await fetchJson(opts.modelManifest ?? MODEL_MANIFEST_URL);
    modelManifest = normalizeModelManifest(raw);
    report.models.manifest = 'ok';
  } catch (err) { report.models.manifest = `missing (${err?.message ?? err})`; log('models manifest', err); }
  try {
    const raw = typeof opts.audioManifest === 'object' && opts.audioManifest ? opts.audioManifest : await fetchJson(opts.audioManifest ?? AUDIO_MANIFEST_URL);
    audioManifest = normalizeAudioManifest(raw);
    report.sounds.manifest = 'ok';
    report.sounds.listed = Object.keys(audioManifest.events);
  } catch (err) { report.sounds.manifest = `missing (${err?.message ?? err})`; log('audio manifest', err); }

  // --- models: load each distinct file once, in parallel ---
  const sources = new Map(); // file -> { scene, animations, skinned }
  const wantModels = THREE && opts.models !== false;
  if (wantModels) {
    const files = [...modelManifest.files];
    const kindsByFile = (file) => Object.values(modelManifest.entries).filter((e) => e.file === file).map((e) => e.key);
    const results = await Promise.allSettled(files.map((file) => loadGLTF(new URL(`${stripSlashes(modelManifest.root)}/${file}`, base).href)));
    results.forEach((r, i) => {
      const file = files[i];
      if (r.status === 'fulfilled' && r.value?.scene) {
        let skinned = false;
        r.value.scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
        sources.set(file, { scene: r.value.scene, animations: r.value.animations ?? [], skinned });
        report.models.loaded.push(...kindsByFile(file));
      } else {
        report.models.failed.push({ file, kinds: kindsByFile(file), error: String(r.reason?.message ?? r.reason ?? 'no scene') });
      }
    });
  }
  const skeletonClone = wantModels && [...sources.values()].some((s) => s.skinned) ? (await gltfModule()).cloneSkinned : null;

  // --- re-paint + fit ---
  function repaint(root, owner, entry, { unique = false } = {}) {
    if (!materials) return root;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const painted = mats.map((m) => {
        const role = roleForMaterial(m?.name, entry?.parts);
        const pm = paletteMaterialFor(role, owner, materials);
        if (!pm) return m;                       // 'keep': textured or unknown material stays as is
        return unique ? pm.clone() : pm;
      });
      o.material = Array.isArray(o.material) ? painted : painted[0];
      o.castShadow = true; o.receiveShadow = true;
      const role = roleForMaterial(mats[0]?.name, entry?.parts);
      if (!o.name) o.name = role === 'team' ? 'body' : role === 'strip' ? 'strip' : role === 'shard' ? 'crystal' : role;
    });
    return root;
  }

  function cloneSource(src) {
    return src.skinned && skeletonClone ? skeletonClone(src.scene) : src.scene.clone(true);
  }

  const models = {
    kinds: () => Object.keys(modelManifest.entries),
    entry: (kind) => resolveModel(modelManifest, kind),
    has(kind) { const e = resolveModel(modelManifest, kind); return !!(e && sources.has(e.file)); },
    url(kind) { const e = resolveModel(modelManifest, kind); return e ? modelUrl(modelManifest, e, base) : null; },
    raw(kind) { const e = resolveModel(modelManifest, kind); return e && sources.get(e.file)?.scene || null; },
    animations(kind) { const e = resolveModel(modelManifest, kind); return (e && sources.get(e.file)?.animations) || []; },
    // A fitted, re-painted clone; null when there is no loaded model for the kind.
    get(kind, { owner = null, category = null, unique = false, footprint = null } = {}) {
      const e = resolveModel(modelManifest, kind);
      const src = e && sources.get(e.file);
      if (!src || !THREE) return null;
      const look = lookFor(kind, category ?? e.category);
      const obj = repaint(cloneSource(src), owner, e, { unique });
      const fp = footprint ?? look.size * tileSize;
      const fitted = fitToFootprint(THREE, obj, fp, { scale: e.scale, offset: e.offset, yaw: e.yaw, maxHeight: look.height * tileSize * 1.6 });
      fitted.name = `${kindKey(kind)}-model`;
      fitted.userData = { kind: kindKey(kind), owner, source: 'model', file: e.file, fit: e.fit, look };
      return fitted;
    },
  };

  // --- sounds ---
  const bufferCache = new Map();
  const sounds = {
    events: () => Object.keys(audioManifest.events),
    entry: (event) => resolveSound(audioManifest, event),
    has: (event) => !!resolveSound(audioManifest, event),
    url(event) { const e = resolveSound(audioManifest, event); return e ? soundUrl(audioManifest, e, base) : null; },
    // Decoded AudioBuffer (cached per event), or null when the event is unknown or the file fails to load/decode.
    async load(event, audioContext) {
      const e = resolveSound(audioManifest, event);
      if (!e || !audioContext) return null;
      if (bufferCache.has(event)) return bufferCache.get(event);
      const p = (async () => {
        try {
          const url = soundUrl(audioManifest, e, base);
          let ab;
          if (url.startsWith('file:')) { const fs = await import('node:fs/promises'); const b = await fs.readFile(new URL(url)); ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
          else { const res = await fetch(url); if (!res.ok) throw new Error(`${res.status} for ${url}`); ab = await res.arrayBuffer(); }
          return await new Promise((resolve, reject) => {
            const r = audioContext.decodeAudioData(ab, resolve, reject);
            if (r && typeof r.then === 'function') r.then(resolve, reject);
          });
        } catch (err) { report.sounds.failed.push({ event, error: String(err?.message ?? err) }); return null; }
      })();
      bufferCache.set(event, p);
      return p;
    },
  };

  const assets = {
    version: ASSETS_VERSION, ready: true, report, tileSize,
    manifest: { models: modelManifest, audio: audioManifest },
    models, sounds, materials,
    placeholder(kind, o = {}) { return THREE ? buildPlaceholder(THREE, materials, kind, { ...o, tileSize }) : null; },
    // The call most owners want: the model if we have one, else the procedural stand-in. Never null with THREE.
    get(kind, o = {}) { return models.get(kind, o) ?? assets.placeholder(kind, o); },
    repaint(object, owner, entry = null, o = {}) { return repaint(object, owner, entry, o); },
    fit(object, kind, o = {}) { return THREE ? fitToFootprint(THREE, object, (o.footprint ?? lookFor(kind, o.category).size * tileSize), o) : object; },
    dispose() {
      for (const s of sources.values()) s.scene.traverse((ch) => { if (ch.geometry) ch.geometry.dispose(); });
      sources.clear(); bufferCache.clear();
    },
  };
  return assets;
}

// ---------- procedural placeholders ----------
// Original low-poly stand-ins that follow ART-GUIDE silhouettes (round, wedge, needle, hex, octagon-ring, block
// with a stack, disc with barrels) so a match is readable even before the real models or the owners' own geometry
// land. Each is a Group with a 'body' and a team 'strip', footprint = lookFor(kind).size tiles, base at y = 0.
export function buildPlaceholder(THREE, materials, kind, { owner = null, category = null, tileSize = 1 } = {}) {
  materials = materials ?? makeMaterials(THREE);
  const look = lookFor(kind, category ?? 'unit');
  const team = materials.forOwner(owner);
  const g = new THREE.Group();
  const fp = look.size * tileSize;           // footprint in world units
  const h = look.height * tileSize;
  const add = (geo, mat, name, pos = [0, 0, 0], rot = null) => {
    const m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const ring = (r, t, y, mat = team.strip) => add(new THREE.TorusGeometry(r, t, 6, 24), mat, 'strip', [0, y, 0], [Math.PI / 2, 0, 0]);
  const r = fp / 2;

  if (look.category === 'terrain') {
    switch (look.shape) {
      case 'boulder':
        add(new THREE.DodecahedronGeometry(r * 0.95, 0), materials.rock, 'body', [0, h * 0.45, 0], [0.3, 0.5, 0.1]).scale.set(1, h / (r * 1.9) + 0.3, 0.9);
        add(new THREE.DodecahedronGeometry(r * 0.5, 0), materials.rockLight, 'detail', [r * 0.45, h * 0.25, -r * 0.3], [0.9, 0.2, 0.4]);
        break;
      case 'cluster': case 'cluster-big': {
        const n = look.shape === 'cluster-big' ? 5 : 3;
        add(new THREE.CylinderGeometry(r * 0.9, r, 0.04 * tileSize, 8), materials.shardFloor, 'floor', [0, 0.02 * tileSize, 0]);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + 0.4, d = r * 0.45;
          const hh = h * (0.6 + 0.4 * ((i * 7) % 3) / 2);
          add(new THREE.ConeGeometry(r * 0.28, hh, 5), materials.shard, 'crystal', [Math.cos(a) * d, hh / 2, Math.sin(a) * d], [0.25 * Math.sin(a), a, 0.2 * Math.cos(a)]);
        }
        break;
      }
      case 'crater':
        add(new THREE.TorusGeometry(r * 0.75, r * 0.2, 6, 16), materials.rockDark, 'body', [0, 0.05 * tileSize, 0], [Math.PI / 2, 0, 0]);
        add(new THREE.CircleGeometry(r * 0.6, 16), materials.flux, 'crystal', [0, 0.03 * tileSize, 0], [-Math.PI / 2, 0, 0]);
        break;
      case 'scrap':
        for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(r * 0.6, h * 0.5, r * 0.4), materials.rubble, 'body', [(i % 2 - 0.5) * r * 0.8, h * 0.25, (Math.floor(i / 2) - 0.5) * r * 0.8], [0.1 * i, 0.6 * i, 0]);
        break;
      case 'cliff':
        add(new THREE.BoxGeometry(fp, h, fp), materials.cliff, 'body', [0, h / 2, 0]);
        break;
      case 'ramp':
        add(new THREE.BoxGeometry(fp, h * 0.5, fp), materials.ramp, 'body', [0, h * 0.25, 0], [0, 0, 0.35]);
        break;
      default:
        add(new THREE.BoxGeometry(fp, 0.05 * tileSize, fp), materials.ground, 'body', [0, 0.025 * tileSize, 0]);
    }
  } else if (look.category === 'structure') {
    switch (look.shape) {
      case 'octagon-ring':
        add(new THREE.CylinderGeometry(r * 0.8, r * 0.9, h * 0.35, 8), team.trim, 'body', [0, h * 0.175, 0]);
        add(new THREE.CylinderGeometry(r * 0.3, r * 0.45, h * 0.5, 8), team.body, 'tower', [0, h * 0.6, 0]);
        add(new THREE.CylinderGeometry(r * 0.25, r * 0.25, h * 0.08, 8), materials.dark, 'well', [0, h * 0.86, 0]);
        ring(r * 0.95, 0.03 * tileSize, h * 0.37);
        for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; add(new THREE.OctahedronGeometry(r * 0.12), materials.shard, 'crystal', [Math.cos(a) * r * 0.6, h * 0.95, Math.sin(a) * r * 0.6]); }
        break;
      case 'block-stack': case 'block-heavy': {
        add(new THREE.BoxGeometry(fp * 0.85, h * 0.6, fp * 0.85), team.body, 'body', [0, h * 0.3, 0]);
        add(new THREE.BoxGeometry(fp * 0.3, h * 0.35, fp * 0.2), materials.heat, 'mouth', [fp * 0.3, h * 0.25, 0]);
        add(new THREE.CylinderGeometry(fp * 0.08, fp * 0.1, h * 0.5, 8), materials.hullDark, 'stack', [-fp * 0.25, h * 0.8, -fp * 0.25]);
        add(new THREE.SphereGeometry(fp * 0.07, 8, 6), materials.heatHot, 'stackTip', [-fp * 0.25, h * 1.05, -fp * 0.25]);
        add(new THREE.BoxGeometry(fp * 0.9, 0.04 * tileSize, fp * 0.06), team.strip, 'strip', [0, h * 0.5, fp * 0.43]);
        break;
      }
      case 'disc-barrels':
        add(new THREE.CylinderGeometry(r * 0.9, r, h * 0.2, 12), materials.hullDark, 'base', [0, h * 0.1, 0]);
        add(new THREE.CylinderGeometry(r * 0.45, r * 0.5, h * 0.35, 6), team.body, 'body', [0, h * 0.37, 0]);
        for (const z of [-r * 0.18, r * 0.18]) add(new THREE.CylinderGeometry(r * 0.07, r * 0.07, r * 1.2, 8), materials.hull, 'barrel', [r * 0.6, h * 0.42, z], [0, 0, Math.PI / 2]);
        ring(r * 0.55, 0.025 * tileSize, h * 0.56);
        break;
      case 'spire':
        add(new THREE.CylinderGeometry(r * 0.5, r * 0.8, h * 0.3, 6), materials.hullDark, 'base', [0, h * 0.15, 0]);
        add(new THREE.ConeGeometry(r * 0.35, h * 0.9, 6), team.body, 'body', [0, h * 0.75, 0]);
        ring(r * 0.45, 0.025 * tileSize, h * 0.5);
        break;
      case 'dish':
        add(new THREE.CylinderGeometry(r * 0.2, r * 0.4, h * 0.6, 6), materials.hull, 'body', [0, h * 0.3, 0]);
        add(new THREE.SphereGeometry(r * 0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), team.body, 'dish', [0, h * 0.75, 0], [Math.PI, 0.5, 0]);
        add(new THREE.SphereGeometry(r * 0.1, 8, 6), team.strip, 'strip', [0, h * 0.95, 0]);
        break;
      case 'dome':
        add(new THREE.CylinderGeometry(r * 0.8, r * 0.85, h * 0.3, 8), team.trim, 'base', [0, h * 0.15, 0]);
        add(new THREE.SphereGeometry(r * 0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), team.glass, 'glass', [0, h * 0.3, 0]);
        ring(r * 0.85, 0.03 * tileSize, h * 0.32);
        break;
      case 'pad':
        add(new THREE.CylinderGeometry(r * 0.95, r, h * 0.25, 8), team.trim, 'base', [0, h * 0.125, 0]);
        add(new THREE.BoxGeometry(fp * 0.3, h * 0.8, fp * 0.3), team.body, 'body', [-fp * 0.3, h * 0.6, -fp * 0.3]);
        ring(r * 0.7, 0.03 * tileSize, h * 0.27);
        break;
      case 'pump':
        add(new THREE.CylinderGeometry(r * 0.6, r * 0.7, h * 0.5, 8), team.body, 'body', [0, h * 0.25, 0]);
        add(new THREE.CylinderGeometry(r * 0.15, r * 0.15, h * 0.7, 8), materials.hull, 'piston', [0, h * 0.75, 0]);
        add(new THREE.SphereGeometry(r * 0.22, 8, 6), materials.flux, 'crystal', [0, h * 1.05, 0]);
        break;
      default:
        add(new THREE.BoxGeometry(fp * 0.8, h * 0.7, fp * 0.8), team.body, 'body', [0, h * 0.35, 0]);
        add(new THREE.BoxGeometry(fp * 0.3, h * 0.3, fp * 0.3), materials.hull, 'detail', [fp * 0.2, h * 0.85, -fp * 0.2]);
        ring(r * 0.95, 0.03 * tileSize, h * 0.1);
    }
  } else {
    // units: body + visor/weapon + team strip; `air` kinds float on a hover offset the owner can animate.
    const hover = look.air ? (look.hover ?? 1.2) * tileSize * 0.5 : 0;
    switch (look.shape) {
      case 'round':
        add(new THREE.SphereGeometry(r * 0.8, 10, 8), team.body, 'body', [0, h * 0.55, 0]).scale.set(1, 0.75, 1);
        add(new THREE.BoxGeometry(r * 0.5, r * 0.25, r * 0.6), materials.dark, 'visor', [r * 0.55, h * 0.65, 0]);
        for (const z of [-r * 0.45, r * 0.45]) add(new THREE.BoxGeometry(r * 0.7, r * 0.15, r * 0.15), materials.hull, 'pincer', [r * 0.7, h * 0.3, z]);
        ring(r * 0.75, 0.02 * tileSize, h * 0.45);
        break;
      case 'wedge':
        add(new THREE.ConeGeometry(r * 0.75, fp * 1.1, 4), team.body, 'body', [0, h * 0.5, 0], [0, Math.PI / 4, -Math.PI / 2]).scale.set(1, 1, 0.6);
        add(new THREE.BoxGeometry(r * 0.2, r * 0.35, r * 0.9), materials.hullLight, 'nose', [r * 0.75, h * 0.55, 0]);
        add(new THREE.BoxGeometry(r * 0.05, r * 0.1, r * 0.6), materials.dark, 'visor', [r * 0.86, h * 0.6, 0]);
        for (const z of [-r * 0.5, r * 0.5]) add(new THREE.BoxGeometry(r * 0.3, h * 0.3, r * 0.2), materials.hullDark, 'leg', [-r * 0.2, h * 0.15, z]);
        add(new THREE.BoxGeometry(r * 0.9, 0.02 * tileSize, 0.04 * tileSize), team.strip, 'strip', [-r * 0.1, h * 0.55, -r * 0.4]);
        break;
      case 'needle':
        add(new THREE.CapsuleGeometry(r * 0.22, fp * 0.7, 3, 8), team.body, 'body', [0, h * 0.55, 0], [0, 0, Math.PI / 2]);
        add(new THREE.CylinderGeometry(r * 0.05, r * 0.05, fp * 1.4, 6), materials.hullLight, 'lance', [r * 0.9, h * 0.6, 0], [0, 0, Math.PI / 2]);
        for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + Math.PI / 2; add(new THREE.CylinderGeometry(r * 0.04, r * 0.04, h * 0.5, 5), materials.hullDark, 'leg', [Math.cos(a) * r * 0.35, h * 0.25, Math.sin(a) * r * 0.35], [0.3 * Math.sin(a), 0, -0.3 * Math.cos(a)]); }
        ring(r * 0.3, 0.02 * tileSize, h * 0.56);
        break;
      case 'hex':
        add(new THREE.CylinderGeometry(r * 0.95, r * 0.85, h * 0.45, 6), team.body, 'body', [0, h * 0.45, 0]);
        add(new THREE.SphereGeometry(r * 0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), materials.hull, 'dome', [-r * 0.1, h * 0.67, 0]);
        for (const z of [-r * 0.5, r * 0.5]) add(new THREE.BoxGeometry(r * 0.7, r * 0.2, r * 0.18), materials.hullDark, 'claw', [r * 0.95, h * 0.4, z]);
        for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(r * 0.3, h * 0.25, r * 0.3), materials.dark, 'leg', [(i % 2 - 0.5) * r * 1.1, h * 0.12, (Math.floor(i / 2) - 0.5) * r * 1.1]);
        ring(r * 0.98, 0.03 * tileSize, h * 0.5);
        break;
      case 'wing':
        add(new THREE.ConeGeometry(r * 0.3, fp * 1.1, 4), team.body, 'body', [0, hover + h * 0.4, 0], [0, 0, -Math.PI / 2]);
        add(new THREE.BoxGeometry(r * 0.6, 0.03 * tileSize, fp * 1.3), team.bodyDark, 'wings', [-r * 0.2, hover + h * 0.4, 0]);
        add(new THREE.BoxGeometry(r * 0.1, 0.02 * tileSize, fp * 1.2), team.strip, 'strip', [-r * 0.45, hover + h * 0.42, 0]);
        break;
      case 'hull':
        add(new THREE.BoxGeometry(fp * 0.9, h * 0.5, fp * 0.6), team.body, 'body', [0, hover + h * 0.4, 0]);
        add(new THREE.BoxGeometry(fp * 0.3, h * 0.25, fp * 0.65), materials.hull, 'cab', [fp * 0.3, hover + h * 0.75, 0]);
        add(new THREE.BoxGeometry(fp * 0.9, 0.02 * tileSize, 0.04 * tileSize), team.strip, 'strip', [0, hover + h * 0.4, fp * 0.31]);
        break;
      case 'eye':
        add(new THREE.SphereGeometry(r * 0.6, 10, 8), materials.hull, 'body', [0, hover + h * 0.5, 0]);
        add(new THREE.SphereGeometry(r * 0.3, 8, 6), team.strip, 'strip', [r * 0.4, hover + h * 0.5, 0]);
        break;
      case 'dart':
        add(new THREE.ConeGeometry(r * 0.35, fp * 1.3, 5), team.body, 'body', [0, h * 0.4, 0], [0, 0, -Math.PI / 2]);
        add(new THREE.BoxGeometry(r * 0.3, 0.02 * tileSize, r * 1.2), team.strip, 'strip', [-r * 0.4, h * 0.4, 0]);
        break;
      case 'halo':
        add(new THREE.CapsuleGeometry(r * 0.35, h * 0.4, 3, 8), team.body, 'body', [0, h * 0.5, 0]);
        ring(r * 0.6, 0.02 * tileSize, h * 1.0, materials.health.good);
        break;
      case 'crown':
        add(new THREE.CapsuleGeometry(r * 0.35, h * 0.4, 3, 8), team.body, 'body', [0, h * 0.5, 0]);
        for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; add(new THREE.ConeGeometry(r * 0.1, h * 0.3, 4), materials.flux, 'crystal', [Math.cos(a) * r * 0.35, h * 1.0, Math.sin(a) * r * 0.35]); }
        break;
      case 'blade':
        add(new THREE.BoxGeometry(r * 0.5, h * 0.8, r * 0.25), team.bodyDark, 'body', [0, h * 0.45, 0], [0, 0, 0.15]);
        add(new THREE.BoxGeometry(r * 1.2, 0.03 * tileSize, r * 0.1), materials.hullLight, 'blade', [r * 0.5, h * 0.5, 0]);
        ring(r * 0.3, 0.015 * tileSize, h * 0.3);
        break;
      case 'spike':
        add(new THREE.CapsuleGeometry(r * 0.3, h * 0.4, 3, 8), team.body, 'body', [0, h * 0.45, 0]);
        add(new THREE.CylinderGeometry(r * 0.05, r * 0.08, h * 1.1, 6), materials.hullLight, 'lance', [r * 0.3, h * 0.9, 0], [0, 0, -0.5]);
        ring(r * 0.35, 0.02 * tileSize, h * 0.4);
        break;
      case 'barrel':
        add(new THREE.BoxGeometry(fp * 0.9, h * 0.4, fp * 0.7), team.body, 'body', [0, h * 0.3, 0]);
        add(new THREE.CylinderGeometry(r * 0.15, r * 0.2, fp * 1.1, 8), materials.hull, 'barrel', [r * 0.4, h * 0.65, 0], [0, 0, Math.PI / 2 - 0.5]);
        for (const z of [-r * 0.6, r * 0.6]) add(new THREE.BoxGeometry(fp * 0.9, h * 0.25, r * 0.2), materials.dark, 'track', [0, h * 0.12, z]);
        add(new THREE.BoxGeometry(fp * 0.8, 0.02 * tileSize, 0.04 * tileSize), team.strip, 'strip', [0, h * 0.4, fp * 0.36]);
        break;
      default:
        add(new THREE.OctahedronGeometry(r * 0.7, 0), team.body, 'body', [0, h * 0.5, 0]);
        add(new THREE.BoxGeometry(r * 0.4, r * 0.15, r * 0.4), materials.dark, 'visor', [r * 0.5, h * 0.55, 0]);
        ring(r * 0.6, 0.02 * tileSize, h * 0.2);
    }
  }
  g.name = `${kindKey(kind)}-placeholder`;
  g.userData = { kind: kindKey(kind), owner, source: 'placeholder', look };
  return g;
}

export default loadAssets;
