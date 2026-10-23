# Audit 10: Upgrades (haiku)

Read: STARCRAFT-ATOMS.md section 10, NORTHSTAR.md, TERRITORY.md sections 6 and 14, env/stats.mjs (upgrade rows and unit rows), env/tiers.mjs (research), env/combat.mjs, env/effects.mjs, env/economy.mjs (setChainMod), env/drift.mjs, play/research-card.mjs, tests run: sim-tiers-research, stats-territory, combat-damage (50/50 pass).

**How to read the verdicts.** They judge the rules in the sim (env/). A verdict of HAVE means the rule exists and is tested. The playable page does not show any of it: `play/app.mjs` and `env/live.mjs` run the classic match, which has no research queue, and `createTerritoryMatch` is called from no page. So for Joshua on the live page, upgrades are MISSING today. That gap is top change 2.

## Verdict table

| Atom line | Verdict | Driftfall now (evidence) |
|---|---|---|
| Numeric upgrades: weapons and armour, 3 levels per class | PARTIAL | Weapons and Hide levels 1 to 3 for ground and air exist as rows (env/stats.mjs:32-51). Nothing reads them: combat.mjs:67 uses the base `damage` only. Air has no air units in the roster (stats units: worker, grunt, lancer, brute), so the air track has nothing to apply to. |
| Each level adds a fixed amount (+1 per hit, bigger for big hitters) | PARTIAL | The +1 is written (`bonus: 1`, stats.mjs:36-41) but not applied. "Bigger for big hitters": NOT FOR US. Flat +1 is already a big deal for the 2-damage Worker (+50%) and small for the 25-damage Brute (+4%), which is the balance we want. A percent bonus would make Brute levels dominate. |
| Costs rise per level; higher levels need higher tech | HAVE | Costs 100/175/250 (Weapons) and 125/220/315 (Hide), with Alloy from level 3 (stats.mjs:43). Tier gates in tiers.mjs `doResearch` (tierReason) and `requires` for the previous level. Covered by tests/sim-tiers-research.test.mjs. |
| Unit-specific upgrades: speed, range, energy, ability unlocks, extra capacity | PARTIAL | Rows exist for Sidewind (+50% speed), Long Strike (+2 range), Thick Hide (+2 armour), Rumble (stun), Venom (slow), Constrict (hold), Hold Fast (claim weapon). Only Tunnels and Swimmers have readers (effects.mjs:41, 102). Movement, combat and claims never read the rest. Extra capacity: Bigger Buffers and Cube Press are data; `setChainMod` (economy.mjs:594) has no caller. Energy: NOT FOR US, Driftfall has no energy resource; Venom and Constrict are the equivalent of an ability unlock. |
| Some upgrades define strategy timing (speed = time to move out) | PARTIAL | Timing is designed: TERRITORY section 7 targets, and `typicalSeconds` per tier (stats.mjs:197-208). But Sidewind's 55 s has no effect, so the timing decides nothing yet. |
| Upgrades are global: apply to all units of a class when done | PARTIAL | The mechanism is global per player: `state.research.done[player]` (tiers.mjs:53, 110). Only two effects check it. Combat does not, so a finished Weapons 1 changes no hit. |
| Research happens at a building and blocks its queue | HAVE | One queue per building (`structure.research`), max 3 (tiers.mjs:17), and `stepTiers` counts only the head (tiers.mjs:110-). Tested. The research card (play/research-card.mjs) has no caller on any page, so nobody can click it. |
| Upgrade timings are common knowledge; scouting the building tells you when it lands | MISSING | The queue and `ticksLeft` are in state, but observe() leaks everything and there is no fog (audit 02), so scouting cannot read it. Nothing shows the countdown on a building. Timings are not on any published balance page (Council item 9). |

Tally: 2 HAVE, 5 PARTIAL, 1 MISSING. Two sub-points inside PARTIAL rows are NOT FOR US: "bigger for big hitters" (row 2) and energy (row 4).

## Top 5 changes, ranked by how much they improve play

1. **Give Weapons and Hide a real effect in combat.** Each Weapons level adds +1 to the hit (`bonus`, stats.mjs:36), each Hide level adds +1 armour, and the hit becomes `max(1, damage + weapons - armour)`. This is the same armour floor that audit 09 asks for, so do them as one change. Ground only at first; there is no air unit to hit.
   - Owner: fable (env/combat.mjs and the armour field in env/stats.mjs). Sonnet builds the number in the HUD.
   - Done when: a test shows a Grunt with Weapons 1 hitting a Lancer for 9, and a Lancer with Hide 1 taking 1 less per hit, and a Brute with Hide 1 taking 1 less from a Grunt; and a replay where a researched Weapons 1 changes the kill tick.

2. **Put research on the live page.** The page must run a match with `state.research` on (today it runs classic, which has none), and the Forge and the other buildings must show a research button and a timer. `play/research-card.mjs` already renders the cells; nothing calls it.
   - Owner: fable decides which match the page runs (or enables `enableResearch` in the classic match with tier gates off). Sonnet wires `research-card` into play/app.mjs. Haiku does the HUD readout (seconds left on the building card, cost and state per cell).
   - Done when: Joshua can click Forge, see Weapons 1 with its cost and 60 s, watch the bar fill on the building, and see the combat change from change 1.

3. **Make the role upgrades read by the sim.** Sidewind (Fang speed +50%), Long Strike (Spitter range +2), Thick Hide (Bulldozer armour +2) and Rumble (Thumper stun 1 s) each need one reader: movement reads speed, combat reads range and armour, the splash hook stuns. Venom and Constrict follow once the sim has a slow and a hold.
   - Owner: fable (movement.mjs, combat.mjs). Sonnet adds the research button text.
   - Done when: each of the four has a test that changes the number after the upgrade is done and does not change it before.

4. **Make the mining upgrades reach the economy.** `setChainMod` exists (economy.mjs:594) and its comment lists drillSpeed, trackSpeed, buffer and pressOut, but nothing calls it. When Drill Speed 1, Track Speed, Bigger Buffers or Twin Press finish, the research owner should call it. This makes the Drill really mine 25% faster.
   - Owner: sonnet (economy.mjs and the research hook in tiers.mjs). Fable checks the numbers match TERRITORY section 6.
   - Done when: a test shows Drill output rising 25% after Drill Speed 1 finishes, and the Drill card shows the new rate.

5. **Make Drift Sense change a decision.** Drift Sense should show Drift warnings 60 s ahead, not 30. Today the 30 s lead is fixed in env/drift.mjs (line 3 comment: "the banner counts down from 30 s"), and `warnSeconds: 60` in the upgrade row is never read.
   - Owner: sonnet (env/drift.mjs reads the upgrade's `warnSeconds` once it is done; play/drift-banner.mjs counts down from the value it gets). Haiku checks the banner test.
   - Done when: after Drift Sense finishes, the next Drift banner counts down from 60, and a test pins 30 without the upgrade.

## Notes for the team
- Changes 1 and 2 must land together: an upgrade that changes combat but cannot be bought on the page is invisible, and a button that buys nothing is worse.
- Keep the default game unchanged until change 2 has a flag: the classic sim gets research only behind the match option.
- Nothing here needs a new unit, a new resource or a new map.
