// Tests for the 128 x 128 Reach map (TERRITORY.md section 2): maps/layout-v4.mjs, maps/driftfall-v4.json and the
// v4 branch of env/map.mjs. Real modules, nothing stubbed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { drawV4, encodeV4, decodeV4, scatterV4, W, H, GATE_BASE, CENTRE_ID } from '../maps/layout-v4.mjs';
import { generateMap, loadMapV4, DEFAULT_MAP } from '../env/map.mjs';

const SEEDS = [1, 2, 7, 42, 1234, 2026];
const SOLID = new Set(['#', 'o', 'S', 'R']);
const mirror = (x, y) => [W - 1 - x, H - 1 - y];
// Ids map to the other side: 1..10 <-> 11..20, Centre and "none" stay, gates only need to stay gates.
const mirrorId = (id) => (id >= 1 && id <= 10 ? id + 10 : id >= 11 && id <= 20 ? id - 10 : id >= GATE_BASE ? GATE_BASE : id);

const base = loadMapV4();

// Ground distance (4-way steps) from a tile to every tile; a step between heights needs a ramp tile on either end.
function distances(m, from) {
  const dist = new Int32Array(W * H).fill(-1);
  const q = [from.y * W + from.x];
  dist[q[0]] = 0;
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !SOLID.has(m.tiles[y][x]);
  const ramp = (x, y) => m.tiles[y][x] === '=' || m.tiles[y][x] === '|';
  for (let h = 0; h < q.length; h++) {
    const x = q[h] % W, y = (q[h] / W) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const a = x + dx, b = y + dy;
      if (!open(a, b) || dist[b * W + a] >= 0) continue;
      if (m.heights[b][a] !== m.heights[y][x] && !ramp(a, b) && !ramp(x, y)) continue;
      dist[b * W + a] = dist[y * W + x] + 1;
      q.push(b * W + a);
    }
  }
  return dist;
}
// Fields and vents are solid; measure to the nearest open neighbour.
const reachTo = (dist, p) => {
  let best = Infinity;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const d = dist[(p.y + dy) * W + p.x + dx];
    if (d >= 0 && d < best) best = d;
  }
  return best;
};

describe('v4 layout', () => {
  test('is 128 x 128 with 21 Reaches: 10 per side and the Centre', () => {
    assert.equal(base.width, 128);
    assert.equal(base.height, 128);
    assert.equal(base.reaches.length, 21);
    assert.deepEqual(base.reaches.map((r) => r.id), Array.from({ length: 21 }, (_, i) => i + 1));
    for (const side of [0, 1]) {
      const kinds = base.reaches.filter((r) => r.side === side).map((r) => r.kind).sort();
      assert.deepEqual(kinds, ['flank', 'main', 'mesa', 'natural', 'outer', 'outer', 'pocket', 'rich', 'vent', 'vent']);
    }
    assert.equal(base.reaches.find((r) => r.id === CENTRE_ID).kind, 'centre');
    assert.equal(new Set(base.reaches.map((r) => r.name + r.side)).size, 21);
  });

  test('every layer is point-mirrored: tiles, heights, Reach ids, cores, workers, gates', () => {
    for (const m of [base, ...SEEDS.map((s) => scatterV4(base, s))]) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const [a, b] = mirror(x, y);
        const t = m.tiles[y][x], u = m.tiles[b][a];
        assert.equal(u, t === '=' || t === '|' ? t : t, `tile ${x},${y}`);
        assert.equal(m.heights[b][a], m.heights[y][x], `height ${x},${y}`);
        const here = m.reachGrid[y * W + x];
        assert.equal(here >= GATE_BASE ? GATE_BASE : here, mirrorId(m.reachGrid[b * W + a]), `reach id ${x},${y}`);
      }
    }
    assert.deepEqual(base.cores[1], { x: W - 1 - base.cores[0].x, y: H - 1 - base.cores[0].y });
    assert.deepEqual(base.workers[1], base.workers[0].map((p) => ({ x: W - 1 - p.x, y: H - 1 - p.y })));
    assert.equal(base.gates.length % 2, 0);
  });

  test('Reaches are separate rooms: different ids never touch except through a gate', () => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const id = base.reachGrid[y * W + x];
      if (id === 0 || id >= GATE_BASE) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const o = base.reachGrid[(y + dy) * W + x + dx];
        assert.ok(o === 0 || o === id || o >= GATE_BASE, `Reach ${id} touches Reach ${o} at ${x},${y}`);
      }
    }
  });

  test('every gate joins two Reaches: floor of both Reaches sits at both ends, ramps join plateau to lowland', () => {
    const byId = new Map(base.reaches.map((r) => [r.id, r]));
    for (const g of base.gates) {
      const ends = new Set();
      for (const [x, y] of g.cells) {
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const id = base.reachGrid[(y + dy) * W + x + dx];
          if (id > 0 && id < GATE_BASE) ends.add(id);
        }
      }
      assert.deepEqual([...ends].sort((a, b) => a - b), [g.a, g.b].sort((a, b) => a - b), `gate ${g.id}`);
      const plateaus = [g.a, g.b].filter((id) => byId.get(id).height === 1).length;
      if (g.type === 'ramp') assert.ok(plateaus >= 1, `ramp gate ${g.id} touches no plateau`);
      else assert.equal(plateaus, 0, `floor gate ${g.id} touches a plateau`);
    }
    for (const r of base.reaches) assert.ok(r.gates.length >= 2, `${r.name} ${r.side} has ${r.gates.length} gates`);
    const mains = base.reaches.filter((r) => r.kind === 'main');
    for (const r of mains) assert.equal(r.gates.length, 2, 'a Quake can close one main ramp, the other stays');
  });

  test('fields and vents sit inside Reaches, away from gates', () => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!'SRL'.includes(base.tiles[y][x])) continue;
      const id = base.reachGrid[y * W + x];
      assert.ok(id >= 1 && id <= 21, `field at ${x},${y} is outside every Reach`);
      for (const g of base.gates) for (const [gx, gy] of g.cells) {
        assert.ok(Math.max(Math.abs(gx - x), Math.abs(gy - y)) >= 3, `field ${x},${y} blocks gate ${g.id}`);
      }
    }
  });
});

describe('v4 ground reachability and fair starts', () => {
  for (const seed of SEEDS) {
    test(`seed ${seed}: every Reach is reachable on foot from both Mains, and every open tile is connected`, () => {
      const m = scatterV4(base, seed);
      for (const core of base.cores) {
        const dist = distances(m, core);
        for (const r of base.reaches) {
          const open = [];
          for (let y = r.rect[1]; y <= r.rect[3]; y++) for (let x = r.rect[0]; x <= r.rect[2]; x++) {
            if (m.reachGrid[y * W + x] === r.id && !SOLID.has(m.tiles[y][x])) open.push([x, y]);
          }
          assert.ok(open.length > 100, `${r.name} has room`);
          assert.ok(open.every(([x, y]) => dist[y * W + x] >= 0), `${r.name} (${r.side}) fully reachable`);
        }
        for (let i = 0; i < W * H; i++) {
          const x = i % W, y = (i / W) | 0;
          if (!SOLID.has(m.tiles[y][x])) assert.ok(dist[i] >= 0, `open tile ${x},${y} cut off`);
        }
      }
    });

    test(`seed ${seed}: start bases are fair (same walk to fields, vents and the Centre)`, () => {
      const m = scatterV4(base, seed);
      const d0 = distances(m, base.cores[0]), d1 = distances(m, base.cores[1]);
      const sorted = (list) => list.slice().sort((a, b) => a - b);
      for (const ch of ['S', 'R', 'L']) {
        const pts = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m.tiles[y][x] === ch) pts.push({ x, y });
        const from0 = sorted(pts.map((p) => reachTo(d0, p))), from1 = sorted(pts.map((p) => reachTo(d1, p)));
        assert.deepEqual(from0, from1, `${ch}: distance lists differ between the two starts`);
      }
      // Centre rich field: the nearest rich tile of the Centre is equally far for both.
      const rich = [];
      for (let y = 62; y < 66; y++) for (let x = 62; x < 66; x++) rich.push({ x, y });
      assert.equal(Math.min(...rich.map((p) => reachTo(d0, p))), Math.min(...rich.map((p) => reachTo(d1, p))));
      // Each side has the same number of fields in its own half.
      assert.equal(d0[base.cores[1].y * W + base.cores[1].x], d1[base.cores[0].y * W + base.cores[0].x]);
    });
  }

  test('Main to Main is a long walk (at least 150 steps) and the Mains are plateaus', () => {
    const d = distances(base, base.cores[0]);
    const far = d[base.cores[1].y * W + base.cores[1].x];
    assert.ok(far >= 150 && far < 400, `Main to Main is ${far} steps`);
    for (const c of base.cores) assert.equal(base.heights[c.y][c.x], 1);
  });
});

describe('v4 seed scatter and the JSON file', () => {
  test('same seed, same map; different seeds scatter differently; scatter stays inside Reaches and off fields', () => {
    const a = scatterV4(base, 7), b = scatterV4(base, 7), c = scatterV4(base, 8);
    assert.deepEqual(a.tiles, b.tiles);
    assert.notDeepEqual(a.tiles, c.tiles);
    assert.ok(a.scatter.rocks > 100 && a.scatter.rubble > 20, JSON.stringify(a.scatter));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = a.tiles[y][x];
      if (t === base.tiles[y][x]) continue;
      assert.ok(t === '#' || t === 'o');
      assert.equal(base.tiles[y][x], '.');
      const id = base.reachGrid[y * W + x];
      assert.ok(id >= 1 && id <= 21, 'scatter only inside Reaches (never in a gate)');
    }
  });

  test('maps/driftfall-v4.json is the output of the layout (run node maps/build-v4.mjs after editing the layout)', () => {
    const file = JSON.parse(fs.readFileSync(new URL('../maps/driftfall-v4.json', import.meta.url), 'utf8'));
    assert.equal(file.version, 4);
    assert.deepEqual(file, JSON.parse(JSON.stringify(encodeV4(drawV4()))));
    assert.deepEqual(decodeV4(file).reachGrid, base.reachGrid);
  });

  test('generateMap(seed, { map: "v4" }) keeps the shape the sim reads and adds the Reach layers', () => {
    const m = generateMap(7, { map: 'v4' });
    assert.equal(m.width, 128);
    assert.deepEqual(m.cores, base.cores);
    assert.equal(m.workers[0].length, 6);
    assert.equal(m.crystals.length, 136);
    assert.equal(m.crystals.filter((c) => c.rich).length, 40);
    assert.ok(m.crystals.every((c) => c.amount === (c.rich ? 800 : 400)));
    assert.equal(m.vents.length, 20);
    assert.ok(m.rocks.every(([x, y]) => x >= 0 && y >= 0 && x < 128 && y < 128));
    assert.equal(m.reaches.length, 21);
    assert.equal(m.reachGrid.length, 128 * 128);
    assert.deepEqual(generateMap(7, { map: 'v4' }).rocks, m.rocks);
  });

  test('the default stays the current 32 x 32 game until the sim is moved; unknown names throw', () => {
    assert.equal(DEFAULT_MAP, 'legacy');
    assert.equal(generateMap(3).width, 32);
    assert.throws(() => generateMap(3, { map: 'nope' }), /unknown map/);
  });
});
