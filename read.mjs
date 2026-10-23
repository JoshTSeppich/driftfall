// Read the team chat (token diet).   node read.mjs            last 20 messages + one-line summaries of the 40 before
//                                     node read.mjs --since N  messages from N on (max 30, long ones trimmed)
//                                     node read.mjs --full N   one message in full
// Waiting for replies is OFF: finish your task and exit. Replies and reviews wake the right agent automatically.
import fs from "node:fs"; import path from "node:path";
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : Number(args[i + 1]); };
const file = new URL("./channel.jsonl", import.meta.url);
const msgs = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const room = path.basename(path.dirname(new URL(import.meta.url).pathname));
let dig = new Map(); try { dig = new Map(JSON.parse(fs.readFileSync(new URL(`../control-room/data/chat-digest-${room}.json`, import.meta.url), "utf8")).items.map((d) => [d.i, d])); } catch {}
const trim = (t) => (t.length > 700 ? t.slice(0, 700) + ` ... (trimmed; node read.mjs --full N)` : t);
const full = opt("--full", null);
if (full !== null) { const m = msgs[full]; console.log(m ? `#${full} [${m.t.slice(11, 19)}] ${m.from}: ${m.text}` : "no such message"); process.exit(0); }
if (args.includes("--wait")) console.log("(waiting is off to save tokens: finish your task and exit; you'll be woken when someone replies)");
const sinceArg = opt("--since", null);
const start = sinceArg === null ? Math.max(0, msgs.length - 20) : Math.max(sinceArg, msgs.length - 30);
if (sinceArg === null) for (let i = Math.max(0, start - 40); i < start; i++) { const d = dig.get(i); if (d) console.log(`#${i} ${msgs[i].from} (${d.kind}, ${d.topic}): ${d.line}`); }
for (let i = start; i < msgs.length; i++) { const m = msgs[i]; console.log(`#${i} [${m.t.slice(11, 19)}] ${m.from}: ${trim(m.text)}`); }
console.log(`(${msgs.length} messages; next --since ${msgs.length})`);
