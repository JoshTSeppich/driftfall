// Post one plain-English message to the team chat.   node say.mjs <fable|sonnet|haiku> "message"
import fs from "node:fs";
const [from, ...words] = process.argv.slice(2);
const text = words.join(" ").trim();
if (!["fable", "sonnet", "haiku", "claude"].includes(from) || !text) { console.error('usage: node say.mjs <fable|sonnet|haiku> "message"'); process.exit(1); }
fs.appendFileSync(new URL("./channel.jsonl", import.meta.url), JSON.stringify({ t: new Date().toISOString(), from, text }) + "\n");
console.log("posted");
