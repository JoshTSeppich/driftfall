// Coil Engine: 24 tps sim -> 60+ fps render. Push one pose per sim tick, sample at "tick + alpha - 1": render one tick
// behind the newest pose so there is always a pair to blend and nothing is ever extrapolated or overshoots.
// The last few poses are kept, so a late or jittery frame still finds the right pair. Pure maths. Owner: fable.

const TAU = Math.PI * 2;
export function wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
export function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }

// opts.angleKeys: fields lerped the short way round (default yaw, heading). opts.teleport: tile jump in x/z that
// snaps instead of sliding (spawns, Unplug & Move recalls). opts.keep: how many ticks of history to hold.
export function createInterpolator(tps = 24, opts = {}) {
  const angleKeys = new Set(opts.angleKeys ?? ['yaw', 'heading']);
  const teleport = opts.teleport ?? 8, keep = opts.keep ?? 4;
  let poses = [];
  return {
    tps,
    push(tick, pose) {
      const last = poses[poses.length - 1];
      if (last && tick <= last.tick) return false;     // late or duplicate tick
      if (last && Math.hypot((pose.x ?? 0) - (last.x ?? 0), (pose.z ?? 0) - (last.z ?? 0)) > teleport) poses = [];
      poses.push({ ...pose, tick });
      if (poses.length > keep) poses.shift();
      return true;
    },
    reset() { poses = []; },
    get latestTick() { return poses.length ? poses[poses.length - 1].tick : -Infinity; },
    sample(tickF, out = {}) {
      if (!poses.length) return out;
      let b = poses[poses.length - 1], a = b;
      for (let i = poses.length - 1; i >= 0; i--) { a = poses[i]; if (a.tick <= tickF) break; b = a; }
      if (a.tick > tickF) b = a;                        // before the oldest pose: hold it
      const span = b.tick - a.tick;
      const t = span > 0 ? Math.min(1, Math.max(0, (tickF - a.tick) / span)) : 1;
      for (const key of Object.keys(b)) {
        if (key === 'tick') continue;
        const vb = b[key], va = a[key];
        if (typeof vb !== 'number' || typeof va !== 'number') out[key] = t >= 0.5 ? vb : (va ?? vb);
        else out[key] = angleKeys.has(key) ? lerpAngle(va, vb, t) : va + (vb - va) * t;
      }
      return out;
    },
  };
}
