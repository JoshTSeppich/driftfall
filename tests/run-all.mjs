// Run every test file, print a plain-English summary per area with its owner, and write tests/last-run.json.
//   node tests/run-all.mjs            run everything, print the summary, write tests/last-run.json
//   node tests/run-all.mjs combat     run only areas whose name contains "combat" (print only, no write)
// Exit code 0 when every file passes, 1 otherwise. See tests/README.md.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = path.join(ROOT, 'tests');
const OUT = path.join(TESTS, 'last-run.json');
const TIMEOUT_MS = 120000;
const JOBS = 4;
const LABELS = { map: 'Map generation', path: 'Path finding', log: 'Match log', viewer: 'Replay viewer', stats: 'Stats table', state: 'State helpers', commands: 'Commands', combat: 'Combat', economy: 'Economy', movement: 'Movement', sim: 'Simulation', referee: 'Referee', full: 'Full match', live: 'Live page', art: 'Art', viewer3d: '3D viewer' };
const filter = process.argv.slice(2).join(' ').trim().toLowerCase();

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }

// Owners: PLAN.json (module files, then test files), then the VISUAL-3D.md owner table (same rule as live/compile.mjs).
const plan = readJson(path.join(ROOT, 'PLAN.json'), { modules: [], tests: [] });
const moduleOwner = new Map(); const fileOwner = new Map(); const testOwner = new Map();
for (const m of plan.modules || []) { moduleOwner.set(m.id, m.owner); for (const f of m.files) fileOwner.set(f, m.owner); }
for (const t of plan.tests || []) for (const f of t.files) testOwner.set(f, t.owner);
try {
  for (const line of fs.readFileSync(path.join(ROOT, 'VISUAL-3D.md'), 'utf8').split('\n')) {
    const c = line.split('|').map((s) => s.trim());
    if (c.length < 4 || !/\.(mjs|html)|\/$/.test(c[1])) continue;
    const owner = c[2].split(/[ (]/)[0];
    for (const f of c[1].split(',').map((s) => s.trim())) if (f && !f.includes('*')) fileOwner.set(f.includes('/') ? f : 'viewer3d/' + f, owner);
  }
} catch { /* no table */ }

// Tests the spec or the table did not name: owner of the first source module the test imports.
function ownerOf(testRel, src) {
  if (testOwner.has(testRel)) return testOwner.get(testRel);
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) continue;
    const rel = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, testRel)), m[1]));
    if (fileOwner.has(rel)) return fileOwner.get(rel);
  }
  return 'unassigned';
}

// Area = the leading word of the test file name ("combat-damage" -> combat, "viewer3d-world" -> viewer3d).
const areaOf = (file) => path.basename(file, '.test.mjs').split('-')[0];
const label = (id) => LABELS[id] || id[0].toUpperCase() + id.slice(1);

function runFile(file) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let out = ''; let err = ''; let timedOut = false;
    const p = spawn(process.execPath, ['--test', '--test-reporter=tap', path.join('tests', file)], { cwd: ROOT });
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, TIMEOUT_MS);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e), ms: Date.now() - t0, timedOut: false }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, ms: Date.now() - t0, timedOut }); });
  });
}

// TAP summary lines from node --test ("# pass 12") and failing checks ("not ok 3 - name").
function parseTap(out) {
  const count = (k) => { const m = new RegExp(`^# ${k} (\\d+)$`, 'm').exec(out); return m ? Number(m[1]) : null; };
  const failing = [...out.matchAll(/^\s*not ok \d+ - (.+?)(?: # .*)?$/gm)].map((m) => m[1].trim());
  return { tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') || 0, failing: [...new Set(failing)] };
}

function plainError(r) {
  if (r.timedOut) return `Stopped after ${TIMEOUT_MS / 1000} seconds without finishing.`;
  const lines = (r.err || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const pick = lines.find((l) => /Error|Cannot find|error:/.test(l)) || lines.at(-1) || '';
  return pick.slice(0, 240) || null;
}

function fileResult(file, owner, r) {
  const p = parseTap(r.out);
  let verdict;
  if (r.timedOut) verdict = 'timeout';
  else if (p.tests === null) verdict = 'error';           // crashed or reported nothing: could not even count checks
  else if (r.code === 0 && p.fail === 0) verdict = 'pass';
  else verdict = 'fail';
  const error = verdict === 'pass' ? null : (verdict === 'fail' && p.failing.length ? null : plainError(r));
  return { file: `tests/${file}`, owner, verdict, tests: p.tests || 0, passed: p.pass || 0, failed: p.fail || 0, skipped: p.skipped, ms: r.ms, failing: p.failing, error };
}

async function pool(items, n, fn) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}

const t0 = Date.now();
const allFiles = fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs')).sort();
const selected = allFiles.filter((f) => !filter || areaOf(f).includes(filter) || label(areaOf(f)).toLowerCase().includes(filter));
if (selected.length === 0) { console.log(`No test files match "${filter}".`); process.exitCode = 1; }
else {
  const results = await pool(selected, JOBS, async (f) => {
    const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
    return fileResult(f, ownerOf(`tests/${f}`, src), await runFile(f));
  });

  // Group files by area, in file-name order.
  const areaIds = [...new Set(selected.map(areaOf))];
  const areas = areaIds.map((id) => {
    const files = results.filter((r) => areaOf(path.basename(r.file)) === id);
    const owners = [...new Set(files.map((r) => r.owner))].filter((o) => o !== 'unassigned');
    const owner = moduleOwner.get(id) || (owners.join(', ') || 'unassigned');
    const bad = files.filter((r) => r.verdict !== 'pass');
    const checks = files.reduce((n, r) => n + r.passed, 0);
    const failedChecks = files.reduce((n, r) => n + r.failed, 0);
    const headline = bad.length === 0
      ? `All ${plural(checks, 'check')} pass across ${plural(files.length, 'file')}.`
      : `${bad.length} of ${files.length} file${files.length === 1 ? '' : 's'} not passing: ${bad.map((r) => path.basename(r.file, '.test.mjs')).join(', ')}` +
        (failedChecks ? ` (${failedChecks} failing check${failedChecks === 1 ? '' : 's'}).` : '.');
    return { id, label: label(id), owner, verdict: bad.length ? 'fail' : 'pass', headline, files };
  });

  const failing = results.filter((r) => r.verdict !== 'pass').map((r) => ({
    file: r.file, owner: r.owner, area: areaOf(path.basename(r.file)), failing: r.failing, error: r.error,
  }));
  const totals = {
    files: results.length, filesPassing: results.filter((r) => r.verdict === 'pass').length,
    tests: results.reduce((n, r) => n + r.tests, 0), passed: results.reduce((n, r) => n + r.passed, 0),
    failed: results.reduce((n, r) => n + r.failed, 0), skipped: results.reduce((n, r) => n + r.skipped, 0),
  };
  const green = failing.length === 0 && results.length > 0;
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const headline = green
    ? `Green: ${totals.passed} checks pass in ${totals.files} test files.`
    : `Red: ${failing.length} of ${totals.files} test file${totals.files === 1 ? '' : 's'} not passing (${totals.failed} failing check${totals.failed === 1 ? '' : 's'}).`;

  // Plain-English summary, one block per area.
  console.log(`Driftfall test run: ${headline} (${seconds}s)\n`);
  for (const a of areas) {
    console.log(`${a.verdict === 'pass' ? 'PASS' : 'FAIL'}  ${a.label} · owner: ${a.owner}`);
    console.log(`      ${a.headline}`);
    for (const r of a.files) {
      const name = path.basename(r.file);
      if (r.verdict === 'pass') { console.log(`      ✔ ${name} (${r.owner}): ${plural(r.passed, 'check')} passed`); continue; }
      console.log(`      ✖ ${name} (${r.owner}): ${r.verdict === 'pass' ? '' : r.verdict === 'timeout' ? 'timed out' : r.verdict === 'error' ? 'did not run' : `${r.failed} of ${r.tests} checks failing`}`);
      for (const n of r.failing.slice(0, 5)) console.log(`          - ${n}`);
      if (r.error) console.log(`          ${r.error}`);
    }
    console.log('');
  }

  if (!filter) {
    const run = {
      format: 'driftfall-test-run', version: 1, at: new Date().toISOString(), seconds, node: process.version,
      verdict: green ? 'green' : 'red', headline, totals,
      areas: areas.map(({ id, label: l, owner, verdict, headline: h, files }) => ({ id, label: l, owner, verdict, headline: h, files })),
      failing,
    };
    const tmp = `${OUT}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(run, null, 1) + '\n');
    fs.renameSync(tmp, OUT);
    console.log(`Wrote tests/last-run.json (${green ? 'green' : 'red'}).`);
  } else {
    console.log('Filtered run: tests/last-run.json not written.');
  }
  process.exitCode = green ? 0 : 1;
}
