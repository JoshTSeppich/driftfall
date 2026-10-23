// Sound effects for the play client (owner: haiku). Plain WebAudio, no Three.js. It reads the same MANIFEST.json as
// the 3D viewer and reuses its helpers. Browsers need a click or key before audio can run, so sounds stay quiet until
// unlock() is called. A file that will not load or decode is replaced by a short synthesized stand-in, so a missing
// file never makes the match silent by error, and a missing AudioContext makes every call a quiet no-op.
import { parseManifest, soundUrl, proceduralSamples } from '../viewer3d/audio.mjs';

const MUTE_KEY = 'driftfall.muted'; // the same key as the 3D viewer, so one mute setting follows you
const NEAR = 6;   // tiles: full volume inside this
const FAR = 40;   // tiles: quietest outside this
const QUIET = 0.15;

// Volume by distance (in tiles) from the camera. Missing distance means "on screen", so full volume.
export function gainFor(dist, near = NEAR, far = FAR) {
  if (dist === undefined || dist === null || dist <= near) return 1;
  if (dist >= far) return QUIET;
  return 1 - (1 - QUIET) * ((dist - near) / (far - near));
}

function readMuted() {
  try { return globalThis.localStorage?.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

function storeMuted(muted) {
  try { globalThis.localStorage?.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* blocked storage: mute still works here */ }
}

// opts: { ctx (a WebAudio context, or null), fetchFn, manifestUrl, volume, muted }.
// Returns { load(manifestJson) -> problems[], unlock(), play(list) -> count started, setMuted, toggleMute, isMuted }.
export function createSoundPlayer({ ctx = defaultContext(), fetchFn = globalThis.fetch, manifestUrl = '../assets/audio/MANIFEST.json', volume = 0.6, muted = readMuted() } = {}) {
  const buffers = new Map(); // event name -> AudioBuffer (or a stand-in)
  const kinds = new Map();   // event name -> sound kind, for the stand-in
  let isMuted = muted;

  // Fetch and decode every event. Each one that fails gets a synthesized stand-in and a line in the returned problems.
  async function load(json) {
    const parsed = parseManifest(json);
    const problems = [...parsed.problems];
    await Promise.all(Object.entries(parsed.events).map(async ([name, entry]) => {
      kinds.set(name, entry.kind);
      if (!ctx) return;
      try {
        const res = await fetchFn(soundUrl(manifestUrl, entry.file));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        if (!bytes || bytes.byteLength === 0) throw new Error('empty file');
        buffers.set(name, await ctx.decodeAudioData(bytes));
      } catch (err) {
        problems.push(`${name}: ${err.message}; using a stand-in`);
        buffers.set(name, standIn(entry.kind));
      }
    }));
    return problems;
  }

  function standIn(kind) {
    if (!ctx) return null;
    const samples = proceduralSamples(kind, ctx.sampleRate || 22050);
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate || 22050);
    buf.getChannelData(0).set(samples);
    return buf;
  }

  // Browsers only start audio after a gesture. Call this from the first click or key press.
  function unlock() {
    if (ctx && ctx.state !== 'running') ctx.resume?.();
  }

  // list: [{ name, dist? }]. Returns how many sounds were started. Unknown names and muted calls do nothing.
  function play(list) {
    if (!ctx || isMuted || ctx.state !== 'running') return 0;
    let started = 0;
    for (const cue of list) {
      const buffer = buffers.get(cue.name);
      if (!buffer) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = volume * gainFor(cue.dist);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      started += 1;
    }
    return started;
  }

  function setMuted(next) { isMuted = !!next; storeMuted(isMuted); }
  function toggleMute() { setMuted(!isMuted); return isMuted; }

  return { load, unlock, play, setMuted, toggleMute, isMuted: () => isMuted };
}

function defaultContext() {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  try { return new Ctor(); } catch { return null; }
}
