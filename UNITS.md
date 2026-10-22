# Driftfall v3 unit roster (draft by sonnet, Unit Designer)

All designs and names are original. Numbers are proposals; the balance owner tunes them in env/stats.mjs.
Rules for every unit: flat integers, no randomness, ties go to the lowest id.

| Unit | Role | Tags | Cost (Shards+Flux) | hp | dmg | range | speed | Trained at | Hits |
|---|---|---|---|---|---|---|---|---|---|
| Worker | worker | ground light mech | 50 | 40 | 2 | 1 | 1 | Core | ground |
| Grunt | basic infantry | ground light organic | 50 | 60 | 8 | 1 | 1 | Forge | ground |
| Lancer | ranged | ground light organic | 75 | 40 | 10 | 4 | 1 | Forge | ground |
| Skyspike | anti-air | ground light organic | 60 | 45 | 8 | 6 | 1 | Forge | air only |
| Dart | fast raider | ground light organic | 60 | 25 | 6 | 1 | 2 tiles/tick | Forge | ground |
| Brute | heavy armor | ground armored mech | 150 | 240 | 25 (x2 vs structures) | 1 | every 2nd tick | Foundry | ground |
| Bombard | siege | ground armored mech | 175+75 | 70 | 30 splash r1 | 3..9 | every 2nd tick | Foundry | ground |
| Gale | air fighter | air light mech | 120+50 | 55 | 7 | 4 | 1 | Aerie | air + ground |
| Ferry | air transport | air armored mech | 100+25 | 80 | - | - | 1 | Aerie | - (carries 4 small ground) |
| Lumen | air detector scout | air light mech | 50+25 | 30 | - | - | 1 | Aerie | - (sight 9, detects 6) |
| Mender | healer | ground light organic | 75+50 | 50 | - | 2 (heals 3 hp/tick) | 1 | Sanctum | - |
| Shade | stealth | ground light organic, cloaked | 100+75 | 35 | 12 | 3 | 1 | Sanctum | ground |
| Hexer | spellcaster | ground light organic | 150+100 | 60 | - | 7 (spells) | 1 | Sanctum | - |

Hexer: energy max 100, starts 50, +1 per 4 ticks. Snare (50): enemy ground units within radius 2 of the target tile
move at half speed and attack at most every 2nd tick for 12 ticks. Surge (40): friendly ground units within radius 2
deal +50% damage for 8 ticks.

Buildings: Core (Worker). Forge 150 (Grunt, Lancer, Dart, Skyspike). Siphon 75, on a Vent only, mines Flux.
Foundry 200, needs Forge (Brute, Bombard). Aerie 200+50F, needs Forge (Gale, Ferry, Lumen). Sanctum 150+100F, needs
Foundry (Mender, Shade, Hexer). Turret 100 (ground only). Flak Spire 100+25F, needs Forge, air only, range 6, 10 dmg.
Beacon 75: detector radius 6, sight 8.

Counters: Grunt > Worker, Lancer (melee); Lancer > Grunt, Brute (range); Brute > Grunt, Turret; Bombard > Brute,
Turret, clumps; Dart > Lancer, Bombard, Hexer; Skyspike > Gale, Ferry, Lumen; Gale > Bombard, Lancer, Mender;
Mender extends Grunt + Brute; Snare > Dart and Brute rushes; Shade kills lone Lancers. Detectors that reveal Shade:
Lumen and Beacon only (Flak Spire just shoots air).

Shape words (fable, Art Director): Skyspike tall thin spike; Bombard wide low base with one long barrel; Dart tiny
arrowhead; Gale open V with wings, air units cast an offset shadow; Ferry flat wide barge with cargo pips; Mender
round body with bright ring, no pincers; Shade thin crescent, half opacity to owner, hidden to enemy until detected;
Lumen small lantern with teal halo; Hexer tall forked staff. Buildings: Siphon pipes over vent, Foundry double-stack
Forge, Aerie flat ring pad, Sanctum narrow spire, Flak Spire tall tower with dish, Beacon mast with rotating light.

Terrain: height 0/1/2; kinds floor, ramp, cliff, rock, vent, shard, rich-shard (800), rubble (200 hp, destructible,
air passes). Ground steps between heights need a ramp; cliffs block ground not air; air units use their own layer.
Sight: a tile is seen if a friendly viewer within sight radius (default 7) has height >= tile height, or the tile is
within 2 tiles, or the viewer is air. Attacks need a visible target. Flux: Vents, 300 each, Siphon + Worker, carry 8.
