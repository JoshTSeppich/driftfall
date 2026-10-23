# Atom audit 16: Mechanics and skill (APM) (haiku)

Scope: research/STARCRAFT-ATOMS.md section 16 only, checked against NORTHSTAR.md and TERRITORY.md sections 13 (scope
and feel) and 14 (items). Read only; nothing else edited.

Files read (by grep and targeted reads): play/input.mjs (selection, control groups, orders, plans, keys, alerts),
play/command-card.mjs, play/hud.mjs, play/teach.mjs (idle workers, alert stack, grid audit), play/app.mjs (imports,
key handling, what is wired), play/items-ui.mjs, play/flow-panel.mjs, play/minimap.mjs (by grep), env/commands.mjs,
env/combat.mjs, env/items.mjs (Recall), env/economy.mjs (Drills, Siphons, Tracks, Presses by grep), env/stats.mjs
(queueMax, unitCap, maxCommandsPerTick), env/live.mjs (which match the page runs). Cross-checked with audits 07
(tech tree) and 15 (control and interface) so the verdicts agree.

**Key fact for this section:** the live page runs `createLiveMatch` → `createMatch` (env/live.mjs:31, 137). The
territory match (env/sim-territory.mjs) is not called by the page. So macro features that live only in territory
mode (Reaches, upkeep, the Trading House) are not on Joshua's screen yet.

Verdict key: HAVE = Driftfall already does an equivalent, on the live page. PARTIAL = some of it exists, or it exists
in code and tests but is not on the live page. MISSING = not there. NOT FOR US = deliberately not in Driftfall, with
the reason.

## Verdict table

| # | Atom (section 16) | Verdict | Driftfall today (evidence) |
|---|---|---|---|
| 16.1 | APM as a measure of mechanical speed (pros 250–400+) | NOT FOR US | Speed of hands is not the goal. NORTHSTAR asks for "a stranger ... understands everything without help" and a one-click start, and Joshua asked for "intuitive at every level" (TERRITORY s13). A 400-APM ceiling works against both. We do not count actions anywhere (no APM counter in env/log.mjs or play/). If we want it for playtests, that is a measurement, not a game rule. |
| 16.2 | Macro: constant production (keep every building busy) | PARTIAL | Each building queues up to 5 (`queueMax: 5`, env/stats.mjs:99); `queueTrain` picks the shortest queue (play/input.mjs:295); a full queue says "Queue is full" (input.mjs:302). Nothing repeats a train on its own, so an idle Core is the player's mistake, and the page never says so (see 16.6). |
| 16.3 | Macro: spending (keep the bank moving) | PARTIAL | The top bar shows Shards (play/app.mjs:632). The flow panel with income, upkeep, bank and Debt (play/flow-panel.mjs) is built and tested but `app.mjs` does not import it. No nudge says "you have 400 Shards and an idle Core". |
| 16.4 | Macro: supply (population) | HAVE | Classic page shows `Supply used/cap` and turns warn-coloured at the cap (play/hud.mjs:68), counting queued units (hud.mjs:62, env/commands.mjs `sideUnitCount`). The cap is 40 (`unitCap`). Territory's no-cap upkeep is not on the page (see 16.5). |
| 16.5 | Macro: expansions | PARTIAL | Reaches, claims and holds exist in env/territory.mjs and play/reach-view.mjs. The live page runs the classic match, so no expansion step is on screen (audit 07 says the same for tiers). |
| 16.6 | Micro: focus fire | HAVE | One order goes to every selected unit with the same target (play/input.mjs `give`, attack branch in `rightClick`, line 237). Combat sums damage per target before applying it (env/combat.mjs step 2), so focus fire actually concentrates damage. |
| 16.7 | Micro: kiting and move-shot (shoot, then step back) | MISSING | A unit with an attack order hits every tick it is in range (env/combat.mjs `stepCombat`, no cooldown field). A move order cannot be shot "between" attacks, so retreat-and-shoot does nothing for a skilled hand. Same root cause as audits 08 and 09. |
| 16.8 | Micro: splitting (spread a group, avoid one tile) | HAVE | Group moves and rally spread units over free tiles around the click (`spreadTiles`, `assignTiles`, play/input.mjs:81, 99; `spreadMove`, line 248), so armies do not stack on one tile. Splitting damage between targets is manual: one attack order per unit. |
| 16.9 | Micro: spellcasting (targeted abilities) | MISSING | No targeted ability exists. The only "cast" is Recall (env/items.mjs:153, play/items-ui.mjs:53), an untargeted button that costs half the price and takes time. It shows the idea but not a target-and-time decision. |
| 16.10 | Multitasking: macro and micro in several places | PARTIAL | HAVE: control groups (1–9, Ctrl to set, double-tap to centre; play/input.mjs:195), minimap (play/app.mjs:472, 576), Shift-queue orders (input.mjs:220), rally points (input.mjs:253). PARTIAL: alerts. `key(' ')` jumps to the single latest alert (input.mjs:360). The stacked alert list with Shift-Space to walk back (play/teach.mjs `createAlerts`) and the idle-Worker key `.` (teach.mjs `nextIdleWorker`) are built and tested, but play/app.mjs imports neither. |
| 16.11 | Race-specific macro mechanics (inject larvae, chrono boost, MULEs) | MISSING | Nothing a player must time for a boost. Drills and Siphons fill buffers that Workers haul (env/economy.mjs), and Tracks move loads, but no button speeds any of it up. This is a design gap we can fill with an original Snakenator mechanic (see top 5, #5). |
| 16.12 | "Spend your money" as the first rule of improvement | PARTIAL | Same evidence as 16.3. The coach only pushes training and building in the first minute (play/teach.mjs coach steps, `show` conditions). After that nothing reminds the player that money sitting idle is lost value. |
| 16.13 | Build-order execution timing to the second | MISSING | The sim runs on ticks at 24 tps and the clock is on the top bar (play/app.mjs:632), but the page shows no build timer, no "time since this started" and no target timings from TERRITORY s7. A player cannot see whether they are on time. |
| 16.14 | Mechanical difficulty as a deliberate skill ceiling | NOT FOR US | Raw click difficulty would fight NORTHSTAR's "one click to start" and the Council's rule for a readable game (FANATICS.md). We put the skill ceiling in decisions instead: Drift timing (TERRITORY s4), claim and hold of Reaches, and when to spend. Those already exist as design; see 16.3 and 16.5. |

## TOP 5 changes (ranked by how much they improve how Driftfall plays)

**1. Wire the alert stack and the idle-Worker key onto the live page.**
- What: in play/app.mjs, use `createAlerts` (play/teach.mjs) for the alert line, so Space jumps to the newest alert
  and Shift-Space walks back through the older ones. Bind `.` to `nextIdleWorker` (teach.mjs) so an idle Worker is one
  key away. Keep today's `key(' ')` behaviour as the fallback until the wiring lands.
- Owner: sonnet (play/app.mjs and play/teach.mjs are the Classic play team's files). haiku can add the alert text to
  the top bar if asked.
- Done when: a test in play/teach.test.mjs or play/app.test.mjs drives the page's key handler; with two alerts 10 s
  apart, Space selects the newer one's camera centre and Shift-Space the older; with an idle Worker, `.` selects it.
  On Joshua's screen: alerts can be walked through, and a stranger can find an idle Worker without a hunt.

**2. "Spend your money" nudge: show the bank and say what is idle.**
- What: put the flow panel's bank line (play/flow-panel.mjs, already built) into the top bar, next to Shards. When
  Shards are at least the cheapest unit's cost and an own Core or Forge has an empty queue for 10 s, show one short
  line under the bank: "Idle: 300 Shards. Press W to train a Worker." Once per 30 s at most.
- Owner: haiku for the top bar and the line (play/hud.mjs, play/flow-panel.mjs are Classic HUD files); sonnet
  for the wiring in play/app.mjs. fable confirms the threshold numbers in BALANCE.md.
- Done when: a unit test on the nudge function passes for "bank high, Core idle for 10 s" and stays silent when a
  queue is running; on Joshua's screen the top bar shows the bank and the nudge appears in a playtest that leaves
  the Core idle.

**3. Cancel a queued unit with a full refund (not the one in progress).**
- What: a new command `cancel-train` in env/commands.mjs: removes the last queued kind from a building's queue
  (never the first, which is already paid for and in progress) and refunds its Shards. Put a "Cancel last" button on
  the queue chips in the selection panel (play/hud.mjs chips, line 88) with the key X.
- Owner: fable (env/commands.mjs, Shard refund rule); sonnet (play/hud.mjs chip click and the X key in play/input.mjs).
- Done when: a sim test queues two units, cancels, and sees the Shards back and the queue at one; a cancel with an
  empty queue is a reject with a reason; on Joshua's screen the queue chips have a Cancel button and a refund shows
  in the top bar.

**4. Per-unit attack cooldown so micro (kiting, focus fire timing) has room to matter.**
- What: give each attack row a cooldown in ticks (env/stats.mjs) and track it on the unit in env/combat.mjs, so a
  unit that has just fired must wait. Then a unit can step back in that gap (move-shot), and focus fire timing is
  a choice. This is the same change audits 08 and 09 ask for; it is listed once here because it is the micro ceiling.
- Owner: fable (env/combat.mjs, env/stats.mjs); sonnet for the cooldown ring on the selection panel if wanted later.
- Done when: a sim test with a Lancer and a Grunt shows the Lancer hits at most once per cooldown and a retreat
  inside that window avoids a hit; the mirror win-rate test stays within 45–55% across seeds.

**5. Timed Molt boost on a Drill (an original macro mechanic, not a copy of inject or chrono).**
- What: a "Molt" button on a selected Drill: pay a fixed Shard cost, the Drill mines 50% faster for 20 s, then a 60 s
  cooldown shown on the button. Being in the right place at the right second is the skill ceiling for macro. The
  button sits on the fixed grid (play/command-card.mjs) with a plain sentence in play/teach.mjs.
- Owner: fable (env/economy.mjs boost, stats numbers); sonnet (button, timer text, grid placement); haiku checks the
  balance (the mirror test).
- Done when: a sim test shows a boosted Drill yields about 1.5× for 20 s and the cooldown blocks a second press; the
  button shows its timer on the page; the balance tester keeps mirror win rate in 45–55%.

## What Joshua can SEE or DO today that he could not before
Nothing new from this audit yet. This was an audit only; I edited only research/atom-audits/16-mechanics-and-skill-apm.md.
