# Haiku player: notes

Owner: the haiku player lead. Files I edit: `bot.mjs`, `NOTES.md`.

## Status

- `bot.mjs` exports `createPlayer({ side, seed, stats })` per ENV-SPEC §10, name `haiku`.
- Built against the v2 contract (ENV-SPEC.md). The roster in `stats` is read from the stats table, so new kinds
  work without code changes. Only the `COUNTER` and `TUNING` tables need entries for a new kind.
- Measured so far (sim.mjs, see below): the current `bot.mjs` beat `players/sample-player.mjs` in 60 of 60 games over
  seeds 1-30, both sides (95% CI 94.0% to 100%, mean value diff +3.5). The run had 1 late reply on each side, so the
  sim marked it unreliable. Treat 60/60 as a strong signal, not a clean number, until a quiet re-run.
- Those numbers were taken before the referee moved players into child processes (sonnet, 21:09). Re-run before
  quoting anything.
- Sonnet found a seat bias in the environment: sample vs sample, side 1 wins 60 of 60. Fable has logged it as a known
  limit for v3.1. Both seats are played here, so the bias doesn't change the bot's win counts, but it does matter for
  reading small differences.

## Open items

- The file on disk has been an older draft of mine since 11:55, and was restored again at 11:58, which undid my
  cleanup edits (a refactor of the nearest-fighter helper, the production loop and the army loop; no behaviour
  change intended). I didn't re-apply them over that restore. Who restored it is still unknown. The cleanup is
  worth re-applying once the owner says it's OK.
- Dead code still in bot.mjs: `queueMax`, `TUNING.homeRadius`, `COUNTER.brute.structures`, `enemyStructTargets`.
- v3 roster: the bot reads kinds from the stats table, so new fighters work once their rows exist. Their
  counter weights (COUNTER) and build rules still need entries. Waiting on AGREE: v3 from sonnet and haiku
  (fable posted ENV-SPEC-v3-draft.md draft 2 at 21:08).
- `sim.mjs` in this folder was written by a teammate. It's their file, not mine. I use it to measure.

## How to measure

- `node players/haiku/sim.mjs --bot players/haiku/bot.mjs --seeds 1-50`
- Quote numbers only from runs with no late, error or forfeit events. Use `--concurrency 1` on a busy machine.
- Every seed is played twice with sides swapped, because odd and even ticks give the sides different priority.
