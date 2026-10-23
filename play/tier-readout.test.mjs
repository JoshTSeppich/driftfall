// The tier and Hold readout (TERRITORY.md section 5). Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tierStatus, renderTier, TIER_NEEDS } from './tier-readout.mjs';
import { STATS } from '../env/stats.mjs';

test('the needs come from STATS.tiers, which match TERRITORY.md section 5', () => {
  for (const t of [1, 2, 3]) assert.deepEqual(TIER_NEEDS[t].buildings, [...STATS.tiers[t].needs]);
  assert.equal(TIER_NEEDS[1].hold, 0);
  assert.equal(TIER_NEEDS[2].hold, 3);
  assert.deepEqual(TIER_NEEDS[2].buildings, ['foundry', 'sanctum']);
  assert.equal(TIER_NEEDS[3].hold, 6);
  assert.deepEqual(TIER_NEEDS[3].buildings, ['hangar']);
});

test('an all-of tier needs every listed building, an any-of tier one of them', () => {
  const needs = { 1: { hold: 0, buildings: [], anyOf: true }, 2: { hold: 0, buildings: ['a', 'b'], anyOf: false } };
  assert.equal(tierStatus({ holds: 0, builtKinds: ['a'], needs }).tier, 1, 'all-of: one of two is not enough');
  assert.equal(tierStatus({ holds: 0, builtKinds: ['a', 'b'], needs }).tier, 2);
  const any = { ...needs, 2: { hold: 0, buildings: ['a', 'b'], anyOf: true } };
  assert.equal(tierStatus({ holds: 0, builtKinds: ['b'], needs: any }).tier, 2);
});

test('start: tier 1, nothing paused, next tier shows its Hold and building', () => {
  const s = tierStatus({ holds: 1, builtKinds: [] });
  assert.equal(s.tier, 1);
  assert.deepEqual(s.paused, []);
  assert.equal(s.next.tier, 2);
  assert.equal(s.next.hold, 3);
  assert.equal(s.next.holdsLeft, 2);
});

test('a Foundry or Sanctum opens tier 2; a Hangar opens tier 3 (the building comes first)', () => {
  assert.equal(tierStatus({ holds: 3, builtKinds: ['foundry'] }).tier, 2);
  assert.equal(tierStatus({ holds: 3, builtKinds: ['sanctum'] }).tier, 2);
  const s = tierStatus({ holds: 4, builtKinds: ['foundry'] });
  assert.equal(s.tier, 2);
  assert.equal(s.next.tier, 3);
  assert.equal(s.next.holdsLeft, 2);
  assert.deepEqual(s.next.buildings, ['hangar']);
});

test('a tier whose building stands but whose Hold is short is paused, and says so', () => {
  const s = tierStatus({ holds: 4, builtKinds: ['foundry', 'hangar'] });
  assert.equal(s.tier, 3);
  assert.deepEqual(s.paused, [3]);
  const html = renderTier(s);
  assert.match(html, /class="amber"[^>]*>Tier 3 paused/);
  assert.match(html, /Hold 4 \/ 6/);
});

test('dropping below the Hold pauses tier 2 too', () => {
  const s = tierStatus({ holds: 2, builtKinds: ['foundry'] });
  assert.deepEqual(s.paused, [2]);
  assert.equal(s.tier, 2);
  assert.match(renderTier(s), /class="amber"[^>]*>Tier 2 paused/);
});

test('with tier 3 unlocked and Hold 5, only tier 3 is paused', () => {
  const s = tierStatus({ holds: 5, builtKinds: ['foundry', 'hangar'] });
  assert.deepEqual(s.paused, [3]);
});

test('at the top tier there is no next tier to show', () => {
  const s = tierStatus({ holds: 9, builtKinds: ['foundry', 'hangar'] });
  assert.equal(s.tier, 3);
  assert.equal(s.next, null);
  assert.doesNotMatch(renderTier(s), /paused/);
});

test('the rendered line has no undefined or NaN values', () => {
  assert.doesNotMatch(renderTier(tierStatus({})), /NaN|undefined/);
});
