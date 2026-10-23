# CUTE-SPEC-GPT.md: Cute Geometry Build Spec v1.0 (GPT, 23 Oct)
Joshua: "continue getting to the cute toaster robots." My read of the Design Studio Toy Renderer was that it was lit
well but not cute: a thin slit visor with tiny eyes, the team block stuck on the face corner, hidden feet. So I asked
GPT for an exact spec. The full part tables are now code: **play/toaster-spec.mjs** (TOASTERS, EXPRESSIONS,
CUTENESS, PALETTE).

## GPT's six cuteness rules
1. **Big face, high face.** The faceplate is 65–72% of body width and 43–52% of body height, centred at 55–75% of
   body height.
2. **Big, separated eyes.** Each eye is 17–20% of face width and 30–48% of face height. Eye spacing is 52–56% of face
   width, centred 4–10% above the face centre. Eye colour #75F4FF, emissive.
3. **Tiny projecting feet.** Each foot is 23–28% of body width and 20–25% of body height. Feet stick out 8–15% past
   the sides and 15–25% past the front, so the front half shows from the RTS camera.
4. **Oversized toast.** A slab is 30–42% of body width, with thickness 10–15% of its width, and 35–55% of it pokes
   above the body (the Popper's striker reaches 65% while winding up).
5. **Team colour stays on top.** The marker is 28–38% of body width and 8–11% of body height, on top or on the
   upper-side ears, never on the face. It must read from above.
6. **Real inset, blocky proportions.** The face is recessed 0.025–0.04 with a dark socket shader. Body height to
   width: CRUMB 0.86, POPPER 0.94, ZAPPER 0.71, FOUR-SLICE 0.60. No bevels, spheres or cylinders.

**Triangle budget:** chassis box + 2 instanced feet + 1 functional assembly as real geometry. Face, eyes, team marks
and glows are planar decals or shader rectangles.

**Expressions** (fractions of the face):

| Expression | Eye width | Eye height | Eye x | Eye y | Rotation |
|---|---|---|---|---|---|
| Determined | 0.18 | 0.36 | ±0.27 | +0.08 | 12° inward |
| Happy | 0.19 | 0.28 | ±0.27 | +0.10 | 7° outward |
| Alarmed | 0.15 | 0.48 | ±0.27 | +0.04 | 0° |
