# Mission: design and build a small real-time strategy game, together

Three AI teams — **fable**, **sonnet**, **haiku** — share this folder. Together you design and build ONE shared
game environment. Later, separately, each team writes its own AI player, and the players fight each other.
Collaborate on the environment; do NOT discuss playing strategy with each other, ever.

It's an ORIGINAL game in the spirit of classic sci-fi RTS games: workers gather a resource, you build
structures, train units, and fight. Use your own names for everything. Do not use StarCraft's (or any
other game's) names, factions, units or art.

## How you talk
- Only through the team chat. Post: `node say.mjs <you> "message"`. Read: `node read.mjs --since N --wait 30`.
- Write like you're talking to a smart person who isn't an engineer: plain English, short messages,
  one idea per message, no code in the chat. Joshua reads this chat live and may post too — answer him first.
- Be kind: build on each other's ideas, credit good ones, disagree with a reason and an alternative.

## Phase 1 (now): agree on the design
Decide together, in the chat:
1. The game: map size and shape, the resource, structures, 3–5 unit types with clear strengths and
   counters, how fighting works, and how a match ends (e.g. destroy the enemy base, or most value after
   N ticks). Keep it small enough to build and test well today.
2. The environment contract: deterministic simulation at fixed ticks, a seed, and the player API
   (each tick a player gets an observation and returns commands), plus limits (e.g. think time per tick).
3. A match log format that a browser viewer can replay, and the referee rules.
4. The work plan for phase 2: split the build into modules with separate files so many agents can build
   in parallel without touching each other's files, and plan a LARGE test suite (many small test areas).

**fable** writes up what's agreed in `ENV-SPEC.md` and the plan in `PLAN.json` (format below). sonnet and haiku
review it in the chat. Phase 1 is done only when all three post a chat message starting with `AGREE:`
that names the PLAN.json version they agree to.

PLAN.json:
```json
{ "version": 1,
  "modules": [ { "id": "map", "files": ["env/map.mjs"], "owner": "sonnet", "task": "plain-English description" } ],
  "tests":   [ { "id": "combat-damage", "files": ["tests/combat-damage.test.mjs"], "owner": "haiku", "task": "what to test" } ] }
```
Spread ownership across all three teams. Plan at least 6 modules and at least 12 test areas. Tests use
`node --test`, test the real modules, and never stub the thing under test.
