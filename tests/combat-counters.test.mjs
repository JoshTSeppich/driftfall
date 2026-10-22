// Combat counters: small open-field duels run through the real sim (env/sim.mjs).
// Each test is named after the counter it checks, so if a balance change breaks one,
// the failing test name and message say which counter broke. Numbers come from env/stats.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS } from '../env/stats.mjs';
import { createTestState, findEntity, isFree } from '../env/state.mjs';
import { step } from '../env/sim.mjs';

const SIZE = 32;
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// An open 32 x 32 field: no rocks, no crystals, and only the units and structures given.
function openField(units, structures = []) {
  return createTestState({ width: SIZE, height: SIZE, rocks: [], crystals: [], shards: [0, 0], units, structures });
}

function unit(id, owner, kind, x, y) {
  return { id, owner, kind, x, y, hp: STATS.units[kind].hp, carrying: 0, order: null };
}

function completeTurret(id, owner, x, y) {
  const { hp, buildTicks } = STATS.structures.turret;
  return { id, owner, kind: 'turret', x, y, hp, progress: buildTicks, complete: true, queue: [] };
}

const alive = (state, id) => Boolean(findEntity(state, id));

// Runs the real sim one tick at a time. `plan(state, tick)` gives the two command lists for that tick.
// Stops once `done(state)` is true or after `maxTicks`. Returns how many ticks ran.
function runDuel(state, { maxTicks, plan = () => [[], []], done }) {
  let ticks = 0;
  while (ticks < maxTicks && !done(state)) {
    step(state, plan(state, ticks));
    ticks += 1;
  }
  return ticks;
}

// Order given on the first tick, through the normal command path (side 1 sends it).
const attackOnFirstTick = (unitId, targetId) => (state, tick) =>
  tick === 0 ? [[], [{ type: 'attack', unit: unitId, target: targetId }]] : [[], []];

// Checks that `winnerId` survives and `loserId` dies within `maxTicks`. The message names the counter.
function assertCounter(state, { counter, winnerId, loserId, ticks, maxTicks }) {
  assert.ok(
    !alive(state, loserId),
    `Counter broken: ${counter}. The loser was still alive after ${maxTicks} ticks.`,
  );
  assert.ok(
    alive(state, winnerId),
    `Counter broken: ${counter}. The winner died (ran ${ticks} ticks).`,
  );
}

test('Lancer beats a Grunt that starts 4 tiles away', () => {
  const state = openField([
    unit(1, 0, 'lancer', 10, 16),
    unit(2, 1, 'grunt', 14, 16),
  ]);
  const maxTicks = 100;
  const ticks = runDuel(state, {
    maxTicks,
    plan: attackOnFirstTick(2, 1),
    done: (s) => !alive(s, 2),
  });
  assertCounter(state, {
    counter: 'a Lancer 4 tiles from a Grunt should kill it at range before it arrives',
    winnerId: 1,
    loserId: 2,
    ticks,
    maxTicks,
  });
});

test('Brute beats three Grunts that all attack it', () => {
  const state = openField([
    unit(1, 0, 'brute', 16, 16),
    unit(2, 1, 'grunt', 20, 14),
    unit(3, 1, 'grunt', 20, 16),
    unit(4, 1, 'grunt', 20, 18),
  ]);
  const maxTicks = 200;
  const plan = (s, tick) => (tick === 0
    ? [[], [2, 3, 4].map((id) => ({ type: 'attack', unit: id, target: 1 }))]
    : [[], []]);
  const ticks = runDuel(state, {
    maxTicks,
    plan,
    done: (s) => !alive(s, 2) && !alive(s, 3) && !alive(s, 4),
  });
  assert.ok(!alive(state, 2) && !alive(state, 3) && !alive(state, 4),
    `Counter broken: a Brute should beat three Grunts. Some Grunts were still alive after ${maxTicks} ticks.`);
  assert.ok(alive(state, 1),
    `Counter broken: a Brute should beat three Grunts. The Brute died after ${ticks} ticks.`);
});

test('Brute beats a Turret', () => {
  const state = openField([
    unit(1, 0, 'brute', 10, 16),
  ], [
    completeTurret(2, 1, 17, 16),
  ]);
  const maxTicks = 200;
  const ticks = runDuel(state, {
    maxTicks,
    plan: attackOnFirstTick(1, 2),
    done: (s) => !alive(s, 2),
  });
  assertCounter(state, {
    counter: 'a Brute should destroy a Turret (double damage to structures) and survive',
    winnerId: 1,
    loserId: 2,
    ticks,
    maxTicks,
  });
});

test('Turret beats a Grunt', () => {
  const state = openField([
    unit(2, 0, 'grunt', 22, 16),
  ], [
    completeTurret(1, 1, 16, 16),
  ]);
  const maxTicks = 100;
  const ticks = runDuel(state, {
    maxTicks,
    plan: attackOnFirstTick(2, 1),
    done: (s) => !alive(s, 2),
  });
  assertCounter(state, {
    counter: 'a Turret should kill a Grunt that walks in on it and survive',
    winnerId: 1,
    loserId: 2,
    ticks,
    maxTicks,
  });
});

// Picks the free neighbour tile that is farthest from the Brute. Moves only if that is farther than now.
function stepAway(state, lancerId, bruteId) {
  const me = findEntity(state, lancerId);
  const foe = findEntity(state, bruteId);
  if (!me || !foe) return null;
  const gap = (x, y) => (x - foe.x) ** 2 + (y - foe.y) ** 2;
  let best = null;
  for (const [dx, dy] of STEPS) {
    const x = me.x + dx;
    const y = me.y + dy;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || !isFree(state, x, y)) continue;
    if (best === null || gap(x, y) > best.gap) best = { x, y, gap: gap(x, y) };
  }
  if (best === null || best.gap <= gap(me.x, me.y)) return null;
  return { type: 'move', unit: lancerId, x: best.x, y: best.y };
}

test('a Lancer that keeps stepping away survives a Brute for at least 40 ticks', () => {
  const state = openField([
    unit(1, 0, 'lancer', 16, 16),
    unit(2, 1, 'brute', 20, 16),
  ]);
  const minTicks = 40;
  const ticks = runDuel(state, {
    maxTicks: minTicks,
    plan: (s, tick) => {
      const orders = tick === 0 ? [{ type: 'attack', unit: 2, target: 1 }] : [];
      const retreat = stepAway(s, 1, 2);
      return [retreat ? [retreat] : [], orders];
    },
    done: (s) => !alive(s, 1),
  });
  assert.ok(alive(state, 1),
    `Counter broken: a Lancer that keeps stepping away should survive a Brute for ${minTicks} ticks. ` +
    `It died after ${ticks} ticks.`);
  assert.ok(ticks >= minTicks, `Counter broken: the kite ran only ${ticks} ticks, expected ${minTicks}.`);
});
