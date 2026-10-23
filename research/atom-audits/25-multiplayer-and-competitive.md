# Audit 25: Multiplayer and competitive (haiku)

Checked against research/STARCRAFT-ATOMS.md section 25, NORTHSTAR.md, TERRITORY.md sections 3, 5 and 14, FANATICS.md,
BALANCE.md, LAUNCH.md, and the code: play/app.mjs, play/watch.mjs, play/index.html, env/live.mjs, env/referee.mjs,
env/map.mjs, env/sim.mjs, viewer/viewer.mjs, viewer/replay.mjs, live/captions.mjs, live/editions.mjs, CHANGELOG.md.
Read only. No code edited.

Context that shapes every verdict: v0.1 is one static page, one human (side 0) against the built-in AI (side 1), no
server, no accounts. The sim is two-sided by design. The game is deterministic (same seed + same command log = same
game), which is the groundwork for replays and any later online play.

## Verdicts

| # | Atom (section 25) | Verdict | Evidence / note |
|---|---|---|---|
| 1 | Online ladder with leagues (Bronze to Grandmaster) | NOT FOR US (v0.1) | Needs accounts, a server and a player base. HOSTING.md picks a static host. Revisit after v0.1 has a rematch habit. |
| 2 | Matchmaking by skill rating | NOT FOR US (v0.1) | No online opponents to match. The closest thing is the AI difficulty setting (`?difficulty=easy\|normal`, play/app.mjs:197), which has no measured rating behind it. See change 5. |
| 3 | Seasons and map pools | PARTIAL | Map sizes exist: `standard` 128, `large` 192, `huge` 256 (env/map.mjs:59). Live Editions (live/editions.mjs) give a patch-like cadence. Missing: a pool of maps or seeds that rotates, and any season name or reset. The default seed is fixed at 7 (play/app.mjs:179). |
| 4 | Replays saved and shared | PARTIAL | Every match is a deterministic log: env/live.mjs builds `driver.log` and `rerun(log)` replays it (env/live.mjs:131-137). viewer/viewer.mjs loads a log and scrubs it. Missing: a human's finished match is not saved or linked from the result screen, so no share. |
| 5 | Replay analysis is a culture (timeline, graphs, what-if) | PARTIAL | The viewer has play, pause, step, scrub and a side panel with counts and value (viewer/replay.mjs `countsOf`, `valueOf`). Missing: a post-match timeline of Reaches held, Drift events, income and army, and any "what if" view. |
| 6 | Observer mode with player-perspective views and production tabs | PARTIAL | Watch mode exists: `?mode=watch`, the built-in AI plays both sides, a caster camera follows the action (play/watch.mjs, play/app.mjs:199-221). The top bar shows income, army and Reaches per side (app.mjs `watchBar`). Missing: a per-side fog view (the bar reads the whole state), production tabs, and an event ticker. |
| 7 | LAN and spawn copies | NOT FOR US (v0.1) | No network play. The sim has no transport. A two-browser lockstep over a relay is possible later because the command log is the protocol; not for v0.1. |
| 8 | Custom games and lobbies | PARTIAL | A custom game is a link: `?seed=`, `?ai=`, `?difficulty=`, `?ticks=`, `?mode=watch` (play/app.mjs:7). Missing: a setup screen (seed, map size, opponent, length) and a "copy this game" share button. There is no lobby, and none is needed for v0.1. |
| 9 | Team games (2v2, 3v3, 4v4) and free-for-all | NOT FOR US (v0.1) | Two sides are hard-wired: `createMatch` and the referee use sides `[0, 1]` (env/referee.mjs, env/sim.mjs), and the watch bar has two teams. Four-base play would need a new map layout and balance. Park it. |
| 10 | Professional leagues and esports | NOT FOR US | Needs a ladder, an audience and years of play. |
| 11 | Casters and commentary culture | PARTIAL | The caster camera exists (play/watch.mjs `createCaster`, `glide`). Live captions exist for the TV page (live/captions.mjs), and FANATICS.md #9 and #10 ask for a caster mode with an event ticker. Missing: the ticker and the score strip wired to Drift warnings and lost Reaches. |
| 12 | Balance patches over years | PARTIAL | Patch notes exist as CHANGELOG.md and a live changelog (live/changelog.mjs), and every green build becomes an Edition (TERRITORY.md section 10). Missing: player-facing balance notes, and a published balance table. BALANCE.md says the mirror "does not pass yet". |

Totals: 0 HAVE, 7 PARTIAL, 0 MISSING, 5 NOT FOR US (rows 1, 2, 7, 9, 10).

Note on the rematch (not a section 25 line, but the goal in NORTHSTAR.md says "wants a rematch"): pressing Enter after a
result runs `location.reload()` (play/app.mjs:405), which keeps the same query. The seed defaults to 7, so the rematch is
the same map and the same game. Nobody can play a different game without typing a new URL. This is the biggest
single gap for the rematch goal, and it is caught by rows 3 and 4 above.

## TOP 5 changes (ranked by how much they improve how Driftfall plays)

**1. A rematch is a new game, with a reason to play again.**
- What: the result screen gets two buttons. "Rematch" keeps the seed. "New seed" picks the next seed from a short list
  (fixed list for v0.1 so it is testable). The screen names the cause in plain words: "A Core fell at 4:12, you lost
  your third Reach at 3:40" (FANATICS.md #8 and #10). Enter is still the rematch key.
- Owner: sonnet (play/app.mjs result screen and `showResult`); fable picks the seed list.
- Done when: a node test finishes a match and checks both buttons; the "New seed" button loads a seed other than 7; the
  result text names the cause for Core, territory and timeout endings.

**2. Save and share a finished match as a replay link.**
- What: when a human match ends, the live driver's log is offered as a download, and a "Watch the replay" link opens
  the viewer on it (viewer/viewer.mjs). The log is already deterministic (env/live.mjs `rerun`), so this is wiring, not
  new sim code.
- Owner: sonnet (play/app.mjs writes the log and link); haiku (viewer/viewer.mjs load check and a replay test).
- Done when: a test runs a short match, produces the log, and `rerun(log)` matches the final state; the viewer opens the
  file from the link.

**3. A map pool and a seed rotation, so the live link is a season.**
- What: the live link rotates a small pool of seeds across the three existing sizes (standard, large, huge). The seed
  shows on screen ("Seed 7 · Standard"). Each Edition picks the next one. This also gives the balance report a fixed set
  of seeds to report on.
- Owner: fable (pool choice and sizes, since they touch map balance); sonnet (play/app.mjs reads the pool).
- Done when: the rotation is a pure function of the build number, a test pins the pool, and the seed is on the HUD.

**4. Caster view: per-side fog toggle, an event ticker, and Drift warnings on the score strip.**
- What: watch mode gets a button for "Cyan view" and "Orange view" (`observe(state, side)` already exists), plus a
  ticker that prints "Flood in 30 s", "Reach lost", "Core under attack". The lower-third captions from live/captions.mjs
  can run in watch mode.
- Owner: sonnet (play/watch.mjs, play/app.mjs); haiku (ticker wording and the caption text).
- Done when: a 5-minute watch session names every Drift event and every lost Reach in the ticker (FANATICS.md #9 test).

**5. Publish the balance table and make the built-in AI a three-step ladder.**
- What: BALANCE.md gets a table of mirror win rates over seeds 1 to 40 with side swapped, and the built-in AI gets three
  published settings (easy, normal, hard), each with its measured win rate against normal. The player sees "Beat Normal
  three times to unlock Hard" on the setup line. This is the v0.1 stand-in for rows 1 and 2.
- Owner: fable (the numbers, in env/stats.mjs); haiku (the balance runner and BALANCE.md); sonnet (the difficulty
  unlock on play/app.mjs).
- Done when: BALANCE.md shows a mirror win rate inside 45 to 55 percent over the published seeds, or says plainly that
  it does not and why; the three settings each have a measured row.

## What Joshua can see or do now

Nothing new. This was an audit only. I edited only this file.
