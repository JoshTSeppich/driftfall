// The Coil motion engine: springs, hop cadence, the per-unit animation graph, physical events and pentagon shards.
// Pure math with no Three.js and no clock or randomness, so the same inputs give the same frames (replays match).
// Presentation only: the sim decides where a unit is; this decides how its body moves between ticks.
// Units are Toastinators (TERRITORY.md section 16); their numbers live in motion-specs.mjs. Owner: sonnet.

export const STATES = ['idle', 'move', 'gather', 'carry', 'strike', 'hit', 'die', 'spawn', 'rankUp'];

const SUBSTEP = 1 / 240;      // springs run in fixed substeps: stable at high stiffness, same result at any frame rate
const BLEND_SECONDS = 0.12;   // base-state crossfade
const KNOCK_SPEED = 1.2;      // metres per second of impulse from one full-strength hit
const FLINCH_SECONDS = 0.16;  // the existing hit flash length (feel.mjs FLASH_MS)
const SPAWN_SECONDS = 0.2;
const RANK_SECONDS = 0.5;
const SHAKE_DECAY = 8;        // per second
const GRAVITY = 12;           // toy scale, metres per second squared, for shard flight only
const ACTIONS = new Set(['strike', 'hit', 'spawn', 'rankUp']);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, w) => a + (b - a) * w;

// --- springs -----------------------------------------------------------------------------------------------------
export function createSpring({ stiffness = 200, damping = 16, value = 0, target = 0 } = {}) {
  return { stiffness, damping, value, target, velocity: 0 };
}

// Semi-implicit Euler in fixed substeps. Returns the new value.
export function stepSpring(s, dt) {
  let left = dt;
  while (left > 1e-12) {
    const h = Math.min(SUBSTEP, left);
    s.velocity += (s.stiffness * (s.target - s.value) - s.damping * s.velocity) * h;
    s.value += s.velocity * h;
    left -= h;
  }
  return s.value;
}

// --- hop cadence -------------------------------------------------------------------------------------------------
// phase is 0..1 over one hop. lift: 0 on the ground, 1 at the apex. squash: 1 on landing, fading by 10% of the cycle.
export function hopAt(phase) {
  const p = ((phase % 1) + 1) % 1;
  const lift = 4 * p * (1 - p);
  const squash = Math.max(0, 1 - p / 0.1, 1 - (1 - p) / 0.1);
  const stretch = lift * (1 - squash) * 0.5;
  return { lift, squash, stretch };
}

// Feet plant at the stride length, so one hop covers exactly one stride: no foot sliding at any speed.
export function advanceHop(phase, speed, dt, stride) {
  const raw = phase + (speed * dt) / stride;
  const contacts = Math.floor(raw);
  return { phase: raw - contacts, contacts };
}

// --- physical events ---------------------------------------------------------------------------------------------
function easeOutBack(x) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

// Seeded so the same death looks the same on replay.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Five-facet rule (ART-DIRECTION.md): every shard is a pentagon.
export function makeShards(count, { seed = 1, dir = { x: 0, z: 1 }, speed = 3 } = {}) {
  const rand = mulberry32(seed);
  const len = Math.hypot(dir.x, dir.z) || 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = 0.06 + 0.06 * rand();
    const verts = [];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    const along = speed * (0.5 + rand());
    out.push({
      verts,
      vel: {
        x: (dir.x / len) * along + (rand() - 0.5) * speed * 0.6,
        y: speed * (0.6 + 0.6 * rand()),
        z: (dir.z / len) * along + (rand() - 0.5) * speed * 0.6,
      },
      spin: (rand() - 0.5) * 12,
    });
  }
  return out;
}

// Shard offset `age` seconds after the death. Ballistic, so the renderer keeps no per-frame state.
export function shardAt(shard, age) {
  return {
    x: shard.vel.x * age,
    y: shard.vel.y * age - 0.5 * GRAVITY * age * age,
    z: shard.vel.z * age,
    angle: shard.spin * age,
  };
}

// A capped list of live shards. Past the cap the oldest are recycled, so a mass death never grows the pool.
export function createShardPool(capacity = 512) {
  const live = [];
  return {
    capacity,
    push(shards, t0) {
      for (const s of shards) live.push({ ...s, t0 });
      if (live.length > capacity) live.splice(0, live.length - capacity);
    },
    shards() { return live; },
    get size() { return live.length; },
  };
}

// --- animation graph ---------------------------------------------------------------------------------------------
const zeroPose = () => ({
  state: 'idle', blend: 1, visible: true, lift: 0, squash: 0, stretch: 0, leanX: 0, leanZ: 0, glow: 0,
  slotOpen: 0, toastPop: 0, scale: 1, spin: 0, fall: 0, flinch: 0, offX: 0, offZ: 0, shakeX: 0, shakeZ: 0,
  planted: false, events: [],
});

// One graph per unit. Base layer (idle, move, carry, gather) follows the input and crossfades. Action layer on top
// (strike, hit, spawn, rankUp) plays once. Death (die) is terminal: a ragdoll fall, then one shatter event.
export function createMotionGraph(spec, { seed = 1 } = {}) {
  const g = {
    spec, seed,
    base: 'idle', baseTime: 0, phase: 0, spin: 0, lastSpeed: 0, plants: 0,
    blendT: BLEND_SECONDS, from: zeroPose(), last: zeroPose(),
    action: null, actionT: 0, strikeHit: false, rankFired: false, actionStrength: 1,
    dir: { x: 0, z: 1 },
    dead: false, deathT: 0, shattered: false,
    offX: createSpring({ stiffness: spec.stiffness, damping: spec.damping }),
    offZ: createSpring({ stiffness: spec.stiffness, damping: spec.damping }),
    quake: { amp: 0, t: 0, dx: 0, dz: 0 },
    get state() { return g.last.state; },
  };

  // Strike, hit, spawn, rankUp. Returns false if the unit is dead or the name is unknown.
  g.trigger = (name, opts = {}) => {
    if (g.dead || !ACTIONS.has(name)) return false;
    if (name === 'hit') {
      const d = opts.dir ?? { x: 0, z: 0 };
      const k = (opts.strength ?? 1) * KNOCK_SPEED;
      g.offX.velocity += d.x * k;
      g.offZ.velocity += d.z * k;
    }
    if (opts.dir) g.dir = opts.dir;
    g.action = name; g.actionT = 0; g.strikeHit = false; g.rankFired = false;
    g.actionStrength = opts.strength ?? 1;
    return true;
  };

  // Death: the unit falls over along dir, then shatters into pentagon shards exactly once.
  g.die = (opts = {}) => {
    if (g.dead) return false;
    g.dead = true; g.deathT = 0; g.action = null;
    if (opts.dir) g.dir = opts.dir;
    g.actionStrength = opts.strength ?? 1;
    return true;
  };

  // Quake or big-hit shake: a one-sided shove along the facet axis that decays (no rotation).
  g.shake = (amount, dir) => {
    const len = Math.hypot(dir.x, dir.z) || 1;
    g.quake = { amp: amount, t: 0, dx: dir.x / len, dz: dir.z / len };
  };

  g.update = (dt, input = {}) => {
    const speed = input.speed ?? 0;
    const accel = dt > 0 ? (speed - g.lastSpeed) / dt : 0;
    g.lastSpeed = speed;
    const p = zeroPose();

    // Base layer. Death freezes it and snaps the pose to the fall.
    if (g.dead) {
      g.deathT += dt;
      g.blendT = BLEND_SECONDS;
    } else {
      const next = baseFor(input);
      if (next !== g.base) { g.from = g.last; g.base = next; g.baseTime = 0; g.blendT = 0; }
      g.baseTime += dt;
      g.blendT += dt;
      if (g.base === 'move' || g.base === 'carry') {
        const adv = advanceHop(g.phase, speed, dt, g.spec.stride);
        g.phase = adv.phase;
        g.plants += adv.contacts;
        g.spin += (speed * dt) / 0.35;
      }
    }
    const w = clamp(g.blendT / BLEND_SECONDS, 0, 1);
    const now = g.dead ? zeroPose() : basePose(g, speed, input.carrying);
    for (const k of ['lift', 'squash', 'stretch', 'glow', 'slotOpen', 'spin']) p[k] = lerp(g.from[k], now[k], w);
    p.planted = now.planted;
    p.leanX = clamp(-accel * 0.02, -0.2, 0.2);
    p.blend = w;

    // Action layer.
    if (g.action) { g.actionT += dt; actionPose(g, p); }
    if (g.dead) deathPose(g, p);

    // Spring knock-back and quake shove.
    p.offX = stepSpring(g.offX, dt);
    p.offZ = stepSpring(g.offZ, dt);
    if (g.quake.amp > 0) {
      g.quake.t += dt;
      const a = g.quake.amp * Math.exp(-SHAKE_DECAY * g.quake.t);
      p.shakeX = a * g.quake.dx;
      p.shakeZ = a * g.quake.dz;
      if (a < 1e-4) g.quake.amp = 0;
    }

    if (g.plants > 0) { p.events.push({ type: 'plant' }); g.plants = 0; }
    p.state = g.dead ? 'die' : g.action ?? g.base;
    p.spin = g.spin;
    g.last = p;
    return p;
  };

  return g;
}

function baseFor(input) {
  if (input.gathering) return 'gather';
  if ((input.speed ?? 0) > 0.05) return input.carrying ? 'carry' : 'move';
  return 'idle';
}

function basePose(g, speed, carrying) {
  const p = zeroPose();
  const s = g.spec;
  const bt = g.baseTime;
  if (g.base === 'idle') {
    p.squash = 0.02 * Math.sin((2 * Math.PI * bt) / 1.6);
    p.lift = 0.01 * (1 + Math.sin((2 * Math.PI * bt) / 1.6));
  } else if (g.base === 'move' || g.base === 'carry') {
    const hop = hopAt(g.phase);
    const gait = s.gait === 'roll' ? 0 : s.gait === 'stomp' ? 0.7 : 1;
    const height = clamp(speed / s.topSpeed, 0.4, 1) * gait;
    p.lift = hop.lift * s.hopHeight * height;
    p.squash = hop.squash * 0.25 * height;
    p.stretch = hop.stretch * 0.3 * height;
    p.planted = hop.lift < 0.02;
    p.slotOpen = carrying || g.base === 'carry' ? 0.6 : 0;
    p.glow = g.base === 'carry' ? 0.4 : 0;
  } else if (g.base === 'gather') {
    p.slotOpen = 0.5 + 0.5 * Math.sin((2 * Math.PI * bt) / 1.2);
    p.glow = clamp(bt / 0.5, 0, 1);
    p.lift = 0.02 * Math.abs(Math.sin((2 * Math.PI * bt) / 1.2));
  }
  return p;
}

function actionPose(g, p) {
  const s = g.spec;
  const t = g.actionT;
  if (g.action === 'strike') {
    const { windup, snap, resolve } = s.strike;
    if (t < windup) {
      p.squash += 0.15 * (t / windup);
    } else if (t < windup + snap) {
      const u = (t - windup) / snap;
      p.toastPop = 1 - (1 - u) * (1 - u);
      p.squash += 0.15 * (1 - u);
    } else {
      p.toastPop = 1 - clamp((t - windup - snap) / resolve, 0, 1);
    }
    if (!g.strikeHit && t >= windup) { g.strikeHit = true; p.events.push({ type: 'strike-hit' }); }
    if (t >= windup + snap + resolve) endAction(g);
  } else if (g.action === 'hit') {
    p.flinch = g.actionStrength * clamp(1 - t / FLINCH_SECONDS, 0, 1);
    if (t >= FLINCH_SECONDS) endAction(g);
  } else if (g.action === 'spawn') {
    p.scale = Math.max(0, easeOutBack(clamp(t / SPAWN_SECONDS, 0, 1)));
    if (t >= SPAWN_SECONDS) endAction(g);
  } else if (g.action === 'rankUp') {
    const u = clamp(t / RANK_SECONDS, 0, 1);
    p.glow = Math.sin(Math.PI * u);
    p.scale = 1 + 0.15 * Math.sin(Math.PI * u);
    if (!g.rankFired) { g.rankFired = true; p.events.push({ type: 'rank-up' }); }
    if (t >= RANK_SECONDS) endAction(g);
  }
}

function endAction(g) { g.action = null; g.actionT = 0; }

function deathPose(g, p) {
  const fall = clamp(g.deathT / g.spec.fallSeconds, 0, 1);
  p.fall = fall;
  p.leanX = g.dir.x * fall * 1.2;
  p.leanZ = g.dir.z * fall * 1.2;
  if (g.deathT >= g.spec.fallSeconds && !g.shattered) {
    g.shattered = true;
    p.events.push({ type: 'shatter', shards: makeShards(g.spec.shards, { seed: g.seed, dir: g.dir, speed: 3 * g.actionStrength + 1 }) });
  }
  if (g.shattered) p.visible = false;
}
