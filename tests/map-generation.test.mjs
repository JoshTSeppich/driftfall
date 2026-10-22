// Map generation tests (node --test). These import the real env/map.mjs and never stub it.
// Expected coordinates and rules come from ENV-SPEC.md section 2, written out here by hand.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const SIZE = 32;
const LAST = SIZE - 1;

// Seeds used across the tests. Spread out on purpose so one lucky seed can't hide a bug.
const SEEDS = [1, 2, 3, 7, 42, 1234, 99999, 123456789, 0xdeadbeef, 2026];

// Starting layout, side 0 (spec section 2). Side 1 is the point mirror of each entry.
const CORE_0 = { x: 3, y: 3 };
const CORE_1 = { x: 28, y: 28 };
const WORKERS_0 = [
  [4, 3],
  [3, 4],
  [4, 4],
  [5, 5],
];
const WORKERS_1 = [
  [27, 28],
  [28, 27],
  [27, 27],
  [26, 26],
];
const CRYSTALS_0 = [
  // Home field, side 0.
  [7, 2],
  [8, 2],
  [7, 3],
  [8, 3],
  // Contested field, side 0.
  [12, 19],
  [13, 19],
  [12, 20],
  [13, 20],
];
const CRYSTALS_1 = [
  // Home field, side 1.
  [24, 29],
  [23, 29],
  [24, 28],
  [23, 28],
  // Contested field, side 1 (mirror of side 0's).
  [19, 12],
  [18, 12],
  [19, 11],
  [18, 11],
];
const CRYSTAL_AMOUNT = 400;
const ROCK_COUNT = 48;

const key = (x, y) => `${x},${y}`;
const chebyshev = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const mirrorXY = (x, y) => [LAST - x, LAST - y];
const sortPairs = (pairs) => pairs.map(([x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// mirror() may return {x, y} or [x, y]. Accept either so the tests check the value, not the shape.
const toXY = (r) => (Array.isArray(r) ? { x: r[0], y: r[1] } : { x: r.x, y: r.y });

async function mapModule() {
  return import("../env/map.mjs");
}

// Generated maps are pure functions of the seed, so caching them per seed only saves time.
// The determinism tests below call generateMap directly and never use this cache.
const cache = new Map();
async function mapFor(seed) {
  if (!cache.has(seed)) {
    const { generateMap } = await mapModule();
    cache.set(seed, generateMap(seed));
  }
  return cache.get(seed);
}

function rockSetOf(map) {
  return new Set(map.rocks.map(([x, y]) => key(x, y)));
}

// Every tile that is not rock or crystal, checked by a plain BFS written here (independent of env/map.mjs).
function openTilesConnected(map) {
  const rocks = rockSetOf(map);
  const crystals = new Set(map.crystals.map((c) => key(c.x, c.y)));
  const isOpen = (x, y) => !rocks.has(key(x, y)) && !crystals.has(key(x, y));

  const open = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isOpen(x, y)) open.push([x, y]);
    }
  }
  if (open.length === 0) return true;

  const seen = new Set([key(open[0][0], open[0][1])]);
  const queue = [open[0]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (!isOpen(nx, ny) || seen.has(key(nx, ny))) continue;
      seen.add(key(nx, ny));
      queue.push([nx, ny]);
    }
  }
  return seen.size === open.length;
}

// Every tile that must stay rock-free: Cores, starting Workers and crystal tiles.
function protectedTiles(map) {
  return [
    ...map.cores.map((c) => [c.x, c.y]),
    ...map.workers.flat().map((w) => [w.x, w.y]),
    ...map.crystals.map((c) => [c.x, c.y]),
  ];
}

describe("map-generation", () => {
  describe("determinism", () => {
    test("the same seed gives an identical map twice", async () => {
      const { generateMap } = await mapModule();
      for (const seed of [7, 42, 2026]) {
        const first = generateMap(seed);
        const second = generateMap(seed);
        assert.deepEqual(second, first, `seed ${seed} gave two different maps`);
        assert.equal(JSON.stringify(second), JSON.stringify(first), `seed ${seed} serialises differently`);
      }
    });

    test("generating other seeds in between does not change a seed's map", async () => {
      const { generateMap } = await mapModule();
      const before = JSON.stringify(generateMap(5));
      generateMap(9);
      generateMap(123);
      generateMap(5 + 1000);
      const after = JSON.stringify(generateMap(5));
      assert.equal(after, before, "shared state leaked between generations");
    });

    test("generation does not touch Math.random", async () => {
      const { generateMap } = await mapModule();
      const realRandom = Math.random;
      Math.random = () => {
        throw new Error("Math.random was called during map generation");
      };
      try {
        for (const seed of SEEDS) generateMap(seed);
      } finally {
        Math.random = realRandom;
      }
    });

    test("different seeds give different maps", async () => {
      const rockStrings = [];
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        rockStrings.push(JSON.stringify(sortPairs(map.rocks)));
      }
      assert.equal(new Set(rockStrings).size, SEEDS.length, "two seeds produced the same rock layout");
    });
  });

  describe("size and fixed layout", () => {
    test("map is 32 by 32", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        assert.equal(map.width, SIZE, `seed ${seed} width`);
        assert.equal(map.height, SIZE, `seed ${seed} height`);
      }
    });

    test("Cores sit at (3,3) for side 0 and (28,28) for side 1", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        assert.equal(map.cores.length, 2, `seed ${seed} core count`);
        assert.deepEqual({ x: map.cores[0].x, y: map.cores[0].y }, CORE_0, `seed ${seed} side 0 core`);
        assert.deepEqual({ x: map.cores[1].x, y: map.cores[1].y }, CORE_1, `seed ${seed} side 1 core`);
      }
    });

    test("starting Workers are at the spec coordinates, and side 1 is the mirror", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        assert.equal(map.workers.length, 2, `seed ${seed} worker groups`);
        assert.equal(map.workers[0].length, 4, `seed ${seed} side 0 worker count`);
        assert.equal(map.workers[1].length, 4, `seed ${seed} side 1 worker count`);
        assert.deepEqual(
          sortPairs(map.workers[0].map((w) => [w.x, w.y])),
          sortPairs(WORKERS_0),
          `seed ${seed} side 0 workers`,
        );
        assert.deepEqual(
          sortPairs(map.workers[1].map((w) => [w.x, w.y])),
          sortPairs(WORKERS_1),
          `seed ${seed} side 1 workers`,
        );
      }
    });

    test("crystal fields are at the spec coordinates with 400 Shards each", async () => {
      const expected = sortPairs([...CRYSTALS_0, ...CRYSTALS_1]);
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        assert.equal(map.crystals.length, 8, `seed ${seed} crystal count`);
        assert.deepEqual(sortPairs(map.crystals.map((c) => [c.x, c.y])), expected, `seed ${seed} crystal tiles`);
        for (const c of map.crystals) {
          assert.equal(c.amount, CRYSTAL_AMOUNT, `seed ${seed} crystal at ${c.x},${c.y} amount`);
        }
      }
    });

    test("the crystal fields are point-mirrored", async () => {
      for (const [x, y] of CRYSTALS_0) {
        assert.ok(
          CRYSTALS_1.some(([mx, my]) => mx === LAST - x && my === LAST - y),
          `no side 1 crystal at the mirror of ${x},${y}`,
        );
      }
    });
  });

  describe("rocks", () => {
    test("exactly 48 rocks when placement succeeds", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        assert.equal(map.rocks.length, ROCK_COUNT, `seed ${seed} rock count`);
      }
    });

    test("rocks are distinct integer tiles inside the map", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        const seen = new Set();
        for (const [x, y] of map.rocks) {
          assert.ok(Number.isInteger(x) && Number.isInteger(y), `seed ${seed} rock ${x},${y} not integer`);
          assert.ok(x >= 0 && x < SIZE && y >= 0 && y < SIZE, `seed ${seed} rock ${x},${y} off map`);
          assert.ok(!seen.has(key(x, y)), `seed ${seed} rock ${x},${y} listed twice`);
          seen.add(key(x, y));
        }
      }
    });

    test("every rock has its mirror rock at (31-x, 31-y)", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        const rocks = rockSetOf(map);
        for (const [x, y] of map.rocks) {
          const [mx, my] = mirrorXY(x, y);
          assert.ok(rocks.has(key(mx, my)), `seed ${seed}: rock ${x},${y} has no mirror at ${mx},${my}`);
        }
      }
    });

    test("rock layout is exactly symmetric (mirror of the set equals the set)", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        const mirrored = sortPairs(map.rocks.map(([x, y]) => mirrorXY(x, y)));
        assert.deepEqual(sortPairs(map.rocks), mirrored, `seed ${seed} rock set is not symmetric`);
      }
    });

    test("rocks never sit on a Core, Worker or crystal tile", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        const rocks = rockSetOf(map);
        for (const [x, y] of protectedTiles(map)) {
          assert.ok(!rocks.has(key(x, y)), `seed ${seed}: rock on protected tile ${x},${y}`);
        }
      }
    });

    test("no rock is within distance 2 of a Core, starting Worker or crystal tile", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        const protectedList = protectedTiles(map);
        for (const [x, y] of map.rocks) {
          for (const p of protectedList) {
            assert.ok(
              chebyshev([x, y], p) > 2,
              `seed ${seed}: rock ${x},${y} is within distance 2 of ${p[0]},${p[1]}`,
            );
          }
        }
      }
    });
  });

  describe("connectivity", () => {
    test("all open tiles are connected (independent BFS check)", async () => {
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        assert.ok(openTilesConnected(map), `seed ${seed}: open tiles are split into pieces`);
      }
    });

    test("isConnected agrees that generated maps are connected", async () => {
      const { isConnected } = await mapModule();
      for (const seed of SEEDS) {
        const map = await mapFor(seed);
        assert.equal(isConnected(map), true, `seed ${seed}: isConnected said no`);
      }
    });

    test("isConnected returns false when a wall of rock splits the map", async () => {
      const { isConnected } = await mapModule();
      // A full column of rock at x = 16 cuts the map in two. Nothing else on the map matters here.
      const rocks = [];
      for (let y = 0; y < SIZE; y++) rocks.push([16, y]);
      const split = { width: SIZE, height: SIZE, rocks, crystals: [], cores: [CORE_0, CORE_1], workers: [[], []] };
      assert.equal(isConnected(split), false);
    });
  });

  describe("mirror", () => {
    test("mirror maps (x, y) to (31-x, 31-y)", async () => {
      const { mirror } = await mapModule();
      const cases = [
        [3, 3, 28, 28],
        [0, 31, 31, 0],
        [16, 15, 15, 16],
        [31, 31, 0, 0],
      ];
      for (const [x, y, mx, my] of cases) {
        assert.deepEqual(toXY(mirror(x, y)), { x: mx, y: my }, `mirror(${x}, ${y})`);
      }
    });

    test("mirroring twice gives back the starting tile", async () => {
      const { mirror } = await mapModule();
      for (let x = 0; x < SIZE; x += 5) {
        for (let y = 0; y < SIZE; y += 5) {
          const once = toXY(mirror(x, y));
          assert.deepEqual(toXY(mirror(once.x, once.y)), { x, y }, `mirror twice of ${x},${y}`);
        }
      }
    });
  });
});
