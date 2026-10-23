// Driftfall production build (owner: sonnet, shipping). `npm run build` -> dist/.
//
// Starts at play/index.html, follows every import (static, dynamic with a literal path, JSON), and copies only what
// the page can reach, plus the opponent bots that app.mjs picks by name at runtime (?ai=), plus the assets named in
// the asset manifests. The tree is kept as it is, so every relative URL in the code still works. Everything goes into
// dist/<hash>/ (the hash is of the shipped bytes, so files there can be cached forever) and dist/index.html is the
// only file that changes name-free. No tests, no .sandbox, no .env, no notes, no live-build tooling.
//
// Run: node scripts/build.mjs [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');

// Opponent modules app.mjs imports by name at runtime (a template string, so the crawler cannot see them).
const RUNTIME_ROOTS = ['players/sample-player.mjs', 'players/builtin/ai.mjs', 'players/sonnet/bot.mjs', 'players/haiku/bot.mjs', 'players/fable/bot.mjs'];
// Assets that code builds paths for by name rather than by manifest.
const ASSET_DIRS = ['assets/portraits'];
const ASSET_MANIFESTS = ['assets/icons/snakenators/manifest.json', 'assets/models/MANIFEST.json', 'assets/audio/MANIFEST.json'];
const FORBIDDEN = /(^|\/)(tests|\.sandbox|\.git|\.github|\.claude|node_modules\/\.cache)(\/|$)|\.test\.mjs$|(^|\/)\.env/;
const TEXT = /\.(mjs|js|json|html|css|svg)$/;

// Every literal module specifier in a source file. Template-string imports are skipped on purpose.
export function findImports(src) {
  const out = new Set();
  const re = /(?:\bimport\s*(?:[\w*${}\s,]+?\s*from\s*)?|\bexport\s*(?:[\w*${}\s,]+?)\s*from\s*|\bimport\s*\(\s*)(['"])([^'"\n]+)\1/g;
  for (let m; (m = re.exec(src));) out.add(m[2]);
  return [...out];
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// Lossless: inflate the pixel data, deflate it again at level 9, keep it only if it is smaller. Other chunks stay.
export function recompressPng(buf) {
  const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 20 || !buf.subarray(0, 8).equals(SIG)) return buf;
  try {
    const chunks = []; const idat = [];
    for (let p = 8; p < buf.length;) {
      const n = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8);
      const data = buf.subarray(p + 8, p + 8 + n);
      if (type === 'IDAT') { if (!idat.length) chunks.push({ type: 'IDAT' }); idat.push(data); } else chunks.push({ type, data });
      p += 12 + n;
    }
    if (!idat.length) return buf;
    const packed = zlib.deflateSync(zlib.inflateSync(Buffer.concat(idat)), { level: 9, memLevel: 9 });
    const parts = [SIG];
    for (const c of chunks) {
      const data = c.type === 'IDAT' ? packed : c.data;
      const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(c.type, 4, 'latin1');
      const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
      parts.push(head, data, tail);
    }
    const out = Buffer.concat(parts);
    return out.length < buf.length ? out : buf;
  } catch { return buf; }
}

const posix = (p) => p.split(path.sep).join('/');

export async function build({ root = DEFAULT_ROOT, out = path.join(root, 'dist'), quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const files = new Map(); // repo-relative path -> Buffer
  const exists = (rel) => { try { return fs.statSync(path.join(root, rel)).isFile(); } catch { return false; } };
  const add = (rel) => {
    rel = posix(path.normalize(rel));
    if (rel.startsWith('..')) throw new Error(`refusing to ship a file outside the repo: ${rel}`);
    if (FORBIDDEN.test(rel)) throw new Error(`the game reaches a file that must not ship: ${rel}`);
    if (!files.has(rel)) files.set(rel, fs.readFileSync(path.join(root, rel)));
    return rel;
  };

  // 1. index.html: the play page, with its ../ paths pointed into the hashed folder (filled in at the end).
  let html = fs.readFileSync(path.join(root, 'play/index.html'), 'utf8');
  html = html.replace(/^.*\bwatchEditions\b.*\n/gm, '').replace(/^.*\.\/edition\.mjs.*\n/gm, '');
  const importmap = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{"imports":{}}').imports;
  const inline = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  // 2. crawl the modules
  const seen = new Set(); const queue = [];
  const resolveSpec = (spec, fromRel) => {
    if (spec.startsWith('.')) return posix(path.normalize(path.join(path.dirname(fromRel), spec)));
    for (const [k, v] of Object.entries(importmap)) {
      if (spec === k) return posix(path.normalize(path.join('play', v)));
      if (k.endsWith('/') && spec.startsWith(k)) return posix(path.normalize(path.join('play', v + spec.slice(k.length))));
    }
    return null; // node: builtins and the like (tests only)
  };
  const visit = (rel) => { if (!seen.has(rel)) { seen.add(rel); queue.push(rel); } };
  for (const spec of findImports(inline)) { const r = resolveSpec(spec, 'play/index.html'); if (r) visit(r); }
  for (const r of RUNTIME_ROOTS) if (exists(r)) visit(r);
  while (queue.length) {
    const rel = queue.shift();
    if (!exists(rel)) throw new Error(`missing module: ${rel}`);
    add(rel);
    if (!/\.m?js$/.test(rel)) continue;
    const src = files.get(rel).toString('utf8');
    for (const spec of findImports(src)) { const r = resolveSpec(spec, rel); if (r) visit(r); }
    // literal asset paths in code
    for (const m of src.matchAll(/['"`]((?:\.\.\/)*assets\/[\w./-]+\.(?:png|jpg|jpeg|webp|glb|ogg|mp3|wav|json))['"`]/g)) {
      for (const a of [posix(path.normalize(path.join(path.dirname(rel), m[1]))), m[1].replace(/^(\.\.\/)+/, '')]) if (exists(a)) { add(a); break; }
    }
  }

  // 3. assets named by manifests, and whole portrait folder
  const collect = (node, bases, found) => {
    if (typeof node === 'string') { for (const b of bases) { const rel = posix(path.join(b, node)); if (/\.\w{2,4}$/.test(node) && exists(rel)) { found.add(rel); break; } } }
    else if (Array.isArray(node)) node.forEach((n) => collect(n, bases, found));
    else if (node && typeof node === 'object') Object.values(node).forEach((n) => collect(n, bases, found));
  };
  for (const m of ASSET_MANIFESTS) {
    if (!exists(m)) continue;
    add(m);
    const json = JSON.parse(files.get(m).toString('utf8'));
    const bases = [path.dirname(m)]; if (typeof json.root === 'string') bases.unshift(json.root);
    const found = new Set(); collect(json, bases, found);
    for (const f of found) add(f);
  }
  for (const d of ASSET_DIRS) {
    if (!fs.existsSync(path.join(root, d))) continue;
    for (const f of fs.readdirSync(path.join(root, d))) if (/\.(png|jpg|webp)$/.test(f) && exists(`${d}/${f}`)) add(`${d}/${f}`);
  }

  // 4. compress images (lossless), hash the shipped bytes
  let before = 0; let after = 0;
  for (const [rel, buf] of files) if (rel.endsWith('.png')) { const o = recompressPng(buf); before += buf.length; after += o.length; files.set(rel, o); }
  const h = crypto.createHash('sha256');
  for (const rel of [...files.keys()].sort()) { h.update(rel); h.update('\0'); h.update(files.get(rel)); }
  h.update(html);
  const hash = h.digest('hex').slice(0, 10);

  // 5. write dist/
  const pre = `./${hash}/`;
  html = html.replace(/(['"])\.\.\//g, `$1${pre}`).replace(/(['"])\.\/app\.mjs/g, `$1${pre}play/app.mjs`);
  if (html.includes('../')) throw new Error('index.html still has a ../ path');
  fs.rmSync(out, { recursive: true, force: true });
  const dir = path.join(out, hash);
  let bytes = 0;
  const write = (target, data) => { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); bytes += data.length; };
  for (const [rel, buf] of files) {
    const target = path.join(dir, rel);
    write(target, buf);
    if (TEXT.test(rel) && buf.length > 1024) {
      write(`${target}.gz`, zlib.gzipSync(buf, { level: 9 }));
      write(`${target}.br`, zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
    }
  }
  write(path.join(out, 'index.html'), Buffer.from(html));
  write(path.join(out, '_headers'), Buffer.from(`/${hash}/*\n  Cache-Control: public, max-age=31536000, immutable\n/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n`));
  const info = { hash, files: files.size, bytes, pngBefore: before, pngAfter: after, builtAt: new Date().toISOString() };
  write(path.join(out, 'build.json'), Buffer.from(JSON.stringify(info, null, 1)));
  log(`dist ready: ${files.size} files, ${(bytes / 1e6).toFixed(1)} MB on disk incl. .gz/.br, hash ${hash}; PNG ${(before / 1e6).toFixed(2)} -> ${(after / 1e6).toFixed(2)} MB`);
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  build(i > 0 ? { out: path.resolve(process.argv[i + 1]) } : {}).catch((e) => { console.error(`build failed: ${e.message}`); process.exit(1); });
}
