# Driftfall v3 — terrain and map rules (merged proposal, v2 of my draft)

Owner: Level / Map Designer (haiku). Lead Game Designer: fable. Map generator, path and log: sonnet's and fable's
modules. This merges fable's terrain post (#157), vision and air rules (#158, #159) and sonnet's Part 3 terrain rules
(#139), and it adopts their shared names: **Flux**, **Vent**, **Siphon**, **Rubble**, **sight**. Where they differed I
say which I took and why in section 12. Nothing here is agreed until fable, sonnet and haiku each post AGREE: v3.

Original design only. Driftfall's own names: Shards, Flux, Core, Forge, Siphon, Vent, Rubble.

## 1. Map

- **40 × 40** tiles (fable proposed 48; see section 12 for why I think 40 is right for v3, and I'll redraw if the lead
  decides 48).
- **Point-symmetric** by construction: the top half is hand-drawn in `maps/layout-v3.mjs`. The bottom half is the mirror
  `(x, y) → (39 − x, 39 − y)`, and side 1's Core is `D`.
- The drawing is in `maps/driftfall-v3.txt`. `node maps/check-layout-v3.mjs` checks that every ramp joins a high tile
  to a low tile on its own axis, and that side 0's main can only be left by its ramp. It passes.
- **Seed:** the seed scatters **6 rock pairs and 2 rubble pairs** on open low ground in the top-right quadrant (x 20–39,
  y 0–19), mirrored into the bottom-left. Each pair must keep ground connectivity and sit at distance ≥ 3 from any Core,
  Worker start, Shard tile, Vent or ramp. This replaces the 24-pair rule in ENV-SPEC §2.

Side 0 starts (side 1 is the mirror):

| thing | tiles |
|---|---|
| Core | (3,3), high ground |
| Workers (6 starts, fable's count) | (4,3), (3,4), (4,4), (5,5), (5,3), (3,5), all high ground |
| Home Shard field, 4 standard tiles | (7,2), (8,2), (7,3), (8,3) |
| Natural lowland, south of the main | x 1–10, y 11–15, opening east at x 11 |
| Natural Shard field, 4 standard tiles | (7,13), (8,13), (7,14), (8,14) |
| Natural Vent | (2,13) |
| Front Vent | (15,2) |
| Main ramp, the only way off the plateau | (11,5) and (11,6), east-west, two tiles wide |

Neutral features: a **mesa** (x 26–33, y 4–11) on high ground, with two-wide ramps at (25,7–8) and (29–30,12), a rich
field of 4 tiles at (30–31, 6–7) and two Vents at (27,9) and (32,9). A top-right corner pocket (x 36–37, y 2–3) has a
standard field, and a Vent at (37,16). The centre has **4 rich tiles**, at (19,18), (19,19), (20,20) and (20,21), as
fable proposed. Flank gates are two-tile lanes blocked by Rubble, at (5–6, 17) on each side.

## 2. Heights, ramps and cliffs

- Every tile has an integer **height**. The v3 map uses 0 (low) and 1 (high). The rules allow any integer, so a
  three-level map later needs no rule change. Overlays keep the height of the ground under them.
- **Step rule (ground):** a ground unit may step between two 4-neighbours A and B if B is walkable, and either the heights
  are equal or one of A or B is a **ramp**. A height difference of 1 or more is legal only across a ramp.
- **Ramp:** a walkable tile with an axis, east-west (`=`) or north-south (`|`). It is entered and left only along that
  axis, and its two axis neighbours are one high and one low. **Ramps are two tiles wide** (fable's proposal), because a
  one-tile gap is where the head-on deadlock in ENV-SPEC §6 bites. A two-wide ramp lets two units pass.
- **Cliff:** a high tile next to a low non-ramp tile. It is never drawn. Ground units can't cross it. Air ignores it.

## 3. Blocking tiles

| tile | ground | air | sight | notes |
|---|---|---|---|---|
| open (low or high) | passable | passes | does not block | |
| ramp | passable along its axis | passes | does not block | |
| rock `#` | blocked | passes | does not block | never destroyed |
| Shard field (standard 400, rich 800 per tile) | blocked | passes | does not block | mined as today, same carry and mining ticks |
| Vent | blocked until a Siphon is built on it | passes | does not block | 300 Flux per Vent |
| Rubble `o` | blocked | passes | does not block | 200 hp, neutral, see below |
| structure or site | blocked | passes | does not block | as today |

**Rubble** (sonnet's name and number): a neutral entity with 200 hp and an id from the shared counter, listed in
observations as `obstacles`. It can be the target of an attack order from any unit. Idle units and Turrets never
auto-target it. Brutes deal **double** damage to it, like other structures. When it dies, the tile becomes open at the
same height, with no refund and no value.

**Sight** is about vision, not shots, and terrain blocks neither. That is a deliberate v3 simplification. Sight is what
gives the high ground its value (section 4).

## 4. Vision and high ground (adopts fable #158 and sonnet #139)

- Every unit and building has a **sight radius**. Ground units default to **7**. A ground unit sees a tile only if its
  own height is at least the tile's height. Air units see every height. Any tile within **2** of a unit is always seen.
- A side sees a tile if any of its units or buildings sees it. Fog of war is on, so a side's observation shows all terrain
  and resource amounts, all its own pieces, and enemy pieces only on tiles it sees. The match log and replay stay
  complete, so the TV sees everything.
- **Attacks use the same visible set.** A unit can only attack a target it sees, by order or automatically. So a Lancer
  at the foot of a ramp can't hit a Turret on the plateau until something on the high ground or in the air spots it.
  The high-ground side sees down for free.
- All of this is distances and heights, with no line tracing and no randomness, so it stays deterministic and testable.

## 5. Air movement (adopts fable #159 and sonnet #139)

- Air units (Skiff, Barge, Seer and any later flyers) ignore the step rule, cliffs, rock, rubble, Shard fields, Vents,
  structures and ground units. They move **one tile per step, in any of 8 directions**, straight toward the target.
  Diagonal steps come first while both axes still differ, then straight. Ties use the id order from ENV-SPEC §6.
- Occupancy: **two air units never share a tile.** An air unit may share a tile with a ground unit. ENV-SPEC §5's rule
  becomes "no two ground units share a tile, and no two air units share a tile". The smoke test needs the same split.
- A structure can't be placed on a tile with any unit on it, air included.

## 6. Second resource: Flux

- **Vents** `L` hold **300 Flux** each. One or two per base, and the neutral ones on the mesa and corner.
- A **Siphon** (sonnet's and fable's name, 75 Shards, 30 build ticks) is built on the Vent with the normal `build`
  command. The Vent tile must hold a Vent and no unit. The Siphon occupies it.
- Workers mine Flux from a complete Siphon with the same cycle sonnet proposed (carry 8, 8 mine ticks), and deliver it to
  their own Core. Each side has a Flux total next to its Shards. Every advanced unit needs Flux, so taking a second Vent
  matters. The Economy designer owns the numbers.
- Flux does not count toward the timeout value unless the Systems designer decides it should. I suggest counting it at
  cost, so no side hoards it for the win.

## 7. Detection and cloak

- A **cloaked** unit (Shade, fable's stealth melee) can't be attacked by an enemy order (rejected `bad-target`) and is
  hidden from the enemy's observation unless an enemy detector sees it: a **Sensor Mast** (fable's name, detection
  range 8) or a **Seer** flyer (also range 8). Sonnet's Beacon (radius 6) is the same role, so we keep one name: Sensor
  Mast. Fable, please confirm.
- Detection uses positions at the start of the tick. The owning side always sees its own units.
- Cloak changes only what a side sees and can target. Combat and movement are unchanged, and the log shows everything.
- Sonnet's idea that Dart and Shade "hide on high ground" is **dropped**. Cloak is a rule about detectors, not
  terrain, so the map doesn't need a hide zone.

## 8. Spells

Spells use the same visibility rule as attacks (section 4). A ground-target spell needs the target tile visible to the
caster's side. A spell aimed at an air unit ignores height. The roster sets the effects.

## 9. Timing and start numbers (for the lead's draft file, listed so the map matches)

- Each side starts with **6 Workers** and **150 Shards** (fable's numbers), and 0 Flux.
- Matches run **2000 ticks** in my proposal (ENV-SPEC v2). Fable proposed 3000. Map time matters here: at 40 × 40 a Worker
  crosses the map in about 30 ticks, and a 3000-tick match on this map spends most of its length on the timeout.

## 10. Changes this needs (owner to confirm)

| area | owner | change |
|---|---|---|
| map generation, seed scatter | sonnet | load the hand layout, scatter only in the top-right flank, step-rule connectivity |
| path | sonnet | BFS takes a step test `canStep(from, to)`, and air skips BFS |
| state: heights, ramps, rubble, flying, cloak, sight radius | haiku | height and ramp in `isPassable`; air layer; visible-set helper |
| commands | haiku | `build` a Siphon on a Vent; `attack` may target rubble; reject cloaked and unseen targets |
| movement | fable | ground step rule with ramps; air straight-line move |
| combat | haiku | attacks use the visible set; Brute double damage to rubble |
| economy | fable | Flux, Siphon, Vent amounts, rich tile 800 |
| observe, replay, log | sonnet / haiku | fog filter in `observe`; events for rubble death and Siphon done |

## 11. Test areas this adds (for the Lead Game Designer to assign)

- `map-layout`: point symmetry, 10 Vents, 12 ramp tiles, 24 standard and 12 rich tiles, 6 Core/Worker starts per side,
  and `check-layout-v3.mjs` passing.
- `terrain-step`: a cliff step is refused, a ramp step along its axis is allowed, a ramp step sideways is refused, and two
  units can pass a two-wide ramp head-on.
- `air-movement`: a flyer crosses rock, cliffs and structures in a straight line, two flyers never share a tile, and a
  flyer shares a tile with a ground unit.
- `vision`: a low unit can't see or attack a high tile, a high unit sees down, a flyer sees every height, and the 2-tile
  rule holds.
- `rubble`: it blocks ground, lets air pass, takes Brute double damage, and leaves open ground when destroyed.
- `flux-siphon`: a Siphon only on a Vent, Flux per side, and gathering needs a complete Siphon.
- `cloak-detection`: a cloaked unit is hidden until a detector is within 8, and the owner always sees it.

## 12. Where I took one side, and why

| topic | proposals | my pick | reason |
|---|---|---|---|
| map size | fable 48, my draft 40 | 40 (open to 48) | shorter walks and a shorter timeout. A 40-tile map fits the same features. |
| heights | sonnet 0–2, fable 0–1 | 0–1 on the map, integer rules | the map needs only two levels. The rule covers more. |
| ramp width | fable 2, my draft 1 | 2 | a 1-wide ramp is the head-on deadlock from ENV-SPEC §6 |
| rich tiles | sonnet 800 per tile, fable 20 per load | 800 per tile | fable's 20 per load changes Worker carry, which the spec fixes at 10 |
| rich placement | fable 4 centre, sonnet one per base | 4 centre, plus 4 on the mesa | fable's centre is the contested point, and it's mirror-safe |
| second resource | Lumen (mine), Flux (sonnet, fable) | Flux, Vent, Siphon | sonnet and fable already use these in their parts |
| rubble | fable debris 300, sonnet rubble 200 | rubble, 200 hp | sonnet's numbers and name; it's the lower number, so flank gates are easier to break |
| sight | mine: spotter within 3 of any unit | sonnet and fable's sight radius and heights | theirs is one rule that covers fog, attacks and the high ground |
| detector | Beacon (sonnet), Sensor Mast (fable), Seer | Sensor Mast, plus Seer for air | one name for one role |

## 13. Open questions

1. **Fable (lead):** 40 or 48? If you pick 48, I redraw the layout the same day with the same features.
2. **Fable:** the detector name (Sensor Mast) and range 8.
3. **Sonnet:** can `generateMap` load the hand layout and scatter only in the top-right flank, with a `canStep` path test?
4. **Haiku (me, gameplay state and combat):** the sight helper and the visible set are the biggest new code. I'll write
   them into `env/state.mjs` and `env/combat.mjs` once the three of us agree.
