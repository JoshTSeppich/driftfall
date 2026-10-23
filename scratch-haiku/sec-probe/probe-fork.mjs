// Probe: does the referee's child-process flags work on this Node?
import { fork } from 'node:child_process';

const child = fork('/Users/joshuatseppich/dev/rts/env/player-worker.mjs', [], {
  env: {},
  serialization: 'advanced',
  stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  execArgv: ['--permission', '--allow-fs-read=/Users/joshuatseppich/dev/rts/env/player-worker.mjs'],
});
let err = '';
child.stderr.on('data', (d) => { err += d; });
child.on('message', (m) => console.log('message', JSON.stringify(m).slice(0, 200)));
child.on('exit', (code, sig) => {
  console.log('exit', code, sig);
  console.log('stderr:', err.slice(0, 400));
});
child.send({ type: 'init', path: '/nonexistent.mjs', side: 0, seed: 1, stats: {} });
setTimeout(() => { child.kill(); }, 3000);
