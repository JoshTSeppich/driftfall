# Driftfall security review

Written by the Security Engineer (team sonnet). Date of review: 2026-10-22. Scope: how players are sandboxed, what
agents may touch, asset downloads, secrets, and the viewer pages. I did not read any `players/` folder. Findings
marked **verified** were reproduced by running code on this machine (Node v20.19.6); the rest come from reading source.

Severity: **High** = a player or file can harm the machine or the match result; **Medium** = can break or bloat a
run; **Low** = needs an unlikely setup. Owners come from `roles/ROLES.md` and `PLAN.json`.

## Summary

| # | Finding | Severity | Owner | Status |
|---|---------|----------|-------|--------|
| 1 | Worker threads are not a sandbox: a player can read/write files, run commands, see env vars, use the network | High | fable (`env/referee.mjs`, `env/player-worker.mjs`) | fixed 2026-10-22 by sonnet: child process + `--permission`, empty env; network also blocked (checked on Node 26.12; needs a Node that knows `--permission` and `--allow-net`, not Node 20) |
| 2 | One player can write a huge command list and bloat the log and memory | Medium | haiku (`env/commands.mjs`), fable (referee) | referee half fixed 21:38 UTC (per-command size cap); `commands.mjs` reject-event half open |
| 3 | No memory limit on player threads; unbounded player name and error text go into the log | Medium | fable | open |
| 4 | Time limit only covers `act`; a player can keep burning CPU between replies | Medium | fable | open |
| 5 | Viewer pages inject text into `innerHTML` from the `?match=` URL and error messages | Low | sonnet (`viewer3d/index.html`) | open |
| 6 | Asset rules: audio and GLB licences and file types are not machine-checked | Low | License audit, sonnet (3D scout) | open |
| 7 | Secrets: `.gitignore` covers `.env`, but nothing scans for keys | Low | Build & Release | open |
| 8 | What agents may touch is only a convention (ownership rules in `PLAN.json`) | Low | Senior Producer | open |

## 1. Players are not really sandboxed (High)

`env/referee.mjs` starts each player with `new Worker(player-worker.mjs, { workerData })` and no other restriction.
A worker thread shares the process user, the file system, the environment and the network. **Verified** with a
throwaway worker thread started from this repo directory: it read `ENV-SPEC.md` (18658 bytes), ran `id -un` through
`child_process` (printed the real user name), listed 54 environment variables and had `fetch` available.

What this means for Driftfall: a player module (they are loaded by file path and run any top-level code at import)
can
- read the opponent's player source or other repo files and use them (breaks "no reaching outside the API");
- write to the repo, including `matches/`, `tests/` or another team's files;
- read environment variables (which on this harness may hold tokens) and send them out with `fetch`;
- run shell commands.

The time limits in spec section 11 only stop infinite loops. They do not stop any of the above.

Recommended fix (concrete, in order of effort):
1. **Run the worker under Node's permission model.** Node 20 supports `node --experimental-permission`
   `--allow-fs-read=<player file and env/ dir>` (no `--allow-fs-write`, no `--allow-child-process`). For worker
   threads the flag applies to the whole process, so the cleanest way is to run each player as a **child process**
   (`child_process.fork` with `execArgv` permission flags and an empty `env: {}`) that talks to the referee over
   IPC, instead of a thread. Owner: fable. I will re-run my probes against the result.
2. Whatever the isolation, start the player with `env: {}` (no inherited variables) and `workerData` containing only
   `{ path, side, seed, stats }` (already true).
3. Add a tournament rule (Esports / Tournament Operations): matches that count for results are only run through
   the isolated mode; the current thread mode is for local tests with trusted players.
4. Add a test `tests/referee-isolation.test.mjs`: a player that tries `fs.readFileSync`, `child_process.execSync`
   and `process.env` must get an error and the match must still finish. (Write it only with the owner's OK.)

## 2. Command flood bloats the log (Medium)

`env/commands.mjs:8-13` loops over every command and, for each one past the 100th, emits a `reject` event that
**contains the whole command object**. `env/log.mjs:40-47` then stores `commands` untouched and every event in
the log. A player returning millions of tiny commands (or a few commands with huge nested fields) makes the
referee do millions of iterations in the main thread (where the 50 ms limit no longer applies) and writes a
multi-hundred-megabyte log. The spec says "at most 100 commands per side per tick" but that limit is applied
after the data has already been copied across and logged.

Fix: in the referee, `commands.slice(0, maxCommandsPerTick)` before `step`, and log a single
`{e:'reject', player, reason:'too-many', count:n}` event instead of one per extra command; in `commands.mjs`
store only `command.type` and known fields in a reject event. Also reject replies larger than a fixed size
(e.g. more than 1000 entries counts as an `error`). Owners: haiku for `commands.mjs`, fable for the referee.
Spec §10/§12 wording needs a one-line change; Technical Director to approve.

Done so far (fable, 21:38 UTC): the referee measures every command as JSON; a reply holding a command over
`STATS.referee.commandChars` (1024) characters, or one that is not plain JSON at all, is an `error` with empty
commands for that tick, so no oversized field reaches the simulation or the log (spec §11 has the sentence). The count
of commands is deliberately not cut in the referee: spec §10 and `tests/anticheat.test.mjs` want every command past
the 100th rejected as `too-many`, so the flood of small reject events remains haiku's `commands.mjs` half.

## 3. No memory limit; unbounded strings in the log (Medium)

`new Worker(...)` is created without `resourceLimits`, so a player can allocate until the machine swaps. Separately,
the player's `name` (player-worker.mjs line ~35, `made.name`) and error messages (`describe(err)`) go straight into
`log.players` and `error` events with no length cap, so a 50 MB name or message ends up in every log and in the UI.

Fix: `resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 }` (or the child-process
equivalent `--max-old-space-size`), truncate `name` to 40 characters and error messages to 200 characters, and
let an out-of-memory exit count as a `forfeit`. Owner: fable.

## 4. CPU burned between replies (Medium)

The 50 ms and 1000 ms clocks measure only the time between `postMessage(observe)` and the reply. A player can reply
fast and keep working afterwards (a timer, a promise loop, or an `await` that never yields), so the next tick
is slow for *both* sides because all threads share the machine's CPU; the opponent's timing then looks late too.
The referee also asks both sides at once, so one heavy player can make the other miss the 50 ms limit.

Fix: run the two players one after the other for timing purposes (ask side 0, wait, ask side 1) or pin each to its
own process; log CPU time (`process.cpuUsage`) next to wall time in `timing` as a tie-breaker for disputes. This is
a design choice, so I'd like fable and the Anti-Cheat Engineer to agree before anyone changes it.

## 5. Viewer pages (Low)

- `viewer3d/index.html:102` and `:186` build `boot.innerHTML` from `url` (the `?match=` query parameter) and from
  `err.message`. A crafted link such as `?match=<img src=x onerror=...>` runs script in the page. It only matters
  if someone opens a link they were sent, and the page is local, hence Low. Fix: use `textContent` (or escape).
  Owner: sonnet (viewer3d). `fetchLog(url)` will also fetch any URL given; restrict it to same-origin paths.
- Good: player names go in with `textContent` (`viewer3d/hud.mjs:223-224`), and `live/threads.mjs:127` uses
  `textContent` for chat. `live/starter-tv.html` escapes `& < >` before `innerHTML` (the colours come from a fixed
  table, so missing quote escaping is not exploitable). `live/spotlight.mjs:375` sets `innerHTML` from `render`
  output built with its own `esc` (escapes quotes too): fine as long as every field goes through `esc`.
  Please keep new code on `textContent`.
- `viewer3d/hud.mjs:332` writes `innerHTML` from unit labels that come from the stats table, not from players. OK.

## 6. Asset downloads (Low)

Current state: `assets/` holds 116 `.glb`, 217 `.png`, 403 `.ogg`, 2 `.ttf`, 3 `.txt`, 3 `.md`, 1 `.ini`, 3 `.json`.
No scripts, archives, executables, SVG or HTML files (checked with `find`). `assets/LICENSES.md` lists Kenney
CC0 sources for sprites and UI; the 3D scout reported GLBs have no external buffers.

Rules to keep (proposal, for License audit and the 3D scout to AGREE):
1. Download into a **new, empty directory outside the repo**, never run anything from it, and move across only
   files with an allowed type: `glb png jpg ogg wav ttf txt md json`.
2. Source only from pages with a recorded licence (CC0 preferred). Record URL, author, licence and date in
   `assets/LICENSES.md` in the same change. Prefer `https` and download pages the author hosts (kenney.nl,
   opengameart.org), not mirrors.
3. Check each file with `file` (type matches extension) and, for `.glb`, that no `uri` points outside the file
   (no `http://` or `../` references). Reject anything containing HTML or scripts.
4. Extract archives with a tool that refuses `../` paths (zip-slip) and list the contents first.
5. Audio: `assets/audio/` has `kenney-*` folders and `_scratch`, but `assets/LICENSES.md` has no audio entry at
   all (`grep -c audio` gives 0; the table covers sprites and UI only). License audit please add them. `_scratch` should be deleted or ignored before any
   release.
Owners: License audit / Licensing Manager (LICENSES.md), Sound Designer (audio), 3D scout (models).

## 7. Secrets (Low)

`.gitignore` excludes `.env`, `.env.*`, `*.log`, `/data/`, `/recordings/`, `.sandbox/`, `__airpull/` and
`node_modules/`. I searched the repo (excluding `node_modules`) for `sk-ant`, `API_KEY`, `SECRET`, `PRIVATE KEY`
and `ghp_` with `grep -rIl`; **no matches** at the time of review. Remaining risk is the environment variables
visible to players (finding 1) and `channel.jsonl`, which is committed chat text: nobody should paste tokens there.
Proposal: Build & Release adds a pre-push check that runs the same grep. Note `.sandbox/` holds scratch scripts and
is ignored by git, which is right; `__airpull/` too.

## 8. What agents may touch (Low)

Rules in `PLAN.json` ("only edit files you own") and `roles/ROLES.md` are conventions, not enforced. Nothing stops
an agent from editing another team's file or from reading `players/` (a fairness issue between the three player
teams). Proposal:
- Keep the convention, and have the Live Build Compiler (`live/compile.mjs`) record a changed-file list per build
  so an out-of-ownership edit shows up in `live/status.json` with the author. (Owner: Live Build Compiler; I
  only ask, I won't touch it.)
- Player teams: no reading another team's `players/<team>` folder; the Tournament Operations role runs matches,
  not players.
- `live/compile.mjs:39` uses `spawn(cmd, argv, { cwd: ROOT })` with fixed commands and no shell: safe as long as
  `cmd` and `argv` never come from chat or logs. It runs every test file, so a test file is trusted code: review
  tests like source.
- Agent commands: `say.mjs` just appends JSON to `channel.jsonl` with a whitelist of senders; fine. Chat text is
  untrusted and must stay on `textContent` in the UI (see 5).

## What I checked and found fine

- `env/player-worker.mjs` answers only `observe` messages, serialises requests, and reports `act` errors without
  crashing the thread; stale replies are ignored by the tick check in `referee.mjs:59`.
- A player that never answers is terminated after `hardMs` and forfeits; one that fails to load forfeits at tick 0.
- Observations are structured-cloned into the worker, so a player cannot mutate the simulation state.
- No `Math.random`, `Date`, or timers in `env/*` outside `referee.mjs` and `player-worker.mjs` (grep clean).
- `run-match.mjs` takes only numbers and file paths from the command line; no shell is involved. The `--out` path is
  written as given: do not run it with an untrusted `--out`.

## Open items I need from others

- fable: yes/no on moving players to a child process with the permission flags (finding 1) and on 2, 3, 4.
- haiku: the reject-event change in `commands.mjs` (finding 2).
- A reviewer from a different team (fable or haiku) to read this file and post AGREE or a disagreement.

Changes to this file go through the same review as code.
