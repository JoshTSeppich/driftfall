// Fence orders, enclosure and softlock rules (POWER-NETWORK.md sections 6-7 and 11). Owner: sonnet. Tests first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { enablePower, buildLines } from '../env/power.mjs';
import {
  enableFences, stepFences, setFence, placementVerdict, fencedBonus, fencedTiles, fenceUpkeep, fenceTiles,
  ENCLOSURE_HOLD, ENCLOSURE_WHEAT,
} from '../env/fence.mjs';

const pt = (id, owner, kind, x, y) => ({ id, owner, kind, x, y, range: 0 });
const unitAt = (id, owner, kind, x, y) => ({ id, owner, kind, x, y, hp: 40, order: null, carrying: 0 });

function world({ cores, points = [], rocks = [], units = [], size = 40 } = {}) {
  const state = createTestState({
    width: size, height: size, rocks, units,
    structures: cores || [{ id: 1, owner: 0, kind: 'core', x: 10, y: 10 }, { id: 2, owner: 1, kind: 'core', x: 35, y: 35 }],
  });
  enablePower(state);
  enableFences(state);
  state.power.points.push(...points);
  return state;
}
// Every ground link of a side becomes a fence (the player's orders, in id order).
function fenceAll(state, player) {
  for (const l of buildLines(state).lines) if (l.owner === player && l.type === 'ground') assert.equal(setFence(state, player, l.a.id, l.b.id, true), null);
}
// A square ring of boxes with the Strip at its top-left corner: corners and edge midpoints `step` apart.
function ring(x0, y0, side, step) {
  const pts = [];
  let id = 10;
  const at = (x, y) => pts.push(pt(id++, 0, 'extension', x, y));
  for (let x = x0 + step; x <= x0 + side; x += step) at(x, y0);
  for (let y = y0 + step; y <= y0 + side; y += step) at(x0 + side, y);
  for (let x = x0 + side - step; x >= x0; x -= step) at(x, y0 + side);
  for (let y = y0 + side - step; y > y0; y -= step) at(x0, y);
  return pts;
}
const runTo = (state, last) => { for (let t = 1; t <= last; t++) { state.tick = t; stepFences(state); } };

test('a closed loop of fences becomes fenced land only after 6 s held, then counts as territory', () => {
  const s = world({ points: ring(10, 10, 14, 7) });
  fenceAll(s, 0);
  runTo(s, ENCLOSURE_HOLD - 1);
  assert.equal(fencedTiles(s, 0).size, 0, 'the enemy had time to react');
  runTo(s, ENCLOSURE_HOLD);
  assert.ok(fencedTiles(s, 0).has('17,17'), 'the middle of the ring is fenced');
  assert.ok(!fencedTiles(s, 0).has('30,30') && !fencedTiles(s, 1).has('17,17'));
  assert.equal(fencedBonus(s, 0, 17, 17), ENCLOSURE_WHEAT);
  assert.equal(ENCLOSURE_WHEAT, 1.15);
  assert.equal(fencedBonus(s, 0, 30, 30), 1);
  assert.equal(fencedBonus(s, 1, 17, 17), 1);
  assert.ok(s.events.some((e) => e.e === 'enclosed' && e.player === 0));
  assert.equal(s.power.fenceStats[0].enclosed, 1);
});

test('the enemy cannot place stations in fenced land, and an enemy toaster inside contests the capture', () => {
  const s = world({ points: ring(10, 10, 14, 7), units: [unitAt(7, 1, 'grunt', 17, 17)] });
  fenceAll(s, 0);
  runTo(s, ENCLOSURE_HOLD * 2);
  assert.equal(fencedTiles(s, 0).size, 0, 'an enemy toaster inside keeps resetting the capture');
  s.units.length = 0;
  runTo(s, ENCLOSURE_HOLD * 2 + ENCLOSURE_HOLD + 48);
  assert.ok(fencedTiles(s, 0).has('17,17'));
  assert.equal(placementVerdict(s, 1, 'extension', 17, 18), 'enemy-fence');
  assert.equal(placementVerdict(s, 0, 'extension', 17, 18), null, 'your own land is fine');
  assert.equal(placementVerdict(s, 1, 'extension', 30, 30), null);
  assert.equal(placementVerdict(s, 1, 'bogus', 30, 30), 'bad-kind');
  assert.equal(placementVerdict(s, 1, 'extension', 35, 35), 'bad-target');
});

test('brown-out drops the fence and the fenced land with it', () => {
  const s = world({ points: ring(10, 10, 14, 7) });
  fenceAll(s, 0);
  runTo(s, ENCLOSURE_HOLD);
  assert.ok(fencedTiles(s, 0).size > 0);
  const built = s.power.fenceStats[0].built;
  assert.ok(built >= 8);
  s.structures[0].hp = 0; // the Strip, the only energy on this network
  runTo(s, ENCLOSURE_HOLD + 48);
  assert.equal(fenceTiles(s).tiles[0].size, 0, 'dark rails are passable');
  assert.equal(fencedTiles(s, 0).size, 0);
  assert.equal(s.power.fenceStats[0].dropped, built, 'every wall dropped');
  assert.ok(s.events.some((e) => e.e === 'fence-down') && s.events.some((e) => e.e === 'enclosure-lost'));
});

test('a pocket bigger than 400 tiles is not fenced', () => {
  const s = world({ points: ring(4, 4, 32, 8), cores: [{ id: 1, owner: 0, kind: 'core', x: 4, y: 4 }, { id: 2, owner: 1, kind: 'core', x: 39, y: 39 }] });
  fenceAll(s, 0);
  runTo(s, ENCLOSURE_HOLD * 2);
  assert.equal(fencedTiles(s, 0).size, 0);
});

test('an open loop (a gap) fences nothing', () => {
  const pts = ring(10, 10, 14, 7).filter((p) => !(p.x === 10 && p.y === 17));
  const s = world({ points: pts });
  fenceAll(s, 0);
  runTo(s, ENCLOSURE_HOLD * 2);
  assert.equal(fencedTiles(s, 0).size, 0);
});

test('fence upkeep is one energy per 8 wall tiles', () => {
  const s = world({ points: [pt(20, 0, 'extension', 10, 17)] });
  fenceAll(s, 0);
  const tiles = fenceTiles(s).tiles[0].size;
  assert.equal(fenceUpkeep(s, 0), Math.ceil(tiles / 8));
  assert.equal(fenceUpkeep(s, 1), 0);
});

test('fence order refusals: no link, not yours, high line', () => {
  const s = world({ points: [pt(20, 0, 'extension', 10, 17), pt(21, 0, 'pylon', 14, 10)] });
  assert.equal(setFence(s, 0, 1, 99), 'no-such-link');
  assert.equal(setFence(s, 1, 1, 20), 'not-yours');
  assert.equal(setFence(s, 0, 1, 21), 'high-line');
  assert.equal(setFence(s, 0, 1, 20, true), null);
  assert.equal(setFence(s, 0, 1, 20, false), null);
  assert.equal(fenceTiles(s).tiles[0].size, 0);
});

test('a new fence cannot cross a live enemy fence', () => {
  const s = world({
    cores: [{ id: 1, owner: 0, kind: 'core', x: 10, y: 10 }, { id: 2, owner: 1, kind: 'core', x: 14, y: 6 }],
    points: [pt(20, 0, 'extension', 18, 10), pt(21, 1, 'extension', 14, 14)],
  });
  assert.equal(setFence(s, 1, 2, 21, true), null, 'the enemy fence goes up first');
  assert.equal(setFence(s, 0, 1, 20, true), 'crosses-enemy-fence');
});

test('a fence may not cut an enemy off from every neutral Reach it could reach before', () => {
  const rocks = [];
  for (let x = 0; x < 40; x++) if (x !== 20) rocks.push([x, 33]);
  const s = world({
    cores: [{ id: 1, owner: 0, kind: 'core', x: 20, y: 26 }, { id: 2, owner: 1, kind: 'core', x: 35, y: 35 }],
    points: [pt(20, 0, 'extension', 20, 34)], rocks,
  });
  s.territory = { map: { reaches: [{ claimSpot: { x: 20, y: 28 } }] }, reaches: [{ holder: null }] };
  assert.equal(setFence(s, 0, 1, 20, true), 'cuts-off-enemy');
  s.territory.reaches[0].holder = 0; // once the Reach is taken it is no longer a neutral route to protect
  assert.equal(setFence(s, 0, 1, 20, true), null);
});

test('the same orders give the same enclosure every time', () => {
  const play = () => {
    const s = world({ points: ring(10, 10, 14, 7) });
    fenceAll(s, 0);
    runTo(s, ENCLOSURE_HOLD);
    return [...fencedTiles(s, 0)].sort().join('|') + JSON.stringify(s.power.fenceStats);
  };
  assert.equal(play(), play());
});
