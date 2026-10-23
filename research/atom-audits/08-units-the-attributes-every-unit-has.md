# Atom audit 08: Units (the attributes every unit has)

Auditor: sonnet. Source: section 8 of research/STARCRAFT-ATOMS.md. Checked against env/stats.mjs (STATS.units has only
worker, grunt, lancer, brute live today), ENV-SPEC-v3-draft.md section 5/7 (the 14-kind roster, still a draft), env/items.mjs,
env/vision.mjs, TERRITORY.md sections 6, 14, and play/hud.mjs + play/command-card.mjs. Edited nothing else.

Key finding: the live unit table is a 4-row sheet (cost, hp, damage, range, speed, trainTicks). The richer attributes exist
as a v3 draft table, as item/upgrade data, or in vision.mjs, but combat.mjs never reads armour, cooldown or hits.

| # | Line | Verdict | Evidence / note |
|---|------|---------|-----------------|
| 1 | Cost: common + rare + supply | PARTIAL | `cost` (Shards) live; `flux` second cost in v3 table. Supply is NOT FOR US (no cap; upkeep replaces it, STATS.upkeep). |
| 2 | Build time | HAVE | `trainTicks` per kind. |
| 3 | Hit points | HAVE | `hp`; shown in HUD (hud.mjs maxHp, hpBar). |
| 4 | Shields | NOT FOR US | Regenerating second layer; Glowmoss Pouch + Shedder cover healing. Avoid a faction-specific mechanic with one faction live. |
| 5 | Armour value | PARTIAL | Data exists (items `armour`, Hide 1/2/3, Thick Hide) but only neutrals.mjs subtracts it (line 151). combat.mjs ignores it, so Hide upgrades do nothing in unit fights. |
| 6 | Armour type / size | MISSING | No tags. A cheap 3-value class (small/medium/large or Light/Hard/Massive) is the engine for counters. |
| 7 | Damage per hit | HAVE | `damage`; `structureMultiplier` is a tiny bonus-vs-tag already (brute x2 vs structures). |
| 8 | Attacks per volley | MISSING | Every attack is one hit. Matters only with armour; low priority. |
| 9 | Weapon cooldown | PARTIAL | Neutrals have `attackEvery`; v3 draft has `cooldown`; live units attack every tick, so range/hp alone define DPS. Howler 8-tick siege cannot exist without it. |
| 10 | Range (ground vs air) | PARTIAL | `range` live; draft `hits` + Spiker `airDamage`. No air in live game yet. |
| 11 | Minimum range | PARTIAL | In draft (Howler min 2); not in live stats/combat. |
| 12 | Targets: ground/air/both/none | PARTIAL | Draft `hits`/`layer`; live units hit everything. |
| 13 | Bonus damage vs tag / damage type | PARTIAL | Only `structureMultiplier` and Spiker airDamage (draft). No armour class to hang bonuses on. |
| 14 | Splash | PARTIAL | Howler splash in draft (20 within 1, flat, no falloff); no live code. |
| 15 | Movement speed | HAVE | `speed` (ticks per step), Sidewind +50%. Coarse: only 1 or 2, so no in-between speeds. |
| 16 | Acceleration / turn rate | NOT FOR US | Grid-tile, tick-based sim; no facing. Right call for a deterministic bot sim. |
| 17 | Sight range | HAVE | vision.mjs DEFAULT_SIGHT per kind, site sight, height rule, Monocle +2. Not in STATS.units rows, and HUD doesn't show it. |
| 18 | Flying or ground | PARTIAL | `layer` + air movement rules in draft; vision.mjs already handles air. Tier 3 only. |
| 19 | Size / radius | NOT FOR US | One unit per tile model; `berths` (transport size) is the only size and is draft. |
| 20 | Energy pool | PARTIAL | Conduit energy 50/100 and Pulse/Snare in draft; no live code. Tier 3 spell caster. |
| 21 | Detector | HAVE (draft) | Seer/Mast detect 8, 2-tick linger, in vision.mjs. Shade is the only hidden kind and not live yet. |
| 22 | Cloak / burrow | PARTIAL | Shade `hidden` in draft. Burrow-as-ability NOT FOR US (the Burrow faction tunnels instead). |
| 23 | Transportable, space | PARTIAL | Barge, `berths` in draft. |
| 24 | Mechanical vs biological | NOT FOR US | All units are creatures or crews; Mender heals, Workers repair structures. One rule, no tag. |
| 25 | Upgrades that affect it | HAVE | Weapons/Hide tracks, Sidewind, Long Strike, Venom etc. in STATS.upgrades, plus ranks and items. Many are inert until combat reads armour (row 5). |
| 26 | Voice lines + portrait | PARTIAL | Portraits drawn (assets/portraits, hud.mjs portraitSvg). Voice: not checked beyond sound-player; treat as MISSING. |
| 27 | Hotkey for training | HAVE | command-card.mjs: classic 4x3 grid, hotkey in every tooltip. |
| 28 | Clear role + counters | PARTIAL | Roles and a counters list are written in the draft (section 5), with a test planned. The player cannot see them: HUD shows only portrait and HP, no role line, no "good against / weak against". |

Also not in the list but worth noting: ranks (3/8/15 kills, +10%) and 2 item slots (TERRITORY section 14) are Driftfall's
own unit-attribute layer and are DESIGNED, ahead of the original on recurring troops.

## TOP 5 changes (best for how Driftfall plays first)

### 1. Make combat read armour, and add a three-value armour class
- What: in combat damage, subtract the target's armour (Hide level + item + Thick Hide) per hit, minimum 1. Give every
  unit kind `armourClass` (Light / Hard / Massive: Fang and Adder Light, Bulldozer Hard, Thumper Massive) and a small
  table of weapon bonus by class (e.g. Spitter x1.25 vs Light; siege x1.5 vs Hard). Keep it additive, with defaults of 0
  and 1.0, so current matches don't change until stats opt in.
- Owner: fable (env/combat.mjs + env/stats.mjs tables), sonnet for the balance sweep.
- Done when: a test shows a Hide 2 Grunt takes 2 less per hit; the counters test shows Spitter beats Fang and Bulldozer beats Spitter by class, not by luck; mirror win rate stays 45-55%; Weapons/Hide upgrades visibly change a fight.

### 2. Per-unit weapon cooldown (and attacks per volley) in live combat
- What: promote the draft `cooldown` field into STATS.units and make combat.mjs count it down per unit (default 1 =
  today). Retune damage so DPS stays about equal (a slow heavy hitter is 25 per 3 ticks). This unlocks Thumper
  siege, minimum range and the Rattle Bell attack-speed aura, which already exist as data.
- Owner: fable (combat/stats); haiku writes the DPS-parity test.
- Done when: unit DPS table in BALANCE.md equals old values within 5%; a unit with cooldown 8 fires once per 8 ticks in a replay; Rattle Bell and the Weary upkeep penalty change attack rate in a test.

### 3. Show role, counters and key stats in the HUD (identity you can read)
- What: the selection panel and the build-button tooltip get one line each: role ("Fast raider"), "Strong vs: ... Weak vs: ...", and a mini stat row (damage, range, speed, sight) with the armour class icon. Generated from STATS so numbers never go stale.
- Owner: haiku/play team (play/hud.mjs, play/command-card.mjs); fable supplies the `role`, `strongVs`, `weakVs` strings in stats.
- Done when: selecting any unit shows its role and counters on Joshua's screen; a stranger can pick a counter without help (Council item 7); a test fails if a unit lacks a role line.

### 4. Move the unit sheet into STATS.units: range, min range, targets, speed steps
- What: put `sight`, `hits` (ground/air/both/none), `layer`, `minRange`, `splash {radius, damage}` and a finer `speed`
  (tiles per second, not 1-or-2 ticks) into the live table for the tier-2 roster as it lands, so stats.mjs is the one
  truth that vision, combat, HUD and AI all read. Add a schema test that every kind has every attribute.
- Owner: fable (stats.mjs); sonnet for the roster numbers.
- Done when: vision.mjs DEFAULT_SIGHT is deleted in favour of the table; the schema test passes; adding Spiker/Howler/Dart needs no combat code edits beyond the fields.

### 5. Wire tier-2/3 specials as data-driven attributes: splash, hidden/detect, energy, transport
- What: one generic implementation each (flat splash with radius, `hidden` plus detectors from vision.mjs, energy with
  regen and a cast table, berths and board command), enabled kind by kind as they enter the live build, not as one
  big merge. Start with splash and hidden, which change fights most.
- Owner: fable (combat), sonnet (referee/commands, observation filtering of hidden units).
- Done when: in a headless match a sieged Thumper hits a clump for splash and a Shade is never in the enemy observation until a Mast or Seer is near; bot-vs-bot still ends in a Core or territory win.

Not recommended now: shields, turn rate, collision radius, mechanical/biological tags, supply (see table).
