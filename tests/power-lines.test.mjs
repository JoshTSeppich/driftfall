// Power Stations and lines (POWER-NETWORK.md step 1). Owner: sonnet. Pure graph tests, no sim ticks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { enablePower, buildLines, linkReach, cordLength, supercover, lineOfSight, liveGroundLines, lineKey } from '../env/power.mjs';

export function world(points, rocks = []) {
  const state = createTestState({
    width: 60, height: 40, rocks,
    structures: [{ id: 1, owner: 0, kind: 'core', x: 5, y: 5 }, { id: 2, owner: 1, kind: 'core', x: 54, y: 34 }],
  });
  enablePower(state);
  state.power.points.push(...points);
  return state;
}
export const pt = (id, owner, kind, x, y) => ({ id, owner, kind, x, y, range: 0 });

test('a link spans only the smaller reach; pylons reach far only pylon to pylon', () => {
  assert.equal(linkReach({ kind: 'strip' }, { kind: 'extension' }), 8);
  assert.equal(linkReach({ kind: 'pylon' }, { kind: 'pylon' }), 16);
  assert.equal(linkReach({ kind: 'pylon' }, { kind: 'strip' }), 8);
  assert.equal(linkReach({ kind: 'pylon' }, { kind: 'bogus' }), 0);
  const g = buildLines(world([pt(10, 0, 'extension', 14, 5), pt(11, 0, 'extension', 23, 5)]));
  assert.equal(g.lines.length, 0, 'strip(5)-box(14) is 9 > 8 and box-box is 9 > 8: nothing links');
});

test('strip to extension within 6 links; extension chain stays lit', () => {
  const g = buildLines(world([pt(10, 0, 'extension', 10, 5), pt(11, 0, 'extension', 15, 5)]));
  assert.deepEqual(g.lines.map((l) => [l.a.id, l.b.id, l.type]), [[1, 10, 'ground'], [10, 11, 'ground']]);
  assert.ok(g.lit.has(11));
});

test('each station links to its nearest three; cycles are allowed and power links never block', () => {
  const g = buildLines(world([pt(10, 0, 'extension', 9, 5), pt(11, 0, 'extension', 9, 7)]));
  const pairs = g.lines.map((l) => l.a.id + '-' + l.b.id);
  assert.deepEqual(pairs, ['1-10', '1-11', '10-11'], 'a triangle: the old shared-neighbour rule is gone');
  const crowd = buildLines(world([10, 11, 12, 13, 14].map((id, i) => pt(id, 0, 'extension', 6 + i, 8))));
  for (const st of crowd.stations.filter((q) => q.owner === 0)) {
    const picks = crowd.lines.filter((l) => l.a.id === st.id || l.b.id === st.id).length;
    assert.ok(picks >= 1, 'every station is linked');
  }
  assert.ok(crowd.lines.length <= 3 * crowd.stations.length, 'at most K=3 picks per station');
});

test('ground lines need line of sight', () => {
  const s = world([pt(10, 0, 'extension', 12, 5)], [[10, 4], [10, 5], [10, 6]]);
  assert.equal(lineOfSight(s, { x: 5, y: 5 }, { x: 12, y: 5 }), false);
  assert.equal(buildLines(s).lines.length, 0);
});

test('high lines hop rocks and never count as ground lines', () => {
  const s = world([pt(10, 0, 'pylon', 5, 9), pt(11, 0, 'pylon', 5, 22)], [[5, 15], [4, 15], [6, 15]]);
  const g = buildLines(s);
  assert.ok(g.lines.some((l) => l.a.id === 10 && l.b.id === 11 && l.type === 'high'));
  assert.ok(g.lines.every((l) => l.type === 'high'), 'strip-pylon is a high line too');
  assert.equal(liveGroundLines(g).length, 0);
});

test('a fence is an explicit order; a dark network drops it (brown-out is local)', () => {
  const s = world([pt(30, 0, 'extension', 40, 30), pt(31, 0, 'extension', 46, 30)]);
  const g = buildLines(s);
  assert.equal(g.lines.length, 1);
  s.power.fenceLinks.add(lineKey(30, 31));
  assert.equal(liveGroundLines(g, s).length, 0, 'no energy on that network: dark');
  s.power.points.push(pt(32, 0, 'windmill', 50, 30));
  const lit = buildLines(s);
  assert.equal(liveGroundLines(lit, s).length, 1, 'a windmill lights it');
  s.power.fenceLinks.clear();
  assert.equal(liveGroundLines(lit, s).length, 0, 'a power link that was not ordered as a fence is not a wall');
});

test('supercover is 4-connected with both sides at an exact corner', () => {
  assert.deepEqual(supercover({ x: 0, y: 0 }, { x: 3, y: 0 }), [[0, 0], [1, 0], [2, 0], [3, 0]]);
  const d = supercover({ x: 0, y: 0 }, { x: 2, y: 2 }).map((t) => t.join());
  assert.ok(d.includes('1,0') && d.includes('0,1'));
});

test('cord length goes through a lookup that knows the Toastinator names', () => {
  assert.equal(cordLength('worker'), cordLength('crumb'));
  assert.equal(cordLength('brute'), cordLength('four-slice'));
  assert.equal(cordLength('mystery'), 8);
});
