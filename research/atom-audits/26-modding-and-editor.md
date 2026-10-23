# Atom audit 26: Modding and editor

Source: research/STARCRAFT-ATOMS.md section 26. Checked against NORTHSTAR.md, LAUNCH.md section 2 (cut list), TERRITORY.md sections 2, 4, 14, and the code in env/, maps/, play/, viewer/ and players/. Read-only audit; nothing else edited.

## Verdicts

| # | Atom line | Verdict | What Driftfall has today (evidence) | Why |
|---|-----------|---------|-------------------------------------|-----|
| 26.1 | Map editor shipped with the game | **NOT FOR US (v0.1)** | No editor anywhere in env/, play/, maps/. Maps are drawn in code (`maps/layout-v4.mjs`, `drawV4(spec)`), written once by `maps/build-v4.mjs` to `maps/driftfall-v4.json`. The format is a self-describing `driftfall-map` JSON with a legend, and `encodeV4`/`decodeV4` round-trip it. | LAUNCH.md section 2 cuts "map editor" and "more than one map" from v0.1. The map data format is the part worth keeping as a foundation (see change 5). |
| 26.2 | Custom maps became their own genres (tower defence, DotA-style, RPG) | **NOT FOR US** | None. Only fixed map sizes exist: `?map=standard|large|huge` (`env/map.mjs`, `maps/layout-sizes.mjs`). | Those genres need triggers, scripting and an editor, all cut for v0.1. Driftfall's own genre hook is the Drift and the territory win, not custom modes. |
| 26.3 | Triggers and scripting | **PARTIAL** | Engine side only. The Drift is a seeded, deterministic event schedule that is announced 30 s ahead (`env/drift.mjs`, `createDrift(seed)`). AI "scripts" are plugged in by name: `?ai=builtin|sonnet|haiku|fable|sample` loads `players/<name>/bot.mjs` (or `players/sample-player.mjs`), and each bot exposes `act()` (`play/app.mjs` line 190). Player-facing triggers: **none**. | The schedule and bot hook are real, but no player can author or see a trigger, and the bot hook is a URL parameter, not a menu. |
| 26.4 | Community map makers set the competitive map pool | **NOT FOR US** | No accounts, sharing, ratings or uploads (LAUNCH.md section 2 cuts all of them). Closest thing: the URL holds `?seed=`, `?map=`, `?ticks=`, `?difficulty=`, so one link reproduces one match exactly. | Needs community infrastructure and a server, both out of scope. The share-by-link idea lives on in change 1. |

### Adjacent facts we already have (not section 26 lines, but they matter here)

| Item | Verdict | Evidence |
|------|---------|----------|
| Deterministic replay of every live game | HAVE | `env/live.mjs` says every live game is a replay (`driver.log` is a `driftfall-log`, `rerun(log)` reproduces it). `viewer/replay.mjs` has `replayTo(log, tick)`. `matches/latest.json` is a real log. |
| Watch mode (AI vs AI, caster camera, next seed) | HAVE | `play/watch.mjs`, `?mode=watch`, `showWatchEnd` in `play/app.mjs` line 673. |
| End screen with a way to play again | **MISSING** | `showResult` (`play/app.mjs` line 653) prints VICTORY/DEFEAT and "Press Enter for a new game". No rematch button, no "watch replay", no match code on screen. Council item 8 in NORTHSTAR.md asks for this. |
| Map choice visible to a player | **MISSING** | `play/index.html` has no map picker. The three sizes are reachable only by typing `?map=` (NORTHSTAR section 2 and TERRITORY section 14 already call these built). |
| Published rules table (stats as data) | PARTIAL | `env/stats.mjs` `STATS` is one deep-frozen data object (units, structures, upgrades, Drift constants). Good shape, but nothing is published for players and there is no override path. |

## TOP 5 changes (ranked by how much they improve how Driftfall plays)

**1. Rematch and match code on the end screen.**
- What: the result panel gets a **Rematch** button (same seed, same map, same Drift), a **Copy match link** button (the full URL with seed, map, ticks, difficulty), and a line "Seed 7 · Standard 128 × 128 · Easy". Enter still starts a new game.
- Why: the Council's item 8 and NORTHSTAR's "wants a rematch". It also turns every game into a shareable link, which is our version of "community map pool" without a server.
- Owner: **sonnet** (builds `play/app.mjs` `showResult`, `play/index.html`); **fable** decides the link format.
- Done when: a test builds the link from a finished match's seed/map/ticks/difficulty and loading that URL gives the same first tick state and the same `drift` schedule (`createDrift(seed)` deep-equals). On Joshua's screen: after a match, a Rematch button and a copyable link appear, and the link opens the same game.

**2. Map picker on the start page (wire, don't add).**
- What: a three-option picker (Standard 128 · Large 192 · Huge 256) plus the seed field on the start page, writing `?map=` for the choice. Default stays what `DEFAULT_MAP` says today.
- Why: the three sizes are built and tested (`tests/map-sizes.test.mjs`) but a stranger can only reach them by typing a URL. NORTHSTAR order item 2 says plug finished work into `play/`.
- Owner: **sonnet** (`play/index.html`, `play/app.mjs` start options); **fable** owns the default.
- Done when: the picker writes `?map=large` and the game loads the 192 map. Test: `tests/map-sizes.test.mjs` plus a new start-page test that each option produces its map name. On Joshua's screen: he picks a size with a click, no URL editing.

**3. Watch last game (replay the command log in the viewer).**
- What: on the end screen, a **Watch replay** button opens `viewer/` with the match's own `driftfall-log`, so the player can scrub to the moment a Reach fell or the Core died.
- Why: the replay log already exists for every game (`env/live.mjs`). Players learn the map and the Drift fastest by seeing their own loss, and this is the classic-replay feel with no new simulation.
- Owner: **haiku** writes the glue (end screen to viewer, log passed through `sessionStorage` or a `#log` hash); **sonnet** owns `viewer/` UI; **fable** approves.
- Done when: a test runs `replayTo(log, lastTick)` and checks the end state equals the live end state (same winner and reason). On Joshua's screen: after a loss, "Watch replay" opens a scrubbable replay of that exact game.

**4. Bot picker for practice (use the bot hook we already have).**
- What: the start page lists the opponents that exist (`builtin`, `sample`, plus any `players/*/bot.mjs` that passes the test-suite contract) with one line each, instead of `?ai=` in the URL. Default stays `builtin` on Easy.
- Why: this is the nearest thing Driftfall has to "scripting a mod": a new AI is a file that exposes `act()`. A player can pick a harder one without touching the URL, which helps the "fair AI, published balance" item in NORTHSTAR's Council list.
- Owner: **sonnet** (start page), **fable** decides which bots are public; each bot owner writes the one-line description.
- Done when: a test asserts every listed bot loads through the same importer `play/app.mjs` uses and exposes `act`. On Joshua's screen: the start page shows an opponent list with a short description, and picking one loads that bot.

**5. Map code: export and import a generated map (the editor's foundation, no editor UI yet).**
- What: a "Copy map code" button that writes the current map's `driftfall-map` JSON (already produced by `encodeV4`), and `?map=code:<base64>` that decodes it through `decodeV4` and plays it. No editing UI.
- Why: this is the only piece of section 26 that is cheap now and useful later. It keeps the map format honest (the round trip is tested) and it lets Joshua send a map that broke a test to someone else for a bug report.
- Owner: **fable** (`maps/layout-v4.mjs`, `env/map.mjs`); **haiku** writes the round-trip test and the import guard (size and legend checks on pasted codes).
- Done when: `encodeV4(decodeV4(code))` equals the original for Standard, Large and Huge seeds, and a malformed code is refused with a plain message instead of a crash. On Joshua's screen: a copy button and a paste path into `?map=code:`; nothing changes for players who never use it.

## Notes for the team
- Nothing in section 26 is HAVE as a player feature. The deterministic log and bot hook are the real assets; the rest is UI wiring.
- Changes 1 to 4 are presentation wiring over existing code. Change 5 touches map files owned by fable, so it needs a `REVIEW?` before it lands.
- Joshua sees nothing new from this audit; it writes only this file.
