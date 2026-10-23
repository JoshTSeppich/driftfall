// Writes maps/driftfall-v4.json and maps/driftfall-v4.txt from maps/layout-v4.mjs. Run: node maps/build-v4.mjs
// (kept apart from the layout so the page can import the layout without node:fs or a top-level await).
import fs from 'node:fs';
import { drawV4, encodeV4, W, H } from './layout-v4.mjs';

const json = encodeV4(drawV4());
fs.writeFileSync(new URL('./driftfall-v4.json', import.meta.url), JSON.stringify(json));
const text = json.tiles.join('\n') + '\n';
fs.writeFileSync(new URL('./driftfall-v4.txt', import.meta.url), text);
process.stdout.write(text);
console.log(`${W}x${H}, ${json.reaches.length} Reaches, ${json.gates.length} gates`);
