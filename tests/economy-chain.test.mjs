// Economy: the mining chain of TERRITORY.md section 8 (hand mining, Drills, Depots, Track lines, the Press,
// Alloy, faction differences, the flow summary). Runs the real sim (env/sim.mjs) on hand-built maps.
//
// The chain is OFF unless enableChain(state) is called, so the first test pins that the default game is
// unchanged. Every number comes from chainStats(state) so a move of the numbers into STATS.chain is a no-op here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState, findEntity } from '../env/state.mjs';
import { step } from '../env/sim.mjs';
import { STATS } from '../env/stats.mjs';
import {
  enableChain, chainStats, layTrack, removeTrack, breakTracksAt, trackAt, flowSummary,
  drillStatus, trackStatus, pressStatus, observeChain, CHAIN_DEFAULTS, RESOURCES, RARE_RESOURCES,
  bankAmount, creditResource, addDeposit, depositAt, setChainMod, placeReason,
} from '../env/economy.mjs';

const NO_CMDS = [[], []];
const CORE = 1;    // side 0's Core, id 1
const WORKER = 3;  // side 0's first Worker, id 3

// A 32 x 32 map with side 0's Core at (3,3) and one Worker at (4,3). Extra pieces are passed in per test.
// Structures of chain kinds (drill, depot, press, siphon) carry their hp so the state helper never asks
// the frozen stats table about them.
function makeState({ crystals = [], units = [], structures = [], shards = [0, 0] } = {}) {
  const state = createTestState({
    width: 32,
    height: 32,
    rocks: [],
    crystals,
    shards,
    units: [
      { id: WORKER, owner: 0, kind: 'worker', x: 4, y: 3, hp: STATS.units.worker.hp, carrying: 0, order: null },
      ...units,
    ],
    structures: [
      { id: CORE, owner: 0, kind: 'core', x: 3, y: 3, hp: STATS.core.hp, progress: 0, complete: true, queue: [] },
      ...structures,
    ],
  });
  // The state helper keeps only the v2 fields; chain extras (a pre-filled buffer) are set here.
  for (const given of structures) {
    if (given.buffer === undefined) continue;
    const made = state.structures.find((s) => s.x === given.x && s.y === given.y);
    made.buffer = given.buffer;
  }
  return state;
}

const chainStructure = (kind, owner, x, y, extra = {}) => ({
  owner, kind, x, y, hp: CHAIN_DEFAULTS.structures[kind].hp, progress: 0, complete: true, queue: [], ...extra,
});

function run(state, ticks, first = []) {
  const all = [];
  for (let i = 0; i < ticks; i++) all.push(...step(state, i === 0 ? [first, []] : NO_CMDS));
  return all;
}

// Lays a straight line of own Track from (x0,y) to (x1,y) inclusive, paying nothing (tests set pay: false).
function lay(state, owner, y, x0, x1) {
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  for (let x = lo; x <= hi; x++) {
    const reason = layTrack(state, owner, x, y, { pay: false });
    assert.equal(reason, null, `layTrack(${x},${y}) -> ${reason}`);
  }
}

const S = CHAIN_DEFAULTS;
// The Burrow is parked (TERRITORY.md section 13), so tests that exercise Burrow rules ask for it explicitly.
const TWO_FACTIONS = ['coil', 'burrow'];

// ---------------------------------------------------------------------------------------------
// Off by default
// ---------------------------------------------------------------------------------------------

test('chain off: a Worker still carries STATS.crystal.carry and the state gains no chain field', () => {
  const state = makeState({ crystals: [{ x: 6, y: 3, amount: 400 }] });
  const events = run(state, 1 + STATS.crystal.mineTicks + 2, [{ type: 'gather', unit: WORKER, x: 6, y: 3 }]);
  const mine = events.find((e) => e.e === 'mine');
  assert.equal(mine.amount, STATS.crystal.carry);
  const deliver = events.find((e) => e.e === 'deliver');
  assert.deepEqual(deliver, { e: 'deliver', id: WORKER, amount: STATS.crystal.carry, shards: STATS.crystal.carry }, 'v2 event shape unchanged');
  assert.equal(state.chain, undefined);
  assert.equal(state.alloy, undefined);
});

test('chainStats reads the stats table (STATS.economy, STATS.factions), falls back to CHAIN_DEFAULTS, and options override single numbers', () => {
  const state = makeState();
  enableChain(state, { numbers: { handCarry: 7 } });
  const s = chainStats(state);
  assert.equal(s.handCarry, 7);
  assert.equal(chainStats(makeState()).handCarry, STATS.economy ? STATS.economy.hand.carry : S.handCarry);
  if (STATS.economy) {
    // The stats owner's table is the source of truth once it exists; these are the names it uses.
    assert.equal(s.drillTicks, STATS.economy.drill.mineEveryTicks);
    assert.equal(s.tileTicks, STATS.economy.track.passEveryTicks);
    assert.equal(s.loadSize, STATS.economy.track.loadSize);
    assert.equal(s.structures.track.cost, STATS.economy.track.costPerTile);
    assert.equal(s.structures.drill.buildTicks, STATS.economy.drill.buildTicks);
    assert.deepEqual(s.pressIn, { shards: STATS.economy.press.recipe.shards, flux: STATS.economy.press.recipe.flux });
    assert.equal(s.pressOut, STATS.economy.press.recipe.alloy);
    assert.equal(s.buffer, STATS.factions.coil.buffer);
    assert.equal(s.burrowBuffer, STATS.factions.burrow.buffer);
    assert.equal(s.waterSpeed, STATS.factions.coil.trackWaterSpeed);
    assert.equal(s.unheldSpeed, STATS.economy.track.unheldSpeed);
  }
  assert.equal(s.loadSize, S.loadSize);
  assert.equal(s.tileTicks, 24);          // one load per tile per second at 24 ticks a second
  assert.equal(s.drillTicks, 12);         // one unit every 12 ticks: 2 a second
  assert.equal(s.buffer, 20);
  assert.equal(s.burrowBuffer, 30);
  assert.equal(s.pressTicks, 48);
  assert.deepEqual(s.pressIn, { shards: 2, flux: 1 });
  assert.equal(s.structures.track.cost, 5);
  assert.equal(s.structures.drill.cost, 75);
  assert.equal(s.structures.depot.cost, 100);
  assert.equal(s.structures.press.cost, 200);
  assert.equal(s.structures.press.flux, 100);
});

test('enableChain sets factions from STATS.factions.sides, flux and alloy banks, empty tracks', () => {
  const state = makeState();
  enableChain(state);
  const expected = STATS.factions?.sides ? [STATS.factions.sides[0], STATS.factions.sides[1]] : ['coil', 'burrow'];
  assert.deepEqual(state.chain.factions, expected);
  assert.deepEqual(state.flux, [0, 0]);
  assert.deepEqual(state.alloy, [0, 0]);
  assert.deepEqual(state.chain.tracks, []);
  // The sim wiring's state.factions wins over the chain's copy when it is there.
  const two = makeState();
  enableChain(two, { factions: ['coil', 'burrow'] });
  assert.deepEqual(observeChain(two, 0).factions, ['coil', 'burrow']);
  two.factions = ['coil', 'coil'];
  assert.deepEqual(observeChain(two, 0).factions, ['coil', 'coil']);
  // Calling it twice is harmless and keeps what is there.
  state.flux[0] = 9;
  enableChain(state);
  assert.equal(state.flux[0], 9);
});

// ---------------------------------------------------------------------------------------------
// Stage 0: hand mining
// ---------------------------------------------------------------------------------------------

test('hand mining carries 5 a trip when the chain is on', () => {
  const state = makeState({ crystals: [{ x: 6, y: 3, amount: 400 }] });
  enableChain(state);
  const events = run(state, 1 + STATS.crystal.mineTicks + 2, [{ type: 'gather', unit: WORKER, x: 6, y: 3 }]);
  const mine = events.find((e) => e.e === 'mine');
  assert.equal(mine.amount, S.handCarry);
  assert.equal(mine.amount, 5);
  assert.equal(state.crystals[0].amount, 400 - 5);
  const deliver = events.find((e) => e.e === 'deliver');
  assert.equal(deliver.amount, 5);
  assert.equal(deliver.to, 'core');
  assert.equal(deliver.resource, 'shards');
});

test('a Worker delivers to the nearest own Depot instead of walking home to the Core', () => {
  // Core at (3,3); field far right at (20,3); a complete Depot at (18,3).
  const state = makeState({
    crystals: [{ x: 20, y: 3, amount: 400 }],
    structures: [chainStructure('depot', 0, 18, 3)],
  });
  enableChain(state);
  const before = state.shards[0];
  // Walk ~15 tiles, mine 8 ticks, deliver next to the Depot, repeat: several trips in 60 ticks.
  const events = run(state, 60, [{ type: 'gather', unit: WORKER, x: 20, y: 3 }]);
  const delivers = events.filter((e) => e.e === 'deliver');
  assert.ok(delivers.length >= 1, 'a delivery happened');
  assert.ok(delivers.every((d) => d.amount === 5 && d.to === 'depot'), 'every load went to the Depot');
  assert.equal(state.shards[0], before + 5 * delivers.length);
  const w = findEntity(state, WORKER);
  assert.ok(Math.abs(w.x - 18) <= 2 && Math.abs(w.y - 3) <= 2, `stayed by the Depot, Worker at ${w.x},${w.y}`);
});

// ---------------------------------------------------------------------------------------------
// Stage 1: Drills with buffers, Workers haul
// ---------------------------------------------------------------------------------------------

test('a Drill mines one unit every drillTicks into a buffer that caps at 20 (Coil) or 30 (Burrow)', () => {
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 400 }, { x: 10, y: 20, amount: 400 }],
    structures: [chainStructure('drill', 0, 10, 3), chainStructure('drill', 1, 10, 20)],
  });
  enableChain(state, { factions: TWO_FACTIONS });
  const coil = state.structures.find((s) => s.kind === 'drill' && s.owner === 0);
  const burrow = state.structures.find((s) => s.kind === 'drill' && s.owner === 1);
  run(state, S.drillTicks * 5);
  assert.equal(coil.buffer, 5);
  assert.equal(state.crystals[0].amount, 395);
  run(state, S.drillTicks * 40);
  assert.equal(coil.buffer, 20, 'Coil buffer caps at 20');
  assert.equal(state.crystals[0].amount, 380, 'a full Drill stops mining');
  assert.equal(burrow.buffer, 30, 'Burrow cubes hold 30');
  assert.equal(drillStatus(state, coil.id).state, 'full');
  assert.equal(drillStatus(state, burrow.id).cap, 30);
});

test('a Drill on an empty tile is dry and a Drill still building does nothing', () => {
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 0 }, { x: 12, y: 3, amount: 400 }],
    structures: [chainStructure('drill', 0, 10, 3), chainStructure('drill', 0, 12, 3, { complete: false, hp: 1 })],
  });
  enableChain(state);
  run(state, S.drillTicks * 3);
  const [dry, site] = state.structures.filter((s) => s.kind === 'drill');
  assert.equal(dry.buffer ?? 0, 0);
  assert.equal(drillStatus(state, dry.id).state, 'dry');
  assert.equal(site.buffer ?? 0, 0);
  assert.equal(state.crystals[1].amount, 400);
});

test('a Worker ordered to gather on a Drill tile hauls from its buffer without mining ticks', () => {
  const state = makeState({
    crystals: [{ x: 6, y: 3, amount: 400 }],
    structures: [chainStructure('drill', 0, 6, 3, { buffer: 12 })],
  });
  enableChain(state);
  const drill = state.structures.find((s) => s.kind === 'drill');
  // Worker at (4,3) walks one tile to (5,3) and is adjacent on the next tick; it picks up 5 at once.
  const events = run(state, 4, [{ type: 'gather', unit: WORKER, x: 6, y: 3 }]);
  const haul = events.find((e) => e.e === 'haul');
  assert.ok(haul, 'a haul event');
  assert.equal(haul.amount, 5);
  assert.equal(findEntity(state, WORKER).carrying, 5);
  assert.ok(drill.buffer <= 12 - 5 + 1, `drill buffer dropped (${drill.buffer})`);
  // The tile itself was not hand-mined by the Worker.
  assert.ok(state.crystals[0].amount >= 400 - 1, 'the Drill, not the Worker, took from the tile');
});

test('a Worker at a Drill whose buffer is short waits beside it for a full load instead of retargeting', () => {
  const state = makeState({
    crystals: [{ x: 6, y: 3, amount: 400 }, { x: 9, y: 9, amount: 400 }],
    structures: [chainStructure('drill', 0, 6, 3, { buffer: 0 })],
  });
  enableChain(state);
  // In 10 ticks the Drill mines nothing (first unit at tick 12): the Worker waits, does not hand-mine the tile.
  run(state, 10, [{ type: 'gather', unit: WORKER, x: 6, y: 3 }]);
  const w = findEntity(state, WORKER);
  assert.equal(w.order?.type, 'gather');
  assert.deepEqual({ x: w.order.x, y: w.order.y }, { x: 6, y: 3 });
  assert.equal(w.carrying, 0);
  assert.equal(state.crystals[0].amount, 400);
  // When the Drill has a full load the Worker takes it in one go (and then walks it home).
  const events = run(state, S.drillTicks * 5 + 2);
  const haul = events.find((e) => e.e === 'haul');
  assert.ok(haul, 'a haul happened once the buffer held 5');
  assert.equal(haul.amount, 5);
  assert.ok(!events.some((e) => e.e === 'mine'), 'the Worker never hand-mined the Drill tile');
});

test('a Worker at a dry, empty Drill moves on to the nearest field with Shards', () => {
  const state = makeState({
    crystals: [{ x: 6, y: 3, amount: 1 }, { x: 9, y: 9, amount: 400 }],
    structures: [chainStructure('drill', 0, 6, 3, { buffer: 0 })],
  });
  enableChain(state);
  run(state, 1, [{ type: 'gather', unit: WORKER, x: 6, y: 3 }]);
  state.crystals[0].amount = 0; // the tile runs dry after the command was accepted
  run(state, 3);
  const w = findEntity(state, WORKER);
  assert.equal(w.order?.type, 'gather');
  assert.deepEqual({ x: w.order.x, y: w.order.y }, { x: 9, y: 9 });
});

// ---------------------------------------------------------------------------------------------
// Stage 2: Track lines
// ---------------------------------------------------------------------------------------------

test('layTrack: pays 5 Shards, rejects off-map, taken and doubled tiles, and no-shards', () => {
  const state = makeState({ crystals: [{ x: 6, y: 3, amount: 400 }], shards: [12, 0] });
  enableChain(state);
  assert.equal(layTrack(state, 0, 40, 3), 'off-map');
  assert.equal(layTrack(state, 0, 6, 3), 'tile-taken', 'a crystal tile');
  assert.equal(layTrack(state, 0, 3, 3), 'tile-taken', 'the Core');
  assert.equal(layTrack(state, 0, 5, 3), null);
  assert.equal(state.shards[0], 7);
  assert.equal(layTrack(state, 0, 5, 3), 'tile-taken', 'already Track');
  assert.equal(layTrack(state, 0, 5, 4), null);
  assert.equal(state.shards[0], 2);
  assert.equal(layTrack(state, 0, 5, 5), 'no-shards');
  assert.equal(state.chain.tracks.length, 2);
  assert.equal(trackAt(state, 5, 3).owner, 0);
  // Track is walkable: the Worker can stand on it.
  const events = run(state, 3, [{ type: 'move', unit: WORKER, x: 5, y: 3 }]);
  assert.equal(findEntity(state, WORKER).x, 5);
  assert.ok(!events.some((e) => e.e === 'reject'));
});

test('placeReason: a Drill goes on a Shard tile with Shards left, a Siphon on a Vent, a Depot or Press on open ground', () => {
  const state = makeState({ crystals: [{ x: 6, y: 3, amount: 400 }, { x: 7, y: 3, amount: 0 }], shards: [500, 0] });
  assert.equal(placeReason(state, 'drill', 6, 3), 'chain-off');
  enableChain(state);
  state.vents = [{ x: 9, y: 3, amount: 600 }];
  assert.equal(placeReason(state, 'drill', 6, 3), null);
  assert.equal(placeReason(state, 'drill', 7, 3), 'bad-target', 'an empty Shard tile');
  assert.equal(placeReason(state, 'drill', 8, 3), 'bad-target', 'plain ground');
  assert.equal(placeReason(state, 'siphon', 9, 3), null);
  assert.equal(placeReason(state, 'siphon', 6, 3), 'bad-target');
  assert.equal(placeReason(state, 'depot', 8, 3), null);
  assert.equal(placeReason(state, 'press', 6, 3), 'tile-taken', 'not on a Shard tile');
  assert.equal(placeReason(state, 'depot', 4, 3), 'tile-taken', 'the Worker stands there');
  assert.equal(placeReason(state, 'depot', 3, 3), 'tile-taken', 'the Core');
  assert.equal(placeReason(state, 'depot', 40, 3), 'off-map');
  assert.equal(placeReason(state, 'track', 8, 3), 'wrong-kind', 'Track goes through layTrack');
  assert.equal(placeReason(state, 'forge', 8, 3), 'wrong-kind');
  layTrack(state, 0, 8, 4, { pay: false });
  assert.equal(placeReason(state, 'depot', 8, 4), 'tile-taken', 'a Track tile');
  addDeposit(state, { x: 8, y: 5, resource: 'quakestone', amount: 3 });
  assert.equal(placeReason(state, 'depot', 8, 5), 'tile-taken', 'a deposit');
});

test('a line carries loads one tile per second from a Drill to the Core', () => {
  // Drill at (10,3) with buffer 20; Track (4,3)..(9,3); the Core at (3,3) is next to (4,3).
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 400 }],
    structures: [chainStructure('drill', 0, 10, 3, { buffer: 20 })],
  });
  enableChain(state);
  findEntity(state, WORKER).x = 4; findEntity(state, WORKER).y = 8; // out of the way
  lay(state, 0, 3, 4, 9);
  const before = state.shards[0];
  // Tick 1: the Drill pushes a load onto (9,3). Six tiles at 24 ticks each: the first load lands after
  // 6 * 24 ticks on the tile next to the Core, and is deposited when its dwell ends.
  run(state, 1);
  assert.equal(trackAt(state, 9, 3).load?.amount, 5, 'the first load of 5 left the Drill');
  run(state, 6 * S.tileTicks - 1);
  assert.equal(state.shards[0], before, 'nothing delivered a tick early');
  const events = run(state, 1);
  assert.equal(state.shards[0], before + 5, 'first load delivered after six tile-seconds');
  assert.ok(events.some((e) => e.e === 'deliver' && e.via === 'track' && e.amount === 5));
  // Steady state: the Drill makes 2 a second, so one load of 5 every 2.5 s = 120 a minute. Run long
  // enough that the pre-filled buffer's early burst has left the 60 s window.
  run(state, 24 * 100);
  const flow = flowSummary(state, 0);
  assert.ok(flow.shardsPerMin >= 110 && flow.shardsPerMin <= 130, `about 120 Shards/min, got ${flow.shardsPerMin}`);
});

test('a tile passes at most one load per second: a faster source queues behind the line', () => {
  // Two Drills feeding one line: the line's single tile next to the Core limits throughput to 5 a second.
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 4000 }, { x: 10, y: 4, amount: 4000 }],
    structures: [chainStructure('drill', 0, 10, 3, { buffer: 20 }), chainStructure('drill', 0, 10, 4, { buffer: 20 })],
  });
  enableChain(state, { numbers: { drillTicks: 1 } }); // absurdly fast Drills
  findEntity(state, WORKER).x = 4; findEntity(state, WORKER).y = 8;
  lay(state, 0, 3, 4, 9);
  lay(state, 0, 4, 9, 9);
  const before = state.shards[0];
  run(state, 24 * 60 + 6 * 24);
  const got = state.shards[0] - before;
  // 60 seconds of steady state at 5 per second = 300, give or take the fill of the line.
  assert.ok(got >= 280 && got <= 320, `one load per tile per second caps the line near 300/min, got ${got}`);
});

test('an enemy standing on a Coil track stops the flow; stepping off resumes it', () => {
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 400 }],
    structures: [chainStructure('drill', 0, 10, 3, { buffer: 20 })],
    units: [{ id: 50, owner: 1, kind: 'grunt', x: 7, y: 3 }],
  });
  enableChain(state);
  findEntity(state, WORKER).x = 4; findEntity(state, WORKER).y = 8;
  lay(state, 0, 3, 4, 9);
  const before = state.shards[0];
  run(state, 6 * S.tileTicks + 24);
  assert.equal(state.shards[0], before, 'nothing gets past the Grunt');
  assert.equal(trackStatus(state, 7, 3).state, 'blocked');
  assert.ok(trackAt(state, 8, 3).load, 'the load waits behind the Grunt');
  // The Grunt leaves (teleported for the test) and the flow resumes.
  const grunt = findEntity(state, 50); grunt.x = 20; grunt.y = 20;
  run(state, 5 * S.tileTicks + 2);
  assert.ok(state.shards[0] > before, 'flow resumed');
});

test('an enemy standing on a Burrow Run does not cut it (it is underground)', () => {
  // Side 1 (Burrow) Core would be at the mirror; give side 1 its own Core and Drill here.
  const state = makeState({
    crystals: [{ x: 20, y: 20, amount: 400 }],
    structures: [
      { id: 2, owner: 1, kind: 'core', x: 14, y: 20, hp: STATS.core.hp, progress: 0, complete: true, queue: [] },
      chainStructure('drill', 1, 20, 20, { buffer: 30 }),
    ],
    units: [{ id: 50, owner: 0, kind: 'grunt', x: 17, y: 20 }],
  });
  enableChain(state, { factions: TWO_FACTIONS });
  lay(state, 1, 20, 15, 19);
  const before = state.shards[1];
  run(state, 5 * S.tileTicks + 1);
  assert.equal(state.shards[1], before + 5, 'the Run delivered under the Grunt');
  assert.equal(trackStatus(state, 17, 20).state, 'running');
});

test('removeTrack and breakTracksAt remove tiles and lose the loads on them; the line re-routes or stalls', () => {
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 400 }],
    structures: [chainStructure('drill', 0, 10, 3, { buffer: 20 })],
  });
  enableChain(state);
  findEntity(state, WORKER).x = 4; findEntity(state, WORKER).y = 8;
  lay(state, 0, 3, 4, 9);
  run(state, 1);
  assert.ok(trackAt(state, 9, 3).load);
  const events = [];
  state.events = events;
  removeTrack(state, 9, 3);
  assert.equal(trackAt(state, 9, 3), null);
  assert.ok(events.some((e) => e.e === 'track-cut' && e.x === 9 && e.y === 3 && e.lost === 5));
  breakTracksAt(state, [[6, 3], [7, 3], [30, 30]]);
  assert.equal(state.chain.tracks.length, 3);
  // The Drill now has no adjacent Track with a route: it fills and reports blocked.
  run(state, S.drillTicks * 30);
  assert.equal(drillStatus(state, state.structures.find((s) => s.kind === 'drill').id).state, 'full');
  assert.equal(trackStatus(state, 8, 3).state, 'no-route');
});

test('a line through a Reach the owner does not hold runs at half speed', () => {
  const holds = (state, owner, x, y) => !(x >= 6 && x <= 7); // tiles 6 and 7 are foreign land
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 400 }],
    structures: [chainStructure('drill', 0, 10, 3, { buffer: 20 })],
  });
  enableChain(state, { holds });
  findEntity(state, WORKER).x = 4; findEntity(state, WORKER).y = 8;
  lay(state, 0, 3, 4, 9);
  const before = state.shards[0];
  // 4 held tiles at 24 + 2 unheld tiles at 48 = 192 ticks, plus the push tick.
  run(state, 1 + 4 * S.tileTicks + 2 * S.tileTicks * 2 - 1);
  assert.equal(state.shards[0], before);
  run(state, 1);
  assert.equal(state.shards[0], before + 5);
  assert.equal(trackStatus(state, 6, 3).speed, 0.5);
});

test('water: a Coil Coil crosses at half speed, a Burrow Run under water stops', () => {
  const isWater = (state, x, y) => x === 7;
  // Coil line, side 0.
  const coil = makeState({
    crystals: [{ x: 10, y: 3, amount: 400 }],
    structures: [chainStructure('drill', 0, 10, 3, { buffer: 20 })],
  });
  enableChain(coil, { isWater });
  findEntity(coil, WORKER).x = 4; findEntity(coil, WORKER).y = 8;
  lay(coil, 0, 3, 4, 9);
  const before = coil.shards[0];
  run(coil, 1 + 5 * S.tileTicks + 2 * S.tileTicks);
  assert.equal(coil.shards[0], before + 5, 'Coil track delivered, one slow tile');
  // Burrow line, side 1, same geometry.
  const burrow = makeState({
    crystals: [{ x: 20, y: 20, amount: 400 }],
    structures: [
      { id: 2, owner: 1, kind: 'core', x: 14, y: 20, hp: STATS.core.hp, progress: 0, complete: true, queue: [] },
      chainStructure('drill', 1, 20, 20, { buffer: 30 }),
    ],
  });
  enableChain(burrow, { factions: TWO_FACTIONS, isWater: (s, x, y) => x === 17 });
  lay(burrow, 1, 20, 15, 19);
  const b0 = burrow.shards[1];
  run(burrow, 1 + 10 * S.tileTicks);
  assert.equal(burrow.shards[1], b0, 'the flooded Run stops');
  assert.equal(trackStatus(burrow, 17, 20).state, 'flooded');
});

// ---------------------------------------------------------------------------------------------
// Stage 3: the Press and Alloy
// ---------------------------------------------------------------------------------------------

test('a Press turns 2 Shards + 1 Flux from its lines into 1 Alloy every 2 seconds, and starves without Flux', () => {
  // Drill (shards) at (10,3), Siphon (flux) on a vent at (10,5); both lines meet the Press at (6,4).
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 400 }],
    structures: [
      chainStructure('drill', 0, 10, 3, { buffer: 20 }),
      chainStructure('siphon', 0, 10, 5, { buffer: 20 }),
      chainStructure('press', 0, 6, 4),
    ],
  });
  state.vents = [{ x: 10, y: 5, amount: 600 }];
  enableChain(state);
  findEntity(state, WORKER).x = 4; findEntity(state, WORKER).y = 8;
  lay(state, 0, 3, 7, 9);   // shard line ends at (7,3), next to the Press at (6,4)? No: (7,3) is diagonal.
  layTrack(state, 0, 6, 3, { pay: false }); // (6,3) is directly above the Press
  lay(state, 0, 5, 7, 9);
  layTrack(state, 0, 6, 5, { pay: false }); // (6,5) directly below
  const press = state.structures.find((s) => s.kind === 'press');
  run(state, 24 * 12);
  assert.ok(state.alloy[0] >= 3, `Alloy made: ${state.alloy[0]}`);
  assert.ok(press.in.shards >= 0 && press.in.flux >= 0);
  const flow = flowSummary(state, 0);
  assert.ok(flow.alloyPerMin > 0);
  // The Siphon's whole line goes (a Quake): the Press runs out of Flux and starves while Shards keep coming.
  assert.equal(breakTracksAt(state, [[6, 5], [7, 5], [8, 5], [9, 5]]), 4);
  press.in.flux = 0;
  run(state, S.pressTicks * 2);
  assert.equal(pressStatus(state, press.id).state, 'starved');
  assert.equal(pressStatus(state, press.id).missing, 'flux');
});

test('a Press input buffer that is full blocks the load at the end of the line', () => {
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 4000 }],
    structures: [chainStructure('drill', 0, 10, 3, { buffer: 20 }), chainStructure('press', 0, 6, 4)],
  });
  enableChain(state, { numbers: { drillTicks: 1 } });
  findEntity(state, WORKER).x = 4; findEntity(state, WORKER).y = 8;
  lay(state, 0, 3, 6, 9);
  const press = state.structures.find((s) => s.kind === 'press');
  run(state, 24 * 40);
  assert.equal(press.in.shards, S.pressBuffer, 'input buffer full');
  assert.equal(pressStatus(state, press.id).state, 'starved');
  assert.ok(trackAt(state, 6, 3).load, 'the load waits on the last tile');
  assert.equal(trackStatus(state, 6, 3).state, 'full');
});

// ---------------------------------------------------------------------------------------------
// Flow summary, observation, determinism
// ---------------------------------------------------------------------------------------------

test('flowSummary reports per-minute rates over the last 60 seconds plus totals', () => {
  const state = makeState({ crystals: [{ x: 6, y: 3, amount: 4000 }] });
  enableChain(state);
  const f0 = flowSummary(state, 0);
  const zeros = Object.fromEntries(RESOURCES.map((r) => [r, 0]));
  assert.deepEqual(f0, { shardsPerMin: 0, fluxPerMin: 0, alloyPerMin: 0, perMin: zeros, total: zeros, seconds: 0 });
  assert.deepEqual(RESOURCES, ['shards', 'flux', 'alloy', 'glowmoss', 'stormglass', 'quakestone', 'ironroot', 'amberlight']);
  run(state, 24 * 30, [{ type: 'gather', unit: WORKER, x: 6, y: 3 }]);
  const f = flowSummary(state, 0);
  assert.equal(f.seconds, 30);
  assert.equal(f.total.shards, state.shards[0]);
  assert.equal(f.shardsPerMin, Math.round(f.total.shards * 2));
  run(state, 24 * 60);
  const g = flowSummary(state, 0);
  assert.equal(g.seconds, 60);
  assert.ok(g.total.shards > f.total.shards);
  assert.ok(g.shardsPerMin > 0 && g.shardsPerMin <= g.total.shards);
});

test('observeChain is a deep copy with own tracks and only the enemy tracks a visibility test allows', () => {
  const state = makeState({ crystals: [{ x: 10, y: 3, amount: 400 }] });
  enableChain(state);
  lay(state, 0, 3, 5, 6);
  lay(state, 1, 20, 5, 6);
  const own = observeChain(state, 0, { visible: (x, y) => x === 5 });
  assert.equal(own.tracks.filter((t) => t.owner === 0).length, 2);
  assert.equal(own.tracks.filter((t) => t.owner === 1).length, 1);
  assert.equal(own.factions.length, 2);
  assert.equal(own.flow.shardsPerMin, 0);
  own.tracks[0].x = 99;
  assert.notEqual(state.chain.tracks[0].x, 99);
  assert.equal(observeChain(makeState(), 0), null, 'null when the chain is off');
});

// ---------------------------------------------------------------------------------------------
// Many resources (TERRITORY.md section 12): banks, deposits, research multipliers
// ---------------------------------------------------------------------------------------------

test('creditResource and bankAmount are the one door to every bank, rare five included', () => {
  const state = makeState({ shards: [100, 0] });
  assert.equal(creditResource(state, 0, 'ironroot', 5), false, 'off: nothing happens');
  enableChain(state);
  assert.equal(bankAmount(state, 0, 'shards'), 100);
  assert.equal(creditResource(state, 0, 'ironroot', 5), true);
  assert.equal(creditResource(state, 1, 'glowmoss', 60), true);
  assert.equal(creditResource(state, 0, 'alloy', 3), true);
  assert.equal(creditResource(state, 0, 'moonrock', 3), false, 'unknown resource');
  assert.equal(creditResource(state, 0, 'ironroot', -6), false, 'no overdraw');
  assert.equal(creditResource(state, 0, 'ironroot', -2), true, 'a sale takes from the bank');
  assert.equal(bankAmount(state, 0, 'ironroot'), 3);
  assert.equal(bankAmount(state, 1, 'glowmoss'), 60);
  assert.equal(state.rare[0].ironroot, 3);
  assert.equal(state.alloy[0], 3);
  // Income (not sales) shows in the flow: 5 Ironroot and 3 Alloy in the first second.
  run(state, 24 * 10);
  const flow = flowSummary(state, 0);
  assert.equal(flow.total.ironroot, 5);
  assert.equal(flow.total.alloy, 3);
  assert.equal(flow.perMin.ironroot, 30, '5 in 10 s is 30 a minute');
  assert.equal(flowSummary(state, 1).total.glowmoss, 60);
  assert.deepEqual(Object.keys(flow.perMin), [...RESOURCES]);
});

test('a Worker picks a rare deposit off the ground like Shards and brings it to the Depot or Core', () => {
  const state = makeState({ crystals: [{ x: 9, y: 9, amount: 400 }] });
  enableChain(state);
  assert.equal(addDeposit(state, { x: 6, y: 3, resource: 'moonrock', amount: 9 }), null, 'unknown resource');
  assert.equal(addDeposit(state, { x: 60, y: 3, resource: 'stormglass', amount: 9 }), null, 'off map');
  const d = addDeposit(state, { x: 6, y: 3, resource: 'stormglass', amount: 7 });
  assert.equal(addDeposit(state, { x: 6, y: 3, resource: 'stormglass', amount: 1 }).amount, 8, 'tops up');
  assert.equal(addDeposit(state, { x: 6, y: 3, resource: 'glowmoss', amount: 1 }), null, 'one kind per tile');
  assert.equal(depositAt(state, 6, 3), d);
  // The gather order is set by hand (commands.mjs only knows crystals; the sim wiring maps gather-on-deposit).
  const w = findEntity(state, WORKER);
  w.order = { type: 'gather', x: 6, y: 3, phase: 'toField', ticks: 0 };
  const events = run(state, 1 + STATS.crystal.mineTicks + 3);
  const mine = events.find((e) => e.e === 'mine');
  assert.equal(mine.resource, 'stormglass');
  assert.equal(mine.amount, 5);
  const deliver = events.find((e) => e.e === 'deliver');
  assert.equal(deliver.resource, 'stormglass');
  assert.equal(deliver.amount, 5);
  assert.equal(deliver.rare, 5);
  assert.equal(bankAmount(state, 0, 'stormglass'), 5);
  assert.equal(depositAt(state, 6, 3).amount, 3);
  assert.equal(w.order.type, 'gather', 'goes back for the rest');
  // The rest: 3 more, then the pile is gone and the Worker goes idle (no other Stormglass).
  const more = run(state, 40);
  assert.equal(bankAmount(state, 0, 'stormglass'), 8);
  assert.equal(depositAt(state, 6, 3), null);
  assert.ok(more.some((e) => e.e === 'deposit' && e.amount === 0), 'the empty pile is announced');
  assert.equal(w.order, null);
  assert.equal(w.carryingRare, undefined);
  assert.equal(flowSummary(state, 0).total.stormglass, 8);
  const obs = observeChain(state, 0);
  assert.deepEqual(obs.rare[0].stormglass, 8);
  assert.deepEqual(obs.deposits, []);
});

test('research multipliers: Drill Speed, Track Speed, Bigger Buffers and Twin Press change the rates', () => {
  const state = makeState({
    crystals: [{ x: 10, y: 3, amount: 4000 }],
    structures: [chainStructure('drill', 0, 10, 3), chainStructure('press', 0, 6, 4)],
  });
  enableChain(state);
  findEntity(state, WORKER).x = 4; findEntity(state, WORKER).y = 8;
  const drill = state.structures.find((s) => s.kind === 'drill');
  const press = state.structures.find((s) => s.kind === 'press');
  setChainMod(state, 0, 'drillSpeed', 2);   // one unit every 6 ticks
  setChainMod(state, 0, 'buffer', 1.5);     // 30 for a Snakenator Drill
  run(state, S.drillTicks * 10);            // 120 ticks: 20 units at double speed
  assert.equal(drill.buffer, 20);
  assert.equal(drillStatus(state, drill.id).cap, 30);
  run(state, S.drillTicks * 10);
  assert.equal(drill.buffer, 30, 'the bigger buffer fills');
  // Track Speed: two loads a second, so a 4-tile line takes 48 ticks instead of 96.
  setChainMod(state, 0, 'trackSpeed', 2);
  lay(state, 0, 3, 6, 9);
  const t0 = state.tick;
  run(state, 1);
  assert.equal(trackAt(state, 9, 3).load.amount, 5);
  run(state, 4 * (S.tileTicks / 2) - 1);
  assert.equal(press.in?.shards ?? 0, 0);
  run(state, 1);
  assert.equal(press.in.shards, 5, `arrived after ${state.tick - t0} ticks`);
  assert.equal(trackStatus(state, 9, 3).speed, 2);
  // Twin Press: 2 Alloy a cycle.
  setChainMod(state, 0, 'pressOut', 2);
  press.in.flux = 10;
  const events = run(state, S.pressTicks + 1);
  const made = events.find((e) => e.e === 'press');
  assert.equal(made.made, 2);
  assert.equal(state.alloy[0], 2);
});

test('the chain is deterministic and the full state stays JSON-serialisable', () => {
  const build = () => {
    const state = makeState({
      crystals: [{ x: 10, y: 3, amount: 400 }],
      structures: [chainStructure('drill', 0, 10, 3, { buffer: 20 }), chainStructure('press', 0, 6, 4)],
      units: [{ id: 50, owner: 1, kind: 'grunt', x: 8, y: 3 }],
    });
    enableChain(state);
    lay(state, 0, 3, 6, 9);
    run(state, 400, [{ type: 'gather', unit: WORKER, x: 10, y: 3 }]);
    return state;
  };
  const a = build(), b = build();
  const strip = (s) => JSON.stringify({ ...s, rockSet: undefined, chain: { ...s.chain, holds: undefined, isWater: undefined } });
  assert.equal(strip(a), strip(b));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(a.chain.tracks)));
});
