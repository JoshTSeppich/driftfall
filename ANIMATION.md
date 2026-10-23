# Animation: beautiful, flawless, still geometric (Joshua, 19:38)

> "What animations are needed to make this beautiful and flawless but still geometric and cool? Ask the swarm and
> identify new experts to weigh in."

Direction: early-2000s, GEOMETRIC, nostalgic (Joshua, 19:37): faceted low-poly / Y2K gloss / inked cel-shaded were
the three options shown to him; the panel designs motion that works in any of them and recommends which fits best.

## The panel (new experts)
| Expert | Weighs in on |
|---|---|
| Animation Director (lead) | the whole list, priorities, the "geometric motion language", final merge |
| Technical Animator | procedural/rig-free animation in code: squash and stretch, slither waves, IK-free tricks, interpolating 24 tps sim to 60 fps |
| VFX Artist (geometric) | hits, deaths, spells, crystals, Drift events, all as shards, facets, rings and lines, never mush |
| UI Motion Designer | buttons, tooltips, cards, the market ticker, alerts, minimap pings, edition banners |
| Camera & Feel Designer | camera moves, shake, hit-stop, zoom, the watch-mode caster camera |
| Rendering Engineer | shaders for the style (flat/faceted, outline, gloss), instanced animation so 200 units hold 60 fps |
| Readability Critic | every animation must make the game easier to read at a glance, never busier |

## Starter checklist (the panel adds, cuts and ranks)
- **Units:** spawn, idle (breathing/coil), move (slither wave), turn, attack windup + strike + recoil, hit react,
  death (shatter into facets), gather, carry, deliver, build, rank-up, item pickup glow, Recall/Shed Skin, selected.
- **Buildings:** placement ghost, construction (assembles from geometric pieces), idle life, producing, damaged
  stages, destroyed (collapse into shards), Trading House prices ticking.
- **World:** crystal shimmer and depletion, Drill/Track/Press motion, neutral camps idle and alert, Drift events
  (Bloom rising, Dry-out fading, Flood filling in steps, Quake cracking in facets, Squall sweeping band, The Fall
  crumbling), fog edges, day light.
- **UI:** button press/hover, cooldown sweeps, tooltips, selection boxes, rally lines, alerts, price arrows,
  minimap pings, territory border pulses when contested, edition reload transition.
- **Camera:** smooth edge-scroll acceleration, jump-to-alert glide, small shake near big hits, hit-stop on kills
  of big units, caster camera in watch mode.

## Panel sections
(each expert writes theirs below; the Director merges into a ranked FINAL LIST at the top with owner + done-when)

### VFX Artist (geometric)

Rule of the discipline: every effect is built from flat facets, hard edges and thin lines. Soft round glow and
smoke read as mush at 200 units. Ink-edged, flat-coloured shards in the team colour are the signature.

Today (checked in code): `viewer3d/vfx.mjs` already has hits, explosions with debris, beams, rings and build pulses,
with pooled buffers and no per-frame allocation. Two things fight the style: the glow and smoke sprites are soft
round blobs (`GLOW_FRAG` uses a `smoothstep` falloff, `SMOKE_FRAG` is a blended puff), and the debris is a single
generic chunk. Fix those first; the rest is timing and shape.

Ranked:
1. **Death = shatter into facets.** Ink-edged triangular shards (4-6 for a Worker, 10-14 for a Brute), team colour
   on the outside, the hull colour inside. Fly outward on a ballistic arc, spin on one axis, shrink in the last 150 ms.
   Timing: burst 380 ms ease-out, gone by 600 ms. Done when a Grunt dying in a crowd reads as a bright shard fan,
   not a blob. Owner: sonnet (vfx pass), haiku checks the counts.
2. **Hit = a flat ring plus a 2-frame flash.** The existing 160 ms ring (`feel.mjs` FLASH_MS), the hull flash in
   `units-instanced.mjs` (HIT_FLASH_SECONDS 0.14), and 4-6 tiny triangle sparks at 180 ms. No glow halo. Done when
   you can see which unit took damage from the overview camera.
3. **Attack strike, two shapes.** Ranged: one straight bright line from shooter to target, 90 ms, snap in and out
   (no fade). Melee: a three-facet fan wedge on the target's ground, 140 ms, team colour. Done when attack direction
   is readable in a crowd without the health bars.
4. **Drift events as shapes, not weather.** 30 s warning: a faint hexagonal outline on the affected Reach, pulsing
   at 1.2 Hz for 4 pulses. Then the event itself, all stepped (3-4 discrete steps, no smooth tween):
   Bloom = petal fans rising in 3 steps (400 ms each); Flood = a flat plane stepping up one tile-height at a time;
   Dry-out = tiles desaturate in 4 steps; Quake = crack polylines drawn out over 300 ms; Squall = a band of diagonal
   chevrons sweeping 1.5 s; The Fall = the Reach's tiles drop and split into shards. Done when a player who never
   read the banner still knows what is happening.
5. **Construction assembles from parts.** A building drops in 3 flat plates, 120 ms each, 60 ms apart, no tween.
   Completion: two concentric ink rings, 350 ms (the existing build pulse, re-shaped). Done when a finished Forge
   looks built, not faded in.
6. **Crystal shimmer and depletion.** Shimmer = one bright diagonal line sweeping across each crystal every 2.4 s,
   phase set by the entity id so the map never pulses in unison. Depletion = the crystal steps down in 3 facet
   sizes and throws 2 shards. Done when a depleting patch is readable from across the map.
7. **Recall and Shed Skin.** Recall: the unit shrinks into a vertical stack of 5 flat prisms and climbs out, 500 ms.
   Shed Skin: the same stack falls and splits. Done when a ranked unit leaving the field is obvious.
8. **Shard delivery and item pickup.** Delivery: 3 sparks rising 220 ms (existing sparkles, trimmed). Pickup: a
   small gold four-point star, 300 ms, one per item. Done when a drop is spotted without the minimap.
9. **Selection and rally.** Selection = four ink corner brackets that snap on in 90 ms (no fade). Rally = a dashed
   straight line that the dash moves along once. Done when a box-selected group reads as a group.

How it stays cheap (60 fps, 200 units):
- Everything goes through the existing pools. Glow, smoke and debris have fixed caps; add a global effect cap of
  64 active effects and drop the lowest-priority new ones past it (small hits first, deaths of big units last).
- Coalesce per tick: 20 deaths in one tick become one shared shatter at the centroid, scaled, not 20 bursts.
- Effects are timed from sim ticks (24 tps) with the frame `alpha`, so they stay smooth at 60 fps without new state.
- Facets are flat-shaded, no per-effect lights, no extra render passes. Debris is one `InstancedMesh`; shards and
  sparks share one geometry each.
- Quality drop: `quality: 0.5` (already in `render.mjs`) halves the caps and skips the Squall chevrons and the Quake
  cracks, so low-end machines keep the same readable shapes.

Never: floating dust, smoke that hangs, glow halos, full-screen flashes (except The Fall and a Core loss), or any
effect that lasts past 1 s unless it marks a Reach or a live Drift event.

### Camera & Feel Designer

**What exists today (read in play/camera.mjs, play/feel.mjs, play/app.mjs, play/watch.mjs):** edge-scroll and arrows
move at a fixed speed with no ramp; wheel and +/- zoom snap to the new height; `centerOn` (alerts, minimap clicks)
teleports; hit flashes are a 160 ms ring and a 200 ms shake of 0.15 tiles on hits within 10 tiles; the watch caster
camera already eases with `glide()` (rate 1.8, capped at 30 tiles/s). There is no hit-stop. The only ease is in watch mode.

**Principle:** the camera is a pure function of the rig, so every move is a couple of numbers per frame. Nothing here
touches the 24 tps sim: it is presentation over the interpolated state in app.mjs. Camera never moves while the player
is box-selecting, placing a building, or dragging, so the eye stays put when hands are busy (Readability Critic's rule).

Ranked:

1. **Glide, don't teleport (alerts, Drift warnings, minimap jumps).** `centerOn` snaps today. Route alert jumps and
   the 30 s Drift warning through `glide()` (rate ~6/s, ~350 ms to settle, max 40 tiles/s). Geometric treatment: the
   minimap gets a thin diamond ping at the target that shrinks over 400 ms, so you see where the eye is going.
   Cost: two floats per frame. Done when: pressing an alert key moves the view in one visible sweep, and any player
   input cancels the glide the same frame.
2. **Edge-scroll ramp.** Velocity eases from 0 to full over 250 ms and back to 0 over 150 ms when the pointer leaves
   the edge. Stops the "jerk when the mouse touches the edge" feel, which is the most common complaint in RTS playtests.
   Cost: one scalar per frame in `rig.velocity()`. Done when: a 1 px edge touch moves ~15% speed for the first 80 ms.
3. **Smooth zoom.** Wheel and +/- set a target height and ease toward it with a 180 ms half-life, clamped to
   min/max as now. Geometric treatment: the ground plane scales as one clean facet step, never a pop. Cost: one
   float. Done when: five wheel notches animate in under 300 ms with no overshoot.
4. **Hit-stop on big kills (presentation only).** On a `die` event for a ranked troop or a Core, freeze the render
   interpolation alpha for 70 ms (not the sim tick), and flash a white inked ring (already in feel.mjs, scaled 1.6x).
   Geometric treatment: the freeze reads as a camera-held beat, like a comic panel. Cost: one timestamp check.
   Done when: a Core kill in a replay holds one frame of stillness and the sim ticks stay identical (replay hash test).
5. **Directional shake and a Core-under-attack thud.** Keep the 0.15-tile shake, but make its direction the hit's
   vector (not the sin/cos wobble), and add a 400 ms, 0.25-tile thud only when your Core is hit and in view.
   Geometric treatment: a hard shove along the facet axis, no rotation (rotation makes the tilted view nauseating).
   Cost: a vector and a decay per event. Done when: a Core hit shakes once, a far hit does not shake at all.
6. **Caster camera dwell (watch mode).** Hold on a fight for at least 1.2 s before switching, and switch only to
   events scored above the current one by 30%. Stops the whip-pan the caster camera does at 2x speed. Cost: a
   timer and a score per event. Done when: a 10-minute seeded watch never switches focus more than once every 1.2 s.

Not for v0.1: camera roll, zoom-to-cursor pivot, depth-of-field, motion blur. They fight the flat, inked look and
add per-frame cost for little readability gain.

Joshua's view after 1-3 land: smoother camera with no snaps; after 4-5: fights feel heavier with no extra clutter.
Owners: play/feel.mjs (haiku, per its header). play/camera.mjs and play/watch.mjs: owner not stated in their headers, so
the lead should assign; I have not edited either.

### Rendering Engineer

**What exists today (read in play/units-instanced.mjs, play/render.mjs):** units are instanced meshes (about 17 draw
calls for 200 units). `instanceTransform` already does walk bob/roll, attack lunge+pitch, mine tick, spawn pop
(easeOutBack), death topple-and-shrink, hit-flash jitter, all as instance matrices on the CPU, plus a per-instance
`aState` flash in the shader. There is **no outline pass, no flat/faceted shading rule, no shard pool, no vertex-shader
animation**. The look is MeshStandardMaterial with vertex colours, so lighting is smooth, not early-2000s geometric.

**Style pick:** faceted low-poly with a thin ink outline (agree with the Director and Technical Animator). Faceted
shading is free (`flatShading` / derivative normals), and an outline is what makes 200 same-shaped units readable.

**Rule that keeps 200 units at 60 fps:** animation lives in the vertex shader or in one instance matrix, never in
per-unit objects; every effect is a pooled instanced mesh with a hard cap; all timing is a pure function of
`(tick + alpha)`, no `Math.random` (seeded by unit id), so replays look identical. Budget: 1.5 ms GPU + 2 ms CPU per frame
at 200 units on a mid laptop; stats.draws must stay under 40.

Ranked:

1. **Faceted shading + ink outline (the style itself).** Flat normals in the unit and building shader
   (`normalize(cross(dFdx(p), dFdy(p)))`), and a 1.5 px inverted-hull outline: a second draw of the same instanced
   mesh, front faces culled, vertices pushed 0.02 tile along the normal, solid near-black team-tinted ink. Selected
   units' ink swells to 2.5 px over 100 ms (ease-out) and turns white; enemies under the cursor go red. Cost: one extra
   draw per batch (about +17 calls), no post-processing, no extra buffers. Done when: a 200-unit screenshot shows every
   silhouette separated from the ground, and perf stays within the current 2x-baseline gate.
2. **Slither as a vertex-shader wave (identity, zero CPU).** Snakenators and Worms bend by `x += sin(k*z - w*t) * amp * (z-weight)`
   in the vertex stage, with `t` = per-instance walk distance (not wall time) so the wave stops the instant the unit
   stops. Amplitude ramps 0 -> full over 120 ms on move start and back over 160 ms on stop (one per-instance float,
   `aMove`). Geometric treatment: the body is 5 rigid-looking segments, so the wave is stepped (quantize phase to 4 steps),
   which keeps the faceted look instead of rubber. Cost: a few ALU ops per vertex, no matrices. Done when: 200 moving
   units add under 0.3 ms GPU and the wave halts with the unit.
3. **Death shatter on a pooled shard mesh.** On a `die` event spawn 5 triangle shards (buildings 12) in one
   InstancedMesh of 512 triangles: team colour, velocity from the hit vector, gravity, spin, fade by scaling to 0.
   Units 450 ms, buildings 900 ms (plus a 1-frame white flash on the first frame). Ring-buffer pool: when full, the
   oldest shard is recycled, so a 100-unit wipe never allocates. Shard state is a function of `(tickDied, tick+alpha)`:
   no per-frame object updates, the vertex shader computes position from age. Cost: one draw call, zero JS per shard.
   Done when: killing 100 units at once holds 60 fps and shard count never exceeds 512.
4. **Windup, strike, recoil with a hit decal.** Today only a lunge exists. Use a single 90/70/140 ms curve (Director's
   set) in `instanceTransform`; the strike frame also pops a 4-spoke white spark (one instanced quad, 120 ms, scale
   1 -> 0.3) at the target, and the target gets the existing flash for 80 ms. Cost: a shared curve and one pooled quad
   mesh (cap 128). Done when: a unit with a 1 s cooldown visibly telegraphs the swing 90 ms before damage.
5. **Selection ring and order markers as instanced geometry.** Hex ring (not a circle: faceted) pops 0 -> 1.15 -> 1 over
   120 ms; the move order drops a contracting hex ping for 300 ms, attack orders a red one with 4 inward ticks. One
   instanced ring mesh already exists, so this is a per-instance scale curve. Cost: no new draw calls. Done when: a click
   always answers within one frame.
6. **Construction assemble and idle life for buildings.** Buildings rise in 4 stages (each a stepped scale/clip-Y on
   the existing mesh via a `uProgress` uniform, 0.25 steps with a 1-frame flash per step), not a smooth lerp. Idle: a
   slow 2.4 s emissive pulse on glow strips, `sin` in the fragment shader (no CPU). Producing: strip pulse speeds to 0.8 s.
   Cost: a uniform per building batch. Done when: progress is readable from the shape alone, no health bar needed.
7. **Crystal shimmer and depletion.** Crystals get a 3 s facet sweep (a bright band that travels across the mesh via
   `fract(worldX*0.3 - t*0.33)` in the shader, no texture) and shrink in 4 steps as the stock drops. Rich patches use a
   warmer band so the gold read matches the rule that Rich looks different. Cost: one shared material. Done when: a
   depleted patch is distinguishable from a full one at minimap zoom.
8. **Drift events as shader-driven world animation.** Flood = a water plane stepping up in 3 discrete levels; Quake =
   terrain facets offset by a 2 Hz vertex displacement pulse, 1.5 s, ground only; Squall = a diagonal band moving across
   at constant speed with a hard edge (flat colour, no gradients). All driven by one `uDrift` uniform struct; no
   per-tile objects. Cost: a few uniforms and a plane, under 0.2 ms. Done when: a 30 s warning is visible as a ghosted
   edge before the event lands.
9. **Fog edge as a stepped dissolve.** Fog already draws as a shader overlay (play/render.mjs); fade alpha toward the new
   value over 200 ms using the fog texture's previous and current values, quantized to 3 steps for the faceted look,
   instead of popping when vision changes. Cost: one extra texture read. Done when: moving a unit no longer pops fog
   edges.

Cuts (fight the style or cost too much): bloom, SSAO, shadow-casting for units (keep the one cheap disc shadow),
skinned meshes, physics ragdolls, per-unit particle emitters, motion blur, real-time reflections for the glossy look
(fake gloss with a fixed specular band in the shader).

**Cheapness checklist for every animation above:** pooled with a cap, state derived from `(tick + alpha)`, seeded by id,
no allocations per frame, no extra textures, at most one draw call added per kind. Add each to `play/perf-scenario.mjs`
and keep the existing 2x-baseline gate green.

Joshua's view after 1: every unit and building has a crisp inked, faceted silhouette that reads at a glance; after
2-3: snakes visibly slither and units shatter on death. Owners: units/buildings shaders and pools in
play/units-instanced.mjs and viewer3d (fable); wiring and tests in play/ (sonnet); the shard and spark pools in
play/feel.mjs (haiku).
