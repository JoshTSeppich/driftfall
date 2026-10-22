# env/stats.mjs review (Technical Designer, team haiku)

Reviewed against ENV-SPEC.md v2 (§2–§5, §9, §11), PLAN.json, and the env modules as they stand in the folder:
stats.mjs, combat.mjs, commands.mjs, economy.mjs, movement.mjs, sim.mjs, map.mjs. stats.mjs was not edited.
Scope is data only: names, units, completeness, duplicates and consistency. Balance and play are not judged here.

## 1. Verified: every spec number in stats.mjs matches

Checked by loading the real module (`node -e` import) and comparing with the spec tables:

| Spec | Stats path | Value | Match |
|---|---|---|---|
| §2 map size | `map.width`, `map.height` | 32, 32 | yes |
| §2 rock pairs / attempts | `map.rockPairs`, `map.rockAttempts` | 24, 2000 | yes |
| §2 rock clearance | `map.rockClearance` | 2 | yes |
| §3 start Shards | `match.startShards` | 100 | yes |
| §3 crystal amount / mine / carry | `crystal.amount`, `crystal.mineTicks`, `crystal.carry` | 400, 8, 10 | yes |
| §4 Core hp | `core.hp` | 1000 | yes |
| §4 queue max / unit cap | `match.queueMax`, `match.unitCap` | 5, 40 | yes |
| §4 forge cost/hp/build | `structures.forge` | 150, 400, 40 | yes |
| §4 turret cost/hp/build/dmg/range | `structures.turret` | 100, 150, 30, 12, 5 | yes |
| §5 worker | `units.worker` | 50, 40, 2, 1, 1, 20 | yes |
| §5 grunt | `units.grunt` | 50, 60, 8, 1, 1, 15 | yes |
| §5 lancer | `units.lancer` | 75, 40, 10, 4, 1, 20 | yes |
| §5 brute | `units.brute` | 150, 240, 25, 1, 2, 40 | yes |
| §8 commands per tick | `match.maxCommandsPerTick` | 100 | yes |
| §9 max ticks | `match.maxTicks` | 2000 | yes |
| §11 think / hard / throws | `referee.thinkMs`, `hardMs`, `throwLimit` | 50, 1000, 50 | yes |

Costs are consistent with the spec's structure and unit tables. Every unit with a cost has a training row
(`trainTicks`) and every buildable structure has `buildTicks`. The Core has no cost, by design (§4).

`valueOf` checks run: Core = 0, unfinished forge site = 0, complete forge = 150. `sideValue` reads correctly.

## 2. Real names (so nobody guesses)

Several teams have asked for names in chat. The real paths are:

- `STATS.match.startShards`, `.maxTicks`, `.unitCap`, `.queueMax`, `.maxCommandsPerTick`
- `STATS.crystal.amount`, `.mineTicks`, `.carry` (not `STATS.mineTicks` or `STATS.worker.carry`)
- `STATS.map.width`, `.height`, `.rockPairs`, `.rockAttempts`, `.rockClearance`
- `STATS.referee.thinkMs`, `.hardMs`, `.throwLimit`
- `STATS.core.hp`, `STATS.core.trains`
- `STATS.units.<kind>.cost | hp | damage | range | speed | trainTicks`
- `STATS.structures.<kind>.cost | hp | buildTicks`, plus `trains` (forge) and `damage | range` (turret)
- `UNIT_KINDS`, `STRUCTURE_KINDS`, `kindStats(kind)`, `valueOf(entity)`, `sideValue(state, player)`

Known wrong guesses in chat: `STATS.maxTicks` (is `STATS.match.maxTicks`), `STATS.grunt` / `STATS.forge`
(are under `units` / `structures`), `STATS.worker.carry` and `STATS.startShards` (see above).

## 3. Proposed changes to stats.mjs (for the stats owner to decide)

Priority order. Each is a data change or a one-line move; none changes a current number.

1. **Brute structure multiplier lives in combat.mjs.** `BRUTE_STRUCTURE_MULTIPLIER = 2` is hard-coded in
   `env/combat.mjs` line 11 (sonnet's and haiku's combat-counters tests will want it from stats).
   Proposal: `units.brute.structureMult: 2`, and combat reads `statsOf(attacker).structureMult ?? 1`.
   Spec §5 and §7 say "double", so the value is a number and belongs here.

2. **Map start layout is hard-coded in map.mjs, not stats.** Core positions, Worker positions, home and
   contested crystal fields, the crystal amount and the rock constants (`SIZE`, `PAIRS`, `ATTEMPTS`,
   `AMOUNT`, `KEEP_OUT`) are all typed out again in `env/map.mjs`. `STATS.map` already has the same
   width, height, pairs, attempts and clearance, so there are two sources of truth.
   Proposal: add `STATS.start = { core: {x,y}, workers: [...], homeCrystals: [...], contestedCrystals: [...] }`,
   and map.mjs reads `STATS.map.*`, `STATS.start.*` and `STATS.crystal.amount`. Owner of map.mjs (sonnet) to
   confirm. This is also the only place v3 (48×48, see §5) would need changing.

3. **Duplicate tick limit in sim.mjs.** `DEFAULT_MAX_TICKS = 2000` in `env/sim.mjs` repeats `match.maxTicks`
   as a fallback. Proposal: delete the fallback once stats is always loaded (sim owner, fable, to agree).

4. **Spawn search distance 3 is hard-coded.** `findSpawnTile(state, bx, by, maxRange = 3)` in economy.mjs
   is spec §4's "search distance 1, then 2, then 3". Proposal: `match.spawnSearch: 3`.

5. **`hp` means two things.** In stats, `hp` is the maximum; on entities, `hp` is the current value.
   economy.mjs already reads it through `maxHpOf`, and fable's tests use `maxHp`. Proposal: rename the stats
   field to `maxHp` in every row (units, forge, turret, core). Sonnet's stats-table tests check `hp` and
   must be updated in the same change. Reviewer from a different team: fable or sonnet.

6. **Structure rows have different shapes.** Forge has `trains` and no `damage` or `range`; turret has
   `damage` and `range` and no `trains`. combat.mjs decides "can attack" by `row.damage !== undefined`.
   Proposal: give every buildable structure `trains: []` (turret) and `damage | range` only where they
   apply, and document the rule in a comment at the top of stats.mjs. Keep the rule the same as combat's.

7. **Adjacency is `1` in four places** (movement.mjs `within: 1` for gather, build and to-Core; economy.mjs
   `distance <= 1` and `> 1`). Spec §6 defines adjacency as distance 1, so this is a rule, not a balance
   number. Proposal: leave as-is, or add `match.adjacentRange: 1` if the stats owner prefers one table.
   Low priority.

8. **Auto-attacking kinds are a list in combat.mjs** (`AUTO_KINDS = ["grunt", "lancer", "brute"]`). Spec §7
   calls them "idle combat units", which is a property of the kind. Proposal: `units.<kind>.autoAttack: true`
   (false for worker). Combat then reads the flag. Reviewer from a different team: fable.

9. **movement.mjs `unitStats` tolerates other layouts** (`STATS.unit?.[kind] ?? STATS[kind]`). Once the table
   is fixed, these fallbacks hide mistakes. Proposal: read `STATS.units[kind]` directly (movement owner,
   fable, to agree).

## 4. Things checked and left alone

- Every kind has a unique key; no kind is in two lists.
- `deepFreeze` makes rows immutable, so tests cannot change balance by accident. Good.
- `UNIT_KINDS` and `STRUCTURE_KINDS` are derived from the table, so adding a kind updates the lists.
- No randomness, clocks or timers in stats.mjs.

## 5. Forward look: v3 (fable's proposal in the chat)

v3 adds about 14 units, several new buildings, a second resource (Flux), supply instead of a flat cap, sight
and fog, cooldowns, and a 48×48 map. None of it is in the spec yet, so none of it should go into stats.mjs now.
When v3 is agreed, the stats table will need:

- `weapon` fields: `targets` (ground | air | both), `cooldown` (ticks between attacks), `splash`, and
  `minRange` for artillery.
- `sight` per row, `supply` per unit (1, 2 or 3 berths), and `height` rules for buildings.
- `flux` in the cost and value rules (spec §9 value must count it, as fable's proposal says).
- `maps` sizes moved to `STATS.map.width | height` (already there), so v3's 48 is a one-line change.

Recommend the same shape rule (keyed by kind, every row the same fields, a `trains` list on buildings) so the
tests that loop over kinds keep working.

## 6. Open questions for the stats owner

1. Who is the stats owner? PLAN.json says `haiku`, which is this team; please name the agent so proposals reach
   the right inbox.
2. Do you accept changes 1 to 9? For each one, say AGREE or give a reason and an alternative.
3. Is `STATS.start` (change 2) acceptable to sonnet (map owner) and fable (sim and tests)?
