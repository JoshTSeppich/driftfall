# The Coil Engine: real movement, built for Driftfall (Joshua, 19:51)

> **DIRECTION CHANGE (Joshua, 20:05): the units are now little TOASTER ROBOTS (the Toastinators, TERRITORY.md
> section 16), because snakes were too hard. This section SUPERSEDES the snake parts below and any snake details in
> your task prompt.** Build the same engine for rigid, boxy bodies:
> - **Body rig instead of a spine:** a rigid toaster body on a damped spring "suspension" (squash on landing, stretch
>   on take-off, lean into turns and acceleration), with child parts on springs: the lever, the slots' toast, the cord.
> - **Locomotion = hops and waddles, as physics:** small parabolic hops for Crumbs and Poppers (hop height and rhythm
>   from speed), heavy stomping hops for the Four-Slice, rolling for the Bagel, flying bob for air units. Feet/base
>   plant on the ground: no sliding (stride matches speed).
> - **Actions:** attack = toast pops up with a spring snap (Popper bonks, Zapper's coils glow then fire), gather =
>   crystal slices slide into the slots and the body heats up, deliver = slices pop out, hit = impulse + wobble,
>   death = sparks, then the body shatters into flat facets; Broiler siege = door swings open on a hinge spring.
> - Everything else below stands: interpolation 24 tps to 60 fps, GPU instancing, 200 units at 60 fps, animation
>   graph. Folder and names stay (engine/coil/).


> "Find a really cool custom-built engine for rendering the animations instead of just flat images moving.
> Develop a real-looking movement."

## Decision
Keep Three.js as the renderer (it's fast, already in the game, WebGL2/WebGPU-ready) and build **our own procedural
animation engine on top of it**, the way the best creature games do it: bodies are simulated, not keyframed. Snakes
are the perfect case: a real snake *is* a chain that follows its head. Faceted, geometric meshes are skinned to the
simulated skeleton, so it stays in the early-2000s geometric style but moves like something alive.

## The engine, in layers (env/ stays the authority; this is presentation only)
1. **Spine simulation.** Each creature is a chain of 8–16 joints. The head follows the sim's path; every joint
   follows the one ahead at a fixed distance (follow-the-leader with distance constraints, solved like verlet
   rope), so the body traces the real path through bends instead of sliding as a stiff object.
2. **Locomotion gaits as forces, not frames.** Serpentine (lateral S-waves pushing off ground), sidewinding (for
   sand and Sidewind), concertina (bunching in tight spaces), straight-line (slow, heavy Constrictor). The gait is
   picked from speed, terrain and unit type, and blends smoothly.
3. **Inverse kinematics for contact.** The head aims at targets (strikes, drills, crystals); the spine reaches with a
   two-stage IK (aim the head, let the neck chain follow); the tail anchors. Later: legs with foot planting for
   neutral creatures and the Burrow.
4. **Secondary motion with springs.** Damped springs on everything that should wobble: the crystal tank sloshing
   (with a liquid level that tilts), helmets, hoses, monocles, antennae. Real weight, tiny cost.
5. **Physical events.** Hits push the body (impulse along the spine), deaths go ragdoll for a beat, then shatter into
   facets with real velocities; recoil, knockback and Quake shakes are forces on the chain.
6. **Interpolation.** The sim runs 24 ticks/s; the engine renders at 60+ fps by interpolating sim positions and
   letting the spine simulation run continuously between ticks. Movement never looks steppy.
7. **Skinning on the GPU, at scale.** Faceted tube meshes skinned to the spine with joint transforms packed in a data
   texture; one instanced draw per unit kind. Target: 200 creatures with full spines at 60 fps on the MacBook Air.
   Fallback LODs: far units use 4 joints.
8. **Animation graph.** A small state machine per unit (idle-coil, move, gather, carry, strike, hit, die, spawn,
   rank-up) blending procedural layers; data-driven so a new unit is mostly a few numbers.

## Done means (on Joshua's screen)
- In the Style Lab and then the game, a Siphoner slithers in real S-curves that follow the exact path, strikes with
  a coiled snap, its tank sloshes, it flinches when hit and collapses then shatters when killed.
- 200 animated creatures at 60 fps. Nothing slides, pops or skates.
