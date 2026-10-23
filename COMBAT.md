# Toaster Wars combat (proposal by claude, reviewed and improved by GPT; Joshua approved 10-23 08:03)
Feel: very cute (a tiny-squad creature game meets the brightest stylised cartoon shooter), entirely our own.
Rule book for looks: STYLE-BIBLE.md. **GPT's line:** "Make Toaster Wars recognisable in motion, not just in
screenshots... unmistakably yours, even with every sound muted."

## 1. Toast is the ammo
- Warriors carry a few slices, **visible in their slots**. **One shot consumes one slice** (unless an attack says more).
- **Crumbs resupply automatically**, hopping toast to the front in a little conga line. Supply routes are visible and
  can be raided. The player sets supply priorities, never individual deliveries.

## 2. Three combat states
| State | Can do |
|---|---|
| **Powered + Fed** | move, attack, abilities |
| **Powered + Hungry** | move, can't fire until resupplied (stomach growl, droopy eyes) |
| **Unpowered** | can't advance or attack until power is restored |
**No invisible logistics, no softlocks**: slices and cords are readable at the RTS zoom; a starving or cut-off player
always has a way back.

## 3. Attacks (GPT's revisions applied)
| Unit | Attack | What you see |
|---|---|---|
| Popper | **Pop Shot** (the 520 ms reference) | slots spring, one big slice arcs with a *ding*, bonks, bounces, five chunky crumbs |
| Zapper | **Hot Coil** | coils glow orange, fires ONE big incandescent toast bolt (no tiny particles); heat build-up on the target is the one status colour (golden → brown → burnt) |
| Four-Slice | **Quad Volley** | braces, one-beat pause, all four slices launch in a spread; heavy *thump*; camera shake allowed |
| Broiler | **Bread Shell** | oven door springs open, lobs an oversized five-facet militarised bread shell; fire splash; camera shake allowed |
| Flak Popper | **Crouton Flak** | slice fired straight up bursts into five large angular croutons |
| Bagel | **Ram** | a chunky PENTAGONAL bagel wheel rolls in, bounces off, wobbles dizzy |
| Crumb | **Crumb Toss** | a weak handful of crumbs that briefly staggers/distracts, then a panic hop away |
- **Hit:** white flash, squeak, small knockback hop, alarmed eyes. **Camera shake only for Four-Slice and Broiler.**
- **Defeat:** X eyes, spring pops out (*boing*), the body shatters into pentagon facets, the slice lands
  butter-side down. **Debris clears fast** and never hides units or resources.
- **Personality:** squads hop in clusters behind a banner and salute together when selected; idle they tug cords and
  polish toast; victory = a synchronised hop dance (always interruptible; never delays commands).

## 4. Animation grammar: five beats, every attack
Anticipate → Charge → Release → Impact → Recover. Body in **stepped poses** with 20–40 ms eased transitions;
**projectiles move smoothly**. Reference, Popper Pop Shot, 520 ms:
| ms | beat |
|---|---|
| 0–80 | lean back, brow lowers |
| 80–160 | toast compresses into the slot, orange heat flash |
| 160–200 | toast snaps up, sharp *ding* |
| 200–340 | slice flies in a clean exaggerated arc |
| 340–410 | impact: *bonk*, white flash, five chunky crumbs |
| 410–520 | body settles, brow resets, one slice fewer visible |
**Visuals are separate from gameplay.** The sim decides ammo, hits and damage; the animation only shows them, so
replays, multiplayer and the Design Studio all play the same attack.

## 5. Prompt templates (written by GPT for itself and for Codex)
### A. Image prompt: animation keyframe sheets (ChatGPT)
```
Create one six-frame animation keyframe sheet for TOASTER WARS.
UNIT: [UNIT]. ATTACK: [ATTACK]. ACTION: [ACTION DESCRIPTION]. TIMING: [KEYFRAME TIMES IN MS].
STYLE LOCK: Original early-2000s geometric cartoon RTS. Cream #F2D7A6 chassis, charcoal #303844 faceplate,
cyan #32D9E8 pentagonal team plates, toasted-gold #D99448 accents. Every rounded form uses exactly five facets.
Chunky top-heavy silhouette, 4–6 rigid parts, trapezoidal glowing eyes, pentagonal brow. Cute but militarily serious.
OUTPUT: Six equal panels, same fixed three-quarter RTS camera, same unit scale, orientation, proportions and
equipment. Show anticipation, charge, release, projectile, impact and recovery. Ivory #F7F4EB background,
consistent lighting, distinct readable poses.
No text, labels, logos, extra appendages, smooth cylinders, or character redesigns.
```
### B. Codex prompt: build one attack in the Design Studio
```
Implement [UNIT] — [ATTACK] in the existing Three.js Design Studio.
First inspect the repository, unit factory, animation loop and scene controls. Reuse existing conventions.
Do not invent APIs.
CONTRACT:
- Preserve existing unit mesh, palette and camera.
- At most 4–6 articulated rigid parts on independent pivots.
- Exactly five facets for every rounded geometry; no smooth cylinders or mesh deformation.
- Keyframes in milliseconds: [TIMING/POSE TABLE].
- Stepped key poses with short intentional transitions.
- Projectile: [SHAPE, PATH, RELEASE TIME]. Impact: [EFFECT AND GAMEPLAY EVENT].
- Return precisely to idle by [END TIME] ms.
- Deterministic, interruptible, driven by elapsed simulation time, not wall-clock timers.
Expose playAttack(), stopAttack(), setAnimationTime(ms), adapting to existing project APIs.
Separate visual events from gameplay damage. Add looping preview and scrubbing using existing UI.
Test pivot counts, facet geometry, start/end poses, repeatability and interruption.
Report modified files and verification results.
```
