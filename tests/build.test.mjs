// Production build tests (node --test). Owner: sonnet (shipping). Builds the real repo into a temp dir.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { build, recompressPng, findImports } from '../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
};

describe('findImports', () => {
  test('finds static, side-effect, dynamic and json imports, ignores template strings', () => {
    const src = [
      "import a from './a.mjs'; import './b.mjs'; export { x } from \"../c.mjs\";",
      "const m = await import('./d.mjs'); import j from './e.json' with { type: 'json' };",
      'const t = import(`./${n}.mjs`);',
    ].join('\n');
    assert.deepEqual(findImports(src).sort(), ['../c.mjs', './a.mjs', './b.mjs', './d.mjs', './e.json']);
  });
});

describe('recompressPng', () => {
  const idatOf = (b) => {
    let p = 8; const parts = [];
    while (p < b.length) { const n = b.readUInt32BE(p); if (b.toString('latin1', p + 4, p + 8) === 'IDAT') parts.push(b.subarray(p + 8, p + 8 + n)); p += 12 + n; }
    return zlib.inflateSync(Buffer.concat(parts));
  };
  test('keeps pixels identical and never grows the file', () => {
    const w = 4, h = 4, raw = Buffer.alloc((w * 4 + 1) * h, 7);
    for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
    const chunk = (type, data) => {
      const b = Buffer.alloc(12 + data.length);
      b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8);
      b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
      return b;
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
    const out = recompressPng(png);
    assert.ok(out.length < png.length);
    assert.deepEqual(idatOf(out), idatOf(png));
  });
  test('returns non-PNG input untouched', () => {
    const b = Buffer.from('not a png');
    assert.equal(recompressPng(b), b);
  });
});

describe('production build of the real game', () => {
  let out, info, files;
  before(async () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'driftfall-dist-'));
    info = await build({ root: ROOT, out, quiet: true });
    files = walk(out).map((f) => path.relative(out, f));
  });

  test('writes index.html and one hashed folder', () => {
    assert.ok(fs.existsSync(path.join(out, 'index.html')));
    assert.match(info.hash, /^[0-9a-f]{10}$/);
    assert.ok(fs.statSync(path.join(out, info.hash)).isDirectory());
  });

  test('index.html points into the hashed folder and drops the live-edition watcher', () => {
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.ok(html.includes(`./${info.hash}/play/app.mjs`));
    assert.ok(html.includes(`./${info.hash}/node_modules/three/build/three.module.js`));
    assert.ok(!html.includes('watchEditions'));
    assert.ok(!html.includes('../'));
  });

  test('ships the game, three.js and the manifest-listed assets', () => {
    const has = (p) => files.includes(`${info.hash}/${p}`);
    for (const p of ['play/app.mjs', 'env/sim.mjs', 'env/stats.mjs', 'viewer3d/engine.mjs', 'node_modules/three/build/three.module.js', 'assets/icons/snakenators/manifest.json', 'assets/models/MANIFEST.json', 'assets/audio/MANIFEST.json']) assert.ok(has(p), p);
  });

  test('ships the opponent bots the page can import at runtime', () => {
    assert.ok(files.includes(`${info.hash}/players/sample-player.mjs`));
    assert.ok(files.includes(`${info.hash}/players/sonnet/bot.mjs`));
  });

  test('leaves out tests, sandboxes, secrets, notes and workspace folders', () => {
    const bad = files.filter((f) => /(^|\/)(tests|\.sandbox|\.git|\.github|live|scratch-haiku|__airpull|research|concept|analytics|matches|roles)\//.test(f)
      || /\.test\.mjs$/.test(f) || /(^|\/)\.env/.test(f) || /\.(log|md)$/.test(f) || /(^|\/)(results\.json|NOTES\.md)$/.test(f));
    assert.deepEqual(bad, []);
  });

  test('every relative import in the shipped modules resolves inside dist', () => {
    const missing = [];
    for (const f of files.filter((x) => /\.mjs$/.test(x))) {
      const src = fs.readFileSync(path.join(out, f), 'utf8');
      for (const spec of findImports(src)) {
        if (!spec.startsWith('.')) continue;
        if (!fs.existsSync(path.resolve(path.dirname(path.join(out, f)), spec))) missing.push(`${f} -> ${spec}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test('every file named in the icon manifest exists in dist', () => {
    const m = JSON.parse(fs.readFileSync(path.join(out, info.hash, 'assets/icons/snakenators/manifest.json'), 'utf8'));
    for (const f of Object.values(m).filter(Boolean)) assert.ok(files.includes(`${info.hash}/assets/icons/snakenators/${f}`), f);
  });

  test('does not ship unused assets (sprites, generated sheets, tools)', () => {
    assert.ok(!files.some((f) => /\/assets\/(sprites|generated|tools)\//.test(f)));
  });

  test('text files get gzip and brotli siblings that decode back', () => {
    const f = `${info.hash}/play/app.mjs`;
    const raw = fs.readFileSync(path.join(out, f));
    assert.deepEqual(zlib.gunzipSync(fs.readFileSync(path.join(out, `${f}.gz`))), raw);
    assert.deepEqual(zlib.brotliDecompressSync(fs.readFileSync(path.join(out, `${f}.br`))), raw);
  });

  test('build.json and _headers are written; assets are cached forever', () => {
    const j = JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8'));
    assert.equal(j.hash, info.hash);
    assert.ok(j.files > 50);
    assert.match(fs.readFileSync(path.join(out, '_headers'), 'utf8'), /immutable/);
  });

  test('the same sources give the same hash', async () => {
    const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'driftfall-dist-'));
    const again = await build({ root: ROOT, out: out2, quiet: true });
    assert.equal(again.hash, info.hash);
  });
});
