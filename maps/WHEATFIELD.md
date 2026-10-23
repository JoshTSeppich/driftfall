# Map: Wheatfield Valley (Toaster Wars' first real map) — proposal by claude, 10-23 08:15

**256 × 256, two players, point-mirrored** (side 1's tile (x, y) = side 0's (255 − x, 255 − y)). Style: STYLE-BIBLE.md
section 8, "The Quiet Battlefield". Every rule of Toaster Wars has a place on it: wheat for flour, the river for
water and power, meadows for butter, generator hills for electricity, movable rocks for dams and chokes, and cords that
limit how far you reach.


## MAP STYLE RULE (Joshua, 10-23 08:29) — overrides anything below that differs
> "The swarm needs to focus on a map style like StarCraft, very grid-like. But the terrain's resources are wheat and
> water... and windmills and dams."

- **Very grid-like, classic-RTS tileset.** Square tiles; plateaus, cliffs and ramps aligned to the grid; cliff edges
  run in straight lines and clean 45° corners; ramps are clear 2–4 tile-wide wedges; every base sits on a readable
  rectangle of buildable tiles. The map reads like a board: you can see where everything can and can't go.
- **Only two terrain resources: WHEAT and WATER.**
  - **Wheat** fields sit at each base like classic resource lines: a tidy row/cluster of wheat tiles a few tiles from
    where the Toaster/Power Strip goes, so Crumbs harvest on short, efficient trips. Bigger, richer fields further out.
  - **Water** comes from the river and ponds: a **Pump** (or Well) is built on a water tile, like a classic gas
    building; each base has one water source close by.
- **Power comes from two structures:**
  - **Windmills**, built on marked windmill pads on high ground (hills and plateau edges). Steady, modest power.
  - **Dams**, built across the river at marked dam sites (the Mill Dam at the centre is the big one). Lots of power,
    and they change the river (lower water downstream opens fords).
- **Butter, meadows and generator sockets are removed from the map.** Butter becomes a crafted topping later (or
  is cut for v0.1); energy is windmills + dams only.
- Cords still rule: power from windmills and dams flows through Outlets and Extension Boxes; units can't pass the end
  of their cord.

## The idea in one line
A farm valley split by **Crumb Creek**, which runs corner to corner. You start on your own bank with a little wheat;
the **Golden Fields**, the big **Mill Dam** and the meadows are out in the open, so every step outward means laying
cord into ground the enemy can see and cut.

## Overview (1 character ≈ 8 × 8 tiles; side 0 bottom-left, side 1 top-right; Crumb Creek runs top-left to bottom-right)
```
~ ~ . . . . . . . . . . . . . . . . . . . . . . . . . ^ ^ ^ ^ ^
. ~ ~ . . . . . . . . . . . . . . . . . . . . . . . . ^ ^ ^ ^ ^
. . ~ ~ . . . . . . . . m m . . . . . . . . . . w w . ^ ^ 2 ^ ^
. . . ~ ~ . . . . . . . m m . . . . . . . . . . w w . ^ ^ ^ ^ ^
. . . . ~ ~ . . . G . . . . . . . . . . . . . . . . o ^ ^ ^ ^ ^
. . . . . ~ ~ . . . . . . . k . . . . . . . . . . . . . . . . .
. . . . . . ~ ~ . . . . . F . . . . . . . f f . . . . . . . . .
. . . . . . . ~ ~ . . . . . . . . . . . . f f f . . . . . . . .
. . . . . . . . ~ ~ r r . . . . . . . . . . . . . . . . . . . .
. . . . . . . . . B ~ . . . . . r r . . b . . . G . . . . . . .
. . . . . . . . . . ~ ~ . . . . . . . . . . . . . . . . m m . .
. . . . . . . . . . . ~ ~ . . . . . W W W . . . . . k . m m . .
. . . . . . . . . . . . ~ ~ . . . . W W W W . . . . . . . . . .
. . . . . . . . . . . . . ~ ~ . . . . . . . . . . . . . . . . .
. . . . . . . . . . . . . . = ~ . . . . . . . . . . . . . . . .
. . . . . . . . . . . . . . . = ~ . X . . . . . . . . . . . . .
. . . . . . . . . . . . . X . . = ~ . . . . . . . . . . . . . .
. . . . . . . . . . . . . . . . . = ~ . . . . . . . . . . . . .
. . . . . . . . . . . . . . . . . . ~ ~ . . . . . . . . . . . .
. . . . . . . . . . W W W W . . . . . ~ ~ . . . . . . . . . . .
. . m m . k . . . . . W W W . . . . . . ~ ~ . . . . . . . . . .
. . m m . . . . . . . . . . . . . . . . . ~ ~ . . . . . . . . .
. . . . . . . G . . . b . . r r . . . . . . B ~ . . . . . . . .
. . . . . . . . . . . . . . . . . . . . r r . ~ ~ . . . . . . .
. . . . . . . . f f f . . . . . . . . . . . . . ~ ~ . . . . . .
. . . . . . . . . f f . . . . . . . F . . . . . . ~ ~ . . . . .
. . . . . . . . . . . . . . . . . k . . . . . . . . ~ ~ . . . .
^ ^ ^ ^ ^ o . . . . . . . . . . . . . . . . G . . . . ~ ~ . . .
^ ^ ^ ^ ^ . w w . . . . . . . . . . m m . . . . . . . . ~ ~ . .
^ ^ P ^ ^ . w w . . . . . . . . . . m m . . . . . . . . . ~ ~ .
^ ^ ^ ^ ^ . . . . . . . . . . . . . . . . . . . . . . . . . ~ ~
^ ^ ^ ^ ^ . . . . . . . . . . . . . . . . . . . . . . . . . . ~
```
(full map, point-mirrored) `^` main plateaus (side 1 top-right `2`, side 0 bottom-left `P`), `o` wells, `w` starter wheat, `f` Lower Farm wheat,
`W` the Golden Fields, `m` dairy meadows, `G` generator hills, `~` Crumb Creek, `=` the Mill Dam (centre, across the creek), `X` the Old Windmill ruin, `B` bridges, `F` fords,
`r` movable-rock lines, `k` neutral camps, `b` a cord-route choke.

## Zones (each one a Reach; 31 Reaches total)
| Zone | Per side | What's there | Why it matters |
|---|---|---|---|
| **Home Plateau** | 1 | Power Strip, a starter wheat plot, a **well** (small, slow water), one ramp | Safe start: you can make toast from minute 0, slowly |
| **Lower Farm** (natural) | 1 | a bigger wheat field and the first **creek inlet** (fast water) | The first expansion: your water problem is solved by reaching the creek |
| **Golden Fields** | 2 | huge, rich wheat on open flat ground near the centre, one on each bank | The flour race: big, exposed, the main fighting ground |
| **Butter Meadows** | 2 | dairy meadows on the far flanks, guarded by Grudge Kettles | Butter for buttered toast and veterans; far from home, cords must stretch |
| **Generator Hills** | 2 | high ground with generator sockets | Electricity: the hills overlook the fields (vision, and a cord hub) |
| **Crumb Creek** | 5 (shared) | the river, corner to corner; 2 bridges, 3 fords | Water for everyone; crossing it is the frontline |
| **The Mill Dam** | 1 (centre) | a broken dam with rock piles on both banks | Push the rocks to rebuild it: the dam makes the most electricity on the map **and** lowers the river downstream, opening new fords. The biggest prize in the game |
| **Old Windmill** | 1 (centre) | a neutral ruin with the toughest camp | Rare toppings (honey) and an item drop |
| **Wild Edges** | rest | plain ground, rocks, small camps | Room to lay cord routes and flank |

## How a match should flow (targets for the pacing and balance owners)
- **0–3 min:** make toast at home from the well and starter wheat; first Outlet toward the Lower Farm.
- **3–6 min:** reach the creek for water; race for your Golden Field; first skirmishes over cords at the fields.
- **6–10 min:** generator hills and meadows; Extension Boxes reach the centre; fights for the bridges and fords.
- **10 min +:** the **Mill Dam** fight. Whoever rebuilds and holds it powers a far bigger network and controls the
  river; the other side has to cut its cords or break the dam. The territory win (two-thirds of the Reaches) usually
  comes from here.
- **Cords shape everything:** nobody can rush the enemy base without laying a power line across the open valley first,
  so attacks are visible coming. Rocks and creek bends make natural chokes for cord routes.

## Readability (Quiet Battlefield rules)
Cool blue-grey ground; wheat is the brightest warm terrain; the creek a wide navy ribbon with lighter shallow bands at
fords; butter blocks on sage meadows; generator sockets with a lightning glyph; movable rocks pale and pentagonal;
dashed ivory Reach borders turning cyan or orange when powered.

## As built (sonnet, 10-23)
Drawn in code: maps/layout-wheatfield.mjs (Voronoi cells per side, point mirror), tests in tests/wheatfield-map.test.mjs. It is the default map for the territory match (env/map.mjs TERRITORY_DEFAULT_MAP); ?map=v4 and the other names still work.
Where the doc and the map differ, and why:
- 31 Reaches = 15 a side + the Mill Dam. The code has one centre Reach, so the Old Windmill is a single ruin on the north-east bank, not a Reach, and it is the one tile the mirror does not copy.
- Crumb Creek is 5 shared Reaches in the doc. Here the two Creek Banks a side are Reaches and the centre is the Dam.
- Fords: 3 cannot be point-symmetric, so there are 2 fords (a mirror pair) and the Dam gap is the centre crossing.
- The Dam gap is 4 water tiles on the centre line; 3 fords in a row make the dam (env/rocks.mjs). The lowered stretch downstream is extras.dam.lowered; riverWhenDammed(map, true) shows the river once built. The sim does not run pushes yet, so the dam is not live.
- Gates are open boundaries between Reaches; each plateau (Home, two Generator Hills a side) has one ramp to its longest lowland neighbour.
