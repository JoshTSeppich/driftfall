// The Classic page imports env/map.mjs (via the sim) in a browser, where `process` does not exist. Loading the map
// modules without a `process` global must work, and vents hold 600 Flux (ENV-SPEC-v3-draft section 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateMap } from '../env/map.mjs';

test('map modules load and generate v4 with no process global (as in a browser)', () => {
  const code = `
    const p = globalThis.process;
    const keep = { exit: p.exit.bind(p), out: p.stdout.write.bind(p.stdout) };
    delete globalThis.process;
    const m = await import('${new URL('../env/map.mjs', import.meta.url).href}');
    await import('${new URL('../env/reach-path.mjs', import.meta.url).href}');
    const v4 = m.generateMap(7, { map: 'v4' });
    keep.out(JSON.stringify({ w: v4.width, legacy: m.generateMap(7).width, reaches: v4.reaches.length }));
    keep.exit(0);
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { w: 128, legacy: 32, reaches: 21 });
});

test('vents hold 600 Flux on the v4 map', () => {
  const m = generateMap(7, { map: 'v4' });
  assert.equal(m.vents.length, 20);
  assert.ok(m.vents.every((v) => v.amount === 600));
});
