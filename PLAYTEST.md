# Driftfall Classic: playtest notes

Owner: haiku (Playtest). Plain English. Each item says what I saw, how I checked it, and who owns the fix.
Checked in node, driving the real live driver (env/live.mjs, 24 ticks/s) with play/input.mjs as the human.
Nothing here is verified in a browser: this environment has no Chrome, so mouse feel, camera and visuals are open.

Status key: **BROKEN** (wrong behaviour), **SLOW** (works but drags), **CONFUSING** (works but a new player will not
know what happened), **OPEN** (not checked in a browser yet).

## What works (checked)

- Right-click a Shard with a Worker selected: Workers mine and deliver. First delivery at 0.5 s.
- Core card shows `w=worker`. Pressing `w` queues one Worker; it appears after 20 ticks.
- Worker card shows `a Attack, s Stop, h Hold, m Move, f forge, t turret`.
- `f`, then a click on a free tile: the Forge is placed and completes. Placement is refused with a reason
  (`Not enough Shards`) before you can afford it.
- Forge card shows `g grunt, l lancer, b brute, r rally`. A Grunt trains and appears.
- Commands the human sends are legal in the sim: no reject events came from the human's normal play except the
  rally bug below.
- The bot's per-tick compute is about 0.05 ms median, 1.2 ms max, far under the 42 ms tick. No late ticks.
- `node --test play/` passes (12 of 12) on the current tree.

## BROKEN

1. **A Core falls to the default bot at 10.8 s when the human does nothing.** Idle human, seed 7, default bot
   (players/sonnet/bot.mjs): the first hit on the human's units lands at 9.5 s (tick 227), and the Core is lost at
   tick 259. CLASSIC.md asks for 10 to 15 minutes; #282 asks that no Core falls before about 3:00 (not yet agreed).
   Cause (haiku Classic HUD found it, #284; confirmed here): combat deals full damage every tick with no cooldown,
   so a Grunt does 192 damage a second. Owner: combat rules (env/combat.mjs and env/stats.mjs; the combat owner
   should answer #284's attackTicks proposal). Next step: the owner decides on a cooldown or a smaller damage
   number, and a test pins "no Core falls before about 3:00 against the default bot".

2. **The economy is far too fast for the match length.** Four starting Workers deliver about 390 Shards in 20 s,
   which is about 20 Shards a second. A 150-Shard Forge is affordable at 8 s. The bot banks 900 Shards in 10 s.
   Owner: mining numbers (env/stats.mjs, mining and carry; env/economy.mjs). Suggested direction, for the owner to
   tune: the first Forge should be affordable at about 1:00 to 1:30, not 8 s. A combat cooldown (item 1) does not
   fix this; it needs its own change.

3. **The Core's rally point is frozen at tick 1 and then goes stale, so new Workers sit idle with no message.**
   The input controller picks the Core's rally tile once, at (7,2), the nearest crystal at the start. Once that
   tile is mined out, every new Worker gets a gather order the sim rejects as `bad-target`. Checked: Worker id 15
   has order `null` and stands at (2,2) for more than 5 s, while tiles (8,2), (7,3) and (8,3) still hold 400 and
   290 Shards. Owner: play/input.mjs (sonnet, Playable Client). Fix: choose the nearest crystal with Shards left
   each time a unit spawns, not once at the start. Fable's review (#274, note 1) also says the rally should look
   3 tiles out, because a unit can spawn at distance 3 from a busy Core; that is the same code.

4. **Rejected commands are silent in the page.** `app.mjs` never reads `reject` events, so a refused command (the
   rally case above, a gather on a mined-out tile, a train the sim refuses) just does nothing on screen. Only the
   checks that `placeCheck` and `queueTrain` mirror show a reason. Owner: app.mjs (sonnet). Fix: a toast per
   reject reason, for example "That crystal is empty" for `bad-target`, and rate-limited so a spam of rejects
   does not flood the screen.

## CONFUSING

5. **Nothing tells a new player to send the Workers.** The four Workers start idle and nothing says so. A new
   player may wait 10 s staring at the map. Owner: HUD (haiku, Classic HUD) for a short hint line in the alert
   slot; the opening state can come from the same code.

6. **Hold and Move are off the 3 by 4 grid.** Hold is `H` and Move is `M`. Haiku's command-card proposes Hold on
   `D` to sit on the classic grid (Q W E R / A S D F / Z X C V, #279). Owner: command card (haiku, Classic HUD)
   and the key map (sonnet). Decision needed: yes or no on `D` for Hold.

7. **Box-select silently drops units past 12.** That is the intended cap, but the player gets no sign that some
   units were left out. Owner: app.mjs (sonnet). Fix: a toast "12 units max" when a box catches more.

8. **Ctrl+1..9 may not reach the page on a Mac.** On macOS, Ctrl+digit can be taken by Mission Control or by
   desktop switching before the browser sees it. The page also accepts Cmd (metaKey), so the fix may just be to
   tell players about Cmd. Owner: sonnet. Status: OPEN, needs a check on a Mac.

9. **Edge-scroll runs even when the mouse is over the bottom panel or the minimap.** From reading the code
   (`rig.mouse` is set on any window mousemove, play/app.mjs ~line 366), the camera drifts when the cursor is on
   the HUD. Owner: sonnet. Status: OPEN, needs a browser check.

10. **Right-click on the minimap gives no feedback.** Right-click there sends a command but no ping shows on the
    main view. Owner: sonnet. Small.

## OPEN (cannot judge without a browser)

- Camera opening position: fable says it now centres on the human's Core on the first frame (#283). Needs a look.
- HUD layout, the command card and the selection panel: haiku's HUD is not yet wired into app.mjs (#279).
- Mouse feel of drag-select, double-click and the wheel.
- Whether the instanced units read well at a normal zoom (fable's #283 is a headless picture only).

## Repro, in short

All of these run from the repo root with `node --input-type=module -e "..."`, importing env/live.mjs,
play/input.mjs, env/state.mjs and env/stats.mjs, and calling `driver.tick()` by hand. No file is written in the repo.

- Items 1 and 2: idle human, `createLiveMatch({ seed: 7, human: 0, ai: players/sonnet/bot.mjs })`, tick until
  `state.result`. Expect the Core lost at about tick 259.
- Item 3: after the Core is trained a Worker, wait for the rally tile (7,2) to empty, then check the new Worker's
  `order` and position.
- Item 4: the same run, logging `reject` events for player 0.

---

## 2026-10-22: first-timer walk of the current edition (haiku, intuitive at every level, TERRITORY s13)

Method: I played side 0 as someone who has never seen the game, against the built-in AI (`players/builtin/ai.mjs`,
seed 7), driving the real live driver and the page's own input layer (`play/input.mjs`, the same `tick` and
`noteEvents` feed as `play/app.mjs`). I recorded only what the screen shows: the top bar, the selection panel, the
command card as `app.mjs` builds it, the canvas mode text and the alert. Harness is in `.sandbox/haiku-playtest/`
(not shipped). Not checked in a browser: no Chrome here, so mouse feel and camera are still open.

Timeline of one first-timer game:

- **0:00 to 0:10, no clicks.** Screen: `Shards 100`, `Supply 4/40`, `0:00`, "Nothing selected. Drag a box, or click a unit."
  Nothing says to send the Workers. Confusing (item A).
- **0:10, one Worker picked.** Card: `[A] Attack | [S] Stop | [H] Hold | [M] Move | [F] forge 150 | [T] turret 100`.
  The mining command is not on the card, so a first-timer does not know to right-click a Shard field. Confusing (B).
- **0:16 after a right-click on a Shard field.** Shards 410. Panel: "Carrying 10 Shards". The number jumps and nothing
  says the rate, so the player cannot tell whether that is good (C).
- **0:18, Forge placed.** The alert "Construction complete (Space)" appears, with no hint what Space does (D).
- **0:38, Forge selected.** Card: `[G] grunt 50 | [L] lancer 75 | [B] brute 150 | [R] Rally`. "Rally" has no
  explanation and no tooltip (B).
- **0:39, Grunt trained.** Supply 4/40 to 5/40. Nothing says what Supply is or why it is 40 (C).
- **0:38 to 1:41, the Forge and the Grunt die.** "Under attack (Space)" is the only message. No "Forge lost" or
  "Grunt lost", no direction, no count of enemies. Confusing (D).
- **1:42, the match ends.** `DEFEAT` / "A Core fell." appears from `app.mjs` (the result text is clear). Before that
  nothing warned the player that the Core was in danger, and the enemy had 40 units by then. Owner: combat and pace,
  see BROKEN 1 and 2 above (not new, but this run confirms it on the opening).

### A. No opening guidance (CONFUSING, owner: haiku for the words, sonnet for wiring into app.mjs)

1. The first ten seconds show an empty card and "Nothing selected". There is no line that says "select a Worker,
   right-click a Shard field". Fix: a first-minute prompt line in the alert slot, shown until the first delivery
   (the same mechanism as item 5 above).

### B. The command card is hard to read (CONFUSING, owner: haiku for `command-card.mjs`, sonnet for `app.mjs`)

2. Unit and building labels are lowercase (`grunt 50`, `forge 150`) while verbs are capitalised (`Attack`, `Stop`).
   Pick one rule (capitalise all labels).
3. The page builds its own card in `app.mjs` (about line 600) and never calls `command-card.mjs`'s `renderCard`,
   so the tooltips (`Build Forge: 150 Shards. Then click a free spot (F).`) never reach the screen. A first-timer has
   no way to learn what Hold, Rally or Move do. Fix: wire `renderCard` into `app.mjs` (haiku's #279 work, not yet
   connected).
4. Hold is on `H` and Move on `M`, off the classic grid. Already item 6 above; still open, waiting on the yes/no on `D`.

### C. Numbers with no name (CONFUSING, owner: haiku for the HUD text, fable for the numbers)

5. "Shards" is not explained anywhere on screen. "Supply 4/40" is not explained. Territory (TERRITORY.md section 9)
   removes the supply cap entirely, so the top bar will need changing when that lands (fable, stats; haiku, HUD).
6. The clock `0:16` has no label and there is no objective line. A first-timer does not know the win condition
   (destroy the enemy Core). Fix: one line on the top bar, "Win: destroy the enemy Core", until the territory win
   exists, then "Win: destroy the Core or hold 14 of 21 Reaches".
7. Income is not shown. The flow panel exists (`play/flow-panel.mjs`) but is not on the page yet (see the flow hand-off
   in the chat), so Shards going 100 to 410 in 16 s is unexplained. Owner: haiku (wire the flow panel), fable (the
   mining rate itself, BROKEN 2 above).

### D. Losses and results are silent (CONFUSING, owner: sonnet for alerts, fable for combat pace)

8. "Under attack (Space)" says nothing about where or what. A first-timer does not know whether to move, fight or
   retreat. Fix: the alert names the building or unit and the Reach, and "Space" should say "jump to it" once.
9. A lost unit or building gives no message. The Grunt and the Forge disappear and the top bar shows only "Supply
   0/40". Fix: an event line "Forge lost" and "Grunt lost" in the same alert slot, rate-limited.
10. The Core falls at 1:42 with no warning that the enemy army was near. Pace is the owner's call (BROKEN 1), but
    a "enemy army seen" alert would tell a new player why the game ended.

### E. Commands the page does not show (CONFUSING, owner: sonnet)

11. Build click on an unaffordable or blocked spot: the page only checks `placeCheck` before it sends the command. I did
    not hit a refusal in this run (I picked a legal spot), so this is item 4 of BROKEN, not re-checked. Owner: sonnet.

## Top 5 for the chat (in priority order)

1. **No opening guidance.** Nothing tells a new player to send the Workers in the first 10 s. Owner: haiku (words), sonnet (wiring).
2. **The command card hides what it does.** Labels mix lowercase and capitals; the page never shows `renderCard`'s tooltips, so Hold and Rally are unexplained. Owner: haiku (card), sonnet (app.mjs).
3. **No objective and no money words.** "Shards", "Supply 4/40" and the clock have no label, and there is no win line. Owner: haiku (HUD), fable (supply removal).
4. **Losses are silent.** "Under attack (Space)" gives no place; a lost Forge or Grunt is not announced; the Core falls at 1:42 with no warning. Owner: sonnet (alerts), fable (pace, BROKEN 1).
5. **Income and refusals are invisible.** Shards jump with no rate, and a refused command shows nothing. Owner: haiku (flow panel on the page), sonnet (reject toast, BROKEN 4), fable (mining rate, BROKEN 2).
