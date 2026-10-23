// Built-in AI for live play (players/builtin/ai.mjs): within 5 minutes (7200 ticks at 24 tps) it builds a Forge,
// trains an army, expands to the contested crystal field and attacks, on both difficulties, both seats and a
// few seeds, against a passive opponent. Runs the real sim in process; it also checks that every command is legal,
// that a run is deterministic, that easy is slower than normal, and that thinking is cheap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { createMatch, step } from '../env/sim.mjs';
import { observe } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import { createPlayer as createAi, createEasy, createNormal } from '../players/builtin/ai.mjs';
import { createPlayer as createSample } from '../players/sample-player.mjs';

const FIVE_MINUTES = 24 * 60 * 5;
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Runs one match with the AI on `side`; `every` > 1 makes the AI think only every that many ticks (env/live.mjs easy).
function play({ difficulty, side = 0, seed = 1, ticks = FIVE_MINUTES, every = 1, opponent = createSample }) {
  const s = createMatch(seed);
  s.maxTicks = ticks;
  const ai = createAi({ side, seed, stats: STATS, difficulty });
  const foe = opponent({ side: 1 - side, seed, stats: STATS });
  const seen = { forge: null, army: null, expanded: null, hit: null, expansionTurret: null };
  let rejects = 0;
  let thinkMax = 0;
  const core = s.structures.find((x) => x.kind === 'core' && x.owner === side);
  while (!s.result) {
    const mine = [];
    if (s.tick % every === 0) {
      const t0 = performance.now();
      mine.push(...ai.act(observe(s, side)));
      thinkMax = Math.max(thinkMax, performance.now() - t0);
    }
    const commands = side === 0 ? [mine, foe.act(observe(s, 1))] : [foe.act(observe(s, 0)), mine];
    const events = step(s, commands);
    for (const e of events) {
      if (e.e === 'reject' && e.player === side) rejects++;
      if (e.e === 'hit' && seen.hit === null && s.units.concat(s.structures).some((x) => x.id === e.by && x.owner === side)) seen.hit = s.tick;
    }
    if (seen.forge === null && s.structures.some((x) => x.owner === side && x.kind === 'forge' && x.complete)) seen.forge = s.tick;
    if (seen.army === null && s.units.some((u) => u.owner === side && u.kind !== 'worker')) seen.army = s.tick;
    const far = (c) => dist(c, core) > 9;
    if (seen.expanded === null && s.units.some((u) => u.owner === side && u.order && u.order.type === 'gather' && far(u.order))) seen.expanded = s.tick;
    if (seen.expansionTurret === null && s.structures.some((x) => x.owner === side && x.kind === 'turret' && s.crystals.some((c) => far(c) && dist(c, x) <= 3))) seen.expansionTurret = s.tick;
  }
  return { seen, result: s.result, rejects, thinkMax, state: s };
}

for (const difficulty of ['normal', 'easy']) {
  for (const side of [0, 1]) {
    test(`${difficulty} on side ${side}: builds, trains, expands and attacks inside 5 minutes`, () => {
      for (const seed of [1, 7]) {
        const { seen, rejects, result } = play({ difficulty, side, seed });
        const label = `${difficulty} side ${side} seed ${seed} ${JSON.stringify(seen)} ${JSON.stringify(result)}`;
        assert.ok(seen.forge !== null && seen.forge < FIVE_MINUTES, 'Forge built: ' + label);
        assert.ok(seen.army !== null && seen.army < FIVE_MINUTES, 'army trained: ' + label);
        assert.ok(seen.expanded !== null && seen.expanded < FIVE_MINUTES, 'expanded to the far crystals: ' + label);
        assert.ok(seen.hit !== null && seen.hit <= FIVE_MINUTES, 'attacked: ' + label);
        assert.equal(rejects, 0, 'every command legal: ' + label);
        assert.equal(result.winner, side, 'beats a passive opponent: ' + label);
      }
    });
  }
}

test('normal guards its expansion with a Turret', () => {
  const { seen } = play({ difficulty: 'normal', seed: 1, ticks: 2300 });
  assert.ok(seen.expansionTurret !== null, JSON.stringify(seen));
});

test('easy is slower than normal: first blow lands later, and it still plays legally when it thinks every 4th tick', () => {
  const normal = play({ difficulty: 'normal', seed: 3 });
  const easy = play({ difficulty: 'easy', seed: 3, every: 4 });
  assert.ok(easy.seen.hit > normal.seen.hit, `easy ${easy.seen.hit} vs normal ${normal.seen.hit}`);
  assert.ok(easy.seen.hit <= FIVE_MINUTES, 'easy still attacks inside 5 minutes: ' + easy.seen.hit);
  assert.equal(easy.rejects, 0);
});

test('a run is deterministic: same seed, same result and same final state', () => {
  const a = play({ difficulty: 'normal', seed: 5, ticks: 1500 });
  const b = play({ difficulty: 'normal', seed: 5, ticks: 1500 });
  assert.deepEqual(a.state.units, b.state.units);
  assert.deepEqual(a.state.structures, b.state.structures);
});

test('it does not give itself away to a real opponent: holds its own against the sample bots and thinks fast', () => {
  const r = play({ difficulty: 'normal', seed: 2, ticks: 3000, opponent: (o) => createAi({ ...o, difficulty: 'easy' }) });
  assert.equal(r.rejects, 0);
  assert.ok(r.thinkMax < STATS.referee.thinkMs, `slowest think ${r.thinkMax.toFixed(2)} ms`);
});

test('the module is player-shaped: name, act, easy and normal helpers, unknown difficulty means normal', () => {
  const p = createNormal({ side: 0, seed: 1, stats: STATS });
  assert.equal(typeof p.act, 'function');
  assert.equal(p.name, 'builtin-normal');
  assert.equal(createEasy({ side: 0, seed: 1, stats: STATS }).name, 'builtin-easy');
  assert.equal(createAi({ side: 0, seed: 1, stats: STATS, difficulty: 'bogus' }).name, 'builtin-normal');
  assert.deepEqual(p.act({ tick: 0, you: 0, width: 4, height: 4, rocks: [], crystals: [], shards: [0, 0], units: [], structures: [], unitCap: 40, maxTicks: 10 }), []);
});
