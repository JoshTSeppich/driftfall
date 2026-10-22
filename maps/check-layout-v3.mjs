// Checks the v3 hand-drawn layout: ramp axes and ground connectivity with the step rule.
// Run: node maps/check-layout-v3.mjs   (exits 1 if a check fails)
import { grid, high, W, H } from "./layout-v3.mjs";

const walkable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !"#oLRSCD".includes(grid[y][x]);
const isRamp = (x, y) => "=|".includes(grid[y][x]);
const problems = [];

// Ramps: exactly one high and one low neighbour along their own axis
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = grid[y][x];
  if (c === "=" && high[y][x - 1] + high[y][x + 1] !== 1) problems.push(`ramp ${x},${y} is not high-to-low east-west`);
  if (c === "|" && high[y - 1][x] + high[y + 1][x] !== 1) problems.push(`ramp ${x},${y} is not high-to-low north-south`);
}

// Ground step rule: same height, or either tile is a ramp (ramp entry along its axis is checked above)
const canStep = (x1, y1, x2, y2) => walkable(x2, y2) && (high[y1][x1] === high[y2][x2] || isRamp(x1, y1) || isRamp(x2, y2));

const reach = (sx, sy, skipRamps) => {
  const seen = new Set([sy * W + sx]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (skipRamps && isRamp(nx, ny)) continue;
      if (!seen.has(ny * W + nx) && canStep(x, y, nx, ny)) { seen.add(ny * W + nx); q.push([nx, ny]); }
    }
  }
  return seen;
};

const idx = (x, y) => y * W + x;
const withRamps = reach(3, 3, false);
const noRamps = reach(3, 3, true);
// The side 1 Core tile itself is a building, so test the open tile next to it
if (!withRamps.has(idx(36, 35))) problems.push("side 0 Core cannot reach next to side 1 Core, even with ramps");
if (noRamps.has(idx(36, 35))) problems.push("side 0 reaches side 1's Core without a ramp (ramps should be the only way up or down)");
if (noRamps.has(idx(13, 3))) problems.push("the front lowland is reachable from the main without its ramp");
const mainWithoutRamp = [...noRamps].filter((i) => high[Math.floor(i / W)][i % W]).length;
const mainTiles = [...withRamps].filter((i) => high[Math.floor(i / W)][i % W]).length;
console.log(`high tiles reachable from side 0 core: ${mainTiles}, reachable without any ramp: ${mainWithoutRamp}`);
console.log(`side 0 natural (3,13) reachable without a ramp: ${noRamps.has(idx(3, 13))}`);

if (problems.length) { console.log("problems:\n  " + problems.join("\n  ")); process.exit(1); }
console.log("layout checks passed");
