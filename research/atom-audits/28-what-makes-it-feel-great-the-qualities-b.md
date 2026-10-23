# Atom audit 28: What makes it feel great (the qualities behind the rules)

Scope: research/STARCRAFT-ATOMS.md section 28 only, checked against NORTHSTAR.md, TERRITORY.md and the files named below.
Read by grep and short excerpts: play/app.mjs (showResult, watch end, toast), play/feel.mjs (flash, shake, cues),
play/watch.mjs (caster, topbar), play/teach.mjs, play/fog.mjs, env/live.mjs (tick driver, catch-up rule),
research/atom-audits/21 and 25 and the team chat. Nothing was run; verdicts come from reading. Verdict key: HAVE / PARTIAL / MISSING / NOT FOR US.

## Verdict table

| # | Quality (section 28) | Verdict | Evidence in Driftfall | Gap |
|---|---|---|---|---|
| 28a | Speed: everything responds instantly | PARTIAL | Live driver ticks at a computed schedule with bounded catch-up (`env/live.mjs`); `play/feel.mjs` gives hit flashes (160 ms) and selection cues; haiku's ANIM plan has button press 80 ms. | The sim only moves on tick edges, so an order shows no change until the next tick. No order acknowledgement (click ring, unit "yes" flinch) and no button press or refusal feedback yet. Haiku's UI motion section is planned, not built. |
| 28b | Readability: tell what is happening at a glance | PARTIAL | Team colours cyan/orange, hand-drawn art, hit rings, Drift banner 30 s ahead (`drift-banner.mjs`), tier readout, territory HUD, minimap. | Fog is drawn by `fog.mjs` but `app.mjs` does not call it, so no hidden or remembered information. Unit identity and counters are muddy (4 live kinds; audit 19). No health or cooldown readout for fights. Placeholder shapes remain in 3D. |
| 28c | Depth from few rules | PARTIAL | Design has it on paper: Reaches gate tiers, upkeep and debt brake armies, Drift events, scarcity prices, Trading House. | Most of these are built but not wired live (items and ranks are off in live, Quake and Fall change no tiles, abilities missing; audits 11, 13, 19). Today the live game is closer to "gather, train, attack" than the multi-system game. |
| 28d | High skill ceiling, clear skill floor | PARTIAL | Floor: `teach.mjs` explains buttons, one-click start, idle-worker key, smart right-click, hotkey grid, control groups. Ceiling: hotkeys, groups, Track drag, Recall planned. | Floor still leaks (no first-3-minutes script, no verb on right-click, audit 15). Ceiling is thin: no kiting (attack cooldown missing, audit 14), no abilities, no harass target other than the Core. |
| 28e | Every unit matters; nothing is filler | PARTIAL | Roster designed with ranks, Recall, 2 item slots; camps drop items. | Live roster is Grunt, Lancer, Brute plus workers; Adder, Charmer, Shedder have no stat rows (audit 11). Armour, air and splash are ignored by combat (audit 19), so units are close to interchangeable. |
| 28f | Information is a weapon | PARTIAL | Vision module with high ground exists (`env/vision.mjs`); fog tracker with explored memory (`play/fog.mjs`). | Not wired into the page (haiku audit 13). Without it, scouting has no value and no ambush is possible. Also nothing lets you see the enemy's tier or Hold count except the god-view. |
| 28g | Economy is a weapon | PARTIAL | Mining chain (Drills, Track, Press) in `env/economy.mjs`; Dry-outs; Reach hold gives +25% mining; Trading House scarcity prices; `flow-panel.mjs` shows income. | Raiding is weak: Track lines and drills are not raidable targets in the live default, and the AI does not harass them. Debt and upkeep are visible only in tests, so "starve them" is not a plan a player can see working. |
| 28h | Constant tension: never enough APM | PARTIAL | Idle-worker key exists; many things to do on paper (claim, camps, Drift warnings, market). | Early game is quiet while the AI sits in its 3-minute peace period; there are no multi-front pressures (no harass, no expansion race) until the middle. Alerts do not yet pull attention (Space-cycles-alerts is only planned). |
| 28i | Clear win/lose feedback; you know why you lost | PARTIAL | `showResult` prints VICTORY / DEFEAT / DRAW with a one-line reason ("A Core fell", "Time ran out"). | The reason names no cause. There is no replay of the last fight, no army, income or Reach-count comparison, and no "you lost because your Hold dropped below 6 for 40 s". Enter reloads the same seed (audit 25), so it is not a rematch. |
| 28j | Comebacks and upsets exist | PARTIAL | Debt upkeep, Drift events, Recall and camps are the planned engine (FANATICS 7); territory win needs 90 s of holding, which gives time to react. | Snowballing is HAVE and risky (audit 21f): Reach holding compounds. Nothing measures comeback rate or gives the loser a dignified lever (cheaper reclaim, Drift targeting the leader). |
| 28k | Watchable: spectators understand the stakes | HAVE | `play/watch.mjs` caster (camera glide to battles/claims/Drift), `watchBar` top bar with income, army and Reaches per side plus a "why we're looking here" label, auto next seed in 10 s. | Minor: no win-probability or "who is ahead" bar; stakes are shown as numbers only. |
| 28l | Distinct factions with personality and humour | PARTIAL | One faction (Snakenators) with hand-drawn funny art; ART-DIRECTION.md sets the tone; portraits and icons exist. | Humour lives in the art only. There is no voice, no unit quips on select/order, no funny cause-of-defeat line, no second faction. The mirror-only match means "distinct" is NOT FOR US in v0.1, but "personality" is not. |

Counts across 12 rows: HAVE 1 (28k), PARTIAL 11, MISSING 0, NOT FOR US 0 as whole lines (only the "distinct" half of 28l is NOT FOR US for v0.1: one faction, a mirror).

## TOP 5 changes, ranked by how much they improve how Driftfall plays

1. **Make every order and button answer within one frame (28a).**
   - Add: a click ring where you right-click (cyan for move, red for attack, gold for mine/claim), a 2-frame unit "nod" (scale squash) on the first selected unit, an 80 ms button press and a 120 ms deny jolt on refused clicks (not enough Sap, no tier). All presentation-only, no sim change; use haiku's ANIM numbers so there is one timing set.
   - Owner: sonnet (`play/feel.mjs`, `play/app.mjs`, `play/render.mjs`), haiku supplies the UI timing section.
   - Done when: a headless test shows each of move, attack, mine, claim and refused-command emitting one cue the same frame as the click (extend `feel.test.mjs`), and Joshua clicks the ground and sees a ring immediately.

2. **A real end screen that says why, with a Rematch button (28i, 28j).**
   - Add: replace the "A Core fell." line with a cause line chosen from the log (Core killed by X army at 7:42; Hold fell below 6; time ran out with fewer Reaches), a two-column comparison (army made, Sap mined, Reaches held, units lost), and buttons Rematch (new seed, same settings) and Watch replay. Give the cause line a Snakenator voice (a dry joke), because defeat should still be funny.
   - Owner: sonnet (`play/app.mjs showResult`), fable supplies the end-reason tags in `env/sim.mjs` (core, territory, timeout, forfeit already exist; add "last damage source" and "Hold minimum").
   - Done when: lose three seeded matches in a test and each shows a different, correct cause plus both stat columns; Enter starts a different seed.

3. **Wire fog and scouting into the page (28f, 28b).**
   - Add: call `fog.update` each tick, draw unexplored black, explored dim, enemy units hidden outside sight, enemy buildings ghosted where last seen, and the same on the minimap. Give the first scout (any worker) a reason to go: camps and Reaches are only shown when seen.
   - Owner: sonnet (`play/app.mjs`, `play/render.mjs`, minimap); fable keeps `env/vision.mjs` exact.
   - Done when: a test places a Fang out of sight and the render list omits it, a ghost remains after sight is lost, and Joshua sees black at match start with his Core and a ring of vision.

4. **Make the opening busy but survivable so tension exists (28h, 28c).**
   - Add: the 3:00 Core floor (already landed as the AI peace period), plus a light early reason to act: the first camp is cheap to clear, the first Reach claim shows a Hold counter ticking toward Tier 2, and the AI sends one 2-unit poke at 1:30 that goes after a worker line, not the Core. Space cycles the last five alerts so attention can be pulled.
   - Owner: fable (AI poke, numbers in `env/stats.mjs`, `players/builtin/ai.mjs` is shared; ask in chat), sonnet (alert cycle in `play/input.mjs`).
   - Done when: across 10 seeds the human is never at Core below 50% before 3:00 and the first fight starts between 1:30 and 2:30 in at least 8 of them.

5. **Give units and the Snakenators a voice and distinct jobs (28e, 28l).**
   - Add: three line quips per unit type on select and order ("Ssssure."), Drift alerts and the end-screen cause line in the same dry tone; and fable's stat rows for Adder, Charmer, Shedder plus armour/air/splash in combat so every unit has a visible counter (see audits 11 and 19, same fix).
   - Owner: fable (stat rows and combat), sonnet (quip hook in `play/feel.mjs`), haiku (writes the lines in `play/teach.mjs`-style data).
   - Done when: a counters test shows each unit beats one other and loses to one other by at least 30% more damage, and selecting each unit shows its own line and portrait.

Not in the Top 5 but worth noting: a "who is ahead" bar on the watch top bar (28k polish), and a measured comeback rate of 15–25% across seeds as a balance gate (28j) once the AI is rescaled.

Edited only this file.
