// Security gate G4 (owner: haiku): the shipped build holds no secrets or private files, and the hosted page
// carries a strict Content Security Policy that matches its own inline scripts. Tests first: the scanner must catch
// planted problems, then the real build must come out clean.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { scanTree } from '../security/scan.mjs';
import { policyFor, inlineBlocks, sha256Source, injectMeta, headerPolicyFor } from '../security/csp.mjs';
import { build } from '../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftfall-gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (dir, rel, data) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), data);
};

// One fresh build for the whole file: it takes a while, so it runs once and is removed after the last test.
let shipped;
after(() => { if (shipped) fs.rmSync(shipped, { recursive: true, force: true }); });
async function freshBuild() {
  if (!shipped) {
    shipped = fs.mkdtempSync(path.join(os.tmpdir(), 'driftfall-dist-'));
    await build({ root: ROOT, out: shipped, quiet: true });
  }
  return shipped;
}

test('scanner flags a planted key, a home path, a private file and a fake image', (t) => {
  const dir = tmpDir(t);
  put(dir, 'play/app.mjs', 'export const k = "sk-ant-api03-AAAAAAAAAAAAAAAA";\n');
  put(dir, 'env/note.mjs', 'const home = "/Users/someone/dev/x";\n');
  put(dir, 'tests/x.test.mjs', 'export {};\n');
  put(dir, '.env', 'KEY=1\n');
  put(dir, 'assets/tex.png', 'not really a png');
  put(dir, 'play/readme.md', '# hi\n');
  const rules = scanTree(dir).map((f) => `${f.file}:${f.rule}`).sort();
  assert.deepEqual(rules, [
    '.env:forbidden-file',
    'assets/tex.png:magic-bytes',
    'env/note.mjs:home-path',
    'play/app.mjs:anthropic-key',
    'play/readme.md:file-type',
    'tests/x.test.mjs:forbidden-file',
  ]);
});

test('scanner reads compressed copies, so a secret cannot hide in a .gz or .br file', (t) => {
  const dir = tmpDir(t);
  const src = Buffer.from('const t = "ghp_abcdefghijklmnopqrstuvwxyz0123";\n');
  put(dir, 'env/a.mjs.gz', zlib.gzipSync(src));
  put(dir, 'env/a.mjs.br', zlib.brotliCompressSync(src));
  const found = scanTree(dir).map((f) => f.rule);
  assert.deepEqual(found, ['github-token', 'github-token']);
});

test('scanner accepts a real PNG and a clean module', (t) => {
  const dir = tmpDir(t);
  put(dir, 'assets/ok.png', PNG);
  put(dir, 'play/ok.mjs', 'export const x = 1;\n');
  assert.deepEqual(scanTree(dir), []);
});

test('the built dist holds no secrets, private files, links or wrong file types', async () => {
  const dist = await freshBuild();
  const findings = scanTree(dist);
  assert.deepEqual(findings, [], `shipped folder has findings: ${JSON.stringify(findings.slice(0, 10))}`);
});

test('the policy pins every inline script and style and allows no script eval or inline handler', async () => {
  const dist = await freshBuild();
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const policy = policyFor(html);
  const blocks = inlineBlocks(html);
  assert.ok(blocks.scripts.length >= 2, 'the import map and the boot module are inline');
  for (const s of blocks.scripts) assert.ok(policy.includes(sha256Source(s)), 'inline script is pinned by hash');
  for (const s of blocks.styles) assert.ok(policy.includes(sha256Source(s)), 'inline style is pinned by hash');
  const scriptSrc = policy.split(';').find((d) => d.trim().startsWith('script-src'));
  assert.ok(!/unsafe-inline|unsafe-eval|unsafe-hashes|\*/.test(scriptSrc), `script-src is strict: ${scriptSrc}`);
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handler attributes');
  assert.ok(!/javascript:/i.test(html), 'no javascript: URLs');
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'none'/);
});

test('the meta and header forms carry the same policy, and the header adds frame-ancestors', () => {
  const html = '<!doctype html><html><head><script type="module">console.log(1)</script></head><body></body></html>';
  const meta = injectMeta(html);
  assert.ok(meta.includes(`content="${policyFor(html)}"`));
  assert.ok(meta.indexOf('Content-Security-Policy') < meta.indexOf('<script'), 'meta comes before the first script');
  assert.ok(headerPolicyFor(html).endsWith("frame-ancestors 'none'"));
});

test('a policy built for a page with a changed script no longer matches the old hash', () => {
  const a = policyFor('<script type="module">const a = 1;</script>');
  const b = policyFor('<script type="module">const a = 2;</script>');
  assert.notEqual(a, b);
});
