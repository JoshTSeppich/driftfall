# Audit 09: The damage model (sonnet)
Read: STARCRAFT-ATOMS.md section 9, env/combat.mjs (98 lines, whole), env/stats.mjs units/upgrades/neutrals, TERRITORY.md section 6.

What the live sim does today: every tick, each armed unit in range hits for its flat `damage` (x`structureMultiplier` vs buildings). All hits sum per target and apply at once. No cooldown, no armour, no size/type, no splash, no shields. Cooldown, rank and armour numbers exist only as data in STATS (neutrals `attackEvery`, upgrades Weapons/Hide, Thick Hide, Rumble) and are not read by combat.mjs.

| Atom line | Verdict | Evidence / why |
|---|---|---|
| Damage = weapon + upgrades - armour, minimum floor | MISSING | combat.mjs:72 uses base damage only. Weapons/Hide tracks (stats.mjs:25-50) are bought data that does nothing. No armour field on any unit. |
| Armour hurts many-hit units most | MISSING | Needs armour first. Today every hit is big and every tick: a Worker (2 dmg) and a Brute (25) both land every tick, so there is no "many small hits" class to punish. |
| Damage types (full vs small, little vs large) | MISSING | Only one modifier exists: structureMultiplier (Brute x2). Units have no size class. |
| Bonus damage vs a tag | PARTIAL | structureMultiplier is a bonus-vs-"structure" tag. No bonus vs unit roles, so no counters (Council item 7, "visible counters"). |
| Overkill is a real waste | PARTIAL | It happens by accident: damage is summed then applied, so extra hits on a dying target are wasted. But with no cooldown the waste is invisible and nothing rewards avoiding it. |
| Focus fire beats spread fire | PARTIAL | An attack order focuses one target (combat.mjs:46). Idle units hit the nearest. Since hits are instant and stack, focus is the only thing that matters, but the player has no good "focus this" feedback and units never retarget a better threat. |
| Splash punishes clumping | MISSING | No splash in the sim. Howler/Thumper (stats.mjs:85, 205) is named but has no area attack. Territory also lists Spiker/Mender. |
| Friendly splash | NOT FOR US (now) | Adds feel-bad before basic splash exists. Revisit for Drift hazards (Flood already hurts everyone, stats.mjs:178) and one Thumper variant at most. |
| Shields absorb first, ignore modifiers | NOT FOR US | Only one faction's identity in the atom. Driftfall's equivalent already has a home: Burrow dirt walls and Hold Fast claim weapons. Skip a second hit-point layer. |
| No randomness (SC2) / high-ground miss (BW) | HAVE (no randomness) / NOT FOR US (miss chance) | Combat is fully deterministic (also needed by the replay tests). High-ground miss: no height in combat; Driftfall's Mesa Reaches are better served by sight bonus, not dice. |
| Attack cadence (implied by "damage per hit") | MISSING | The atom assumes discrete hits. Driftfall has one every tick. This is the root cause behind haiku's finding (#415): 4 units drop a 1000-hp Core in ~35 ticks. |

Tally: 1 HAVE, 3 PARTIAL, 6 MISSING, 2 NOT FOR US (rows mixed on the last one).

## Top 5 changes, ranked by how much they improve play

1. **Attack cooldown (a hit every N ticks, per unit).**
   Add `attackEvery` to each unit row (Fang 8, Spitter 12, Bulldozer 16 as a starting point; the neutrals table already uses 12/16/24 and `unitAttackEvery: 8`) and store `cooldown` on the unit. Scale each hit so damage-per-second stays roughly what balance expects, so existing balance tables only need a re-check, not a rewrite. Everything else below is meaningless without discrete hits.
   Owner: fable (env/combat.mjs, env/stats.mjs, sim determinism). Done when: a test shows a lone Fang hits once per `attackEvery` ticks; 4 units need more than 3 s (over 100 ticks) to kill a 1000-hp Core; hit events in the replay are spaced; sim-determinism and 8-seed mirror runs stay green.

2. **Armour from the Hide tracks and a 1-damage floor.**
   Add `armor` to unit rows (Fang 0, Spitter 0, Bulldozer 2). Hit = max(1, damage + weaponsLevel - armor - hideLevel); apply bonus after armour. This makes the Weapons/Hide upgrades (already sold in TERRITORY section 6) do something and makes Thick Hide's "+2 armor" real. Keep the floor at 1 (the atom's 0.5 needs fractions we don't carry).
   Owner: fable (combat.mjs reads upgrades from state), sonnet for the HUD number (play/ command card shows armour and damage). Done when: a Bulldozer takes 3 less per Fang hit than a Spitter does; buying Weapons 1 raises damage by exactly 1 in a test; a unit with 0 effective damage still takes 1.

3. **Role counters: a visible bonus-vs-tag table.**
   Give each unit a size/tag (Light: Worker, Fang, Spitter, Adder; Heavy: Bulldozer; Structure). Spitter/Adder deal x1.5 vs Light, x0.75 vs Heavy; Bulldozer keeps x2 vs Structure and x0.75 vs Light; Fang is the cheap generalist. One table in STATS, drawn from one place, shown on the button tooltip as "Strong against: ...". This delivers Council item 7 (visible counters, unit identity) with a few numbers instead of a new system.
   Owner: fable table + combat.mjs; sonnet for tooltip/HUD text; haiku for the 8-seed balance check (mirror 45-55%). Done when: the tooltip lists the counter, a test proves each pair, and a Spitter-heavy army loses to Bulldozers by a measured margin.

4. **Thumper splash (the only area weapon, 1.5-tile radius, no friendly fire).**
   Give Howler/Thumper `splash: 1.5` with 50% damage to non-primary targets, using the same simultaneous damage sum already in combat.mjs (cheap: loop neighbours before the sum). Pair with an animation ring in the renderer so clumping reads as dangerous. Leave Rumble's stun as a later add-on.
   Owner: fable (combat.mjs), fable art/render hook (play/render.mjs ring). Done when: 5 Fangs standing on one tile take splash from a single Thumper hit, a spread formation takes less, no own-unit damage, and a replay shows the ring.

5. **Smart retarget and focus feedback.**
   Idle units pick the nearest enemy; let them prefer the enemy that is attacking them, then lowest-hp in range, and clear the stale order the moment the target dies (already done at combat.mjs:92). On the page show a thin line from each selected attacker to its target and a damage number per hit. This makes focus fire legible and teaches overkill by sight.
   Owner: fable for the target rule, sonnet for the target line and damage numbers in play/. Done when: a test shows three Fangs split across two equal targets by lowest-hp, and a recorded playthrough shows the lines and numbers.

Notes for other audits: 1 and 2 feed haiku's top item (#422/#415); #5 depends on cooldown (#1) or every unit just kills the nearest enemy the same tick. Edited only this file.
