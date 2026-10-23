# Atom audit 05: Production

Scope: research/STARCRAFT-ATOMS.md section 5 only, checked against NORTHSTAR.md and TERRITORY.md sections 5, 6, 9, 14.
Files read: env/commands.mjs (train, build, stop), env/sim-territory.mjs (doBudgetTrain), env/economy.mjs (tickTraining,
spawn), env/budget.mjs (training draw), env/tiers.mjs (tier pause, research queue), env/stats.mjs (match.queueMax,
core/structures/units rows, tiers), env/items.mjs (Recall, by grep), play/input.mjs (queueTrain, rally, train card),
play/hud.mjs (selection panel), play/app.mjs (rally overlay), tests/commands-validation.test.mjs (queue-full, by grep).

Verdict key: HAVE = Driftfall already does an equivalent. PARTIAL = some of it exists, or it exists but is off on the
live page. MISSING = not there. NOT FOR US = deliberately not in Driftfall, with the reason.

## Verdict table

| # | Atom (section 5) | Verdict | Driftfall today (evidence) |
|---|---|---|---|
| 5.1 | Units come from specific buildings, each with a queue (5 per building) | HAVE | Core trains `worker`; Forge trains `grunt`, `lancer`, `brute` (env/stats.mjs:132, 137). Queue cap `STATS.match.queueMax = 5` (stats.mjs:99), enforced in env/commands.mjs:99 and env/sim-territory.mjs:132. Pinned by tests/commands-validation.test.mjs:183-197. |
| 5.2 | One unit at a time per building; more buildings = more output | HAVE | Only the queue head trains (env/economy.mjs:82-115). The live page's train card sends the order to the selected building with the shortest queue (play/input.mjs:292-304), so several Forges double output. |
| 5.3 | Build time is fixed per unit | HAVE | `trainTicks` per unit in stats.mjs:143-146 (worker 20, grunt 15, lancer 20, brute 40). In the budget mode the same ticks are used for the gradual cost draw (env/budget.mjs:148-164). |
| 5.4 | Rally points send new units to a spot, or to mine for workers | PARTIAL | Works on the live page only. The rally lives in the UI (`ui.rally`, play/input.mjs:253-256, 405-430), not in the sim, so it is not in replays, not in watch mode, and not used by AI sides. A unit gets the rally only if it spawns within 2 tiles of the building. Workers from the Core go to the nearest crystal by default. |
| 5.5 | Production structures can be built in numbers ("4 gate", "3 rax") | HAVE | `build` has no cap on the count of one kind (env/commands.mjs:74-91). Forge is the only military production building right now, so there is no variety yet (see 5.7). |
| 5.6 | Zerg larvae: a shared pool at hatcheries | NOT FOR US | A shared pool would break the per-building queue and the per-building Hold pause that TERRITORY.md section 5 relies on. Burrow already has its own identity through Mounds and claims. Revisit only if Burrow needs a production identity of its own. |
| 5.7 | Protoss warp-in at any powered location | NOT FOR US | Power-field placement is a Protoss signature. Driftfall has a Recall instead: a ranked unit returns from its Shed Skin at the Nest with its rank and items (TERRITORY.md section 14, env/items.mjs). That covers the "reinforce from anywhere" need without a new rule. |
| 5.8 | Terran add-ons: reactor (double queue), tech lab (advanced units) | PARTIAL | The tech-lab job is done by tier gates: tier 2 needs a Foundry or Sanctum plus Hold 3, tier 3 needs a Hangar plus Hold 6 (env/stats.mjs:198-212, env/tiers.mjs). But Foundry, Sanctum and Hangar are not in STATS.structures, so the building part is skipped and tier 2 and 3 are gated by Hold alone (tiers.mjs header). The reactor (a second queue slot per building) is MISSING: the queue is a flat 5 for every building. |
| 5.9 | Cancelling refunds most of the cost (and is exploited in tricks) | MISSING | There is no cancel or dequeue command. The command list is move, attack, gather, build, train, stop (env/commands.mjs:17-31), and the queue only shrinks when the head finishes. A misclick can't be undone. The cancel itself is missing, not just the refund. |

Also noted (not in section 5, but production-adjacent): the selection panel says "Training X (+n queued)" as text only. It has no progress bar or seconds left, even though the sim already holds `structure.training` (env/economy.mjs:90-93). See change 2.

## TOP 5 changes (ranked by how much they improve play)

**1. Cancel a queued unit, with a fair refund (MISSING, 5.9).**
- What to add, in Driftfall's terms: a `cancel` train command `{ type: 'cancel', building, index }`. Clicking a queue chip in the selection panel removes that unit. Refund rule: a unit still waiting in the queue is refunded in full. The head unit that has already started is refunded for the part not yet drawn. In the budget mode (TERRITORY.md section 9) nothing is charged up front, so cancelling just stops the draw and there is nothing to exploit. Shift-click on a chip removes the whole queue.
- Owner: fable for the command and the refund in env/commands.mjs and env/sim-territory.mjs (the budget draw is fable's, env/budget.mjs). Sonnet for the chip click in play/hud.mjs and play/input.mjs.
- Done when: (a) a test in a new tests/train-cancel.test.mjs covers a waiting unit refunded in full, a started head refunded for the undrawn part, and a finished unit not cancellable; (b) on the live page, clicking a queued chip removes it and the Shards shown go back up at once; (c) the anticheat suite still passes.

**2. Show the queue head's progress: a bar and seconds left (PARTIAL, 5.2 and 5.3 read-out).**
- What to add: in the selection panel, a thin bar under "Training X" that fills as `structure.training` counts down, with the seconds left as a number. Use the fixed train time from `trainTicks`. Keep the existing "(+n queued)" text.
- Owner: sonnet (play/hud.mjs; the data is already in the snapshot).
- Done when: a test in play/hud (or a new hud-train.test.mjs) checks the bar width and the seconds for a half-trained Grunt, and on Joshua's screen a new player can see when the next unit arrives without counting.

**3. Put Foundry, Sanctum and Hangar in the roster so tiers 2 and 3 need a building (PARTIAL, 5.8).**
- What to add: `foundry`, `sanctum` and `hangar` rows in STATS.structures (cost, hp, buildTicks, and `trains` lists for the tier 2 and 3 units, matching the unlock lists in stats.mjs:204-210). Then the existing `tierMet` check in env/tiers.mjs starts requiring a finished building as well as the Hold. Add them to the build card with hotkeys. Keep them behind territory mode so the non-territory page is unchanged.
- Owner: fable for the stats rows and the tier rules (env/stats.mjs, env/tiers.mjs); sonnet for the build card entries in play/input.mjs.
- Done when: in territory mode, tier 2 units are rejected with the tier reason until a Foundry or Sanctum is complete and Hold is 3, and a test in tests/sim-tiers-research.test.mjs pins it. The build card shows the three buildings with cost and hotkey.

**4. Move rally into the sim so AI sides, watch mode and replays get it (PARTIAL, 5.4).**
- What to add: a `rally` command that stores `{ type, x, y }` on the building (`building.rally`), with the same gather-for-workers and move-for-others rule as now. New units from that building get the order from the sim inside `tickTraining` (env/economy.mjs) when they spawn, with no 2-tile check. Keep the play/input.mjs overlay, but read the rally from the snapshot.
- Owner: fable for the command and the spawn order (env/commands.mjs, env/economy.mjs); sonnet for the input and overlay (play/input.mjs, play/app.mjs).
- Done when: a test in a new tests/rally.test.mjs shows a unit spawned by a rallied Forge walks to the point with no client involved, and a watch-mode AI sets a rally. The rally overlay still draws on the live page.

**5. Hotkey to jump to idle production (MISSING, production management).**
- What to add: a free key (proposed `.`) that selects the next complete building with an empty queue and centres the camera on it. Repeated presses cycle through them. The idle state is already shown as "Idle" in the selection panel (play/hud.mjs:87), so this only adds the way to find it. Not yet checked against a playtest.
- Owner: sonnet (play/input.mjs keys, play/app.mjs camera). No sim change.
- Done when: a test in play/input.test.mjs pins the cycle order (by id, skipping queued and incomplete buildings) and the camera moves to the chosen building on the live page.

## Notes for the Council

- Changes 1, 2 and 5 are wiring of existing state (queue, training ticks, selection), so they fit "wire, don't add" in NORTHSTAR.md.
- Change 3 changes the live tier rules once the buildings exist, so it must stay behind territory mode until the Foundry is built by the AI as well.
- Nothing in section 5 was copied: the Recall, the budget draw and the tier pauses are Driftfall's own rules.
