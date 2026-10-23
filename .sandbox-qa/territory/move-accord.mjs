// One-off: move the accord record to the end of TERRITORY.md as section 14, after Joshua's section 13.
import fs from 'node:fs';
const p = new URL('../../TERRITORY.md', import.meta.url);
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('## 13. Accord record');
const end = s.indexOf('## 12. Many resources');
if (start < 0 || end < 0 || end < start) throw new Error('accord block not where expected');
const block = s.slice(start, end).replace('## 13. Accord record', '## 14. Accord record');
s = s.slice(0, start) + s.slice(end);
if (!s.endsWith('\n')) s += '\n';
s += '\n' + block.trimEnd() + '\n' +
  '- **Joshua, 18:34:** one race first, Snakenators vs Snakenators, the Burrow parked; `STATS.factions.sides` is\n' +
  "  `['coil', 'coil']` and `STATS.factions.burrow.parked` is true until the Snakenators feel great. The Burrow's\n" +
  '  numbers stay in the tables so nothing is lost.\n';
fs.writeFileSync(p, s);
console.log('moved; sections:', [...s.matchAll(/^## (\d+)\./gm)].map((m) => m[1]).join(' '));
