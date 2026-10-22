// Path-finding tests for env/path.mjs (ENV-SPEC.md §6 and §14).
//
//   findPath({ width, height, blocked(x, y) }, from, to, { within = 0 }) -> [{x, y}, ...] or null
//
// The result is the list of steps, start excluded. Movement is 4-directional. "within" uses the
// game's distance (max of |dx| and |dy|), so within=1 means any of the 8 neighbours.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../env/path.mjs';

// ---------- helpers ----------

const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const key = (x, y) => `${x},${y}`;

// Build a grid whose blocked tiles are the given list of [x, y] pairs.
function grid(width, height, blockedTiles = []) {
  const set = new Set(blockedTiles.map(([x, y]) => key(x, y)));
  return { width, height, blocked: (x, y) => set.has(key(x, y)), set };
}

// Check the structural promises every path has to keep: it is an array of integer tiles inside the
// map, no tile is blocked, the first step touches the start, and every step is one 4-way move.
function assertWellFormed(map, from, path, label = '') {
  assert.ok(Array.isArray(path), `${label} path should be an array`);
  let prev = from;
  for (const [i, step] of path.entries()) {
    assert.ok(Number.isInteger(step.x) && Number.isInteger(step.y), `${label} step ${i} has integer coords`);
    assert.ok(step.x >= 0 && step.x < map.width && step.y >= 0 && step.y < map.height,
      `${label} step ${i} (${step.x},${step.y}) is inside the map`);
    assert.equal(map.blocked(step.x, step.y), false, `${label} step ${i} (${step.x},${step.y}) must not be blocked`);
    assert.equal(manhattan(prev, step), 1,
      `${label} step ${i} (${step.x},${step.y}) must be one 4-way move from (${prev.x},${prev.y})`);
    prev = step;
  }
}

const last = (path) => path[path.length - 1];

// ---------- straight lines ----------

test('a straight horizontal path has one step per tile and ends on the goal', () => {
  const map = grid(10, 10);
  const from = { x: 0, y: 0 }, to = { x: 5, y: 0 };
  const path = findPath(map, from, to, { within: 0 });
  assertWellFormed(map, from, path, 'horizontal');
  assert.equal(path.length, 5);
  assert.deepEqual(path, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }]);
});

test('a straight vertical path has the right length and excludes the start', () => {
  const map = grid(10, 10);
  const from = { x: 3, y: 7 }, to = { x: 3, y: 1 };
  const path = findPath(map, from, to, { within: 0 });
  assertWellFormed(map, from, path, 'vertical');
  assert.equal(path.length, 6);
  assert.ok(!path.some((p) => p.x === from.x && p.y === from.y), 'start tile is not in the path');
  assert.deepEqual(last(path), to);
});

test('on an open grid a diagonal goal takes exactly the Manhattan distance', () => {
  const map = grid(12, 12);
  const from = { x: 2, y: 3 }, to = { x: 6, y: 8 };
  const path = findPath(map, from, to, { within: 0 });
  assertWellFormed(map, from, path, 'diagonal');
  assert.equal(path.length, manhattan(from, to));
  assert.deepEqual(last(path), to);
});

test('asking for a path from a tile to itself gives an empty list, not null', () => {
  const map = grid(5, 5);
  const path = findPath(map, { x: 2, y: 2 }, { x: 2, y: 2 }, { within: 0 });
  assert.deepEqual(path, []);
});

// ---------- going around a wall ----------

test('a path goes around a wall through the only gap', () => {
  // Wall down column 5 with the single gap at y = 9.
  const wall = [];
  for (let y = 0; y < 9; y++) wall.push([5, y]);
  const map = grid(10, 10, wall);
  const from = { x: 2, y: 0 }, to = { x: 8, y: 0 };
  const path = findPath(map, from, to, { within: 0 });
  assertWellFormed(map, from, path, 'wall');
  assert.deepEqual(last(path), to);
  // Down 9, across 6, up 9 is the shortest way round.
  assert.equal(path.length, 24);
  assert.ok(path.some((p) => p.x === 5 && p.y === 9), 'the path must pass through the gap at (5,9)');
});

test('a path takes the shorter of two detours around a wall', () => {
  // Wall down column 4 from y = 1 to y = 9; gaps at y = 0 and y = 10. Start near the top so the
  // top gap is closer.
  const wall = [];
  for (let y = 1; y <= 9; y++) wall.push([4, y]);
  const map = grid(9, 11, wall);
  const from = { x: 1, y: 2 }, to = { x: 7, y: 2 };
  const path = findPath(map, from, to, { within: 0 });
  assertWellFormed(map, from, path, 'two-gaps');
  assert.deepEqual(last(path), to);
  // Up 2, across 6, down 2 = 10 (the bottom gap would cost 8 + 6 + 8 = 22).
  assert.equal(path.length, 10);
  assert.ok(path.some((p) => p.x === 4 && p.y === 0), 'the path uses the top gap');
});

// ---------- within = 1 next to a blocked goal ----------

test('within=1 stops on the tile just before a blocked goal', () => {
  const map = grid(10, 10, [[5, 5]]);
  const from = { x: 0, y: 5 }, to = { x: 5, y: 5 };
  const path = findPath(map, from, to, { within: 1 });
  assertWellFormed(map, from, path, 'within1');
  assert.equal(path.length, 4);
  assert.deepEqual(last(path), { x: 4, y: 5 });
  assert.equal(dist(last(path), to), 1);
});

test('within=1 accepts a diagonal neighbour when the four side neighbours are blocked', () => {
  // Goal and its four orthogonal neighbours are blocked (think: a crystal tile hemmed in by rock).
  const map = grid(10, 10, [[5, 5], [5, 4], [6, 5], [5, 6], [4, 5]]);
  const from = { x: 0, y: 0 }, to = { x: 5, y: 5 };
  const path = findPath(map, from, to, { within: 1 });
  assertWellFormed(map, from, path, 'diagonal-neighbour');
  const end = last(path);
  assert.equal(dist(end, to), 1, 'ends within distance 1 (max of dx, dy) of the goal');
  assert.equal(map.blocked(end.x, end.y), false);
  // (4,4) is the nearest tile at distance 1: 8 steps from (0,0).
  assert.equal(path.length, 8);
  assert.deepEqual(end, { x: 4, y: 4 });
});

test('within=1 when already adjacent to the goal gives an empty list', () => {
  const map = grid(10, 10, [[5, 5]]);
  const path = findPath(map, { x: 4, y: 4 }, { x: 5, y: 5 }, { within: 1 });
  assert.deepEqual(path, []);
});

// ---------- within = 4 stops at range ----------

test('within=4 stops as soon as the goal is 4 tiles away in a straight line', () => {
  const map = grid(20, 20);
  const from = { x: 0, y: 0 }, to = { x: 10, y: 0 };
  const path = findPath(map, from, to, { within: 4 });
  assertWellFormed(map, from, path, 'range4-line');
  assert.equal(path.length, 6);
  assert.deepEqual(last(path), { x: 6, y: 0 });
  assert.equal(dist(last(path), to), 4);
});

test('within=4 towards a diagonal goal stops on the nearest tile at range using max(dx, dy)', () => {
  const map = grid(20, 20);
  const from = { x: 0, y: 0 }, to = { x: 10, y: 10 };
  const path = findPath(map, from, to, { within: 4 });
  assertWellFormed(map, from, path, 'range4-diag');
  const end = last(path);
  assert.equal(dist(end, to), 4, 'ends exactly at range 4');
  // Any tile with x >= 6 and y >= 6 is in range; the nearest such tile is 12 steps away.
  assert.equal(path.length, 12);
  for (const step of path.slice(0, -1)) {
    assert.ok(dist(step, to) > 4, `step (${step.x},${step.y}) before the end must still be out of range`);
  }
});

test('within=4 when the goal is already in range gives an empty list', () => {
  const map = grid(20, 20);
  const path = findPath(map, { x: 3, y: 3 }, { x: 7, y: 1 }, { within: 4 });
  assert.deepEqual(path, []);
});

test('within=4 still routes around rock to reach range', () => {
  // A wall between start and goal; the unit must walk round it before it can be in range.
  const wall = [];
  for (let y = 0; y < 15; y++) wall.push([8, y]);
  const map = grid(20, 16, wall);
  const from = { x: 2, y: 2 }, to = { x: 14, y: 2 };
  const path = findPath(map, from, to, { within: 4 });
  assertWellFormed(map, from, path, 'range4-wall');
  assert.equal(dist(last(path), to), 4);
  assert.ok(path.some((p) => p.x === 8 && p.y === 15), 'passes through the gap at the bottom');
});

// ---------- unreachable goals ----------

test('a goal walled off on all sides returns null', () => {
  const ring = [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]];
  const map = grid(10, 10, ring);
  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 5, y: 5 }, { within: 0 }), null);
});

test('a start walled off on all sides returns null', () => {
  const ring = [[0, 1], [1, 1], [1, 0]];
  const map = grid(10, 10, ring);
  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 9, y: 9 }, { within: 0 }), null);
});

test('a blocked goal with within=0 returns null', () => {
  const map = grid(10, 10, [[5, 5]]);
  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 5, y: 5 }, { within: 0 }), null);
});

test('within=1 returns null when every tile around the goal is unreachable', () => {
  // Goal at (5,5); a 5x5 ring of rock around it keeps every neighbour out of reach.
  const ring = [];
  for (let x = 3; x <= 7; x++) for (let y = 3; y <= 7; y++) {
    if (x === 3 || x === 7 || y === 3 || y === 7) ring.push([x, y]);
  }
  const map = grid(12, 12, ring);
  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 5, y: 5 }, { within: 1 }), null);
});

test('a map split in two by a full wall makes the far side unreachable', () => {
  const wall = [];
  for (let y = 0; y < 10; y++) wall.push([5, y]);
  const map = grid(10, 10, wall);
  assert.equal(findPath(map, { x: 1, y: 1 }, { x: 8, y: 8 }, { within: 0 }), null);
  assert.equal(findPath(map, { x: 1, y: 1 }, { x: 8, y: 8 }, { within: 2 }), null);
});

// ---------- determinism ----------

test('the same question returns the same path every time', () => {
  const rocks = [];
  // A deterministic scatter of rocks with lots of equal-length alternatives.
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
    if ((x * 7 + y * 13) % 5 === 0 && !(x === 0 && y === 0) && !(x === 15 && y === 15)) rocks.push([x, y]);
  }
  const map = grid(16, 16, rocks);
  const from = { x: 0, y: 0 }, to = { x: 15, y: 15 };
  const first = findPath(map, from, to, { within: 0 });
  assert.ok(first !== null, 'the scatter map should still be solvable');
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(findPath(map, from, to, { within: 0 }), first, `run ${i + 1} differs`);
  }
  // Also for a range query.
  const ranged = findPath(map, from, to, { within: 3 });
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(findPath(map, from, to, { within: 3 }), ranged, `ranged run ${i + 1} differs`);
  }
});

test('ties are broken by the fixed neighbour order up, right, down, left', () => {
  // From (0,0) to (2,2) on an open grid there are six shortest paths. Breadth-first search that
  // explores up, right, down, left and records the first parent finds: right, right, down, down.
  const map = grid(5, 5);
  const path = findPath(map, { x: 0, y: 0 }, { x: 2, y: 2 }, { within: 0 });
  assertWellFormed(map, { x: 0, y: 0 }, path, 'tie-break');
  assert.deepEqual(path, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }]);
});

test('the path does not depend on object identity of the inputs', () => {
  const map = grid(8, 8, [[3, 3], [3, 4]]);
  const a = findPath(map, { x: 0, y: 0 }, { x: 7, y: 7 }, { within: 0 });
  const b = findPath(grid(8, 8, [[3, 3], [3, 4]]), { x: 0, y: 0 }, { x: 7, y: 7 }, { within: 0 });
  assert.deepEqual(a, b);
});

// ---------- never stepping on a blocked tile ----------

test('across many start and goal pairs a path never steps on a blocked tile or leaves the map', () => {
  const rocks = [];
  for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) {
    if ((x * 7 + y * 13 + (x ^ y)) % 5 === 0) rocks.push([x, y]);
  }
  const map = grid(20, 20, rocks);
  const open = [];
  for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) if (!map.blocked(x, y)) open.push({ x, y });
  assert.ok(open.length > 100, 'scatter map keeps plenty of open tiles');

  let found = 0;
  for (let i = 0; i < open.length; i += 7) {
    for (let j = 0; j < open.length; j += 11) {
      const from = open[i], to = open[j];
      for (const within of [0, 1, 4]) {
        const path = findPath(map, from, to, { within });
        if (path === null) continue;
        found++;
        assertWellFormed(map, from, path, `(${from.x},${from.y})->(${to.x},${to.y}) within ${within}`);
        const end = path.length ? last(path) : from;
        assert.ok(dist(end, to) <= within, `ends within ${within} of the goal`);
        if (within === 0) assert.deepEqual(end, to);
      }
    }
  }
  assert.ok(found > 0, 'at least some pairs should be reachable');
});

test('blocked() is never asked about tiles outside the map', () => {
  // The grid should stay inside its bounds without relying on blocked() to say no.
  const asked = [];
  const map = {
    width: 6,
    height: 6,
    blocked: (x, y) => { asked.push([x, y]); return false; },
  };
  const path = findPath(map, { x: 0, y: 0 }, { x: 5, y: 5 }, { within: 0 });
  assert.ok(Array.isArray(path));
  const outside = asked.filter(([x, y]) => x < 0 || y < 0 || x >= 6 || y >= 6);
  assert.deepEqual(outside, [], 'blocked() was called with off-map coordinates');
});

test('a range path never steps onto a blocked tile even when the goal is blocked', () => {
  // Goal is a blocked tile with a mixed neighbourhood; within=1 must end on a free neighbour.
  const map = grid(10, 10, [[5, 5], [4, 5], [5, 4], [6, 6]]);
  const from = { x: 9, y: 9 }, to = { x: 5, y: 5 };
  const path = findPath(map, from, to, { within: 1 });
  assertWellFormed(map, from, path, 'blocked-goal-range');
  const end = last(path);
  assert.equal(dist(end, to), 1);
  assert.equal(map.blocked(end.x, end.y), false);
});

// ---------- the real map, when it is available ----------

test('on a generated map every open tile is reachable and paths avoid rock and crystal', async (t) => {
  let generateMap;
  try {
    ({ generateMap } = await import('../env/map.mjs'));
  } catch {
    t.skip('env/map.mjs is not written yet');
    return;
  }
  const m = generateMap(7);
  const blockedSet = new Set([
    ...m.rocks.map(([x, y]) => key(x, y)),
    ...m.crystals.map((c) => key(c.x, c.y)),
  ]);
  const map = { width: m.width, height: m.height, blocked: (x, y) => blockedSet.has(key(x, y)) };
  const core0 = m.cores[0], core1 = m.cores[1];
  const w0 = m.workers[0][0];

  // Worker to a tile next to the own Core, next to the enemy Core, and next to a crystal tile.
  for (const [to, within, label] of [
    [core0, 1, 'own core'],
    [core1, 1, 'enemy core'],
    [m.crystals[0], 1, 'crystal'],
    [{ x: m.width - 1 - w0.x, y: m.height - 1 - w0.y }, 0, 'mirror tile'],
  ]) {
    const path = findPath(map, w0, to, { within });
    assert.ok(path !== null, `${label} should be reachable`);
    assertWellFormed(map, w0, path, label);
    const end = path.length ? last(path) : w0;
    assert.ok(dist(end, to) <= within, `${label}: ends within ${within}`);
  }
});
