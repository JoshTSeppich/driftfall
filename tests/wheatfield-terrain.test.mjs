// Wheatfield Valley on the play page (owner: sonnet): a square-grid ground in the Quiet Battlefield palette (STYLE-BIBLE
// section 8, play/style-lab/grid-terrain-kit.mjs look), a minimap that shows the land instead of dark Voronoi cells, and
// boulders / wheat bundles / windmill pads drawn from the map's own tile letters. Real Three.js, headless.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateMap } from '../env/map.mjs';
import { TERRAIN_PALETTE } from '../play/style-lab/terrain-kit.mjs';
import {
  QUIET, tileColour, buildTileImage, buildMinimapImage, createWheatfieldTerrain, SEAM, NAVY, BAND,
} from '../play/wheatfield-terrain.mjs';

const map = generateMap(7, { map: 'wheatfield' });
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const near = (a, b, tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('the palette is the Quiet Battlefield table: ground, wheat, water, cliff, ramp', () => {
  assert.equal(QUIET.ground, TERRAIN_PALETTE.ground);
  assert.equal(QUIET.ground, 0x52696b); assert.equal(QUIET.wheat, 0xc9a65e); assert.equal(QUIET.shallow, 0x367d8a);
  assert.equal(QUIET.cliff, 0x303f48); assert.equal(QUIET.ramp, 0x89918a);
});

test('tile letters map to surfaces: creek is water, bridge and ford are walkable looks, wheat is warm', () => {
  assert.equal(tileColour('~', {}), BAND);
  assert.equal(tileColour('~', { deep: true }), NAVY);
  assert.equal(tileColour('.', {}), QUIET.ground);
  assert.equal(tileColour('.', { high: true }), QUIET.high);
  assert.equal(tileColour('B', {}), QUIET.ramp);
  assert.equal(tileColour('=', {}), QUIET.ramp);
  assert.equal(tileColour('G', {}), QUIET.socket);
  assert.equal(tileColour('L', {}), QUIET.meadow);
  assert.notEqual(tileColour('S', {}), QUIET.ground, 'a wheat field tile is tinted');
});

test('the tile image is a 256 x 256 grid with thin seams, one pixel block per tile, no bright grass', () => {
  const img = buildTileImage(map);
  assert.equal(img.width, 256 * 4); assert.equal(img.height, 256 * 4);
  assert.equal(img.data.length, img.width * img.height * 4);
  // an open ground tile: body pixel is the base ground (± the faint grain), the seam pixel is darker
  let gx = -1, gy = -1;
  outer: for (let y = 2; y < 250; y++) for (let x = 2; x < 250; x++) if (map.tiles[y][x] === '.' && !(map.heights?.[y]?.[x] > 0)) { gx = x; gy = y; break outer; }
  assert.ok(gx >= 0);
  const body = px(img, gx * 4 + 2, gy * 4 + 2), seam = px(img, gx * 4, gy * 4);
  assert.ok(near(body, hex(QUIET.ground), 12), `body ${body}`);
  assert.ok(seam[0] + seam[1] + seam[2] < body[0] + body[1] + body[2], 'the seam is darker than the tile');
  assert.ok(SEAM > 0 && SEAM < 0.6);
  // the creek: a water tile is blue (blue channel above red)
  const w = map.water[Math.floor(map.water.length / 2)];
  const wp = px(img, w[0] * 4 + 2, w[1] * 4 + 2);
  assert.ok(wp[2] > wp[0], `creek tile looks like water ${wp}`);
  // no pixel is brighter than a bright-grass green (the world stays quieter than the Toastinators)
  let bright = 0;
  for (let i = 0; i < img.data.length; i += 4 * 97) if (img.data[i + 1] > 215) bright++;
  assert.equal(bright, 0);
});

test('the minimap image is 256 x 256, one pixel per tile, water blue, wheat gold-ish, not the old dark board', () => {
  const m = buildMinimapImage(map);
  assert.equal(m.width, 256); assert.equal(m.height, 256);
  const w = map.water[1000];
  const p = px(m, w[0], w[1]);
  assert.ok(p[2] > p[0]);
  const c = map.crystals[0];
  const cp = px(m, c.x, c.y);
  assert.ok(cp[0] > cp[2], 'wheat is warm');
  const g = px(m, 10, 120);
  assert.ok(g[1] > 0x40, 'land is not near black');
});

function fakeCtx() {
  const ctx = { THREE, scene: new THREE.Scene(), tileSize: 1, camera: new THREE.PerspectiveCamera(),
    gridToWorld(x, y, h, out = new THREE.Vector3()) { return out.set(x + 0.5 - 128, h, y + 0.5 - 128); } };
  return ctx;
}
const frameOf = (crystals, rocks = map.rocks) => ({ tick: 1, next: { crystals, rocks, units: [], structures: [] }, prev: { crystals, rocks, units: [], structures: [] } });

test('the terrain system: one ground plane, boulders, wheat bundles, pads; cheap in draws; disposes clean', () => {
  const ctx = fakeCtx();
  const t = createWheatfieldTerrain(ctx, { map });
  t.update(frameOf(map.crystals.map((c) => ({ ...c }))), 1 / 60);
  const ground = ctx.scene.getObjectByName('wheatfield-ground');
  assert.ok(ground && ground.isMesh);
  const bb = new THREE.Box3().setFromObject(ground);
  assert.ok(Math.abs(bb.min.x + 128) < 0.01 && Math.abs(bb.max.x - 128) < 0.01, 'the plane covers 256 tiles');
  assert.equal(t.heightAt(10, 10), 0);
  assert.ok(t.stats.boulders > 1000, `boulders ${t.stats.boulders}`);
  assert.ok(t.stats.wheat >= 176 * 5 - 5, `wheat blades ${t.stats.wheat}`);
  assert.ok(t.stats.draws <= 6, `draws ${t.stats.draws}`);
  // water tiles never become boulders even though the sim stores creek water as rock
  assert.ok(t.stats.boulders <= map.rocks.length - map.water.length + map.rubble.length + 5);
  t.dispose();
  assert.equal(ctx.scene.children.length, 0);
});

test('wheat shrinks as a field is mined and vanishes at zero', () => {
  const ctx = fakeCtx();
  const t = createWheatfieldTerrain(ctx, { map });
  const full = map.crystals.map((c) => ({ ...c }));
  t.update(frameOf(full), 1 / 60);
  const visibleFull = t.stats.wheatShown;
  const mined = full.map((c, i) => (i < 20 ? { ...c, amount: 0 } : c));
  t.update(frameOf(mined), 1 / 60);
  assert.ok(t.stats.wheatShown < visibleFull, 'twenty emptied fields lose their bundles');
  t.dispose();
});

test('Quiet Battlefield contrast: wheat is the brightest warm tile, navy is darker than the shallow band, the seam is subtle', () => {
  const lum = (h) => ((h >> 16) & 255) * 0.3 + ((h >> 8) & 255) * 0.59 + (h & 255) * 0.11;
  assert.ok(lum(NAVY) < lum(BAND) - 15, 'shallow band is lighter than navy');
  assert.ok(lum(NAVY) < lum(QUIET.ground) - 20, 'water is darker than the ground');
  for (const ch of ['S', 'R']) {
    const w = tileColour(ch, {});
    assert.ok(((w >> 16) & 255) > (w & 255) + 40, 'wheat is warm');
    assert.ok(lum(w) > lum(QUIET.ground) + 25 && lum(w) > lum(QUIET.high), 'wheat is the brightest ground feature');
  }
  assert.ok(SEAM <= 0.2, 'seam is a faint pull toward the cliff colour');
});
