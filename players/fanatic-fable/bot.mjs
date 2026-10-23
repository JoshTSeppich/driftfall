// Fanatic-fable: a timing-attack opponent. Mines with ~10 Workers, drops a Forge early, then masses Lancers behind
// Grunts and pushes as one ball once it has 8 fighters, re-sending reinforcements. Player API only; no clock or
// randomness, so matches replay exactly.
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function createPlayer({ side, stats }) {
  const U = stats.units;
  const S = stats.structures;
  function act(obs) {
    const cmds = [];
    const mine = obs.units.filter((u) => u.owner === side);
    const foeU = obs.units.filter((u) => u.owner !== side);
    const core = obs.structures.find((s) => s.owner === side && s.kind === 'core');
    const foeCore = obs.structures.find((s) => s.owner !== side && s.kind === 'core');
    if (!core) return cmds;
    let shards = obs.shards[side];
    const workers = mine.filter((u) => u.kind === 'worker');
    const army = mine.filter((u) => u.kind !== 'worker');
    const forges = obs.structures.filter((s) => s.owner === side && s.kind === 'forge');
    const live = obs.crystals.filter((c) => c.amount > 0).sort((a, b) => dist(a, core) - dist(b, core) || a.y - b.y || a.x - b.x);
    const load = new Map();
    const key = (c) => c.x + ',' + c.y;
    for (const w of workers) if (w.order && w.order.type === 'gather') load.set(key(w.order), (load.get(key(w.order)) || 0) + 1);
    for (const w of workers) {
      if (w.order || !live.length) continue;
      const c = live.reduce((b, t) => ((load.get(key(t)) || 0) < (load.get(key(b)) || 0) ? t : b), live[0]);
      cmds.push({ type: 'gather', unit: w.id, x: c.x, y: c.y });
      load.set(key(c), (load.get(key(c)) || 0) + 1);
    }
    if (core.complete && workers.length + core.queue.length < 10 && core.queue.length < 2 && shards >= U.worker.cost) {
      cmds.push({ type: 'train', building: core.id, kind: 'worker' });
      shards -= U.worker.cost;
    }
    // Forge: first one at 6 workers, second when rich.
    const building = workers.some((w) => w.order && w.order.type === 'build');
    const want = forges.length === 0 ? workers.length >= 6 : forges.length === 1 && shards > 350;
    if (want && !building && shards >= S.forge.cost) {
      const taken = new Set([...obs.units, ...obs.structures].map(key));
      const rock = new Set(obs.rocks.map((r) => r[0] + ',' + r[1]));
      outer: for (let d = 3; d < 9; d++) {
        for (let dy = -d; dy <= d; dy++) {
          for (let dx = -d; dx <= d; dx++) {
            const x = core.x + dx;
            const y = core.y + dy;
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || x < 1 || y < 1 || x >= obs.width - 1 || y >= obs.height - 1) continue;
            const p = { x, y };
            if (taken.has(key(p)) || rock.has(key(p)) || obs.crystals.some((c) => dist(c, p) <= 2)) continue;
            const w = workers.find((q) => !(q.order && q.order.type === 'build'));
            if (!w) break outer;
            cmds.push({ type: 'build', unit: w.id, kind: 'forge', x, y });
            shards -= S.forge.cost;
            break outer;
          }
        }
      }
    }
    // Army: two lancers per grunt; more lancers when the foe has brutes.
    const foeBrutes = foeU.filter((u) => u.kind === 'brute').length;
    let nl = army.filter((u) => u.kind === 'lancer').length;
    let ng = army.filter((u) => u.kind === 'grunt').length;
    for (const f of forges.filter((s) => s.complete)) {
      if (f.queue.length >= 2) continue;
      const kind = foeBrutes > 1 || nl < ng * 2 ? 'lancer' : 'grunt';
      if (shards >= U[kind].cost) {
        cmds.push({ type: 'train', building: f.id, kind });
        shards -= U[kind].cost;
        if (kind === 'lancer') nl++; else ng++;
      }
    }
    // Push as a ball.
    const fc = foeCore || core;
    const rally = { x: Math.round((core.x * 2 + fc.x) / 3), y: Math.round((core.y * 2 + fc.y) / 3) };
    const go = army.length >= 8 || (obs.tick > 4200 && army.length >= 4);
    for (const u of army) {
      const near = foeU.filter((e) => dist(e, u) <= 7).sort((a, b) => dist(a, u) - dist(b, u) || a.id - b.id)[0];
      const t = near || (go ? foeCore : null);
      if (t) {
        if (!(u.order && u.order.type === 'attack' && u.order.target === t.id)) cmds.push({ type: 'attack', unit: u.id, target: t.id });
      } else if (dist(u, rally) > 3 && !u.order) cmds.push({ type: 'move', unit: u.id, x: rally.x, y: rally.y });
    }
    return cmds;
  }
  return { name: 'fanatic-fable', act };
}
