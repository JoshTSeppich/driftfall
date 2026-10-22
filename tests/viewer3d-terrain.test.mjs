import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createTerrain, hash2, tileShade, crystalFraction, shardScale, rockLayout, crystalLayout, SHARDS_PER_TILE, pulse } from '../viewer3d/terrain.mjs';
import { replayTo } from '../viewer/replay.mjs';

const log = JSON.parse(fs.readFileSync(new URL('../matches/sample-7.json', import.meta.url)));
const mkCtx = () => ({ THREE, scene: new THREE.Scene(), tileSize: 1,
  gridToWorld: (x, y) => new THREE.Vector3(x - 15.5, 0, y - 15.5) });

test('hash and shade are deterministic and in range', () => {
  assert.equal(hash2(3, 4, 5), hash2(3, 4, 5));
  for (let i = 0; i < 200; i++) { const s = tileShade(i % 32, i >> 5, 7); assert.ok(s >= 0 && s <= 1); }
});

test('shard scale shrinks monotonically and drops spikes one by one', () => {
  assert.equal(shardScale(0, 0), 0);
  for (let k = 0; k < SHARDS_PER_TILE; k++) {
    let prev = Infinity;
    for (let f = 1; f >= 0; f -= 0.05) { const s = shardScale(f, k); assert.ok(s <= prev + 1e-9); prev = s; }
  }
  assert.ok(shardScale(1, 0) > shardScale(0.3, 0) && shardScale(0.3, 0) > 0);
  assert.equal(shardScale(0.2, SHARDS_PER_TILE - 1), 0);
  assert.equal(crystalFraction(200, 400), 0.5);
  assert.equal(crystalFraction(-5, 400), 0);
});

test('rocks in clusters count neighbours; crystal layout has every spike', () => {
  const l = rockLayout([[1, 1], [2, 1], [3, 1], [20, 20]], 1);
  assert.equal(l.length, 4);
  assert.ok(l[1].neighbours === 2 && l[3].neighbours === 0);
  assert.equal(crystalLayout([{ x: 1, y: 1 }])[0].spikes.length, SHARDS_PER_TILE);
  const p = pulse(3.3, 1);
  assert.ok(p >= 0 && p <= 1);
});

test('builds the real sample map, shrinks crystals as mined, disposes cleanly', () => {
  const ctx = mkCtx();
  const t = createTerrain(ctx);
  const s0 = replayTo(log, 0), s1 = replayTo(log, 1500);
  t.update({ prev: s0, next: s0, alpha: 0 }, 0.016);
  assert.ok(ctx.scene.fog && ctx.scene.background);
  const shards = () => t.root.children.flatMap((g) => g.children).filter((m) => m.isInstancedMesh && m.material.emissive).reduce((a, m) => a + m.count, 0);
  const before = shards();
  assert.ok(before > 0);
  t.update({ prev: s1, next: s1, alpha: 0 }, 0.016);
  const left = s1.crystals.reduce((a, c) => a + c.amount, 0);
  assert.ok(left < s0.crystals.reduce((a, c) => a + c.amount, 0), 'sample match mines something');
  assert.ok(shards() < before, 'fewer glowing shards late in the match');
  t.dispose();
  assert.equal(ctx.scene.fog, null);
  assert.equal(ctx.scene.children.length, 0);
});

import { readTiles, rampInfo, surfaceHeight, ELEV_STEP, tilesSignature } from '../viewer3d/terrain.mjs';

test('v3 tiles: heights, ramp direction, cliff, vent, rubble, rich-shard all build', () => {
  const W = 8, H = 8;
  const tiles = Array.from({ length: H }, () => Array.from({ length: W }, (_, x) => ({ type: 'floor', h: x >= 4 ? 1 : 0 })));
  tiles[3][3] = { type: 'ramp', h: 0 };      // climbs east, from level 0 to 1
  tiles[1][1] = 'cliff'; tiles[5][2] = 'vent'; tiles[6][6] = 'rubble'; tiles[2][6] = 'rich-shard';
  const state = { seed: 3, width: W, height: H, tick: 0, rocks: [[0, 0]], crystals: [{ x: 6, y: 2, amount: 800 }], tiles };
  const tl = readTiles(state);
  const ri = rampInfo(tl, W, H, 3, 3);
  assert.deepEqual([ri.dx, ri.dy, ri.low, ri.high], [1, 0, 0, 1]);
  assert.equal(surfaceHeight(tl, W, H, 5, 5), ELEV_STEP);
  const cleared = tiles.map((r, y) => r.map((t, x) => (x === 6 && y === 6 ? 'floor' : t)));
  assert.notEqual(tilesSignature(state), tilesSignature({ ...state, tiles: cleared }));
  const ctx = mkCtx();
  const t = createTerrain(ctx);
  t.update({ prev: state, next: state, alpha: 0 }, 0.016);
  assert.equal(t.heightAt(5, 5), ELEV_STEP);
  assert.ok(Math.abs(t.heightAt(3, 3) - ELEV_STEP / 2) < 1e-9);
  t.update({ prev: state, next: state, alpha: 0 }, 0.5);
  t.dispose();
});
