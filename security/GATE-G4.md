# G4 security gate: findings (haiku, 2026-10-22)

Owner: haiku. Files I own: `security/` (csp.mjs, scan.mjs, this file), `tests/security-gate.test.mjs`.
SECURITY.md is sonnet's; the items below are proposed for it, not written there.

## Results

| Check | Result |
|---|---|
| Fresh build holds no secrets, private files, links, wrong file types | PASS (`scanTree` on a fresh build: 0 findings) |
| Build ships players/haiku, sonnet, fable bots | Yes, by design: they are the `?ai=` opponents, public in the build |
| Player sandbox (SECURITY.md finding 1) | **FAILS on Node 20**: `--permission` is "bad option" (child exits 9), so every player forfeits. anticheat/referee tests fail 17 of 19. Node 20.19.6 is what the Live Build runs |
| Sandbox with `--experimental-permission` on Node 20 | Probed: own file readable, other repo file blocked, writes blocked, child_process blocked, worker threads blocked. **Network not blocked** (fetch reaches the socket layer) |
| Strict CSP for the hosted page | Written (`security/csp.mjs`): script-src is 'self' + two hashes, no unsafe-inline/eval; style-src-attr unsafe-inline (HUD writes style="" attributes) |
| CSP verified in a real browser | **NOT DONE**: the browser tool was not permitted in this session |

## Risks for SECURITY.md

1. (High, fable) Sandbox does not start on Node 20. Fix: choose `--permission` when `process.allowedNodeEnvironmentFlags.has('--permission')`, else `--experimental-permission`. Verify with tests/anticheat.
2. (Medium, fable) Player children on Node 20 can still open network sockets. Only Node 22.13+/23.5+ `--allow-net`-style restriction would cover it; env is empty, so no tokens leak.
3. (Medium, sonnet, app.mjs) `?ai=` is pasted into a dynamic import path: `../players/${aiName}/bot.mjs`. Use an allowlist: sample, builtin, sonnet, haiku, fable.
4. (Low, sonnet, play/index.html:57) `err.message` goes into innerHTML on boot failure. Use textContent.
5. (Low, sonnet) Build wiring: scripts/build.mjs should call `injectMeta` and write the `headerPolicyFor` CSP plus SECURITY_HEADERS into `_headers`.
6. (Low, Build & Release) live/status.json is red (5 files). tests/build.test.mjs resolves `/Users/joshuaseppich/...` (typo path), so it cannot find scripts/build.mjs.
7. (Low) Built-in bots' source is public in the build; acceptable for the public AI, but the tournament bots must not be treated as secret.
