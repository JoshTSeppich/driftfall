// Smoke test for mountHud with a tiny stand-in DOM (no browser here): it builds, updates and fires callbacks.
// Runs with: node --test tests/viewer-hud-mount.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayer } from '../viewer/replay.mjs';

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.style = { setProperty() {} }; this.classes = new Set(); this._text = ''; this.listeners = {}; this.clientWidth = 300; }
  set className(v) { this.classes = new Set(v.split(' ').filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  append(...k) { this.children.push(...k); }
  replaceChildren(...k) { this.children = k; this._text = ''; }
  addEventListener(n, f) { this.listeners[n] = f; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 160, height: 160 }; }
  get classList() { return { toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)), add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c) }; }
  getContext() {
    return new Proxy({}, { get: () => () => {}, set: () => true });
  }
}
globalThis.document = { createElement: (t) => new El(t), getElementById: () => null, head: new El('head') };

const { mountHud } = await import('../viewer/hud.mjs');
const { runMatch } = await import('../env/referee.mjs');

test('mountHud builds, updates through a whole match and routes button presses', async () => {
  const sample = new URL('../players/sample-player.mjs', import.meta.url).pathname;
  const { log } = await runMatch({ seed: 7, players: [sample, sample], maxTicks: 120 });
  const calls = [];
  const root = new El('div');
  const hud = mountHud(root, { log, onSeek: (t) => calls.push(['seek', t]), onPlay: () => calls.push(['play']), onPause: () => calls.push(['pause']), onSpeed: (s) => calls.push(['speed', s]), onMapClick: (x, y) => calls.push(['map', x, y]) });
  const r = createReplayer(log);
  for (const t of [0, 60, r.last]) {
    r.seek(t);
    hud.update({ state: r.state, tick: t, last: r.last, playing: false, speed: 10 });
  }
  const text = root.textContent;
  assert.match(text, /Shards/);
  assert.match(text, /tick 120 \/ 120/);
  assert.match(text, /wins|Draw/, 'banner shows at the end');

  // find the buttons by label and press them
  const all = [];
  (function walk(e) { all.push(e); e.children.forEach(walk); })(root);
  const btn = (label) => all.find((e) => e.tag === 'button' && e.textContent === label);
  btn('▶ Play').onclick(); btn('1×').onclick(); btn('10×').onclick(); btn('⏮').onclick();
  hud.update({ state: r.state, tick: 5, last: r.last, playing: true, speed: 100 });
  btn('⏸ Pause').onclick();
  assert.deepEqual(calls, [['play'], ['speed', 10], ['speed', 100], ['seek', 0], ['pause']]);
});
