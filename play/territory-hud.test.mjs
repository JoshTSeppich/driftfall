import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../env/sim.mjs';
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { territoryHud } from './territory-hud.mjs';

test('plain match has no territory HUD: current game untouched', () => {
  assert.equal(territoryHud(createMatch(7), 0), null);
});

test('territory match gives views, tier, Hold, flow and a Drift banner', () => {
  const s = createTerritoryMatch(7);
  const early = territoryHud(s, 0);
  assert.ok(early.views.length >= 5);
  assert.match(early.html, /Tier 1/);
  assert.match(early.html, /Shards\/min/);
  assert.doesNotMatch(early.html, /class="drift/);
  const ev = s.drift.events[0];
  s.tick = ev.announceTick + 24;
  const warn = territoryHud(s, 0);
  assert.match(warn.html, /class="drift incoming"/);
  assert.match(warn.html, /in 30 s|in 29 s/);
});

test('debt shows as Debt in the flow panel', () => {
  const s = createTerritoryMatch(7);
  s.shards[0] = -40;
  assert.match(territoryHud(s, 0).html, /Debt -40/);
});
