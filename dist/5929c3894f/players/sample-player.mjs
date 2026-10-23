// Minimal legal player used by the tests. Not a competitor: it sends idle Workers to the nearest crystal tile
// with Shards left and trains a few extra Workers from the Core. Every command it sends is legal by spec section 10,
// it never issues more than a handful per tick, and it uses no randomness or clock, so a match with it is
// deterministic.

const SMALL_ARMY_OF_WORKERS = 8; // stop training once this many units exist; keeps the sample far below the cap
const MAX_QUEUE = 5;

// Unit costs come from the stats table handed to createPlayer (STATS.units[kind].cost in env/stats.mjs).
function costOf(stats, kind) {
  const cost = stats?.units?.[kind]?.cost;
  return typeof cost === 'number' ? cost : 50;
}

const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// True when list a sorts before list b, comparing element by element.
function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

export function createPlayer({ side, seed, stats }) {
  const workerCost = costOf(stats, 'worker');
  const name = 'sample';

  function act(obs) {
    const commands = [];
    const mine = obs.units.filter((u) => u.owner === side);
    const core = obs.structures.find((s) => s.owner === side && s.kind === 'core');
    const live = obs.crystals.filter((c) => c.amount > 0);
    let shards = obs.shards[side];

    // Idle Workers gather from a crystal tile that still holds Shards. Spread them out: pick the tile with the
    // fewest own Workers already heading for it, then the nearest, then lower y, then lower x. Spreading keeps
    // Workers from standing in each other's way (spec section 6: paths ignore units, so a crowd can jam).
    const headed = new Map(); // 'x,y' -> number of own Workers with a gather order on that tile
    for (const unit of mine) {
      if (unit.order && unit.order.type === 'gather') {
        const key = unit.order.x + ',' + unit.order.y;
        headed.set(key, (headed.get(key) ?? 0) + 1);
      }
    }
    for (const unit of mine) {
      if (unit.kind !== 'worker' || unit.order) continue;
      if (!live.length) break;
      let best = null;
      let bestKey = null;
      for (const c of live) {
        const key = [headed.get(c.x + ',' + c.y) ?? 0, distance(unit, c), c.y, c.x];
        if (!best || lexLess(key, bestKey)) {
          best = c;
          bestKey = key;
        }
      }
      commands.push({ type: 'gather', unit: unit.id, x: best.x, y: best.y });
      headed.set(best.x + ',' + best.y, (headed.get(best.x + ',' + best.y) ?? 0) + 1);
    }

    // Train a few more Workers while there is money, the queue has room and we stay well under the unit cap.
    if (core && core.complete) {
      const queued = core.queue.length;
      const total = mine.length + queued;
      if (queued < MAX_QUEUE && total < SMALL_ARMY_OF_WORKERS && total < obs.unitCap && shards >= workerCost) {
        commands.push({ type: 'train', building: core.id, kind: 'worker' });
        shards -= workerCost;
      }
    }

    return commands;
  }

  return { name, act };
}
