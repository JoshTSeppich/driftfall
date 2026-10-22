// live/show.mjs — Driftfall LIVE VIEW scene scheduler (owner: fable, Show Director).
//
// Decides what is on the TV stage at every moment and switches scenes. Other panels plug in.
// Runs in the browser (imported by live/index.html) and in node (dry run / self-test):
//   node live/show.mjs --selftest            scripted signals through the pure rules, prints every cut
//   node live/show.mjs --seconds 30          watches the real Control Room and prints what it would show
//
// Browser use (Live View Engineer):
//   import { createShow, SCENES } from "./show.mjs";
//   const show = createShow();                        // same-origin fetch of the Control Room APIs
//   show.register({ name: SCENES.MATCH, ready: (sig) => !!sig.match.path, enter(cue, sig) {...}, leave() {...}, update(sig) {...} });
//   show.on("scene", (cue) => { /* cue = { scene, reason, priority, since, until, cut, data } */ });
//   show.start();                                     // polls every 1.5 s, calls panels, dispatches window "show:scene"
//   show.cue(SCENES.WALL, "Joshua pressed W", 60000); // manual override, pins the scene for 60 s
//
// Pure parts (no fetch, no DOM, no clock): readSignals(raw, prev, now) and decide(state, signals, now).
// Everything the show says is read from the harness's records; it never invents an event.

export const SCENES = Object.freeze({
  MATCH: "match",        // the newest build playing the freshest recorded match
  WALL: "wall",          // every agent working right now, live output tiles
  SPOTLIGHT: "spotlight",// one agent's live output, chosen by live/spotlight.mjs or by activity
  MOMENT: "moment",      // a chat moment: Joshua posting, an AGREE, a decision, a question
  BUILD: "build",        // tests going green or red, what broke, who owns it
  CHANGES: "changes",    // what just changed in the repo and why (changelog)
  TITLE: "title",        // opening card / nothing to show yet
});

// Minimum time a scene holds the stage (ms), cooldown before it may return in rotation, and how long
// an interrupt ("cut") may keep the stage before the show returns to the rotation.
export const RULES = Object.freeze({
  hold:     { match: 45000, wall: 20000, spotlight: 20000, moment: 12000, build: 15000, changes: 15000, title: 8000 },
  cooldown: { match: 0, wall: 30000, spotlight: 25000, moment: 0, build: 0, changes: 60000, title: 0 },
  cutMax:   { match: 90000, wall: 30000, spotlight: 30000, moment: 20000, build: 25000, changes: 20000, title: 8000 },
  rotation: ["match", "wall", "spotlight", "match", "changes", "wall", "spotlight"],
  eventTtl: 60000,      // a cue older than this is dropped unseen
  pinMs: 120000,        // "tv: wall" in the chat pins a scene this long
  hotMs: 6000,          // an agent whose last output is newer than this counts as hot
});

// Priority of each kind of interrupt. A cue cuts in when its priority beats the scene on stage
// (rotation scenes sit at 10) or when the current hold has run out.
export const PRIORITY = Object.freeze({
  joshua: 100, pin: 100, buildFlip: 95, agree: 90, newMatch: 85, decision: 75, agentDone: 65, question: 60,
  newChanges: 10, rotation: 10, title: 0, // changes never interrupt: forty agents save files every few seconds
});

const CHAT_PIN = /^\s*(?:tv|show|screen)\s*[:=]\s*(match|wall|spotlight|moment|build|changes|title)\b/i;
const AGREE = /^\s*AGREE\b/i;
const DECISION = /\b(decision|decided|final call|we will|let's go with|settled)\b/i;
const BUILD_FILE = /^(env|viewer|viewer3d|assets|players)\//;
const TEST_FILE = /\.test\.mjs$/;

function modelOf(label) { return /fable/i.test(label) ? "fable" : /sonnet/i.test(label) ? "sonnet" : /haiku/i.test(label) ? "haiku" : ""; }
function parseJsonl(text) {
  return String(text || "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// readSignals: turn one poll of raw records into a snapshot plus the cues that are new since the last snapshot.
// raw = { graph, chat (jsonl text), project, status (live/status.json or null), subtitles, threads (live/threads.json or null) }
export function readSignals(raw, prev, now) {
  const cues = [];
  const sig = { t: now, cues, agents: { running: [], hot: [], count: 0, byMachine: {} }, chat: { count: 0, last: null },
    match: { path: null, mtime: 0 }, build: { ok: null, tests: null, failures: [], t: 0, source: "none" },
    changes: { newest: null, files: [], mtime: 0 }, caption: null, pinned: prev?.pinned || null };

  // Agents, from /api/graph.
  const nodes = raw.graph?.nodes || [];
  const jobs = nodes.filter((n) => n.kind === "job" || n.kind === "subagent");
  const running = jobs.filter((n) => n.state === "running").sort((a, b) => (b.last || 0) - (a.last || 0));
  sig.agents.running = running.map((n) => ({ id: n.id, label: n.label, model: modelOf(n.label), machine: n.src?.machine || "mini", last: n.last || 0, kind: n.kind }));
  sig.agents.hot = sig.agents.running.filter((a) => now - a.last < RULES.hotMs);
  sig.agents.count = running.length;
  for (const a of sig.agents.running) sig.agents.byMachine[a.machine] = (sig.agents.byMachine[a.machine] || 0) + 1;
  if (prev?.agentStates) {
    for (const n of jobs) {
      const was = prev.agentStates[n.id];
      if (was === "running" && n.state !== "running" && n.kind === "job") {
        cues.push({ scene: SCENES.SPOTLIGHT, kind: "agentDone", priority: PRIORITY.agentDone, t: now,
          reason: `${n.label} just finished`, data: { id: n.id, label: n.label, model: modelOf(n.label), state: n.state } });
      }
    }
  }
  sig.agentStates = Object.fromEntries(jobs.map((n) => [n.id, n.state]));

  // Team chat, from /preview/rts/channel.jsonl.
  const msgs = parseJsonl(raw.chat);
  sig.chat.count = msgs.length;
  sig.chat.last = msgs[msgs.length - 1] || null;
  const seen = prev?.chat?.count ?? msgs.length; // the first poll never replays history as cues
  msgs.slice(seen).forEach((m, k) => {
    const i = seen + k, text = String(m.text || ""), from = String(m.from || "");
    const data = { i, from, text, t: m.t };
    const pin = text.match(CHAT_PIN);
    if (pin) { sig.pinned = { scene: pin[1].toLowerCase(), by: from, until: now + RULES.pinMs, i }; cues.push({ scene: sig.pinned.scene, kind: "pin", priority: PRIORITY.pin, t: now, reason: `${from} asked for ${pin[1].toUpperCase()} in the chat`, data }); return; }
    if (/^joshua$/i.test(from)) cues.push({ scene: SCENES.MOMENT, kind: "joshua", priority: PRIORITY.joshua, t: now, reason: "Joshua posted in the chat", data });
    else if (AGREE.test(text)) cues.push({ scene: SCENES.MOMENT, kind: "agree", priority: PRIORITY.agree, t: now, reason: `${from} posted an AGREE`, data });
    else if (DECISION.test(text)) cues.push({ scene: SCENES.MOMENT, kind: "decision", priority: PRIORITY.decision, t: now, reason: `${from} announced a decision`, data });
    else if (/\?/.test(text) && /\b(fable|sonnet|haiku|claude|joshua|everyone|owner|anyone)\b/i.test(text)) cues.push({ scene: SCENES.MOMENT, kind: "question", priority: PRIORITY.question, t: now, reason: `${from} asked a question`, data });
  });
  if (sig.pinned && sig.pinned.until <= now) sig.pinned = null;

  // Curated threads (live/threads.json) beat the regexes when present: any new decision/agree item becomes a cue.
  // Real shape today (live/threads.mjs): { generated, messageCount, agrees: [{ n, from, text, topic }], decisions: [...], disagreements: [...], openQuestions: [...] }.
  // Each item carries n, the chat message number, so a highlight the regexes already cued (same n) is not cued twice.
  const threads = raw.threads;
  if (threads && typeof threads === "object") {
    const lists = { agree: threads.agrees, decision: threads.decisions, question: threads.openQuestions, decision2: threads.disagreements };
    const already = new Set(cues.map((c) => c.data?.i).filter((x) => x != null));
    const seenN = prev?.threadMaxN ?? -1;
    let maxN = seenN;
    for (const [k, list] of Object.entries(lists)) {
      if (!Array.isArray(list)) continue;
      const kind = k === "decision2" ? "decision" : k;
      for (const h of list) {
        const n = Number(h.n); if (!Number.isFinite(n)) continue;
        if (n > maxN) maxN = n;
        if (n <= seenN || already.has(n) || seenN < 0) continue; // the first poll never replays history
        cues.push({ scene: SCENES.MOMENT, kind, priority: PRIORITY[kind], t: now, reason: `curator: ${h.from || "someone"} ${kind === "agree" ? "posted an AGREE" : kind === "question" ? "asked a question" : "made a decision"}${h.topic ? ` on ${h.topic}` : ""}`, data: { i: n, from: h.from, text: h.text, t: h.time, topic: h.topic } });
      }
    }
    sig.threadMaxN = maxN;
  }

  // Build status: live/status.json from the Live Build Compiler when it exists, else the newest test files as a weak signal.
  const files = raw.project?.files || [];
  // Real shape today (live/compile.mjs): { build, at, state: "green"|"red", headline, tests: { files, pass, fail }, failures: [{ file, owners, tests, error }], match: { ok, file, result } }.
  const st = raw.status;
  if (st && typeof st === "object") {
    const rawState = st.ok ?? st.green ?? st.status ?? st.state;
    const ok = rawState === true || /^(green|ok|pass|passing|good)$/i.test(String(rawState));
    const failures = st.failures || st.broken || [];
    sig.build = { ok, number: st.build ?? null, headline: st.headline || st.summary || null, tests: st.tests || null, failures,
      owners: [...new Set(failures.flatMap((f) => f.owners || (f.owner ? [f.owner] : [])))],
      t: Date.parse(st.at || st.t || st.time || 0) || 0, source: "live/status.json" };
    if (prev?.build?.ok !== null && prev?.build?.ok !== undefined && prev.build.ok !== ok) {
      cues.push({ scene: SCENES.BUILD, kind: "buildFlip", priority: PRIORITY.buildFlip, t: now, reason: ok ? "the build just went GREEN" : `the build just went RED: ${sig.build.headline || "tests failing"}`, data: sig.build });
    }
    const m = st.match;
    if (typeof m === "string") sig.build.match = m;
    else if (m && typeof m === "object" && m.file && m.ok !== false) sig.build.match = m.file;
  }

  // Freshest recorded match: live/status.json's match first, else newest matches/*.json by mtime.
  const matches = files.filter((f) => /^matches\/.*\.json$/.test(f.path)).sort((a, b) => b.mtime - a.mtime);
  if (sig.build.match) sig.match = { path: sig.build.match, mtime: files.find((f) => f.path === sig.build.match)?.mtime || sig.build.t };
  else if (matches[0]) sig.match = { path: matches[0].path, mtime: matches[0].mtime };
  if (prev && sig.match.path && sig.match.mtime > (prev.match?.mtime || 0) && prev.match?.mtime) {
    cues.push({ scene: SCENES.MATCH, kind: "newMatch", priority: PRIORITY.newMatch, t: now, reason: `a fresh match was recorded: ${sig.match.path}`, data: sig.match });
  }

  // Repo changes: newest real build files (not tests).
  const real = files.filter((f) => BUILD_FILE.test(f.path) && !TEST_FILE.test(f.path)).sort((a, b) => b.mtime - a.mtime);
  sig.changes = { newest: real[0] || null, files: real.slice(0, 8), mtime: real[0]?.mtime || 0, tests: files.filter((f) => TEST_FILE.test(f.path)).length };
  if (prev && sig.changes.mtime > (prev.changes?.mtime || 0) && prev.changes?.mtime) {
    const fresh = real.filter((f) => f.mtime > prev.changes.mtime);
    cues.push({ scene: SCENES.CHANGES, kind: "newChanges", priority: PRIORITY.newChanges, t: now, reason: `${fresh.length} build file${fresh.length === 1 ? "" : "s"} changed: ${fresh.slice(0, 3).map((f) => f.path).join(", ")}`, data: { files: fresh } });
  }

  // Latest caption (lower third). Not a scene; always shown.
  const items = raw.subtitles?.items || [];
  sig.caption = items[items.length - 1] || null;
  sig.subtitleTotal = raw.subtitles?.total || 0;
  return sig;
}

// Which scenes have something to show right now. A panel can override this through register({ ready }).
export function availability(sig, panels = {}) {
  const def = {
    match: !!sig.match?.path,
    wall: (sig.agents?.count || 0) > 0,
    spotlight: (sig.agents?.hot?.length || 0) > 0,
    moment: !!sig.chat?.last,
    build: sig.build?.ok !== null && sig.build?.ok !== undefined,
    changes: !!sig.changes?.newest,
    title: true,
  };
  for (const [name, p] of Object.entries(panels)) if (typeof p.ready === "function") { try { def[name] = !!p.ready(sig); } catch { def[name] = false; } }
  return def;
}

export function initialState(now = 0) {
  return { current: null, previous: null, queue: [], lastShown: {}, rotIndex: RULES.rotation.length - 1, history: [] };
}

// decide: the pure director. Returns the new state and, when the stage changes, the new cue (else null).
export function decide(state, sig, now, panels = {}) {
  const s = { ...state, queue: state.queue.filter((c) => now - c.t < RULES.eventTtl), lastShown: { ...state.lastShown } };
  const avail = availability(sig, panels);
  for (const c of sig.cues || []) {
    if (!(avail[c.scene] || c.data)) continue; // a cue that carries its own content is always showable
    const dup = s.queue.find((q) => q.scene === c.scene && q.kind === c.kind);
    if (dup) { dup.reason = c.reason; dup.data = c.data; dup.t = c.t; continue; } // same thing again: refresh, don't stack
    if (c.priority <= PRIORITY.rotation && now - (s.lastShown[c.scene] || 0) < RULES.cooldown[c.scene]) continue; // soft cues respect cooldown
    s.queue.push(c);
  }
  s.queue.sort((a, b) => b.priority - a.priority || a.t - b.t);

  const cur = s.current;
  const holdOver = !cur || now >= cur.until;
  const cutOver = cur && cur.cut && now >= cur.since + RULES.cutMax[cur.scene];
  const pinned = sig.pinned && sig.pinned.until > now ? sig.pinned : null;

  let next = null;
  // 1. A pinned scene stays unless Joshua himself posts.
  if (pinned && (!cur || cur.scene !== pinned.scene || cutOver)) {
    const j = s.queue.find((c) => c.kind === "joshua");
    if (j && (!cur || cur.kind !== "joshua")) { next = j; s.queue = s.queue.filter((c) => c !== j); }
    else if (!cur || cur.scene !== pinned.scene) next = { scene: pinned.scene, kind: "pin", priority: PRIORITY.pin, t: now, reason: `${pinned.by} pinned ${pinned.scene.toUpperCase()}`, data: pinned };
  } else if (pinned) {
    // keep the pin on stage; refresh its hold so rotation never steals it
    if (cur && cur.scene === pinned.scene) s.current = { ...cur, until: Math.max(cur.until, pinned.until) };
  }
  // 2. The strongest waiting cue cuts in if it beats the stage or the stage's hold is over.
  if (!next && s.queue.length && !pinned) {
    const top = s.queue[0];
    const stagePri = cur ? cur.priority : -1;
    const sameScene = cur && cur.scene === top.scene;
    if (holdOver || cutOver || top.priority > stagePri || (sameScene && top.priority >= stagePri)) {
      next = top; s.queue = s.queue.filter((c) => c !== top);
      if (sameScene && !holdOver && top.priority <= stagePri && top.kind === cur.kind) { next = null; } // same thing again: just extend, no re-cut
    }
  }
  // 3. After an interrupt, return to the rotation (or the scene it interrupted).
  if (!next && cur && cur.cut && cutOver && !pinned) {
    const back = s.previous && !s.previous.cut && avail[s.previous.scene] ? s.previous.scene : null;
    next = back ? { scene: back, kind: "rotation", priority: PRIORITY.rotation, t: now, reason: `back to ${back.toUpperCase()} after ${cur.reason}` } : null;
    if (!next) { const r = pickRotation(s, avail, now, cur.scene); if (r) next = r; }
  }
  // 4. Normal rotation when the hold has run out.
  if (!next && (holdOver || !cur) && !pinned) {
    const r = pickRotation(s, avail, now, cur?.scene);
    if (r && (!cur || r.scene !== cur.scene)) next = r;
    else if (!cur) next = { scene: SCENES.TITLE, kind: "title", priority: PRIORITY.title, t: now, reason: "nothing to show yet" };
  }
  if (!next) return { state: s, cue: null };

  const isCut = next.priority > PRIORITY.rotation;
  const cue = { ...next, since: now, until: now + RULES.hold[next.scene], cut: isCut, from: cur?.scene || null };
  // same scene re-cut (e.g. a second AGREE while a MOMENT is up): refresh the hold and tell the panel, but keep since of the stage
  s.previous = cur && cur.scene !== cue.scene ? cur : s.previous;
  s.current = cue;
  s.lastShown[cue.scene] = now;
  s.history = [...s.history.slice(-49), cue];
  return { state: s, cue };
}

function pickRotation(s, avail, now, currentScene) {
  const rot = RULES.rotation;
  for (let k = 1; k <= rot.length; k++) {
    const idx = (s.rotIndex + k) % rot.length, scene = rot[idx];
    if (!avail[scene]) continue;
    if (scene === currentScene) continue;
    const last = s.lastShown[scene] || 0;
    if (now - last < RULES.cooldown[scene]) continue;
    s.rotIndex = idx;
    return { scene, kind: "rotation", priority: PRIORITY.rotation, t: now, reason: `rotation: ${scene.toUpperCase()}` };
  }
  return null;
}

// What to show at a glance for each scene, so a panel or a caption can describe the stage in plain English.
export function describe(cue, sig) {
  if (!cue) return "Driftfall · waiting for the swarm";
  const a = sig?.agents?.count || 0;
  switch (cue.scene) {
    case "match": return `LIVE MATCH · ${sig?.match?.path || "no match yet"}${sig?.build?.number != null ? ` · build ${sig.build.number}` : ""}${sig?.build?.ok === false ? " · tests RED" : sig?.build?.ok ? " · tests GREEN" : ""}`;
    case "wall": return `THE SWARM · ${a} agent${a === 1 ? "" : "s"} working${sig?.agents?.hot?.length ? ` · ${sig.agents.hot.length} active this second` : ""}`;
    case "spotlight": return `SPOTLIGHT · ${cue.data?.label || sig?.agents?.hot?.[0]?.label || "an agent at work"}`;
    case "moment": return `MOMENT · ${cue.reason}`;
    case "build": return `BUILD · ${sig?.build?.ok ? "GREEN" : "RED"}${sig?.build?.tests ? ` · ${JSON.stringify(sig.build.tests)}` : ""}`;
    case "changes": return `CHANGES · ${cue.reason}`;
    default: return "DRIFTFALL · built live by the swarm";
  }
}

// sceneRecord: what the director publishes to live/scene.json for pages that read a file instead of importing this module
// (live/app.mjs reads { scene, agent, title }; the rest is extra). focus = which panel should be big: stage | wall | chat | status.
export function sceneRecord(cue, sig, now = Date.now()) {
  const focus = { match: "stage", wall: "wall", spotlight: "wall", moment: "chat", build: "status", changes: "status", title: "stage" };
  const hot = sig?.agents?.hot?.[0] || sig?.agents?.running?.[0] || null;
  const agent = cue?.scene === "spotlight" ? (cue.data?.id || hot?.id || null) : null;
  return {
    t: new Date(now).toISOString(), scene: cue?.scene || "default", focus: focus[cue?.scene] || "stage", kind: cue?.kind || null, priority: cue?.priority ?? 0,
    title: describe(cue, sig), reason: cue?.reason || null, agent, agentLabel: agent ? (cue.data?.label || hot?.label || null) : null,
    since: cue?.since ? new Date(cue.since).toISOString() : null, until: cue?.until ? new Date(cue.until).toISOString() : null, cut: !!cue?.cut,
    message: cue?.scene === "moment" && cue.data?.text ? { from: cue.data.from, text: cue.data.text, i: cue.data.i ?? null } : null,
    match: sig?.match?.path || null, build: sig?.build?.ok == null ? null : (sig.build.ok ? "green" : "red"), buildHeadline: sig?.build?.headline || null,
    agents: sig?.agents?.count || 0, pinned: sig?.pinned ? { scene: sig.pinned.scene, by: sig.pinned.by, until: new Date(sig.pinned.until).toISOString() } : null,
  };
}

// createShow: the live director. Polls the Control Room, runs the rules, drives the registered panels.
export function createShow(opts = {}) {
  const origin = opts.origin ?? "";
  const fetchFn = opts.fetch ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const clock = opts.now ?? (() => Date.now());
  const panels = {}, listeners = { scene: [], signals: [], error: [] };
  let state = initialState(clock()), sig = null, timer = null, polling = false, manual = [];
  const emit = (ev, ...a) => { for (const f of listeners[ev] || []) { try { f(...a); } catch (e) { if (ev !== "error") emit("error", e); } } };

  async function getJson(p) { const r = await fetchFn(origin + p, { cache: "no-store" }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); }
  async function getText(p) { const r = await fetchFn(origin + p, { cache: "no-store" }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.text(); }
  const quiet = (pr) => pr.catch(() => null);

  async function poll() {
    if (!fetchFn) throw new Error("no fetch available");
    const v = "?v=" + clock();
    const [graph, chat, project, status, subtitles, threads] = await Promise.all([
      quiet(getJson("/api/graph")), quiet(getText("/preview/rts/channel.jsonl" + v)), quiet(getJson("/api/project?p=rts")),
      quiet(getJson("/preview/rts/live/status.json" + v)), quiet(getJson("/api/subtitles?since=" + Math.max(0, (sig?.subtitleTotal || 1) - 1))),
      quiet(getJson("/preview/rts/live/threads.json" + v)),
    ]);
    return { graph, chat, project, status, subtitles, threads };
  }

  function step(raw, now = clock()) {
    sig = readSignals(raw, sig, now);
    if (manual.length) { sig.cues.push(...manual); manual = []; }
    emit("signals", sig);
    const before = state.current;
    const r = decide(state, sig, now, panels);
    state = r.state;
    if (r.cue) switchTo(r.cue, before);
    else for (const p of Object.values(panels)) if (p.name === state.current?.scene && p.update) { try { p.update(sig, state.current); } catch (e) { emit("error", e); } }
    return r.cue;
  }

  function switchTo(cue, before) {
    const prev = before && panels[before.scene];
    if (prev && before.scene !== cue.scene && prev.leave) { try { prev.leave(cue); } catch (e) { emit("error", e); } }
    const p = panels[cue.scene];
    if (p && p.enter) { try { p.enter(cue, sig); } catch (e) { emit("error", e); } }
    emit("scene", cue, sig);
    if (typeof window !== "undefined" && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("show:scene", { detail: { cue, describe: describe(cue, sig) } }));
  }

  async function tick() {
    if (polling) return; polling = true;
    try { step(await poll()); } catch (e) { emit("error", e); } finally { polling = false; }
  }

  const show = {
    SCENES, RULES, PRIORITY,
    register(panel) { if (!panel?.name) throw new Error("panel needs a name"); panels[panel.name] = panel; return show; },
    on(ev, f) { (listeners[ev] ||= []).push(f); return show; },
    cue(scene, reason = "manual cue", holdMs = RULES.hold[scene] || 15000, data = null) {
      manual.push({ scene, kind: "pin", priority: PRIORITY.pin, t: clock(), reason, data, hold: holdMs });
      if (sig) { sig.pinned = { scene, by: "operator", until: clock() + holdMs }; }
      return show;
    },
    unpin() { if (sig) sig.pinned = null; return show; },
    start(intervalMs = 1500) { if (!timer) { tick(); timer = setInterval(tick, intervalMs); } return show; },
    stop() { if (timer) clearInterval(timer); timer = null; return show; },
    step, poll, tick,
    current: () => state.current, signals: () => sig, history: () => state.history.slice(), queue: () => state.queue.slice(),
    describe: () => describe(state.current, sig),
  };
  if (typeof window !== "undefined") window.DriftfallShow = show;
  return show;
}

// ---------------------------------------------------------------------------------------------------
// node: self-test and dry run
const isMain = typeof process !== "undefined" && process.argv?.[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const args = process.argv.slice(2);
  const origin = args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "http://localhost:4477";
  if (args.includes("--selftest")) selfTest();
  else if (args.includes("--run")) runDirector(origin, args.includes("--seconds") ? Number(args[args.indexOf("--seconds") + 1]) : 0);
  else dryRun(Number(args[args.indexOf("--seconds") + 1]) || 30, origin);
}

// node live/show.mjs --run [--seconds N]: the real director. Polls the Control Room every 1.5 s, runs the rules,
// writes live/scene.json on every change (and at least every 5 s so readers can tell it is alive), logs every cut.
async function runDirector(origin, seconds) {
  const fs = await import("node:fs");
  const out = new URL("./scene.json", import.meta.url);
  const show = createShow({ origin });
  let lastWrite = 0;
  const write = (cue, s) => { const rec = sceneRecord(cue, s); rec.director = "live/show.mjs"; fs.writeFileSync(out, JSON.stringify(rec, null, 1) + "\n"); lastWrite = Date.now(); };
  show.on("scene", (cue, s) => { write(cue, s); console.log(`[${new Date().toISOString().slice(11, 19)}] ${cue.cut ? "CUT" : "   "} → ${cue.scene.toUpperCase()} (${cue.kind}) · ${cue.reason}`); });
  show.on("signals", (s) => { if (Date.now() - lastWrite > 5000 && show.current()) write(show.current(), s); });
  show.on("error", (e) => console.log("error:", e.message));
  show.start(1500);
  console.log(`show director running against ${origin}, writing ${out.pathname}`);
  if (seconds) { await new Promise((r) => setTimeout(r, seconds * 1000)); show.stop(); console.log("stopped"); }
}

function selfTest() {
  let fails = 0;
  const check = (name, ok) => { console.log(`${ok ? "ok " : "FAIL"} ${name}`); if (!ok) fails++; };
  const files = (extra = []) => ({ files: [{ path: "matches/sample-7.json", mtime: 1000 }, { path: "viewer/art.mjs", mtime: 900 }, { path: "tests/a.test.mjs", mtime: 10 }, ...extra] });
  const graph = (n = 3, hot = true, t = 0) => ({ nodes: Array.from({ length: n }, (_, i) => ({ id: "job:" + i, kind: "job", state: "running", label: `Live View · role ${i} (${["fable", "sonnet", "haiku"][i % 3]})`, last: hot ? t : t - 60000, src: { machine: i % 2 ? "air" : "mini" } })) });
  const chat = (ms) => ms.map((m) => JSON.stringify({ t: "2026-10-22T18:00:00Z", ...m })).join("\n");
  let now = 100000, sig = null, state = initialState(now), cuts = [];
  const run = (raw, dt = 0) => { now += dt; sig = readSignals(raw, sig, now); const r = decide(state, sig, now); state = r.state; if (r.cue) cuts.push(r.cue); return r.cue; };

  let c = run({ graph: graph(3, true, now), chat: chat([{ from: "sonnet", text: "hello" }]), project: files(), status: null, subtitles: { total: 1, items: [{ text: "cap" }] } });
  check("opens on MATCH when a match file exists", c?.scene === "match" && c.kind === "rotation");
  c = run({ graph: graph(3, true, now + 5000), chat: chat([{ from: "sonnet", text: "hello" }]), project: files(), status: null }, 5000);
  check("holds MATCH inside its 45 s hold", c === null && state.current.scene === "match");
  c = run({ graph: graph(3, true, now + 1000), chat: chat([{ from: "sonnet", text: "hello" }, { from: "haiku", text: "AGREE: plan v3" }]), project: files(), status: null }, 1000);
  check("an AGREE cuts into MATCH as a MOMENT", c?.scene === "moment" && c.kind === "agree" && c.cut);
  c = run({ graph: graph(3, true, now + 1000), chat: chat([{ from: "sonnet", text: "hello" }, { from: "haiku", text: "AGREE: plan v3" }, { from: "sonnet", text: "fable, which cell size do you want?" }]), project: files(), status: null }, 1000);
  check("a question does not out-rank the AGREE on stage", c === null && state.queue.some((q) => q.kind === "question"));
  c = run({ graph: graph(3, true, now + 1000), chat: chat([{ from: "sonnet", text: "hello" }, { from: "haiku", text: "AGREE: plan v3" }, { from: "sonnet", text: "fable, which cell size do you want?" }, { from: "joshua", text: "looks great" }]), project: files(), status: null }, 1000);
  check("Joshua posting cuts in over everything", c?.scene === "moment" && c.kind === "joshua");
  c = run({ graph: graph(3, true, now + 21000), chat: chat([{ from: "sonnet", text: "hello" }, { from: "haiku", text: "AGREE: plan v3" }, { from: "sonnet", text: "fable, which cell size do you want?" }, { from: "joshua", text: "looks great" }]), project: files(), status: null }, 21000);
  check("after the MOMENT cut runs out, the queued question shows (hold over, higher than rotation)", c?.scene === "moment" && c.kind === "question");
  c = run({ graph: graph(3, true, now + 21000), chat: "", project: files(), status: null }, 21000);
  check("then it returns to MATCH, the scene it interrupted", c?.scene === "match" && /back to MATCH/.test(c.reason));
  c = run({ graph: graph(3, true, now + 1000), chat: "", project: files(), status: { ok: true, t: "2026-10-22T18:01:00Z", tests: { passed: 120, failed: 0 } } }, 1000);
  check("first sight of status.json is not a flip", c === null);
  c = run({ graph: graph(3, true, now + 1000), chat: "", project: files(), status: { ok: false, t: "2026-10-22T18:02:00Z", failures: [{ name: "x", owner: "haiku" }] } }, 1000);
  check("build going RED cuts in as BUILD", c?.scene === "build" && /RED/.test(c.reason));
  c = run({ graph: graph(3, true, now + 1000), chat: "", project: files([{ path: "matches/latest-3.json", mtime: 5000 }]), status: { ok: false, t: "2026-10-22T18:02:00Z" } }, 1000);
  check("a fresh match file queues but does not beat BUILD (95 > 85)", c === null && state.queue.some((q) => q.kind === "newMatch"));
  c = run({ graph: graph(3, true, now + 16000), chat: "", project: files([{ path: "matches/latest-3.json", mtime: 5000 }]), status: { ok: false, t: "2026-10-22T18:02:00Z" } }, 16000);
  check("when BUILD's hold ends the fresh match plays", c?.scene === "match" && c.kind === "newMatch" && c.data.path === "matches/latest-3.json");
  c = run({ graph: graph(3, true, now + 1000), chat: chat([{ from: "haiku", text: "tv: wall" }]), project: files([{ path: "matches/latest-3.json", mtime: 5000 }]), status: { ok: false, t: "2026-10-22T18:02:00Z" } }, 1000);
  check("'tv: wall' in the chat pins the WALL", c?.scene === "wall" && c.kind === "pin" && sig.pinned?.scene === "wall");
  c = run({ graph: graph(3, true, now + 60000), chat: chat([{ from: "haiku", text: "tv: wall" }]), project: files([{ path: "matches/latest-3.json", mtime: 5000 }]), status: { ok: false, t: "2026-10-22T18:02:00Z" } }, 60000);
  check("the pin outlasts the normal WALL hold", c === null && state.current.scene === "wall");
  c = run({ graph: graph(3, true, now + 70000), chat: chat([{ from: "haiku", text: "tv: wall" }]), project: files([{ path: "matches/latest-3.json", mtime: 5000 }]), status: { ok: false, t: "2026-10-22T18:02:00Z" } }, 70000);
  check("after the pin expires rotation resumes", c && c.scene !== "wall" && c.kind === "rotation");
  // rotation never flickers: step 200 times at 1.5 s with no events, every scene holds at least its minimum
  let bad = 0, lastCue = state.current, tStart = now;
  for (let i = 0; i < 200; i++) { const cc = run({ graph: graph(3, true, now + 1500), chat: "", project: files([{ path: "matches/latest-3.json", mtime: 5000 }]), status: { ok: false, t: "x" } }, 1500); if (cc) { if (cc.since - lastCue.since < RULES.hold[lastCue.scene]) bad++; lastCue = cc; } }
  check("rotation respects every minimum hold over 5 minutes", bad === 0);
  const scenesSeen = new Set(cuts.filter((x) => x.since > tStart).map((x) => x.scene));
  check("rotation visits match, wall and spotlight", ["match", "wall", "spotlight"].every((x) => scenesSeen.has(x)));
  c = run({ graph: { nodes: [{ id: "job:0", kind: "job", state: "done", label: "Live View · role 0 (fable)", last: now, src: {} }] }, chat: "", project: files(), status: { ok: true, t: "x" } }, 1500);
  check("an agent finishing queues a SPOTLIGHT cue", c?.kind === "agentDone" || state.queue.some((q) => q.kind === "agentDone"));
  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed"); process.exitCode = fails ? 1 : 0;
}

async function dryRun(seconds, origin) {
  const show = createShow({ origin });
  show.on("scene", (cue, s) => console.log(`[${new Date().toISOString().slice(11, 19)}] CUT → ${cue.scene.toUpperCase()} (${cue.kind}, p${cue.priority}) · ${cue.reason}\n           ${describe(cue, s)}`));
  show.on("error", (e) => console.log("error:", e.message));
  const t0 = Date.now();
  show.start(1500);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  show.stop();
  const s = show.signals();
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s watched · ${s?.agents.count} agents running (${JSON.stringify(s?.agents.byMachine)}) · ${s?.chat.count} chat messages · match: ${s?.match.path} · build: ${s?.build.source} ${s?.build.ok} · newest change: ${s?.changes.newest?.path}`);
  console.log(`queue now: ${show.queue().map((q) => q.kind).join(", ") || "empty"} · history: ${show.history().map((h) => h.scene).join(" → ")}`);
}
