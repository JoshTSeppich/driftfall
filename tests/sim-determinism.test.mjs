import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envDir = join(root, 'env');
const samplePath = join(root, 'players', 'sample-player.mjs');

const play = async (seed) => (await import('../env/referee.mjs')).runMatch({ seed, players: [samplePath, samplePath] });
const withoutTiming = (log) => {
  const { timing, ...rest } = log;
  return JSON.stringify(rest);
};

test('same seed, same players: logs are byte-identical without timing', async () => {
  const a = await play(11);
  const b = await play(11);
  assert.ok(a.log.ticks.length > 0, 'the match should run at least one tick');
  assert.equal(withoutTiming(a.log), withoutTiming(b.log));
  assert.equal(JSON.stringify(a.result), JSON.stringify(b.result));
});

test('same seed: comparable(log) is identical too', async () => {
  const { comparable } = await import('../env/log.mjs');
  const a = await play(5);
  const b = await play(5);
  assert.equal(JSON.stringify(comparable(a.log)), JSON.stringify(comparable(b.log)));
  assert.equal('timing' in comparable(a.log), false);
});

test('timing is the only top-level field that may differ', async () => {
  const a = await play(3);
  const b = await play(3);
  assert.deepEqual(Object.keys(a.log).sort(), Object.keys(b.log).sort());
  for (const key of Object.keys(a.log)) {
    if (key === 'timing') continue;
    assert.equal(JSON.stringify(a.log[key]), JSON.stringify(b.log[key]), `field "${key}" differed`);
  }
  for (const log of [a.log, b.log]) {
    assert.ok(Array.isArray(log.timing), 'timing is a list');
    assert.equal(log.timing.length, log.ticks.length, 'one timing pair per tick');
    for (const pair of log.timing) {
      assert.equal(pair.length, 2);
      assert.ok(pair.every((ms) => typeof ms === 'number' && ms >= 0));
    }
  }
});

test('no millisecond numbers leak into events', async () => {
  const { log } = await play(3);
  for (const t of log.ticks) {
    for (const ev of t.events) {
      if (ev.e === 'late' || ev.e === 'error' || ev.e === 'forfeit') {
        assert.equal('ms' in ev, false);
        assert.equal('time' in ev, false);
      }
    }
  }
});

test('different seeds give different logs', async () => {
  const a = await play(1);
  const b = await play(2);
  assert.equal(a.log.seed, 1);
  assert.equal(b.log.seed, 2);
  assert.notEqual(withoutTiming(a.log), withoutTiming(b.log));
  assert.notEqual(JSON.stringify(a.log.initial.rocks), JSON.stringify(b.log.initial.rocks), 'maps should differ');
});

function listSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listSources(p));
    else if (/\.(mjs|js|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('env sources (except referee and player-worker) avoid nondeterministic APIs', () => {
  const allowed = new Set(['referee.mjs', 'player-worker.mjs']);
  const banned = [/Math\.random/, /Date\.now/, /setTimeout/, /new\s+Date/];
  const files = listSources(envDir).filter((f) => !allowed.has(f.slice(envDir.length + 1)));
  assert.ok(files.length > 0, 'expected env files to scan');
  const hits = [];
  for (const f of files) {
    // Comments may mention the banned names ("never uses Math.random"); only code counts.
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    for (const re of banned) if (re.test(text)) hits.push(`${relative(root, f)}: ${re.source}`);
  }
  assert.deepEqual(hits, []);
});
