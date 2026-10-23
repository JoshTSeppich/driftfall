# Audit 17: Strategies and concepts (haiku)

Read: STARCRAFT-ATOMS.md section 17, NORTHSTAR.md, TERRITORY.md sections 1 to 7, 14 and the Snakenators and Burrow upgrade tables. Code grepped (not read in full): env/sim-territory.mjs, env/live.mjs, env/vision.mjs, env/drift.mjs, env/territory.mjs, env/effects.mjs, env/tiers.mjs, env/budget.mjs, env/neutrals.mjs, env/combat.mjs, env/stats.mjs, players/builtin/ai.mjs, play/app.mjs, play/input.mjs, play/render.mjs. No code or other files were edited.

**How to read the verdicts.** They judge the rules Driftfall has, and whether Joshua can see and use them on the live page. HAVE means the rule works on the live page and has a test. PARTIAL means the rule exists in part, or only in the sim (env/), or only as data with no reader. MISSING means no rule and no page support. NOT FOR US means we chose against it, with the reason.

**The big finding.** The live page runs the classic match (`env/live.mjs` imports `createMatch` from `env/sim.mjs`). The territory rules, the Drift, claims, camps, research, the budget and the mining chain are switched on only by `createTerritoryMatch` in `env/sim-territory.mjs`, and only tests call it. So most Driftfall-specific strategy (timing windows, Floods, Hold, claims, walls, upgrades) is real in the sim and invisible to Joshua. Several top changes below come from that one gap. Owner note: the rules themselves are not in doubt; the wiring is.

## Verdict table

| Atom line | Verdict | Driftfall now (evidence) |
|---|---|---|
| Build order: the scripted opening | PARTIAL | The built-in AI has a scripted opening: 12 Workers, a Forge at 4 Workers, a second Forge, an expansion Turret (players/builtin/ai.mjs:18, 238-256). The player has no opening on screen. play/teach.mjs has a first-3-minutes coach, but the target timings in TERRITORY.md section 7 are not shown in the game. |
| Rush: very early attack | PARTIAL | The AI is not asked to act before 3:00 (`aiStartTick: 24 * 180`, env/live.mjs:49-51, 315). That protects a new player (Council item 1), but it also means an early rush by the player meets an AI that issues no orders. The code reads that way; whether its Workers sit idle was not run. Nothing else is rush-specific. |
| Cheese: risky all-in surprise strategies | PARTIAL | The cheese options are sim-only: Tunnels (env/effects.mjs:91-134), a claim in a Reach the enemy holds (Undermine, stats.mjs:83, no reader). The live page has no claim button, so nobody can try them. |
| All-in: commit everything; win or lose | HAVE | Attack-move, Stop and Hold are on the command card (play/input.mjs:313-338). The AI commits waves when it is big enough or the clock says so, and calls off a wave that is losing (ai.mjs:303-308). Win or lose is real on the live page. |
| Timing attack: attack when upgrades or units peak | PARTIAL | The AI times waves by clock and size (ai.mjs:303-304), not by upgrades. Only Tunnels and Swimmers read research (env/effects.mjs:41, 102). Sidewind, Long Strike, Thick Hide, Weapons and Hide change no number in combat, so an upgrade peak changes nothing. (Audit 10 has the detail.) |
| Timing window: the opponent cannot yet defend something | PARTIAL | The Drift does this well in the sim: Floods at 7:00 and 8:00 are announced 30 s ahead (env/drift.mjs:52-53, TERRITORY.md section 4), and play/drift-banner.mjs counts them down. None of it runs on the live page. Drift Sense (`warnSeconds: 60`) has no reader. |
| Fast expand: take the natural early | PARTIAL | The live classic has a contested field the AI expands to (env/map.mjs:19; ai.mjs:7). Claims for Reaches (100 Shards, Totem or Mound, env/territory.mjs:9) exist only in the sim. |
| Turtle: heavy defence, late-game army | PARTIAL | Turrets are real: the AI builds them at home and at the expansion (ai.mjs:246-252). Hold-gated tier 3 (env/tiers.mjs) is the late-game payoff, but only in the sim. Bank Up walls are not wired. |
| Contain: block the opponent in their base | PARTIAL | Holding Reaches freezes an enemy's tiers and production (TERRITORY.md section 5; env/tiers.mjs:92-98). That is our containment, and it is sim-only. Quake closes ramps (env/drift.mjs:55), also sim-only. |
| Harass: small raids on workers | PARTIAL | Workers never fight unless ordered (env/combat.mjs:8, 30), so a raid needs a manual attack-move onto a mining field. The fast raider upgrade (Sidewind) is not read. The raidable economy (Drill, Track, Depot in TERRITORY section 8) is sim-only. |
| Drop play: transports dropping units in bases | PARTIAL | The Barge transport (8 berths) is in ENV-SPEC-v3-draft.md:112 and :140-143. env/territory.mjs:103 skips units inside a Barge, but there is no `board` command in env/. The Barge is tier 3 only. |
| Counter attack / base trade | PARTIAL | The AI falls back to defend when the enemy walks in (ai.mjs:135, 306). Nothing tells a human that their base is under attack on the live page, and no base-trade rule is designed. |
| Tech switch | NOT FOR US | Each side plays one fixed faction (Snakenators or Burrow, TERRITORY.md section 1). Switching would mean a second roster. Hold-gated tiers already force a change of plan when Reaches are lost, which is the part of the idea we want. |
| Map control: holding the middle and the watchtowers | PARTIAL | Hold counts, Reach sight and the contested minimap flash (TERRITORY.md section 3) are sim-only. Towers exist as Turret, Mast (sight 10) and Conduit. The live page does not show Hold. |
| Proxy buildings: hidden forward production | MISSING | No building produces units far from the Core on the live page. Claims produce nothing, and fog that would hide a forward build is not on the page (see the Fog row in change 3). |
| Wall-off: buildings blocking the choke | MISSING | `wallHp: 150` on Bank Up (stats.mjs:82) has no reader. No wall exists in env/ or play/. |
| Expansion race and denial | PARTIAL | The Bloom race is designed (TERRITORY.md section 4; env/drift.mjs:35). Camps stop a claim while they stand (env/neutrals.mjs header). The AI avoids Reaches that are about to flood (ai.mjs:190). All sim-only. The live page has a contested field race only. |
| Economy vs army trade-off | PARTIAL | Upkeep and debt (env/budget.mjs) are real and tested, but `enableBudget` is called only from `createTerritoryMatch` (env/sim-territory.mjs:54). The live page has pay-up-front training, so the trade-off is only "Workers or units now". |
| Reactive play: scout, then counter | PARTIAL | The AI counters your army by a weight table (ai.mjs:22-28). The player has no counter hint on the live page. Scouting means moving a unit: `filterVisible` (env/vision.mjs:72) is called by no page, so there is no fog to scout through. |
| Mind games: fake builds, hiding units | MISSING | Hiding needs fog, and fog is not on the live page. Fake builds clash with the public clock and visible Hold (TERRITORY.md sections 3 and 4), so that half is NOT FOR US; the other half is a fog question. |

Tally: 1 HAVE, 14 PARTIAL, 3 MISSING, 2 NOT FOR US (tech switch, and fake builds inside the mind-games line). 20 lines.

## Top 5 changes, ranked by how much they improve play

1. **Put the territory match on the live page.** Hold, claims, the Drift, Floods, Quakes, the timing windows and the Hold-gated tiers all run only in `createTerritoryMatch`. Most of section 17 depends on them. Make the live page start that match (with the budget and Drift on) and show Hold and the Drift banner.
   - Owner: fable decides which match the page runs (`env/live.mjs` is fable's). Sonnet wires `play/app.mjs` and the claim button. Haiku does the Hold readout in `play/territory-hud.mjs` text, if asked.
   - Done when: Joshua opens the page, sees "Drift in 30 s: Flood" at 6:30, can click a Worker and claim a Reach, and sees the Hold count move. A test runs a live match with rules on and checks a Drift banner and a claim.

2. **Stop the free early win.** The AI does nothing before 3:00 (env/live.mjs:315). A player who rushes at 1:00 meets an AI that does not answer, which is the opposite of what Council item 1 wants (a rush has a counter). Keep the peace only against attacks: let the AI mine, build the Forge and make Grunts from 0:00, and let it answer a Reach-close or base-close attack by walking home.
   - Owner: fable (env/live.mjs peace rule); the AI logic is in players/builtin/ai.mjs.
   - Done when: a test runs the AI with the peace on and sees Workers mining and a Forge by 1:30, and a 4-Grunt rush at 1:00 is not a win by 2:00 on the seeds in tests/builtin-ai.test.mjs.

3. **Put fog and ghosts on the live page.** `filterVisible` exists but nothing calls it. Without fog there is no scouting, no hiding units, no proxy, and no reactive play. Council item 4 asks for fog that hides and ghosts (a building seen once stays drawn, marked as last seen).
   - Owner: fable (env/vision.mjs ghost data in the snapshot); sonnet (play/app.mjs filters the snapshot with the player's vision).
   - Done when: an enemy unit outside Joshua's sight is not drawn on the live page, a building seen once stays as a ghost after it leaves sight, and the test covers both.

4. **Make upgrades change fights.** Weapons and Hide, Sidewind (Fang speed), Long Strike (Spitter range), Thick Hide (Bulldozer armour) and Rumble need a reader each. That gives timing attacks their point: the upgrade peak is the reason to attack now. This is audit 10's changes 1 and 3, listed here because it is line 5.
   - Owner: fable (env/combat.mjs, env/movement.mjs); sonnet adds the research button text.
   - Done when: each upgrade has a test that changes its number after research and not before, and a replay where Weapons 1 changes the kill tick.

5. **Wire walls and the Quake ramp on the live map.** Bank Up walls (1 tile, 150 hp, Burrow tier 2) and the Quake ramp close give the Wall-off, Contain and Turtle lines their body. Without them, the Burrow has no way to hold a choke except units.
   - Owner: fable (env/map.mjs and the path rule for wall tiles); sonnet builds the wall command and placement preview.
   - Done when: a Burrow player places a wall on a ramp, a Grunt's path reroutes or stops, and a test checks both. A Quake closes a ramp on the live page at 9:00.

## Notes for the team

- The first thing to check before change 2 is what the AI does before 3:00. This audit read it from the code and did not run it.
- Changes 1 and 3 depend on each other: the territory match should also carry fog.
- Haiku's rows here do not change a shared contract. No REVIEW request is needed for this file.
