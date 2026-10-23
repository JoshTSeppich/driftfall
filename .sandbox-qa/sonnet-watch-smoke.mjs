// headless: two built-in AIs through the live driver (fast clock), caster + topbar on a real match
import { createLiveMatch, loadAi } from '../env/live.mjs';
import { observe } from '../env/state.mjs';
import { createCaster, createTopbar } from '../play/watch.mjs';
const AI = new URL('../players/builtin/ai.mjs', import.meta.url).href;
const d = createLiveMatch({ seed: 7, human: 0, ai: AI, maxTicks: 3000, difficulty: 'normal', tps: 2000 });
const ai0 = await loadAi(AI, { side: 0, seed: 7, difficulty: 'normal' });
const c = createCaster(), bar = createTopbar();
const looks = new Set(); let moves = 0, last = null, ticks = 0;
d.on('tick', ({ events }) => {
  ticks++;
  c.note(d.state.tick, d.state, events); bar.note(d.state);
  const p = c.pick(d.state.tick); if (p) { looks.add(p.why); if (last !== p.key) moves++; last = p.key; }
  Promise.resolve(ai0.act(observe(d.state, 0))).then((cm) => d.queue(cm));
});
const done = new Promise((res) => d.on('end', res));
await d.ready();
d.start();
const r = await done;
console.log('end', r.winner, r.reason, 'ticks', ticks, 'looks', [...looks], 'switches', moves, JSON.stringify(bar.read(d.state)));
