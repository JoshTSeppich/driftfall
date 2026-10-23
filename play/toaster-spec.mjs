// TOASTER WARS: Cute Geometry Build Spec v1.0 (GPT, 23 Oct 2026). Pure data, shared by the Design Studio and the
// live game, so both draw the SAME cute toasters. Source: research/CUTE-SPEC-GPT.md.
// Coordinates: +X right, +Y up, +Z forward (toward the camera). Origin = bottom-centre of the body. CRUMB body width = 1.
// Each part: [name, [w,h,d], [x,y,z], colour, pivot]. A part with mirror:true repeats at -x.
// Triangle budget (GPT's note): one box for the chassis, two instanced foot boxes and one functional assembly; draw the
// faceplate, eyes, team marks and glows as planar decals or shader rectangles where the 60-triangle cap needs it.
export const PALETTE = Object.freeze({
  cream: '#F2D7A6', charcoal: '#303844', cyan: '#32D9E8', orange: '#FF8540', toast: '#D99448',
  feet: '#434A52', eyes: '#75F4FF', heat: '#F25745',
});
const P = (name, size, pos, colour, pivot, extra = {}) => Object.freeze({ name, size, pos, colour, pivot, ...extra });
export const TOASTERS = Object.freeze({
  crumb: [
    P('body', [1.00, 0.86, 0.76], [0, 0.43, 0], 'cream', 'root'),
    P('face', [0.66, 0.43, 0.02], [0, 0.48, 0.388], 'charcoal', 'body', { decal: true }),
    P('eye', [0.115, 0.16, 0.012], [0.175, 0.52, 0.403], 'eyes', 'face', { mirror: true, emissive: true }),
    P('foot', [0.27, 0.19, 0.36], [0.39, 0.08, 0.17], 'feet', 'feet', { mirror: true }),
    P('toast', [0.30, 0.36, 0.10], [0, 0.98, -0.04], 'toast', 'toast'),
    P('team', [0.38, 0.11, 0.25], [-0.25, 0.88, 0], 'team', 'body'),
  ],
  popper: [
    P('body', [1.25, 1.18, 0.84], [0, 0.59, 0], 'cream', 'root'),
    P('face', [0.88, 0.53, 0.02], [0, 0.70, 0.428], 'charcoal', 'body', { decal: true }),
    P('eye', [0.17, 0.19, 0.012], [0.225, 0.74, 0.443], 'eyes', 'face', { mirror: true, emissive: true }),
    P('foot', [0.32, 0.27, 0.42], [0.49, 0.10, 0.20], 'feet', 'feet', { mirror: true }),
    P('toast', [0.48, 0.78, 0.13], [0, 1.47, -0.04], 'toast', 'striker'),
    P('team', [0.42, 0.12, 0.30], [-0.36, 1.20, -0.03], 'team', 'body'),
  ],
  zapper: [
    P('body', [1.38, 0.98, 0.95], [0, 0.49, 0], 'cream', 'root'),
    P('face', [0.94, 0.48, 0.02], [0, 0.59, 0.483], 'charcoal', 'body', { decal: true }),
    P('eye', [0.16, 0.20, 0.012], [0.245, 0.62, 0.498], 'eyes', 'face', { mirror: true, emissive: true }),
    P('foot', [0.33, 0.24, 0.43], [0.53, 0.10, 0.23], 'feet', 'feet', { mirror: true }),
    P('emitter', [0.25, 0.24, 0.54], [0.43, 1.04, 0.30], 'feet', 'emitter', { mirror: true }),
    P('team', [0.40, 0.12, 0.28], [0, 1.00, -0.20], 'team', 'body'),
    P('glow', [0.17, 0.14, 0.012], [0.43, 1.04, 0.577], 'heat', 'emitter', { mirror: true, emissive: true, decal: true }),
  ],
  'four-slice': [
    P('body', [2.30, 1.38, 1.35], [0, 0.69, 0], 'cream', 'root'),
    P('face', [1.48, 0.63, 0.02], [0, 0.81, 0.683], 'charcoal', 'body', { decal: true }),
    P('eye', [0.26, 0.25, 0.012], [0.41, 0.88, 0.698], 'eyes', 'face', { mirror: true, emissive: true }),
    P('foot', [0.46, 0.34, 0.58], [0.88, 0.13, 0.28], 'feet', 'feet', { mirror: true }),
    P('toast', [0.31, 0.69, 0.15], [0.66, 1.58, -0.10], 'toast', 'volley', { mirror: true }),
    P('toast', [0.31, 0.69, 0.15], [0.22, 1.58, -0.10], 'toast', 'volley', { mirror: true }),
    P('team', [0.58, 0.13, 0.39], [-0.78, 1.40, -0.32], 'team', 'body'),
  ],
  broiler: [
    P('body', [1.65, 1.20, 1.12], [0, 0.60, 0], 'cream', 'root'),
    P('face', [1.00, 0.48, 0.02], [0, 0.86, 0.573], 'charcoal', 'body', { decal: true }),
    P('eye', [0.19, 0.18, 0.012], [0.28, 0.89, 0.588], 'eyes', 'face', { mirror: true, emissive: true }),
    P('foot', [0.38, 0.29, 0.48], [0.64, 0.11, 0.19], 'feet', 'feet', { mirror: true }),
    P('door', [1.16, 0.37, 0.09], [0, 0.35, 0.64], 'feet', 'door'),
    P('team', [0.48, 0.12, 0.30], [-0.48, 1.22, -0.25], 'team', 'body'),
    P('glow', [0.96, 0.20, 0.01], [0, 0.37, 0.572], 'heat', 'body', { emissive: true, decal: true }),
  ],
  'flak-popper': [
    P('body', [1.30, 1.08, 0.93], [0, 0.54, 0], 'cream', 'root'),
    P('face', [0.90, 0.51, 0.02], [0, 0.63, 0.473], 'charcoal', 'body', { decal: true }),
    P('eye', [0.17, 0.19, 0.012], [0.23, 0.67, 0.488], 'eyes', 'face', { mirror: true, emissive: true }),
    P('foot', [0.32, 0.25, 0.42], [0.50, 0.10, 0.21], 'feet', 'feet', { mirror: true }),
    P('barrel', [0.23, 0.48, 0.26], [0.33, 1.31, -0.12], 'feet', 'launcher', { mirror: true }),
    P('team', [0.41, 0.12, 0.27], [0, 1.10, 0.26], 'team', 'body'),
    P('glow', [0.15, 0.01, 0.17], [0.33, 1.56, -0.12], 'heat', 'launcher', { mirror: true, emissive: true, decal: true }),
  ],
  bagel: [
    P('body', [1.25, 1.25, 0.44], [0, 0.63, 0], 'toast', 'wheel', { prism: 5 }), // vertical capped pentagonal prism, rolls about Z
    P('face', [0.67, 0.38, 0.02], [0, 0.70, 0.235], 'charcoal', 'wheel', { decal: true }),
    P('eye', [0.13, 0.16, 0.012], [0.18, 0.72, 0.250], 'eyes', 'face', { mirror: true, emissive: true }),
    P('team', [0.39, 0.12, 0.24], [0, 1.29, 0], 'team', 'wheel'),
  ],
});
// Eyes as fractions of the face width (FW) and height (FH); rotation in degrees (+ = inward).
export const EXPRESSIONS = Object.freeze({
  determined: { w: 0.18, h: 0.36, x: 0.27, y: 0.08, rot: 12 },
  happy: { w: 0.19, h: 0.28, x: 0.27, y: 0.10, rot: -7 },
  alarmed: { w: 0.15, h: 0.48, x: 0.27, y: 0.04, rot: 0 },
});
// GPT's six cuteness rules as checkable ranges (tests should assert every toaster meets them).
export const CUTENESS = Object.freeze({
  faceWidthOfBody: [0.65, 0.72], faceHeightOfBody: [0.43, 0.52], faceCentreOfBodyHeight: [0.55, 0.75],
  eyeWidthOfFace: [0.17, 0.20], eyeHeightOfFace: [0.30, 0.48], eyeSpacingOfFace: [0.52, 0.56], eyeAboveFaceCentre: [0.04, 0.10],
  footWidthOfBody: [0.23, 0.28], footHeightOfBody: [0.20, 0.25], feetOutsideSides: [0.08, 0.15], feetBeyondFront: [0.15, 0.25],
  toastWidthOfBody: [0.30, 0.42], toastExposedAboveBody: [0.35, 0.55],
  teamWidthOfBody: [0.28, 0.38], teamOnTop: true, faceInset: [0.025, 0.04],
});
// Kind aliases: old sim kinds -> toaster.
export const KIND_ALIAS = Object.freeze({ worker: 'crumb', grunt: 'popper', lancer: 'zapper', brute: 'four-slice', howler: 'broiler', dart: 'bagel', flak: 'flak-popper' });
export const toasterOf = (kind) => TOASTERS[kind] ? kind : (KIND_ALIAS[kind] ?? 'popper');

// ---- Joshua, 09:47: "give them little toaster wheels and accentuate their power cords" ----
// WHEELS replace feet on every wheeled toaster (all except Bagel, which IS a wheel). Four little five-sided wheels
// (STYLE-BIBLE five-facet rule) poking out past the sides and front, charcoal tyre + cream hub cap, they spin when moving.
export const WHEELS = Object.freeze({
  count: 4,              // front pair + back pair
  diameterOfBodyH: 0.40, // wheel diameter as a fraction of body height (chunky)
  widthOfBodyW: 0.16,    // tyre width as a fraction of body width
  outsideSides: 0.06,    // how far a wheel sticks out past the body side, fraction of body width
  frontInset: 0.18,      // front axle sits this fraction of depth back from the front face (back axle mirrors it)
  lift: 0.55,            // body bottom sits at this fraction of wheel diameter above ground (wheels tuck under)
  sides: 5, tyre: 'charcoal', hub: 'cream', hubOfDiameter: 0.42,
});
// CORD: the hero of Toaster Wars, so make it BOLD. Every toaster trails a thick cord from the back of its body to its
// power point: a little coiled spring right at the body (it stretches when the unit nears its cord limit), then a
// thick charcoal cable on the ground with a team-coloured glowing stripe and energy pulses running toward the toaster.
export const CORD = Object.freeze({
  radius: 0.085,              // THICK: reads at RTS zoom
  exitHeightOfBodyH: 0.35,    // leaves the back face this high up
  coilTurns: 3, coilRadius: 0.17, coilLength: 0.55, // springy coil at the back; stretches to 0 turns at the cord limit
  colour: 'team', colourEmissive: 0.35, stripe: 'charcoal', stripeEmissive: 0, // the cable itself is team colour
  pulseSpeed: 2.2, pulseSpacing: 0.9, pulseLength: 0.18, // tiles/s; glowing beads travelling toward the toaster
  plug: { size: [0.22, 0.16, 0.26], colour: 'cream', prongs: 2 }, // a chunky plug where it meets the outlet
  tautAt: 0.85,               // above 85% of cord length the cord pulls straight, the coil flattens and the stripe flashes
});
