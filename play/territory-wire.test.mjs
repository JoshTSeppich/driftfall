import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { territoryOptions, drawReachBorders, territoryPanel } from './territory-wire.mjs';

const fakeCtx = () => {
  const calls = [];
  return { calls, set strokeStyle(v) { calls.push(['stroke', v]); }, set lineWidth(v) {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { calls.push(['draw']); } };
};

test('territory is the default match; ?territory=0 gives the old classic match', () => {
  // Joshua 10-23 08:03: territory is the default (sonnet, wire-up); the classic match is ?territory=0.
  const on = territoryOptions(new URLSearchParams(''));
  assert.equal(on.on, true);
  assert.ok(on.createState(7).territory && on.createState(7).drift);
  assert.equal(territoryOptions(new URLSearchParams('territory=0')).on, false);
  assert.equal(territoryOptions(new URLSearchParams('territory=0')).createState, undefined);
});

test('Reach borders: one stroke per visible Reach', () => {
  const state = createTerritoryMatch(7);
  const ctx = fakeCtx();
  const n = drawReachBorders(ctx, state.territory, 0, 0, (x, y) => ({ sx: x, sy: y }));
  assert.equal(n, state.territory.map.reaches.length);
  assert.equal(ctx.calls.filter((c) => c[0] === 'draw').length, n);
  assert.equal(drawReachBorders(ctx, null, 0, 0, () => ({ sx: 0, sy: 0 })), 0);
});

test('panel html: tier and flow when territory is on, empty when off', () => {
  const state = createTerritoryMatch(7);
  const html = territoryPanel(state, 0);
  assert.match(html, /Tier 1/);
  assert.match(html, /Shards\/min/);
  assert.equal(territoryPanel({ ...state, territory: undefined }, 0), '');
});
