import { loadMapSize } from '../maps/layout-sizes.mjs';
for (const n of ['large', 'huge']) {
  const t = Date.now();
  const m = loadMapSize(n);
  console.log(n, m.width, m.reaches.length, m.gates.length, m.winCount, Date.now() - t, 'ms', JSON.stringify(m.cores), m.perSide);
  if (n === 'large') console.log(m.tiles.filter((_, y) => y % 3 === 0).map((r) => r.filter((_, x) => x % 2 === 0).join('')).join('\n'));
}
