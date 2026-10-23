// Cord power (TERRITORY.md section 20: the cord is the leash). Owner: sonnet. Tests first.
// Everything here is opt-in: state.power exists only after enablePower() (createTerritoryMatch turns it on).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../env/state.mjs';
import { step } from '../env/sim.mjs';
import { enablePower, POWER, stepPower, stepVerdict, doPlug, doPlaceCord } from '../env/power.mjs';
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { createMatch } from '../env/sim.mjs';
import { distance } from '../env/state.mjs';

const NONE = [[], []];
const run = (state, n, cmds = NONE) => {
  const events = [];
  for (let i = 0; i < n; i++) events.push(...step(state, cmds));
  return events;
};
const hasEvent = (events, e) => events.some((ev) => ev.e === e);

// Two cores (strip points), a worker of side 0 in the open, and optionally an enemy worker.
function world({ units = [], claims = [], shards = [100, 100] } = {}) {
  const state = createTestState({
    width: 40,
    height: 40,
    shards,
    structures: [
      { id: 1, owner: 0, kind: 'core', x: 5, y: 5 },
      { id: 2, owner: 1, kind: 'core', x: 34, y: 34 },
    ],
    units,
  });
  state.claims = claims;
  enablePower(state);
  return state;
}
const unitAt = (id, owner, kind, x, y, extra = {}) => ({ id, owner, kind, x, y, hp: 40, order: null, carrying: 0, ...extra });
const byId = (state, id) => state.units.find((u) => u.id === id);

test('default matches have no power; the territory match turns it on', () => {
  assert.equal(createMatch(5).power, undefined);
  const t = createTerritoryMatch(5);
  assert.ok(t.power, 'territory match carries state.power');
  assert.equal(t.power.points.length, 0);
});

test('cord limit: a Crumb stops 12 tiles from its Power Strip and the order is dropped', () => {
  const s = world({ units: [unitAt(10, 0, 'worker', 6, 5, { order: { type: 'move', x: 30, y: 5 } })] });
  const events = run(s, 30);

  assert.equal(byId(s, 10).x, 5 + POWER.cord.worker);
  assert.equal(byId(s, 10).order, null);
  const stop = events.find((ev) => ev.e === 'cord-limit');
  assert.ok(stop, 'cord-limit event');
  assert.equal(stop.reason, 'cord');
});

test('a completed Outlet extends the cord: the Crumb walks 12 tiles past it', () => {
  const outlet = { id: 30, owner: 0, kind: 'totem', reach: 1, x: 17, y: 5, complete: true, hp: 300, progress: 0 };
  const s = world({ units: [unitAt(10, 0, 'worker', 6, 5, { order: { type: 'move', x: 39, y: 5 } })], claims: [outlet] });
  run(s, 60);
  assert.equal(byId(s, 10).x, 17 + POWER.cord.worker);
});

test('an unfinished claim is not an Outlet', () => {
  const outlet = { id: 30, owner: 0, kind: 'totem', reach: 1, x: 17, y: 5, complete: false, hp: 10, progress: 3 };
  const s = world({ units: [unitAt(10, 0, 'worker', 6, 5, { order: { type: 'move', x: 39, y: 5 } })], claims: [outlet] });
  run(s, 60);
  assert.equal(byId(s, 10).x, 5 + POWER.cord.worker);
});

test('brown-out: an island network with no Generator is stuck; a Generator lights it', () => {
  // Strip at (5,5) reaches 14 tiles; the Outlet at (25,5) reaches 10: 20 apart, so the island is not linked to the base.
  const outlet = { id: 30, owner: 0, kind: 'totem', reach: 1, x: 25, y: 5, complete: true, hp: 300, progress: 0 };
  const s = world({ units: [unitAt(10, 0, 'worker', 26, 5, { order: { type: 'move', x: 27, y: 5 } })], claims: [outlet] });
  const first = run(s, 3);
  assert.equal(byId(s, 10).x, 26, 'stuck in place');
  assert.equal(first.find((ev) => ev.e === 'cord-limit')?.reason, 'stuck');

  s.power.points.push({ id: 31, owner: 0, kind: 'generator', x: 28, y: 5, range: POWER.range.generator });
  byId(s, 10).order = { type: 'move', x: 27, y: 5 };
  run(s, 3);
  assert.equal(byId(s, 10).x, 27, 'the Generator lights the island and the Crumb moves again');
});

test('a cut cord: an enemy on the line puts the Crumb on a 10 s battery, then powers it down', () => {
  const s = world({ units: [unitAt(10, 0, 'worker', 10, 5), unitAt(11, 1, 'worker', 7, 5)] });
  const first = run(s, 1);
  assert.equal(byId(s, 10).power.state, 'battery');
  const cut = first.find((ev) => ev.e === 'cord-cut');
  assert.ok(cut, 'cord-cut event');
  assert.equal(cut.id, 10);
  assert.equal(s.power.cuts.length, 1, 'sparks are remembered for the view');

  byId(s, 11).y = 9; // the raider steps off the line
  run(s, POWER.batteryTicks - 1);
  assert.equal(byId(s, 10).power.state, 'battery', 'still on battery one tick short');
  const down = run(s, 1);
  assert.equal(byId(s, 10).power.state, 'down');
  assert.ok(hasEvent(down, 'power-down'));
});

test('a battery Crumb may still walk; a powered-down one may not', () => {
  const s = world({ units: [unitAt(10, 0, 'worker', 10, 5), unitAt(11, 1, 'worker', 7, 5)] });
  run(s, 1); // cut
  byId(s, 10).order = { type: 'move', x: 13, y: 5 };
  run(s, 3);
  assert.equal(byId(s, 10).x, 13, 'battery units move freely');

  byId(s, 11).y = 9;
  run(s, POWER.batteryTicks);
  assert.equal(byId(s, 10).power.state, 'down');
  byId(s, 10).order = { type: 'move', x: 16, y: 5 };
  const events = run(s, 3);
  assert.equal(byId(s, 10).x, 13, 'down units do not move');
  assert.equal(events.find((ev) => ev.e === 'cord-limit')?.reason, 'down');
});

test('re-plug: a Crumb standing next to a cut unit plugs it in after 24 ticks', () => {
  const s = world({ units: [unitAt(10, 0, 'worker', 10, 5), unitAt(11, 1, 'worker', 7, 5), unitAt(12, 0, 'worker', 10, 4)] });
  run(s, 1); // cut
  byId(s, 11).y = 9;
  run(s, POWER.batteryTicks + 1);
  assert.equal(byId(s, 10).power.state, 'down');

  const issued = run(s, 1, [[{ type: 'plug', unit: 12, target: 10 }], []]);
  assert.ok(!issued.some((ev) => ev.e === 'reject'), 'the plug is accepted');
  run(s, POWER.plugTicks - 2);
  assert.equal(byId(s, 10).power.state, 'down', 'not yet');
  const done = run(s, 1);
  assert.equal(byId(s, 10).power.state, 'plugged');
  assert.ok(hasEvent(done, 'plugged'));
});

test('re-plug rules: only a cut unit, only from next to it, only by your own Crumb', () => {
  const s = world({ units: [unitAt(10, 0, 'worker', 10, 5), unitAt(12, 0, 'worker', 10, 4), unitAt(13, 0, 'worker', 20, 20)] });
  assert.equal(doPlug(s, 0, { type: 'plug', unit: 12, target: 10 }), 'not-cut');
  byId(s, 10).power = { state: 'down', anchor: null, battery: 0 };
  assert.equal(doPlug(s, 0, { type: 'plug', unit: 13, target: 10 }), 'too-far');
  assert.equal(doPlug(s, 1, { type: 'plug', unit: 12, target: 10 }), 'not-yours');
  assert.equal(doPlug(s, 0, { type: 'plug', unit: 12, target: 10 }), null);
});

test('Extension Box: placed next to a plugged Crumb, paid for, and it reaches further', () => {
  const s = world({ units: [unitAt(10, 0, 'worker', 15, 5)] });
  const ok = run(s, 1, [[{ type: 'place-power', unit: 10, kind: 'extension', x: 16, y: 5 }], []]);
  assert.ok(!ok.some((ev) => ev.e === 'reject'));
  assert.equal(s.shards[0], 100 - POWER.cost.extension);
  assert.ok(s.power.points.some((p) => p.kind === 'extension' && p.x === 16 && p.y === 5));
  byId(s, 10).order = { type: 'move', x: 39, y: 5 };
  run(s, 40);
  assert.equal(byId(s, 10).x, 16 + POWER.cord.worker);
});

test('place-power rejects: unplugged builder, no shards, too far, bad kind', () => {
  const s = world({ units: [unitAt(10, 0, 'worker', 15, 5), unitAt(11, 0, 'worker', 14, 5)] });
  byId(s, 11).power = { state: 'battery', anchor: null, battery: 9 }; // createTestState does not copy power records
  assert.equal(doPlaceCord(s, 0, { type: 'place-power', unit: 11, kind: 'extension', x: 15, y: 4 }), 'unplugged');
  assert.equal(doPlaceCord(s, 0, { type: 'place-power', unit: 10, kind: 'extension', x: 18, y: 5 }), 'too-far');
  assert.equal(doPlaceCord(s, 0, { type: 'place-power', unit: 10, kind: 'castle', x: 16, y: 5 }), 'bad-command');
  s.shards[0] = 0;
  assert.equal(doPlaceCord(s, 0, { type: 'place-power', unit: 10, kind: 'extension', x: 16, y: 5 }), 'no-shards');
});

test('Power Strip reserve: a side with no Crumbs and no Shards gets a free emergency Crumb, then a cooldown', () => {
  const s = world({ units: [unitAt(10, 0, 'worker', 6, 5)], shards: [100, 0] });
  const events = run(s, 1);
  assert.equal(s.units.filter((u) => u.owner === 1 && u.kind === 'worker').length, 1);
  assert.ok(hasEvent(events, 'reserve-crumb'));
  const ids = s.units.filter((u) => u.owner === 1).map((u) => u.id);
  run(s, 10);
  assert.equal(s.units.filter((u) => u.owner === 1 && u.kind === 'worker').length, 1, 'cooldown: no second Crumb yet');
  assert.equal(ids.length, 1);
  assert.ok(distance(s.units.find((u) => u.owner === 1), s.structures.find((x) => x.owner === 1 && x.kind === 'core')) <= 1);
});

test('stepVerdict is null when power is off, and plugged units inside the cord may step', () => {
  const plain = createTestState({ width: 20, height: 20, units: [unitAt(10, 0, 'worker', 3, 3)] });
  assert.equal(stepVerdict(plain, plain.units[0], 4, 3), null);
  const s = world({ units: [unitAt(10, 0, 'worker', 6, 5)] });
  stepPower(s);
  assert.equal(stepVerdict(s, byId(s, 10), 7, 5), null);
  assert.equal(stepVerdict(s, byId(s, 10), 30, 5), 'cord');
});

test('deterministic: the same script gives the same match', () => {
  const script = () => {
    const s = world({ units: [unitAt(10, 0, 'worker', 6, 5, { order: { type: 'move', x: 30, y: 5 } }), unitAt(11, 1, 'worker', 9, 5)] });
    run(s, 80);
    return JSON.stringify([s.units, s.power.cuts, s.shards]);
  };
  assert.equal(script(), script());
});
