// Fanatic sonnet: the pro's "fast forge, Grunt timing" opener. 6 Workers, early Forge, mass Grunts, hit at 7.
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function createPlayer({ side, stats }) {
  const U = stats.units;
  let sent = false;
  function act(obs) {
    const cmds = [];
    let shards = obs.shards[side];
    const mine = obs.units.filter((u) => u.owner === side);
    const core = obs.structures.find((s) => s.owner === side && s.kind === 'core');
    if (!core) return cmds;
    const workers = mine.filter((u) => u.kind === 'worker');
    const army = mine.filter((u) => u.kind !== 'worker');
    const forges = obs.structures.filter((s) => s.owner === side && s.kind === 'forge');
    const foeCore = obs.structures.find((s) => s.owner !== side && s.kind === 'core');
    const live = obs.crystals.filter((c) => c.amount > 0).sort((a, b) => dist(a, core) - dist(b, core));
    workers.forEach((w, i) => {
      if (!w.order && live.length) {
        const c = live[i % Math.min(live.length, 3)];
        cmds.push({ type: 'gather', unit: w.id, x: c.x, y: c.y });
      }
    });
    if (core.complete && core.queue.length < 2 && workers.length + core.queue.length < 6 && shards >= U.worker.cost) {
      cmds.push({ type: 'train', building: core.id, kind: 'worker' });
      shards -= U.worker.cost;
    }
    if (!forges.length && shards >= stats.structures.forge.cost && workers.length) {
      const dx = side === 0 ? 4 : -4;
      const x = Math.max(1, Math.min(obs.width - 2, core.x + dx));
      const y = Math.max(1, Math.min(obs.height - 2, core.y + dx));
      const w = workers.find((u) => !(u.order && u.order.type === 'build'));
      if (w) cmds.push({ type: 'build', unit: w.id, kind: 'forge', x, y });
    }
    for (const f of forges) {
      if (!f.complete) continue;
      let room = 2 - f.queue.length;
      while (room-- > 0 && shards >= U.grunt.cost) {
        cmds.push({ type: 'train', building: f.id, kind: 'grunt' });
        shards -= U.grunt.cost;
      }
    }
    if (army.length >= 7) sent = true;
    if (sent) {
      const home = { x: obs.width - 1 - core.x, y: obs.height - 1 - core.y };
      for (const u of army) {
        if (foeCore) {
          if (!(u.order && u.order.type === 'attack')) cmds.push({ type: 'attack', unit: u.id, target: foeCore.id });
        } else if (!u.order) cmds.push({ type: 'move', unit: u.id, x: home.x, y: home.y });
      }
    }
    return cmds;
  }
  return { name: 'fanatic-sonnet', act };
}
