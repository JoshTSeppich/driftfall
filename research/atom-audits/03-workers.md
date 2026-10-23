# Atom audit 03: Workers

Scope: research/STARCRAFT-ATOMS.md section 3 only, checked against NORTHSTAR.md and TERRITORY.md sections 3, 8 and 9
(and section 14 for Workers' items).
Files read (by grep and targeted line ranges): env/economy.mjs (tickGather, tickConstruction, dropOff, enableChain),
env/stats.mjs (crystal, hand, worker and faction rows, Totem and Mound), env/combat.mjs (line 7: workers fight only
when ordered), env/territory.mjs (line 11: workers are nonCombat), env/budget.mjs (workers pay no upkeep, via the
exempt list in stats), env/sim.mjs (gathering step), env/map.mjs (crystal placement), play/input.mjs (worker commands
and target choice), FANATICS.md (rush counter, item 2).
No tests were run; verdicts come from reading the source.

Verdict key: HAVE = Driftfall already does an equivalent. PARTIAL = some of it exists, or it exists but is off on the
live page. MISSING = not there. NOT FOR US = deliberately not in Driftfall, with the reason.

Important context for the live page: the chain (Drills, Tracks, Depots) is OFF in a plain `createMatch`
(env/economy.mjs line 9, enabled only by env/sim-territory.mjs). So the default page runs the hand-mining rules:
load 10 (`STATS.crystal.carry`), drop-off only at the own Core, and no Depot.

## Verdict table

| # | Atom (section 3, as written) | Verdict | Evidence in Driftfall | Gap |
|---|---|---|---|---|
| 3a | Workers are the economy: each gathers and returns small loads (5 minerals, 8 gas) | PARTIAL | `env/economy.mjs` `stepGathering` / `tickGather`: Workers mine and haul. Load is `STATS.crystal.carry` = 10 on the default page; `stats.hand.carry` = 5 only when the chain is on | Default load is 10, twice the spec in TERRITORY §8 (5). Joshua's "mining too fast" playtest bug points the same way. Mine time is 8 ticks (a third of a second) per load |
| 3b | Workers walk to a patch, mine for a fixed time, carry the load back to the main building | HAVE | `tickGather` phases `toField` → `mining` (fixed `mineTicks` = 8) → `toCore`; `dropOff` returns the load to the own Core | none (the walk and timing are as described) |
| 3c | Workers also construct buildings | HAVE | `env/economy.mjs` `tickConstruction`: progress only while a Worker with a build order stands within 1 tile; it stops when the builder leaves | Only one builder counts, so there is no faster build with more Workers. The atom does not require it |
| 3d | Saturation: about 2 per mineral patch is efficient, 3 is the cap; 3 per gas | MISSING | `tickGather` has no count of Workers on a tile: any number can mine the same Shard tile (400 Shards, 800 on a rich tile). Retarget only happens when the tile is empty (`retarget`) | No saturation curve, no cap, no reason to spread Workers. The "how many per patch" decision does not exist on the page |
| 3e | Constant worker production is the first macro skill | PARTIAL | Core trains from a queue: `trainTicks` 20, cost 50 (`stats.mjs` worker row). Queueing works on the page | Workers pay no upkeep (exempt list in `env/budget.mjs` / stats), and there is no pressure to keep the Core busy, so the skill is only the 50-Shard cost. No auto-repeat or "keep training" control |
| 3f | Distance from patch to drop-off matters; base layouts are tuned for it | PARTIAL | Distance matters: `distance(unit, sink)` gates every drop. With the chain on, the nearest Core or Depot is used (`dropOff`) | On the default page the only drop-off is the Core (`dropOff` with no chain), and there is no Depot. Base layout tuning for distance was not found in `env/map.mjs` (crystals are placed by map, not per base). Not verified in the maps |
| 3g | Workers can attack weakly and are used to fight off early rushes ("pull workers") | PARTIAL | Workers have 40 hp, damage 2, range 1 (`stats.mjs` worker row). `env/combat.mjs` line 7: "Workers only fight when ordered". Attack-move works on them | No one-key pull. A player must box-select the Workers and attack-move by hand, which is slow in a rush. FANATICS #2 asks for "workers pulling" as the rush counter, and it is not a single action yet |
| 3h | Workers can be lost to harassment; killing workers is the cheapest way to hurt an economy | PARTIAL | Workers are normal units with hp, so they can be killed (`env/combat.mjs`). The Track can be cut (TERRITORY §8), which is the Driftfall version of the same idea | Workers are nonCombat for territory (`env/territory.mjs` line 11), and enemy armies do not target them first. The cheap-harassment payoff does not exist on the default page, where the only economy is Workers |
| 3i | BW worker mining bounce: workers drift between patches (an AI quirk players exploited with "mineral walking") | NOT FOR US | Driftfall's retarget is deterministic and nearest-first (`nearestCrystalWithShards`), so no drifting | Mineral walking is an AI quirk and an exploit. The useful idea (spreading Workers across patches) is covered by 3d |
| 3j | Each race builds differently: one stays to build (Terran), one summons and leaves (Protoss), one becomes the building (Zerg) | PARTIAL | Both factions use the same Worker kind and build rule. Snakenators: Siphoner (`stats.mjs` faction row, buffer 20). Burrow: Digger (buffer 30, Diggers compact ore). Both build the claim (Totem, Mound, 20 s) | The three build styles are not in the game. Both factions' Workers stay to build and then go back to work, so the factions look the same in the build step |

Counts across the 10 rows: HAVE 2 (3b, 3c), PARTIAL 6 (3a, 3e, 3f, 3g, 3h, 3j), MISSING 1 (3d), NOT FOR US 1 (3i).

## TOP 5 changes (ranked by how much they improve how Driftfall plays)

**1. Put the load back to the spec: 5 per trip on the default page.**
- What: set the default hand-mining load to 5. Either change `STATS.crystal.carry` to 5, or make the chain-off path read
  `stats.hand.carry` so the two values cannot drift apart again. Keep the mine time, or re-check it against the Shards
  per minute the numbers give.
- Why: it is the spec number (TERRITORY §8), and "mining too fast" was Joshua's own playtest bug. It is a one-number
  change with a large effect on the first 5 minutes.
- Owner: fable (`env/stats.mjs`, `env/economy.mjs`, `tests/economy-gather.test.mjs`). Sonnet checks the flow panel rate.
- Done when: a test pins the default load at 5 and the chain-on hand load at 5 from one value; a seeded default match
  shows Shards per minute in the agreed band at 3:00 (fable writes the band into the test); Joshua says the first minutes
  of mining feel right on the live page.

**2. Patch saturation: 3 Workers per Shard tile, and extra Workers move to the next patch.**
- What: a tile counts the Workers mining it. A fourth Worker sent to a full tile retargets to the nearest tile with Shards
  that has room. Show "2/3 Workers" on a selected patch. Rich tiles (800 Shards) use the same cap.
- Why: spreading Workers is the first real economy decision the player makes, and it stops the whole army from
  piling onto one tile. It also gives the ordinary Snakenator and Burrow maps a reason to care where the patches are.
- Owner: fable for the rule (`env/economy.mjs` `tickGather`, retarget path); sonnet for the patch readout in `play/hud.mjs`
  or the selection panel.
- Done when: a test orders six Workers onto one 400-Shard tile and sees three mining and three on the next nearest tile;
  the selection panel on the live page shows the count on a patch.

**3. Give the default page a drop-off near the patch.**
- What: a Depot (100 Shards, 300 hp, 20 s, already in `stats.mjs`) can be built on the default page as the second
  drop-off, and the patch tooltip shows the walk to the nearest drop-off. This needs the chain's `dropOff` rule on the
  default page, or a plain Depot-only version.
- Why: distance from patch to drop-off is the first thing a macro player looks at. On the default page the only answer
  to "where do I drop?" is the Core, so the map is flat in that respect.
- Owner: fable (`env/economy.mjs` `dropOff`, `env/stats.mjs` Depot row; decides whether the Depot is on before tier 1);
  sonnet (build button in `play/command-card.mjs`).
- Done when: a test shows a Worker walking to a Depot instead of the Core when the Depot is nearer; the Depot button
  appears on the live page with its icon, hotkey, cost and one plain sentence.

**4. One key to pull Workers.**
- What: a hotkey (sonnet picks a free key on the command card) orders every Worker within about 10 tiles of an enemy
  unit in your base to attack the nearest enemy. When the threat is gone, the Workers go back to the gather order they
  had before. Uses the existing attack order, so no new sim command is needed.
- Why: it is the rush counter FANATICS #2 asks for, and it turns a slow box-select into one press. It also makes the
  Workers feel like part of the defence, which is what the atom describes.
- Owner: sonnet (`play/input.mjs`, `play/command-card.mjs`, `play/app.mjs`). Fable confirms the attack order is enough.
- Done when: a test puts four enemy units at a Core with six Workers mining nearby; one press makes the nearby Workers
  attack; after the enemy dies they return to mining. The live page shows the key on the command card.

**5. Each faction builds its claim in its own way.**
- What: Burrow Diggers dig in: the Mound is built by a Digger, which is used up when the Mound completes (the Worker
  becomes the building). Snakenator Siphoners plant the Totem and walk back to mining the moment it is planted, so
  the Totem finishes on its own clock. Both still cost 100 Shards and 20 s, so the claim rules do not change.
- Why: it makes the two factions build differently in the one place both must do the same job. It also gives the
  Burrow a visible cost (a lost Digger) and the Snakenators a visible advantage (no walk back).
- Owner: fable (`env/territory.mjs` claim rules, `env/stats.mjs` faction rows, tests in `tests/territory-claim*`).
  Sonnet for the sprite change in `play/drawn-units.mjs` (a Digger turning into the Mound).
- Done when: a test shows a Burrow claim completing with its Digger removed; a Snakenator claim completing with its
  Siphoner back on a Shard tile; both factions still hold a Reach with a complete claim (TERRITORY §3).

## Notes for the Council

- Items 1 and 2 are the two cheapest ways to change the economy's feel on the default page. Item 1 is also the
  "mining too fast" playtest bug, so it should go before anything else in this list.
- Item 4 is the Workers' half of FANATICS #2. Item 3 is part of the wiring list (NORTHSTAR priority 2): the Depot code
  exists and only needs to be on by default.
- Nothing in section 3 says Workers should be free forever. Workers pay no upkeep today. Leave that alone until the
  upkeep numbers are settled in TERRITORY §9. Do not add a Worker upkeep without a balance test.
