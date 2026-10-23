// Coil Engine: aiming and reach. Whole-body aim (Zapper turns to its target, Flak Popper leans back), a spring-driven
// aimer that turns the short way round, and a two-bone solver for hinged reaches (lever, Broiler door arm).
// Angle convention everywhere: yaw 0 faces +z, yaw = atan2(dx, dz). Pure maths, no Three.js. Owner: fable.
import { createSpring, stepSpring } from './springs.mjs';
import { wrapAngle } from './interpolate.mjs';

export function shortestAngle(from, to) { return wrapAngle(to - from); }
export function yawTo(dx, dz) { return Math.atan2(dx, dz); }
export function pitchTo(dx, dz, dy) { return Math.atan2(dy, Math.hypot(dx, dz)); }

export function createAimer(angle = 0, k = 90, d = 14) {
  const s = createSpring(angle, k, d);
  return {
    get angle() { return s.x; },
    get velocity() { return s.v; },
    set(a) { s.x = a; s.v = 0; },
    step(target, dt) {
      stepSpring(s, s.x + shortestAngle(s.x, target), dt);
      s.x = wrapAngle(s.x);
      return s.x;
    },
  };
}

// Joint angles for a two-bone limb in a plane. a1 is the first bone's angle from +x, a2 the elbow bend relative to it.
// Unreachable targets stretch the limb straight toward the target (reached = false).
export function solveTwoBone(l1, l2, tx, ty, out = {}) {
  const dist = Math.hypot(tx, ty), lo = Math.abs(l1 - l2) + 1e-9, hi = l1 + l2;
  const dd = Math.min(hi, Math.max(lo, dist));
  const c2 = Math.min(1, Math.max(-1, (dd * dd - l1 * l1 - l2 * l2) / (2 * l1 * l2)));
  const a2 = Math.acos(c2);
  out.a2 = a2;
  out.a1 = Math.atan2(ty, tx) - Math.atan2(l2 * Math.sin(a2), l1 + l2 * c2);
  out.reached = dist <= hi + 1e-9 && dist >= lo - 1e-9;
  out.x = l1 * Math.cos(out.a1) + l2 * Math.cos(out.a1 + a2);
  out.y = l1 * Math.sin(out.a1) + l2 * Math.sin(out.a1 + a2);
  return out;
}
