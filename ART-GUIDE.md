# Driftfall art guide (v1)

Owner: fable (Art Director). This is the look everyone builds to, in the 2D viewer (`viewer/art.mjs`) and in the
3D scene (`viewer3d/`). If your piece doesn't match this guide, change the piece or ask here to change the guide.
Reference you can look at right now: `viewer/art-preview.html` (served over http) or `node viewer/art-render.mjs`
which writes `.sandbox/art-sheet.png`.

## 1. The world in three lines

Driftfall is a dark basalt plateau at dusk where glowing **Shard** crystals have fallen out of the sky in long
diagonal streaks (the "fall"). Two salvage fleets fight over them with cheap, angular, hand-welded machines.
Everything is original to Driftfall: no names, shapes, colours or sounds from StarCraft or any other game.

## 2. Palette

| use | colour | notes |
|---|---|---|
| ground | `#0f1318`, mottled with `#131920` and `#0d1015` | near-black blue-grey. Mottling is soft-edged, never a checkerboard |
| drift streaks | `rgba(120,150,180,0.06)` | long, faint, diagonal from upper right to lower left |
| rock | `#3a434f`, lit facet `#5a6573`, edge `#20262e` | jagged, cool grey. Reads as a boulder, not a cube |
| Shard crystal | `#4ef2d8`, dark face `#137a6b`, bright edge `#d9fff8`, glow `rgba(78,242,216,0.35)` | the only teal in the game. Teal means "resource" everywhere: carried loads, delivery sparkles, the Core's orbiting shards |
| Shard tile, mined out | `#2a3b40` stubs on a `rgba(40,60,64,0.35)` floor | still clearly a crystal tile, just dead |
| side 0 **Cobalt** | main `#3fa9ff`, light `#aee0ff`, dark `#174e8f`, deep `#0b2a4f` | |
| side 1 **Ember** | main `#ff8a3d`, light `#ffd4ae`, dark `#9a3f14`, deep `#4f1f08` | |
| hit flash | white `#ffffff` with a white halo | one tick, whole piece |
| health | green `#63e07a` over 50%, yellow `#f0c84a` over 25%, red `#ff5a5a` below | bar hidden at full health |
| heat (Forge furnace, muzzle) | yellow-white to `#ff7828` | warm light is "industry", never a team colour |

Blue and orange are the only two team colours; they stay apart for colour-blind readers. Team colour goes on the
body of a piece; teal only ever means Shards. In 3D these same values are the emissive and base colours in
`viewer3d/palette.mjs`.

## 3. Factions

Both sides field the same machines (the sim is mirrored), so the difference is paint and personality, not shape:

- **Cobalt** is the orderly fleet: clean plating, cool light, crisp edges.
- **Ember** is the scrappy fleet: the same hulls in rust-orange with warm highlights.

Don't add asymmetric geometry per side; a Grunt silhouette must be the same Grunt on both sides.

## 4. Silhouettes (what must read at 20 px)

Each unit kind has one shape word. At the match viewer's 20 px per tile a player must tell them apart by shape
alone, with colour as a second cue, never the only one.

| piece | shape word | size in a tile | identifying detail |
|---|---|---|---|
| Worker | **round** | small (about 0.5) | hover pod with two pincers and a visor; holds a teal Shard out in front when carrying |
| Grunt | **wedge** | medium (0.65) | stocky arrowhead, bright nose plate with a dark visor strip, stubby legs |
| Lancer | **needle** | long and thin (0.9 long, 0.3 wide) | slender hull on a tripod with a lance twice its body length |
| Brute | **hex** | big (0.9) | wide hex-plated walker, raised dome, two claws out front |
| Core | **octagon with a ring** | overflows the tile (1.25) | glowing dashed ring, three Shards orbiting a dark well |
| Forge | **block with a stack** | fills the tile | chamfered block, hot furnace mouth, chimney with a glowing tip |
| Turret | **disc with barrels** | 0.85 | bolted base plate, hex head with twin barrels that scan |

Units face a direction (the enemy by default: side 0 looks down-right, side 1 up-left). Structures don't.

## 5. States everyone must show

| state | how it reads |
|---|---|
| idle | a slow breath or sway, nothing more. Idle units never look like they are walking |
| move | legs scissor, hull bobs, Brute feet lift in sequence; the Lancer sways |
| attack | Grunt lunges with a white slash arc; Lancer recoils and fires a bright bolt along the lance; Brute clamps its claws with a white impact star; Worker's pincers clamp while mining (its "attack" pose) |
| hit | whole piece flashes white for the tick, with a halo |
| die | about half a second: fade, shrink, slight spin, 7 fragments of the team colours flying out and falling |
| under construction | dashed footprint in team colour, four corner posts that grow with progress, the building clipped so it rises out of the ground by progress, a wandering weld spark, thin progress bar on top |
| damaged | health bar under the piece, only when below full |
| training queue | small light pips in the top right corner of a Forge or Core, one per queued unit (max 5) |
| Shard tile | crystals shrink and the glow dims as the amount falls; at zero the cluster is dark stubs |

## 6. Rules of thumb

1. **Shape first, colour second, detail last.** If a piece needs its colour to be identified, its shape is wrong.
2. **Nothing is a plain primitive.** Every piece has at least one asymmetry (a visor, a stack, a claw) so it reads as a machine, not a token.
3. **Light comes from the upper left**, so lit facets are top-left and shadows fall down-right (the 2D sprites all drop a soft ellipse shadow offset down-right).
4. **Animation is cheap and deterministic**: driven by a time value passed in, never by `Math.random` or the clock inside the drawing code, so a scrubbed replay looks the same every time.
5. **Overdraw is fine for the Core only.** Units stay inside their tile so crowds remain countable.
6. **Effects live in fx, not in the sprites.** Beams, rings, damage numbers and sparkles are sonnet's `viewer/fx.mjs` (or `viewer3d/vfx.mjs`); the sprite only shows its own pose.

## 7. Downloaded assets

The scouts' CC0 packs under `assets/` may be used for HUD chrome, fonts, soft particle textures and sounds, with
their entry in `assets/LICENSES.md`. The Kenney sci-fi RTS sprites are **not** used for game pieces: they are a
slanted three-quarter view with grey buildings and would break the one-look rule above. In 3D, CC0 models are fine
as a base if they are re-coloured to this palette and keep the silhouettes in section 4; otherwise build them as
original low-poly geometry in code.

## 8. Sign-off

Post a screenshot or the preview page in the chat and say which rows of section 4 and 5 it covers. The Art Director
replies AGREE or says what to change. The 2D sheet in `viewer/art-preview.html` is the reference for silhouettes;
`viewer3d/palette.mjs` is the reference for colours once it exists.
