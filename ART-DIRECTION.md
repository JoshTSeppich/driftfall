# Art direction: early-2000s geometric (Joshua, 19:37: "really cool and stylistic... more geometric and like early 2000s nostalgic")

Reference: assets/generated/snk-20-style-exploration-y2k.png (the Siphoner in three styles).

**Status: PROPOSAL (claude). Joshua picks after seeing the Style Lab (play/style-lab.html) in motion.**

## Recommendation: "Faceted Ink" with a Y2K-gloss interface
- **World and units: faceted low-poly with ink outlines.** Flat-shaded triangles (no textures), bold saturated
  colours, crisp hard edges, a thick dark outline pass, and a gradient sky. It reads instantly from a high RTS
  camera, it's the cheapest look to render (200 units at 60 fps is easy), and, most important, **every unit and
  building can be modelled in code** from a few geometric parts, so the swarm is never blocked waiting on art.
- **Interface: Y2K gloss.** Translucent candy-plastic panels, brushed-chrome bevels, aqua and lime highlights, glossy
  rounded buttons with the drawn icons inside. The HUD is where nostalgia is loudest and readability costs least.
- **Effects: geometric.** Hits, deaths, crystals and Drift events made of shards, facets, rings and lines.
- **Keep the humour:** oversized helmets, monocles, a moustache-scale pattern: silhouettes do the joke.
- **The drawn art** stays for portraits, icons and loading/menu screens; the map uses the faceted models.

## Palette
Snakenators: slate green (#3f5d4a), gunmetal (#5b6470), cyan crystal (#38e0ff), signal lime (#b6ff3b).
Enemy mirror: same models, team colour swaps cyan for orange (#ff8a2a).
Sky: dusk gradient (#2b1b4a → #ff9a6b). Ground: warm sand facets with darker rock.

## Rules
1. Flat shading only; no texture maps on units. 2. Every model under ~300 triangles (buildings ~800).
3. Outline width constant in screen space. 4. Team colour on at least 30% of each unit's visible area.
5. Motion is snappy: 80–200 ms for actions, eased; nothing floaty.
