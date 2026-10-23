// Probe: which permission flag works on this Node, and what a child under it can still do.
// Usage: node probe-perm.mjs <flag>   e.g. --experimental-permission
import { spawnSync } from 'node:child_process';

const flag = process.argv[2] ?? '--experimental-permission';
const probe = `
const out = {};
const t = (k, f) => { try { out[k] = f() ? 'ALLOWED' : 'ok-false'; } catch (e) { out[k] = 'blocked:' + (e.code ?? e.message.slice(0, 60)); } };
const fs = require('node:fs');
t('read-own-file', () => fs.readFileSync('/Users/joshuatseppich/dev/rts/env/player-worker.mjs').length);
t('read-other-file', () => fs.readFileSync('/Users/joshuatseppich/dev/rts/ENV-SPEC.md').length);
t('write-file', () => fs.writeFileSync('/tmp/haiku-probe-write.txt', 'x'));
t('env-visible', () => Object.keys(process.env).length);
t('spawn', () => require('node:child_process').execSync('echo hi').length);
t('worker-thread', () => { new (require('node:worker_threads').Worker)('0', { eval: true }); return true; });
console.log(JSON.stringify(out));
`;
const r = spawnSync(process.execPath, [flag, '--allow-fs-read=/Users/joshuatseppich/dev/rts/env', '-e', probe], {
  env: {},
  encoding: 'utf8',
});
console.log('flag', flag, 'status', r.status);
console.log('stdout', r.stdout.trim());
console.log('stderr', r.stderr.trim().slice(0, 300));
