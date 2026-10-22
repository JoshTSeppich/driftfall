# Tuner notes (for the bot author)

Harness: `node players/sonnet/sim.mjs --help`. Real env/ matches, in-process, many seeds, A in both seats.

- Quick check: `node players/sonnet/sim.mjs --a bot --b sample --seeds 1-40`
- Freeze a version to beat later: `--snapshot v2`, then `--b snap:v2` (or `--b git:HEAD~1`).
- Tune a knob: make `createPlayer({ side, seed, stats, params })` read `params.<name>` with a default, then
  `--sweep <name>=1,2,3 --seeds 1-60`. Several `--sweep` flags make a grid.
- `--save --label "text"` appends the run to `results.json`.
- Always judge on both seats: the env currently favours side 1 in mirror matches (see chat), so a one-seat result lies.

Baseline (bot at first harness run, 40 seeds x 2 seats): 80W 0D 0L vs sample, core wins at mean tick 1594, A think max ~100 ms
(2 late acts out of ~160k under 7 parallel workers; check with `--jobs 1` before blaming the bot).
Bot vs its own snapshot: decided by seat, side 1 wins 10/10 (env issue, not a bot difference).
