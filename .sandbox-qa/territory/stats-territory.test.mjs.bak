// stats-territory: the TERRITORY.md numbers live in env/stats.mjs (sections 3, 5, 6, 8 and 9).
// Owner: fable (territory accord lead). Additive on top of stats-table.test.mjs: nothing from v2 is re-checked here.
//
// The two faction upgrade tables in TERRITORY.md section 6 are parsed from the document itself, so a number edited in
// one place and not the other turns this file red. Everything else is checked by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  STATS, UNIT_KINDS, STRUCTURE_KINDS, UPGRADES, upgradeById, upkeepOf, secondsToTicks,
} from '../env/stats.mjs';

const TERRITORY = fs.readFileSync(new URL('../TERRITORY.md', import.meta.url), 'utf8');
const TPS = 24;

// Parses "| Sidewind | Grunt-role "Fang" +50% speed | 2 | 100/100 | 55 s |" rows that follow a faction heading.
function factionRows(heading) {
  const start = TERRITORY.indexOf(heading);
  assert.ok(start >= 0, `TERRITORY.md heading not found: ${heading}`);
  const rows = [];
  for (const line of TERRITORY.slice(start).split('\n').slice(1)) {
    if (!line.startsWith('|')) { if (rows.length) break; else continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5 || cells[0] === 'Upgrade' || /^-+$/.test(cells[0])) continue;
    const [shards, flux, alloy = '0'] = cells[3].split('/');
    rows.push({
      name: cells[0], effect: cells[1], tier: Number(cells[2]),
      cost: { shards: Number(shards), flux: Number(flux), alloy: Number(alloy) },
      seconds: Number(cells[4].replace(/\s*s$/, '')),
    });
  }
  assert.equal(rows.length, 6, `${heading}: expected 6 upgrade rows`);
  return rows;
}

const byName = (faction) => Object.fromEntries(UPGRADES.filter((u) => u.faction === faction).map((u) => [u.name, u]));

test('the v2 kind lists are untouched, so the current game keeps playing', () => {
  assert.deepEqual([...UNIT_KINDS].sort(), ['brute', 'grunt', 'lancer', 'worker']);
  assert.deepEqual([...STRUCTURE_KINDS].sort(), ['forge', 'turret']);
  assert.equal(STATS.match.unitCap, 40);
});

test('the clock is 24 ticks a second and secondsToTicks rounds to whole ticks', () => {
  assert.equal(STATS.clock.ticksPerSecond, TPS);
  assert.equal(secondsToTicks(20), 480);
  assert.equal(secondsToTicks(0.5), 12);
  assert.equal(secondsToTicks(1 / 24), 1);
});

test('section 3: claim, hold and the territory win', () => {
  const t = STATS.territory;
  assert.equal(t.reachCount, 21);
  assert.equal(t.claimCost, 100);
  assert.equal(t.claimSeconds, 20);
  assert.equal(t.claimTicks, 20 * TPS);
  assert.equal(t.holdSeconds, 10);
  assert.equal(t.holdTicks, 10 * TPS);
  assert.equal(t.holdMiningBonus, 0.25);
  assert.equal(t.winReaches, 14);
  assert.equal(t.winSeconds, 90);
  assert.equal(t.winTicks, 90 * TPS);
  assert.equal(t.claims.coil, 'totem');
  assert.equal(t.claims.burrow, 'mound');
  for (const kind of ['totem', 'mound']) {
    const c = t.claimStructures[kind];
    assert.ok(c, `claimStructures.${kind}`);
    assert.equal(c.cost, 100);
    assert.equal(c.flux, 0);
    assert.equal(c.buildSeconds, 20);
    assert.equal(c.buildTicks, 20 * TPS);
    assert.ok(c.hp > 0);
    assert.ok(!(kind in STATS.structures), `${kind} must not be buildable before the sim wires territory`);
  }
  assert.equal(t.claimStructures.totem.faction, 'coil');
  assert.equal(t.claimStructures.mound.faction, 'burrow');
});

test('section 4: the Drift numbers, and parity with env/drift.mjs where it exports them', async () => {
  const d = STATS.drift;
  assert.equal(d.announceSeconds, 30);
  assert.equal(d.announceTicks, 720);
  assert.equal(d.flood.seconds, 60);
  assert.equal(d.flood.damage, 10);
  assert.equal(d.flood.minHp, 1);
  assert.equal(d.squall.seconds, 45);
  assert.equal(d.squall.sight, 2);
  assert.equal(d.dryOut.keep, 1 / 3);
  assert.equal(d.fall.startSeconds, 840);
  assert.equal(d.fall.gapSeconds, 20);
  assert.deepEqual(d.schedule.map((e) => e.seconds / 60), [3, 5, 5, 7, 8, 9, 11, 13, 14]);
  assert.deepEqual(d.randomWeights, { 'dry-out': 3, bloom: 1, flood: 1, quake: 1, squall: 1 });
  const drift = await import('../env/drift.mjs');
  assert.equal(drift.ANNOUNCE_TICKS, d.announceTicks);
  assert.equal(drift.TICKS_PER_SECOND, STATS.clock.ticksPerSecond);
  const { events } = drift.createDrift(7);
  const fixed = events.filter((e) => e.kind !== 'fall' && e.tick % 60 === 0 && ![11 * 60, 13 * 60].includes(e.tick / TPS));
  assert.deepEqual(fixed.map((e) => e.tick / TPS / 60), [3, 5, 5, 7, 8, 9], 'the fixed clock matches section 4');
  const flood = events.find((e) => e.kind === 'flood');
  assert.equal(flood.expireTick - flood.tick, d.flood.ticks);
  const squall = events.find((e) => e.kind === 'squall');
  assert.equal(squall.expireTick - squall.tick, d.squall.ticks);
  const falls = events.filter((e) => e.kind === 'fall').map((e) => e.tick);
  assert.equal(falls[0], d.fall.startSeconds * TPS);
  assert.equal(falls[1] - falls[0], d.fall.gapTicks);
});

test('section 5: three tiers, each needing a building and land', () => {
  const tiers = STATS.tiers;
  assert.deepEqual(Object.keys(tiers), ['1', '2', '3']);
  assert.deepEqual(tiers[1].needs, []);
  assert.equal(tiers[1].hold, 0);
  assert.deepEqual(tiers[2].needs, ['foundry', 'sanctum']);
  assert.equal(tiers[2].needsAny, true);
  assert.equal(tiers[2].hold, 3);
  assert.deepEqual(tiers[3].needs, ['hangar']);
  assert.equal(tiers[3].hold, 6);
  assert.deepEqual(tiers[2].typicalSeconds, [210, 270]);
  assert.deepEqual(tiers[3].typicalSeconds, [480, 600]);
  for (const n of [1, 2, 3]) {
    assert.equal(tiers[n].upgradeLevel, n, `tier ${n} allows weapons/hide level ${n}`);
    assert.ok(Array.isArray(tiers[n].unlocks) && tiers[n].unlocks.length > 0);
  }
  for (const kind of ['worker', 'grunt', 'lancer', 'turret', 'siphon', 'forge', 'drill', 'depot', 'track']) {
    assert.ok(tiers[1].unlocks.includes(kind), `tier 1 unlocks ${kind}`);
  }
  for (const kind of ['brute', 'spiker', 'howler', 'dart', 'mender', 'shade', 'mast', 'press']) {
    assert.ok(tiers[2].unlocks.includes(kind), `tier 2 unlocks ${kind}`);
  }
  for (const kind of ['skiff', 'barge', 'seer', 'conduit']) {
    assert.ok(tiers[3].unlocks.includes(kind), `tier 3 unlocks ${kind}`);
  }
});

test('section 6: every upgrade has one id, a name, a faction, a tier, a cost and a time', () => {
  assert.ok(Object.isFrozen(UPGRADES));
  const ids = new Set();
  const names = new Set();
  for (const u of UPGRADES) {
    assert.ok(/^[a-z][a-zA-Z0-9]*$/.test(u.id), `id ${u.id}`);
    assert.ok(!ids.has(u.id), `duplicate id ${u.id}`);
    ids.add(u.id);
    const nameKey = `${u.faction}:${u.name}`;
    assert.ok(!names.has(nameKey), `duplicate name ${nameKey}`);
    names.add(nameKey);
    assert.ok(['shared', 'coil', 'burrow'].includes(u.faction), `${u.id}.faction`);
    assert.ok([1, 2, 3].includes(u.tier), `${u.id}.tier`);
    for (const r of ['shards', 'flux', 'alloy']) {
      assert.ok(Number.isInteger(u.cost[r]) && u.cost[r] >= 0, `${u.id}.cost.${r}`);
    }
    assert.ok(u.cost.shards > 0, `${u.id} costs Shards`);
    assert.ok(Number.isInteger(u.seconds) && u.seconds > 0, `${u.id}.seconds`);
    assert.equal(u.ticks, u.seconds * TPS, `${u.id}.ticks`);
    assert.equal(typeof u.effect, 'string');
    assert.equal(upgradeById(u.id), u);
  }
  assert.equal(upgradeById('nope'), null);
});

test('section 6: weapons and hide, ground and air, three levels each', () => {
  const want = [
    { shards: 100, flux: 100, alloy: 0, seconds: 60 },
    { shards: 175, flux: 175, alloy: 0, seconds: 75 },
    { shards: 250, flux: 250, alloy: 50, seconds: 90 },
  ];
  const hide = [
    { shards: 125, flux: 125, alloy: 0, seconds: 60 },
    { shards: 220, flux: 220, alloy: 0, seconds: 75 },
    { shards: 315, flux: 315, alloy: 50, seconds: 90 },
  ];
  for (const layer of ['ground', 'air']) {
    for (const [track, table] of [['weapons', want], ['hide', hide]]) {
      for (let level = 1; level <= 3; level++) {
        const id = `${track}${layer[0].toUpperCase()}${layer.slice(1)}${level}`;
        const u = upgradeById(id);
        assert.ok(u, id);
        assert.equal(u.faction, 'shared');
        assert.equal(u.track, track);
        assert.equal(u.layer, layer);
        assert.equal(u.level, level);
        assert.equal(u.tier, level, `${id}: level ${level} needs tier ${level}`);
        assert.deepEqual(u.cost, { shards: table[level - 1].shards, flux: table[level - 1].flux, alloy: table[level - 1].alloy }, id);
        assert.equal(u.seconds, table[level - 1].seconds, id);
        assert.equal(u.bonus, 1, `${id}: +1 per level`);
        if (level > 1) assert.equal(u.requires, `${track}${layer[0].toUpperCase()}${layer.slice(1)}${level - 1}`);
      }
    }
  }
});

test('section 6: land upgrades', () => {
  const sense = upgradeById('driftSense');
  assert.equal(sense.tier, 1);
  assert.deepEqual(sense.cost, { shards: 100, flux: 50, alloy: 0 });
  assert.equal(sense.seconds, 45);
  assert.equal(sense.warnSeconds, 60);
  const deep = upgradeById('deepClaim');
  assert.equal(deep.tier, 2);
  assert.deepEqual(deep.cost, { shards: 150, flux: 100, alloy: 0 });
  assert.equal(deep.seconds, 60);
  assert.equal(deep.claimBuildBonus, 0.4);
  assert.equal(deep.holdExtraSeconds, 10);
  const fast = upgradeById('holdFast');
  assert.equal(fast.tier, 2);
  assert.deepEqual(fast.cost, { shards: 150, flux: 150, alloy: 0 });
  assert.equal(fast.seconds, 75);
  assert.equal(fast.damage, 8);
  assert.equal(fast.range, 4);
});

test('section 6: mining upgrades', () => {
  for (let level = 1; level <= 3; level++) {
    const u = upgradeById(`drillSpeed${level}`);
    assert.ok(u, `drillSpeed${level}`);
    assert.equal(u.level, level);
    assert.equal(u.drillSpeedBonus, 0.25);
    assert.equal(u.tier, level === 3 ? 3 : 2);
    if (level > 1) assert.equal(u.requires, `drillSpeed${level - 1}`);
  }
  assert.deepEqual(upgradeById('drillSpeed1').cost, { shards: 100, flux: 50, alloy: 0 });
  assert.deepEqual(upgradeById('drillSpeed2').cost, { shards: 150, flux: 75, alloy: 0 });
  assert.deepEqual(upgradeById('drillSpeed3').cost, { shards: 200, flux: 100, alloy: 25 });
  assert.deepEqual([1, 2, 3].map((l) => upgradeById(`drillSpeed${l}`).seconds), [50, 60, 70]);
  const track = upgradeById('trackSpeed');
  assert.equal(track.tier, 2);
  assert.equal(track.loadsPerSecond, 2);
  assert.deepEqual(track.cost, { shards: 100, flux: 100, alloy: 0 });
  assert.equal(track.seconds, 60);
  const buffers = upgradeById('biggerBuffers');
  assert.equal(buffers.tier, 2);
  assert.equal(buffers.bufferBonus, 0.5);
  assert.deepEqual(buffers.cost, { shards: 100, flux: 50, alloy: 0 });
  assert.equal(buffers.seconds, 45);
  const twin = upgradeById('twinPress');
  assert.equal(twin.tier, 3);
  assert.equal(twin.alloyPerCycle, 2);
  assert.deepEqual(twin.cost, { shards: 200, flux: 100, alloy: 50 });
  assert.equal(twin.seconds, 75);
});

test('section 6: the Coil table in TERRITORY.md matches STATS.upgrades', () => {
  const have = byName('coil');
  for (const row of factionRows('**The Snakenators: serpents, cyan.**')) {
    const u = have[row.name];
    assert.ok(u, `Coil upgrade ${row.name} missing from STATS.upgrades`);
    assert.equal(u.tier, row.tier, `${row.name}.tier`);
    assert.deepEqual(u.cost, row.cost, `${row.name}.cost`);
    assert.equal(u.seconds, row.seconds, `${row.name}.seconds`);
  }
  assert.equal(Object.keys(have).length, 6);
});

test('section 6: the Burrow table in TERRITORY.md matches STATS.upgrades', () => {
  const have = byName('burrow');
  for (const row of factionRows('**The Burrow: wombats, amber.**')) {
    const u = have[row.name];
    assert.ok(u, `Burrow upgrade ${row.name} missing from STATS.upgrades`);
    assert.equal(u.tier, row.tier, `${row.name}.tier`);
    assert.deepEqual(u.cost, row.cost, `${row.name}.cost`);
    assert.equal(u.seconds, row.seconds, `${row.name}.seconds`);
  }
  assert.equal(Object.keys(have).length, 6);
});

test('section 6: faction upgrade effect numbers', () => {
  assert.equal(upgradeById('sidewind').speedBonus, 0.5);
  assert.equal(upgradeById('sidewind').unit, 'grunt');
  assert.equal(upgradeById('longStrike').rangeBonus, 2);
  assert.equal(upgradeById('longStrike').unit, 'lancer');
  assert.equal(upgradeById('swimmers').floodSpeed, 0.5);
  assert.equal(upgradeById('swimmers').floodDamage, 0);
  assert.equal(upgradeById('shedSkin').movesClaim, true);
  assert.equal(upgradeById('venom').slow, 0.5);
  assert.equal(upgradeById('venom').slowSeconds, 3);
  assert.equal(upgradeById('venom').unit, 'shade');
  assert.equal(upgradeById('constrict').holdSeconds, 4);
  assert.equal(upgradeById('constrict').unit, 'conduit');
  assert.equal(upgradeById('tunnels').travelSeconds, 3);
  assert.equal(upgradeById('tunnels').quakeCollapseSeconds, 30);
  assert.equal(upgradeById('thickHide').armorBonus, 2);
  assert.equal(upgradeById('thickHide').unit, 'brute');
  assert.equal(upgradeById('cubePress').bufferBonus, 0.25);
  assert.equal(upgradeById('bankUp').wallHp, 150);
  assert.equal(upgradeById('undermine').breakSeconds, 20);
  assert.equal(upgradeById('rumble').stunSeconds, 1);
  assert.equal(upgradeById('rumble').unit, 'howler');
  // Every tier-3 upgrade costs Alloy; nothing below tier 3 does, except nothing (section 5: Alloy pays for level 3).
  for (const u of UPGRADES) {
    if (u.tier === 3) assert.ok(u.cost.alloy > 0, `${u.id} is tier 3 and must cost Alloy`);
    else assert.equal(u.cost.alloy, 0, `${u.id} is below tier 3 and must not cost Alloy`);
  }
});

test('section 6: faction names named in TERRITORY.md', () => {
  const f = STATS.factions;
  assert.equal(f.coil.name, 'The Snakenators', 'Joshua renamed the serpents; the key stays coil');
  assert.equal(f.coil.adjective, 'Snakenator');
  assert.equal(f.coil.colour, 'cyan');
  assert.equal(f.coil.claim, 'totem');
  assert.equal(f.coil.track, 'coil');
  assert.equal(f.coil.roles.grunt, 'Fang');
  assert.equal(f.coil.roles.lancer, 'Spitter');
  assert.equal(f.coil.roles.shade, 'Adder');
  assert.equal(f.coil.roles.conduit, 'Charmer');
  assert.equal(f.burrow.name, 'The Burrow');
  assert.equal(f.burrow.colour, 'amber');
  assert.equal(f.burrow.claim, 'mound');
  assert.equal(f.burrow.track, 'run');
  assert.equal(f.burrow.roles.brute, 'Bulldozer');
  assert.equal(f.burrow.roles.howler, 'Thumper');
  assert.equal(f.burrow.buffer, 30);
  // Section 13: one race first, a Snakenator mirror; the Burrow is parked but its numbers stay.
  assert.deepEqual(f.sides, ['coil', 'coil']);
  assert.equal(f.burrow.parked, true);
  assert.notEqual(f.coil.parked, true);
  assert.ok(UPGRADES.filter((u) => u.faction === 'burrow').length === 6, 'Burrow upgrades stay in the table');
  assert.equal(f.coil.buffer, 20);
  assert.equal(f.coil.trackWaterSpeed, 0.5);
});

test('a Flux vent holds 600, as ENV-SPEC-v3-draft section 2 says', () => {
  assert.equal(STATS.vent.amount, 600);
});

test('section 8: mining stages from hand to Press', () => {
  const e = STATS.economy;
  assert.equal(e.hand.carry, 5);
  assert.equal(e.drill.cost, 100 - 25);
  assert.equal(e.drill.flux, 0);
  assert.equal(e.drill.buffer, 20);
  assert.equal(e.drill.shardsPerSecond, 2);
  assert.equal(e.drill.mineEveryTicks, 12);
  assert.equal(e.drill.mineEveryTicks * e.drill.shardsPerSecond, TPS, 'rate and interval agree');
  assert.equal(e.drill.tier, 1);
  assert.equal(e.drill.on, 'shard');
  assert.ok(e.drill.hp > 0 && e.drill.buildSeconds > 0);
  assert.equal(e.siphon.buffer, 20);
  assert.equal(e.siphon.fluxPerSecond, 2);
  assert.equal(e.siphon.mineEveryTicks, 12);
  assert.equal(e.depot.cost, 100);
  assert.equal(e.depot.tier, 1);
  assert.ok(e.depot.hp > 0 && e.depot.buildSeconds > 0);
  assert.equal(e.track.costPerTile, 5);
  assert.equal(e.track.loadSize, 5);
  assert.equal(e.track.loadsPerSecond, 1);
  assert.equal(e.track.passEveryTicks, TPS);
  assert.equal(e.track.unheldSpeed, 0.5);
  assert.equal(e.track.tier, 1);
  assert.equal(e.track.hold, 2);
  assert.equal(e.track.walkable, true);
  assert.ok(e.track.hp > 0 && e.track.buildSeconds > 0);
  assert.equal(e.press.cost, 200);
  assert.equal(e.press.flux, 100);
  assert.equal(e.press.tier, 2);
  assert.deepEqual(e.press.recipe, { shards: 2, flux: 1, alloy: 1, seconds: 2 });
  assert.ok(e.press.hp > 0 && e.press.buildSeconds > 0);
  assert.equal(e.holdMiningBonus, STATS.territory.holdMiningBonus);
  for (const kind of ['drill', 'depot', 'track', 'press']) {
    assert.ok(!(kind in STATS.structures), `${kind} must not be buildable before the sim wires the economy`);
    assert.equal(e[kind].buildTicks, e[kind].buildSeconds * TPS, `${kind}.buildTicks`);
  }
});

test('section 9: upkeep with no supply cap', () => {
  const u = STATS.upkeep;
  assert.equal(u.supplyCap, null);
  assert.equal(u.ratePerMinute, 0.1);
  assert.equal(u.drawEverySeconds, 1);
  assert.equal(u.drawEveryTicks, TPS);
  assert.deepEqual(u.exempt, ['worker']);
  assert.deepEqual(u.debtPauses, ['build', 'research']);
  assert.equal(u.deepDebt, -500);
  assert.equal(u.wearyAttackSpeed, -0.25);
  assert.equal(u.holdDiscount, 0.03);
  assert.equal(u.holdDiscountMax, 0.3);
  assert.equal(u.moundDiscount, 0.02);
  assert.equal(u.coilHeldDiscount, 0.2);
  assert.equal(u.discountMax, 0.6);
  assert.equal(u.trainDraw, 'gradual');
});

test('upkeepOf is 10% of a unit cost, both resources, Workers and structures free', () => {
  assert.deepEqual(upkeepOf({ cost: 150, flux: 0 }), { shards: 15, flux: 0 });
  assert.deepEqual(upkeepOf({ cost: 150, flux: 100 }), { shards: 15, flux: 10 });
  assert.deepEqual(upkeepOf('brute'), { shards: 15, flux: 0 });
  assert.deepEqual(upkeepOf('worker'), { shards: 0, flux: 0 });
  assert.deepEqual(upkeepOf('forge'), { shards: 0, flux: 0 });
  assert.deepEqual(upkeepOf('nope'), { shards: 0, flux: 0 });
});

// Parses the five-row resource table in section 12: "| **Glowmoss** | Grows in ... | Healing ... |".
function resourceRows() {
  const start = TERRITORY.indexOf('| Resource | Where it comes from |');
  assert.ok(start >= 0, 'TERRITORY.md resource table not found');
  const rows = [];
  for (const line of TERRITORY.slice(start).split('\n').slice(2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    rows.push({ name: cells[0].replace(/\*/g, ''), source: cells[1], use: cells[2] });
  }
  assert.equal(rows.length, 5, 'five rare resources');
  return rows;
}

test('section 12: every resource in TERRITORY.md is in STATS.resources, with the basics and Alloy', () => {
  const r = STATS.resources;
  assert.deepEqual(Object.keys(r), ['shards', 'flux', 'alloy', 'glowmoss', 'stormglass', 'quakestone', 'ironroot', 'amberlight']);
  assert.equal(r.shards.kind, 'basic');
  assert.equal(r.shards.currency, true);
  assert.equal(r.shards.tradable, false);
  assert.equal(r.flux.kind, 'basic');
  assert.equal(r.alloy.kind, 'refined');
  for (const row of resourceRows()) {
    const id = row.name.toLowerCase();
    assert.ok(r[id], `STATS.resources.${id}`);
    assert.equal(r[id].name, row.name);
    assert.equal(r[id].kind, 'rare');
    assert.equal(typeof r[id].source, 'string');
    assert.ok(r[id].yield > 0, `${id}.yield`);
    assert.ok(['flood', 'squall', 'quake', 'mesa', 'bloom'].includes(r[id].from), `${id}.from`);
  }
  for (const id of Object.keys(r)) {
    assert.ok(['basic', 'refined', 'rare'].includes(r[id].kind), `${id}.kind`);
    assert.equal(typeof r[id].name, 'string');
    if (r[id].tradable !== false) assert.ok(r[id].basePrice > 0, `${id}.basePrice`);
    if (r[id].tradable !== false) assert.ok(r[id].target > 0, `${id}.target`);
  }
  assert.equal(r.glowmoss.from, 'flood');
  assert.equal(r.glowmoss.growSeconds, 120);
  assert.equal(r.stormglass.from, 'squall');
  assert.equal(r.quakestone.from, 'quake');
  assert.equal(r.ironroot.from, 'mesa');
  assert.equal(r.ironroot.everySeconds, 10);
  assert.equal(r.amberlight.from, 'bloom');
  assert.equal(r.amberlight.start, 100);
  assert.deepEqual(r.glowmoss.preferredBy, 'coil');
  assert.deepEqual(r.stormglass.preferredBy, 'coil');
  assert.deepEqual(r.quakestone.preferredBy, 'burrow');
  assert.deepEqual(r.ironroot.preferredBy, 'burrow');
  assert.equal(r.amberlight.preferredBy, null);
  assert.equal(STATS.factions.coil.roles.mender, 'Shedder');
});

test('section 12: the Trading House and the price formula', () => {
  const m = STATS.market;
  assert.equal(m.house.cost, 150);
  assert.equal(m.house.flux, 0);
  assert.equal(m.house.tier, 1);
  assert.ok(m.house.hp > 0 && m.house.buildSeconds > 0);
  assert.equal(m.house.buildTicks, m.house.buildSeconds * TPS);
  assert.equal(m.house.perSide, 1);
  assert.equal(m.house.secondAtHold, 4);
  assert.ok(!('house' in STATS.structures) && !('tradinghouse' in STATS.structures));
  assert.equal(m.scarcityMin, 0.25);
  assert.equal(m.scarcityMax, 4);
  assert.equal(m.buySpread, 0.25);
  assert.equal(m.drainPerSecond, 0.02);
  assert.equal(m.ownSaleDip, 0.01);
  assert.equal(m.dipRecoverSeconds, 60);
  assert.equal(m.formula, 'base * clamp(sqrt(target / (held + market + 1)), min, max)');
  // The formula as written, on the table's numbers: nothing anywhere sells at 4x, a glut sells at a quarter.
  const price = (id, held, market) => {
    const r = STATS.resources[id];
    const s = Math.min(m.scarcityMax, Math.max(m.scarcityMin, Math.sqrt(r.target / (held + market + 1))));
    return r.basePrice * s;
  };
  assert.equal(price('ironroot', 0, 0), STATS.resources.ironroot.basePrice * 4);
  assert.equal(price('flux', 100000, 0), STATS.resources.flux.basePrice * 0.25);
  assert.ok(price('alloy', STATS.resources.alloy.target - 1, 0) === STATS.resources.alloy.basePrice, 'at target the price is base');
});

test('parity: env/effects.mjs defaults say the same as STATS.drift and the Tunnels upgrade', async () => {
  const { EFFECTS } = await import('../env/effects.mjs');
  assert.equal(EFFECTS.floodDamage, STATS.drift.flood.damage);
  assert.equal(EFFECTS.tunnelTicks, secondsToTicks(upgradeById('tunnels').travelSeconds));
});

test('parity: env/budget.mjs defaults say the same as STATS.upkeep', async () => {
  const { BUDGET } = await import('../env/budget.mjs');
  const u = STATS.upkeep;
  assert.equal(BUDGET.tps, STATS.clock.ticksPerSecond);
  assert.equal(BUDGET.upkeepPercentPerMinute / 100, u.ratePerMinute);
  assert.equal(BUDGET.holdReductionPercent / 100, u.holdDiscount);
  assert.equal(BUDGET.holdReductionMax / 100, u.holdDiscountMax);
  assert.equal(BUDGET.moundReductionPercent / 100, u.moundDiscount);
  assert.equal(BUDGET.totalReductionMax / 100, u.discountMax);
  assert.equal(BUDGET.coilInReachPercent / 100, u.coilHeldDiscount);
  assert.equal(BUDGET.wearyBelow, u.deepDebt);
  assert.equal(BUDGET.wearyAttackSpeedPercent / 100, 1 + u.wearyAttackSpeed);
});

test('parity: env/territory.mjs rules say the same as STATS.territory', async () => {
  const { TERRITORY_RULES } = await import('../env/territory.mjs');
  const t = STATS.territory;
  assert.equal(TERRITORY_RULES.holdTicks, t.holdTicks);
  assert.equal(TERRITORY_RULES.winCount, t.winReaches);
  assert.equal(TERRITORY_RULES.winTicks, t.winTicks);
  assert.deepEqual([...TERRITORY_RULES.claimKinds].sort(), Object.values(t.claims).sort());
  assert.deepEqual([...TERRITORY_RULES.nonCombat], STATS.upkeep.exempt);
});

test('kindStats resolves the territory-round structures without making them buildable', async () => {
  const { kindStats, RULE_STRUCTURE_KINDS, valueOf } = await import('../env/stats.mjs');
  assert.deepEqual([...RULE_STRUCTURE_KINDS].sort(), ['depot', 'drill', 'house', 'mound', 'press', 'totem']);
  for (const kind of RULE_STRUCTURE_KINDS) {
    const s = kindStats(kind);
    assert.ok(s, kind);
    assert.ok(s.cost > 0 && s.hp > 0 && s.buildTicks > 0, `${kind} has cost, hp and buildTicks`);
    assert.ok(!(kind in STATS.structures), `${kind} is not in STATS.structures`);
    assert.ok(!STRUCTURE_KINDS.includes(kind));
    // valueOf stays as the v2 rule: only STATS.structures kinds count toward a side's value until the spec says so.
    assert.equal(valueOf({ kind, complete: true }), 0);
  }
  assert.equal(kindStats('track'), null, 'Track tiles are not structures (they live in state.chain.tracks)');
  assert.equal(kindStats('nope'), null);
  assert.equal(kindStats('forge'), STATS.structures.forge);
});

test('the new tables are frozen like the rest of STATS', () => {
  for (const key of ['clock', 'territory', 'tiers', 'upgrades', 'factions', 'economy', 'upkeep', 'resources', 'market', 'vent']) {
    assert.ok(Object.isFrozen(STATS[key]), `STATS.${key} frozen`);
  }
  assert.equal(STATS.upgrades, UPGRADES);
});
