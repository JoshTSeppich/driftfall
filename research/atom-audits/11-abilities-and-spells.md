# Audit 11: Abilities and spells (haiku)
Read: STARCRAFT-ATOMS.md section 11 (lines 133-142), NORTHSTAR.md, TERRITORY.md sections 6, 11, 13, 14.
Code read: env/stats.mjs (unit rows, upgrades, items, factions), env/items.mjs, env/effects.mjs, env/sim.mjs,
env/sim-territory.mjs, env/combat.mjs, env/commands.mjs, env/neutrals.mjs, play/items-ui.mjs, play/input.mjs
(`act()`), play/command-card.mjs, tests/items.test.mjs.

**The short version: the live match has no working active ability or spell.** Abilities exist as numbers in
`env/stats.mjs` and as code in `env/items.mjs` and `env/effects.mjs`, but the sim never calls most of it. Three facts
explain almost every verdict below:

1. **Items are off in the live game.** `enableItems()` is called only from tests. So `state.items` never exists:
   camps drop nothing (`dropPickup` returns null), no unit ever gets a Shed Skin, and no Recall button appears.
2. **`combat.mjs` and `movement.mjs` read none of the effect fields.** `unitMods()` (items) is called only by
   `env/neutrals.mjs`, so item buffs work on camp creatures and never on your troops. `slow`, `holdSeconds`,
   `stunSeconds`, `stunTicks`, `speedBonus`, `rangeBonus` and `armorBonus` are data only.
3. **Three of the four Snakenator casters have no unit row.** `STATS.units` (stats.mjs:143-146) has only worker, grunt,
   lancer and brute. Shade (Adder), Conduit (Charmer), Mender (Shedder) and Howler (Thumper) are named in the tier
   unlocks and the upgrades, but nothing can train or simulate them.

Also: the live game is a Snakenator mirror (`STATS.factions.sides = ["coil", "coil"]`, stats.mjs:222). The Burrow is
parked (stats.mjs:231, TERRITORY.md section 13), so Burrow-only abilities (Tunnels, Thumper splash, Rumble stun,
Undermine, Bank Up) are not live for anyone yet.

Overlap: sonnet's audit 09 already covers the per-unit attack cooldown and splash (rows 3a and 8 here), and audit 08
covers armour. Those are not repeated here.

## Verdict table

| # | Atom line | Verdict | Evidence / why |
|---|---|---|---|
| 1 | Spellcasters have energy; spells cost energy | NOT FOR US (v0.1) | A third meter beside Shards, Flux and Alloy works against "readable economy" (FANATICS.md item 5). Driftfall pays for things through the budget (TERRITORY.md section 9). Ability timers (row 8) do the job without a meter. |
| 2 | Energy regenerates slowly; upgrades raise cap or start energy | NOT FOR US | Follows from row 1. Driftfall's upgrades change effects directly (Venom, Constrict, Hold Fast). |
| 3a | Damage area (storm) | MISSING | `env/combat.mjs` has no area hit. The Thumper "splash" exists only in the upgrade text (stats.mjs:85) and has no unit row. |
| 3b | Disable (stasis, lockdown, fungal) | MISSING (data only) | Constrict's 4 s hold (stats.mjs:74-75), Rumble's stun (stats.mjs:85) and the Stormglass stun (stats.mjs:352, `stunOnHit`) are numbers. Nothing reads them, and `stunOnHit` is never called. |
| 3c | Buff (stim, guardian shield) | PARTIAL | Fang Polish, Scale Plating and the Rattle Bell aura work through `unitMods()`, but only `neutrals.mjs` calls it. They buff creatures, not your troops. Sidewind (+50% speed) and Long Strike (+2 range) are data only. |
| 3d | Debuff | MISSING | Venom's 50% slow for 3 s (stats.mjs:72-73) reads nothing, and its Adder has no unit row. |
| 3e | Summon | NOT FOR US (v0.1) | Recall already covers "bring the troops back". A summon adds units with no upkeep story and muddies the army budget. |
| 3f | Teleport (recall) | PARTIAL | `recall()` in `env/items.mjs:153` is complete and tested (tests/items.test.mjs). But `stepItems()` is never called, `enableItems()` never runs, and `play/input.mjs` `act()` has no `'recall'` case. The Recall buttons in `play/items-ui.mjs` need Shed Skins, which never exist, so the button never appears. |
| 3g | Teleport through a structure (Burrow) | PARTIAL | Tunnels is wired in the sim: `env/effects.mjs:91-116` and `env/sim-territory.mjs:163`. No button exists in `play/`, and the Burrow is parked, so no live player can use it. |
| 3h | Mind control | NOT FOR US | Taking a unit flips the fight and breaks "trustworthy orders" (FANATICS item 3). Constrict's hold gives the same "stop that unit" moment without swapping ownership. |
| 3i | Healing | MISSING | `combat.mjs` has no heal. The Glowmoss Pouch heal (items.mjs:200-207) runs in `stepItems()`, which is never called. The Shedder (healer) has no unit row. |
| 4 | Some abilities cost HP instead of energy | NOT FOR US | A hidden cost the player can't read conflicts with NORTHSTAR "everything that can make you lose is visible". |
| 5a | Siege mode | MISSING | No unit modes in `env/commands.mjs` (move, attack, stop, build, gather, train only). The siege role (Thumper) is Burrow-only and parked. |
| 5b | Burrow (dig in) as a toggle | NOT FOR US | Driftfall's version is Tunnels (row 3g): a route, not a stance. |
| 5c | Lift-off | NOT FOR US | Driftfall structures are fixed. The Drift takes the role of mobility. |
| 6 | Smart-casting (press once, one caster casts) | NOT FOR US (for now) | No multi-caster spells exist. Right-click smart commands (play/input.mjs) already cover move and attack. |
| 7 | BW casting (select each caster by hand) | NOT FOR US | A skill test. NORTHSTAR wants a stranger to understand the game without help. |
| 8 | Cooldown-based abilities | PARTIAL | There are no ability cooldowns and no cast button. Timers exist: Recall's `readyTick` (items.mjs:165), Tunnels' 3 s walk (effects.mjs:14), Quake's 30 s tunnel collapse (effects.mjs:114-116). |
| 9 | Autocast (heal, repair) | NOT FOR US (v0.1) | No toggled ability exists yet. Passives (Glowmoss, Shedder aura) are always on, which is the simpler form. Revisit when players ask for an off switch. |

**Tally:** HAVE 0 · PARTIAL 4 (3c, 3f, 3g, 8) · MISSING 5 (3a, 3b, 3d, 3i, 5a) · NOT FOR US 10 (1, 2, 3e, 3h, 4, 5b, 5c, 6, 7, 9).

No row is HAVE. The closest is Tunnels in the sim (3g), which has no button.

## Top 5 changes, ranked by how much they improve how Driftfall plays

Numbers are in ticks at 24 ticks a second (as in `env/effects.mjs`).

1. **Give the Snakenator casters a body.** Add unit rows for Adder (`shade`), Charmer (`conduit`) and Shedder
   (`mender`) to `STATS.units`, with cost, hp, damage, range, speed and train time. Put them on their tier 2 and 3
   unlocks. Until this lands, Venom, Constrict and the Shedder are text.
   - Owner: fable (`env/stats.mjs`, `tests/stats-territory.test.mjs`). Sonnet puts them on the card.
   - Done when: a test trains each kind at its tier; the stats parity test passes; an 8-seed mirror still lands at
     45-55% for each side; on the live page, a tier 2 match shows an Adder on the card.

2. **One status layer the sim reads.** Timed effects on a unit (slow factor, hold, stun, and speed, range, armour
   and damage modifiers, plus a heal per second) read in one place inside `combat.mjs` and `movement.mjs`. Wire
   Venom (slow 50% for 72 ticks), Constrict (hold 96 ticks), Stormglass (first hit stuns 12 ticks), Sidewind,
   Long Strike, and Glowmoss (1 hp/s). Only researched upgrades and carried items switch them on, so the default game
   does not change.
   - Owner: fable (`combat.mjs`, `movement.mjs`, `sim.mjs`). Sonnet adds a tint and a short "Slowed" or "Held" word in
     the hit feed (`play/units-instanced.mjs`, `play/hud.mjs`).
   - Done when: a test shows an Adder hit halves the target's speed for 72 ticks and then restores it; a Charmer hold
     stops the target for 96 ticks; the sim-determinism test stays green; on the live page a slowed unit is tinted.

3. **Constrict as an ordered ability with a cooldown.** The Charmer's Constrict becomes a card button with a free
   hotkey and a cooldown sweep (20 s, a starting number). It fires only on a chosen target in range, never by itself.
   - Owner: fable (a new command in `env/commands.mjs`, cooldown state). Sonnet (`play/command-card.mjs`, `act()` case
     in `play/input.mjs`, the sweep).
   - Done when: a test refuses the cast with no target in range or during cooldown, and the hold lasts exactly 96
     ticks; on the live page, press the key, click a target, see the hold and the cooldown counting down.

4. **Plug Recall into the live match.** Call `enableItems(state)` at match start, `stepItems(state)` once per tick,
   and add a `'recall'` case to `act()`. The camps' pickups then start to drop. This is the "wire, don't add" item
   from NORTHSTAR.
   - Owner: fable (`env/sim.mjs` wiring). Sonnet (the `'recall'` case in `play/input.mjs`, and the button in
     `play/items-ui.mjs`).
   - Done when: a test runs a ranked grunt's death to a Shed Skin at the Nest, then a Recall costs half the price and
     the unit reappears after its train time with rank and items; on the live page a Recall button (key x) shows
     when the Core is selected.

5. **Shedder heal aura, always on.** The Shedder heals own units within 4 tiles by 2 hp/s. It is the Snakenators'
   only healer, and it works without an autocast toggle.
   - Owner: fable (`env/combat.mjs`, Shedder row from change 1).
   - Done when: a test shows a 60 hp Fang next to a Shedder gains 2 hp/s up to full and no more; the mirror win band
     holds; on the live page a green pulse shows around the healed unit.

**Left out on purpose:** Burrow-only abilities (Tunnels button, Thumper splash, Rumble stun, Undermine). Joshua has
parked the Burrow (TERRITORY.md section 13), so putting them first would not change what a live player sees.

## What Joshua can see or do after this audit
Nothing new on the page. This was an audit, and I edited only this file. The blocker for abilities is item 1 (no
caster rows) and item 4 (items never switched on), which belong to fable.
