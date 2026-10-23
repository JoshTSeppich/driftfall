# Atom audit 06: Buildings

Audit of Driftfall against section 6 of `research/STARCRAFT-ATOMS.md` (Joshua, 19:33). Read by reading the code, not by
running it. Sources: `NORTHSTAR.md`, `TERRITORY.md` sections 3, 4, 5, 6, 8, 9, 14; `env/stats.mjs`, `env/commands.mjs`,
`env/economy.mjs` (placeReason), `env/combat.mjs`, `env/movement.mjs`, `env/tiers.mjs`, `env/territory.mjs`,
`env/effects.mjs`, `env/items.mjs`; `play/input.mjs`, `play/app.mjs`, `play/hud.mjs`, `play/teach.mjs`.

**What is live today:** the default game's build card offers only **Forge** and **Turret** (`env/stats.mjs` lines
137-138; `play/input.mjs` builds its card from `STATS.structures`). Drill, Siphon, Depot, Track, Press, Totem, Mound and
Trading House are specified in TERRITORY.md and have stats and placement code, but sit in the flagged tables
(`env/stats.mjs` ~lines 240-260, 302, 392-406) and are not on the page.

## Verdict table

Verdicts: **HAVE** (Driftfall has an equivalent), **PARTIAL**, **MISSING**, **NOT FOR US** (with why).

| # | Atom (section 6) | Verdict | What Driftfall has (file) | What is missing or why not |
|---|---|---|---|---|
| 1 | Buildings are placed on a grid; some races need power or creep to place | **PARTIAL** | Grid placement with a green/red footprint preview: `env/economy.mjs` `placeReason` (~line 546), `play/app.mjs` ~534. Field-gated placement: a Drill must sit on a Shard tile, a Siphon on a Vent (`placeReason`). | Field gating exists only in the module (`placeReason` returns `chain-off` unless the chain is on) and no field-gated building is on the live card. Power and creep as such: NOT FOR US as copies. Our version is "build where the land gives you something" (Shard, Vent, Reach). |
| 2 | Buildings have HP and armour; repair (Terran), shield regen (Protoss), HP regen (Zerg) | **PARTIAL** | HP on every structure: Forge 400, Turret 150, Core 1000 (`env/stats.mjs` 131-138), claims 300, Depot 300, Press 400 (lines 168-256). Attackers do a `structureMultiplier` against buildings (`env/combat.mjs` line 68). | **No structure armour.** **No repair:** nothing in `env/` or `play/` lets a Worker or any unit restore a building's HP. **No regen** for buildings. Repair is the main missing piece here. |
| 3 | Terran buildings lift off and fly to a new spot | **MISSING** | Nothing for buildings. The closest idea is in TERRITORY.md section 6: the Snakenator **Shed Skin** upgrade (a claim can be packed up and moved). It is written in the design but not built (`env/items.mjs` `shed` is for units only). | Lift-off as such: NOT FOR US as a copy. Shed Skin is the Driftfall version and is the right one to build. |
| 4 | Buildings burn down when badly damaged (Terran) | **MISSING** | None. | Low priority: feel only (smoke and fire as damage shows). Not a rule the player needs to learn. Keep for polish after the top items. |
| 5 | Buildings block movement and are used to wall off chokes | **PARTIAL** | Blocking: HAVE. Structures block the tile for units (`env/movement.mjs` line 40); a route with no way through is cleared and logged as `blocked` (movement.mjs line 15). | Walling off is MISSING for players: no wall piece exists in the live game. The Burrow's **Bank Up** dirt walls (TERRITORY.md section 6, `env/stats.mjs` line 82) are parked. |
| 6 | Static defence buildings: anti-ground, anti-air, detection | **PARTIAL** | **Turret** (`env/stats.mjs` 138: damage 12, range 5, hp 150) fires at any enemy in range (`env/combat.mjs` `chooseTarget`, lines 39-50). | **Anti-air:** no ground/air split; a Turret shoots air and ground alike, and no building is air-only. **Detection:** nothing reveals a hidden or buried unit; `env/effects.mjs` Tunnels use underground movement, but nothing finds it. The Squall (TERRITORY.md section 4) blocks air and cuts sight, yet no building answers that. |
| 7 | Losing all buildings loses the game, not units | **HAVE** | Losing the Core ends the match (`env/sim.mjs` line 79 finds the Core; Core hp 1000 in `env/stats.mjs` line 131). Units never end the game. The territory win (TERRITORY.md section 3) is the second way to win. | Driftfall ends on the Core alone, not on "all buildings". That is a deliberate simplification. Keep it. |
| 8 | Footprints define walls and paths | **MISSING** | Nothing. Every structure is one tile: `env/commands.mjs` line 85 places a site at one x, y; `play/input.mjs` ~line 114 checks "one tile". | No multi-tile footprints, so a 2×2 block cannot wall a choke or reshape a path. Reach terrain (`maps/layout-v4.mjs`) already has footprints for land, not for buildings. |

**Totals:** HAVE 2 (rows 5 blocking, 7) · PARTIAL 4 (1, 2, 5 walls, 6) · MISSING 3 (3, 4, 8) · NOT FOR US: power and creep
as copies (row 1), lift-off as a copy (row 3).

## TOP 5 changes (ranked by how much they improve play)

**1. Put the economy and claim buildings on the live build card.** Right now a first-timer can build only a Forge and a
Turret. Drill, Depot, Track, Press, Totem and Trading House are the Driftfall buildings; without them the Drift, the
claims and the flow panel have nothing to do.
- **Change:** un-flag the live kinds so they are in `STATS.structures` (or the card reads both tables), give each a
  hotkey, cost and one plain sentence, and keep the field rules from `placeReason` on the placement preview.
- **Owner:** Sonnet (builds `play/input.mjs`, `env/stats.mjs` wiring); Fable signs off the numbers; Haiku writes the test.
- **Done when:** a fresh page shows Drill, Depot and Totem buttons with hotkey and cost; a Drill places on a Shard tile
  and is refused on plain ground with the reason shown; the Totem places only in a Reach. Test: a `play` card test
  lists the new kinds with hotkeys.

**2. Lookout: a building that sees through the Squall and shoots air.** This closes the anti-air and detection gaps and
answers the Squall (TERRITORY.md section 4) with a choice the player makes, not just a wait.
- **Change:** a new static building with sight that ignores Squall cuts, reveals buried Tunnel units in range, and is
  the only static anti-air (the Turret stays ground and air, or becomes ground only; Fable decides). The air check goes
  into `env/combat.mjs` `chooseTarget`.
- **Owner:** Fable (design and numbers); Sonnet (`env/combat.mjs`, `env/vision.mjs`); Haiku (tests).
- **Done when:** an enemy air unit inside a Squall is invisible to a Turret-only base and visible to a Lookout; a
  Tunnel unit under a Lookout's range shows; test covers both.

**3. Workers repair buildings for Shards.** Gives the economy a reason to keep Workers near the line, lets a Flood or
Quake-hit Drill come back without a rebuild, and makes damage a decision.
- **Change:** a Worker order `repair` on a damaged structure: restores hp at a fixed rate and costs Shards per hp
  (drawn through the same bank as construction, so it pauses in debt, `TERRITORY.md` section 9).
- **Owner:** Sonnet (`env/movement.mjs` order, `env/combat.mjs` or a new `env/repair.mjs`); Haiku writes the test;
  Fable sets the rate.
- **Done when:** a Worker right-clicked on a damaged Forge raises its hp each second and the Shards drop; the HUD bar
  shows the change; test: hp rises to max and stops; no repair without Shards.

**4. Walls and Barricades that wall off the choke.** Gives players a real choice of defence and a use for Quakes
(a closing ramp then matters to a player).
- **Change:** a one-tile **Barricade** (cheap, low hp, blocks movement, placed on open ground) and the wall-off rule
  so an enemy with no route is held at the wall, not cleared as `blocked`. Burrow's Bank Up stays parked.
- **Owner:** Sonnet (`env/movement.mjs`, `play/input.mjs` card); Fable (cost and hp).
- **Done when:** a player can close a one-tile gap with two Barricades and the enemy path reroutes or stops at the
  wall; test covers reroute and full block.

**5. Footprints: 2×2 Depots, Presses and the Trading House.** Multi-tile buildings are what make wall-off and paths
read as a design, not a dot on the map. Last because it touches movement, placement and Track collisions.
- **Change:** each structure kind has a footprint (1×1 stays the default); `placeReason`, movement blocking and the
  preview all use the footprint; Tracks cannot run under one.
- **Owner:** Sonnet (`env/commands.mjs`, `env/movement.mjs`, `env/economy.mjs`, `play/app.mjs` preview); Haiku checks
  the tests.
- **Done when:** a 2×2 Depot blocks a 2-wide gap and the preview shows four tiles; test: a unit cannot step into any
  of the four tiles.

Not in the top 5 but in the audit: Shed Skin (moving a claim, TERRITORY.md section 6) is the Driftfall answer to row 3;
burning buildings (row 4) is polish.

## Caveats

- Read by code only; no test was run and no game was played for this audit.
- Owners are by role (Fable designs, Sonnet builds, Haiku tests), as in NORTHSTAR.md. I did not check the chat for the
  current owner map; the team lead should confirm names before work starts.
- The "live" claim depends on `env/stats.mjs` being the table the page reads; I read it that way, which matches
  `play/input.mjs` building its card from `STATS.structures`.
