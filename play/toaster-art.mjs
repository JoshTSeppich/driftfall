// Toaster Wars HUD art (owner: sonnet, Playable Client). Portraits and icons for the selection panel and the command card,
// built from the same data the 3D toasters use (play/toaster-models.mjs), so the HUD and the map show the same toasters.
// Pure strings, no DOM and no canvas: each picture is an SVG data URL, made once and cached. play/icons.mjs asks this
// module for pictures once the page installs it with setArtProvider(toasterArt) (Toaster Wars only; ?classic=1 keeps the old art).
import { TOASTERS, COLORS, toasterKindOf } from './toaster-models.mjs';

const INK = '#1d1a14';
const TEAM = ['#12D8F0', '#FF7A2E'];
const BACK = ['#16313a', '#3a2314'];
const f2 = (n) => (Math.round(n * 100) / 100).toString();
const svgUrl = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const frame = (owner, inner, vb = 256) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}" width="${vb}" height="${vb}"><rect x="6" y="6" width="${vb - 12}" height="${vb - 12}" rx="26" fill="${BACK[owner] ?? BACK[0]}" stroke="${INK}" stroke-width="6"/>${inner}</svg>`;
const rect = (x, y, w, h, fill, rx = 5) => `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" rx="${rx}" fill="${fill}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
const poly = (pts, fill) => `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
const circ = (x, y, r, fill) => `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}" fill="${fill}" stroke="${INK}" stroke-width="5"/>`;

// Back to front, as seen from the camera.
const ORDER = ['tyre', 'hub', 'toast', 'feet', 'prism', 'chassis', 'faceplate', 'glow', 'eyes', 'team'];

/** The front view of one toaster (sim kind or toaster id) as an SVG string: ink outlines, flat colour, glowing eyes. */
export function toasterPortraitSvg(kind, owner = 0) {
  const model = TOASTERS[toasterKindOf(kind)];
  const parts = model.parts.slice().sort((a, b) => ORDER.indexOf(a.part) - ORDER.indexOf(b.part));
  let minX = Infinity, maxX = -Infinity;
  for (const p of parts) { minX = Math.min(minX, p.pos[0] - p.size[0] / 2); maxX = Math.max(maxX, p.pos[0] + p.size[0] / 2); }
  const w = maxX - minX, h = model.height;
  const k = 168 / Math.max(w, h * 1.05), ox = 128 - (minX + w / 2) * k, oy = 128 + (h * k) / 2 + 6;
  const X = (x) => ox + x * k, Y = (y) => oy - y * k;
  const team = TEAM[owner] ?? TEAM[0];
  const fill = { chassis: COLORS.chassis, faceplate: COLORS.faceplate, eyes: COLORS.eye, toast: COLORS.toast, feet: COLORS.feet, glow: COLORS.heat, team, tyre: COLORS.faceplate, hub: COLORS.chassis, prism: COLORS.toast };
  let out = '';
  for (const p of parts) {
    const [sx, sy] = p.size, [px, py] = p.pos;
    if (p.part === 'prism') { out += `<ellipse cx="${f2(X(px))}" cy="${f2(Y(py))}" rx="${f2(sx / 2 * k)}" ry="${f2(sy / 2 * k)}" fill="${fill.prism}" stroke="${INK}" stroke-width="5"/><ellipse cx="${f2(X(px))}" cy="${f2(Y(py))}" rx="${f2(sx / 5 * k)}" ry="${f2(sy / 5 * k)}" fill="${BACK[owner] ?? BACK[0]}" stroke="${INK}" stroke-width="4"/>`; continue; }
    out += rect(X(px - sx / 2), Y(py + sy / 2), Math.max(sx * k, 4), Math.max(sy * k, 4), fill[p.part] ?? COLORS.feet, p.part === 'eyes' ? 4 : 6);
  }
  return frame(owner, out);
}

/** Blocky toy icons for the buildings: Power Strip, Assembly Line, Heat Lamp, Mill, Well, Toaster. */
export function structureIconSvg(kind, owner = 0) {
  const team = TEAM[owner] ?? TEAM[0];
  const cream = COLORS.chassis, char = COLORS.faceplate, toast = COLORS.toast, heat = COLORS.heat;
  let g = '';
  switch (kind) {
    case 'core': // Power Strip: a long cream bar, five dark sockets, a team-colour switch and the cord
      g = rect(34, 100, 188, 66, cream, 14) + [0, 1, 2, 3, 4].map((i) => rect(50 + i * 34, 118, 22, 30, char, 4)).join('') + rect(190, 80, 22, 24, team, 6)
        + `<path d="M34 134 Q8 134 8 176 Q8 214 40 214" fill="none" stroke="${char}" stroke-width="12" stroke-linecap="round"/>`; break;
    case 'forge': // Assembly Line: a belt with a toaster-in-progress riding it
      g = rect(24, 150, 208, 38, char, 10) + [0, 1, 2, 3, 4, 5].map((i) => circ(46 + i * 33, 190, 9, cream)).join('')
        + rect(70, 92, 78, 58, cream, 10) + rect(86, 74, 22, 24, toast, 4) + rect(112, 74, 22, 24, toast, 4) + rect(168, 60, 34, 90, team, 8); break;
    case 'turret': // Heat Lamp: a pole and a glowing orange shade
      g = rect(100, 190, 56, 22, char, 8) + rect(120, 100, 16, 92, char, 4) + poly([[70, 100], [186, 100], [160, 50], [96, 50]], heat) + circ(128, 108, 14, '#FFE9A8'); break;
    case 'mill': // Mill: a cream tower with a roof, a team door and four blades
      g = poly([[78, 210], [178, 210], [160, 100], [96, 100]], cream) + poly([[84, 100], [172, 100], [128, 56]], toast) + rect(112, 160, 32, 50, team, 6)
        + poly([[128, 80], [60, 40], [80, 24]], char) + poly([[128, 80], [196, 40], [176, 24]], char) + poly([[128, 80], [60, 130], [78, 144]], char) + poly([[128, 80], [196, 130], [178, 144]], char) + circ(128, 80, 9, team); break;
    case 'well': // Well: a ring of blocks around blue water, a little roof and a bucket
      g = rect(58, 130, 140, 80, cream, 10) + rect(74, 118, 108, 28, '#4aa8d8', 12) + rect(62, 60, 12, 74, char, 3) + rect(182, 60, 12, 74, char, 3)
        + poly([[48, 64], [208, 64], [128, 22]], team) + rect(116, 82, 24, 24, toast, 4); break;
    case 'toaster': // Toaster: a big cream box, two slots with toast popping up, a lever and a team block
      g = rect(40, 100, 176, 110, cream, 20) + rect(66, 92, 60, 14, char, 5) + rect(134, 92, 60, 14, char, 5) + rect(76, 52, 40, 48, toast, 5) + rect(144, 52, 40, 48, toast, 5)
        + rect(96, 150, 64, 36, char, 8) + circ(112, 168, 7, COLORS.eye) + circ(144, 168, 7, COLORS.eye) + rect(200, 126, 24, 18, team, 5); break;
    default: g = rect(60, 80, 136, 110, cream, 14) + rect(100, 50, 56, 36, team, 8);
  }
  return frame(owner, g);
}

/** Command icons: simple flat shapes on the same tile. */
export function actionIconSvg(action) {
  const c = COLORS.chassis, hot = COLORS.heat, ok = '#6fe08a';
  let g;
  switch (action) {
    case 'amove': g = poly([[128, 40], [160, 120], [216, 128], [160, 144], [128, 216], [96, 144], [40, 128], [96, 120]], hot); break;
    case 'stop': g = poly([[90, 40], [166, 40], [216, 90], [216, 166], [166, 216], [90, 216], [40, 166], [40, 90]], '#d9534f') + rect(84, 108, 88, 40, c, 6); break;
    case 'hold': g = poly([[128, 36], [208, 66], [200, 150], [128, 220], [56, 150], [48, 66]], c) + rect(112, 84, 32, 80, COLORS.faceplate, 6); break;
    case 'move': g = poly([[40, 100], [140, 100], [140, 60], [220, 128], [140, 196], [140, 156], [40, 156]], ok); break;
    case 'rally': g = rect(74, 40, 14, 180, COLORS.faceplate, 4) + poly([[88, 48], [208, 78], [88, 120]], hot); break;
    default: g = circ(128, 128, 60, c);
  }
  return frame(0, g);
}

export const UNIT_ART_KINDS = Object.freeze(['worker', 'grunt', 'lancer', 'brute', 'howler', 'spiker', 'dart']);
export const STRUCTURE_ART_KINDS = Object.freeze(['core', 'forge', 'turret', 'mill', 'well', 'toaster']);
const ACTIONS = new Set(['amove', 'stop', 'hold', 'move', 'rally']);

const cache = new Map();
const once = (key, make) => { let v = cache.get(key); if (v === undefined) { v = svgUrl(make()); cache.set(key, v); } return v; };

/** The provider play/icons.mjs uses: { portrait(kind, owner) -> data URL | null, icon(id) -> data URL | null }. */
export const toasterArt = Object.freeze({
  portrait(kind, owner = 0) {
    const o = owner === 1 ? 1 : 0;
    if (STRUCTURE_ART_KINDS.includes(kind)) return once(`s:${kind}:${o}`, () => structureIconSvg(kind, o));
    return once(`u:${toasterKindOf(kind)}:${o}`, () => toasterPortraitSvg(kind, o));
  },
  icon(id) {
    if (ACTIONS.has(id)) return once(`a:${id}`, () => actionIconSvg(id));
    if (STRUCTURE_ART_KINDS.includes(id)) return this.portrait(id, 0);
    if (UNIT_ART_KINDS.includes(id) || TOASTERS[id]) return this.portrait(id, 0);
    return null;
  },
});
