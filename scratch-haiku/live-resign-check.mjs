// Probe: does resign() during an in-flight AI think let the tick run on after the match is over?
import { createLiveMatch } from '../env/live.mjs';

const slowAi = { act: () => new Promise((resolve) => setTimeout(() => resolve([]), 20)) };
const m = createLiveMatch({ seed: 3, human: 0, ai: slowAi, thinkMs: 500, hardMs: 1000, aiEvery: 1 });
const ends = [];
m.on('end', (r) => ends.push(r));
await m.ready();
const pending = m.tick();          // AI is thinking for ~20 ms
m.resign();                        // human quits while the tick is in flight
await pending;
console.log('result:', m.result && m.result.reason, '| state.tick:', m.state.tick, '| log ticks:', m.log.ticks.length);
console.log('end events:', ends.length);
console.log('last log tick:', m.log.ticks.at(-1).tick, 'events:', JSON.stringify(m.log.ticks.at(-1).events).slice(0, 160));
