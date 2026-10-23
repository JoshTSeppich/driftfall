# Atom audit 21: Pacing and phases

Scope: research/STARCRAFT-ATOMS.md section 21 only, checked against NORTHSTAR.md and TERRITORY.md (sections 3, 4, 5, 9, 14).
Files read (by grep and short excerpts): env/drift.mjs (the fixed clock), env/tiers.mjs, env/budget.mjs, env/sim.mjs
(checkEnd, maxTicks), players/builtin/ai.mjs (holdPlan, wave timings, claim logic), play/drift-banner.mjs, FANATICS.md (items 7, 1).
Nothing was run; verdicts come from reading. Verdict key: HAVE / PARTIAL / MISSING / NOT FOR US.

## Verdict table

| # | Atom (section 21, as written) | Verdict | Evidence in Driftfall | Gap |
|---|---|---|---|---|
| 21a | Opening (0-4 min): builds, scouting, early pressure | PARTIAL | Built-in AI follows a build order (Workers, Forge, expansion; `ai.mjs` cfg) and a first wave from tick 2400 (1:40). TERRITORY section 5 puts tier 2 at 3:30-4:30; Bloom at 3:00 | Nothing protects the opening: bots kill the built-in Core in 14-33 s (FANATICS #1). Scouting has no reason to exist yet because fog is not hiding anything (FANATICS #4). No on-screen "what you should be doing now" |
| 21b | Early-mid: first expansions, tier 2 tech, first attacks | PARTIAL | Claims gated by neutral camps (TERRITORY 14), tier 2 needs Hold >= 3 (`env/tiers.mjs`), AI `holdPlan` [2400,2],[4000,3] | All of it is territory-only, and the default page is not a territory match. On the default page there is no expansion pressure and no tier gate |
| 21c | Mid game: multiple bases, army trades, harass | PARTIAL | Hold-count upkeep discount (`env/budget.mjs`), Drift events at 5:00, 7:00, 8:00 push fights; AI attacks in waves, retreats and re-arms (`ai.mjs` ~303-308) | No harass tool: nothing rewards hitting an enemy Drill/Track line with a small squad (TERRITORY 8 raidable economy is in the doc, not yet proven in play). The built-in AI only sends one big wave, never a raid |
| 21d | Late game: max supply, top tech, map running out of resources | PARTIAL | No supply cap by design; upkeep and debt are the late-game brake (`budget.mjs`); tier 3 at Hold >= 6; Dry-outs deplete fields; The Fall at 14:00 crumbles Outer Reaches one every 20 s, "ends long games by ~16:00" | Max supply is NOT FOR US (replaced by upkeep). The map-runs-out part is HAVE in design (Dry-out, Fall) but unproven: no test shows a match reaching 14:00, since matches end in minutes (see 21a) |
| 21e | Comebacks possible through harass and smart trades | PARTIAL | Debt-based upkeep and Drift events are the planned comeback engine (FANATICS item 7). Shed Skin Recall (TERRITORY 14) lets a loser re-buy ranked troops at half price | Nothing measures it. FANATICS item 7's goal (30% of matches change lead after the first big fight) has no counting test. Also a lost Core is instant defeat, so a comeback after a lost fight is only possible if the Core survives (cooldown/floor missing) |
| 21f | The game snowballs: an advantage tends to grow | HAVE (and risky) | Holding Reaches gives +25% mining, cheaper upkeep and tier access (TERRITORY section 3), so a lead compounds; the Core win and the 14-of-21 hold both end snowballs fast | Needs a brake as well as a feature: the Drift is meant to be that brake (hits the leader's Reaches too) but the fixed 3:00 to 14:00 table is the same for both sides, so it does not help the side that is behind specifically. Debt softens only army size |
| 21g | (implied) Phases are legible to the player | MISSING | `play/drift-banner.mjs` announces each Drift event 30 s ahead; `ai.mjs` and docs name phases, but there is no phase name or timeline in the HUD | NORTHSTAR 4: "everything that can make you lose is visible before it bites". There is no strip showing opening, expand, fight, endgame |
| 21h | (implied) Match length fits the phases | PARTIAL | NORTHSTAR target 12-16 min; live driver cap 15 min; `STATS.match.maxTicks` 2000 (about 83 s) in `env/stats.mjs` for the stats runs | Stats cap (2000 ticks) is far shorter than the first Drift event (Bloom at 3:00 = 4320 ticks), so the sim tests never see a single phase change. Built-in mirrors end near 1:42 |

Counts across 8 rows: HAVE 1 (21f), PARTIAL 6 (21a, 21b, 21c, 21d, 21e, 21h), MISSING 1 (21g). Of the six section lines themselves: 5 PARTIAL, 1 HAVE. NOT FOR US: only "max supply" inside 21d, replaced by upkeep.

## TOP 5 changes, ranked by how much they improve how Driftfall plays

1. **Make the opening survivable, so the phases actually happen** (same root as FANATICS #1).
   - What: a Core that cannot fall before about 3:00 (extra Core hp or damage reduction that fades, plus an attack cooldown so a 4-unit push is not a 1.5 s kill). Raise or remove the 2000-tick stats cap for territory runs.
   - Owner: fable (`env/combat.mjs`, `env/stats.mjs`, `env/sim.mjs`); sonnet reviews numbers.
   - Done when: over 20 seeded mirror matches with side swap, no Core falls before 3:00, the built-in mirror passes 4:00 on at least half the seeds, and a test records the tick of the first Bloom reached (4320) in most runs.

2. **A visible phase strip in the HUD** (Opening, Expand, Fight, Endgame), driven by the real clock, Hold count and next Drift.
   - What: a thin bar by the Drift banner: current phase name, one plain sentence of advice ("claim your Natural, clear its camp"), and next-phase trigger (for example "Tier 2 at Hold 3: you hold 2"). Pure display from state already available (`tick`, Hold, tier, Drift schedule).
   - Owner: sonnet (`play/` new file next to `play/drift-banner.mjs`, plus one line in `play/app.mjs`); fable checks wording for the 3-minute teaching goal.
   - Done when: a unit test maps tick/Hold/tier to a phase name for 8 sample states; on the page the strip changes at 3:00, Tier 2 and 9:00; a fresh player in a playtest names what to do next without help.

3. **Make the territory match the default, so expansion and tiers shape the mid game** (NORTHSTAR 2; already top item in audit 01).
   - What: default link starts the territory ruleset with the 128x128 map, camps, tier gates and upkeep. Without it, 21b to 21d have no effect on the live page.
   - Owner: sonnet (`play/app.mjs`, `env/live.mjs` hand-off) with fable on the default flag.
   - Done when: opening the plain link shows the Reach count and tier lock text, and a built-in vs built-in run on the default takes a Reach by 4:00.

4. **Give the built-in AI a raid and a recall step, not only one big wave.**
   - What: after the first wave, the AI sends 2-3 fast units at the enemy's Drill/Track line or a lightly held Reach, and pulls back when outmatched; it also rebuilds (Recall) after a lost fight. This is the harass and comeback pattern the section describes, and it is what the human is playing against.
   - Owner: haiku drafts, sonnet reviews (`players/builtin/ai.mjs`).
   - Done when: across 10 seeds, in at least 5 matches the AI raids an economy structure before 8:00, and the human loses no more than the Drill, not the match, to a 3-unit raid.

5. **Measure snowball and comeback, then tune them** (turns FANATICS item 7 into a number).
   - What: add a counting test/report that, per seed, records the lead (value or Hold count) at the first Drift announcement, after the first big fight and at the end, and reports how many matches change leader. Tune the Drift's random slots (11:00, 13:00) and debt weariness so the loser is not just slower to die.
   - Owner: fable (balance, `BALANCE.md`) with haiku running the seeds.
   - Done when: across 10 seeds, at least 30% of matches change leader after the first big fight and no match is decided before the first Drift announcement (FANATICS item 7's own "done"), published in BALANCE.md.

Not recommended now: a supply cap or "max supply" phase (upkeep replaces it); team modes (not v0.1).
