# Atom audit 24: Single player (haiku)

Scope: STARCRAFT-ATOMS.md section 24 (six lines), checked against NORTHSTAR.md and TERRITORY.md sections 1, 3, 14.
Code read by grep and reading only (no tests run; no code edited):
`players/builtin/ai.mjs`, `env/live.mjs`, `env/items.mjs`, `env/territory.mjs`, `env/tiers.mjs`,
`play/app.mjs` (start options and result screen), `play/teach.mjs`, `play/index.html`, `play/watch.mjs`.

## Verdicts

| # | Atom line | Verdict | Driftfall now | Why |
|---|-----------|---------|---------------|-----|
| 1 | Campaigns per race with a story | NOT FOR US (v0.1) | No campaign. The page starts one skirmish vs the built-in AI. The world text in TERRITORY §1 is flavour only. | A campaign is a large content build. NORTHSTAR v0.1 is one match vs AI with a rematch. Revisit after v0.1 as a Drift-era saga. |
| 2 | Mission variety (defend, escort, timed, hero missions) | PARTIAL | Timed pressure exists (the Drift is on a public clock). The territory win (hold 14 of 21 for 90 s) is built in `env/territory.mjs` (`holdTicks: 240`), but the live result screen only knows `core`, `timeout` and both-Cores endings (`play/app.mjs:656`), so it is not on screen. No defend, escort or side objective. | Objectives are the mission variety. Only the Core kill is visible to a player today. |
| 3 | Heroes with names in the campaign | PARTIAL | `env/items.mjs` has ranks 1–3, Shed Skins, Recall at half price with rank and items kept, and two item slots. `enableItems` is called from nowhere in `env/` or `play/`, so it is OFF in every live match. Veterans have no names. | The veteran is Driftfall's hero. It is built and not wired (NORTHSTAR order 2). |
| 4 | Difficulty levels | PARTIAL | Two levels in `players/builtin/ai.mjs` (`normal`, `easy`). Easy has 8 workers, a later first wave, no expansion turret and a slower re-aim. The live page defaults to `easy` (`play/app.mjs:197`) but the setting is URL-only (`?difficulty=`). There is no on-page picker. `env/live.mjs` maps both levels to `aiEvery: 1`, so Easy is not a throttle. A 3-minute AI peace period (`aiStartTick`) applies to both. | The ladder exists; the player cannot see or choose it. |
| 5 | Challenge / training modes (SC2) | PARTIAL | `play/teach.mjs` gives short contextual coaching for the first 3 minutes, never a tutorial screen. `?mode=watch` is an AI-vs-AI spectator match with a caster camera. No drills or timed challenges. | Coaching and spectating exist. A challenge a player can pass or fail does not. |
| 6 | Vs AI with difficulty levels (Very Easy → Elite, Cheater) | PARTIAL (Cheater: NOT FOR US) | Two levels (see row 4). No Very Easy, Hard or Elite. | More levels are cheap (Fable sets the numbers). A Cheater AI breaks the Council's rule 9, "fair AI, published balance table". |

Counts: 0 HAVE, 5 PARTIAL, 0 MISSING, 1 NOT FOR US (campaign for v0.1; the Cheater sub-item is also NOT FOR US).

## TOP 5 changes (ranked by how much they improve how Driftfall plays)

### 1. A difficulty picker on the start page, plus a Hard level
- **What:** Put a three-way choice (Easy / Standard / Hard) next to the one-click start, defaulting to Easy for a
  first game. Add a `hard` row to `SETTINGS` in `players/builtin/ai.mjs` (earlier first wave, more workers, the
  expansion turret on, faster re-aim). Publish the three rows in the balance table (Council rule 9).
- **Owner:** Sonnet wires the picker in `play/app.mjs` and the start screen. Fable sets the Hard numbers in `players/builtin/ai.mjs`.
- **Done when:** On Joshua's screen, the start page shows the three levels before the match starts. A test asserts
  that `SETTINGS` has `easy`, `normal`, `hard`, and that the page passes the chosen level to `createLiveMatch`.
  The default first game is still Easy, so no early loss before 3:00 (Council rule 1).

### 2. Wire the veterans in: enable items and ranks, Recall works, and veterans get names
- **What:** Call `enableItems(state)` in the live match (`env/live.mjs`), so ranks, Shed Skins and Recall run.
  Give each unit that reaches Rank 1 a generated name (a short Driftfall-style name list, original). Show the rank
  stars and the name in the HUD, and show the Recall button after a ranked unit dies.
- **Owner:** Fable wires `enableItems` and `stepItems` into `env/live.mjs` and `env/sim.mjs`. Sonnet adds the `recall`
  case in `play/input.mjs` and the name plus stars on the unit card. Haiku writes the name list and its test.
- **Done when:** In a live match, a unit with one kill shows one star and a name. After a ranked unit dies, the
  Recall button appears and a recalled unit returns with its rank. Test: a scripted match with one kill ends with
  that unit named and at rank 1.

### 3. In-match objectives that can be won or lost on screen (a mission card)
- **What:** Show the territory win on the result screen (`play/app.mjs:656` only knows Core and timeout today). Add
  one or two optional objective cards per match, each with a timer and a reward: hold a Reach through a Drift for
  60 s, or clear a camp within 4 minutes. Keep the Core win as the default ending.
- **Owner:** Fable designs the objectives and their numbers (`env/territory.mjs`, a new objective module). Sonnet
  adds the card and the result line in `play/`.
- **Done when:** A match shows an objective card with a live timer. Completing it pays the reward, and the end
  screen names the win reason, including "held 14 of 21 Reaches for 90 s". Tests cover the timer and the reward.

### 4. Short timed drills from the start page
- **What:** Three drills, each a short scenario with a pass or fail and a best time saved in localStorage:
  "Have 10 Workers by 2:00", "Claim your Natural by 4:00", "Survive the first Bloom at full Core HP". The drills
  reuse `play/teach.mjs` coaching to explain each step.
- **Owner:** Sonnet builds `play/drills.mjs` and the start-page entry. Haiku writes the drill tests and checks each
  drill is winnable against the Easy AI. Fable signs off the numbers.
- **Done when:** Three drill buttons appear on the start page. Each drill shows a pass or fail at the end and keeps
  the best time after a reload. A test runs each drill to completion with a scripted player.

### 5. A named rival for the one match
- **What:** Give the built-in AI one original rival name (for example from the Drift's own cast of creatures) and
  show it on the start page, in the HUD and on the end screen. The rival gets one line of alert text the first time
  a Drift event hits. This is the cheap version of "heroes with names", with no campaign.
- **Owner:** Fable chooses the name and the lines (copy in TERRITORY-style flavour). Sonnet shows them in `play/` (alerts and end screen).
- **Done when:** The start page and end screen both name the rival. Joshua sees the rival's line the first time a
  Drift warning fires. Test: the rival name appears in the end-screen HTML and in the alert text.

## Not doing (and why)
- **A story campaign per race:** NOT FOR US for v0.1 (see row 1). Reopen after v0.1 ships.
- **A Cheater AI:** NOT FOR US. It conflicts with Council rule 9 (fair AI).

## What Joshua can see or do now
Nothing new. This is an audit only. Blockers for the top changes: `enableItems` is not called anywhere (change 2),
and the difficulty choice is URL-only (change 1).
