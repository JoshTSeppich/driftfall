// The cute blocky toasters as DATA (owner: sonnet). Mirrors the Design Studio's blocky look (STYLE-BIBLE.md section 0,
// play/style-lab/blocky.mjs): every toaster is 2-4 plain parts: a cream box, a charcoal face with two square eyes, a
// team-colour block, one wide foot box and golden toast. Under 60 triangles each. Pure data and pure maths, no Three.js,
// so tests/toaster-units.test.mjs checks every number in node. Model units: feet at y = 0, front faces +Z.
//
//   TOASTERS[id] = { id, height, radius, parts: [{ id, part, pivot, geo, size, pos, rotZ?, hinge? }] }
//   part   = the batch it is drawn in: chassis | faceplate | eyes | team | feet | toast | wheel
//   pivot  = which rigid piece moves it: body | toast | feet | panel | coil | wheel
//   geo    = box (12 tris) | plane (2 tris, faces +Z) | wheel (five-sided prism, 20 tris)

export const COLORS = Object.freeze({
  chassis: '#F2D7A6', faceplate: '#303844', toast: '#D99448', feet: '#434A52',
  cyan: '#32D9E8', orange: '#FF8540', eye: '#F7F4EB', eyeOff: '#14181e', flash: '#FFFFFF',
});

export const GEO_TRIS = Object.freeze({ box: 12, plane: 2, wheel: 20 });
export const TOASTER_KINDS = Object.freeze(['crumb', 'popper', 'zapper', 'four-slice', 'broiler', 'flak-popper', 'bagel']);

// Sim kind -> toaster. The old Driftfall names stay mapped (play/coil-motion.mjs toastinatorFor); the roster names and
// any unknown kind fall back to the Popper so no unit is ever invisible.
const KIND_TO_TOASTER = Object.freeze({
  worker: 'crumb', grunt: 'popper', lancer: 'zapper', brute: 'four-slice', dart: 'bagel', howler: 'broiler',
  crumb: 'crumb', popper: 'popper', zapper: 'zapper', fourslice: 'four-slice', broiler: 'broiler',
  flakpopper: 'flak-popper', flak: 'flak-popper', bagel: 'bagel',
  spiker: 'flak-popper', mender: 'crumb', shade: 'popper', conduit: 'zapper',
});
export function toasterKindOf(kind) {
  const k = String(kind ?? '').trim().toLowerCase().replace(/[_\s-]+/g, '');
  return KIND_TO_TOASTER[k] ?? 'popper';
}

// Compact recipe -> parts. Recipes are the only per-toaster data; the face rules are shared so every toaster reads as
// the same family (STYLE-BIBLE section 0: "same design family, different silhouettes").
const FACE_Z = 0.006;
function build(id, r) {
  const [w, h, d] = r.body, fh = r.feetH ?? 0.1, by = fh + h / 2, top = fh + h;
  const parts = [];
  const add = (p) => parts.push(p);
  add({ id: 'feet', part: 'feet', pivot: 'feet', geo: 'box', size: [w * 0.92, fh, d * 0.85], pos: [0, fh / 2, 0] });
  if (r.wheel) {
    add({ id: 'wheel', part: 'chassis', pivot: 'wheel', geo: 'wheel', size: [r.wheel, r.wheel, d], pos: [0, by, 0] });
  } else {
    add({ id: 'body', part: 'chassis', pivot: 'body', geo: 'box', size: [w, h, d], pos: [0, by, 0] });
  }
  const fy = by + h * 0.08;
  add({ id: 'face', part: 'faceplate', pivot: 'body', geo: 'plane', size: [w * 0.72, h * 0.44, 1], pos: [0, fy, d / 2 + FACE_Z] });
  for (const s of [-1, 1]) {
    add({ id: s < 0 ? 'eye-left' : 'eye-right', part: 'eyes', pivot: 'body', geo: 'plane', size: [w * 0.15, h * 0.14, 1], pos: [s * w * 0.17, fy, d / 2 + FACE_Z * 3], eye: s });
  }
  if (r.team) add({ id: 'team', part: 'team', pivot: 'body', geo: 'box', size: r.team.size, pos: r.team.pos ?? [w * 0.27, top + r.team.size[1] / 2 - 0.02, 0] });
  for (const [i, e] of (r.emitters ?? []).entries()) {
    add({ id: `emitter-${i}`, part: 'team', pivot: 'coil', geo: 'box', size: e.size, pos: [e.x, top + e.size[1] / 2 - 0.02, e.z ?? 0] });
  }
  for (const [i, t] of (r.toast ?? []).entries()) {
    add({ id: `toast-${i}`, part: 'toast', pivot: 'toast', geo: t.geo ?? 'box', size: t.size, pos: [t.x ?? 0, top + t.size[1] / 2 - (t.sink ?? 0.1), t.z ?? 0], rotZ: t.rotZ });
  }
  if (r.panel) add({ id: 'panel', part: 'feet', pivot: 'panel', geo: 'box', size: r.panel.size, pos: r.panel.pos, hinge: r.panel.hinge });
  return Object.freeze({ id, top, height: top + (r.toast?.length ? Math.max(...r.toast.map((t) => t.size[1] - (t.sink ?? 0.1))) : 0), radius: Math.max(w, d) * 0.55, parts: Object.freeze(parts) });
}

export const TOASTERS = Object.freeze({
  // small cube
  crumb: build('crumb', { body: [0.56, 0.56, 0.5], team: { size: [0.18, 0.1, 0.22] }, toast: [{ size: [0.34, 0.26, 0.07], sink: 0.06 }] }),
  // taller box, tall toast slab
  popper: build('popper', { body: [0.66, 0.76, 0.56], team: { size: [0.2, 0.12, 0.26] }, toast: [{ size: [0.42, 0.52, 0.08], sink: 0.12 }] }),
  // box with two block emitters on top, no toast
  zapper: build('zapper', { body: [0.62, 0.7, 0.54], emitters: [{ x: -0.18, size: [0.16, 0.3, 0.16] }, { x: 0.18, size: [0.16, 0.3, 0.16] }] }),
  // wide, long box with four slabs
  'four-slice': build('four-slice', { body: [1.12, 0.78, 0.74], team: { size: [0.26, 0.12, 0.3], pos: [0.44, 1.0, 0] },
    toast: [-0.39, -0.13, 0.13, 0.39].map((x) => ({ x, size: [0.2, 0.46, 0.06], geo: 'plane', sink: 0.04 })) }),
  // box with a hinged front panel (the broiler door)
  broiler: build('broiler', { body: [0.84, 0.7, 0.66], team: { size: [0.24, 0.12, 0.3] }, feetH: 0.12,
    panel: { size: [0.74, 0.3, 0.05], pos: [0, 0.22, 0.375], hinge: [0, 0.12, 0.37] } }),
  // popper with three fanned flak slices
  'flak-popper': build('flak-popper', { body: [0.7, 0.76, 0.58], team: { size: [0.2, 0.12, 0.26] },
    toast: [{ x: -0.2, size: [0.24, 0.44, 0.06], geo: 'plane', rotZ: 0.3, sink: 0.08 }, { size: [0.24, 0.52, 0.06], geo: 'plane', sink: 0.08 }, { x: 0.2, size: [0.24, 0.44, 0.06], geo: 'plane', rotZ: -0.3, sink: 0.08 }] }),
  // short five-sided wheel rolled on its edge
  bagel: build('bagel', { body: [0.8, 0.8, 0.36], wheel: 0.88, team: { size: [0.18, 0.1, 0.2], pos: [0, 1.0, 0] }, feetH: 0.06 }),
});

export function triangleCount(id) {
  return TOASTERS[id].parts.reduce((n, p) => n + GEO_TRIS[p.geo], 0);
}
// "Main" pieces = distinct rigid pivots (STYLE-BIBLE: 2-4 parts per unit, each on its own pivot).
export function mainPartCount(id) {
  return new Set(TOASTERS[id].parts.map((p) => p.pivot)).size;
}
