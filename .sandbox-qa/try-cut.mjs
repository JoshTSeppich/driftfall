import { generateMap } from '../env/map.mjs';
const m = generateMap(1, { map: 'large' });
const W = m.width;
const SOLID = new Set(['#', 'o', 'S', 'R']);
const dist = new Int32Array(W * W).fill(-1);
const q = [(m.cores[0].y + 3) * W + m.cores[0].x + 3];
dist[q[0]] = 0;
const open = (x, y) => x >= 0 && y >= 0 && x < W && y < W && !SOLID.has(m.tiles[y][x]);
const ramp = (x, y) => m.tiles[y][x] === '=' || m.tiles[y][x] === '|';
for (let h = 0; h < q.length; h++) {
  const x = q[h] % W, y = (q[h] / W) | 0;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const a = x + dx, b = y + dy;
    if (!open(a, b) || dist[b * W + a] >= 0) continue;
    if (m.heights[b][a] !== m.heights[y][x] && !ramp(a, b) && !ramp(x, y)) continue;
    dist[b * W + a] = 1;
    q.push(b * W + a);
  }
}
const cut = [];
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (open(x, y) && dist[y * W + x] < 0) cut.push(`${x},${y}:${m.tiles[y][x]}h${m.heights[y][x]}id${m.reachGrid[y * W + x]}`);
console.log(cut.join(' '));
