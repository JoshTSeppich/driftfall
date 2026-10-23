// Edition snapshots (TERRITORY.md section 10). Owner: sonnet. Called by live/compile.mjs after a GREEN build.
import fs from 'node:fs';
import path from 'node:path';
import { whatChanged } from '../play/edition.mjs';

const COPY = ['play', 'env', 'viewer3d', 'maps'];
const LINK = ['node_modules', 'assets'];
const skip = (name) => name.startsWith('.') || /\.test\.mjs$/.test(name);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else if (e.isFile()) fs.copyFileSync(a, b);
  }
}

export function listEditions(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'editions', 'index.json'), 'utf8')); } catch { return []; }
}

export function snapshotEdition(root, status) {
  try {
    if (status?.state !== 'green' || !Number.isFinite(status.build)) return { ok: false, reason: 'not a green build' };
    const dir = path.join(root, 'editions', String(status.build));
    fs.rmSync(dir, { recursive: true, force: true });
    for (const d of COPY) if (fs.existsSync(path.join(root, d))) copyDir(path.join(root, d), path.join(dir, d));
    for (const l of LINK) if (fs.existsSync(path.join(root, l))) fs.symlinkSync(path.join('..', '..', l), path.join(dir, l));
    const entry = { build: status.build, at: status.at || new Date().toISOString(), headline: status.headline || '', what: whatChanged(status), path: `editions/${status.build}/play/index.html` };
    const idx = [entry, ...listEditions(root).filter((e) => e.build !== status.build)].sort((a, b) => b.build - a.build);
    const f = path.join(root, 'editions', 'index.json');
    fs.writeFileSync(f + '.tmp', JSON.stringify(idx, null, 1) + '\n');
    fs.renameSync(f + '.tmp', f);
    return { ok: true, dir };
  } catch (e) { return { ok: false, reason: String(e.message || e) }; }
}
