# Audit 13: Terrain and maps (haiku)
Read: STARCRAFT-ATOMS.md section 13, NORTHSTAR.md, TERRITORY.md sections 2, 4, 14, and the code that implements terrain: maps/layout-v4.mjs, maps/layout-sizes.mjs, env/map.mjs, env/movement.mjs, env/path.mjs, env/reach-path.mjs, env/state.mjs, env/vision.mjs, env/effects.mjs, env/drift.mjs, env/sim-territory.mjs, env/neutrals.mjs, play/app.mjs, play/fog.mjs, play/minimap.mjs.

Checked by running, not only reading (standard map, seed 7): 5076 rock tiles, 88 Rubble tiles, 120 ramp tiles, 2016 raised tiles. **0 of 88 Rubble tiles are in the blocking set; 0 ramp tiles are blocked.** Shard tiles per Reach: Main 8, Natural 8, Mesa 4, Rich 8, Centre 16 (standard shards are 400 each, rich 800). Tests run green: tests/map-sizes.test.mjs 29/29, tests/map-generation.test.mjs 20/20, tests/vision.test.mjs 0 fail.

## What the live game does today, in one paragraph

The map is a hand-drawn, point-mirrored board of 21 Reaches (Standard), with rock walls that make the Reaches. The seed only scatters rocks and Rubble. Heights and ramps are **drawn** and used by the vision rule, but **the movement code never reads them**: ground walking is decided by walls, rocks, crystals and buildings alone. The only terrain change that really happens is **Flood** (it adds tiles to the blocking set). **Quake** and **The Fall** are announced on the banner and emitted as events, but they change no tile.

## Verdict table

Verdicts: HAVE (Driftfall has an equivalent that works in the sim), PARTIAL (some of it works, the rest is missing or not on screen), MISSING, NOT FOR US (with the reason).

| Atom line (section 13) | Verdict | Evidence / why |
|---|---|---|
| Maps are hand-made | HAVE | Hand-drawn Reach outlines, heights and gates in maps/layout-v4.mjs (Standard) and maps/layout-sizes.mjs (Large 192, Huge 256). The seed only scatters rock and Rubble blobs (layout-v4.mjs:247-325). |
| Maps are hand-made; the ladder uses a rotating map pool | PARTIAL | Hand-made: HAVE. Rotating pool: NOT FOR US for v0.1, since there is no ladder and the goal is one link against the built-in AI (NORTHSTAR goal). |
| Main base on high ground with one ramp | PARTIAL | The Main is drawn as a plateau (`h: 1`, layout-v4.mjs:23-25) with **two** ramps, so a Quake can close one (layout-v4.mjs:40-43). But no pathing reads heights or ramps (env/movement.mjs, env/path.mjs, env/reach-path.mjs, env/state.mjs: zero hits), so the plateau is only closed by walls. The ramp is not the way up; it is just an open tile. |
| Natural expansion close by, with a choke | PARTIAL | Natural is joined to the Main by a 3-tile ramp gate (layout-v4.mjs:43, gate width at layout-v4.mjs:39). The choke is geometry only: nothing gives it a rule (no ramp step, no defender bonus). |
| Third and fourth bases further out, more exposed | HAVE | Reaches step outward from Main to Flank, Pocket, Rich, then Outer A and Outer B. The Fall hits the Outer Reaches first (env/drift.mjs:61). Exposure is by graph distance only; it is never measured. |
| Ramps and chokes favour defenders | PARTIAL | Half is in: high ground hides low-ground units beyond 2 tiles (env/vision.mjs:37-46). There is no attack or defence bonus at a ramp or gate, so a defender at a choke gets nothing extra. |
| High ground gives vision advantage | PARTIAL | The rule is in env/vision.mjs (heightAt, NEAR_SIGHT 2). But play/app.mjs never calls fog (grep: 0 hits), and drawMinimap is called with no fog. **Joshua sees no high-ground advantage on the live page.** |
| Open areas favour bigger armies and surrounds | MISSING | The Centre (the Rift) is open ground with 16 Shard tiles, and the fast lanes are real. There is no surround or flank rule: env/combat.mjs sums hits per target with no facing, side or flank bonus. |
| Destructible rocks block paths until destroyed | MISSING | Rubble is parsed with 200 hp (env/map.mjs:90) but never joins the blocking set (state.rocks is built from map.rocks only) and nothing reads its hp (grep: no reader outside map.mjs and a comment). Data only. |
| Watchtowers give vision when a unit stands next to them | MISSING | Sight is per building or unit, always on (env/vision.mjs DEFAULT_SIGHT, sight fields in env/stats.mjs, e.g. turret 7). No object gives sight only when a unit stands beside it. |
| Islands reachable only by air or drop | MISSING | No island tiles on any map. Movement has no air exception that I could find: env/state.mjs isPassable checks rockSet and buildings for every unit, and env/movement.mjs has no `air` branch. Air is blocked by rock today, which contradicts the v3 terrain table (air passes rock). No drop mechanic exists. Flood blocks air as well, so it is not an air-only lake. |
| Rush distance: walking time between mains | PARTIAL | tests/map-sizes.test.mjs:143 times Main to Centre (about a minute at 3 tiles a second or less). Fair starts (line 120) check equal distances to the Reaches. Main-to-Main walk time is neither tested nor shown. |
| Spawn positions: 2- or 4-player maps | PARTIAL | 2-player: HAVE, point-mirrored Mains in opposite corners. 4-player: NOT FOR US (NORTHSTAR is 1 v 1 against the built-in AI). |
| Cross or close spawn | MISSING | Spawns are fixed at the mirror corners. There is no choice of spawn on a map. |
| Reduced mineral lines (as a map feature) | PARTIAL | Small fields exist: Mesa has 4 Shard tiles. But Main has 8 standard Shard tiles, exactly the same as Natural (probe above). The Main is not the poorer line, so there is no pull to expand. |
| Back-door entrances | PARTIAL | Outer A of side 0 meets Outer B of side 1 across the right edge, and its mirror across the left (layout-v4.mjs:52). That is a far-room link, not a way into a Main from behind. |
| Collapsible rocks (SC2) as map features | MISSING | Designed in TERRITORY.md section 4 (Quake closes a ramp and opens a cliff; The Fall turns Outer Reaches to rock). In the sim, env/effects.mjs:85-88 applies only `flood`. Quake and The Fall emit `drift-apply` (env/sim-territory.mjs:196) and change no tile. The Flood path (rockSet) is the pattern to reuse. |
| Map symmetry for fairness | HAVE | Point mirror (x, y) -> (W-1-x, H-1-y) in layout-v4.mjs:2 and env/map.mjs:11. Tests: map-sizes "fair starts", map-generation (both pass). |
| Maps tuned per meta; one change can change balance | PARTIAL | The bot runner exists (env/run-match.mjs). No test or gate asserts a per-map win rate; NORTHSTAR item 5 (mirror win rate 45-55% across seeds) is a requirement with no gate yet. |

## TOP 5 changes (ranked by how much they improve play)

**1. Put the high-ground and fog rule on the live page.** Rules are built (env/vision.mjs, play/fog.mjs); the page never calls them, so the terrain advantage and the scouting game are invisible.
- What to change: pass `createFog(state, side)` into `drawMinimap` and into the 3D fog in play/app.mjs. Enemy units out of sight are hidden. Use the existing `heightAt` rule for high ground.
- Owner: sonnet (play/app.mjs, play/minimap.mjs, play/render.mjs). fable confirms the sight numbers.
- Done when: on Joshua's screen, the map is dark outside his units' sight, and a unit on the Mesa is hidden from a low-ground unit beyond 2 tiles. A test runs the page's fog path and checks the enemy unit disappears.

**2. Make Quake and The Fall change the ground.** This is the Drift's whole identity ("the map you scouted at 3:00 isn't the map at 9:00"). Right now only the banner moves.
- What to change: in env/effects.mjs, apply `quake` (one Main ramp joins rockSet, the other side's Mesa edge opens) and `fall` (the Outer Reach's tiles join rockSet). Reuse the Flood `added`-tile memory so real rocks are never removed.
- Owner: fable (env/effects.mjs, env/drift.mjs rules). sonnet redraws the minimap on the event.
- Done when: a seeded match at 9:00 closes one ramp in the path search (a route through it fails), and at 14:00 the first Outer Reach turns to rock. A new test checks both, and the minimap shows the change.

**3. Enforce the step rule: ground units change height only on a ramp.** This turns the drawn plateaus, chokes and defender advantage into real rules (TERRAIN-V3 section 2 already states them).
- What to change: in env/movement.mjs and env/reach-path.mjs, a ground step between two tiles of different height is legal only when one end is a ramp tile on its axis. Keep the reach-router budget.
- Owner: fable (env/movement.mjs, env/reach-path.mjs). sonnet checks play/ behaviour.
- Done when: a test over the generated Standard map finds no ground path that climbs onto a plateau off a ramp; the fast-lane and fair-start tests in tests/map-sizes.test.mjs still pass; the perf budget stays inside its 2 ms per unit-step ceiling.

**4. Make Rubble real: blocking, attackable, gone when destroyed.** There are 88 Rubble tiles on the Standard seed and they do nothing. This is the cheapest way to get "destructible rocks" and it gives the Drift a non-Flood terrain change.
- What to change: add Rubble tiles to the blocking set at map load (env/map.mjs, env/state.mjs). Let a combat order target a Rubble tile, lower its hp by the attacker's damage, and clear it at 0 hp.
- Owner: fable (env/map.mjs, env/combat.mjs). sonnet shows the rubble on the minimap and in the cursor.
- Done when: a Rubble tile blocks a path; an attack on it lowers hp and removes the block at 0; a test covers both; Joshua can see the rubble and click it.

**5. Make the Main the poorer line, publish the rush walk, and gate the map on balance.** The Main and Natural both hold 8 standard Shard tiles, so there is no pull to expand; and nobody can see how long the walk between Mains takes.
- What to change: in maps/layout-v4.mjs, cut the Main's standard Shard tiles from 8 to 6 (Natural stays 8). Add a short script or test line that prints main-to-main walk seconds. Run env/run-match.mjs mirror matches (40 seeds) as the balance gate.
- Owner: fable (layout numbers). haiku runs the mirror balance check and writes the walk time into the map notes.
- Done when: a test asserts Main standard Shard tiles are fewer than Natural's; the printed Main-to-Main walk is in a stated range; 40-seed mirror matches sit at 45-55% (NORTHSTAR item 5).

## Lower priority, noted here

- **Watchtowers** (MISSING): a cheap neutral sight post would add a scouting choice. Park it until items 1-5 are on the page.
- **Air blocked by rock** (suspected bug, not yet tested): if air is meant to fly over rock (the v3 table says so), a rock-blocked air unit is a rule bug. Check with a test before building islands on it.
- **Surrounds** (MISSING): a flank bonus belongs to combat, not terrain. Owner fable, after the damage model (research/atom-audits/09-the-damage-model.md).

## What Joshua can see now

Nothing new on the page. This was an audit. I edited only this file.
