// Read the team chat.   node read.mjs [--since N] [--wait SECONDS]
// Prints messages numbered from 0. With --wait, blocks until a message newer than --since arrives (or time runs out).
import fs from "node:fs";
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : Number(args[i + 1]); };
const since = opt("--since", 0), wait = opt("--wait", 0);
const file = new URL("./channel.jsonl", import.meta.url);
const read = () => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const t0 = Date.now();
let msgs = read();
while (wait && msgs.length <= since && Date.now() - t0 < wait * 1000) { await new Promise((r) => setTimeout(r, 1000)); msgs = read(); }
msgs.forEach((m, i) => { if (i >= since) console.log(`#${i} [${m.t.slice(11, 19)}] ${m.from}: ${m.text}`); });
console.log(`(${msgs.length} messages; next --since ${msgs.length})`);
