# Coil Engine core (fable)

Pure modules, no Three.js, deterministic. Presentation only: the sim in env/ stays the authority.

| File | What |
|---|---|
| `springs.mjs` | damped springs, substepped, stable at any dt (`createSpring`, `stepSpring`, `kickSpring`, `springFromHz`) |
| `interpolate.mjs` | 24 tps -> 60 fps: `createInterpolator(24).push(tick, pose)`, `.sample(tick + alpha - 1, out)`; angles wrap the short way, teleports snap |
| `spine.mjs` | follow-the-leader verlet chain (`createChain`) for cords, antennae, hoses |
| `gaits.mjs` | `GAITS` hop / stomp / waddle / roll / fly, driven by distance so planted bases never slide |
| `ik.mjs` | `createAimer` (spring yaw), `yawTo`, `pitchTo`, `solveTwoBone` |
| `specs.mjs` | creature specs by Toastinator id; `KIND_TO_SPEC` maps sim kinds; reads `motion-specs.mjs` |
| `creature.mjs` | `createCreature(id or spec, { seed })` |

```js
const c = createCreature('crumb', { seed: unit.id });
// every render frame, with the INTERPOLATED sim position:
const j = c.update(dt, { x, z, y?, heading?, aim?: { x, z } }, { action, carrying?, lod? });
// j is the same object every call: root{x,y,z,yaw,pitch,roll,spin,sx,sy,sz,flash}, parts{name:{y,rx,ry,rz,glow}},
// cord (Float64Array xyz or null), planted, speed, visible/alive, events[{type,x,y,z}]
c.hit(dx, dz, strength);   // knock impulse (also fired by action 'hit')
```

actions: idle move attack gather deliver hit die spawn siege. events: takeoff land thump strike fire deliver sparks
hit shatter (on shatter the creature hides; the shard pool in motions.mjs spawns the pentagon shards).
Conventions: yaw 0 = +z, yaw = atan2(dx, dz); Euler YXZ; pitch > 0 tips forward; scale pivots at the base.
Tests: `tests/coil-core.test.mjs`, `tests/coil-creature.test.mjs`.
