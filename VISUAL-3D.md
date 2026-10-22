# Driftfall 3D — graphics contract (Joshua's direction: make it look a LOT better)

Decision: the main visual is a real-time 3D scene built on **Three.js 0.169.0** (MIT), installed in this
folder (`node_modules/three`). The 2D viewer in `viewer/` stays as the debug view. The look is ORIGINAL sci-fi:
nothing copied from StarCraft or any other game. Free CC0 models/sounds from the scouts may be used (licenses
recorded in `assets/`); anything missing is built as original low-poly geometry in code.

Target look: a tilted three-quarter battlefield at dusk on an alien plateau. Soft shadows, rim light, fog in the
distance, emissive Shard crystals that pulse, team-colored glow strips on every unit and building (side 0 cyan,
side 1 amber), lasers and sparks with bloom, dust when Brutes walk, buildings that rise out of scaffolding,
satisfying explosions, a camera that eases toward the action. Must run smoothly at 60 fps on a Mac mini in
Safari/Chrome at 1080p.

## How the page loads Three.js
`viewer3d/index.html` uses an import map:
```html
<script type="importmap">{ "imports": {
  "three": "../node_modules/three/build/three.module.js",
  "three/addons/": "../node_modules/three/examples/jsm/" } }</script>
```
Open it as `http://localhost:4477/preview/rts/viewer3d/index.html?log=../matches/sample-7.json`
(also `?playlist=a.json,b.json`, `?tv=1` for full-screen auto camera).

## Shared interfaces (code against these; ask in the chat to change them)
- `viewer3d/world.mjs` — `createWorld(log)` → `{ ticks, stateAt(tick), frame(t) }` where `t` is a fractional tick;
  `frame(t)` returns `{ tick, alpha, prev, next, events }` (prev/next = states at floor(t)/ceil(t), alpha in 0..1,
  events = hits, deaths, deliveries, builds started/finished during that tick). Uses `viewer/replay.mjs`.
- `viewer3d/engine.mjs` — `createEngine(canvas, opts)` → `{ ctx, add(system), start(), stop() }`.
  `ctx` = `{ THREE, scene, camera, renderer, composer, clock, palette, assets, gridToWorld(x, y) → THREE.Vector3,
  tileSize }`. Each frame it calls every system's `update(frame, dt)`.
- Every other module exports `createXxx(ctx)` returning `{ update(frame, dt), dispose() }`.
- `viewer3d/palette.mjs` — all colors and material presets in one place (team colors, emissive levels, fog).
- `viewer3d/assets.mjs` — `loadAssets(ctx)` → models/sounds from `assets/models/MANIFEST.json` and
  `assets/audio/MANIFEST.json`, with procedural fallbacks when a file is missing.

## Owners (only edit your own files)
| file(s) | owner | what |
|---|---|---|
| viewer3d/index.html, engine.mjs | fable | renderer, shadows, tone mapping, post-processing (bloom, vignette), render loop, resize |
| viewer3d/world.mjs | sonnet | log → interpolated frames and events |
| viewer3d/terrain.mjs | sonnet | ground tiles, cliffs/rocks, Shard fields (emissive, pulsing, shrinking as mined), fog, sky |
| viewer3d/units.mjs | fable | Worker/Grunt/Lancer/Brute models (CC0 or procedural), team glow, walk/attack/death animation, health bars |
| viewer3d/buildings.mjs | haiku | Core/Forge/Turret, construction scaffolding + rise, damage states, turret aiming |
| viewer3d/vfx.mjs | sonnet | lasers, melee sparks, impacts, explosions, debris, delivery sparkles, selection rings — GPU particles |
| viewer3d/camera.mjs | haiku | orbit/pan/zoom controls, and a TV auto-director that eases to fights, builds and the ending |
| viewer3d/hud.mjs | haiku | DOM overlay: names, Shards, values, unit counts, minimap, time bar + scrub, result banner |
| viewer3d/audio.mjs | haiku | positional sound from assets/audio/MANIFEST.json, volume + mute |
| viewer3d/palette.mjs, assets.mjs | fable | shared look + asset loading with fallbacks |
| assets/models/ | sonnet (3D scout) | CC0 glTF/GLB models only, LICENSES.md + MANIFEST.json |
| tests/viewer3d-*.test.mjs | each owner | node tests for pure logic (world frames, events, director choices, manifest loading) |
