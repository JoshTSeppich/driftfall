# Driftfall test plan and quality bar

Owner: QA Lead (fable). Only this file. Plain English. Every claim below was checked by running it; the time of the
last run is in section 3. If a line here and the code disagree, say so in the chat and one of them gets fixed.

How to read: **GATE** = must be green before the thing it guards may happen. **COVERED** = a real test exists and
passes. **THIN** = a test exists but misses an important case. **GAP** = nothing tests it yet. Each gap names a
proposed owner; the owner may decline in the chat with a reason and an alternative.

---

## 1. What "green" means

A build is **green** when, run by the Build Compiler or by hand with the same command, these all hold:

1. Every file in `tests/` and `play/*.test.mjs` runs under `node --test` and exits normally (no hung process, no
   timer keeping node alive).
2. Zero failing tests, after the flake rule below is applied.
3. `env/run-match.mjs` plays a sample-vs-sample match on seed 7 and the log passes `validateLog`.
4. No test file was weakened to get there: a test that is loosened, skipped or marked `todo` needs a chat post
   naming the reason and an AGREE from someone on another team.

**Flake rule.** Two checks are known to go red only under full-suite parallel load and pass alone: the perf
"2× baseline" checks (`tests/perf.test.mjs`) and the byte-identical-logs check in `tests/sim-determinism.test.mjs`
(the referee's wall-clock limits trip when the CPU is shared). A red in either counts as a flake only if it passes
when re-run alone, twice. Anything else red is red. The Build Compiler should run with `--test-concurrency=2` or
run those two files after the rest, so the status page stops lying.

**Who decides.** The QA Lead says whether a build is green for a gate. Owners fix; QA does not patch other
people's files to make the bar.

---

## 2. The gates

### Gate A: players may compete (bot-vs-bot matches count for standings)

All of section 1, plus every one of these green **when run alone**:

| area | file | why it guards the gate |
|---|---|---|
| sim determinism | `tests/sim-determinism.test.mjs` | same seed and players must give byte-identical logs or results can't be trusted or replayed |
| determinism fuzz | `tests/determinism-fuzz.test.mjs` | random legal command streams, replayed from the log, must match |
| referee limits | `tests/referee-limits.test.mjs` | late, throwing, hanging and broken players are handled exactly as the spec says |
| anti-cheat | `tests/anticheat.test.mjs` | a player can't read files, spawn, hang, flood the log or crash the other side |
| command validation | `tests/commands-validation.test.mjs` | every reject reason fires right, malformed input never throws, odd-tick order holds |
| end conditions | `tests/sim-end-conditions.test.mjs` | core, both-cores, timeout by value, exact tie |
| log format | `tests/log-format.test.mjs` | the log validates and a replay rebuilds the final state |
| full match smoke | `tests/full-match-smoke.test.mjs` | the command-line referee runs end to end, exit 0, no shared tiles |
| combat rules | `tests/combat-damage.test.mjs`, `tests/combat-targeting.test.mjs`, `tests/combat-counters.test.mjs` | damage, targeting, simultaneous kills, Brute double damage, the five promised counters |
| economy | `tests/economy-gather.test.mjs`, `tests/economy-build-train.test.mjs` | mining, delivery, retargeting, build and train rules, unit cap |
| movement | `tests/movement-order.test.mjs`, `tests/movement-edge.test.mjs`, `tests/path-finding.test.mjs` | id order, odd-tick reversal, detours, deadlocks, blocked events |
| map and state | `tests/map-generation.test.mjs`, `tests/state-helpers.test.mjs`, `tests/stats-table.test.mjs` | mirrored maps, connected, spec coordinates, observation is a true deep copy |
| perf | `tests/perf.test.mjs` | no metric over 2× its recorded baseline (PERF.md) |

Also required, not a test file:

- **Every number in `env/stats.mjs` that a competing player can see is frozen** for the length of a round. A balance
  change between rounds is a new round. (Patch Manager / Balance Designer own the change; QA checks the counters
  file still passes.)
- `SECURITY.md` finding 1 (players not sandboxed) is **closed**: players run as child processes under Node's
  permission model. Checked by `tests/anticheat.test.mjs` "file reads from a player must fail".
- `assets/LICENSE-AUDIT.md` is **not** part of Gate A (bots don't ship art), but it is part of Gate C.

### Gate B: a human may be put in front of Classic (play/)

Gate A, plus:

| area | file or check | status now |
|---|---|---|
| live driver | `tests/live-driver.test.mjs` | COVERED (30 checks; 24 tps on a fake clock, queue slice before step, resign mid-think, oversized command) |
| input to commands | `play/input.test.mjs`, `play/app.test.mjs`, `play/systems.test.mjs` | COVERED in node, **never seen in a browser** |
| built-in AI | `tests/builtin-ai.test.mjs` | COVERED (builds, expands, attacks inside 5 min, both seats, deterministic) |
| vision / fog | `tests/vision.test.mjs` | COVERED in node (13); the sim itself has no fog yet, so the client draws fog the sim doesn't enforce |
| "no Core falls before about 3:00 against the default bot" | `tests/viewer3d-integration.test.mjs`, two Classic checks (3D QA fable), Joshua's ask in chat (#282) | COVERED and **red on purpose**: idle human loses the Core at about 10 s to the sonnet bot and well inside 3:00 to the built-in normal AI under today's numbers. Stays red until the stats owner lands the pace change (cooldowns, train/build/mine ticks). |
| opening camera frames the human's base | same file, two checks | COVERED and **red on purpose** (Joshua's #282, camera opens off-centre); owners sonnet (app.mjs, camera.mjs) |
| renderer path: app.mjs draws units through `play/units-instanced.mjs` or `createPlayRenderer` | `tests/viewer3d-integration.test.mjs` "play/app.mjs draws units through the instanced path" (3D QA fable, added 22:14) | COVERED and **red on purpose** until sonnet switches (two lines, chat #292): the stress check gives 17 instanced meshes for 208 units on the instanced path and 2796 plain meshes on `viewer3d/units.mjs`, which is what the page still wires at line 258. (Credit: Classic renderer fable's review.) |
| whole Classic renderer boots headless | `tests/viewer3d-integration.test.mjs`, ported by the 3D QA fable at 22:17 from the Classic renderer fable's `.sandbox/fable-classic/smoke-render.mjs` | COVERED, passing: builds createPlayRenderer under a proxy WebGL context, waits for ready, sets the sample world, steps 30 engine frames, asserts no system was switched off (the dead-HUD class of bug), picks a unit at its projected screen position and nothing in an empty corner, applies a fog window and disposes. Not a substitute for a browser pass. |
| HUD and command card in a real browser | GAP | nobody has opened play/index.html with the wired HUD. Compatibility Tester owns the browser pass. |
| rejected commands shown to the player | GAP | PLAYTEST.md item 4; owner sonnet (app.mjs) |

### Gate C: a build may be shown on the TV / released

Gate A, plus the 3D and live-view suites (`tests/viewer3d-*.test.mjs`, `tests/live-*.test.mjs`,
`tests/viewer-*.test.mjs`, `tests/art-smoke.test.mjs`) green, `viewer3d/QA.md` has no open item marked blocking
by the 3D QA fable, and `assets/LICENSE-AUDIT.md` says clear to ship (today it says **not clear**: 390 unrecorded
`.ogg` files in `assets/audio/_scratch/` and one OpenGameArt track with unverified CC0).

---

## 3. Where we stand (measured)

Filled in by the QA Lead from a run of every test file. Numbers from `live/status.json` are **not** used here: at
the time of writing it was stale (build 26, 19:47 UTC, 516 pass / 77 fail) and `tests/run-all.mjs` crashes before
printing anything (`plural is not defined`, line 114), so neither is a source of truth until the SDET fixes the
runner and the compiler is restarted.

See section 3a below for the latest run; it is replaced each time, never appended.

### 3a. Latest run

Run by the QA Lead on the Mac mini, 2026-10-22 21:54–21:57 UTC, `node --test --test-concurrency=2 tests/ play/`:

| | count |
|---|---|
| test files | 41 in `tests/` + 3 in `play/` |
| tests | 709 |
| pass | 708 |
| fail | 1 |
| wall clock | 191 s |

The one red is `sim-determinism` "env sources avoid nondeterministic APIs": it lists `env/live.mjs: Date.now` and
`setTimeout`. That is gap 6 in section 5 (bookkeeping, not a sim bug); it also fails alone, so it is not a flake.

Re-run alone right after: `perf` 6 of 6 pass; `sim-determinism` the same single red; `viewer3d-integration`
(re-run 22:15) 5 fail **on purpose**, the rest pass (the 3D QA fable added Joshua's Classic findings as failing
checks after the full run had passed that file: "no Core falls before 3:00 against the default AI" for both the
sonnet bot and the built-in normal AI, "the opening camera frames the human's base" for app.mjs and camera.mjs,
and "app.mjs draws units through the instanced path"). Those five are Gate B reds, not Gate A reds.

By hand: `env/run-match.mjs --seed 7` sample vs sample: side 1 wins by timeout at tick 2000, value 3480 vs 3520,
563 ms, 2000 tick entries, `validateLog` returns no problems.

By hand, first real-bot match checked by QA (`players/sonnet/bot.mjs` vs `players/builtin/ai.mjs`, seed 7, logs
only, no bot code read): sonnet wins by Core kill at tick 1592, value 865 vs 25, 2.6 s wall clock; 546 hits, 89
deaths, **zero** late, error, forfeit or reject events; `validateLog` clean. Run twice, the two logs are
byte-identical once `timing` is removed. This is one pairing on one seed, so
gap 1 stays open, but it shows the referee, combat and Core-kill path work end to end with real players.

**Gate A verdict right now: red for one bookkeeping reason only (gap 6).** Every gate-A test file in section 2
passes alone except that one check. Once the `live.mjs` exemption and the spec sentence land together, Gate A is
green on this machine, subject to gap 9 (the Air rsync) being off.

**Gate B verdict: red** (four intentional reds above, plus PLAYTEST.md items 3 and 4, plus no browser pass).

**Gate C verdict: red** (license audit not clear; viewer3d/QA.md has open items; no browser pass).

---

## 4. Coverage map (test area → owner → how solid)

Status is from the latest run plus reading the file. "Owner" is the test owner in PLAN.json (or the file header).

### Simulation (env/)

| area | file | test owner | module owner | status |
|---|---|---|---|---|
| map generation | map-generation | haiku | sonnet | COVERED (20) |
| path finding | path-finding | fable | sonnet | COVERED (25) |
| stats table | stats-table | sonnet | haiku | COVERED; **THIN**: does not yet check `structureMultiplier` or the new `referee.commandChars` row |
| state helpers | state-helpers | sonnet | haiku | COVERED (30) |
| commands | commands-validation | sonnet | haiku | COVERED (36) |
| combat damage | combat-damage | fable | haiku | COVERED (19) |
| combat targeting | combat-targeting | sonnet | haiku | COVERED (45) |
| combat counters | combat-counters | haiku | haiku/fable | COVERED (5); **THIN**: five duels only, no Lancer kiting under movement detours, no Turret vs Lancer at range 4 vs 5 |
| economy gather | economy-gather | haiku | fable | COVERED (6); **THIN**: 6 tests for the whole gather loop; no test for two Workers on one tile, a Core surrounded, or a tile emptying mid-mine for two Workers at once |
| economy build/train | economy-build-train | sonnet | fable | COVERED (40) |
| movement order | movement-order | haiku | fable | COVERED (8) |
| movement edge | movement-edge | Movement edge agent | fable | COVERED (8); sticky detours reviewed by haiku (AGREE) |
| end conditions | sim-end-conditions | haiku | fable | COVERED |
| determinism | sim-determinism | sonnet | fable | COVERED; flaky under load (section 1) |
| determinism fuzz | determinism-fuzz | Network Programmer | fable | COVERED (12 seeds × 3 runs by default) |
| referee limits | referee-limits | fable | fable | COVERED (13) |
| anti-cheat | anticheat | Anti-Cheat Engineer | fable (referee) | COVERED (19 incl. file-read, spawn, hang, 50 MB reply) |
| log format | log-format | fable | sonnet | COVERED (66) |
| full match smoke | full-match-smoke | fable | fable | COVERED (8) |
| perf | perf | Performance Engineer (haiku) | — | COVERED (5 metrics, 2× rule); flaky under load |
| live driver | live-driver | fable | fable | COVERED (30) |
| vision | vision | sonnet | sonnet | COVERED (13) against the **v3 draft**, not the agreed spec |

### Viewer, live page, 3D, Classic

| area | files | status |
|---|---|---|
| 2D replay | viewer-replay (31), log-format replay half | COVERED |
| 2D art, fx, hud, live screen | art-smoke, viewer-fx-fight, viewer-fx-hud, viewer-hud-mount, live-viewer (18) | COVERED in node; never opened in a browser by an agent |
| live TV page, spotlight | live-page (1), live-spotlight (8) | **THIN**: live-page is one mocked test |
| 3D systems | viewer3d-world, -terrain, -vfx, -director, -engine, -hud, -units, -palette, -assets | COVERED in node with real Three.js |
| 3D integration and perf | viewer3d-integration (59 checks, 3D QA fable) | COVERED, includes a scripted fight and a 208-unit stress frame |
| Classic client | play/input.test, play/app.test, play/systems.test (12) | COVERED in node; PLAYTEST.md lists 4 BROKEN items |

---

## 5. Thin areas and gaps, with proposed owners

Ordered by how much they threaten a gate. "Proposed" means the owner has not yet said yes in the chat.

1. **GAP, Gate A.** No match between two **different** real players has been recorded or checked. Every smoke,
   determinism and balance run is sample-vs-sample (the balance report kept 1 of 6 matches, the rest dropped for
   late or errored players, and no hit was ever logged). Proposed: Balance Tester runs the three team bots
   round-robin through `env/run-match.mjs` on 3 seeds and reports forfeits, late ticks and reasons; QA Tester
   files every forfeit in BUGS.md with seed and tick. The bots' code is never read, only their logs.
2. **THIN, Gate A.** The "late on every tick" case **is** covered (corrected after reading the file:
   `tests/anticheat.test.mjs` line 348 runs a slow-but-inside-the-hard-limit player for 5 ticks, expects 5 late
   events, no forfeit, and no commands reaching the sim). Still missing: that `timing` is the **only** field that
   differs between two referee runs with a slow player (sim-determinism checks this for the sample player only),
   and a slow player over a full-length match rather than 5 ticks. Proposed owner: Anti-Cheat Engineer.
3. **COVERED, red, Gate B.** "No Core falls before about 3:00 against the default bot" (Joshua, #282) is pinned
   by the 3D QA fable in `tests/viewer3d-integration.test.mjs` for both default AIs. It needs the pace decision
   (haiku's ×12 table and the Live Driver's measurements are in the chat) from the Balance Designer and stats
   owner. Once numbers land, that check should move into a sim-level file (it is a rules test, not a renderer
   test) so Gate B doesn't depend on the 3D harness; proposed owner for the move: Playtest haiku, with the 3D QA
   fable's agreement.
4. **THIN, Gate A.** `tests/stats-table.test.mjs` doesn't know about the fields added since: `structureMultiplier`
   on every attacker row and `referee.commandChars`. If someone deletes either, combat goes NaN again and the
   command cap vanishes, and only indirect tests catch it. Proposed owner: stats-table test owner (sonnet).
5. **THIN, Gate A.** `economy-gather` has 6 tests for the most-exercised loop in the game. Missing: two Workers
   sharing one crystal tile's last load; a Worker whose Core is fully ringed by units (delivery impossible); a
   Worker ordered to gather a tile that empties while it walks. Proposed owner: haiku (test owner).
6. **THIN, Gate A.** `sim-determinism`'s source scan exempts only `referee.mjs` and `player-worker.mjs`; the new
   `env/live.mjs` legitimately owns a clock, so this test is red until the exemption and ENV-SPEC §13 are updated
   together (both the Live Driver and Integration B asked for this). Owner: sonnet (test) + spec owner. Until
   then this red is **not** a flake and **not** a sim bug; it is a bookkeeping red.
7. **GAP, Gate B/C.** Nothing in `play/` or `viewer3d/` has been run in a browser by an agent; Joshua found three
   broken things in one look (HUD stuck at tick 0, camera too close, units tiny) that no node test could see.
   Proposed: Compatibility Tester owns a written browser checklist (Safari, Chrome, the TV, Retina) and runs it on
   every Gate C candidate; the 3D QA fable keeps `viewer3d/QA.md` as the punch list.
8. **GAP, infrastructure.** `tests/run-all.mjs` crashes; `live/status.json` is stale. Owner: SDET (sonnet) for the
   runner, Build Compiler (sonnet) to restart with the flake rule from section 1.
9. **GAP, process.** Files were overwritten by an rsync job from the MacBook Air (chat #285, #289, #293). Until
   that is off, no test result from this machine is trustworthy for more than a few minutes. Owner: IT Support /
   DevOps; QA re-runs the gate after the sync is stopped.
10. **GAP, v3.** PLAN-v3-draft.json lists 34 test areas; 18 are new (terrain-step, air-movement, vision-fog,
    stealth-detection, combat-air, combat-cooldown-siege, abilities-conduit, healing-repair, economy-flux,
    economy-rich, tech-berths, transport-barge, raider-dart, rubble, combat-counters-v3, observation-fog, map-layout
    and the v3 stats-table). **Rule:** v3 does not replace ENV-SPEC.md until every new module in PLAN-v3 has its
    test area green, and `tests/full-match-smoke.test.mjs` checks shared tiles **per layer** (ground and air).

---

## 6. Who covers what (QA roles)

| role | owns | first job |
|---|---|---|
| QA Lead (fable) | this file; the green call for each gate | keep sections 2, 3 and 5 true; post the gate status every 15 min |
| QA Analyst / Test Lead | the coverage map's truth (section 4 and `tests/` coverage) | read each spec section against the test files and add rows to section 5 |
| QA Tester | BUGS.md | reproduce every BROKEN line in PLAYTEST.md and every forfeit from gap 1 with seed, tick and owner |
| Balance / Multiplayer Tester | analytics/balance-reports | gap 1: round-robin of the three team bots, 3 seeds each, report forfeits and win rates with data |
| SDET / Test Automation | tests/run-all.mjs | fix the `plural` crash; add `--test-concurrency=2` and the run-alone retry for the two flaky files |
| Determinism fuzzing (Network Programmer) | determinism-fuzz, sim-determinism | gap 6 bookkeeping red; then raise fuzz seeds for Gate A runs |
| Performance Engineer | perf.test.mjs, PERF.md | the baseline block in PERF.md must be recorded and reviewed; today the 2× rule has nothing to compare against on a fresh checkout |
| Anti-Cheat Engineer | anticheat.test.mjs | gap 2 (all-late player, timing-only differences) |
| Compatibility Tester | COMPAT.md | gap 7: browser checklist for play/ and viewer3d/ |
| Certification / Compliance | assets/LICENSE-AUDIT.md | the two blocking items (scratch oggs, OpenGameArt track) |
| 3D visual QA (fable) | viewer3d-integration, viewer3d/QA.md | unchanged |
| Playtest (haiku) | PLAYTEST.md | gap 3 once numbers land |

Nobody tests their own module. If a test owner and module owner are the same person, that row is a conflict to
fix in PLAN.json, not here.

---

## 7. Rules for every test (from PLAN.json, restated so nobody has to look)

- `node --test`, import the real env modules, never stub the thing under test.
- Every number comes from `env/stats.mjs`; tests read it from there (`STATS.units.x`, `STATS.structures.x`,
  `STATS.crystal.x`, `STATS.match.x`, `STATS.referee.x`), never hard-coded.
- No `Math.random`, `Date`, timers or async inside `env/*` except `referee.mjs`, `player-worker.mjs` and (pending
  the §13 update) `live.mjs`.
- A test that needs a browser says so in its header and is **not** counted toward a gate; it goes on the
  Compatibility Tester's checklist instead.
- A hanging test is a failing test: anything that keeps node alive (timers, workers, child processes) must unref or
  dispose.
- Test files run alone must pass alone. Passing only inside the full suite, or only outside it, is a bug in the test.

How to run:

```
node --test --test-concurrency=2 tests/ play/        # the gate run
node --test tests/perf.test.mjs                      # re-run a flake alone
node --test tests/sim-determinism.test.mjs           # re-run a flake alone
node env/run-match.mjs --seed 7 --p0 players/sample-player.mjs --p1 players/sample-player.mjs --out /tmp/m.json
```

---

## 8. Open asks (answered in the chat, tracked here)

- Build Compiler (sonnet): adopt the flake rule and concurrency from section 1; restart the compiler.
- SDET (sonnet): fix `tests/run-all.mjs`.
- sim-determinism owner (sonnet) + spec owner (fable): `live.mjs` exemption and ENV-SPEC §13 sentence, together.
- Balance Designer: the pace decision (cooldowns, train/build ticks, mining ticks) so gap 3 can be tested.
- Reviews so far: 3D QA fable AGREE on Gate B naming the two Classic checks (#309); Classic renderer fable
  (Engineering) AGREE on sections 1, 2 and 5 with the two Gate B rows above added (#312). A Design-side read is
  still welcome.
