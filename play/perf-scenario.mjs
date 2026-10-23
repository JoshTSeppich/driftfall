// The 60 fps gate's scenario (owner: haiku, Performance). A pure builder, so node tests can check it without a browser:
// the v4 map (128 x 128, maps/driftfall-v4.json through env/map.mjs), both Cores, and N units spread over open floor,
// split evenly between the two sides and point-mirrored. Half of them march across the map at once (the worst case for
// the renderer: every unit moving, every frame), the other half stand still on their tile.
//
//   buildPerfScenario({ seed, units }) -> { state, map, units: [{ id, side, kind, x, y, marching }] }
//   The state is a plain sim state (env/state.mjs createTestState plus the v4 layers the renderer reads).
import { generateMapV4 } from '../env/map.mjs';
import { createTestState } from '../env/state.mjs';

export const PERF_UNITS = 200;
export const PERF_SEED = 7;
const KINDS = ['grunt', 'grunt', 'grunt', 'lancer', 'lancer'];   // 60% melee, 40% ranged, the usual mix

export function buildPerfScenario({ seed = PERF_SEED, units = PERF_UNITS } = {}) {
  if (!Number.isInteger(units) || units < 2 || units % 2) throw new Error('units must be an even count of at least 2');
  const map = generateMapV4(seed);
  const { width, height } = map;
  const taken = new Set([...map.cores.map((c) => `${c.x},${c.y}`)]);
  // Open floor on side 0's half, in reading order, so the even stride spreads the units over the whole half.
  const half = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width / 2; x++) {
      if (map.tiles[y][x] === '.' && !taken.has(`${x},${y}`)) half.push({ x, y });
    }
  }
  const perSide = units / 2;
  if (half.length < perSide) throw new Error(`only ${half.length} open tiles on side 0's half`);
  const chosen = [];
  for (let i = 0; i < perSide; i++) chosen.push(half[Math.floor((i * half.length) / perSide)]);

  const placed = [];
  let nextId = 1 + map.cores.length;
  let i = 0;
  for (const tile of chosen) {
    const kind = KINDS[i % KINDS.length];
    const marching = i % 2 === 0;
    placed.push({ id: nextId++, side: 0, kind, x: tile.x, y: tile.y, marching });
    // point mirror: side 1 is (W-1-x, H-1-y)
    placed.push({ id: nextId++, side: 1, kind, x: width - 1 - tile.x, y: height - 1 - tile.y, marching });
    i++;
  }

  const crystals = map.crystals.map((c) => ({ x: c.x, y: c.y, amount: c.amount }));
  const state = createTestState({
    width, height, seed,
    rocks: map.rocks,
    crystals,
    shards: [0, 0],
    structures: map.cores.map((c, side) => ({ id: side + 1, owner: side, kind: 'core', x: c.x, y: c.y })),
    units: placed.map((p) => ({
      id: p.id, owner: p.side, kind: p.kind, x: p.x, y: p.y,
      order: p.marching ? { type: 'move', x: width - 1 - p.x, y: height - 1 - p.y } : null,
    })),
  });
  // The v4 layers the renderer's terrain, buildings and vents read (the sim reads tiles and heights for the ramp rule).
  state.tiles = map.tiles;
  state.heights = map.heights;
  state.ramps = map.ramps;
  state.vents = map.vents;
  state.rubble = map.rubble;
  return { state, map, units: placed };
}
