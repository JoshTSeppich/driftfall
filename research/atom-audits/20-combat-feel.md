# Atom audit 20: Combat feel

Audited by haiku against `research/STARCRAFT-ATOMS.md` section 20 (7 lines). Scope: that section, NORTHSTAR.md, and the
env/ and play/ files that implement combat. Nothing was edited except this file.

Verdicts: **HAVE** (Driftfall already does an equivalent), **PARTIAL**, **MISSING**, **NOT FOR US** (with reason).

## Evidence used

- `env/combat.mjs`: `stepCombat` runs every tick. Every attacker that is in range hits every tick. The only cadence
  check is for neutrals (`attackEvery` in `env/neutrals.mjs:177`). Player units have no cadence field. Hits are
  summed per target and applied at once. Combat imports only `stats.mjs` and `state.mjs`: it never reads map heights.
- `env/stats.mjs`: grunt 60 hp / 8 dmg / range 1; lancer 40 hp / 10 dmg / range 4; brute 240 hp / 25 dmg; turret
  range 5; Core 1000 hp. Three Burrow abilities (Venom, Constrict, Rumble) are data rows only.
- `env/effects.mjs`: Flood pushes units out of a Reach and does 1+ damage. It never kills.
- `play/feel.mjs`: hit and death cues, a 160 ms hit ring, and a camera shake within 10 tiles. Ranged shots play their own
  sound (`viewer3d/audio.mjs:65`: attacker range 2 or more).
- `play/units-instanced.mjs`: one shared death (tip over and sink, 0.5 s) for all ground units. Air units rise and fall.
  A unit flashes when hit (line 433).
- `play/app.mjs:334`: dying buildings are filtered out of the frame at once, so they have no collapse. Hit rings are
  drawn at line 557.
- No code anywhere in env/ or play/ draws a projectile or a wreck. Units with a move order cannot attack
  (`canAttack` in `combat.mjs`), so a Move command is a real retreat.

## Verdict table

| # | Line from section 20 | Verdict | Driftfall now | Why |
|---|---|---|---|---|
| 1 | Fights are short and decisive; one bad engagement can lose the game | **PARTIAL** | Fights are decisive but too fast to read. A grunt kills a grunt in 8 ticks (about 0.33 s). A lancer kills a worker in 4 ticks. | Attacks land every tick (`combat.mjs` step 2) because player units have no cadence. Neutrals already use `attackEvery`, so the field pattern exists. |
| 2 | Engagement positioning: concave, flanks, chokes | **PARTIAL** | Chokes exist as terrain: ramps (`=`, `\|`) and gates in `env/map.mjs`. Flanks exist as a Reach role. | Nothing rewards a position. Combat ignores map heights, so there is no high-ground bonus and no concave or flank logic. Auto-fight only hits what is already in range; nothing moves a unit to a better spot. |
| 3 | Retreating to save units is a skill | **PARTIAL** | A Move command works as a retreat (a moving unit stops firing). | There is no one-key fall-back and no retreat threshold. With a 0.33 s kill time, a player cannot pull back in time to matter. |
| 4 | Spells can turn a fight instantly (storms, fungals, EMPs) | **MISSING** | No unit spell runs in a live fight. Venom, Constrict and Rumble are data rows only. Drift Flood is the nearest thing, but it is deliberately non-lethal. | Matches fable's audit 11: no status layer in combat. Flood's design (never kills) is right for our brand, so the gap is the unit-level spell. |
| 5 | Big visual and sound feedback on spells and deaths | **PARTIAL** | Deaths: a big white ring, a full camera shake, and `explosion_death` for brutes, Cores and buildings. Spells: no feedback, since none fire. | Deaths are covered. Spell feedback waits on line 4. |
| 6a | Units die with distinctive animations | **PARTIAL** | One shared death for every ground unit (tip, sink, 0.5 s). Air units differ. | Kinds are told apart by sound only. Each kind has the same fall. |
| 6b | ...and corpses or wreckage | **MISSING** | Nothing is left behind. Buildings disappear at once (`app.mjs:334`). The shed skin from a dead ranked unit is data only and is not drawn. | ANIMATION.md already plans a shatter for buildings (900 ms). This audit agrees with that plan. |
| 7a | Clear hit effects | **HAVE** | A 160 ms hit ring, a unit hit flash, a camera shake, and hit sounds that differ for melee and ranged. | `play/feel.mjs`, `app.mjs:557`, `units-instanced.mjs:433`. |
| 7b | Clear projectiles | **PARTIAL** | No projectile is drawn. A lancer or turret shot hits instantly, and the ring appears on the target with a sound but no visible shot. | Instant hits are deterministic and simple, so keep them (see NOT FOR US). The missing piece is a visible shot line. |

NOT FOR US: **travelling projectiles in the simulation.** Instant hits keep the 24-tick sim deterministic and cheap at 200
units. The visible shot can be a tracer drawn on the client (top 5, item 4) with no change to the sim.

## Top 5 changes, ranked by how much they improve how Driftfall plays

1. **Give player units an attack cadence** (lines 1 and 3). Add a per-kind `attackEvery` (in ticks) to the unit rows
   in `env/stats.mjs`, and have `env/combat.mjs` honour it the way neutrals already do. Aim for a grunt-vs-grunt fight
   of at least 2 s, and about 1 s between blows.
   - Owner: **fable** (`env/combat.mjs`, `env/stats.mjs`). Sonnet adds an optional cooldown ring in the HUD.
   - Done when: a test pins that one attacker hits at most once per `attackEvery` ticks, and a grunt 1v1 lasts 48+ ticks.
     On the page, Joshua can watch a single fight and see the blows land one at a time.

2. **Add a one-key Fall Back order** (line 3). Selected units move to the nearest owned structure. Treat it as a Move
   order so they stop firing, and keep the hotkey off the existing ones (R is Rally).
   - Owner: **sonnet** (`play/input.mjs`, `play/command-card.mjs`), with **fable** for the command in `env/commands.mjs`.
   - Done when: a test pins that a fall-back order sends the group to the nearest structure with no attack order left. On
     the page, Joshua selects five grunts in a losing fight, presses the key, and they walk out and survive.

3. **Reward high ground** (line 2). In `env/combat.mjs`, a unit on a higher map tile than its target deals +25% damage.
   Pass heights into combat (the map already has them in `env/map.mjs`). Sonnet shows the bonus as a tint on high tiles.
   - Owner: **fable** (rule and number), **sonnet** (the tint). Haiku checks the balance against the 45-55% mirror target.
   - Done when: a test pins the +25% and checks the bonus is zero on flat ground. On the default map, each side's
     approach has at least one high tile, and the HUD shows the bonus when a unit stands on one.

4. **Draw a shot line for ranged hits** (line 7b). When a `hit` event comes from an attacker with range 2 or more, draw
   a thin tracer from the attacker to the target for 90 ms. It is a pure function of the event and positions, so no
   sim change is needed.
   - Owner: **sonnet** (`play/feel.mjs` cue, `play/app.mjs` overlay). **Haiku** writes the test in `play/feel.test.mjs`.
   - Done when: a test pins that a lancer hit yields one tracer lasting 90 ms and a melee hit yields none. On the page,
     Joshua sees lancer and turret shots leave the shooter.

5. **Make unit spells visible in a fight** (line 4). Once fable's status layer (audit 11, item 2) lands, Venom and
   Constrict should slow or hold their target. Sonnet adds a short status ring on the unit (green for slowed, amber for
   held) that lasts the effect's length.
   - Owner: **fable** (the status layer and the Adder and Charmer rows), **sonnet** (the status ring in
     `play/units-instanced.mjs`).
   - Done when: a test pins that a Venom hit slows its target for 3 s, and on the page a slowed unit shows the ring.
     Blocked until fable's unit rows exist.

## Notes for the Producer

- Items 1 and 3 change balance, so they need a fresh mirror-win check (NORTHSTAR done-means item 5).
- Item 5 is blocked on fable's audit 11, items 1 and 2. Nothing in it is visible to Joshua today.
- Before this audit: nothing new is visible or playable from this work. It is a document only.
