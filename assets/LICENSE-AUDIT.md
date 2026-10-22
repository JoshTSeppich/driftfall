# Asset license audit

Audited: 2026-10-22, by team haiku (Certification / Compliance Tester).
Scope: every file under `assets/` (748 files). Only `assets/LICENSE-AUDIT.md` was edited.

## Verdict

**Not clear to ship yet.** The media that is recorded is clean: correct formats, recorded CC0 licenses, no franchise
content found. Two blocking items remain:

1. **390 unrecorded `.ogg` files** sit in `assets/audio/_scratch/` (plus one `desktop.ini`). None are in any license
   table. The sound scout said these could not be removed because of read-only files; they need deleting, not
   recording.
2. **The OpenGameArt track `oga-ambient/MyVeryOwnDeadShip.ogg` has its CC0 status unverified.** It is the only
   non-Kenney work in the tree. Our online checks were blocked, so only the repo's claim is on record. If the page
   says anything other than CC0, it needs its attribution line.

## Summary

| Check | Result |
|-------|--------|
| Files in `assets/` | 748: 738 media, 10 non-media |
| Media files match their format (PNG signature, OGG `OggS`, glTF binary `glTF`, TTF header) | Pass: 217 PNG, 403 OGG, 116 GLB, 2 TTF, none mismatched |
| Every media folder has a source URL, author and license recorded | Pass for every kept pack (see table below). Fail for `_scratch/` (blocking) |
| GLB files pull in anything from outside themselves | Pass: only `td/*.glb` reference `Textures/colormap.png`, which is shipped in `td/Textures/` |
| Manifest paths exist on disk | Pass: all 13 audio entries; all real file paths in models and sprites manifests |
| Franchise content (names and bytes of all 748 files, including GLB JSON) | Pass: no franchise content found (see below) |
| Non-media files | Fail: 10 files (see below) |
| Online source pages checked | Not done: network and tool permission blocked. Licenses below are as recorded in the repo |

## Recorded licenses (pack level)

| Folder | Source | Author | License recorded | Source verified online? |
|--------|--------|--------|------------------|-------------------------|
| `sprites/kenney-scifi-rts/`, `sprites/game/` (units, structures, tiles, environment) | kenney.nl/assets/sci-fi-rts | Kenney Vleugels | CC0 (license text kept in `License.txt`) | No |
| `sprites/kenney-particles/`, `sprites/game/` (projectile, muzzle, explosion, smoke) | kenney.nl/assets/particle-pack | Kenney Vleugels | CC0 (license text kept) | No |
| `ui/kenney-ui-space/` | kenney.nl/assets/ui-pack-sci-fi | Kenney | CC0 (license text kept) | No |
| `models/space/` (66 GLB) | kenney.nl/assets/space-kit | Kenney Vleugels | CC0 (license text not kept) | No |
| `models/td/` (50 GLB + texture) | kenney.nl/assets/tower-defense-kit | Kenney Vleugels | CC0 (license text not kept) | No |
| `audio/kenney-sci-fi/`, `kenney-impact/`, `kenney-ui/`, `kenney-jingles/` (12 OGG) | kenney.nl sound packs | Kenney | CC0 (license text not kept) | No |
| `audio/oga-ambient/MyVeryOwnDeadShip.ogg` | opengameart.org/content/background-space-track | yd | CC0 as claimed in `audio/LICENSES.md` | **No, blocking** |

Byte checks passed: every `sprites/game/` copy is byte-identical to a file in its source pack.

## Franchise check

Searched every file name and every byte of every file (including GLB JSON chunks) for about 70 franchise and unit
terms (StarCraft, Blizzard, Zerg, Terran, Protoss, marine, vulture, goliath, wraith, ghost, medic, Thor, mutalisk,
hydralisk, SCV, probe and similar). Hits, all explained:

- `assets/LICENSES.md` and `assets/models/LICENSES.md`: "thor" inside the word "Author". False positive.
- `assets/audio/LICENSES.md`: "StarCraft" in the sentence "Nothing here comes from StarCraft". A disclaimer, not content.
- `assets/audio/_scratch/.../thrusterFire_00x.ogg`: "scV" / "SCv" in the binary audio data. False positive.

No franchise names in any kept file name, manifest, or GLB. A keyword scan can't prove that a model or sprite is
not a copy of someone else's art, so visual originality is not covered by this audit.

## Blocking findings

### B1. Unrecorded audio in `assets/audio/_scratch/` (owner: Sound Designer / sound scout)

- 390 `.ogg` files under `_scratch/kenney-impact/`, `_scratch/kenney-jingles/`, `_scratch/kenney-scifi/`,
  `_scratch/kenney-ui/` and `_scratch/oga-space/`. Their packs are Kenney packs, but none are in `audio/LICENSES.md`,
  and none are used by `audio/MANIFEST.json`.
- Also `_scratch/kenney-scifi/x/Audio/desktop.ini`: a Windows folder file, non-media.
- Also an empty folder `_scratch/oga-searching/`.
- **Action:** delete `_scratch/` once the read-only files are cleared. Do not record it. If any file is wanted, move
  it into the table with its source and license first.

### B2. OpenGameArt track not verified (owner: Licensing / Rights Manager)

- `audio/oga-ambient/MyVeryOwnDeadShip.ogg`, 4.36 MB, by yd, recorded as CC0.
- Needs a human to open the OpenGameArt page and confirm the license. If it is CC-BY or anything else, add the
  attribution line that the license requires.
- The page is also the only source of a loop claim: the scout said its loop point is unchecked.

## Non-media files (10)

| File | Note | Recommendation |
|------|------|----------------|
| `assets/LICENSES.md`, `assets/audio/LICENSES.md`, `assets/models/LICENSES.md` | License records | Keep. They are the compliance record the spec requires. Technical Director to confirm the exception. |
| `assets/audio/MANIFEST.json`, `assets/models/MANIFEST.json`, `assets/sprites/MANIFEST.json` | File maps the viewers load | Keep. Spec and chat rely on them. Technical Director to confirm the exception. |
| `assets/sprites/kenney-particles/License.txt`, `assets/sprites/kenney-scifi-rts/License.txt`, `assets/ui/kenney-ui-space/License.txt` | Pack license texts | Keep. They are the license texts the pack requires us to carry. |
| `assets/audio/_scratch/kenney-scifi/x/Audio/desktop.ini` | Windows junk | Delete (part of B1). |

## Accuracy notes (non-blocking)

- **A1.** The sound scout's chat message said "13 CC0 Ogg files from Kenney's packs plus one OpenGameArt track". The
  table is right: 12 Kenney files plus 1 OpenGameArt track = 13 files in total. Only the chat message is off.
- **A2.** `models/LICENSES.md` says "kit's License.txt says the same" for the Space Kit, but no kit license text is
  kept. The claim stands on the table only. Save the text next to the models if we want it on record.
- **A3.** Audio pack license texts are not kept (disclosed in `audio/LICENSES.md`). Same fix as A2.
- **A4.** The models manifest has notes such as "dish pointed at sky; or td/weapon-turret.glb" and a range written
  "construction stages a..f". These are prose, not missing files. All referenced real files exist.

## What passed (for the record)

- All 116 GLB files are real glTF binary, with no external buffers except the `colormap.png` texture.
- All 217 PNG files are real PNG; all 403 OGG files are real Ogg; both TTF fonts have valid headers.
- No archives (zip, tar, rar), no scripts (js, py, sh), no symlinks, no executables.
- Every kept pack folder has an entry in one of the three LICENSES files.

## Re-check

Re-run this audit after B1 and B2 are fixed. Each finding above lists its check so the same commands can be run again.
