// Always-live editions (TERRITORY.md section 10). Owner: sonnet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide, whatChanged, startEditions, isArchived } from '../play/edition.mjs';
import { snapshotEdition, listEditions } from '../live/editions.mjs';

const green = (build, extra = {}) => ({ build, state: 'green', headline: 'Green.', changed: { first: false, added: [], changed: [{ file: 'play/app.mjs', owner: 'sonnet' }], removed: [], total: 1 }, ...extra });
const red = (build) => ({ build, state: 'red', headline: 'Red: 1 test file(s) failing.', previous: { build: build - 1, state: 'green' } });

test('whatChanged: plain words, names files, caps the list', () => {
  assert.match(whatChanged(green(5)), /play\/app\.mjs/);
  const many = green(6, { changed: { first: false, added: [], changed: ['a', 'b', 'c', 'd', 'e'].map((x) => ({ file: `env/${x}.mjs` })), removed: [], total: 5 } });
  const t = whatChanged(many);
  assert.match(t, /5 files/); assert.match(t, /\+2 more/);
  assert.equal(whatChanged({ build: 1, state: 'green', changed: { first: true, total: 9 } }), 'First edition.');
  assert.equal(whatChanged({ build: 2, state: 'green', what: 'Drills added' }), 'Drills added');
  assert.equal(typeof whatChanged({}), 'string');
});

test('decide: first status only records the loaded edition', () => {
  const r = decide({}, green(10));
  assert.equal(r.action, 'none'); assert.equal(r.state.loaded, 10);
});
test('decide: a newer green build announces once, then does nothing more', () => {
  const s = decide({}, green(10)).state;
  const a = decide(s, green(11));
  assert.equal(a.action, 'announce'); assert.equal(a.build, 11); assert.match(a.text, /^Edition 11: /);
  assert.equal(decide(a.state, green(11)).action, 'none');
});
test('decide: a red build never reloads, says it is being fixed, and the same red is not repeated', () => {
  const s = decide({}, green(10)).state;
  const r = decide(s, red(11));
  assert.equal(r.action, 'fixing'); assert.equal(r.text, 'Edition 11 is being fixed');
  assert.equal(decide(r.state, red(11)).action, 'none');
  assert.equal(decide(r.state, green(12)).action, 'announce');
});
test('decide: page opened during a red build uses the last good build as its edition', () => {
  const r = decide({}, red(11));
  assert.equal(r.state.loaded, 10); assert.equal(r.action, 'none');
  assert.equal(decide(r.state, green(12)).action, 'announce');
});
test('decide: older, equal or junk statuses are ignored', () => {
  const s = { loaded: 10 };
  for (const st of [green(9), green(10), null, {}, { build: 'x', state: 'green' }]) assert.equal(decide(s, st).action, 'none');
});

test('isArchived: copies under /editions/ and ?edition=off do not follow the stream', () => {
  assert.equal(isArchived('http://x/preview/rts/editions/7/play/index.html'), true);
  assert.equal(isArchived('http://x/preview/rts/play/index.html?edition=off'), true);
  assert.equal(isArchived('http://x/preview/rts/play/index.html'), false);
});

function fakeEnv(statuses) {
  const shown = []; let reloads = 0; const timers = [];
  const doc = { createElement: () => ({ style: {}, remove() {} }), body: { appendChild(el) { shown.push(el); } } };
  const win = { location: { href: 'http://x/preview/rts/play/index.html', reload() { reloads++; } }, document: doc };
  const fetchImpl = async () => ({ ok: true, json: async () => statuses.shift() });
  const setTimeoutImpl = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  return { win, fetchImpl, setTimeoutImpl, shown, timers, reloads: () => reloads };
}
test('startEditions: new green shows the banner for 3 s then reloads; red never reloads', async () => {
  const env = fakeEnv([green(1), red(2), green(3)]);
  const h = startEditions({ ...env, auto: false });
  await h.poll(); assert.equal(env.reloads(), 0);
  await h.poll(); assert.equal(env.reloads(), 0); assert.match(env.shown.at(-1).textContent, /being fixed/);
  await h.poll(); assert.match(env.shown.at(-1).textContent, /^Edition 3: /);
  const t = env.timers.find((x) => x.ms === 3000); assert.ok(t); assert.equal(env.reloads(), 0);
  t.fn(); assert.equal(env.reloads(), 1);
});
test('startEditions: fetch failures are swallowed', async () => {
  const env = fakeEnv([]); env.fetchImpl = async () => { throw new Error('offline'); };
  const h = startEditions({ ...env, auto: false });
  await h.poll(); assert.equal(env.reloads(), 0);
});

test('snapshotEdition copies play, env, viewer3d, maps into editions/N and indexes it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-'));
  for (const f of ['play/index.html', 'env/stats.mjs', 'viewer3d/engine.mjs', 'maps/m.json', 'play/x.test.mjs']) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), f); }
  fs.mkdirSync(path.join(root, 'node_modules')); fs.mkdirSync(path.join(root, 'assets'));
  const r = snapshotEdition(root, green(7, { at: '2026-01-01T00:00:00Z' }));
  assert.equal(r.ok, true);
  for (const f of ['play/index.html', 'env/stats.mjs', 'viewer3d/engine.mjs', 'maps/m.json']) assert.ok(fs.existsSync(path.join(root, 'editions/7', f)), f);
  assert.equal(fs.existsSync(path.join(root, 'editions/7/play/x.test.mjs')), false);
  assert.ok(fs.lstatSync(path.join(root, 'editions/7/node_modules')).isSymbolicLink());
  const idx = listEditions(root); assert.equal(idx.length, 1); assert.equal(idx[0].build, 7); assert.match(idx[0].what, /play\/app\.mjs/);
  snapshotEdition(root, green(7)); snapshotEdition(root, green(8));
  assert.deepEqual(listEditions(root).map((e) => e.build), [8, 7]);
  assert.equal(snapshotEdition(root, red(9)).ok, false);
  assert.equal(snapshotEdition('/nonexistent/zzz', green(1)).ok, false);
});
