// Wheatfield Valley (maps/WHEATFIELD.md): the 256 x 256 point-mirrored map, 31 Reaches, the creek with bridges and
// fords, the Mill Dam, and the territory default. Real modules, nothing stubbed. Owner: sonnet.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, loadMapV4, reachLayoutV4, chosenMap, TERRITORY_DEFAULT_MAP, isTerritoryMap } from '../env/map.mjs';
import { riverWhenDammed, WHEATFIELD } from '../maps/layout-wheatfield.mjs';
import { winCountFor } from '../maps/layout-sizes.mjs';

const W = 256, H = 256, PER_SIDE = 15, DAM = 31;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// Tiles a unit cannot walk: rock, rubble, crystal and creek water.
const SOLID = new Set(['#', 'o', 'S', 'R', '~']);
const CROSSING = new Set(['B', 'f']);

const m = loadMapV4('wheatfield');
const at = (x, y) => m.tiles[y][x];
const idAt = (x, y) => m.reachGrid[y * W + x];
const mirrorXY = (x, y) => ({ x: W - 1 - x, y: H - 1 - y });
const rockAt = (x, y) => at(x, y) === '#' || at(x, y) === '~';

// Ground BFS from a tile, the same ramp rule as the sim: a height step needs a ramp at either end. `blockedKind`
// lets a test close a set of tiles (bridges and fords) and see the answer change.
// `water` is the set of creek tiles still water (default: the base map's whole creek).
function reach(from, { closed = () => false, water = riverWhenDammed(m, false) } = {}) {
  const seen = new Uint8Array(W * H);
  const q = [from.y * W + from.x];
  seen[q[0]] = 1;
  const solid = (x, y) => (at(x, y) === '~' ? water.has(`${x},${y}`) : SOLID.has(at(x, y)));
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !solid(x, y) && !closed(x, y);
  const ramp = (x, y) => at(x, y) === '=' || at(x, y) === '|';
  for (let i = 0; i < q.length; i++) {
    const x = q[i] % W, y = (q[i] / W) | 0;
    for (const [dx, dy] of DIRS) {
      const a = x + dx, b = y + dy;
      if (!open(a, b) || seen[b * W + a]) continue;
      if (m.heights[b][a] !== m.heights[y][x] && !ramp(a, b) && !ramp(x, y)) continue;
      seen[b * W + a] = 1;
      q.push(b * W + a);
    }
  }
  return seen;
}

// Strips of crossing tiles (bridge or ford), grouped by their first column.
function crossings(char) {
  const cols = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) === char) {
    if (!cols.has(x)) cols.set(x, []);
    cols.get(x).push(y);
  }
  return cols;
}

describe('wheatfield map', () => {
  test('is 256 x 256 with 31 Reaches (15 a side and the Mill Dam) and a two-thirds win of 21', () => {
    assert.equal(m.width, W);
    assert.equal(m.height, H);
    assert.equal(m.reaches.length, 2 * PER_SIDE + 1);
    assert.deepEqual(m.reaches.map((r) => r.id), Array.from({ length: 2 * PER_SIDE + 1 }, (_, i) => i + 1));
    assert.equal(winCountFor(31), 21);
    assert.equal(m.winCount, 21);
    assert.equal(m.reaches.find((r) => r.id === DAM).kind, 'dam');
  });

  test('every tile is point-mirrored: same char, height and Reach (side 1 = side 0 + 15, the dam maps to itself)', () => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = mirrorXY(x, y);
      // The Old Windmill is one neutral ruin on the centre line, the only tile the mirror does not copy.
      if (at(x, y) === 'X' || at(k.x, k.y) === 'X') continue;
      assert.equal(at(k.x, k.y), at(x, y), `char at ${x},${y}`);
      assert.equal(m.heights[k.y][k.x], m.heights[y][x], `height at ${x},${y}`);
      const a = idAt(x, y), b = idAt(k.x, k.y);
      if (a === 0 || a >= 32) continue;
      if (a === DAM) assert.equal(b, DAM, `dam at ${x},${y}`);
      else assert.equal(b, a <= PER_SIDE ? a + PER_SIDE : a - PER_SIDE, `Reach at ${x},${y}`);
    }
  });

  test('each side has the planned Reaches: Home, Lower Farm, 2 Golden, 2 Butter, 2 Generator, 2 Creek Banks, 5 Wild', () => {
    const count = (side) => {
      const c = {};
      for (const r of m.reaches.filter((x) => x.side === side)) c[r.kind] = (c[r.kind] || 0) + 1;
      return c;
    };
    const want = { main: 1, natural: 1, golden: 2, butter: 2, generator: 2, creek: 2, wild: 5 };
    assert.deepEqual(count(0), want);
    assert.deepEqual(count(1), want);
    assert.equal(m.reaches.filter((r) => r.side === null).length, 1);
  });

  test('every Reach has an open claim spot inside itself', () => {
    const layout = reachLayoutV4('wheatfield');
    assert.equal(layout.reaches.length, 31);
    for (const r of m.reaches) {
      const spot = layout.reaches.find((x) => x.id === r.id - 1).claimSpot;
      assert.equal(at(spot.x, spot.y), '.', `claim spot of ${r.name}`);
      assert.equal(idAt(spot.x, spot.y), r.id, `claim spot of ${r.name} lies in it`);
    }
  });

  test('Crumb Creek runs corner to corner: water at both ends, through the centre, and every water tile is a rock for movement', () => {
    const water = (x0, y0) => { for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) if (at(x, y) === '~') return true; return false; };
    assert.ok(water(0, 0), 'top-left end');
    assert.ok(water(W - 8, H - 8), 'bottom-right end');
    assert.equal(at(128, 128), '~', 'centre');
    let n = 0;
    const rocks = new Set(generateMap(7, { map: 'wheatfield' }).rocks.map(([x, y]) => `${x},${y}`));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) === '~') { n++; assert.ok(rocks.has(`${x},${y}`), `${x},${y} in rocks`); }
    assert.ok(n > 2000, `creek has ${n} tiles`);
  });

  test('two bridges and two fords cross the creek, each a mirror pair of three-column strips', () => {
    const strips = (char) => [...crossings(char).keys()].sort((p, q) => p - q);
    assert.deepEqual(strips('B'), [52, 53, 54, 201, 202, 203], 'two bridges');
    assert.deepEqual(strips('f'), [88, 89, 90, 165, 166, 167], 'two fords');
    for (const char of ['B', 'f']) for (const x of strips(char)) {
      for (const y of crossings(char).get(x)) assert.ok(!rockAt(x, y), 'a crossing is open ground, not water');
    }
  });

  test('connectivity: the two cores reach each other on foot, and only over bridges or fords', () => {
    const c0 = m.cores[0], c1 = m.cores[1];
    const open = reach(c0);
    assert.ok(open[c1.y * W + c1.x], 'side 0 core reaches side 1 core');
    const closed = reach(c0, { closed: (x, y) => CROSSING.has(at(x, y)) });
    assert.equal(closed[c1.y * W + c1.x], 0, 'with every bridge and ford closed the sides are cut apart');
  });

  test('connectivity: every Reach can be walked to from the cores (no sealed pockets)', () => {
    const seen = reach(m.cores[0]);
    const layout = reachLayoutV4('wheatfield');
    for (const r of m.reaches) {
      if (r.id === DAM) continue;
      const spot = layout.reaches.find((x) => x.id === r.id - 1).claimSpot;
      assert.ok(seen[spot.y * W + spot.x], `${r.name} is reachable`);
    }
  });

  test('each plateau (Home and the two Generator Hills a side) has exactly one ramp gate', () => {
    for (const side of [0, 1]) {
      for (const plateau of m.reaches.filter((r) => r.side === side && r.h === 1)) {
        const ramps = m.gates.filter((g) => g.type === 'ramp' && (g.a === plateau.id || g.b === plateau.id));
        assert.equal(ramps.length, 1, `${plateau.name} ramps`);
      }
    }
  });

  test('fair starts: 6 Workers each, a starter well and wheat in Home, the same wheat, gold and vents a side, the same walk to a crossing', () => {
    const sum = (side, char) => {
      let n = 0;
      for (const r of m.reaches.filter((x) => x.side === side)) {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (idAt(x, y) === r.id && at(x, y) === char) n++;
      }
      return n;
    };
    for (const ch of ['S', 'R', 'L']) assert.equal(sum(0, ch), sum(1, ch), `${ch} tiles a side`);
    assert.equal(m.workers[0].length, 6);
    assert.equal(m.workers[1].length, 6);
    for (const side of [0, 1]) {
      const home = m.reaches.find((r) => r.side === side && r.kind === 'main').id;
      let wells = 0, wheat = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (idAt(x, y) === home) {
        if (at(x, y) === 'U') wells++;
        if (at(x, y) === 'S') wheat++;
      }
      assert.equal(wells, 1, `side ${side} starter well`);
      assert.ok(wheat >= 8, `side ${side} starter wheat (${wheat})`);
    }
    const walk = (core) => {
      const seen = reach(core);
      let best = Infinity;
      for (const [x, ys] of [...crossings('B'), ...crossings('f')]) for (const y of ys) {
        for (const [dx, dy] of DIRS) {
          const a = x + dx, b = y + dy;
          if (seen[b * W + a]) best = Math.min(best, Math.abs(a - core.x) + Math.abs(b - core.y));
        }
      }
      return best;
    };
    assert.ok(Number.isFinite(walk(m.cores[0])));
    assert.ok(Math.abs(walk(m.cores[0]) - walk(m.cores[1])) <= 2, 'crossing is equally near both cores');
  });

  test('the Mill Dam: its gap is water on the centre line, its rock slots are rocks beside the gap, and the Reach holds both', () => {
    const dam = m.extras.dam;
    assert.equal(dam.gap.length, 4);
    for (const [x, y] of dam.gap) {
      assert.equal(at(x, y), '~');
      assert.equal(idAt(x, y), DAM);
    }
    assert.equal(dam.rockSlots.length, 6);
    for (const [x, y] of dam.rockSlots) {
      assert.ok(rockAt(x, y), `slot ${x},${y} holds a rock`);
      assert.ok(dam.gap.some(([gx, gy]) => Math.abs(gx - x) <= 4 && Math.abs(gy - y) <= 4), `slot ${x},${y} is on the bank by the gap`);
    }
    assert.ok(m.extras.ruins.length === 1, 'the Old Windmill is one neutral ruin');
  });

  test('the dam changes the river: built, the lowered stretch becomes fords and the two banks join on foot', () => {
    const lowered = m.extras.dam.lowered;
    assert.ok(lowered.length >= 9, 'a real stretch of river');
    for (const [x, y] of lowered) assert.equal(at(x, y), '~');
    const before = riverWhenDammed(m, false);
    const after = riverWhenDammed(m, true);
    assert.equal(before.size - after.size, lowered.length, 'the lowered tiles leave the water');
    for (const [x, y] of lowered) assert.ok(!after.has(`${x},${y}`));
    const c0 = m.cores[0], c1 = m.cores[1];
    const shut = { closed: (x, y) => CROSSING.has(at(x, y)) };
    assert.equal(reach(c0, { ...shut, water: before })[c1.y * W + c1.x], 0, 'no dam: bridges and fords shut, the sides are cut');
    assert.equal(reach(c0, { ...shut, water: after })[c1.y * W + c1.x], 1, 'dam built: the lowered stretch is a new way across');
  });

  test('the Reach graph joins all 31 Reaches (gates link every Reach to the rest)', () => {
    const links = new Map(m.reaches.map((r) => [r.id, new Set()]));
    for (const g of m.gates) { links.get(g.a)?.add(g.b); links.get(g.b)?.add(g.a); }
    const seen = new Set([1]);
    const stack = [1];
    while (stack.length) for (const n of links.get(stack.pop())) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    assert.equal(seen.size, 31);
  });

  test('generateMap(seed, { map: "wheatfield" }) is deterministic per seed, keeps water as rock, and varies with the seed', () => {
    const a = generateMap(7, { map: 'wheatfield' }), b = generateMap(7, { map: 'wheatfield' }), c = generateMap(8, { map: 'wheatfield' });
    assert.equal(a.width, W);
    assert.equal(a.reaches.length, 31);
    assert.deepEqual(a.rocks, b.rocks);
    assert.notDeepEqual(a.rocks, c.rocks);
    assert.ok(a.rocks.some(([x, y]) => at(x, y) === '~'));
  });

  test('the territory match plays Wheatfield by default; ?map=v4 and the other names still work', () => {
    assert.equal(TERRITORY_DEFAULT_MAP, 'wheatfield');
    assert.ok(isTerritoryMap('wheatfield'));
    assert.equal(WHEATFIELD.name, 'wheatfield');
    assert.equal(chosenMap({ territory: true }), process.env.DRIFTFALL_MAP || 'wheatfield');
    assert.equal(generateMap(3, { map: 'v4' }).width, 128);
  });
});
