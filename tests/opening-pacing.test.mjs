// Opening pace (Council #1, Match Room seed 996): on the classic game a Core fell at tick ~374-459 (15-19 s) to one
// brawl. With { pacing: true } a match gets a tougher Core, a Core shield to 3:00, and slower travel, training and
// building at 24 tps. The defaults stay the old classic numbers, so nothing changes unless a match asks for pacing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACING, STATS, rowOf, secondsToTicks } from '../env/stats.mjs';
import { createMatch, step } from '../env/sim.mjs';
import { runMatch } from '../env/referee.mjs';

const url = (p) => new URL(p, import.meta.url).pathname;
const RUSHERS = [
  url('../players/fanatic-fable/bot.mjs'),
  url('../players/fanatic-sonnet/bot.mjs'),
  url('../players/fanatic-haiku/bot.mjs'),
];
const DEFENDER = url('../players/defender-sonnet/bot.mjs');
// The full 20-seed sweep takes about 3 minutes, so the suite runs 3 seeds. Set PACING_SWEEP=1 for all 20.
const SEEDS = Array.from({ length: process.env.PACING_SWEEP ? 20 : 3 }, (_, i) => i + 1);
const SHIELD_TICKS = secondsToTicks(180);

test('the pacing table: a tougher Core, a 3:00 shield and slower timings', () => {
  assert.equal(PACING.coreHp, 2500);
  assert.equal(PACING.coreShieldTicks, SHIELD_TICKS);
  assert.equal(PACING.slow, 2);
  assert.equal(STATS.core.hp, 1000, 'the classic Core stays 1000 hp without pacing');
});

test('pacing is off by default: the classic state plays the classic numbers', () => {
  const state = createMatch(7);
  const core = state.structures.find((s) => s.kind === 'core' && s.owner === 0);
  assert.equal(core.hp, 1000);
  assert.equal(rowOf(state, 'grunt').speed, STATS.units.grunt.speed);
  assert.equal(rowOf(state, 'grunt').trainTicks, STATS.units.grunt.trainTicks);
  assert.equal(rowOf(state, 'forge').buildTicks, STATS.structures.forge.buildTicks);
});

test('a paced match: Core hp, unit speed, train time and build time are slowed', () => {
  const state = createMatch(7, { pacing: true });
  const core = state.structures.find((s) => s.kind === 'core' && s.owner === 0);
  assert.equal(core.hp, PACING.coreHp);
  assert.equal(rowOf(state, 'grunt').speed, STATS.units.grunt.speed * PACING.slow);
  assert.equal(rowOf(state, 'brute').speed, STATS.units.brute.speed * PACING.slow);
  assert.equal(rowOf(state, 'grunt').trainTicks, STATS.units.grunt.trainTicks * PACING.slow);
  assert.equal(rowOf(state, 'forge').buildTicks, STATS.structures.forge.buildTicks * PACING.slow);
  assert.equal(rowOf(state, 'grunt').damage, STATS.units.grunt.damage, 'damage is not slowed');
});

test('the Core takes no damage before the 3:00 shield runs out, and takes it after', () => {
  const state = createMatch(7, { pacing: true });
  const core = state.structures.find((s) => s.kind === 'core' && s.owner === 0);
  // A side-1 Grunt beside the side-0 Core with an attack order on it.
  state.units.push({
    id: 999, owner: 1, kind: 'grunt', x: core.x + 1, y: core.y, hp: STATS.units.grunt.hp,
    carrying: 0, order: { type: 'attack', target: core.id },
  });
  while (state.tick < SHIELD_TICKS - 1) step(state, [[], []]);
  assert.equal(core.hp, PACING.coreHp, 'no damage while shielded');
  for (let i = 0; i < 40; i++) step(state, [[], []]);
  assert.ok(core.hp < PACING.coreHp, 'the Core takes damage once the shield is down');
});

test('no paced match ends before 3:00, across 20 seeds and every rusher', async () => {
  for (const bot of RUSHERS) {
    for (const seed of SEEDS) {
      for (const side of [0, 1]) {
        const players = side === 0 ? [bot, DEFENDER] : [DEFENDER, bot];
        const log = await runMatch({ seed, players, maxTicks: SHIELD_TICKS, pacing: true });
        assert.ok(
          log.result.reason !== 'core' || log.result.tick >= SHIELD_TICKS,
          `${bot} seed ${seed} side ${side} ended by core at tick ${log.result.tick}`,
        );
      }
    }
  }
});
