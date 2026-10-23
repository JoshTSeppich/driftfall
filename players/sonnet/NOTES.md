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

## Bot author notes (bot v1, env v2 roster)

Strategy: 5 Workers, Forge ASAP at a mirror-symmetric site near the Core, 7 Workers, then Grunt/Lancer/Brute chosen by
counter weights against what the enemy has (COUNTERS table in bot.mjs; add new unit kinds there and in BASE_MIX, unknown
kinds default to weight 1/0.7). Army waits at a rally point, attacks when its power (hp*dmg*range bonus) beats
1.25x enemy power + 3000 (+6000 per enemy Turret), retreats below 0.7x, goes all-in after tick 1500. Enemy units near the
Core pull the army home and trigger a Turret. Targets: nearest enemy fighter, Brutes take Turrets, then Forge, then Core.
Tie-breaks are side-signed so both seats behave the same (first version lost every side-0 mirror match to this).

Measured (sim.mjs, 40 seeds x 2 seats vs sample): 80W 0D 0L, mean core-win tick 296, think max 8.9 ms, 0 rejects.
Mirror (bot vs bot, seeds 1-10): side 0 won 5, side 1 won 5.
Not measured: any opponent stronger than the sample. Tunable next: wave threshold, worker count, Turret use.
