import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { territoryOptions, drawReachBorders, territoryPanel } from './territory-wire.mjs';

const fakeCtx = () => {
  const calls = [];
  return { calls, set strokeStyle(v) { calls.push(['stroke', v]); }, set lineWidth(v) {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { calls.push(['draw']); } };
};

test('territory is off unless ?territory=1, so the plain game stays as it was', () => {
  assert.equal(territoryOptions(new URLSearchParams('')).on, false);
  assert.equal(territoryOptions(new URLSearchParams('')).createState, undefined);
  const t = territoryOptions(new URLSearchParams('territory=1'));
  assert.equal(t.on, true);
  const s = t.createState(7);
  assert.ok(s.territory && s.drift);
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
