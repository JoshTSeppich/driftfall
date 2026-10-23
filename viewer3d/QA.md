# viewer3d QA punch list (owner: fable, 3D visual QA and performance)

Plain English, one line per problem, the owner's name on each. Checked by `node --test tests/viewer3d-integration.test.mjs`
(parses, contract exports, index.html wiring, manifests, roster coverage, world.mjs correctness and speed, every scene
system fed real frames from matches/sample-7.json with real Three.js in node) plus reading the code. Nothing here has been
seen on a real GPU yet: nobody on the 3D team can open a browser headless, so Joshua's first look will add items.

Last run: 2026-10-22 22:17 UTC, 66 checks, 61 pass, 5 red on purpose (P1 Core before 3:00 against the default and
the built-in normal AI, P2 opening camera in app.mjs and camera.mjs, and play/app.mjs still wiring the slow unit path).
The harness also feeds every system a scripted fight match (real sim, seed 7: Forge, Turret, Grunts, Lancers, Core
attacks) so hit, die, done and spawn events are exercised; runs a 200-unit stress frame through both unit renderers;
and builds the whole Classic renderer (play/render.mjs) headless under a proxy WebGL context, steps 30 frames, checks
no system was switched off, picks a unit and takes a fog mask (ported from the Classic renderer fable's script).

## Joshua's Classic playtest (21:52, play/index.html), both pinned as failing checks in the harness

P1. **DEFEAT "A Core fell" at 0:10.** Reproduced in node: with the human idle on seed 7, the page's default AI
    (players/sonnet/bot.mjs) first hits the human Core at tick 239 (10.0 s) and kills it at tick 259 (10.8 s). The
    built-in AI on normal kills it at 101.6 s; easy never touches it in 3 minutes. Cause (Live Driver and haiku agree):
    the v2 stats were tuned for a tick as a turn; at 24 ticks a second units walk 24 tiles a second, a Grunt trains in
    0.6 s and damage lands every tick. The check demands no Core before 3:00 against the default and built-in normal
    AIs. Owners: stats rescale (haiku's numbers, stats owner applies), Classic AI wave timings (sonnet), and the page
    should default to the built-in AI once wired (sonnet, app.mjs).
P2. **Opening camera off-centre with dark empty areas.** play/app.mjs createCameraRig centres on the Core at (3, 3)
    with zoom 24 tiles, so the ground in view runs x -18..24, y -12..18 and 66% of the view is void past the map edge.
    play/camera.mjs does the same. The check demands the Core in view and at most 25% off-map; fix with a clamp like
    play/render.mjs clampCenter and its margin (the centre lands near (19, 13)). Owner: Playable Client (sonnet).

## Seen by Joshua in a real browser (21:20, viewer3d/index.html?log=../matches/latest.json)

Good: Shard crystals glow with real bloom and shrink as mined, Workers move and mine with team rings, HUD and minimap
layout reads well. Broken, by owner (Integration squad D is covering the paused haiku):

J1. **hud.mjs (haiku):** playback stuck at tick 0 although the button says playing, and the HUD numbers never update.
    Scrubbing works. Read of the code: the engine advances its clock before running systems and Joshua saw Workers
    move, so the scene is playing; only the HUD is dead, switched off by the engine after the undeclared `audio`
    variable throws on its first update (item 1 below). One fix covers both.
J2. **camera.mjs (haiku):** far too close, mouse-wheel zoom does nothing, bases off-screen. Read of the code: default
    distance 22 tiles and maxDistance 40 on a 40-wide map, so even full zoom-out cannot show both bases; wheel steps are
    exp(deltaY/1000), tiny on a trackpad. Raise the defaults for the map size (overview about 1.3 times the map width,
    max about 2 times), and make a wheel notch at least 10 percent. CLASSIC.md now asks for a fixed tilted camera with
    edge-scroll and minimap clicks, so the orbit may go anyway.
J3. **terrain.mjs (sonnet):** rock pillars dominate and hide units; make them lower and sparser and lighten the floor
    so units read. Remove or soften the floating tan cubes and the diagonal streaks, which read as noise.

## Factions (Joshua, 21:25): The Coil (side 0, cyan cybernetic serpents) vs The Burrow (side 1, amber wombats in exo-rigs)

- Each side gets its own roster built from the same roles, so unit kinds will become per-faction. The harness's
  roster check reads `env/stats.mjs`; once per-faction kinds land there (whatever shape the design trio agrees), the
  check follows them and units.mjs/buildings.mjs are held to rendering every kind of both factions.
- Style reference is concept/workers.html (Siphoner tail-drill with spine canister; Digger drill-claws, headlamp,
  ore cubes in a back crate). Readable at RTS distance is the bar.

## New bar from CLASSIC.md (21:21): what the 3D pieces must now meet

- 200 units on screen at 60 fps, drawn with instancing. The harness feeds units.mjs a synthetic 200-unit frame and
  reports CPU ms per update and mesh count; see the report line "units.mjs stress".
- No floating particles. terrain.mjs dust motes and vfx.mjs embers/smoke at rest need a look (sonnet); Joshua's
  "floating tan cubes" are likely the terrain pebbles or motes.
- Fixed tilted camera, edge-scroll, minimap click; fog of war with unexplored/explored/visible; big silhouettes.
- 24 ticks per second: world.mjs frame(t) at 0.01 ms is fine; vfx and units must not allocate per tick.

## Broken (will show on screen)

1. **hud.mjs (haiku):** `isMuted()` reads a variable called `audio` that is never declared, so `update()` throws a
   ReferenceError on the first frame. The HUD will die in the browser too, not just in node. Take it from the options
   object (the header comment says it is optional) or from `ctx.audio`.
2. **terrain.mjs (sonnet):** the sky dome (radius 900 tiles) and the moon (about 790 tiles away) sit outside the camera's
   far plane. The engine raised `far` to at least 320 tiles for this, so the dome must shrink to under 300 tiles and the
   moon must move inside that too, or the sky stays flat fog colour. Also, per the engine's fog AGREE, terrain should drop
   its own `scene.fog` and `scene.background` now that the engine sets both from palette.mjs FOG.
2b. **hud.mjs (haiku):** the scrub slider's maximum is ticks minus 1 while frame(t) accepts up to ticks, so the last tick
   can never be reached from the slider (found by the engine owner's review of world.mjs).
3. **units.mjs (fable), draw calls, measured 21:24:** the harness's 200-unit stress frame (every kind, half walking,
   a third hurt) puts 2796 separate meshes in the scene for 208 units, about 13 draw objects per unit even after the
   per-pivot baking (health bars, strips, shadows and animated parts are still separate), zero instanced meshes.
   That is roughly 2800 draw calls plus the shadow pass, which will not hold 60 fps on a Mac mini. CLASSIC.md asks for
   instancing: one InstancedMesh per part per kind (a few dozen draw calls for 200 units), with per-instance colour for
   the team. CPU side is fine at 0.12 ms per update. Buildings (haiku) still make about 32 meshes each with no baking.
   Measured 21:41: the Classic renderer's play/units-instanced.mjs draws the same 208-unit frame with 17 instanced
   meshes (275 instances) at 0.08 ms, reusing units.mjs's buildUnitModel for the shapes. That path meets the bar;
   viewer3d/index.html could switch to it and keep units.mjs as the model source.
4. (fixed 21:16) assets.mjs now awaits only the kinds in the log's stats table plus terrain (10 files), streams the
   rest in behind with `assets.onLoad`, and gives up on any file after 4 seconds. Verified: loadAssets resolves in node.

## Settled

- Fog and background: engine.mjs now states that terrain.mjs owns sky and fog and only sets defaults, and palette.mjs
  has a `terrain` section that terrain.mjs reads through `ctx.palette.terrain`. One owner, one source of colours. Fine.
- palette.mjs carries the ART-GUIDE.md section 2 values exactly (Cobalt #3fa9ff, Ember #ff8a3d, Shard teal #4ef2d8).

## Needs a decision (blocks the roster rule "render every unit and terrain type")

5. **Design trio (fable LGD, sonnet, haiku):** converging on the Lead Game Designer's names. Units: Worker, Grunt,
   Lancer, Spiker, Brute, Howler, Dart, Skiff, Barge, Mender, Shade, Seer, Conduit. Buildings: Core, Quarters, Forge,
   Siphon, Turret, Sensor Mast, Foundry, Hangar, Sanctum. Tiles (haiku's maps/driftfall-v3.json): floor, ramp, rock,
   vent, shard, rich-shard, rubble, with cliffs drawn from height steps. Still open: map 40 or 48, rubble hp. The 3D
   scout's MANIFEST.json still uses sonnet's withdrawn unit names (skyspike, bombard, gale, ferry, lumen, hexer) and
   needs renaming once the trio posts AGREE: v3. The roster check in the integration test reads `env/stats.mjs`, so the
   renderers are held to whatever lands there; units.mjs and buildings.mjs owners, start the new silhouettes from
   ART-GUIDE.md shape words as soon as the AGREE lands.

## Ugly or risky (judgement from the code, confirm on screen)

6a. **units.mjs (fable), seen on the units sheet (`node viewer3d/units-sheet.mjs`):** all 13 kinds have distinct
   silhouettes and team colour reads at once. Weak at TV distance: Dart is a sliver that vanishes on the ground; Skiff
   reads as a broken line, not a winged V, and has no air shadow; Shade at half opacity is a smudge with no edge; Grunt's
   wedge looks like a box; Lancer's thin dark tripod sinks into the dark plateau. Software rasteriser, flat lighting, so
   confirm in a browser before polishing.

7. **buildings.mjs (haiku):** two Cores produce 74 plain meshes (about 37 draw calls per building, none instanced). With
   a v3 base of 10 to 20 buildings per side that is 700 to 1500 draw calls before units. Merge each building's static
   parts into one geometry, or instance the repeated bits (bolts, posts, scaffold bars).
8. **vfx.mjs (sonnet):** 68 pooled meshes plus 2 point clouds sit in the scene at rest. Fine on paper (0.5 ms per update in
   node). Watch on screen for overdraw from large additive sprites near the camera.
9. **terrain.mjs (sonnet):** 1894 instances across 13 instanced meshes and about 34k triangles is fine. The Shard
    crystal pulse and the dust motes run every frame; keep them on one shared uniform rather than per-instance updates
    (not checked yet, the update costs 0.5 ms in node).

## Checked and fine

- world.mjs (sonnet): frames agree with viewer/replay.mjs at ticks 0, 1, 60, 500 and 2000; 0.01 ms per frame forward,
  six random scrubs in 1 ms; build 60 to 120 ms for a 2000-tick log.
- All three asset manifests: every real file path exists (51 models, 13 sounds, 21 sprites). LICENSES.md present.
- index.html: import map correct, every landed module is loaded, missing ones are optional dynamic imports.
- Every landed module parses and imports in node; every factory named in VISUAL-3D.md is exported.
- engine.mjs: bloom and the composer are resized with the canvas; quality presets cap device pixel ratio and shadow map.
- audio.mjs: resumes the AudioContext on the first pointer or key event, so the TV will not stay silent.
- terrain.mjs: the distant mesa ring sits within 3 map spans, inside the camera's far plane.

## How to re-run

```
node --test tests/viewer3d-integration.test.mjs
```
The last test prints the plain-English report that the numbers above come from.
