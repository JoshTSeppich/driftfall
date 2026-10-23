// Driftfall map sizes (TERRITORY.md section 14), owned by sonnet: Standard 128 (21 Reaches), Large 192 (31) and
// Huge 256 (41). Same drawing code as maps/layout-v4.mjs (drawV4 takes a spec); this file holds the Large and Huge
// specs. Pure: no fs, no clock, no randomness (the seed only scatters rocks, see scatterV4).
//
// Both are hand-drawn at the Reach level on a grid: Reaches are rooms 4 tiles apart, side 0 fills the top half
// (5 columns x 3 or 4 rows), the point mirror (x, y) -> (W-1-x, H-1-y) makes side 1, and one wide Centre ("the Rift")
// sits across the middle. The middle lane: column 2 runs straight from the top row to the Rift, three lanes feed the
// Rift from each side, and two long links along the edges let flank armies cross without touching it.
// Row/column names are r<row>c<col>; kinds below are the hand-drawn part (what each room is for).
import { STANDARD, drawV4, encodeV4, decodeV4 } from './layout-v4.mjs';

const COL_W = { large: 34, huge: 46 };
const COL_X0 = { large: 3, huge: 5 };
const COL_STEP = { large: 38, huge: 50 };
const ROW_H = 24;
const ROW_Y0 = 2;
const ROW_STEP = 30;

// What each room is, row by row (left to right). main and natural appear once per side; mesas and Main are plateaus.
const KINDS = {
  large: [
    ['main', 'vent', 'flank', 'pocket', 'outer'],
    ['natural', 'vent', 'mesa', 'rich', 'outer'],
    ['outer', 'flank', 'mesa', 'vent', 'pocket'],
  ],
  huge: [
    ['main', 'vent', 'flank', 'pocket', 'outer'],
    ['natural', 'vent', 'mesa', 'rich', 'outer'],
    ['outer', 'pocket', 'flank', 'mesa', 'vent'],
    ['flank', 'vent', 'mesa', 'rich', 'outer'],
  ],
};

// Doors, as pairs of grid cells "row,col". H = side by side, V = one above the other. Left out on purpose: they make
// walls, so the map has lanes and chokes instead of one open field.
const DOORS = {
  large: {
    H: [['0,0', '0,1'], ['0,1', '0,2'], ['0,2', '0,3'], ['0,3', '0,4'],
      ['1,0', '1,1'], ['1,2', '1,3'], ['1,3', '1,4'],
      ['2,0', '2,1'], ['2,1', '2,2'], ['2,2', '2,3'], ['2,3', '2,4']],
    V: [['0,0', '1,0'], ['1,0', '2,0'], ['0,1', '1,1'], ['0,2', '1,2'], ['1,2', '2,2'], ['1,3', '2,3'], ['0,4', '1,4'], ['1,4', '2,4']],
    rift: [1, 2, 3], // columns of the last row that open into the Rift
  },
  huge: {
    H: [['0,0', '0,1'], ['0,1', '0,2'], ['0,2', '0,3'], ['0,3', '0,4'],
      ['1,0', '1,1'], ['1,2', '1,3'], ['1,3', '1,4'],
      ['2,0', '2,1'], ['2,1', '2,2'], ['2,3', '2,4'],
      ['3,0', '3,1'], ['3,1', '3,2'], ['3,2', '3,3'], ['3,3', '3,4']],
    V: [['0,0', '1,0'], ['1,0', '2,0'], ['2,0', '3,0'], ['0,1', '1,1'], ['2,1', '3,1'], ['0,2', '1,2'], ['1,2', '2,2'], ['2,2', '3,2'],
      ['1,3', '2,3'], ['0,4', '1,4'], ['1,4', '2,4'], ['2,4', '3,4']],
    rift: [1, 2, 3],
  },
};

const nameOf = (kind, count) => (kind === 'main' || kind === 'natural' ? kind[0].toUpperCase() + kind.slice(1) : `${kind[0].toUpperCase()}${kind.slice(1)} ${count}`);

function features(kind, [x0, y0, x1, y1]) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const f = {};
  const S = (x, y, a = 4, b = 2) => (f.S ||= []).push([x0 + x, y0 + y, a, b]);
  const R = (x, y, a = 2, b = 2) => (f.R ||= []).push([x0 + x, y0 + y, a, b]);
  const L = (x, y) => (f.L ||= []).push([x0 + x, y0 + y]);
  switch (kind) {
    case 'main':
      f.core = [x0 + 6, y0 + 6];
      f.workers = [[1, 0], [0, 1], [1, 1], [2, 2], [2, 0], [0, 2]].map(([a, b]) => [x0 + 6 + a, y0 + 6 + b]);
      S(14, 4);
      break;
    case 'natural': S(6, 5); L(w - 9, h - 7); break;
    case 'vent': S(6, 5, 2, 2); L(w - 9, 5); L(8, h - 7); break;
    case 'flank': S(6, 5); break;
    case 'pocket': S(6, 5); L(w - 9, h - 7); break;
    case 'mesa': R((w >> 1) - 1, (h >> 1) - 1); L(7, 5); L(w - 8, h - 6); break;
    case 'rich': R(6, 5, 4, 2); break;
    case 'outer': S(6, 5); L(w - 9, h - 7); break;
    default: break;
  }
  return f;
}

function buildSpec(name) {
  const kinds = KINDS[name];
  const cols = kinds[0].length, rows = kinds.length;
  const w = name === 'large' ? 192 : 256, h = w;
  const seen = {};
  const side0 = [];
  const heightOf = new Map();
  const feat = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const kind = kinds[r][c];
    const x0 = COL_X0[name] + COL_STEP[name] * c, y0 = ROW_Y0 + ROW_STEP * r;
    const rect = [x0, y0, x0 + COL_W[name] - 1, y0 + ROW_H - 1];
    seen[kind] = (seen[kind] || 0) + 1;
    const key = `r${r}c${c}`;
    const plateau = kind === 'main' || kind === 'mesa';
    side0.push({ key, name: nameOf(kind, seen[kind]), kind, rect, h: plateau ? 1 : 0, chamfer: kind === 'main' ? 4 : 3 });
    heightOf.set(`${r},${c}`, { key, h: plateau ? 1 : 0, rect });
    feat[key] = features(kind, rect);
  }
  const lastRow = rows - 1;
  const lastY1 = ROW_Y0 + ROW_STEP * lastRow + ROW_H - 1; // bottom edge of the last row
  const centreY0 = lastY1 + 3; // two rock rows between the last row and the Rift
  const centreY1 = h - 1 - centreY0;
  const firstCol = COL_X0[name] + COL_STEP[name], lastColX1 = COL_X0[name] + COL_STEP[name] * 3 + COL_W[name] - 1;
  const centre = { key: 'centre', name: 'Rift', kind: 'centre', rect: [firstCol, centreY0, lastColX1, centreY1], h: 0, chamfer: 2 };
  const cx = Math.floor((firstCol + lastColX1) / 2), cy = Math.floor((centreY0 + centreY1) / 2);
  feat.centre = { R: [[cx - 1, cy - 1, 4, 4]], L: [[firstCol + 12, centreY0 + 3], [firstCol + 30, centreY0 + 3]] };
  // The vents sit on the Centre's top half; the mirror paints the bottom ones.

  // Gate tiles lie at ground level, so a door into or out of a plateau (Main, Mesa) is always a ramp.
  const type = (a, b) => (heightOf.get(a).h || (b === 'centre' ? 0 : heightOf.get(b).h) ? 'ramp' : 'floor');
  const gates0 = [];
  const D = DOORS[name];
  D.H.forEach(([a, b], i) => {
    const A = heightOf.get(a);
    // Alternate the door between the upper and lower part of the wall so lanes zig-zag.
    const line = A.rect[1] + (i % 2 ? ROW_H - 7 : 6);
    gates0.push([A.key, heightOf.get(b).key, line, type(a, b)]);
  });
  D.V.forEach(([a, b], i) => {
    const A = heightOf.get(a);
    const line = A.rect[0] + (i % 2 ? COL_W[name] - 9 : 8);
    gates0.push([A.key, heightOf.get(b).key, line, type(a, b)]);
  });
  for (const c of D.rift) {
    const A = heightOf.get(`${lastRow},${c}`);
    gates0.push([A.key, 'centre', A.rect[0] + (COL_W[name] >> 1), type(`${lastRow},${c}`, 'centre')]);
  }
  const edge = heightOf.get(`${lastRow},0`).key, farEdge = `r${lastRow}c${cols - 1}`;
  const cross = [[edge, `${farEdge}@1`, COL_X0[name] + 16, 'floor']];
  return {
    name, w, h, gateBase: name === 'large' ? 48 : 64, idDigits: 2,
    side0, centre, gates0, cross, features: feat,
  };
}

export const LARGE = buildSpec('large');
export const HUGE = buildSpec('huge');

/** Spec by name: 'standard' | 'large' | 'huge'. */
export const SPECS = { standard: STANDARD, large: LARGE, huge: HUGE };

/** Territory win: two-thirds of all Reaches (21 -> 14, 31 -> 21, 41 -> 28). */
export const winCountFor = (reachCount) => Math.ceil((reachCount * 2) / 3);

/** The decoded map for a size name, built once. Same shape as env/map.mjs loadMapV4. */
const cache = {};
export function loadMapSize(name) {
  const spec = SPECS[name];
  if (!spec) throw new Error(`unknown map size "${name}" (standard, large or huge)`);
  if (!cache[name]) {
    const decoded = decodeV4(JSON.parse(JSON.stringify(encodeV4(drawV4(spec)))));
    cache[name] = { ...decoded, size: name, winCount: winCountFor(decoded.reaches.length) };
  }
  return cache[name];
}
export { drawV4, encodeV4, decodeV4 };
