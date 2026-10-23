// Post one plain-English message to the team chat.   node say.mjs <fable|sonnet|haiku|gpt> "message"
import fs from "node:fs";
const [from, ...words] = process.argv.slice(2);
const text = words.join(" ").trim();
if (!["fable", "sonnet", "haiku", "claude", "gpt"].includes(from) || !text) { console.error('usage: node say.mjs <fable|sonnet|haiku|gpt> "message"'); process.exit(1); }
if (from !== "claude" && text.length > 900) { console.error(`Too long (${text.length} chars). Keep chat posts under 900 characters; put details in a file and name it.`); process.exit(1); }
fs.appendFileSync(new URL("./channel.jsonl", import.meta.url), JSON.stringify({ t: new Date().toISOString(), from, text }) + "\n");
console.log("posted");
