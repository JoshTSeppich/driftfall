// Items, ranks and Recall on the live page (TERRITORY s14). Pure HTML helpers, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, itemInfo, slotsHtml, rankStars, recallEntries, SLOT_COUNT } from './items-ui.mjs';
import { renderSelectionPanel } from './hud.mjs';
import { layoutCard } from './command-card.mjs';

const ITEM_IDS = ['fang-polish', 'scale-plating', 'crystal-monocle', 'rattle-bell', 'molting-charm',
  'glowmoss-pouch', 'stormglass-shard', 'ironroot-brace', 'amberlight-tooth'];

test('the nine item ids from TERRITORY s14 each have a name and one plain sentence', () => {
  assert.deepEqual(Object.keys(ITEMS).sort(), [...ITEM_IDS].sort());
  for (const id of ITEM_IDS) {
    assert.ok(ITEMS[id].name.length > 0, `${id} has a name`);
    assert.ok(ITEMS[id].text.length > 10 && !/\n/.test(ITEMS[id].text), `${id} has one sentence`);
  }
});

test('an unknown item still shows as something readable, never a crash', () => {
  assert.equal(itemInfo('no-such-item').name, 'no-such-item');
  assert.match(itemInfo('no-such-item').text, /unknown/i);
});

test('each unit has two item slots', () => {
  assert.equal(SLOT_COUNT, 2);
  const html = slotsHtml({ items: [] });
  assert.equal((html.match(/class="slot/g) ?? []).length, 2);
});

test('a carried item fills its slot, with its name in the tooltip', () => {
  const html = slotsHtml({ items: ['fang-polish'] });
  assert.match(html, /data-slot="0"[^>]*data-item="fang-polish"/);
  assert.match(html, /title="Fang Polish:/);
  assert.match(html, /class="slot empty" data-slot="1"/);
});

test('an empty slot says how to get an item, and the html has no raw ids from user data', () => {
  const html = slotsHtml({ items: ['<img onerror=x>'] });
  assert.ok(!html.includes('<img onerror'));
  assert.match(slotsHtml({ items: [] }), /Empty slot/);
});

test('rank shows as stars: none at rank 0, one to three stars at rank 1..3', () => {
  assert.equal(rankStars(0), '');
  assert.equal(rankStars(undefined), '');
  assert.equal((rankStars(1).match(/★/g) ?? []).length, 1);
  assert.equal((rankStars(3).match(/★/g) ?? []).length, 3);
  assert.equal((rankStars(9).match(/★/g) ?? []).length, 3);
});

test('the selection panel shows slots and rank stars for one unit', () => {
  const snap = { tick: 0, shards: [0, 0], units: [], structures: [] };
  const unit = { id: 5, kind: 'grunt', owner: 0, x: 1, y: 1, hp: 40, carrying: 0, rank: 2, items: ['scale-plating'] };
  const html = renderSelectionPanel(snap, [unit], { side: 0 });
  assert.equal((html.match(/class="slot/g) ?? []).length, 2);
  assert.match(html, /★★/);
});

test('a selection panel without items or rank still renders (empty slots, no stars)', () => {
  const snap = { tick: 0, shards: [0, 0], units: [], structures: [] };
  const unit = { id: 6, kind: 'worker', owner: 0, x: 1, y: 1, hp: 20, carrying: 0 };
  const html = renderSelectionPanel(snap, [unit], { side: 0 });
  assert.equal((html.match(/class="slot empty"/g) ?? []).length, 2);
  assert.ok(!html.includes('★'));
});

test('Recall is absent unless one of my Shed Skins waits at the Nest', () => {
  assert.deepEqual(recallEntries({}, 0), []);
  assert.deepEqual(recallEntries({ shedSkins: [] }, 0), []);
  assert.deepEqual(recallEntries({ shedSkins: [{ id: 3, kind: 'grunt', owner: 1, cost: 40 }] }, 0), []);
});

test('Recall lists each waiting Shed Skin at half its price, up to three buttons', () => {
  const state = { shedSkins: [
    { id: 3, kind: 'grunt', owner: 0, cost: 50, rank: 2 },
    { id: 4, kind: 'lancer', owner: 0, cost: 100, rank: 0 },
    { id: 5, kind: 'brute', owner: 0, cost: 150, rank: 1 },
    { id: 6, kind: 'worker', owner: 0, cost: 30, rank: 0 },
  ] };
  const entries = recallEntries(state, 0);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].action, 'recall');
  assert.equal(entries[0].shed, 3);
  assert.equal(entries[0].cost, 25);
  assert.match(entries[0].tooltip ?? entries[0].label, /Recall/);
});

test('Recall buttons land on free grid cells with their own hotkeys', () => {
  const card = recallEntries({ shedSkins: [{ id: 3, kind: 'grunt', owner: 0, cost: 50, rank: 1 }] }, 0);
  const cells = layoutCard(card).filter(Boolean);
  assert.equal(cells.length, 1);
  assert.ok(['x', 'c', 'v'].includes(cells[0].key));
});
