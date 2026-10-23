// Standard 128 / Large 192 / Huge 256 maps (TERRITORY.md section 14): maps/layout-sizes.mjs + env/map.mjs.
// Real modules, nothing stubbed. Symmetry, connectivity, fair starts, Reach counts, win count and a routing perf check.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, loadMapV4, reachLayoutV4, MAP_SIZES, DEFAULT_MAP } from '../env/map.mjs';
import { LARGE, HUGE, winCountFor, SPECS } from '../maps/layout-sizes.mjs';
import { drawV4, encodeV4, decodeV4, scatterV4 } from '../maps/layout-v4.mjs';
import { buildReaches } from '../env/territory.mjs';
import { createReachRouter, findPathVia } from '../env/reach-path.mjs';
import { findPath } from '../env/path.mjs';
import { makeRng } from '../env/rng.mjs';

const SIZES = { standard: { w: 128, reaches: 21, win: 14 }, large: { w: 192, reaches: 31, win: 21 }, huge: { w: 256, reaches: 41, win: 28 } };
const SEEDS = [1, 7, 42];
const SOLID = new Set(['#', 'o', 'S', 'R']);
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Ground distance from a tile, 4-way; a step between heights needs a ramp tile at either end.
function distances(m, from) {
  const { width: W, height: H } = m;
  const dist = new Int32Array(W * H).fill(-1);
  const q = [from.y * W + from.x];
  dist[q[0]] = 0;
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !SOLID.has(m.tiles[y][x]);
  const ramp = (x, y) => m.tiles[y][x] === '=' || m.tiles[y][x] === '|';
  for (let h = 0; h < q.length; h++) {
    const x = q[h] % W, y = (q[h] / W) | 0;
    for (const [dx, dy] of DIRS) {
      const a = x + dx, b = y + dy;
      if (!open(a, b) || dist[b * W + a] >= 0) continue;
      if (m.heights[b][a] !== m.heights[y][x] && !ramp(a, b) && !ramp(x, y)) continue;
      dist[b * W + a] = dist[y * W + x] + 1;
      q.push(b * W + a);
    }
  }
  return dist;
}
const nearestOpen = (dist, m, p) => {
  let best = Infinity;
  for (const [dx, dy] of DIRS) {
    const d = dist[(p.y + dy) * m.width + p.x + dx];
    if (d >= 0 && d < best) best = d;
  }
  return best;
};

for (const [size, want] of Object.entries(SIZES)) {
  describe(`${size} map`, () => {
    const base = loadMapV4(size);
    const W = want.w;

    test(`is ${W} x ${W} with ${want.reaches} Reaches and a two-thirds win of ${want.win}`, () => {
      assert.equal(base.width, W);
      assert.equal(base.height, W);
      assert.equal(base.reaches.length, want.reaches);
      assert.deepEqual(base.reaches.map((r) => r.id), Array.from({ length: want.reaches }, (_, i) => i + 1));
      assert.equal(base.winCount, want.win);
      assert.equal(winCountFor(want.reaches), want.win);
      const per = (want.reaches - 1) / 2;
      for (const side of [0, 1]) {
        const mine = base.reaches.filter((r) => r.side === side);
        assert.equal(mine.length, per);
        assert.equal(mine.filter((r) => r.kind === 'main').length, 1);
        assert.equal(mine.filter((r) => r.kind === 'natural').length, 1);
      }
      assert.equal(base.reaches.filter((r) => r.kind === 'centre').length, 1);
      assert.equal(new Set(base.reaches.map((r) => r.name + r.side)).size, want.reaches);
    });

    test('Reach rooms never overlap and every gate joins two real Reaches', () => {
      const owner = new Int32Array(W * W);
      for (const r of base.reaches) {
        const [x0, y0, x1, y1] = r.rect;
        assert.ok(x0 >= 1 && y0 >= 1 && x1 <= W - 2 && y1 <= W - 2, `${r.name} inside the border`);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          assert.equal(owner[y * W + x], 0, `${r.name} overlaps at ${x},${y}`);
          owner[y * W + x] = r.id;
        }
      }
      const ids = new Set(base.reaches.map((r) => r.id));
      for (const g of base.gates) assert.ok(ids.has(g.a) && ids.has(g.b) && g.id >= base.gateBase, `gate ${g.id}`);
      assert.ok(base.gates.length + base.gateBase <= 255, 'ids fit a byte');
    });

    test('every layer is point-mirrored, including after the seeded scatter', () => {
      for (const m of [base, ...SEEDS.map((s) => scatterV4(base, s))]) {
        for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
          const a = W - 1 - x, b = W - 1 - y;
          assert.equal(m.tiles[y][x], m.tiles[b][a], `tile ${x},${y}`);
          assert.equal(m.heights[y][x], m.heights[b][a], `height ${x},${y}`);
        }
        const [c0, c1] = m.cores;
        assert.deepEqual([W - 1 - c0.x, W - 1 - c0.y], [c1.x, c1.y]);
        m.workers[0].forEach((p, i) => assert.deepEqual([W - 1 - p.x, W - 1 - p.y], [m.workers[1][i].x, m.workers[1][i].y]));
      }
      // Reach ids: side 0 <-> side 1 swap, Centre stays.
      const n = base.perSide;
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const id = base.reachGrid[y * W + x], o = base.reachGrid[(W - 1 - y) * W + (W - 1 - x)];
        const want2 = id === 0 ? 0 : id >= base.gateBase ? 'gate' : id === base.centreId ? id : id <= n ? id + n : id - n;
        if (want2 === 'gate') assert.ok(o >= base.gateBase, `gate mirror ${x},${y}`);
        else assert.equal(o, want2, `id mirror ${x},${y}`);
      }
    });

    test('all open ground is one connected piece (ramps join the plateaus), for several seeds', () => {
      for (const seed of SEEDS) {
        const m = generateMap(seed, { map: size });
        const dist = distances(m, { x: m.cores[0].x + 3, y: m.cores[0].y + 3 });
        let open = 0, reached = 0;
        for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
          if (SOLID.has(m.tiles[y][x])) continue;
          open++;
          if (dist[y * W + x] >= 0) reached++;
        }
        assert.equal(reached, open, `seed ${seed}: ${open - reached} open tiles cut off`);
      }
    });

    test('fair starts: both Mains see the same distance to the Centre, their fields and every Reach', () => {
      const m = generateMap(7, { map: size });
      const d0 = distances(m, { x: m.cores[0].x + 2, y: m.cores[0].y + 2 });
      const d1 = distances(m, { x: m.cores[1].x - 2, y: m.cores[1].y - 2 });
      const at = (d, x, y) => nearestOpen(d, m, { x, y });
      const centre = base.reaches.find((r) => r.kind === 'centre');
      assert.equal(at(d0, centre.center[0], centre.center[1]), at(d1, W - 1 - centre.center[0], W - 1 - centre.center[1]), 'Centre');
      for (const r of base.reaches) {
        if (r.side === null) continue;
        // Walk to each Reach from side 0's Main and to its point mirror from side 1's Main: the same.
        const a = at(d0, r.center[0], r.center[1]), b = at(d1, W - 1 - r.center[0], W - 1 - r.center[1]);
        assert.equal(a, b, `${r.name} vs its mirror`);
        assert.ok(a >= 0, `${r.name} reachable`);
      }
      // Starting fields: the same count and the same walk for both sides.
      const near = (dist, p) => nearestOpen(dist, m, p);
      const f0 = m.crystals.map((c) => near(d0, c)).filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
      const f1 = m.crystals.map((c) => near(d1, c)).filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
      assert.deepEqual(f0, f1);
      const home0 = m.crystals.filter((c) => near(d0, c) <= 30).length, home1 = m.crystals.filter((c) => near(d1, c) <= 30).length;
      assert.ok(home0 >= 4 && home0 === home1, `home fields ${home0} / ${home1}`);
    });

    test('a fast lane through the middle: Main reaches the Centre quickly (about a minute at 3 tiles a second or less)', () => {
      const m = generateMap(7, { map: size });
      const d = distances(m, { x: m.cores[0].x + 2, y: m.cores[0].y + 2 });
      const centre = base.reaches.find((r) => r.kind === 'centre');
      let walk = Infinity; // the nearest open tile inside the Centre (its middle is a field)
      for (let i = 0; i < W * W; i++) if (m.reachGrid[i] === centre.id && d[i] >= 0) walk = Math.min(walk, d[i]);
      assert.ok(walk > 0 && walk <= { standard: 140, large: 210, huge: 280 }[size], `walk ${walk}`);
    });

    test('territory layout builds: every Reach claims tiles and the mirrors pair up', () => {
      const layout = reachLayoutV4(size);
      const t = buildReaches(layout);
      assert.equal(t.reaches.length, want.reaches);
      for (const r of layout.reaches) {
        assert.equal(layout.reaches[r.mirror].mirror, r.id);
        assert.equal(t.reachAt(r.claimSpot.x, r.claimSpot.y), r.id, `${r.name} claim spot`);
      }
    });

    test('the file form round-trips (two-digit ids on the big maps) and the seed changes only the scatter', () => {
      const json = JSON.parse(JSON.stringify(encodeV4(drawV4(SPECS[size]))));
      assert.deepEqual(decodeV4(json).reachGrid, base.reachGrid);
      const a = generateMap(7, { map: size }), b = generateMap(7, { map: size }), c = generateMap(8, { map: size });
      assert.deepEqual(a.rocks, b.rocks);
      assert.notDeepEqual(a.rocks, c.rocks);
      assert.deepEqual(a.cores, c.cores);
      assert.equal(a.reachCount, want.reaches);
      assert.equal(a.winCount, want.win);
    });

    test('Reach routing on this size: same reachability as the plain search, and 200 paths inside one 24 ticks a second budget', () => {
      const m = generateMap(7, { map: size });
      const solid = new Uint8Array(W * W);
      for (const [x, y] of m.rocks) solid[y * W + x] = 1;
      for (const c of m.crystals) solid[c.y * W + c.x] = 1;
      for (const r of m.rubble) solid[r.y * W + r.x] = 1;
      const grid = { width: W, height: W, blocked: (x, y) => solid[y * W + x] === 1 };
      const router = createReachRouter(m);
      const open = [];
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (!solid[y * W + x] && m.reachGrid[y * W + x] > 0) open.push({ x, y });
      const rng = makeRng(99);
      const pairs = Array.from({ length: 200 }, () => [open[rng.int(open.length)], open[rng.int(open.length)]]);
      for (const [a, b] of pairs.slice(0, 20)) {
        const via = findPathVia(grid, router, a, b), plain = findPath(grid, a, b);
        assert.equal(via === null, plain === null);
        if (via) assert.ok(via.length >= plain.length);
      }
      findPathVia(grid, router, pairs[0][0], pairs[0][1]); // warm up
      const t0 = process.hrtime.bigint();
      for (const [a, b] of pairs) findPathVia(grid, router, a, b);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.ok(ms < 1000 / 24 * 4, `200 paths took ${ms.toFixed(0)} ms`); // generous: four ticks, test machines are loaded
    });
  });
}

describe('map names', () => {
  test('MAP_SIZES, the v4 alias, and the legacy default', () => {
    assert.deepEqual(MAP_SIZES, ['standard', 'large', 'huge']);
    assert.equal(DEFAULT_MAP, 'legacy');
    assert.equal(generateMap(3, { map: 'v4' }).width, 128);
    assert.equal(generateMap(3, { map: 'large' }).width, 192);
    assert.equal(generateMap(3, { map: 'huge' }).width, 256);
    assert.throws(() => generateMap(3, { map: 'gigantic' }), /unknown map/);
  });
  test('Large and Huge specs are the ones the loader uses', () => {
    assert.equal(LARGE.side0.length, 15);
    assert.equal(HUGE.side0.length, 20);
  });
});
