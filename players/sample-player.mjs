// Minimal legal player used by the tests. Not a competitor: it sends idle Workers to the nearest crystal tile
// with Shards left and trains a few extra Workers from the Core. Every command it sends is legal by spec section 10,
// it never issues more than a handful per tick, and it uses no randomness or clock, so a match with it is
// deterministic.

const SMALL_ARMY_OF_WORKERS = 8; // stop training once this many units exist; keeps the sample far below the cap
const MAX_QUEUE = 5;

// The stats table shape belongs to env/stats.mjs; accept the common spellings so the sample keeps working.
function costOf(stats, kind) {
  const table = stats?.units ?? stats?.UNITS ?? stats;
  const row = table?.[kind] ?? stats?.[kind];
  const cost = row?.cost;
  return typeof cost === 'number' ? cost : 50;
}

const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function createPlayer({ side, seed, stats }) {
  const workerCost = costOf(stats, 'worker');
  const name = 'sample';

  function act(obs) {
    const commands = [];
    const mine = obs.units.filter((u) => u.owner === side);
    const core = obs.structures.find((s) => s.owner === side && s.kind === 'core');
    const live = obs.crystals.filter((c) => c.amount > 0);
    let shards = obs.shards[side];

    // Idle Workers gather from the nearest crystal tile that still holds Shards (ties: lower y, then lower x).
    for (const unit of mine) {
      if (unit.kind !== 'worker' || unit.order) continue;
      if (!live.length) break;
      let best = null;
      let bestD = Infinity;
      for (const c of live) {
        const d = distance(unit, c);
        if (d < bestD || (d === bestD && (c.y < best.y || (c.y === best.y && c.x < best.x)))) {
          best = c;
          bestD = d;
        }
      }
      commands.push({ type: 'gather', unit: unit.id, x: best.x, y: best.y });
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
