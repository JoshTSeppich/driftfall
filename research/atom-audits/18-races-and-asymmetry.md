# Atom audit 18: Races and asymmetry (haiku)

Scope: research/STARCRAFT-ATOMS.md section 18 only, checked against NORTHSTAR.md, TERRITORY.md sections 1-6, 13 and 14.
Code read: env/stats.mjs (factions block, upgrades, items), env/sim.mjs and env/sim-territory.mjs (match factories,
`opts.factions`), env/economy.mjs (Track water speed, buffers), env/budget.mjs (upkeep discounts), env/effects.mjs
(Tunnels, `wrong-faction` gate), env/tiers.mjs (faction check on research), play/app.mjs (which match the page starts),
play/research-card.mjs, players/*/sim.mjs (balance tester sweeps). Grep only, nothing else.

Verdict key: HAVE = Driftfall already does an equivalent. PARTIAL = some of it exists, or it exists but is off on the
live page or as data only. MISSING = not there. NOT FOR US = deliberately not in Driftfall, with the reason.

**The key fact for this section:** the live page starts the classic match (`createMatch`, env/sim.mjs) through
play/app.mjs. It never calls `createTerritoryMatch`, so the faction plumbing (`state.factions`, claims, tiers, the
budget) is not read on Joshua's screen. Both sides get the same roster and the same rules. Most asymmetry verdicts are
therefore PARTIAL: the data and tests exist, the page does not show them. (Same finding as audit 07.)

## Verdict table

| # | Atom (section 18) | Verdict | Driftfall today (evidence) |
|---|---|---|---|
| 18.1 | Three races with entirely different mechanics, units and buildings | PARTIAL | Two factions are designed and tabled: the Snakenators (`coil`) and the Burrow (`burrow`), each with its own claim structure (Totem / Mound), worker (Siphoner / Digger), Drill buffer (20 / 30), track type, upgrade list and unit role names (env/stats.mjs:220-234; TERRITORY.md sections 3, 6). Only the Snakenator mirror is playable (`sides: ["coil", "coil"]`), and the Burrow is `parked: true`. A third race is NOT FOR US for v0.1: Joshua said "start with only one race" (TERRITORY.md section 13). |
| 18.2 | First race: flexible, defensive, mobile buildings, repair, siege | PARTIAL | This identity is the Burrow, and it is parked. Its pieces exist: Mounds hold ground, Thick Hide, Rumble (siege splash that stuns), Undermine, and Tunnels (env/effects.mjs:95-120, gated on `factions[player] === 'burrow'`). Repair is the Mender (3 hp a tick, UNITS.md). Mobile buildings: Shed Skin (a Snakenator claim moves) is a row in env/stats.mjs only; grep finds no code that reads its effect. |
| 18.3 | Second race: psionic, expensive strong units, shields, warp-in, power fields | NOT FOR US | Driftfall has no shields, no warp-in and no power fields, and it should not get them in v0.1. Its closest caster is the Hexer (Snare, Surge) in the classic roster, which is not tied to a faction. Its identity is cheap and fast, so the expensive-elite lane is a different race, and the one-race-first scope rules it out. |
| 18.4a | Third race (swarm): cheap units | PARTIAL | Grunt-role Fang is cheap and the classic roster is cheap (UNITS.md), but "cheap" is not tied to a faction. |
| 18.4b | Swarm: larvae | NOT FOR US | Units come from buildings (Forge, Foundry, Sanctum) and cost army upkeep (TERRITORY.md section 9). A larva economy would fight the upkeep model. |
| 18.4c | Swarm: creep | PARTIAL | Claim and Hold do the job: a Totem built in a Reach spreads your ground, and a Hold needs a complete claim (territory.mjs, TERRITORY.md section 3). Off the live page. |
| 18.4d | Swarm: fast expansion | PARTIAL | Totem costs 100 Shards and takes 20 s (env/stats.mjs:168); the Snakenators are "best at taking new ground fast" (TERRITORY.md section 1). Claims run only in the territory match. |
| 18.4e | Swarm: regeneration | MISSING | No unit regenerates HP out of combat. grep finds no regen. The "Molting Charm" item is a free Recall, not regen, so the name is taken. |
| 18.5 | Each race: own economy rhythm, supply method, production model | PARTIAL | The economy differs in data: Coil Tracks cross Flood water at half speed (`trackWaterSpeed: 0.5`), Burrow Runs are underground, Drill buffers are 20 vs 30 (env/economy.mjs:474-478). Upkeep discounts differ per faction (env/budget.mjs:80, Coil held discount and Mound discount). Production is the same for both (Forge, Foundry, Sanctum). None of it runs on the live page. |
| 18.6 | Matchups (TvZ, PvT, ZvP, mirrors) each play like different games | PARTIAL | Plumbing: the sim takes a mixed pair (`opts.factions` in env/sim-territory.mjs:60). Experience: no cross-faction match is playable, and no cross-faction balance has been run. Burrow is parked. |
| 18.7 | Balance across the asymmetric races is the defining achievement | PARTIAL | The goal is written: mirror win rate 45-55% across seeds (NORTHSTAR "Done means" 5; TERRITORY.md section 13). The tester exists: players/sonnet/sim.mjs sweeps report win rate with a 95% CI, and players/haiku/sim.mjs does the same. Nothing runs the Snakenator mirror as a fairness gate, and the three-race version is NOT FOR US. |
| 18.8 | Mirror matchups are the "pure" skill tests | HAVE | The default is a Snakenator mirror (`sides: ["coil", "coil"]`, env/stats.mjs:222). The map is point-mirrored (TERRITORY.md section 2; tests/map-sizes.test.mjs checks the mirror). Both sides start with the same roster on the live page. |

## TOP 5 changes (ranked by how much they improve how Driftfall plays)

1. **Put the faction on the live page, so both sides are not identical.**
   - What: the start screen and HUD show "The Snakenators" (name, cyan, one line: "fast claims, Coils cross Flood water
     at half speed"). Decide with fable whether the live match switches to the territory factory. That is the same
     wiring as audit 07's #1, so do them together.
   - Owner: sonnet (play/app.mjs, play/hud.mjs; the match factory choice is fable's).
   - Done when: a first-time player sees their faction name and identity line before the first click, and a test
     reads the live driver's state and asserts `factions` is `['coil', 'coil']` with the territory rules on.

2. **Give the Snakenator identity real rules: its upgrades do something.**
   - What: Sidewind (Fang +50% speed) and Swimmers (ground units cross Flood at half speed, no Flood damage) are rows in
     env/stats.mjs with no code reading them (grep finds the names only there). Implement those two first, in
     movement.mjs and effects.mjs, then the other four. Keep the Molting Charm as it is (a free Recall) and do not reuse "molting" for regen.
   - Owner: fable (effect spec and numbers), sonnet (movement.mjs, effects.mjs).
   - Done when: a test shows a Fang with Sidewind crosses a fixed path in fewer ticks than without, and a unit in
     Flood water with Swimmers takes no Flood damage. The research card lists the effect in one sentence.

3. **Unpark the Burrow as a playable second faction, behind a start-page picker.**
   - What: `?faction=burrow` (or a picker) sets `state.factions` for the human side. The Burrow is the only real
     asymmetry in the game (Mounds, Tunnels, Thick Hide, Rumble), so it is the biggest gain for matchups (18.2, 18.6).
     Joshua set the order (mirror first), so this waits for his OK.
   - Owner: Joshua decides the unpark; fable (numbers); sonnet (picker, faction wiring in app.mjs).
   - Done when: a human can pick the Burrow, a Snakenator-vs-Burrow match runs on the page, and the balance sweep
     prints its win rate with the 95% CI.

4. **A fairness readout for the mirror: one command prints win rate per seed.**
   - What: a sweep over seeds that prints the Snakenator mirror win rate with the 45-55% band and a flag when it
     drifts outside. The sweeps in players/sonnet/sim.mjs already print win rate and CI, so this is a thin wrapper and
     a table, not new sim code.
   - Owner: haiku (the tester script in players/haiku/sim.mjs, plus a line in the balance table); fable reviews.
   - Done when: `node players/haiku/sim.mjs --mirror` (or similar) prints one line per seed set with win rate, CI and
     "in band" or "out of band", and the test for it passes.

5. **A Snakenator out-of-combat recovery trait (an original take on the swarm's regeneration).**
   - What: units that are out of combat for 10 s regain 1 hp every 2 ticks up to 50% (not full), so raiders survive
     one skirmish and retreat. Mender still matters because it heals in combat. This is the one swarm-style identity
     mark that is missing (18.4e).
   - Owner: fable (the rule and numbers, and whether it's a Snakenator trait or a shared one); sonnet (combat.mjs).
   - Done when: a test shows a damaged Fang out of combat for 10 s regains the set hp on schedule and not during
     combat, and the Mender test still passes.

## Notes

- The NOT FOR US lines are deliberate: a third race, larvae, and shields/warp-in/power fields all conflict with the
  one-race-first scope and the upkeep model. Revisit only if Joshua opens a third faction.
- Items 1-3 depend on the territory wiring decision in audit 07 (fable). Until that is made, the faction rows are
  data and tests only, and Joshua sees no asymmetry.
- Atom audit 07 found the same thing: the live page runs the classic match. Reading this audit alone is not enough
  to change the page; the match-factory decision is the blocker for most of the list.
- No code was edited. This audit file is the only change.
