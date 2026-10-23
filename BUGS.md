# Driftfall bug log

Owned by the QA Tester (team haiku). Each entry: seed, tick, what happened, expected, owner (from PLAN.json).
Scope: found by playing matches through `env/run-match.mjs` and reading the logs. Code is not edited here.

## Open

### BUG-001: side 1 wins every symmetric timeout match (seat bias)
- **Owner:** fable (env/sim.mjs, env/movement.mjs, env/economy.mjs; tie-breaks in env/combat.mjs). Known-limit candidate for v3.1 per fable's #192.
- **Repro:** `node env/run-match.mjs --seed S --p0 players/sample-player.mjs --p1 players/sample-player.mjs --out x.json` for S = 1..60.
- **What happened:** side 1 won all 60 of 60 by timeout (tick 2000). Values were about 3440–3480 for side 0 against 3500–3560 for side 1 (seed 1: [3440, 3550]; seed 7: [3460, 3520]). The gap averages about 85–90.
- **Control:** both sides run an idle test player that returns `[]` (kept outside the repo): seeds 1, 2, 3, 7, 11 all end `winner null, timeout, value [300, 300]`. So the referee and the value rule are symmetric; the bias needs both players acting.
- **Expected:** with identical players on a point-mirrored map, the win rate should be near 50/50 (spec §8 fairness rule).
- **Notes:** same finding from sonnet's AI tuner (#173) and haiku (#175: tie-breaks for spawn, gather, path neighbour order and nearest-enemy ids are not point-symmetric). A mirror-equivariant probe (decisions made in side-0 coordinates) gave 4 side-1 wins out of 5 seeds with values within 50 (seeds 1, 2, 3, 7, 11). That is smaller but not yet enough samples to call it fair; more seeds pending.

### BUG-002: Workers freeze forever when a crystal tile has no free neighbour
- **Owner:** fable (env/movement.mjs, env/economy.mjs).
- **Repro:** `node env/run-match.mjs --seed 1 --p0 <probe> --p1 <probe> --out x.json`, where the probe sends every idle Worker to the same nearest crystal, `(23,29)` on seed 1 for side 1. The probe is in /tmp/driftfall-qa (not in the repo).
- **What happened:** from about tick 700 on, side 1 has about 30 Workers on order `gather (23,29)`, phase `toField`, `ticks: 0`. At tick 700 they stand at (22..31, 26..31); at tick 1000 they are unchanged. Side 1's last `move` event is at tick 873 and it mines only 1,580 Shards against side 0's 4,800 in the same run. No `blocked` event, no retarget.
- **Expected:** a Worker that cannot reach a free tile next to its crystal should wait and then retarget, or the order should clear with a `blocked` event. Spec §3 only covers empty tiles, so this is a gap in the spec too.
- **Notes:** the probe caused the pile-up, so this is partly a player-side issue. The engine still gives a jammed Worker no way out, and that is the bug. The same freeze shape showed up in sample-vs-sample (fable's seed 7, tick 440, #104), which fable fixed in movement (#115). Only the crowded-tile case is still open.

## Verified and not a bug

- **Sim side order:** `ticks[1]` (tick 1, odd) lets side 1 act first, which matches spec §8 (side 0 on even `t`, the pre-step tick). The log is numbered by the tick the players saw, as fable said in #108.
- **Tick 0 in the log:** 2000 entries, `result.tick` 2000 on every sample match.

## Fixed

_None yet._
