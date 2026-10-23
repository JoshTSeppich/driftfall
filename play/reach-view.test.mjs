// Reach borders: ground lines and minimap outlines, with contested Reaches flashing. Pure, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReaches, createTerritory } from '../env/territory.mjs';
import { reachViews, flashOn, tone, reachBorderLines, drawReachMinimap, FLASH_TICKS, OPEN_COLOUR } from './reach-view.mjs';

// A tiny two-Reach layout: a square for Reach 0 and a square for Reach 1, on a 10 x 10 map.
const layout = {
  width: 10, height: 10,
  reaches: [
    { id: 0, name: 'Main', role: 'main', side: 0, outline: [[0, 0], [4, 0], [4, 4], [0, 4]] },
    { id: 1, name: 'Natural', role: 'natural', side: 1, outline: [[6, 6], [9, 6], [9, 9], [6, 9]] },
  ],
};

function territoryWith(holders) {
  const state = {};
  createTerritory(state, buildReaches(layout));
  state.territory.reaches.forEach((r, i) => Object.assign(r, holders[i]));
  return state.territory;
}

// A ctx stub that records what the minimap draws.
function recorder() {
  const calls = [];
  const ctx = new Proxy({ canvas: { width: 100, height: 100 } }, {
    get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, ...args])),
    set: (t, k, v) => { t[k] = v; calls.push(['set', k, v]); return true; },
  });
  return { ctx, calls };
}

test('reachViews is empty before territory is on, and merges holders with outlines', () => {
  assert.deepEqual(reachViews(undefined), []);
  const t = territoryWith([{ holder: 0 }, { holder: null, contested: true }]);
  const views = reachViews(t);
  assert.equal(views.length, 2);
  assert.equal(views[0].name, 'Main');
  assert.equal(views[0].holder, 0);
  assert.equal(views[1].contested, true);
  assert.deepEqual(views[0].outline, [[0, 0], [4, 0], [4, 4], [0, 4]]);
});

test('tone: nobody holds is open, your hold is mine, the other side is foe', () => {
  assert.equal(tone(null, 0), 'open');
  assert.equal(tone(undefined, 0), 'open');
  assert.equal(tone(0, 0), 'mine');
  assert.equal(tone(1, 0), 'foe');
  assert.equal(tone(0, 1), 'foe');
});

test('flashOn switches every FLASH_TICKS and is a pure function of the tick', () => {
  assert.equal(FLASH_TICKS, 12);
  assert.equal(flashOn(0), true);
  assert.equal(flashOn(11), true);
  assert.equal(flashOn(12), false);
  assert.equal(flashOn(23), false);
  assert.equal(flashOn(24), true);
  assert.equal(flashOn(12345), flashOn(12345));
});

test('reachBorderLines: one closed loop of segments per Reach, tone and visibility set', () => {
  const t = territoryWith([{ holder: 0 }, { holder: null, contested: true }]);
  const lines = reachBorderLines(reachViews(t), 0, 0);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].segments.length, 4);
  assert.deepEqual(lines[0].segments[0], [0, 0, 4, 0]);
  assert.deepEqual(lines[0].segments[3], [0, 4, 0, 0]); // closes back to the first point
  assert.equal(lines[0].tone, 'mine');
  assert.equal(lines[0].visible, true);
  assert.equal(lines[1].tone, 'open');
  assert.equal(lines[1].visible, true); // on phase at tick 0
  assert.equal(reachBorderLines(reachViews(t), 0, FLASH_TICKS)[1].visible, false); // contested, off phase
});

test('reachBorderLines: an open Reach is never hidden by the flash', () => {
  const t = territoryWith([{ holder: null }, { holder: null }]);
  for (const tick of [0, FLASH_TICKS, 2 * FLASH_TICKS]) {
    assert.ok(reachBorderLines(reachViews(t), 0, tick).every((l) => l.visible));
  }
});

test('drawReachMinimap strokes held Reaches in their tone and skips a contested Reach off-phase', () => {
  const t = territoryWith([{ holder: 0 }, { holder: 1, contested: true }]);
  const views = reachViews(t);

  const on = recorder();
  drawReachMinimap(on.ctx, views, { side: 0, tick: 0, mapW: 10, mapH: 10, width: 100, height: 100 });
  const onStrokes = on.calls.filter((c) => c[0] === 'stroke').length;
  assert.equal(onStrokes, 2);
  assert.ok(on.calls.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#3fa9ff'));

  const off = recorder();
  drawReachMinimap(off.ctx, views, { side: 0, tick: FLASH_TICKS, mapW: 10, mapH: 10, width: 100, height: 100 });
  assert.equal(off.calls.filter((c) => c[0] === 'stroke').length, 1); // only the steady Main
});

test('drawReachMinimap scales tile outlines to the minimap pixels', () => {
  const t = territoryWith([{ holder: null }, { holder: null }]);
  const { ctx, calls } = recorder();
  drawReachMinimap(ctx, reachViews(t), { side: 0, tick: 0, mapW: 10, mapH: 10, width: 100, height: 100 });
  const firstMove = calls.find((c) => c[0] === 'moveTo');
  assert.deepEqual(firstMove.slice(1), [0, 0]);
  assert.ok(calls.some((c) => c[0] === 'lineTo' && c[1] === 40 && c[2] === 0)); // x = 4 tiles -> 40 px
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === OPEN_COLOUR));
});
