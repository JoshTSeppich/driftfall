// Driftfall built-in opponent for live play (CLASSIC.md). One self-contained file: it uses only the player API
// (ENV-SPEC §10), no imports, no clock, no randomness, so it also runs in the browser and replays exactly.
//
//   createPlayer({ side, seed, stats, difficulty: 'easy' | 'normal' })   // difficulty defaults to 'normal'
//
// What it does, in order of the match:
//   1. Economy: Workers mine the home field (two per tile), then extra Workers expand to the contested field.
//   2. Tech: a Forge as soon as the Shards allow, a second Forge when rich, a Turret guarding the expansion and one
//      at home when the enemy shows up.
//   3. Army: Grunt / Lancer / Brute mixed by a simple counter table (only kinds that exist in `stats` are used).
//   4. Attack: gathers at a rally point, sends a wave when big enough or when the clock says so, then keeps
//      reinforcing; falls back home to defend when the enemy walks in.
// Easy is slower and smaller on purpose: fewer Workers, no expansion Turret, a bigger and later first wave, and it
// only re-aims its army every few ticks. (env/live.mjs additionally makes easy think only every few ticks.)

// holdPlan: [tick, Hold wanted from then on], used only when the match runs the territory rules (obs.rules).
const SETTINGS = {
  normal: { holdPlan: [[2400, 2], [4000, 3], [7200, 4], [11520, 6]], workers: 12, forgeAt: 4, secondForge: true, expandTurret: true, wave: 8, earliest: 2400, waveByTick: 4800, minArmy: 3, rethink: 1, queue: 2 },
  easy: { holdPlan: [[6000, 2], [12000, 3]], workers: 8, forgeAt: 5, secondForge: false, expandTurret: false, wave: 12, earliest: 4800, waveByTick: 6600, minArmy: 5, rethink: 6, queue: 1 },
};

// Weight of our kind (inner key) against the enemy kind (outer key). Missing entries count as 1.
const COUNTERS = {
  grunt: { lancer: 2.0, grunt: 1.0, brute: 1.0 },
  lancer: { grunt: 1.6, brute: 1.2, lancer: 0.8 },
  brute: { lancer: 2.2, grunt: 0.6, brute: 0.8 },
  worker: { grunt: 1.5, lancer: 1.0, brute: 0.3 },
  turret: { brute: 2.5, lancer: 1.3, grunt: 0.5 },
};
const CLAIM_ROLES = ['natural', 'vent', 'flank', 'rich', 'mesa', 'pocket', 'outer', 'centre']; // claim order; nearest first within a role
const CLAIM_RETRY = 24 * 60; // a claim order not shown as claimed after a minute is retried
const FLOOD_WARN = 24 * 8; // pull units out of a Reach this long before a Flood
const BASE_MIX = { grunt: 1.0, lancer: 1.0, brute: 0.5, howler: 0, spiker: 0, dart: 0 }; // the rest of the roster: not yet in its plan

const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const HOME_RADIUS = 9; // crystal tiles within this of our Core are the home field

export function createPlayer({ side, seed, stats, difficulty } = {}) {
  const cfg = SETTINGS[difficulty] ?? SETTINGS.normal;
  const U = stats.units;
  const S = stats.structures;
  const combatKinds = Object.keys(U).filter((k) => k !== 'worker' && U[k].damage > 0);
  const power = (u) => {
    const s = U[u.kind];
    return !s || u.kind === 'worker' ? 0 : (u.hp ?? s.hp) * s.damage * (1 + (s.range - 1) * 0.15);
  };

  let attacking = false;
  let rally = null;
  let lastAim = -999;
  let calledOff = -999;
  let pendingClaim = null; // { reach, tick }: the one claim order in flight

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
    const enemyArmy = enemyUnits.filter((u) => u.kind !== 'worker');

    const taken = new Set();
    for (const u of obs.units) taken.add(u.x + ',' + u.y);
    for (const s of obs.structures) taken.add(s.x + ',' + s.y);
    const rockSet = new Set(obs.rocks.map((r) => r[0] + ',' + r[1]));
    const crystalSet = new Set(obs.crystals.map((c) => c.x + ',' + c.y));
    const blocked = (x, y) => x < 0 || y < 0 || x >= obs.width || y >= obs.height || rockSet.has(x + ',' + y) || crystalSet.has(x + ',' + y);
    const free = (x, y) => !blocked(x, y) && !taken.has(x + ',' + y);

    // ---------------------------------------------------------------- economy
    const live = obs.crystals.filter((c) => c.amount > 0);
    const home = live.filter((c) => dist(c, core) <= HOME_RADIUS);
    const away = live.filter((c) => dist(c, core) > HOME_RADIUS).sort((a, b) => dist(a, core) - dist(b, core) || a.y - b.y || a.x - b.x);
    // The expansion is the nearest far field: the far tiles close to the nearest far tile.
    const expansion = away.length ? away.filter((c) => dist(c, away[0]) <= 3) : [];
    const key = (c) => c.x + ',' + c.y;
    const load = new Map();
    for (const w of workers) if (w.order && w.order.type === 'gather') load.set(w.order.x + ',' + w.order.y, (load.get(w.order.x + ',' + w.order.y) ?? 0) + 1);
    const crystalAt = (x, y) => live.find((c) => c.x === x && c.y === y);
    const enemyNear = (c, r) => enemyArmy.some((e) => dist(e, c) <= r);
    const homeSlots = home.length * 2;
    const atHome = workers.filter((w) => w.order && w.order.type === 'gather' && home.some((c) => c.x === w.order.x && c.y === w.order.y)).length;
    const wantExpand = obs.tick >= 300 && forges.length > 0 && workers.length >= 7 && expansion.length > 0 && atHome >= Math.min(homeSlots, 6);
    const expanders = new Set();
    let expandCount = 0;
    for (const w of workers) if (w.order && w.order.type === 'gather' && expansion.some((c) => c.x === w.order.x && c.y === w.order.y)) { expanders.add(w.id); expandCount++; }
    const expandWant = wantExpand && cfg.expandTurret ? 4 : wantExpand ? 2 : 0;

    const sendTo = (w, pool) => {
      let best = null;
      let bs = Infinity;
      for (const c of pool) {
        const score = (load.get(key(c)) ?? 0) * 6 + dist(w, c) * 0.2;
        if (score < bs) { bs = score; best = c; }
      }
      if (!best) return;
      cmds.push({ type: 'gather', unit: w.id, x: best.x, y: best.y });
      load.set(key(best), (load.get(key(best)) ?? 0) + 1);
      if (expansion.includes(best)) { if (!expanders.has(w.id)) expandCount++; expanders.add(w.id); }
      else if (expanders.delete(w.id)) expandCount--;
    };
    const homePool = home.length ? home : live;
    const sent = new Set();
    for (const w of workers) {
      const order = w.order;
      if (order && order.type !== 'gather') continue; // building or moving
      const onTile = order ? crystalAt(order.x, order.y) : null;
      const danger = expanders.has(w.id) && expansion.some((c) => enemyNear(c, 5));
      if (order && onTile && !danger) continue;
      sendTo(w, danger || expandCount >= expandWant || !expansion.length ? homePool : expansion);
      sent.add(w.id);
    }
    // Rebalance: move empty-handed home miners out to the expansion until it has enough.
    for (const w of workers) {
      if (expandCount >= expandWant) break;
      if (sent.has(w.id) || expanders.has(w.id) || w.carrying > 0 || !w.order || w.order.type !== 'gather') continue;
      sendTo(w, expansion);
    }

    // ---------------------------------------------------------------- building
    const queuedWorkers = core.queue.length;
    const queuedAll = obs.structures.reduce((n, s) => (s.owner === me ? n + s.queue.length : n), 0);
    let room = obs.unitCap - myUnits.length - queuedAll;
    const emergency = enemyArmy.some((e) => dist(e, core) <= 9);
    const building = myStruct.some((s) => !s.complete);

    function siteNear(center, minD, maxD, awayFrom) {
      let best = null;
      let bs = Infinity;
      for (let dy = -maxD; dy <= maxD; dy++) {
        for (let dx = -maxD; dx <= maxD; dx++) {
          const x = center.x + dx;
          const y = center.y + dy;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d < minD || !free(x, y)) continue;
          if (obs.crystals.some((c) => dist(c, { x, y }) <= 1)) continue; // never block a mining spot
          let open = 0;
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!blocked(x + ax, y + ay)) open++;
          if (open < 3) continue; // do not wall ourselves in
          const sg = side === 0 ? 1 : -1;
          const toward = awayFrom ? dist({ x, y }, awayFrom) * 0.2 : 0;
          const score = d * 2 + toward + dy * sg * 0.01 + dx * sg * 0.001;
          if (score < bs) { bs = score; best = { x, y }; }
        }
      }
      return best;
    }
    function builderFor(site) {
      let best = null;
      let bd = Infinity;
      for (const w of workers) {
        if (w.order && w.order.type === 'build') continue;
        const d = dist(w, site) + (w.carrying > 0 ? 6 : 0);
        if (d < bd) { bd = d; best = w; }
      }
      return best;
    }
    function tryBuild(kind, site) {
      if (building || !S[kind] || shards < S[kind].cost || !site) return false;
      const w = builderFor(site);
      if (!w) return false;
      cmds.push({ type: 'build', unit: w.id, kind, x: site.x, y: site.y });
      shards -= S[kind].cost;
      return true;
    }
    const buildKinds = Object.keys(S).filter((k) => Array.isArray(S[k].trains) && S[k].trains.length);
    const forgeKind = buildKinds[0] ?? 'forge';
    const turretKind = Object.keys(S).find((k) => S[k].damage > 0) ?? 'turret';
    const enemyHome = enemyCore ?? { x: obs.width - 1 - core.x, y: obs.height - 1 - core.y };

    // ---------------------------------------------------------------- territory (only when obs.rules is present)
    const rules = obs.rules && obs.rules.territory ? obs.rules : null;
    const claimCost = (stats.territory && stats.territory.claimCost) || 100;
    const inBox = (p, r) => !!r.bounds && p.x >= r.bounds.x0 && p.x <= r.bounds.x1 && p.y >= r.bounds.y0 && p.y <= r.bounds.y1;
    const driftNow = rules && rules.drift ? rules.drift.active ?? [] : [];
    const driftEvents = rules && rules.drift ? [...driftNow, ...(rules.drift.upcoming ?? [])] : [];
    const evReaches = (ev) => (ev.reaches ?? (ev.targets ?? []).map((t) => t.reach)).filter((id) => Number.isInteger(id));
    const floodSoon = new Set(); // Reaches flooded now or within FLOOD_WARN
    const floodLater = new Set(); // every announced or running Flood: do not claim there
    const bloomIn = new Set();
    let stormAhead = false;
    for (const ev of driftEvents) {
      const dt = ev.tick - obs.tick;
      const running = driftNow.includes(ev);
      if (ev.kind === 'flood') for (const id of evReaches(ev)) { floodLater.add(id); if (running || dt <= FLOOD_WARN) floodSoon.add(id); }
      else if (ev.kind === 'bloom') for (const id of evReaches(ev)) bloomIn.add(id);
      else if ((ev.kind === 'squall' || ev.kind === 'quake') && (running || dt <= 24 * 20)) stormAhead = true;
    }
    const overBudget = !!rules && !!rules.budget && rules.budget.net < 0 && army.length >= cfg.minArmy;
    if (rules) {
      const t = rules.territory;
      const hold = Array.isArray(t.hold) ? t.hold[me] : t.reaches.filter((r) => r.claimedBy === me).length;
      let want = 1;
      for (const [at, h] of cfg.holdPlan) if (obs.tick >= at) want = h;
      if (pendingClaim && (obs.tick - pendingClaim.tick > CLAIM_RETRY || t.reaches.some((r) => r.id === pendingClaim.reach && r.claimedBy !== null))) pendingClaim = null;
      if (!pendingClaim && hold < want && shards >= claimCost) {
        const rank = (r) => (bloomIn.has(r.id) ? -1 : CLAIM_ROLES.indexOf(r.role));
        const target = t.reaches
          .filter((r) => r.claimedBy === null && r.holder === null && r.side !== foe && r.role !== 'main' && r.centre && !floodLater.has(r.id) && (r.role !== 'centre' || hold >= 4))
          .sort((a, b) => rank(a) - rank(b) || dist(a.centre, core) - dist(b.centre, core) || a.id - b.id)[0];
        if (target) {
          let best = null;
          let bd = Infinity;
          for (const w of workers) {
            if (w.order && w.order.type === 'build') continue;
            const d = dist(w, target.centre) + (w.carrying > 0 ? 6 : 0);
            if (d < bd) { bd = d; best = w; }
          }
          if (best) {
            cmds.push({ type: 'claim', unit: best.id, reach: target.id });
            pendingClaim = { reach: target.id, tick: obs.tick };
            shards -= claimCost;
          }
        }
      }
    }

    const workerTotal = workers.length + queuedWorkers;
    const needWorkers = workerTotal < cfg.workers && room > 0 && queuedWorkers < 2;
    // Opening: keep Workers coming until the Forge threshold, then save for the Forge.
    if (!forges.length) {
      if (workerTotal < cfg.forgeAt && shards >= U.worker.cost && queuedWorkers < 2 && room > 0) {
        cmds.push({ type: 'train', building: core.id, kind: 'worker' });
        shards -= U.worker.cost;
        room--;
      }
      if (workerTotal >= cfg.forgeAt) tryBuild(forgeKind, siteNear(core, 2, 5, enemyHome));
    } else {
      if (needWorkers && shards >= U.worker.cost) {
        cmds.push({ type: 'train', building: core.id, kind: 'worker' });
        shards -= U.worker.cost;
        room--;
      }
      if (emergency && doneForges.length) {
        if (myStruct.filter((s) => s.kind === turretKind).length < 2) tryBuild(turretKind, siteNear(core, 2, 5, enemyHome));
      }
      if (cfg.expandTurret && expanders.size >= 2 && expansion.length && doneForges.length) {
        const nearTurret = myStruct.some((s) => s.kind === turretKind && expansion.some((c) => dist(c, s) <= 3));
        if (!nearTurret) {
          const mid = expansion[0];
          tryBuild(turretKind, siteNear(mid, 2, 3, enemyHome));
        }
      }
      if (cfg.secondForge && forges.length < 2 && doneForges.length && obs.tick > 600 && shards >= S[forgeKind].cost + 100) {
        tryBuild(forgeKind, siteNear(core, 2, 6, enemyHome));
      }

      // Army production, balanced by counter weights against what the enemy has.
      const enemyCount = {};
      for (const e of enemyUnits) enemyCount[e.kind] = (enemyCount[e.kind] ?? 0) + 1;
      for (const s of enemyStruct) if (s.kind === turretKind && s.complete) enemyCount.turret = (enemyCount.turret ?? 0) + 1;
      const have = {};
      for (const u of army) have[u.kind] = (have[u.kind] ?? 0) + 1;
      for (const f of forges) for (const k of f.queue) have[k] = (have[k] ?? 0) + 1;
      for (const f of doneForges) {
        const trains = (S[f.kind].trains ?? combatKinds).filter((k) => U[k]);
        let guard = 0;
        while (f.queue.length < cfg.queue && room > 0 && guard++ < 3 && trains.length && !overBudget) {
          let best = null;
          let bs = -Infinity;
          for (const k of trains) {
            let w = 0;
            let tot = 0;
            for (const ek of Object.keys(enemyCount)) {
              w += ((COUNTERS[ek] && COUNTERS[ek][k]) ?? 1) * enemyCount[ek];
              tot += enemyCount[ek];
            }
            w = tot ? w / tot : 1;
            const sc = (w * (BASE_MIX[k] ?? 0.7)) / (1 + (have[k] ?? 0) * 0.5);
            if (sc > bs) { bs = sc; best = k; }
          }
          if (shards < U[best].cost) break; // wait for the preferred kind
          cmds.push({ type: 'train', building: f.id, kind: best });
          f.queue.push(best);
          have[best] = (have[best] ?? 0) + 1;
          shards -= U[best].cost;
          room--;
        }
      }
    }

    // ---------------------------------------------------------------- army
    if (!rally) {
      const dx = Math.sign(enemyHome.x - core.x);
      const dy = Math.sign(enemyHome.y - core.y);
      rally = { x: core.x + dx * 5, y: core.y + dy * 5 };
    }
    const myPower = army.reduce((n, u) => n + power(u), 0);
    const foePower = enemyArmy.reduce((n, u) => n + power(u), 0);
    const foeTurrets = enemyStruct.filter((s) => s.kind === turretKind && s.complete);
    const needed = foePower * 1.2 + foeTurrets.length * 6000;
    const bigEnough = army.length >= cfg.wave && myPower >= needed;
    const clockSaysGo = obs.tick >= cfg.waveByTick && army.length >= cfg.minArmy;
    if (!attacking && !stormAhead && obs.tick >= cfg.earliest && obs.tick - calledOff >= 120 && (bigEnough || clockSaysGo)) attacking = true;
    if (attacking && (army.length <= 1 || (myPower < foePower * 0.6 && obs.tick < cfg.waveByTick * 2))) {
      attacking = false;
      calledOff = obs.tick; // hold 120 ticks before re-arming so a wave does not yo-yo at the enemy's door
    }

    const threats = enemyUnits.filter((e) => dist(e, core) <= 10 || workers.some((w) => dist(w, e) <= 4) || (cfg.expandTurret && expansion.some((c) => dist(c, e) <= 4)));
    const pick = (u, pool, maxD) => {
      let best = null;
      let bs = Infinity;
      for (const e of pool) {
        const d = dist(u, e);
        if (d > maxD) continue;
        const sc = d + (e.kind === 'worker' ? 3 : 0) + (e.hp ?? 100) * 0.02;
        if (sc < bs) { bs = sc; best = e; }
      }
      return best;
    };

    const aimNow = obs.tick - lastAim >= cfg.rethink;
    if (aimNow) lastAim = obs.tick;
    for (const u of army) {
      if (!aimNow && u.order) continue;
      let target = null;
      if (attacking) {
        target = pick(u, enemyArmy, 9);
        if (!target && u.kind === 'brute') target = foeTurrets.find((t) => dist(t, u) <= 8) ?? null;
        if (!target) target = pick(u, enemyUnits, 8);
        if (!target) {
          const prod = enemyStruct.filter((s) => s.kind !== 'core' && s.kind !== turretKind && dist(s, u) <= 6);
          target = prod[0] ?? enemyCore ?? enemyStruct[0] ?? null;
        }
      } else if (threats.length) {
        target = pick(u, threats, 40);
      }
      if (target) {
        const cur = u.order;
        if (!(cur && cur.type === 'attack' && cur.target === target.id)) cmds.push({ type: 'attack', unit: u.id, target: target.id });
      } else if (!u.order || u.order.type === 'attack') {
        if (dist(u, rally) > 2) cmds.push({ type: 'move', unit: u.id, x: rally.x, y: rally.y });
        else if (u.order) cmds.push({ type: 'stop', unit: u.id });
      }
    }

    // A Flood is coming: everything inside the doomed Reach walks out, toward home.
    if (rules) {
      for (const r of rules.territory.reaches) {
        if (!floodSoon.has(r.id) || !r.bounds) continue;
        const b = r.bounds;
        const sx = Math.sign(core.x - r.centre.x);
        const sy = Math.sign(core.y - r.centre.y);
        const ex = Math.max(0, Math.min(obs.width - 1, sx > 0 ? b.x1 + 2 : sx < 0 ? b.x0 - 2 : b.x1 + 2));
        const ey = Math.max(0, Math.min(obs.height - 1, sy > 0 ? b.y1 + 2 : sy < 0 ? b.y0 - 2 : r.centre.y));
        for (const u of myUnits) if (inBox(u, r)) cmds.push({ type: 'move', unit: u.id, x: ex, y: ey });
      }
    }

    return cmds.slice(0, 90);
  }

  return { name: 'builtin-' + (SETTINGS[difficulty] ? difficulty : 'normal'), act };
}

export const createEasy = (opts) => createPlayer({ ...opts, difficulty: 'easy' });
export const createNormal = (opts) => createPlayer({ ...opts, difficulty: 'normal' });
