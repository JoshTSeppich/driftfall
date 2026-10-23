// The v4 Reach list must feed env/territory.mjs buildReaches (ids 0..20) and agree with the map's own reachGrid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMapV4, reachLayoutV4 } from '../env/map.mjs';
import { buildReaches } from '../env/territory.mjs';

const base = loadMapV4();
const W = base.width, H = base.height;

test('reachLayoutV4 feeds buildReaches and agrees with reachGrid on every Reach tile', () => {
  const layout = reachLayoutV4();
  const t = buildReaches(layout);
  assert.equal(t.reaches.length, 21);
  assert.deepEqual(layout.reaches.map((r) => r.id), Array.from({ length: 21 }, (_, i) => i));
  let wrong = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const id = base.reachGrid[y * W + x];
    if (id >= 1 && id <= 21 && t.reachAt(x, y) !== id - 1) wrong++;
  }
  assert.equal(wrong, 0, 'tiles whose Reach differs between the polygon and the grid');
  for (const r of layout.reaches) {
    assert.equal(t.reachAt(r.claimSpot.x, r.claimSpot.y), r.id, `${r.name} claimSpot is inside it`);
    assert.equal(base.tiles[r.claimSpot.y][r.claimSpot.x], '.', `${r.name} claimSpot is open ground`);
    assert.equal(layout.reaches[r.mirror].mirror, r.id);
  }
  assert.equal(t.reachAt(base.cores[0].x, base.cores[0].y), 0, 'the Core is in the Main (id 0)');
  assert.equal(t.reachAt(base.cores[1].x, base.cores[1].y), 10);
});
