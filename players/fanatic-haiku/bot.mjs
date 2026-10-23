// Team haiku's fanatic opponent for the Fanatic Council (FANATICS.md). Plain JavaScript, no randomness, no clock:
// the same observation always gives the same commands, so its matches are reproducible.
//
// Style: an early ranged push. It keeps Workers mining, builds one Forge, floods it with Lancers and Grunts,
// holds the Core when enemy units come close, and pushes the enemy Core once it has a real army. It is a test
// opponent, not a balance reference: it exists so the council can watch a plain, readable timing attack.
//
// The player API is ENV-SPEC section 10: createPlayer({ side, seed, stats }) returns { name, act(obs) }.

const TUNING = Object.freeze({
  workerTarget: 8, // Workers kept alive (queued ones count)
  coreQueueMax: 2,
  forgeQueueMax: 2,
  forgeShards: 150, // Shards in hand before the Forge is placed
  forgeRing: [3, 4, 5, 6], // Chebyshev distances from the Core to try for the Forge
  buildCooldown: 30, // ticks between build attempts, so a refused site is not spammed
  pushTick: 1200, // at this tick the push starts even with a small army
  pushArmy: 14, // or as soon as this many fighters are alive
  defendRadius: 8, // enemy fighters this close to the Core are answered at once
  engageRadius: 6, // a fighter attacks an enemy fighter this close to itself
  lancerRatio: 1, // train a Lancer while lancers < grunts * ratio, else a Grunt
});

const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const costOf = (stats, kind) => stats?.units?.[kind]?.cost ?? stats?.structures?.[kind]?.cost ?? 50;

export function createPlayer({ side, seed, stats }) {
  const name = 'fanatic-haiku';
  let pushing = false; // latched once the push starts, so the army does not turn back halfway
  let forgeTry = 0; // index into forgeRing x offsets, advanced after every build attempt
  let lastBuildTick = -Infinity;

  function act(obs) {
    const commands = [];
    const mine = obs.units.filter((u) => u.owner === side);
    const workers = mine.filter((u) => u.kind === 'worker');
    const fighters = mine.filter((u) => u.kind !== 'worker');
    const enemies = obs.units.filter((u) => u.owner !== side);
    const enemyFighters = enemies.filter((u) => u.kind !== 'worker');
    const enemyStructs = obs.structures.filter((s) => s.owner !== side);
    const enemyCore = enemyStructs.find((s) => s.kind === 'core');
    const core = obs.structures.find((s) => s.owner === side && s.kind === 'core');
    const forge = obs.structures.find((s) => s.owner === side && s.kind === 'forge');
    const live = obs.crystals.filter((c) => c.amount > 0);
    let shards = obs.shards[side];
    if (!core) return commands;

    // 1. Economy: idle Workers mine the nearest crystal, spreading out over the tiles already in use.
    const headed = new Map();
    for (const u of workers) {
      if (u.order && u.order.type === 'gather') headed.set(u.order.x + ',' + u.order.y, (headed.get(u.order.x + ',' + u.order.y) ?? 0) + 1);
    }
    for (const u of workers) {
      if (u.order || !live.length) continue;
      let best = null;
      for (const c of live) {
        const score = (headed.get(c.x + ',' + c.y) ?? 0) * 1000 + distance(u, c);
        if (!best || score < best.score) best = { c, score };
      }
      commands.push({ type: 'gather', unit: u.id, x: best.c.x, y: best.c.y });
      headed.set(best.c.x + ',' + best.c.y, (headed.get(best.c.x + ',' + best.c.y) ?? 0) + 1);
    }

    // 2. Production at the Core: Workers until the target is met.
    if (core.complete && core.queue.length < TUNING.coreQueueMax && workers.length + core.queue.length < TUNING.workerTarget && shards >= costOf(stats, 'worker')) {
      commands.push({ type: 'train', building: core.id, kind: 'worker' });
      shards -= costOf(stats, 'worker');
    }

    // 3. One Forge, placed on the first free tile in a fixed ring around the Core. A refused site moves the
    // index on, so the next attempt tries another tile.
    const building = obs.structures.some((s) => s.owner === side && s.kind === 'forge' && !s.complete);
    if (!forge && !building && shards >= TUNING.forgeShards && obs.tick - lastBuildTick >= TUNING.buildCooldown && workers.length) {
      const spot = nextFreeSpot(obs, core, forgeTry);
      forgeTry++;
      lastBuildTick = obs.tick;
      if (spot) {
        const builder = workers.reduce((best, w) => (!best || distance(w, spot) < distance(best, spot) ? w : best), null);
        commands.push({ type: 'build', unit: builder.id, kind: 'forge', x: spot.x, y: spot.y });
        shards -= costOf(stats, 'forge');
      }
    }

    // 4. The Forge trains Lancers and Grunts, keeping the queue short so Shards are not locked up.
    if (forge && forge.complete && forge.queue.length < TUNING.forgeQueueMax) {
      const lancers = fighters.filter((u) => u.kind === 'lancer').length;
      const grunts = fighters.filter((u) => u.kind === 'grunt').length;
      const kind = lancers < grunts * TUNING.lancerRatio ? 'lancer' : 'grunt';
      if (shards >= costOf(stats, kind)) commands.push({ type: 'train', building: forge.id, kind });
    }

    // 5. Army: fight any enemy fighter within reach of the Core or of one of our units, start the push once the
    // army is big enough (or the clock says so), and otherwise rally at the Core.
    if (!pushing && (obs.tick >= TUNING.pushTick || fighters.length >= TUNING.pushArmy)) pushing = true;
    for (const u of fighters) {
      const foe = nearest(u, enemyFighters);
      const engaged = foe && (distance(foe, u) <= TUNING.engageRadius || distance(foe, core) <= TUNING.defendRadius);
      if (engaged) {
        if (!u.order || u.order.type !== 'attack' || !enemyFighters.some((e) => e.id === u.order.target)) {
          commands.push({ type: 'attack', unit: u.id, target: foe.id });
        }
      } else if (pushing && enemyCore) {
        if (!u.order || u.order.type !== 'attack') {
          const target = nearest(u, enemyStructs.filter((s) => s.kind !== 'core')) ?? enemyCore;
          commands.push({ type: 'attack', unit: u.id, target: target.id });
        }
      } else if (!pushing && !u.order && distance(u, core) > 4) {
        commands.push({ type: 'move', unit: u.id, x: core.x, y: core.y });
      }
    }
    return commands;
  }

  return { name, act };
}

// First tile in the ring around the Core that has no rock, crystal, structure or unit on it, starting from the
// given attempt number. Returns null when every candidate is taken.
function nextFreeSpot(obs, core, attempt) {
  const taken = new Set();
  for (const [x, y] of obs.rocks) taken.add(x + ',' + y);
  for (const c of obs.crystals) taken.add(c.x + ',' + c.y);
  for (const s of obs.structures) taken.add(s.x + ',' + s.y);
  for (const u of obs.units) taken.add(u.x + ',' + u.y);
  const spots = [];
  for (const r of TUNING.forgeRing) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = core.x + dx;
        const y = core.y + dy;
        if (x < 0 || y < 0 || x >= obs.width || y >= obs.height) continue;
        if (taken.has(x + ',' + y)) continue;
        spots.push({ x, y });
      }
    }
  }
  return spots.length ? spots[attempt % spots.length] : null;
}

function nearest(from, list) {
  let best = null;
  for (const item of list) {
    if (!best || distance(from, item) < distance(from, best)) best = item;
  }
  return best;
}
