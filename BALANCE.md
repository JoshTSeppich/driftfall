# Balance report: Snakenators mirror (G6)

Owner: team haiku. Runner: `scratch-haiku/balance/run.mjs` (built-in normal AI vs built-in normal AI, headless, `env/sim.mjs` or `env/sim-territory.mjs`, seeds 1 to 40). Raw rows: `scratch-haiku/balance/out/*.jsonl`.

## Result: does not pass yet

Targets: side win rate 45-55%, match length 12-16 min.

| Rules | Matches | Side 0 wins | Side 1 wins | Mean length | Ends by |
|---|---|---|---|---|---|
| legacy (the live v2 game) | 40 | 17.5% | 82.5% | 1.37 min | timeout at 2000 ticks (39), core kill (1) |
| territory (v0.1 rules, `createTerritoryMatch`, factions coil vs coil) | 40 | 42.5% | 57.5% | 1.70 min | core kill (40) |

## What this means

1. **Length is about 1.4 to 1.7 minutes, not 12 to 16.** The legacy cap is `STATS.match.maxTicks = 2000` (about 84 s), so most legacy games are decided by the timeout's value count. The territory games end by Core kill at about 1:42 with no Drift, Hold or tier play in them. The AI is rushing a cheap army straight at the Core.
2. **Side 1 has a strong edge on the live game.** 82.5% of legacy matches go to side 1, which is far outside 45-55%. The territory mirror is closer, but still outside the band at 42.5 / 57.5 over 40 seeds (a margin of about 2.5 points past the 55% line; not conclusive at this sample size).
3. **The territory numbers are not a valid balance signal yet.** `players/builtin/ai.mjs` plans territory only when `obs.rules.territory` is present (lines 182-183). `env/state.mjs` `observe()` never sets that field, so the AI in a territory match makes no claims, follows no Hold plan and reads no Drift warnings. The territory games are therefore a rush with no territory play. This needs an observation contract (sonnet owns `sim-territory`, fable owns the AI or the observe shape) before any v0.1 balance result counts.
4. **Dominant strategy:** in both modes the early army rush wins. The live game's side bias says the sim's side ordering (`sideOrder`) or spawn positions favour side 1; not yet checked which.

## Next steps (owners to confirm in the chat)

- Wire `obs.rules` (territory, budget net, Drift upcoming and active) into `observe()` for territory matches, then rerun. (sonnet and fable)
- Check the side bias: swap sides across seeds and compare, and look at the spawn geometry of the Cores. (fable)
- Raise the territory cap to about 23040 ticks (16 min) and confirm the Fall ends games in range. The runner already accepts `--max-ticks`.
- Rerun 200+ seeds once the observation lands. The run takes about 6 s per 2000-tick match on this machine.

## Reproduce

```
node scratch-haiku/balance/run.mjs --seeds 1-40 --rules legacy
node scratch-haiku/balance/run.mjs --seeds 1-40 --rules territory --max-ticks 23040
```
