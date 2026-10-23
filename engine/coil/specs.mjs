// Coil Engine: creature specs, the data createCreature() reads. A new unit is mostly a few numbers here.
// Toastinator names per TERRITORY.md section 16. Numbers that sonnet owns in motion-specs.mjs (stride, hop height,
// stiffness, damping, strike timings) are read from there when the id matches, so there is one source for them.
// Owner: fable.
import { MOTION_UNITS } from './motion-specs.mjs';

// attack styles: bonk (toast pops up and whacks), zap (coil heats orange, then fires), flak (leans back, toast shot up)
const BASE = {
  gait: 'hop', stride: null, hopHeight: null,
  stiffness: 260, damping: 20, landKick: 10, takeKick: 9, crouchDepth: 0.2,
  leanGain: 0.05, leanMax: 0.3, bankGain: 0.35, bankMax: 0.35, idleBob: 0.01,
  aimBody: false, hover: 0, parts: [], cord: null, doorOpen: -1.4, dial: false,
  attack: { style: 'bonk', period: 1.1, windup: 0.09, snap: 0.07, resolve: 0.14, charge: 0.2 },
  dieSparks: 0.25, mass: 1,
};

const D = {
  crumb: { parts: ['toast', 'lever', 'cord'], cord: { count: 6, spacing: 0.1, back: 0.28, up: 0.12 } },
  popper: { parts: ['toast', 'lever'] },
  zapper: { parts: ['coil', 'lever'], aimBody: true, attack: { style: 'zap' } },
  'four-slice': { gait: 'stomp', parts: ['toast', 'lever'], landKick: 14, leanGain: 0.03 },
  'flak-popper': { parts: ['toast', 'lever'], aimBody: true, attack: { style: 'flak', period: 1.1 } },
  broiler: { gait: 'stomp', parts: ['door', 'dial'], landKick: 12, dial: true },
  bagel: { gait: 'roll', parts: ['hub'], landKick: 0, takeKick: 0, bankGain: 0.6, bankMax: 0.5 },
  defroster: { gait: 'waddle', parts: ['glow'] },
  timer: { parts: ['dial'], dial: true },
  'cold-toast': { parts: ['toast'], landKick: 5, leanGain: 0.02 },
  'flying-toast': { gait: 'fly', hover: 1.1, parts: ['wingL', 'wingR'], landKick: 0, takeKick: 0, idleBob: 0 },
  breadbox: { gait: 'fly', hover: 1.0, parts: ['lid'], landKick: 0, takeKick: 0, leanGain: 0.02, idleBob: 0 },
  'smoke-alarm': { gait: 'fly', hover: 1.4, parts: ['beep'], landKick: 0, takeKick: 0, idleBob: 0 },
};

// sim unit kind (env/stats.mjs UNIT_KINDS) -> spec id
export const KIND_TO_SPEC = {
  worker: 'crumb', grunt: 'popper', lancer: 'zapper', brute: 'four-slice', spiker: 'flak-popper', howler: 'broiler',
  dart: 'bagel', mender: 'defroster', shade: 'cold-toast', conduit: 'timer', skiff: 'flying-toast', barge: 'breadbox', seer: 'smoke-alarm',
};

export const SPEC_IDS = Object.freeze(Object.keys(D));

export function makeSpec(id, overrides = {}) {
  const d = D[id];
  if (!d) throw new Error(`Unknown creature spec: ${id}`);
  const m = MOTION_UNITS[id] ?? {};
  const spec = { ...BASE, ...d, id };
  if (m.gait) spec.gait = m.gait;
  if (m.stride) spec.stride = m.stride;
  if (m.hopHeight) spec.hopHeight = m.hopHeight;
  if (m.stiffness) spec.stiffness = m.stiffness;
  if (m.damping) spec.damping = m.damping;
  spec.attack = { ...BASE.attack, ...(m.strike ?? {}), ...(d.attack ?? {}) };
  return Object.assign(spec, overrides);
}
