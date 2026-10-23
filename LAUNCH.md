# Driftfall v0.1: the production plan

Owner: sonnet (production lead). Written 2026-10-22. Plain English. Gate owners edit their own rows by posting in the chat; I update this file.
Driftfall is ORIGINAL: our names, numbers and art only. Sources: TERRITORY.md (sections 13 and 10), CLASSIC.md, TEST-PLAN.md, MILESTONES.md, PERF.md, SECURITY.md.

## 1. What v0.1 is
A person opens one web page and plays a 12-16 minute match **against the built-in AI**, as the Snakenators in a **Snakenators mirror** (the Burrow stays parked, its numbers kept in the tables).
- **One map**, 128x128, cut into Reaches (maps/driftfall-v4).
- **Territory**: claim a Reach with a Totem, hold it, tiers unlock by Holds (TERRITORY s3, s5).
- **The Drift**: announced events (Flood, Squall, Quake, Dry-out, The Fall) change the map (s4).
- **Mining chain**: hand mining, then Drills, Tracks, Depots, Presses (s8).
- **Upkeep**: army costs a share of income; debt is visible (s9).
- **Trading House**: eight resources, prices that follow scarcity, 25% buy spread (s12).
- **Drawn art**: hand-drawn cartoon style, icons and portraits; no placeholder boxes in the play client.
- **Classic controls**: edge-scroll, arrow keys, minimap, box select, control groups, smart right-click, hotkey grid, alerts with jump-to key, idle-worker button (CLASSIC.md).
- **Always-live editions**: every green build becomes a playable edition on the live page (s10).
- **Deterministic**: same seed + same commands = same game; a replay is the command log.

## 2. Cut until later (not in v0.1)
Burrow faction and any second race; human-vs-human and online play; campaign, missions, story cinematics; more than one map; map editor; accounts, saves, ratings; mobile and touch; sound beyond a few clear barks and alerts (music is out); bot-vs-bot tournaments as a player feature (they stay a QA tool); anything needing a server. Anything not listed in section 1 is cut by default.

## 3. Release gates
v0.1 ships only when every gate is green on the **same commit**. The gate owner says green; nobody else edits their evidence.

| # | Gate | How it is checked (a command or a procedure) | Owner |
|---|---|---|---|
| G1 | **All tests green** | `node --test --test-concurrency=2 tests/ play/` has zero failures after the TEST-PLAN flake rule (perf and sim-determinism re-run alone, twice); `env/run-match.mjs` seed 7 passes `validateLog`; no test weakened to pass | fable (QA Lead) |
| G2 | **60 fps with 200 units on the MacBook Air** | A scripted scene of 100 units a side in combat, in the real play client with the instanced renderer, holds a 60 fps average and no frame over 33 ms for 60 s; sim tick stays under budget in PERF.md. Numbers measured on the Air, not the mini | haiku (Performance) with fable (renderer) |
| G3 | **A first-timer finishes a match unaided** | QA (fresh eyes, no hints) plays one full match start to end and files every moment they had to ask or guess; zero blocking items, and s13 checks pass (every button shows hotkey, cost and a sentence; every losing condition visible before it bites; first 3 minutes self-teach) | Onboarding/UX owner (haiku, play UI) with QA |
| G4 | **No secrets in the build** | A scan of the repo and the shipped files for keys, tokens, `.env`, absolute home paths and the user's email finds nothing; player sandbox fixes from SECURITY.md (findings 1-5) are closed or accepted in writing | sonnet (Security) with Build & Release |
| G5 | **Deterministic replays** | The same seed and command log replayed twice gives byte-identical logs and equal final state, with territory, Drift, chain, upkeep and market all switched on; the fuzz suite passes; no wall clock or Math.random in sim code (the sim-determinism clock scan, with env/live.mjs reconciled) | fable (sim/driver) |
| G6 | **Balance** | Hundreds of built-in-AI mirror matches on the v0.1 map keep side win rate inside 45-55% and length inside 12-16 min | Balance Designer (fable) |
| G7 | **Licence and originality** | Asset MANIFESTs cover every shipped file; Gate C of TEST-PLAN is green; no name, number or art from an existing game | Licence audit (gpt) with Art Director |
| G8 | **Playable from a clean checkout** | Fresh clone, one documented command opens the game; Live Build Compiler status is green; tag v0.1 and notes written | Build & Release |

## 4. Order of work (small steps, always playable)
1. Defaults stay playable; every new rule stays behind its flag until its tests pass (so editions never break).
2. Switch the flagged territory match on as the **default** play match once G1 and G5 pass with it on.
3. Wire the instanced renderer and the Classic UI helpers into play/app.mjs (M4/M8), then measure G2.
4. Build intercepts still open: Drill/Siphon/Depot/Press build, drag-laid Tracks, Trading House commands and UI.
5. First-timer pass (G3), balance run (G6), then the security, licence and secrets sweeps (G4, G7).
6. Freeze, run all gates on one commit, go/no-go.

## 5. Go/no-go
I run the go/no-go once every row shows green with evidence (command output or dated QA note). Any red row is a no-go; a gate can be waived only by Joshua. Open risks are listed in MILESTONES.md.

## 6. Prod role plans
Each role replies in the chat with one paragraph: what you will do, what you need, when you will report. Roles: Senior Producer, QA Lead, Build & Release, Performance, Security, Onboarding/UX, Balance, Licence audit, Art Director, Technical Director.
