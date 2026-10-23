# Audit 15: Control and interface (sonnet)

Checked against play/input.mjs, play/app.mjs, play/camera.mjs, play/minimap.mjs, play/command-card.mjs, play/hud.mjs. Read only; nothing else edited.

| # | Atom | Verdict | Evidence / note |
|---|---|---|---|
| 1 | Click select; drag box select | HAVE | app.mjs mouseup: click under 5 px picks, else `boxSelect` |
| 2 | Selection cap (12 in the 1998 game) | HAVE | `MAX_SELECT = 12` (input.mjs:19). Fine for v0.1; revisit if armies exceed 40 |
| 3 | Shift-click add/remove | HAVE | `clickSelect` toggles own units; box with shift adds |
| 4 | Double-click selects all of that type on screen | HAVE (units only) | input.mjs:173. But app.mjs:399 swallows native dblclick, and it is based on timing of two picks, fine. Buildings excluded, so double-click a Barracks does nothing. Ctrl-click variant MISSING (minor) |
| 5 | Control groups, bind / recall / double-tap centre | PARTIAL | Keys 1-9 only, no 0; Ctrl (or Cmd) binds, double-tap centres. Missing: Shift+number to add to a group, a group badge on units/HUD, groups pruned silently when units die (ok) |
| 6 | Right-click smart command | PARTIAL | Move / attack / gather / rally exist (`rightClick`). Missing: right-click own damaged building = repair (no repair exists), right-click a Reach = claim, right-click a neutral camp = attack-move is only via target pick; cursor does not change to show what the click will do |
| 7 | Attack-move | HAVE | A then click, shift keeps mode armed |
| 8 | Stop / Hold / Patrol | PARTIAL | S and H have. Patrol MISSING (P is pause, and `p` is reserved) |
| 9 | Shift-queue | PARTIAL | Move/attack/amove queue. Build orders and train do not queue as waypoints; no on-screen path line showing the queue |
| 10 | Hotkeys for every action; grid layout | HAVE | 4x3 `GRID` in command-card.mjs, every button shows key + cost in tooltip. Check that tier-2/3 and Drift-era buttons (Recall, items, Track) all land on grid cells |
| 11 | Camera hotkeys / saved locations | MISSING | Only group-recall centres and Space-to-alert. No F-key camera slots |
| 12 | Jump to base | MISSING | No Home/H-style key. The opening-camera bug (off-base) shows why it matters; with 192/256 maps it is essential |
| 13 | Space jumps to last alert / cycle | PARTIAL | Space centres on the single latest alert (under attack, construction done). Does not cycle through the last few; alerts exist for only 2 events (no Drift warning, no Reach lost, no idle army, no Core hit) |
| 14 | Idle worker button | MISSING | TERRITORY section 14 lists it, nothing in code. Pairs with no-saturation economy |
| 15 | Select all army key | MISSING | Only box / double-click. One key is the biggest hand-saver in a 12-16 min match |
| 16 | Minimap: click moves camera, right-click commands, pings | PARTIAL | Click/drag and right-click command both exist (app.mjs:422). Pings MISSING (ANIMATION.md UI Motion already asks); no attack-alert flash on minimap; no Reach markers on live minimap beyond camps overlay |
| 17 | Edge scroll, arrow keys, middle-drag | HAVE | camera.mjs edgeVector, arrows, pointer-lock edge push, middle-drag panning. Wheel zoom + / - too |
| 18 | Command card shows abilities with hotkeys | HAVE | command-card.mjs; Shed Skin / Recall / item slots live in items-ui.mjs, not yet wired in live page |
| 19 | Tooltips: cost, time, description | PARTIAL | `tooltip()` gives cost + key + sentence; build time and "strong against" missing (see audits 08, 09) |
| 20 | Wireframe portraits show damage state | PARTIAL | Portrait + hp bar in selection panel; portrait itself does not crack/tint with damage |
| 21 | Portraits animate and talk | NOT FOR US (v0.1) | Static drawn portraits fit the art; barks via sound-player cover the "talk". Revisit in polish |
| 22 | Subgroup Tab in mixed selection | MISSING | Matters only once mixed armies of 3+ kinds exist; ranked troops and casters make it matter |
| 23 | Multi-building select to queue across buildings | PARTIAL | Train picks the building with the shortest queue (`queueTrain`) when several selected. Hotkey train from no selection ("train from anywhere") MISSING |
| 24 | Rapid-fire / repeat keys | NOT FOR US | Marginal for a browser game; hold-key repeat would also spam the command cap |
| + | Cancel a queued unit | MISSING | Cross-ref audit 05. Also no Esc-cancel of a build placement beyond mode Esc |
| + | Concede / pause menu | PARTIAL | P pauses; no concede (haiku audit 22) |

Tally: HAVE 7, PARTIAL 11, MISSING 6, NOT FOR US 2 (plus 2 extras).

## Top 5 changes (ranked by effect on how Driftfall plays)

1. **Jump keys: Home = my Core, F2-F4 = saved camera spots, Space cycles the last 5 alerts.**
   - Add: `Home`/`Backspace` centres on the player's main; Ctrl+F2..F4 saves, F2..F4 recalls; Space steps back through a ring of alerts instead of one. Add new alert kinds: Drift 30 s warning, Reach lost/contested, Core hit, army idle.
   - Owner: sonnet (play/input.mjs, app.mjs wiring); fable only if alert events need new sim events (`hold-lost`, `contested` already exist per TERRITORY.md).
   - Done when: a test feeds events and checks Space visits them newest to oldest; on `?map=large` Home lands within 3 tiles of the Core from any camera position; the opening camera test uses the same call.

2. **Idle Worker key + Select All Army key (and a visible count on the HUD).**
   - Add: `.` (or `,`) cycles idle Workers; `Ctrl+A`-free alternative `F1`/`Q`-free key chosen from unused grid keys selects every non-Worker unit, press again to centre. HUD chips show "3 idle" and "army 24" and are clickable.
   - Owner: sonnet (input.mjs + hud.mjs); haiku for tests of the idle definition (order === null, not carrying).
   - Done when: tests cover cycle order and wrap; with 40 units the key selects the 12-cap sensibly (see change 5); chips visible on the live page.

3. **Smart right-click that explains itself: cursor/ghost shows the verb, plus Reach claim and camp attack.**
   - Add: hover cursor tint and a one-word label (Move / Attack / Mine / Claim / Rally); right-click on a free Reach with Workers = go claim; right-click a neutral camp = attack-move (camps are marked per TERRITORY section 14). Click ping colours already exist; add the minimap ping (350 ms contracting diamond, pool of 32).
   - Owner: sonnet (input.mjs `rightClick`, app.mjs overlay, minimap.mjs); art cursors from fable's draw set.
   - Done when: `rightClick` unit tests return kind claim/attack/gather for those targets; Joshua right-clicks a camp and units go and fight without opening a menu; minimap pings show on an attack.

4. **Group power-ups: Shift+number adds, group 0, group badges, Ctrl-click and building double-click.**
   - Add: Shift+N appends selection to group N; 0 works; a small number badge on selected units' portraits and on the selection panel; double-click a building selects all of its kind (so all Barracks queue together); Ctrl-click = same as double-click for units.
   - Owner: sonnet (input.mjs); haiku checks.
   - Done when: tests for append / dedupe / prune-dead; double-click on Barracks selects all Barracks; train queues spread across them.

5. **Raise the selection cap and add Tab subgroups once armies are mixed (territory mode).**
   - Add: `MAX_SELECT` 12 -> 24 (data in stats.match, not a literal) for the no-supply-cap upkeep game; Tab cycles the focused kind, so the command card shows that kind's abilities (items, Recall, caster spells) while the whole group still moves. Highlighted tab row in the selection panel.
   - Owner: sonnet (input.mjs, hud.mjs); fable agrees the number (it is a balance lever: 12 forces micro, 24 forgives); haiku balance check.
   - Done when: a 20-unit mixed selection shows 3 tabs, Tab switches the card, a command still goes to all 20; cap read from STATS; no frame-time rise at 200 units (perf scenario).

Not in the top 5 but queued: Patrol (P is pause; move pause to Pause/F10 first), cancel queued unit (audit 05), build-queue waypoints, portrait damage tint, tooltips with build time and "strong vs" (audits 08/09).
