// The cute toasters as DATA (owner: sonnet), built from GPT's Cute Geometry Spec v1.0 (play/toaster-spec.mjs): big high
// face, big separated glowing eyes, oversized toast, team block on top, and (Joshua, 09:47) four little five-sided WHEELS
// instead of feet. Pure data and pure maths, no Three.js, so tests/toaster-units.test.mjs checks every number in node.
// Spec numbers that break the spec's own six CUTENESS rules (a few table rows do) are clamped into range by fit().
// Model units: CRUMB body width = 1, ground at y = 0, front faces +Z. The renderer's unit scale turns them into tiles.
//
//   TOASTERS[id] = { id, top, height, radius, body: {w,h,d,lift}, wheels: [{x,y,z,r,w}] | null, parts: [part] }
//   part = { id, part, pivot, geo, size, pos, rotZ?, eye?, hinge?, spin? }
//   part  = the batch: chassis | faceplate | eyes | team | feet | toast | glow | tyre | hub | prism
//   pivot = which rigid piece moves it: body | toast | coil | panel | roll (bagel) | axle (a wheel: spins about its own x)
//   geo   = box | plane | tyre (five-sided prism, axis x) | prism (bagel, axis z)

import { TOASTERS as SPEC, CUTENESS as RULE, EXPRESSIONS, PALETTE, WHEELS, CORD, toasterOf } from './toaster-spec.mjs';

export { EXPRESSIONS, WHEELS, CORD };
// Eyes are saturated cyan: pale #75F4FF washes out under the tone mapping, so the live eyes are drawn unlit in #12E4FF.
export const COLORS = Object.freeze({
  chassis: PALETTE.cream, faceplate: PALETTE.charcoal, toast: PALETTE.toast, feet: PALETTE.feet, heat: PALETTE.heat,
  cyan: '#12D8F0', orange: '#FF7A2E', eye: '#12E4FF', eyeOff: '#14181e', flash: '#FFFFFF',
});
export const GEO_TRIS = Object.freeze({ box: 12, plane: 2, tyre: 20, prism: 20 });
export const TOASTER_KINDS = Object.freeze(['crumb', 'popper', 'zapper', 'four-slice', 'broiler', 'flak-popper', 'bagel']);

// Sim kind -> toaster. The old Driftfall names stay mapped; roster names and any unknown kind fall back to the Popper so no
// unit is ever invisible. (toaster-spec.mjs toasterOf does the same for exact ids.)
const KIND_TO_TOASTER = Object.freeze({
  worker: 'crumb', grunt: 'popper', lancer: 'zapper', brute: 'four-slice', dart: 'bagel', howler: 'broiler',
  crumb: 'crumb', popper: 'popper', zapper: 'zapper', fourslice: 'four-slice', broiler: 'broiler',
  flakpopper: 'flak-popper', flak: 'flak-popper', bagel: 'bagel',
  spiker: 'flak-popper', mender: 'crumb', shade: 'popper', conduit: 'zapper',
});
export function toasterKindOf(kind) {
  const k = String(kind ?? '').trim().toLowerCase().replace(/[_\s-]+/g, '');
  return KIND_TO_TOASTER[k] ?? toasterOf(kind);
}

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
const FACE_Z = 0.008;         // the face decal floats this far in front of the body
const EYE_Z = 0.012;          // and the eyes this far in front of the face
const PIVOT = { root: 'body', body: 'body', face: 'body', feet: 'body', toast: 'toast', striker: 'toast', volley: 'toast', emitter: 'coil', launcher: 'coil', door: 'panel', wheel: 'roll' };

function build(id) {
  const spec = SPEC[id];
  const get = (n) => spec.find((p) => p.name === n);
  const body = get('body'), face = get('face'), eye = get('eye'), team = get('team');
  const [W, H, D] = body.size;
  const isBagel = id === 'bagel';
  const wheelD = isBagel ? 0 : WHEELS.diameterOfBodyH * H;
  const lift = isBagel ? 0 : WHEELS.lift * wheelD;        // wheels tuck under, the body floats this high
  const parts = [];
  const add = (p) => parts.push(Object.freeze(p));

  add(isBagel
    ? { id: 'body', part: 'prism', pivot: 'roll', geo: 'prism', size: [...body.size], pos: [...body.pos] }
    : { id: 'body', part: 'chassis', pivot: 'body', geo: 'box', size: [W, H, D], pos: [0, lift + H / 2, 0] });

  // Face and eyes, fitted to the six rules. Face height is a share of the body height, centred a share up the body.
  const fw = clamp(face.size[0] / W, RULE.faceWidthOfBody), fh = clamp(face.size[1] / H, RULE.faceHeightOfBody);
  const FW = fw * W, FH = fh * H;
  const fcy = clamp(face.pos[1] / H, RULE.faceCentreOfBodyHeight) * H;
  const frontZ = D / 2 + FACE_Z;
  add({ id: 'face', part: 'faceplate', pivot: 'body', geo: 'plane', size: [FW, FH, 1], pos: [0, lift + fcy, frontZ] });
  const ew = clamp(eye.size[0] / face.size[0], RULE.eyeWidthOfFace) * FW;
  const eh = clamp(eye.size[1] / face.size[1], RULE.eyeHeightOfFace) * FH;
  const ex = clamp(2 * eye.pos[0] / face.size[0], RULE.eyeSpacingOfFace) * FW / 2;
  const ey = fcy + clamp((eye.pos[1] - face.pos[1]) / face.size[1], RULE.eyeAboveFaceCentre) * FH;
  for (const s of [-1, 1]) {
    add({ id: s < 0 ? 'eye-left' : 'eye-right', part: 'eyes', pivot: 'body', geo: 'plane', size: [ew, eh, 1], pos: [s * ex, lift + ey, frontZ + EYE_Z], eye: s });
  }

  // The team block sits on top, a rule-width block.
  const tw = clamp(team.size[0] / W, RULE.teamWidthOfBody) * W;
  add({ id: 'team', part: 'team', pivot: 'body', geo: 'box', size: [tw, team.size[1], team.size[2]], pos: [team.pos[0], lift + team.pos[1], team.pos[2]] });

  // Everything else in the spec: toast, emitters, barrels, the broiler door, heat glows.
  let n = 0;
  for (const p of spec) {
    if (['body', 'face', 'eye', 'team', 'foot'].includes(p.name)) continue;
    const mirrors = p.mirror ? [-1, 1] : [1];
    for (const m of mirrors) {
      const pos = [p.pos[0] * m, p.pos[1] + lift, p.pos[2]];
      const base = { id: `${p.name}-${n++}`, pivot: PIVOT[p.pivot] ?? 'body', size: [...p.size], pos };
      if (p.name === 'toast') add({ ...base, part: 'toast', geo: 'box', size: [clamp(p.size[0] / W, RULE.toastWidthOfBody) * W, p.size[1], p.size[2]] });
      else if (p.name === 'glow') add({ ...base, part: 'glow', geo: 'box' });
      else if (p.name === 'door') add({ ...base, part: 'feet', geo: 'box', hinge: [pos[0], pos[1] - p.size[1] / 2, pos[2] + p.size[2] / 2] });
      else add({ ...base, part: 'feet', geo: 'box' });                 // emitter, barrel: dark charcoal blocks
    }
  }

  // Four wheels (every toaster except the Bagel, which is one). Front axle sits frontInset of the depth back from the front.
  let wheels = null;
  if (!isBagel) {
    const tyreW = WHEELS.widthOfBodyW * W, cx = W / 2 + WHEELS.outsideSides * W - tyreW / 2, cz = D / 2 - WHEELS.frontInset * D;
    wheels = [];
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const w = { x: sx * cx, y: wheelD / 2, z: sz * cz, r: wheelD / 2, w: tyreW, side: sx };
      wheels.push(w);
      add({ id: `tyre-${wheels.length}`, part: 'tyre', pivot: 'axle', geo: 'tyre', size: [tyreW, wheelD, wheelD], pos: [w.x, w.y, w.z] });
      add({ id: `hub-${wheels.length}`, part: 'hub', pivot: 'axle', geo: 'tyre', size: [tyreW * 1.12, wheelD * WHEELS.hubOfDiameter, wheelD * WHEELS.hubOfDiameter], pos: [w.x, w.y, w.z] });
    }
  }

  const bodyTop = isBagel ? body.pos[1] + H / 2 : lift + H;
  const toasts = parts.filter((p) => p.part === 'toast');
  const height = Math.max(bodyTop, ...toasts.map((p) => p.pos[1] + p.size[1] / 2));
  return Object.freeze({
    id, top: bodyTop, height, radius: Math.max(W, D) * 0.55 + (isBagel ? 0 : WHEELS.outsideSides * W),
    body: Object.freeze({ w: W, h: H, d: D, lift }), wheels: wheels && Object.freeze(wheels),
    fit: Object.freeze({ faceW: FW, faceH: FH, faceY: fcy, eyeW: ew, eyeH: eh, eyeX: ex, eyeY: ey }),
    parts: Object.freeze(parts),
  });
}

export const TOASTERS = Object.freeze(Object.fromEntries(TOASTER_KINDS.map((id) => [id, build(id)])));

export function triangleCount(id) {
  return TOASTERS[id].parts.reduce((n, p) => n + GEO_TRIS[p.geo], 0);
}
// "Main" pieces = distinct rigid pivots (body, toast, wheels...).
export function mainPartCount(id) {
  return new Set(TOASTERS[id].parts.map((p) => p.pivot)).size;
}
