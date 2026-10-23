// Opening and clock (Council #1, match 62 at tick 374): no match ends before 3:00, and a rush loses to a Turret plus
// worker-pull defender. Runs on the referee's default map. The 20-seed sweep is scripts/opening-sweep.mjs; this file
// keeps a few seeds so the suite stays fast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMatch } from '../env/referee.mjs';
import { STATS, secondsToTicks } from '../env/stats.mjs';

const url = (p) => new URL(p, import.meta.url).pathname;
const RUSHERS = {
  fable: url('../players/fanatic-fable/bot.mjs'),
  sonnet: url('../players/fanatic-sonnet/bot.mjs'),
  haiku: url('../players/fanatic-haiku/bot.mjs'),
};
const DEFENDER = url('../players/defender-sonnet/bot.mjs');
const BUILTIN = url('../players/builtin/ai.mjs');

// Nothing ends before 3:00 (the Council's floor) and a typical match runs to 12-16 minutes.
const FLOOR_TICKS = secondsToTicks(180);
const SEEDS = [591, 592];
// Long enough to see a 16-minute match end on its own clock; the Core must survive the whole window.
const MAX_TICKS = secondsToTicks(16 * 60);

test('the Core floor and clock numbers are in the stats table', () => {
  assert.ok(STATS.core.hp >= 3000, 'Core hp must be at least 3000, got ' + STATS.core.hp);
  assert.ok(STATS.units.grunt.trainTicks >= 30, 'grunt train time must be at least 30 ticks');
  assert.ok(STATS.units.grunt.speed >= 3, 'grunt speed must be at least 3 ticks per step');
  assert.ok(STATS.structures.forge.buildTicks >= 80, 'forge build time must be at least 80 ticks');
});

test('each rush bot loses to a Turret plus worker-pull defender and no match ends before 3:00', async () => {
  for (const [name, bot] of Object.entries(RUSHERS)) {
    for (const seed of SEEDS) {
      for (const rushSide of [0, 1]) {
        const players = rushSide === 0 ? [bot, DEFENDER] : [DEFENDER, bot];
        const log = await runMatch({ seed, players, maxTicks: MAX_TICKS });
        const label = name + ' seed ' + seed + ' rush side ' + rushSide;
        assert.notEqual(log.result.winner, rushSide, label + ' should not win: ' + JSON.stringify(log.result));
        assert.ok(log.result.tick >= FLOOR_TICKS, label + ' ended before 3:00 at tick ' + log.result.tick);
      }
    }
  }
});

test('a built-in mirror does not end before 3:00', async () => {
  for (const seed of SEEDS) {
    const log = await runMatch({ seed, players: [BUILTIN, BUILTIN], maxTicks: MAX_TICKS });
    assert.ok(log.result.tick >= FLOOR_TICKS, 'mirror seed ' + seed + ' ended at tick ' + log.result.tick);
  }
});
