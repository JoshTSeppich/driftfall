// The research card: upgrade cells with cost, time and why each one is locked or poor (TERRITORY.md section 6). Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { researchState, researchFor, renderResearchCard } from './research-card.mjs';

const UP = [
  { id: 'weapons-1', name: 'Weapons 1', faction: 'shared', tier: 1, cost: { shards: 100, flux: 100 }, seconds: 60, effect: '+1 damage per hit' },
  { id: 'sidewind', name: 'Sidewind', faction: 'coil', tier: 2, cost: { shards: 100, flux: 100 }, seconds: 55, effect: 'Fang +50% speed' },
  { id: 'tunnels', name: 'Tunnels', faction: 'burrow', tier: 2, cost: { shards: 150, flux: 100 }, seconds: 60, effect: 'Mound to Mound' },
  { id: 'venom', name: 'Venom', faction: 'coil', tier: 3, cost: { shards: 200, flux: 200, alloy: 50 }, seconds: 80, effect: 'slow 50%' },
];

test('researchFor keeps the shared upgrades and the chosen faction only', () => {
  assert.deepEqual(researchFor(UP, 'coil').map((u) => u.id), ['weapons-1', 'sidewind', 'venom']);
  assert.deepEqual(researchFor(UP, 'burrow').map((u) => u.id), ['weapons-1', 'tunnels']);
});

test('a level that requires the one below stays locked until that one is done', () => {
  const L2 = { id: 'weaponsGround2', name: 'Ground Weapons 2', tier: 2, cost: { shards: 175, flux: 175 }, seconds: 75, requires: 'weaponsGround1' };
  const rich = { tier: 2, shards: 999, flux: 999, done: [] };
  assert.equal(researchState(L2, rich), 'locked', 'Weapons 1 not done');
  assert.equal(researchState(L2, { ...rich, done: ['weaponsGround1'] }), 'ready');
  assert.equal(researchState(L2, { ...rich, done: [], busy: 'weaponsGround2' }), 'busy', 'busy still shows while in progress');
});

test('state: done, busy, locked by tier, poor, or ready, in that order', () => {
  const ctx = { tier: 1, shards: 500, flux: 500, alloy: 0, done: ['weapons-1'], busy: null };
  assert.equal(researchState(UP[0], ctx), 'done');
  assert.equal(researchState(UP[1], { ...ctx, busy: 'sidewind' }), 'busy');
  assert.equal(researchState(UP[1], ctx), 'locked', 'tier 2 is not open at tier 1');
  assert.equal(researchState(UP[1], { ...ctx, tier: 2 }), 'ready');
  assert.equal(researchState(UP[1], { ...ctx, tier: 2, shards: 99 }), 'poor');
  assert.equal(researchState(UP[3], { ...ctx, tier: 3, alloy: 49 }), 'poor', 'Alloy counts too');
  assert.equal(researchState(UP[3], { ...ctx, tier: 3, alloy: 50 }), 'ready');
});

test('card cells carry the state class, the id, cost, time and effect tooltip', () => {
  const html = renderResearchCard(researchFor(UP, 'coil'), { tier: 2, shards: 120, flux: 120, done: ['weapons-1'] });
  assert.match(html, /class="rs done"[^>]*data-research="weapons-1"/);
  assert.match(html, /class="rs ready"[^>]*data-research="sidewind"/);
  assert.match(html, /class="rs locked"[^>]*data-research="venom"/);
  assert.match(html, /Sidewind/);
  assert.match(html, /100\/100 · 55 s/);
  assert.match(html, /title="Fang \+50% speed"/);
});

test('an Alloy cost shows with an A, and the card escapes its text', () => {
  const html = renderResearchCard([{ ...UP[3], name: '<b>x</b>' }], { tier: 3, shards: 999, flux: 999, alloy: 99 });
  assert.match(html, /200\/200\/50A/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test('an empty list renders an empty card, not a crash', () => {
  assert.equal(renderResearchCard([], {}), '');
});
