// Breadth-first shortest path on a 4-directional grid. See ENV-SPEC.md section 6.
// Neighbour order is fixed (up, right, down, left) so the same question gives the same path.

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function findPath({ width, height, blocked }, from, to, { within = 0 } = {}) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  if (!inside(from.x, from.y)) return null;
  const done = (x, y) => Math.max(Math.abs(x - to.x), Math.abs(y - to.y)) <= within;
  if (done(from.x, from.y)) return [];

  const start = from.y * width + from.x;
  const prev = new Int32Array(width * height).fill(-2);
  prev[start] = -1;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inside(nx, ny)) continue;
      const n = ny * width + nx;
      if (prev[n] !== -2 || blocked(nx, ny)) continue;
      prev[n] = cur;
      if (done(nx, ny)) {
        const path = [];
        for (let i = n; i !== start; i = prev[i]) path.push({ x: i % width, y: Math.floor(i / width) });
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}
