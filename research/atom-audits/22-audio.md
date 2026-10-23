# Atom audit 22: Audio

Scope: research/STARCRAFT-ATOMS.md section 22 only, checked against NORTHSTAR.md (Done means 1, 3, 4; order 3b, FANATICS 5/6/7)
and TERRITORY.md sections 4 (Drift warnings are announced with a sound) and 13 (borrow "clear audio barks").
Files read: play/sound-player.mjs, play/feel.mjs, play/app.mjs (audio wiring), play/input.mjs (alerts, refusals),
play/teach.mjs (alert list), viewer3d/audio.mjs (chooseSounds, ambient), assets/audio/MANIFEST.json, env/sim-territory.mjs
(drift-announce event), and live/decisions.md #144 (faction rule). Nothing was run; verdicts come from reading.
Verdict key: HAVE / PARTIAL / MISSING / NOT FOR US.

## Verdict table

| # | Atom (section 22, as written) | Verdict | Evidence in Driftfall | Gap |
|---|---|---|---|---|
| 22a | Unit acknowledgement voice lines (selection, move, attack) | PARTIAL | Selecting a new group plays `unit_select` (play/feel.mjs:88). Any order plays `unit_move_ack` (play/feel.mjs:87). Both are blips from one kenney file each. | No voice or per-unit identity: a Grunt and a Brute sound the same. An attack order gets the same move blip, so the player cannot hear that the order was an attack. |
| 22b | Annoyed voice lines when clicked repeatedly (easter egg) | MISSING | Nothing counts repeat clicks or orders on one unit. The only click-driven sounds are the select and move blips. | Entirely absent. A cheap, funny, on-brief addition (NORTHSTAR Done 3: "laughs at the art"). |
| 22c | Alerts: "Your base is under attack", "Not enough minerals", "You must construct additional pylons" | PARTIAL | Text alert for any own entity hit: "Under attack" (play/input.mjs:373), with a jump key (Space, play/teach.mjs createAlerts). Sound `alert_under_attack` plays only when the Core is hit (viewer3d/audio.mjs chooseSounds, the `target.kind === "core"` line). Refusals are toasts: "Not enough Shards", "Queue is full", "Unit cap reached" (play/input.mjs, train section). Drift warnings play `drift_warning` (play/feel.mjs:26). | (1) A Forge or Shard being hit makes no sound. (2) Refusals are silent: no sound for "Not enough Shards". (3) `alert_under_attack` and `drift_warning` both point at the same file, `kenney-ui/error_006.ogg` (assets/audio/MANIFEST.json), so the two most important warnings in the game sound identical. (4) The pylon line has no equivalent: the design has no supply cap (NORTHSTAR Done 2, upkeep). Upkeep debt is the thing to warn about instead. |
| 22d | Distinct sounds per unit and per weapon; you can hear a fight without seeing it | PARTIAL | Weapon classes differ: `ranged_shot` for range 2+, `melee_hit` for melee, `heavy_impact` for structures, `explosion_death` for Brute, Core and structures (viewer3d/audio.mjs chooseSounds). Enemy sounds play only within 12 tiles of the camera (play/feel.mjs:10, AUDIBLE_RANGE). | Sound is per weapon class, not per unit: the live roster is four kinds (see audit 19), and each sound has one sample. The 12-tile range means you cannot hear a fight at the other end of the map, which is the atom's point. Also: the stand-in sounds for failed files are procedural and generic. |
| 22e | Race-specific music | NOT FOR US | Driftfall has one faction, the same hulls on both sides, and only paint and personality differ (live/decisions.md #144, the faction rule). A race-specific score would have nothing to vary by. | Our equivalent is state-based music, which is MISSING: `ambient_loop` is in MANIFEST.json and viewer3d starts it (viewer3d/audio.mjs startAmbient), but nothing in play/ starts it, so the live page has no music at all. |

Extra items seen while reading (not in the section, kept for the owners):
- Victory and defeat stingers play (play/app.mjs:235, `stingerFor`). HAVE.
- Mute is one stored setting shared with the 3D viewer (play/sound-player.mjs). HAVE, but no visible mute button was found in play/index.html.
- Sounds are capped per tick (`limitSounds`, 2 per name, 8 total). HAVE, and it keeps busy fights from turning into noise.

## Top 5 changes, ranked by how much they improve play

1. **Warnings that sound different and fire where they matter.** Give `alert_under_attack` and `drift_warning` separate
   files (audition from the CC0 packs; keep LICENSES.md next to them). Fire `alert_under_attack` when any of our
   structures or units is hit, not only the Core, with a 6-second cooldown per base so it does not spam.
   - Owner: haiku (play/feel.mjs, viewer3d/audio.mjs chooseSounds, assets/audio/MANIFEST.json). Sonnet only if the
     text alert in play/input.mjs needs the same rule.
   - Done when: a test feeds a hit on our Forge and expects one `alert_under_attack` cue; a test checks no two warning
     events in MANIFEST.json share a file; Joshua can tell the Drift warning from a base alarm with his eyes shut.

2. **Refusals you can hear.** Play a short denial sound when a train or build is refused ("Not enough Shards", "Queue
   is full", "Unit cap reached"). The toast stays; the sound is the new part. Pair it with the deny jolt from ANIMATION.md
   (UI Motion, item 1).
   - Owner: haiku adds the `deny` cue in play/feel.mjs; sonnet sends the refusal reason to feel in play/input.mjs
     (the toast path already knows the reason).
   - Done when: a test refuses a train with no Shards and expects a `deny` cue; Joshua hears a no-click on a refused order.

3. **Per-kind selection and order voice.** Give each live kind (Worker, Grunt, Lancer, Brute) its own select and move
   blip pitch, plus a separate attack acknowledgement for attack orders, so the player learns unit identity by ear.
   - Owner: haiku (play/feel.mjs cue names per kind, sound-player); sonnet passes the kind of the selected unit and
     the order type from play/input.mjs.
   - Done when: a test selects a Grunt and a Brute and gets different cue names; an attack order gets `unit_attack_ack`,
     not `unit_move_ack`.

4. **Music that starts on the first click.** Start `ambient_loop` after the first unlock, at a low volume, looping,
   and stop it on mute (the mute key already exists). This gives the live page its missing bed and costs one file.
   - Owner: haiku adds loop support to play/sound-player.mjs; sonnet calls it from play/app.mjs next to `sounds.unlock`.
   - Done when: a test shows the bed starts once after unlock and stops on mute; Joshua hears a low loop after the first click.

5. **The annoyed grumble.** If the same unit is ordered four times within two seconds, play a short grumble cue (one new
   CC0 sample) and nothing else. It is the easter egg the atom names, and it is cheap.
   - Owner: sonnet counts repeat orders in play/input.mjs; haiku adds the `unit_grumble` cue in play/feel.mjs.
   - Done when: a test sends four move orders to one unit inside two seconds and gets one `unit_grumble` cue; Joshua
     clicks a unit four times and laughs.

## Notes for the team
- Nothing in this audit was run in a browser. The verdicts come from reading the code; checking each sound by ear is
  Joshua's call, as the MANIFEST note says ("Nobody has listened to these yet").
- Changes 1 and 2 touch the Drift warnings that FANATICS item 6 ranks, so they belong in the early wave.
