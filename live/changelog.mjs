// Build changelog writer. Watches the Driftfall folder and keeps two outputs up to date:
//   live/changelog.json  newest first; the on-screen panel reads this
//   CHANGELOG.md         the same story for the repo
// Every entry says what changed, who made it, and why, and links to the chat message that explains it.
// Usage:  node live/changelog.mjs          keep watching (checks every 3 s)
//         node live/changelog.mjs --once   one pass, then exit
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_JSON = path.join(ROOT, "live", "changelog.json");
const OUT_MD = path.join(ROOT, "CHANGELOG.md");
const CHAT = path.join(ROOT, "channel.jsonl");
const OWNERS_DOC = path.join(ROOT, "VISUAL-3D.md");
const KEEP = 400; // entries kept
const MERGE_MS = 3 * 60e3; // saves to one file by one author within 3 minutes become one entry
const SETTLE_MS = 1500; // skip files still being written
const WATCH_MS = 3000;
const CHAT_WINDOW_MS = 2 * 60e3; // a chat message may explain a change up to 2 minutes after the save ...
const CHAT_LOOKBACK_MS = 2 * 3600e3; // ... and up to 2 hours before it

const SKIP_DIRS = new Set(["node_modules", "__airpull", ".sandbox", ".git", "matches"]);
const SKIP_FILES = new Set(["CHANGELOG.md", "channel.jsonl", "package-lock.json", "live/changelog.json", "live/status.json"]);
const WANTED = /\.(mjs|js|html|css|md|json|glb|gltf|ogg|mp3|wav|png|svg)$/i;
const TEXT = /\.(mjs|js|html|css|md|json)$/i;
const GENERIC = new Set(["index.html", "package.json", "README.md", "index.mjs"]); // too common to match in chat
const ROLES = new Set(["fable", "sonnet", "haiku"]);

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const clip = (s, n = 240) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function listFiles(rel = "", out = new Map()) {
  for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listFiles(r, out);
      continue;
    }
    if (!WANTED.test(entry.name) || SKIP_FILES.has(r)) continue;
    out.set(r, fs.statSync(path.join(ROOT, r)));
  }
  return out;
}

// Owners from the table in VISUAL-3D.md ("| file(s) | owner | what |"). Rows can list several files and globs.
function readOwners() {
  const rules = [];
  if (!fs.existsSync(OWNERS_DOC)) return rules;
  for (const line of fs.readFileSync(OWNERS_DOC, "utf8").split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const who = cells[1].split(/\s/)[0];
    if (!ROLES.has(who)) continue;
    const names = cells[0].replace(/`/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    const dir = names[0].includes("/") ? names[0].slice(0, names[0].lastIndexOf("/") + 1) : "";
    for (const name of names) {
      const pattern = name.includes("/") ? name : dir + name;
      rules.push({ pattern, who });
    }
  }
  return rules;
}

function ownerOf(rel, rules) {
  const exact = rules.find((r) => r.pattern === rel);
  if (exact) return exact.who;
  const hit = rules.find((r) => {
    if (r.pattern.endsWith("/")) return rel.startsWith(r.pattern);
    if (r.pattern.includes("*")) {
      const re = new RegExp("^" + r.pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      return re.test(rel);
    }
    return false;
  });
  return hit ? hit.who : null;
}

// Chat messages, numbered the same way as `node read.mjs`.
function readChat() {
  if (!fs.existsSync(CHAT)) return [];
  return fs
    .readFileSync(CHAT, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((m, n) => ({ n, t: Date.parse(m.t), from: m.from, text: String(m.text || "") }));
}

// The latest chat message, close to the save, that names this file (by path, or by name when the name is distinctive).
function explain(rel, mtimeMs, chat) {
  const base = path.basename(rel);
  const names = GENERIC.has(base) ? [rel] : [rel, base];
  let best = null;
  for (const m of chat) {
    if (!(m.t <= mtimeMs + CHAT_WINDOW_MS && m.t >= mtimeMs - CHAT_LOOKBACK_MS)) continue;
    if (names.some((n) => m.text.includes(n))) best = m;
  }
  return best;
}

function countLines(rel) {
  if (!TEXT.test(rel)) return null;
  const buf = fs.readFileSync(path.join(ROOT, rel));
  let n = 0;
  for (const byte of buf) if (byte === 10) n++;
  return n;
}

function emptyState() {
  return { version: 1, nextId: 1, started: false, files: {}, entries: [] };
}

function loadState() {
  if (!fs.existsSync(OUT_JSON)) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(OUT_JSON, "utf8")) };
  } catch {
    return emptyState();
  }
}

// Compare the folder with the saved snapshot. Returns the changes, and updates the snapshot.
function scan(state, now) {
  const files = listFiles();
  const first = !state.started;
  const events = [];
  for (const [rel, st] of files) {
    if (now - st.mtimeMs < SETTLE_MS) continue;
    const prev = state.files[rel];
    if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) continue;
    const hash = sha1(fs.readFileSync(path.join(ROOT, rel)));
    const lines = countLines(rel);
    if (prev && prev.hash === hash) {
      state.files[rel] = { hash, mtime: st.mtimeMs, size: st.size, lines };
      continue;
    }
    state.files[rel] = { hash, mtime: st.mtimeMs, size: st.size, lines };
    if (!first) events.push({ rel, kind: prev ? "changed" : "added", mtime: st.mtimeMs, lines, prevLines: prev ? prev.lines : null });
  }
  for (const rel of Object.keys(state.files)) {
    if (files.has(rel) || !(now - 0 >= 0)) continue;
    const prev = state.files[rel];
    delete state.files[rel];
    if (!first) events.push({ rel, kind: "removed", mtime: now, lines: null, prevLines: prev.lines });
  }
  return { events, first, count: Object.keys(state.files).length };
}

function describe(ev) {
  if (ev.kind === "removed") return `Removed ${ev.rel}`;
  const verb = ev.kind === "added" ? "Added" : "Changed";
  if (ev.lines == null) return `${verb} ${ev.rel}`;
  if (ev.prevLines == null) return `${verb} ${ev.rel} (${ev.lines} lines)`;
  const d = ev.lines - ev.prevLines;
  return `${verb} ${ev.rel} (${d >= 0 ? "+" : ""}${d} lines, now ${ev.lines})`;
}

function record(state, events, chat, rules, now) {
  for (const ev of events) {
    const msg = ev.kind === "removed" ? null : explain(ev.rel, ev.mtime, chat);
    const owner = ownerOf(ev.rel, rules);
    // The owner from the VISUAL-3D.md table is who made it; otherwise, whoever named the file in the chat.
    const who = owner || (msg ? msg.from : "unassigned");
    const at = new Date(ev.mtime).toISOString();
    const recent = state.entries.slice(0, 20).find((e) => e.path === ev.rel && e.who === who && Date.parse(e.at) > ev.mtime - MERGE_MS && e.kind !== "removed");
    if (recent && ev.kind !== "removed") {
      // Several saves in a row by the same author become one entry.
      recent.at = at;
      recent.lines = ev.lines;
      recent.what = describe({ ...ev, kind: recent.kind, prevLines: recent.startLines });
      if (msg) {
        recent.why = clip(msg.text);
        recent.chat = { n: msg.n, from: msg.from };
      }
      recent.saves = (recent.saves || 1) + 1;
      continue;
    }
    state.entries.unshift({
      id: state.nextId++,
      at,
      seen: new Date(now).toISOString(),
      kind: ev.kind,
      path: ev.rel,
      what: describe(ev),
      who,
      owner,
      why: msg ? clip(msg.text) : "No chat message explains this yet.",
      chat: msg ? { n: msg.n, from: msg.from } : null,
      lines: ev.lines,
      startLines: ev.prevLines,
      saves: 1,
    });
  }
  state.entries = state.entries.slice(0, KEEP);
}

function renderMarkdown(state) {
  const out = [
    "# Driftfall changelog",
    "",
    "Written by the Build Changelog Writer (`live/changelog.mjs`). Newest first. Each line says what changed, who made it, and why. The chat message that explains it is named as `channel.jsonl #N`, the number that `node read.mjs` prints.",
    "",
  ];
  let day = "";
  for (const e of state.entries) {
    const d = new Date(e.at);
    const dayLabel = d.toISOString().slice(0, 10);
    if (dayLabel !== day) {
      day = dayLabel;
      out.push(`## ${day}`, "");
    }
    const time = d.toISOString().slice(11, 16);
    const why = e.chat ? `${e.why} (chat #${e.chat.n})` : e.why;
    out.push(`- **${time} UTC** ${e.what}. By ${e.who}. Why: ${why}`);
  }
  return out.join("\n") + "\n";
}

function writeAtomic(file, text) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function runPass(now = Date.now()) {
  const state = loadState();
  const chat = readChat();
  const rules = readOwners();
  const { events, first, count } = scan(state, now);
  if (first) {
    state.started = true;
    state.entries.unshift({
      id: state.nextId++,
      at: new Date(now).toISOString(),
      seen: new Date(now).toISOString(),
      kind: "start",
      path: null,
      what: `Changelog started, tracking ${count} project files`,
      who: "live view",
      owner: null,
      why: "The Build Changelog Writer began watching the folder.",
      chat: null,
      lines: null,
      startLines: null,
      saves: 1,
    });
  }
  if (events.length) record(state, events, chat, rules, now);
  if (first || events.length) {
    state.updated = new Date(now).toISOString();
    state.tracked = count;
    writeAtomic(OUT_JSON, JSON.stringify(state, null, 2) + "\n");
    writeAtomic(OUT_MD, renderMarkdown(state));
  }
  return { changes: events.length, first, tracked: count };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const once = process.argv.includes("--once");
  const pass = () => {
    try {
      const r = runPass();
      if (r.changes || r.first) console.log(new Date().toISOString().slice(11, 19), `${r.changes} change(s), ${r.tracked} files tracked`);
    } catch (err) {
      console.error("changelog pass failed:", err.message);
    }
  };
  pass();
  if (!once) setInterval(pass, WATCH_MS);
}
