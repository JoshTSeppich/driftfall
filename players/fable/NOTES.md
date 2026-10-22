# Haiku player: notes

Owner: the haiku player lead. Files I edit: `bot.mjs`, `NOTES.md`.

## Status

- `bot.mjs` exports `createPlayer({ side, seed, stats })` per ENV-SPEC §10, name `haiku`.
- Built against the v2 contract (ENV-SPEC.md). The roster in `stats` is read from the stats table, so new kinds
  work without code changes. Only the `COUNTER` and `TUNING` tables need entries for a new kind.
- Measured so far (sim.mjs, see below): the current `bot.mjs` beat `players/sample-player.mjs` in 12 of 12 games over
  seeds 1-6, both sides. Late replies showed up on this busy machine (3 and 2), so the sim marked the run unreliable.
  I need a quieter run before I quote a number.

## Open items

- The file on disk at 11:55 was an older draft of mine (a cleaned-up rewrite was lost). Who changed it is still
  unknown; I've asked in the team chat. I'll reapply the cleanup on top of the current file once the teammate
  replies, without undoing anything they meant to keep.
- `sim.mjs` in this folder was written by a teammate. It's their file, not mine. I use it to measure.

## How to measure

- `node players/haiku/sim.mjs --bot players/haiku/bot.mjs --seeds 1-50`
- Quote numbers only from runs with no late, error or forfeit events. Use `--concurrency 1` on a busy machine.
- Every seed is played twice with sides swapped, because odd and even ticks give the sides different priority.
