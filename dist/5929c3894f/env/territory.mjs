// Territory: Reaches, claims, hold, Hold count and the territory win. Rules: TERRITORY.md sections 2, 3 and 5.
// Pure and deterministic: no clock, no randomness. The sim calls updateTerritory(state) once a tick after combat and
// merges a returned result into state.result. Nothing here runs unless the sim wires it in.

export const TERRITORY_RULES = Object.freeze({
  holdTicks: 240, // 10 s at 24 ticks a second: enemy alone this long breaks a hold
  winCount: 14, // Reaches held ...
  winTicks: 2160, // ... for 90 s
  claimKinds: Object.freeze(['totem', 'mound']),
  coreClaims: true, // the Core claims the Reach it stands in
  nonCombat: Object.freeze(['worker']), // units that neither contest nor defend
});

const inPoly = (poly, px, py) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Also accepts the map file's names: rect [x0, y0, x1, y1] or {x, y, w, h} for outline, kind for role, center for centre.
function normalizeReach(r) {
  let outline = r.outline;
  if (!outline && r.rect) {
    const [a, b, c, d] = Array.isArray(r.rect) ? r.rect : [r.rect.x, r.rect.y, r.rect.x + r.rect.w, r.rect.y + r.rect.h];
    outline = [[a, b], [c, b], [c, d], [a, d]];
  }
  const centre = r.centre || r.center || null;
  return { ...r, outline, role: r.role || r.kind, centre, claimSpot: r.claimSpot || centre };
}

// layout: { width, height, reaches: [{ id, name, role, side, mirror, centre, claimSpot, outline }] }.
// Outlines are polygons in tile coordinates; a tile belongs to the lowest-id Reach whose polygon holds its centre.
export function buildReaches(layout) {
  const { width, height } = layout;
  const reaches = layout.reaches.map(normalizeReach).sort((a, b) => a.id - b.id);
  reaches.forEach((r, i) => {
    if (r.id !== i) throw new Error(`reach id ${r.id} must be ${i} (ids run 0..n-1 without repeats)`);
    if (!Array.isArray(r.outline) || r.outline.length < 3) throw new Error(`reach ${r.id} outline needs at least 3 points`);
  });
  const grid = new Int16Array(width * height).fill(-1);
  for (const r of reaches) {
    const xs = r.outline.map((p) => p[0]);
    const ys = r.outline.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (grid[y * width + x] === -1 && inPoly(r.outline, x + 0.5, y + 0.5)) grid[y * width + x] = r.id;
      }
    }
  }
  const reachAt = (x, y) => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return -1;
    return grid[ty * width + tx];
  };
  return { width, height, reaches, grid, reachAt };
}

export function createTerritory(state, reachMap, rules = {}) {
  state.territory = {
    rules: { ...TERRITORY_RULES, ...rules },
    map: reachMap,
    reaches: reachMap.reaches.map((x) => ({ id: x.id, claimedBy: null, holder: null, contested: false, alone: [0, 0] })),
    hold: [0, 0],
    countdown: [null, null],
  };
  return state.territory;
}

export function holdCount(state, side) {
  return state.territory ? state.territory.hold[side] : 0;
}

export function reachSummary(state) {
  const t = state.territory;
  return t.map.reaches.map((r, i) => ({
    id: r.id, name: r.name, role: r.role, holder: t.reaches[i].holder, contested: t.reaches[i].contested,
  }));
}

function emit(state, event) {
  (state.events ||= []).push(event);
}

// One tick. Returns a result ({ winner, reason: 'territory', tick }) on the tick a side wins, else null.
export function updateTerritory(state) {
  const t = state.territory;
  if (!t) return null;
  const { rules, map } = t;
  const n = t.reaches.length;
  const present = Array.from({ length: n }, () => [0, 0]);
  const claimBy = new Array(n).fill(null);

  for (const u of state.units) {
    if (u.hp <= 0 || u.inside || rules.nonCombat.includes(u.kind)) continue; // a unit inside a Barge is off the map
    const id = map.reachAt(u.x, u.y);
    if (id >= 0 && (u.owner === 0 || u.owner === 1)) present[id][u.owner]++;
  }
  for (const s of [...state.structures, ...(state.claims || [])]) {
    if (!s.complete || s.hp <= 0) continue;
    if (!(rules.claimKinds.includes(s.kind) || (rules.coreClaims && s.kind === 'core'))) continue;
    const id = map.reachAt(s.x, s.y);
    if (id >= 0 && t.flooded && t.flooded.has(id)) continue; // water: claims there stop working
    if (id >= 0 && claimBy[id] === null) claimBy[id] = s.owner; // structures are in id order: the oldest claim wins
  }

  const hold = [0, 0];
  for (let i = 0; i < n; i++) {
    const rs = t.reaches[i];
    const owner = claimBy[i];
    if (owner !== rs.claimedBy) {
      rs.claimedBy = owner;
      rs.alone = [0, 0];
      if (owner !== null) emit(state, { e: 'claimed', player: owner, reach: i });
    }
    let holder = null;
    let contested = false;
    if (owner !== null) {
      const enemy = 1 - owner;
      if (present[i][enemy] > 0 && present[i][owner] === 0) rs.alone[owner]++;
      else rs.alone[owner] = 0;
      contested = rs.alone[owner] > 0;
      if (rs.alone[owner] === 1) emit(state, { e: 'contested', player: owner, by: enemy, reach: i });
      if (rs.alone[owner] <= rules.holdTicks) holder = owner; // the hold breaks on tick holdTicks + 1 (241)
    }
    if (holder !== rs.holder) {
      if (rs.holder !== null) emit(state, { e: 'hold-lost', player: rs.holder, reach: i });
      if (holder !== null) emit(state, { e: 'hold-gained', player: holder, reach: i });
      rs.holder = holder;
    }
    rs.contested = contested;
    if (holder !== null) hold[holder]++;
  }
  t.hold = hold;

  let result = null;
  for (const side of [0, 1]) {
    if (hold[side] >= rules.winCount) {
      if (t.countdown[side] === null) {
        t.countdown[side] = rules.winTicks;
        emit(state, { e: 'countdown-start', player: side, reaches: hold[side], ticks: rules.winTicks });
      } else {
        t.countdown[side]--;
      }
      if (t.countdown[side] <= 0 && !result) {
        emit(state, { e: 'territory-win', player: side, reaches: hold[side] });
        result = { winner: side, reason: 'territory', tick: state.tick };
      }
    } else if (t.countdown[side] !== null) {
      t.countdown[side] = null;
      emit(state, { e: 'countdown-cancel', player: side });
    }
  }
  return result;
}
