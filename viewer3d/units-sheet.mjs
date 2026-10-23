// Renders every unit model in viewer3d/units.mjs to a PNG without a browser or WebGL: a tiny software rasteriser
// (z-buffer, flat shading, the ART-GUIDE light from the upper left) so the silhouettes can be checked headlessly.
// Usage: node viewer3d/units-sheet.mjs [out.png] [cellPx] [kind,kind,...]   default .sandbox/units-sheet.png, 150 px.
// Row 1 is side 0 (Cobalt), row 2 side 1 (Ember); columns follow UNIT_KINDS_3D then an unknown kind.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { buildUnitModel, UNIT_KINDS_3D, UNIT_SPECS } from './units.mjs';

const out = process.argv[2] ?? new URL('../.sandbox/units-sheet.png', import.meta.url).pathname;
const CELL = Number(process.argv[3]) || 150;
const kinds = process.argv[4] ? process.argv[4].split(',') : [...UNIT_KINDS_3D, 'unknown'];   // 4th arg: kinds to draw
const COLS = kinds.length;
const ROWS = 2;
const W = COLS * CELL;
const H = ROWS * CELL;
const rgb = new Float32Array(W * H * 3);
const zbuf = new Float32Array(W * H).fill(-Infinity);
const bg = [0x0f / 255, 0x13 / 255, 0x18 / 255];
for (let i = 0; i < W * H; i++) { rgb[i * 3] = bg[0]; rgb[i * 3 + 1] = bg[1]; rgb[i * 3 + 2] = bg[2]; }

// three-quarter view: yaw the model 35° then tilt 32° down, orthographic
const view = new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(32)).multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(-35)));
const light = new THREE.Vector3(-0.6, 0.8, -0.45).normalize();   // upper left, toward the viewer

function shade(mat, n) {
  const c = mat.color ?? new THREE.Color(0.5, 0.5, 0.5);
  const d = Math.max(0, n.dot(light));
  const amb = 0.28;
  const e = mat.emissive ? mat.emissive.clone().multiplyScalar(Math.min(1.2, mat.emissiveIntensity ?? 1)) : null;
  const o = [c.r * (amb + 0.85 * d), c.g * (amb + 0.85 * d), c.b * (amb + 0.85 * d)];
  if (e) { o[0] += e.r; o[1] += e.g; o[2] += e.b; }
  const a = mat.transparent ? mat.opacity : 1;
  return [Math.min(1, o[0]), Math.min(1, o[1]), Math.min(1, o[2]), a];
}

function tri(p0, p1, p2, col, ox, oy, scale) {
  const toPx = (p) => [ox + p.x * scale, oy - p.y * scale, p.z];
  const a = toPx(p0), b = toPx(p1), c = toPx(p2);
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
      const i = y * W + x;
      if (z <= zbuf[i]) continue;
      if (col[3] >= 1) zbuf[i] = z;
      const al = col[3];
      rgb[i * 3] = rgb[i * 3] * (1 - al) + col[0] * al;
      rgb[i * 3 + 1] = rgb[i * 3 + 1] * (1 - al) + col[1] * al;
      rgb[i * 3 + 2] = rgb[i * 3 + 2] * (1 - al) + col[2] * al;
    }
  }
}

function drawModel(group, ox, oy, scale) {
  group.updateMatrixWorld(true);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const n = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();
  const tris = [];
  group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = g.attributes.position;
    const m = new THREE.Matrix4().multiplyMatrices(view, o.matrixWorld);
    normalMat.getNormalMatrix(m);
    for (let i = 0; i < pos.count; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, i + k).applyMatrix4(m);
      n.crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0]));
      if (n.lengthSq() === 0) continue;
      n.normalize();
      if (n.z < 0) n.negate();                                  // double-sided for a sheet
      tris.push({ p: v.map((p) => p.clone()), col: shade(o.material, n), alpha: o.material.transparent ? o.material.opacity : 1 });
    }
  });
  // opaque first, then transparent (sorted back to front)
  tris.sort((a, b) => (a.alpha >= 1) === (b.alpha >= 1) ? (a.alpha >= 1 ? 0 : (a.p[0].z + a.p[1].z + a.p[2].z) - (b.p[0].z + b.p[1].z + b.p[2].z)) : (a.alpha >= 1 ? -1 : 1));
  for (const t of tris) tri(t.p[0], t.p[1], t.p[2], t.col, ox, oy, scale);
}

// ground disc per cell so the feet and shadow read
function groundDisc(ox, oy, scale, r) {
  const steps = 24;
  const c = new THREE.Vector3(0, 0, 0).applyMatrix4(view);
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI * 2, a1 = ((i + 1) / steps) * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * r, 0, Math.sin(a0) * r).applyMatrix4(view);
    const p1 = new THREE.Vector3(Math.cos(a1) * r, 0, Math.sin(a1) * r).applyMatrix4(view);
    tri(c, p0, p1, [0.11, 0.14, 0.17, 1], ox, oy, scale);
  }
}

for (let row = 0; row < ROWS; row++) {
  kinds.forEach((kind, col) => {
    const r = buildUnitModel(THREE, kind, row, null);
    const spec = UNIT_SPECS[kind] ?? { size: 0.5, height: 0.8 };
    const ox = col * CELL + CELL / 2;
    const oy = row * CELL + CELL * 0.78;
    const scale = CELL * 0.62;                       // one tile = 0.62 of the cell
    groundDisc(ox, oy, scale, 0.5);
    if (spec.altitude) r.group.position.y = 0.35;     // lift air units a little so they read as flying
    drawModel(r.group, ox, oy, scale);
  });
}

// PNG
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const o = y * (W * 3 + 1) + 1 + x * 3;
    raw[o] = Math.round(Math.min(1, rgb[i * 3]) * 255);
    raw[o + 1] = Math.round(Math.min(1, rgb[i * 3 + 1]) * 255);
    raw[o + 2] = Math.round(Math.min(1, rgb[i * 3 + 2]) * 255);
  }
}
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${W}x${H}); columns: ${kinds.join(', ')}`);
