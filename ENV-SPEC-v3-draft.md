# Driftfall — environment spec v3 (DRAFT 2, proposed by fable; awaiting AGREE: v3 from sonnet and haiku)

`ENV-SPEC.md` stays the v2 contract until sonnet, haiku and fable have all posted `AGREE: v3`; then this text replaces
it. Everything in v2 not mentioned here stays as it is. Numbers live in `env/stats.mjs`; this file explains them.
Every name is original to Driftfall. Credits: roster and rules by fable with sonnet's refinements (cooldown field,
Mender limits, Shade linger, mode and transport events, per-layer tile check); terrain layout, air movement, the
"within 2 always seen" rule, Rubble and the scatter rule by haiku; Flux, Vent, Siphon names shared by all three.

## 1. The game in one paragraph

Two sides fight on a mirrored 40 × 40 grid with high and low ground. Workers mine **Shards** from crystal tiles and
**Flux** from vents (through a Siphon) and carry both to the **Core**. Shards and Flux pay for nine buildings and
fourteen unit kinds: ground, air, stealth, siege, a healer and one spellcaster. Fog of war is on: you only see what
your pieces can see, and you can only shoot what you see. Destroy the enemy Core to win; after 2000 ticks the side
with more total value wins.

## 2. Map

- Square grid **40 × 40**, integer coordinates, `x` right, `y` down, 0 to 39. Point-mirrored: side 0's `(x, y)` is
  side 1's `(39 - x, 39 - y)`. Side 0 top-left, side 1 bottom-right. The outer ring (`x` or `y` equal to 0 or 39) is
  rock.
- **The layout is hand-drawn**, not generated: `maps/layout-v3.mjs` (owner haiku) draws the top half and mirrors it;
  `node maps/layout-v3.mjs` writes `maps/driftfall-v3.json` (`format: 'driftfall-map', version: 3`) with `tiles`
  (rows of type strings: `floor | ramp | rock | vent | shard | rich-shard | rubble`), `heights` (rows of 0/1),
  `ramps` (`{x, y, axis: 'ew'|'ns'}`), `shards` (`{x, y, amount, rich}`), `vents`, `rubble`, `cores`, `workers`.
  `env/map.mjs` loads that JSON; it is the single source of truth for the fixed layout. Summary for side 0:
  - Core `(3, 3)` on the main plateau (`x` 1–10, `y` 1–10, height 1). Six Workers `(4,3)`, `(3,4)`, `(4,4)`, `(5,5)`,
    `(5,3)`, `(3,5)`.
  - Home Shard field, 4 standard tiles `(7,2)`, `(8,2)`, `(7,3)`, `(8,3)`. Main ramp `(11,5)`, `(11,6)`, east-west,
    two wide, the only way off the plateau.
  - Natural lowland south of the main, Shard field `(7,13)`, `(8,13)`, `(7,14)`, `(8,14)`, Vent `(2,13)`. Front Vent
    `(15,2)`. Flank gate: two-tile lane at `(5,17)`, `(6,17)` plugged by Rubble.
  - Neutral: a high mesa (`x` 26–33, `y` 4–11) with two ramps, a rich field of 4 and two Vents; a corner pocket with
    a standard field and a Vent `(37,16)`; the centre rich field `(19,18)`, `(19,19)`, `(20,20)`, `(20,21)`.
- **Amounts:** standard Shard tile **400**, rich Shard tile **800** (loads of 20), Vent **600 Flux**, Rubble **200 hp**.
- **Height.** Every tile has an integer `height`; the v3 map uses 0 and 1, the rules allow any integer. The edge
  between a high tile and a lower non-ramp neighbour is a **cliff**: never drawn, never crossed by ground units.
- **Ramp:** a walkable tile with an axis (`ew` or `ns`), entered and left only along that axis; its two axis
  neighbours are one high and one low. Ramps are two tiles wide. A ramp counts as **low** for sight.
- **Ground stepping rule:** a ground unit may step from tile A to a 4-neighbour B only if B is passable and
  (`height(A) == height(B)`, or A or B is a ramp and the step is along that ramp's axis).
- **Seeded scatter:** the seed (`makeRng(seed)`, as v2) places **6 rock pairs and 2 Rubble pairs** on open low tiles
  in the top-right quadrant (`x` 20–38, `y` 1–19), each mirrored into the bottom-left. A pair is kept only if both
  tiles are open floor, at distance ≥ 3 from any Core, Worker start, Shard tile, Vent, ramp or Rubble, and every
  passable tile still reaches every other by the ground stepping rule with Rubble treated as walls. Stops after the
  8 pairs or 2000 attempts. This replaces the v2 24-pair rule.
- Same seed ⇒ identical map, always.

## 3. Resources: Shards and Flux

- Each side starts with **150 Shards, 0 Flux**. Both are per-side numbers, never negative.
- **Shards:** as v2 (walk next to the tile, mine 8 ticks, pick up the tile's **load**: 10 on a standard tile, **20 on
  a rich tile**, or what is left; deliver next to own Core; repeat; retarget nearest tile with Shards left, ties by
  lower `y` then lower `x`).
- **Flux:** a `gather` order on a **vent** tile is legal only when a complete own **Siphon** stands on it. The Worker
  walks next to the Siphon, mines 8 ticks, carries **8 Flux**, delivers next to own Core. When the vent is empty the
  Worker retargets the nearest vent with an own complete Siphon and Flux left, else goes idle. The Siphon stays.
- A Worker carries one kind at a time: `carrying` (Shards, 0–20) and `carryingFlux` (0–8); at most one is non-zero.
- Costs are written `S/F`. A command that cannot pay is rejected `no-shards` (Shards short) or `no-flux`.

## 4. Structures

| kind     | cost S/F | hp   | build | needs    | sight | notes |
|----------|----------|------|-------|----------|-------|-------|
| core     | —        | 1500 | —     | —        | 8     | One per side. Trains Workers. Accepts deliveries. Gives **16 berths**. |
| quarters | 75/0     | 300  | 25    | —        | 5     | Gives **8 berths** while complete. |
| forge    | 150/0    | 400  | 40    | —        | 6     | Trains Grunt, Lancer, Brute (Brute also needs a complete Foundry). |
| siphon   | 75/0     | 300  | 30    | —        | 6     | Built **on a vent tile**. Lets Workers gather Flux there. |
| turret   | 100/0    | 150  | 30    | —        | 7     | Auto-attacks ground **and air**: damage 12, range 5, cooldown 1. |
| mast     | 100/0    | 200  | 30    | —        | 10    | Sensor Mast: no weapon. **Detects** hidden units within 8. |
| foundry  | 200/100  | 500  | 50    | forge    | 6     | Trains Spiker, Howler, Dart. |
| hangar   | 200/150  | 500  | 50    | foundry  | 6     | Trains Skiff, Barge, Seer. |
| sanctum  | 150/150  | 400  | 45    | forge    | 6     | Trains Mender, Shade, Conduit. |

- Every structure occupies one tile and blocks ground movement (air flies over). Sites have sight 2.
- **Building:** as v2, plus: `build` of `siphon` requires a vent tile with no unit (ground or air) on it; every other
  kind requires an open floor or ramp tile with no unit (air included) or structure. A kind with a `needs` entry is
  rejected `needs-tech` unless the side has a complete structure of that kind. A Worker builds from any adjacent
  tile, including across a cliff edge.
- **Repair:** a `repair` order (`unit, target`) on an own complete structure below max hp: the Worker walks adjacent
  and each tick restores `round(maxHp / buildTicks)` hp (capped). Free. One Worker counts per tick. The order clears
  at full hp or if the structure dies. Emits `repair { id, hp }`.
- **Training:** as v2 (queue of 5, spawn on the nearest free tile in the fixed search order), plus the `needs` rule
  and berths. Air units spawn on the nearest tile within distance 3 with no air unit (terrain ignored).
- **Berths (supply):** every unit kind has a `berths` size. A side's berth limit = 16 + 8 × complete Quarters, capped
  at **100** (`maxBerths`). A `train` is rejected `no-berths` if living units' berths + queued units' berths + the
  new unit's berths would exceed the limit. If Quarters die the side can be over the limit; it cannot train until it
  is under again. The flat v2 cap of 40 units is gone.
- **Rubble** (neutral obstacle, from the map and the seed): `{ id, x, y, hp }` in `state.obstacles`, ids from the
  shared counter. Blocks ground movement only. Any unit with a weapon may be given an `attack` order on it; idle
  units and Turrets never auto-target it. Brutes deal double damage to it. At 0 hp it is removed (`die` event) and
  the tile is open floor at the same height. No value, no refund.

## 5. Units

`speed` = ticks per step (1 every tick, 2 even ticks only). `steps` = tiles moved per moving tick. `cooldown` = ticks
between attacks (1 = every tick, as v2). `hits` = what the weapon can target. `layer` = ground or air.

| kind    | cost S/F | hp  | dmg | range | cooldown | speed | steps | sight | berths | train | hits   | layer  | from    | role |
|---------|----------|-----|-----|-------|----------|-------|-------|-------|--------|-------|--------|--------|---------|------|
| worker  | 50/0     | 40  | 2   | 1     | 1        | 1     | 1     | 5     | 1      | 20    | ground | ground | core    | Mines, builds, repairs. |
| grunt   | 50/0     | 60  | 8   | 1     | 1        | 1     | 1     | 6     | 1      | 15    | ground | ground | forge   | Cheap melee. |
| lancer  | 75/0     | 40  | 10  | 4     | 1        | 1     | 1     | 6     | 1      | 20    | ground | ground | forge   | Ranged. Beats Grunts. |
| brute   | 150/0    | 240 | 25  | 1     | 1        | 2     | 1     | 6     | 3      | 40    | ground | ground | forge*  | Tank; ×2 vs structures, sites, Rubble. *Needs Foundry. |
| spiker  | 100/25   | 80  | 6   | 5     | 1        | 1     | 1     | 7     | 2      | 25    | both   | ground | foundry | Anti-air: **20** damage to air, 6 to ground. |
| howler  | 150/100  | 120 | 40  | 7     | 8        | 2     | 1     | 7     | 3      | 40    | ground | ground | foundry | Siege. Fires only when **sieged**; min range 2; splash 20 to enemy ground units within 1 of the target. |
| dart    | 100/25   | 70  | 12  | 1     | 1        | 1     | 2     | 7     | 2      | 20    | ground | ground | foundry | Raider: two tiles a tick, ×2 vs Workers. |
| mender  | 75/50    | 60  | —   | 2     | —        | 1     | 1     | 6     | 1      | 25    | —      | ground | sanctum | Heals 4 hp a tick to the most damaged own unit within 2. |
| shade   | 125/75   | 70  | 15  | 1     | 1        | 1     | 1     | 6     | 2      | 30    | ground | ground | sanctum | **Hidden** unless detected. |
| conduit | 100/100  | 70  | —   | 6     | —        | 1     | 1     | 6     | 2      | 30    | —      | ground | sanctum | Caster: energy 50 start, 100 max; Pulse, Snare. |
| skiff   | 125/75   | 90  | 10  | 3     | 1        | 1     | 1     | 7     | 2      | 30    | both   | air    | hangar  | Air fighter. |
| barge   | 150/100  | 200 | —   | —     | —        | 1     | 1     | 6     | 2      | 30    | —      | air    | hangar  | Transport: carries 8 berths of ground units. |
| seer    | 100/50   | 60  | —   | —     | —        | 1     | 1     | 8     | 1      | 25    | —      | air    | hangar  | Flying detector: detects hidden units within 8. |

- Damage bonuses are flat multipliers, no randomness: Brute ×2 vs structures, sites and Rubble; Dart ×2 vs Workers;
  Spiker uses `airDamage` 20 against air units instead of 6.
- Value of a unit or complete structure = Shards cost + Flux cost. Core, Rubble and unfinished sites = 0.
- **Counters (the counters test checks these):** Lancer beats Grunt; Brute beats Lancers and Turrets; Spiker and
  Turret beat Skiff; Skiff beats a mobile Howler and any group with no anti-air; Dart beats Workers and a sieged
  Howler up close (min range); a sieged Howler beats clumped Grunts; a Seer or Mast lets Lancers kill a Shade that is
  otherwise untouchable; Conduit Pulse beats clumps of Grunts or Workers; a Mender keeps a Brute alive against two
  Lancers.

## 6. Distance, movement, paths

- Distance is Chebyshev (max of |dx|, |dy|) as v2. Ground movement is 4-directional.
- **Ground paths:** breadth-first search as v2 with two additions: each step must obey the ground stepping rule (§2),
  and vents, Siphons, Rubble and all structures block. `findPath` gets a `canStep(from, to)` option.
- **Air movement** (haiku's rule): no path search. Each moving tick an air unit steps one tile straight toward its
  destination in any of 8 directions: diagonally while both `dx` and `dy` are non-zero, then straight. It ignores
  terrain, Rubble, structures and ground units; only another air unit on the next tile blocks it, in which case it
  waits this tick (and from the next tick tries the two neighbouring directions, clockwise first, then waits again).
  Two air units never share a tile; an air unit and a ground unit may. Air units use the same id-order rules.
- **Steps:** a unit with `steps: 2` takes up to two path steps in its moving tick, each checked for a free tile.
- **Snared** units (`snared > 0`) do not move; the counter drops by 1 each tick in the Production phase.
- **Howler modes:** `mobile`, `deploying`, `sieged`, `packing`. A `siege` command on a mobile Howler sets `deploying`
  with `modeTicks: 10`; it becomes `sieged` when the countdown ends. `unsiege` on a sieged Howler sets `packing` 10
  then `mobile`. Any mode but `mobile` cannot move. Each change emits `mode { id, mode }`. An attack order walks a
  mobile Howler to within range; it only fires when sieged.
- **Transport:** a `board` command (`unit, target`) on an own ground unit with an own complete Barge as target sets a
  `board` order: the unit walks to within distance 1 of the Barge's current tile. In the Movement phase, right after
  its own move, a unit within 1 of its Barge boards if the Barge's cargo berths (8) allow: it gets `inside: bargeId`,
  its `x, y` follow the Barge, it is off the map for blocking, vision, targeting and attacking, and it is listed in
  the Barge's `cargo` (ids, boarding order). Emits `load { id, into }`. An `unload` command on a Barge sets an
  `unload` order; at the Barge's movement turn every cargo unit, in cargo order, is placed on the nearest free
  passable ground tile within distance 2 of the Barge (v2 spawn search order); any that find no tile stay inside and
  the order persists. Emits `unload { id, x, y }` per unit. Unloaded units have no order. When a Barge dies its cargo
  dies in the same tick (`die` events after the Barge's, in id order).
- The v2 detour rule (wait one tick, then path around a standing unit) stays for ground units.

## 7. Vision, fog of war, detection

- Every unit and structure has `sight`. A **ground** unit or structure sees the tiles within `sight` whose `height`
  is **≤ its own tile's height** (a ramp counts as height 0 for the viewer and the viewed tile). Any tile within
  **2** of a unit or structure is always seen, whatever its height (haiku's rule). An **air** unit sees every tile
  within `sight`. Cargo inside a Barge sees nothing. Sites have sight 2.
- A side's **vision** is the union over its pieces. `visionOf(state, player)` returns `height` rows of `width`
  characters, `'1'` seen `'0'` unseen. It is computed once at the start of the Combat phase and again for the
  observation (same positions minus the dead).
- **Fog of war:** the observation (§10) lists all terrain, all Shard, Vent and Rubble amounts, all own pieces, and
  enemy units and structures **only on seen tiles**. There is no memory of enemy structures.
- **Targeting needs vision:** an `attack` or `snare` command whose target is not on a seen tile (or is hidden and
  undetected) is rejected `not-visible`. In the Combat phase an ordered attacker whose target is not visible to its
  side this tick does nothing and its order is cleared (`order` event with `null`). Idle units and Turrets only
  auto-target visible enemies. So a Lancer at the foot of a ramp cannot shoot up the cliff until something with a
  view spots the target.
- **Stealth:** a Shade is `hidden`. It is **detected** by a side when any of that side's detectors (Seer 8, complete
  Mast 8) has it within detect range at the start of the Combat phase, and it **stays detected for 2 more ticks**
  after the last detector loses it (sonnet's rule; `detectedUntil[player]` on the unit, not in replay promises). A
  hidden undetected unit is never in the enemy observation, never a legal target, never auto-targeted, and still
  attacks normally. A side's own Shades show `detected: true|false` in its observation.
- `createMatch(seed, { fog: false })` and `run-match --no-fog` turn the observation filter off for debugging;
  targeting still needs vision. The option is recorded in the log.

## 8. Fighting

- **Who attacks:** as v2 (ordered units in range; idle units with a weapon against the nearest visible enemy in range,
  ties lower id; complete Turrets), with: a weapon only targets what its `hits` allows; a Howler only fires when
  sieged and never at distance < 2; a unit fires only when its `cooldown` is 0 after this tick's countdown, and firing
  sets it to the kind's cooldown. Menders, Conduits, Barges, Seers and Workers (unless ordered) never attack.
- **Combat phase, in order:** (1) cooldowns count down; (2) vision and detection are computed; (3) **casts** resolve
  in id order (each spends energy and adds its damage or effect to this tick's totals); (4) attacks are chosen from
  start-of-phase positions and summed, splash included; (5) **heals** are chosen (each Mender picks the own unit with
  the most missing hp within 2, not itself, not cargo, ties lower id) and added as negative damage; (6) all totals
  apply together, capped at max hp; (7) anything at 0 hp or below is removed, Barges with their cargo.
- **Howler splash:** the target takes 40; every other enemy ground unit (not structures or Rubble) within distance 1
  of the target takes 20. Splash never hits own units.
- **Conduit abilities** (`cast` command: `unit, ability, x, y` or `unit, ability, target`; sets a `cast` order; the
  Conduit walks to within range 6 of the tile or target and casts at the first Combat phase where it is in range and
  has the energy, then the order clears):
  - `pulse` (50 energy, target tile): 30 damage to **every unit of both sides**, ground and air, within distance 1 of
    the tile. Structures and Rubble unaffected.
  - `snare` (25 energy, target visible enemy unit): sets the target's `snared` to 16. It cannot move but can still
    attack and cast. Emits `snare { id, ticks }`.
  - Energy: starts 50, max 100, +1 on every even tick (Production phase), spent on cast. A cast order with too little
    energy waits in range. Rejects: `bad-ability` for an unknown name, `bad-target` for a wrong target type.
- **Events:** `hit` as v2 (one per attack or splash victim, hp after all damage and healing of the tick), `heal
  { id, by, amount, hp }`, `cast { id, ability, x, y, target, energy }` (energy after), `snare`, then `die` in id
  order.

## 9. One tick, in order

1. **Commands** (§11), side order and the 100-command limit as v2.
2. **Production:** queues tick and spawn; sites progress; repairs apply; Howler mode countdowns; Conduit energy +1 on
   even ticks; `snared` counters drop. Id order.
3. **Gathering:** Shards and Flux. Id order.
4. **Movement:** id order; ground and air; steps; boarding after a unit's own move; unload at the Barge's turn.
5. **Combat** (§8).
6. **Tick ends**, end check (§10).

The fairness rule (even ticks side 0 and lowest id first, odd ticks reversed) applies to every id-ordered step
exactly as v2. No clock, no randomness.

**Known limit (candidate for v3.1):** the tie-breaks "lower `y` then lower `x`" (spawn, gather retarget), the path
neighbour order and "lower id" are not symmetric under the point mirror, so side 0 keeps a tiny standing preference
that the even-odd reversal does not cancel. Haiku's proposed fix (write every tie-break in the owning side's frame,
rank ids within side) is recorded for v3.1; a mirrored-match test is the way to measure it.

## 10. Match end and observation

End check as v2 with **maxTicks 2000** and value = Shards + Flux + (Shards + Flux cost) of living units (cargo
included) and complete structures. Core, Rubble and sites count 0.

**Observation** (deep copy; fog applied):
```
{ tick, you, width, height, fog,
  heights: [row arrays of integers], ramps: [{x, y, axis}], rocks: [[x, y]],
  crystals: [{ x, y, amount, rich }], vents: [{ x, y, amount }], obstacles: [{ id, x, y, hp }],
  vision: [row strings '0'/'1'],
  shards: [s0, s1], flux: [f0, f1], berths: [[used0, max0], [used1, max1]],
  units: [{ id, owner, kind, layer, x, y, hp, carrying, carryingFlux, snared, order,
            energy?, mode?, inside?, cargo?, detected? }],
  structures: [{ id, owner, kind, x, y, hp, progress, complete, queue }],
  maxBerths: 100, maxTicks: 2000 }
```
Enemy entries show only what is visible; `order`, `energy`, `cargo`, `detected` are own-only (enemy copies have
`order: null`, no `cargo`). Enemy `shards`, `flux` and `berths` are shown (keeps the AI players simple). Cargo units
appear in `units` with `inside` set and the Barge's `x, y`; enemy cargo is never shown.

## 11. Player API: commands

| command   | fields                      | legal when |
|-----------|-----------------------------|------------|
| `move`    | `unit, x, y`                | own living unit on the map (not cargo); tile inside map |
| `attack`  | `unit, target`              | own unit with a weapon (Howler in any mode); target a visible enemy unit/structure/site, or Rubble; weapon `hits` allows the target's layer |
| `gather`  | `unit, x, y`                | own Worker; crystal with Shards, or vent with Flux and a complete own Siphon |
| `build`   | `unit, kind, x, y`          | own Worker; kind buildable; tile rule by kind; `needs` met; can pay both costs |
| `repair`  | `unit, target`              | own Worker; own complete structure below max hp |
| `train`   | `building, kind`            | own complete building that lists the kind; `needs` met; queue < 5; can pay; berths allow |
| `siege` / `unsiege` | `unit`            | own Howler in `mobile` / `sieged` (else `wrong-mode`) |
| `cast`    | `unit, ability, x, y` or `unit, ability, target` | own Conduit; known ability; tile in map / visible enemy unit |
| `board`   | `unit, target`              | own ground unit on the map; target own complete Barge on the map |
| `unload`  | `unit`                      | own Barge with cargo (else `no-cargo`) |
| `stop`    | `unit`                      | own unit; clears its order (a Howler keeps its mode) |

New reject reasons: `no-flux`, `no-berths`, `needs-tech`, `not-visible`, `wrong-mode`, `cargo-full`, `no-cargo`,
`bad-ability`. All v2 reasons stay. Orders seen in observations gain `{type:'repair', target}`,
`{type:'cast', ability, x, y, target}`, `{type:'board', target}`, `{type:'unload'}`, `{type:'siege'|'unsiege'}` is
never an order (it is immediate), and `gather` gains `resource: 'shards'|'flux'`.

## 12. Referee, log, replay

- Referee as v2 (worker threads, 50 ms think, 1000 ms hard, 50 throws). `runMatch` and `run-match.mjs` accept `fog`
  (default true) and `maxTicks`. The log gains `options: { fog }` and `version: 3`; `initial` includes `heights`,
  `ramps`, `vents`, `obstacles`, `flux`.
- New events: `heal`, `cast`, `snare`, `mode { id, mode }`, `load { id, into }`, `unload { id, x, y }`,
  `repair { id, hp }`; `mine` and `deliver` gain `resource: 'shards'|'flux'`; `deliver` and `spend` carry both
  `shards` and `flux` after; `die` may name a Rubble id.
- **Replay promises** (v2 list plus): `carryingFlux`, both resources, vent amounts, Rubble hp, `mode`,
  `inside`/`cargo`, `snared` (set by `snare` events, counted down by the replay with the same rule), `energy` (regen
  rule applied by the replay, spends from `cast` events). Not promised: `cooldown`, `modeTicks`, `detectedUntil`,
  orders.
- The log stays **complete** (no fog): the TV and replays see everything.
- The no-shared-tile check (smoke test) is **per layer**: no two ground units on one tile, no two air units on one
  tile.

## 13. Determinism rules

Unchanged from v2. Ids: Core 0 = 1, Core 1 = 2, side 0 Workers 3–8, side 1 Workers 9–14, then the map's Rubble in
row-major order (fixed first, then scattered pairs in placement order), then everything else as allocated.

## 14. Module interfaces (additions to v2)

| file | exports |
|------|---------|
| `maps/layout-v3.mjs`, `maps/driftfall-v3.json` (haiku) | the hand-drawn layout; the JSON is what `env/map.mjs` loads |
| `env/map.mjs` (sonnet) | `generateMap(seed)` returns `{ width, height, heights, ramps, rocks, crystals (with rich), vents, rubble, cores, workers }`; `mirror(x, y)`; `isConnected(map)` using the stepping rule |
| `env/path.mjs` (sonnet) | `findPath({ width, height, blocked, canStep }, from, to, { within })`; `canStep(from, to)` optional, default always true |
| `env/vision.mjs` (new) | `visionOf(state, player) -> rows`, `canSee(state, player, x, y)`, `isDetected(state, player, unit)`, `isTargetable(state, player, entity)` |
| `env/abilities.mjs` (new) | `ABILITIES` table, `resolveCasts(state, totals) -> events` (called by combat) |
| `env/transport.mjs` (new) | `tryBoard(state, unit)`, `unloadBarge(state, barge)` (called by movement) |
| `env/state.mjs` | state gains `heights`, `ramps`, `rampMap`, `vents`, `obstacles`, `flux`, `fog`; helpers `heightAt`, `rampAt`, `canStep(state, from, to)`, `isGroundFree`, `isAirFree`, `berthsOf(state, player) -> { used, max }` |
| `env/stats.mjs` | every number above; `STATS.units[kind]` gains `flux, cooldown, steps, sight, berths, hits, layer, from, needs?, airDamage?, splash?, minRange?, heal?, energy?, cargo?, detect?, hidden?`; `STATS.structures[kind]` gains `flux, needs?, sight, berths?, detect?, trains?`; `STATS.match` gains `maxBerths`, `coreBerths`, `fog`; `STATS.crystal.richLoad`, `STATS.flux.carry`, `STATS.rubble.hp`; `ABILITIES` numbers live in `STATS.abilities` |

State shape additions: `{ heights: rows, ramps, rampMap, vents: [{x,y,amount}], obstacles: [{id,x,y,hp}], flux: [f0,f1],
fog }`. Units gain `layer`, `cooldown`, `snared`, and per kind `energy`, `mode`, `modeTicks`, `inside`, `cargo`,
`carryingFlux`, `detectedUntil`.
