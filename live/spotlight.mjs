// live/spotlight.mjs — Agent Spotlight panel for the Driftfall live view. Owner: fable (Agent Spotlight Operator).
//
// Picks the 3–4 most interesting agents right now and shows them large with their live output.
// Everything shown comes from the Control Room's records at the same origin:
//   /api/graph                      every agent and its state
//   /api/feed?id=<node id>          an agent's last output lines
//   /api/subtitles?since=N          plain-English captions (each names the agent it describes)
//   /preview/rts/channel.jsonl      the team chat
//
// Embed:   import { mountSpotlight } from "./spotlight.mjs"; const sp = mountSpotlight(el, { count: 4 }); sp.stop();
// Or:      <div data-spotlight data-count="4"></div>  (mounts itself when the module loads)
//
// Pure parts (classifyLine, extractChatPosts, describeWork, scoreAgent, pickSpotlight, renderCard) take plain data
// and return plain data or HTML strings, so they run under node tests with no DOM.

export const DEFAULTS = {
  count: 4,          // cards on screen (3 or 4)
  interval: 2000,    // ms between polls
  holdMs: 20000,     // a picked agent stays at least this long
  swapMargin: 25,    // a newcomer must beat the weakest card by this much to replace it
  staleMs: 240000,   // a card shown this long with no fresh signal gets gently rotated out
  lines: 14,         // output lines per card
  feedBudget: 10,    // feeds fetched per poll (picks first, then the agents we looked at longest ago)
  base: "",          // prefix for fetches (same origin by default)
  chatPath: "/preview/rts/channel.jsonl",
};

export const COLORS = {
  fable: "#e9a3ff", sonnet: "#d4a27f", haiku: "#4cc2ff", claude: "#ffb547", joshua: "#58c98a",
  ok: "#58c98a", bad: "#ff6b6b", warn: "#ffb547", dim: "#7d8590", text: "#e6e8eb",
};

// ---------- line classification ----------

const TEST_PASS = /✔|\bpassing\b|\ball tests? pass|\b[1-9]\d* passed\b|\btests? pass(ed)?\b/i;
const TEST_FAIL = /✖|\bFAIL(ED|ING)?\b|AssertionError|\b[1-9]\d* failed\b|\btests? fail(ed)?\b/;
/** node:test summary: "# pass N ... # fail M" → true/false, or null when there is no summary. */
function testSummaryOk(body) {
  const fail = /(^|\s)# fail (\d+)/.exec(body), pass = /(^|\s)# pass (\d+)/.exec(body);
  if (!fail && !pass) return null;
  return !(fail && Number(fail[2]) > 0);
}
const ERRORISH = /\bError\b|\bTypeError\b|\bReferenceError\b|\bSyntaxError\b|Cannot find module|ENOENT|Exit code [1-9]|\bthrew\b/;

/** Classify one feed line. Returns { kind, tool, file, text, chat } where kind is one of
 *  say | tool | result | denied | test-pass | test-fail | error | plain, and chat is set when the line is a say.mjs post. */
export function classifyLine(raw) {
  const text = String(raw ?? "");
  const t = text.trimStart();
  if (t.startsWith("claude:")) return { kind: "say", text: t.slice(7).trim(), tool: null, file: null, chat: null };
  if (t.startsWith("✗")) return { kind: "denied", text: t.slice(1).trim(), tool: null, file: null, chat: null };
  if (t.startsWith("→")) {
    const m = /^→\s*(\w+)\s*(\{[\s\S]*\})?\s*$/.exec(t);
    const tool = m ? m[1] : "";
    let args = null;
    if (m && m[2]) { try { args = JSON.parse(m[2]); } catch { args = null; } }
    const file = args?.file_path ? shortPath(args.file_path) : null;
    let chat = null;
    const cmd = args?.command ?? (m && m[2] && !args ? m[2] : "");
    if (tool === "Bash" && /say\.mjs/.test(cmd || "")) chat = parseSay(cmd);
    const desc = args?.description || (file ? `${tool} ${file}` : tool);
    return { kind: "tool", tool, file, text: desc, chat, command: args?.command ?? null };
  }
  if (t.startsWith("↳")) {
    const body = t.slice(1).trim();
    const summary = testSummaryOk(body);
    const fail = summary === false || (summary === null && TEST_FAIL.test(body));
    const pass = summary === true || (summary === null && TEST_PASS.test(body));
    if (fail) return { kind: "test-fail", text: body, tool: null, file: null, chat: null };
    if (pass) return { kind: "test-pass", text: body, tool: null, file: null, chat: null };
    if (ERRORISH.test(body)) return { kind: "error", text: body, tool: null, file: null, chat: null };
    return { kind: "result", text: body, tool: null, file: null, chat: null };
  }
  if (t.startsWith("[started]")) return { kind: "plain", text: t, tool: null, file: null, chat: null, started: true };
  return { kind: "plain", text: t, tool: null, file: null, chat: null };
}

/** Pull the sender and message out of a `node say.mjs <from> "..."` command (first post only). */
export function parseSay(cmd) {
  const m = /say\.mjs\s+(fable|sonnet|haiku|claude)\s+(["'])([\s\S]*?)\2(?:\s*(?:&&|;|\||$))/.exec(String(cmd));
  if (!m) return null;
  return { from: m[1], text: m[3].replace(/\\(["'])/g, "$1").replace(/\\n/g, " ").replace(/\s+/g, " ").trim() };
}

/** Every chat post an agent has made, in feed order. */
export function extractChatPosts(lines) {
  const out = [];
  for (const l of lines) { const c = classifyLine(l.text ?? l); if (c.chat) out.push(c.chat); }
  return out;
}

export function shortPath(p) {
  const s = String(p).replace(/^\/Users\/[^/]+\/dev\/rts\//, "").replace(/^\/Users\/[^/]+\//, "~/");
  return s;
}

// ---------- chat tone ----------

const AGREE = /\bAGREE\b/;
const DISAGREE = /\bdisagree|\bpush ?back|\bI'?d rather\b|\bobject(ion)?\b|\binstead of\b|\bnot (?:right|correct|what)\b|\bwrong\b|\bcounter-?proposal|\bI don'?t think\b|\bbut (?:I|we) (?:think|should|need)|\bno[,:] /i;
const QUESTION = /\?\s*$|\?\s/;

/** 'agree' | 'disagree' | 'question' | 'status' for one chat message. */
export function chatTone(text) {
  const s = String(text || "");
  if (AGREE.test(s)) return "agree";
  if (DISAGREE.test(s)) return "disagree";
  if (QUESTION.test(s)) return "question";
  return "status";
}

// ---------- labels ----------

export function parseLabel(label) {
  const s = String(label || "");
  const machine = /MacBook Air/i.test(s) ? "MacBook Air" : "mini";
  const model = (/\((fable|sonnet|haiku|claude)\)/i.exec(s)?.[1] || /\b(fable|sonnet|haiku)\b/i.exec(s)?.[1] || "").toLowerCase();
  const core = s.replace(/\s*·\s*MacBook Air.*$/i, "").trim();
  const parts = core.split("·").map((x) => x.trim()).filter(Boolean);
  const team = parts.length > 1 ? parts[0] : "";
  const role = (parts.length > 1 ? parts.slice(1).join(" · ") : core).replace(/\s*\((fable|sonnet|haiku|claude)\)\s*$/i, "").trim();
  return { team, role, model, machine, core };
}

// ---------- what the agent is doing ----------

/** Plain-English "working on" line plus the last file and tool, from the agent's feed (newest last). */
export function describeWork(lines, caption) {
  let doing = "", file = null, tool = null, lastFile = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const c = classifyLine(lines[i].text ?? lines[i]);
    if (!doing && c.kind === "say") doing = c.text;
    if (!tool && c.kind === "tool") { tool = c.tool; if (c.file) file = c.file; }
    if (!lastFile && c.kind === "tool" && c.file && /^(Write|Edit|NotebookEdit)$/.test(c.tool)) lastFile = c.file;
    if (doing && tool && lastFile) break;
  }
  const text = doing || caption || (lastFile ? `Editing ${lastFile}` : tool ? `Running ${tool}` : "Thinking…");
  return { doing: text, file: lastFile || file, tool, caption: caption || "" };
}

// ---------- scoring ----------

const SIGNALS = {
  "test-fail": { w: 70, tag: "TEST FAILED", tone: "bad" },
  "test-pass": { w: 60, tag: "TESTS PASS", tone: "ok" },
  disagree: { w: 85, tag: "DISAGREEMENT", tone: "warn" },
  agree: { w: 65, tag: "AGREE", tone: "ok" },
  question: { w: 45, tag: "ASKING THE TEAM", tone: "info" },
  said: { w: 50, tag: "SAID IN CHAT", tone: "info" },
  wrote: { w: 40, tag: "WROTE", tone: "info" },
  error: { w: 30, tag: "HIT AN ERROR", tone: "bad" },
  denied: { w: 20, tag: "BLOCKED", tone: "warn" },
  addressed: { w: 35, tag: "BEING ASKED", tone: "info" },
  fresh: { w: 30, tag: "LIVE", tone: "info" },
  started: { w: 25, tag: "JUST STARTED", tone: "info" },
};

/** Score one agent. `lines` are its feed lines newest last, each with `.text` and `.age` (seconds since first seen).
 *  `chat` is recent team chat [{from,text,age}], `now` ms. Returns { score, tag, tone, reasons[] }. */
export function scoreAgent(node, lines, { now = Date.now(), chat = [], halfLifeS = 40 } = {}) {
  const decay = (ageS) => Math.exp(-Math.max(0, ageS) * Math.LN2 / halfLifeS);
  const reasons = [];
  const add = (key, ageS, detail) => { const s = SIGNALS[key]; const v = s.w * decay(ageS); reasons.push({ key, tag: s.tag, tone: s.tone, v, detail }); };

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
    const l = lines[i]; const age = l.age ?? 999; if (age > 240) continue;
    const c = classifyLine(l.text);
    if (c.kind === "test-pass" || c.kind === "test-fail" || c.kind === "error" || c.kind === "denied") add(c.kind, age, c.text.slice(0, 80));
    else if (c.kind === "tool" && c.chat) { const tone = chatTone(c.chat.text); add(tone === "status" ? "said" : tone, age, c.chat.text.slice(0, 120)); }
    else if (c.kind === "tool" && c.file && /^(Write|Edit|NotebookEdit)$/.test(c.tool)) add("wrote", age, c.file);
    else if (c.started) add("started", age, "");
  }
  // output freshness from the graph's own clock
  const sinceOut = (now - (node.last || 0)) / 1000;
  if (sinceOut < 60) add("fresh", sinceOut, "");
  // being talked to: a chat line in the last 3 minutes that names this agent's model and a word from its role
  const { model, role } = parseLabel(node.label);
  const words = role.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !/^(live|view|team|the|and|for)$/.test(w));
  for (const m of chat) {
    if ((m.age ?? 999) > 180 || m.from === model) continue;
    const t = m.text.toLowerCase();
    if (model && t.includes(model) && words.some((w) => t.includes(w))) { add("addressed", m.age, m.text.slice(0, 120)); break; }
  }
  reasons.sort((a, b) => b.v - a.v);
  const score = reasons.reduce((s, r) => s + r.v, 0);
  const top = reasons[0];
  return { score, tag: top ? top.tag : "WORKING", tone: top ? top.tone : "info", reasons };
}

/** Choose which ids to show. `scored` is [{id, score}], `prev` is [{id, since, lastSignal}] from the last pick.
 *  Holds each shown agent for holdMs, and only swaps when the newcomer beats the weakest by swapMargin. */
export function pickSpotlight(scored, prev = [], { count = 4, holdMs = 20000, swapMargin = 25, now = Date.now(), staleMs = 240000, pinned = [] } = {}) {
  const byId = new Map(scored.map((s) => [s.id, s]));
  let kept = prev.filter((p) => byId.has(p.id)).map((p) => ({ ...p, score: byId.get(p.id).score }));
  // pinned agents (the show director asked for them) go in now, replacing the weakest unpinned card if needed
  for (const id of pinned) {
    if (!byId.has(id) || kept.some((k) => k.id === id)) continue;
    if (kept.length >= count) { const victim = kept.filter((k) => !pinned.includes(k.id)).sort((a, b) => a.score - b.score)[0]; if (!victim) continue; kept = kept.filter((k) => k !== victim); }
    kept.push({ id, since: now, score: byId.get(id).score + 1000 });
  }
  for (const k of kept) if (pinned.includes(k.id)) k.score = byId.get(k.id).score + 1000; // never swapped out while pinned
  // stale cards (shown a long time without any fresh signal) lose their hold and a chunk of score
  for (const k of kept) if (now - k.since > staleMs && byId.get(k.id).score < 20) k.score -= 50;
  const free = scored.filter((s) => !kept.some((k) => k.id === s.id)).sort((a, b) => b.score - a.score);
  // fill empty slots first
  while (kept.length < count && free.length) { const s = free.shift(); kept.push({ id: s.id, since: now, score: s.score }); }
  // then consider swaps for cards past their hold
  for (const cand of free) {
    const swappable = kept.filter((k) => now - k.since >= holdMs).sort((a, b) => a.score - b.score);
    const weakest = swappable[0];
    if (!weakest || cand.score < weakest.score + swapMargin) break;
    kept = kept.filter((k) => k !== weakest); kept.push({ id: cand.id, since: now, score: cand.score });
  }
  // keep screen order stable: existing cards keep their slot, newcomers take freed slots
  const order = prev.map((p) => p.id);
  const slots = order.map((id) => kept.find((k) => k.id === id) || null);
  const newcomers = kept.filter((k) => !order.includes(k.id));
  for (let i = 0; i < slots.length && newcomers.length; i++) if (!slots[i]) slots[i] = newcomers.shift();
  return [...slots.filter(Boolean), ...newcomers].slice(0, count);
}

// ---------- rendering ----------

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const TONE_COLOR = { ok: COLORS.ok, bad: COLORS.bad, warn: COLORS.warn, info: COLORS.haiku };

/** HTML for one card. view = { id, label, machine, model, team, role, tag, tone, doing, caption, file, lines:[{text,age}], since, last, hot, reasons } */
export function renderCard(view, { lines = 14, now = Date.now() } = {}) {
  const color = COLORS[view.model] || "#ccc";
  const tone = TONE_COLOR[view.tone] || TONE_COLOR.info;
  const tail = view.lines.slice(-lines);
  const rows = tail.map((l) => {
    const c = classifyLine(l.text);
    const fresh = (l.age ?? 999) < 6 ? " sp-new" : "";
    let cls = "sp-l", body = c.text;
    if (c.kind === "say") { cls += " sp-say"; }
    else if (c.kind === "tool") { cls += " sp-tool"; body = c.chat ? `says in chat: ${c.chat.text}` : (c.file ? `${c.tool} ${c.file}` : (c.command ? `$ ${c.command}` : c.text)); if (c.chat) cls += " sp-chat"; }
    else if (c.kind === "test-pass") cls += " sp-ok";
    else if (c.kind === "test-fail" || c.kind === "error") cls += " sp-bad";
    else if (c.kind === "denied") cls += " sp-warn";
    else if (c.kind === "result") cls += " sp-res";
    return `<div class="${cls}${fresh}">${esc(body)}</div>`;
  }).join("");
  const ago = view.last ? fmtAgo(now - view.last) : "";
  const secondary = view.caption && view.caption !== view.doing ? `<div class="sp-cap">${esc(view.caption)}</div>` : "";
  return `<header class="sp-head" style="--c:${color}">
    <span class="sp-dot${view.hot ? " sp-hot" : ""}"></span>
    <div class="sp-who"><b>${esc(view.role)}</b><small>${esc([view.team, view.model, view.machine].filter(Boolean).join(" · "))}</small></div>
    <span class="sp-tag" style="--t:${tone}">${esc(view.tag)}</span>
  </header>
  <div class="sp-doing">${esc(view.doing)}</div>${secondary}
  <div class="sp-feed">${rows || '<div class="sp-l sp-res">waiting for output…</div>'}</div>
  <footer class="sp-foot"><span>${esc(view.file ? "last file: " + view.file : "")}</span><span class="sp-ago">${esc(ago)}</span></footer>`;
}

export function fmtAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 2) return "just now"; if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export const CSS = `
.sp-root{container-type:size;display:grid;gap:8px;padding:8px;height:100%;width:100%;box-sizing:border-box;min-height:0;min-width:0;
  background:var(--sp-bg,transparent);color:#e6e8eb;font-family:ui-sans-serif,-apple-system,"SF Pro Text",system-ui,sans-serif}
.sp-root[data-count="1"]{grid-template-columns:1fr}
.sp-root[data-count="2"]{grid-template-columns:1fr 1fr}
.sp-root[data-count="3"]{grid-template-columns:1fr 1fr 1fr}
.sp-root[data-count="4"]{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
@container (aspect-ratio < 1.2){.sp-root[data-count="3"]{grid-template-columns:1fr;grid-template-rows:1fr 1fr 1fr}
  .sp-root[data-count="4"]{grid-template-columns:1fr;grid-template-rows:repeat(4,1fr)}}
@container (aspect-ratio > 3.2){.sp-root[data-count="4"]{grid-template-columns:repeat(4,1fr);grid-template-rows:1fr}}
.sp-card{position:relative;display:flex;flex-direction:column;min-height:0;min-width:0;background:#0b0e13;border:1px solid #1d232c;border-radius:10px;
  overflow:hidden;animation:sp-in .45s ease-out;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
.sp-card.sp-leaving{animation:sp-out .3s ease-in forwards}
@keyframes sp-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes sp-out{to{opacity:0;transform:scale(.97)}}
.sp-head{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #1d232c;background:linear-gradient(90deg,color-mix(in srgb,var(--c) 14%,#0b0e13),#0b0e13 70%)}
.sp-dot{width:12px;height:12px;border-radius:50%;background:var(--c);box-shadow:0 0 8px var(--c);flex:none}
.sp-dot.sp-hot{animation:sp-pulse 1s ease-in-out infinite}
@keyframes sp-pulse{0%,100%{box-shadow:0 0 6px var(--c)}50%{box-shadow:0 0 18px var(--c),0 0 32px var(--c)}}
.sp-who{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.15}
.sp-who b{font-size:clamp(14px,1.35cqw,24px);font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em}
.sp-who small{font-size:clamp(10px,.85cqw,14px);color:#7d8590;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-tag{flex:none;font-size:clamp(10px,.8cqw,13px);font-weight:700;letter-spacing:.1em;padding:4px 10px;border-radius:99px;color:#07090c;background:var(--t);box-shadow:0 0 14px color-mix(in srgb,var(--t) 60%,transparent)}
.sp-doing{padding:8px 12px 4px;font-size:clamp(12px,1.05cqw,18px);line-height:1.3;color:#e6e8eb;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sp-cap{padding:0 12px 6px;font-size:clamp(10px,.85cqw,14px);color:#9aa3ad;font-style:italic;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sp-feed{flex:1;min-height:0;overflow:hidden;padding:6px 12px;display:flex;flex-direction:column;justify-content:flex-end;
  font:clamp(10px,.8cqw,13.5px)/1.4 ui-monospace,Menlo,SFMono-Regular,monospace;color:#9aa3ad;border-top:1px solid #151a21}
.sp-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-say{color:#e6e8eb} .sp-tool{color:#4cc2ff} .sp-chat{color:#ffb547;font-weight:600} .sp-ok{color:#58c98a} .sp-bad{color:#ff6b6b} .sp-warn{color:#ffb547} .sp-res{color:#7d8590}
.sp-new{animation:sp-flash 1.2s ease-out}
@keyframes sp-flash{from{background:rgba(76,194,255,.25)}to{background:transparent}}
.sp-foot{display:flex;justify-content:space-between;gap:8px;padding:4px 12px 6px;font-size:clamp(9px,.75cqw,12px);color:#7d8590;border-top:1px solid #151a21}
.sp-foot span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-empty{grid-column:1/-1;display:flex;align-items:center;justify-content:center;color:#7d8590;font-size:clamp(12px,1.2cqw,20px)}
`;

// ---------- live panel ----------

/** Mount the panel into `root`. Returns { stop(), refresh(), state }. */
export function mountSpotlight(root, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (root.dataset?.count) o.count = Number(root.dataset.count) || o.count;
  const doc = root.ownerDocument || globalThis.document;
  if (doc && !doc.getElementById("sp-style")) { const st = doc.createElement("style"); st.id = "sp-style"; st.textContent = CSS; doc.head.appendChild(st); }
  root.classList.add("sp-root"); root.dataset.count = String(o.count);

  const state = {
    feeds: new Map(),     // id -> { lines:[{i,text,first}], last, fetchedAt }
    picks: [],            // [{id, since, score}]
    captions: new Map(),  // label core -> latest caption text
    capSince: 0,
    chat: [],             // [{from,text,t}]
    cards: new Map(),     // id -> element
    html: new Map(),      // id -> last rendered html (skip identical renders)
    nodes: [],
    pins: new Map(),      // id -> until (ms); agents the show director asked to spotlight
    lastError: null,
  };
  const url = (p) => o.base + p;
  const jget = async (p) => { const r = await fetch(url(p), { cache: "no-store" }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };

  async function pollChat() {
    try {
      const txt = await (await fetch(url(o.chatPath) + "?v=" + Date.now(), { cache: "no-store" })).text();
      const lines = txt.split("\n").filter(Boolean).slice(-80);
      state.chat = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch (e) { state.lastError = e; }
  }
  async function pollCaptions() {
    try {
      const r = await jget(`/api/subtitles?since=${state.capSince}`);
      for (const it of r.items || []) {
        const who = /^(.*?)\s*\(?(fable|sonnet|haiku|claude)\)?:\s/i.exec((it.basis || [])[0] || "");
        if (who) state.captions.set(parseLabel(who[0].replace(/:\s$/, "")).core, it.text);
        if (typeof it.n === "number") state.capSince = Math.max(state.capSince, it.n + 1);
      }
      if (!r.items?.length && r.total && state.capSince === 0) state.capSince = Math.max(0, r.total - 40);
    } catch (e) { state.lastError = e; }
  }
  async function pollFeeds() {
    const g = await jget("/api/graph");
    const now = g.now || Date.now();
    state.nodes = (g.nodes || []).filter((n) => n.kind === "job" && n.state === "running");
    for (const n of state.nodes) if (!state.feeds.has(n.id)) state.feeds.set(n.id, { lines: [], last: 0, fetchedAt: 0, firstLoad: true });
    // Only a budget of feeds per poll: forty agents save files every few seconds, so fetching every feed each time
    // would swamp the Control Room. Current picks first, then whoever has gone longest since we last looked.
    const picked = new Set(state.picks.map((p) => p.id));
    const due = state.nodes.filter((n) => { const f = state.feeds.get(n.id); return !(f.last === n.last && f.fetchedAt); })
      .sort((a, b) => (picked.has(b.id) - picked.has(a.id)) || (state.feeds.get(a.id).fetchedAt - state.feeds.get(b.id).fetchedAt))
      .slice(0, o.feedBudget);
    await Promise.all(due.map(async (n) => {
      const f = state.feeds.get(n.id);
      try {
        const raw = await jget(`/api/feed?id=${encodeURIComponent(n.id)}`);
        const known = new Map(f.lines.map((l) => [l.i, l]));
        const t = Date.now();
        f.lines = raw.map((l) => known.get(l.i) || { i: l.i, text: l.text, first: f.firstLoad ? t - 120000 : t });
        if (f.firstLoad && f.lines.length) { // on first load, treat only the very last few lines as fresh
          for (const l of f.lines.slice(-3)) l.first = t - Math.max(0, (t - (n.last || t)));
          f.firstLoad = false;
        }
        f.last = n.last; f.fetchedAt = t;
      } catch (e) { state.lastError = e; }
    }));
    return now;
  }

  function buildViews(now) {
    const chat = state.chat.map((m) => ({ ...m, age: (now - Date.parse(m.t)) / 1000 }));
    const scored = state.nodes.map((n) => {
      const f = state.feeds.get(n.id) || { lines: [] };
      const lines = f.lines.map((l) => ({ text: l.text, age: (now - l.first) / 1000 }));
      const s = scoreAgent(n, lines, { now, chat });
      return { id: n.id, node: n, lines, ...s };
    });
    const pinned = [...state.pins].filter(([, until]) => until > now).map(([id]) => id);
    for (const [id, until] of state.pins) if (until <= now) state.pins.delete(id);
    state.picks = pickSpotlight(scored, state.picks, { count: o.count, holdMs: o.holdMs, swapMargin: o.swapMargin, now, staleMs: o.staleMs, pinned });
    return state.picks.map((p) => {
      const s = scored.find((x) => x.id === p.id); const n = s.node; const lab = parseLabel(n.label);
      const caption = state.captions.get(lab.core) || "";
      const work = describeWork(s.lines, caption);
      return { id: n.id, label: n.label, ...lab, tag: s.tag, tone: s.tone, reasons: s.reasons, doing: work.doing, caption: work.caption, file: work.file,
        lines: s.lines, since: p.since, last: n.last, hot: now - (n.last || 0) < 5000, score: s.score };
    });
  }

  function render(views, now) {
    const want = new Set(views.map((v) => v.id));
    for (const [id, el] of state.cards) if (!want.has(id)) { el.classList.add("sp-leaving"); setTimeout(() => el.remove(), 300); state.cards.delete(id); state.html.delete(id); }
    root.querySelector(".sp-empty")?.remove();
    views.forEach((v, i) => {
      let el = state.cards.get(v.id);
      if (!el) { el = doc.createElement("article"); el.className = "sp-card"; el.dataset.id = v.id; state.cards.set(v.id, el); }
      const html = renderCard(v, { lines: o.lines, now });
      if (state.html.get(v.id) !== html) { el.innerHTML = html; state.html.set(v.id, html); }
      el.title = v.reasons.slice(0, 3).map((r) => `${r.tag}${r.detail ? ": " + r.detail : ""}`).join("\n");
      if (root.children[i] !== el) root.insertBefore(el, root.children[i] || null);
    });
    if (!views.length && !root.querySelector(".sp-empty")) { const d = doc.createElement("div"); d.className = "sp-empty"; d.textContent = state.lastError ? `Control Room unreachable: ${state.lastError.message}` : "No agents running right now"; root.appendChild(d); }
  }

  let timer = null, inflight = null, stopped = false;
  function tick() {
    if (stopped) return Promise.resolve();
    if (inflight) return inflight; // a poll is already running; share it
    inflight = (async () => {
      try {
        const [now] = await Promise.all([pollFeeds(), pollChat(), pollCaptions()]);
        render(buildViews(now || Date.now()), now || Date.now());
      } catch (e) { state.lastError = e; render([], Date.now()); }
      inflight = null;
    })();
    return inflight;
  }
  timer = setInterval(tick, o.interval); tick();
  return {
    stop() { stopped = true; clearInterval(timer); },
    refresh: tick, state, options: o, el: root,
    /** Force an agent (graph node id) into the spotlight for `ms` (default 30 s). Call from the show director's cue. */
    pin(id, ms = 30000) { if (id) state.pins.set(String(id), Date.now() + ms); return tick(); },
    /** Current picks as plain data for other panels: [{ id, label, score, since }]. */
    picks() { return state.picks.map((p) => ({ id: p.id, label: state.nodes.find((n) => n.id === p.id)?.label || p.id, score: p.score, since: p.since })); },
    setCount(n) { o.count = Math.max(1, Math.min(4, Number(n) || o.count)); root.dataset.count = String(o.count); return tick(); },
  };
}

/** Plug the panel into live/show.mjs: `registerWithShow(show, root)`. The show's SPOTLIGHT scene shows `root`
 *  and pins the agent named in the cue's data (id / node / label); other scenes hide it unless `opts.alwaysOn`. */
export function registerWithShow(show, root, opts = {}) {
  const sp = mountSpotlight(root, opts);
  const findId = (d) => {
    if (!d) return null; if (typeof d === "string") return d;
    if (d.id) return d.id; if (d.node) return d.node;
    if (d.label) return sp.state.nodes.find((n) => n.label === d.label)?.id || null;
    return null;
  };
  show.register({
    name: "spotlight",
    ready: () => sp.state.picks.length > 0,
    enter(cue) { root.hidden = false; const id = findId(cue?.data); if (id) sp.pin(id, (cue?.until && cue.until - Date.now()) || 30000); },
    leave() { if (!opts.alwaysOn) root.hidden = true; },
    update() {},
  });
  if (!opts.alwaysOn) root.hidden = true;
  return sp;
}

// self-mount for <div data-spotlight>
if (typeof document !== "undefined") {
  for (const el of document.querySelectorAll("[data-spotlight]")) {
    if (!el.__spotlight) el.__spotlight = mountSpotlight(el, { count: Number(el.dataset.count) || DEFAULTS.count });
  }
  globalThis.DriftfallSpotlight = { mountSpotlight, scoreAgent, pickSpotlight, classifyLine };
}
