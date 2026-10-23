import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step } from '../env/sim.mjs';
import { observe } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import { createInput, assignHotkeys, boxEntities, pickEntity } from './input.mjs';

const project = (x, y) => ({ sx: x * 10, sy: y * 10 });
const ALL = { x0: 0, y0: 0, x1: 9999, y1: 9999 };
function setup() {
  const state = createMatch(7);
  const input = createInput({ side: 0, stats: STATS });
  const run = (n) => { for (let i = 0; i < n; i++) { const o = observe(state, 0); step(state, [input.tick(o), []]); } };
  return { state, input, run, obs: () => observe(state, 0) };
}

test('hotkeys come from kind names and skip reserved keys', () => {
  assert.deepEqual(assignHotkeys(['forge', 'turret']), { forge: 'f', turret: 't' });
  assert.equal(assignHotkeys(['strider']).strider, 't'); // s is reserved
});

test('box select picks own units and caps at 12', () => {
  const { obs, input } = setup();
  const o = obs();
  const mine = o.units.filter((u) => u.owner === 0);
  assert.equal(boxEntities(o, project, ALL, 0).length, mine.length);
  input.boxSelect(o, project, ALL);
  assert.deepEqual([...input.ui.selection].sort(), mine.map((u) => u.id).sort());
  const many = { ...o, units: Array.from({ length: 30 }, (_, i) => ({ id: i, owner: 0, x: 1, y: 1 })) };
  assert.equal(boxEntities(many, project, ALL, 0).length, 12);
});

test('pickEntity finds the unit under the cursor', () => {
  const { obs } = setup();
  const o = obs(); const u = o.units[0];
  const p = project(u.x, u.y);
  assert.equal(pickEntity(o, project, p.sx + 3, p.sy + 2)?.id, u.id);
  assert.equal(pickEntity(o, project, -500, -500), null);
});

test('right click on a Shard sends workers mining; on ground spreads a move', () => {
  const { obs, input, run } = setup();
  const o = obs();
  const ws = o.units.filter((u) => u.owner === 0);
  input.boxSelect(o, project, ALL);
  const c = o.crystals[0];
  assert.equal(input.rightClick(o, { x: c.x, y: c.y }).kind, 'gather');
  run(2);
  assert.ok(obs().units.filter((u) => u.owner === 0).every((u) => u.order && u.order.type === 'gather'));
  input.rightClick(obs(), { x: 12, y: 12 });
  run(1);
  const tiles = new Set(obs().units.filter((u) => u.owner === 0).map((u) => u.order && `${u.order.x},${u.order.y}`));
  assert.equal(tiles.size, ws.length, 'each worker gets its own tile');
});

test('place a forge, a worker builds it, then train a grunt from the card', () => {
  const { obs, input, run, state } = setup();
  state.shards[0] = 500;
  let o = obs();
  input.boxSelect(o, project, ALL);
  assert.ok(input.commandCard(o).some((c) => c.key === 'f' && c.action === 'build'));
  input.key(o, 'f');
  assert.deepEqual(input.ui.mode, { type: 'place', kind: 'forge' });
  const core = o.structures.find((s) => s.owner === 0 && s.kind === 'core');
  assert.equal(input.placeCheck(o, 'forge', core.x, core.y).ok, false);
  let spot = null;
  for (let dx = -4; dx <= 4 && !spot; dx++) for (let dy = -4; dy <= 4 && !spot; dy++) {
    if (input.placeCheck(o, 'forge', core.x + dx, core.y + dy).ok) spot = { x: core.x + dx, y: core.y + dy };
  }
  assert.ok(spot);
  input.modeClick(o, spot);
  assert.equal(input.ui.mode, null);
  run(80);
  o = obs();
  const forge = o.structures.find((s) => s.owner === 0 && s.kind === 'forge');
  assert.ok(forge?.complete, 'forge built');
  input.ui.selection = [forge.id];
  const card = input.commandCard(o);
  assert.ok(card.some((c) => c.action === 'train' && c.kind === 'grunt'));
  input.key(o, card.find((c) => c.kind === 'grunt').key);
  run(40);
  assert.ok(obs().units.some((u) => u.owner === 0 && u.kind === 'grunt'), 'grunt trained');
});

test('attack-move walks, the shift queue follows, control groups recall', () => {
  const { obs, input, run } = setup();
  let o = obs();
  const w = o.units.find((u) => u.owner === 0);
  input.ui.selection = [w.id];
  input.act(o, 'amove');
  input.modeClick(o, { x: w.x + 3, y: w.y });
  input.rightClick(o, { x: w.x + 3, y: w.y + 3 }, { shift: true });
  run(40);
  o = obs();
  const u = o.units.find((x) => x.id === w.id);
  assert.ok(u.y >= w.y + 2, `queued move ran (at ${u.x},${u.y})`);
  input.setGroup('2', o);
  input.ui.selection = [];
  assert.equal(input.key(o, '2', { now: 1000 }), null);
  assert.deepEqual(input.ui.selection, [w.id]);
  assert.ok(input.key(o, '2', { now: 1200 }).center);
});

test('hold position sets hold; stop clears it', () => {
  const { obs, input, run } = setup();
  const o = obs();
  const w = o.units.find((u) => u.owner === 0);
  input.ui.selection = [w.id];
  input.key(o, 'h');
  run(2);
  assert.equal(input.ui.plans.get(w.id).hold, true);
  input.key(obs(), 's');
  assert.equal(input.ui.plans.get(w.id).hold, false);
});
