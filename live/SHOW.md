# Driftfall LIVE VIEW — run of show

Owner: fable (Show Director). What Joshua sees on the TV at every moment, and why it switches.
The scheduler that enforces this is `live/show.mjs`. Everything shown is read from the harness's records
(agent feeds, the team chat, the project's files, the compiler's status); nothing on screen is invented.

## The screen

The TV is one 1920x1080 page, `live/index.html` (Live View Engineer builds it; this file says what goes where).

```
┌───────────────────────────────────────────────┬──────────────────────┐
│                                               │ BUILD STATUS         │
│                 STAGE                         │ green/red, tests,    │
│   whichever scene is on (below)               │ what broke, owners   │
│                                               ├──────────────────────┤
│                                               │ SWARM TALKING        │
│                                               │ last chat lines +    │
│                                               │ decisions / AGREEs   │
├───────────────────────────────────────────────┴──────────────────────┤
│ AGENTS AT WORK   tiles for every running agent, hot ones lit         │
├──────────────────────────────────────────────────────────────────────┤
│ NOW ▸ plain-English caption from /api/subtitles (always on)          │
└──────────────────────────────────────────────────────────────────────┘
```

Always on, whatever the scene: the build pill (GREEN / RED / build number), the caption line, the clock,
the agent count. The scene decides which panel is **big** (the `focus`), never which panels exist.

## The scenes

| scene | what is on the stage | focus | minimum hold | may return after |
|---|---|---|---|---|
| MATCH | the newest build playing the freshest recorded match (3D viewer when `viewer3d/index.html` exists, else `viewer/live.html`) | stage | 45 s | at once |
| WALL | every agent working right now, live output, hot ones lit, split by machine | wall | 20 s | 30 s |
| SPOTLIGHT | one agent's live output, large: the one `live/spotlight.mjs` ranks top, or the one that just finished | wall + agent | 20 s | 25 s |
| MOMENT | a chat moment, quoted in full: Joshua's post, an AGREE, a decision, a question to an owner | chat | 12 s | at once |
| BUILD | the build just flipped: green or red, which test files, whose | status | 15 s | at once |
| CHANGES | what just changed in the repo (files, who, why from the changelog) | status | 15 s | 60 s |
| TITLE | "Driftfall, built live by the swarm" card, only when there is nothing to show | stage | 8 s | — |

## When it switches

Two kinds of switch. **Rotation** fills quiet time. **Cuts** interrupt for something that just happened.

**Rotation** (nothing new): MATCH → WALL → SPOTLIGHT → MATCH → CHANGES → WALL → SPOTLIGHT → repeat.
A scene is skipped when it has nothing to show (no match file yet, no agents running, nothing hot, no change)
or when it was on stage too recently (the "may return after" column). The match is on stage roughly half the time.

**Cuts**, strongest first. A cut takes the stage if it is stronger than what is on, or when the current hold is over.
Weaker cuts wait in a queue (for up to 60 s) and play in order of strength once the stage is free.

| priority | what happened | scene | source |
|---|---|---|---|
| 100 | Joshua posted in the chat | MOMENT, his message quoted | channel.jsonl, `from: joshua` |
| 100 | someone wrote `tv: wall` (or match, spotlight, moment, build, changes, title) in the chat | that scene, pinned for 2 minutes | channel.jsonl |
| 95 | the build flipped green→red or red→green | BUILD | live/status.json `state` |
| 90 | an AGREE was posted | MOMENT | channel.jsonl / live/threads.json `agrees` |
| 85 | a fresh match was recorded | MATCH, that match from the start | live/status.json `match.file`, else newest matches/*.json |
| 75 | a decision was announced | MOMENT | live/threads.json `decisions`, else chat words like "decision", "settled" |
| 65 | an agent just finished | SPOTLIGHT on that agent | /api/graph state running → done |
| 60 | a question addressed to someone | MOMENT | live/threads.json `openQuestions`, else a "?" naming a team |
| 10 | build files changed | CHANGES, rotation strength only, never interrupts | /api/project mtimes |

Rules that keep it watchable:
- A cut keeps the stage for its minimum hold, then at most its cut limit (MOMENT 20 s, BUILD 25 s, MATCH 90 s),
  then the show returns to the scene it interrupted if that still has content, else to the rotation.
- The same thing twice (two AGREEs in a row, the same files again) refreshes the scene already up; it does not re-cut.
- A pinned scene (`tv: wall`) holds for 2 minutes and only Joshua's own post can cut it. Pin again to extend.
- Nothing ever flickers: no scene is shown for less than its minimum hold, checked by the self-test over 5 simulated minutes.
- The first poll never replays history: old AGREEs and old questions are not cues, only new ones.

## How the panels plug in

Two ways, both live:

1. **File** (what `live/app.mjs` does today): the director process `node live/show.mjs --run` polls the Control Room
   every 1.5 s and writes `live/scene.json` on every change and at least every 5 s:
   `{ t, scene, focus, kind, priority, title, reason, agent, agentLabel, since, until, cut, message, match, build, buildHeadline, agents, pinned }`.
   `scene` is one of match, wall, spotlight, moment, build, changes, title. `focus` is the panel to make big: stage, wall, chat, status.
   `agent` is the Control Room node id to spotlight. `message` is the quoted chat line for a MOMENT. `until` is when the hold ends.
2. **Module** (for panels that want callbacks): `import { createShow, SCENES } from "./show.mjs"`, then
   `show.register({ name: SCENES.WALL, ready(sig), enter(cue, sig), leave(cue), update(sig, cue) })`, `show.on("scene", fn)`,
   `show.start()`. The page also gets a `show:scene` window event with `{ cue, describe }`. `show.cue(scene, reason, holdMs)` is the manual override.

## Checking it

- `node live/show.mjs --selftest` runs scripted signals through the pure rules (opening scene, AGREE cut, Joshua over
  everything, queue order, build flip, fresh match, chat pin, no flicker over 5 minutes, agent finishing).
- `node live/show.mjs --seconds 30` watches the real Control Room and prints what it would put on stage, without writing anything.
- `node live/show.mjs --run` is the real director (writes `live/scene.json`). Add `--seconds N` to stop after N seconds.

## Open to the team

- Live View Engineer (sonnet): please map `focus: "status"` to the build panel; today app.mjs only knows stage, chat, wall.
- Agent Spotlight Operator (fable): if spotlight.mjs publishes its top pick (an id) anywhere readable, the SPOTLIGHT scene will use it over "hottest agent".
- Swarm Discussion Curator (haiku): `threads.json` items carry `n`, the chat message number; the director uses that to avoid cueing the same message twice.
- Anyone: `tv: match` (or wall, spotlight, moment, build, changes) in the chat takes the TV over for 2 minutes. Joshua's posts always win.
