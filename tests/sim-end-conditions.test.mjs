// Match end rules from ENV-SPEC.md section 9, run through the real sim.
// Every number comes from env/stats.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { step, checkEnd } from '../env/sim.mjs';
import { STATS } from '../env/stats.mjs';

// Hand-built unit and structure records, with every field the spec lists in section 10.
function unit(id, owner, kind, x, y, hp = STATS[kind].hp) {
  return { id, owner, kind, x, y, hp, carrying: 0, order: null };
}

function core(id, owner, x, y, hp = STATS.core.hp) {
  return { id, owner, kind: 'core', x, y, hp, progress: 0, complete: true, queue: [] };
}

function finished(id, owner, kind, x, y) {
  return { id, owner, kind, x, y, hp: STATS[kind].hp, progress: STATS[kind].buildTicks, complete: true, queue: [] };
}

// Two Cores at the spec spots, nothing else on the map unless a test adds it.
function matchState({ units = [], structures = [], shards = [0, 0], cores = {} } = {}) {
  return createTestState({
    width: 32,
    height: 32,
    rocks: [],
    crystals: [],
    shards,
    units,
    structures: [
      core(1, 0, 3, 3, cores.hp0),
      core(2, 1, 28, 28, cores.hp1),
      ...structures,
    ],
  });
}

const NO_COMMANDS = [[], []];

test('a side whose Core dies loses with reason core', () => {
  // Side 1's Grunt stands next to side 0's Core, which has 1 hp. Idle combat units hit
  // what is in range, so the Grunt's first attack removes the Core in the combat phase.
  const state = matchState({
    cores: { hp0: 1 },
    units: [unit(3, 1, 'grunt', 4, 3)],
  });

  step(state, NO_COMMANDS);

  assert.equal(state.structures.find((s) => s.id === 1), undefined, 'side 0 Core should be gone');
  assert.deepEqual(state.result?.winner, 1);
  assert.equal(state.result?.reason, 'core');
  assert.deepEqual(checkEnd(state), state.result);
});

test('when side 1 Core dies, side 0 wins with reason core', () => {
  const state = matchState({
    cores: { hp1: 1 },
    units: [unit(3, 0, 'grunt', 27, 28)],
  });

  step(state, NO_COMMANDS);

  assert.deepEqual(state.result?.winner, 0);
  assert.equal(state.result?.reason, 'core');
});

test('both Cores dying on the same tick is a draw with reason both-cores', () => {
  // Each side's Grunt is next to the other side's Core. Both Cores have 1 hp, so both
  // are removed in the same combat phase.
  const state = matchState({
    cores: { hp0: 1, hp1: 1 },
    units: [unit(3, 1, 'grunt', 4, 3), unit(4, 0, 'grunt', 27, 28)],
  });

  step(state, NO_COMMANDS);

  assert.equal(state.structures.filter((s) => s.kind === 'core').length, 0, 'both Cores should be gone');
  assert.equal(state.result?.winner, null);
  assert.equal(state.result?.reason, 'both-cores');
  assert.deepEqual(checkEnd(state), state.result);
});

test('reaching maxTicks with a higher value wins with reason timeout', () => {
  // Side 0: 100 Shards plus one Grunt = 100 + grunt cost.
  // Side 1: 100 Shards plus one complete Forge = 100 + forge cost.
  // Side 1 has more value, so side 1 wins.
  const state = matchState({
    shards: [100, 100],
    units: [unit(3, 0, 'grunt', 10, 10)],
    structures: [finished(4, 1, 'forge', 20, 20)],
  });
  state.tick = STATS.maxTicks - 1;

  step(state, NO_COMMANDS);

  const v0 = 100 + STATS.grunt.cost;
  const v1 = 100 + STATS.forge.cost;
  assert.equal(state.tick, STATS.maxTicks);
  assert.deepEqual(state.result?.value, [v0, v1]);
  assert.deepEqual(state.result?.winner, 1);
  assert.equal(state.result?.reason, 'timeout');
  assert.equal(state.result?.tick, STATS.maxTicks);
});

test('reaching maxTicks with a higher value for side 0 wins for side 0', () => {
  const state = matchState({
    shards: [STATS.forge.cost + 10, 0],
  });
  state.tick = STATS.maxTicks - 1;

  step(state, NO_COMMANDS);

  assert.deepEqual(state.result?.winner, 0);
  assert.equal(state.result?.reason, 'timeout');
});

test('an exact value tie at maxTicks is a draw with reason timeout', () => {
  // Side 0: 100 Shards plus one Grunt. Side 1: Shards equal to that total and nothing else.
  const total = 100 + STATS.grunt.cost;
  const state = matchState({
    shards: [100, total],
    units: [unit(3, 0, 'grunt', 10, 10)],
  });
  state.tick = STATS.maxTicks - 1;

  step(state, NO_COMMANDS);

  assert.deepEqual(state.result?.value, [total, total]);
  assert.equal(state.result?.winner, null);
  assert.equal(state.result?.reason, 'timeout');
});

test('nothing is reported before a Core dies or maxTicks is reached', () => {
  // Unequal value, but well before the time limit and with both Cores healthy.
  const state = matchState({
    shards: [500, 0],
    units: [unit(3, 0, 'grunt', 10, 10)],
  });

  assert.equal(state.result, null);
  assert.equal(checkEnd(state), null);

  for (let i = 0; i < 5; i += 1) {
    step(state, NO_COMMANDS);
    assert.equal(state.result, null, `no result expected after tick ${state.tick}`);
    assert.equal(checkEnd(state), null, `checkEnd should be null at tick ${state.tick}`);
  }
});

test('a lone Grunt out of range of any Core reports nothing before the limit', () => {
  // The Grunt sits two tiles from the enemy Core, so it cannot attack and nothing ends.
  const state = matchState({
    cores: { hp1: 1 },
    units: [unit(3, 0, 'grunt', 26, 28)],
  });

  step(state, NO_COMMANDS);

  assert.equal(state.result, null);
  assert.equal(checkEnd(state), null);
});

test('the timeout is not reported one tick early', () => {
  // Values differ by a lot, but the match is one tick short of maxTicks.
  const state = matchState({
    shards: [900, 0],
  });
  state.tick = STATS.maxTicks - 2;

  step(state, NO_COMMANDS);

  assert.equal(state.tick, STATS.maxTicks - 1);
  assert.equal(state.result, null);
  assert.equal(checkEnd(state), null);

  step(state, NO_COMMANDS);

  assert.equal(state.tick, STATS.maxTicks);
  assert.equal(state.result?.reason, 'timeout');
});
