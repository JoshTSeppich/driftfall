# StarCraft, atomically: every attribute of the classic and its sequel

Research reference for Driftfall (Joshua, 22 Oct, 19:32). One idea per line. These are the *mechanics and qualities*
that make the games what they are; Driftfall translates the lessons and never copies names, units, art or numbers.
"BW" = the 1998 classic with its expansion; "SC2" = the sequel. Unmarked lines apply to both.

## 1. The core loop
- Gather resources → spend them → build an army → fight → expand → repeat.
- Every second is spent on one of three things: economy, army or tech.
- The game ends when one side has no buildings left (or concedes).
- Players almost always concede ("GG") before total destruction.
- One player per side in the standard format (1v1); team modes exist.
- Matches last roughly 8–25 minutes; most decisive games end 10–18 minutes.
- Real time: both players act simultaneously; no turns.
- The game speed "Fastest" is the competitive standard.

## 2. Resources
- Two resources: a common one (minerals) and a rarer one (gas).
- The common resource comes from many small patches clustered at a base (about 8).
- The rare resource comes from a geyser (BW 1, SC2 2 per base) that needs a building on it.
- Gas is the gate for tech and strong units; minerals are the gate for volume.
- Each mineral patch holds a finite amount; bases run dry.
- SC2 adds "gold" (rich) patches that mine faster, usually at exposed bases.
- Some patches are reduced or blocking (BW: small mineral walls in paths).
- Resources are banked per player and visible to that player only.
- Unspent money ("floating") is a sign of bad play.
- Income rate, not bank, is what matters.

## 3. Workers
- Workers are the economy: each one gathers and returns small loads (5 minerals, 8 gas in BW/SC2 normal).
- Workers walk to a patch, mine for a fixed time, carry the load back to the main building.
- Workers also construct buildings.
- Saturation: about 2 per mineral patch is efficient, 3 is the cap; 3 per gas.
- Constant worker production is the first macro skill.
- Distance from patch to drop-off matters; base layouts are tuned for it.
- Workers can attack weakly and are used to fight off early rushes ("pull workers").
- Workers can be lost to harassment; killing workers is the cheapest way to hurt an economy.
- BW worker mining bounce: workers drift between patches (an AI quirk players exploited with "mineral walking").
- Each race builds differently: one worker stays to build (Terran), one summons and leaves (Protoss), one turns into the building (Zerg).

## 4. Supply (population)
- Every unit costs supply; total supply is capped.
- You raise the cap by building supply structures/units (depots, pylons, overlords).
- Max supply is 200 per player.
- Getting "supply blocked" (cap reached with no room) halts production: a classic mistake.
- Supply buildings double as other things: Protoss pylons power buildings; Zerg overlords fly and scout; Terran depots wall off (and lower in SC2).
- Supply count is the shorthand for game state ("20 supply", "200/200 max").
- Army supply vs worker supply split is a core macro decision.

## 5. Production
- Units come from specific buildings; each building has a queue (BW 5, SC2 5 per building).
- One unit at a time per building (except special cases); more buildings = more output.
- Build time is fixed per unit.
- Rally points send new units to a spot (or to mine for workers).
- Production structures can be built in numbers ("4 gate", "3 rax").
- Zerg produce from a shared pool of larvae at hatcheries: a different production model.
- SC2 Protoss can warp units in at any powered location.
- SC2 Terran add-ons (reactor: double queue; tech lab: advanced units).
- Cancelling refunds most of the cost (exploited in tricks).

## 6. Buildings
- Buildings are placed on a grid; some races need power (pylon) or creep (Zerg) to place.
- Buildings have HP and armour; they can be repaired (Terran), regenerate shields (Protoss) or regenerate HP (Zerg).
- Terran buildings can lift off and fly to a new spot.
- Buildings burn down when badly damaged (Terran).
- Buildings block movement and are used to wall off chokes.
- Static defence buildings exist: anti-ground, anti-air, detection.
- Losing all buildings loses the game, not losing units.
- Buildings have footprints that define walls and paths.

## 7. The tech tree
- Buildings require other buildings: a dependency tree.
- Three rough tiers: early, mid, late.
- Tech gates both units and upgrades.
- Scouting a tech building reveals the opponent's plan.
- Teching is a gamble: tech time and money mean fewer units now.
- Some tech is a "switch": a sudden change to a different unit mix.
- Hidden tech (e.g. cloaked units) punishes opponents who haven't prepared detection.
- The main building itself upgrades for tech (Zerg Hatchery → Lair → Hive; Terran Command Center add-ons and upgrades in SC2).

## 8. Units (the attributes every unit has)
- Cost: common resource + rare resource + supply.
- Build time.
- Hit points.
- Shields (Protoss): regenerate when out of combat; take full damage regardless of armour type.
- Armour value (flat reduction per hit).
- Armour type / size (BW: small, medium, large; SC2: tags like light, armoured, biological, mechanical, massive, psionic).
- Weapon damage per hit.
- Number of attacks per volley (e.g. 2 hits that both get reduced by armour).
- Weapon cooldown (attack speed).
- Range (ground and air may differ).
- Minimum range (siege units).
- What it can target: ground, air, both, neither.
- Bonus damage versus a tag (SC2) or damage type multiplier (BW: concussive, explosive, normal).
- Splash damage: radius and falloff.
- Movement speed.
- Acceleration and turn rate (SC2 more forgiving).
- Sight range.
- Flying or ground.
- Size/radius for collision and surround.
- Energy pool for spells; energy regenerates.
- Detector or not.
- Cloaked / burrowed capability.
- Transportable and how much space it takes.
- Mechanical (repairable) or biological (healable).
- Upgrades that affect it.
- Voice lines and portrait.
- Hotkey for training it.
- Each unit has a clear job ("role") and counters.

## 9. The damage model
- Damage per hit = weapon damage + upgrades − armour (minimum 0.5 in BW, 0.5 in SC2).
- Armour hurts many-hit, low-damage units most; high-damage units ignore it.
- BW damage types: concussive does full to small and little to large; explosive the reverse.
- SC2 bonus damage: extra damage versus a tag (e.g. +10 vs armoured).
- Overkill: wasted damage on a target that dies, a real efficiency concern.
- Focus fire beats spread fire.
- Splash damage punishes clumping.
- Friendly splash exists for some spells/units (BW storms hit your own).
- Shields absorb damage before HP and ignore armour type modifiers.
- No randomness in SC2; BW had a small miss chance from low ground versus high ground.

## 10. Upgrades
- Numeric upgrades: weapons and armour, 3 levels per class (infantry, vehicle, air; or melee, ranged, carapace).
- Each level adds a fixed amount (often +1 per hit, bigger for big-hit units).
- Costs rise per level; higher levels need higher tech.
- Unit-specific upgrades: speed, range, energy, ability unlocks, extra capacity.
- Some upgrades define a strategy's timing (e.g. a speed upgrade means you can now move out).
- Upgrades are global: they apply to all units of that class instantly when done.
- Research happens at a building and blocks that building's research queue.
- Upgrade timings are common knowledge, so scouting the building tells you when it lands.

## 11. Abilities and spells
- Spellcasters have energy; spells cost energy.
- Energy regenerates slowly; upgrades raise the cap or start energy.
- Spell types: damage area (storm), disable (stasis, lockdown, fungal), buff (stim, guardian shield), debuff, summon, teleport (recall), mind control, healing.
- Some abilities cost HP instead of energy (stim).
- Mode switches: siege mode, burrow, lift-off.
- Smart-casting (SC2): select many casters, press once, only one casts.
- BW casting: each caster had to be selected individually, a skill test.
- Cooldown-based abilities (SC2 more common: blink).
- Autocast for some abilities (heal, repair).

## 12. Information
- Fog of war: unexplored (black), explored (grey, shows terrain and last-seen buildings), visible.
- You only see what your units and buildings can see.
- High ground blocks vision from low ground; you must see up to shoot up.
- Scouting is essential: a worker scout early, then units, then spells/scans.
- Scanner sweeps, observers, overlords, hallucinations: scouting tools.
- Cloaked/burrowed units are invisible without detection.
- Detection comes from specific units, buildings or spells.
- Replays reveal everything afterwards.
- Hiding information (blocking scouts, proxy buildings, hidden tech) is a skill.

## 13. Terrain and maps
- Maps are hand-made; the ladder uses a rotating map pool.
- Main base on high ground with one ramp.
- Natural expansion close by with a choke.
- Third, fourth bases further out, progressively more exposed.
- Ramps and chokes favour defenders.
- High ground gives vision advantage.
- Open areas favour bigger armies and surrounds.
- Destructible rocks (SC2) block paths until destroyed.
- Watchtowers (SC2) give vision when a unit stands next to them.
- Islands (BW/SC2 some maps) reachable only by air or drop.
- Rush distance: walking time between mains.
- Spawn positions: 2- or 4-player maps; cross or close spawn.
- Reduced mineral lines, back-door entrances, collapsible rocks (SC2) as map features.
- Map symmetry for fairness (rotational or mirror).
- Maps tuned per meta; a single map change can change the balance.

## 14. Movement and pathing
- Click to move; units find a path around obstacles.
- BW pathing is famously clunky: units bump, get stuck, dragoons wander; part of the skill and the charm.
- SC2 pathing uses flocking: smooth clumps that move as a blob.
- Collision: ground units can't overlap; air units can stack.
- Units can be "body blocked" by others or buildings.
- Narrow chokes create traffic jams.
- Speed differences let fast units catch or escape slow ones.
- Move-shot / stutter step: attack, move during cooldown, attack again.

## 15. Control and interface
- Left-click select; drag box select.
- BW selection cap 12 units; SC2 unlimited.
- Shift-click adds/removes from selection.
- Double-click selects all of that type on screen; Ctrl-click the same.
- Control groups 1–0: Ctrl+number to bind, number to recall, double-tap to centre camera.
- Right-click = smart command (move, attack, gather, enter, repair based on target).
- Attack-move (A-click): move and fight anything on the way.
- Stop (S), Hold position (H), Patrol (P).
- Shift-queue commands (waypoints, multiple buildings).
- Hotkeys for every action; a grid layout option (SC2).
- Camera hotkeys / saved camera locations (SC2).
- Base camera / jump to base hotkey.
- Space / backspace jumps to last alert or cycles bases.
- Idle worker button.
- Select all army key (SC2).
- Minimap: click to move camera, right-click to command, pings.
- Edge scrolling and arrow-key scrolling; middle-drag scrolling.
- Command card shows the selected unit's abilities with hotkeys.
- Tooltips show cost, time and description.
- Wireframe portraits show damage state.
- Unit portraits animate and talk.
- Subgroup tabbing within a mixed selection (Tab).
- Multiple-building selection to queue units across buildings (SC2).
- Rapid-fire / repeat keys (SC2 option).

## 16. Mechanics and skill (APM)
- APM (actions per minute) as a measure of mechanical speed: pros 250–400+.
- Macro: constant production, spending, supply, expansions.
- Micro: controlling units in fights (focus fire, kiting, splitting, spellcasting).
- Multitasking: doing macro and micro at once, in several places.
- Race-specific macro mechanics (SC2): inject larvae, chrono boost, MULEs.
- "Spend your money" as the first rule of improvement.
- Build-order execution timing to the second.
- Mechanical difficulty as a deliberate skill ceiling.

## 17. Strategies and concepts
- Build order: the scripted opening.
- Rush: very early attack (worker rush, zergling rush, proxy).
- Cheese: risky all-in surprise strategies.
- All-in: commit everything; win or lose.
- Timing attack: attack when your upgrade or unit count peaks before the opponent's.
- Timing window: the gap when the opponent can't yet defend something.
- Fast expand: take the natural early for economy.
- Turtle: heavy defence, late-game army.
- Contain: block the opponent in their base.
- Harass: small raids on workers (drops, flyers, fast units).
- Drop play: transports dropping units in bases.
- Counter attack / base trade.
- Tech switch.
- Map control: holding the middle and watchtowers.
- Proxy buildings: hidden forward production.
- Wall-off: buildings blocking the choke.
- Expansion race and denial.
- Economy vs army trade-off.
- Reactive play: scout, then counter.
- Mind games: fake builds, hiding units.

## 18. Races and asymmetry
- Three races with entirely different mechanics, units and buildings.
- Terran: humans; flexible, defensive, mobile buildings, repair, siege.
- Protoss: psionic aliens; expensive, strong units, shields, warp/power fields.
- Zerg: swarm; cheap units, larvae, creep, fast expansion, regeneration.
- Each race has its own economy rhythm, supply method and production model.
- Matchups (TvZ, PvT, ZvP, mirrors) each play like different games.
- Balance across three asymmetric races is the defining design achievement.
- Mirror matchups are the "pure" skill tests.

## 19. Unit identity and counters
- Every unit has a clear silhouette, sound and role.
- Rock-paper-scissors counters (air beats ground-only, splash beats swarms, etc.).
- Compositions (combinations of units) matter more than single units.
- "Hard counters" and "soft counters".
- Unit tiers: cheap early units stay useful late in the right composition.
- Iconic "hero" units of each race (capital ships, casters).

## 20. Combat feel
- Fights are short and decisive; one bad engagement can lose the game.
- Engagement positioning: concave, flanks, chokes.
- Retreating to save units is a skill.
- Spells can turn a fight instantly (storms, fungals, EMPs).
- Big visual and sound feedback on spells and deaths.
- Units die with distinctive animations and corpses or wreckage.
- Clear projectiles and hit effects.

## 21. Pacing and phases
- Opening (0–4 min): builds, scouting, early pressure.
- Early-mid game: first expansions, tier 2 tech, first attacks.
- Mid game: multiple bases, army trades, harass.
- Late game: max supply, top tech, map running out of resources.
- Comebacks are possible through harass and smart trades.
- The game snowballs: an advantage tends to grow.

## 22. Audio
- Unit acknowledgement voice lines (selection, move, attack).
- Annoyed voice lines when clicked repeatedly (an easter egg players love).
- Alerts: "Your base is under attack", "Not enough minerals", "You must construct additional pylons".
- Distinct sounds per unit and per weapon; you can hear a fight without seeing it.
- Race-specific music.

## 23. Presentation
- Iconic art direction per race (industrial, golden-crystal, organic).
- Readable from a top-down camera at small sizes.
- Portraits with talking characters.
- UI skins per race.
- Cinematics between campaign missions.
- Strong silhouettes and team colours.

## 24. Single player
- Campaigns per race with a story.
- Mission variety (defend, escort, timed, hero missions).
- Heroes with names in the campaign.
- Difficulty levels.
- Challenge / training modes (SC2).
- Vs AI with difficulty levels (SC2 Very Easy → Elite, Cheater).

## 25. Multiplayer and competitive
- Online ladder with leagues (Bronze → Grandmaster in SC2).
- Matchmaking by skill rating.
- Seasons and map pools.
- Replays saved and shared; replay analysis is a culture.
- Observer mode with player-perspective views and production tabs.
- LAN / spawn copies (BW).
- Custom games and lobbies.
- Team games (2v2, 3v3, 4v4) and free-for-all.
- Professional leagues and esports (Korea's pro scene).
- Casters and commentary culture.
- Balance patches over years.

## 26. Modding and editor
- Map editor shipped with the game.
- Custom maps became their own genres (tower defence, defence of the ancients style, RPGs).
- Triggers and scripting.
- Community map makers set the competitive map pool.

## 27. Technical
- Deterministic lockstep networking: only commands are sent; every client simulates.
- Replays are command logs, which is why they're tiny.
- Fixed game ticks (BW about 24 per second on Fastest).
- Same input → same game, always.
- Low hardware requirements; runs on everything.
- Sprite-based 2D graphics (BW); 3D with a fixed RTS camera (SC2).

## 28. What makes it feel great (the qualities behind the rules)
- Speed: everything responds instantly.
- Readability: you can tell what's happening at a glance.
- Depth from few rules: many outcomes from a handful of systems.
- High skill ceiling, clear skill floor.
- Every unit matters; nothing is filler.
- Information is a weapon.
- Economy is a weapon.
- Constant tension: you never have enough APM to do everything.
- Clear win/lose feedback; you know why you lost.
- Comebacks and upsets exist.
- Watchable: spectators understand the stakes.
- Distinct factions with personality and humour.
