// The play client's sound player: WebAudio with fake contexts here, so no real audio runs in tests (owner: haiku).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoundPlayer, gainFor } from './sound-player.mjs';

function fakeContext(state = 'running') {
  const started = [];
  const ctx = {
    state,
    destination: {},
    resumed: 0,
    resume() { this.resumed += 1; return Promise.resolve(); },
    decodeAudioData(bytes) {
      if (bytes.byteLength === 0) return Promise.reject(new Error('bad file'));
      return Promise.resolve({ duration: 0.2, fake: true });
    },
    createBuffer(channels, length, rate) {
      return { length, rate, data: new Float32Array(length), getChannelData() { return this.data; } };
    },
    createBufferSource() {
      const src = { buffer: null, connect(node) { this.to = node; }, start() { started.push(this); this.startedAt = true; } };
      return src;
    },
    createGain() { return { gain: { value: 1 }, connect(node) { this.to = node; } }; },
    started,
  };
  return ctx;
}

const manifest = {
  root: 'assets/audio',
  events: {
    unit_select: { file: 'kenney-ui/select_001.ogg', kind: 'blip' },
    melee_hit: { file: 'kenney-impact/impactPunch_medium_000.ogg', kind: 'impact' },
    drift_warning: { file: 'kenney-ui/bong_001.ogg', kind: 'alert' },
  },
};

const fetchOk = async (url) => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, url });
const fetchNo = async () => { throw new Error('offline'); };

test('gainFor: full volume close to the camera, quiet far away, never silent', () => {
  assert.equal(gainFor(0), 1);
  assert.equal(gainFor(3), 1);
  assert.ok(gainFor(20) < 1 && gainFor(20) > 0.15);
  assert.equal(gainFor(500), 0.15);
  assert.equal(gainFor(undefined), 1);
});

test('before the first gesture nothing plays; after load and resume a known sound plays', async () => {
  const ctx = fakeContext('suspended');
  const player = createSoundPlayer({ ctx, fetchFn: fetchOk, manifestUrl: 'http://x/assets/audio/MANIFEST.json' });
  await player.load(manifest);
  assert.equal(player.play([{ name: 'unit_select' }]), 0);
  player.unlock();
  assert.equal(ctx.resumed, 1);
  ctx.state = 'running';
  assert.equal(player.play([{ name: 'unit_select' }]), 1);
  assert.equal(ctx.started.length, 1);
});

test('unknown names and muted play are silent', async () => {
  const ctx = fakeContext();
  const player = createSoundPlayer({ ctx, fetchFn: fetchOk, manifestUrl: 'http://x/a/MANIFEST.json', muted: true });
  await player.load(manifest);
  assert.equal(player.play([{ name: 'unit_select' }]), 0, 'muted');
  player.setMuted(false);
  assert.equal(player.play([{ name: 'not_a_sound' }]), 0, 'unknown');
  assert.equal(player.isMuted(), false);
  assert.equal(player.toggleMute(), true);
});

test('a sound file that will not load becomes a short stand-in, so the game is never silent by error', async () => {
  const ctx = fakeContext();
  const player = createSoundPlayer({ ctx, fetchFn: fetchNo, manifestUrl: 'http://x/a/MANIFEST.json' });
  const problems = await player.load(manifest);
  assert.ok(problems.length > 0, 'the failed loads are reported');
  assert.equal(player.play([{ name: 'drift_warning' }]), 1);
});

test('a file that decodes to nothing falls back to the stand-in too', async () => {
  const ctx = fakeContext();
  const player = createSoundPlayer({ ctx, fetchFn: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }), manifestUrl: 'http://x/a/MANIFEST.json' });
  await player.load(manifest);
  assert.equal(player.play([{ name: 'melee_hit' }]), 1);
});

test('no audio context at all (old browser, node): every call is a quiet no-op', async () => {
  const player = createSoundPlayer({ ctx: null, fetchFn: fetchOk, manifestUrl: 'http://x/a/MANIFEST.json' });
  await player.load(manifest);
  player.unlock();
  assert.equal(player.play([{ name: 'unit_select' }]), 0);
});

test('play(list) returns how many sounds started, and distance lowers the volume of far sounds', async () => {
  const ctx = fakeContext();
  const player = createSoundPlayer({ ctx, fetchFn: fetchOk, manifestUrl: 'http://x/a/MANIFEST.json', volume: 0.5 });
  await player.load(manifest);
  assert.equal(player.play([{ name: 'melee_hit', dist: 0 }, { name: 'melee_hit', dist: 300 }]), 2);
  const [near, far] = ctx.started;
  assert.ok(near.to && far.to, 'each sound goes through its own gain');
  assert.ok(near.to.gain.value > far.to.gain.value);
  assert.ok(near.to.gain.value <= 0.5 + 1e-9);
});
