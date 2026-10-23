// Coil Engine: damped springs for secondary motion (suspension, lever, toast, door, lean).
// Pure maths, no Three.js. Owner: fable.
//
// A spring is a plain object { x, v, k, d }: position, velocity, stiffness, damping. stepSpring integrates it with
// fixed small substeps (semi-implicit Euler), so it stays stable and nearly frame-rate independent at any dt; absurd
// or non-finite dt is clamped or ignored instead of exploding.

export const MAX_DT = 0.1;      // longest slice one call will integrate (tab suspension, hitches)
const SUB_DT = 1 / 120;         // preferred substep

export function createSpring(x = 0, k = 150, d = 18) { return { x, v: 0, k, d }; }

// k and d from a natural frequency in Hz and a damping ratio (1 = critically damped, <1 wobbles).
export function springFromHz(hz, zeta = 1) { const w = 2 * Math.PI * hz; return { k: w * w, d: 2 * zeta * w }; }

export function stepSpring(s, target, dt, k = s.k, d = s.d) {
  if (!(dt > 0) || !Number.isFinite(dt)) return s.x;
  if (dt > MAX_DT) dt = MAX_DT;
  const h = Math.min(SUB_DT, 0.4 / Math.sqrt(k), 0.5 / d);
  const n = Math.ceil(dt / h), hh = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += ((target - s.x) * k - s.v * d) * hh;
    s.x += s.v * hh;
  }
  return s.x;
}

export function kickSpring(s, dv) { s.v += dv; return s; }
export function resetSpring(s, x = 0) { s.x = x; s.v = 0; return s; }
export function settled(s, target, eps = 1e-3) { return Math.abs(s.x - target) < eps && Math.abs(s.v) < eps; }
