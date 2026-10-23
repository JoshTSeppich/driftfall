#!/usr/bin/env node
// Balance runner (haiku, G6): built-in AI vs built-in AI, headless, many seeds.
//   node scratch-haiku/balance/run.mjs --seeds 1-50 --rules territory|legacy [--max-ticks N] [--json out.jsonl]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { createMatch, step, checkEnd } = await import(path.join(root, 'env/sim.mjs'));
const { createTerritoryMatch } = await import(path.join(root, 'env/sim-territory.mjs'));
const { observe } = await import(path.join(root, 'env/state.mjs'));
const { loadAi } = await import(path.join(root, 'env/live.mjs'));

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const [lo, hi] = opt('--seeds', '1-20').split('-').map(Number);
const rules = opt('--rules', 'territory');
const maxTicks = opt('--max-ticks', null);
const jsonOut = opt('--json', null);
const ai = path.join(root, 'players/builtin/ai.mjs');

function newState(seed) {
  if (rules === 'territory') return createTerritoryMatch(seed, { factions: ['coil', 'coil'] });
  return createMatch(seed);
}

async function playOne(seed) {
  const state = newState(seed);
  if (maxTicks) state.maxTicks = Number(maxTicks);
  const players = [await loadAi(ai, { side: 0, seed, difficulty: 'normal' }), await loadAi(ai, { side: 1, seed, difficulty: 'normal' })];
  let result = null;
  const started = performance.now();
  let errors = 0;
  while (!result) {
    const cmds = [[], []];
    for (const side of [0, 1]) {
      try {
        const c = players[side].act(observe(state, side));
        if (Array.isArray(c)) cmds[side] = c;
        else errors++;
      } catch (err) {
        errors++;
      }
    }
    step(state, cmds);
    result = state.result ?? checkEnd(state);
  }
  return { seed, winner: result.winner, reason: result.reason, tick: result.tick, minutes: result.tick / 24 / 60, errors, ms: Math.round(performance.now() - started) };
}

const rows = [];
for (let s = lo; s <= hi; s++) {
  const r = await playOne(s);
  rows.push(r);
  if (jsonOut) fs.appendFileSync(jsonOut, JSON.stringify(r) + '\n');
}
const n = rows.length;
const w0 = rows.filter((r) => r.winner === 0).length;
const w1 = rows.filter((r) => r.winner === 1).length;
const mins = rows.map((r) => r.minutes).sort((a, b) => a - b);
const mean = mins.reduce((a, b) => a + b, 0) / n;
const reasons = {};
for (const r of rows) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
console.log(JSON.stringify({
  rules, matches: n, side0: w0, side1: w1, draws: n - w0 - w1,
  win0: +((w0 / n) * 100).toFixed(1), win1: +((w1 / n) * 100).toFixed(1),
  meanMin: +mean.toFixed(2), medianMin: +mins[Math.floor(n / 2)].toFixed(2), reasons,
  errors: rows.reduce((a, r) => a + r.errors, 0), msPerMatch: Math.round(rows.reduce((a, r) => a + r.ms, 0) / n),
}));
