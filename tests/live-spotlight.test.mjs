// Tests for live/spotlight.mjs (owner: fable, Agent Spotlight). Pure parts run with no DOM;
// the last test mounts the panel into a tiny fake DOM against the real Control Room if it is reachable.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyLine, parseSay, extractChatPosts, chatTone, parseLabel, describeWork, scoreAgent, pickSpotlight, renderCard, mountSpotlight, fmtAgo, cueFromScene } from "../live/spotlight.mjs";
import fs from "node:fs";

test("cueFromScene pins only on a SPOTLIGHT scene that names an agent, for as long as the cue lasts", () => {
  const now = 1_000_000;
  assert.equal(cueFromScene(null), null);
  assert.equal(cueFromScene({ scene: "wall", agent: "job:x" }), null);
  assert.equal(cueFromScene({ scene: "spotlight", agent: null }), null);
  assert.deepEqual(cueFromScene({ scene: "spotlight", agent: "job:x", until: now + 15000, reason: "finished" }, now), { id: "job:x", ms: 15000, reason: "finished" });
  assert.equal(cueFromScene({ scene: "spotlight", agent: { id: "job:y" } }, now).ms, 30000, "no until: default 30 s");
  assert.equal(cueFromScene({ scene: "spotlight", agent: "job:z", until: now + 999999 }, now).ms, 120000, "capped at two minutes");
  assert.equal(cueFromScene({ scene: "spotlight", agent: "job:z", until: new Date(now + 5000).toISOString() }, now).ms, 5000, "ISO until works");
});

test("the standalone page imports the module it ships with", () => {
  const html = fs.readFileSync(new URL("../live/spotlight.html", import.meta.url), "utf8");
  assert.match(html, /import \{ mountSpotlight, followSceneFile \} from "\.\/spotlight\.mjs"/);
  assert.match(html, /id="spotlight"/);
});

test("classifyLine tells narration, tools, results, tests and denials apart", () => {
  assert.equal(classifyLine("claude: I'll start by reading the spec.").kind, "say");
  const t = classifyLine('  → Edit {"file_path":"/Users/joshuaseppich/dev/rts/viewer3d/terrain.mjs","old_string":"a","new_string":"b"}');
  assert.equal(t.kind, "tool"); assert.equal(t.tool, "Edit"); assert.equal(t.file, "viewer3d/terrain.mjs");
  assert.equal(classifyLine("    ↳ ✔ world frames (1.2ms) # tests 5 # pass 5 # fail 0").kind, "test-pass");
  assert.equal(classifyLine("    ↳ ✖ world frames # tests 5 # pass 4 # fail 1").kind, "test-fail");
  assert.equal(classifyLine("    ↳ Error: Cannot find module 'x'").kind, "error");
  assert.equal(classifyLine("    ✗ This command requires approval").kind, "denied");
  assert.equal(classifyLine("    ↳ 1 # Driftfall swarm roles").kind, "result");
  assert.equal(classifyLine("[started] session abc · claude-haiku-5-5").started, true);
});

test("say.mjs posts are recovered from Bash commands and toned", () => {
  const line = '  → Bash {"command":"cd /Users/joshuaseppich/dev/rts && node say.mjs sonnet \\"Sonnet here: I disagree, the Lancer should hit ground only. Alternative: give Skyspike the air role.\\" && node read.mjs --since 5","description":"Post"}';
  const c = classifyLine(line);
  assert.equal(c.chat.from, "sonnet");
  assert.match(c.chat.text, /^Sonnet here: I disagree/);
  assert.equal(chatTone(c.chat.text), "disagree");
  assert.equal(chatTone("AGREE, ids in spec order."), "agree");
  assert.equal(chatTone("Haiku, which name do you want for the limit?"), "question");
  assert.equal(chatTone("Terrain is done and tested."), "status");
  assert.equal(parseSay("node say.mjs haiku 'single quotes work'").text, "single quotes work");
  assert.equal(extractChatPosts([{ text: line }, { text: "claude: hi" }]).length, 1);
});

test("parseLabel splits team, role, model and machine", () => {
  assert.deepEqual(parseLabel("Live View · Agent Spotlight Operator (fable)"), { team: "Live View", role: "Agent Spotlight Operator", model: "fable", machine: "mini", core: "Live View · Agent Spotlight Operator (fable)" });
  const a = parseLabel("Driftfall 3D · 3D buildings (haiku) · MacBook Air");
  assert.equal(a.machine, "MacBook Air"); assert.equal(a.role, "3D buildings"); assert.equal(a.core, "Driftfall 3D · 3D buildings (haiku)");
});

test("describeWork prefers the agent's own narration, then the caption, then the last file", () => {
  const lines = [{ text: "claude: Writing the terrain module now." }, { text: '  → Write {"file_path":"/Users/joshuaseppich/dev/rts/viewer3d/terrain.mjs","content":"x"}' }, { text: "    ↳ File created" }];
  const w = describeWork(lines, "A caption");
  assert.equal(w.doing, "Writing the terrain module now."); assert.equal(w.file, "viewer3d/terrain.mjs");
  assert.equal(describeWork(lines.slice(1), "A caption").doing, "A caption");
  assert.equal(describeWork(lines.slice(1), "").doing, "Editing viewer3d/terrain.mjs");
});

test("scoreAgent ranks a fresh test pass or a disagreement above quiet reading", () => {
  const now = Date.now();
  const quiet = { id: "q", label: "Driftfall 3D · 3D terrain (sonnet)", last: now - 50000 };
  const tester = { id: "t", label: "Driftfall 3D · 3D VFX (sonnet)", last: now - 1000 };
  const fighter = { id: "f", label: "Roster + terrain accord · Unit Designer (sonnet)", last: now - 30000 };
  const q = scoreAgent(quiet, [{ text: '  → Read {"file_path":"/x/ENV-SPEC.md"}', age: 40 }, { text: "    ↳ 1 # spec", age: 40 }], { now });
  const t = scoreAgent(tester, [{ text: "    ↳ ✔ vfx plan (1ms) # pass 7 # fail 0", age: 2 }], { now });
  const f = scoreAgent(fighter, [{ text: '  → Bash {"command":"node say.mjs sonnet \\"I disagree with the Flak Spire cost, alternative: 75.\\""}', age: 10 }], { now });
  assert.ok(t.score > q.score); assert.equal(t.tag, "TESTS PASS");
  assert.ok(f.score > q.score); assert.equal(f.tag, "DISAGREEMENT");
  // being addressed in chat counts
  const a = scoreAgent(quiet, [], { now, chat: [{ from: "fable", text: "Sonnet, is the terrain fog in your module or mine?", age: 20 }] });
  assert.ok(a.reasons.some((r) => r.key === "addressed"));
  // ages beyond 4 minutes are ignored
  const old = scoreAgent(tester, [{ text: "    ↳ # pass 7", age: 500 }], { now: now - 100000 });
  assert.ok(!old.reasons.some((r) => r.key === "test-pass"));
});

test("pickSpotlight holds cards, swaps only on a clear win, and keeps slots stable", () => {
  const now = 1000000;
  const scored = [{ id: "a", score: 90 }, { id: "b", score: 80 }, { id: "c", score: 70 }, { id: "d", score: 60 }, { id: "e", score: 50 }];
  let picks = pickSpotlight(scored, [], { count: 4, now });
  assert.deepEqual(picks.map((p) => p.id), ["a", "b", "c", "d"]);
  // within the hold window nothing moves even if e jumps
  const bumped = scored.map((s) => (s.id === "e" ? { ...s, score: 200 } : s));
  picks = pickSpotlight(bumped, picks, { count: 4, now: now + 5000, holdMs: 20000 });
  assert.deepEqual(picks.map((p) => p.id), ["a", "b", "c", "d"]);
  // after the hold, e replaces the weakest (d) and takes d's slot
  picks = pickSpotlight(bumped, picks, { count: 4, now: now + 25000, holdMs: 20000 });
  assert.deepEqual(picks.map((p) => p.id), ["a", "b", "c", "e"]);
  // a small edge is not enough to swap
  const close = bumped.map((s) => (s.id === "d" ? { ...s, score: 85 } : s));
  const again = pickSpotlight(close, picks, { count: 4, now: now + 50000, holdMs: 20000, swapMargin: 25 });
  assert.deepEqual(again.map((p) => p.id), ["a", "b", "c", "e"]);
  // an agent that finished disappears and the slot is refilled
  const gone = close.filter((s) => s.id !== "a");
  const refill = pickSpotlight(gone, picks, { count: 4, now: now + 50000 });
  assert.equal(refill.length, 4); assert.ok(!refill.some((p) => p.id === "a"));
  assert.equal(pickSpotlight(scored, [], { count: 3, now }).length, 3);
  // a pinned agent (show director's cue) jumps in at once, replacing the weakest, and stays while pinned
  const pinned = pickSpotlight(scored, picks, { count: 4, now: now + 26000, pinned: ["e"] });
  assert.ok(pinned.some((p) => p.id === "e"));
  const still = pickSpotlight(scored.map((s) => (s.id === "e" ? { ...s, score: 1 } : s)), pinned, { count: 4, now: now + 60000, pinned: ["e"] });
  assert.ok(still.some((p) => p.id === "e"));
  assert.ok(pickSpotlight(scored, [], { count: 4, now, pinned: ["zzz"] }).every((p) => p.id !== "zzz"), "unknown pins are ignored");
});

test("renderCard escapes and colors lines", () => {
  const html = renderCard({ id: "x", role: "3D units", team: "Driftfall 3D", model: "fable", machine: "mini", tag: "TESTS PASS", tone: "ok", doing: "Modelling <Brute>", caption: "", file: "viewer3d/units.mjs",
    lines: [{ text: "claude: hi", age: 1 }, { text: "    ↳ ✔ units # pass 3", age: 1 }, { text: '  → Bash {"command":"node say.mjs fable \\"AGREE\\""}', age: 1 }], last: Date.now() - 1500, hot: true, reasons: [] });
  assert.match(html, /Modelling &lt;Brute&gt;/);
  assert.match(html, /sp-ok/); assert.match(html, /sp-chat/); assert.match(html, /says in chat: AGREE/);
  assert.match(html, /sp-hot/); assert.match(html, /last file: viewer3d\/units.mjs/);
  assert.equal(fmtAgo(500), "just now"); assert.equal(fmtAgo(65000), "1m ago");
});

// ---- fake DOM just big enough for mountSpotlight ----
function fakeDom() {
  const mk = (tag) => {
    const el = { tagName: tag, children: [], dataset: {}, classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } },
      innerHTML: "", textContent: "", title: "", id: "", className: "", parentNode: null,
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      insertBefore(c, ref) { if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = el; const i = ref ? el.children.indexOf(ref) : el.children.length; el.children.splice(i < 0 ? el.children.length : i, 0, c); return c; },
      remove() { if (el.parentNode) el.parentNode.children.splice(el.parentNode.children.indexOf(el), 1); el.parentNode = null; },
      querySelector(sel) { return el.children.find((c) => sel === "." + c.className) || null; },
      querySelectorAll() { return []; } };
    return el;
  };
  const head = mk("head"); const styles = [];
  const document = { head, createElement: mk, getElementById: (id) => styles.find((s) => s.id === id) || null, querySelectorAll: () => [] };
  head.appendChild = (s) => { styles.push(s); return s; };
  return { document, mk };
}

test("mountSpotlight renders cards from a stubbed Control Room (deterministic: no live server needed)", async () => {
  const realFetch = globalThis.fetch;
  const now = Date.now();
  const nodes = [1, 2, 3].map((i) => ({ id: `job:${i}`, kind: "job", state: "running", label: `Team ${i} · Role ${i} (sonnet)`, last: now - 1000 * i }));
  globalThis.fetch = async (u) => {
    const s = String(u); const ok = (body) => ({ ok: true, json: async () => body, text: async () => "" });
    if (s.includes("/api/graph")) return ok({ now, nodes });
    if (s.includes("/api/feed")) return ok([{ i: 1, text: "claude: reading the spec." }, { i: 2, text: "    ↳ ✔ t # tests 5 # pass 5 # fail 0" }]);
    if (s.includes("/api/subtitles")) return ok({ items: [], total: 0 });
    return ok({});
  };
  try {
  const { document, mk } = fakeDom();
  const root = mk("div"); root.ownerDocument = document;
  const sp = mountSpotlight(root, { base: "http://localhost:4477", count: 4, interval: 100000 });
  await sp.refresh();
  sp.stop();
  assert.ok(document.getElementById("sp-style"), "injects its stylesheet once");
  assert.equal(root.dataset.count, "4");
  assert.ok(root.children.length >= 1 && root.children.length <= 4, `shows 1–4 cards, got ${root.children.length}`);
  for (const c of root.children) { assert.equal(c.className, "sp-card"); assert.match(c.innerHTML, /sp-head/); assert.match(c.innerHTML, /sp-feed/); }
  assert.equal(sp.state.picks.length, root.children.length);
  } finally { globalThis.fetch = realFetch; }
});
