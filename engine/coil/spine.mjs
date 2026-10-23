// Coil Engine: follow-the-leader chain (verlet with distance constraints). Used for the Crumb's cord, antennae,
// hoses and the Smoke Alarm's tail. The first joint is pinned to the head; every other joint follows at a fixed
// spacing, so the chain traces the path the head took instead of sliding as a stiff object.
// Fixed 120 Hz substeps keep it stable at any frame rate. Pure maths, no Three.js. Owner: fable.

const STEP = 1 / 120, MAX_STEPS = 12, MAX_FRAME = 0.25;

// opts: count, spacing, gravity (y accel, negative = down), drag (1/s), floor (y or null), iterations
export function createChain(opts = {}) {
  const count = Math.max(2, opts.count | 0 || 6), spacing = opts.spacing ?? 0.15;
  const gravity = opts.gravity ?? -9, drag = opts.drag ?? 3, floor = opts.floor ?? null, iterations = opts.iterations ?? 6;
  const damp = Math.exp(-drag * STEP);
  const positions = new Float64Array(count * 3), prev = new Float64Array(count * 3);
  let acc = 0, ready = false, lx = 0, ly = 0, lz = 0;

  function lay(hx, hy, hz) {
    for (let j = 0; j < count; j++) {
      positions[j * 3] = prev[j * 3] = hx;
      positions[j * 3 + 1] = prev[j * 3 + 1] = hy;
      positions[j * 3 + 2] = prev[j * 3 + 2] = hz - spacing * j;
    }
    lx = hx; ly = hy; lz = hz; acc = 0; ready = true;
  }

  function relax() {
    for (let it = 0; it < iterations; it++) {
      for (let j = 1; j < count; j++) {
        const a = (j - 1) * 3, b = j * 3;
        const dx = positions[b] - positions[a], dy = positions[b + 1] - positions[a + 1], dz = positions[b + 2] - positions[a + 2];
        const len = Math.hypot(dx, dy, dz) || 1e-9, diff = (len - spacing) / len;
        const wa = j === 1 ? 0 : 0.5, wb = 1 - wa;      // joint 0 is pinned to the head
        positions[a] += dx * diff * wa; positions[a + 1] += dy * diff * wa; positions[a + 2] += dz * diff * wa;
        positions[b] -= dx * diff * wb; positions[b + 1] -= dy * diff * wb; positions[b + 2] -= dz * diff * wb;
      }
      if (floor !== null) for (let j = 1; j < count; j++) if (positions[j * 3 + 1] < floor) positions[j * 3 + 1] = floor;
    }
  }

  return {
    count, spacing, positions,
    reset(hx, hy, hz) { lay(hx, hy, hz); },
    step(dt, hx, hy, hz) {
      if (!Number.isFinite(hx + hy + hz)) return positions;
      if (!ready || Math.hypot(hx - lx, hy - ly, hz - lz) > count * spacing * 2) { lay(hx, hy, hz); return positions; }
      if (!(dt > 0) || !Number.isFinite(dt)) return positions;
      acc += Math.min(dt, MAX_FRAME);
      let steps = Math.floor(acc / STEP);
      if (steps > MAX_STEPS) { steps = MAX_STEPS; acc = 0; } else acc -= steps * STEP;
      const g = gravity * STEP * STEP;
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        for (let j = 1; j < count; j++) {
          const o = j * 3;
          for (let c = 0; c < 3; c++) {
            const p = positions[o + c], v = (p - prev[o + c]) * damp;
            prev[o + c] = p; positions[o + c] = p + v + (c === 1 ? g : 0);
          }
        }
        positions[0] = lx + (hx - lx) * u; positions[1] = ly + (hy - ly) * u; positions[2] = lz + (hz - lz) * u;
        relax();
      }
      positions[0] = hx; positions[1] = hy; positions[2] = hz;
      lx = hx; ly = hy; lz = hz;
      if (steps === 0) relax();
      return positions;
    },
  };
}
