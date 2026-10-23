// `npm run preview`: serve dist/ locally, the way a static host would (owner: sonnet, shipping).
// Serves .br / .gz siblings when the browser accepts them. Run: node scripts/preview.mjs [--port 4173] [--dir dist]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

export function createPreviewServer(dir) {
  const base = path.resolve(dir);
  return http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end('bad url'); return; }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(base, path.normalize(rel));
    if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403).end('no'); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('not found'); return; }
    const accept = String(req.headers['accept-encoding'] || '');
    const enc = accept.includes('br') && fs.existsSync(`${file}.br`) ? 'br' : accept.includes('gzip') && fs.existsSync(`${file}.gz`) ? 'gzip' : null;
    const hashed = /^\/[0-9a-f]{10}\//.test(rel);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(enc ? { 'Content-Encoding': enc, Vary: 'Accept-Encoding' } : {}),
    });
    fs.createReadStream(enc ? `${file}.${enc === 'br' ? 'br' : 'gz'}` : file).pipe(res);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const dir = path.resolve(arg('--dir', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')));
  if (!fs.existsSync(path.join(dir, 'index.html'))) { console.error(`nothing to serve in ${dir}; run: npm run build`); process.exit(1); }
  const port = Number(arg('--port', 4173));
  createPreviewServer(dir).listen(port, '127.0.0.1', () => console.log(`Driftfall preview: http://127.0.0.1:${port}/  (serving ${dir})`));
}
