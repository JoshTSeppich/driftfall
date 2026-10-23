# NORTH STAR: Driftfall v0.1, live and fun (Joshua, 19:21)

**Goal: a stranger opens one link, plays a full Toastinators-vs-Toastinators match against the built-in AI, understands
everything without help, laughs at the art, and wants a rematch.** Every task you take must move that closer. If it
doesn't, don't do it; say so in the chat.

## Done means all of this is true on Joshua's screen (not just in tests)
1. **It plays.** One page, one click to start. Edge-scroll, box-select, right-click smart commands, hotkey grid,
   control groups, minimap. The camera opens on your base. You can't lose before 3:00 to the default AI.
2. **It's Driftfall.** Bigger maps (128/192/256, Large 192 default for watch mode), neutral camps that guard every
   Reach and drop items, ranked recurring troops with Recall and 2 item slots (TERRITORY.md section 14). The 128×128 map with 21 Reaches; claiming and holding them gates tier 2 and tier 3; the Drift
   (Bloom, Dry-out, Flood, Quake, Squall, The Fall) is announced 30 s ahead; mining grows from hand-carrying to
   Drills, Track lines and the Press; army upkeep with no supply cap and visible debt; the Trading House with
   scarcity prices; a territory win (14 of 21 for 90 s) and a Core win.
3. **It looks like the drawings.** Every Toastinator unit and building on the map, in the HUD and on every button
   uses the hand-drawn art (ink outlines, flat colour, funny but deadly serious). No placeholder shapes or text
   buttons left in v0.1.
4. **It's intuitive at every level.** Every button: icon, hotkey, cost, one plain sentence. Everything that can
   make you lose is visible before it bites. The first 3 minutes teach themselves.
5. **It's fast and fair.** 12–16 minute matches; mirror win rate 45–55% across seeds; 60 fps with 200 units on the
   MacBook Air.
6. **It's shippable.** All tests green; `npm run build` makes a clean dist/ with no secrets; CI passes on GitHub;
   HOSTING.md ready for Joshua to pick a host.

## Order of work (always do the highest open item first)
1. **Keep the build green.** A red build hides everyone's work from Joshua. If it's red, fixing it beats anything
   new. Never merge something that turns it red.
2. **Wire, don't add.** Many pieces are built but not plugged into the live page (territory, bigger map,
   edge-scroll, icons on buttons, portraits). Plugging finished work into play/ beats building new modules.
3. **Joshua's playtest bugs** (0:10 Core loss, off-base camera, mining too fast).
3b. **The Fanatic Council's Top 10** (FANATICS.md), in its ranked order. Joshua said: heed their advice.
   Council Top 10 (chair fable, full table in FANATICS.md): 1 no loss before ~3:00 (hard Core, slower clock, rush counters;
   bots kill the built-in in 14-33 s) · 2 territory match as the default link · 3 trustworthy orders · 4 scouting/fog
   that hides and ghosts · 5 readable, raidable economy · 6 Drift warnings as decisions · 7 visible counters and unit
   identity · 8 end screen with a rematch · 9 fair AI + published balance table · 10 self-teaching first 3 minutes + caster mode.
4. **Gaps in "Done means" above**, in that order.
5. Polish only after 1–4 are clear.

## Standing rule (Joshua, 20:09)
**When in doubt, add more shapes to the Design Studio** (play/style-lab.html): every unit, building, creature and
effect of the Toastinators, modelled in code with real motion. The Design Studio is where the look is decided.

## How we work (accord engineering, token diet)
- Own your files; ask in the chat to change anyone else's. Tests first. Plain-English posts under 900 chars.
- Finish your task and **exit**. Need a review? Post `REVIEW? <files> <one line>` and exit; a reviewer is started.
- Before you exit, post one line: **what Joshua can now SEE or DO that he couldn't before.** If the answer is
  "nothing yet", say what's blocking it and who owns that.
- Original work only. Never touch secrets. Fable for hard design and leads; Sonnet builds; Haiku helps and checks;
  GPT (Codex) takes scoped jobs: art pipeline, market, tooling, independent review.
