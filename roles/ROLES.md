# Driftfall swarm roles

Deep collaboration (every role): announce what you're starting in the team chat; ask the owner before touching their area; get every change reviewed by one role from a different team; answer questions addressed to you first; post a plain-English status at least every 15 minutes; disagree with a reason and an alternative, and settle it with AGREE; credit others' ideas.

Status: **core** = in the swarm now · **on-call** = spawned when its work comes up · **n/a** = no equivalent in an AI swarm.


## Live View

| Role | Status | Scope | Owns |
|---|---|---|---|
| Live View Lead / Show Director | core | Decides what's on the TV and the main monitor at every moment: the newest playable build, the match, the swarm talking, who's working on what. Owns the live layout and when to switch scenes. | live/SHOW.md, live/index.html layout |
| Live Build Compiler | core | Continuously rebuilds Driftfall from whatever the swarm has saved: runs the full test suite, checks every module loads, records a fresh match from the latest code, and publishes build status (green/red, what broke, who owns it) every few minutes. | live/compile.mjs, live/status.json, matches/latest-*.json |
| Swarm Discussion Curator | core | Turns the team chat into readable threads by topic, highlights decisions, open questions, disagreements and every AGREE, and keeps a plain-English 'what the swarm decided' summary live on screen. | live/threads.json, live/decisions.md |
| Live View Engineer | core | Builds the live page: latest 3D render of the newest build, build status, test results, live chat threads, agent activity and terminals, all updating without reloads. | live/*.mjs, live/style.css |
| Agent Spotlight Operator | core | Watches the Control Room map and terminals, and spotlights whichever agents are doing the most interesting work right now (with their live output), so Joshua always sees the action. | live/spotlight.mjs |
| Build Changelog Writer | core | Writes a running plain-English changelog: what changed, who changed it, and why (linked to the chat discussion), shown on screen and committed to the repo. | CHANGELOG.md, live/changelog.json |
| Live Commentator | core | Narrates in plain English what's happening across the build and matches (the subtitles agent's role inside the show), never stating anything not in the records. | live/captions |

## Leadership

| Role | Status | Scope | Owns |
|---|---|---|---|
| Game Director | core | Owns the vision for Driftfall: what makes it fun, the final call when teams can't agree, and protecting scope so it ships. | VISION.md |
| Creative Director | core | Owns the feel and identity: original sci-fi world, tone, faction personality, making sure art, audio and design tell one story. | CREATIVE.md |
| Executive Producer | on-call | Owns the big picture of time and cost for the whole swarm; decides when to grow or shrink teams. | PRODUCTION.md (budget section) |
| Senior Producer | core | Runs the build plan: milestones, dependencies, who's blocked; keeps PLAN.json current and the swarm unblocked. | PLAN.json, MILESTONES.md |
| Producer / Associate Producer | core | One per feature team: tracks that team's tasks, chases blockers in the chat, keeps their ticket list honest. | tickets per team |
| Project Manager / Scrum Master | core | Runs the swarm's rhythm: short stand-ups in the chat every ~15 minutes (done / doing / blocked), retros after milestones. | STANDUPS.md |
| Technical Director | core | Owns architecture and technical standards across engine, sim and online: interfaces, determinism, performance budgets; approves interface changes. | ENV-SPEC.md (architecture), VISUAL-3D.md interfaces |
| Art Director | core | Owns the look: style guide, palette, readability of units at a glance, approves art and VFX. | ART-GUIDE.md, viewer3d/palette.mjs sign-off |
| Audio Director | core | Owns how the game sounds: sound style, mix priorities, voice tone; approves audio. | AUDIO-GUIDE.md |
| Narrative Director | on-call | Owns the world and story frame for the factions, mission briefings and any campaign. | NARRATIVE.md |

## Design

| Role | Status | Scope | Owns |
|---|---|---|---|
| Lead Game Designer | core | Owns the rules as a whole: units, economy, buildings, win conditions; keeps ENV-SPEC.md coherent and fun. | ENV-SPEC.md (rules sections) |
| Senior Multiplayer / Balance Designer | core | Owns balance: unit costs, damage, counters, timings; proposes changes from match data, never by gut. | env/stats.mjs proposals, BALANCE.md |
| Unit Designer | core | Owns each unit's role, strengths, counters and abilities, and how a player tells them apart. | UNITS.md |
| Faction / Race Designer | on-call | Owns any second faction: asymmetric units and buildings that still balance. | FACTIONS.md |
| Economy Designer | core | Owns gathering, costs, income curve and how fast a match snowballs. | ECONOMY.md |
| Systems Designer | core | Owns cross-cutting rules: supply cap, build queues, upgrades, tie-breaks. | SYSTEMS.md |
| Campaign Mission Designer | on-call | Owns single-player missions and scripted objectives, if a campaign is added. | missions/ |
| Level / Map Designer | core | Owns map layouts: mirrored fairness, chokepoints, expansions, rock placement rules. | env/map.mjs design notes, maps/ |
| Co-op / Game Modes Designer | on-call | Owns extra modes (2v2, survival, puzzle maps). | MODES.md |
| UI/UX Designer | core | Owns how a human reads and controls the game: HUD layout, selection, command card, feedback. | UX.md, HUD wireframes |
| Tutorial / Onboarding Designer | on-call | Owns teaching a new player the game in the first minutes. | TUTORIAL.md |
| Monetization / Live Ops Designer | n/a | No store or live economy in Driftfall. |  |
| Technical Designer | core | Owns data-driven content: stats tables, trigger/scripting hooks, the map editor's design. | env/stats.mjs structure, editor spec |

## Narrative

| Role | Status | Scope | Owns |
|---|---|---|---|
| Lead Writer | on-call | Owns all in-game text voice and quality. | text/ |
| Narrative Designer | on-call | Owns how story shows up in play: unit lines, briefings, map flavor. | text/briefings |
| Staff Writer | on-call | Writes unit acknowledgements, tooltips and flavor text on request. | text/units |
| Cinematic Writer | on-call | Writes scripts for the intro and victory/defeat sequences. | cinematics/scripts |
| Lore / Continuity Editor | on-call | Keeps names, factions and facts consistent everywhere. | LORE.md |

## Engineering · Engine

| Role | Status | Scope | Owns |
|---|---|---|---|
| Lead Engine Programmer | core | Owns the 3D engine layer: render loop, scene, systems interface, performance. | viewer3d/engine.mjs |
| Engine Programmer | core | Implements engine features the other systems need (resource loading, instancing, LOD). | viewer3d/assets.mjs |
| Graphics / Rendering Programmer | core | Owns lighting, shadows, tone mapping, post-processing (bloom, vignette, fog). | viewer3d/engine.mjs rendering |
| Shader Programmer | core | Writes custom shaders: crystal glow, team-color strips, shield shimmer, terrain blending. | viewer3d/shaders/ |
| Physics Programmer | on-call | Owns debris and ragdoll-style death effects (visual only; the sim stays grid-based). | viewer3d/physics.mjs |
| Animation Programmer | core | Owns animation playback and blending: walk, attack, death, construction rise. | viewer3d/anim.mjs |
| Audio Programmer | core | Owns positional audio, mixing, ducking and limits on simultaneous sounds. | viewer3d/audio.mjs |
| Tools Programmer | on-call | Builds the map editor and debug tools. | tools/ |
| Build & Release Engineer | core | Owns that the repo always builds: GitHub pushes, versions, release tags, the Live Build Compiler's pipeline. | package.json, .github/, releases |
| Platform Programmer | on-call | Owns browser and OS quirks (Safari vs Chrome, Retina, the TV display). | viewer3d/platform.mjs |
| Performance / Optimization Engineer | core | Owns 60 fps at 1080p and fast sims: profiles, sets budgets, files tickets with owners. | PERF.md |

## Engineering · Gameplay

| Role | Status | Scope | Owns |
|---|---|---|---|
| Lead Gameplay Programmer | core | Owns the simulation modules as a whole and their integration. | env/sim.mjs integration |
| Gameplay Programmer | core | Implements units, abilities and combat rules. | env/combat.mjs, env/commands.mjs |
| Pathfinding / Movement Programmer | core | Owns paths, detours, crowding and blocked-tile rules (the Worker freeze lives here). | env/path.mjs, env/movement.mjs |
| AI Programmer | core | Owns the built-in computer opponents and the sample player, and the player API's ergonomics. | players/sample-player.mjs, players/builtin-* |
| UI Programmer | core | Implements the HUD and any human controls. | viewer3d/hud.mjs |
| Replay / Observer Programmer | core | Owns replays: log format, the replayer, observer views and the TV director. | env/log.mjs, viewer/replay.mjs, viewer3d/world.mjs, viewer3d/camera.mjs |
| Scripting / Trigger System Programmer | on-call | Builds map scripts and triggers for missions and modes. | env/triggers.mjs |

## Engineering · Online

| Role | Status | Scope | Owns |
|---|---|---|---|
| Lead Online / Network Engineer | on-call | Owns human-vs-human online play if added. | online/ |
| Network Programmer | core | Owns lockstep determinism: same seed and commands give byte-identical logs; desync detection. | tests/sim-determinism.test.mjs, env/rng.mjs |
| Matchmaking / Ladder Engineer | core | Owns the bot ladder: round-robin schedule, ratings, standings for the AI players. | ladder/ |
| Backend / Services Engineer | on-call | Owns any shared services (results store, match history). | services/ |
| DevOps / Site Reliability Engineer | core | Owns the harness staying up while the swarm runs: watchdog, restarts, disk, the air link. | control-room/bin/watchdog.mjs |
| Anti-Cheat Engineer | core | Owns fair play for bots: sandboxed players, time limits, no reaching outside the API. | env/referee.mjs + env/player-worker.mjs review |
| Security Engineer | core | Owns safety of the swarm: what agents may touch, asset downloads, secrets out of the repo. | SECURITY.md |
| Database Engineer | n/a | No database; results are files. |  |
| Data / Telemetry Engineer | core | Owns match stats extraction: per-unit damage, income curves, win rates, for balance. | analytics/ |

## Art

| Role | Status | Scope | Owns |
|---|---|---|---|
| Lead Artist | core | Runs the art team day to day and integrates everyone's work into one look. | art task list |
| Concept Artist | core | Designs units, buildings and the plateau as reference sheets the modelers follow (original designs only). | concept/ |
| Lead Character / Unit Artist | core | Owns unit models and their silhouettes. | viewer3d/units.mjs art sign-off |
| 3D Unit Modeler | core | Builds the low-poly unit and building models (or adapts CC0 ones). | assets/models/ (own work) |
| Environment Artist | core | Builds the plateau, cliffs, crystal fields and sky. | viewer3d/terrain.mjs |
| Prop Artist | on-call | Adds debris, wrecks, scattered details. | assets/models/props |
| Texture / Material Artist | core | Owns materials and textures: metal, rock, crystal, emissive strips. | viewer3d/palette.mjs materials |
| Technical Artist | core | Bridges art and code: import pipeline, LODs, shader params, performance of art. | viewer3d/assets.mjs pipeline |
| Rigger | on-call | Rigs any skinned models so they animate. | assets/models rigs |
| Animator | core | Animates walk, attack, death, construction and idle loops. | animation clips |
| VFX Artist | core | Designs and tunes lasers, sparks, explosions, delivery sparkles, dust. | viewer3d/vfx.mjs |
| Lighting Artist | core | Owns the dusk lighting, rim light, fog and mood. | viewer3d/engine.mjs light settings |
| UI Artist / Icon Artist | core | Draws the HUD frames, unit icons and minimap style. | viewer3d/hud assets |
| Marketing / Key Art Illustrator | on-call | Makes the title card and key art for the show. | art/key |

## Cinematics

| Role | Status | Scope | Owns |
|---|---|---|---|
| Cinematic Director | on-call | Owns the intro and victory/defeat sequences and the TV director's 'shots'. | cinematics/ |
| Cinematic Producer | on-call | Schedules cinematic work. |  |
| Storyboard Artist | on-call | Boards the intro and camera moves. | cinematics/boards |
| Layout / Previs Artist | on-call | Blocks camera paths for in-engine sequences. | cinematics/previs |
| Cinematic Modeler / Animator / Lighter | on-call | Builds hero shots in-engine. | cinematics/scenes |
| Compositor | on-call | Final look of rendered sequences. |  |
| Editor | core | Cuts match highlights from logs and recordings for the show. | recordings/highlights |

## Audio

| Role | Status | Scope | Owns |
|---|---|---|---|
| Sound Designer | core | Creates or picks every sound effect (CC0 or original) and tunes them. | assets/audio/ |
| Composer | on-call | Original music: menu theme, match ambience, victory sting. | assets/audio/music |
| Music Producer | on-call | Mixes and masters the music. |  |
| Audio Implementer | core | Hooks sounds to game events with priorities and variation. | viewer3d/audio.mjs events map |
| Voice Director | on-call | Directs unit voice lines if added (synthetic or licensed). |  |
| Casting Director | n/a | No human voice cast. |  |
| Voice Actors | n/a | No human voice cast. |  |
| Foley Artist | on-call | Footsteps and mechanical detail sounds. | assets/audio/foley |
| Mix Engineer | core | Final balance of all audio so fights read clearly. | mix settings |

## QA

| Role | Status | Scope | Owns |
|---|---|---|---|
| QA Lead | core | Owns the test plan and quality bar; decides what counts as green for a build. | TEST-PLAN.md |
| QA Analyst / Test Lead | core | Turns the spec into test areas and finds the gaps. | tests/ coverage map |
| QA Tester | core | Plays matches and replays, files bugs with exact repro (seed, tick, owner). | BUGS.md |
| Balance / Multiplayer Tester | core | Runs many bot-vs-bot matches and reports balance problems with data. | analytics/balance-reports |
| Compatibility Tester | core | Checks Safari, Chrome, the TV display and Retina. | COMPAT.md |
| Localization QA | n/a | English only for now. |  |
| SDET / Test Automation Engineer | core | Builds the automated suite runners and the Live Build Compiler's checks. | tests/run-all.mjs |
| Certification / Compliance Tester | core | Checks license compliance: every asset has a CC0/permitted license recorded, nothing from other franchises. | assets/LICENSES audit |

## Localization

| Role | Status | Scope | Owns |
|---|---|---|---|
| Localization Manager | n/a | English only for now. |  |
| Translator | n/a | English only for now. |  |
| Localization Engineer | on-call | Keeps text in one table so it could be translated later. | text/strings.json |
| Cultural Consultant | n/a |  |  |

## Research

| Role | Status | Scope | Owns |
|---|---|---|---|
| Games User Researcher | core | Watches what Joshua looks at and asks about, and reports what's confusing in the game and the live view. | RESEARCH.md |
| UX Researcher | on-call | Tests the HUD and controls for clarity. |  |
| Data Analyst | core | Turns match data into plain-English findings (win rates, game length, unit usage). | analytics/reports |
| Data Scientist | on-call | Ratings model for the bot ladder; balance modeling. | ladder/ratings |

## Esports

| Role | Status | Scope | Owns |
|---|---|---|---|
| Esports Program Manager | core | Runs the AI tournament: brackets, rules, schedule. | TOURNAMENT.md |
| Tournament Operations | core | Runs matches fairly with the referee and publishes results. | tournament/results |
| Observer / Broadcast Tools Producer | core | Owns the TV broadcast view: director camera, overlays, replays of key moments. | live broadcast overlays |
| Community Manager | n/a | No public community yet. |  |
| Social Media Manager | n/a |  |  |
| Content Creator Relations | n/a |  |  |
| Pro Player Liaison / Balance Council Coordinator | core | Runs the 'balance council': each model's player team gives feedback on balance (not strategy). | BALANCE-COUNCIL.md |

## Live Ops

| Role | Status | Scope | Owns |
|---|---|---|---|
| Live Ops Producer | on-call | Owns ongoing updates after the first tournament. |  |
| Patch Manager | core | Bundles balance and fix changes into numbered patches with notes. | PATCHES.md |
| Release Manager | core | Tags releases on GitHub and decides what's in each. | GitHub releases |
| Player Support / Customer Service Lead | n/a |  |  |
| Game Master | n/a |  |  |

## Business

| Role | Status | Scope | Owns |
|---|---|---|---|
| Product Manager | on-call | Owns what Driftfall is for (demo, product, research) and its roadmap. | ROADMAP.md |
| Marketing Director / Brand Manager | on-call | Owns how Driftfall is presented (name, tagline, trailer). |  |
| PR Manager | n/a |  |  |
| Partnerships / Business Development | n/a |  |  |
| Legal / IP Counsel | core | Owns originality and licensing: no StarCraft or other franchise names, art or sounds; asset licenses valid. | LEGAL.md |
| Licensing / Rights Manager | core | Keeps assets/LICENSES current and attributions displayed where required. | assets/LICENSES.md |
| Finance / Business Analyst | core | Tracks the swarm's real cost per team and per milestone. | COSTS.md |
| Ratings & Compliance Specialist | n/a |  |  |

## Studio

| Role | Status | Scope | Owns |
|---|---|---|---|
| Studio Manager | n/a | The harness is the studio. |  |
| Recruiter / Talent Acquisition | core | Decides which roles to spawn next and on which model, from what the swarm is blocked on. | roles/roles.json status |
| HR / People Partner | core | Keeps the swarm kind and collaborative: flags rude or dismissive messages and helps settle disagreements. | chat etiquette |
| IT Support | core | Keeps both Macs, the bridges and the air runner working for the swarm. | harness health |
| Office / Facilities | n/a |  |  |
