# Atom audit 04: Supply (population)

Auditor: haiku. Section 4 of research/STARCRAFT-ATOMS.md only. Checked against NORTHSTAR.md, TERRITORY.md sections 3, 9 and 10, and these files: env/commands.mjs (train rejects), env/stats.mjs (match.unitCap, upkeep table), env/budget.mjs (upkeep, debt, no cap when on), env/sim-territory.mjs (budget training), env/live.mjs (live link), play/hud.mjs and play/app.mjs (top strip), play/input.mjs (client pre-check and toast), play/flow-panel.mjs and play/territory-hud.mjs (flow panel, not on the live page yet).

Important context: the **live page still runs the classic match** (`createMatch`, no `territory:true`, per sonnet's #413). So the live game has a hard 40-unit cap today. The territory budget (no cap, upkeep, debt) exists in env/ and play/ but is OFF on the live page until env/live.mjs gets `territory:true`.

## Verdict table

| # | Line from section 4 | Driftfall today (file:line) | Verdict | Why |
|---|---|---|---|---|
| 1 | Every unit costs supply; total supply is capped | Every unit (workers included) counts 1 against `STATS.match.unitCap = 40`, queued units too (env/commands.mjs:102, :119-122; env/stats.mjs:98). | HAVE | Equivalent exists in classic mode. The cost is a flat 1 per unit, not a per-unit weight. |
| 2 | You raise the cap by building supply structures or units | Nothing raises the cap. The depot is a drop-off point (env/stats.mjs:250, play/teach.mjs:17), not supply. | NOT FOR US | TERRITORY section 9 replaces the cap with upkeep on purpose ("No supply cap... Quarters are removed"). A cap-raising building would bring back the thing we chose to remove. Caveat: until the territory economy is the live default, the live game has no way to grow the cap. |
| 3 | Max supply is 200 per player | Cap is 40 in classic mode. No cap at all when the budget is on (env/budget.mjs:55, `unitCapApplies`). | NOT FOR US | The number is another game's scale. The principle (a ceiling on army size) is covered by upkeep and debt. |
| 4 | Supply-blocked halts production, a classic mistake | Training rejects with `unit-cap` (env/commands.mjs:102). The HUD counter turns warn-coloured at the cap (play/hud.mjs:63-68). A toast says "Unit cap reached" (play/input.mjs:303). | HAVE (classic mode) | The trap exists and is visible at the moment of the block. With the budget on, training never stalls for supply or money (TERRITORY section 9), so the trap is removed by design. |
| 5 | Supply buildings double as other things | No supply structure exists. The claim structures do double duty: the Totem claims land, and the Mound also lowers army upkeep 2% each (TERRITORY section 3, section 9; stats.mjs upkeep block). | PARTIAL | We have the design principle through claim structures, but they are not in the live game (territory off) and the discount has no on-screen readout. |
| 6 | Supply count is shorthand for game state ("20 supply", "200/200") | Top strip: `Supply used/cap` (play/app.mjs:632, :598; play/hud.mjs:68). Territory's shorthand, net upkeep per minute and bank, is in play/flow-panel.mjs and play/territory-hud.mjs. | HAVE (classic) / PARTIAL (territory) | The classic "x/40" shorthand is on screen today. The territory flow line is built and tested but not wired to the live page. |
| 7 | Army supply vs worker supply split is a core macro decision | Classic: workers and army share one pool of 40 and nothing splits them on screen. Territory: workers are the only unit exempt from upkeep (env/budget.mjs NO_UPKEEP; stats.mjs `upkeep.exempt: ["worker"]`), which makes the split a real choice. | PARTIAL | The decision exists only in territory mode, and no HUD shows the split. |

Count: **HAVE 3** (rows 1, 4, 6, all in classic mode), **PARTIAL 2** (rows 5, 7), **MISSING 0**, **NOT FOR US 2** (rows 2, 3). The territory half of row 6 is wired only in the flow panel, which is not on the live page yet.

Note: no row is MISSING. The biggest gap is not a missing idea but a missing wire: the territory supply model is built, and the live page still runs the classic cap.

## TOP 5 changes (ranked by how much they improve play)

**1. Make the no-cap army economy the live default (territory on).**
- What: `env/live.mjs` passes `territory:true` to `createTerritoryMatch` (with `reachLayoutV4()` on map v4). The live page then gets budget upkeep, debt and weary in place of the 40 cap.
- Owner: fable (env/live.mjs), then sonnet (play/app.mjs default flag). This is already on NORTHSTAR's top list (#413, #422), so I am only restating it for section 4.
- Done when: `createLiveMatch({territory:true}).state.budget` is set and a test shows a side training past 40 units with a positive bank. On the page, the flow panel shows upkeep per minute, and no "Unit cap reached" toast appears in a 15-minute match.

**2. Show the worker/army split and the cap count in the top strip.**
- What: classic: `Workers 18 · Army 22 · 40 cap`. Territory: `Workers free · Army −X S/min`. This makes the macro choice from row 7 readable without help.
- Owner: sonnet (play/hud.mjs and the top bar in play/app.mjs).
- Done when: a hud test asserts both numbers for a fixed state, and on the page Joshua can say which pool is which without asking.

**3. Warn before the cap, not at it.**
- What: at 36/40 the Supply counter turns amber and the alert line reads "Supply 36/40: 4 slots left". Today the warning only fires once the cap is hit (play/hud.mjs:68).
- Owner: sonnet (play/hud.mjs, play/app.mjs alert line).
- Done when: a test shows the amber class at 36 and not at 35, and the alert text appears once per crossing.

**4. Surface every refused train, not only the ones the client pre-check catches.**
- What: play/app.mjs never reads reject events (no `reject` handler in play/app.mjs or play/teach.mjs). Any sim-side refusal (for example `unit-cap` or `no-shards` on a command sent in the same tick) is silent. Map each reason to one toast: "Unit cap reached", "Not enough Shards", "Queue is full".
- Owner: sonnet (play/app.mjs), with fable confirming the reject event shape from env/commands.mjs.
- Done when: a test feeds a rejected `train` event and checks the toast text, and in a play session no refused train happens without a message.

**5. Show the upkeep discount when a Totem or Mound goes down.**
- What: placing a Mound shows "−2% army upkeep" in the flow panel and on the Reach's hover tooltip, so the double-duty building from row 5 is visible when it matters.
- Owner: sonnet (play/flow-panel.mjs, play/territory-hud.mjs), after item 1 lands.
- Done when: a flow-panel test shows the discount line after a Mound is complete, and on the page the upkeep figure drops by 2% when it completes.

## What I did not check

- I did not run the tests. This is a read-only audit; the claims are from reading the cited lines.
- I did not check the AI for cap handling. The AI uses the same sim commands, so it should get the same `unit-cap` rejects.
- The depot's drop-off role (row 5) is from env/stats.mjs:250 and play/teach.mjs:17 only.
