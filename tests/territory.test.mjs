import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReaches, createTerritory, updateTerritory, holdCount, TERRITORY_RULES, reachSummary } from '../env/territory.mjs';

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// Three tiny Reaches in a 30x10 world: A (side 0 main), B (neutral centre), C (side 1 main).
const layout = () => ({
  width: 30, height: 10,
  reaches: [
    { id: 0, name: 'A', role: 'main', side: 0, mirror: 2, centre: { x: 5, y: 5 }, claimSpot: { x: 5, y: 5 }, outline: sq(0, 0, 10, 10) },
    { id: 1, name: 'B', role: 'centre', side: null, mirror: 1, centre: { x: 15, y: 5 }, claimSpot: { x: 15, y: 5 }, outline: sq(10, 0, 20, 10) },
    { id: 2, name: 'C', role: 'main', side: 1, mirror: 0, centre: { x: 25, y: 5 }, claimSpot: { x: 25, y: 5 }, outline: sq(20, 0, 30, 10) },
  ],
});
const mk = (extra = {}) => {
  const state = { tick: 0, width: 30, height: 10, units: [], structures: [], events: [], result: null, nextId: 1, ...extra };
  const reaches = buildReaches(layout());
  createTerritory(state, reaches, { winCount: 2, winTicks: 50, holdTicks: 10 });
  return { state, reaches };
};
const core = (id, owner, x, y) => ({ id, owner, kind: 'core', x, y, complete: true, hp: 100 });
const totem = (complete = true) => ({ id: 9, owner: 0, kind: 'totem', x: 15, y: 5, complete, hp: 5 });
const unit = (id, owner, x, y, kind = 'grunt') => ({ id, owner, kind, x, y, hp: 10 });
const run = (state, n) => {
  let r = null;
  for (let i = 0; i < n; i++) { state.events = []; r = updateTerritory(state) || r; state.tick++; }
  return r;
};
const cores = () => [core(1, 0, 5, 5), core(2, 1, 25, 5)];

test('buildReaches rasterizes outlines; reachAt finds the Reach, outside is -1', () => {
  const r = buildReaches(layout());
  assert.equal(r.reaches.length, 3);
  assert.equal(r.reachAt(5, 5), 0);
  assert.equal(r.reachAt(15.7, 2.2), 1);
  assert.equal(r.reachAt(29, 9), 2);
  assert.equal(r.reachAt(10, 5), 1, 'tile 10 starts the centre');
  assert.equal(r.reachAt(-1, 3), -1);
  assert.equal(r.reachAt(3, 30), -1);
});

test('overlapping outlines: the lower id wins', () => {
  const l = layout();
  l.reaches[1].outline = sq(8, 0, 20, 10);
  const r = buildReaches(l);
  assert.equal(r.reachAt(9, 5), 0);
  assert.equal(r.reachAt(10, 5), 1);
});

test('buildReaches also reads rect, kind and center from the map file', () => {
  const r = buildReaches({ width: 20, height: 10, reaches: [
    { id: 0, name: 'A', kind: 'main', side: 0, rect: [0, 0, 10, 10], center: { x: 5, y: 5 } },
    { id: 1, name: 'B', kind: 'centre', side: null, rect: { x: 10, y: 0, w: 10, h: 10 }, center: { x: 15, y: 5 } },
  ] });
  assert.equal(r.reachAt(3, 3), 0);
  assert.equal(r.reachAt(12, 3), 1);
  assert.equal(r.reaches[1].role, 'centre');
  assert.deepEqual(r.reaches[1].claimSpot, { x: 15, y: 5 });
});

test('buildReaches rejects bad layouts', () => {
  const l = layout(); l.reaches[1].id = 0;
  assert.throws(() => buildReaches(l), /id/);
  const m = layout(); m.reaches[0].outline = [[0, 0], [1, 1]];
  assert.throws(() => buildReaches(m), /outline/);
});

test('the Core claims its Main from the start', () => {
  const { state } = mk({ structures: cores() });
  run(state, 1);
  assert.equal(holdCount(state, 0), 1);
  assert.equal(holdCount(state, 1), 1);
  assert.equal(state.territory.reaches[0].holder, 0);
  assert.equal(state.territory.reaches[1].holder, null);
});

test('an incomplete Totem does not claim; a complete Totem or Mound does, and claimed is emitted once', () => {
  const site = totem(false);
  const { state } = mk({ structures: [...cores(), site] });
  run(state, 3);
  assert.equal(holdCount(state, 0), 1);
  site.complete = true;
  run(state, 1);
  assert.equal(holdCount(state, 0), 2);
  assert.ok(state.events.some((e) => e.e === 'claimed' && e.player === 0 && e.reach === 1));
  run(state, 1);
  assert.ok(!state.events.some((e) => e.e === 'claimed'));
  const m = mk({ structures: [...cores(), { id: 9, owner: 1, kind: 'mound', x: 15, y: 5, complete: true, hp: 5 }] });
  run(m.state, 1);
  assert.equal(holdCount(m.state, 1), 2);
});

test('enemy combat alone for holdTicks breaks the hold; a defender prevents it; Workers do not count', () => {
  const { state } = mk({ structures: [...cores(), totem()], units: [unit(20, 1, 15, 5, 'worker')] });
  run(state, 30);
  assert.equal(state.territory.reaches[1].holder, 0, 'worker does not contest');
  state.units = [unit(21, 1, 15, 5), unit(22, 0, 14, 5)];
  run(state, 30);
  assert.equal(state.territory.reaches[1].holder, 0, 'defender present, no contest');
  state.units = [unit(21, 1, 15, 5)];
  run(state, 9);
  assert.equal(state.territory.reaches[1].holder, 0);
  assert.ok(state.territory.reaches[1].contested);
  run(state, 2);
  assert.equal(state.territory.reaches[1].holder, null);
  assert.ok(state.events.some((e) => e.e === 'hold-lost' && e.player === 0 && e.reach === 1));
  state.units = [];
  run(state, 1);
  assert.equal(state.territory.reaches[1].holder, 0, 'hold returns when the enemy leaves');
  assert.ok(state.events.some((e) => e.e === 'hold-gained'));
});

test('contested is emitted once when the enemy first stands alone', () => {
  const { state } = mk({ structures: [...cores(), totem()], units: [unit(21, 1, 15, 5)] });
  let n = 0;
  for (let i = 0; i < 5; i++) { state.events = []; updateTerritory(state); n += state.events.filter((e) => e.e === 'contested').length; }
  assert.equal(n, 1);
});

test('destroying the claim structure drops the hold', () => {
  const t = totem();
  const { state } = mk({ structures: [...cores(), t] });
  run(state, 1);
  assert.equal(holdCount(state, 0), 2);
  state.structures = state.structures.filter((s) => s !== t);
  run(state, 1);
  assert.equal(holdCount(state, 0), 1);
  assert.ok(state.events.some((e) => e.e === 'hold-lost' && e.reach === 1));
});

test('territory win: hold winCount Reaches for winTicks; the countdown cancels if you drop below', () => {
  const { state } = mk({ structures: [...cores(), totem()] });
  run(state, 1);
  assert.ok(state.events.some((e) => e.e === 'countdown-start' && e.player === 0));
  run(state, 10);
  const left = state.territory.countdown[0];
  assert.ok(left > 0 && left < 50);
  state.units = [unit(30, 1, 15, 5)];
  run(state, 12);
  assert.equal(state.territory.countdown[0], null);
  state.units = [];
  const r = run(state, 80);
  assert.equal(r.winner, 0);
  assert.equal(r.reason, 'territory');
});

test('the win is logged once and returned on the tick it happens', () => {
  const { state } = mk({ structures: [...cores(), totem()] });
  let result = null; let wins = 0; let cancels = 0;
  for (let i = 0; i < 80 && !result; i++) {
    state.events = [];
    result = updateTerritory(state);
    wins += state.events.filter((e) => e.e === 'territory-win').length;
    cancels += state.events.filter((e) => e.e === 'countdown-cancel').length;
    state.tick++;
  }
  assert.ok(result);
  assert.equal(wins, 1);
  assert.equal(cancels, 0);
  assert.equal(result.winner, 0);
  assert.equal(result.reason, 'territory');
});

test('deterministic: same inputs give the same territory state', () => {
  const build = () => {
    const { state } = mk({ structures: [...cores(), totem()], units: [unit(21, 1, 15, 5)] });
    run(state, 40);
    return JSON.stringify([state.territory.reaches, state.territory.hold, state.territory.countdown]);
  };
  assert.equal(build(), build());
});

test('default rules match TERRITORY.md: 10 s hold, 14 of 21 for 90 s at 24 ticks a second', () => {
  assert.equal(TERRITORY_RULES.holdTicks, 240);
  assert.equal(TERRITORY_RULES.winCount, 14);
  assert.equal(TERRITORY_RULES.winTicks, 2160);
  assert.deepEqual([...TERRITORY_RULES.claimKinds].sort(), ['mound', 'totem']);
});

test('reachSummary gives per-Reach rows for the HUD and minimap', () => {
  const { state } = mk({ structures: cores() });
  run(state, 1);
  const rows = reachSummary(state);
  assert.equal(rows.length, 3);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['contested', 'holder', 'id', 'name', 'role']);
  assert.equal(rows[0].holder, 0);
});
