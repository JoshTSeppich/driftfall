// The ?motion=coil adapter: the live game asks this for each unit's pose. It keeps one motion graph per unit id and
// maps each sim kind to its Toastinator (TERRITORY.md section 16). Presentation only: the sim is never touched and
// with the flag off nothing here runs. Owner: sonnet.
import { createMotionGraph } from '../engine/coil/motions.mjs';
import { MOTION_UNITS } from '../engine/coil/motion-specs.mjs';

const KIND_TO_TOASTINATOR = Object.freeze({
  worker: 'crumb', grunt: 'popper', lancer: 'zapper', brute: 'four-slice', dart: 'bagel', howler: 'broiler',
  // the toaster roster's own names (and the model ids of play/toaster-models.mjs) map to themselves
  crumb: 'crumb', popper: 'popper', zapper: 'zapper', 'four-slice': 'four-slice', fourslice: 'four-slice', broiler: 'broiler',
  'flak-popper': 'popper', flakpopper: 'popper', bagel: 'bagel',
});

export function coilEnabled(search = '') {
  return new URLSearchParams(search).get('motion') === 'coil';
}

export function toastinatorFor(kind) {
  return KIND_TO_TOASTINATOR[kind] ?? 'popper';
}

// Stable small seed from a unit id (number or string), so the same unit always shatters the same way.
function seedOf(id) {
  if (typeof id === 'number') return id >>> 0;
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function createCoilUnits() {
  const graphs = new Map();
  const graphFor = (id, kind) => {
    let g = graphs.get(id);
    if (!g) {
      g = createMotionGraph(MOTION_UNITS[toastinatorFor(kind)], { seed: seedOf(id) });
      graphs.set(id, g);
    }
    return g;
  };
  return {
    // input: { speed, dt, gathering?, carrying? }. Returns the pose for this frame, events included.
    pose(id, kind, input) { return graphFor(id, kind).update(input.dt ?? 1 / 60, input); },
    act(id, name, opts) { return graphs.get(id)?.trigger(name, opts) ?? false; },
    die(id, opts) { return graphs.get(id)?.die(opts) ?? false; },
    forget(id) { graphs.delete(id); },
    get size() { return graphs.size; },
  };
}
