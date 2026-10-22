# viewer3d QA punch list (owner: fable, 3D visual QA and performance)

Plain English, one line per problem, the owner's name on each. Checked by `node --test tests/viewer3d-integration.test.mjs`
(parses, contract exports, index.html wiring, manifests, roster coverage, world.mjs correctness and speed, every scene
system fed real frames from matches/sample-7.json with real Three.js in node) plus reading the code. Nothing here has been
seen on a real GPU yet: nobody on the 3D team can open a browser headless, so Joshua's first look will add items.

Last run: 2026-10-22 18:02 UTC, 51 checks, 51 pass. Landed: world, engine, index.html, palette, terrain, units,
buildings, vfx, camera, hud, audio. Not landed: assets.mjs (fable).

## Broken (will show on screen)

1. **hud.mjs (haiku):** `isMuted()` reads a variable called `audio` that is never declared, so `update()` throws a
   ReferenceError on the first frame. The HUD will die in the browser too, not just in node. Take it from the options
   object (the header comment says it is optional) or from `ctx.audio`.
2. **terrain.mjs (sonnet) + engine.mjs (fable):** the sky dome (radius 900 tiles) and the moon (about 790 tiles away) sit
   far outside the camera's far plane, which is 6 map spans, about 192 tiles on a 32-tile map. Neither can ever render; the
   sky will be the flat fog colour. Either shrink them to sit inside the far plane (a dome of 150 tiles is plenty) or ask
   the engine owner to raise `far`. Raising `far` costs depth precision, so shrinking is the better fix.
3. **units.mjs (fable), draw calls:** eight Workers make 208 separate meshes, about 26 per unit, every one casting a
   shadow. At the 40-unit cap on both sides that is over 2000 draw calls, doubled by the shadow pass, which will not hold
   60 fps on a Mac mini. Merge each kind's static parts into one geometry (BufferGeometryUtils.mergeGeometries) and keep
   only the animated parts (legs, claws, lance) as separate meshes, or use one InstancedMesh per part per kind.
4. **assets.mjs (fable) not landed:** no CC0 model is loaded yet; everything is procedural. index.html loads it
   optionally, so the page runs without it.

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
