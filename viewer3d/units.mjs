// Driftfall 3D units (owner: fable). createUnits(ctx, opts) -> { update(frame, dt), dispose() } per VISUAL-3D.md.
//
// Every unit is an original low-poly model built in code from Three.js primitives, following the shape words in
// ART-GUIDE.md §4 (Worker round, Grunt wedge, Lancer needle, Brute hex) and the Art Director's shape words for the
// v3 roster (Spiker spike, Howler barrel, Dart arrowhead, Skiff open V, Barge flat barge, Mender ring, Shade
// crescent, Seer lantern, Conduit trident). CC0 models from assets.mjs are only used when opts.useAssetModels is
// true (the Kenney astronauts do not keep the silhouettes, see the chat), and then still get a team glow ring.
//
// Each unit gets: a team glow strip (emissive, breathes, flares on attack), smooth movement between ticks (prev and
// next tile lerped by frame.alpha), walk / attack / mine / death animations driven by the frame, a whole-piece white
// hit flash, and a health bar (green / yellow / red per ART-GUIDE) that is hidden at full health.
//
// Pure helpers (normalizeEvents, choosePose, yawBetween, turnToward, healthBarState, lerpTile, UNIT_SPECS,
// resolveKind, buildUnitModel) are exported so tests/viewer3d-units.test.mjs can run them in node.

import { STATS as ENV_STATS } from '../env/stats.mjs';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------------------------------------------
// Look. Falls back to these when ctx.palette is missing; otherwise palette.team[side] (ART-GUIDE values) wins.
// ---------------------------------------------------------------------------------------------------------------
const DEFAULT_TEAM = [
  { main: '#3fa9ff', light: '#aee0ff', dark: '#174e8f', strip: '#7fd4ff' },   // Cobalt
  { main: '#ff8a3d', light: '#ffd4ae', dark: '#9a3f14', strip: '#ffb070' },   // Ember
];
const HULL = '#8f98a3';
const HULL_LIGHT = '#c4ccd4';
const HULL_DARK = '#4e5660';
const VISOR = '#e8fbff';
const SHARD = '#4ef2d8';          // teal only ever means Shards (carried load, Seer lantern)
const HEALTH = { good: '#63e07a', warn: '#f0c84a', bad: '#ff5a5a', warnBelow: 0.5, badBelow: 0.25 };
const DEFAULT_STRIP_LEVEL = 1.8;

// Rigs: hover (bobbing pod), biped (two legs), tripod (three legs, sways), hex (six-legged stomp), tracked (low
// chassis), skim (low wedge that banks), air (flies at an altitude), float (hovers with orbiting bits).
// size = footprint in tiles, height = top of the model in tiles (health bar sits above it), stride = leg cycles per
// tile walked.
export const UNIT_SPECS = {
  // The agreed four (ENV-SPEC.md v2).
  worker: { rig: 'hover',   size: 0.50, height: 0.60, stride: 1.0, shape: 'round' },
  grunt:  { rig: 'biped',   size: 0.65, height: 0.80, stride: 1.4, shape: 'wedge' },
  lancer: { rig: 'tripod',  size: 0.90, height: 1.00, stride: 1.6, shape: 'needle', bar: 0.5 },   // 0.9 long, 0.3 wide
  brute:  { rig: 'hex',     size: 0.90, height: 1.00, stride: 1.0, shape: 'hex', heavy: true },
  // v3 roster (Lead Game Designer fable's names, which the Unit Designer adopted). Provisional until AGREE: v3.
  spiker:  { rig: 'biped',   size: 0.52, height: 1.25, stride: 1.4, shape: 'spike',     provisional: true },
  howler:  { rig: 'tracked', size: 0.86, height: 0.70, stride: 1.0, shape: 'barrel',    provisional: true, heavy: true },
  dart:    { rig: 'skim',    size: 0.40, height: 0.20, stride: 2.0, shape: 'arrowhead', provisional: true },
  skiff:   { rig: 'air',     size: 0.62, height: 0.20, altitude: 1.5, shape: 'open-v',  provisional: true },
  barge:   { rig: 'air',     size: 0.90, height: 0.30, altitude: 1.8, shape: 'barge',   provisional: true },
  seer:    { rig: 'air',     size: 0.36, height: 0.34, altitude: 2.2, shape: 'lantern', provisional: true },
  mender:  { rig: 'hover',   size: 0.55, height: 0.72, stride: 1.0, shape: 'ring',      provisional: true },
  shade:   { rig: 'biped',   size: 0.44, height: 0.95, stride: 1.6, shape: 'crescent',  provisional: true, ghost: true },
  conduit: { rig: 'float',   size: 0.50, height: 1.30, stride: 1.0, shape: 'trident',   provisional: true },
};
// Names used by earlier proposals in the chat (sonnet's v3 draft) map onto the agreed ones so no kind is ever blank.
export const KIND_ALIASES = { skyspike: 'spiker', bombard: 'howler', gale: 'skiff', ferry: 'barge', lumen: 'seer', hexer: 'conduit' };
export const UNIT_KINDS_3D = Object.freeze(Object.keys(UNIT_SPECS));

export function resolveKind(kind) {
  const k = String(kind ?? '').trim().toLowerCase().replace(/[_\s-]+/g, '');
  return UNIT_SPECS[k] ? k : (KIND_ALIASES[k] ?? k);
}

// Joshua's TV note: units must read at TV distance, so models are drawn larger than their tile fraction. The
// footprint sizes above are the design sizes; UNIT_SCALE multiplies them on screen (opts.scale overrides).
export const UNIT_SCALE = 1.35;

const DEATH_SECONDS = 0.8;
const SPAWN_SECONDS = 0.35;
const HIT_FLASH_SECONDS = 0.16;
const BAR_HOLD_SECONDS = 1.6;

// ---------------------------------------------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------------------------------------------

// world.mjs hands events as an array of enriched log events ({ e: 'hit', type: 'hit', ... }); a grouped object
// ({ hits: [...], deaths: [...] }) is accepted too. Returns { hits, deaths, spawns, mines, delivers }.
export function normalizeEvents(events) {
  const out = { hits: [], deaths: [], spawns: [], mines: [], delivers: [] };
  if (!events) return out;
  if (Array.isArray(events)) {
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      switch (ev.e ?? ev.type) {
        case 'hit': out.hits.push(ev); break;
        case 'die': out.deaths.push(ev.id); break;
        case 'spawn': if (ev.unit) out.spawns.push(ev.unit.id); break;
        case 'mine': out.mines.push(ev); break;
        case 'deliver': out.delivers.push(ev); break;
        default: break;
      }
    }
    return out;
  }
  const idOf = (v) => (typeof v === 'object' && v !== null ? v.id ?? v.unit?.id : v);
  out.hits = (events.hits ?? events.hit ?? []).filter((h) => h && typeof h === 'object');
  out.deaths = (events.deaths ?? events.die ?? []).map(idOf).filter((id) => id !== undefined);
  out.spawns = (events.spawns ?? events.spawn ?? []).map(idOf).filter((id) => id !== undefined);
  out.mines = events.mines ?? events.mine ?? [];
  out.delivers = events.delivers ?? events.deliver ?? [];
  return out;
}

// Lerp a unit between its prev and next tile. Either side may be missing (spawned or dying this tick).
export function lerpTile(prev, next, alpha) {
  const a = prev ?? next;
  const b = next ?? prev;
  const t = Math.max(0, Math.min(1, alpha ?? 0));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Pose for this tick. prev/next are the unit's records (either may be undefined), hits are this tick's hit events.
//   'die'    in prev but not in next, or has a die event
//   'attack' it dealt a hit this tick
//   'walk'   its tile changed this tick, or it moved within `graceTicks` ticks and still has a moving order
//   'mine'   a Worker whose gather order is in the mining phase, or that picked up Shards this tick
//   'idle'   otherwise
export function choosePose({ id, prev, next, hits = [], deaths = [], mines = [], lastMoveTick = -Infinity, tick = 0, graceTicks = 1 }) {
  if ((prev && !next) || deaths.includes(id)) return 'die';
  if (hits.some((h) => h.by === id)) return 'attack';
  const u = next ?? prev;
  if (prev && next && (prev.x !== next.x || prev.y !== next.y)) return 'walk';
  const order = u?.order;
  const moving = order && (order.type === 'move' || order.type === 'attack' || (order.type === 'gather' && order.phase !== 'mining') || order.type === 'build');
  if (moving && tick - lastMoveTick <= graceTicks && tick - lastMoveTick >= 0) return 'walk';
  if (order?.type === 'gather' && order.phase === 'mining') return 'mine';
  if (mines.some((m) => m.id === id)) return 'mine';
  return 'idle';
}

// Yaw (radians about +Y) so a model built facing +Z looks from `from` to `to`; null when they coincide.
export function yawBetween(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return null;
  return Math.atan2(dx, dz);
}

// Shortest-arc step from yaw a toward yaw b by at most rate * dt radians.
export function turnToward(a, b, rate, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-rate * dt, Math.min(rate * dt, d));
}

// Health bar: hidden at full health; shown while hurt and for `hold` seconds after a hit, then fades out.
// level follows ART-GUIDE: good over 50 %, warn over 25 %, bad below.
export function healthBarState({ hp, maxHp, sinceHit = Infinity, hold = BAR_HOLD_SECONDS, thresholds = HEALTH }) {
  const max = maxHp > 0 ? maxHp : Math.max(1, hp);
  const ratio = Math.max(0, Math.min(1, hp / max));
  let opacity = 0;
  if (ratio < 1) opacity = 1;
  if (sinceHit < hold) opacity = 1;
  else if (sinceHit < hold + 0.5) opacity = Math.max(opacity, 1 - (sinceHit - hold) / 0.5);
  const level = ratio <= thresholds.badBelow ? 'bad' : ratio <= thresholds.warnBelow ? 'warn' : 'good';
  return { ratio, opacity, visible: opacity > 0.01, level };
}

export function maxHpOf(kind, stats) {
  const s = stats?.units?.[kind] ?? ENV_STATS.units?.[kind];
  return typeof s?.hp === 'number' ? s.hp : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Materials and geometry
// ---------------------------------------------------------------------------------------------------------------
function teamLook(palette, owner) {
  const p = palette?.team?.[owner] ?? palette?.teams?.[owner];
  const d = DEFAULT_TEAM[owner] ?? DEFAULT_TEAM[0];
  return {
    main: p?.main ?? d.main,
    light: p?.light ?? d.light,
    dark: p?.dark ?? d.dark,
    strip: p?.strip ?? p?.light ?? d.strip,
  };
}

// One material set per team, shared by every unit of that team. The palette's shared materials are used where they
// exist (so units, buildings and terrain are painted from the same pots); the rest are made here once.
function makeTeamMaterials(THREE, palette, owner) {
  const c = teamLook(palette, owner);
  const pm = palette?.materials;
  const tm = pm?.team?.[owner];
  const stripLevel = palette?.emissive?.strip ?? DEFAULT_STRIP_LEVEL;
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, ...extra });
  const own = [];
  const keep = (m) => { own.push(m); return m; };
  const mats = {
    body: tm?.body ?? keep(std(c.main)),
    accent: tm?.bodyDark ?? keep(std(c.dark, { roughness: 0.6, metalness: 0.4 })),
    light: tm?.bodyLight ?? keep(std(c.light, { roughness: 0.4, metalness: 0.3 })),
    trim: tm?.trim ?? keep(std(c.dark, { roughness: 0.7, metalness: 0.2 })),
    hull: pm?.hull ?? keep(std(HULL, { roughness: 0.5, metalness: 0.45 })),
    hullLight: pm?.hullLight ?? keep(std(HULL_LIGHT, { roughness: 0.45, metalness: 0.4 })),
    hullDark: pm?.hullDark ?? keep(std(HULL_DARK, { roughness: 0.6, metalness: 0.4 })),
    // the strip template; each unit clones it so attack flares and death fades stay local
    strip: keep(new THREE.MeshStandardMaterial({ color: c.strip, emissive: c.strip, emissiveIntensity: stripLevel, roughness: 0.4, metalness: 0 })),
    visor: keep(new THREE.MeshStandardMaterial({ color: VISOR, emissive: VISOR, emissiveIntensity: 1.2, roughness: 0.2 })),
    shard: pm?.shard ?? keep(new THREE.MeshStandardMaterial({ color: SHARD, emissive: SHARD, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0, flatShading: true })),
    ghost: keep(new THREE.MeshStandardMaterial({ color: c.main, roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.45 })),
    hit: pm?.hit ?? keep(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 4.0 })),
    colors: c,
    stripLevel,
    own,
  };
  return mats;
}

const geoCache = new Map();
function geo(THREE, key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const box = (THREE, w, h, d) => geo(THREE, `box:${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (THREE, rt, rb, h, n = 8) => geo(THREE, `cyl:${rt},${rb},${h},${n}`, () => new THREE.CylinderGeometry(rt, rb, h, n));
const cone = (THREE, r, h, n = 6) => geo(THREE, `cone:${r},${h},${n}`, () => new THREE.ConeGeometry(r, h, n));
const sph = (THREE, r, n = 8) => geo(THREE, `sph:${r},${n}`, () => new THREE.SphereGeometry(r, n, Math.max(4, n >> 1)));
const octa = (THREE, r) => geo(THREE, `octa:${r}`, () => new THREE.OctahedronGeometry(r, 0));
const tor = (THREE, r, t, n = 10) => geo(THREE, `tor:${r},${t},${n}`, () => new THREE.TorusGeometry(r, t, 6, n));
// a wedge: a 4-sided pyramid lying on its side, point forward (+Z), flattened to `h`
const wedge = (THREE, w, h, l) => geo(THREE, `wedge:${w},${h},${l}`, () => {
  const g = new THREE.ConeGeometry(0.5, 1, 4);
  g.rotateY(Math.PI / 4);
  g.rotateX(Math.PI / 2);
  g.scale(w * 1.3, h, l);
  return g;
});

function mesh(THREE, g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = false;
  return o;
}
// lay a ring / rod flat (rotate 90° about X) or squash a mesh; both return the mesh so it can be added in place
// (Object3D.add returns the parent, so `parent.add(m).rotation` would turn the parent: never do that)
const flat = (o) => { o.rotation.x = Math.PI / 2; return o; };
const squash = (o, y) => { o.scale.y = y; return o; };
function pivot(THREE, x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  return p;
}

// Builders return { group, parts }. parts has pivots the rig animates: body (the whole upper body / hull, bobs),
// head, legs[], arms[], weapon, carry (Worker's Shard), extras[] (spinners). Models face +Z, feet at y = 0,
// built at the spec size in tile units.
const BUILDERS = {
  // WORKER: round. A hover pod with two pincers and a visor; holds a teal Shard out in front when carrying.
  worker(THREE, m) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.26, 0);
    g.add(body);
    body.add(mesh(THREE, sph(THREE, 0.21, 10), m.body, 0, 0.02, 0));                           // round pod
    body.add(mesh(THREE, cyl(THREE, 0.16, 0.22, 0.08, 10), m.hullDark, 0, -0.16, 0));          // hover skirt
    body.add(flat(mesh(THREE, tor(THREE, 0.22, 0.025, 12), m.strip, 0, -0.06, 0)));           // glow ring
    body.add(mesh(THREE, box(THREE, 0.16, 0.05, 0.05), m.visor, 0, 0.06, 0.19));               // visor
    body.add(mesh(THREE, box(THREE, 0.10, 0.08, 0.10), m.hull, 0, 0.22, -0.02));               // sensor cap
    const arms = [];
    for (const side of [-1, 1]) {
      const a = pivot(THREE, 0.15 * side, -0.04, 0.12);
      a.add(mesh(THREE, box(THREE, 0.05, 0.05, 0.14), m.hullLight, 0, 0, 0.07));
      a.add(mesh(THREE, box(THREE, 0.03, 0.06, 0.08), m.hullDark, -0.02 * side, 0, 0.17));     // pincer jaw
      a.add(mesh(THREE, box(THREE, 0.03, 0.06, 0.08), m.hullDark, 0.03 * side, 0, 0.17));
      body.add(a);
      arms.push(a);
    }
    const carry = mesh(THREE, octa(THREE, 0.07), m.shard, 0, -0.02, 0.22);                      // Shard, out front
    carry.visible = false;
    body.add(carry);
    return { group: g, parts: { body, arms, carry, legs: [], extras: [] } };
  },

  // GRUNT: wedge. A stocky arrowhead with a bright nose plate, dark visor strip and stubby legs; blade arm.
  grunt(THREE, m) {
    const g = new THREE.Group();
    const hip = pivot(THREE, 0, 0.30, 0);
    g.add(hip);
    hip.add(mesh(THREE, wedge(THREE, 0.42, 0.24, 0.64), m.body, 0, 0.14, 0.02));               // arrowhead torso, sharp nose
    hip.add(mesh(THREE, wedge(THREE, 0.20, 0.09, 0.34), m.light, 0, 0.21, 0.20));              // bright nose plate
    hip.add(mesh(THREE, box(THREE, 0.20, 0.03, 0.04), m.hullDark, 0, 0.23, 0.12));             // dark visor strip
    hip.add(mesh(THREE, box(THREE, 0.34, 0.025, 0.03), m.strip, 0, 0.09, 0.16));               // glow strip
    hip.add(mesh(THREE, box(THREE, 0.30, 0.08, 0.10), m.hullDark, 0, 0.14, -0.22));            // engine block
    hip.add(mesh(THREE, box(THREE, 0.10, 0.04, 0.03), m.strip, 0, 0.14, -0.28));               // tail light
    const legs = [];
    for (const side of [-1, 1]) {
      const l = pivot(THREE, 0.12 * side, 0.02, -0.02);
      l.add(mesh(THREE, box(THREE, 0.10, 0.24, 0.12), m.hull, 0, -0.14, 0));
      l.add(mesh(THREE, box(THREE, 0.13, 0.06, 0.18), m.hull, 0, -0.29, 0.03));                // stubby boot (same pot: bakes into the leg)
      hip.add(l);
      legs.push(l);
    }
    const weapon = pivot(THREE, 0.26, 0.12, 0.06);                                              // blade arm
    weapon.add(mesh(THREE, box(THREE, 0.07, 0.08, 0.12), m.accent, 0, 0, 0));
    weapon.add(mesh(THREE, box(THREE, 0.025, 0.07, 0.30), m.hullLight, 0.01, 0, 0.18));
    weapon.add(mesh(THREE, box(THREE, 0.012, 0.025, 0.24), m.strip, 0.025, 0, 0.20));          // glowing edge
    hip.add(weapon);
    const armL = pivot(THREE, -0.26, 0.12, 0.06);                                               // shield pad
    armL.add(mesh(THREE, box(THREE, 0.05, 0.14, 0.18), m.accent, -0.02, 0, 0.02));
    hip.add(armL);
    return { group: g, parts: { body: hip, legs, arms: [armL, weapon], weapon, extras: [] } };
  },

  // LANCER: needle. A slender hull on a tripod with a lance twice its body length.
  lancer(THREE, m) {
    const g = new THREE.Group();
    const hip = pivot(THREE, 0, 0.40, 0);
    g.add(hip);
    hip.add(mesh(THREE, cyl(THREE, 0.07, 0.11, 0.40, 6), m.body, 0, 0.18, 0));                  // slender hull
    hip.add(mesh(THREE, cone(THREE, 0.08, 0.16, 6), m.hullLight, 0, 0.46, 0));                 // crown
    hip.add(mesh(THREE, box(THREE, 0.08, 0.03, 0.04), m.visor, 0, 0.30, 0.09));
    hip.add(mesh(THREE, cyl(THREE, 0.115, 0.115, 0.03, 6), m.strip, 0, 0.06, 0));              // glow collar
    hip.add(mesh(THREE, box(THREE, 0.10, 0.16, 0.06), m.accent, 0, 0.16, -0.11));              // backpack
    const legs = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI;                                                // one leg to the back
      const l = pivot(THREE, Math.sin(a) * 0.08, 0.0, Math.cos(a) * 0.08);
      const seg = mesh(THREE, box(THREE, 0.04, 0.44, 0.04), m.hullLight, Math.sin(a) * 0.08, -0.20, Math.cos(a) * 0.08);  // light step so it lifts off the ground
      seg.rotation.z = -Math.sin(a) * 0.35;
      seg.rotation.x = Math.cos(a) * 0.35;
      l.add(seg);
      hip.add(l);
      legs.push(l);
    }
    const weapon = pivot(THREE, 0.13, 0.22, 0.02);                                              // the lance: 2x body
    weapon.add(flat(mesh(THREE, cyl(THREE, 0.02, 0.03, 0.88, 6), m.hull, 0, 0, 0.26)));
    weapon.add(flat(mesh(THREE, cyl(THREE, 0.012, 0.012, 0.64, 4), m.strip, 0, 0.03, 0.30)));   // glow rail
    weapon.add(flat(mesh(THREE, cone(THREE, 0.03, 0.12, 4), m.hullLight, 0, 0, 0.76)));         // tip
    weapon.add(mesh(THREE, box(THREE, 0.06, 0.10, 0.08), m.accent, 0, -0.05, 0.08));                             // grip
    hip.add(weapon);
    return { group: g, parts: { body: hip, legs, arms: [weapon], weapon, extras: [] } };
  },

  // BRUTE: hex. A wide hex-plated walker with a raised dome and two claws out front.
  brute(THREE, m) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.44, 0);
    g.add(body);
    body.add(mesh(THREE, cyl(THREE, 0.44, 0.40, 0.30, 6), m.body, 0, 0.08, 0));                 // hex hull
    body.add(mesh(THREE, cyl(THREE, 0.36, 0.44, 0.08, 6), m.hullDark, 0, -0.11, 0));            // under plate
    body.add(mesh(THREE, cyl(THREE, 0.46, 0.46, 0.03, 6), m.strip, 0, 0.12, 0));               // glow seam round the hex
    body.add(squash(mesh(THREE, sph(THREE, 0.22, 10), m.hull, 0, 0.26, -0.04), 0.7));          // raised dome
    body.add(mesh(THREE, box(THREE, 0.18, 0.04, 0.03), m.visor, 0, 0.30, 0.17));
    body.add(mesh(THREE, cyl(THREE, 0.05, 0.05, 0.20, 6), m.hullLight, -0.20, 0.34, -0.22));    // stacks
    body.add(mesh(THREE, cyl(THREE, 0.05, 0.05, 0.20, 6), m.hullLight, 0.20, 0.34, -0.22));
    // six legs in two alternating tripods (legs 0,2,4 and 1,3,5), each tripod one pivot so it bakes to 2 meshes
    const legs = [pivot(THREE, 0, -0.08, 0), pivot(THREE, 0, -0.08, 0)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const l = legs[i % 2];
      const sx = Math.sin(a), cz = Math.cos(a);
      const seg = mesh(THREE, box(THREE, 0.10, 0.30, 0.10), m.accent, sx * 0.36, -0.14, cz * 0.36);
      seg.rotation.z = -sx * 0.3;
      seg.rotation.x = cz * 0.3;
      l.add(seg);
      l.add(mesh(THREE, box(THREE, 0.12, 0.05, 0.12), m.hullDark, sx * 0.40, -0.31, cz * 0.40));
    }
    body.add(legs[0], legs[1]);
    const arms = [];
    for (const side of [-1, 1]) {
      const a = pivot(THREE, 0.24 * side, 0.02, 0.28);                                           // claws out front
      a.add(mesh(THREE, box(THREE, 0.10, 0.10, 0.18), m.accent, 0, 0, 0.06));
      a.add(mesh(THREE, box(THREE, 0.04, 0.08, 0.14), m.hullLight, -0.05 * side, 0, 0.21));
      a.add(mesh(THREE, box(THREE, 0.04, 0.08, 0.14), m.hullLight, 0.06 * side, 0, 0.21));
      body.add(a);
      arms.push(a);
    }
    return { group: g, parts: { body, legs, arms, weapon: arms[1], extras: [] } };
  },

  // ---- v3 roster ----
  // SPIKER: a tall thin spike on a small base, pointing up (anti-air).
  spiker(THREE, m) {
    const g = new THREE.Group();
    const hip = pivot(THREE, 0, 0.26, 0);
    g.add(hip);
    hip.add(mesh(THREE, box(THREE, 0.30, 0.16, 0.30), m.body, 0, 0.08, 0));                     // small base
    hip.add(mesh(THREE, box(THREE, 0.32, 0.025, 0.03), m.strip, 0, 0.02, 0.15));
    hip.add(mesh(THREE, box(THREE, 0.10, 0.03, 0.03), m.visor, 0, 0.12, 0.15));
    const legs = [];
    for (const side of [-1, 1]) {
      const l = pivot(THREE, 0.10 * side, 0.02, 0);
      l.add(mesh(THREE, box(THREE, 0.08, 0.22, 0.10), m.hull, 0, -0.13, 0));
      l.add(mesh(THREE, box(THREE, 0.10, 0.05, 0.14), m.hull, 0, -0.26, 0.02));
      hip.add(l);
      legs.push(l);
    }
    const weapon = pivot(THREE, 0, 0.16, 0);                                                     // the spike
    weapon.add(mesh(THREE, cyl(THREE, 0.03, 0.06, 0.56, 6), m.hull, 0, 0.28, 0));
    weapon.add(mesh(THREE, cone(THREE, 0.045, 0.30, 6), m.hullLight, 0, 0.70, 0));
    weapon.add(mesh(THREE, cyl(THREE, 0.035, 0.035, 0.40, 4), m.strip, 0, 0.30, 0));
    hip.add(weapon);
    return { group: g, parts: { body: hip, legs, arms: [], weapon, extras: [] } };
  },

  // HOWLER: a wide low base with one long barrel (siege).
  howler(THREE, m) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.18, 0);
    g.add(body);
    body.add(mesh(THREE, box(THREE, 0.76, 0.18, 0.60), m.body, 0, 0.04, 0));                    // wide low base
    for (const side of [-1, 1]) {
      body.add(mesh(THREE, box(THREE, 0.12, 0.20, 0.66), m.hullDark, 0.40 * side, -0.04, 0));  // tracks
      body.add(mesh(THREE, box(THREE, 0.015, 0.03, 0.50), m.strip, 0.465 * side, 0.04, 0));
    }
    const weapon = pivot(THREE, 0, 0.16, -0.12);                                                 // one long barrel
    weapon.add(mesh(THREE, box(THREE, 0.26, 0.12, 0.24), m.accent, 0, 0, 0));
    const barrel = mesh(THREE, cyl(THREE, 0.05, 0.065, 0.90, 8), m.hull, 0, 0.14, 0.28);     // forward and up
    barrel.rotation.x = Math.PI / 2 - 0.42;
    weapon.add(barrel);
    const muzzle = mesh(THREE, tor(THREE, 0.06, 0.015, 8), m.strip, 0, 0.32, 0.69);
    muzzle.rotation.x = Math.PI / 2 - 0.42;
    weapon.add(muzzle);
    body.add(weapon);
    return { group: g, parts: { body, weapon, legs: [], arms: [], extras: [] } };
  },

  // DART: the smallest unit, a tiny arrowhead.
  dart(THREE, m) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.12, 0);
    g.add(body);
    body.add(mesh(THREE, wedge(THREE, 0.30, 0.11, 0.44), m.body, 0, 0.0, 0.04));                 // arrowhead
    body.add(mesh(THREE, box(THREE, 0.22, 0.02, 0.04), m.strip, 0, 0.055, -0.08));              // bright strip across the back
    body.add(mesh(THREE, box(THREE, 0.02, 0.02, 0.30), m.strip, 0, 0.055, 0.04));               // and a spine, so it reads at TV distance
    body.add(mesh(THREE, box(THREE, 0.06, 0.03, 0.03), m.visor, 0, 0.04, 0.10));
    body.add(mesh(THREE, box(THREE, 0.08, 0.04, 0.06), m.hullDark, 0, -0.03, -0.14));            // engine
    body.add(mesh(THREE, box(THREE, 0.06, 0.03, 0.02), m.strip, 0, -0.03, -0.175));              // engine glow (vfx draws the trail)
    return { group: g, parts: { body, legs: [], arms: [], extras: [] } };
  },

  // SKIFF: an open V with wings (air fighter).
  skiff(THREE, m) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0, 0);
    g.add(body);
    body.add(mesh(THREE, wedge(THREE, 0.26, 0.10, 0.44), m.body, 0, 0.02, 0.06));                 // solid hull between the wings
    body.add(mesh(THREE, box(THREE, 0.10, 0.08, 0.26), m.hull, 0, 0.06, -0.06));                   // spine
    body.add(mesh(THREE, box(THREE, 0.07, 0.03, 0.03), m.visor, 0, 0.08, 0.14));
    const extras = [];
    for (const side of [-1, 1]) {
      const wing = mesh(THREE, box(THREE, 0.36, 0.03, 0.14), m.body, 0.20 * side, 0, -0.08);      // open V
      wing.rotation.y = -0.6 * side;
      body.add(wing);
      const strip = mesh(THREE, box(THREE, 0.30, 0.015, 0.03), m.strip, 0.20 * side, 0.02, -0.02);
      strip.rotation.y = -0.6 * side;
      body.add(strip);
      const jet = mesh(THREE, cyl(THREE, 0.03, 0.03, 0.04, 6), m.strip, 0.34 * side, 0, -0.24);
      jet.rotation.x = Math.PI / 2;
      body.add(jet);
      extras.push(jet);
    }
    return { group: g, parts: { body, legs: [], arms: [], extras } };
  },

  // BARGE: a flat wide air barge, rectangle with rounded ends, cargo pips on top.
  barge(THREE, m) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0, 0);
    g.add(body);
    body.add(mesh(THREE, box(THREE, 0.50, 0.12, 0.60), m.body, 0, 0, 0));                         // flat deck
    body.add(mesh(THREE, cyl(THREE, 0.25, 0.25, 0.12, 12), m.body, 0, 0, 0.30));                 // rounded ends
    body.add(mesh(THREE, cyl(THREE, 0.25, 0.25, 0.12, 12), m.body, 0, 0, -0.30));
    body.add(mesh(THREE, box(THREE, 0.52, 0.02, 0.03), m.strip, 0, -0.05, 0.42));
    body.add(mesh(THREE, box(THREE, 0.52, 0.02, 0.03), m.strip, 0, -0.05, -0.42));
    body.add(mesh(THREE, box(THREE, 0.14, 0.06, 0.08), m.hull, 0, 0.09, 0.40));                   // bridge
    body.add(mesh(THREE, box(THREE, 0.10, 0.02, 0.02), m.visor, 0, 0.10, 0.44));
    for (let i = 0; i < 8; i++) {
      const px = -0.14 + (i % 4) * 0.093;
      const pz = i < 4 ? 0.10 : -0.10;
      body.add(mesh(THREE, box(THREE, 0.05, 0.03, 0.05), m.hullLight, px, 0.075, pz));           // cargo pips
    }
    const extras = [];
    for (const side of [-1, 1]) {
      const fan = pivot(THREE, 0.32 * side, 0.0, 0);
      fan.add(flat(mesh(THREE, tor(THREE, 0.08, 0.015, 10), m.hullDark, 0, 0, 0)));
      const blade = mesh(THREE, box(THREE, 0.14, 0.008, 0.03), m.hullLight, 0, 0, 0);
      fan.add(blade);
      body.add(fan);
      extras.push(blade);
    }
    return { group: g, parts: { body, legs: [], arms: [], extras } };
  },

  // SEER: a small air lantern, a circle with a halo, the only unit whose glow is Shard teal (it reveals things).
  seer(THREE, m) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0, 0);
    g.add(body);
    body.add(mesh(THREE, sph(THREE, 0.11, 10), m.hull, 0, 0, 0));
    body.add(mesh(THREE, sph(THREE, 0.07, 8), m.shard, 0, 0, 0.07));                              // teal lantern
    const halo = pivot(THREE, 0, 0, 0);
    halo.add(flat(mesh(THREE, tor(THREE, 0.20, 0.018, 14), m.shard, 0, 0, 0)));
    body.add(halo);
    body.add(mesh(THREE, tor(THREE, 0.14, 0.012, 10), m.strip, 0, 0, 0));                        // team ring
    return { group: g, parts: { body, legs: [], arms: [], extras: [halo] } };
  },

  // MENDER: a round body like the Worker with a bright ring around it and no pincers.
  mender(THREE, m) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.26, 0);
    g.add(body);
    body.add(mesh(THREE, sph(THREE, 0.20, 10), m.body, 0, 0.02, 0));
    body.add(mesh(THREE, cyl(THREE, 0.15, 0.20, 0.08, 10), m.hullDark, 0, -0.15, 0));
    body.add(mesh(THREE, box(THREE, 0.14, 0.04, 0.05), m.visor, 0, 0.06, 0.18));
    const ring = pivot(THREE, 0, 0.06, 0);
    ring.add(flat(mesh(THREE, tor(THREE, 0.30, 0.03, 16), m.strip, 0, 0, 0)));                  // the bright ring
    body.add(ring);
    body.add(mesh(THREE, octa(THREE, 0.06), m.light, 0, 0.30, 0));
    return { group: g, parts: { body, legs: [], arms: [], extras: [ring] } };
  },

  // SHADE: a thin crescent at half opacity (stealth).
  shade(THREE, m) {
    const g = new THREE.Group();
    const hip = pivot(THREE, 0, 0.36, 0);
    g.add(hip);
    const crescent = mesh(THREE, tor(THREE, 0.22, 0.045, 16), m.ghost, 0, 0.22, 0);              // thin crescent
    crescent.geometry = geo(THREE, 'crescent', () => new THREE.TorusGeometry(0.22, 0.045, 6, 16, Math.PI * 1.1));
    crescent.rotation.z = Math.PI * 0.95;
    hip.add(crescent);
    const edge = mesh(THREE, geo(THREE, 'crescent-edge', () => new THREE.TorusGeometry(0.235, 0.012, 4, 16, Math.PI * 1.1)), m.strip, 0, 0.22, 0.02);
    edge.rotation.z = Math.PI * 0.95;                                                             // full-opacity edge so it keeps a shape
    hip.add(edge);
    hip.add(mesh(THREE, box(THREE, 0.06, 0.03, 0.03), m.visor, 0, 0.44, 0.03));
    hip.add(mesh(THREE, box(THREE, 0.025, 0.14, 0.02), m.strip, 0, 0.10, 0.02));                  // thin glow line
    const legs = [];
    for (const side of [-1, 1]) {
      const l = pivot(THREE, 0.06 * side, 0.0, 0);
      l.add(mesh(THREE, box(THREE, 0.04, 0.36, 0.05), m.ghost, 0, -0.18, 0));
      hip.add(l);
      legs.push(l);
    }
    const weapon = pivot(THREE, 0.12, 0.16, 0.04);
    weapon.add(mesh(THREE, box(THREE, 0.02, 0.05, 0.30), m.ghost, 0, 0, 0.14));
    hip.add(weapon);
    return { group: g, parts: { body: hip, legs, arms: [weapon], weapon, extras: [] } };
  },

  // CONDUIT: a tall forked staff (trident) on a small body (caster).
  conduit(THREE, m) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.22, 0);
    g.add(body);
    body.add(mesh(THREE, cone(THREE, 0.20, 0.40, 6), m.body, 0, 0.14, 0));                        // small robed body
    body.add(mesh(THREE, sph(THREE, 0.09, 8), m.hull, 0, 0.40, 0));
    body.add(mesh(THREE, box(THREE, 0.08, 0.025, 0.03), m.visor, 0, 0.41, 0.08));
    body.add(flat(mesh(THREE, tor(THREE, 0.20, 0.018, 12), m.strip, 0, -0.04, 0)));
    const weapon = pivot(THREE, 0.18, 0.0, 0.04);                                                 // the trident
    weapon.add(mesh(THREE, cyl(THREE, 0.018, 0.018, 1.10, 6), m.hull, 0, 0.55, 0));
    weapon.add(mesh(THREE, box(THREE, 0.22, 0.03, 0.03), m.hullLight, 0, 1.00, 0));               // fork bar
    for (const dx of [-0.10, 0, 0.10]) {
      weapon.add(mesh(THREE, cone(THREE, 0.02, 0.18, 4), m.hullLight, dx, 1.10, 0));
      weapon.add(mesh(THREE, cyl(THREE, 0.012, 0.012, 0.10, 4), m.strip, dx, 1.02, 0));
    }
    body.add(weapon);
    const extras = [];
    for (let i = 0; i < 2; i++) {
      const orbit = pivot(THREE, 0, 0.30, 0);
      orbit.rotation.y = i * Math.PI;
      orbit.add(mesh(THREE, octa(THREE, 0.035), m.strip, 0.26, 0, 0));
      body.add(orbit);
      extras.push(orbit);
    }
    return { group: g, parts: { body, weapon, legs: [], arms: [], extras } };
  },
};

// An unknown kind (a roster entry that landed before its model) gets a capsule with a team ring, never nothing.
function buildFallback(THREE, m) {
  const g = new THREE.Group();
  const body = pivot(THREE, 0, 0.26, 0);
  g.add(body);
  body.add(mesh(THREE, cyl(THREE, 0.16, 0.20, 0.36, 8), m.body, 0, 0.04, 0));
  body.add(mesh(THREE, sph(THREE, 0.16, 8), m.hull, 0, 0.26, 0));
  body.add(mesh(THREE, box(THREE, 0.10, 0.03, 0.03), m.visor, 0, 0.28, 0.14));
  body.add(flat(mesh(THREE, tor(THREE, 0.22, 0.025, 10), m.strip, 0, -0.12, 0)));
  return { group: g, parts: { body, legs: [], arms: [], extras: [] } };
}

// Bake: inside every pivot, merge the plain child meshes that share a material into one mesh, so a unit costs a
// handful of draw calls instead of fifteen. Pivots (legs, arms, weapon, head, extras) keep their own merged meshes
// and still animate. Meshes that are toggled (the Worker's Shard) or start hidden are left alone.
// Returns the merged geometries so the owner can dispose them.
export function bakeModel(THREE, group, keep = new Set()) {
  const owned = [];
  const groups = [];
  group.traverse((o) => { if (o.isGroup || o === group) groups.push(o); });
  for (const g of groups) {
    const byMat = new Map();
    for (const c of [...g.children]) {
      if (!c.isMesh || c.children.length || !c.visible || keep.has(c)) continue;
      c.updateMatrix();
      const geoCopy = c.geometry.clone().applyMatrix4(c.matrix);
      if (!byMat.has(c.material)) byMat.set(c.material, []);
      byMat.get(c.material).push(geoCopy);
      g.remove(c);
    }
    for (const [mat, geos] of byMat) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) for (const ge of geos) ge.dispose();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      g.add(mesh);
      owned.push(merged);
    }
  }
  return owned;
}

// Build a model for `kind` (aliases resolved). Returns { group, parts, spec, materials, kind, geometries }.
export function buildUnitModel(THREE, kind, owner, palette, materials, { bake = true } = {}) {
  const k = resolveKind(kind);
  const m = materials ?? makeTeamMaterials(THREE, palette, owner === 1 ? 1 : 0);
  const spec = UNIT_SPECS[k] ?? { rig: 'hover', size: 0.5, height: 0.8, stride: 1.2, shape: 'unknown', provisional: true };
  const builder = BUILDERS[k];
  const r = builder ? builder(THREE, m) : buildFallback(THREE, m);
  r.geometries = bake ? bakeModel(THREE, r.group, new Set(r.parts.carry ? [r.parts.carry] : [])) : [];
  r.parts.strips = [];
  r.group.traverse((o) => { if (o.isMesh && o.material === m.strip) r.parts.strips.push(o); });
  r.spec = spec;
  r.materials = m;
  r.kind = k;
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Health bars (two planes, billboarded, green / yellow / red, hidden at full health)
// ---------------------------------------------------------------------------------------------------------------
function makeHealthBar(THREE, width) {
  const g = new THREE.Group();
  const plane = geo(THREE, 'bar:plane', () => new THREE.PlaneGeometry(1, 1));
  const bg = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.6, depthWrite: false, depthTest: false }));
  bg.scale.set(width, width * 0.14, 1);
  const fill = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: HEALTH.good, transparent: true, opacity: 1, depthWrite: false, depthTest: false }));
  fill.position.z = 0.002;
  g.add(bg, fill);
  bg.renderOrder = 1000;
  fill.renderOrder = 1001;
  g.visible = false;
  return { group: g, bg, fill, width, level: null };
}

function setHealthBar(bar, state, colors) {
  const { ratio, opacity, visible, level } = state;
  bar.group.visible = visible;
  if (!visible) return;
  const w = bar.width * 0.94;
  bar.fill.scale.set(Math.max(0.001, w * ratio), bar.width * 0.10, 1);
  bar.fill.position.x = -w / 2 + (w * ratio) / 2;
  if (bar.level !== level) { bar.level = level; bar.fill.material.color.set(colors[level] ?? HEALTH[level]); }
  bar.fill.material.opacity = opacity;
  bar.bg.material.opacity = 0.6 * opacity;
}

// ---------------------------------------------------------------------------------------------------------------
// Rig animation. pose = idle | walk | attack | mine, phase 0..1 inside the tick, walkPhase in radians, t seconds.
// ---------------------------------------------------------------------------------------------------------------
const easeOutBack = (x) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
const strike = (x) => (x < 0.3 ? x / 0.3 : Math.max(0, 1 - (x - 0.3) / 0.5));   // quick lunge, slower recovery

function animate(v, pose, phase, walkPhase, t, dt) {
  const p = v.parts;
  const rig = v.spec.rig;
  const body = p.body;
  const base = v.baseY;
  const sw = Math.sin(walkPhase);
  const cw = Math.cos(walkPhase);
  const targetWalk = pose === 'walk' ? 1 : 0;
  v.walkAmount += (targetWalk - v.walkAmount) * Math.min(1, dt * 10);
  const walk = v.walkAmount;
  const attack = pose === 'attack' ? strike(phase) : 0;
  const breathe = Math.sin(t * 2.2 + v.id);

  if (rig === 'biped') {
    for (let i = 0; i < p.legs.length; i++) p.legs[i].rotation.x = (i === 0 ? sw : -sw) * 0.8 * walk;
    body.position.y = base + Math.abs(cw) * 0.05 * walk + breathe * 0.006;
    body.rotation.x = 0.10 * walk - attack * 0.15;
    body.rotation.z = sw * 0.04 * walk;
    if (p.arms?.[0]) p.arms[0].rotation.x = -sw * 0.4 * walk;
    if (p.weapon) {
      if (v.kind === 'spiker') { p.weapon.rotation.x = -attack * 0.35; p.weapon.position.y = 0.16 - attack * 0.05; }
      else if (v.kind === 'shade') { p.weapon.rotation.y = -attack * 1.6; p.weapon.rotation.x = sw * 0.3 * walk; }
      else { p.weapon.rotation.x = sw * 0.4 * walk - attack * 1.9; p.weapon.rotation.y = -attack * 0.5; }   // blade slash
    }
  } else if (rig === 'tripod') {
    body.position.y = base + Math.abs(cw) * 0.03 * walk + breathe * 0.005;
    body.rotation.z = sw * 0.08 * walk;                                                           // the Lancer sways
    body.rotation.x = 0.05 * walk;
    for (let i = 0; i < p.legs.length; i++) p.legs[i].rotation.x = Math.sin(walkPhase + (i * Math.PI * 2) / 3) * 0.35 * walk;
    if (p.weapon) {
      p.weapon.rotation.x = -0.08 + attack * 0.22;                                                 // recoil
      p.weapon.position.z = 0.02 - attack * 0.10;
    }
  } else if (rig === 'hex') {
    // Brute feet lift in sequence: two alternating tripods (one pivot each)
    const s = Math.sin(walkPhase);
    for (let i = 0; i < p.legs.length; i++) {
      const tri = i % 2 === 0 ? 1 : -1;
      const lift = Math.max(0, s * tri);
      p.legs[i].position.y = -0.08 + lift * 0.09 * walk;
      p.legs[i].rotation.y = s * tri * 0.05 * walk;
    }
    body.position.y = base + Math.abs(Math.sin(walkPhase * 2)) * 0.04 * walk + breathe * 0.004;
    body.rotation.z = s * 0.04 * walk;
    body.rotation.x = -attack * 0.10 + 0.03 * walk;
    for (let i = 0; i < p.arms.length; i++) {
      const a = p.arms[i];
      a.rotation.y = (i === 0 ? 1 : -1) * (0.15 - attack * 0.45);                                   // claws clamp
      a.position.z = 0.28 + attack * 0.10;
    }
  } else if (rig === 'hover') {
    body.position.y = base + 0.04 + Math.sin(t * 3.0 + v.id * 1.7) * 0.025 + walk * 0.02;
    body.rotation.x = 0.22 * walk;
    body.rotation.z = Math.sin(t * 2.0 + v.id) * 0.03;
    const mine = pose === 'mine' ? 1 : 0;
    v.mineAmount += (mine - v.mineAmount) * Math.min(1, dt * 8);
    for (let i = 0; i < p.arms.length; i++) {
      const clamp = Math.max(0, Math.sin(t * 9 + i * Math.PI)) * v.mineAmount;                     // pincers clamp
      p.arms[i].rotation.y = (i === 0 ? 1 : -1) * (0.3 - 0.5 * clamp - attack * 0.5);
      p.arms[i].rotation.x = -0.2 * v.mineAmount - attack * 0.6 + walk * 0.1;
    }
    for (const e of p.extras) e.rotation.y = t * 1.5;
  } else if (rig === 'tracked') {
    body.position.y = base + breathe * 0.003;
    body.rotation.x = 0.04 * walk - attack * 0.12;
    if (p.weapon) { p.weapon.rotation.x = -attack * 0.30; p.weapon.position.z = -0.12 - attack * 0.08; }
  } else if (rig === 'skim') {
    body.position.y = base + 0.03 + Math.sin(t * 6 + v.id) * 0.012 + walk * 0.03;
    body.rotation.x = 0.16 * walk - attack * 0.3;
    body.rotation.z = Math.sin(t * 4.0 + v.id) * 0.08 * walk - v.turnRate * 0.05;
    body.position.z = attack * 0.12;
  } else if (rig === 'air') {
    const alt = (v.spec.altitude ?? 1.5);
    body.position.y = alt + Math.sin(t * 1.7 + v.id * 0.9) * 0.05;
    body.rotation.x = 0.14 * walk - attack * 0.2;
    body.rotation.z = Math.sin(t * 1.1 + v.id) * 0.04 - v.turnRate * 0.08;
    for (const e of p.extras) e.rotation.y = v.kind === 'barge' ? t * 30 : t * 2.2;
  } else if (rig === 'float') {
    body.position.y = base + 0.06 + Math.sin(t * 1.5 + v.id) * 0.03;
    body.rotation.x = 0.08 * walk;
    if (p.weapon) { p.weapon.rotation.x = -attack * 0.6; p.weapon.rotation.z = attack * 0.3; }
    for (let i = 0; i < p.extras.length; i++) p.extras[i].rotation.y = t * (1.2 + attack * 8) + (i / p.extras.length) * Math.PI * 2;
  }

  // glow strips breathe in step with the palette's shared strips, and flare on attack
  const breath = 0.8 + 0.2 * Math.sin(t * 2.6 + v.id * 0.7);
  v.materials.strip.emissiveIntensity = v.stripLevel * (breath + attack * 1.2);
}

// ---------------------------------------------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------------------------------------------
export function createUnits(ctx, opts = {}) {
  const THREE = ctx.THREE;
  const scene = ctx.scene;
  const tileSize = ctx.tileSize ?? 1;
  const palette = ctx.palette ?? null;
  const stats = opts.stats ?? ctx.stats ?? ctx.log?.stats ?? null;
  const useAssetModels = opts.useAssetModels ?? ctx.useAssetModels ?? false;
  const unitScale = (opts.scale ?? ctx.unitScale ?? UNIT_SCALE) * (ctx.tileSize ?? 1);   // world units per model unit
  const healthColors = palette?.health ?? HEALTH;
  const root = new THREE.Group();
  root.name = 'units';
  scene.add(root);

  const teamMats = [makeTeamMaterials(THREE, palette, 0), makeTeamMaterials(THREE, palette, 1)];
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false });
  const views = new Map();        // id -> view
  const lastKnown = new Map();    // id -> last record seen (dying units keep a tile; attack targets keep a spot)
  let time = 0;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();

  function worldOf(x, y, out) {
    const w = ctx.gridToWorld(x, y, 0, out);
    if (w !== out) out.set(w.x, w.y ?? 0, w.z);
    return out;
  }

  function tryAsset(kind, owner) {
    if (!useAssetModels) return null;
    const get = ctx.assets?.models?.get;
    if (typeof get !== 'function') return null;
    try {
      const obj = get.call(ctx.assets.models, kind, { owner, category: 'unit', unique: true });
      if (!obj || !obj.isObject3D) return null;
      obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      return obj;
    } catch { return null; }
  }

  function makeView(u) {
    const owner = u.owner === 1 ? 1 : 0;
    const shared = teamMats[owner];
    const mats = { ...shared, strip: shared.strip.clone() };
    const kind = resolveKind(u.kind);
    let model;
    const asset = tryAsset(kind, owner);
    if (asset) {
      const g = new THREE.Group();
      g.add(asset);
      const spec = UNIT_SPECS[kind] ?? { rig: 'hover', size: 0.5, height: 0.8 };
      const ring = mesh(THREE, tor(THREE, spec.size * 0.55, 0.02, 12), mats.strip, 0, 0.02, 0);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      model = { group: g, parts: { body: asset, legs: [], arms: [], extras: [], strips: [ring] }, spec, materials: mats, kind, geometries: [] };
    } else {
      model = buildUnitModel(THREE, kind, owner, palette, mats);
    }
    model.group.scale.setScalar(unitScale);
    const holder = new THREE.Group();
    holder.add(model.group);
    if (model.spec.altitude) {
      // air reads as air: a soft ground shadow offset down-right (ART-GUIDE rule), separate from the sun shadow
      const disc = new THREE.Mesh(geo(THREE, 'air:shadow', () => new THREE.CircleGeometry(0.5, 14)), shadowMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(0.18 * tileSize, 0.015, 0.18 * tileSize);
      disc.scale.setScalar(model.spec.size * 0.8 * unitScale);
      holder.add(disc);
    }
    const bar = makeHealthBar(THREE, (model.spec.bar ?? Math.max(0.42, Math.min(0.7, model.spec.size * 0.9))) * unitScale);
    bar.group.position.y = (model.spec.height + (model.spec.altitude ?? 0) + 0.18) * unitScale;
    holder.add(bar.group);
    root.add(holder);
    const meshes = [];
    model.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const v = {
      id: u.id, kind, owner, holder, model: model.group, parts: model.parts, spec: model.spec, materials: mats, meshes, geometries: model.geometries,
      bar, baseY: model.parts.body?.position.y ?? 0,
      yaw: owner === 0 ? Math.PI * 0.75 : -Math.PI * 0.25, turnRate: 0,    // side 0 looks down-right, side 1 up-left
      walkAmount: 0, mineAmount: 0, lastMoveTick: -Infinity, lastHitTick: null, lastHitAt: -Infinity, hitFlash: 0, flashing: false,
      spawnAt: time, dying: false, deathAt: 0, dead: false,
      maxHp: maxHpOf(kind, stats) || u.hp,
      stripLevel: mats.stripLevel,
    };
    views.set(u.id, v);
    return v;
  }

  // whole-piece white flash: swap every mesh to the hit material, remember its own
  function setFlash(v, on) {
    if (v.flashing === on) return;
    v.flashing = on;
    for (const o of v.meshes) {
      if (on) { o.userData.ownMat = o.material; o.material = v.materials.hit; }
      else if (o.userData.ownMat) { o.material = o.userData.ownMat; o.userData.ownMat = null; }
    }
  }

  function startDeath(v) {
    if (v.dying) return;
    setFlash(v, false);
    v.dying = true;
    v.dead = false;
    v.deathAt = time;
    v.bar.group.visible = false;
    for (const o of v.meshes) {
      o.userData.baseOpacity = o.material.transparent ? o.material.opacity : 1;
      o.userData.isStrip = o.material === v.materials.strip;
      const m = o.material.clone();
      m.transparent = true;
      o.userData.deathMat = m;
      o.material = m;
    }
  }

  function animateDeath(v, spawnScale) {
    const d = Math.min(1, (time - v.deathAt) / DEATH_SECONDS);
    const air = v.spec.rig === 'air';
    v.model.rotation.x = d * (air ? 0.9 : 1.3);
    v.model.rotation.z = d * 0.5;                                                                // slight spin
    v.model.position.y = (air ? -d * d * (v.spec.altitude ?? 1.5) : -d * 0.3) * unitScale;
    const op = 1 - Math.max(0, d - 0.35) / 0.65;                                                  // fade
    for (const o of v.meshes) {
      o.material.opacity = o.userData.baseOpacity * op;
      if (o.userData.isStrip) o.material.emissiveIntensity = v.stripLevel * (1 - d) * 2.5;         // strip flares then dies
    }
    v.model.scale.setScalar(unitScale * spawnScale * (1 - d * 0.3));                              // shrink
    if (d >= 1) v.dead = true;
  }

  function revive(v) {                       // the viewer scrubbed back before this unit's death: rebuild it
    const u = lastKnown.get(v.id);
    const yaw = v.yaw;
    removeView(v);
    if (!u) return null;
    const nv = makeView(u);
    nv.spawnAt = -Infinity;
    nv.yaw = yaw;
    return nv;
  }

  function removeView(v) {
    root.remove(v.holder);
    for (const o of v.meshes) if (o.userData.deathMat) { o.userData.deathMat.dispose(); o.userData.deathMat = null; }
    for (const g of v.geometries) g.dispose();
    v.materials.strip.dispose();
    v.bar.bg.material.dispose();
    v.bar.fill.material.dispose();
    views.delete(v.id);
  }

  function findEntity(state, id) {
    if (!state) return null;
    return state.units.find((u) => u.id === id) ?? state.structures.find((s) => s.id === id) ?? null;
  }

  function update(frame, dt) {
    dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0.016));
    time += dt;
    if (!frame) return;
    const prev = frame.prev ?? frame.next;
    const next = frame.next ?? frame.prev;
    if (!prev && !next) return;
    const alpha = Math.max(0, Math.min(1, frame.alpha ?? 0));
    const tick = frame.tick ?? prev?.tick ?? 0;
    const ev = normalizeEvents(frame.events);
    const hitsBy = new Map();
    const hitsOn = new Map();
    for (const h of ev.hits) {
      if (!hitsBy.has(h.by)) hitsBy.set(h.by, h);
      hitsOn.set(h.id, h);
    }
    const prevById = new Map();
    const nextById = new Map();
    for (const u of prev?.units ?? []) prevById.set(u.id, u);
    for (const u of next?.units ?? []) nextById.set(u.id, u);
    const seen = new Set();

    const handle = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const pu = prevById.get(id);
      const nu = nextById.get(id);
      const u = nu ?? pu;
      let v = views.get(id);
      if (!v) {
        if (!nu) return;                       // only in prev and unknown to us: scrubbed past it, nothing to show
        v = makeView(u);
        if (pu) v.spawnAt = -Infinity;         // already alive before: no spawn pop
      } else if (v.kind !== resolveKind(u.kind) || v.owner !== (u.owner === 1 ? 1 : 0)) {
        removeView(v);                         // ids are never reused by the sim, but a new log might
        v = makeView(u);
      }
      lastKnown.set(id, u);
      const pose = choosePose({ id, prev: pu, next: nu, hits: ev.hits, deaths: ev.deaths, mines: ev.mines, lastMoveTick: v.lastMoveTick, tick, graceTicks: v.spec.heavy ? 2 : 1 });
      if (pu && nu && (pu.x !== nu.x || pu.y !== nu.y)) v.lastMoveTick = tick;
      if (pose === 'die') startDeath(v);
      else if (v.dying) { v = revive(v); if (!v) return; }

      // position: lerp between tiles (a dying unit stays on its last tile)
      const a = pu ?? nu;
      const b = nu ?? pu;
      worldOf(a.x, a.y, tmpA);
      worldOf(b.x, b.y, tmpB);
      v.holder.position.lerpVectors(tmpA, tmpB, pose === 'die' ? 0 : alpha);

      // facing: movement direction, else the attack target, else keep heading
      let targetYaw = null;
      if (pu && nu && (pu.x !== nu.x || pu.y !== nu.y)) targetYaw = yawBetween(tmpA, tmpB);
      if (targetYaw === null) {
        const hit = hitsBy.get(id);
        const tid = hit ? hit.id : (u.order?.type === 'attack' ? u.order.target : null);
        const target = tid !== null && tid !== undefined ? findEntity(next, tid) ?? findEntity(prev, tid) ?? lastKnown.get(tid) : null;
        if (target) targetYaw = yawBetween(v.holder.position, worldOf(target.x, target.y, tmpC));
      }
      if (targetYaw !== null) {
        const before = v.yaw;
        v.yaw = turnToward(v.yaw, targetYaw, 9, dt);
        v.turnRate = dt > 0 ? (v.yaw - before) / dt : 0;
      } else v.turnRate *= 0.8;
      v.model.rotation.y = v.yaw;

      // hit on this unit: whole piece flashes white, then the health bar shows
      const hit = hitsOn.get(id);
      if (hit && v.lastHitTick !== tick) { v.lastHitTick = tick; v.lastHitAt = time; v.hitFlash = 1; }
      v.hitFlash = Math.max(0, v.hitFlash - dt / HIT_FLASH_SECONDS);
      if (!v.dying) setFlash(v, v.hitFlash > 0);
      const flash = v.hitFlash;
      if (flash > 0) v.model.position.set(Math.sin(time * 97 + v.id) * 0.02 * flash * tileSize, 0, Math.cos(time * 83 + v.id) * 0.02 * flash * tileSize);
      else if (!v.dying) v.model.position.set(0, 0, 0);

      // Worker cargo: the Shard out front, sized by the load
      if (v.parts.carry) {
        const c = u.carrying ?? 0;
        v.parts.carry.visible = c > 0;
        if (c > 0) { v.parts.carry.scale.setScalar(0.6 + 0.4 * Math.min(1, c / 10)); v.parts.carry.rotation.y = time * 2; }
      }

      // animation: heavy walkers take one stride per move tick, the rest cycle with distance walked
      const walkPhase = v.spec.heavy ? alpha * Math.PI : (tick + alpha) * Math.PI * (v.spec.stride ?? 1.2);
      animate(v, pose, alpha, walkPhase, time, dt);

      // spawn pop
      const since = time - v.spawnAt;
      const spawnScale = since < SPAWN_SECONDS ? Math.max(0.01, easeOutBack(since / SPAWN_SECONDS)) : 1;

      if (v.dying) {
        animateDeath(v, spawnScale);
      } else {
        v.model.rotation.x = 0;
        v.model.rotation.z = 0;
        v.model.scale.setScalar(unitScale * spawnScale);
        if (u.hp > v.maxHp) v.maxHp = u.hp;
        const hb = healthBarState({ hp: u.hp, maxHp: v.maxHp, sinceHit: time - v.lastHitAt, thresholds: healthColors });
        setHealthBar(v.bar, hb, healthColors);
        if (hb.visible && ctx.camera) v.bar.group.quaternion.copy(ctx.camera.quaternion);
      }
    };

    for (const u of next?.units ?? []) handle(u.id);
    for (const u of prev?.units ?? []) handle(u.id);

    // units in neither state: a dying unit finishes its animation (playback usually passes several ticks in under
    // a second); anything else was scrubbed away and goes at once
    for (const v of [...views.values()]) {
      if (v.dead) { removeView(v); continue; }
      if (seen.has(v.id)) continue;
      if (!v.dying) { removeView(v); continue; }
      animateDeath(v, 1);
      if (v.dead) removeView(v);
    }
  }

  function dispose() {
    for (const v of [...views.values()]) removeView(v);
    scene.remove(root);
    shadowMat.dispose();
    for (const tm of teamMats) for (const m of tm.own) m.dispose();
  }

  // positionOf(id) -> THREE.Vector3 of the unit's current world position (for vfx / camera), or null.
  function positionOf(id) {
    const v = views.get(id);
    return v ? v.holder.position.clone() : null;
  }

  return {
    update, dispose, positionOf,
    get count() { return views.size; },
    kinds: UNIT_KINDS_3D,
    root,
    _views: views,
  };
}

export default createUnits;
