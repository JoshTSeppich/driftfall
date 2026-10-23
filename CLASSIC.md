# Driftfall Classic — Joshua's direction: "how fast and simple StarCraft 1 was — build basically that"

Driftfall stays ORIGINAL (our units, names, numbers and art; nothing copied from StarCraft). We copy the *principles*
that made the 1998 classic fast and simple. Everything below is a requirement unless the swarm agrees otherwise (AGREE).

## The principles
1. **It's played, not watched.** A human plays live against an AI in the browser. Replays/bot-vs-bot remain, but the
   main mode is: open the page, you're one side, the built-in AI is the other.
2. **Fast fixed clock.** The sim steps at 24 ticks per second (≈42 ms), deterministic, grid-based, integer-friendly.
   Input becomes commands applied on the next tick. A full match is about 10–15 minutes of real time.
3. **Few systems, each readable.** Two resources (Shards, Flux), Workers carrying small loads, a supply cap raised by
   building Quarters, about a dozen units with clear counters (the v3 roster), simple build/train queues.
4. **Cheap, readable graphics.** A fixed tilted camera (orthographic or narrow perspective) over the grid; edge-scroll,
   arrow keys and minimap clicks to move it; units drawn with instancing so 200 units hold 60 fps; big silhouettes,
   strong team colors, health bars, selection circles. Effects short and crisp, never clutter. No floating particles.
5. **Information is gameplay.** Fog of war (unexplored / explored / visible), sight ranges, high ground blocks sight from below.
6. **Lockstep + replays.** The same seed and commands give the same game; a replay is the command log (we already have this).

## The controls (the heart of it)
- Left-click select; drag a box to select up to 12 of your units; double-click selects all of that kind on screen.
- Right-click = smart command: on ground → move, on an enemy → attack, on a Shard/Flux → gather, on your site → build.
- A then click = attack-move; S = stop; H = hold position; Shift = queue orders.
- Ctrl+1..9 make control groups, 1..9 recall them, double-tap centers the camera.
- Building: select a Worker, press a building's hotkey, click to place (green/red footprint).
- Buildings: hotkeys to train; right-click sets a rally point.
- Minimap: click to move the camera, right-click to command.
- Space centers on the last alert ("under attack", "construction complete").

## How it plugs into what exists
- `env/` sim stays the source of truth. New: `env/live.mjs` — a real-time driver at 24 tps that takes queued player
  commands each tick and runs the AI side through the referee rules.
- `play/` (new) — the playable client: `play/index.html`, input → commands, selection, camera, fog rendering,
  reusing viewer3d's renderer pieces but with the Classic look rules above (fast, readable, instanced).
- The AI opponent is the best of the three player teams' bots (round-robin decides), with an "easy" setting.
