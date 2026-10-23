// Team haiku's AI player for Driftfall (Phase 3). Plain JavaScript, no randomness, no clock: the same observation
// always gives the same commands, so matches stay reproducible.
//
// Plan, in order of priority each tick:
//   1. Economy: idle Workers mine the crystal tile that is cheapest to reach from the Core (fewest Workers
//      already heading there breaks ties). The Core keeps a small queue of Workers until the target is met.
//   2. Builders: one Worker walks to every unfinished site of ours. Forge first, then a Turret, then a second Forge.
//   3. Production: each complete Forge keeps a short queue. The kind is picked by counters to the enemy army.
//   4. Army: defend when enemy fighters come near home; otherwise gather at a rally point and attack once the
//      army is clearly ahead on value. Attack orders are handed out fresh every tick to any unit that has none.
//
// Everything reads the observation and the stats table passed to createPlayer, so a new unit or structure kind
// from the stats table is used without code changes. Only the TUNING and COUNTER tables below need entries for
// a new kind.

// ---- Tuning (edit these numbers to balance the bot) ------------------------------------------------------------

const TUNING = Object.freeze({
  workerTarget: 12, // Workers we want alive (queued ones count too)
  coreQueueMax: 2, // Core queue is kept short so Shards aren't locked in training
  forgeQueueMax: 2, // same, per Forge
  firstForgeShards: 150, // build the first Forge once we can pay for it
  turretAfterTick: 500, // no Turret before this tick unless enemy fighters are already near
  turretShards: 200, // Shards we want in hand before a Turret
  maxTurrets: 2,
  maxForges: 2,
  secondForgeAfterTick: 400,
  secondForgeShards: 300,
  attackArmySize: 10, // fighters needed before we start an attack
  attackRatio: 1.2, // our army value over the enemy's, to start an attack
  lateTick: 1500, // after this tick a smaller lead is enough
  lateRatio: 1.05,
  retreatRatio: 0.6, // stop attacking when our army falls below this share of the enemy's
  minArmyToKeepAttacking: 4,
  reachEnemy: 6, // a fighter switches to an enemy fighter within this distance
  defendRadius: 10, // enemy fighters this close to home trigger defence
  defendChaseRadius: 14, // defenders chase enemies this close to home
  homeRadius: 12, // "home" for the purpose of structure defence
  rallyOffset: 6, // rally point, in tiles, from our Core toward the enemy Core
});

// Preference weights for each combat kind, given the enemy's counts. Higher means we want more of it. A kind is
// picked by weight divided by (1 + how many we already have), so a mix comes out of one simple rule. Kinds not
// listed here get weight 1 and no counter bonus, so new units still get built.
const COUNTER = Object.freeze({
  grunt: { base: 1.0, perEnemy: { lancer: 1.0, brute: -0.4, grunt: 0 } },
  lancer: { base: 1.0, perEnemy: { grunt: 1.0, brute: -0.6, lancer: 0 } },
  brute: { base: 0.8, perEnemy: { lancer: 1.2, grunt: -0.2, brute: 0 }, structures: 0.6 },
});

// ---- Small helpers ---------------------------------------------------------------------------------------------

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const byId = (a, b) => a.id - b.id;
const keyOf = (x, y) => x + ',' + y;

function unitCost(stats, kind) {
  return stats?.units?.[kind]?.cost ?? 50;
}

function structCost(stats, kind) {
  return stats?.structures?.[kind]?.cost ?? 100;
}

// Value of one combat unit, as in spec section 9 (units count their cost).
function fighterValue(stats, u) {
  return unitCost(stats, u.kind);
}

// ---- Player ---------------------------------------------------------------------------------------------------

export function createPlayer({ side, seed, stats }) {
  const name = 'haiku';
  const enemy = 1 - side;
  const unitKinds = Object.keys(stats?.units ?? { worker: {}, grunt: {}, lancer: {}, brute: {} });
  const fighterKinds = unitKinds.filter((k) => k !== 'worker');
  const unitCap = stats?.match?.unitCap ?? 40;
  const queueMax = stats?.match?.queueMax ?? 5;
  const maxCommands = stats?.match?.maxCommandsPerTick ?? 100;

  // Attack state carries across ticks (the only memory the bot has). Deterministic: it depends on the observations.
  let attacking = false;

  function act(obs) {
    const commands = [];
    const me = side;
    const myUnits = obs.units.filter((u) => u.owner === me).sort(byId);
    const enemyUnits = obs.units.filter((u) => u.owner === enemy).sort(byId);
    const myStructs = obs.structures.filter((s) => s.owner === me).sort(byId);
    const enemyStructs = obs.structures.filter((s) => s.owner === enemy).sort(byId);
    const core = myStructs.find((s) => s.kind === 'core');
    const enemyCore = enemyStructs.find((s) => s.kind === 'core');
    const workers = myUnits.filter((u) => u.kind === 'worker');
    const fighters = myUnits.filter((u) => u.kind !== 'worker' && fighterKinds.includes(u.kind));
    const enemyFighters = enemyUnits.filter((u) => u.kind !== 'worker' && fighterKinds.includes(u.kind));
    let shards = obs.shards[me];

    const push = (cmd) => {
      if (commands.length < maxCommands) commands.push(cmd);
    };

    // Map occupancy: rocks, crystals, every unit and every structure block a new building.
    const blocked = new Set();
    for (const [x, y] of obs.rocks) blocked.add(keyOf(x, y));
    for (const c of obs.crystals) blocked.add(keyOf(c.x, c.y));
    for (const u of obs.units) blocked.add(keyOf(u.x, u.y));
    for (const s of obs.structures) blocked.add(keyOf(s.x, s.y));
    const inMap = (x, y) => x >= 0 && y >= 0 && x < obs.width && y < obs.height;

    // ---- 1. Economy: gather -----------------------------------------------------------------------------------

    const live = obs.crystals.filter((c) => c.amount > 0);
    const headed = new Map(); // 'x,y' -> Workers already gathering from that tile
    for (const w of workers) {
      if (w.order && w.order.type === 'gather') headed.set(keyOf(w.order.x, w.order.y), (headed.get(keyOf(w.order.x, w.order.y)) ?? 0) + 1);
    }
    const coreRef = core ?? { x: 0, y: 0 };
    const coreDist = (c) => cheb(c, coreRef);
    const idleWorkers = workers.filter((w) => !w.order);
    for (const w of idleWorkers) {
      if (!live.length) break;
      let best = null;
      let bestScore = Infinity;
      for (const c of live) {
        const score = coreDist(c) + 8 * (headed.get(keyOf(c.x, c.y)) ?? 0) + cheb(w, c) * 0.25;
        if (score < bestScore) {
          best = c;
          bestScore = score;
        }
      }
      push({ type: 'gather', unit: w.id, x: best.x, y: best.y });
      headed.set(keyOf(best.x, best.y), (headed.get(keyOf(best.x, best.y)) ?? 0) + 1);
    }

    // ---- 2. Builders and new buildings ------------------------------------------------------------------------

    // Every unfinished site of ours gets one builder: the nearest Worker that isn't already building something.
    const sites = myStructs.filter((s) => !s.complete);
    const building = new Set();
    for (const w of workers) if (w.order && w.order.type === 'build') building.add(w.order.site);
    const assigned = new Set();
    for (const site of sites) {
      if (building.has(site.id)) continue;
      let best = null;
      for (const w of workers) {
        if (assigned.has(w.id)) continue;
        if (w.order && w.order.type !== 'gather') continue;
        if (!best || cheb(w, site) < cheb(best, site)) best = w;
      }
      if (best) {
        push({ type: 'build', unit: best.id, kind: site.kind, x: site.x, y: site.y });
        assigned.add(best.id);
        building.add(site.id);
      }
    }

    const forges = myStructs.filter((s) => s.kind === 'forge');
    const turrets = myStructs.filter((s) => s.kind === 'turret');
    const sitesOpen = sites.length > 0;
    const enemyNearHomeNow = enemyFighters.some((e) => coreRef && cheb(e, coreRef) <= TUNING.defendRadius);

    // A new building needs a free Worker and no other unfinished site, so we never stack several at once.
    if (core && !sitesOpen && workers.length >= 4) {
      const wantForge = forges.length === 0 && shards >= TUNING.firstForgeShards;
      const wantSecondForge =
        forges.length === 1 && obs.tick >= TUNING.secondForgeAfterTick && shards >= TUNING.secondForgeShards;
      const wantTurret =
        turrets.length < TUNING.maxTurrets &&
        shards >= TUNING.turretShards &&
        (obs.tick >= TUNING.turretAfterTick || enemyNearHomeNow) &&
        forges.length >= 1;
      let kind = null;
      if (wantForge || (wantSecondForge && forges.length < TUNING.maxForges)) kind = 'forge';
      else if (wantTurret) kind = 'turret';
      if (kind) {
        const spot = findSpot(kind, core, enemyCore, obs, blocked, inMap, live);
        if (spot) {
          const builder = nearestWorker(workers, spot, assigned);
          if (builder) {
            push({ type: 'build', unit: builder.id, kind, x: spot.x, y: spot.y });
            assigned.add(builder.id);
            shards -= structCost(stats, kind);
            blocked.add(keyOf(spot.x, spot.y));
          }
        }
      }
    }

    // ---- 3. Production -------------------------------------------------------------------------------------------

    if (core && core.complete) {
      const queued = core.queue.length;
      const workersAlive = workers.length + queued;
      if (queued < TUNING.coreQueueMax && workersAlive < TUNING.workerTarget && workersAlive < unitCap && shards >= unitCost(stats, 'worker')) {
        push({ type: 'train', building: core.id, kind: 'worker' });
        shards -= unitCost(stats, 'worker');
      }
    }

    const ourCounts = countKinds(fighters);
    for (const f of forges) {
      if (!f.complete) continue;
      // Count what is already queued at every Forge, so the mix holds while units wait to be built.
      for (const k of f.queue) ourCounts[k] = (ourCounts[k] ?? 0) + 1;
    }
    const enemyCounts = countKinds(enemyFighters);
    const armyTotal = fighters.length + forges.reduce((n, f) => n + f.queue.length, 0);
    for (const f of forges) {
      if (!f.complete) continue;
      while (f.queue.length < TUNING.forgeQueueMax && armyTotal + 1 <= unitCap) {
        const choice = pickFighter(fighterKinds, ourCounts, enemyCounts, stats, shards);
        if (!choice) break;
        push({ type: 'train', building: f.id, kind: choice.kind });
        shards -= unitCost(stats, choice.kind);
        ourCounts[choice.kind] = (ourCounts[choice.kind] ?? 0) + 1;
        f.queue = f.queue.concat(choice.kind); // only for this tick's bookkeeping
        if (commands.length >= maxCommands) break;
        break; // one unit per Forge per tick keeps the queue even
      }
    }

    // ---- 4. Army --------------------------------------------------------------------------------------------------

    const myValue = fighters.reduce((sum, u) => sum + fighterValue(stats, u), 0);
    const enemyValue = enemyFighters.reduce((sum, u) => sum + fighterValue(stats, u), 0);
    if (!attacking) {
      const readyByRatio = myValue >= enemyValue * TUNING.attackRatio && fighters.length >= TUNING.attackArmySize;
      const readyLate = obs.tick >= TUNING.lateTick && myValue >= enemyValue * TUNING.lateRatio && fighters.length >= TUNING.attackArmySize;
      if (readyByRatio || readyLate || fighters.length >= 20) attacking = true;
    } else if (fighters.length < TUNING.minArmyToKeepAttacking || myValue < enemyValue * TUNING.retreatRatio) {
      attacking = false;
    }

    const rally = rallyPoint(core, enemyCore, obs, blocked, inMap);
    const enemyStructTargets = enemyStructs.filter((s) => s.complete || s.kind === 'core' || true);

    for (const f of fighters) {
      const threat = enemyNearestFighter(f, enemyFighters, TUNING.defendChaseRadius, core);
      if (enemyNearHomeNow && threat) {
        // Defend: every fighter near home answers, even one that was marching out.
        if (!f.order || f.order.type !== 'attack' || !enemyFighters.some((e) => e.id === f.order.target)) {
          push({ type: 'attack', unit: f.id, target: threat.id });
        }
        continue;
      }

      if (attacking) {
        if (f.order && f.order.type === 'attack') {
          const tgt = findById(obs, f.order.target);
          const isStruct = tgt && (tgt.kind === 'forge' || tgt.kind === 'turret' || tgt.kind === 'core' || tgt.kind === 'site');
          if (tgt && isStruct) {
            const closeEnemy = enemyNearestFighter(f, enemyFighters, TUNING.reachEnemy);
            if (closeEnemy) push({ type: 'attack', unit: f.id, target: closeEnemy.id });
          }
          continue;
        }
        const target = chooseAttackTarget(f, enemyFighters, enemyStructs, enemyCore, obs);
        if (target) push({ type: 'attack', unit: f.id, target: target.id });
        continue;
      }

      // Not attacking: gather at the rally point and wait.
      if (!f.order && rally && cheb(f, rally) > 2) push({ type: 'move', unit: f.id, x: rally.x, y: rally.y });
    }

    return commands;
  }

  return { name, act };
}

// ---- Helpers that need the observation ------------------------------------------------------------------------

function countKinds(list) {
  const counts = {};
  for (const u of list) counts[u.kind] = (counts[u.kind] ?? 0) + 1;
  return counts;
}

function nearestWorker(workers, spot, assigned) {
  let best = null;
  for (const w of workers) {
    if (assigned.has(w.id)) continue;
    if (w.order && w.order.type !== 'gather') continue;
    if (!best || cheb(w, spot) < cheb(best, spot)) best = w;
  }
  return best;
}

function findById(obs, id) {
  return obs.units.find((u) => u.id === id) ?? obs.structures.find((s) => s.id === id) ?? null;
}

// The nearest enemy fighter to a unit, within a radius. If `near` is given, the radius is measured from it
// (used for home defence) instead of from the unit itself.
function enemyNearestFighter(unit, enemyFighters, radius, near = null) {
  let best = null;
  let bestD = Infinity;
  for (const e of enemyFighters) {
    const d = near ? Math.max(cheb(e, near), 0) : cheb(unit, e);
    const fromUnit = cheb(unit, e);
    if (near && cheb(e, near) > radius) continue;
    if (!near && fromUnit > radius) continue;
    const score = near ? fromUnit : d;
    if (score < bestD) {
      best = e;
      bestD = score;
    }
  }
  return best;
}

// Fighter target while attacking. Enemy fighters within reach first, then structures. Brutes go for structures
// (double damage), everyone else goes for the enemy Core when nothing else is close.
function chooseAttackTarget(unit, enemyFighters, enemyStructs, enemyCore, obs) {
  const nearFighter = enemyNearestFighter(unit, enemyFighters, TUNING.defendChaseRadius);
  if (nearFighter && unit.kind !== 'brute') return nearFighter;
  const structs = enemyStructs.filter((s) => s.complete !== false || s.kind === 'core');
  if (structs.length === 0) return nearFighter;
  // Priority: Turrets (they shoot back) then Forges, then the Core. Ties go to the nearest, then the lower id.
  const rank = (s) => (s.kind === 'turret' ? 0 : s.kind === 'forge' ? 1 : s.kind === 'core' ? 2 : 3);
  let best = null;
  let bestKey = null;
  for (const s of structs) {
    const key = [rank(s), cheb(unit, s), s.id];
    if (!bestKey || lexLess(key, bestKey)) {
      best = s;
      bestKey = key;
    }
  }
  return best ?? nearFighter;
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// Picks the fighter kind to train next, or null when none is affordable (we then wait and save Shards).
function pickFighter(fighterKinds, ourCounts, enemyCounts, stats, shards) {
  let best = null;
  for (const kind of fighterKinds) {
    const w = weightOf(kind, enemyCounts);
    const score = w / (1 + (ourCounts[kind] ?? 0));
    if (!best || score > best.score) best = { kind, score, cost: unitCost(stats, kind) };
  }
  if (!best) return null;
  if (best.cost <= shards) return best;
  // The best kind is too expensive right now: only build a cheaper kind if it's nearly as good.
  let cheap = null;
  for (const kind of fighterKinds) {
    const cost = unitCost(stats, kind);
    if (cost > shards) continue;
    const score = weightOf(kind, enemyCounts) / (1 + (ourCounts[kind] ?? 0));
    if (!cheap || score > cheap.score) cheap = { kind, score, cost };
  }
  if (cheap && cheap.score * 1.5 >= best.score) return cheap;
  return null;
}

function weightOf(kind, enemyCounts) {
  const c = COUNTER[kind];
  if (!c) return 1;
  let w = c.base;
  for (const [ek, bonus] of Object.entries(c.perEnemy ?? {})) w += bonus * (enemyCounts[ek] ?? 0) / 4;
  return Math.max(0.1, w);
}

// A free tile for a new building, within a few tiles of the Core but never next to it, so Workers can still
// reach the Core to deliver. Turrets prefer the middle of our home crystal field.
function findSpot(kind, core, enemyCore, obs, blocked, inMap, live) {
  const anchor = kind === 'turret' ? homeFieldCentre(core, live) : core;
  const minD = kind === 'turret' ? 2 : 3;
  const maxD = kind === 'turret' ? 5 : 6;
  let best = null;
  let bestKey = null;
  for (let dy = -maxD; dy <= maxD; dy++) {
    for (let dx = -maxD; dx <= maxD; dx++) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (!inMap(x, y) || blocked.has(keyOf(x, y))) continue;
      const dCore = cheb({ x, y }, core);
      if (dCore < minD) continue;
      const dAnchor = cheb({ x, y }, anchor);
      if (dAnchor > maxD) continue;
      const toEnemy = enemyCore ? cheb({ x, y }, enemyCore) : 0;
      const key = kind === 'turret' ? [dAnchor, toEnemy, y, x] : [dCore, toEnemy, y, x];
      if (!bestKey || lexLess(key, bestKey)) {
        best = { x, y };
        bestKey = key;
      }
    }
  }
  return best;
}

function homeFieldCentre(core, live) {
  const near = live.filter((c) => cheb(c, core) <= 8);
  if (!near.length) return core;
  const x = Math.round(near.reduce((s, c) => s + c.x, 0) / near.length);
  const y = Math.round(near.reduce((s, c) => s + c.y, 0) / near.length);
  return { x, y };
}

// Rally point: a few tiles from our Core toward the enemy Core, on an open tile.
function rallyPoint(core, enemyCore, obs, blocked, inMap) {
  if (!core || !enemyCore) return core ?? null;
  const dx = Math.sign(enemyCore.x - core.x);
  const dy = Math.sign(enemyCore.y - core.y);
  const want = { x: core.x + dx * TUNING.rallyOffset, y: core.y + dy * TUNING.rallyOffset };
  for (let r = 0; r <= 4; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const x = want.x + ox;
        const y = want.y + oy;
        if (inMap(x, y) && !blocked.has(keyOf(x, y))) return { x, y };
      }
    }
  }
  return core;
}
