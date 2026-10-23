// Defender-sonnet: the counter-rush check (Council #1). Trains Workers to six, mines, builds one Turret beside its Core,
// and when an enemy fighter comes within 10 tiles of the Core every Worker without an attack order pulls onto the
// nearest enemy. Player API only; no clock or randomness, so matches replay exactly.
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function createPlayer({ side, stats }) {
  const U = stats.units;
  const T = stats.structures.turret;
  const WORKERS = 6;
  const PULL_RANGE = 10;
  function act(obs) {
    const cmds = [];
    let shards = obs.shards[side];
    const core = obs.structures.find((s) => s.owner === side && s.kind === 'core');
    if (!core) return cmds;
    const mine = obs.units.filter((u) => u.owner === side);
    const foes = obs.units.filter((u) => u.owner !== side);
    const workers = mine.filter((u) => u.kind === 'worker');
    const turrets = obs.structures.filter((s) => s.owner === side && s.kind === 'turret');
    const live = obs.crystals.filter((c) => c.amount > 0).sort((a, b) => dist(a, core) - dist(b, core) || a.y - b.y || a.x - b.x);

    // Pull: the nearest enemy fighter to the Core, if it is close enough, draws every idle Worker.
    const threat = foes.filter((f) => dist(f, core) <= PULL_RANGE).sort((a, b) => dist(a, core) - dist(b, core) || a.id - b.id)[0];
    if (threat) {
      for (const w of workers) {
        if (!(w.order && w.order.type === 'attack')) cmds.push({ type: 'attack', unit: w.id, target: threat.id });
      }
      return cmds;
    }

    for (const w of workers) {
      if (!w.order && live.length) {
        const c = live[workers.indexOf(w) % Math.min(live.length, 3)];
        cmds.push({ type: 'gather', unit: w.id, x: c.x, y: c.y });
      }
    }
    if (core.complete && workers.length + core.queue.length < WORKERS && core.queue.length < 2 && shards >= U.worker.cost) {
      cmds.push({ type: 'train', building: core.id, kind: 'worker' });
      shards -= U.worker.cost;
    }
    const building = workers.some((w) => w.order && w.order.type === 'build');
    if (turrets.length === 0 && !building && workers.length >= 4 && shards >= T.cost) {
      const x = Math.max(1, Math.min(obs.width - 2, core.x + (side === 0 ? 3 : -3)));
      const y = Math.max(1, Math.min(obs.height - 2, core.y + 3));
      const w = workers.find((u) => !u.order);
      if (w) cmds.push({ type: 'build', unit: w.id, kind: 'turret', x, y });
    }
    return cmds;
  }
  return { act };
}
