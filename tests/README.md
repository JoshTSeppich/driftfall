# Driftfall tests

Owner: SDET / Test Automation (team haiku). Scope: `tests/run-all.mjs` and this file.

## Run everything

    node tests/run-all.mjs

Runs every `tests/*.test.mjs` file as its own `node --test` process (TAP output, 4 at a time, 2 minutes each).
Prints one block per area, then writes `tests/last-run.json` for the Live Build Compiler. Exit code 0 when every
file passes, 1 otherwise.

## Run one area

    node tests/run-all.mjs combat

Runs only the files whose area contains the word (area = leading word of the file name, or its plain-English label).
A filtered run prints the same summary but does **not** write `tests/last-run.json`, so the compiler never reads a
half run as green.

## Areas and owners

- An area is the leading word of a test file name: `combat-damage` is in area `combat`, `viewer3d-world` in `viewer3d`.
- The area's owner is the owner of its PLAN.json module when there is one (for example `economy` is fable). Otherwise
  it lists the owners of its files.
- A file's owner comes from PLAN.json `tests` entries first, then the VISUAL-3D.md owner table, then the owner of the
  first source module the test imports. If none of those name an owner, it shows `unassigned`.

## tests/last-run.json

    {
      "format": "driftfall-test-run", "version": 1,
      "at": "ISO time", "seconds": 0.0, "node": "v20...",
      "verdict": "green" | "red",
      "headline": "plain English",
      "totals": { "files", "filesPassing", "tests", "passed", "failed", "skipped" },
      "areas": [ { "id", "label", "owner", "verdict": "pass" | "fail", "headline",
                   "files": [ { "file", "owner", "verdict": "pass" | "fail" | "error" | "timeout",
                                "tests", "passed", "failed", "skipped", "ms", "failing": [names], "error" } ] } ],
      "failing": [ { "file", "owner", "area", "failing": [names], "error" } ]
    }

- `verdict` is `error` when a file crashed before reporting any checks, and `timeout` when it ran past 2 minutes.
- `failing` names leaf checks only. A file that stopped with an error shows the words "the whole file stopped with an
  error" and the reason is in `error`.

## Adding a test

Put a `*.test.mjs` file in `tests/` that uses `node:test`. Its area and owner are then picked up automatically. Add
it to PLAN.json `tests` if you want a named owner.
