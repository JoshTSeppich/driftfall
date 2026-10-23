# Audit 14: Movement and pathing (sonnet)

Checked against: `env/movement.mjs` (one BFS step per tick, 4-direction, id order flips on odd ticks, wait-then-detour),
`env/path.mjs`, `env/reach-path.mjs` (Reach/gate corridor + A*), `env/combat.mjs`, `play/input.mjs` (spreadMove, amove,
hold, stop), `env/stats.mjs` (speed = ticks per step, only 1 or 2), `env/drift.mjs` (Flood). Read-only audit; no code changed.

## Verdicts

| Line in section 14 | Verdict | Evidence / reasoning |
|---|---|---|
| Click to move; units path around obstacles | HAVE | Move orders use BFS; rocks, crystals, structures block. Walled-off targets clear the order and log `blocked`. |
| Clunky pathing (bumps, stuck units) as charm | PARTIAL | We are clunky, but by accident, not by design: 4-direction steps, one unit per tile, wait-then-detour. No stuck rescue besides the detour, so head-on in a one-tile gap waits forever. Keep the charm, fix the deadlocks. |
| Flocking, smooth blob movement | MISSING | Every unit plans alone. A group ordered to one spot becomes a queue through chokes (spreadMove only picks different end tiles). NOT FOR US: true flocking. Lighter version wanted (see top 5). |
| Ground can't overlap; air can stack | PARTIAL | Ground exclusivity HAVE (`isFree`). No air units exist in movement, so air stacking MISSING; `stats.mjs` has only air upgrade tracks, no air movement class. |
| Body blocking by units and buildings | HAVE | Units and structures block tiles. Wall-in is possible. Needs a readable "stuck" signal for the player. |
| Narrow chokes make traffic jams | HAVE (rough) | Gates in the 128 map are tight and jams happen. No yield or swap rule, so jams last too long, especially when idle units park in a gate. |
| Speed differences (fast catches slow) | PARTIAL | Only speed 1 (every tick) and 2 (every other tick). Brute is the only slow kind. Fast is "1" so nothing is faster than a Worker. Sidewind (+50% speed) and Flood half-speed exist as upgrades, but the step model (integer ticks per step) cannot express 1.5x. No terrain speed (Mesa climb, mud). |
| Move-shot / stutter step | MISSING | Combat: an attack order hits only the target in range, and the movement phase steps the unit until in range. No weapon cooldown phase to move in, no "move and still shoot". Lancer (range 4) has nothing to kite with. Hold and attack-move exist in `play/input.mjs` but are a client layer on top of plain orders. |
| (implied) Attack-move, hold, stop, shift queue | HAVE | In `play/input.mjs` (plans, queue, `hold`). Orders are trustworthy per Council item 3. |
| (implied) Long-range routing on big maps | HAVE | `reach-path.mjs` two-step routing for 128+ maps. Perf budget already pinned by tests. |
| (implied) Rally and group spread | HAVE | `spreadTiles` and `assignTiles` fan the group over free tiles. |

## Top 5 changes (most improvement to how Driftfall plays first)

1. **Choke yield and swap (anti-deadlock).** In `stepMovement`, when a unit has waited two moving ticks and the blocker is
   an idle or same-owner unit with no order, swap tiles with it (or push it one tile aside); a Rooted item (Ironroot Brace,
   already in stats) refuses the push. Why first: a stuck army at a gate loses fights and reads as a bug to a stranger.
   Owner: movement owner (whoever holds `env/movement.mjs`; ask in chat). Done when: a test with 12 units ordered through a
   one-tile gap all arrive in bounded ticks, head-on pairs resolve, and the sim-determinism test still passes.
2. **Group move at the slowest member's pace plus a staging tile.** On a multi-unit move or amove, `play/input.mjs` gives
   the group one shared speed class so Grunts do not arrive piecemeal ahead of Brutes and die alone. Cheap stand-in for
   flocking. Owner: input owner (play/). Done when: a 6 Grunt + 2 Brute amove across the 128 map arrives within a few tiles
   of each other (a test measuring spread at arrival) and the first-contact casualty split is more even.
3. **Weapon cooldown and move-shot.** Give units a short attack cooldown in `STATS` (original numbers) and let a unit with
   an attack-move or kite order step during cooldown. Lancers become worth microing and Council item 7 (unit identity)
   gets a verb. Owner: combat plus movement owners; stats table owner for numbers. Done when: a scripted lancer
   kiting a brute wins in a test while a stationary lancer loses, and the AI can still beat the built-in.
4. **Finer speed classes.** Replace "ticks per step 1 or 2" with a speed accumulator (e.g. 3 steps per 2 ticks) so we can
   have a genuinely fast scout, Sidewind +50% and Flood 0.5x. Must stay integer so determinism holds. Owner: movement
   owner plus stats owner. Done when: speeds 2/3, 1, 1/2 all appear in the table, a fast unit catches a slow one in a test,
   and the determinism fuzz stays green.
5. **Diagonal steps (8-direction) plus smoother draw.** BFS is 4-direction, so paths look like staircases and travel
   takes longer than it should. Allow diagonals when both side tiles are free, costing the same tick. Highest risk of the
   five (changes every replay), so last and behind a flag. Owner: path owner (`env/path.mjs`); renderer interpolates.
   Done when: path length across the map drops by a clear margin in a perf scenario and replays stay identical with the flag off.

Not recommended: true flocking and air units for v0.1 (no air roster yet; revisit with the tech tree).
