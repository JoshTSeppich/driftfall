// Driftfall 3D palette: every colour, emissive level and shared material preset in one place.
//
// The values are the ones in ART-GUIDE.md (Art Director sign-off): a near-black blue-grey basalt plateau at dusk,
// teal Shards (teal only ever means "resource"), side 0 Cobalt and side 1 Ember. Hex strings here are the truth;
// THREE.Color and material objects are built from them on demand so this file can be imported without three.js
// (tests, world.mjs, the 2D viewer) and the same numbers reach the 2D canvas and the 3D scene.
//
// Exports
//   TEAM[0|1], NEUTRAL, HIT, HEALTH, HEAT, WORLD, SKY, FOG, LIGHTS, EMISSIVE, KIND_LOOK, SIZE_CLASS
//   teamColors(owner) -> TEAM[owner] or NEUTRAL          lookFor(kind) -> { category, sizeClass, size, height, ... }
//   healthColor(frac) -> css hex                          hexToInt('#3fa9ff') -> 0x3fa9ff
//   pulse(t, speed, lo, hi) -> deterministic breathing value in [lo, hi]
//   makeMaterials(THREE, opts) -> one shared, cached set of materials (see below)
//   createPalette(ctx | THREE) -> { team, neutral, hit, health, heat, world, sky, fog, lights, emissive,
//                                   terrain, materials, color(css), teamColors, healthColor, lookFor,
//                                   update(frame, dt), dispose() }
//   The engine puts createPalette(THREE) on ctx.palette; every other system reads ctx.palette.* and never makes
//   its own copy of a team colour. update(frame, dt) breathes the shared Shard and strip emissives from frame.tick
//   + frame.alpha (deterministic: scrubbing a replay gives the same glow at the same tick).
//
// Nothing here uses Math.random or the clock.

export const PALETTE_VERSION = 1;

// ---------- teams ----------
// `main` body paint, `light` highlight, `dark` shadow, `deep` deepest shade, `strip` the emissive glow strip colour
// (a bright step of the same hue so bloom reads as the team), `glow` an rgba for 2D halos, `css` for the HUD.
// `base` and `main` are the same value (ART-GUIDE says base; the 2D art says main). `hex` is the base as a number
// for code that feeds THREE.Color directly. Per the Art Director, the glow strips are the light steps pushed
// through bloom (Joshua's "cyan" and "amber"), while hull paint stays the base colours.
export const TEAM = Object.freeze([
  Object.freeze({
    side: 0, name: 'Cobalt', base: '#3fa9ff', main: '#3fa9ff', hex: 0x3fa9ff, light: '#aee0ff', dark: '#174e8f', deep: '#0b2a4f',
    strip: '#aee0ff', stripHex: 0xaee0ff, laser: '#aee0ff', glow: 'rgba(63,169,255,0.55)', css: '#3fa9ff',
  }),
  Object.freeze({
    side: 1, name: 'Ember', base: '#ff8a3d', main: '#ff8a3d', hex: 0xff8a3d, light: '#ffd4ae', dark: '#9a3f14', deep: '#4f1f08',
    strip: '#ffd4ae', stripHex: 0xffd4ae, laser: '#ffd4ae', glow: 'rgba(255,138,61,0.55)', css: '#ff8a3d',
  }),
]);

export const NEUTRAL = Object.freeze({
  side: null, name: 'Drift', base: '#9aa3ad', main: '#9aa3ad', hex: 0x9aa3ad, light: '#d8dde3', dark: '#4e5660', deep: '#262b32',
  strip: '#d8dde3', stripHex: 0xd8dde3, laser: '#e0e6ec', glow: 'rgba(154,163,173,0.5)', css: '#9aa3ad',
});

export const HIT = Object.freeze({ color: '#ffffff', halo: 'rgba(255,255,255,0.8)', emissive: 4.0, ticks: 1 });

export const HEALTH = Object.freeze({ good: '#63e07a', warn: '#f0c84a', bad: '#ff5a5a', back: 'rgba(0,0,0,0.6)', warnBelow: 0.5, badBelow: 0.25 });

// Warm light is "industry" (Forge furnace, muzzle flash), never a team colour.
export const HEAT = Object.freeze({ hot: '#fff3c0', warm: '#ffb347', ember: '#ff7828', emissive: 2.0 });

// ---------- world ----------
export const WORLD = Object.freeze({
  ground: '#0f1318', groundLight: '#131920', groundDark: '#0d1015', drift: 'rgba(120,150,180,0.06)',
  grid: 'rgba(140,160,190,0.05)', crack: '#1d3a44',                      // faint glow cracks in the basalt
  rock: '#3a434f', rockLight: '#5a6573', rockDark: '#20262e',
  cliff: '#2b3139', cliffLight: '#434b55', ramp: '#171d24',
  shard: '#4ef2d8', shardLight: '#d9fff8', shardDark: '#137a6b', shardGlow: 'rgba(78,242,216,0.35)',
  shardEmpty: '#2a3b40', shardFloor: 'rgba(78,242,216,0.10)', shardFloorEmpty: 'rgba(40,60,64,0.35)',
  flux: '#c08cff', fluxLight: '#ecd9ff', fluxDark: '#5a2f8f',             // the second resource (vents), violet
  rubble: '#4a4238', rubbleLight: '#6b6150', rubbleDark: '#2a251f',
  scaffold: '#8a94a0', scaffoldDark: '#3b434d', weld: '#fff3c0',
  dust: '#5c6672', smoke: '#262c33', debris: '#3a434f',
  mesa: '#141a21', mesaFar: '#1a2230',
});

export const SKY = Object.freeze({ zenith: '#0a0e18', mid: '#1a2238', horizon: '#4a3a4e', dusk: '#b0603a', star: '#dfe8ff' });
export const FOG = Object.freeze({ color: '#1a1f2c', near: 28, far: 80, density: 0.018 });

// The keys terrain.mjs (sonnet) spreads over its defaults, filled from the guide values above so the plateau,
// rocks, Shards, cliffs, ramps, vents and sky all come from this one file.
export const TERRAIN = Object.freeze({
  ground: WORLD.ground, groundHi: WORLD.groundLight, seam: WORLD.groundDark,
  rock: WORLD.rock, rockDark: WORLD.rockDark, rockLight: WORLD.rockLight,
  crystal: WORLD.shard, crystalCore: WORLD.shardLight, crystalDead: WORLD.shardEmpty, crystalDark: WORLD.shardDark,
  crack: WORLD.crack,
  cliff: WORLD.cliff, cliffLip: WORLD.cliffLight, ramp: WORLD.ramp, rampMark: WORLD.scaffold,
  vent: WORLD.flux, ventFloor: WORLD.fluxDark, rubble: WORLD.rubble,
  skyTop: SKY.zenith, skyMid: SKY.mid, skyHorizon: SKY.horizon, skyDusk: SKY.dusk, star: SKY.star,
  fog: FOG.color, hemiSky: '#3a4a6e', hemiGround: '#15110f',
  mesa: WORLD.mesa, dust: WORLD.dust,
});

// Light rig (positions in tile units from the map centre, the renderer scales by tileSize). Light comes from the
// upper left (ART-GUIDE rule 3) with a warm low dusk sun, a cool sky fill and a faint cyan rim from the Shards.
export const LIGHTS = Object.freeze({
  sun: Object.freeze({ color: '#ffb582', intensity: 2.6, position: Object.freeze([-18, 22, -14]), shadowRadius: 3 }),
  sky: Object.freeze({ skyColor: '#3a4a6e', groundColor: '#15110f', intensity: 0.55 }),
  rim: Object.freeze({ color: '#4ef2d8', intensity: 0.35, position: Object.freeze([22, 8, 20]) }),
  ambient: Object.freeze({ color: '#202838', intensity: 0.4 }),
  exposure: 1.05,
  bloom: Object.freeze({ strength: 0.65, radius: 0.55, threshold: 0.85 }),
});

// Emissive intensities (MeshStandardMaterial.emissiveIntensity) so bloom catches the right things and only those.
export const EMISSIVE = Object.freeze({
  strip: 1.8, stripIdle: 1.2,     // team glow strips breathe between these two
  shard: 1.4, shardLow: 0.9, shardEmpty: 0.0,
  flux: 1.3, heat: 2.0, laser: 3.5, hit: 4.0, scaffold: 0.6, weld: 3.0, selection: 1.5, health: 1.0,
  window: 0.8,
});

// ---------- kinds ----------
// Size classes in tile fractions (footprint as a fraction of one tile, height in tiles), plus render hints shared
// by units, buildings, vfx and hud: `air` floats, `ranged` draws beams, `heavy` makes dust and big impacts.
export const SIZE_CLASS = Object.freeze({
  tiny: Object.freeze({ size: 0.35, height: 0.3 }),
  small: Object.freeze({ size: 0.5, height: 0.45 }),
  medium: Object.freeze({ size: 0.65, height: 0.6 }),
  large: Object.freeze({ size: 0.9, height: 0.8 }),
  huge: Object.freeze({ size: 1.25, height: 1.1 }),
  tile: Object.freeze({ size: 1.0, height: 0.9 }),
});

const look = (category, sizeClass, shape, extra = {}) =>
  Object.freeze({ category, sizeClass, shape, ...SIZE_CLASS[sizeClass], air: false, ranged: false, heavy: false, ...extra });

// ENV-SPEC v2 kinds plus the v3 roster the design trio settled on in the chat (fable's names: Spiker, Howler, Dart,
// Skiff, Barge, Mender, Shade, Seer, Conduit; Quarters, Siphon, Sensor Mast, Foundry, Hangar, Sanctum; vent, ramp,
// rich crystal, rubble). The earlier working names (Skyspike, Bombard, Gale, Ferry, Lumen, Hexer, Aerie, Flak
// Spire, Beacon) stay as aliases because the model manifest uses them. Shape words are the Art Director's.
// Unknown kinds fall back to a medium ground unit / tile building so nothing ever fails to draw.
const SPIKER = look('unit', 'medium', 'spike', { ranged: true, antiAir: true });
const HOWLER = look('unit', 'large', 'barrel', { ranged: true, heavy: true, splash: true, deploys: true });
const SKIFF = look('unit', 'medium', 'wing', { air: true, ranged: true, hover: 1.4 });
const BARGE = look('unit', 'large', 'hull', { air: true, hover: 1.6, cargo: true });
const SEER = look('unit', 'tiny', 'eye', { air: true, hover: 2.0, detector: true, glow: WORLD.shard });
const CONDUIT = look('unit', 'medium', 'crown', { caster: true });
const QUARTERS = look('structure', 'tile', 'block-low', { height: 0.6 });
const HANGAR = look('structure', 'tile', 'pad', { air: true });
const SENSOR_MAST = look('structure', 'medium', 'dish', { detector: true, height: 1.1 });
const FLAK_SPIRE = look('structure', 'large', 'spire', { ranged: true, antiAir: true, aims: true, height: 1.2 });
const RICH = look('terrain', 'tile', 'cluster-big', { shard: true, rich: true, height: 0.7 });
const RUBBLE = look('terrain', 'tile', 'scrap', { height: 0.3, destructible: true });

export const KIND_LOOK = Object.freeze({
  // units
  worker: look('unit', 'small', 'round', { accent: 'visor', carries: true }),
  grunt: look('unit', 'medium', 'wedge'),
  lancer: look('unit', 'medium', 'needle', { ranged: true, size: 0.9, width: 0.3 }),
  brute: look('unit', 'large', 'hex', { heavy: true, dust: true }),
  spiker: SPIKER, skyspike: SPIKER,
  howler: HOWLER, bombard: HOWLER,
  dart: look('unit', 'small', 'dart', { fast: true }),
  skiff: SKIFF, gale: SKIFF,
  barge: BARGE, ferry: BARGE,
  mender: look('unit', 'small', 'halo', { healer: true }),
  shade: look('unit', 'medium', 'blade', { cloak: true }),
  seer: SEER, lumen: SEER,
  conduit: CONDUIT, hexer: CONDUIT,
  // structures
  core: look('structure', 'huge', 'octagon-ring', { overflow: true, height: 1.2 }),
  quarters: QUARTERS,
  forge: look('structure', 'tile', 'block-stack', { heat: true }),
  turret: look('structure', 'large', 'disc-barrels', { ranged: true, aims: true, size: 0.85 }),
  siphon: look('structure', 'large', 'pump', { flux: true }),
  foundry: look('structure', 'tile', 'block-heavy', { heat: true, height: 1.0 }),
  hangar: HANGAR, aerie: HANGAR,
  sanctum: look('structure', 'tile', 'dome', { flux: true, height: 1.3 }),
  'sensor-mast': SENSOR_MAST, sensormast: SENSOR_MAST, mast: SENSOR_MAST, beacon: SENSOR_MAST,
  'flak-spire': FLAK_SPIRE, flakspire: FLAK_SPIRE,
  // terrain tile kinds (v3)
  open: look('terrain', 'tile', 'floor'), floor: look('terrain', 'tile', 'floor'),
  ramp: look('terrain', 'tile', 'ramp'), cliff: look('terrain', 'tile', 'cliff'),
  rock: look('terrain', 'tile', 'boulder', { height: 0.6 }),
  crystal: look('terrain', 'tile', 'cluster', { shard: true, height: 0.55 }),
  'shard-field': look('terrain', 'tile', 'cluster', { shard: true, height: 0.55 }),
  shard: look('terrain', 'tile', 'cluster', { shard: true, height: 0.4 }),
  'rich-crystal': RICH, 'rich-shard': RICH,
  vent: look('terrain', 'tile', 'crater', { flux: true, height: 0.15 }),
  rubble: RUBBLE, debris: RUBBLE, scrap: RUBBLE,
});

// The agreed v3 names, one per kind (aliases above are not repeated here). Renderers use this to make sure every
// kind has a look; the QA integration test can compare it with env/stats.mjs when v3 lands there.
export const ROSTER = Object.freeze({
  units: Object.freeze(['worker', 'grunt', 'lancer', 'spiker', 'brute', 'howler', 'dart', 'skiff', 'barge', 'mender', 'shade', 'seer', 'conduit']),
  structures: Object.freeze(['core', 'quarters', 'forge', 'turret', 'siphon', 'foundry', 'hangar', 'sanctum', 'sensor-mast']),
  terrain: Object.freeze(['open', 'rock', 'crystal', 'rich-crystal', 'vent', 'ramp', 'cliff', 'rubble']),
});

const DEFAULT_LOOK = Object.freeze({
  unit: look('unit', 'medium', 'unknown'),
  structure: look('structure', 'tile', 'unknown'),
  terrain: look('terrain', 'tile', 'unknown'),
});

// Normalises names the sim or manifest might use ('rich_shard', 'richShard', 'flak_spire') to the palette key.
export function kindKey(kind) {
  if (!kind) return '';
  return String(kind).trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[_\s]+/g, '-');
}

// Same looks keyed without dashes, so 'richshard', 'rich_shard' and 'rich-shard' all resolve.
const KIND_LOOK_FLAT = Object.freeze(Object.fromEntries(Object.entries(KIND_LOOK).map(([k, v]) => [k.replace(/-/g, ''), v])));

// Look up render hints for any kind; `category` ('unit' | 'structure' | 'terrain') picks the fallback when the kind
// is new. Always returns an object, never undefined.
export function lookFor(kind, category = 'unit') {
  const k = kindKey(kind);
  return KIND_LOOK[k] ?? KIND_LOOK_FLAT[k.replace(/-/g, '')] ?? DEFAULT_LOOK[category] ?? DEFAULT_LOOK.unit;
}

export function teamColors(owner) {
  return TEAM[owner] ?? NEUTRAL;
}

export function healthColor(frac) {
  if (frac <= HEALTH.badBelow) return HEALTH.bad;
  if (frac <= HEALTH.warnBelow) return HEALTH.warn;
  return HEALTH.good;
}

export function hexToInt(css) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(css).trim());
  if (m) return parseInt(m[1], 16);
  const s = /^#?([0-9a-f]{3})$/i.exec(String(css).trim());
  if (s) return parseInt(s[1].split('').map((c) => c + c).join(''), 16);
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(String(css));
  if (rgba) return (Number(rgba[1]) << 16) | (Number(rgba[2]) << 8) | Number(rgba[3]);
  throw new Error(`palette: not a colour: ${css}`);
}

// Deterministic breathing in [lo, hi]; t in seconds (or ticks), speed in cycles per unit of t.
export function pulse(t, speed = 0.5, lo = 0, hi = 1) {
  const s = 0.5 + 0.5 * Math.sin(t * speed * Math.PI * 2);
  return lo + (hi - lo) * s;
}

// ---------- materials ----------
// One shared set per THREE instance, so every module draws with identical paint and the renderer batches well.
// Names are stable; add, never rename (other owners code against them):
//   team[side].body / strip / trim / glass / laser / dust      hull, hullLight, hullDark, dark
//   ground, groundLight, groundDark, crack, rock, rockLight, rockDark, cliff, ramp, mesa
//   shard, shardEmpty, shardFloor, flux, rubble, scaffold, scaffoldDark, weld, heat, hit, selection,
//   health.good / warn / bad / back, star, smoke, debris
const materialCache = new WeakMap();

export function makeMaterials(THREE, opts = {}) {
  if (!THREE || typeof THREE.MeshStandardMaterial !== 'function') throw new Error('palette.makeMaterials needs THREE');
  const cached = materialCache.get(THREE);
  if (cached && !opts.fresh) return cached;

  const c = (css) => new THREE.Color(hexToInt(css));
  const std = (css, extra = {}) => new THREE.MeshStandardMaterial({ color: c(css), roughness: 0.6, metalness: 0.25, ...extra });
  const glow = (css, intensity, extra = {}) =>
    new THREE.MeshStandardMaterial({ color: c(css), emissive: c(css), emissiveIntensity: intensity, roughness: 0.4, metalness: 0.0, ...extra });
  const flat = (css, extra = {}) => new THREE.MeshBasicMaterial({ color: c(css), ...extra });

  const team = TEAM.map((t) => ({
    side: t.side, name: t.name,
    body: std(t.main, { roughness: 0.45, metalness: 0.35 }),
    bodyDark: std(t.dark, { roughness: 0.55, metalness: 0.3 }),
    bodyLight: std(t.light, { roughness: 0.4, metalness: 0.3 }),
    strip: glow(t.strip, EMISSIVE.strip),
    trim: std(t.deep, { roughness: 0.7, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: c(t.light), emissive: c(t.strip), emissiveIntensity: EMISSIVE.window, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.7 }),
    laser: flat(t.laser, { transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    dust: flat(t.main, { transparent: true, opacity: 0.35, depthWrite: false }),
    site: flat(t.main, { transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
  }));
  const neutral = {
    side: null, name: NEUTRAL.name,
    body: std(NEUTRAL.main), bodyDark: std(NEUTRAL.dark), bodyLight: std(NEUTRAL.light),
    strip: glow(NEUTRAL.strip, EMISSIVE.stripIdle), trim: std(NEUTRAL.deep),
    glass: std(NEUTRAL.light, { transparent: true, opacity: 0.6 }),
    laser: flat(NEUTRAL.laser, { transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    dust: flat(NEUTRAL.main, { transparent: true, opacity: 0.3, depthWrite: false }),
    site: flat(NEUTRAL.main, { transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
  };

  const materials = {
    team, neutral,
    forOwner(owner) { return team[owner] ?? neutral; },
    // hull greys shared by both fleets (ART-GUIDE: same hulls, only paint differs)
    hull: std('#8f98a3', { roughness: 0.5, metalness: 0.45 }),
    hullLight: std('#c4ccd4', { roughness: 0.45, metalness: 0.4 }),
    hullDark: std('#4e5660', { roughness: 0.6, metalness: 0.4 }),
    dark: std('#262b32', { roughness: 0.7, metalness: 0.3 }),
    // terrain
    ground: std(WORLD.ground, { roughness: 0.95, metalness: 0.05 }),
    groundLight: std(WORLD.groundLight, { roughness: 0.95, metalness: 0.05 }),
    groundDark: std(WORLD.groundDark, { roughness: 0.95, metalness: 0.05 }),
    crack: glow(WORLD.crack, 0.5),
    rock: std(WORLD.rock, { roughness: 0.9, metalness: 0.05, flatShading: true }),
    rockLight: std(WORLD.rockLight, { roughness: 0.9, metalness: 0.05, flatShading: true }),
    rockDark: std(WORLD.rockDark, { roughness: 0.9, metalness: 0.05, flatShading: true }),
    cliff: std(WORLD.cliff, { roughness: 0.9, metalness: 0.05, flatShading: true }),
    ramp: std(WORLD.ramp, { roughness: 0.9, metalness: 0.05 }),
    mesa: std(WORLD.mesa, { roughness: 1.0, metalness: 0.0, fog: true }),
    shard: new THREE.MeshStandardMaterial({ color: c(WORLD.shard), emissive: c(WORLD.shard), emissiveIntensity: EMISSIVE.shard, roughness: 0.2, metalness: 0.0, transparent: true, opacity: 0.92, flatShading: true }),
    shardEmpty: std(WORLD.shardEmpty, { roughness: 0.8, metalness: 0.1, flatShading: true }),
    shardFloor: glow(WORLD.shardDark, 0.6, { transparent: true, opacity: 0.5, depthWrite: false }),
    flux: new THREE.MeshStandardMaterial({ color: c(WORLD.flux), emissive: c(WORLD.flux), emissiveIntensity: EMISSIVE.flux, roughness: 0.3, metalness: 0.0, transparent: true, opacity: 0.9 }),
    rubble: std(WORLD.rubble, { roughness: 0.95, metalness: 0.15, flatShading: true }),
    // construction, effects
    scaffold: new THREE.MeshStandardMaterial({ color: c(WORLD.scaffold), emissive: c(WORLD.scaffold), emissiveIntensity: EMISSIVE.scaffold, roughness: 0.5, metalness: 0.6 }),
    scaffoldDark: std(WORLD.scaffoldDark, { roughness: 0.6, metalness: 0.5 }),
    weld: flat(WORLD.weld, { transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    heat: glow(HEAT.ember, EMISSIVE.heat),
    heatHot: glow(HEAT.hot, EMISSIVE.heat * 1.2),
    hit: glow(HIT.color, EMISSIVE.hit),
    selection: flat(WORLD.shardLight, { transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    health: {
      good: flat(HEALTH.good, { depthTest: false, transparent: true }),
      warn: flat(HEALTH.warn, { depthTest: false, transparent: true }),
      bad: flat(HEALTH.bad, { depthTest: false, transparent: true }),
      back: flat('#000000', { depthTest: false, transparent: true, opacity: 0.6 }),
    },
    star: flat(SKY.star, { transparent: true, opacity: 0.9, depthWrite: false }),
    smoke: flat(WORLD.smoke, { transparent: true, opacity: 0.5, depthWrite: false }),
    debris: std(WORLD.debris, { roughness: 0.8, metalness: 0.3, flatShading: true }),
  };

  // Give every material a readable name so the renderer's debug overlay and tests can tell them apart.
  const nameAll = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && v.isMaterial) v.name = `${prefix}${k}`;
      else if (v && typeof v === 'object' && !Array.isArray(v) && !v.isColor) nameAll(v, `${prefix}${k}.`);
    }
  };
  nameAll(materials, 'df.');
  team.forEach((t, i) => nameAll(t, `df.team${i}.`));
  nameAll(neutral, 'df.neutral.');

  materials.all = () => {
    const out = [];
    const walk = (obj) => { for (const v of Object.values(obj)) { if (v && v.isMaterial) out.push(v); else if (v && typeof v === 'object' && !Array.isArray(v) && typeof v !== 'function') walk(v); } };
    walk(materials); team.forEach(walk); walk(neutral);
    return [...new Set(out)];
  };
  materials.dispose = () => {
    for (const m of materials.all()) m.dispose();
    if (materialCache.get(THREE) === materials) materialCache.delete(THREE);
  };

  if (!opts.fresh) materialCache.set(THREE, materials);
  return materials;
}

// Recolour an already-made material to a team (used by assets.mjs when it re-paints a loaded model).
export function tintMaterial(material, css, { emissive = null, emissiveIntensity = null } = {}) {
  if (!material) return material;
  if (material.color) material.color.setHex(hexToInt(css));
  if (emissive !== null && material.emissive) {
    material.emissive.setHex(hexToInt(emissive));
    if (emissiveIntensity !== null) material.emissiveIntensity = emissiveIntensity;
  }
  return material;
}

// ---------- the ctx.palette object ----------
// Accepts either the THREE namespace or a ctx that has one (so both `createPalette(THREE)` and
// `createPalette(ctx)` work). Without THREE you still get all the colour data; `materials` is then null.
export function createPalette(ctxOrThree = null, opts = {}) {
  const THREE = ctxOrThree && typeof ctxOrThree.MeshStandardMaterial === 'function' ? ctxOrThree : ctxOrThree?.THREE ?? null;
  const materials = THREE ? makeMaterials(THREE, opts) : null;
  const colorCache = new Map();

  const palette = {
    version: PALETTE_VERSION,
    team: TEAM, teams: TEAM.map((t) => t.main), teamHex: TEAM.map((t) => t.hex), strips: TEAM.map((t) => t.strip),
    neutral: NEUTRAL, hit: HIT, health: HEALTH, heat: HEAT,
    world: WORLD, terrain: TERRAIN, sky: SKY, fog: FOG, lights: LIGHTS, emissive: EMISSIVE,
    // flat shortcuts other systems asked for (vfx: shard, dust; engine: ground, rock, crystal; guide: heat)
    shard: WORLD.shard, crystal: WORLD.shard, shardGlow: WORLD.shardGlow, dust: WORLD.dust, smoke: WORLD.smoke,
    ground: WORLD.ground, rock: WORLD.rock, flux: WORLD.flux, background: SKY.mid,
    kinds: KIND_LOOK, roster: ROSTER, sizeClass: SIZE_CLASS,
    materials,
    teamColors, healthColor, lookFor, kindKey, pulse, hexToInt,
    // THREE.Color for any css value, cached and shared (do not mutate; clone first).
    color(css) {
      if (!THREE) throw new Error('palette.color needs THREE');
      let col = colorCache.get(css);
      if (!col) colorCache.set(css, (col = new THREE.Color(hexToInt(css))));
      return col;
    },
    // Breathe the shared emissives from the frame so every Shard and strip pulses in step and scrubbing is stable.
    update(frame, _dt) {
      if (!materials) return;
      const t = frame ? (frame.tick ?? 0) + (frame.alpha ?? 0) : 0;
      materials.shard.emissiveIntensity = pulse(t, 1 / 24, EMISSIVE.shardLow, EMISSIVE.shard);
      materials.flux.emissiveIntensity = pulse(t + 7, 1 / 30, EMISSIVE.flux * 0.7, EMISSIVE.flux);
      for (let i = 0; i < materials.team.length; i++) {
        materials.team[i].strip.emissiveIntensity = pulse(t + i * 9, 1 / 40, EMISSIVE.stripIdle, EMISSIVE.strip);
      }
    },
    dispose() { if (materials) materials.dispose(); colorCache.clear(); },
  };
  return palette;
}

// Colour data only (no materials), for modules that never touch three.js and for the QA test's shape check.
export const PALETTE = createPalette(null);

export default createPalette;
