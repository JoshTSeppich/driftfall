# Atom audit 27: Technical

Author: team haiku (audit only). Source: research/STARCRAFT-ATOMS.md section 27, checked against NORTHSTAR.md,
TERRITORY.md sections 2 and 11, and these files: env/live.mjs, env/log.mjs, env/rng.mjs, env/sim.mjs,
env/commands.mjs, env/stats.mjs, env/referee.mjs, viewer/replay.mjs, play/app.mjs, play/camera.mjs,
play/render.mjs, play/units-instanced.mjs, play/perf-scenario.mjs, PERF.md, matches/latest.json, and the tests
named below. No code was edited.

## Verdict table

| # | Atom line | Verdict | What Driftfall already has (evidence) | The gap |
|---|---|---|---|---|
| 1 | Deterministic lockstep: only commands are sent; every client simulates. | **PARTIAL** | The sim is pure: `step(state, [cmds0, cmds1])` in env/sim.mjs. The only input is a command list per side (env/commands.mjs). `rerun(log)` in env/live.mjs re-simulates a log from its seed and gives the same events. The RNG is mulberry32 (env/rng.mjs); no `Math.random` in env/ outside the timing code in referee and run-match. | There is no second client. play/ runs the sim in one browser tab with the AI in the same process. Networked human-vs-human is NOT FOR US for v0.1 (NORTHSTAR: "vs the built-in AI"), so the local half is the part that counts. |
| 2 | Replays are command logs, which is why they're tiny. | **PARTIAL** | The log is a command log plus events: `rerun` already rebuilds every event from commands alone. Driftfall logs are written to matches/latest.json and replayed by viewer/replay.mjs. Log format is tested (tests/log-format.test.mjs, tests/viewer-replay.test.mjs). | The log stores every event, so it is not tiny: matches/latest.json is 784 KB for 2000 ticks. The same log with commands only (every tick kept) is 66 KB. Joshua has no in-game way to watch a finished match back: play/app.mjs only imports the replay helper (`statFor`), and watch mode is live only. |
| 3 | Fixed game ticks (BW about 24 per second on Fastest). | **HAVE** | `TICKS_PER_SECOND` = 24. env/live.mjs runs a fixed 1000/tps step, caps catch-up at `maxCatchUp` per wake-up and drops the rest, so a hidden tab never fast-forwards. Stats clock: stats.mjs `clock.ticksPerSecond`. Tests: tests/live-driver.test.mjs with a fake clock. | None that matters for v0.1. |
| 4 | Same input → same game, always. | **HAVE** | Same seed + same command lists → same events, pinned by tests/sim-determinism.test.mjs and tests/determinism-fuzz.test.mjs. A test (sim-determinism.test.mjs line 82) scans env/ sources for nondeterministic APIs. The live driver logs what was applied, so a live game replays exactly. | Two soft spots. (a) A live game is not checked against its own replay: the log has no state checksum, so a divergence shows only in tests. (b) sim-determinism goes red under full-suite parallel load (.sandbox notes), so the guarantee is only proven when that test runs alone. |
| 5 | Low hardware requirements; runs on everything. | **PARTIAL** | Units are instanced: about 17 draw calls for 200 units plus a shadow pass (play/units-instanced.mjs header). Pixel ratio capped at 2 (play/app.mjs). `?quality=high|medium|low` exists (play/app.mjs, play/render.mjs). Sim cost is budgeted: tests/perf.test.mjs, 40 v 40 in under 2x baseline. The 200-unit perf scene exists (play/perf-scenario.mjs, tests/perf-render.test.mjs). | Nothing measured in a browser yet. PERF.md line 87 says rendering "is not gated here". NORTHSTAR's "60 fps with 200 units on the MacBook Air" has no recorded number. `quality=low` only halves the VFX (play/app.mjs line 269); shadows and unit detail do not change. There is no automatic step-down, and no check for WebGL failure beyond the 3D loader's failure list. |
| 6 | Sprite-based 2D graphics (BW). | **NOT FOR US** | We render in 3D with drawn geometry (ART-DIRECTION.md "Faceted Ink": every unit modelled in code, under 300 triangles). Sprites would break the drawn-art rule in NORTHSTAR section 3. The 2D canvas still exists for the minimap and overlay (play/app.mjs lines 423, 454), which is fine. | Not a gap. |
| 7 | 3D with a fixed RTS camera (SC2). | **HAVE** | play/camera.mjs: "a fixed tilted orthographic view", pitch 52 degrees, zoom 12 to 40, edge scroll, middle-drag. Units interpolate between ticks with `alpha` (play/units-instanced.mjs lines 327 to 419), so 24 tps sim motion draws smoothly at 60 fps. | Nothing for v0.1 beyond item 5 above. |

Tally (7 lines): HAVE 3, 4, 7 · PARTIAL 1, 2, 5 · MISSING 0 · NOT FOR US 6.

## Top 5 changes, ranked by how much they improve how Driftfall plays

1. **Prove 60 fps on the MacBook Air, and make `quality` real.**
   - What: run play/perf.html on the Air once and write the median frame time and draw count into PERF.md. Make `quality=low` also switch off the shadow pass and use the simpler unit detail. Add an automatic step-down to medium when frame time stays above 25 ms for 3 s.
   - Owner: fable (play/render.mjs, play/units-instanced.mjs). Haiku writes the PERF.md row and the gate in tests/perf-render.test.mjs.
   - Done when: PERF.md has a browser row for the Air at 200 units with median ≤ 16.7 ms, a test proves `quality=low` drops the shadow pass, and Joshua sees a 200-unit battle hold 60 fps on the Air.

2. **"Watch the match back" on the end screen, next to the rematch.**
   - What: after a game ends, the banner offers Watch back. It loads the match log and plays it through viewer/replay.mjs with the play, pause, speed and scrub controls already in viewer/hud.mjs.
   - Owner: sonnet (play/app.mjs end banner and the replay wiring). Fable confirms the log shape.
   - Done when: after any game Joshua can press Watch back and scrub the whole match, and a test shows the replayed final state equals the result shown on the banner.

3. **Commands-only match logs, rebuilt on load.**
   - What: keep one entry per tick with its commands and drop the stored events, so the file is about 66 KB instead of 784 KB. viewer/replay.mjs calls `rerun` to rebuild the events when the log is opened.
   - Owner: fable (env/log.mjs, env/live.mjs, viewer/replay.mjs). Sonnet checks the viewer.
   - Done when: a 2000-tick log is under 100 KB, the log-format test passes, and the rebuilt events match the full log exactly. Measure the rebuild time on the Air; it must stay under 1 s.

4. **State checksums in the log, every 240 ticks (10 s).**
   - What: export a short hash of the sim state from env/sim.mjs. env/live.mjs writes it into the log every 240 ticks. `rerun` compares it and reports the first tick that differs.
   - Owner: fable (env/sim.mjs hash export, env/live.mjs, env/log.mjs). Haiku writes the test.
   - Done when: a test that changes one unit's hp makes the rerun name the right checkpoint, and every live log from a match with the built-in AI reruns with no mismatch. This also tells us if sim-determinism flakes are real drift.

5. **Command envelope with a tick and a player id.**
   - What: give each command a `tick` and `player` field in the log, so a future human-vs-human link can feed the same log and the same rerun. Today the driver only queues plain commands.
   - Owner: fable (env/live.mjs, env/commands.mjs). Sonnet updates the log-format test.
   - Done when: the log-format test accepts the new envelope, old logs still rerun, and a test feeds two sides of commands through the envelope. This does not change play for v0.1; it keeps the lockstep path open.

## What Joshua can see or do now

Nothing new is visible from this audit. Items 1 and 2 are the two that Joshua would feel first: a measured 60 fps on the Air, and a Watch back button after each game.

## Scope note

Haiku edited only this file. No tests were run, because this is an audit. Numbers come from matches/latest.json (784 KB full log, 66 KB commands only, 2000 ticks) and from reading the files named above.
