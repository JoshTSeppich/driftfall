# Atom audit 02: Resources

Scope: research/STARCRAFT-ATOMS.md section 2 only, against NORTHSTAR.md and TERRITORY.md sections 8, 9, 12.
Files read (by grep and short excerpts): env/stats.mjs (crystal, economy, resources), env/map.mjs (generateMapV4),
maps/driftfall-v4.txt (tile counts), env/economy.mjs (gathering, chain, flow), env/state.mjs (observe), env/market.mjs
(header), env/sim-territory.mjs and env/sim.mjs (imports only), env/drift.mjs, play/flow-panel.mjs, play/app.mjs (grep).

Verdict key: HAVE / PARTIAL / MISSING / NOT FOR US, as in audit 01.

## Verdict table

| # | Atom (section 2, as written) | Verdict | Evidence in Driftfall | Gap |
|---|---|---|---|---|
| 2a | Two resources: a common one and a rarer one | HAVE (and more) | Shards and Flux (`env/stats.mjs` `STATS.resources`), plus Alloy and five rare resources (TERRITORY §12) | The rare five and the Trading House are specified; only Shards/Flux/Alloy run in the sim today |
| 2b | Common resource from many small patches clustered at a base (about 8) | PARTIAL | `crystals` are single tiles with 400 each (`STATS.crystal`); the v4 map has 96 `S` and 40 `R` tiles in total, about 6 to 8 per base cluster | Nothing in the HUD or the base layout tells a new player "this cluster is your base's income"; no saturation rule (see 2k) |
| 2c | Rare resource from a geyser that needs a building on it | HAVE | Vents (600 Flux, `L` tiles, 20 on v4) need a Siphon; Siphon mines 2/s like a Drill (`STATS.economy.siphon`) | Siphon is territory-only; the default page has no Flux at all |
| 2d | Gas gates tech and strong units; minerals gate volume | PARTIAL | Tiers 2 and 3 are gated by Reach holds, with Flux/Alloy costs on upgrades and tier-3 units (TERRITORY §5, §6) | Tier gate is land, not Flux alone: good, but the live default (no territory) has no tech gate, so Flux does little |
| 2e | Each patch holds a finite amount; bases run dry | HAVE | `tile.amount -= take` in `env/economy.mjs`; workers retarget when empty; Dry-out Drift event starves a field | No warning that a patch is nearly empty; no "base is mined out" cue on the minimap or in the flow panel |
| 2f | Gold: richer, faster patches at exposed bases | PARTIAL | `R` tiles are `rich` and hold 2x (`env/map.mjs`); Bloom surfaces a rich field in a named Reach (TERRITORY §4) | Rich tiles hold more but do not mine faster; and no one sees a "rich" look on the ground to chase |
| 2g | Reduced or blocking patches (mineral walls in paths) | PARTIAL | Rubble (`o`, 200 hp) exists in the map format and the map reader; Quake changes tiles | The v4 map has 0 rubble tiles; no ore wall that you mine through to open a path |
| 2h | Resources banked per player, visible to that player only | **MISSING** | `observe()` in `env/state.mjs:155` returns `shards: [both banks]`, all crystals with amounts, and every unit and structure | Bots and any future fog logic see the enemy bank and the whole map. A scout can never learn anything (FANATICS #4 fog) |
| 2i | Floating money is a sign of bad play | PARTIAL | Flow panel shows bank, income, upkeep, net, debt (`play/flow-panel.mjs`); training never stalls (§9) | The bank is shown but not judged: no "you're floating 600" nudge, no idle-Worker or idle-production cue, no rally-to-mining default |
| 2j | Income rate, not bank, is what matters | HAVE | Flow panel is built on per-minute rates; budget = income − upkeep (§9); `flowSummary` in `env/economy.mjs` | Flow panel is hidden unless territory rules are on |
| 2k | (implied by 2b) Worker saturation: more workers per patch than it can feed stop paying | MISSING | Not in the section text but it is the rule that makes "about 8 patches" matter. `stepGathering` lets any number of Workers mine one tile | With no cap, one patch plus 12 Workers pays like 12 patches; the expansion pressure of the loop disappears |

Counts across the 11 rows: HAVE 4 (2a, 2c, 2e, 2j), PARTIAL 5 (2b, 2d, 2f, 2g, 2i), MISSING 2 (2h, 2k),
NOT FOR US 0. Row 2k is not a line in the section; I added it because it is what makes "about 8 patches" matter.

## Top 5 changes, ranked by how much they improve play

1. **Hide the enemy bank and the map from `observe()` (resources are private).**
   - Change: `observe(state, player)` returns only your own Shards/Flux/Alloy, only crystals and units in your sight
     (use `env/vision.mjs`), and for the enemy only what is seen now or remembered as a ghost.
   - Owner: fable (`env/state.mjs`, `env/vision.mjs`); sonnet adjusts `play/` readers if they used the enemy bank.
   - Done when: a test shows `observe(state, 0).shards` has no enemy entry and enemy units outside sight are
     absent; a scouting Worker that sees the enemy Core makes it appear; the 8-seed bot run still completes.
     Without this the whole "scout, harass, raid the economy" game (FANATICS #4, #5) cannot exist.

2. **Worker saturation: a patch pays fully for 2 Workers and little for the 3rd.**
   - Change: in `stepGathering`, count Workers assigned to a tile; the 3rd Worker mines at 40%, the 4th gets
     nothing. Numbers in `STATS.crystal` (`fullWorkers: 2`, `extraRate: 0.4`). Surplus Workers retarget to a free
     patch. A Drill counts as a patch.
   - Owner: fable (`env/economy.mjs`, `env/stats.mjs`); sonnet shows "2/2" over a cluster in `play/`.
   - Done when: a test puts 12 Workers on 1 patch and shows income well below 12 Workers on 6 patches; the AI
     takes a second base by 3:00 in the 8-seed run; income at the 6-patch main peaks at about 12 Workers.

3. **Make rich patches mine faster, and make them visible.**
   - Change: `rich` tiles load 1.5x per trip (carry 15) in `STATS.crystal.richCarry`, so a Bloom or a rich Reach
     is worth a race; draw rich tiles with a distinct gold-ink look and add them to the minimap as a dot.
   - Owner: fable (`env/economy.mjs` carry rule, `env/stats.mjs`); fable's art (`viewer/art.mjs`) for the look;
     sonnet for the minimap dot.
   - Done when: a test shows a Worker on a rich tile delivers 15 per trip against 10; a Bloom announcement shows
     the target Reach on the minimap; the built-in AI sends Workers to the Bloom within 60 s.

4. **Turn the flow panel into a floating cue, and show it on every page.**
   - Change: show Shards/Flux income per minute always (not only with territory). When the bank is above 400 Shards
     for 20 s while a production building is idle, pulse the bank and say in one sentence what to build or train.
     Also flag idle Workers (a small badge with a hotkey to select them).
   - Owner: sonnet (`play/flow-panel.mjs`, `play/hud.mjs`, `play/teach.mjs`).
   - Done when: a play test with no spending shows the cue within 25 s; panel tests cover "floating" and "idle
     Workers"; the page shows income on the default link.

5. **Warn before a patch runs dry; give bases a "mined out" end.**
   - Change: when a cluster is below 20% of its start amount, mark it on the minimap and in the flow panel
     ("Main: 18% left, about 90 s"). Add rubble ore walls (`o`, mineable for a Shard bounty) to v4 so two Reaches
     link by digging, which is what makes finite patches a reason to move out.
   - Owner: sonnet (`play/flow-panel.mjs`, `play/minimap.mjs`); fable for the map layout and the bounty
     (`maps/layout-v4.mjs`, `env/map.mjs`).
   - Done when: a test drains a cluster and the panel reports the low-ore warning; v4 has at least 2 ore walls;
     a map test shows that Reach routing still connects with the walls dug or not.

Not ranked (watch list): the Trading House and rare resources (TERRITORY §12) are the biggest unbuilt part of the
economy. `env/market.mjs` exists but is not imported by the sim or the page. After Top 5 items 1 and 2 land, wiring
the market strip is the next economy step.
