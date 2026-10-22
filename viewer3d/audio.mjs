// Driftfall 3D audio (owner: haiku). Positional sound effects from assets/audio/MANIFEST.json, one ambient loop,
// master volume and mute. Sounds are picked from the events of each world frame; nothing here changes game state.
// If a file is missing or will not decode, a small synthesized stand-in is used, so the match is never silent by error.
// The pure helpers are what tests/viewer3d-audio.test.mjs covers; createAudio is the Three.js part.
import { STRUCTURE_KINDS, kindStats } from "../env/stats.mjs";

const MUTE_KEY = "driftfall.muted";
// Used only when MANIFEST.json cannot be read, so every event still has a sound kind.
const FALLBACK_EVENTS = {
  melee_hit: { kind: "impact" },
  ranged_shot: { kind: "shot" },
  heavy_impact: { kind: "impact" },
  explosion_death: { kind: "explosion" },
  building_placed: { kind: "build" },
  building_finished: { kind: "build" },
  resource_collected: { kind: "resource" },
  alert_under_attack: { kind: "alert" },
  victory: { kind: "stinger" },
  defeat: { kind: "stinger" },
  ambient_loop: { kind: "ambient", loop: true },
};

// Reads MANIFEST.json (spec in assets/audio/MANIFEST.json). Returns { root, events, problems } and never throws.
export function parseManifest(json) {
  const problems = [];
  if (!json || typeof json !== "object") {
    return { root: "", events: { ...FALLBACK_EVENTS }, problems: ["manifest missing or not an object"] };
  }
  const events = {};
  for (const [name, entry] of Object.entries(json.events || {})) {
    if (!entry || typeof entry.file !== "string" || entry.file === "") {
      problems.push(`${name}: no file`);
      continue;
    }
    events[name] = { file: entry.file, kind: typeof entry.kind === "string" ? entry.kind : "blip", loop: entry.loop === true };
  }
  if (Object.keys(events).length === 0) problems.push("manifest has no events");
  return { root: typeof json.root === "string" ? json.root : "", events, problems };
}

// URL of one file: the manifest's own folder plus the file name from its entry.
export function soundUrl(manifestUrl, file) {
  return manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1) + file;
}

// Entities by id from both frame states, so a hit or death that removed its target can still be placed.
export function makeLookup(prev, next) {
  const byId = new Map();
  for (const st of [prev, next]) {
    if (!st) continue;
    for (const e of [...st.units, ...st.structures]) if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return (id) => byId.get(id) || null;
}

// Turns one tick's events (spec section 12 names) into sound requests: { name, pos: {x, y} | null }.
// Unknown or uninteresting events give nothing.
export function chooseSounds(events, lookup) {
  const out = [];
  for (const ev of events || []) {
    if (ev.e === "hit") {
      const target = lookup(ev.id);
      if (!target) continue;
      const attacker = lookup(ev.by);
      const ranged = attacker !== null && (kindStats(attacker.kind)?.range ?? 1) >= 2;
      const structure = target.kind === "core" || STRUCTURE_KINDS.includes(target.kind);
      out.push({ name: ranged ? "ranged_shot" : structure ? "heavy_impact" : "melee_hit", pos: target, kind: "hit" });
      if (target.kind === "core") out.push({ name: "alert_under_attack", pos: target, kind: "alert" });
    } else if (ev.e === "die") {
      // A unit removed this tick is in prev; world.mjs also carries the dead record on the event itself.
      const dead = lookup(ev.id) || ev.entity || null;
      if (!dead) continue;
      const big = dead.kind === "brute" || dead.kind === "core" || STRUCTURE_KINDS.includes(dead.kind);
      out.push({ name: big ? "explosion_death" : "heavy_impact", pos: dead, kind: "death" });
    } else if (ev.e === "deliver") {
      const worker = lookup(ev.id);
      if (worker) out.push({ name: "resource_collected", pos: worker, kind: "resource" });
    } else if (ev.e === "spawn" && ev.structure) {
      out.push({ name: "building_placed", pos: ev.structure, kind: "build" });
    } else if (ev.e === "done") {
      const built = lookup(ev.id);
      if (built) out.push({ name: "building_finished", pos: built, kind: "build" });
    }
  }
  return out;
}

// Keeps a busy frame from becoming a wall of noise: at most `perName` of one sound and `max` in total per frame.
// Stingers (kind "stinger") are never dropped.
export function limitSounds(list, { perName = 2, max = 10 } = {}) {
  const counts = new Map();
  const out = [];
  let total = 0;
  for (const s of list) {
    const n = counts.get(s.name) || 0;
    if (n >= perName) continue;
    if (total >= max && s.kind !== "stinger") continue;
    counts.set(s.name, n + 1);
    total += 1;
    out.push(s);
  }
  return out;
}

// True when the frame moved on by one to three ticks, so events are new. A seek or a paused frame is not.
export function isForwardStep(prevTick, tick) {
  return prevTick >= 0 && tick > prevTick && tick - prevTick <= 3;
}

// Winner-based stinger name for the local side, or null for a draw or a match still running.
export function stingerFor(result, localSide = 0) {
  if (!result || (result.winner !== 0 && result.winner !== 1)) return null;
  return result.winner === localSide ? "victory" : "defeat";
}

// Small deterministic noise (no Math.random) so the stand-in sounds are the same every time.
function noiseSource(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 * 2 - 1;
  };
}

// Synthesized stand-in for a missing sound. Returns mono samples in -1..1.
export function proceduralSamples(kind, sampleRate = 22050) {
  const sec = (t) => Math.round(t * sampleRate);
  const make = (length, fn) => {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) out[i] = Math.max(-1, Math.min(1, fn(i / sampleRate, i)));
    return out;
  };
  const noise = noiseSource(kind.length * 7919);
  const tone = (f, t) => Math.sin(2 * Math.PI * f * t);
  switch (kind) {
    case "blip":
      return make(sec(0.07), (t) => 0.5 * tone(880, t) * Math.exp(-t * 40));
    case "shot":
      return make(sec(0.16), (t) => 0.5 * Math.sin(2 * Math.PI * (1400 - 2600 * t) * t) * Math.exp(-t * 14));
    case "impact":
      return make(sec(0.18), (t) => 0.7 * noise() * Math.exp(-t * 30));
    case "explosion":
      return make(sec(0.9), (t) => 0.8 * noise() * Math.exp(-t * 4));
    case "build":
      return make(sec(0.22), (t) => 0.35 * Math.sin(2 * Math.PI * (300 + 900 * t) * t) * Math.min(1, t * 30) * Math.exp(-t * 6));
    case "resource":
      return make(sec(0.09), (t) => 0.4 * tone(1200, t) * Math.exp(-t * 25));
    case "alert":
      return make(sec(0.3), (t) => 0.4 * tone(660, t) * (t % 0.15 < 0.11 ? 1 : 0));
    case "stinger":
      return make(sec(0.8), (t) => 0.3 * (tone(392, t) + tone(494, t) + tone(587, t)) * Math.exp(-t * 3));
    case "ambient":
      return make(sec(4), (t) => 0.12 * noise() * Math.sin(Math.PI * t / 4));
    default:
      return make(sec(0.1), (t) => 0.3 * tone(440, t) * Math.exp(-t * 20));
  }
}

function readMuted() {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeMuted(muted) {
  try {
    globalThis.localStorage?.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Storage can be blocked (private windows); the mute still works for this page.
  }
}

// The Three.js part. `ctx` comes from engine.mjs: THREE, scene, camera, gridToWorld(x, y).
// opts: { manifestUrl, volume, muted, localSide, refDistance, voices }.
// Returns { update(frame), setMuted(bool), toggleMute(), isMuted(), setVolume(v), dispose() }.
export function createAudio(ctx, opts = {}) {
  const THREE = ctx.THREE;
  const manifestUrl = opts.manifestUrl || "../assets/audio/MANIFEST.json";
  const voiceCount = opts.voices || 16;
  const listener = new THREE.AudioListener();
  (ctx.camera || ctx.scene).add(listener);
  const context = listener.context;

  let volume = Math.min(1, Math.max(0, opts.volume ?? 0.8));
  let muted = opts.muted ?? readMuted();
  listener.setMasterVolume(muted ? 0 : volume);

  const buffers = new Map();
  const kinds = new Map();
  let ready = false;
  let disposed = false;
  let unlocked = false;
  let ambient = null;
  let lastTick = -1;
  let resultPlayed = false;
  let voiceNext = 0;
  let played = 0;

  const voices = Array.from({ length: voiceCount }, () => {
    const holder = new THREE.Object3D();
    const sound = new THREE.PositionalAudio(listener);
    sound.setRefDistance(opts.refDistance ?? 6);
    sound.setRolloffFactor(1.4);
    holder.add(sound);
    ctx.scene.add(holder);
    return { holder, sound };
  });
  const stinger = new THREE.Audio(listener);

  function bufferFromSamples(samples) {
    const buf = context.createBuffer(1, samples.length, context.sampleRate || 22050);
    buf.copyToChannel(samples, 0);
    return buf;
  }

  function loadBuffer(url) {
    return new Promise((resolve, reject) => {
      new THREE.AudioLoader().load(url, resolve, undefined, reject);
    });
  }

  async function loadAll() {
    let json = null;
    try {
      json = await fetch(manifestUrl).then((r) => (r.ok ? r.json() : null));
    } catch {
      json = null;
    }
    const manifest = parseManifest(json);
    const entries = Object.keys(manifest.events).length ? manifest.events : FALLBACK_EVENTS;
    for (const [name, entry] of Object.entries(entries)) {
      kinds.set(name, entry.kind);
      let buffer = null;
      if (entry.file) {
        try {
          buffer = await loadBuffer(soundUrl(manifestUrl, entry.file));
        } catch {
          buffer = null;
        }
      }
      if (!buffer) buffer = bufferFromSamples(proceduralSamples(entry.kind));
      buffers.set(name, buffer);
    }
    ready = !disposed;
    if (ready && unlocked) startAmbient();
  }

  function startAmbient() {
    if (ambient || !buffers.has("ambient_loop")) return;
    ambient = new THREE.Audio(listener);
    ambient.setBuffer(buffers.get("ambient_loop"));
    ambient.setLoop(true);
    ambient.setVolume(0.3);
    ambient.play();
  }

  // Browsers only allow sound after a click or key press.
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    if (context.state === "suspended") context.resume();
    if (ready) startAmbient();
  };
  const unlockEvents = ["pointerdown", "keydown"];
  if (typeof window !== "undefined") unlockEvents.forEach((ev) => window.addEventListener(ev, unlock));

  loadAll().catch((err) => console.warn("driftfall audio: could not load sounds", err));

  function pickVoice() {
    const v = voices.find((x) => !x.sound.isPlaying);
    if (v) return v;
    voiceNext = (voiceNext + 1) % voices.length;
    return voices[voiceNext];
  }

  function playAt(name, pos) {
    const buffer = buffers.get(name);
    if (!buffer || kinds.get(name) === "ambient") return;
    const v = pickVoice();
    v.sound.stop();
    v.sound.setBuffer(buffer);
    v.sound.setVolume(0.9);
    // Small pitch variety so repeated hits don't sound identical. Deterministic, so a replay sounds the same.
    v.sound.setPlaybackRate(0.94 + ((played * 37) % 11) / 100);
    if (pos) {
      const world = ctx.gridToWorld ? ctx.gridToWorld(pos.x, pos.y) : new THREE.Vector3(pos.x, 0, pos.y);
      v.holder.position.copy(world);
    }
    v.sound.play();
    played += 1;
  }

  function playStinger(name) {
    const buffer = buffers.get(name);
    if (!buffer) return;
    stinger.stop();
    stinger.setBuffer(buffer);
    stinger.setVolume(0.8);
    stinger.play();
  }

  function setMuted(m) {
    muted = Boolean(m);
    listener.setMasterVolume(muted ? 0 : volume);
    storeMuted(muted);
  }

  function update(frame) {
    if (!ready || disposed) return;
    const tick = frame.tick;
    const forward = isForwardStep(lastTick, tick);
    lastTick = tick;

    const result = frame.next && frame.next.result;
    if (!result) resultPlayed = false;
    else if (!resultPlayed) {
      resultPlayed = true;
      if (forward && !muted) {
        const name = stingerFor(result, opts.localSide ?? 0);
        if (name) playStinger(name);
      }
    }

    if (!forward || muted) return;
    const lookup = makeLookup(frame.prev, frame.next);
    for (const s of limitSounds(chooseSounds(frame.events, lookup))) {
      playAt(s.name, s.pos ? { x: s.pos.x, y: s.pos.y } : null);
    }
  }

  function dispose() {
    disposed = true;
    if (typeof window !== "undefined") unlockEvents.forEach((ev) => window.removeEventListener(ev, unlock));
    for (const v of voices) {
      v.sound.stop();
      v.holder.remove(v.sound);
      ctx.scene.remove(v.holder);
    }
    stinger.stop();
    if (ambient) ambient.stop();
    listener.parent?.remove(listener);
  }

  return {
    update,
    dispose,
    setMuted,
    toggleMute() {
      setMuted(!muted);
      return muted;
    },
    isMuted: () => muted,
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      if (!muted) listener.setMasterVolume(volume);
    },
  };
}
