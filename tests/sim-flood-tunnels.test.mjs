// Flood (push-out, blocked water, dead claims) and Burrow Tunnels (TERRITORY.md sections 4 and 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { step } from '../env/sim.mjs';
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { EFFECTS } from '../env/effects.mjs';
import { isPassable } from '../env/state.mjs';
import { holdCount } from '../env/territory.mjs';

const run = (s, n, cmds = [[], []]) => { for (let i = 0; i < n; i++) step(s, cmds); };
const rejected = (s) => s.events.find((e) => e.e === 'reject')?.reason;
const FLOOD = { id: 77, kind: 'flood', targets: [{ side: 0, role: 'natural', index: 0 }] };

// Fake Drift: flood the side-0 Natural from tick 3 for 100 ticks.
function floodAt(s, from = 3, len = 100) {
  s.drift = {
    events: [],
    step: (t) => ({ announce: [], apply: t === from ? [FLOOD] : [], expire: t === from + len ? [FLOOD] : [] }),
    active: () => [],
  };
}
const naturalOf = (s) => s.territory.map.reaches.find((r) => r.role === 'natural' && r.side === 0);
const inside = (s, x, y) => s.territory.map.reachAt(x, y) === naturalOf(s).id;

test('flood: the Reach becomes water (impassable) for its length, then dries; real rocks stay', () => {
  const s = createTerritoryMatch(5);
  floodAt(s);
  const r = naturalOf(s);
  const spot = r.claimSpot || r.centre;
  const rocksBefore = s.rockSet.size;
  assert.equal(isPassable(s, spot.x, spot.y), true);
  run(s, 5);
  assert.equal(isPassable(s, spot.x, spot.y), false, 'water');
  assert.ok(s.rockSet.size > rocksBefore);
  run(s, 100);
  assert.equal(isPassable(s, spot.x, spot.y), true, 'dry again');
  assert.equal(s.rockSet.size, rocksBefore, 'only the flood tiles came out');
});

test('flood pushes units inside to the nearest dry tile and hurts them', () => {
  const s = createTerritoryMatch(5);
  floodAt(s);
  const r = naturalOf(s);
  const spot = r.claimSpot || r.centre;
  s.units.push({ id: 500, owner: 1, kind: 'grunt', x: spot.x, y: spot.y, hp: 60, carrying: 0, order: null });
  s.units.sort((a, b) => a.id - b.id);
  run(s, 5);
  const u = s.units.find((x) => x.id === 500);
  assert.equal(inside(s, u.x, u.y), false, 'moved out of the flooded Reach');
  assert.equal(u.hp, 60 - EFFECTS.floodDamage);
});

test('flood: swimmers (research) are pushed out but not hurt', () => {
  const s = createTerritoryMatch(5);
  floodAt(s);
  s.research.done[1].push('swimmers');
  s.factions[1] = 'coil';
  const spot = naturalOf(s).claimSpot || naturalOf(s).centre;
  s.units.push({ id: 501, owner: 1, kind: 'grunt', x: spot.x, y: spot.y, hp: 60, carrying: 0, order: null });
  s.units.sort((a, b) => a.id - b.id);
  run(s, 5);
  assert.equal(s.units.find((x) => x.id === 501).hp, 60);
});

test('flood: a claim in the flooded Reach stops holding, and holds again when it dries', () => {
  const s = createTerritoryMatch(5);
  const r = naturalOf(s);
  const spot = r.claimSpot || r.centre;
  s.claims.push({ id: 600, owner: 0, kind: 'totem', reach: r.id, x: spot.x, y: spot.y, hp: 300, progress: 480, complete: true, builder: null });
  run(s, 2);
  const before = holdCount(s, 0);
  floodAt(s, s.tick + 1, 50);
  run(s, 5);
  assert.equal(holdCount(s, 0), before - 1, 'flooded claim does not hold');
  run(s, 60);
  assert.equal(holdCount(s, 0), before);
});

// ---- Tunnels -------------------------------------------------------------------------------------------

function burrow() {
  const s = createTerritoryMatch(5);
  s.factions = ['coil', 'burrow'];
  s.holdOverride = () => 3;
  s.research.done[1].push('tunnels');
  const a = { id: 700, owner: 1, kind: 'mound', reach: 3, x: 26, y: 26, hp: 300, progress: 480, complete: true, builder: null };
  const b = { id: 701, owner: 1, kind: 'mound', reach: 4, x: 18, y: 28, hp: 300, progress: 480, complete: true, builder: null };
  s.claims.push(a, b);
  s.units.push({ id: 502, owner: 1, kind: 'grunt', x: 25, y: 26, hp: 60, carrying: 0, order: null });
  s.units.sort((x, y) => x.id - y.id);
  return { s, a, b };
}
const tunnel = (unit, from, to) => ({ type: 'tunnel', unit, from, to });

test('tunnel: a unit next to one Mound comes out at another after 3 s (72 ticks)', () => {
  const { s } = burrow();
  step(s, [[], [tunnel(502, 700, 701)]]);
  assert.equal(rejected(s), undefined);
  assert.equal(s.units.some((u) => u.id === 502), false, 'underground');
  run(s, 70);
  assert.equal(s.units.some((u) => u.id === 502), false, 'still underground');
  run(s, 4);
  const u = s.units.find((x) => x.id === 502);
  assert.ok(u, 'out');
  assert.ok(Math.max(Math.abs(u.x - 18), Math.abs(u.y - 28)) <= 3, 'next to the exit Mound');
});

test('tunnel rejections: wrong faction, not researched, too far, not a Mound, not yours', () => {
  let { s } = burrow();
  const rej = (cmd, p = 1) => { step(s, p === 1 ? [[], [cmd]] : [[cmd], []]); return rejected(s); };
  assert.equal(rej(tunnel(502, 700, 701), 0), 'not-yours');
  assert.equal(rej(tunnel(9999, 700, 701)), 'no-such-unit');
  assert.equal(rej(tunnel(502, 700, 999)), 'bad-target');
  assert.equal(rej(tunnel(502, 700, 700)), 'bad-target');
  s.units.find((u) => u.id === 502).x = 5;
  assert.equal(rej(tunnel(502, 700, 701)), 'too-far');
  ({ s } = burrow());
  s.research.done[1].length = 0;
  assert.equal(rej(tunnel(502, 700, 701)), 'not-researched');
  ({ s } = burrow());
  s.factions[1] = 'coil';
  assert.equal(rej(tunnel(502, 700, 701)), 'wrong-faction');
});

test('a tunnel that lost its Mound while the unit was underground drops it at the other end on arrival anyway', () => {
  const { s, a } = burrow();
  step(s, [[], [tunnel(502, 700, 701)]]);
  s.claims.splice(s.claims.indexOf(a), 1);
  run(s, 80);
  assert.ok(s.units.some((u) => u.id === 502));
});
