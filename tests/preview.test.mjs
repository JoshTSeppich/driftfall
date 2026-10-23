// Preview server tests (node --test). Owner: sonnet (shipping).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createPreviewServer } from '../scripts/preview.mjs';

let dir, server, base;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftfall-prev-'));
  fs.mkdirSync(path.join(dir, 'abcdef0123'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');
  fs.writeFileSync(path.join(dir, 'abcdef0123', 'a.mjs'), 'export const a = 1;');
  fs.writeFileSync(path.join(dir, 'abcdef0123', 'a.mjs.gz'), zlib.gzipSync('export const a = 1;'));
  fs.writeFileSync(path.join(dir, '..', 'driftfall-secret.txt'), 'nope');
  server = createPreviewServer(dir);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('serves index.html at / with no-cache', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.equal(await r.text(), '<h1>hi</h1>');
});

test('hashed files are immutable, javascript mime, gzip when accepted', async () => {
  const r = await fetch(`${base}/abcdef0123/a.mjs`, { headers: { 'accept-encoding': 'gzip' } });
  assert.match(r.headers.get('cache-control'), /immutable/);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.equal(await r.text(), 'export const a = 1;');
});

test('missing files are 404 and ../ cannot leave dist', async () => {
  assert.equal((await fetch(`${base}/nope.js`)).status, 404);
  const raw = await new Promise((resolve) => {
    import('node:net').then(({ default: net }) => {
      const s = net.connect(server.address().port, '127.0.0.1', () => s.write('GET /../driftfall-secret.txt HTTP/1.0\r\n\r\n'));
      let d = ''; s.on('data', (c) => { d += c; }); s.on('end', () => resolve(d));
    });
  });
  assert.ok(!raw.includes('nope\n') && !raw.endsWith('nope'));
  assert.match(raw, /^HTTP\/1\.\d (403|404)/);
});
