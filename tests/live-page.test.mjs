// Runs live/app.mjs against a tiny fake DOM and mocked Control Room data; checks every panel fills.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.className = ''; this.dataset = {}; this.style = {}; }
  append(...c) { for (const x of c) this.children.push(typeof x === 'string' ? Object.assign(new Node_('#t'), { textContent: x }) : x); }
  replaceChildren(...c) { this.children = []; this.append(...c); }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
  text() { return [this.textContent, ...this.children.map((c) => c.text())].join(' '); }
}

test('live page paints stage, status, chat, wall and captions', async () => {
  const ids = {};
  globalThis.document = {
    getElementById: (id) => (ids[id] ??= new Node_(id)),
    createElement: (t) => new Node_(t),
    createTextNode: (t) => Object.assign(new Node_('#t'), { textContent: t }),
  };
  const now = Date.now();
  const json = (o) => ({ ok: true, json: async () => o, text: async () => JSON.stringify(o) });
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.includes('/api/graph')) return json({ nodes: [
      { id: 'job:a', kind: 'job', state: 'running', label: 'Viewer (sonnet)', last: now, src: { cwd: '/x/rts', model: 'sonnet' } },
      { id: 'job:b', kind: 'job', state: 'done', label: 'Old', last: 1, src: { cwd: '/x/rts' } },
      { id: 'job:c', kind: 'job', state: 'running', label: 'Other project', last: now, src: { cwd: '/x/tetris' } }] });
    if (url.includes('/api/feed')) return json([{ i: 0, text: 'claude: hello world' }, { i: 1, text: '  ↳ skipped' }]);
    if (url.includes('/api/subtitles')) return json({ total: 1, items: [{ text: 'Caption one' }] });
    if (url.includes('/api/project')) return json({ files: [{ path: 'matches/latest-1.json', mtime: now }, { path: 'viewer3d/index.html', mtime: now }] });
    if (url.endsWith('channel.jsonl')) return { ok: true, text: async () => '{"from":"fable","text":"hi"}\n{"from":"sonnet","text":"AGREE"}\n' };
    if (url.endsWith('status.json')) return json({ ok: false, tests: { pass: 10, fail: 2 }, failures: [{ name: 'combat', owner: 'haiku' }] });
    if (url.endsWith('viewer3d/index.html')) return { ok: true };
    return { ok: false };
  };
  const src = readFileSync(new URL('../live/app.mjs', import.meta.url), 'utf8');
  await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  await new Promise((r) => setTimeout(r, 400));
  assert.match(ids.matchFrame.src, /viewer3d\/index\.html\?log=/);
  assert.match(ids.build.textContent, /RED/);
  assert.match(ids.statusBody.text(), /10 pass · 2 fail/);
  assert.match(ids.statusBody.text(), /combat/);
  assert.match(ids.chatLines.text(), /AGREE/);
  assert.equal(ids.agents.children.length, 1);
  assert.match(ids.agents.text(), /hello world/);
  assert.doesNotMatch(ids.agents.text(), /skipped/);
  assert.equal(ids.capText.textContent, 'Caption one');
});
