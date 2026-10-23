// Fanatic-fable bot (FANATICS.md): legal under the referee and a fast rusher on the legacy 32x32 map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMatch } from '../env/referee.mjs';

const FABLE = new URL('../players/fanatic-fable/bot.mjs', import.meta.url).pathname;
const BUILTIN = new URL('../players/builtin/ai.mjs', import.meta.url).pathname;

test('fanatic-fable beats the built-in AI by Core inside 40 seconds from either side', async () => {
  for (const [players, side] of [[[FABLE, BUILTIN], 0], [[BUILTIN, FABLE], 1]]) {
    const log = await runMatch({ seed: 43, players, maxTicks: 2000 });
    assert.equal(log.result.winner, side);
    assert.equal(log.result.reason, 'core');
    assert.ok(log.result.tick < 960, 'rush lands before 0:40, got tick ' + log.result.tick);
  }
});
