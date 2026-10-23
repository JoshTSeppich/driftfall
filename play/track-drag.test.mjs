// Track laying by click-drag: the path, the green/red preview and the lay-track command (TERRITORY.md section 8). Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { trackPath, trackPreview, createTrackDrag, TRACK_COST } from './track-drag.mjs';

const open = () => true;

test('a straight drag gives one row of tiles, both ends included', () => {
  assert.deepEqual(trackPath({ x: 2, y: 5 }, { x: 5, y: 5 }, open), [[2, 5], [3, 5], [4, 5], [5, 5]]);
  assert.deepEqual(trackPath({ x: 5, y: 1 }, { x: 5, y: 3 }, open), [[5, 1], [5, 2], [5, 3]]);
});

test('a diagonal drag is an L: across first, then along', () => {
  assert.deepEqual(trackPath({ x: 0, y: 0 }, { x: 2, y: 2 }, open),
    [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]);
});

test('the L flips to go down first when the across-first leg is blocked', () => {
  const blocked = (x, y) => !(y === 0 && x >= 1); // the top row past x=0 is rock
  const p = trackPath({ x: 0, y: 0 }, { x: 2, y: 2 }, blocked);
  assert.deepEqual(p[0], [0, 0]);
  assert.deepEqual(p.at(-1), [2, 2]);
  assert.ok(p.every(([x, y]) => !(y === 0 && x >= 1)), 'the path avoids the blocked row');
});

test('a single tile is a one-tile path, which the preview calls too short', () => {
  assert.deepEqual(trackPath({ x: 3, y: 3 }, { x: 3, y: 3 }, open), [[3, 3]]);
  const pv = trackPreview([[3, 3]], open, { money: 1000 });
  assert.equal(pv.ok, false);
  assert.equal(pv.reason, 'short');
});

test('preview: every tile green when placeable and affordable, with cost at 5 S a tile', () => {
  assert.equal(TRACK_COST, 5);
  const pv = trackPreview([[0, 0], [1, 0], [2, 0]], open, { money: 15 });
  assert.equal(pv.cost, 15);
  assert.equal(pv.ok, true);
  assert.equal(pv.reason, null);
  assert.ok(pv.tiles.every((t) => t.ok === true));
});

test('preview: a blocked tile turns red and the whole line is refused', () => {
  const pv = trackPreview([[0, 0], [1, 0], [2, 0]], (x) => x !== 1, { money: 1000 });
  assert.deepEqual(pv.tiles.map((t) => t.ok), [true, false, true]);
  assert.equal(pv.ok, false);
  assert.equal(pv.reason, 'blocked');
});

test('preview: short of money is refused with reason cost', () => {
  const pv = trackPreview([[0, 0], [1, 0], [2, 0]], open, { money: 14 });
  assert.equal(pv.ok, false);
  assert.equal(pv.reason, 'cost');
});

test('drag: start, move, end gives a lay-track command with the path as [x, y] pairs', () => {
  const drag = createTrackDrag({ canPlace: open, money: 100 });
  assert.equal(drag.active(), false);
  drag.start({ x: 0, y: 0 });
  assert.equal(drag.active(), true);
  const pv = drag.move({ x: 2, y: 0 });
  assert.equal(pv.ok, true);
  assert.deepEqual(drag.preview(), pv);
  assert.deepEqual(drag.end(), { type: 'lay-track', path: [[0, 0], [1, 0], [2, 0]] });
  assert.equal(drag.active(), false);
});

test('drag: releasing on a red preview sends nothing; cancel clears the drag', () => {
  const drag = createTrackDrag({ canPlace: (x) => x !== 2, money: 100 });
  drag.start({ x: 0, y: 0 });
  drag.move({ x: 4, y: 0 });
  assert.equal(drag.end(), null);
  drag.start({ x: 0, y: 0 });
  drag.move({ x: 4, y: 0 });
  drag.cancel();
  assert.equal(drag.active(), false);
  assert.equal(drag.end(), null);
});

test('drag: move and end before start do nothing', () => {
  const drag = createTrackDrag({ canPlace: open, money: 100 });
  assert.equal(drag.move({ x: 1, y: 1 }), null);
  assert.equal(drag.end(), null);
});
