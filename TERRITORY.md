# Driftfall: territory on a drifting world

> Joshua, 18:03: "Watch a game of StarCraft, write down all the upgrades and tiers of tech and timings and
> incorporate this, but instead this game is about how to handle territory among an ever-changing environment."
> Joshua, 18:07: "Add them to the game and make it live always as the editions are being added. Making mining
> something you need to build up to like Factorio, and a military that has an upkeep spend, but they'll always be
> trained, they just cut into the budget."
> Joshua, 18:08: "The map also needs to be bigger."
> Joshua, 18:27: the serpent faction is called **the Snakenators**; art style is hand-drawn video game art, funny but played straight.

**Status: Joshua approved the direction. The swarm settles the numbers by accord: fable, sonnet and haiku each post
`AGREE: territory`, or decline a part with a reason and an alternative.** Builds on CLASSIC.md (fast, simple, live)
and ENV-SPEC-v3-draft.md (roster, two resources). The classic's structure we borrow is in
research/CLASSIC-TECH-REFERENCE.md. Every name here is original. Numbers are starting points; once agreed they live
in env/stats.mjs.

## 1. The game in one paragraph

The land drifts. Shard fields run dry and new ones surface, lowlands flood and drain, quakes open and close ramps,
and storms roll across the map, all on a **public clock** both players can see coming. Territory is the set of
**Reaches** you have *claimed* and can *still hold*. Holding Reaches pays income, cheapens your army and unlocks your
tech tiers. Mining is something you build up, from Workers carrying by hand to Drills, Track lines and Presses. Your
army always trains, but every unit has upkeep that eats your budget. The Snakenators (serpents; formerly "the Coil", and `coil` is still the key in code) are best at taking new
ground fast; the Burrow (wombats) are best at holding ground and moving under it.

## 2. The map: bigger, cut into Reaches

- **128 × 128 tiles** (was 40 × 40), the size of a standard classic 1v1 map, point-mirrored. The 40 × 40 v3 map
  stays for tests and quick matches (`?map=v3`).
- **21 Reaches**: 10 per side, mirrored, plus the neutral **Centre** with its rich field. Each side has a Main,
  Natural, two Vent Reaches, a Flank, a Mesa, a Pocket, a Rich Reach, and two Outer Reaches that The Fall crumbles
  first.
- **Hand-drawn at the Reach level, filled by seed.** `maps/layout-v4.mjs` draws each Reach's outline, height, ramps,
  fields and vents for the top half and mirrors it; the seed scatters rocks and Rubble inside the Reaches.
  Output: `maps/driftfall-v4.json` (`version: 4`).
- Distances grow ~3×: Main to Main is about 75 s for a normal ground unit (the classic is ~60–90 s). Sight and
  weapon ranges stay the same.
- **Performance:** paths use the tile grid plus a coarse Reach graph (between Reaches first, then tiles inside), so
  200 units on 128 × 128 still hold 24 ticks a second. The renderer draws only tiles in view plus a margin; fog is
  updated only near units; the minimap redraws on Drift events.

## 3. Territory: claim and hold

- **Claim:** a Worker builds your faction's claim structure in a Reach (the Snakenators **Totem**, the Burrow **Mound**:
  100 Shards, 20 s, 300 hp, sight 6). Your Main is claimed from the start (the Core counts as its claim, so Hold
  starts at 1).
- **Hold:** you hold a Reach while you have a complete claim there **and** no enemy combat unit has stood in it for
  10 s without one of yours present. Contested Reaches flash on the minimap.
- **Holding gives:** sight of the whole Reach, +25% mining there, lower army upkeep (section 9), and +1 to your
  **Hold count**.
- **Territory win (the second way to win):** hold **14 of 21** Reaches for 90 s. The countdown is shown to both
  players. Destroying the Core still wins outright.

## 4. The Drift (the ever-changing environment)

Seeded and deterministic: same seed, same Drift. Every event is **announced 30 s ahead** with a banner, a minimap
marker and a sound. The warning is the point: like the classic's known build timings, it creates a clock both
players can plan around and fight over.

| Event | What changes | Lasts | Why it's fun |
|---|---|---|---|
| **Bloom** | A new rich Shard field surfaces in a named Reach. | Until mined out | A race: whoever claims it first gets the income. |
| **Dry-out** | A field shrinks to a third of what's left. | Permanent | Forces you off a base before you're ready. |
| **Flood** | A lowland Reach becomes water. Ground units can't enter; any inside are pushed to the nearest dry tile and take 10 damage (never below 1 hp). Claims and Tracks there stop working. | 60 s | Cuts territory in half for a minute: the time to hit what's on the other side. |
| **Quake** | One ramp closes (rubble) and one cliff edge elsewhere opens into a ramp. Tracks on changed tiles break. | Permanent | Old walls stop working. The map you scouted at 3:00 isn't the map at 9:00. |
| **Squall** | A band of storm drifts across the map. Inside it, sight drops to 2 and air can't fly. | 45 s | Ambushes, and cover to move a claim-builder unseen. |

| Game time | Drift | Intent |
|---|---|---|
| 0:00 – 3:00 | none | A clean opening: workers, first production, first claim. |
| 3:00 | Bloom in each side's Flank (mirrored) | The first race: expand toward it or attack the other side's builder. |
| 5:00 | Squall over the Centre + Bloom in the Centre | The first big fight, as tier 2 lands. |
| 7:00 / 8:00 | Flood in one side's Natural, then the other's | A timing window each side can see coming. |
| 9:00 | Quake: a main ramp closes, the Mesa gets a new ramp | Old defences go stale; tier 3 arrives. |
| every 2:00 after | Random from the table, weighted toward Dry-outs | The map keeps shrinking toward the middle. |
| 14:00 | **The Fall**: Outer Reaches crumble to rock, one every 20 s | Ends long games by ~16:00. |

## 5. Tiers, gated by territory

Three tiers, like the classic, but **a tier needs both a building and land**.

| Tier | Needs | Typical time | Unlocks (v3 roster, reskinned per faction) |
|---|---|---|---|
| **1** | start | 0:00 | Worker, Grunt, Lancer, Turret, Siphon, Forge, claim, Drill, Depot, Track, weapons/hide **level 1** |
| **2** | Foundry or Sanctum **and Hold ≥ 3** | 3:30 – 4:30 | Brute, Spiker, Howler, Dart, Mender, Shade, Mast, Press; unit upgrades; weapons/hide **level 2** |
| **3** | Hangar **and Hold ≥ 6** | 8:00 – 10:00 | Skiff, Barge, Seer, Conduit; faction capstones; weapons/hide **level 3** (these cost Alloy) |

**Dropping below the Hold a tier needs pauses that tier**: its production and research stop (shown in amber) until
you hold enough again. Units you already have keep fighting. An enemy who takes two of your Reaches can freeze your
tech without touching your base.

## 6. Upgrades

Costs are `Shards/Flux` (`/Alloy` where noted); times in game seconds.

**Shared skeleton (both factions, own names in game):**
- **Weapons** 1/2/3 and **Hide** (armor) 1/2/3 for ground, and the same for air. Each level: +1 damage per hit or +1
  armor. 100/100, 175/175, 250/250 + 50 Alloy; 60, 75, 90 s. Hide costs 25% more, rounded to 5: 125/125, 220/220,
  315/315 + 50 Alloy. Levels 2 and 3 need tiers 2 and 3. Ids in `env/stats.mjs`: `weaponsGround1` … `hideAir3`.
- **Land upgrades:** **Drift Sense** (see Drift warnings 60 s ahead, tier 1, 100/50, 45 s); **Deep Claim** (claims
  build 40% faster and take 10 s longer to lose, tier 2, 150/100, 60 s); **Hold Fast** (claims gain a weapon:
  8 damage, range 4, tier 2, 150/150, 75 s).
- **Mining upgrades** (numbers proposed by fable in the accord):

| Upgrade | Effect | Tier | Cost | Time |
|---|---|---|---|---|
| Drill Speed 1 | Drills and Siphons mine 25% faster | 2 | 100/50 | 50 s |
| Drill Speed 2 | another +25% | 2 | 150/75 | 60 s |
| Drill Speed 3 | another +25% | 3 | 200/100/25 | 70 s |
| Track Speed | Tracks carry 2 loads a second | 2 | 100/100 | 60 s |
| Bigger Buffers | Drill, Siphon and Depot buffers hold 50% more | 2 | 100/50 | 45 s |
| Twin Press | a Press makes 2 Alloy per cycle | 3 | 200/100/50 | 75 s |

Every tier-3 upgrade costs Alloy and nothing below tier 3 does. `tests/stats-territory.test.mjs` reads the Snakenators and
Burrow tables above straight from this file and checks them against `STATS.upgrades`, so edit both or the build goes
red.

**The Snakenators: serpents, cyan.** Fast, fragile; good at taking ground.
| Upgrade | Effect | Tier | Cost | Time |
|---|---|---|---|---|
| Sidewind | Grunt-role "Fang" +50% speed | 2 | 100/100 | 55 s |
| Long Strike | Lancer-role "Spitter" +2 range | 2 | 150/150 | 65 s |
| Swimmers | Ground units cross Flood water at half speed and take no Flood damage | 2 | 150/100 | 60 s |
| Shed Skin | A claim can be packed up and moved to a new Reach | 2 | 100/100 | 50 s |
| Venom | Shade-role "Adder" attacks slow the target 50% for 3 s | 3 | 200/200/50 | 80 s |
| Constrict | Conduit-role "Charmer" can hold one unit in place for 4 s | 3 | 200/200/50 | 90 s |

**The Burrow: wombats, amber.** Slow, tough; good at holding ground and moving under it.
| Upgrade | Effect | Tier | Cost | Time |
|---|---|---|---|---|
| Tunnels | Ground units walk into one Mound and come out of any other own Mound 3 s later. Tunnels ignore Floods and Squalls; a Quake collapses that Reach's tunnel for 30 s. | 2 | 150/100 | 60 s |
| Thick Hide | Brute-role "Bulldozer" +2 armor | 2 | 150/150 | 65 s |
| Cube Press | Diggers and Drills hold 25% more (ore compacted into cubes) | 2 | 100/100 | 55 s |
| Bank Up | Workers can build dirt walls (1 tile, 150 hp) | 2 | 75/50 | 40 s |
| Undermine | A Mound can be built in a Reach the enemy holds; their hold there breaks after 20 s | 3 | 200/200/50 | 80 s |
| Rumble | Siege-role "Thumper" splash also stuns for 1 s | 3 | 200/200/50 | 90 s |

## 7. Target timings (what a good game should look like)

A Driftfall match is ~12–16 minutes; the classic's phases are compressed by about a quarter.

| Time | Event (a standard, safe game) |
|---|---|
| 0:00 | 6 Workers hand-mining; Worker production nonstop |
| 0:45 | First Drill on the home field; Workers switch to hauling |
| 1:15 | Forge; Siphon on the first Vent |
| 1:45 – 2:30 | Second claim, the Natural (Hold 2); first Track line home |
| 3:00 | **Bloom** in the Flank: third claim race (Hold 3) |
| 3:30 – 4:30 | **Tier 2** online; first Press |
| 4:30 – 5:30 | First unit upgrade (Sidewind / Tunnels); Weapons 1 |
| 5:00 | **Centre Bloom + Squall**: the first big fight |
| 6:00 – 7:00 | Hold 4–6; 2–3 production buildings; upkeep near income |
| 7:00 – 8:00 | **Floods** at the Naturals: the timing windows |
| 8:00 – 10:00 | **Tier 3** (Hold 6); Weapons/Hide 2 |
| 9:00 | **Quake** reshapes the main ramps and the Mesa |
| 12:00 + | Level-3 upgrades; the map shrinks; a territory win or a Core kill |
| 14:00 | **The Fall** starts |

## 8. Mining you build up to (like Factorio)

Mining starts by hand and grows into a production line you design, lay out and defend. Income is a **rate** (per
minute), shown on the HUD.

| Stage | How Shards and Flux arrive | Unlocked by |
|---|---|---|
| **0. Hand** | Workers walk to a field, mine, carry 5 back. Slow on purpose: an opening, not an economy. | start |
| **1. Drills** | A **Drill** (on a Shard tile, 75 S, 200 hp, 15 s to build) mines on its own, 2 Shards a second (one every 12 ticks), into a buffer of 20. Workers haul from the Drill to the Core or a **Depot** (100 S, 300 hp, 20 s). A Siphon on a Vent works the same way for Flux, 2 a second. | tier 1 |
| **2. Lines** | **Track** tiles (5 S each, 50 hp, 1 s to lay, walkable) carry loads of 5 from a Drill or Siphon to a Depot or the Core, one load per tile per second, no Workers needed. **Tracks can be cut**: an enemy standing on or destroying a Track stops the flow. A line through a Reach you don't hold runs at half speed. | tier 1 + Hold 2 |
| **3. Refining** | A **Press** (200/100, 400 hp, 30 s) takes Shards + Flux from lines and makes **Alloy** (2 S + 1 F into 1 A every 2 s). Alloy pays for tier-3 units, level-3 upgrades and capstones. | tier 2 |
| **4. Scale** | Drill Speed 1/2/3, Track Speed, Bigger Buffers, Twin Press. | tiers 2–3 |

- **The Drift hits the line.** A Flood stops Tracks in that Reach; a Quake breaks Tracks on the tiles it changes; a
  Dry-out starves the Drills on that field. Rebuilding and re-routing lines is part of holding territory.
- **Factions:** the Snakenators lay **Coils** (Track that crosses water at half speed, so Floods only slow them). The Burrow
  lay **Runs** underground (ignore Squalls and can't be stood on, but a Quake breaks them), and their buffers hold 30
  because Diggers compact ore into cubes.
- The HUD's **flow panel** shows Shards/min, Flux/min, Alloy/min, upkeep/min and the net. Clicking a Drill, Track or
  Press shows its throughput and whether it is starved, blocked or full.

## 9. Army upkeep: always trained, it just cuts into the budget

- **No supply cap.** Berths, the cap and the `no-berths` rejection go away; Quarters are removed.
- **Training never stalls for money.** A train order always runs. Its cost is drawn gradually while it trains (cost
  ÷ train time each tick). If the bank is empty, the draw goes into **debt** instead of pausing.
- **Every combat unit has upkeep**, drawn every second while it lives: per minute, 10% of its cost (a 150 S Brute
  costs 15 S a minute; a 150/100 Howler costs 15 S + 10 F). Workers, Drills and structures have none.
- **The budget is the net:** income rate − upkeep rate. Below zero the side is **in debt**:
  - in debt, construction and research pause; units keep training;
  - deep debt (below −500 S) makes units **weary**: −25% attack speed until back above −500;
  - debt never kills or removes units. You fix it by earning more, holding more land, or losing units.
- **Territory pays the army.** Each held Reach lowers the whole army's upkeep by 3% (max −30%). Burrow Mounds lower
  it a further 2% each. Snakenator units cost 20% less upkeep while inside a Reach the Snakenators holds. All discounts together
  never pass −60% (sonnet's budget assumption, kept).
- **Why it's fun:** a big army is always possible, but it eats the economy that builds the next one. The question
  stops being "am I supply blocked?" and becomes "can my mining line and my land carry this army?"

## 10. Always live: editions

- The playable game is always the latest good build. Each green build from the Live Build Compiler is an **edition**
  (edition N = build N, with what changed in plain words, from live/status.json).
- `play/index.html` follows the Control Room's stream. When a new edition passes its checks, the page shows
  "Edition N: what's new" for 3 s and reloads into a fresh match. A red build never reloads the page; it keeps the
  last good edition and shows "Edition N+1 is being fixed".
- The TV (Swarm TV) and Build Mode show the same game at the same edition, so Joshua watches features appear.
- Every edition is kept in `editions/<N>/` (play/, env/ and stats) so any edition can be opened again.

## 11. What changes in the code (owners settle in the accord)

- `maps/layout-v4.mjs`, `maps/driftfall-v4.json`, `env/map.mjs`, `env/path.mjs`: the 128 × 128 map and Reach graph.
- `env/territory.mjs`: Reaches, claims, hold, Hold count, territory win.
- `env/drift.mjs`: the seeded Drift schedule and its five events.
- `env/economy.mjs`: Drills, Depots, Track, Presses, Alloy, flow.
- `env/budget.mjs`: training draw, upkeep, debt, weariness.
- `env/stats.mjs`: tiers, Hold needs, every upgrade, both factions' names and numbers.
- `env/sim.mjs`: wiring, tier pause, research queues, Flood push-out, Tunnels, new commands.
- `play/`: Reach borders, Drift banner, flow panel, Track laying, research card, edition reload.
- `players/builtin/ai.mjs`: plays the new rules, with an easy setting a new human can beat.
- Tests first for each, as before.

## 12. Many resources and the Trading House (Joshua, 18:28: "there are all sorts of different resources, but the trading house pays more or less depending on how much of it you have; scarcity sells for more")

**More resources, tied to the drifting land.** Shards and Flux stay the basics, and Alloy stays the refined one. Five
**rare resources** appear only in certain Reaches or after certain Drift events, so holding the right land at the
right moment is what makes you rich:

| Resource | Where it comes from | Natural use |
|---|---|---|
| **Glowmoss** | Grows in a lowland Reach for 2 min after its Flood drains | Healing and the Shedder (medic) line |
| **Stormglass** | Forms where a Squall passed; Workers pick it up off the ground | Air units and sight upgrades |
| **Quakestone** | Exposed on tiles a Quake changed | Armour (Hide) upgrades and walls |
| **Ironroot** | Grows slowly on Mesa Reaches only | Siege units and the Press (Twin Press) |
| **Amberlight** | One deposit in the Centre, refilled by each Bloom | Tier-3 capstones |

Each faction also *prefers* some of them (the Snakenators use more Stormglass and Glowmoss, the Burrow more
Quakestone and Ironroot), so what one side hoards the other side wants.

**The Trading House** (tier 1, 150 Shards, one per side at first; a second needs Hold 4) buys and sells every
resource for Shards.
- **Scarcity sets the price.** Each resource has a base price. The price you get for selling one unit is
  `base × scarcity`, where scarcity compares how much of that resource exists in **both sides' banks plus the market**
  to a target amount: `scarcity = clamp(sqrt(target / (held + market + 1)), 0.25, 4)`. If almost nobody has
  Ironroot, it sells for up to 4× base; if both sides are swimming in Shards, they sell for a quarter.
- **Your own pile matters too.** The more of a resource *you* hold, the less each extra unit you sell fetches
  (each sale lowers the price for the next one, and the dip recovers over about 60 s). Dumping a hoard all at once
  crashes your own price, so you sell into scarcity, not out of panic.
- **Buying** costs the sell price plus a 25% spread, so trading is never free money.
- **The market remembers.** Sold resources sit in the market's stock and drain away at 2% a second; prices drift
  back toward base. A Drift event that creates a resource (a Flood that grows Glowmoss) drops its price right after.
- **Cornering:** hold every Reach that produces a rare resource and the other side can only buy it from the market,
  at your scarcity price. The territory game and the economy game become the same game.
- The HUD shows a small **market strip**: each resource's current sell price with an up/down arrow, and a 2-minute
  sparkline. The Trading House's card has sell 10 / sell 50 / buy 10 buttons and shows the price after the trade
  before you commit.

**The numbers** (fable's proposal in the accord; they live in `STATS.resources` and `STATS.market`):

| Resource | Base price (Shards a unit) | Scarcity target | Yield |
|---|---|---|---|
| Flux | 2 | 600 | from Vents, as section 8 |
| Alloy | 5 | 200 | from Presses, as section 8 |
| Glowmoss | 6 | 100 | 60 per drained Flood, growing over 120 s |
| Stormglass | 8 | 100 | 40 dropped along a Squall's path |
| Quakestone | 6 | 100 | 30 on the tiles a Quake changed |
| Ironroot | 10 | 100 | 1 every 10 s per Mesa you hold |
| Amberlight | 15 | 100 | 100 in the Centre at the start, +50 per Bloom |

Shards are the currency and are not sold. Scarcity is clamped to 0.25 … 4, buying adds 25%, the market's stock drains
2% a second, and each unit you sell dips your own price 1%, recovering over 60 s. The Trading House: 150 Shards,
400 hp, 25 s, tier 1, one per side, a second at Hold 4. The Snakenators' medic (the Mender role) is the **Shedder**.

## 13. Scope and feel (Joshua, 18:34)

> "It needs to be intuitive at every level. Really find a lot of ideas from SC and SC2 and then scarcity market
> games, but keeping things fast paced and balanced. We'll start with only one race, which are the Snakenators."

- **One race first: Snakenators vs Snakenators** (a mirror match). The Burrow is parked until the Snakenators feel
  great; every number is balanced as a mirror first.
- **Intuitive at every level** is a requirement with tests, not a hope:
  - every button shows its hotkey, cost (with the *current* market price where it matters) and one plain sentence;
  - command cards use one fixed grid layout so the same key does the same kind of thing everywhere;
  - every rule the player can lose to is visible on screen before it bites: Drift warnings, Hold count vs tier
    needs, upkeep vs income, debt, a Reach being contested, a Track being cut, a price crashing;
  - the first 3 minutes teach themselves with short contextual prompts (no tutorial screen);
  - QA plays each new edition as a first-timer and files anything that needed explaining.
- **Borrow what made the classics and their sequel smooth** (principles only, no names or numbers): unlimited
  selection and control groups, smart-cast so one press per caster works, rally points into mining, queued orders,
  alerts with a jump-to key, idle-worker button, clear audio barks, a fixed hotkey grid.
- **Borrow from scarcity-market strategy games:** prices that react to supply instantly and visibly, selling into
  shortage, cornering a resource by controlling where it comes from, and a short, decisive match where the
  economy itself is a weapon.
- **Fast and balanced:** matches 12–16 minutes; no single upgrade, unit or trade decides a game alone; the balance
  tester runs hundreds of mirror matches between built-in AIs per edition and flags win-rate drift beyond 45–55%.

## 14. Accord record (who agreed what, and what they changed)

- **sonnet, AGREE: territory** (sections 2, 3, 9, 10, 11). Changes kept: `env/territory.mjs` names the events
  `claimed`, `contested`, `hold-gained`, `hold-lost`, `countdown-start`, `countdown-cancel`, `territory-win` and the
  win result `reason: 'territory'`; the Core claims its Main; the 128 × 128 map stays opt-in (`legacy` is the default
  map name) until the stats rescale lands; all upkeep discounts cap at 60% together; every new module is off until
  the sim enables it (`enableBudget`, `createTerritory`, `createTerritoryMatch`). Flood push-out deals 10 damage
  and never kills (sonnet's assumption, kept, in `STATS.drift.flood`).
- **haiku, AGREE: territory** (section 4, Drift). Changes kept: the 9:00 Quake closes a Main ramp on one side and
  opens the Mesa ramp on the *other* side, so both bases change; the random slots are 11:00 and 13:00 only, since
  The Fall starts at 14:00; random events never touch the Outer Reaches or the Centre; which Natural floods first
  is seeded.
- **Joshua, 18:27:** the serpents are **the Snakenators**. Shown names change everywhere; the code key `coil`
  (`STATS.factions.coil`, `coilHeldDiscount`, `claims.coil`) stays so no module has to be renamed mid-round.
- **fable, AGREE: territory** (sections 5, 6, 8, 9 numbers). Changes kept: Hide costs rounded to 5; the mining
  upgrade numbers above; claim hp 300; Drill and Siphon at 2 a second with loads of 5 on Tracks (the Mining chain's
  numbers); hp and build times for Drill, Depot, Track and Press. Everything lives in `env/stats.mjs` under
  `STATS.territory`, `tiers`, `upgrades`, `factions`, `economy` and `upkeep`, checked by
  `tests/stats-territory.test.mjs`, which also pins parity with `env/budget.mjs` and `env/territory.mjs`.
- **Joshua, 18:34:** one race first, Snakenators vs Snakenators, the Burrow parked; `STATS.factions.sides` is
  `['coil', 'coil']` and `STATS.factions.burrow.parked` is true until the Snakenators feel great. The Burrow's
  numbers stay in the tables so nothing is lost.

## 14. Bigger maps, neutral camps, items for recurring troops (Joshua, 19:30)

> "I want to watch two AIs battle. Also the maps need to be bigger, and there should be neutral camps, as well as
> items you can get for your recurring troops."

**Bigger maps.** Three sizes, all mirrored and hand-drawn at the Reach level: **Standard 128 × 128** (21 Reaches),
**Large 192 × 192** (31 Reaches, the default for watch mode), **Huge 256 × 256** (41 Reaches, for long games).
Territory win = hold two-thirds of the Reaches for 90 s. Distances stay readable: Tracks and Tunnels matter more,
and every map has a fast lane through the middle so armies meet before minute 6.

*As built (sonnet):* `maps/layout-sizes.mjs` holds the Large and Huge specs, drawn by the same code as Standard
(`maps/layout-v4.mjs`, `drawV4(spec)`). Rooms sit on a grid 4 tiles apart: Large is 5 × 3 Reaches a side + the Rift
(Centre) = 31, Huge is 5 × 4 + the Rift = 41. The middle column runs straight to the Rift, three doors feed the Rift
from each side, and one long link along each edge lets a flank force cross without touching it. Doors are left out on
purpose so there are lanes and chokes. Gate ids start at 48 (Large) and 64 (Huge) and the file stores 2 digits per id.
Win count is two-thirds rounded up: 14 / 21 / 28 (`winCountFor`). `?map=standard|large|huge` (or `DRIFTFALL_MAP=`)
picks the map; `v4` still means Standard; the default stays `legacy` until the sim runs these maps at full speed.
Tests: `tests/map-sizes.test.mjs` (counts, mirror, one connected piece, fair starts, fast lane, routing budget).

**Neutral camps.** Every Reach except the two Mains starts with a neutral camp guarding it: original creatures of the
drifting world (e.g. crystal-backed **Shardbacks**, packs of **Duneskippers**, a lone **Old Mossjaw** guarding the
Centre). Camps come in three strengths (marked on the minimap with 1–3 pips) and never leave their camp.
- **You can't claim a Reach while its camp stands.** Clearing camps is how you expand, and when.
- Clearing a camp pays a **bounty** (Shards, sometimes a rare resource) and **drops an item**. Stronger camps drop
  better items.
- Camps **respawn** 4 minutes after being cleared if no one holds that Reach: unheld land goes wild again.
- The Drift touches them too: a Bloom wakes a new camp next to the new field; a Flood drives a camp to higher ground.

**Items for recurring troops.**
- Any combat unit can carry **up to 2 items**. Items drop from camps as a glowing pickup; walk over it, or right-click
  it, to pick it up. Drop or swap them with the item card.
- Units that keep coming back are the point: units earn **Ranks** (1–3 stars) from kills and survived fights. When a
  ranked unit dies, it leaves its **Shed Skin** at the Nest: you can **Recall** it (costs half its price, takes its
  train time) and it returns with its rank and items. Your veterans become characters you keep alive and rebuild.
- Item ideas (numbers in env/stats.mjs, all original): **Fang Polish** (+damage), **Scale Plating** (+armour),
  **Crystal Monocle** (+1 range, +2 sight), **Rattle Bell** (nearby allies attack faster), **Molting Charm** (Recall
  costs nothing once), **Glowmoss Pouch** (slow self-heal), **Stormglass Shard** (first hit each fight stuns 0.5 s),
  **Ironroot Brace** (can't be pushed or slowed), **Amberlight Tooth** (rare: +1 rank).
- Intuitive: items show as two small slots on the unit's portrait, a glow on the unit, and a one-line tooltip.
