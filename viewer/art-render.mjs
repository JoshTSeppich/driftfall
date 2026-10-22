// Renders the Driftfall art to a PNG without a browser, using a tiny software canvas written here.
// Usage: node viewer/art-render.mjs [out.png] [cell]      (default .sandbox/art-sheet.png at 40 px; .sandbox is gitignored)
// This is a development tool for checking the art; the viewer itself uses the real browser canvas.
// The software context implements the subset of CanvasRenderingContext2D that art.mjs uses: paths, arcs,
// ellipses, fill with nonzero winding and anti-aliasing, strokes (round joins), transforms, globalAlpha,
// rect clipping, radial and linear gradients. Dashes are drawn solid and text is skipped.
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as art from './art.mjs';

// ---------- colour parsing ----------
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
function parseColor(c) {
  if (Array.isArray(c)) return c;
  if (typeof c !== 'string') return [255, 0, 255, 1];
  c = c.trim();
  if (NAMED[c]) return NAMED[c];
  if (c[0] === '#') {
    const h = c.slice(1);
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((ch) => parseInt(ch + ch, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
    return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
  }
  const m = c.match(/rgba?\(([^)]*)\)/);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return [255, 0, 255, 1];
}

class Gradient {
  constructor(kind, args) { this.kind = kind; this.args = args; this.stops = []; }
  addColorStop(t, c) { this.stops.push([t, parseColor(c)]); this.stops.sort((a, b) => a[0] - b[0]); }
  at(x, y) {
    let t;
    const a = this.args;
    if (this.kind === 'radial') {
      const dx = x - a[3], dy = y - a[4];
      t = (Math.hypot(dx, dy) - a[2]) / Math.max(1e-6, a[5] - a[2]);
    } else {
      const dx = a[2] - a[0], dy = a[3] - a[1];
      t = ((x - a[0]) * dx + (y - a[1]) * dy) / Math.max(1e-6, dx * dx + dy * dy);
    }
    t = Math.max(0, Math.min(1, t));
    const s = this.stops;
    if (!s.length) return [0, 0, 0, 0];
    if (t <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i][0]) {
        const u = (t - s[i - 1][0]) / Math.max(1e-6, s[i][0] - s[i - 1][0]);
        const c0 = s[i - 1][1], c1 = s[i][1];
        return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u, c0[3] + (c1[3] - c0[3]) * u];
      }
    }
    return s[s.length - 1][1];
  }
}

// ---------- software canvas ----------
export class SoftCanvas {
  constructor(width, height) {
    this.width = width; this.height = height;
    this.data = new Float32Array(width * height * 3);
    this.alpha = new Float32Array(width * height);
  }
  getContext() { return new SoftContext(this); }
  toPNG() {
    const { width: w, height: h } = this;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 4 + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, o = y * (w * 4 + 1) + 1 + x * 4;
        raw[o] = clampByte(this.data[i * 3]); raw[o + 1] = clampByte(this.data[i * 3 + 1]); raw[o + 2] = clampByte(this.data[i * 3 + 2]);
        raw[o + 3] = clampByte(this.alpha[i] * 255);
      }
    }
    const chunk = (type, body) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
      const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb) >>> 0);
      return Buffer.concat([len, tb, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }
}
const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c;
}

class SoftContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.m = [1, 0, 0, 1, 0, 0];
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.globalAlpha = 1;
    this.lineCap = 'butt'; this.lineJoin = 'miter'; this.font = ''; this.textAlign = 'left'; this.lineDashOffset = 0;
    this.clipMask = null;
    this.stack = [];
    this.path = []; this.cur = null; this.start = null;
  }
  // transforms
  save() { this.stack.push({ m: [...this.m], fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, clipMask: this.clipMask, lineCap: this.lineCap, lineJoin: this.lineJoin }); }
  restore() { const s = this.stack.pop(); if (s) Object.assign(this, s); }
  setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
  transformWith(n) { const [a, b, c, d, e, f] = this.m, [a2, b2, c2, d2, e2, f2] = n; this.m = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f]; }
  translate(x, y) { this.transformWith([1, 0, 0, 1, x, y]); }
  scale(x, y) { this.transformWith([x, 0, 0, y, 0, 0]); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this.transformWith([c, s, -s, c, 0, 0]); }
  pt(x, y) { const [a, b, c, d, e, f] = this.m; return [a * x + c * y + e, b * x + d * y + f]; }
  scaleFactor() { const [a, b, c, d] = this.m; return Math.sqrt(Math.abs(a * d - b * c)); }
  // paths (stored in device space)
  beginPath() { this.path = []; this.cur = null; }
  moveTo(x, y) { this.cur = [this.pt(x, y)]; this.path.push(this.cur); }
  lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); this.cur.push(this.pt(x, y)); }
  closePath() { if (this.cur && this.cur.length) { this.cur.closed = true; const p = this.cur[0]; this.cur = null; this._pending = p; } }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) * this.scaleFactor() / 2));
    let span = a1 - a0;
    if (ccw && span > 0) span -= Math.PI * 2;
    if (!ccw && span < 0) span += Math.PI * 2;
    if (Math.abs(span) >= Math.PI * 2 - 1e-9) span = Math.sign(span || 1) * Math.PI * 2;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
      const x = cx + ex * cr - ey * sr, y = cy + ex * sr + ey * cr;
      if (i === 0 && !this.cur) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  arc(cx, cy, r, a0, a1, ccw) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  setLineDash() {}
  createRadialGradient(x0, y0, r0, x1, y1, r1) { const [ax, ay] = this.pt(x0, y0), [bx, by] = this.pt(x1, y1); const s = this.scaleFactor(); return new Gradient('radial', [ax, ay, r0 * s, bx, by, r1 * s]); }
  createLinearGradient(x0, y0, x1, y1) { const [ax, ay] = this.pt(x0, y0), [bx, by] = this.pt(x1, y1); return new Gradient('linear', [ax, ay, bx, by]); }
  fillText() {}
  drawImage(src, x, y) {
    if (!(src instanceof SoftCanvas)) return;
    const [ox, oy] = this.pt(x, y);
    for (let sy = 0; sy < src.height; sy++) for (let sx = 0; sx < src.width; sx++) {
      const dx = Math.round(ox + sx), dy = Math.round(oy + sy);
      if (dx < 0 || dy < 0 || dx >= this.canvas.width || dy >= this.canvas.height) continue;
      const si = sy * src.width + sx, di = dy * this.canvas.width + dx;
      this.blendPixel(di, src.data[si * 3], src.data[si * 3 + 1], src.data[si * 3 + 2], src.alpha[si]);
    }
  }
  // filling
  fillRect(x, y, w, h) { const p = this.path, c = this.cur; this.beginPath(); this.rect(x, y, w, h); this.fill(); this.path = p; this.cur = c; }
  strokeRect(x, y, w, h) { const p = this.path, c = this.cur; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.path = p; this.cur = c; }
  clearRect(x, y, w, h) { const p = this.path, c = this.cur; this.beginPath(); this.rect(x, y, w, h); this.rasterize(this.path, [0, 0, 0, 0], 1, true); this.path = p; this.cur = c; }
  fill() { this.rasterize(this.path, this.fillStyle, this.globalAlpha); }
  clip() {
    const mask = new Float32Array(this.canvas.width * this.canvas.height);
    coverage(this.path, this.canvas.width, this.canvas.height, (i, cov) => { mask[i] = cov; });
    if (this.clipMask) for (let i = 0; i < mask.length; i++) mask[i] *= this.clipMask[i];
    this.clipMask = mask;
  }
  stroke() {
    const w = Math.max(0.6, this.lineWidth * this.scaleFactor());
    const polys = [];
    for (const sub of this.path) {
      const pts = sub.closed ? [...sub, sub[0]] : sub;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
        if (len < 1e-6) continue;
        const nx = (-dy / len) * w / 2, ny = (dx / len) * w / 2;
        polys.push(orient([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]));
      }
      if (w >= 1.5) {
        const joints = sub.closed ? sub : sub.slice(1, -1);
        const round = this.lineCap === 'round' ? sub : joints;
        for (const [x, y] of round) polys.push(circlePoly(x, y, w / 2));
      }
    }
    this.rasterize(polys, this.strokeStyle, this.globalAlpha);
  }
  rasterize(polys, style, alpha, clear = false) {
    const paint = style instanceof Gradient ? style : parseColor(style);
    const W = this.canvas.width;
    coverage(polys, W, this.canvas.height, (i, cov) => {
      const c = paint instanceof Gradient ? paint.at(i % W, Math.floor(i / W)) : paint;
      let a = cov * alpha * c[3];
      if (this.clipMask) a *= this.clipMask[i];
      if (clear) { this.canvas.data[i * 3] = this.canvas.data[i * 3 + 1] = this.canvas.data[i * 3 + 2] = 0; this.canvas.alpha[i] *= 1 - cov; return; }
      this.blendPixel(i, c[0], c[1], c[2], a);
    });
  }
  blendPixel(i, r, g, b, a) {
    if (a <= 0) return;
    const d = this.canvas.data;
    d[i * 3] += (r - d[i * 3]) * a; d[i * 3 + 1] += (g - d[i * 3 + 1]) * a; d[i * 3 + 2] += (b - d[i * 3 + 2]) * a;
    this.canvas.alpha[i] = a + this.canvas.alpha[i] * (1 - a);
  }
}

function orient(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]; s += x0 * y1 - x1 * y0; }
  return s < 0 ? poly.reverse() : poly;
}
function circlePoly(cx, cy, r) {
  const n = Math.max(8, Math.ceil(r * 3));
  const out = [];
  for (let i = 0; i < n; i++) out.push([cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)]);
  return out;
}

// Scanline coverage with nonzero winding, 4 sub-scanlines per pixel and exact horizontal coverage.
function coverage(polys, W, H, emit) {
  const edges = [];
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const poly of polys) {
    if (!poly || poly.length < 2) continue;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1); minX = Math.min(minX, x0, x1); maxX = Math.max(maxX, x0, x1);
    }
  }
  if (!edges.length) return;
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
  const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(W - 1, Math.ceil(maxX));
  if (y1 < y0 || x1 < x0) return;
  const row = new Float32Array(x1 - x0 + 2);
  const SUB = 4;
  const xs = [];
  for (let py = y0; py <= y1; py++) {
    row.fill(0);
    let touched = false;
    for (let s = 0; s < SUB; s++) {
      const sy = py + (s + 0.5) / SUB;
      xs.length = 0;
      for (const e of edges) if (sy >= e[1] && sy < e[3]) xs.push([e[0] + ((sy - e[1]) * (e[2] - e[0])) / (e[3] - e[1]), e[4]]);
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let i = 0; i + 1 < xs.length; i++) {
        wind += xs[i][1];
        if (wind === 0) continue;
        let xa = Math.max(x0, xs[i][0]), xb = Math.min(x1 + 1, xs[i + 1][0]);
        if (xb <= xa) continue;
        touched = true;
        const ia = Math.floor(xa), ib = Math.floor(xb);
        if (ia === ib) row[ia - x0] += (xb - xa) / SUB;
        else {
          row[ia - x0] += (ia + 1 - xa) / SUB;
          for (let k = ia + 1; k < ib; k++) row[k - x0] += 1 / SUB;
          if (ib <= x1) row[ib - x0] += (xb - ib) / SUB;
        }
      }
    }
    if (!touched) continue;
    for (let px = x0; px <= x1; px++) {
      const c = Math.min(1, row[px - x0]);
      if (c > 0.002) emit(py * W + px, c);
    }
  }
}

// ---------- the sheet ----------
export function renderSheet({ cell = 40, time = 1.3 } = {}) {
  const stats = { units: { worker: { hp: 40 }, grunt: { hp: 60 }, lancer: { hp: 40 }, brute: { hp: 240 } },
    structures: { core: { hp: 1000 }, forge: { hp: 400, buildTicks: 40 }, turret: { hp: 150, buildTicks: 30 } } };
  const cols = 9, gap = 6, box = cell * 2;
  const unitRows = 2 * 4; // sides x kinds
  const structRows = 2;
  const sampleH = 8 * 20 + gap, sceneH = 8 * cell + gap;
  const W = cols * (box + gap) + gap, H = gap + sampleH + (structRows + unitRows) * (box + gap) + sceneH + gap;
  const canvas = new SoftCanvas(W, H);
  const ctx = canvas.getContext();
  ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, W, H);
  let y = gap;
  // terrain sample at the real 20 px scale, twice (two seeds)
  const sample = { width: 8, height: 8, seed: 7, rocks: [[1, 1], [2, 1], [5, 3], [6, 6], [1, 6], [4, 0]],
    crystals: [{ x: 4, y: 4, amount: 400 }, { x: 5, y: 4, amount: 400 }, { x: 4, y: 5, amount: 180 }, { x: 5, y: 5, amount: 0 }, { x: 0, y: 3, amount: 40 }] };
  for (const [i, seed] of [7, 11].entries()) {
    ctx.save(); ctx.translate(gap + i * (8 * 20 + gap), y);
    art.drawTerrain(ctx, { ...sample, seed }, { cell: 20, time });
    ctx.restore();
  }
  ctx.save(); ctx.translate(gap + 2 * (8 * 20 + gap), y);
  art.drawTerrain(ctx, { ...sample, width: 4, height: 4, rocks: [[0, 0], [3, 3]], crystals: [{ x: 1, y: 1, amount: 400 }, { x: 2, y: 2, amount: 0 }] }, { cell: 40, time });
  ctx.restore();
  y += sampleH;
  // structures: per side one row: core, forge, forge 25%, forge 75%, forge queue, turret, turret 25%, turret 75%, turret damaged
  for (const owner of [0, 1]) {
    let c = 0;
    const put = (s, opts) => { ctx.save(); ctx.translate(gap + c * (box + gap), y); ctx.fillStyle = '#0f1318'; ctx.fillRect(0, 0, box, box); ctx.translate(cell / 2, cell / 2); art.drawStructure(ctx, s, { cell, time, ...opts }); ctx.restore(); c++; };
    const base = (kind) => ({ id: 10 + owner, kind, owner, x: 0, y: 0, hp: stats.structures[kind].hp, complete: true, queue: [] });
    put(base('core'), { maxHp: 1000 });
    for (const kind of ['forge', 'turret']) {
      const b = base(kind), bt = stats.structures[kind].buildTicks, mh = stats.structures[kind].hp;
      put(b, { maxHp: mh });
      put({ ...b, complete: false, progress: bt * 0.25, hp: mh * 0.25 }, { maxHp: mh, buildTicks: bt });
      put({ ...b, complete: false, progress: bt * 0.75, hp: mh * 0.75 }, { maxHp: mh, buildTicks: bt });
      put({ ...b, hp: mh * 0.6, queue: kind === 'forge' ? ['grunt', 'grunt', 'lancer'] : [] }, { maxHp: mh, hit: kind === 'turret' });
    }
    y += box + gap;
  }
  // units: per side and kind one row: idle, move, attack, die .25, die .7, carrying/hit, then 20px versions of idle, move, attack
  for (const owner of [0, 1]) for (const kind of art.KINDS.units) {
    let c = 0;
    const mh = stats.units[kind].hp;
    const base = { id: 20 + owner * 4 + c, kind, owner, x: 0, y: 0, hp: mh, carrying: 0, order: null };
    const put = (u, opts, size = cell) => { ctx.save(); ctx.translate(gap + c * (box + gap), y); ctx.fillStyle = '#0f1318'; ctx.fillRect(0, 0, box, box); ctx.translate(box / 2 - size / 2, box / 2 - size / 2); art.drawUnit(ctx, u, { cell: size, time, maxHp: mh, ...opts }); ctx.restore(); c++; };
    put(base, { pose: 'idle' });
    put(base, { pose: 'move' });
    put({ ...base, hp: mh * 0.4 }, { pose: 'attack' });
    put(base, { pose: 'die', deathT: 0.25 });
    put(base, { pose: 'die', deathT: 0.7 });
    put({ ...base, carrying: 10 }, { pose: 'move', hit: kind !== 'worker', facing: 0 });
    put(base, { pose: 'idle' }, 20);
    put(base, { pose: 'move' }, 20);
    put({ ...base, hp: mh * 0.4 }, { pose: 'attack' }, 20);
    y += box + gap;
  }
  // crowded scene at the sheet cell size
  const scene = { width: 10, height: 8, seed: 7, rocks: [[8, 0], [9, 5], [2, 7]],
    crystals: [{ x: 7, y: 1, amount: 400 }, { x: 8, y: 1, amount: 400 }, { x: 7, y: 2, amount: 200 }, { x: 8, y: 2, amount: 0 }],
    structures: [
      { id: 1, kind: 'core', owner: 0, x: 2, y: 2, hp: 1000, complete: true, queue: ['worker'] },
      { id: 50, kind: 'forge', owner: 0, x: 4, y: 4, hp: 400, complete: true, queue: ['grunt', 'brute'] },
      { id: 51, kind: 'turret', owner: 0, x: 5, y: 1, hp: 150, complete: true, queue: [] },
      { id: 52, kind: 'turret', owner: 0, x: 1, y: 5, hp: 50, progress: 10, complete: false, queue: [] },
      { id: 53, kind: 'forge', owner: 1, x: 8, y: 6, hp: 100, progress: 30, complete: false, queue: [] }],
    units: [
      { id: 3, kind: 'worker', owner: 0, x: 3, y: 2, hp: 40, carrying: 10, order: { type: 'gather', phase: 'toCore' } },
      { id: 4, kind: 'worker', owner: 0, x: 6, y: 2, hp: 40, carrying: 0, order: { type: 'gather', phase: 'mining' } },
      { id: 5, kind: 'worker', owner: 0, x: 2, y: 5, hp: 30, carrying: 0, order: { type: 'build', site: 52 } },
      { id: 60, kind: 'grunt', owner: 0, x: 5, y: 5, hp: 60, order: null },
      { id: 61, kind: 'grunt', owner: 0, x: 6, y: 5, hp: 20, order: { type: 'attack', target: 70 } },
      { id: 62, kind: 'lancer', owner: 0, x: 4, y: 6, hp: 40, order: { type: 'attack', target: 71 } },
      { id: 63, kind: 'brute', owner: 0, x: 3, y: 4, hp: 240, order: { type: 'move', x: 7, y: 7 } },
      { id: 70, kind: 'grunt', owner: 1, x: 7, y: 5, hp: 35, order: { type: 'attack', target: 61 } },
      { id: 71, kind: 'brute', owner: 1, x: 7, y: 7, hp: 200, order: { type: 'attack', target: 62 } },
      { id: 72, kind: 'lancer', owner: 1, x: 9, y: 3, hp: 40, order: null },
      { id: 73, kind: 'worker', owner: 1, x: 9, y: 7, hp: 40, carrying: 0, order: { type: 'build', site: 53 } }] };
  const sceneOpts = { time, stats, hitIds: new Set([61, 70]), facings: new Map([[61, 0], [70, Math.PI], [62, Math.PI / 4], [71, -Math.PI / 2], [63, Math.PI / 2]]),
    deaths: [{ unit: { id: 80, kind: 'lancer', owner: 1, x: 6, y: 4, hp: 0 }, t: 0.4 }] };
  ctx.save(); ctx.translate(gap, y); art.drawScene(ctx, scene, { cell, ...sceneOpts }); ctx.restore();
  ctx.save(); ctx.translate(gap + 10 * cell + gap, y); art.drawScene(ctx, scene, { cell: 20, ...sceneOpts }); ctx.restore();
  return canvas;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const out = process.argv[2] ?? new URL('../.sandbox/art-sheet.png', import.meta.url).pathname;
  const cell = Number(process.argv[3] ?? 40);
  const t0 = Date.now();
  const canvas = renderSheet({ cell });
  fs.mkdirSync(new URL('.', 'file://' + out).pathname, { recursive: true });
  fs.writeFileSync(out, canvas.toPNG());
  console.log(`wrote ${out} (${canvas.width}x${canvas.height}) in ${Date.now() - t0} ms`);
}
