# RENDERING.md — the Premium Toy Renderer (GPT's parts list, 2026-10-23)

Joshua: "the toasters need MUCH better renderings." GPT (ChatGPT, design lead) gave the parts list below.
Target: a **premium collectible toy**. Not a photoreal appliance, and not a generic low-poly game.
Platform: Three.js r169, WebGL2, MacBook Air M2, 200 animated units at 60 fps.
GPU budget: aim for 10–12 ms sustained out of the 16.67 ms frame. Pixel ratio 1.0–1.5×. All costs below are rough estimates, not measurements.

90% of the toy quality comes from lighting, materials, edge response, contact shadows and composition. Post-processing is polish only.

## THE FIVE TO BUILD FIRST (in order)

1. **Studio lighting + tone mapping.** Key, fill, rim and hemisphere lights, with AgX tone mapping and sRGB output. Tune until the cream chassis has distinct top and side faces.
2. **Soft shadows + instanced contact decals.** One shadow-casting light, a tight shadow frustum, and a soft decal under every toaster.
3. **Satin enamel + procedural edge highlights.** Shared materials, plus narrow edge highlights done in the shader with no geometry change.
4. **Instancing for every repeated part.** Shared box geometries, materials grouped per batch, per-instance matrices, and culling by chunk.
5. **AA + camera composition.** 4× MSAA at a capped DPR, FOV 35, and eyes that stay crisp.

**Decisive test:** put one CRUMB, one POPPER and one FOUR-SLICE on a featureless ivory plane at the real gameplay camera angle. Compare before and after lighting, shadows and edges. If they don't look much better, post-processing would only decorate a weak base.

**Acceptance benchmark:** 200 animated units with the full terrain in view, not a blank showroom.

## Full parts list (priority order)

1. **Lighting rig** (~0.1–0.5 ms; only the key light casts shadows)
   - Key: `DirectionalLight(0xffedd7, 2.6)` at (-8, 14, 9), castShadow.
   - Fill: `DirectionalLight(0xd7edff, 0.65)` at (7, 5, -4).
   - Rim: `DirectionalLight(0xffffff, 0.9)` at (4, 9, -10).
   - Hemisphere: `HemisphereLight(0xe8f5ff, 0x65727d, 0.85)`.
   - All intensities are starting points; re-tune after tone mapping.
2. **Shadows** (one shadow pass ~0.5–2.5 ms; decals ~0.05–0.25 ms)
   - `PCFSoftShadowMap`, map size 1024 (2048 only if needed).
   - Ortho shadow camera ±28, near 0.5, far 65. Fit it to the ACTIVE camera area, never the whole 256 map.
   - bias -0.00015, normalBias 0.025. Don't rely on shadow.radius.
   - Contact shadows: a radial-alpha texture of 32 or 64 px on an instanced quad just above the ground. Opacity 0.18–0.32, 5–15% wider than the chassis, depthWrite false.
3. **Materials:** MeshStandardMaterial, one shared material per category (+0.1–0.5 ms for environment reflections).

   | Part | Colour | Roughness | Metalness |
   |---|---|---|---|
   | Cream chassis | #F2D7A6 | 0.48 | 0 |
   | Charcoal faceplate | #303844 | 0.35 | 0.08 |
   | Team cyan | #32D9E8 | 0.38 | 0.05 |
   | Toast | #D99448 | 0.82 | 0 |
   | Feet / joints | #434A52 | 0.65 | 0.10 |

   - Add a low-contrast studio environment through PMREMGenerator.
   - No clearcoat yet; that is for the inspect view only.
4. **Edge treatment** (~0.1–0.6 ms, no extra draws)
   - Use `onBeforeCompile`: from object-space distances to the six box planes, add a highlight where two boundaries meet. Plain Fresnel is not enough.
   - Band width 1–2% of the box, intensity 0.12–0.22, warm ivory. Dark inset 0.05–0.09.
   - Antialias the band with `fwidth()`.
   - Pass the half-extents to the shader for boxes with different proportions.
   - No RoundedBoxGeometry in gameplay, and no edge meshes.
5. **Colour management** (~0.05–0.2 ms)
   - `outputColorSpace = SRGBColorSpace`, `toneMapping = AgXToneMapping`, exposure 1.15. Also A/B test ACES at exposure 1.0–1.15 on real captures.
   - OutputPass goes last, with no double tone mapping.
   - Colour textures are sRGB; data maps stay linear.
6. **AO**
   - Gameplay: bake or procedurally darken cavities (the inner 5–10% around the faceplate recess and joints), ~0–0.15 ms.
   - Studio: SSAOPass with kernelRadius 6, min 0.005, max 0.08, 16 samples, half resolution (~0.7–2.5 ms).
   - Don't stack strong SSAO with dark decals.
7. **Outlines** (~0.2–0.8 ms for a screen-space edge pass)
   - Replace the heavy outline pass. Use charcoal material boundaries plus a subtle silhouette of 0.75–1.25 px.
   - Thick team-colour outlines are for selection and hover only (OutlinePass is for selection only).
8. **Eyes** (negligible)
   - Flat squares with `emissive` set to the team colour and `emissiveIntensity` 1.5–2.5, roughness 0.5.
   - Expression comes from separation, height and square rotation only.
9. **Camera** (free)
   - `PerspectiveCamera(35, …)`, about 40° above the horizon, height derived from zoom. Also test an orthographic camera.
   - NO DOF in gameplay. In the inspect view only, BokehPass with aperture ~0.002 and maxblur 0.003–0.008.
10. **Bloom** (~0.4–1.5 ms at half resolution)
    - `UnrealBloomPass(half-res, 0.22, 0.18, 1.2)`, catching emissive eyes and coils only.
    - Ship gameplay WITHOUT it first. If the cream body glows, something is wrong.
11. **AA**
    - Order to try: native MSAA at capped DPR, then a composer target with `samples: 4`, then FXAA (after OutputPass) as the fallback. SMAA only if those fail.
    - Don't combine them blindly; it softens the eyes.
    - Cost: 4× MSAA ~0.4–1.5 ms; FXAA ~0.15–0.5 ms.
12. **Ground**
    - Studio: #EDE9E0 or #F7F4EB, roughness 0.9–1.0, no grid or checkerboard, an almost invisible gradient.
    - Gameplay: keep the Quiet Battlefield palette.
13. **Instancing** (the foundation)
    - Pipeline: sim → animation state → pivot/part transforms → instanced batches. Batches: chassis, faceplates, team blocks, feet, toast slabs, eyes, decals.
    - Group by geometry and material, not by unit. Upload with setMatrixAt and one needsUpdate per batch.
    - Split batches by map chunk so frustum culling still works.
14. **Adaptive quality governor**

    | | High | Balanced | Performance |
    |---|---|---|---|
    | Pixel ratio | 1.5 | 1.25 | 1.0 |
    | Shadow map | 2048 | 1024 | 1024 / local |
    | SSAO | half-res | baked | baked |
    | Bloom | half-res | off | off |
    | Outlines | subtle + selection | selection | selection |
    | DOF | preview only | off | off |
    | Contact decals | all units | all units | all units |

    - Switch tiers on rolling frame time with hysteresis, never per frame.
    - Log median and p95 frame time, GPU timer queries, `renderer.info.render.calls`, triangles, caster count, time per pass, and CPU matrix-upload time.

## Not yet
Full-scene GTAO, SSR, per-unit shadow lights, real-time DOF, volumetrics, clearcoat on every unit, multi-level bloom.

## Profiles
- **Gameplay:** no DOF, minimal post-processing.
- **Unit preview / Design Studio:** optional SSAO, bloom and shallow DOF.
- **Pass order:** AO in linear space → bloom → OutputPass → (FXAA).
