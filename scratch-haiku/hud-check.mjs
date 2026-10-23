import assert from 'node:assert/strict';
import { createTestState, createInitialState } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import * as hud from '../play/hud.mjs';
import * as cc from '../play/command-card.mjs';
import { createInput } from '../play/input.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };
const s = createInitialState(7);

ok('top bar shows shards, supply, clock', () => {
  const html = hud.renderTopBar(s, { side: 0, stats: STATS, tps: 24 });
  assert.match(html, /id="shards">\d+</);
  assert.match(html, /Supply <b id="supply">\d+\/40</);
  assert.match(html, /id="clock">0:00</);
  assert.doesNotMatch(html, /Space/);
});

ok('alert shows only while fresh, with Space hint', () => {
  const alert = { x: 1, y: 1, text: 'Under attack', tick: 0 };
  assert.match(hud.renderTopBar({ ...s, tick: 10 }, { side: 0, alert }), /Under attack \(Space\)/);
  assert.doesNotMatch(hud.renderTopBar({ ...s, tick: 1000 }, { side: 0, alert }), /Under attack/);
});

ok('supply goes warn at cap', () => {
  const units = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, owner: 0, kind: 'worker', x: 0, y: 0 }));
  const st = createTestState({ width: 32, height: 32, units, shards: [5, 5] });
  assert.match(hud.renderTopBar(st, { side: 0 }), /class="res warn"/);
});

ok('single unit: portrait, hp bar, status', () => {
  const st = createTestState({ width: 32, height: 32, units: [
    { id: 1, owner: 0, kind: 'grunt', x: 2, y: 2, hp: 29, carrying: 0 },
    { id: 2, owner: 0, kind: 'worker', x: 3, y: 3, hp: 40, carrying: 10 },
  ] });
  const g = hud.renderSelectionPanel(st, [st.units[0]], { side: 0 });
  assert.match(g, /<b>Grunt<\/b>/);
  assert.match(g, /29\/60 HP/);
  assert.match(g, /<svg class="portrait"/);
  assert.match(g, /Idle/);
  assert.match(g, /background:#f0c84a/, 'under half hp is amber');
  assert.match(hud.renderSelectionPanel(st, [st.units[1]], { side: 0 }), /Carrying 10 Shards/);
});

ok('enemy unit is tagged', () => {
  const st = createTestState({ width: 32, height: 32, units: [{ id: 1, owner: 1, kind: 'brute', x: 2, y: 2 }] });
  assert.match(hud.renderSelectionPanel(st, [st.units[0]], { side: 0 }), /\(enemy\)/);
});

ok('structure: building percent and training queue', () => {
  const st = createTestState({ width: 32, height: 32, structures: [
    { id: 5, owner: 0, kind: 'forge', x: 4, y: 4, complete: false, progress: 20 },
    { id: 6, owner: 0, kind: 'forge', x: 8, y: 4, complete: true, queue: ['grunt', 'lancer'] },
  ] });
  assert.match(hud.renderSelectionPanel(st, [st.structures[0]], { side: 0 }), /Building 50%/);
  const t = hud.renderSelectionPanel(st, [st.structures[1]], { side: 0 });
  assert.match(t, /Training Grunt \(\+1 queued\)/);
  assert.match(t, /class="on">Grunt/);
});

ok('multi-select: count, chips and pick buttons with ids', () => {
  const units = [{ id: 1, owner: 0, kind: 'grunt', x: 0, y: 0 }, { id: 2, owner: 0, kind: 'grunt', x: 0, y: 0 }, { id: 3, owner: 0, kind: 'worker', x: 0, y: 0 }];
  const st = createTestState({ width: 32, height: 32, units });
  const m = hud.renderSelectionPanel(st, st.units, { side: 0 });
  assert.match(m, /3 selected/);
  assert.match(m, /Grunt ×2/);
  assert.match(m, /data-pick="3"/);
});

ok('nothing selected hint', () => assert.match(hud.renderSelectionPanel(s, [], { side: 0 }), /Nothing selected/));

ok('grid: in-grid keys sit on their cell, loose keys fill free cells', () => {
  const card = [
    { key: 'a', label: 'Attack', action: 'amove' },
    { key: 's', label: 'Stop', action: 'stop' },
    { key: 'h', label: 'Hold', action: 'hold' },
    { key: 'm', label: 'Move', action: 'move' },
  ];
  const cells = cc.layoutCard(card);
  assert.equal(cells.length, 12);
  assert.equal(cells[4].entry.action, 'amove');
  assert.equal(cells[5].entry.action, 'stop');
  assert.equal(cells[0].entry.action, 'hold');
  assert.equal(cells[1].entry.action, 'move');
});

ok('worker build card: f on its cell, cost shown, poor when short', () => {
  const card = [
    { key: 'f', label: 'forge', kind: 'forge', action: 'build', cost: 150 },
    { key: 't', label: 'turret', kind: 'turret', action: 'build', cost: 100 },
  ];
  const html = cc.renderCard(card, { shards: 120 });
  assert.match(html, /data-key="f"/);
  assert.match(html, /class="cc poor" data-action="build" data-kind="forge"/);
  assert.match(html, /class="cc" data-action="build" data-kind="turret"/);
  assert.equal((html.match(/class="cc empty"/g) ?? []).length, 10);
  assert.match(html, /Build Forge: 150 Shards/);
});

ok('active mode highlights the button', () => {
  assert.match(cc.renderCard([{ key: 'a', label: 'Attack', action: 'amove' }], { shards: 0, mode: { type: 'amove' } }), /class="cc on"/);
  const b = [{ key: 'f', label: 'forge', kind: 'forge', action: 'build', cost: 150 }];
  assert.match(cc.renderCard(b, { shards: 999, mode: { type: 'place', kind: 'forge' } }), /class="cc on"/);
});

ok('signature changes when shards or mode change', () => {
  const card = [{ key: 'a', label: 'Attack', action: 'amove' }];
  assert.notEqual(cc.cardSignature(card, { shards: 1 }), cc.cardSignature(card, { shards: 2 }));
  assert.notEqual(cc.cardSignature(card, { mode: null }), cc.cardSignature(card, { mode: { type: 'amove' } }));
});

ok('works with input.commandCard() on a real selection', () => {
  const st = createTestState({ width: 32, height: 32, shards: [300, 0],
    units: [{ id: 1, owner: 0, kind: 'worker', x: 2, y: 2 }],
    structures: [{ id: 9, owner: 0, kind: 'core', x: 1, y: 1, complete: true }] });
  const input = createInput({ side: 0, stats: STATS });
  input.ui.selection = [1];
  const card = input.commandCard(st);
  const html = cc.renderCard(card, { shards: 300 });
  assert.equal((html.match(/<button/g) ?? []).length, card.length);
  console.log('   card keys:', card.map((c) => c.key).join(' '));
});

console.log(`${n} checks passed`);
