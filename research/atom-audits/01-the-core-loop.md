# Atom audit 01: The core loop

Scope: research/STARCRAFT-ATOMS.md section 1 only, checked against NORTHSTAR.md and TERRITORY.md sections 1, 3, 4, 8, 9.
Files read: env/sim.mjs (checkEnd), env/sim-territory.mjs and env/territory.mjs (rules), env/economy.mjs (gathering),
env/budget.mjs (upkeep, debt), env/combat.mjs (attacks), env/drift.mjs (clock), env/tiers.mjs, env/live.mjs
(maxTicks, forfeit), env/stats.mjs (match block), play/app.mjs (result screen, pause, AI default, territory flag),
play/flow-panel.mjs, players/builtin/ai.mjs (claim logic, by grep only).

Verdict key: HAVE = Driftfall already does an equivalent. PARTIAL = some of it exists, or it exists but is off on the
live page. MISSING = not there. NOT FOR US = deliberately not in Driftfall, with the reason.

## Verdict table

| # | Atom (section 1, as written) | Verdict | Evidence in Driftfall | Gap |
|---|---|---|---|---|
| 1a | Gather resources | HAVE | `env/economy.mjs` `stepGathering` (Workers mine and deliver); Drills, Tracks and Press in TERRITORY §8 | Mining is wired on the live page; a regression was reported at 19:32 and is under NORTHSTAR priority 1 |
| 1b | Spend them | HAVE | `env/budget.mjs` draws cost during training; construction and research pay through the same budget | none |
| 1c | Build an army | HAVE | Training queues in `env/economy.mjs`; no supply cap (TERRITORY §9) | none |
| 1d | Fight | HAVE | `env/combat.mjs` `stepCombat`, attack orders and auto-fight | Combat has no attack cooldown: a 4-unit push takes 1000 Core hp in about 35 ticks (haiku, FANATICS.md). This is a balance gap, not a missing loop step |
| 1e | Expand | PARTIAL | Claims (`env/territory.mjs`, Totem/Mound), built-in AI claim logic in `players/builtin/ai.mjs` | Territory is off on the default page; only `?territory=on&map=v4` reaches it. The live driver does not create a territory match yet (sonnet #413, blocked on fable) |
| 1f | Every second is economy, army or tech | PARTIAL | Flow panel (`play/flow-panel.mjs`), tiers and research (`env/tiers.mjs`), upkeep (`env/budget.mjs`) | Tiers and upkeep exist only when territory rules are on. On the default page the three-way choice is not in the HUD |
| 1g | Game ends when one side has no buildings left | NOT FOR US | `env/sim.mjs` `checkEnd`: the match ends when a Core falls (`reason: core`), or on a timeout by value | Deliberate design: TERRITORY §3 makes Core destruction and a 14-of-21 Reach hold for 90 s the wins. "No buildings" would fight the Reach win and the Drift |
| 1h | Players concede ("GG") before total destruction | MISSING | `play/app.mjs` has no Concede control, and `play/` never references forfeit. The forfeit path exists only in `env/live.mjs` (driver API, lines ~331 and ~450) | A player cannot end a lost match early. Only Enter after the result (reload) is offered |
| 1i | One player per side in 1v1; team modes exist | NOT FOR US (for v0.1) | Two sides only; NORTHSTAR's goal is one human against the built-in AI. Watch mode is two AIs, not teams | Team play is a later idea. Revisit only after v0.1 is fun |
| 1j | Matches last about 8–25 min; most decisive games 10–18 min | PARTIAL | Live driver cap is 15 min (`env/live.mjs` maxTicks 24×60×15); stats cap is 2000 ticks (`env/stats.mjs`); NORTHSTAR target 12–16 min | Built-in mirrors end around 1:42 (FANATICS.md). The Core has no early-game floor, so matches end too fast to feel like a match |
| 1k | Real time: both players act at once, no turns | HAVE | Fixed 24 ticks a second clock (`env/drift.mjs` TICKS_PER_SECOND, `env/live.mjs`); commands queue into the next tick; pause with P (`play/app.mjs`) | none |
| 1l | Game speed "Fastest" is the competitive standard | NOT FOR US | One fixed clock, no speed setting. A fixed clock keeps the Drift timers and per-minute numbers readable and fair | A speed option would only matter for debugging. Not planned |

Counts across the 12 rows: HAVE 5 (1a, 1b, 1c, 1d, 1k; 1d has a balance problem noted above), PARTIAL 3 (1e, 1f, 1j),
MISSING 1 (1h), NOT FOR US 3 (1g, 1i, 1l).

## TOP 5 changes, ranked by how much they improve how Driftfall plays

1. **Give the combat loop a cooldown and a 3:00 Core floor** (FANATICS Council #1).
   - What: add an attack cooldown per unit kind in `env/combat.mjs` and `env/stats.mjs`, so a 4-unit push cannot take a Core in about 1.5 s. Add an early-game rule so no Core can fall before 3:00.
   - Why it matters: with no cooldown, the first 20 seconds decide the match. That is the opposite of a 12–16 minute game.
   - Owner: fable (`env/combat.mjs`, `env/stats.mjs`, `env/sim.mjs`). Sonnet reviews the numbers.
   - Done when: over 20 seeded mirror matches with side swap, no Core falls before 3:00; the median decisive match is 10–18 min; the built-in mirror runs past 4:00 on at least half of its seeds.

2. **Make the territory match the default link.** The 14-of-21 Reach win and the Drift are the game's loop, but the live page cannot reach them by default.
   - What: `env/live.mjs` gets `territory: true` (fable, per sonnet #413). `play/app.mjs` makes `?territory=on&map=v4` the default, with the existing `territory-hud` shown.
   - Owner: fable (`env/live.mjs`), sonnet (`play/app.mjs`, defaults).
   - Done when: a plain page load shows Reaches held, the Drift 30 s banner and the flow panel, and a match can end on a 90 s territory win.

3. **Add a Concede button and a rematch on the result screen** (loop step 1h).
   - What: a Concede control in `play/index.html` and `play/app.mjs` that calls the existing forfeit path in `env/live.mjs`. The result screen gets a Rematch button next to "Press Enter".
   - Owner: sonnet (`play/app.mjs`, `play/index.html`); fable confirms the driver call.
   - Done when: clicking Concede ends the match on the next tick with reason `forfeit`, and the result screen offers a rematch that starts a new seed without a page reload.

4. **Show the three-way spend split on the default page** (loop step 1f: every second is economy, army or tech).
   - What: a small bar under the HUD with three segments (economy spend, army spend, tech spend) per minute, driven from the existing flow panel numbers. Hidden when territory is off, as now, but shown on the default page once item 2 lands.
   - Owner: sonnet (`play/flow-panel.mjs`, `play/hud.mjs`).
   - Done when: during a default match a first-timer can see what fraction of the last minute went to workers and buildings, to the army and to research, and the bar moves when they change their build.

5. **Teach the expansion step in the first three minutes** (loop step 1e: gather, spend, build, fight, expand, repeat).
   - What: the teaching hints in `play/teach.mjs` gain one line that points at the first Reach to claim (the Natural), shown once the Main has a finished Totem or Mound option. The built-in AI already claims Reaches (`players/builtin/ai.mjs`), so the player sees the same move the AI makes.
   - Owner: sonnet (`play/teach.mjs`).
   - Done when: a fresh player in a 3-minute test run reads the Natural hint and claims a Reach without outside help (haiku's newcomer playtest format, #377).

## Notes for the Council

- Items 1 and 2 are the same blockers as FANATICS.md #1 and #2. This audit does not add a new priority; it confirms them against the loop.
- The built-in AI's claim logic was checked by grep only. Whether it claims on the default page depends on item 2.
- No code was changed for this audit.
