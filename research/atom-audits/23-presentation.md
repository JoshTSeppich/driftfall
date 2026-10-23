# Atom audit 23: Presentation (Driftfall, haiku)

Source: `research/STARCRAFT-ATOMS.md` section 23 (six lines). Read with NORTHSTAR.md "Done means" item 3 (drawn art on every unit, building and button), TERRITORY.md sections 1, 8 and 13, and the play/ and viewer3d/ files that draw the live page. Verdicts come from reading the code and asset files. I did not view live renders, so "readable" and "strong silhouette" are judged from geometry and settings, not by eye.

Verdicts: **HAVE** (an equivalent exists and is on the live page) · **PARTIAL** · **MISSING** · **NOT FOR US** (with why).

## Verdict table

| # | Atom line | Verdict | What Driftfall has (evidence) | Gap |
|---|---|---|---|---|
| 1 | Iconic art direction per race (industrial, golden-crystal, organic) | PARTIAL | The Snakenators are an organic serpent identity: drawn sprites in `assets/sprites/snakenators/` (siphoner, fang, spitter, constrictor, hisser, boomslang), slate green and cyan palette in ART-DIRECTION.md. The Burrow is parked (`STATS.factions.burrow.parked`, TERRITORY.md section 14). | Only one race has an art identity. No industrial or golden-crystal counterpart exists. The Faceted Ink look in ART-DIRECTION.md is a proposal awaiting Joshua's pick, not adopted. |
| 2 | Readable from a top-down camera at small sizes | PARTIAL | Fixed tilted camera, pitch 52° (`play/camera.mjs:5`). Units are instanced billboards with a team foot ring and health bars (`play/render.mjs` header, `play/drawn-units.mjs`). Selection rings (`viewer3d/vfx.mjs:311`). Minimap units floor at 2 px (`play/minimap.mjs:40`). | Every minimap unit is the same square dot, so a Grunt and a Brute look alike. Buildings have no minimap kind mark. No test checks that the four live kinds stay distinct at max zoom (40 tiles). `tests/icons.test.mjs` checks that a fallback exists, not that it reads. |
| 3 | Portraits with talking characters | PARTIAL | Portraits are HAVE for the live roster: the four live kinds (worker, grunt, lancer, brute) map to drawn PNGs in `assets/portraits/` through `play/icons.mjs:9`, shown at 72 px in the selection panel (`play/hud.mjs:94`). | Nothing talks. No character line, speech bubble or spoken alert uses a portrait. The caster captions in `live/show.mjs:160` exist only on the TV, not on the play page. |
| 4 | UI skins per race | NOT FOR US | One interface skin, and it is the only one needed while one race is live. | Per-race skins need the Burrow unparked. Revisit when `STATS.factions.burrow.parked` becomes false. The Y2K-gloss interface in ART-DIRECTION.md is a separate, single-skin proposal, not a per-race one. |
| 5 | Cinematics between campaign missions | NOT FOR US | v0.1 has no campaign: one match, then the result screen. The nearest equivalents exist: the 3-second edition card (`play/edition.mjs`) and the result screen (`play/app.mjs:656`). | The result screen is text only ("VICTORY" / "DEFEAT" with a line). It has no art and no rematch button. This is covered by Fanatics item 8, not by a campaign. |
| 6 | Strong silhouettes and team colours | PARTIAL | Four live kinds have drawn silhouettes with per-kind heights (`play/drawn-units.mjs:10`). Team colour is one shared palette used by the 3D world, HUD, minimap and reach view (`viewer3d/palette.mjs` TEAM, `play/hud.mjs:4`). | (a) Buildings are box primitives: `BoxGeometry` forge blocks, turret housings and a generic block (`viewer3d/buildings.mjs:283-378`). That breaks NORTHSTAR "Done means" item 3. (b) Three different team colour sets are in the code: palette.mjs uses Cobalt `#3fa9ff` and Ember `#ff8a3d`; ART-DIRECTION.md says cyan `#38e0ff` and orange `#ff8a2a`; the watch labels hard-code cyan `#33e0ff` and orange `#ff9a3b` (`play/app.mjs:661`). The style lab uses `0x38e0ff`. (c) ART-DIRECTION rule 4 (team colour on at least 30% of a unit) is not tested. (d) 14 manifest ids have no drawn icon, `null` in `assets/icons/snakenators/manifest.json`, including `train`, `shards` and `flux`, so they show as text. |

## TOP 5 changes, ranked by how much they improve play

1. **Draw the buildings the way the units are drawn.** Replace the box-primitive buildings with Snakenator-drawn sprite or faceted models in the same ink family as the units, so a Core, a Totem and a Mound read as Driftfall at a glance.
   - Owner: fable sets the art contract in viewer3d (`buildings.mjs`); GPT draws the sprites; sonnet wires them into `play/render.mjs`.
   - Done when: a live match contains no building kind that is only a `BoxGeometry`, a test lists every building kind and its art source, and Joshua sees drawn buildings on his screen.

2. **Draw the 14 missing icons, starting with what a live player presses or reads.** `train`, `shards` and `flux` come first, then the rest of the `null` list, so no button or resource label on the live page is text.
   - Owner: GPT (art pipeline) draws; sonnet wires the manifest into `play/icons.mjs`.
   - Done when: `tests/icons.test.mjs` fails if a live card or resource label has no drawn icon, and the play page shows no text-only buttons.

3. **One team colour set, everywhere.** Pick the palette.mjs values (or the ART-DIRECTION values, and change palette.mjs to match) and make every place read from it: the watch labels, the style lab, and ART-DIRECTION.md.
   - Owner: fable (palette.mjs and ART-DIRECTION decision); sonnet changes the hard-coded watch labels in `play/app.mjs`.
   - Done when: one test pins the TEAM values, grep finds no other team hex in play/ or viewer3d/, and the watch label colour matches the unit colour Joshua sees.

4. **Give each live kind its own minimap mark.** A worker is a dot, a grunt a square, a lancer a diamond, a brute a big square with a ring, all in the team colour, so the minimap reads the army without the camera.
   - Owner: sonnet (`play/minimap.mjs`).
   - Done when: a test maps the four live kinds to four distinct mark shapes, and Joshua can name each kind on the minimap.

5. **Give the two big moments a face.** The 30-second Drift banner gets a drawn face and one short line in the Drift's voice. The result screen gets the winner's and the loser's portrait and the rematch button (Fanatics item 8).
   - Owner: sonnet (`play/drift-banner.mjs`, `play/app.mjs` result screen); GPT draws the Drift face.
   - Done when: a live match shows a banner with a face and a line, and a finished match shows art plus a rematch button.

## What I did not check
- I did not view any render, so I did not confirm visually that the drawn Snakenator sprites read at the default zoom. That needs a headless render (memory: `node viewer/art-render.mjs`) or Joshua's eyes.
- I did not read the Burrow's art (it is parked) or the style-lab files beyond the colour values.
- I edited nothing except this file.
