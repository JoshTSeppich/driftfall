# Atom audit 07: The tech tree

Scope: research/STARCRAFT-ATOMS.md section 7 only, checked against NORTHSTAR.md and TERRITORY.md sections 5, 6, 14.
Files read: env/tiers.mjs (tier gate, research gate, pause), env/stats.mjs (tiers, upgrade rows, structures, core, forge
trains), env/sim.mjs and env/sim-territory.mjs (createMatch vs createTerritoryMatch, research and tier wiring),
env/vision.mjs (filterVisible: enemy pieces only on seen tiles), play/fog.mjs (explored memory),
play/tier-readout.mjs, play/research-card.mjs, play/territory-hud.mjs, play/app.mjs (imports, by grep),
env/effects.mjs (Tunnels, by grep), env/items.mjs (Shed Skin, by grep).

Verdict key: HAVE = Driftfall already does an equivalent. PARTIAL = some of it exists, or it exists but is off on the
live page. MISSING = not there. NOT FOR US = deliberately not in Driftfall, with the reason.

**The key fact for this section:** the live page plays `createMatch` (env/sim.mjs:34), the classic match. Tiers,
research, the tier readout and the Trading House are only in `createTerritoryMatch` (env/sim-territory.mjs), which the
page does not call (its only callers are the sim itself and play/territory-hud.test.mjs). So on Joshua's screen today
there is one tier: the Core trains Workers and the Forge trains Grunt, Lancer and Brute from minute 0. Most verdicts
below are therefore PARTIAL: the rule exists in code and tests, not on the page.

## Verdict table

| # | Atom (section 7) | Verdict | Driftfall today (evidence) |
|---|---|---|---|
| 7.1 | Buildings require other buildings: a dependency tree | PARTIAL | Tier 2 needs Foundry or Sanctum and Hold 3; Tier 3 needs Hangar and Hold 6 (env/stats.mjs:198-212, env/tiers.mjs:22-30). It is one level of building, not a tree. Foundry, Sanctum and Hangar are not in `STATS.structures` (stats.mjs:136-138 has only Forge and Turret), and tiers.mjs:26 drops any need the roster lacks, so today tier 2 is Hold-only and tier 3 is Hold-only. Territory mode only. |
| 7.2 | Three rough tiers: early, mid, late | PARTIAL | Three tiers are defined (stats.mjs:198-212) with unlock lists and Hold counts. The readout (play/tier-readout.mjs) is not on the live page (app.mjs does not import it). |
| 7.3 | Tech gates both units and upgrades | PARTIAL | Code does both: `kindTier` gates units and `doResearch` gates upgrades by tier (env/tiers.mjs:40-46, 59-75). Territory mode only. On the live page, Brute (a tier-2 unit in the table) is trainable at the Forge with no gate. |
| 7.4 | Scouting a tech building reveals the opponent's plan | PARTIAL | Fog works: enemy pieces show only on seen tiles (env/vision.mjs:71-73), and explored tiles are remembered (play/fog.mjs:7). But a building seen once and then fogged is not shown as a ghost, so the scout's information goes away, and the tech buildings themselves are not in the live roster yet. |
| 7.5 | Teching is a gamble: tech time and money mean fewer units now | PARTIAL | Upgrade costs and times are in STATS.upgrades (stats.mjs:28-29, TERRITORY.md section 6). The Hold pause stops research (tiers.mjs:93-98). The budget mode draws the cost gradually (env/budget.mjs). No tech card on the live page tells the player what the tech costs in units (research-card.mjs shows Shards and seconds only, and is not wired). |
| 7.6 | Some tech is a "switch": a sudden change of unit mix | PARTIAL | The design is a switch: tier 2 unlocks Brute, Spiker, Howler, Dart, Mender, Shade, Mast, Press (stats.mjs:205-206), and tier 3 unlocks Skiff, Barge, Seer, Conduit (stats.mjs:209-210). Live, the switch is already spent at minute 0 because the Forge trains Brute (stats.mjs:137). |
| 7.7 | Hidden tech (cloaked units) punishes opponents without detection | MISSING | No cloak, submerge or hidden unit kind exists. `grep cloak\|detect\|stealth` in env/ and play/ finds nothing. The nearest thing is Tunnels (env/effects.mjs:91-101), which is movement under ground, not hiding, and the Burrow is parked (stats.mjs:231). |
| 7.8 | The main building upgrades for tech (Hatchery to Lair to Hive; CC add-ons) | NOT FOR US | The Core cannot be built and has no upgrade (stats.mjs:129-132). Joshua's tech is bought with Hold: tier 2 and 3 are opened by territory plus a tech building, and the Core stays the same. A Core morph would give the same gate twice. A later option is an upgrade on the Nest, but it does not fit v0.1. |

Summary: 0 HAVE, 6 PARTIAL, 1 MISSING, 1 NOT FOR US (of 8 lines). Every PARTIAL is a rule that is built and tested
but not on the live page, except 7.4, which is also missing its ghosts.

## TOP 5 changes (ranked by how much they improve play)

**1. Put the tech on the live page (7.2, 7.3, 7.6).** Joshua sees one tier today, and Brute at the Forge at minute 0
removes the switch. Wire the tier readout and the research/tier gates into the page, so a fresh match shows "Tier 1
Hold 0 / 3 for Tier 2" and the Brute button is locked until tier 2 opens.
- Owner: sonnet (play/app.mjs, the match factory; it owns the live match path), haiku (play/tier-readout.mjs HUD line).
- Done when: on the live page, the Brute button is greyed and says "Tier 2: needs a Foundry and Hold 3", the tier line
  shows on screen, and a test in play/ fails if Brute can be trained before tier 2 opens. Fable decides whether the
  live match switches to `createTerritoryMatch` or only the gates are copied in; this is a design call for fable.

**2. Build the tech buildings and make the gates bite (7.1).** Add Foundry, Sanctum and Hangar to `STATS.structures`
with cost, hp and build time (Driftfall's own numbers, from fable's proposal), so the "roster lacks it, so do not block"
rule in env/tiers.mjs:5 and tiers.mjs:26 stops swallowing the gate. Foundry and Sanctum both open tier 2, Hangar opens
tier 3.
- Owner: fable (numbers and which building opens what), sonnet (env/stats.mjs rows, env/tiers.mjs).
- Done when: a test shows Hold 3 with no Foundry or Sanctum leaves tier 2 closed; building a Foundry opens it; a
  Hold drop to 2 pauses it; `tests/stats-territory.test.mjs` still passes.

**3. Ghost the scouted tech (7.4).** When a scout sees an enemy Foundry, Sanctum or Hangar, keep it on the minimap and
the fog as "last seen" (a faded icon with the building name) until it is seen again or destroyed. This is what makes
scouting worth it and tells the player the enemy's plan, which is NORTHSTAR's "scouting/fog that hides and ghosts"
(FANATICS.md item 4).
- Owner: haiku (play/fog.mjs and play/minimap.mjs ghost layer), with a read-only rule from env/vision.mjs (sonnet owns it).
- Done when: Joshua scouts an enemy tech building, scouts away, and still sees it faded on the minimap with its name;
  the ghost clears when the building dies or is re-seen (a test in play/fog.test.mjs or play/minimap test).

**4. Show what the tech costs in units (7.5).** The research card reads "Tier 2 · 150/100 · 60 s". Add one line that
turns the cost into the thing you give up: "= 2 Grunts of Shards, 60 s of Forge time". This is the gamble the classic
rewards, and it is the first thing a stranger needs to understand the tech.
- Owner: haiku (play/research-card.mjs; the function already takes the cost), with the unit price from env/stats.mjs.
- Done when: the research card on the live page (once #1 wires it) shows the trade in units, and a test pins the text
  for one upgrade.

**5. A hidden unit and the counter to it (7.7).** Right now no unit can hide, so there is nothing to detect. Give the
Snakenators one hidden ability in their own terms: a Shade-role "Adder" that submerges in Flood water (Swimmers already
puts Snakenators in water, TERRITORY.md section 6) and is invisible to enemies beyond 2 tiles. The counter is an item,
"Scent Glands" (a Glowmoss pouch variant, TERRITORY.md section 14), that reveals submerged units within 6 tiles.
- Owner: fable (the design and the numbers), sonnet (env/combat.mjs and env/vision.mjs visibility rule).
- Done when: a test shows an enemy at 3 tiles cannot see a submerged Adder, a unit carrying Scent Glands reveals it, and
  Joshua can see the submerged shape on his own side and a shimmer on the enemy's.

## Notes for the owners
- Nothing here changes the 128 × 128 classic match until #1 is accepted by fable; the live page should keep working
  while these are built, behind the existing defaults.
- The scouting and gamble items (#3, #4) only pay off once #1 and #2 make the tiers real on the page.
