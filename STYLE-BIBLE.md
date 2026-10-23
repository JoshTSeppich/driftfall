# THE TOASTINATORS: Visual Style Bible v1.0, "Five-Sided Fury"
Designed with GPT (ChatGPT, Joshua's plan) at Joshua's request (20:29: "unique and cute... distinct, but our own").
This is the rule book for the Design Studio (play/style-lab.html), every model, every animation and all art.


## 0. BLOCKY REVISION (Joshua, 10-23 08:21: "go way simple, geometric and blocky") — overrides the sections below where they differ
- **Every toaster is a few plain blocks.** Body = one box (a toaster is a box). Feet = two small boxes. Toast = one
  thin slab sticking out of the slot. Face = a dark inset panel with two small square/trapezoid eye blocks. That's it.
- **2–4 parts per unit** (body, toast, feet as one or two pieces, optional one prop), each a box on its own pivot.
- **No bevels, no greebles, no rounded anything.** Where something must read as round (a dial, a wheel), use the
  five-facet prism, but most units should need none.
- **Under ~60 triangles per unit.** Silhouette by proportion only: Crumb = small cube; Popper = taller box with a tall
  slab of toast; Zapper = box with two short block emitters on top; Four-Slice = a wide, long box with four slabs;
  Broiler = a box with a hinged front panel; Bagel = a short pentagonal prism wheel.
- **Colour does the work:** flat cream body, charcoal face panel, team-colour block on top or shoulder, golden toast.
- Motion stays the same (hop, clunk, toast pops); simpler parts make it snappier and cheaper.

## The idea
The Toastinators are tiny, highly disciplined war machines who happen to be kitchen appliances. **They don't know
they're adorable.** They think they're an elite mechanised army: every hop is a military manoeuvre, every slice of
toast is ammunition, every burnt crumb is a casualty of war. It should feel like a forgotten 2002 strategy game
redesigned with modern art direction: bold shapes, unusually satisfying animation, minimal geometry, instantly
recognisable.

## 1. Shape language
- **Five facets, always.** No spheres, cylinders or rounded corners. Every curved-looking part is a five-sided
  prism, pentagonal dome or five-sided joint. This constraint IS the signature.
- Pentagonal hardware: five-sided vents, hinges, bolts, feet and muzzles.
- Silhouettes are **top-heavy and squat**, like confident little soldiers in armour several sizes too big. Faces and
  toast slots stay visible from above.
- Every unit shares three features: the five-facet chassis, a dark expressive faceplate, a toast-slot silhouette.

## 2. Units (rigid animated parts)
| Unit | Silhouette | Parts |
|---|---|---|
| **Crumb** | tiny, pear-shaped, enormous toast slot, little feet | 4: body, two feet, toast |
| **Popper** | stocky brawler, tall armoured toast sticking out of its slot | 5: body, two feet, pop-up striker, brow |
| **Zapper** | leaner, tilted forward, two raised five-sided coil emitters | 6: body, two feet, two emitters, faceplate |
| **Four-Slice** | nearly twice Crumb's height, wide armoured double toaster | 6: body, two feet, two toast assemblies, brow |
Same design family, different silhouettes, never different art styles.

## 3. The face: four shapes, lots of personality
A recessed charcoal **faceplate**, two luminous **trapezoid eyes**, an optional floating pentagonal **brow plate**.
No mouths, noses or hair. Expressions are mechanical:
- **Determined:** narrow, inward-sloping eyes. **Proud:** raised brow, wide bright eyes, chest forward.
- **Alarmed:** eyes become tall pentagons; toast jumps up. **Angry:** brow pivots down; the heating slot glows.
Comedy comes from exaggerated seriousness, not goofy smiles.

## 4. Palette
| Name | Hex |
|---|---|
| Bread Cream | #F2D7A6 |
| Toasted Gold | #D99448 |
| Charcoal Iron | #303844 |
| Crust Brown | #805432 |
| Team Cyan | #32D9E8 |
| Team Orange | #FF8540 |
| Heating Red | #F25745 |
| Studio Ivory | #F7F4EB |
Team colour lives on a replaceable pentagonal shoulder plate, front rim or back stripe; the chassis stays cream and
charcoal so the faction reads first and the team second.

## 5. Materials, light, outline
Painted enamel, matte ceramic, brushed charcoal metal, softly glowing heating elements; the toast is a beautifully
flat-shaded golden polygon. Warm key light from upper left, cooler fill, short contact shadows; facets clearly
different values; no texture maps. Dark charcoal outlines (inverted hull or edge shader), thinner on the face.
No photorealism, rust, scratches or complicated machinery: geometry does the work.

## 6. Motion personality: funny because it's precise
- **Hop:** the chassis tilts back, both feet snap up, it jumps with almost no anticipation.
- **Land:** a hard, satisfying *clunk*; the toast rises from the slot, then drops back.
- **Attack:** Popper launches its toast like a spring-loaded fist; Zapper's emitters recoil; Four-Slice braces
  for a massive synchronised pop.
- **React:** bodies rock rigidly on their feet, brows rotate, toast rattles.
- **Stepped, snappy movement and strong poses. No soft-body squish, no rubbery limbs.**

## 7. Do / Don't
| Do | Don't |
|---|---|
| Make every silhouette recognisable in pure black | Add realistic rounded corners or smooth cylinders |
| Build everything around five-sided geometry | Add tiny details that vanish from the strategy camera |
| Exaggerate slots, toast and body width | Turn them into humanoids with arms and legs |
| Make attacks visually ridiculous but emotionally serious | Use constant wacky faces or random comedy props |
| Make each animated part independent and reusable | Add joints, cables or hinges that need complex rigs |

**Production test:** at 64 pixels you recognise the Crumb by its oversized slot, the Popper by its raised toast, the
Zapper by its twin emitters, and the Four-Slice by its enormous width.

## 8a. Grid tileset (Joshua, 10-23 08:29): classic-RTS, very grid-like. Square tiles, grid-aligned cliffs with straight
edges and 45° corners, wide wedge ramps, rectangular buildable base areas. Terrain resources are only WHEAT (fields
near each base) and WATER (river and ponds, tapped by Pumps); power comes from WINDMILLS (windmill pads on high
ground) and DAMS (dam sites on the river). No meadows, butter blocks or generator sockets on the map.

## 8. Terrain: "The Quiet Battlefield" (designed with GPT, 20:42; Joshua: "build the terrain with GPT, sharp contrast")
**The world is quieter than the Toastinators.** Terrain is the stage, never the show: a miniature geometric
landscape (chunky polygons, five-sided rocks, angular rivers, simple farm shapes, crisp elevation).
Attention, highest to lowest: **units and team colour → interactive resources → Reach borders and objectives →
elevation and paths → decoration.**

**Value and hue:** cool, low-saturation, mid-dark terrain, so the pale cream chassis separates instantly. Ground is
muted blue-grey (never bright grass). High ground slightly lighter but still cooler than units; cliffs darker than
their plateaus. Water cool, moderately dark blue, pale cyan only for flow and dams. Wheat is the brightest warm
terrain feature but less saturated than our toast. Meadows subdued sage with butter-yellow markers. **Team cyan and
orange are the most saturated colours on the map.**

| Surface | Hex | Surface | Hex |
|---|---|---|---|
| Base ground | #52696B | Wheat | #C9A65E |
| High ground | #71878A | Dairy meadow | #77977C |
| Cliff faces | #303F48 | Generator site | #516A79 |
| Ramps | #89918A | Movable rocks | #A0A7A0 |
| Shallow water | #367D8A | Neutral Reach border | #CAD3CD |
| Deep water | #244E67 | Our Reach | #32D9E8 |
| Dammed water | #499CAA | Enemy Reach | #FF8540 |
| Fog of war | #26353F | | |
(Base material targets; check at real zoom with the real lighting.)

**Five-facet terrain:** pentagonal boulders with five dominant faces; cliffs from large angular segments with dark
side faces (no noisy rock meshes); ramps wide, few big facets, a distinct neutral stone value; riverbanks meander but
in straight segments; five-blade wheat tufts, five-petal meadow flowers, lots of negative space. The rule governs
local forms; a whole cliff or river can have many sides.

**Resources at 64 px (one shape = one resource):**
- **Wheat → flour:** dense golden five-stalk bundles in contiguous golden plots.
- **Dairy meadow → butter:** sage ground with oversized golden **butter blocks** (the butter IS the symbol).
- **River → water and dam energy:** a wide navy ribbon, lighter shallow band at the banks; a dam is an unmistakable
  rock barrier across the river with a pale cyan spillway / energy pulse.
- **Generator site → energy:** a big five-sided industrial socket with a bright lightning-glyph recess; buildable
  when empty, obviously occupied when built.
- **Movable rocks:** oversized light-slate pentagonal blocks, clearly brighter than cliffs, with a light edge and a
  readable shadow, so you discover they're pushable.

**Reaches:** borders at region level, constant screen-space width. Neutral = ivory-grey dashed; ours = continuous
cyan; theirs = continuous orange; plus a shape difference for colour-blind players. At most a thin transparent tint;
never recolour resources or flood regions with team colour.

**Fog on a 256 × 256 map:** keep the geography readable. Unexplored = near-solid slate with a subtle angular edge;
explored-but-unseen = darkened, desaturated, no live enemies; visible = full palette; fog edges are broad
five-segment polygons, no smoke. Zooming out, decoration disappears first; units, resources, cliffs and borders last.
**One action, one dominant visual cue:** push a rock into the river and you see the blockage, the water level change
and the new generator opportunity, with no panel needed.

**Do:** keep terrain darker and less saturated than units; make movable rocks unmistakable; show elevation with dark
cliffs and wide ramps; give each resource its own colour AND silhouette; show ownership with thin continuous lines.
**Don't:** vivid grass or glowing edges everywhere; identical interactive and decorative stones; paths hidden by
foliage or thin slopes; colour alone to tell flour, butter, water and energy apart; opaque team-coloured regions.

**Acceptance test:** shrink a gameplay screenshot to 720p, then to a thumbnail. You can still find your units, the
major resources, river crossings, ramps and Reach ownership without hunting.
