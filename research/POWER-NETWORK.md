# POWER-NETWORK.md — Power Stations, Power Lines and cords that reshape the map

Joshua (23 Oct, 09:29): "deeply research how we make power stations so they can connect their cords better, and
how, when they do that, it stops others from going that way, so the terrain changes as you wrap around it,
because of the electric cords."

This is the research, then the design (it becomes TERRITORY.md section 21). It builds on env/power.mjs (section 20):
cords as leash, Strip/Outlet/Extension, battery, re-plug.

## 1. What other games teach us

| Game | Mechanic | Lesson for Toaster Wars |
|---|---|---|
| StarCraft (pylons) | A pylon projects a power field; buildings only work inside it; kill the pylon and they go dark; pylons double as wall pieces at the ramp | Power points should be **targets** and **wall pieces** at once. Losing one should visibly switch things off. |
| SC2 walling / force fields | Walls and force fields **change the terrain** temporarily; chokes decide fights | Lines should create **temporary chokes** the player builds. That is the "terrain changes" feeling. |
| Factorio (electric poles) | Each pole has **wire reach** (how far it links to another pole) and a **supply area** (what it powers). It auto-connects to every pole in reach that doesn't already share a neighbour, which keeps the graph tidy. Wire length is limited by the smaller pole. | Split each station into **link reach** and **plug radius**. Use auto-connect with the shared-neighbour rule so lines never become spaghetti. A link only spans the smaller station's reach. |
| Creeper World (collectors and relays) | Short links between normal buildings, **long links only relay to relay** (5 vs 11). Relays **hop islands** without running through enemy-held lowland. Losing one node splits the network. | Have a **cheap short station** and an **expensive long relay**. **Splitting** the network is the main raid goal. Storage (here, the Strip reserve) prevents death spirals. |
| Qix / Go / paper.io | Draw a closed line and the area inside becomes yours. Go: surround to capture. | A **closed loop of your live lines** (with cliffs, water and map edge counting as wall) **fences** the land inside. Fenced land is your territory. |
| Tron light cycles | Your trail is a wall for everyone else. The game is cutting off space. | Ground power lines **block enemy ground units**. Laying line is laying wall. |
| Tethered-robot path planning (robotics) | A tether **wraps around obstacles**; reachable space is a disc around the anchor that obstacles cut; **wrapping uses up length**; the tether's state is the list of obstacles it went around (homotopy / h-signature). | A unit's cord **bends around cliff and rock corners**, and every bend costs length. So **going around** a cliff shrinks a unit's reach, and terrain decides how far an army can go. |
| Rope / grappling-hook games (wrap-point list) | Store the rope as a list of wrap points. Add a point when the line from the last point to the tip hits a corner; remove it when the tip swings back across that corner's angle. | The exact, cheap, deterministic algorithm for cord wrapping on our grid (see section 4). |
| "Wrap Around It" (itch) | You control only the tip; you loop the rope around pivots on purpose. | **Wrapping on purpose** is a skill. Pegs (rocks, Extension Boxes) are tools. |

Sources: Factorio wiki (Medium electric pole); Knuckle Cracker wiki (Creeper World structures); Liquipedia
(SC2 walling); Kodeco grappling-hook tutorial (wrap/unwrap); Frontiers in Robotics and AI 2024 (tethered robot,
h-signature); eagle-studio "Wrap Around It"; Qix and Tron references.

## 2. The design in one line

**Stations throw power lines; live ground lines are fences only you can cross; close a loop and you fence the
land; every unit's cord bends around corners, so the map you can reach is shaped by what you wrap around.**

## 3. Power Stations (the pieces)

Each station has a **link reach** (to other stations), a **plug radius** (units plug into it) and HP.

| Station | Link reach | Plug radius | Line it makes | Cost | Role |
|---|---|---|---|---|---|
| Power Strip (base) | 10 | 14 | ground | — | Always lit (reserve). Lose it, lose the match. |
| Outlet (in a Reach) | 10 | 10 | ground | claim | Claims a Reach. |
| Extension Box | 6 | 8 | **ground** (fence) | cheap | Pushes power out. The **fence-builder** and the peg. |
| Relay Pylon | 14, **pylon to pylon only** | 4 | **high line** (does NOT block) | expensive | Hops rivers, cliffs and enemy land, Creeper-World style. Reach without walls. |
| Windmill / Dam | 6 | 0 | ground | site only | Energy. A network with none browns out. Mill Dam = the big prize. |

All numbers are starting values and will be tuned. A link spans at most the **smaller** reach of its two ends
(Factorio). Auto-connect: a new station links to every own station in reach that does not already share a neighbour
with it. Lines need line of sight on the grid: **ground lines can't pass through cliffs or deep water; high lines
can**.

The core choice: **an Extension Box line is short and makes a wall; a Relay Pylon line is long and makes no wall.**
Reach or denial.

## 4. Cords wrap around the terrain (unit cords)

- A unit's cord is a **wrap-point list**: anchor (its station), then corners, then the unit.
- **Wrap:** when the straight line from the last point to the unit would cross a blocked tile (cliff, rock, enemy
  wall), add the corner tile it bends around, using the grid supercover line, deterministic.
- **Unwrap:** remove the last corner when the unit swings back across that corner's side (the sign of the cross
  product flips).
- **Length used** = the sum of the segments. Moves stop when it would exceed the cord length. Corners are **cord
  sinks**: going around a cliff can cost 3–6 tiles of reach.
- **Pegs:** pushing a rock or dropping an Extension Box at a corner re-anchors the cord there. This is deliberate
  wrapping as a skill (Wrap Around It).
- Unit cords stay **tripwires, not walls**: an enemy standing on one cuts it (section 20). That keeps fights readable.
  Only station lines are walls.

## 5. Lines are fences: "it stops others from going that way"

- A **live ground line** blocks **enemy ground** movement across the tile edges it passes (supercover edges).
  Your own units, Bagels (air) and high lines pass freely.
- An enemy cord **can't pass through** your live line either. Their leash snags, so a fence also stops their power
  from creeping in.
- **Brown-out drops the wall.** A line on a network with no energy goes dark and becomes passable. Cut the Windmill
  and the whole fence falls: a big, readable swing moment.
- **Breaking a fence:** kill a station (lines attached to it vanish), Broiler shells break posts, or push a rock onto
  a line to **short** it for 10 s. Crumbs can't cut lines; only damage can.
- **Can't cross lines:** a new ground line can't cross an enemy line. That creates a **race to fence** the Golden
  Fields.

## 6. Enclosure: fencing land

- **Fenced:** a closed loop of your live ground lines, with cliffs, deep water and the map edge counting as walls.
  Every N = 48 ticks (2 s), flood-fill from the map edge or the enemy Strip over tiles the loop doesn't block; your
  tiles it can't reach are fenced (deterministic grid flood-fill).
- Fenced land counts as **your territory** (a Reach inside it is claimed without an Outlet). The enemy **can't place
  stations** there, and your wheat inside gets **+25% harvest** (safe farmland).
- Leaving a cliff or river side open is free; the terrain does half the walling. **Map knowledge = fence
  efficiency.**

## 7. No softlocks (must hold)

- No fence may enclose an enemy Power Strip, Outlet or Generator. Placement is refused if it would.
- Every player always keeps a ground path from their Strip to at least one open Reach. A line that would break this
  can't be placed (check by flood-fill on placement).
- Fences never block Crumbs from re-plugging their own units.

## 8. How it plays (phases)

- **Early:** Extension Boxes stretch toward the Lower Farm, with a small fence across your ramp (the StarCraft wall).
- **Mid:** race to fence the Golden Fields. One side fences; the other hops over with a Relay Pylon line and raids
  the Windmill to drop the fence.
- **Late:** the Mill Dam. Whoever powers it lights a long fence across the creek, and the map literally narrows.

## 9. Readability

- Ground lines: low charcoal posts with a thick glowing team-colour wire and a faint buzz. You can see it's a wall.
- High lines: tall blocky pylons with a thin wire overhead and a shadow on the ground. You can see it isn't a wall.
- Fenced land: a soft team-tint pentagon pattern. Dark lines: grey, with a flicker when shorted.
- Cords show their bends: a little peg-dot at each corner, and the reach ring shrinks live as you wrap.

## 10. Build order (for the swarm)

1. env/power.mjs: station kinds, link reach and plug radius, auto-connect with the shared-neighbour rule,
   ground/high lines, line of sight (tests first).
2. Line-edge blocking in movement for enemy ground units (supercover edges), repath on change, brown-out unblock,
   placement refusal on crossing.
3. Cord wrap-point list: wrap, unwrap, length used, pegs.
4. Enclosure flood-fill every 48 ticks, plus the no-softlock placement checks.
5. HUD and render: posts, wires, high pylons, fenced tint, peg dots, shrinking reach ring.
6. Bots: the Match Room bot builds a ramp fence and races to fence the Golden Fields; the Reporter reports fences.

## 11. GPT's review (23 Oct). ADOPTED: these override sections 3-7 where they differ

GPT's verdict: 8/10, and 9.5/10 with these changes. The danger is that the best strategy becomes "build an
impenetrable fence" instead of commanding toaster armies.

1. **Power graph and fence graph are separate.** Power links auto-connect deterministically, may form cycles and
   never block. Replace the order-dependent shared-neighbour rule with: link to the nearest K = 3 stations in reach,
   ties broken by id. A **fence is an explicit order**: a player activates a ground link as a fence. Fences cost
   **1 energy per 8 tiles** as upkeep.
2. **Enclosure is contestable and bounded.** A loop needs at least 3 stations and fences a bounded area (cap 400
   tiles). Capture takes **6 s held**, so the enemy can react. The wheat bonus is **+15%**, capped.
3. **Brown-out is local, not one global switch.** Each connected component has its own capacity. On overload, shed
   loads in order: wheat bonus, then fences, then military supply, always keeping a small essential reserve.
   Restored power takes a **2 s restart**.
4. **Visual layers:**
   - Powered fence: a solid team-colour rail.
   - High relay: a thin elevated dashed beam that never blocks.
   - Unit cord: a thin dark cable, drawn prominently only when threatened.
   - Browned-out fence: a dim rail with occasional sparks.
5. **Cord routing is cheap and event-driven.** Use a visibility graph around obstacle corners, with **at most 3 wrap
   points**. Routes are cached and recomputed only when a unit changes anchoring region or an obstacle moves.
6. **No accidental spaghetti deaths.** An enemy crossing a cord **threatens** it (it flashes red) but does not cut it.
   Cutting is an explicit attack or a short deliberate interaction. This changes section 20's walk-over cut and
   needs agreement with the cord-leash owner.
7. **Numbers:**
   - Extension Box link reach 8.
   - Relay Pylon reach 16.
   - Rock short 5 s.
8. **No softlock, relaxed:** every player keeps a **reachable** neutral expansion route. It doesn't have to be
   **safe**, so real encirclement is still allowed.
9. **Signature moment, "The Great Unplugging":** when a station dies, its cords recoil to the surviving anchors with a
   FWIP, and edge toasters hop back with flickering eyes. A broken dam changes the river, exposing crossings or
   flooding low outlets. **The battlefield visibly rearranges when the network changes.**
