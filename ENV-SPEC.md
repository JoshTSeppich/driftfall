# Driftfall — environment spec (v2)

Agreed in the team chat by fable, sonnet and haiku. This file is the contract: if code and spec disagree, fix one of
them and say so in the chat. Numbers live in `env/stats.mjs`; this file explains them.

## 1. The game in one paragraph

Two sides fight on a small mirrored grid. Workers mine **Shards** from crystal tiles and carry them to the **Core**.
Shards pay for buildings (**Forge**, **Turret**) and units (**Worker**, **Grunt**, **Lancer**, **Brute**). You win by
destroying the enemy Core. If nobody has after 2000 ticks, the side with more total value wins.

## 2. Map

- Square grid, **32 × 32** tiles. Coordinates are integers, `x` to the right, `y` down, both from 0 to 31.
- Tile kinds: **open**, **rock** (never passable), **crystal** (never passable, holds Shards).
- The map is point-mirrored: whatever is at `(x, y)` for side 0 is at `(31 - x, 31 - y)` for side 1.
- Side 0 starts top-left, side 1 bottom-right. Starting layout for side 0 (side 1 is the mirror):
  - Core at `(3, 3)`.
  - Four Workers at `(4, 3)`, `(3, 4)`, `(4, 4)`, `(5, 5)`.
  - Home crystal field: four tiles `(7, 2)`, `(8, 2)`, `(7, 3)`, `(8, 3)`, each holding 400 Shards.
  - Side 0's contested field: `(12, 19)`, `(13, 19)`, `(12, 20)`, `(13, 20)`, 400 each. (Its mirror is side 1's.)
- Rocks come from the seed. The map generator makes a deterministic random stream from the seed (`makeRng(seed)` in
  `env/rng.mjs`, a tiny 32-bit mixer; never `Math.random`). It picks a tile, places a rock there **and** at its
  mirror, and keeps the pair only if: neither tile is already rock or crystal, neither is within distance 2 (see §6
  for distance) of any Core, starting Worker or crystal tile, and every open tile still connects to every other open
  tile. It stops after **24 pairs** (48 rocks) or 2000 attempts, whichever comes first.
- Same seed ⇒ identical map, always.

## 3. Resource: Shards

- Each side starts with **100** Shards. Shards are a per-side number, never negative.
- A Worker given a `gather` order on a crystal tile walks to a tile next to it, mines for **8 ticks**, picks up
  **10 Shards** (or whatever is left), walks back next to its own Core, delivers (Shards are credited instantly),
  then walks back to the same crystal tile and repeats. When that tile is empty it switches to the nearest crystal
  tile with Shards left (nearest by distance, ties by lower `y` then lower `x`); if none, it goes idle.
- Crystal tiles that reach 0 stay on the map as empty crystal tiles (still not passable).

## 4. Structures

| kind   | cost | hp   | build ticks | notes |
|--------|------|------|-------------|-------|
| core   | —    | 1000 | —           | One per side at start. Can't be built. Trains Workers. Accepts deliveries. |
| forge  | 150  | 400  | 40          | Trains Grunt, Lancer, Brute. |
| turret | 100  | 150  | 30          | Attacks automatically once complete: damage 12, range 5. |

- Every structure occupies exactly one tile and blocks movement.
- **Building:** a Worker gets a `build` order for a kind and a tile. The tile must be open and empty (no rock,
  crystal, unit or structure). The cost is paid when the command is accepted and a **site** appears on the tile at
  once with `hp = 1`, `progress = 0`. Each tick, if at least one own Worker with a `build` order for that site is
  adjacent, `progress` rises by 1 and `hp` rises by `round(maxHp / buildTicks)` (capped at maxHp). Only one Worker
  counts per tick; extra Workers don't speed it up. When `progress` reaches `buildTicks` the structure is complete
  and the Workers' orders clear. A site counts as a structure for attack orders and Turrets; if its hp hits 0 it is
  destroyed and nothing is refunded.
- **Training:** a `train` command on a complete Core (Workers only) or Forge (combat units only) pays the cost and
  adds the kind to that building's queue (max **5** waiting). The front item counts down one tick at a time. When it
  reaches 0 the unit appears on the nearest free tile around the building (search distance 1, then 2, then 3; within
  a distance, lower `y` first, then lower `x`). If no free tile exists within distance 3 the unit waits in the queue.
- **Unit cap:** each side may have at most **40** units. A `train` command is rejected if living units plus queued
  units would exceed 40.

## 5. Units

| kind   | cost | hp  | damage | range | speed | train ticks | role |
|--------|------|-----|--------|-------|-------|-------------|------|
| worker | 50   | 40  | 2      | 1     | 1     | 20          | Mines and builds. Fights only if ordered. |
| grunt  | 50   | 60  | 8      | 1     | 1     | 15          | Cheap melee. Wins by numbers. |
| lancer | 75   | 40  | 10     | 4     | 1     | 20          | Ranged. Beats Grunts (shoots them on the way in). Dies fast to Brutes. |
| brute  | 150  | 240 | 25     | 1     | 2     | 40          | Tank. Beats Grunts and Turrets (double damage to structures). Slow, so Lancers can keep away. |

- `speed` is **ticks per step**: speed 1 moves every tick, speed 2 (Brute) moves only on even ticks.
- Every unit occupies one tile. Two units never share a tile.
- Workers carry at most 10 Shards (`carrying`).
- Value of a unit or complete structure = its cost. Core = 0. Unfinished site = 0.

## 6. Distance, movement, paths

- **Distance** between two tiles is the larger of `|dx|` and `|dy|` (so range 1 covers all 8 neighbours;
  "adjacent" means distance 1).
- **Movement** is 4-directional (up, down, left, right), one tile per step.
- **Paths** come from breadth-first search in `env/path.mjs` over tiles that are not rock, crystal or structure.
  Units are ignored when planning. Neighbours are explored in the fixed order up, right, down, left, so the same
  question always gives the same path. If the goal itself is not passable (a crystal tile, a structure, an enemy
  unit's tile) the path ends on the nearest passable tile within the needed distance of the goal.
- **Each tick, units move one at a time in id order**: lowest id first on even ticks, highest id first on odd ticks
  (see §8 for why). A unit takes the first step of its path if that tile is free right now (rocks, crystals,
  structures and other units all block; a unit that already moved this tick counts at its new tile). If the tile
  is taken the unit just waits this tick. Paths are recomputed every tick, so a blocked unit will route around a
  standing one next tick.
- A `move` order ends when the unit stands on the target tile, or when the target is unreachable (order cleared, a
  `blocked` event is logged).
- Known limit, on purpose: because planning ignores units, two units meeting head-on in a one-tile-wide gap block
  each other until a player moves one of them away. Players are expected to handle this.

## 7. Fighting

- Who attacks: a unit with an `attack` order whose target is within range; **idle** combat units (Grunt, Lancer,
  Brute with no order) against the nearest enemy within range; complete Turrets against the nearest enemy within
  range. Workers never attack unless ordered. Units with `move`, `gather` or `build` orders never attack.
  "Nearest" ties break by lower enemy id. **Idle units never move on their own**: they only hit what is already in
  range. To chase, a player gives an `attack` order.
- A unit with an `attack` order that is out of range walks toward the target (path to the nearest tile within
  range). The order clears when the target dies. Targets can be enemy units, structures or unfinished sites.
- Damage is flat: `damage` hp per attack, every tick, no cooldown, no armour, no randomness. A Brute deals double
  damage to structures (sites included).
- **All attacks in a tick are decided from the positions at the start of the combat phase, summed, then applied
  together.** So two units can kill each other in the same tick. Anything at 0 hp or below is removed at the end
  of the phase. Removed units drop their orders and queues; carried Shards are lost.
- Events: one `hit` per attack, in attacker id order, each carrying the target's hp **after all damage of the
  tick** (so three hits on one target all show the same final hp), then one `die` per removed entity, in id order.

## 8. One tick, in order

Starting from state at tick `t`, `step(state, [commands0, commands1])` produces tick `t + 1`:

1. **Commands.** One side's list, then the other's. Each command is checked (§10); legal ones take effect (orders
   set, Shards spent, sites placed, queues extended); illegal ones are ignored and a `reject` event is logged. At
   most **100 commands** per side per tick; extras are rejected as `too-many`.
2. **Production.** Training queues tick down and spawn; construction sites progress. Entities are visited in id
   order.
3. **Gathering.** Workers next to their crystal tile count mining ticks and pick up; Workers next to their Core
   deliver; empty tiles cause retargeting. Visited in id order.
4. **Movement.** In id order, as in §6.
5. **Combat.** As in §7 (simultaneous, so order doesn't matter).
6. **Tick ends.** `tick` becomes `t + 1`, then the end check (§9).

**Fairness rule:** on **even** ticks `t` (the tick being computed is `t + 1`), side 0 goes first and ids run lowest
first. On **odd** ticks side 1 goes first and ids run highest first. This applies to every "in side order" or "in id
order" step above (commands, production, gathering, movement), so neither side gets a standing edge in contested
tiles or spawn spots. Event order inside a tick follows the same visiting order.

The simulation has **no clock**: no timers, no sleeping, no dates. Tests run it as fast as the CPU allows.

## 9. Match end

Checked at the end of every tick, in this order:

1. Both Cores destroyed this tick ⇒ **draw**, reason `both-cores`.
2. One Core destroyed ⇒ the other side **wins**, reason `core`.
3. `tick` reached **2000** ⇒ compare **value** = Shards + cost of living units + cost of complete structures.
   Higher wins, reason `timeout`. Exactly equal ⇒ draw, reason `timeout`.
4. Referee only: a side can also lose by **forfeit** (§11).

The result is `{ winner: 0 | 1 | null, reason, tick, value: [v0, v1] }`.

## 10. Player API

A player is an ES module that exports `createPlayer({ side, seed, stats })` and returns
`{ name: string, act(observation) => commands[] }`. `act` may be sync or return a promise.

**Observation** (a fresh deep copy each tick; mutating it changes nothing):
```
{ tick, you: 0|1, width, height,
  rocks: [[x, y], ...],
  crystals: [{ x, y, amount }],
  shards: [s0, s1],
  units: [{ id, owner, kind, x, y, hp, carrying, order }],
  structures: [{ id, owner, kind, x, y, hp, progress, complete, queue: [kind, ...] }],
  unitCap: 40, maxTicks: 2000 }
```
There is no fog of war: both sides see everything.

**Commands** (each an object; unknown fields ignored):

| command | fields | legal when |
|---------|--------|------------|
| `move`   | `unit, x, y` | own living unit; tile inside map |
| `attack` | `unit, target` | own Grunt/Lancer/Brute/Worker; target is a living enemy unit, structure or unfinished site |
| `gather` | `unit, x, y` | own Worker; `(x, y)` is a crystal tile with Shards left |
| `build`  | `unit, kind, x, y` | own Worker; kind is `forge` or `turret`; tile open and empty; enough Shards |
| `train`  | `building, kind` | own complete Core (`worker`) or Forge (`grunt`/`lancer`/`brute`); queue < 5; enough Shards; unit cap not exceeded |
| `stop`   | `unit` | own living unit; clears its order |

A new order replaces the unit's old one. Rejected commands carry one of these reasons: `bad-command`, `not-yours`,
`no-such-unit`, `wrong-kind`, `off-map`, `tile-taken`, `no-shards`, `queue-full`, `unit-cap`, `bad-target`,
`not-complete`, `too-many`.

**Orders** as seen in observations: `null`, `{type:'move', x, y}`, `{type:'attack', target}`,
`{type:'gather', x, y, phase: 'toField'|'mining'|'toCore', ticks}`, `{type:'build', site}`.

## 11. Referee and limits

`env/referee.mjs` runs a match between two player modules:

- **Each player runs in its own worker thread** (`node:worker_threads`), so the referee can cut off a player that
  never answers. The referee sends the observation as a message and waits for the commands message back.
- Each tick it asks side 0 and side 1 for commands with their observations, measures wall-clock time from send to
  reply, then calls `step`. Think limit is **50 ms** per tick. If the reply takes longer, that side's commands for
  the tick are discarded (a `late` event with the time is logged) and the match continues. If `act` throws or
  returns something that is not an array, the side's commands are empty for that tick (`error` event).
- If no reply has arrived after **1000 ms**, the worker is terminated and that side **forfeits** (reason `forfeit`).
  A player that has thrown on **50** ticks in total also forfeits. A player module that fails to load forfeits at
  tick 0.
- Players are loaded by file path. `node env/run-match.mjs --seed 7 --p0 players/a.mjs --p1 players/b.mjs
  --out match.json` runs one match and writes the log and prints the result.
- The referee never changes the rules; it only feeds commands in and records what the simulation reports.

## 12. Match log

One JSON file, written by `env/log.mjs`:
```
{ format: 'driftfall-log', version: 1, seed, players: [name0, name1], stats: {...stats table...},
  initial: <full state at tick 0, as in the observation but without `you`>,
  ticks: [ { tick, commands: [cmds0, cmds1], events: [...] }, ... ],
  result: { winner, reason, tick, value: [v0, v1] },
  timing: [ [ms0, ms1], ... ] }
```

`timing` (one pair per tick, wall-clock milliseconds) is the only part of the log that may differ between two
runs of the same match. Everything else is deterministic. `late`, `error` and `forfeit` events live in `events`
because they change what happened; they carry no millisecond numbers (the number is in `timing`).

Events, one object each, with `e` naming the kind. Together they are enough to rebuild the state tick by tick
without re-running the simulation. **Replay promises** to reproduce: every entity's id, owner, kind, tile, hp and
`carrying`; structure `progress`, `complete` and `queue`; both sides' Shards; every crystal tile's amount. It does
**not** promise order details (the `order` event is best-effort and fires only when an order is set or cleared,
never on phase changes inside a gather order).

| event | fields |
|-------|--------|
| `spawn` | `unit: {...}` or `structure: {...}` (full record) |
| `move` | `id, x, y` (new tile) |
| `hit` | `id, by, dmg, hp` (hp after all damage of the tick, see §7) |
| `die` | `id` |
| `mine` | `id, x, y, amount, left` (fires once per load picked up, not per mining tick; `left` = tile's Shards after) |
| `deliver` | `id, amount, shards` (side's Shards after) |
| `spend` | `player, amount, shards` |
| `progress` | `id, progress, hp` |
| `done` | `id` (structure complete) |
| `queue` | `id, queue` (new queue) |
| `order` | `id, order` (new order, may be null; best-effort, see above) |
| `blocked` | `id` |
| `reject` | `player, command, reason` |
| `late` | `player` (commands discarded this tick) |
| `error` | `player, message` |
| `forfeit` | `player, reason` (`timeout`, `errors` or `load`) |

`viewer/replay.mjs` exports `applyTick(state, tickEntry)` and `replayTo(log, tick)`; it is a pure module with no
DOM so tests can run it in node. `viewer/index.html` loads a log file, draws the grid on a canvas and offers
play, pause, step and scrub, with a side panel showing Shards, value and unit counts.

## 13. Determinism rules (everyone follows these)

- No `Math.random`, `Date`, timers or async inside `env/*` except `referee.mjs`.
- Iterate units and structures in **id order**; never rely on object key order or `Set` iteration.
- Ids are shared by units and structures, start at 1 and only go up (Core 0 = 1, Core 1 = 2, then side 0's Workers
  3–6, side 1's Workers 7–10).
- Two matches with the same seed and the same two players must give byte-identical logs once the `timing` field
  is removed (`JSON.stringify` of everything else).
- Where the spec says "in id order" or "side order", the odd-tick reversal in §8 applies.

## 14. Module interfaces (so we can build in parallel)

| file | exports |
|------|---------|
| `env/rng.mjs` | `makeRng(seed) -> rng`; `rng()` float in [0,1), `rng.int(n)` integer in [0,n) |
| `env/map.mjs` | `generateMap(seed) -> { width, height, rocks: [[x,y]], crystals: [{x,y,amount}], cores: [{x,y},{x,y}], workers: [[{x,y}×4],[{x,y}×4]] }`, `mirror(x, y)`, `isConnected(map)` |
| `env/path.mjs` | `findPath({ width, height, blocked(x,y) }, from, to, { within = 0 }) -> [{x,y},...] or null` (steps only, start excluded) |
| `env/stats.mjs` | `STATS` (every number in §3–§5, §11), `UNIT_KINDS`, `STRUCTURE_KINDS`, `valueOf(entity)`, `sideValue(state, player)` |
| `env/state.mjs` | `createInitialState(seed)`, `createTestState({ width, height, rocks, crystals, shards, units, structures })`, `findEntity(state, id)`, `unitsOf(state, player)`, `structuresOf(state, player)`, `isPassable(state, x, y)` (ignores units), `isFree(state, x, y)` (also checks units), `distance(a, b)`, `allocId(state)`, `emit(state, event)`, `observe(state, player)` |
| `env/commands.mjs` | `applyCommands(state, player, commands)` |
| `env/economy.mjs` | `stepProduction(state)`, `stepGathering(state)` |
| `env/movement.mjs` | `stepMovement(state)`, `destinationOf(state, unit)` |
| `env/combat.mjs` | `stepCombat(state)`, `chooseTarget(state, attacker)` |
| `env/sim.mjs` | `createMatch(seed) -> state`, `step(state, [cmds0, cmds1]) -> events`, `checkEnd(state) -> result or null` |
| `env/referee.mjs` | `runMatch({ seed, players: [path0, path1], thinkMs, hardMs, maxTicks }) -> Promise<{ log, result }>`; `env/player-worker.mjs` is the worker-thread wrapper that loads a player module and answers observation messages |
| `env/log.mjs` | `createLog({ seed, players, stats, initial })`, `appendTick(log, { tick, commands, events }, timing)`, `finishLog(log, result)`, `validateLog(log) -> string[]` (empty when valid), `comparable(log)` (the log without `timing`) |
| `viewer/replay.mjs` | `applyTick(state, tickEntry)`, `replayTo(log, tick)` |

State shape (what `createInitialState` returns and every `step*` function mutates in place):
```
{ tick, seed, width, height, rocks: [[x,y]], rockSet: Set('x,y'), crystals: [{x,y,amount}],
  shards: [s0, s1], nextId, units: [...], structures: [...], events: [], result: null }
```
`events` is cleared at the start of each `step` and returned at the end. `rockSet` is a cache; `rocks` is truth.
