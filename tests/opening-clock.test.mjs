// Opening and clock (Council #1) on the Toaster Wars rules: nothing ends before 3:00, because toasters go hungry
// and cannot leave their cord, so the old 15 s rush is gone. Runs the territory match (the game Joshua plays) for
// exactly the 3:00 floor and checks that neither side has won by then. A territory bot match costs seconds of real
// time per game minute, so the suite keeps two matches; scripts/opening-sweep.mjs holds the wide sweep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMatch } from '../env/referee.mjs';
import { STATS, secondsToTicks } from '../env/stats.mjs';

const url = (p) => new URL(p, import.meta.url).pathname;
const RUSHERS = [
  { name: 'fable', bot: url('../players/fanatic-fable/bot.mjs'), side: 0 },
  { name: 'sonnet', bot: url('../players/fanatic-sonnet/bot.mjs'), side: 1 },
];
const DEFENDER = url('../players/defender-sonnet/bot.mjs');

const FLOOR_TICKS = secondsToTicks(180);
const SEED = 591;

test('the Power Strip and the toaster pace numbers are in the stats table', () => {
  // The classic table (STATS.core, STATS.units) is pinned by tests/stats-table.test.mjs and is not played live.
  assert.ok(STATS.toaster.coreHp >= 2000, 'Power Strip hp must be at least 2000, got ' + STATS.toaster.coreHp);
  assert.ok(STATS.toaster.units.grunt.trainTicks >= 30, 'Popper train time must be at least 30 ticks');
  assert.ok(STATS.toaster.units.grunt.speed >= 3, 'Popper speed must be at least 3 ticks per step');
  assert.ok(STATS.toaster.units.grunt.shot.every >= 12, 'a Popper may not fire faster than one slice every half second');
});

test('a rush bot does not beat a defender, and no match ends, before 3:00', async () => {
  for (const { name, bot, side } of RUSHERS) {
    const players = side === 0 ? [bot, DEFENDER] : [DEFENDER, bot];
    const log = await runMatch({ seed: SEED, players, maxTicks: FLOOR_TICKS, territory: true });
    const label = name + ' rush on side ' + side;
    assert.ok(log.result.tick >= FLOOR_TICKS, label + ' ended before 3:00 at tick ' + log.result.tick + ': ' + JSON.stringify(log.result));
  }
});
