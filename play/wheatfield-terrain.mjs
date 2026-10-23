// Wheatfield Valley on the play page (owner: sonnet, Playable Client). The 256 x 256 map as a square-grid toy landscape
// in the Quiet Battlefield palette (STYLE-BIBLE section 8; the look of play/style-lab/grid-terrain-kit.mjs): one ground
// plane textured from the map's tile letters with thin seams between the tiles, five-sided boulders on the rock lines,
// wheat bundles on the wheat fields (they shrink as Crumbs haul the wheat), flat windmill pads on the generator sockets.
// The world is quieter than the Toastinators: muted blue-grey ground, water cool and dark, no bright grass anywhere.
//
//   QUIET                     the palette (hex numbers), TERRAIN_PALETTE of the style lab
//   tileColour(ch, {deep, high})  hex for a tile letter of maps/layout-wheatfield.mjs
//   buildTileImage(map, scale)    { width, height, data } RGBA for the ground texture (scale px per tile, default 4)
//   buildMinimapImage(map)        the same land at one pixel per tile, for the minimap
//   createWheatfieldTerrain(ctx, { map }) -> { update(frame), dispose(), heightAt(), stats }  (viewer3d system shape)
// Pure parts run in node; the system needs three.js but no renderer (tests/wheatfield-terrain.test.mjs).
import * as THREE from 'three';
import { TERRAIN_PALETTE } from './style-lab/terrain-kit.mjs';

export const QUIET = TERRAIN_PALETTE;
export const SEAM = 0.14; // how far a seam pixel is pulled toward the cliff colour: a quiet 1 px line, not a board
export const NAVY = 0x1b3b57; // deep water: darker than the style-bible deep, so the creek reads as a cut in the ground
export const BAND = 0x4d97a6; // shallow band: clearly lighter than the navy, still cool
const FOG = 0x26353f;

const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hash = (x, y) => { let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const isWater = (ch) => ch === '~';

/** Hex colour of one tile letter. deep: a water tile with water on all four sides; high: raised ground. */
export function tileColour(ch, { deep = false, high = false } = {}) {
  switch (ch) {
    case '~': return deep ? NAVY : BAND;
    case 'U': return NAVY;                                // a spring: the Well goes here
    case 'B': case '=': case '|': return QUIET.ramp;              // bridges and ramps share the pale stone value
    case 'f': return rgbToHex(mix(rgb(QUIET.shallow), rgb(QUIET.ramp), 0.5));   // a ford: shallows over stone
    case 'G': return QUIET.socket;                                // a windmill pad
    case 'L': return QUIET.meadow;
    case 'S': return rgbToHex(mix(rgb(QUIET.ground), rgb(QUIET.wheat), 0.8));   // a wheat field: the brightest warm thing on the map
    case 'R': return rgbToHex(mix(rgb(QUIET.ground), rgb(QUIET.wheat), 0.95));  // golden wheat
    case '#': return QUIET.cliff;
    default: return high ? QUIET.high : QUIET.ground;
  }
}
const rgbToHex = ([r, g, b]) => (r << 16) | (g << 8) | b;

function tileInfo(map, x, y) {
  const ch = map.tiles[y][x];
  const w = (xx, yy) => xx >= 0 && yy >= 0 && xx < map.width && yy < map.height && isWater(map.tiles[yy][xx]);
  return { ch, deep: isWater(ch) && w(x - 1, y) && w(x + 1, y) && w(x, y - 1) && w(x, y + 1), high: (map.heights?.[y]?.[x] ?? 0) > 0 };
}

const isWheat = (ch) => ch === 'S' || ch === 'R';
function nearWheat(map, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const row = map.tiles[y + dy];
    if (row && isWheat(row[x + dx])) return true;
  }
  return false;
}

/** RGBA pixels for the ground texture: `scale` x `scale` pixels per tile, a faint grain, a seam on each tile's top and left. */
export function buildTileImage(map, scale = 4) {
  const width = map.width * scale, height = map.height * scale;
  const data = new Uint8Array(width * height * 4);
  const cliff = rgb(QUIET.cliff);
  for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < map.width; tx++) {
    const { ch, deep, high } = tileInfo(map, tx, ty);
    let base = rgb(tileColour(ch, { deep, high }));
    if (ch === '.' && nearWheat(map, tx, ty)) base = mix(base, rgb(QUIET.wheat), 0.3); // a golden verge: fields read as big patches
    const grain = (hash(tx, ty) - 0.5) * 0.04;                   // ±2 %: tiles read as tiles without noise
    const body = base.map((v) => Math.max(0, Math.min(255, Math.round(v * (1 + grain)))));
    const seam = mix(body, cliff, SEAM);
    for (let py = 0; py < scale; py++) for (let pxl = 0; pxl < scale; pxl++) {
      const c = scale >= 3 && (py === 0 || pxl === 0) ? seam : body; // no seams on the 1 px minimap
      const i = ((ty * scale + py) * width + tx * scale + pxl) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** The land at one pixel per tile (no seams), with the wheat fields marked. */
export function buildMinimapImage(map) {
  const img = buildTileImage(map, 1);
  const set = (x, y, hexv) => { const i = (y * img.width + x) * 4; [img.data[i], img.data[i + 1], img.data[i + 2]] = rgb(hexv); };
  for (const c of map.crystals ?? []) set(c.x, c.y, c.rich ? 0xe0b84a : QUIET.wheat);
  for (const [x, y] of map.sockets ?? []) set(x, y, 0x8ec1d4);
  return img;
}

// ------------------------------------------------------------------------------------------------------------------
// The system
// ------------------------------------------------------------------------------------------------------------------

const BLADES = 5;
export function createWheatfieldTerrain(ctx, { map }) {
  const root = new THREE.Group(); root.name = 'wheatfield';
  ctx.scene.add(root);
  const W = map.width, H = map.height, ts = ctx.tileSize ?? 1;
  const toWorld = (x, y, h = 0) => ctx.gridToWorld(x, y, h, new THREE.Vector3());
  const disposables = [];
  const own = (o) => { disposables.push(o); return o; };
  const prevBackground = ctx.scene.background, prevFog = ctx.scene.fog;
  ctx.scene.background = new THREE.Color(FOG);   // beyond the map edge: the quiet fog colour, not Driftfall's purple dusk
  ctx.scene.fog = null;

  // Ground: one plane, one texture (1024 x 1024), nearest when zoomed in, mipmapped when zoomed out.
  const img = buildTileImage(map, 4);
  const tex = own(new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat));
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8; tex.flipY = false; tex.needsUpdate = true;
  const ground = new THREE.Mesh(own(new THREE.PlaneGeometry(W * ts, H * ts)), own(new THREE.MeshBasicMaterial({ map: tex, fog: false })));
  ground.name = 'wheatfield-ground'; ground.rotation.x = -Math.PI / 2; ground.position.copy(toWorld((W - 1) / 2, (H - 1) / 2, -0.01));
  ground.renderOrder = -1; ground.receiveShadow = true;
  root.add(ground);

  // Instanced props. One draw call each: boulders (five-sided blocks), wheat blades, windmill pads.
  const dummy = new THREE.Object3D();
  const boulderGeo = own(new THREE.CylinderGeometry(0.46, 0.56, 1, 5));
  const boulderMat = own(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const cap = (n) => Math.max(1, n);
  let boulders = null, boulderKey = '';
  function buildBoulders(rocks, rubble) {
    if (boulders) { root.remove(boulders); boulders.dispose?.(); }
    const waterSet = new Set(map.water.map(([x, y]) => y * W + x));
    const list = rocks.filter(([x, y]) => !waterSet.has(y * W + x));
    const all = [...list.map(([x, y]) => ({ x, y, cliff: true })), ...rubble.map((r) => ({ x: r.x, y: r.y, cliff: false }))];
    const set = new Set(all.map((o) => o.y * W + o.x));
    boulders = new THREE.InstancedMesh(boulderGeo, boulderMat, cap(all.length));
    boulders.name = 'wheatfield-boulders'; boulders.frustumCulled = false; boulders.castShadow = true; boulders.receiveShadow = true;
    const col = new THREE.Color();
    all.forEach((o, i) => {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && set.has((o.y + dy) * W + o.x + dx)) n++;
      const hgt = o.cliff ? 0.7 + n * 0.12 + hash(o.x, o.y) * 0.5 : 0.35 + hash(o.x, o.y) * 0.2;
      const s = o.cliff ? 1.02 : 0.55;
      dummy.position.copy(toWorld(o.x, o.y, hgt * ts / 2)); dummy.rotation.set(0, hash(o.y, o.x) * Math.PI * 2, 0);
      dummy.scale.set(s * ts, hgt * ts, s * ts); dummy.updateMatrix(); boulders.setMatrixAt(i, dummy.matrix);
      // cliffs: dark blue-grey with a little variation; movable rubble: the pale rock value
      col.setHex(o.cliff ? QUIET.cliff : QUIET.rock).multiplyScalar(0.92 + hash(o.x + 7, o.y) * 0.16 + (o.cliff ? 0.28 * Math.min(1, n / 8) : 0));
      boulders.setColorAt(i, col);
    });
    boulders.count = all.length; boulders.instanceMatrix.needsUpdate = true; if (boulders.instanceColor) boulders.instanceColor.needsUpdate = true;
    root.add(boulders);
    boulderKey = `${rocks.length}:${rubble.length}`;
    stats.boulders = all.length;
  }

  // Wheat: five blades per field tile, shrinking with the wheat left. The sim lists a tile's wheat in `crystals`.
  const bladeGeo = own(new THREE.ConeGeometry(0.075, 0.5, 5));
  const bladeMat = own(new THREE.MeshLambertMaterial({ color: QUIET.wheat }));
  let wheat = null, wheatTiles = [];
  function buildWheat(crystals) {
    if (wheat) { root.remove(wheat); wheat.dispose?.(); }
    wheatTiles = crystals;
    wheat = new THREE.InstancedMesh(bladeGeo, bladeMat, cap(crystals.length * BLADES));
    wheat.name = 'wheatfield-wheat'; wheat.frustumCulled = false; wheat.castShadow = false;
    wheat.count = crystals.length * BLADES;
    root.add(wheat);
    stats.wheat = crystals.length * BLADES;
  }
  const wheatFull = new Map();
  function updateWheat(crystals) {
    if (!wheat || crystals.length !== wheatTiles.length) buildWheat(crystals);
    let shown = 0;
    crystals.forEach((c, i) => {
      const full = wheatFull.get(i) ?? (wheatFull.set(i, Math.max(c.amount, 1)), wheatFull.get(i));
      const f = c.amount > 0 ? Math.max(0.25, Math.min(1, c.amount / full)) : 0;
      if (f > 0) shown++;
      for (let k = 0; k < BLADES; k++) {
        const a = (k * Math.PI * 2) / BLADES + hash(c.x, c.y) * 3;
        const r = k === 0 ? 0 : 0.2;
        dummy.position.copy(toWorld(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 0.25 * f * ts));
        dummy.rotation.set(Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15);
        dummy.scale.set(ts, Math.max(f, 0.0001) * (c.rich ? 1.2 : 1) * ts, ts); dummy.updateMatrix();
        wheat.setMatrixAt(i * BLADES + k, dummy.matrix);
      }
    });
    wheat.instanceMatrix.needsUpdate = true;
    stats.wheatShown = shown;
  }

  // Windmill pads: a low pale square on each generator socket.
  const padGeo = own(new THREE.BoxGeometry(0.92, 0.08, 0.92));
  const padMat = own(new THREE.MeshLambertMaterial({ color: 0x8ea3ae }));
  const sockets = map.sockets ?? [];
  const pads = new THREE.InstancedMesh(padGeo, padMat, cap(sockets.length));
  pads.name = 'wheatfield-pads'; pads.count = sockets.length; pads.frustumCulled = false;
  sockets.forEach(([x, y], i) => { dummy.position.copy(toWorld(x, y, 0.04 * ts)); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(ts); dummy.updateMatrix(); pads.setMatrixAt(i, dummy.matrix); });
  root.add(pads);

  const stats = {
    boulders: 0, wheat: 0, wheatShown: 0,
    get draws() { return 1 + (boulders ? 1 : 0) + (wheat ? 1 : 0) + (sockets.length ? 1 : 0); },
  };
  return {
    name: 'wheatfield-terrain', stats,
    heightAt: () => 0,
    update(frame) {
      const snap = frame?.next ?? frame?.prev ?? {};
      const rocks = snap.rocks ?? map.rocks, crystals = snap.crystals ?? map.crystals;
      const key = `${rocks.length}:${map.rubble.length}`;
      if (!boulders || key !== boulderKey) buildBoulders(rocks, map.rubble);
      updateWheat(crystals);
    },
    dispose() {
      ctx.scene.remove(root);
      for (const d of disposables) d.dispose?.();
      boulders?.dispose?.(); wheat?.dispose?.(); pads.dispose?.();
      ctx.scene.background = prevBackground; ctx.scene.fog = prevFog;
    },
  };
}
