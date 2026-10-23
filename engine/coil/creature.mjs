// Coil Engine: the creature rig. One rigid toaster body on a damped-spring suspension, hop/stomp/waddle/roll/fly
// locomotion that plants its base (no sliding), child parts on their own springs, an optional cord chain, and
// action poses (attack, gather, deliver, hit, die, spawn, siege). Pure maths, no Three.js, deterministic.
// Owner: fable.
//
//   const c = createCreature('crumb', { seed: unitId });            // id from specs.mjs, or a full spec object
//   c.update(dt, { x, z, y?, heading?, aim?: { x, z } }, { action, carrying?, lod? });   // every render frame
//   const j = c.joints();     // same object every call, overwritten in place: copy what you need
//
// Conventions (three.js): yaw 0 faces +z, yaw = atan2(dx, dz); Euler order YXZ (yaw, then pitch, then roll).
// pitch > 0 tips the front down, roll > 0 raises the +x (left) side. Scale pivots at the base, so squash keeps the
// feet on the ground. Parts are offsets/angles from their rest pose in the body's local space.
//
// joints() = { visible, alive, planted, speed, action,
//   root:  { x, y, z, yaw, pitch, roll, spin, sx, sy, sz, flash },     spin = roll-gait rotation (rad) for the rolling part
//   parts: { [name]: { y, rx, ry, rz, glow } },                         toast pop, lever, coil heat, door hinge, dial...
//   cord:  Float64Array [x,y,z, ...] world positions, or null,
//   events: [{ type, x, y, z, ... }] }
// events this frame: takeoff, land, thump (stomp landing), strike, fire, deliver, sparks, shatter, hit.
import { createSpring, stepSpring, kickSpring } from './springs.mjs';
import { GAITS, createGaitState, advanceGait, sampleGait } from './gaits.mjs';
import { createChain } from './spine.mjs';
import { createAimer, yawTo } from './ik.mjs';
import { makeSpec } from './specs.mjs';

const MAX_DT = 0.1, TELEPORT = 6;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const hash01 = n => { let h = (Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; return (h ^ (h >>> 16)) / 4294967296; };

export const ACTIONS = ['idle', 'move', 'attack', 'gather', 'deliver', 'hit', 'die', 'spawn', 'siege'];

export function createCreature(specOrId, opts = {}) {
  const spec = typeof specOrId === 'string' ? makeSpec(specOrId, opts.overrides) : { ...specOrId };
  const gait = { ...GAITS[spec.gait] };
  if (!gait.kind) throw new Error(`Unknown gait: ${spec.gait}`);
  if (spec.stride) gait.stride = spec.stride;
  if (spec.hopHeight != null && gait.kind === 'hop') gait.height = spec.hopHeight;
  const seed = opts.seed ?? 0, phase0 = hash01(seed) * Math.PI * 2;
  const A = spec.attack;

  const gs = createGaitState(), gout = {};
  const compress = createSpring(0, spec.stiffness, spec.damping);
  const pitchS = createSpring(0, 140, 14), rollS = createSpring(0, 120, 12);
  const spawnS = createSpring(1, 220, 10);
  const yaw = createAimer(0, 70, 14);
  const chain = spec.cord ? createChain({ count: spec.cord.count, spacing: spec.cord.spacing, floor: 0 }) : null;
  const P = {};   // part springs: a = y offset / hinge, b = tilt
  for (const name of spec.parts) if (name !== 'cord') P[name] = { a: createSpring(0, 230, 12), b: createSpring(0, 380, 19), glow: 0, ry: 0 };

  const out = {
    visible: true, alive: true, planted: true, speed: 0, action: 'idle',
    root: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, spin: 0, sx: 1, sy: 1, sz: 1, flash: 0 },
    parts: {}, cord: chain ? chain.positions : null, events: [],
  };
  for (const name of Object.keys(P)) out.parts[name] = { y: 0, rx: 0, ry: 0, rz: 0, glow: 0 };

  let ready = false, lx = 0, lz = 0, pathYaw = 0, speed = 0, lastSpeed = 0, accel = 0, yawRate = 0, lastYawT = 0;
  let action = 'idle', actionT = 0, age = 0, cycleDone = -1, dead = false, flash = 0, deliverKick = false;

  function ev(type, extra) { out.events.push({ type, x: out.root.x, y: out.root.y, z: out.root.z, ...extra }); }

  function enter(next) {
    action = next; actionT = 0; cycleDone = -1; deliverKick = false;
    if (next === 'hit') hit(0, 0, 1);
    if (next === 'spawn') { spawnS.x = 0.02; spawnS.v = 0; }
    if (next === 'die') ev('sparks');
    if (next === 'deliver') { ev('deliver'); deliverKick = true; }
  }

  function hit(dx, dz, strength = 1) {
    const f = dx * Math.sin(yaw.angle) + dz * Math.cos(yaw.angle), r = dx * Math.cos(yaw.angle) - dz * Math.sin(yaw.angle);
    kickSpring(pitchS, -f * strength * 8 || strength * 4);
    kickSpring(rollS, (r * strength * 8) || (hash01(seed + age * 7 | 0) < 0.5 ? -1 : 1) * strength * 5);
    kickSpring(compress, strength * 3);
    flash = 1;
    ev('hit', { strength });
  }

  // Targets for the part springs this frame, from the action state. Returns nothing: writes into P[name].t*
  function drivePart(name, p) {
    let ta = 0, tb = 0, glow = 0;
    const t = actionT, att = action === 'attack';
    if (name === 'toast') {
      if (att && A.style === 'bonk') {
        const c = t % A.period;
        if (c < A.windup) ta = -0.12; else if (c < A.windup + A.snap + A.resolve) { ta = 0.95; tb = -0.7; }
      } else if (att && A.style === 'flak') { const c = t % A.period; if (c > A.windup && c < A.windup + A.snap + A.resolve) ta = 1.4; }
      else if (action === 'gather') { ta = clamp(t / 0.8, 0, 1) * 0.4; glow = clamp(t / 0.8, 0, 1) * 0.7; }
      else if (action === 'deliver') { ta = t < 0.25 ? 1.0 : 0; }
      else if (p.carry) { ta = 0.4; glow = 0.35; }
    } else if (name === 'lever') {
      ta = action === 'gather' ? -0.18 : att ? (t % A.period < A.windup ? 0.08 : -0.1) : 0;
    } else if (name === 'coil') {
      if (att && A.style === 'zap') {
        const c = t % A.period;
        glow = c < A.charge ? clamp(c / A.charge, 0, 1) : Math.max(0, 1 - (c - A.charge) / 0.09);
        ta = c >= A.charge && c < A.charge + 0.09 ? 0.1 : 0;
      }
    } else if (name === 'door') {
      ta = action === 'siege' ? spec.doorOpen : 0;
    } else if (name === 'dial') {
      glow = att || action === 'siege' ? 0.6 : 0.1;
      p.ry += (att || action === 'siege' ? 6 : 1.2) * lastDt;
    } else if (name === 'glow') {
      glow = 0.4 + 0.2 * Math.sin(age * 3 + phase0);
    } else if (name === 'beep') {
      glow = Math.sin(age * 9 + phase0) > 0.85 ? 1 : 0;
    } else if (name === 'wingL' || name === 'wingR') {
      const flap = Math.sin(age * 16 + phase0 + (name === 'wingR' ? Math.PI : 0)) * (0.5 + speed * 0.1);
      tb = name === 'wingL' ? flap : -flap;
    }
    p.ta = ta; p.tb = tb; p.glowT = glow;
  }
  let lastDt = 0;

  return {
    spec, gait,
    hit,
    impulse(dx, dz, strength = 1) { hit(dx, dz, strength); },
    joints() { return out; },
    update(dt, target, state = {}) {
      out.events.length = 0;
      const tx = target.x, tz = target.z, ty = target.y ?? 0;
      if (!Number.isFinite(tx + tz + ty)) return out;
      if (!(dt > 0) || !Number.isFinite(dt)) dt = 0; else if (dt > MAX_DT) dt = MAX_DT;
      lastDt = dt;
      const next = ACTIONS.includes(state.action) ? state.action : 'idle';
      if (!ready) { lx = tx; lz = tz; ready = true; yaw.set(target.heading ?? 0); pathYaw = target.heading ?? 0; action = next; if (next === 'spawn') enter('spawn'); }
      if (dead) { out.visible = false; return out; }
      if (next !== action) enter(next); else actionT += dt;
      age += dt;

      // -- path speed and heading from the interpolated sim position
      let vx = 0, vz = 0;
      if (dt > 0) { vx = (tx - lx) / dt; vz = (tz - lz) / dt; }
      const jump = Math.hypot(tx - lx, tz - lz) > TELEPORT;
      if (jump) { vx = vz = 0; gs.phase = Math.ceil(gs.phase); if (chain) chain.reset(tx, ty, tz); }
      lx = tx; lz = tz;
      speed = Math.hypot(vx, vz);
      if (speed > 0.15) pathYaw = Math.atan2(vx, vz);
      if (dt > 0) { accel += ((speed - lastSpeed) / dt - accel) * Math.min(1, dt / 0.08); lastSpeed = speed; }

      // -- heading: face travel, or face the aim point when stationary (or for turret-style bodies)
      let wantYaw = Number.isFinite(target.heading) ? target.heading : pathYaw;
      const fighting = action === 'attack' || action === 'siege';
      if (target.aim && fighting && (speed < 0.3 || spec.aimBody)) wantYaw = yawTo(target.aim.x - tx, target.aim.z - tz);
      const prevYaw = yaw.angle;
      yaw.step(wantYaw, dt);
      if (dt > 0) { let dy = yaw.angle - prevYaw; if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI; yawRate += (dy / dt - yawRate) * Math.min(1, dt / 0.1); }

      // -- gait and suspension
      const dying = action === 'die';
      advanceGait(gs, gait, dying ? 0 : speed, dt);
      sampleGait(gait, gs, speed, gout);
      if (gs.takeoff) { kickSpring(compress, -spec.takeKick); ev('takeoff'); }
      if (gs.landed) {
        kickSpring(compress, spec.landKick * gs.impact); ev('land', { impact: gs.impact });
        if (gait.thump) ev('thump', { impact: gs.impact });
      }
      const squashT = (gait.kind === 'hop' && gout.planted && speed > MIN_MOVE ? gout.crouch * gout.crouch * spec.crouchDepth : 0) + (dying ? 0.5 : 0);
      stepSpring(compress, squashT, dt);

      // -- lean into acceleration, bank into turns, action recoil
      let pitchT = clamp(accel * spec.leanGain, -spec.leanMax, spec.leanMax) + (gait.kind === 'roll' ? 0 : clamp(speed * 0.02, 0, 0.08));
      let rollT = clamp(-yawRate * Math.min(speed, 3) * spec.bankGain * 0.3, -spec.bankMax, spec.bankMax) + (gout.sway || 0);
      const c = actionT % A.period;
      if (action === 'attack') {
        if (A.style === 'bonk') pitchT += c >= A.windup && c < A.windup + A.snap ? 0.22 : c < A.windup ? -0.08 : 0;
        else if (A.style === 'zap') pitchT += c >= A.charge && c < A.charge + 0.1 ? -0.3 : 0;
        else if (A.style === 'flak') pitchT += c < A.windup + A.snap + A.resolve ? -0.48 : 0;
        const strikeAt = A.style === 'zap' ? A.charge : A.windup, cycle = Math.floor(actionT / A.period);
        if (cycle > cycleDone && c >= strikeAt) { cycleDone = cycle; ev(A.style === 'bonk' ? 'strike' : 'fire'); }
      } else if (dying) { rollT += Math.sin(age * 40) * 0.15; }
      stepSpring(pitchS, pitchT, dt); stepSpring(rollS, rollT, dt);
      if (dying && actionT >= spec.dieSparks) { dead = true; out.alive = false; ev('shatter', { seed }); }
      if (action === 'spawn') stepSpring(spawnS, 1, dt); else if (spawnS.x !== 1) stepSpring(spawnS, 1, dt);

      // -- parts
      for (const name of Object.keys(P)) {
        const p = P[name], o = out.parts[name];
        if (state.carrying !== undefined) p.carry = !!state.carrying;
        else if (action === 'gather') p.carry = true; else if (action === 'deliver') p.carry = false;
        drivePart(name, p);
        if (deliverKick && name === 'toast') { kickSpring(p.a, 9); }
        stepSpring(p.a, p.ta, dt, p.a.k, name === 'door' ? 9 : p.a.d); stepSpring(p.b, p.tb, dt);
        p.glow += (p.glowT - p.glow) * Math.min(1, dt / (name === 'coil' ? 0.008 : 0.03));
        if (name === 'door') { o.y = 0; o.rx = p.a.x; } else if (name === 'coil' || name === 'dial' || name === 'toast' || name === 'lever') { o.y = p.a.x; o.rx = p.b.x; } else { o.y = p.a.x; o.rx = p.b.x; }
        o.ry = p.ry; o.glow = clamp(p.glow, 0, 1);
      }
      deliverKick = false;
      flash = Math.max(0, flash - dt / 0.12);

      // -- assemble the root
      const so = Math.sin(pathYaw), co = Math.cos(pathYaw), off = gout.offset * gait.stride;
      const r = out.root;
      r.x = tx + so * off; r.z = tz + co * off;
      const hov = spec.hover, idle = gait.kind === 'fly' ? 0 : spec.idleBob * (1 + Math.sin(age * 4 + phase0)) * (speed < 0.1 ? 1 : 0);
      const arc = action === 'spawn' ? Math.sin(Math.PI * clamp(actionT / 0.45, 0, 1)) * 0.5 : 0;
      r.y = ty + hov + gout.lift + idle + arc;
      r.yaw = yaw.angle; r.pitch = pitchS.x; r.roll = rollS.x; r.spin = gout.spin; r.flash = flash;
      const q = clamp(compress.x, -0.6, 0.9), sp = Math.max(0, spawnS.x);
      r.sy = clamp(1 - q * 0.35, 0.6, 1.3) * sp; r.sx = r.sz = clamp(1 + q * 0.18, 0.9, 1.2) * sp;
      out.planted = gout.planted; out.speed = speed; out.action = action;
      if (chain && state.lod !== 1) {
        const k = spec.cord;
        chain.step(dt, r.x - Math.sin(r.yaw) * k.back, r.y + k.up, r.z - Math.cos(r.yaw) * k.back);
      }
      return out;
    },
  };
}

const MIN_MOVE = 0.1;
