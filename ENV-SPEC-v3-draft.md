# Driftfall — environment spec v3 (DRAFT, proposed by fable, not yet agreed)

This is the proposal for version 3. `ENV-SPEC.md` stays the v2 contract until sonnet, haiku and fable have all posted
`AGREE: v3` in the team chat; then this text replaces it. Everything in v2 that is not mentioned here stays as it is.
Numbers live in `env/stats.mjs`; this file explains them. Every name is original to Driftfall.

## 1. The game in one paragraph

Two sides fight on a mirrored 48 × 48 grid with high and low ground. Workers mine **Shards** from crystal tiles and
**Flux** from vents (through a Siphon) and carry both to the **Core**. Shards and Flux pay for ten buildings and
fourteen unit kinds: ground, air, stealth, siege, healers and one spellcaster. Fog of war is on: you only see what
your pieces can see, and you can only shoot what you see. Destroy the enemy Core to win; after 3000 ticks the side
with more total value wins.

## 2. Map

- Square grid **48 × 48**, integer coordinates, `x` right, `y` down, 0 to 47. Point-mirrored: side 0's `(x, y)` is
  side 1's `(47 - x, 47 - y)`. Side 0 top-left, side 1 bottom-right.
- **Height.** Every tile has `elev` 0 (low) or 1 (high). Side 0's main plateau is every tile with `x ≤ 15` and
  `y ≤ 15`; side 1's is `x ≥ 32` and `y ≥ 32`. Everything else is low. The edge between a high tile and a low tile
  with no ramp is a **cliff**: ground units never step across it (in either direction). Air units ignore height.
- **Tile kinds:** `open`, `rock` (never passable), `crystal` (holds Shards; `rich` tiles hold more and give bigger
  loads), `vent` (holds Flux; only a Siphon can be built on it; not passable), `ramp` (passable; joins low and high
  ground; counts as low ground for sight). **Debris** is not a tile kind but a neutral structure (§4) that blocks
  the tile until destroyed.
- **Ground stepping rule:** a ground unit may step from tile A to a 4-neighbour B only if B is passable and
  (`elev(A) == elev(B)` or A is a ramp or B is a ramp).
- **Fixed layout for side 0** (side 1 is the mirror). Amounts: home and natural crystal tiles 500 Shards, third-base
  crystal tiles 500, rich tiles 600 (loads of 20), vents 800 Flux.
  - Core `(5, 5)`. Six Workers `(6, 5)`, `(5, 6)`, `(6, 6)`, `(7, 5)`, `(5, 7)`, `(7, 7)`.
  - Home crystals (high ground): `(9, 3)`, `(10, 3)`, `(9, 4)`, `(10, 4)`, `(9, 5)`, `(10, 5)`.
  - Home vents (high ground): `(3, 9)`, `(9, 9)`.
  - Ramp: `(10, 16)`, `(11, 16)` (two wide, joins the plateau row `y = 15` to the natural at `y = 17`).
  - Natural crystals (low ground, inside the pocket): `(4, 20)`, `(5, 20)`, `(4, 21)`, `(5, 21)`, `(4, 22)`,
    `(5, 22)`. Natural vent `(13, 21)`.
  - Pocket walls (fixed rocks): `(16, y)` for `y` 16 to 22, and `(x, 28)` for `x` 0 to 15 except `(2, 28)` and
    `(3, 28)`. The open gap `(16, 23)`–`(16, 27)` is the natural's front choke, five wide.
  - **Debris** (back door of the natural): `(2, 28)` and `(3, 28)`, 300 hp each.
  - Third base (low ground, bottom-left): crystals `(3, 38)`, `(4, 38)`, `(3, 39)`, `(4, 39)`, `(3, 40)`,
    `(4, 40)`; vent `(9, 41)`.
  - Contested vent `(20, 28)`.
  - Centre rich field, shared by both sides and its own mirror: `(23, 23)`, `(24, 23)`, `(23, 24)`, `(24, 24)`.
- **Random rocks** come from the seed exactly as in v2 (`makeRng`, mirrored pairs, rejection), with these changes:
  **20 pairs**; only on low open tiles; never within distance 2 of a Core, starting Worker, crystal, vent, ramp,
  debris or fixed rock; and the pair is kept only if every passable tile still reaches every other passable tile
  by the ground stepping rule, treating debris as walls. Stops after 20 pairs or 2000 attempts.
- Same seed ⇒ identical map, always. `generateMap(seed)` also returns `elev` (rows), `ramps`, `vents`, `debris`,
  and marks `rich` on crystals.

## 3. Resources: Shards and Flux

- Each side starts with **150 Shards, 0 Flux**. Both are per-side numbers, never negative.
- **Shards:** as v2 (walk next to the crystal tile, mine 8 ticks, carry 10, deliver next to own Core, repeat,
  retarget nearest tile with Shards left). A **rich** tile gives **20** per load in the same 8 ticks.
- **Flux:** a `gather` order on a **vent** tile is legal only when a complete own **Siphon** stands on it. The
  Worker walks next to the Siphon, mines 8 ticks, carries **8 Flux**, delivers next to own Core. When the vent is
  empty the Worker retargets the nearest vent with an own Siphon and Flux left, else goes idle. The Siphon stays
  (it is still a structure) when the vent is empty.
- A Worker carries one kind at a time: `carrying` (Shards, 0–20) and `carryingFlux` (0–8); at most one is non-zero.
- Costs are written `S/F`. A command that cannot pay is rejected `no-shards` (Shards short) or `no-flux`.

## 4. Structures

| kind     | cost S/F | hp   | build | needs    | notes |
|----------|----------|------|-------|----------|-------|
| core     | —        | 1500 | —     | —        | One per side. Trains Workers. Accepts deliveries. Gives **16 berths**. Sight 8. |
| quarters | 75/0     | 300  | 25    | —        | Gives **8 berths** while complete. Sight 5. |
| forge    | 150/0    | 400  | 40    | —        | Trains Grunt, Lancer, Brute (Brute also needs a complete Foundry). |
| siphon   | 75/0     | 300  | 30    | —        | Built **on a vent tile**. Lets Workers gather Flux there. |
| turret   | 100/0    | 150  | 30    | —        | Auto-attacks ground **and air**: damage 12, range 5, cooldown 1. Sight 7. |
| mast     | 100/0    | 200  | 30    | —        | Sensor Mast: no weapon. Sight 10, **detects** hidden units within 8. |
| foundry  | 200/100  | 500  | 50    | forge    | Trains Spiker, Howler, Dart. |
| hangar   | 200/150  | 500  | 50    | foundry  | Trains Skiff, Barge, Seer. |
| sanctum  | 150/150  | 400  | 45    | forge    | Trains Mender, Shade, Conduit. |
| debris   | —        | 300  | —     | —        | Neutral (`owner: null`), placed by the map, never built. Blocks ground movement until destroyed. |

- Default sight for structures without a number: 6. Every structure occupies one tile and blocks ground movement
  (air flies over).
- **Building:** as v2, plus: `build` of `siphon` requires the tile to be a vent tile with nothing on it; every other
  kind requires an open tile (not rock, crystal, vent, ramp is allowed) with no unit or structure. A kind with a
  `needs` entry is rejected `needs-tech` unless the side has a complete structure of that kind. Building on high
  ground is allowed. A Worker builds from any adjacent tile, including across a cliff edge.
- **Repair:** a `repair` order (`unit, target`) on an own complete structure below max hp: the Worker walks adjacent
  and each tick restores `round(maxHp / buildTicks)` hp (capped). Free. One Worker counts per tick. The order
  clears at full hp or if the structure dies. Emits `progress`-style `repair` events.
- **Training:** as v2 (queue of 5, spawn on nearest free tile in the fixed search order), plus the `needs` rule
  and berths. Air units spawn on the nearest tile with no air unit (terrain ignored).
- **Berths (supply):** every unit kind has a `berths` size. A side's berth limit = 16 + 8 × complete Quarters,
  capped at **100**. A `train` is rejected `no-berths` if living units' berths + queued units' berths + the new
  unit's berths would exceed the limit. If Quarters die the side can be over the limit; it simply cannot train
  until it is under again. The flat cap of 40 units is gone; `unitCap` becomes `maxBerths` = 100.
- **Debris** can be given as an `attack` target by any unit with a weapon. Idle units and Turrets never auto-attack
  it. When its hp hits 0 it is removed (`die` event) and the tile is open.

## 5. Units

`speed` = ticks per step (1 every tick, 2 even ticks only). `steps` = tiles moved per moving tick (Dart 2).
`cd` = cooldown ticks between attacks (1 = every tick, as v2). `hits` = what the weapon can target.
`layer` = ground or air. `berths` = supply used.

| kind    | cost S/F | hp  | dmg | range | cd | speed | steps | sight | berths | train | hits   | layer  | from    | role |
|---------|----------|-----|-----|-------|----|-------|-------|-------|--------|-------|--------|--------|---------|------|
| worker  | 50/0     | 40  | 2   | 1     | 1  | 1     | 1     | 5     | 1      | 20    | ground | ground | core    | Mines, builds, repairs. |
| grunt   | 50/0     | 60  | 8   | 1     | 1  | 1     | 1     | 6     | 1      | 15    | ground | ground | forge   | Cheap melee. |
| lancer  | 75/0     | 40  | 10  | 4     | 1  | 1     | 1     | 6     | 1      | 20    | ground | ground | forge   | Ranged. Beats Grunts. |
| brute   | 150/0    | 240 | 25  | 1     | 1  | 2     | 1     | 6     | 3      | 40    | ground | ground | forge*  | Tank; ×2 vs structures. Needs Foundry. |
| spiker  | 100/25   | 80  | 6   | 5     | 1  | 1     | 1     | 7     | 2      | 25    | both   | ground | foundry | Anti-air: **20** damage to air, 6 to ground. |
| howler  | 150/100  | 120 | 40  | 7     | 8  | 2     | 1     | 7     | 3      | 40    | ground | ground | foundry | Siege. Fires only when **sieged**; min range 2; splash 20 to enemy ground units within 1 of the target. |
| dart    | 100/25   | 70  | 12  | 1     | 1  | 1     | 2     | 7     | 2      | 20    | ground | ground | foundry | Raider: two tiles a tick, ×2 vs Workers. |
| mender  | 75/50    | 60  | —   | 2     | —  | 1     | 1     | 6     | 1      | 25    | —      | ground | sanctum | Heals 4 hp a tick to the most damaged own unit within 2. |
| shade   | 125/75   | 70  | 15  | 1     | 1  | 1     | 1     | 6     | 2      | 30    | ground | ground | sanctum | **Hidden** unless detected. |
| conduit | 100/100  | 70  | —   | 6     | —  | 1     | 1     | 6     | 2      | 30    | —      | ground | sanctum | Caster: energy 50 start, 100 max; Pulse, Snare. |
| skiff   | 125/75   | 90  | 10  | 3     | 1  | 1     | 1     | 7     | 2      | 30    | both   | air    | hangar  | Air fighter. |
| barge   | 150/100  | 200 | —   | —     | —  | 1     | 1     | 6     | 2      | 30    | —      | air    | hangar  | Transport: carries 8 berths of ground units. |
| seer    | 100/50   | 60  | —   | —     | —  | 1     | 1     | 8     | 1      | 25    | —      | air    | hangar  | Flying detector: detects hidden units within 8. |

- Damage bonuses, all flat multipliers, no randomness: Brute ×2 vs structures and sites (as v2); Dart ×2 vs
  Workers; Spiker uses `airDamage` 20 against air units instead of its 6.
- Value of a unit or complete structure = Shards cost + Flux cost. Core, debris and unfinished sites = 0.
- **Counters (what the tests check):** Lancer beats Grunt; Brute beats Lancers and Turrets; Spiker and Turret beat
  Skiff; Skiff beats a mobile Howler and anything with no anti-air; Dart beats Workers and a sieged Howler up close
  (min range); sieged Howler beats clumped Grunts; Seer or Mast lets Lancers kill a Shade that is otherwise
  untouchable; Conduit Pulse beats clumps of Grunts or Workers; Mender keeps a Brute alive against two Lancers.

## 6. Distance, movement, paths

- Distance is Chebyshev (max of |dx|, |dy|) as v2. Movement is 4-directional.
- **Ground paths** use breadth-first search as v2 with two additions: the step must obey the ground stepping rule
  (§2), and vents, Siphons, debris and all structures block. `findPath` gets a `canStep(from, to)` option.
- **Air paths** ignore terrain and structures entirely: every tile inside the map is passable. Only another air
  unit occupies an air tile. Air and ground units may share a tile. Air units still move one tile per step,
  4-directional, by the same id-order rules.
- **Steps:** a unit with `steps: 2` takes up to two path steps in its moving tick, each checked for a free tile.
- **Snared** units (`snared > 0`) do not move; the counter drops by 1 each tick in the Production phase.
- **Howler modes:** `mobile`, `deploying`, `sieged`, `packing`. A `siege` command on a mobile Howler sets
  `deploying` with `modeTicks: 10`; it becomes `sieged` when the countdown ends. `unsiege` on a sieged Howler sets
  `packing` 10 then `mobile`. Any mode but `mobile` cannot move. Attack orders on a Howler walk it within range
  (mobile) but it only fires when sieged.
- **Transport:** a `board` command (`unit, target`) on an own ground unit with an own Barge as target sets a
  `board` order: the unit walks to within distance 1 of the Barge (the Barge's current tile each tick). In the
  Movement phase, after its own move, a unit standing within 1 of its Barge boards if the Barge's cargo berths
  (8) allow: it gets `inside: bargeId`, keeps `x, y` equal to the Barge's, is no longer on the map for blocking,
  vision, targeting or attacking, and is listed in the Barge's `cargo` (ids, boarding order). An `unload` command
  (`unit`) on a Barge places every cargo unit, in cargo order, on the nearest free passable ground tile within
  distance 2 of the Barge (the v2 spawn search order); any that find no tile stay inside. When a Barge dies its
  cargo dies in the same tick (`die` events after the Barge's, in id order). Cargo units carry their orders into
  the Barge but the orders are cleared when unloaded.
- The v2 detour rule (wait one tick, then path around a standing unit) stays.

## 7. Vision, fog of war, detection

- Every unit and structure has `sight`. A **ground** unit or structure sees the tiles within `sight` distance whose
  `elev` is **≤ its own tile's elev** (ramps count as elev 0). An **air** unit sees every tile within `sight`.
  Cargo inside a Barge sees nothing. Sites (unfinished structures) have sight 2.
- A side's **vision** is the union over its pieces. `visionOf(state, player)` returns `height` rows of `width`
  characters, `'1'` seen `'0'` unseen. It is computed from positions at the start of the Combat phase and again
  for the observation (same positions minus the dead).
- **Fog of war:** the observation (§10) lists all terrain, all crystal and vent amounts, all debris, all own
  pieces, and enemy units and structures **only on seen tiles**. There is no memory of enemy structures; players
  keep their own notes.
- **Targeting needs vision:** an `attack` command whose target is not on a seen tile (or is hidden and undetected)
  is rejected `not-visible`. In the Combat phase, an ordered attacker whose target is not visible to its side
  this tick does nothing and its order is cleared (`order` event with `null`). Idle units and Turrets only
  auto-target visible enemies. So a unit at the bottom of a ramp cannot shoot up the cliff until something
  with a view spots the target.
- **Stealth:** a Shade is `hidden`. It is **detected** by a side when any of that side's detectors (Seer: 8,
  Mast: 8, complete only) has it within its detect range. A hidden undetected unit is never in the enemy
  observation, never a legal target, never auto-targeted, and still attacks normally. A side's own Shades show
  `detected: true|false` in its observation (best-effort, for information).
- A match can be run with fog off (`createMatch(seed, { fog: false })`, `run-match --no-fog`): the observation
  then shows everything, but targeting still needs vision. The option is recorded in the log.

## 8. Fighting

- **Who attacks:** as v2 (ordered units in range; idle units with a weapon against the nearest visible enemy in
  range; complete Turrets), with: a weapon only targets what its `hits` allows; a Howler only fires when sieged
  and never at distance < 2; a unit fires only when its `cooldown` is 0 after this tick's countdown, and firing
  sets `cooldown` to the kind's `cd`. Menders, Conduits, Barges, Seers and Workers (unless ordered) never attack.
- **Combat phase, in order:** (1) cooldowns count down; (2) vision and detection are computed; (3) **casts** resolve
  in id order (each spends energy and adds its damage or effect to this tick's totals); (4) attacks are chosen
  from start-of-phase positions and summed, splash included; (5) **heals** are chosen (each Mender picks the most
  damaged own unit by missing hp within 2, ties lower id, not itself) and added as negative damage; (6) all totals
  apply together, capped at max hp; (7) anything at 0 hp or below is removed, Barges with their cargo.
- **Howler splash:** the target takes 40; every other enemy ground unit (not structures) within distance 1 of the
  target takes 20. Splash never hits own units.
- **Conduit abilities** (`cast` command: `unit, ability, x, y` or `unit, ability, target`; sets a `cast` order; the
  Conduit walks to within range 6 of the tile or target and casts at the first Combat phase where it is in range
  and has the energy, then the order clears):
  - `pulse` (50 energy, target tile): 30 damage to **every unit of both sides**, ground and air, within distance 1
    of the tile. Structures unaffected.
  - `snare` (25 energy, target visible enemy unit): sets the target's `snared` to 16. It cannot move but can still
    attack and cast.
  - Energy: starts 50, max 100, +1 on every even tick (Production phase), spent on cast. A cast order with not
    enough energy waits in range. `cast` is rejected `no-energy` only if the ability's cost exceeds max energy
    (never, by the table) and `bad-target` for a wrong target type.
- **Events:** `hit` as v2 (one per attack or splash victim, hp after all damage and healing of the tick), `heal`
  `{ id, by, amount, hp }`, `cast { id, ability, x, y, target, energy }` (energy after), `snare { id, ticks }`,
  then `die` in id order.

## 9. One tick, in order

1. **Commands** (§11), side order and the 100-command limit as v2.
2. **Production:** queues tick and spawn; sites progress; repairs apply; Howler mode countdowns; Conduit energy +1
   on even ticks; `snared` counters drop. Id order.
3. **Gathering:** Shards and Flux. Id order.
4. **Movement:** id order; ground and air; steps; boarding after a unit's own move; unload orders resolve for the
   Barge at its turn.
5. **Combat** (§8).
6. **Tick ends**, end check (§10).

The fairness rule (even ticks side 0 and lowest id first, odd ticks reversed) applies to every id-ordered step
exactly as v2. No clock, no randomness.

## 10. Match end and observation

End check as v2 with **maxTicks 3000** and value = Shards + Flux + (Shards + Flux cost) of living units and
complete structures. Core, debris, cargo (counted like any living unit), sites as before.

**Observation** (deep copy; fog applied):
```
{ tick, you, width, height, fog,
  elev: [row strings '0'/'1'], ramps: [[x,y]], rocks: [[x,y]],
  crystals: [{ x, y, amount, rich }], vents: [{ x, y, amount }],
  vision: [row strings '0'/'1'],
  shards: [s0, s1], flux: [f0, f1], berths: [[used0, max0], [used1, max1]],
  units: [{ id, owner, kind, layer, x, y, hp, carrying, carryingFlux, order,
            energy?, mode?, snared, inside?, cargo?, detected? }],
  structures: [{ id, owner, kind, x, y, hp, progress, complete, queue }],   // debris has owner null
  maxBerths: 100, maxTicks: 3000 }
```
Enemy entries show only what is visible; `order`, `energy`, `cargo`, `detected` are own-only (enemy copies have
`order: null`, no `cargo`). Enemy `shards`, `flux` and `berths` are shown (no scouting of the economy needed; keeps
the AI players simple). Cargo units appear in `units` with `inside` set and the Barge's `x, y`.

## 11. Player API: commands

| command   | fields                      | legal when |
|-----------|-----------------------------|------------|
| `move`    | `unit, x, y`                | own living unit on the map; tile inside map; not snared-irrelevant (order is set, movement waits) |
| `attack`  | `unit, target`              | own unit with a weapon (Howler any mode); target a visible enemy unit/structure/site or debris; weapon `hits` allows the target's layer |
| `gather`  | `unit, x, y`                | own Worker; crystal with Shards, or vent with Flux and a complete own Siphon |
| `build`   | `unit, kind, x, y`          | own Worker; kind buildable; tile rule by kind; `needs` met; can pay both costs |
| `repair`  | `unit, target`              | own Worker; own complete structure below max hp |
| `train`   | `building, kind`            | own complete building that lists the kind; `needs` met; queue < 5; can pay; berths allow |
| `siege` / `unsiege` | `unit`            | own Howler in `mobile` / `sieged` |
| `cast`    | `unit, ability, x, y` or `unit, ability, target` | own Conduit; known ability; tile in map / visible enemy unit |
| `board`   | `unit, target`              | own ground unit (not Worker carrying? allowed, load kept); target own complete Barge on the map |
| `unload`  | `unit`                      | own Barge with cargo |
| `stop`    | `unit`                      | own unit; clears its order (a deploying/sieged Howler stays in its mode) |

New reject reasons: `no-flux`, `no-berths`, `needs-tech`, `not-visible`, `wrong-mode`, `cargo-full`, `no-cargo`,
`bad-ability`. All v2 reasons stay. Orders seen in observations gain `{type:'repair', target}`,
`{type:'cast', ability, x, y, target}`, `{type:'board', target}`, `{type:'gather', ..., resource: 'shards'|'flux'}`.

## 12. Referee, log, replay

- Referee as v2 (worker threads, 50 ms think, 1000 ms hard, 50 throws). `runMatch` and `run-match.mjs` accept
  `fog` (default true) and `maxTicks`. The log gains `options: { fog }` and `version: 3`.
- New events: `heal`, `cast`, `snare`, `mode { id, mode }`, `load { id, into }`, `unload { id, x, y }`,
  `repair { id, hp }`; `mine` and `deliver` gain `resource: 'shards'|'flux'`; `deliver` and `spend` carry both
  `shards` and `flux` after; `spawn` of debris happens in `initial`, not as an event.
- **Replay promises** (v2 list plus): `carryingFlux`, both resources, vent amounts, `mode`, `inside`/`cargo`,
  `snared` (set by `snare` events, counted down by the replay with the same rule), `energy` (regen rule applied by
  the replay, spends from `cast` events). Not promised: `cooldown`, `modeTicks`, orders.
- The log stays **complete** (no fog): the TV and replays see everything.

## 13. Determinism rules

Unchanged from v2. Ids: Core 0 = 1, Core 1 = 2, side 0 Workers 3–8, side 1 Workers 9–14, side 0 debris 15–16,
side 1 debris 17–18, then everything else as allocated.

## 14. Module interfaces (additions to v2)

| file | exports |
|------|---------|
| `env/layout.mjs` (new) | `LAYOUT`: the fixed side-0 table from §2 (core, workers, crystals with `rich`, vents, ramp, fixedRocks, debris, plateau rectangle); `mirrorLayout()` helper |
| `env/map.mjs` | `generateMap(seed)` returns `{ width, height, elev, ramps, rocks, crystals, vents, debris, cores, workers }` |
| `env/path.mjs` | `findPath({ width, height, blocked, canStep }, from, to, { within })`; `canStep(from, to)` optional, default always true |
| `env/vision.mjs` (new) | `visionOf(state, player) -> rows`, `canSee(state, player, x, y)`, `isDetected(state, player, unit)`, `isTargetable(state, player, entity)` |
| `env/abilities.mjs` (new) | `ABILITIES` table, `resolveCasts(state, damageMap) -> events` (called by combat) |
| `env/state.mjs` | state gains `elev`, `ramps`, `rampSet`, `vents`, `flux`, `fog`; helpers `elevAt`, `isGroundFree`, `isAirFree`, `berthsOf(state, player) -> { used, max }` |
| `env/transport.mjs` (new) | `tryBoard(state, unit)`, `unloadBarge(state, barge)` (called by movement) |

State shape additions: `{ elev: rows, ramps, rampSet, vents: [{x,y,amount}], flux: [f0,f1], fog: true }`. Units gain
`layer`, `cooldown`, `snared`, and per kind `energy`, `mode`, `modeTicks`, `inside`, `cargo`, `carryingFlux`.
