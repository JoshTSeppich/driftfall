// Probe: when does a Core fall in a headless live match between the human seat (idle) and a built-in bot?
import { createLiveMatch } from '../env/live.mjs';

const ai = process.argv[2] ?? 'players/builtin/ai.mjs';
const seed = Number(process.argv[3] ?? 7);
const m = createLiveMatch({ seed, human: 0, ai: new URL('../' + ai, import.meta.url).href, maxTicks: 2000 });
const deaths = [];
m.on('tick', ({ tick, events }) => {
  for (const e of events) if (e.e === 'die' && e.kind === 'core') deaths.push({ tick, owner: e.owner, id: e.id });
});
await m.ready();
while (!m.result) await m.tick();
console.log('result', JSON.stringify(m.result));
console.log('core deaths', JSON.stringify(deaths));
console.log('ticks', m.state.tick, 'seconds', (m.state.tick / 24).toFixed(1));
console.log('cores now', JSON.stringify(m.state.structures.filter((s) => s.kind === 'core').map((s) => [s.owner, s.hp])));
