#!/usr/bin/env node
// Live Build Compiler. Every 3 minutes: run each test file, syntax-check every module,
// record a fresh match, and write live/status.json for the TV pages.
//   node live/compile.mjs          loop forever (3 min)
//   node live/compile.mjs --once   one build, then exit
//   node live/compile.mjs --every SECONDS
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUS = path.join(ROOT, 'live', 'status.json');
const STATE = path.join(ROOT, 'live', '.compile-state.json');
const WATCH = ['env', 'viewer', 'viewer3d', 'players', 'tests', 'live', 'assets/models'];
const args = process.argv.slice(2);
const once = args.includes('--once');
const every = (args.includes('--every') ? Number(args[args.indexOf('--every') + 1]) : 180) * 1000;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
function writeAtomic(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = p + '.tmp'; fs.writeFileSync(t, text); fs.renameSync(t, p); }
const parseLine = (s) => { try { return JSON.parse(s); } catch { return s; } };

function walk(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}

function run(cmd, argv, timeout = 120000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, argv, { cwd: ROOT });
    let out = '';
    const timer = setTimeout(() => { out += '\n[timed out]'; p.kill('SIGKILL'); }, timeout);
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - t0 }); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e), ms: Date.now() - t0 }); });
  });
}

// owners: PLAN.json module files + the VISUAL-3D.md owner table
function loadOwners() {
  const map = new Map(); const globs = [];
  for (const m of readJson(path.join(ROOT, 'PLAN.json'), { modules: [] }).modules || [])
    for (const f of m.files) map.set(f, m.owner);
  try {
    for (const line of fs.readFileSync(path.join(ROOT, 'VISUAL-3D.md'), 'utf8').split('\n')) {
      const c = line.split('|').map((s) => s.trim());
      if (c.length < 4 || !/\.(mjs|html)|\/$/.test(c[1])) continue;
      const owner = c[2].split(/[ (]/)[0];
      for (const f of c[1].split(',').map((s) => s.trim())) {
        if (!f) continue;
        if (f.includes('*')) globs.push([new RegExp('^' + f.replace(/[.+?^$()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), owner]);
        else map.set(f.includes('/') ? f : 'viewer3d/' + f, owner);
      }
    }
  } catch { /* no table yet */ }
  return (file) => map.get(file) || (globs.find(([re]) => re.test(file)) || [])[1] || null;
}

// failing test file -> owners of the source modules it imports (likely culprits), plus the test's own owner
function ownersFor(testFile, ownerOf) {
  let src = '';
  try { src = fs.readFileSync(path.join(ROOT, testFile), 'utf8'); } catch { /* gone */ }
  const imports = new Set(); const re = /from\s+['"](\.\.?\/[^'"]+)['"]/g; let m;
  for (const mm of readJson(path.join(ROOT, 'PLAN.json'), { modules: [] }).modules || []) if (path.basename(testFile).startsWith(mm.id + '-')) mm.files.forEach((f) => imports.add(f));
  while ((m = re.exec(src))) imports.add(rel(path.resolve(path.dirname(path.join(ROOT, testFile)), m[1])));
  const owners = new Set();
  for (const i of imports) { const o = ownerOf(i); if (o) owners.add(o); }
  const own = ownerOf(testFile); if (own && own !== 'each') owners.add(own);
  return { owners: [...owners], imports: [...imports] };
}

function failingNames(out) {
  const names = [];
  for (const l of out.split('\n')) { const m = /^\s*✖ (.+?)(?: \(\d[\d.]*ms\))?$/.exec(l); if (m && !/^failing tests:?$/i.test(m[1]) && !/\.test\.mjs$/.test(m[1])) names.push(m[1]); }
  return [...new Set(names)].slice(0, 6);
}

async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

async function build(buildNo) {
  const started = Date.now();
  const ownerOf = loadOwners();
  const prev = readJson(STATE, { hashes: {}, build: 0 });

  const hashes = {};
  for (const d of WATCH) for (const f of walk(path.join(ROOT, d))) {
    const r = rel(f); if (r === 'live/status.json') continue;
    try { hashes[r] = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12); } catch { /* vanished */ }
  }
  const first = !Object.keys(prev.hashes).length;
  const added = [], changed = [], removed = [];
  for (const [f, h] of Object.entries(hashes)) { if (!(f in prev.hashes)) added.push(f); else if (prev.hashes[f] !== h) changed.push(f); }
  for (const f of Object.keys(prev.hashes)) if (!(f in hashes)) removed.push(f);
  const withOwner = (f) => ({ file: f, owner: ownerOf(f) });

  const mods = Object.keys(hashes).filter((f) => /^(env|viewer|viewer3d|players)\/.*\.mjs$/.test(f));
  const parse = await pool(mods, 8, async (f) => {
    const r = await run(process.execPath, ['--check', f], 30000);
    return r.code === 0 ? null : { file: f, owner: ownerOf(f), error: (r.out.split('\n').find((l) => /Error/.test(l)) || r.out).slice(0, 240) };
  });
  const parseErrors = parse.filter(Boolean);

  const testFiles = Object.keys(hashes).filter((f) => /^tests\/.*\.test\.mjs$/.test(f)).sort();
  const results = await pool(testFiles, 4, async (f) => {
    const r = await run(process.execPath, ['--test', '--test-reporter=spec', f], 300000); // builtin-ai alone needs ~3 minutes
    const g = (k) => Number((new RegExp('^ℹ ' + k + ' (\\d+)', 'm').exec(r.out) || [0, 0])[1]);
    return { file: f, ok: r.code === 0, pass: g('pass'), fail: g('fail'), ms: r.ms, out: r.out };
  });
  // flake rule: timing-sensitive files go red under parallel load; a failing file gets one rerun alone
  for (const r of results) {
    if (r.ok) continue;
    const again = await run(process.execPath, ['--test', '--test-reporter=spec', r.file], 300000);
    if (again.code === 0) {
      const g = (k) => Number((new RegExp('^ℹ ' + k + ' (\\d+)', 'm').exec(again.out) || [0, 0])[1]);
      Object.assign(r, { ok: true, pass: g('pass'), fail: g('fail'), ms: r.ms + again.ms, out: again.out });
    }
  }
  const failures = results.filter((r) => !r.ok).map((r) => ({
    file: r.file, ...ownersFor(r.file, ownerOf), tests: failingNames(r.out),
    error: (r.out.split('\n').find((l) => /Error|error:|Cannot find/.test(l)) || '').trim().slice(0, 240),
  }));
  const tests = {
    files: results.length, pass: results.reduce((a, r) => a + r.pass, 0), fail: results.reduce((a, r) => a + r.fail, 0),
    seconds: Math.round(results.reduce((a, r) => a + r.ms, 0) / 100) / 10,
  };

  // fresh match with the current code; matches/latest.json is replaced only on success
  const seed = (buildNo % 9000) + 1;
  const tmp = path.join(ROOT, 'matches', '.latest.tmp.json');
  let match;
  const mr = await run(process.execPath, ['env/run-match.mjs', '--seed', String(seed), '--p0', 'players/sample-player.mjs', '--p1', 'players/sample-player.mjs', '--out', rel(tmp), '--quiet', '--classic'], 90000);
  if (mr.code === 0 && fs.existsSync(tmp)) {
    fs.renameSync(tmp, path.join(ROOT, 'matches', 'latest.json'));
    match = { ok: true, seed, file: 'matches/latest.json', result: parseLine(mr.out.trim().split('\n').pop()), ms: mr.ms };
  } else {
    match = { ok: false, seed, error: mr.out.trim().slice(-300), keptPrevious: fs.existsSync(path.join(ROOT, 'matches', 'latest.json')) };
  }

  const green = !failures.length && !parseErrors.length && match.ok;
  const bad = [failures.length && `${failures.length} test file(s) failing`, parseErrors.length && `${parseErrors.length} module(s) don't parse`, !match.ok && 'match did not record'].filter(Boolean).join(', ');
  const status = {
    build: buildNo, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 100) / 10,
    state: green ? 'green' : 'red', nextBuildAt: once ? null : new Date(Date.now() + every).toISOString(),
    headline: green ? `Green: ${tests.pass} tests pass in ${tests.files} files, all ${mods.length} modules parse, new match recorded.` : `Red: ${bad}.`,
    tests, failures, parse: { checked: mods.length, errors: parseErrors }, match,
    changed: { first, added: added.map(withOwner), changed: changed.map(withOwner), removed: removed.map(withOwner), total: added.length + changed.length + removed.length },
    files: Object.fromEntries(['env', 'viewer', 'viewer3d', 'tests', 'players', 'live'].map((d) => [d, Object.keys(hashes).filter((f) => f.startsWith(d + '/')).length])),
    previous: prev.last ? { build: prev.build, state: prev.last.state, at: prev.last.at, failing: prev.last.failing } : null,
  };
  writeAtomic(STATUS, JSON.stringify(status, null, 1) + '\n');
  writeAtomic(STATE, JSON.stringify({ build: buildNo, hashes, last: { state: status.state, at: status.at, failing: failures.map((f) => f.file) } }));
  console.log(`[${status.at}] build ${buildNo} ${status.state.toUpperCase()}: ${status.headline} (${status.seconds}s, ${status.changed.total} file changes)`);
}

let n = readJson(STATE, { build: 0 }).build;
for (;;) {
  try { await build(++n); } catch (e) { console.error('compile error', e); }
  if (once) break;
  await new Promise((r) => setTimeout(r, every));
}
