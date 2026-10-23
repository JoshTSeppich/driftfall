// `npm test`: run every *.test.mjs in tests/ and play/ with node --test (owner: sonnet, shipping).
// Same files the Live Build Compiler runs. Extra args are passed to node --test (for example --test-reporter=spec).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['tests', 'play'].flatMap((d) => fs.existsSync(path.join(root, d))
  ? fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(d, f)) : []);
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
