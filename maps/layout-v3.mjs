// Driftfall v3 hand-drawn map (40 x 40), owned by the Level / Map Designer.
// Only the top half is drawn here. The bottom half is the point mirror (x, y) -> (39 - x, 39 - y),
// so the map is fair by construction. Run `node maps/layout-v3.mjs` to print it and write maps/driftfall-v3.txt.
//
// Legend (one character per tile):
//   .  open ground (low)          ^  open ground (high plateau)
//   #  rock: blocks ground movement, never destroyed; air flies over it
//   =  ramp, east-west axis       |  ramp, north-south axis (ramps are two tiles wide)
//   o  rubble: destructible block (200 hp), blocks ground movement only; air flies over it
//   S  standard Shard field tile (400 Shards)
//   R  rich Shard field tile (800 Shards, same mining cycle as standard)
//   L  Flux vent (300 Flux, needs a Siphon built on it)
//   C  side 0 Core spot (side 1's is D, the mirror)
import fs from "node:fs";

const W = 40;
const H = 40;
const grid = Array.from({ length: H }, () => Array(W).fill("."));
const high = Array.from({ length: H }, () => Array(W).fill(0));

const paint = (x0, y0, x1, y1, ch) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = ch;
};
// High ground: marks a rectangle as plateau. Overlays painted on top keep the height.
const plateau = (x0, y0, x1, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { grid[y][x] = "^"; high[y][x] = 1; }
};

// Top half, drawn for side 0 (top-left) and the neutral top-right flank.
// Map edge
paint(0, 0, W - 1, 0, "#");
paint(0, 0, 0, H - 1, "#");
paint(W - 1, 0, W - 1, H - 1, "#");

// Side 0 main plateau with one ramp east onto the front lowland
plateau(1, 1, 10, 10);
paint(11, 1, 11, 4, "#");
paint(11, 7, 11, 10, "#");
paint(11, 5, 11, 6, "=");
paint(3, 3, 3, 3, "C");
// (Worker starts are listed in maps/TERRAIN-V3.md; they sit on the plateau.)
paint(7, 2, 8, 3, "S");
// Front lowland
paint(15, 2, 15, 2, "L");
paint(14, 7, 15, 7, "#");
paint(15, 9, 15, 9, "o");
paint(14, 12, 14, 12, "o");
// Natural lowland south of the main (cliff to the plateau above it)
paint(7, 13, 8, 14, "S");
paint(2, 13, 2, 13, "L");
paint(5, 15, 6, 15, "#");
// Flank gate: a two-tile lane blocked by rubble
paint(1, 16, 4, 16, "#");
paint(7, 16, 10, 16, "#");
paint(1, 17, 4, 17, "#");
paint(7, 17, 10, 17, "#");
paint(5, 17, 6, 17, "o");
// South lowland, rock and the centre rich pair (its mirror is the other centre pair)
paint(3, 18, 3, 18, "#");
paint(6, 18, 6, 18, "#");
paint(19, 18, 19, 19, "R");

// Neutral mesa in the top-right: high ground, two ramps, rich field and two vents
plateau(26, 4, 33, 11);
paint(25, 7, 25, 8, "=");
paint(29, 12, 30, 12, "|");
paint(30, 6, 31, 7, "R");
paint(27, 9, 27, 9, "L");
paint(32, 9, 32, 9, "L");
// Neutral top-right corner pocket: standard field, vent, rock and rubble
paint(36, 2, 37, 3, "S");
paint(22, 3, 23, 3, "#");
paint(35, 14, 35, 15, "#");
paint(37, 9, 37, 9, "o");
paint(37, 16, 37, 16, "L");
paint(23, 17, 23, 17, "o");

// Mirror the top half into the bottom half (point mirror, C becomes D)
const mirrorChar = (ch) => (ch === "C" ? "D" : ch);
for (let y = H / 2; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const sx = W - 1 - x;
    const sy = H - 1 - y;
    grid[y][x] = mirrorChar(grid[sy][sx]);
    high[y][x] = high[sy][sx];
  }
}

const text = grid.map((row) => row.join("")).join("\n") + "\n";
fs.writeFileSync(new URL("./driftfall-v3.txt", import.meta.url), text);

// Quick counts the spec and tests can check against
const count = (ch) => grid.flat().filter((c) => c === ch).length;
const summary = {
  size: `${W}x${H}`,
  rock: count("#"),
  rubble: count("o"),
  standardShardTiles: count("S"),
  richShardTiles: count("R"),
  fluxVents: count("L"),
  rampTiles: count("=") + count("|"),
  highTiles: high.flat().filter(Boolean).length,
  cores: count("C") + count("D"),
};
// JSON export for env/map.mjs and the renderers. Types: floor | ramp | rock | vent | shard | rich-shard | rubble.
// Cliffs are not a tile type: they are the high-to-low steps where no ramp joins them (derived from heights).
const typeOf = { ".": "floor", "^": "floor", "C": "floor", "D": "floor", "=": "ramp", "|": "ramp", "#": "rock", "L": "vent", "S": "shard", "R": "rich-shard", "o": "rubble" };
const tiles = grid.map((row) => row.map((c) => typeOf[c]));
const rampAxis = [];
const shards = [], vents = [], rubble = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = grid[y][x];
  if (c === "=") rampAxis.push({ x, y, axis: "ew" });
  if (c === "|") rampAxis.push({ x, y, axis: "ns" });
  if (c === "S") shards.push({ x, y, amount: 400 });
  if (c === "R") shards.push({ x, y, amount: 800, rich: true });
  if (c === "L") vents.push({ x, y, amount: 300 });
  if (c === "o") rubble.push({ x, y, hp: 200 });
}
const workers0 = [[4, 3], [3, 4], [4, 4], [5, 5], [5, 3], [3, 5]].map(([x, y]) => ({ x, y }));
const workers1 = workers0.map(({ x, y }) => ({ x: W - 1 - x, y: H - 1 - y }));
const mapJson = {
  format: "driftfall-map", version: 3, width: W, height: H,
  tiles, heights: high, ramps: rampAxis, shards, vents, rubble,
  cores: [{ x: 3, y: 3 }, { x: W - 1 - 3, y: H - 1 - 3 }],
  workers: [workers0, workers1],
};
fs.writeFileSync(new URL("./driftfall-v3.json", import.meta.url), JSON.stringify(mapJson));

if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.stdout.write(text);
  console.log(JSON.stringify(summary));
}

export { grid, high, summary, W, H };
