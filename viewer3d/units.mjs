// Driftfall 3D units (owner: fable). createUnits(ctx) -> { update(frame, dt), dispose() } per VISUAL-3D.md.
//
// Every unit is an original low-poly model built in code from Three.js primitives (assets/models has no CC0 models
// yet; if the scout lands some, ctx.assets.models.get(kind) is tried first and the procedural model is the fallback).
// Each unit gets: a team glow strip (emissive, pulses, bloom-friendly), smooth movement between ticks (prev/next
// tile lerped by frame.alpha), walk / attack / mine / death animations driven by the frame, and a health bar that
// fades in when the unit is hurt or was just hit.
//
// Pure helpers (normalizeEvents, choosePose, yawBetween, healthBarState, lerpTile, UNIT_SPECS, buildUnitModel)
// are exported so tests/viewer3d-units.test.mjs can run them in node; three.module.js imports fine without a DOM.

import { STATS as ENV_STATS } from '../env/stats.mjs';

// ---------------------------------------------------------------------------------------------------------------
// Look (falls back to these when ctx.palette has no team / unit entries)
// ---------------------------------------------------------------------------------------------------------------
const DEFAULT_TEAM = [
  { main: 0x1fb6d8, light: 0x8af2ff, dark: 0x0b5c70, glow: 0x3ae6ff },
  { main: 0xd9892a, light: 0xffd38a, dark: 0x6b3f0b, glow: 0xffb340 },
];
const HULL = 0x3a3f47;       // dark alloy
const HULL_LIGHT = 0x6a717c;
const VISOR = 0xe8fbff;
const SHARD = 0x4df0d2;      // carried Shard crystal
const WARN = 0xff4a3d;       // low-health bar colour

// Rigs: how a model animates. hover (bobbing pod), biped (two legs, arm swing), quad (four stomping legs),
// tracked (low chassis, tilts), skim (low wedge, banks), air (flies at an altitude), float (hovers, orbiting bits).
export const UNIT_SPECS = {
  // The agreed four (ENV-SPEC.md v2).
  worker: { rig: 'hover', size: 0.40, height: 0.55, stride: 1.0, provisional: false },
  grunt:  { rig: 'biped', size: 0.50, height: 0.80, stride: 1.4, provisional: false },
  lancer: { rig: 'biped', size: 0.48, height: 0.95, stride: 1.6, provisional: false },
  brute:  { rig: 'quad',  size: 0.82, height: 0.95, stride: 1.0, provisional: false },
  // v3 roster as proposed by the design trio in the chat (provisional until AGREE: v3). Silhouettes are original.
  skyspike: { rig: 'biped',   size: 0.50, height: 1.05, stride: 1.4, provisional: true },
  bombard:  { rig: 'tracked', size: 0.80, height: 0.75, stride: 1.0, provisional: true },
  dart:     { rig: 'skim',    size: 0.55, height: 0.40, stride: 2.0, provisional: true },
  gale:     { rig: 'air',     size: 0.60, height: 0.35, altitude: 1.5, provisional: true },
  ferry:    { rig: 'air',     size: 0.75, height: 0.55, altitude: 1.9, provisional: true },
  lumen:    { rig: 'air',     size: 0.35, height: 0.35, altitude: 2.3, provisional: true },
  mender:   { rig: 'hover',   size: 0.45, height: 0.70, stride: 1.0, provisional: true },
  shade:    { rig: 'biped',   size: 0.46, height: 0.90, stride: 1.6, ghost: true, provisional: true },
  hexer:    { rig: 'float',   size: 0.50, height: 1.05, stride: 1.0, provisional: true },
};
export const UNIT_KINDS_3D = Object.freeze(Object.keys(UNIT_SPECS));

const DEATH_SECONDS = 0.9;
const SPAWN_SECONDS = 0.35;
const HIT_FLASH_SECONDS = 0.25;
const BAR_HOLD_SECONDS = 1.6;

// ---------------------------------------------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------------------------------------------

// world.mjs may hand events as the raw per-tick array ({ e: 'hit', ... }) or already grouped ({ hits: [...], ... }).
// Either way this returns { hits, deaths, spawns, mines, delivers } with plain records.
export function normalizeEvents(events) {
  const out = { hits: [], deaths: [], spawns: [], mines: [], delivers: [] };
  if (!events) return out;
  if (Array.isArray(events)) {
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      switch (ev.e) {
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
  out.hits = (events.hits ?? []).filter((h) => h && typeof h === 'object');
  out.deaths = (events.deaths ?? events.dies ?? []).map(idOf).filter((id) => id !== undefined);
  out.spawns = (events.spawns ?? []).map(idOf).filter((id) => id !== undefined);
  out.mines = events.mines ?? [];
  out.delivers = events.delivers ?? events.deliveries ?? [];
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
//   'die'   the unit is in prev but not in next (or has a die event)
//   'attack' it dealt a hit this tick
//   'walk'  its tile changed this tick, or it moved within the last `graceTicks` ticks and still has a moving order
//   'mine'  a Worker whose gather order is in the mining phase, or that picked up Shards this tick
//   'idle'  otherwise
export function choosePose({ id, prev, next, hits = [], deaths = [], mines = [], lastMoveTick = -Infinity, tick = 0, graceTicks = 1 }) {
  if ((prev && !next) || deaths.includes(id)) return 'die';
  if (hits.some((h) => h.by === id)) return 'attack';
  const u = next ?? prev;
  if (prev && next && (prev.x !== next.x || prev.y !== next.y)) return 'walk';
  const order = u?.order;
  const moving = order && (order.type === 'move' || order.type === 'attack' || (order.type === 'gather' && order.phase !== 'mining') || order.type === 'build');
  if (moving && tick - lastMoveTick <= graceTicks && tick - lastMoveTick >= 0) return 'walk';
  if (u?.kind === 'worker' && (order?.type === 'gather' && order.phase === 'mining')) return 'mine';
  if (mines.some((m) => m.id === id)) return 'mine';
  return 'idle';
}

// Yaw (radians, around +Y) so that a model built facing +Z looks from world point `from` to `to`. Returns null when
// the points coincide so the caller keeps its old heading.
export function yawBetween(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return null;
  return Math.atan2(dx, dz);
}

// Shortest-arc step from yaw a toward yaw b by at most `rate * dt` radians.
export function turnToward(a, b, rate, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, d));
  return a + step;
}

// Health bar visibility: shown while hurt or for BAR_HOLD_SECONDS after a hit, fading out over the last half second.
export function healthBarState({ hp, maxHp, sinceHit = Infinity, hold = BAR_HOLD_SECONDS }) {
  const max = maxHp > 0 ? maxHp : Math.max(1, hp);
  const ratio = Math.max(0, Math.min(1, hp / max));
  let opacity = 0;
  if (ratio < 1) opacity = 1;
  if (sinceHit < hold) opacity = 1;
  else if (sinceHit < hold + 0.5) opacity = Math.max(opacity, 1 - (sinceHit - hold) / 0.5);
  return { ratio, opacity, visible: opacity > 0.01, warn: ratio < 0.35 };
}

export function maxHpOf(kind, stats) {
  const s = stats?.units?.[kind] ?? ENV_STATS.units?.[kind];
  return typeof s?.hp === 'number' ? s.hp : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Materials and geometry (shared per team; the body material is cloned per unit so hit flashes stay local)
// ---------------------------------------------------------------------------------------------------------------
function teamColors(palette, owner) {
  const p = palette?.team?.[owner] ?? palette?.teams?.[owner];
  const d = DEFAULT_TEAM[owner] ?? DEFAULT_TEAM[0];
  const pick = (v, fallback) => (v === undefined || v === null ? fallback : v);
  return {
    main: pick(p?.main ?? p?.color ?? p?.base, d.main),
    light: pick(p?.light, d.light),
    dark: pick(p?.dark, d.dark),
    glow: pick(p?.glow ?? p?.emissive, d.glow),
  };
}

function makeTeamMaterials(THREE, palette, owner) {
  const c = teamColors(palette, owner);
  const glowLevel = palette?.emissive?.strip ?? palette?.emissive?.unitStrip ?? 2.2;
  return {
    body: new THREE.MeshStandardMaterial({ color: c.main, roughness: 0.55, metalness: 0.35 }),
    accent: new THREE.MeshStandardMaterial({ color: c.dark, roughness: 0.6, metalness: 0.4 }),
    hull: new THREE.MeshStandardMaterial({ color: HULL, roughness: 0.7, metalness: 0.5 }),
    hullLight: new THREE.MeshStandardMaterial({ color: HULL_LIGHT, roughness: 0.6, metalness: 0.45 }),
    strip: new THREE.MeshStandardMaterial({ color: c.glow, emissive: c.glow, emissiveIntensity: glowLevel, roughness: 0.3, metalness: 0 }),
    visor: new THREE.MeshStandardMaterial({ color: VISOR, emissive: VISOR, emissiveIntensity: 1.2, roughness: 0.2 }),
    shard: new THREE.MeshStandardMaterial({ color: SHARD, emissive: SHARD, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0 }),
    ghost: new THREE.MeshStandardMaterial({ color: c.main, roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.42 }),
    colors: c,
  };
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

function mesh(THREE, g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = false;
  return o;
}
function pivot(THREE, x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  return p;
}

// Each builder returns { group, parts } where parts has named pivots used by the rig animation:
//   legs: [leftPivot, rightPivot, ...], arms: [...], weapon, head, body, strips: [...], carry (worker pod crystal),
//   extras (anything the rig spins or bobs). All models face +Z, feet at y = 0, size in tile units.
const BUILDERS = {
  worker(THREE, m, s) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.30 * s, 0);
    g.add(body);
    body.add(mesh(THREE, cyl(THREE, 0.32, 0.26, 0.30, 8), m.body, 0, 0, 0));                 // hover pod
    body.add(mesh(THREE, cyl(THREE, 0.20, 0.32, 0.10, 8), m.hull, 0, -0.20, 0));             // underside skirt
    body.add(mesh(THREE, tor(THREE, 0.33, 0.035, 8), m.strip, 0, 0.0, 0)).rotation.x = Math.PI / 2; // glow ring
    const head = pivot(THREE, 0, 0.22, 0.05);
    head.add(mesh(THREE, sph(THREE, 0.14, 8), m.hull, 0, 0, 0));
    head.add(mesh(THREE, box(THREE, 0.16, 0.05, 0.06), m.visor, 0, 0.02, 0.12));             // eye slit
    body.add(head);
    const arms = [];
    for (const side of [-1, 1]) {
      const a = pivot(THREE, 0.22 * side, 0.02, 0.18);
      a.add(mesh(THREE, box(THREE, 0.06, 0.06, 0.26), m.hullLight, 0, 0, 0.13));
      a.add(mesh(THREE, cone(THREE, 0.05, 0.12, 4), m.accent, 0, 0, 0.30)).rotation.x = Math.PI / 2; // claw tip
      body.add(a);
      arms.push(a);
    }
    const pod = mesh(THREE, box(THREE, 0.24, 0.18, 0.14), m.accent, 0, 0.06, -0.26);          // rear cargo pod
    body.add(pod);
    const carry = mesh(THREE, octa(THREE, 0.09), m.shard, 0, 0.17, -0.26);                   // Shard shows when carrying
    carry.visible = false;
    body.add(carry);
    g.scale.setScalar(s / 0.4);
    return { group: g, parts: { body, head, arms, carry, strips: [] } };
  },

  grunt(THREE, m, s) {
    const g = new THREE.Group();
    const hip = pivot(THREE, 0, 0.36, 0);
    g.add(hip);
    const torso = mesh(THREE, box(THREE, 0.34, 0.32, 0.22), m.body, 0, 0.18, 0);
    hip.add(torso);
    hip.add(mesh(THREE, box(THREE, 0.38, 0.06, 0.26), m.hull, 0, 0.36, 0));                  // shoulder plate
    hip.add(mesh(THREE, box(THREE, 0.36, 0.04, 0.04), m.strip, 0, 0.12, 0.12));              // chest strip
    hip.add(mesh(THREE, box(THREE, 0.16, 0.14, 0.04), m.strip, 0, 0.10, -0.12));             // back strip
    const head = pivot(THREE, 0, 0.44, 0);
    head.add(mesh(THREE, box(THREE, 0.18, 0.16, 0.18), m.hull, 0, 0.08, 0));
    head.add(mesh(THREE, box(THREE, 0.14, 0.04, 0.03), m.visor, 0, 0.08, 0.10));
    hip.add(head);
    const legs = [];
    for (const side of [-1, 1]) {
      const l = pivot(THREE, 0.10 * side, 0, 0);
      l.add(mesh(THREE, box(THREE, 0.10, 0.34, 0.12), m.hull, 0, -0.17, 0));
      l.add(mesh(THREE, box(THREE, 0.12, 0.06, 0.18), m.accent, 0, -0.33, 0.03));            // boot
      hip.add(l);
      legs.push(l);
    }
    const armR = pivot(THREE, 0.24, 0.30, 0);                                                 // blade arm
    armR.add(mesh(THREE, box(THREE, 0.09, 0.26, 0.10), m.accent, 0, -0.13, 0));
    const blade = mesh(THREE, box(THREE, 0.03, 0.08, 0.42), m.hullLight, 0, -0.26, 0.20);
    armR.add(blade);
    armR.add(mesh(THREE, box(THREE, 0.012, 0.03, 0.36), m.strip, 0.02, -0.26, 0.22));        // glowing edge
    hip.add(armR);
    const armL = pivot(THREE, -0.24, 0.30, 0);                                                // shield arm
    armL.add(mesh(THREE, box(THREE, 0.09, 0.26, 0.10), m.accent, 0, -0.13, 0));
    armL.add(mesh(THREE, box(THREE, 0.05, 0.28, 0.24), m.body, -0.06, -0.14, 0.04));
    hip.add(armL);
    g.scale.setScalar(s / 0.5);
    return { group: g, parts: { body: hip, head, legs, arms: [armL, armR], weapon: armR, strips: [] } };
  },

  lancer(THREE, m, s) {
    const g = new THREE.Group();
    const hip = pivot(THREE, 0, 0.44, 0);
    g.add(hip);
    hip.add(mesh(THREE, cyl(THREE, 0.13, 0.10, 0.34, 6), m.body, 0, 0.18, 0));                // slim torso
    hip.add(mesh(THREE, box(THREE, 0.30, 0.05, 0.16), m.hull, 0, 0.36, 0));                  // shoulders
    hip.add(mesh(THREE, box(THREE, 0.12, 0.22, 0.10), m.accent, 0, 0.16, -0.14));            // backpack
    const antenna = mesh(THREE, cyl(THREE, 0.01, 0.01, 0.34, 4), m.hullLight, 0.06, 0.42, -0.14);
    hip.add(antenna);
    hip.add(mesh(THREE, sph(THREE, 0.025, 6), m.strip, 0.06, 0.60, -0.14));                  // antenna tip
    const head = pivot(THREE, 0, 0.42, 0);
    head.add(mesh(THREE, cyl(THREE, 0.08, 0.10, 0.16, 6), m.hull, 0, 0.08, 0));
    head.add(mesh(THREE, box(THREE, 0.10, 0.03, 0.04), m.visor, 0, 0.09, 0.09));
    hip.add(head);
    const legs = [];
    for (const side of [-1, 1]) {
      const l = pivot(THREE, 0.08 * side, 0, 0);
      l.add(mesh(THREE, box(THREE, 0.07, 0.42, 0.09), m.hull, 0, -0.21, 0));
      l.add(mesh(THREE, box(THREE, 0.09, 0.05, 0.16), m.accent, 0, -0.42, 0.03));
      hip.add(l);
      legs.push(l);
    }
    const weapon = pivot(THREE, 0.16, 0.26, 0.05);                                            // lance rifle
    weapon.add(mesh(THREE, box(THREE, 0.07, 0.07, 0.78), m.hull, 0, 0, 0.26));
    weapon.add(mesh(THREE, box(THREE, 0.03, 0.03, 0.70), m.strip, 0, 0.045, 0.30));           // glow rail
    weapon.add(mesh(THREE, cone(THREE, 0.035, 0.14, 4), m.hullLight, 0, 0, 0.72)).rotation.x = Math.PI / 2;
    weapon.add(mesh(THREE, box(THREE, 0.08, 0.16, 0.10), m.accent, 0, -0.08, 0.02));          // grip
    hip.add(weapon);
    const armL = pivot(THREE, -0.17, 0.30, 0);
    armL.add(mesh(THREE, box(THREE, 0.07, 0.24, 0.08), m.accent, 0, -0.12, 0.06));
    hip.add(armL);
    g.scale.setScalar(s / 0.48);
    return { group: g, parts: { body: hip, head, legs, arms: [armL, weapon], weapon, strips: [] } };
  },

  brute(THREE, m, s) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.48, 0);
    g.add(body);
    body.add(mesh(THREE, box(THREE, 0.74, 0.40, 0.70), m.body, 0, 0.10, 0));                 // hull
    body.add(mesh(THREE, box(THREE, 0.84, 0.10, 0.50), m.hull, 0, 0.36, -0.04));             // dorsal plate
    body.add(mesh(THREE, box(THREE, 0.60, 0.14, 0.06), m.hull, 0, 0.02, 0.37));              // front bumper
    body.add(mesh(THREE, box(THREE, 0.50, 0.05, 0.03), m.strip, 0, 0.18, 0.37));             // front strip
    for (const side of [-1, 1]) body.add(mesh(THREE, box(THREE, 0.03, 0.05, 0.56), m.strip, 0.385 * side, 0.18, 0)); // side strips
    body.add(mesh(THREE, cyl(THREE, 0.06, 0.06, 0.22, 6), m.hullLight, -0.22, 0.46, -0.20)); // exhaust stack
    body.add(mesh(THREE, cyl(THREE, 0.06, 0.06, 0.22, 6), m.hullLight, 0.22, 0.46, -0.20));
    const head = pivot(THREE, 0, 0.26, 0.30);
    head.add(mesh(THREE, box(THREE, 0.30, 0.16, 0.20), m.hull, 0, 0, 0.06));
    head.add(mesh(THREE, box(THREE, 0.22, 0.04, 0.03), m.visor, 0, 0.02, 0.17));
    body.add(head);
    const legs = [];
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const l = pivot(THREE, 0.34 * sx, -0.10, 0.24 * sz);
      l.add(mesh(THREE, box(THREE, 0.16, 0.30, 0.18), m.accent, 0.06 * sx, -0.15, 0));
      l.add(mesh(THREE, box(THREE, 0.22, 0.08, 0.24), m.hull, 0.06 * sx, -0.34, 0));          // foot
      body.add(l);
      legs.push(l);
    }
    const arms = [];
    for (const side of [-1, 1]) {
      const a = pivot(THREE, 0.44 * side, 0.22, 0.22);                                         // hammer fists
      a.add(mesh(THREE, box(THREE, 0.12, 0.12, 0.30), m.accent, 0.03 * side, -0.02, 0.12));
      a.add(mesh(THREE, box(THREE, 0.22, 0.22, 0.20), m.hullLight, 0.05 * side, -0.04, 0.34));
      a.add(mesh(THREE, box(THREE, 0.24, 0.04, 0.04), m.strip, 0.05 * side, 0.08, 0.34));
      body.add(a);
      arms.push(a);
    }
    g.scale.setScalar(s / 0.82);
    return { group: g, parts: { body, head, legs, arms, weapon: arms[1], strips: [] } };
  },

  // ---- v3 roster (provisional silhouettes; swapped/tuned as the design trio settles each one) ----
  skyspike(THREE, m, s) {
    const r = BUILDERS.grunt(THREE, m, 0.5);
    const hip = r.parts.body;
    // replace the blade: a tall vertical launcher on the back, two spikes ready
    r.parts.weapon.children.forEach((c) => { c.visible = false; });
    const rack = pivot(THREE, 0, 0.30, -0.16);
    rack.add(mesh(THREE, box(THREE, 0.16, 0.44, 0.08), m.accent, 0, 0.10, 0));
    for (const side of [-1, 1]) {
      rack.add(mesh(THREE, cone(THREE, 0.035, 0.26, 4), m.hullLight, 0.05 * side, 0.42, 0));
      rack.add(mesh(THREE, cyl(THREE, 0.012, 0.012, 0.30, 4), m.strip, 0.05 * side, 0.14, 0));
    }
    hip.add(rack);
    const armR = r.parts.weapon;
    armR.add(mesh(THREE, box(THREE, 0.09, 0.26, 0.10), m.accent, 0, -0.13, 0));
    armR.add(mesh(THREE, cyl(THREE, 0.04, 0.04, 0.30, 6), m.hull, 0, -0.26, 0.10)).rotation.x = Math.PI / 2;
    r.group.scale.setScalar(s / 0.5);
    r.parts.extras = [rack];
    return r;
  },

  bombard(THREE, m, s) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.22, 0);
    g.add(body);
    body.add(mesh(THREE, box(THREE, 0.70, 0.24, 0.80), m.body, 0, 0.06, 0));                 // chassis
    for (const side of [-1, 1]) {
      body.add(mesh(THREE, box(THREE, 0.14, 0.26, 0.84), m.hull, 0.40 * side, -0.06, 0));    // tracks
      body.add(mesh(THREE, box(THREE, 0.02, 0.04, 0.70), m.strip, 0.475 * side, 0.02, 0));
    }
    const weapon = pivot(THREE, 0, 0.26, -0.10);                                              // mortar tube
    weapon.add(mesh(THREE, box(THREE, 0.30, 0.16, 0.30), m.accent, 0, 0, 0));
    const tube = mesh(THREE, cyl(THREE, 0.08, 0.10, 0.64, 8), m.hull, 0, 0.18, 0.22);
    tube.rotation.x = -Math.PI / 3.2;
    weapon.add(tube);
    const ring = mesh(THREE, tor(THREE, 0.09, 0.02, 8), m.strip, 0, 0.30, 0.42);
    ring.rotation.x = -Math.PI / 3.2 + Math.PI / 2;
    weapon.add(ring);
    body.add(weapon);
    body.add(mesh(THREE, box(THREE, 0.06, 0.06, 0.40), m.hullLight, -0.28, 0.20, 0.10));     // stabiliser arms
    body.add(mesh(THREE, box(THREE, 0.06, 0.06, 0.40), m.hullLight, 0.28, 0.20, 0.10));
    g.scale.setScalar(s / 0.8);
    return { group: g, parts: { body, weapon, strips: [], legs: [], arms: [] } };
  },

  dart(THREE, m, s) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.16, 0);
    g.add(body);
    const hull = mesh(THREE, cone(THREE, 0.22, 0.66, 4), m.body, 0, 0.04, 0.04);
    hull.rotation.x = Math.PI / 2;
    hull.rotation.z = Math.PI / 4;
    body.add(hull);
    for (const side of [-1, 1]) {
      const fin = mesh(THREE, box(THREE, 0.26, 0.03, 0.18), m.hull, 0.18 * side, 0.08, -0.16);
      fin.rotation.z = 0.5 * side;
      body.add(fin);
      body.add(mesh(THREE, box(THREE, 0.02, 0.03, 0.30), m.strip, 0.09 * side, 0.08, -0.02));
      body.add(mesh(THREE, box(THREE, 0.05, 0.08, 0.16), m.accent, 0.14 * side, -0.12, 0.0)); // skids
    }
    body.add(mesh(THREE, box(THREE, 0.10, 0.06, 0.03), m.visor, 0, 0.09, 0.22));
    body.add(mesh(THREE, cone(THREE, 0.06, 0.16, 4), m.hullLight, 0, 0.0, 0.42)).rotation.x = Math.PI / 2; // prow blade
    g.scale.setScalar(s / 0.55);
    return { group: g, parts: { body, strips: [], legs: [], arms: [] } };
  },

  gale(THREE, m, s) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0, 0);
    g.add(body);
    const wing = mesh(THREE, cone(THREE, 0.40, 0.56, 3), m.body, 0, 0, -0.02);               // delta wing
    wing.rotation.x = Math.PI / 2;
    wing.scale.y = 0.12;
    body.add(wing);
    body.add(mesh(THREE, box(THREE, 0.14, 0.12, 0.44), m.hull, 0, 0.06, 0.02));              // spine
    body.add(mesh(THREE, box(THREE, 0.08, 0.04, 0.03), m.visor, 0, 0.09, 0.24));
    const extras = [];
    for (const side of [-1, 1]) {
      const pod = mesh(THREE, cyl(THREE, 0.06, 0.06, 0.26, 6), m.accent, 0.24 * side, 0.02, -0.14);
      pod.rotation.x = Math.PI / 2;
      body.add(pod);
      const glow = mesh(THREE, cyl(THREE, 0.045, 0.045, 0.04, 6), m.strip, 0.24 * side, 0.02, -0.29);
      glow.rotation.x = Math.PI / 2;
      body.add(glow);
      extras.push(glow);
    }
    body.add(mesh(THREE, box(THREE, 0.50, 0.015, 0.03), m.strip, 0, 0.0, -0.18));
    g.scale.setScalar(s / 0.6);
    return { group: g, parts: { body, strips: [], legs: [], arms: [], extras } };
  },

  ferry(THREE, m, s) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0, 0);
    g.add(body);
    body.add(mesh(THREE, box(THREE, 0.44, 0.30, 0.70), m.body, 0, 0, 0));                    // hull
    body.add(mesh(THREE, box(THREE, 0.30, 0.10, 0.30), m.hull, 0, 0.20, 0.10));              // cabin
    body.add(mesh(THREE, box(THREE, 0.26, 0.04, 0.03), m.visor, 0, 0.22, 0.26));
    body.add(mesh(THREE, box(THREE, 0.46, 0.03, 0.03), m.strip, 0, -0.06, 0.36));
    body.add(mesh(THREE, box(THREE, 0.46, 0.03, 0.03), m.strip, 0, -0.06, -0.36));
    const extras = [];
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const arm = mesh(THREE, box(THREE, 0.20, 0.05, 0.05), m.hull, 0.30 * sx, 0.14, 0.28 * sz);
      body.add(arm);
      const ring = pivot(THREE, 0.42 * sx, 0.16, 0.28 * sz);
      ring.add(mesh(THREE, tor(THREE, 0.13, 0.02, 10), m.accent, 0, 0, 0)).rotation.x = Math.PI / 2;
      const rotor = mesh(THREE, box(THREE, 0.24, 0.01, 0.04), m.hullLight, 0, 0.01, 0);
      ring.add(rotor);
      body.add(ring);
      extras.push(rotor);
    }
    g.scale.setScalar(s / 0.75);
    return { group: g, parts: { body, strips: [], legs: [], arms: [], extras } };
  },

  lumen(THREE, m, s) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0, 0);
    g.add(body);
    body.add(mesh(THREE, sph(THREE, 0.16, 10), m.hull, 0, 0, 0));
    body.add(mesh(THREE, sph(THREE, 0.09, 8), m.visor, 0, 0, 0.11));                         // lantern eye
    const ring = pivot(THREE, 0, 0, 0);
    ring.add(mesh(THREE, tor(THREE, 0.26, 0.025, 14), m.strip, 0, 0, 0)).rotation.x = Math.PI / 2;
    body.add(ring);
    const ring2 = pivot(THREE, 0, 0, 0);
    ring2.add(mesh(THREE, tor(THREE, 0.21, 0.015, 12), m.body, 0, 0, 0));
    body.add(ring2);
    g.scale.setScalar(s / 0.35);
    return { group: g, parts: { body, strips: [], legs: [], arms: [], extras: [ring, ring2] } };
  },

  mender(THREE, m, s) {
    const r = BUILDERS.worker(THREE, m, 0.4);
    const body = r.parts.body;
    r.parts.carry.visible = false;
    const halo = pivot(THREE, 0, 0.48, 0);
    halo.add(mesh(THREE, tor(THREE, 0.20, 0.02, 12), m.strip, 0, 0, 0)).rotation.x = Math.PI / 2;
    body.add(halo);
    body.add(mesh(THREE, octa(THREE, 0.07), m.visor, 0, 0.48, 0));
    for (const a of r.parts.arms) a.children.forEach((c, i) => { if (i === 1) c.material = m.visor; });
    r.group.scale.setScalar(s / 0.4);
    r.parts.extras = [halo];
    return r;
  },

  shade(THREE, m, s) {
    const r = BUILDERS.lancer(THREE, m, 0.48);
    r.group.traverse((o) => { if (o.isMesh && (o.material === m.body || o.material === m.hull || o.material === m.accent)) o.material = m.ghost; });
    r.group.scale.setScalar(s / 0.48);
    return r;
  },

  hexer(THREE, m, s) {
    const g = new THREE.Group();
    const body = pivot(THREE, 0, 0.30, 0);
    g.add(body);
    const robe = mesh(THREE, cone(THREE, 0.26, 0.60, 6), m.body, 0, 0.30, 0);                 // robed cone
    body.add(robe);
    body.add(mesh(THREE, cone(THREE, 0.16, 0.22, 6), m.hull, 0, 0.70, 0));                   // cowl
    body.add(mesh(THREE, box(THREE, 0.10, 0.03, 0.04), m.visor, 0, 0.62, 0.12));
    body.add(mesh(THREE, tor(THREE, 0.26, 0.02, 12), m.strip, 0, 0.10, 0)).rotation.x = Math.PI / 2;
    const extras = [];
    for (let i = 0; i < 3; i++) {
      const orbit = pivot(THREE, 0, 0.50, 0);
      orbit.rotation.y = (i / 3) * Math.PI * 2;
      orbit.add(mesh(THREE, octa(THREE, 0.05), m.strip, 0.36, 0, 0));
      body.add(orbit);
      extras.push(orbit);
    }
    g.scale.setScalar(s / 0.5);
    return { group: g, parts: { body, strips: [], legs: [], arms: [], extras } };
  },
};

// Unknown kinds (a roster entry that landed before its model) get a plain capsule with a team ring, so nothing is
// ever invisible on the battlefield.
function buildFallback(THREE, m, s) {
  const g = new THREE.Group();
  const body = pivot(THREE, 0, 0.30, 0);
  g.add(body);
  body.add(mesh(THREE, cyl(THREE, 0.18, 0.22, 0.44, 8), m.body, 0, 0.05, 0));
  body.add(mesh(THREE, sph(THREE, 0.18, 8), m.hull, 0, 0.30, 0));
  body.add(mesh(THREE, tor(THREE, 0.26, 0.025, 10), m.strip, 0, -0.14, 0)).rotation.x = Math.PI / 2;
  g.scale.setScalar(s / 0.5);
  return { group: g, parts: { body, strips: [], legs: [], arms: [] } };
}

// Build a model for `kind`. Returns { group, parts, spec }. Exported for tests and for anyone who wants a preview.
export function buildUnitModel(THREE, kind, owner, palette, materials) {
  const m = materials ?? makeTeamMaterials(THREE, palette, owner);
  const spec = UNIT_SPECS[kind] ?? { rig: 'hover', size: 0.5, height: 0.8, stride: 1.2, provisional: true };
  const builder = BUILDERS[kind];
  const r = builder ? builder(THREE, m, spec.size) : buildFallback(THREE, m, spec.size);
  r.parts.strips ??= [];
  r.group.traverse((o) => { if (o.isMesh && o.material === m.strip) r.parts.strips.push(o); });
  r.spec = spec;
  r.materials = m;
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Health bars
// ---------------------------------------------------------------------------------------------------------------
function makeHealthBar(THREE, teamColor, width) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(geo(THREE, 'bar:bg', () => new THREE.PlaneGeometry(1, 1)),
    new THREE.MeshBasicMaterial({ color: 0x0a0d12, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false }));
  bg.scale.set(width, width * 0.14, 1);
  const fill = new THREE.Mesh(geo(THREE, 'bar:fill', () => new THREE.PlaneGeometry(1, 1)),
    new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 1, depthWrite: false, depthTest: false }));
  fill.position.z = 0.002;
  g.add(bg, fill);
  g.renderOrder = 1000;
  bg.renderOrder = 1000;
  fill.renderOrder = 1001;
  g.visible = false;
  return { group: g, bg, fill, width };
}

function setHealthBar(bar, state, teamColor) {
  const { ratio, opacity, visible, warn } = state;
  bar.group.visible = visible;
  if (!visible) return;
  const w = bar.width * 0.96;
  bar.fill.scale.set(Math.max(0.001, w * ratio), bar.width * 0.10, 1);
  bar.fill.position.x = -w / 2 + (w * ratio) / 2;
  bar.fill.material.color.set(warn ? WARN : teamColor);
  bar.fill.material.opacity = opacity;
  bar.bg.material.opacity = 0.75 * opacity;
}

// ---------------------------------------------------------------------------------------------------------------
// Rig animation. `v` is the view, `pose` the chosen pose, `phase` 0..1 inside the tick, `t` seconds of wall time.
// ---------------------------------------------------------------------------------------------------------------
const easeOutBack = (x) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
const pulse = (x) => Math.sin(Math.PI * Math.min(1, Math.max(0, x)));   // 0 -> 1 -> 0 over x in 0..1
const strike = (x) => (x < 0.35 ? x / 0.35 : Math.max(0, 1 - (x - 0.35) / 0.5)); // quick lunge, slower recover

function animate(v, pose, phase, walkPhase, t, dt) {
  const p = v.parts;
  const spec = v.spec;
  const rig = spec.rig;
  const bob = p.body;
  const base = v.baseY;
  const sw = Math.sin(walkPhase);
  const cw = Math.cos(walkPhase);

  // walking amount eases in and out so a unit that stops does not freeze mid-stride
  const targetWalk = pose === 'walk' ? 1 : 0;
  v.walkAmount += (targetWalk - v.walkAmount) * Math.min(1, dt * 10);
  const walk = v.walkAmount;
  const attack = pose === 'attack' ? strike(phase) : 0;

  if (rig === 'biped') {
    for (let i = 0; i < p.legs.length; i++) p.legs[i].rotation.x = (i === 0 ? sw : -sw) * 0.75 * walk;
    bob.position.y = base + Math.abs(cw) * 0.05 * walk + Math.sin(t * 2.2) * 0.008;
    bob.rotation.x = 0.08 * walk;
    bob.rotation.z = sw * 0.04 * walk;
    if (p.arms?.[0]) p.arms[0].rotation.x = -sw * 0.5 * walk;
    if (p.weapon) {
      if (v.kind === 'lancer' || v.kind === 'shade') {
        p.weapon.rotation.x = -0.25 + sw * 0.1 * walk + attack * 0.18;  // recoil
        p.weapon.position.z = 0.05 - attack * 0.08;
      } else if (v.kind === 'skyspike') {
        p.weapon.rotation.x = sw * 0.5 * walk - attack * 1.1;
      } else {
        p.weapon.rotation.x = sw * 0.5 * walk - attack * 1.9;            // blade swing
        p.weapon.rotation.z = -attack * 0.6;
      }
    }
    if (p.head) p.head.rotation.y = Math.sin(t * 0.9 + v.id) * 0.25 * (1 - walk) * (1 - attack);
  } else if (rig === 'quad') {
    // one heavy stomp per move tick: legs alternate in diagonal pairs
    const s = Math.sin(walkPhase);
    for (let i = 0; i < p.legs.length; i++) {
      const pair = (i === 0 || i === 3) ? 1 : -1;
      p.legs[i].rotation.x = s * pair * 0.45 * walk;
      p.legs[i].position.y = -0.10 + Math.max(0, s * pair) * 0.10 * walk;
    }
    bob.position.y = base + Math.abs(Math.sin(walkPhase * 2)) * 0.06 * walk + Math.sin(t * 1.4) * 0.006;
    bob.rotation.z = s * 0.06 * walk;
    bob.rotation.x = -attack * 0.12;
    for (const a of p.arms) { a.rotation.x = -attack * 1.4 + Math.sin(t * 1.6) * 0.03; }
    if (p.head) p.head.rotation.y = Math.sin(t * 0.6 + v.id) * 0.15 * (1 - attack);
  } else if (rig === 'hover') {
    bob.position.y = base + 0.05 + Math.sin(t * 3.0 + v.id * 1.7) * 0.03 + walk * 0.02;
    bob.rotation.x = 0.22 * walk;
    bob.rotation.z = Math.sin(t * 2.0 + v.id) * 0.03;
    const mine = pose === 'mine' ? 1 : 0;
    v.mineAmount += (mine - v.mineAmount) * Math.min(1, dt * 8);
    for (let i = 0; i < p.arms.length; i++) {
      const chip = Math.max(0, Math.sin(t * 9 + i * Math.PI)) * v.mineAmount;
      p.arms[i].rotation.x = -0.35 * v.mineAmount + chip * 0.55 - attack * 0.9 + walk * 0.15;
      p.arms[i].rotation.y = (i === 0 ? 1 : -1) * (0.25 - 0.2 * v.mineAmount);
    }
    if (p.head) p.head.rotation.y = Math.sin(t * 1.1 + v.id) * 0.35 * (1 - walk);
    if (p.extras) for (const e of p.extras) e.rotation.y = t * 1.5;
  } else if (rig === 'tracked') {
    bob.position.y = base + Math.sin(t * 1.3) * 0.004;
    bob.rotation.x = 0.05 * walk - attack * 0.10;
    if (p.weapon) { p.weapon.rotation.x = -attack * 0.25; p.weapon.position.z = -0.10 - attack * 0.06; }
  } else if (rig === 'skim') {
    bob.position.y = base + 0.04 + Math.sin(t * 6 + v.id) * 0.015 + walk * 0.03;
    bob.rotation.x = 0.18 * walk - attack * 0.3;
    bob.rotation.z = Math.sin(t * 4.0 + v.id) * 0.06 * walk;
    bob.position.z = attack * 0.15;
  } else if (rig === 'air') {
    const alt = (spec.altitude ?? 1.5) * v.tileSize;
    bob.position.y = alt + Math.sin(t * 1.7 + v.id * 0.9) * 0.06 * v.tileSize;
    bob.rotation.x = 0.16 * walk - attack * 0.2;
    bob.rotation.z = Math.sin(t * 1.1 + v.id) * 0.05 + (v.kind === 'gale' ? -v.turnRate * 0.6 : 0);
    if (p.extras) for (const e of p.extras) { if (v.kind === 'ferry') e.rotation.y = t * 30; else e.rotation.y = t * 2.2; }
  } else if (rig === 'float') {
    bob.position.y = base + 0.08 + Math.sin(t * 1.5 + v.id) * 0.04;
    bob.rotation.x = 0.1 * walk;
    if (p.extras) for (let i = 0; i < p.extras.length; i++) p.extras[i].rotation.y = t * (1.2 + attack * 6) + (i / p.extras.length) * Math.PI * 2;
  }

  // glow strips breathe; brighter on attack
  const glow = 0.85 + 0.15 * Math.sin(t * 2.6 + v.id) + attack * 0.8;
  v.materials.strip.emissiveIntensity = v.stripLevel * glow;
}

// ---------------------------------------------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------------------------------------------
export function createUnits(ctx) {
  const THREE = ctx.THREE;
  const scene = ctx.scene;
  const tileSize = ctx.tileSize ?? 1;
  const palette = ctx.palette ?? null;
  const stats = ctx.stats ?? ctx.log?.stats ?? null;
  const root = new THREE.Group();
  root.name = 'units';
  scene.add(root);

  const teamMats = [makeTeamMaterials(THREE, palette, 0), makeTeamMaterials(THREE, palette, 1)];
  const views = new Map();        // id -> view
  const lastKnown = new Map();    // id -> last seen record (so dying units keep a tile and so vfx can ask us)
  let time = 0;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function worldOf(x, y, out) {
    const w = ctx.gridToWorld(x, y);
    return out.set(w.x, w.y ?? 0, w.z);
  }

  function tryAsset(kind, owner) {
    const get = ctx.assets?.models?.get;
    if (typeof get !== 'function') return null;
    try {
      const obj = get.call(ctx.assets.models, kind, owner);
      if (!obj || !obj.isObject3D) return null;
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      return obj;
    } catch { return null; }
  }

  function makeView(u) {
    const owner = u.owner === 1 ? 1 : 0;
    const shared = teamMats[owner];
    // body + strip materials are per unit so hit flashes and death fades stay local; the rest is shared per team
    const mats = { ...shared, body: shared.body.clone(), strip: shared.strip.clone(), ghost: shared.ghost.clone() };
    let model = null;
    const asset = tryAsset(u.kind, owner);
    if (asset) {
      const g = new THREE.Group();
      g.add(asset);
      model = { group: g, parts: { body: asset, legs: [], arms: [], strips: [] }, spec: UNIT_SPECS[u.kind] ?? { rig: 'hover', size: 0.5, height: 0.8 } };
      // give CC0 models the team strip too: a glow ring at the feet
      const ring = mesh(THREE, tor(THREE, 0.3 * tileSize, 0.02 * tileSize, 12), mats.strip, 0, 0.02, 0);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    } else {
      model = buildUnitModel(THREE, u.kind, owner, palette, mats);
    }
    model.group.scale.multiplyScalar(tileSize);
    const holder = new THREE.Group();
    holder.add(model.group);
    const bar = makeHealthBar(THREE, mats.colors.glow, Math.max(0.45, model.spec.size * 1.1) * tileSize);
    bar.group.position.y = (model.spec.height + (model.spec.altitude ?? 0) + 0.22) * tileSize;
    holder.add(bar.group);
    root.add(holder);
    const v = {
      id: u.id, kind: u.kind, owner, holder, model: model.group, parts: model.parts, spec: model.spec, materials: mats,
      bar, baseY: model.parts.body?.position.y ?? 0, tileSize,
      yaw: owner === 0 ? Math.PI / 4 : -Math.PI * 0.75, turnRate: 0,
      walkAmount: 0, mineAmount: 0, lastMoveTick: -Infinity, lastHitAt: -Infinity, hitFlash: 0,
      spawnAt: time, dying: false, deathAt: 0, dead: false,
      maxHp: maxHpOf(u.kind, stats) || u.hp, bodyColor: mats.body.color.clone(), bodyEmissive: mats.body.emissive.clone(),
      stripLevel: mats.strip.emissiveIntensity,
    };
    v.baseY = v.parts.body ? v.parts.body.position.y : 0;
    views.set(u.id, v);
    return v;
  }

  function startDeath(v) {
    if (v.dying) return;
    v.dying = true;
    v.deathAt = time;
    v.bar.group.visible = false;
    v.model.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.isStrip = o.material === v.materials.strip;
      const m = o.material.clone();
      m.transparent = true;
      o.material = m;
      o.userData.ownMaterial = true;
    });
  }

  function animateDeath(v, spawnScale) {
    const d = Math.min(1, (time - v.deathAt) / DEATH_SECONDS);
    const air = v.spec.rig === 'air';
    v.model.rotation.x = d * (air ? 0.9 : 1.35);
    v.model.rotation.z = d * 0.4;
    v.model.position.y = air ? -d * d * (v.spec.altitude ?? 1.5) * tileSize : -d * 0.35 * tileSize;
    const op = 1 - Math.max(0, d - 0.45) / 0.55;
    v.model.traverse((o) => {
      if (!o.isMesh || !o.userData.ownMaterial) return;
      o.material.opacity = (o.material.opacity < 0.5 && d === 0 ? 0.42 : 1) * op;
      if (o.userData.isStrip) o.material.emissiveIntensity = v.stripLevel * (1 - d) * 2.5;   // strip flares then dies
    });
    v.model.scale.setScalar(spawnScale * (1 - d * 0.15));
    if (d >= 1) v.dead = true;
  }

  function revive(v) {
    v.dying = false;
    v.dead = false;
    v.model.traverse((o) => { if (o.isMesh && o.userData.ownMaterial) o.material.opacity = o.material === v.materials.ghost ? 0.42 : 1; });
    v.model.position.set(0, 0, 0);
  }

  function removeView(v) {
    root.remove(v.holder);
    v.model.traverse((o) => { if (o.isMesh && o.userData.ownMaterial) o.material.dispose(); });
    v.materials.body.dispose();
    v.materials.strip.dispose();
    v.materials.ghost.dispose();
    v.bar.bg.material.dispose();
    v.bar.fill.material.dispose();
    views.delete(v.id);
  }

  function findEntity(state, id) {
    if (!state) return null;
    return state.units.find((u) => u.id === id) ?? state.structures.find((s) => s.id === id) ?? null;
  }

  function update(frame, dt) {
    dt = Math.max(0, Math.min(0.1, dt ?? 0.016));
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
        if (!nu) return;                       // only in prev and not known to us: skip (scrubbed past it)
        v = makeView(u);
        if (pu) v.spawnAt = -Infinity;         // was already alive: no spawn pop
      }
      lastKnown.set(id, u);
      const pose = choosePose({ id, prev: pu, next: nu, hits: ev.hits, deaths: ev.deaths, mines: ev.mines, lastMoveTick: v.lastMoveTick, tick, graceTicks: v.spec.rig === 'quad' ? 2 : 1 });
      if (pose === 'walk' && pu && nu && (pu.x !== nu.x || pu.y !== nu.y)) v.lastMoveTick = tick;
      if (pose === 'die') { startDeath(v); }
      else if (v.dying) revive(v);              // scrubbed back before its death

      // position
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
        if (target) targetYaw = yawBetween(v.holder.position, worldOf(target.x, target.y, tmpA));
      }
      if (targetYaw !== null) {
        const before = v.yaw;
        v.yaw = turnToward(v.yaw, targetYaw, 9, dt);
        v.turnRate = (v.yaw - before) / Math.max(dt, 1e-4);
      } else v.turnRate *= 0.8;
      v.model.rotation.y = v.yaw;

      // hits on this unit
      const hit = hitsOn.get(id);
      if (hit && v.lastHitTick !== tick) { v.lastHitTick = tick; v.lastHitAt = time; v.hitFlash = 1; }
      v.hitFlash = Math.max(0, v.hitFlash - dt / HIT_FLASH_SECONDS);
      const flash = v.hitFlash * v.hitFlash;
      v.materials.body.emissive.setRGB(flash, flash * 0.9, flash * 0.8);
      v.materials.body.color.copy(v.bodyColor).lerp(new THREE.Color(1, 1, 1), flash * 0.6);
      if (flash > 0) {   // small deterministic shudder (no Math.random anywhere in the viewer either)
        v.model.position.set(Math.sin(time * 97 + v.id) * 0.03 * flash * tileSize, 0, Math.cos(time * 83 + v.id) * 0.03 * flash * tileSize);
      } else v.model.position.set(0, 0, 0);

      // worker cargo
      if (v.parts.carry) {
        const c = u.carrying ?? 0;
        v.parts.carry.visible = c > 0;
        if (c > 0) { v.parts.carry.scale.setScalar(0.6 + 0.4 * Math.min(1, c / 10)); v.parts.carry.rotation.y = time * 2; }
      }

      // animation
      const walkPhase = v.spec.rig === 'quad' ? alpha * Math.PI : (tick + alpha) * Math.PI * v.spec.stride;
      animate(v, pose, alpha, walkPhase, time, dt);

      // spawn pop
      const since = time - v.spawnAt;
      const spawnScale = since < SPAWN_SECONDS ? Math.max(0.01, easeOutBack(since / SPAWN_SECONDS)) : 1;

      // death: topple, sink, fade
      if (v.dying) {
        animateDeath(v, spawnScale);
      } else {
        v.model.rotation.x = 0;
        v.model.rotation.z = 0;
        v.model.scale.setScalar(spawnScale);
        // health bar
        if (u.hp > v.maxHp) v.maxHp = u.hp;
        const hb = healthBarState({ hp: u.hp, maxHp: v.maxHp, sinceHit: time - v.lastHitAt });
        setHealthBar(v.bar, hb, v.materials.colors.glow);
        if (hb.visible && ctx.camera) v.bar.group.quaternion.copy(ctx.camera.quaternion);
      }
    };

    for (const u of next?.units ?? []) handle(u.id);
    for (const u of prev?.units ?? []) handle(u.id);

    // units in neither state: a dying unit keeps its animation going (playback usually passes several ticks in
    // under a second); anything else was scrubbed away and goes at once
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
    for (const tm of teamMats) for (const k of Object.keys(tm)) if (tm[k]?.dispose) tm[k].dispose();
  }

  // positionOf(id) -> THREE.Vector3 of the unit's current world position (for vfx / camera), or null.
  function positionOf(id) {
    const v = views.get(id);
    return v ? v.holder.position.clone() : null;
  }

  return { update, dispose, positionOf, get count() { return views.size; }, kinds: UNIT_KINDS_3D, _views: views };
}

export default createUnits;
