import { buildPerfScenario } from '../play/perf-scenario.mjs';
import { step } from '../env/sim.mjs';
const t0 = performance.now();
const { state, map } = buildPerfScenario();
console.log('build ms', (performance.now() - t0).toFixed(1), 'units', state.units.length, 'w,h', map.width, map.height, 'cores', JSON.stringify(map.cores));
const ms = [];
for (let t = 0; t < 240; t++) {
  const a = performance.now();
  const ev = step(state, []);
  ms.push(performance.now() - a);
  if (t === 0) console.log('first events', ev.length, ev.slice(0, 3).map((e) => e.e).join(','));
}
const sorted = [...ms].sort((a, b) => a - b);
console.log('tick ms median', sorted[120].toFixed(2), 'p95', sorted[228].toFixed(2), 'max', sorted[239].toFixed(2));
console.log('alive', state.units.length, 'rejects', state.events.filter((e) => e.e === 'reject').length);
