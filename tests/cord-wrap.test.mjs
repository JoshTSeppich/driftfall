// Cord wrap-point list (POWER-NETWORK.md section 4, build step 3). Owner: sonnet. Tests first, pure functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCord, updateCord, cordUsed, cordMove, pegAt, segmentBlockedBy } from '../env/cord-wrap.mjs';

// A solid block of cliff: tiles x 10..12, y 5..9.
const cliff = (x, y) => x >= 10 && x <= 12 && y >= 5 && y <= 9;
const pts = (c) => c.pts.map((p) => `${p.x},${p.y}`);

test('a clear straight cord has no bends and uses the plain distance', () => {
  const c = updateCord(newCord({ x: 2, y: 2 }), { x: 8, y: 4 }, cliff);
  assert.equal(c.pts.length, 1);
  assert.equal(cordUsed(c, { x: 8, y: 4 }), 6);
});

test('the segment test grazes corners but is stopped by a tile body', () => {
  assert.equal(segmentBlockedBy({ x: 5, y: 7 }, { x: 15, y: 7 }, cliff) !== null, true);
  assert.equal(segmentBlockedBy({ x: 5, y: 4 }, { x: 15, y: 4 }, cliff), null, 'row 4 is above the cliff');
  assert.equal(segmentBlockedBy({ x: 8, y: 6 }, { x: 12, y: 2 }, cliff), null, 'touching only the corner point (9.5,4.5)');
});

test('walking round the cliff wraps at its corner and every bend costs reach', () => {
  let c = newCord({ x: 8, y: 7 });
  const path = [[8, 4], [10, 4], [13, 4], [13, 7], [13, 10], [11, 10]];
  const seen = [];
  for (const [x, y] of path) { c = updateCord(c, { x, y }, cliff); seen.push(c.pts.length); }
  assert.ok(c.pts.length >= 2, 'the cord is bent at the cliff');
  assert.ok(cordUsed(c, { x: 13, y: 7 }) > Math.max(5, 0), 'the other side of the cliff costs more than the straight gap of 5');
  // On the far side the straight line would be 5 tiles; going round the corner must use at least 6.
  c = updateCord(newCord({ x: 8, y: 7 }), { x: 14, y: 7 }, cliff);
  assert.ok(cordUsed(c, { x: 14, y: 7 }) > 6, 'reach is lost to the bend');
});

test('swinging back across the corner unwraps it', () => {
  let c = newCord({ x: 8, y: 7 });
  for (const [x, y] of [[8, 4], [10, 4], [14, 4], [14, 6]]) c = updateCord(c, { x, y }, cliff);
  const bent = c.pts.length;
  assert.ok(bent >= 2);
  for (const [x, y] of [[14, 4], [10, 4], [8, 4], [8, 6]]) c = updateCord(c, { x, y }, cliff);
  assert.equal(c.pts.length, 1, 'back where it started: no bends left');
});

test('moves stop at the cord length: cordMove refuses a step that would overstretch', () => {
  const start = updateCord(newCord({ x: 8, y: 7 }), { x: 14, y: 7 }, cliff);
  const used = cordUsed(start, { x: 14, y: 7 });
  const ok = cordMove(start, { x: 14, y: 7 }, cliff, used);
  assert.equal(ok.ok, true);
  const no = cordMove(start, { x: 14, y: 7 }, cliff, used - 1);
  assert.equal(no.ok, false);
  assert.equal(no.cord, start, 'a refused step leaves the cord untouched');
});

test('a cord needing more than three wrap points is tangled and the move is refused', () => {
  // Four separate posts in a row force a bend round each one.
  const posts = (x, y) => (x === 10 || x === 13 || x === 16 || x === 19) && y >= 4 && y <= 6;
  const tip = { x: 22, y: 5 };
  const c = updateCord(newCord({ x: 7, y: 5 }), tip, posts);
  assert.equal(c.tangled, true);
  assert.equal(cordMove(newCord({ x: 7, y: 5 }), tip, posts, 99).ok, false);
});

test('the same walk always gives the same cord', () => {
  const walk = () => {
    let c = newCord({ x: 8, y: 7 });
    for (const [x, y] of [[8, 4], [10, 4], [14, 4], [14, 8], [14, 11], [11, 11]]) c = updateCord(c, { x, y }, cliff);
    return JSON.stringify(c);
  };
  assert.equal(walk(), walk());
});

test('a peg re-anchors the cord at a corner and frees the rest', () => {
  let c = newCord({ x: 8, y: 7 });
  for (const [x, y] of [[8, 4], [10, 4], [14, 4]]) c = updateCord(c, { x, y }, cliff);
  assert.ok(c.pts.length >= 2);
  const pegged = pegAt(c, { x: 10, y: 5 }); // the cliff tile whose corner holds the cord
  assert.ok(pegged, 'a pivot touches this tile');
  assert.equal(pegged.pts[0].x, c.pts[1].x);
  assert.equal(pegged.pts.length, c.pts.length - 1);
  assert.equal(pegAt(c, { x: 30, y: 30 }), null);
  assert.deepEqual(pts(newCord({ x: 1, y: 1 })), ['1,1']);
});
