# Driftfall performance budgets

Owner: Performance / Optimization Engineer (haiku). Test: `tests/perf.test.mjs`.

## What is measured

| metric | what it times |
|---|---|
| `idle-tick` | one tick of a full seed-7 match with no commands (the sim's base cost) |
| `army-40v40-march` | 40 Grunts a side all walking to the mirror tile: heavy pathing, everyone crossing the middle |
| `army-40v40-engage` | 40 Grunts a side all attacking the enemy with the same index: heavy combat and re-pathing |
| `findpath-open-32` | one `findPath` call, open 32 × 32 grid, corner to corner |
| `findpath-sealed-32` | one `findPath` call that has to search every reachable tile and return null |

40 a side is the spec's unit cap (ENV-SPEC.md §4, `STATS.match.unitCap`). The worst tick the sim can see is roughly the
engage or march case, so those two are the budgets that matter most.

Each number is the median of 5 runs. Each run is divided by a fixed calibration workload timed in the same process,
so the numbers are roughly the same on the Mac mini and the MacBook Air.

## The rule

A change fails the perf test when any metric is **more than 2× its baseline**. That is the gate, and it is a hard
failure. Speed-ups never fail. A balance change that adds real work (more units, more rules) may fail it too; the
fix is to record a new baseline in the same change, say why in the chat, and get it reviewed.

Run it:

```
node --test tests/perf.test.mjs
```

Record a new baseline (rewrites only the block below):

```
node tests/perf.test.mjs --record
```

## Baseline

Recorded on the Mac mini, Node v20.19.6, 2026-10-22, against the sim as it stood in the v2 env.

<!-- perf-baseline:start -->
```json
{
  "note": "Normalised by the calibration workload (see tests/perf.test.mjs). Limit is 2x each value.",
  "calibrationMs": 5.072,
  "metrics": {
    "idle-tick": {
      "unit": "us per tick, seed 7, no commands",
      "normalized": 0.2999,
      "rawAtRecord": 1.521
    },
    "army-40v40-march": {
      "unit": "us per tick, 40 v 40 all moving across",
      "normalized": 827.6166,
      "rawAtRecord": 4197.533
    },
    "army-40v40-engage": {
      "unit": "us per tick, 40 v 40 all attacking",
      "normalized": 258.5203,
      "rawAtRecord": 1311.172
    },
    "findpath-open-32": {
      "unit": "us per call, open 32x32, corner to corner",
      "normalized": 3.2996,
      "rawAtRecord": 16.735
    },
    "findpath-sealed-32": {
      "unit": "us per call, goal sealed by rocks",
      "normalized": 3.3527,
      "rawAtRecord": 17.005
    }
  }
}
```
<!-- perf-baseline:end -->

## Known costs (not yet gated)

- `movement.mjs` runs a fresh BFS for every moving unit every tick. When a unit is waiting, its detour BFS calls
  `state.units.some` for every tile, so congested fights are the expensive case. Owner: Pathfinding / Movement
  Programmer (fable, `env/movement.mjs`). Not changed here; numbers in the engage metric show the cost.
- `isPassable` scans crystals and structures for each tile it tests. Fine at 32 × 32; it will matter at the 48 × 48
  size proposed in the v3 terrain round. Owner: state helpers (haiku, `env/state.mjs`), to be revisited when v3 lands.
- Workers gathering, building and the fog-of-war work proposed in v3 have no metric yet. Add one when they land.
- Rendering (60 fps at 1080p) is not gated here; it belongs to the Lead Engine Programmer and the viewer3d QA.
