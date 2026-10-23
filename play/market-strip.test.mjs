import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { step } from '../env/sim.mjs';
import { marketStrip } from './market-strip.mjs';

test('a territory match has a market that ticks, and the strip lists every tradable price', () => {
  const state = createTerritoryMatch(7);
  assert.ok(state.market, 'market is on in territory matches');
  for (let i = 0; i < 24 * 3; i++) step(state, [[], []]);
  assert.ok(state.market.history[0].flux.length >= 2, 'history sampled once a second');
  const html = marketStrip(state, 0);
  assert.match(html, /Trading House/);
  assert.match(html, /flux/i);
  assert.match(html, /Build a Trading House/); // no house yet: prices are shown but trading is locked
});

test('no market, no strip', () => {
  assert.equal(marketStrip({ structures: [] }, 0), '');
});
