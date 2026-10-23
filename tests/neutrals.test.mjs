// Neutral camps (TERRITORY.md section 14): camps per Reach, leash, claim block, bounty, drops, respawn, Drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState, distance } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import { buildReaches, createTerritory } from '../env/territory.mjs';
import { enableItems, effectiveRank } from '../env/items.mjs';
import {
  enableNeutrals, campOf, canClaim, stepNeutrals, damageCreature, creaturesOf, observeNeutrals, floodCamp, wakeCamp,
} from '../env/neutrals.mjs';

const R = (id, name, kind, side, x0, y0, x1, y1) => ({ id, name, kind, side, rect: [x0, y0, x1, y1], centre: { x: (x0 + x1) >> 1, y: (y0 + y1) >> 1 } });
const LAYOUT = {
  width: 64, height: 64,
  reaches: [
    R(0, 'Main A', 'main', 0, 0, 0, 16, 16), R(1, 'Main B', 'main', 1, 48, 48, 64, 64), R(2, 'Natural', 'natural', 0, 0, 20, 16, 36),
    R(3, 'Centre', 'centre', null, 24, 24, 40, 40), R(4, 'Vent', 'vent', 0, 20, 0, 36, 16), R(5, 'Mesa', 'mesa', 1, 40, 44, 56, 60),
  ],
};
function mk({ units = [], items = true, autoFight = false } = {}) {
  const state = createTestState({
    width: 64, height: 64, shards: [100, 100], seed: 7,
    structures: [{ id: 1, owner: 0, kind: 'core', x: 3, y: 3, hp: 1000 }, { id: 2, owner: 1, kind: 'core', x: 60, y: 60, hp: 1000 }],
    units,
  });
  createTerritory(state, buildReaches(LAYOUT));
  if (items) enableItems(state);
  enableNeutrals(state, { autoFight });
  return state;
}
const tickN = (s, n) => { for (let i = 0; i < n; i++) { s.tick++; stepNeutrals(s); } };
const kill = (s, camp, by = 0) => { for (const c of creaturesOf(s, camp.reach)) damageCreature(s, c.id, 99999, by); };

test('every Reach but a Main gets a camp, sized by its role', () => {
  const s = mk();
  assert.equal(campOf(s, 0), null);
  assert.equal(campOf(s, 1), null);
  assert.equal(campOf(s, 2).strength, 1);
  assert.equal(campOf(s, 3).strength, 3);
  assert.equal(campOf(s, 4).strength, 2);
  assert.equal(campOf(s, 5).strength, 2);
  for (const reach of [2, 3, 4, 5]) {
    const camp = campOf(s, reach);
    const cs = creaturesOf(s, reach);
    assert.equal(cs.length, STATS.neutrals.strengths[camp.strength].count);
    for (const c of cs) assert.equal(s.territory.map.reachAt(c.x, c.y), reach, 'creatures stand in their own Reach');
  }
  assert.equal(creaturesOf(s, 3)[0].name, 'Old Mossjaw');
});

test('a Reach cannot be claimed while its camp stands, and can once it is cleared', () => {
  const s = mk();
  assert.deepEqual(canClaim(s, 2), { ok: false, reason: 'camp' });
  assert.equal(canClaim(s, 0).ok, true, 'mains have no camp');
  kill(s, campOf(s, 2));
  assert.equal(canClaim(s, 2).ok, true);
});

test('creatures attack a unit that walks into their sight, but do not leave the leash', () => {
  const s = mk({ units: [{ id: 50, owner: 0, kind: 'brute', x: 8, y: 25 }] });
  const camp = campOf(s, 2);
  const u = s.units[0];
  u.x = camp.home.x + 3; u.y = camp.home.y;
  tickN(s, 40);
  assert.ok(u.hp < STATS.units.brute.hp, 'the brute was hit');
  const far = STATS.neutrals.strengths[1].leash;
  u.x = camp.home.x + far + 6; u.y = camp.home.y;
  tickN(s, 80);
  for (const c of creaturesOf(s, 2)) assert.ok(distance(c, camp.home) <= far, 'back inside the leash');
});

test('an out-of-reach unit is left alone and the camp heals while it waits', () => {
  const s = mk();
  const c = creaturesOf(s, 2)[0];
  c.hp = 10;
  tickN(s, 24 * 10);
  assert.ok(c.hp > 10);
  assert.ok(c.hp <= c.maxHp);
});

test('clearing a camp pays the bounty to the killer and drops an item where the camp stood', () => {
  const s = mk({ units: [{ id: 50, owner: 0, kind: 'grunt', x: 8, y: 25 }] });
  const camp = campOf(s, 4);
  const before = s.shards[0];
  const cs = creaturesOf(s, 4);
  damageCreature(s, cs[0].id, 99999, 0, 50);
  assert.equal(s.shards[0], before, 'not paid until the whole camp is down');
  damageCreature(s, cs[1].id, 99999, 0, 50);
  assert.equal(s.shards[0] - before, STATS.neutrals.strengths[2].bounty);
  assert.equal(camp.standing, false);
  assert.equal(s.items.pickups.length, 1);
  assert.ok(STATS.neutrals.dropPools.good.includes(s.items.pickups[0].item));
  assert.ok(s.events.some((e) => e.e === 'camp-cleared' && e.reach === 4 && e.player === 0));
  assert.equal(s.units[0].kills, 2, 'each creature killed counts toward the killer rank');
});

test('stronger camps drop from better pools and the centre also pays a rare bounty line', () => {
  const s = mk();
  kill(s, campOf(s, 3), 1);
  assert.ok(STATS.neutrals.dropPools.rare.includes(s.items.pickups[0].item));
  const ev = s.events.find((e) => e.e === 'camp-cleared');
  assert.equal(ev.bounty, STATS.neutrals.strengths[3].bounty);
  assert.deepEqual(ev.rare, STATS.neutrals.rareBounty[3]);
});

test('without the items module a cleared camp still pays and clears', () => {
  const s = mk({ items: false });
  kill(s, campOf(s, 2));
  assert.equal(campOf(s, 2).standing, false);
});

test('an unheld cleared camp goes wild again after 4 minutes; a held Reach does not', () => {
  const s = mk();
  kill(s, campOf(s, 2));
  s.territory.reaches[2].claimedBy = 0;
  tickN(s, STATS.neutrals.respawnTicks + 10);
  assert.equal(campOf(s, 2).standing, false, 'held land stays calm');
  s.territory.reaches[2].claimedBy = null;
  tickN(s, STATS.neutrals.respawnTicks - 5);
  assert.equal(campOf(s, 2).standing, false);
  tickN(s, 10);
  assert.equal(campOf(s, 2).standing, true);
  const cs = creaturesOf(s, 2);
  assert.equal(cs.length, STATS.neutrals.strengths[1].count);
  assert.ok(cs.every((c) => c.hp === c.maxHp));
  assert.equal(canClaim(s, 2).ok, false);
});

test('autoFight: a squad of grunts clears the smallest camp and takes the bounty', () => {
  const home = LAYOUT.reaches[2].centre;
  const units = Array.from({ length: 6 }, (_, i) => ({ id: 60 + i, owner: 0, kind: 'grunt', x: home.x - 1 + (i % 3), y: home.y + 1 + (i >> 1) }));
  const s = mk({ units, autoFight: true });
  tickN(s, 24 * 20);
  assert.equal(campOf(s, 2).standing, false);
  assert.ok(s.shards[0] >= 100 + STATS.neutrals.strengths[1].bounty);
  assert.ok(s.units.filter((u) => u.kills > 0).length >= 1);
  assert.ok(s.units.some((u) => effectiveRank(u) >= 0));
});

test('a Flood drives a camp to higher ground and it returns when the water goes', () => {
  const s = mk();
  const camp = campOf(s, 2);
  const home = { ...camp.home };
  floodCamp(s, 2, true, { x: home.x + 4, y: home.y - 4 });
  assert.deepEqual(camp.home, { x: home.x + 4, y: home.y - 4 });
  tickN(s, 60);
  for (const c of creaturesOf(s, 2)) assert.ok(distance(c, camp.home) <= 3, 'moved up');
  floodCamp(s, 2, false);
  assert.deepEqual(camp.home, home);
});

test('a Bloom wakes a new camp next to the new field, and it blocks claiming there', () => {
  const s = mk();
  kill(s, campOf(s, 2));
  const extra = wakeCamp(s, 2, { x: 10, y: 30 });
  assert.ok(extra);
  assert.equal(extra.strength, 1);
  assert.equal(extra.extra, true);
  assert.equal(canClaim(s, 2).ok, false);
  assert.equal(creaturesOf(s, 2).length, STATS.neutrals.strengths[1].count);
});

test('observeNeutrals gives pips and standing for the minimap', () => {
  const s = mk();
  const o = observeNeutrals(s);
  const c = o.find((x) => x.reach === 3);
  assert.equal(c.pips, 3);
  assert.equal(c.standing, true);
  assert.equal(o.find((x) => x.reach === 0), undefined);
});

test('the same seed always builds and plays the same camps', () => {
  const run = () => {
    const s = mk({ units: [{ id: 50, owner: 0, kind: 'grunt', x: 8, y: 26 }] });
    tickN(s, 200);
    return JSON.stringify([s.neutrals, s.units, s.events]);
  };
  assert.equal(run(), run());
});
