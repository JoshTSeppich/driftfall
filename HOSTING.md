# Hosting Driftfall (for Joshua to choose)

Driftfall is a static site: `npm run build` makes `dist/` (about 13 MB with the precompressed copies, 132 files),
and any host that serves plain files can run it. There is no server code. Nothing has been signed up for or deployed;
that is yours to do. Try it first with `npm run build && npm run preview` (http://127.0.0.1:4173/).

What the build gives a host:
- `dist/index.html` (never cached) and `dist/<hash>/...` (everything else, safe to cache forever; the hash changes with the content).
- `dist/_headers` with those cache rules (Cloudflare Pages and Netlify read it as is).
- `.br` and `.gz` copies of the code. Most hosts compress on the fly anyway, so you can ignore them.
- Needs only **HTTPS or localhost** (modules and audio work on both). No cookies, no database, no secrets.

## Comparison (free tiers, as of my knowledge in 2026: check the host's pricing page before you commit)

| Host | Free tier fits a 13 MB static game? | Setup effort | Uses `_headers` | Good for | Watch out for |
|---|---|---|---|---|---|
| **Cloudflare Pages** | Yes. Unlimited bandwidth on static assets, generous file limits (25 MB per file) | Connect GitHub repo, build command `npm run build`, output `dist` | Yes | A game that might get shared widely; fastest worldwide CDN | Account needed; commercial use is allowed |
| **GitHub Pages** | Yes. 1 GB site, soft 100 GB/month bandwidth | The CI workflow can publish `dist` (needs one more job, I can add it when you choose) | No (cannot set cache headers) | Simplest if the repo is already on GitHub; free custom domain | Public repo needed on the free plan; no custom headers; files cached for only 10 min |
| **Netlify** | Yes, within a monthly bandwidth/credit allowance | Connect repo or drag-and-drop the `dist` folder in the browser | Yes | Drag-and-drop with no Git at all, easy preview URL per branch | Free-tier monthly caps; going over pauses the site |
| **Vercel** | Yes for hobby use | Connect repo, output `dist` | Uses `vercel.json` instead (I can add) | Nice previews per pull request | Hobby plan is for non-commercial use; bandwidth cap |
| **itch.io** (HTML5 upload) | Yes (zip of `dist`) | Make a project, upload zip, tick "play in browser" | n/a | Where players look for games; no Git needed | Runs inside an iframe, so fullscreen/audio need a click; 500 MB limit is no issue |

## My recommendation
1. **Cloudflare Pages** if you want it public and shareable (no bandwidth worry, honours our cache rules).
2. **itch.io** in addition if you want an audience of game players; zip `dist` and upload.
3. **GitHub Pages** only if you want zero extra accounts and don't mind slower first loads.

## What I need from you
- Which host, and whether the repo will be on GitHub (CI is already in `.github/workflows/ci.yml` and runs the tests plus the build on every push, but it never deploys).
- Whether the public build should still show the "Edition N" live reload. Right now it does not: the production page drops the live-build watcher because the public site has no Control Room feeding it.
- One thing to know: the page runs the computer opponent in the browser, so the bots under `players/` (sample, builtin, sonnet, haiku, fable `bot.mjs`) are shipped with the game, along with the files they import. Tests, `.sandbox`, notes, `.env` and the live-build tooling are never shipped.
