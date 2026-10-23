// Post one plain-English message to the team chat.   node say.mjs <fable|sonnet|haiku|gpt> "message"
import fs from "node:fs";
const [from, ...words] = process.argv.slice(2);
const text = words.join(" ").trim();
if (!/^[A-Za-z0-9 &·()._-]{2,48}$/.test(from) || !text) { console.error('usage: node say.mjs <fable|sonnet|haiku|gpt> "message"'); process.exit(1); }
if (text.length > 700) { console.error(`Too long (${text.length} chars). Keep chat posts under 900 characters; put details in a file and name it.`); process.exit(1); }
fs.appendFileSync(new URL("./channel.jsonl", import.meta.url), JSON.stringify({ t: new Date().toISOString(), from, text }) + "\n");
console.log("posted");
