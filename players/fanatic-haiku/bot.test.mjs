// Tests for the fanatic-haiku opponent. Run: node --test players/fanatic-haiku/
// They check the player API shape, that orders only name things the observation shows, and that the same
// observation always gives the same commands (no randomness, no clock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from './bot.mjs';
import { STATS } from '../../env/stats.mjs';

// A small observation in the shape env/state.mjs observe() returns: side 0 has a Core, two Workers and a crystal
// field nearby; side 1 has a Core and one Grunt far away.
function obsWith(overrides = {}) {
  return {
    tick: 100,
    you: 0,
    width: 32,
    height: 32,
    rocks: [],
    crystals: [{ x: 6, y: 6, amount: 400 }, { x: 25, y: 25, amount: 400 }],
    shards: [300, 300],
    units: [
      { id: 3, owner: 0, kind: 'worker', x: 3, y: 3, hp: 40, carrying: 0, order: null },
      { id: 4, owner: 0, kind: 'worker', x: 4, y: 3, hp: 40, carrying: 0, order: null },
      { id: 9, owner: 1, kind: 'grunt', x: 28, y: 28, hp: 60, carrying: 0, order: null },
    ],
    structures: [
      { id: 1, owner: 0, kind: 'core', x: 2, y: 2, hp: 1000, progress: 0, complete: true, queue: [] },
      { id: 2, owner: 1, kind: 'core', x: 29, y: 29, hp: 1000, progress: 0, complete: true, queue: [] },
    ],
    unitCap: STATS.match.unitCap,
    maxTicks: STATS.match.maxTicks,
    ...overrides,
  };
}

test('createPlayer returns a named player with act()', () => {
  const player = createPlayer({ side: 0, seed: 1, stats: STATS });
  assert.equal(player.name, 'fanatic-haiku');
  assert.equal(typeof player.act, 'function');
});

test('the same observation gives the same commands from a fresh player', () => {
  const a = createPlayer({ side: 0, seed: 1, stats: STATS }).act(obsWith());
  const b = createPlayer({ side: 0, seed: 1, stats: STATS }).act(obsWith());
  assert.deepEqual(a, b);
});

test('idle Workers gather from a crystal the observation shows', () => {
  const commands = createPlayer({ side: 0, seed: 1, stats: STATS }).act(obsWith());
  const gathers = commands.filter((c) => c.type === 'gather');
  assert.equal(gathers.length, 2);
  for (const g of gathers) {
    assert.ok(obsWith().crystals.some((c) => c.x === g.x && c.y === g.y && c.amount > 0), 'gather targets a live crystal');
  }
});

test('the Core trains Workers only while it can pay and has queue room', () => {
  const commands = createPlayer({ side: 0, seed: 1, stats: STATS }).act(obsWith({ shards: [40, 300] }));
  assert.equal(commands.filter((c) => c.type === 'train').length, 0, 'no train with 40 Shards');
  const rich = createPlayer({ side: 0, seed: 1, stats: STATS }).act(obsWith());
  const trains = rich.filter((c) => c.type === 'train');
  assert.equal(trains.length, 1);
  assert.equal(trains[0].kind, 'worker');
  assert.equal(trains[0].building, 1);
});

test('a build order names a Worker we own and a tile inside the map', () => {
  const obs = obsWith({ tick: 200 });
  const commands = createPlayer({ side: 0, seed: 1, stats: STATS }).act(obs);
  const builds = commands.filter((c) => c.type === 'build');
  assert.equal(builds.length, 1, 'one Forge is placed once Shards allow it');
  const [b] = builds;
  assert.equal(b.kind, 'forge');
  assert.ok(obs.units.some((u) => u.id === b.unit && u.owner === 0 && u.kind === 'worker'));
  assert.ok(b.x >= 0 && b.y >= 0 && b.x < obs.width && b.y < obs.height);
});

test('an enemy Grunt next to our Core is attacked by our fighter', () => {
  const obs = obsWith({
    tick: 300,
    units: [
      { id: 5, owner: 0, kind: 'lancer', x: 3, y: 3, hp: 40, carrying: 0, order: null },
      { id: 9, owner: 1, kind: 'grunt', x: 5, y: 3, hp: 60, carrying: 0, order: null },
    ],
  });
  const commands = createPlayer({ side: 0, seed: 1, stats: STATS }).act(obs);
  const attacks = commands.filter((c) => c.type === 'attack');
  assert.deepEqual(attacks, [{ type: 'attack', unit: 5, target: 9 }]);
});
