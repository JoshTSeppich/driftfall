// viewer3d/palette.mjs: the shared look. Checks the guide values, kind lookups, materials and deterministic pulses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TEAM, NEUTRAL, WORLD, TERRAIN, FOG, LIGHTS, EMISSIVE, KIND_LOOK, ROSTER, PALETTE,
  teamColors, healthColor, hexToInt, lookFor, kindKey, pulse, makeMaterials, createPalette, tintMaterial,
} from '../viewer3d/palette.mjs';

test('team colours are exactly the ART-GUIDE values, strips are the light steps', () => {
  assert.equal(TEAM[0].name, 'Cobalt');
  assert.deepEqual([TEAM[0].base, TEAM[0].light, TEAM[0].dark, TEAM[0].deep], ['#3fa9ff', '#aee0ff', '#174e8f', '#0b2a4f']);
  assert.equal(TEAM[1].name, 'Ember');
  assert.deepEqual([TEAM[1].base, TEAM[1].light, TEAM[1].dark, TEAM[1].deep], ['#ff8a3d', '#ffd4ae', '#9a3f14', '#4f1f08']);
  for (const t of TEAM) {
    assert.equal(t.main, t.base, 'main and base are the same value');
    assert.equal(t.hex, hexToInt(t.base));
    assert.equal(t.strip, t.light, 'glow strip = light step');
    assert.match(t.glow, /^rgba\(/);
  }
  assert.equal(WORLD.shard, '#4ef2d8');
  assert.equal(WORLD.ground, '#0f1318');
  assert.equal(WORLD.rock, '#3a434f');
  assert.equal(WORLD.rockLight, '#5a6573');
  assert.equal(teamColors(0), TEAM[0]);
  assert.equal(teamColors(1), TEAM[1]);
  assert.equal(teamColors(7), NEUTRAL);
  assert.equal(teamColors(undefined), NEUTRAL);
});

test('terrain keys match what terrain.mjs spreads over its defaults', () => {
  for (const k of ['ground', 'groundHi', 'seam', 'rock', 'rockDark', 'crystal', 'crystalCore', 'crystalDead', 'crack', 'cliff', 'cliffLip', 'ramp', 'rampMark', 'vent', 'ventFloor', 'rubble', 'skyTop', 'skyMid', 'skyHorizon', 'fog', 'hemiSky', 'hemiGround']) {
    assert.ok(TERRAIN[k], `TERRAIN.${k}`);
    assert.doesNotThrow(() => new THREE.Color(TERRAIN[k]), `THREE.Color accepts TERRAIN.${k}`);
  }
  assert.equal(TERRAIN.crystal, WORLD.shard);
  assert.equal(TERRAIN.fog, FOG.color);
});

test('hexToInt handles #rrggbb, #rgb and rgba()', () => {
  assert.equal(hexToInt('#3fa9ff'), 0x3fa9ff);
  assert.equal(hexToInt('3fa9ff'), 0x3fa9ff);
  assert.equal(hexToInt('#fff'), 0xffffff);
  assert.equal(hexToInt('rgba(78,242,216,0.35)'), 0x4ef2d8);
  assert.throws(() => hexToInt('teal'));
});

test('healthColor thresholds follow the guide (green over 50%, yellow over 25%, red below)', () => {
  assert.equal(healthColor(1), '#63e07a');
  assert.equal(healthColor(0.51), '#63e07a');
  assert.equal(healthColor(0.5), '#f0c84a');
  assert.equal(healthColor(0.26), '#f0c84a');
  assert.equal(healthColor(0.25), '#ff5a5a');
  assert.equal(healthColor(0), '#ff5a5a');
});

test('every agreed roster kind and every alias has a look; unknown kinds fall back by category', () => {
  for (const k of [...ROSTER.units, ...ROSTER.structures, ...ROSTER.terrain]) {
    assert.ok(KIND_LOOK[k], `KIND_LOOK has ${k}`);
    const l = lookFor(k);
    assert.ok(l.size > 0 && l.height > 0 && typeof l.shape === 'string', `look for ${k}`);
  }
  assert.equal(lookFor('worker').category, 'unit');
  assert.equal(lookFor('core').category, 'structure');
  assert.equal(lookFor('crystal').category, 'terrain');
  // aliases: old working names and spelling variants map to the same look
  assert.equal(lookFor('skyspike'), lookFor('spiker'));
  assert.equal(lookFor('Rich_Shard'), lookFor('rich-crystal'));
  assert.equal(lookFor('sensorMast'), lookFor('sensor-mast'));
  assert.equal(lookFor('flakspire'), lookFor('flak-spire'));
  assert.equal(lookFor('debris'), lookFor('rubble'));
  // unknown
  assert.equal(lookFor('gizmo').category, 'unit');
  assert.equal(lookFor('gizmo', 'structure').category, 'structure');
  assert.equal(lookFor(undefined).category, 'unit');
  assert.equal(kindKey('Rich Shard'), 'rich-shard');
  assert.equal(kindKey('sensorMast'), 'sensor-mast');
  // air and ranged hints that vfx and units rely on
  assert.ok(lookFor('skiff').air && lookFor('barge').air && lookFor('seer').air);
  assert.ok(lookFor('lancer').ranged && lookFor('turret').ranged && lookFor('howler').ranged);
  assert.ok(!lookFor('grunt').air && !lookFor('grunt').ranged);
});

test('pulse is deterministic and stays in range', () => {
  assert.equal(pulse(3.25, 0.5, 0.9, 1.4), pulse(3.25, 0.5, 0.9, 1.4));
  for (let t = 0; t < 50; t += 0.37) {
    const v = pulse(t, 1 / 24, 0.9, 1.4);
    assert.ok(v >= 0.9 - 1e-9 && v <= 1.4 + 1e-9, `pulse ${v}`);
  }
  assert.notEqual(pulse(0, 1 / 24), pulse(6, 1 / 24));
});

test('makeMaterials builds one shared, named set per THREE and caches it', () => {
  const m1 = makeMaterials(THREE);
  const m2 = makeMaterials(THREE);
  assert.equal(m1, m2, 'cached');
  assert.equal(m1.team.length, 2);
  for (const side of [0, 1]) {
    const t = m1.team[side];
    for (const key of ['body', 'bodyDark', 'bodyLight', 'strip', 'trim', 'glass', 'laser', 'dust', 'site']) assert.ok(t[key]?.isMaterial, `team${side}.${key}`);
    assert.equal(t.body.color.getHexString(), TEAM[side].base.slice(1));
    assert.equal(t.strip.emissive.getHexString(), TEAM[side].strip.slice(1));
    assert.ok(t.strip.emissiveIntensity >= EMISSIVE.stripIdle);
    assert.equal(t.body.name, `df.team${side}.body`);
  }
  assert.equal(m1.forOwner(1), m1.team[1]);
  assert.equal(m1.forOwner(null), m1.neutral);
  for (const key of ['hull', 'hullLight', 'hullDark', 'dark', 'ground', 'rock', 'rockLight', 'rockDark', 'cliff', 'ramp', 'shard', 'shardEmpty', 'flux', 'rubble', 'scaffold', 'weld', 'heat', 'hit', 'selection', 'debris', 'smoke', 'star']) {
    assert.ok(m1[key]?.isMaterial, `materials.${key}`);
  }
  assert.equal(m1.shard.emissive.getHexString(), '4ef2d8');
  assert.equal(m1.hit.emissiveIntensity, EMISSIVE.hit);
  for (const k of ['good', 'warn', 'bad', 'back']) assert.ok(m1.health[k].isMaterial);
  const all = m1.all();
  assert.ok(all.length > 40, `found ${all.length} materials`);
  assert.ok(all.every((m) => m.name.startsWith('df.')), 'all named');
  const fresh = makeMaterials(THREE, { fresh: true });
  assert.notEqual(fresh, m1);
  fresh.dispose();
  assert.equal(makeMaterials(THREE), m1, 'disposing a fresh set does not drop the shared one');
});

test('createPalette(THREE) gives the ctx.palette shape and breathes emissives deterministically', () => {
  const p = createPalette(THREE);
  assert.equal(p.team, TEAM);
  assert.deepEqual(p.teams, ['#3fa9ff', '#ff8a3d']);
  assert.deepEqual(p.teamHex, [0x3fa9ff, 0xff8a3d]);
  assert.equal(p.shard, WORLD.shard);
  assert.equal(p.terrain, TERRAIN);
  assert.equal(p.fog, FOG);
  assert.equal(p.lights, LIGHTS);
  assert.ok(p.materials.shard.isMaterial);
  assert.equal(p.color('#3fa9ff').getHexString(), '3fa9ff');
  assert.equal(p.color('#3fa9ff'), p.color('#3fa9ff'), 'cached colour');
  p.update({ tick: 10, alpha: 0.5 }, 0.016);
  const a = p.materials.shard.emissiveIntensity;
  const s0 = p.materials.team[0].strip.emissiveIntensity;
  p.update({ tick: 400, alpha: 0.1 }, 0.016);
  p.update({ tick: 10, alpha: 0.5 }, 0.016);
  assert.equal(p.materials.shard.emissiveIntensity, a, 'same tick, same glow after scrubbing');
  assert.equal(p.materials.team[0].strip.emissiveIntensity, s0);
  assert.ok(a >= EMISSIVE.shardLow && a <= EMISSIVE.shard);
  assert.doesNotThrow(() => p.update(null, 0.016));
  assert.doesNotThrow(() => p.update({}, 0));
  // accepts a ctx too
  const p2 = createPalette({ THREE });
  assert.equal(p2.materials, p.materials);
});

test('the module works without three.js (colour data only)', () => {
  const p = createPalette(null);
  assert.equal(p.materials, null);
  assert.equal(p.team[1].name, 'Ember');
  assert.doesNotThrow(() => p.update({ tick: 1, alpha: 0 }, 0.016));
  assert.throws(() => p.color('#fff'));
  assert.equal(PALETTE.team, TEAM);
  assert.equal(PALETTE.terrain, TERRAIN);
});

test('tintMaterial recolours an existing material', () => {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000 });
  tintMaterial(m, '#ff8a3d', { emissive: '#ffd4ae', emissiveIntensity: 2 });
  assert.equal(m.color.getHexString(), 'ff8a3d');
  assert.equal(m.emissive.getHexString(), 'ffd4ae');
  assert.equal(m.emissiveIntensity, 2);
  assert.equal(tintMaterial(null, '#fff'), null);
});
