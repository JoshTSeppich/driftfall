# Driftfall changelog

Written by the Build Changelog Writer (`live/changelog.mjs`). Newest first. Each line says what changed, who made it, and why. The chat message that explains it is named as `channel.jsonl #N`, the number that `node read.mjs` prints.

## 2026-10-22

- **17:53 UTC** Added tests/viewer3d-director.test.mjs (327 lines). By unassigned. Why: No chat message explains this yet.
- **17:53 UTC** Added viewer3d/vfx.mjs (642 lines). By sonnet. Why: sonnet (vfx): starting viewer3d/vfx.mjs + tests/viewer3d-vfx.test.mjs. Plan: createVfx(ctx) with pooled additive GPU Points (sparks, glow, smoke/dust), instanced debris chunks, beam quads for lasers, shockwave rings. All driven by frame.ev… (chat #130)
- **17:52 UTC** Changed viewer3d/world.mjs (+0 lines, now 230). By sonnet. Why: sonnet (3D world): viewer3d/world.mjs is in, 14 tests pass in tests/viewer3d-world.test.mjs (sample-7 plus a hand-made fight). createWorld(log) -> {ticks,start,end,map,stats,players,result,stateAt,frame,facingAt}. frame(t) -> {tick,alpha,p… (chat #149)
- **17:51 UTC** Added viewer3d/terrain.mjs (586 lines). By sonnet. Why: sonnet (terrain): viewer3d/terrain.mjs is in with tests/viewer3d-terrain.test.mjs (4 pass). createTerrain(ctx) builds on the first frame from frame.prev/next: basalt plateau tiles with colour patches, sunken plates, glow cracks, drift stre… (chat #151)
- **17:52 UTC** Added viewer3d/hud.mjs (361 lines). By haiku. Why: Fable (art director) on the scouted assets, for sonnet, haiku and the viewer owners. Decision: the game pieces (map, Core, Forge, Turret, four units) stay as the drawn art in viewer/art.mjs. Reasons: the Kenney sci-fi RTS pack is a slanted… (chat #126)
- **17:52 UTC** Added viewer3d/camera.mjs (431 lines). By haiku. Why: Fable (Lead Engine / Rendering) starting viewer3d/index.html and viewer3d/engine.mjs now. Plan: createEngine(canvas, opts) exactly as VISUAL-3D.md says, with ctx = { THREE, scene, camera, renderer, composer, clock, palette, assets, gridToW… (chat #141)
- **17:52 UTC** Added viewer3d/buildings.mjs (698 lines). By haiku. Why: No chat message explains this yet.
- **17:52 UTC** Added viewer3d/audio.mjs (359 lines). By haiku. Why: No chat message explains this yet.
- **17:52 UTC** Added tests/viewer3d-terrain.test.mjs (54 lines). By sonnet. Why: sonnet (terrain): viewer3d/terrain.mjs is in with tests/viewer3d-terrain.test.mjs (4 pass). createTerrain(ctx) builds on the first frame from frame.prev/next: basalt plateau tiles with colour patches, sunken plates, glow cracks, drift stre… (chat #151)
- **17:52 UTC** Added tests/live-page.test.mjs (49 lines). By unassigned. Why: No chat message explains this yet.
- **17:52 UTC** Changed live/threads.mjs (+1 lines, now 203). By unassigned. Why: No chat message explains this yet.
- **17:52 UTC** Changed live/changelog.mjs (+1 lines, now 281). By unassigned. Why: No chat message explains this yet.
- **17:52 UTC** Added live/app.mjs (193 lines). By sonnet. Why: Live View Engineer: starting live/index.html, live/app.mjs, live/style.css. One full-screen TV page: match left (3D when ready, else 2D), build status, chat threads, agent wall with live output, captions. Reading the Control Room API shape… (chat #132)
- **17:52 UTC** Added assets/models/MANIFEST.json (441 lines). By sonnet. Why: Sonnet (3D scout) DONE first pass: assets/models/ now has 116 CC0 GLB files (Kenney Space Kit 66 in space/, Kenney Tower Defense Kit 50 in td/ plus td/Textures/colormap.png, which the td models need next to them). LICENSES.md and MANIFEST.… (chat #150)
- **17:52 UTC** Added assets/models/LICENSES.md (12 lines). By sonnet. Why: Sonnet (3D scout) DONE first pass: assets/models/ now has 116 CC0 GLB files (Kenney Space Kit 66 in space/, Kenney Tower Defense Kit 50 in td/ plus td/Textures/colormap.png, which the td models need next to them). LICENSES.md and MANIFEST.… (chat #150)
- **17:51 UTC** Changelog started, tracking 810 project files. By live view. Why: The Build Changelog Writer began watching the folder.
