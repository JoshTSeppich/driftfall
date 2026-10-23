// Toaster Wars buildings as blocky toys (owner: sonnet, Playable Client): the Power Strip (the base), the Mill, the Well and
// the Toaster. Cream and charcoal blocks, five-sided rounds, a team-colour block on each, and cute faces where a toaster
// would have one. Same palette and proportions as the units (play/toaster-models.mjs), so a base reads as one family.
// viewer3d/buildings.mjs asks for these through ctx.buildingLook(THREE, kind, owner) and falls back to its own builders
// for anything this returns null for (Assembly Line, Heat Lamp).
//
//   buildToasterBody(T, kind, owner) -> { kind, body, spin, pulse, head, furnace, muzzle, barrels, stackTop, tick(clock, dt) } | null
//   toasterBuildingLook = buildToasterBody   (the ctx hook)
// Units here are tiles; a model sits on y = 0 and stays inside about 1.4 tiles.
import { COLORS } from './toaster-models.mjs';

export const TOASTER_BUILDING_KINDS = Object.freeze(['core', 'mill', 'well', 'toaster']);
const TEAM = [COLORS.cyan, COLORS.orange];
const WATER = '#4aa8d8';

export function buildToasterBody(T, kind, owner) {
  if (!TOASTER_BUILDING_KINDS.includes(kind)) return null;
  const body = new T.Group();
  const parts = { kind, body, spin: [], pulse: [], head: null, furnace: null, muzzle: null, barrels: [], tick: null };
  const team = TEAM[owner] ?? TEAM[0];
  const mat = (c, extra = {}) => new T.MeshStandardMaterial({ color: new T.Color(c), roughness: 0.78, metalness: 0.02, ...extra });
  const glowMat = (c) => { const m = new T.MeshBasicMaterial({ color: new T.Color(c) }); m.toneMapped = false; return m; };
  const add = (parent, name, geo, material, x, y, z) => {
    const m = new T.Mesh(geo, material);
    m.name = name; m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    parent.add(m); return m;
  };
  const box = (parent, name, w, h, d, c, x, y, z) => add(parent, name, new T.BoxGeometry(w, h, d), mat(c), x, y, z);
  const eyes = (parent, y, z, spread, size, faceW) => {
    const plate = add(parent, 'face', new T.BoxGeometry(faceW, size * 2.2, 0.02), mat(COLORS.faceplate), 0, y, z);
    for (const s of [-1, 1]) add(parent, s < 0 ? 'eye-left' : 'eye-right', new T.BoxGeometry(size * 0.75, size, 0.02), glowMat(COLORS.eye), s * spread, y + size * 0.1, z + 0.014);
    return plate;
  };
  const teamBox = (parent, w, h, d, x, y, z) => add(parent, 'team', new T.BoxGeometry(w, h, d), mat(team), x, y, z);

  if (kind === 'core') {
    // Power Strip: a long cream bar on four little feet, five dark sockets on top, a team switch, a face, a cord loop out the back.
    box(body, 'strip', 1.3, 0.34, 0.6, COLORS.chassis, 0, 0.27, 0);
    for (const sx of [-0.52, 0.52]) for (const sz of [-0.2, 0.2]) box(body, 'foot', 0.18, 0.1, 0.16, COLORS.feet, sx, 0.05, sz);
    const sockets = new T.Group(); sockets.name = 'sockets'; body.add(sockets);
    for (let i = 0; i < 5; i++) add(sockets, `socket-${i}`, new T.BoxGeometry(0.16, 0.03, 0.2), mat(COLORS.faceplate), -0.5 + i * 0.25, 0.445, -0.1);
    eyes(body, 0.27, 0.306, 0.2, 0.1, 0.62);
    const light = teamBox(body, 0.2, 0.09, 0.16, 0.52, 0.47, 0.17);
    parts.pulse.push({ obj: light, base: 1, amp: 0.12, speed: 2.4 });
    const cord = add(body, 'cord', new T.TorusGeometry(0.2, 0.04, 5, 10, Math.PI * 1.6), mat(COLORS.faceplate), -0.68, 0.3, -0.12);
    cord.rotation.set(0, Math.PI / 2, 0);
    box(body, 'plug', 0.1, 0.1, 0.16, COLORS.faceplate, -0.68, 0.06, 0.12);
  } else if (kind === 'mill') {
    // Mill: a cream tower with a toast-brown roof, a team door and four blades that turn on the front.
    add(body, 'tower', new T.CylinderGeometry(0.26, 0.36, 0.7, 4).rotateY(Math.PI / 4), mat(COLORS.chassis), 0, 0.35, 0);
    add(body, 'roof', new T.ConeGeometry(0.42, 0.34, 4).rotateY(Math.PI / 4), mat(COLORS.toast), 0, 0.87, 0);
    teamBox(body, 0.18, 0.26, 0.04, 0, 0.13, 0.31);
    box(body, 'window', 0.12, 0.12, 0.03, COLORS.faceplate, 0, 0.52, 0.24);
    const pivot = new T.Group(); pivot.position.set(0, 0.62, 0.3); pivot.rotation.x = Math.PI / 2; body.add(pivot);
    const hub = new T.Group(); hub.name = 'blades'; pivot.add(hub);
    for (let i = 0; i < 4; i++) {
      const arm = new T.Group(); arm.rotation.y = (i * Math.PI) / 2; hub.add(arm);
      add(arm, `blade-${i}`, new T.BoxGeometry(0.1, 0.03, 0.46), mat(i % 2 ? COLORS.toast : COLORS.chassis), 0, 0, 0.25);
    }
    add(pivot, 'axle', new T.CylinderGeometry(0.06, 0.06, 0.08, 5), mat(team), 0, 0, 0);
    parts.spin.push({ obj: hub, speed: 0.9 });
  } else if (kind === 'well') {
    // Well: a five-sided stone ring round blue water, two posts, a team-colour roof and a bucket.
    add(body, 'ring', new T.CylinderGeometry(0.42, 0.46, 0.3, 5), mat(COLORS.chassis), 0, 0.15, 0);
    const water = add(body, 'water', new T.CylinderGeometry(0.31, 0.31, 0.04, 5), glowMat(WATER), 0, 0.29, 0);
    water.castShadow = false;
    parts.pulse.push({ obj: water, base: 1, amp: 0.05, speed: 1.7 });
    for (const s of [-1, 1]) box(body, 'post', 0.06, 0.55, 0.06, COLORS.faceplate, s * 0.34, 0.55, 0);
    add(body, 'roof', new T.ConeGeometry(0.5, 0.26, 4).rotateY(Math.PI / 4), mat(team), 0, 0.95, 0);
    box(body, 'beam', 0.7, 0.05, 0.05, COLORS.faceplate, 0, 0.82, 0);
    const bucket = box(body, 'bucket', 0.12, 0.12, 0.12, COLORS.toast, 0, 0.6, 0);
    parts.tick = (clock) => { bucket.position.y = 0.6 + 0.04 * Math.sin(clock * 1.4); };
  } else if (kind === 'toaster') {
    // Toaster: a big cream box with a face, two slots, two slices of toast that bob up and down, a lever and a team block.
    box(body, 'toaster', 0.9, 0.56, 0.62, COLORS.chassis, 0, 0.28 + 0.04, 0);
    for (const x of [-0.48, 0.48]) for (const z of [-0.2, 0.2]) box(body, 'foot', 0.14, 0.08, 0.14, COLORS.feet, x * 0.8, 0.04, z);
    const toasts = [];
    for (const [name, x] of [['toast-left', -0.17], ['toast-right', 0.17]]) {
      box(body, `slot-${name}`, 0.26, 0.03, 0.1, COLORS.faceplate, x, 0.605, 0);
      toasts.push(box(body, name, 0.22, 0.3, 0.07, COLORS.toast, x, 0.66, 0));
    }
    eyes(body, 0.36, 0.316, 0.18, 0.1, 0.58);
    teamBox(body, 0.24, 0.1, 0.2, -0.28, 0.63, 0.2);
    box(body, 'lever', 0.05, 0.22, 0.05, COLORS.faceplate, 0.5, 0.4, 0.12);
    box(body, 'knob', 0.1, 0.07, 0.08, COLORS.heat, 0.5, 0.53, 0.12);
    const rest = toasts.map((t) => t.position.y);
    parts.tick = (clock) => toasts.forEach((t, i) => { t.position.y = rest[i] + 0.07 * (0.5 + 0.5 * Math.sin(clock * 1.6 + i * Math.PI)); });
    parts.stackTop = new T.Vector3(0, 0.95, 0);
  }
  return parts;
}

export const toasterBuildingLook = buildToasterBody;
