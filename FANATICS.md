# The Fanatic Council (Joshua, 19:24)

> "I want the AIs to face each other, and when playing the game, with the mindset of: INSTANTIATE THEM AS STARCRAFT
> AND RTS FANATICS AND THEY KNOW WHAT NEEDS TO BE ADDED. Heed their advice."

Four agents, one per team, each a lifelong RTS fanatic, play Driftfall against each other and against the built-in
AI, then write what it needs. The chair merges them into the **Council Top 10**, which goes into NORTHSTAR.md right
after "keep the build green" and "wire finished work into the live page". The swarm heeds it.

## Council Top 10
Merged by the chair (fable) from ## fable, ## sonnet and ## gpt; haiku's section was still empty, so ties in votes are
broken by who ranked it highest. "Votes" = how many of the three listed it. Details and done-tests live in each section.

| # | Must-have | Votes | Done when |
|---|-----------|-------|-----------|
| 1 | **A match cannot be lost before ~3:00-4:00.** Hard Core in the opening (hp/shield/garrison), slower clock (build, travel, Core kill time), a cheap counter to every rush. Evidence: three bots ended the built-in in 14-33 s; built-in mirrors end at 1:42. | 3 | The rush bots lose to a basic Turret+worker-pull defender; nothing ends before the first Drift announcement; matches run 12-16 min. |
| 2 | **Ship the territory match as the default link.** 128x128, 21 Reaches, claims, Hold-gated tiers, 14-of-21 countdown. | 3 | The plain link plays it end to end. |
| 3 | **Orders you can trust.** Groups, attack-move, shift-queue, rally, retreat, idle-worker hotkey; every refused order says why. | 3 | A scripted squad crosses a choke, fights, retreats and reinforces with zero lost orders. |
| 4 | **Scouting buys information.** Fog hides enemies from every interface (picking, minimap, targeting), cheap scout, ghosts of last-seen buildings. | 3 | An unseen enemy cannot be selected or shown; a scouted Forge leaves a ghost. |
| 5 | **Economy you can read and raid.** Income / upkeep / net on screen, Drills and Tracks cuttable, second base worth taking. | 3 | A raid visibly dips income within 5 s; 2-base beats 1-base bot at 55%+. |
| 6 | **Drift warnings are decisions.** Banner, sound, minimap marker, jump-to hotkey, 30 s ahead. | 3 | A player moves or defends a claim before a Flood. |
| 7 | **Counters and unit identity you can see.** Silhouettes, range rings, "good against" on the card, upgrades that visibly change fights. | 3 | A newcomer picks the right counter in a 5v5 without a tooltip. |
| 8 | **An end screen that earns a rematch.** Cause of the win/loss, decisive moment, income and army timeline, one-click rematch. | 2 | A finished match names why and restarts in one click. |
| 9 | **Fair, teachable AI and a published balance table.** Side-swapped win rates (mirror 45-55%), easy builds/expands/attacks in recoverable waves. Note: results swing by side (fable's bot lost seed 7 on side 1). | 2 | BALANCE.md with 30+ matches per pairing, regenerated per green build. |
| 10 | **The first three minutes teach themselves; a caster mode to watch.** Coach, idle-worker helper, icons+hotkeys+costs on every button; `?mode=watch` with score strip and event ticker. | 2 | An unbriefed newcomer mines, trains, claims and names the win goal in 3 min. |

Chair's note: #1 is ranked first because all three bots (fable, sonnet, gpt's logs) show the same disease: the game is
over before the design starts. Everything below is invisible while a 20-second rush decides the match.

## fable

Evidence: wrote `players/fanatic-fable/bot.mjs` (10 workers, Forge at 6, 2 Lancers per Grunt, push at 8 fighters), test `tests/fanatic-fable.test.mjs`. Played it against `players/builtin/ai.mjs` (normal), seeds 7/19/43, both sides, legacy 32×32, logs in `.sandbox/fable-council/`. **It won 5 of 6 by Core, at ticks 457, 507, 525, 613, 785 (19–33 seconds).** The sixth (seed 7, my bot on side 1) was a 2000-tick timeout. The Core (1000 hp) falls to eight units in a single tick of overkill hits, and the built-in never answers a Forge-at-tick-120 push. A caster would call this a coin-flip build order that ends the game before anyone has expanded. Not read: a live browser (headless, no screenshot taken); play/ judged from source and chat only.

1. **The Core must be hard to kill early.** Today 8 fighters erase 1000 hp in one tick at 0:20. Give the Core a opening shield (damage reduction or a "Core Hardened" window), a garrison that shoots back, or a siege-only structure multiplier, so that nobody can win before ~4:00 by a straight line. **Done:** the rush bot above can no longer win before 4:00 on any of 10 seeds; the Core visibly shows its hp bar and a "Core under attack" alarm with a ping on the minimap.
2. **Every opening must have a counter in the first two minutes.** A rush should be answerable by one Turret plus workers pulling, so scouting and walls matter. **Done:** a scripted defender (Turret at 60 s, workers pull) holds the rush bot on 8 of 10 seeds, and the rush bot still wins when the defender sleeps.
3. **Put territory in the default match, together with the clock.** Same as gpt #1: a 128×128 map makes the rush take minutes of travel, which gives the Core windows, scouting and expansion a reason to exist. **Done:** the ordinary link plays the 128×128, 21-Reach rules and the rush bot needs ≥2 minutes of marching to threaten a Core.
4. **Information first: scouting, fog, "what did they build?".** A fanatic wins by knowing; the player needs a visible enemy-tech readout when scouted (Forge seen, army count estimate, last-seen ghosts on the minimap). **Done:** a scouted Forge leaves a ghost icon; an enemy not seen for 10 s loses its live marker on every interface.
5. **Economy pressure that can be raided.** Workers walking to far crystal fields, Drills and Track lines (TERRITORY) must be cuttable, with an income number that visibly dips. **Done:** killing 3 workers or one Track tile drops the income readout within 5 s, and rerouting recovers it.
6. **Unit identity at a glance.** The bot only used Lancer/Grunt and still won; the built-in used Brutes. Counters need to be readable: silhouette, hp bar, range ring on hover, and a one-line "good against" on the card. **Done:** two players shown a 5v5 of Lancer vs Brute pick the right counter without a tooltip; the built-in's counter table and the card text come from the same STATS entry.
7. **Timing windows and comebacks.** Debt-based upkeep and Drift events are the comeback engine; make sure the loser of a big fight can still hold a Reach or retake one. **Done:** across 10 seeds, ≥30% of matches have the lead change after the first big fight; no match is decided before the first Drift announcement.
8. **Control must be instant and honest.** Attack-move, queue-by-shift, retreat that doesn't strand units, control groups; every refused order gives a reason in the log line or toast. **Done:** the browser scenario of gpt #3 passes and shows reasons.
9. **A caster mode worth watching.** The mode=watch page needs a score strip (income, army value, Reaches), event ticker ("Core under attack", "Flood in 30 s"), and auto-camera on fights. It is also how Joshua sees AI-vs-AI balance. **Done:** a 5-minute watch session names every Drift and every lost Reach without human camera work.
10. **Balance table published.** Side-swapped win rates for built-in vs built-in and for rush/boom/turtle bots, each match's duration, regenerated on every green build. **Done:** a BALANCE.md table with ≥30 matches each, mirror 45–55%, no archetype above 65% against the others.

## sonnet

Evidence: wrote `players/fanatic-sonnet/bot.mjs` (6 Workers, early Forge, mass Grunts, all-in at 7). Legacy 32x32 rules, 24 tps, `--max-ticks 23040`. Against built-in normal I lost seed 3 (side 0) and seed 11 (side 1): the built-in took the Core at ticks 2451 and 2447 (about 1:42), the same clock gpt saw. Against my older `players/sonnet/bot.mjs` (seed 5) I lost at tick 337 (14 s), so one opening can end a game before either side macros. No browser test; the play/ view is from source and chat. A 1:42 finish means the Drift, claims and tiers never happen in a default match.

1. **Slow the clock.** Lengthen build times, unit speed and Core hp so a Core takes 20+ s to kill and no army arrives before ~3:00. Why: scouting, expanding and comebacks need minutes. Done: three built-in mirrors plus bot-vs-built-in on 5 seeds all last 8+ min; nothing ends before the first Bloom.
2. **Ship the territory match as the default.** 128x128, Reaches, claims, Hold-gated tiers, 14-of-21 win with a visible countdown. Done: the plain link plays it.
3. **A safe opening.** A window where no rush can kill you (Core hp, a worker pull, a cheap defence). Done: my 14-second loss on seed 5 is impossible.
4. **Economy that rewards the second base.** Mining out one field must sting by ~4:00 so expanding is the default decision. Done: a 2-base bot beats my 1-base timing bot at least 55%.
5. **Counters you can see.** Roles with a clear answer, shown on the card and in hit effects. Done: scripted fights where the right counter wins at equal cost, every time.
6. **Upkeep as pressure.** Income, upkeep and net next to Shards; a raid visibly moves it. Done: a viewer can say why they are broke.
7. **Drift warnings as a clock.** Banner, sound, minimap marker, jump-to hotkey, 30 s ahead. Done: a player moves a claim before a Flood.
8. **Scouting with a price.** A cheap fast scout, fog that hides production, a reason to look. Done: the AI changes its build when it sees an army.
9. **Control feel at speed.** Groups, attack-move, shift-queue, rally, idle-worker hotkey, no silently refused order. Done: a scripted squad crosses a choke, retreats and reinforces with zero lost orders.
10. **An end screen that earns a rematch.** Cause of defeat, the decisive moment, income and army timeline, one-click rematch. Done: a finished match names why and restarts in one click.

Fight: gpt ranks control reliability third; I put the clock and territory-as-default above it, because without them nothing else shows. Agree with gpt on 4, 6, 8 and 10.

## haiku

Evidence: `players/fanatic-haiku/bot.mjs` (a plain Forge-then-push bot, 6 tests pass in `players/fanatic-haiku/bot.test.mjs`).
Ran `node env/run-match.mjs` on legacy 32×32 maps, seeds 7, 19, 43, both seats: fanatic vs built-in AI, AI vs fanatic,
fanatic mirror, AI mirror. Logs in `.sandbox/haiku-council/`. Caster read: fights start at tick ~370–470 (about 16–20 s),
and the match's first hit to the Core's fall takes 113 ticks, about 4.7 s (seed 19: first hit tick 388, Core dead tick
501). The Core itself went from 1000 hp to 0 in 34 ticks, with four units hitting it every tick. Read `env/combat.mjs` (`canAttack`, `chooseTarget`) and `env/state.mjs` (`observe`) to confirm.
No browser run; `play/` judged from the code and the chat's live-page reports.

1. **Give every attack a cooldown now.** Today a unit hits every tick (24 hits a second, `ENV-SPEC.md` section 10: "every tick, no
   cooldown", section 7). Four Lancers or Grunts take a 1000 hp Core from full to zero in about 35 ticks (1.5 s), so a 12–16 minute game
   can't survive first contact.
   The v3 draft already has `cooldown` per unit; ship that field in `env/stats.mjs` and `env/combat.mjs`, one table, no
   new mechanic. **Done:** each unit row has a `cooldown`; a 4 v 4 Grunt push on a Core takes at least 20 s of hits;
   the timeline test and the mirror logs show the first Core fall after 2:30 with the default AI.

2. **Attack-move and hold position in the player API and live input.** `ENV-SPEC.md` section 11 has `move`, `attack`
   and `stop` only. A unit given `move` walks past enemies and gets shot, and CLASSIC.md asks for A-click and H.
   Idle Workers never fight (`AUTO_KINDS` is grunt, lancer, brute), so they die to any raid. **Done:** `attackMove`
   and `hold` are legal commands with tests; a squad sent across a field fights what it passes and reaches its point;
   a held squad does not chase.

3. **Stop giving every player the whole map.** `observe(state, player)` in `env/state.mjs` copies every unit and
   structure, enemy ones included, and `env/referee.mjs` sends both sides that full view. Fog only lives in `play/`,
   so the built-in AI and any bot see through walls, and a scout buys nothing. The balance numbers were measured
   on an omniscient AI. **Done:** `observe` returns only units and structures in sight (plus remembered structures
   for the explored map); a test shows an enemy outside sight missing from `obs.units`; the default AI gets the same
   view as a human; the fog and minimap tests still pass.

4. **Fix the match clock before the territory game.** `STATS.match.maxTicks` is 2000 (83 s). Legacy matches end on
   value at that cap, and the first fight comes at about 16–20 s. Before any Drift or claim is wired in, a sustained
   early fight should be the exception. **Done:** over 30 seeds the first combat tick is at least 3600 (2:30), and the
   default match runs to a Core or territory end, with `maxTicks` raised to the 12–16 minute cap.

5. **Find the seat advantage before tuning numbers.** Across my eight bot matches, side 1 won 7 (both bots, both
   seats). Four of them ended on a timeout value that favoured side 1, so this is not just one early rush. Suspects:
   tick-parity move order (sonnet recorded the same seat effect in `players/haiku/NOTES.md`), and map orientation in
   the 32×32 layout. **Done:**
   50 side-swapped seeds with the fanatic bot, the built-in AI and the territory map; each side between 45 and 55%.

6. **Make a Core attack visible and answerable.** The Core has 1000 hp and no weapon (`STATS.units` and
   `combat.mjs`: "The Core has no row with damage"). The only warning is a value tally at the end. **Done:** an
   enemy fighter within 8 tiles of the Core raises a "Core under attack" alert in under 1 s with a jump-to key
   (Space, per CLASSIC.md), and the HUD shows the Core's time-to-die at the current enemy DPS.

7. **Workers must survive a raid or flee it.** In one fight (seed 7, fanatic vs built-in AI) all 15 of my Workers
   died at the mine, because they only fight when ordered and don't leave. **Done:** Workers within 6 tiles of an
   enemy fighter walk to the Core or the nearest Depot, and a log check shows Worker losses under 1/3 of the team in
   a 10-minute fight.

8. **Make refusals and scouting-free losses explainable.** My bot placed a Forge on a ring of tiles with no feedback
   about a refused site. It retries blind. Every refused command needs its reason in the next observation, and the
   player's log must show it, so a bot and a human can both learn. **Done:** a test sends a `build` on an occupied tile
   and reads `reason` back in the next observation and in the replay log.

9. **Role identity on the card.** Lancer has range 4 and 40 hp, Grunt has range 1 and 60 hp, Brute is slow with 240 hp.
   The roles only show as numbers. A fanatic should see "Lancer: keeps range, dies to Grunts in melee" on the card
   and tooltip. This agrees with gpt's item 8. **Done:** each card button shows one role sentence and a counter
   hint; a Lancer and a Grunt picked in a test show different sentences.

10. **Give the built-in AI a teaching style.** The default AI beat my plain push 3 of 3 and never showed a visible
    timing. Easy must build, expand and attack in waves a newcomer can see and answer, and it must not kill an
    idle player before 3:00. **Done:** a scripted idle newcomer loses no Core before 3:00 on easy, and a recorded
    easy game shows at least two waves of attacks a human can answer.

## gpt

Evidence: ran `node env/run-match.mjs` with built-in AI on both sides, seeds **7, 19, 43**, and `--max-ticks 23040`. Logs: `.sandbox/gpt-council-{seed}.json`. These are **normal AI, legacy 32×32 matches**, not the browser's easy setting or territory-enabled matches. Side 1 won all three by Core at ticks 2450/2452/2455 (about 1:42 at 24 tps); first combat was at ticks 409/362/374. Three seeds are a warning, not a balance verdict. Read `play/` source; no browser playtest or frame-rate measurement claimed. Existing input/app/teaching tests passed **24/24 before this documentation edit**.

1. **Make the default match the actual territory game.** Wire the finished bigger map, claims, tiers and both victory conditions into the live driver and page together. Right now the caster sees a small-map army collision before Driftfall's first scheduled event can happen. **Done:** opening the ordinary link shows 128×128 land, 21 named Reaches, claim controls, Hold-gated tiers and a visible territory-win countdown; a full replay reaches a legal territory or Core victory.

2. **Tune one real-time clock for economy, travel and combat.** Audit timings in seconds before adjusting individual unit strength. These mirrors finished before the intended first Bloom; a Core survived only 15 ticks after its first hit in each log. Players need time to scout, respond and retreat. **Done:** default easy cannot defeat an idle newcomer before 3:00; representative active matches usually last 12–16 minutes, with a visible, actionable Core-danger warning. Validate on the shipped map, not just this legacy harness.

3. **Make orders dependable under pressure.** Preserve the working selection, groups, attack-move and queued orders while wiring new commands; explicitly test choke traversal, retreat, rally and interrupted construction. Fighting the controls destroys tactical expression. **Done:** a browser scenario sends a selected squad through a choke, attacks, retreats and reinforces without stranded units, lost queued orders or invisible rejections; every refused command gives a reason.

4. **Make scouting buy information.** Audit fog across rendering, minimap, picking, attack acquisition and AI observations. Scouting a production choice or a new claim must change a player's decision; hidden enemies must stay hidden to every interface. **Done:** an unseen enemy cannot be selected, targeted or exposed on the minimap; a scout reveals it, lost sight hides current activity, and explored terrain remains legible. Run the same checks for both sides.

5. **Put the mining line and army budget on screen together.** Wire Drills, Track laying, Presses and the flow panel; replace the live input's old bank/cap training checks with the new debt rules. Expansion should fund aggression, and a raid should have a readable economic consequence. **Done:** a human builds a working line, sees income/upkeep/net, locates a cut, reroutes it and watches income recover; training continues in debt while paused construction/research explains why.

6. **Turn each Drift warning into a decision.** Wire the banner, sound and affected Reach marker to the public clock; show routes and economic assets at risk. The fun is choosing whether to evacuate, reroute or attack before the land changes. **Done:** a player sees the announced event 30 seconds ahead, jumps to its location and acts before impact; Flood/Quake outcomes and the next available route are understandable without reading code.

7. **Teach an opening through useful actions.** Wire the existing coach, idle-worker helper, illustrated card, portraits and plain tooltips into the actual page; it still hand-builds its old card and selection panel. First teach gathering, production and a claim, then expose the next need. **Done:** an unbriefed newcomer mines, trains, claims and identifies the win objective in the first three minutes; each button shows its real hotkey, cost and purpose, including the reason it is locked.

8. **Make composition and upgrades change a fight visibly.** Explain roles, target restrictions and upgrade effects in the live card, then validate positional and composition counters. These three logs spawned only workers, grunts, lancers and brutes among units; that is evidence of narrow AI usage, not proof other units are useless. **Done:** repeatable encounters demonstrate a reason to scout and change composition, and a researched upgrade demonstrably changes its stated behavior; no advertised upgrade is cosmetic or silently inactive.

9. **Audit mirror fairness and teachable AI pressure.** Side 1 swept this tiny sample. Separate map orientation, deterministic ordering, AI decisions and difficulty before changing balance numbers. **Done:** a larger published seed set with side-swapped team opponents and built-in mirrors reports win rate and timing; investigate departures from the North Star's 45–55% target. Easy visibly builds, expands and attacks in recoverable waves, so the human can learn a response.

10. **Close the match with a reason to rematch.** Show the winning cause, decisive land loss or economy break, and a one-click fresh start. Add the Trading House only with visible quotes, stock and transaction feedback so its strategic purpose is understandable. **Done:** a finished browser match names Core destruction or territory control as the cause, offers a replay/rematch, and lets the player identify a decision to try differently; market trades visibly explain what was paid and received.

## Round 2: Toaster Wars core

Evidence: read NORTHSTAR.md (Toaster Wars core, Done-means list), TERRITORY.md sections 17, 18, 20 and the Toaster
rules, COMBAT.md sections 1–4, CLASSIC.md, ENV-SPEC-v3-draft.md and sonnet's `env/power.mjs` plan (#616). Judged on paper;
no browser run and no code changed. Verdict: the core idea is strong (a visible leash, raids on cords, food you can
see). Three things will break pacing or readability if they ship as written.

1. **Make cord length follow the ground, not the map's straight lines.** Cords are measured Chebyshev (sonnet's plan,
   TERRITORY s20 "12 tiles"), so a cord reaches across a cliff, through rock and over a choke. Chokes, ramps and
   Quakes then stop mattering for power, and the leash feels arbitrary. Our own rules already say cliffs and rock block
   ground movement (ENV-SPEC-v3 s2, s6). **Why it matters:** the Snakenator/Toastinator mirror is decided at the
   chokes; a leash that ignores them removes the best fights. **Owner:** sonnet (`env/power.mjs`), with fable's sign-off.
   **Done when:** the cord limit ring on a selected Four-Slice matches the walkable tiles it can reach in 6 cord tiles;
   a Power point on a plateau cannot plug a unit on the low ground across a cliff; a test covers a Quake that changes
   the ramp and re-plugs (or un-plugs) the units behind it.

2. **Pick one army bill, and make the rules agree.** Three costs stack on every soldier: 10% of its cost a minute in
   Shards/Flux (TERRITORY s9), a minute of toast eaten (TERRITORY s17), and one slice per shot (COMBAT s1). The docs
   also disagree on hunger: TERRITORY s17 says hungry soldiers **strike** (stop attacking, sit with a sign), while
   COMBAT s2 says Powered + Hungry **can move** and only can't fire. Three bills and two hunger rules make the flow
   panel unreadable and the balance table impossible to tune. **Why it matters:** "am I broke or out of ammo?" must have
   one answer on screen. **Owner:** fable (decides the model, one page), then sonnet (`env/ammo.mjs`, `env/budget.mjs`).
   **Done when:** one hunger rule is in both files; the 10% coin upkeep is either removed or written as the toast
   bill; a 10-unit army's toast/min appears on the flow panel and matches a test; COMBAT's state table and TERRITORY
   s17 use the same words.

3. **Make a cut a fight, not a free tap.** Today an enemy standing on a cord line severs it at once, and the cut
   costs the enemy nothing but a step. A Bagel can unplug a whole Outlet chain before anyone reacts, and the raid
   becomes the only game. **Why it matters:** raids should be the exciting part of the late game, with a warning the
   defender can answer. **Owner:** sonnet (cut rule in `env/power.mjs`), gpt (the sparking cord and its countdown).
   **Done when:** a cord or Extension Box has hp; a cut needs about 3 s of contact or damage on that line; a "cord
   under attack, 4 s" banner and a red blink show before it severs; a Crumb re-plugs in view and the log names the
   tile; a lone Popper cannot cut a three-Outlet network in one step (a test).

4. **Cut the v0.1 resource list to what the loop needs.** Right now the docs name Shards, Flux, Alloy, Flour, Water,
   Butter, Energy, Toast, Waffles, Jam, Honey, Salt, Sugar, Nut butter, Glowmoss, Stormglass, Quakestone, Ironroot and
   Amberlight, with a Trading House quoting eight. Each one is a counter, a price and a pile on the top bar. Fanatics
   learn one economy deeply, so the first edition should ship only the chain that makes toast: Flour, Water, Butter,
   Energy, Toast, and one rare topping (Jam). The rest wait for later editions. **Owner:** fable (scope), haiku
   (top-bar counters, HUD check). **Done when:** the top bar shows at most six counters, the market quotes at most five
   rows in v0.1, every Toaster shows one missing-ingredient icon, and a first-timer can name all six without help.

5. **Write the air and late-game leash now, before sonnet builds it.** TERRITORY s20 says air units "use long cords and
   drift like kites", and the Squall section says air can't fly inside a storm. Nobody has ruled what happens when a
   Flying Toast (no ground path, long cord) sits under a Squall, when its cord is cut, or when the Fall takes the
   Outlet it hangs from. Late games also need a brake: cord upgrades plus cheap Outlets make the leash vanish after
   about 12:00, which erases the late-game map pressure the Fall is meant to create. **Owner:** fable (the rule),
   sonnet (`env/power.mjs`). **Done when:** a Squall stops air cords the same way it stops air moves; a Flying Toast
   with its Outlet lost browns out (like a ground unit with no power) and lands after its battery; a test shows the
   Fall lowers the longest cord a side can build to a fixed maximum.

Also noted, not top 5: TERRITORY.md has two sections numbered "20" and two numbered "14" (doc hygiene, fix when next
edited); the first 3 minutes need a fed-start rule (every opening unit begins Fed for 3:00) so the Council's #1 "no loss
before 3:00" still holds once toast ammo exists.

Fanatic's read of the pacing: the 0:00–3:00 opening is the only place this design can lose its readability. A new
player who is taught cords, toast, Crumbs, Outlets and Drills in one minute will quit. Teach one loop at a time (feed,
then leash, then raid), and keep the rest hidden behind the Drift banner until the player asks.
