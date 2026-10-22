// economy-build-train: Build and Train rules (ENV-SPEC §4, §8, §10), run through the real env modules.
// Phases are driven the way sim.step drives them: commands first, then production (movement is left out so
// Workers stay where the test puts them).
import test from 'node:test';
import assert from 'node:assert/strict';

const loaded = {};
const missing = [];
for (const name of ['stats', 'state', 'commands', 'economy', 'combat', 'sim']) {
  try { loaded[name] = await import(`../env/${name}.mjs`); } catch (err) { missing.push(`env/${name}.mjs (${err.code || err.message})`); }
}
// A clear "module missing" failure, so it is not confused with a real rule bug.
function need(...names) {
  for (const n of names) if (!loaded[n]) assert.fail(`MODULE MISSING: env/${n}.mjs could not be loaded [${missing.join('; ')}]`);
  return loaded;
}

const stat = (kind) => {
  const { STATS } = need('stats');
  return kind === 'core' ? STATS.core : STATS.units[kind] || STATS.structures[kind];
};
const unitCap = () => need('stats').STATS.match.unitCap;
const queueMax = () => need('stats').STATS.match.queueMax;

const CORE = { x: 10, y: 10 };
// Tiles at exactly Chebyshev distance d from (cx, cy), in the spec's search order (lower y first, then lower x).
const ring = (cx, cy, d) => {
  const out = [];
  for (let y = cy - d; y <= cy + d; y++) for (let x = cx - d; x <= cx + d; x++) {
    if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) === d) out.push([x, y]);
  }
  return out;
};

const unit = (id, owner, kind, x, y, extra = {}) => ({ id, owner, kind, x, y, hp: stat(kind).hp, carrying: 0, order: null, ...extra });
const struct = (id, owner, kind, x, y, extra = {}) => ({
  id, owner, kind, x, y, hp: stat(kind).hp, progress: 0, complete: true, queue: [], ...extra,
});

function makeState({ units = [], structures = [], rocks = [], shards = [1000, 1000] } = {}) {
  const { createTestState } = need('state');
  const state = createTestState({
    width: 32, height: 32, rocks, crystals: [], shards, units,
    structures: [struct(1, 0, 'core', CORE.x, CORE.y), struct(2, 1, 'core', 25, 25), ...structures],
  });
  state.nextId = Math.max(state.nextId, 100);
  return state;
}

// One tick of commands + production (phases 1 and 2 of §8). Returns that tick's events.
function tick(state, cmds0 = [], cmds1 = []) {
  need('commands', 'economy');
  state.events = [];
  loaded.commands.applyCommands(state, 0, cmds0);
  loaded.commands.applyCommands(state, 1, cmds1);
  loaded.economy.stepProduction(state);
  state.tick += 1;
  return state.events;
}
const idle = (state, n) => { for (let i = 0; i < n; i++) tick(state); };
const get = (state, id) => need('state').findEntity(state, id);
const rejects = (events) => events.filter((e) => e.e === 'reject').map((e) => e.reason);
const ownUnits = (state, owner = 0) => state.units.filter((u) => u.owner === owner);
const buildCmd = (unitId, kind, x, y) => ({ type: 'build', unit: unitId, kind, x, y });
const trainCmd = (building, kind) => ({ type: 'train', building, kind });

// ---------------------------------------------------------------- Build
test('build: cost is paid on accept and a forge site appears at once', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)] });
  const events = tick(state, [buildCmd(3, 'forge', 21, 20)]);
  assert.deepEqual(rejects(events), []);
  const site = state.structures.find((s) => s.kind === 'forge');
  assert.ok(site, 'a forge site exists');
  assert.equal(site.owner, 0);
  assert.deepEqual([site.x, site.y], [21, 20]);
  assert.equal(site.complete, false);
  assert.equal(state.shards[0], 1000 - stat('forge').cost);
  assert.equal(state.shards[1], 1000, 'other side untouched');
  assert.ok(events.some((e) => e.e === 'spend' && e.player === 0 && e.amount === stat('forge').cost), 'spend event');
  assert.equal(get(state, 3).order?.type, 'build');
  assert.equal(get(state, 3).order?.site, site.id);
});

test('build: the new site has hp 1 and progress 0 while no Worker is adjacent', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)] });
  tick(state, [buildCmd(3, 'turret', 25, 20)]);
  const site = state.structures.find((s) => s.kind === 'turret');
  assert.equal(site.hp, 1);
  assert.equal(site.progress, 0);
  assert.equal(site.complete, false);
  assert.deepEqual(site.queue, []);
});

test('build: with the Worker already adjacent the site starts at hp 1 and progress is at most 1 after the first tick', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)] });
  tick(state, [buildCmd(3, 'forge', 21, 20)]);
  const site = state.structures.find((s) => s.kind === 'forge');
  assert.ok(site.progress <= 1);
  assert.ok(site.hp <= 1 + Math.round(stat('forge').hp / stat('forge').buildTicks));
});

test('build: rejected with no-shards (nothing spent, nothing placed) when Shards are short', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)], shards: [stat('turret').cost - 1, 1000] });
  const events = tick(state, [buildCmd(3, 'turret', 21, 20)]);
  assert.deepEqual(rejects(events), ['no-shards']);
  assert.equal(state.shards[0], stat('turret').cost - 1);
  assert.equal(state.structures.filter((s) => s.kind === 'turret').length, 0);
});

test('build: rejected with tile-taken on a unit, a structure or a rock, and costs nothing', () => {
  const state = makeState({
    rocks: [[22, 20]],
    units: [unit(3, 0, 'worker', 20, 20), unit(4, 1, 'grunt', 21, 20)],
    structures: [struct(5, 0, 'turret', 20, 21)],
  });
  for (const [x, y] of [[21, 20], [20, 21], [22, 20]]) {
    assert.deepEqual(rejects(tick(state, [buildCmd(3, 'turret', x, y)])), ['tile-taken'], `tile ${x},${y}`);
  }
  assert.equal(state.shards[0], 1000);
});

test('build: progress only rises while an own Worker with a build order is adjacent', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)] });
  tick(state, [buildCmd(3, 'forge', 25, 20)]); // Worker is 5 tiles away
  const site = state.structures.find((s) => s.kind === 'forge');
  idle(state, 5);
  assert.equal(site.progress, 0, 'no progress while the Worker is away');
  assert.equal(site.hp, 1);
  const w = get(state, 3); w.x = 24; w.y = 21; // diagonal neighbour counts as adjacent
  idle(state, 1);
  assert.equal(site.progress, 1);
  idle(state, 3);
  assert.equal(site.progress, 4);
  w.x = 20; w.y = 20; // leaves: progress freezes
  idle(state, 4);
  assert.equal(site.progress, 4);
});

test('build: an adjacent idle own Worker and an adjacent enemy Worker do not build', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20), unit(4, 0, 'worker', 25, 21), unit(5, 1, 'worker', 26, 20)] });
  tick(state, [buildCmd(3, 'forge', 25, 20)]);
  const site = state.structures.find((s) => s.kind === 'forge');
  idle(state, 5);
  assert.equal(site.progress, 0);
});

test('build: an adjacent enemy Worker ordered to build this site does not build it either', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20), unit(5, 1, 'worker', 26, 20)] });
  tick(state, [buildCmd(3, 'forge', 25, 20)]);
  const site = state.structures.find((s) => s.kind === 'forge');
  get(state, 5).order = { type: 'build', site: site.id };
  idle(state, 5);
  assert.equal(site.progress, 0);
});

test('build: only one Worker counts per tick', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 24, 20), unit(4, 0, 'worker', 26, 20), unit(5, 0, 'worker', 25, 21)] });
  tick(state, [buildCmd(3, 'forge', 25, 20)]);
  const site = state.structures.find((s) => s.kind === 'forge');
  get(state, 4).order = { type: 'build', site: site.id };
  get(state, 5).order = { type: 'build', site: site.id };
  const p0 = site.progress;
  idle(state, 6);
  assert.equal(site.progress - p0, 6, 'three adjacent Workers still give 1 progress per tick');
});

for (const kind of ['forge', 'turret']) {
  test(`build: ${kind} hp and progress grow every tick and it completes after buildTicks`, () => {
    const { buildTicks, hp: maxHp } = stat(kind);
    const per = Math.round(maxHp / buildTicks);
    const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)] });
    tick(state, [buildCmd(3, 'forge' === kind ? 'forge' : 'turret', 21, 20)]);
    const site = state.structures.find((s) => s.kind === kind);
    let lastHp = site.hp, lastProgress = site.progress;
    for (let i = 0; i < buildTicks + 2 && !site.complete; i++) {
      idle(state, 1);
      if (site.complete) break;
      assert.equal(site.progress, lastProgress + 1, 'progress +1 per tick');
      assert.equal(site.hp, Math.min(maxHp, lastHp + per), `hp +${per} per tick`);
      lastHp = site.hp; lastProgress = site.progress;
    }
    assert.equal(site.complete, true);
    assert.equal(site.progress, buildTicks);
    assert.equal(site.hp, maxHp);
  });

  test(`build: a ${kind} is not complete shortly before buildTicks and is complete just after`, () => {
    const { buildTicks } = stat(kind);
    const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)] });
    tick(state, [buildCmd(3, kind, 21, 20)]);
    const site = state.structures.find((s) => s.kind === kind);
    idle(state, buildTicks - 3);
    assert.equal(site.complete, false);
    idle(state, 4);
    assert.equal(site.complete, true);
  });

  test(`build: finishing a ${kind} emits progress and done events, clears the Worker order and then stays put`, () => {
    const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)] });
    const events = [...tick(state, [buildCmd(3, kind, 21, 20)])];
    for (let i = 0; i < stat(kind).buildTicks + 2; i++) events.push(...tick(state));
    const site = state.structures.find((s) => s.kind === kind);
    assert.ok(events.some((e) => e.e === 'progress' && e.id === site.id), 'progress events');
    assert.equal(events.filter((e) => e.e === 'done' && e.id === site.id).length, 1, 'exactly one done event');
    assert.equal(get(state, 3).order, null);
    idle(state, 3);
    assert.equal(site.progress, stat(kind).buildTicks);
    assert.equal(site.hp, stat(kind).hp);
  });
}

test('build: an unfinished forge cannot train (not-complete); the finished one can', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)] });
  tick(state, [buildCmd(3, 'forge', 21, 20)]);
  const site = state.structures.find((s) => s.kind === 'forge');
  assert.deepEqual(rejects(tick(state, [trainCmd(site.id, 'grunt')])), ['not-complete']);
  assert.equal(state.shards[0], 1000 - stat('forge').cost);
  idle(state, stat('forge').buildTicks + 2);
  assert.equal(site.complete, true);
  assert.deepEqual(rejects(tick(state, [trainCmd(site.id, 'grunt')])), []);
  assert.equal(site.queue.length, 1);
});

test('build: a destroyed site refunds nothing and disappears', () => {
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20), unit(4, 1, 'grunt', 22, 20)] });
  tick(state, [buildCmd(3, 'turret', 21, 20)]);
  const site = state.structures.find((s) => s.kind === 'turret');
  const afterPay = state.shards[0];
  assert.equal(afterPay, 1000 - stat('turret').cost);
  need('combat');
  state.events = [];
  get(state, 4).order = { type: 'attack', target: site.id };
  loaded.combat.stepCombat(state);
  assert.equal(state.structures.find((s) => s.id === site.id), undefined, 'site destroyed');
  assert.ok(state.events.some((e) => e.e === 'die' && e.id === site.id), 'die event');
  assert.equal(state.shards[0], afterPay, 'no refund');
  idle(state, 3);
  assert.equal(state.shards[0], afterPay, 'still no refund later');
  assert.equal(state.structures.some((s) => s.kind === 'turret'), false);
});

// ---------------------------------------------------------------- Train
test('train: pays on accept and queues the kind', () => {
  const state = makeState();
  const events = tick(state, [trainCmd(1, 'worker')]);
  assert.deepEqual(rejects(events), []);
  assert.equal(state.shards[0], 1000 - stat('worker').cost);
  assert.equal(get(state, 1).queue.length, 1);
  assert.ok(events.some((e) => e.e === 'spend' && e.amount === stat('worker').cost));
  assert.ok(events.some((e) => e.e === 'queue' && e.id === 1), 'queue event');
});

test('train: rejected with no-shards, spending nothing and queuing nothing', () => {
  const state = makeState({ shards: [stat('worker').cost - 1, 1000] });
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), ['no-shards']);
  assert.equal(state.shards[0], stat('worker').cost - 1);
  assert.equal(get(state, 1).queue.length, 0);
});

test('train: wrong kind for the building is rejected (Core: workers only, Forge: combat units only)', () => {
  const state = makeState({ structures: [struct(5, 0, 'forge', 15, 15)] });
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'grunt')])), ['wrong-kind']);
  assert.deepEqual(rejects(tick(state, [trainCmd(5, 'worker')])), ['wrong-kind']);
  assert.equal(state.shards[0], 1000);
  assert.equal(get(state, 1).queue.length, 0);
  assert.equal(get(state, 5).queue.length, 0);
});

test('train: queue holds at most 5; the 6th is rejected with queue-full and not charged', () => {
  const state = makeState({ shards: [5000, 5000] });
  for (let i = 0; i < queueMax(); i++) {
    assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), [], `train #${i + 1}`);
  }
  const spent = 5000 - state.shards[0];
  assert.equal(spent, 5 * stat('worker').cost);
  assert.equal(get(state, 1).queue.length, 5);
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), ['queue-full']);
  assert.equal(5000 - state.shards[0], spent, 'no charge for the rejected one');
  assert.equal(get(state, 1).queue.length, 5);
});

test('train: six commands in one tick fill the queue and the sixth is rejected', () => {
  const state = makeState({ shards: [5000, 5000] });
  const events = tick(state, Array.from({ length: 6 }, () => trainCmd(1, 'worker')));
  assert.deepEqual(rejects(events), ['queue-full']);
  assert.equal(get(state, 1).queue.length, 5);
});

test('train: a queue slot frees up once the front unit spawns', () => {
  const state = makeState({ shards: [5000, 5000] });
  for (let i = 0; i < 5; i++) tick(state, [trainCmd(1, 'worker')]);
  idle(state, stat('worker').trainTicks + 1);
  assert.equal(ownUnits(state).length, 1);
  assert.equal(get(state, 1).queue.length, 4);
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), []);
  assert.equal(get(state, 1).queue.length, 5);
});

test('train: a unit appears after trainTicks, not before, with the table stats', () => {
  const state = makeState();
  tick(state, [trainCmd(1, 'worker')]);
  idle(state, stat('worker').trainTicks - 3);
  assert.equal(ownUnits(state).length, 0, 'not yet');
  idle(state, 4); // one tick of slack on whether the accept tick already counts
  const made = ownUnits(state);
  assert.equal(made.length, 1, 'spawned by trainTicks + 1 ticks');
  assert.equal(made[0].kind, 'worker');
  assert.equal(made[0].owner, 0);
  assert.equal(made[0].hp, stat('worker').hp);
  assert.equal(made[0].carrying, 0);
  assert.equal(made[0].order, null);
  assert.equal(get(state, 1).queue.length, 0);
});

test('train: queued units come out one at a time, in order, each after its own trainTicks', () => {
  const state = makeState({ structures: [struct(5, 0, 'forge', 15, 15)], shards: [5000, 5000] });
  tick(state, [trainCmd(5, 'grunt'), trainCmd(5, 'brute')]);
  idle(state, stat('grunt').trainTicks + 1);
  assert.deepEqual(ownUnits(state).map((u) => u.kind), ['grunt'], 'grunt first');
  idle(state, stat('brute').trainTicks - 4);
  assert.deepEqual(ownUnits(state).map((u) => u.kind), ['grunt'], 'brute not done yet');
  idle(state, 6);
  assert.deepEqual(ownUnits(state).map((u) => u.kind), ['grunt', 'brute']);
});

test('train: a Core and a Forge train in parallel', () => {
  const state = makeState({ structures: [struct(5, 0, 'forge', 15, 15)], shards: [5000, 5000] });
  tick(state, [trainCmd(1, 'worker'), trainCmd(5, 'grunt')]);
  idle(state, stat('worker').trainTicks + 1);
  assert.deepEqual(ownUnits(state).map((u) => u.kind).sort(), ['grunt', 'worker']);
});

test('train: an enemy building is not yours', () => {
  const state = makeState();
  assert.deepEqual(rejects(tick(state, [trainCmd(2, 'worker')])), ['not-yours']);
  assert.equal(state.shards[0], 1000);
});

test('spawn: the first unit goes to the first tile of the distance-1 ring (lowest y, then lowest x)', () => {
  const state = makeState();
  tick(state, [trainCmd(1, 'worker')]);
  idle(state, stat('worker').trainTicks + 1);
  const [u] = ownUnits(state);
  assert.deepEqual([u.x, u.y], [CORE.x - 1, CORE.y - 1]);
});

test('spawn: successive units fill the distance-1 ring in the fixed order, then start on distance 2', () => {
  const state = makeState({ shards: [100000, 100000] });
  const expected = [...ring(CORE.x, CORE.y, 1), ...ring(CORE.x, CORE.y, 2).slice(0, 2)];
  const got = [];
  for (let i = 0; i < expected.length; i++) {
    tick(state, [trainCmd(1, 'worker')]);
    const before = ownUnits(state).length;
    for (let k = 0; k < stat('worker').trainTicks + 2 && ownUnits(state).length === before; k++) tick(state);
    const fresh = ownUnits(state).at(-1);
    got.push([fresh.x, fresh.y]);
    assert.equal(new Set(state.units.map((q) => `${q.x},${q.y}`)).size, state.units.length, 'no shared tiles');
  }
  assert.deepEqual(got, expected);
});

test('spawn: skips tiles blocked by a rock, an enemy unit and a structure', () => {
  const r1 = ring(CORE.x, CORE.y, 1);
  const state = makeState({
    rocks: [r1[0]],
    units: [unit(3, 1, 'grunt', ...r1[1])],
    structures: [struct(5, 0, 'turret', ...r1[2])],
  });
  tick(state, [trainCmd(1, 'worker')]);
  idle(state, stat('worker').trainTicks + 1);
  const made = ownUnits(state);
  assert.equal(made.length, 1);
  assert.deepEqual([made[0].x, made[0].y], r1[3]);
});

test('spawn: with the distance-1 ring full the unit appears on the first distance-2 tile', () => {
  const state = makeState({ units: ring(CORE.x, CORE.y, 1).map(([x, y], i) => unit(10 + i, 1, 'grunt', x, y)) });
  tick(state, [trainCmd(1, 'worker')]);
  idle(state, stat('worker').trainTicks + 1);
  const made = ownUnits(state);
  assert.equal(made.length, 1);
  assert.deepEqual([made[0].x, made[0].y], ring(CORE.x, CORE.y, 2)[0]);
});

function surround() {
  const blockers = [];
  let id = 10;
  for (const d of [1, 2, 3]) for (const [x, y] of ring(CORE.x, CORE.y, d)) blockers.push(unit(id++, 1, 'grunt', x, y));
  return blockers;
}

test('spawn: distance 3 is the limit; with all 48 tiles taken the unit waits, then spawns when one frees up', () => {
  const blockers = surround();
  assert.equal(blockers.length, 48);
  const state = makeState({ units: blockers });
  tick(state, [trainCmd(1, 'worker')]);
  idle(state, stat('worker').trainTicks + 15);
  assert.equal(ownUnits(state).length, 0, 'nothing spawned while surrounded');
  assert.equal(get(state, 1).queue.length, 1, 'still waiting in the queue');
  assert.equal(state.shards[0], 1000 - stat('worker').cost, 'paid once, not refunded');
  const free = ring(CORE.x, CORE.y, 3)[5];
  state.units = state.units.filter((u) => !(u.x === free[0] && u.y === free[1]));
  idle(state, 2);
  const made = ownUnits(state);
  assert.equal(made.length, 1, 'spawns once a tile frees up');
  assert.deepEqual([made[0].x, made[0].y], free);
  assert.equal(get(state, 1).queue.length, 0);
});

test('spawn: a blocked front item holds the queue; one free tile gives exactly one spawn', () => {
  const state = makeState({ units: surround(), shards: [5000, 5000] });
  tick(state, [trainCmd(1, 'worker'), trainCmd(1, 'worker')]);
  idle(state, stat('worker').trainTicks + 10);
  assert.equal(get(state, 1).queue.length, 2);
  state.units = state.units.filter((u) => !(u.x === CORE.x - 1 && u.y === CORE.y - 1));
  idle(state, 2);
  assert.equal(ownUnits(state).length, 1);
  assert.equal(get(state, 1).queue.length, 1);
});

test('spawn: emits a spawn event with the full unit record and a fresh id', () => {
  const state = makeState();
  const events = [...tick(state, [trainCmd(1, 'worker')])];
  for (let i = 0; i < stat('worker').trainTicks + 2; i++) events.push(...tick(state));
  const sp = events.find((e) => e.e === 'spawn' && e.unit);
  assert.ok(sp, 'spawn event');
  assert.equal(sp.unit.kind, 'worker');
  assert.equal(sp.unit.owner, 0);
  assert.ok(sp.unit.id >= 100, 'id comes from allocId');
});

// ---------------------------------------------------------------- Unit cap
// n side-0 Workers parked in rows far from the Core.
const fillUnits = (n, startId = 10) => Array.from({ length: n }, (_, i) => unit(startId + i, 0, 'worker', i % 32, 28 + Math.floor(i / 32)));

test('unit cap: with cap-1 living units one train is accepted, the next is rejected with unit-cap', () => {
  const state = makeState({ units: fillUnits(unitCap() - 1), shards: [5000, 5000] });
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), []);
  const paid = 5000 - state.shards[0];
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), ['unit-cap']);
  assert.equal(5000 - state.shards[0], paid, 'rejected train costs nothing');
  assert.equal(get(state, 1).queue.length, 1);
});

test('unit cap: queued units count toward the cap, across Core and Forge', () => {
  const state = makeState({ units: fillUnits(unitCap() - 3), structures: [struct(5, 0, 'forge', 15, 15)], shards: [9000, 9000] });
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker'), trainCmd(5, 'grunt'), trainCmd(5, 'grunt')])), []);
  assert.equal(get(state, 1).queue.length + get(state, 5).queue.length, 3);
  const over = tick(state, [trainCmd(1, 'worker'), trainCmd(5, 'lancer')]);
  assert.deepEqual(rejects(over), ['unit-cap', 'unit-cap']);
  assert.equal(get(state, 1).queue.length + get(state, 5).queue.length, 3);
});

test('unit cap: already at the cap with living units rejects any train', () => {
  const state = makeState({ units: fillUnits(unitCap()), shards: [5000, 5000] });
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), ['unit-cap']);
  assert.equal(state.shards[0], 5000);
  assert.equal(get(state, 1).queue.length, 0);
});

test('unit cap: the cap is per side, enemy units do not count', () => {
  const enemy = Array.from({ length: unitCap() }, (_, i) => unit(200 + i, 1, 'worker', i % 32, Math.floor(i / 32)));
  const state = makeState({ units: enemy, shards: [5000, 5000] });
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), []);
});

test('unit cap: a queued unit that spawns is not counted twice, and a death frees room', () => {
  const state = makeState({ units: fillUnits(unitCap() - 1), shards: [5000, 5000] });
  tick(state, [trainCmd(1, 'worker')]);
  idle(state, stat('worker').trainTicks + 2);
  assert.equal(ownUnits(state).length, unitCap(), 'spawned');
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), ['unit-cap']);
  state.units = state.units.filter((u) => u.id !== 10);
  assert.deepEqual(rejects(tick(state, [trainCmd(1, 'worker')])), []);
});

// ---------------------------------------------------------------- Through the real tick loop
test('sim.step: build then train work end to end through the real tick loop', () => {
  need('sim', 'commands', 'economy', 'state');
  const state = makeState({ units: [unit(3, 0, 'worker', 20, 20)] });
  loaded.sim.step(state, [[buildCmd(3, 'turret', 21, 20)], []]);
  const site = state.structures.find((s) => s.kind === 'turret');
  assert.ok(site);
  for (let i = 0; i < stat('turret').buildTicks + 2; i++) loaded.sim.step(state, [[], []]);
  assert.equal(site.complete, true);
  loaded.sim.step(state, [[trainCmd(1, 'worker')], []]);
  for (let i = 0; i < stat('worker').trainTicks + 2; i++) loaded.sim.step(state, [[], []]);
  assert.equal(state.units.filter((u) => u.owner === 0 && u.kind === 'worker').length, 2);
  assert.equal(state.shards[0], 1000 - stat('turret').cost - stat('worker').cost);
});
