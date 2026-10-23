// Team sonnet's Driftfall player. Strategy notes live in NOTES.md.
//
// Shape: economy (spread Workers over crystal tiles, keep training), tech (Forge early, a second one when rich,
// a Turret when the enemy shows up near home), army (counter-composition, staged waves, focus on the nearest
// threat, then the Core). Everything is driven by the stats table handed to createPlayer, so a new unit kind only
// needs a row in COUNTERS / ROLE below (unknown kinds fall back to a generic melee-or-ranged guess by range).

const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// How good a kind is as an addition against what the enemy has. Higher wins the next training slot.
// Keys are enemy kinds; values are weights per own kind. Missing entries count as 1.
const COUNTERS = {
  grunt: { lancer: 2.0, grunt: 1.0, brute: 1.0 },
  lancer: { grunt: 1.6, brute: 1.2, lancer: 0.8 },
  brute: { lancer: 2.2, grunt: 0.6, brute: 0.8 },
  worker: { grunt: 1.5, lancer: 1.0, brute: 0.3 },
  turret: { brute: 2.5, lancer: 1.3, grunt: 0.5 },
};
const BASE_MIX = { grunt: 1.0, lancer: 1.0, brute: 0.5 };

export function createPlayer({ side, seed, stats }) {
  const U = stats.units;
  const S = stats.structures;
  const combatKinds = Object.keys(U).filter((k) => k !== 'worker');
  const power = (u) => {
    const s = U[u.kind];
    if (!s || u.kind === 'worker') return 0;
    // hp * damage is the usual "lanchester" strength; range adds a little.
    return (u.hp ?? s.hp) * s.damage * (1 + (s.range - 1) * 0.15) / (s.speed >= 2 ? 1.0 : 1.0);
  };

  let attacking = false;
  let rally = null;

  function act(obs) {
    const cmds = [];
    const me = side;
    const foe = 1 - side;
    const myUnits = obs.units.filter((u) => u.owner === me);
    const enemyUnits = obs.units.filter((u) => u.owner === foe);
    const myStruct = obs.structures.filter((s) => s.owner === me);
    const enemyStruct = obs.structures.filter((s) => s.owner === foe);
    const core = myStruct.find((s) => s.kind === 'core');
    const enemyCore = enemyStruct.find((s) => s.kind === 'core');
    if (!core) return cmds;
    let shards = obs.shards[me];

    const workers = myUnits.filter((u) => u.kind === 'worker');
    const army = myUnits.filter((u) => u.kind !== 'worker');
    const forges = myStruct.filter((s) => s.kind === 'forge');
    const doneForges = forges.filter((s) => s.complete);
    const turrets = myStruct.filter((s) => s.kind === 'turret');
    const enemyArmy = enemyUnits.filter((u) => u.kind !== 'worker');

    const occupied = new Set();
    for (const u of obs.units) occupied.add(u.x + ',' + u.y);
    for (const s of obs.structures) occupied.add(s.x + ',' + s.y);
    const rockSet = new Set(obs.rocks.map((r) => r[0] + ',' + r[1]));
    const crystalSet = new Set(obs.crystals.map((c) => c.x + ',' + c.y));
    const blockedTile = (x, y) =>
      x < 0 || y < 0 || x >= obs.width || y >= obs.height || rockSet.has(x + ',' + y) || crystalSet.has(x + ',' + y);
    const free = (x, y) => !blockedTile(x, y) && !occupied.has(x + ',' + y);

    // ------------------------------------------------------------ economy
    const live = obs.crystals.filter((c) => c.amount > 0);
    const headed = new Map();
    for (const w of workers) {
      if (w.order && w.order.type === 'gather') {
        const k = w.order.x + ',' + w.order.y;
        headed.set(k, (headed.get(k) ?? 0) + 1);
      }
    }
    // Prefer fields near our own core; avoid tiles close to enemy army (contested field danger).
    const dangerNear = (c) => enemyArmy.some((e) => dist(e, c) <= 6);
    for (const w of workers) {
      if (w.order) continue;
      let best = null;
      let bestScore = Infinity;
      for (const c of live) {
        const load = headed.get(c.x + ',' + c.y) ?? 0;
        const score = load * 6 + dist(c, core) + (dangerNear(c) ? 40 : 0) + dist(w, c) * 0.1;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best) {
        cmds.push({ type: 'gather', unit: w.id, x: best.x, y: best.y });
        headed.set(best.x + ',' + best.y, (headed.get(best.x + ',' + best.y) ?? 0) + 1);
      }
    }

    // ------------------------------------------------------------ spending
    const queuedWorkers = core.queue.length;
    const targetWorkers = obs.tick < 400 ? 7 : 8;
    const unitTotal = myUnits.length + obs.structures.filter((s) => s.owner === me).reduce((n, s) => n + s.queue.length, 0);
    let room = obs.unitCap - unitTotal;
    const emergency = enemyArmy.some((e) => dist(e, core) <= 9);

    // Choose a build tile near the core: open, not next to a crystal, not hugging the core's walking lanes.
    function findSite(prefer) {
      let best = null;
      let bestScore = Infinity;
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const x = core.x + dx;
          const y = core.y + dy;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d < 2 || !free(x, y)) continue;
          if (obs.crystals.some((c) => dist(c, { x, y }) <= 1)) continue;
          // keep at least 3 open orthogonal neighbours so we don't wall ourselves in
          let open = 0;
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!blockedTile(x + ax, y + ay)) open++;
          if (open < 3) continue;
          const toEnemy = enemyCore ? dist({ x, y }, enemyCore) : 0;
          // Tie-breaks use side-signed offsets so both sides choose mirrored tiles.
          const sg = side === 0 ? 1 : -1;
          const score = d * 2 + (prefer === 'front' ? toEnemy * 0.3 : toEnemy * 0.1) + (dy * sg * 0.01 + dx * sg * 0.001);
          if (score < bestScore) {
            bestScore = score;
            best = { x, y };
          }
        }
      }
      return best;
    }

    function builder(site) {
      const idle = workers.filter((w) => !(w.order && w.order.type === 'build'));
      let best = null;
      let bd = Infinity;
      for (const w of idle) {
        const d = dist(w, site) + (w.carrying > 0 ? 6 : 0);
        if (d < bd) {
          bd = d;
          best = w;
        }
      }
      return best;
    }

    const building = obs.structures.some((s) => s.owner === me && !s.complete);
    function tryBuild(kind, prefer) {
      if (building || shards < S[kind].cost) return false;
      const site = findSite(prefer);
      const w = site && builder(site);
      if (!w) return false;
      cmds.push({ type: 'build', unit: w.id, kind, x: site.x, y: site.y });
      shards -= S[kind].cost;
      return true;
    }

    // 1. Opening: second worker early, then the Forge, then keep both flowing.
    const earlyWorkers = obs.tick < 120 ? 6 : targetWorkers;
    if (!forges.length) {
      // Save for the Forge once we have enough Workers.
      if (workers.length + queuedWorkers < Math.min(earlyWorkers, 5) && shards >= U.worker.cost && queuedWorkers < 2) {
        cmds.push({ type: 'train', building: core.id, kind: 'worker' });
        shards -= U.worker.cost;
      }
      tryBuild('forge', 'back');
    } else {
      if (workers.length + queuedWorkers < earlyWorkers && room > 0 && queuedWorkers < 2 && shards >= U.worker.cost && (doneForges.length === 0 || shards >= U.worker.cost + 0)) {
        cmds.push({ type: 'train', building: core.id, kind: 'worker' });
        shards -= U.worker.cost;
        room--;
      }
      // A Turret at home if the enemy shows up and we have a Forge going.
      if (emergency && turrets.length < 2 && doneForges.length) tryBuild('turret', 'front');
      // Second Forge when floating money.
      if (forges.length < 2 && shards >= S.forge.cost + 100 && doneForges.length && obs.tick > 150) tryBuild('forge', 'back');

      // Army training, balanced by counter weights.
      const enemyCount = {};
      for (const e of enemyUnits) enemyCount[e.kind] = (enemyCount[e.kind] ?? 0) + 1;
      for (const s of enemyStruct) if (s.kind === 'turret' && s.complete) enemyCount.turret = (enemyCount.turret ?? 0) + 1;
      const have = {};
      for (const u of army) have[u.kind] = (have[u.kind] ?? 0) + 1;
      for (const f of forges) for (const k of f.queue) have[k] = (have[k] ?? 0) + 1;

      for (const f of doneForges) {
        let guard = 0;
        while (f.queue.length < 2 && room > 0 && guard++ < 3) {
          const choices = (S.forge.trains ?? combatKinds).filter((k) => U[k]);
          if (!choices.length) break;
          // Score: counter weight * need (inverse of how many we already have vs the target mix)
          let best = null;
          let bs = -Infinity;
          for (const k of choices) {
            let w = 0;
            let tot = 0;
            for (const ek of Object.keys(enemyCount)) {
              const c = (COUNTERS[ek] && COUNTERS[ek][k]) ?? 1;
              w += c * enemyCount[ek];
              tot += enemyCount[ek];
            }
            w = tot ? w / tot : 1;
            const base = BASE_MIX[k] ?? 0.7;
            const s = (w * base) / (1 + (have[k] ?? 0) * 0.5);
            if (s > bs) {
              bs = s;
              best = k;
            }
          }
          // Wait for the preferred kind rather than leaking money into the cheapest one every time.
          if (shards < U[best].cost) break;
          cmds.push({ type: 'train', building: f.id, kind: best });
          have[best] = (have[best] ?? 0) + 1;
          f.queue.push(best);
          shards -= U[best].cost;
          room--;
        }
      }
      // Late game extra Workers are wasteful; if rich and under cap, a few more is fine (handled by value tiebreak).
    }

    // ------------------------------------------------------------ army
    if (!rally) {
      // staging point: a few tiles from the core toward the enemy
      const ex = enemyCore ? enemyCore.x : obs.width - 1 - core.x;
      const ey = enemyCore ? enemyCore.y : obs.height - 1 - core.y;
      const dx = Math.sign(ex - core.x);
      const dy = Math.sign(ey - core.y);
      rally = { x: core.x + dx * 5, y: core.y + dy * 5 };
    }
    const myPower = army.reduce((n, u) => n + power(u), 0);
    const foePower = enemyArmy.reduce((n, u) => n + power(u), 0);
    const foeTurrets = enemyStruct.filter((s) => s.kind === 'turret' && s.complete);
    const needed = foePower * 1.25 + foeTurrets.length * 6000 + 3000;
    if (!attacking && myPower >= needed && army.length >= 4) attacking = true;
    if (attacking && (myPower < foePower * 0.7 || army.length <= 1)) attacking = false;
    // Late game: if the clock is running out and we're ahead on value, hold; if behind, go all in.
    if (obs.tick > 1500 && army.length >= 3) attacking = true;

    // Defend: enemy units near our core/workers pull the army home even when not attacking.
    const threats = enemyUnits.filter((e) => dist(e, core) <= 10 || workers.some((w) => dist(w, e) <= 4));

    const pickTarget = (u, pool, maxD) => {
      let best = null;
      let bd = Infinity;
      for (const e of pool) {
        const d = dist(u, e);
        if (d > maxD) continue;
        // Prefer low-hp and dangerous kinds slightly.
        const s = U[e.kind];
        const dang = s && e.kind !== 'worker' ? 0 : 3;
        const sc = d + dang + (e.hp ?? 100) * 0.02;
        if (sc < bd) {
          bd = sc;
          best = e;
        }
      }
      return best;
    };

    for (const u of army) {
      const range = U[u.kind].range;
      let target = null;
      if (attacking) {
        const fightPool = enemyUnits.filter((e) => e.kind !== 'worker');
        target = pickTarget(u, fightPool, 9);
        if (!target) {
          const turretsNear = foeTurrets.filter((t) => dist(t, u) <= 7 + range);
          if (turretsNear.length && u.kind === 'brute') target = turretsNear[0];
        }
        if (!target) target = pickTarget(u, enemyUnits, 8);
        if (!target) {
          // structures: production first (kill the army source), then core
          const prod = enemyStruct.filter((s) => s.kind !== 'core' && s.kind !== 'turret');
          const near = prod.filter((s) => dist(s, u) <= 6);
          target = near[0] ?? enemyCore ?? enemyStruct[0] ?? null;
        }
      } else if (threats.length) {
        target = pickTarget(u, threats, 40);
      }
      if (target) {
        const cur = u.order;
        if (!(cur && cur.type === 'attack' && cur.target === target.id)) {
          cmds.push({ type: 'attack', unit: u.id, target: target.id });
        }
      } else if (!u.order || (u.order.type === 'attack')) {
        if (dist(u, rally) > 2) cmds.push({ type: 'move', unit: u.id, x: rally.x, y: rally.y });
        else if (u.order) cmds.push({ type: 'stop', unit: u.id });
      }
    }

    // Workers under attack nearby flee? Keep mining; army handles it. Limit command count.
    return cmds.slice(0, 90);
  }

  return { name: 'sonnet', act };
}
