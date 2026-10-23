// Smoke: the sim steps on each map size (workers told to gather, a worker told to cross the map).
import { createMatch, step } from '../env/sim.mjs';
for (const map of ['legacy', 'standard', 'large', 'huge']) {
  process.env.DRIFTFALL_MAP = map;
  const s = createMatch(7);
  const t = Date.now();
  const mine = s.units.filter((u) => u.owner === 0);
  const far = s.cores?.[1] || s.structures.find((x) => x.owner === 1);
  const cmds = [[{ type: 'move', unit: mine[0].id, x: far.x, y: far.y - 3 }], []];
  for (let i = 0; i < 1500; i++) step(s, i === 0 ? cmds : []);
  const u = s.units.find((x) => x.id === mine[0].id);
  console.log(map, s.width, 'units', s.units.length, 'after 600 ticks pos', u && [u.x, u.y], 'target', [far.x, far.y], Date.now() - t, 'ms');
}
