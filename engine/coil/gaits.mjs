// Coil Engine: gaits for rigid toaster bodies, driven by DISTANCE, not time, so stride matches speed and nothing
// slides. Gait phase P advances by distance/stride; the integer part counts steps. Pure maths. Owner: fable.
//
// hop/stomp: each cycle is [planted contact | airborne arc]. The visual body is held back (offset <= 0, in strides)
// during contact and catches up during flight, so the base is truly still on the ground while planted. offset
// stays within -contact..0 and lands on exactly 0 at the end of every hop.
// waddle: feet alternate, small lift and sway. roll: spins by distance/radius, always touching. fly: hover bob.

export const GAITS = {
  hop:    { kind: 'hop',    stride: 0.9, contact: 0.3,  height: 0.3,  refSpeed: 2.2, finishRate: 2.5 },
  stomp:  { kind: 'hop',    stride: 1.4, contact: 0.45, height: 0.18, refSpeed: 1.4, finishRate: 1.6, thump: true },
  waddle: { kind: 'waddle', stride: 0.8, height: 0.05, sway: 0.2, refSpeed: 1.5, finishRate: 2 },
  roll:   { kind: 'roll',   stride: 1.1, radius: 0.35, height: 0, refSpeed: 3 },
  fly:    { kind: 'fly',    stride: 1.6, height: 0.06, refSpeed: 2, idleRate: 0.5 },
};

const MAX_DT = 0.1, MIN_SPEED = 0.05;

export function createGaitState() { return { phase: 0, takeoff: false, landed: false, impact: 0 }; }

export function advanceGait(st, g, speed, dt) {
  st.takeoff = st.landed = false; st.impact = 0;
  if (!(dt > 0) || !Number.isFinite(dt)) return st;
  if (dt > MAX_DT) dt = MAX_DT;
  const before = st.phase;
  const rate = Math.max(0, speed) / g.stride;
  if (g.kind === 'roll') st.phase += rate * dt;
  else if (g.kind === 'fly') st.phase += Math.max(rate, g.idleRate ?? 0.5) * dt;
  else if (speed < MIN_SPEED) {
    const next = Math.ceil(st.phase - 1e-12);      // finish the step in progress, then rest on the ground
    if (next > st.phase) st.phase = Math.min(next, st.phase + g.finishRate * dt);
  } else st.phase += rate * dt;
  if (g.kind === 'hop') {
    const a = before, b = st.phase;
    if (Math.floor(b - g.contact) > Math.floor(a - g.contact)) st.takeoff = true;
    if (Math.floor(b) > Math.floor(a)) { st.landed = true; st.impact = Math.min(1, Math.max(0.35, speed / g.refSpeed)); }
  }
  return st;
}

export function sampleGait(g, st, speed, out = {}) {
  const P = st.phase, n = Math.floor(P), p = P - n;
  out.lift = 0; out.offset = 0; out.planted = true; out.crouch = 0; out.sway = 0; out.spin = 0;
  if (g.kind === 'hop') {
    const c = g.contact;
    if (p < c) { out.crouch = p / c; out.offset = n - P; }   // gathering for the next hop, held back while planted
    else {
      const s = (p - c) / (1 - c), w = 0.5 * s + 0.5 * s * s * (3 - 2 * s);
      const amp = Math.min(1, Math.max(0.45, speed / g.refSpeed));
      out.lift = 4 * g.height * amp * s * (1 - s); out.planted = false;
      out.offset = n + w - P;
    }
  } else if (g.kind === 'waddle') {
    out.lift = g.height * Math.abs(Math.sin(Math.PI * P)); out.sway = g.sway * Math.sin(Math.PI * P);
  } else if (g.kind === 'roll') {
    out.spin = P * g.stride / g.radius;
  } else if (g.kind === 'fly') {
    out.lift = g.height * (1 + Math.sin(2 * Math.PI * P)); out.sway = 0.05 * Math.sin(2 * Math.PI * P + 1); out.planted = false;
  }
  return out;
}
