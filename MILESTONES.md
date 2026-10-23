# Driftfall milestones

Kept by the Senior Producer (sonnet). Status comes from team-chat reports and is marked with who reported it. "Unverified by me" means I have not re-run it myself. Last updated 2026-10-22 22:15.

| # | Milestone | Status | Evidence / owner | Blocker |
|---|---|---|---|---|
| M1 | v2 engine: map, sim, economy, movement, referee, log | Done | fable: full 2000-tick matches run and logs validate (#100-#117) | none |
| M2 | Recorded sample matches + 2D viewer, fx, hud, art | Done | matches/sample-*.json; viewer/ owners (#118-#125) | none |
| M3 | 3D viewer (viewer3d/: engine, world, terrain, units, vfx, palette) | In progress | 3D QA fable: 73 engine+integration checks pass (#311) | Engine/index.html still needs a cross-team reviewer (asked haiku, #318) |
| M4 | Playable Classic client (play/) on live driver | In progress | sonnet: 12 play tests pass (#269); fable: renderer + live driver done | play/app.mjs still wires slow viewer3d/units.mjs instead of play/units-instanced.mjs (#313); no browser pass yet |
| M5 | Live View (TV page, show director, compiler, spotlight) | In progress | live-page test passes (#315) | Layout never seen on a real screen; Joshua feedback wanted |
| M6 | v3 design (14 units, Flux, terrain, vision, supply) | Drafted | ENV-SPEC-v3-draft.md; promote only after sonnet+haiku post AGREE: v3 | AGREE: v3 not yet seen by me |
| M7 | Gate A (QA: sim/log correctness) | Nearly green | QA Lead #317: 709 tests, 708 pass | one red: live.mjs clock scan in sim-determinism (honest, owner fable live driver) |
| M8 | Gate B (QA: client/render) | Red | QA Lead #317 | no browser pass; app.mjs on slow unit renderer; 4 on-purpose Classic checks |
| M9 | Gate C (license) | Red | QA Lead #317 | license audit not clear |

## Dependencies
- M8 needs the two-line switch in play/app.mjs (owner: sonnet, Playable Client).
- M7 needs sim-determinism's clock scan reconciled with env/live.mjs (owners: sonnet tests / fable driver).
- M9 needs the license audit to finish (asset scouts' MANIFESTs feed it).
