// Feel: which sounds play for a tick, and the small hit flash and camera shake (owner: haiku).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cuesForTick, priceCues, selectionChanged, createFeedback, SHAKE_TILES, FLASH_MS, SHAKE_MS, SHAKE_RANGE } from './feel.mjs';
import { makeLookup } from '../viewer3d/audio.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../assets/audio/MANIFEST.json', import.meta.url), 'utf8'));
const known = new Set(Object.keys(manifest.events));

const unit = (id, owner, x, y, kind = 'grunt') => ({ id, owner, kind, x, y, hp: 10 });
const snapOf = (...entities) => ({ tick: 0, units: entities.filter((e) => !e.structure), structures: entities.filter((e) => e.structure) });
const lookupOf = (...entities) => makeLookup(null, snapOf(...entities));
const focus = { x: 20, y: 20 };

test('every cue name the feel module can produce is in the sound manifest', () => {
  const events = [
    { e: 'hit', id: 1, by: 2 }, { e: 'die', id: 1 }, { e: 'done', id: 3 }, { e: 'spawn', structure: { id: 4, kind: 'drill', owner: 0, x: 20, y: 20 } },
    { e: 'drift-announce', id: 9, kind: 'flood', tick: 720 },
  ];
  const ents = [unit(1, 0, 20, 20), unit(2, 1, 21, 20, 'lancer'), { ...unit(3, 0, 20, 21, 'totem'), structure: true }];
  const cues = cuesForTick(events, lookupOf(...ents), 0, focus);
  for (const c of cues) assert.ok(known.has(c.name), `${c.name} missing from MANIFEST.json`);
  for (const name of ['drift_warning', 'price_up', 'price_down', 'unit_select', 'unit_move_ack']) assert.ok(known.has(name), name);
});

test('a hit on one of our units is heard; a hit on a far enemy unit is not', () => {
  const ents = [unit(1, 0, 20, 20), unit(2, 1, 90, 90)];
  const ours = cuesForTick([{ e: 'hit', id: 1, by: 2 }], lookupOf(...ents), 0, focus);
  const far = cuesForTick([{ e: 'hit', id: 2, by: 1 }], lookupOf(...ents), 0, focus);
  assert.equal(ours.length, 1);
  assert.equal(far.length, 0);
});

test('an enemy hit close to the camera is heard', () => {
  const ents = [unit(2, 1, 22, 20)];
  assert.equal(cuesForTick([{ e: 'hit', id: 2, by: 1 }], lookupOf(...ents), 0, focus).length, 1);
});

test('core under attack is an alert only for our own core', () => {
  const core = (owner) => ({ id: 5, owner, kind: 'core', x: 60, y: 60, hp: 900, structure: true });
  const ours = cuesForTick([{ e: 'hit', id: 5, by: 9 }], lookupOf(core(0), unit(9, 1, 61, 60)), 0, focus);
  const theirs = cuesForTick([{ e: 'hit', id: 5, by: 9 }], lookupOf(core(1), unit(9, 0, 61, 60)), 0, focus);
  assert.ok(ours.some((c) => c.name === 'alert_under_attack'));
  assert.ok(!theirs.some((c) => c.name === 'alert_under_attack'));
});

test('construction finished is heard for our buildings only', () => {
  const site = (owner) => ({ id: 8, owner, kind: 'depot', x: 20, y: 22, hp: 300, structure: true });
  assert.ok(cuesForTick([{ e: 'done', id: 8 }], lookupOf(site(0)), 0, focus).some((c) => c.name === 'building_finished'));
  assert.equal(cuesForTick([{ e: 'done', id: 8 }], lookupOf(site(1)), 0, focus).length, 0);
});

test('a Drift announcement plays the Drift warning', () => {
  const cues = cuesForTick([{ e: 'drift-announce', id: 9, kind: 'flood', tick: 720 }], lookupOf(), 0, focus);
  assert.deepEqual(cues.map((c) => c.name), ['drift_warning']);
});

test('price cues: a rise plays up, a fall plays down, a small wobble plays nothing', () => {
  assert.deepEqual(priceCues({ ironroot: 10 }, { ironroot: 11 }).map((c) => c.name), ['price_up']);
  assert.deepEqual(priceCues({ ironroot: 10 }, { ironroot: 9 }).map((c) => c.name), ['price_down']);
  assert.deepEqual(priceCues({ ironroot: 10 }, { ironroot: 10.1 }), []);
  assert.deepEqual(priceCues(null, { ironroot: 10 }), []);
});

test('selection sound only when the picked set really changes and is not empty', () => {
  assert.equal(selectionChanged('', ['3']), true);
  assert.equal(selectionChanged('3', ['3']), false);
  assert.equal(selectionChanged('3', []), false);
  assert.equal(selectionChanged('3', ['3', '4']), true);
});

test('a busy tick never plays more than two of one sound', () => {
  const ents = [];
  const events = [];
  for (let i = 1; i <= 12; i++) { ents.push(unit(i, 0, 20, 20 + (i % 3))); events.push({ e: 'hit', id: i, by: 99 }); }
  const played = [];
  const player = { play: (list) => { played.push(...list); return list.length; } };
  const feed = createFeedback({ player, side: 0 });
  feed.tick({ events, snap: snapOf(...ents), focus, now: 0 });
  assert.ok(played.filter((c) => c.name === 'melee_hit').length <= 2);
});

test('a hit makes a flash at the target, and it fades out after FLASH_MS', () => {
  const player = { play: () => 0 };
  const feed = createFeedback({ player, side: 0 });
  const ents = [unit(1, 0, 20, 20)];
  feed.tick({ events: [{ e: 'hit', id: 1, by: 2 }], snap: snapOf(...ents), focus, now: 1000 });
  const during = feed.flashes(1000 + FLASH_MS / 2);
  assert.equal(during.length, 1);
  assert.deepEqual([during[0].x, during[0].y], [20, 20]);
  assert.ok(during[0].age > 0.4 && during[0].age < 0.6);
  assert.equal(feed.flashes(1000 + FLASH_MS).length, 0);
});

test('a death makes a bigger flash than a hit', () => {
  const player = { play: () => 0 };
  const feed = createFeedback({ player, side: 0 });
  feed.tick({ events: [{ e: 'die', id: 1 }], snap: snapOf(unit(1, 0, 20, 20)), focus, now: 0 });
  assert.equal(feed.flashes(0)[0].big, true);
  const hitFeed = createFeedback({ player, side: 0 });
  hitFeed.tick({ events: [{ e: 'hit', id: 1, by: 2 }], snap: snapOf(unit(1, 0, 20, 20)), focus, now: 0 });
  assert.equal(hitFeed.flashes(0)[0].big, false);
});

test('camera shake: near the camera it moves the view a little, far away it does nothing', () => {
  const feed = createFeedback({ player: { play: () => 0 }, side: 0 });
  feed.tick({ events: [{ e: 'hit', id: 1, by: 2 }], snap: snapOf(unit(1, 0, focus.x + 1, focus.y)), focus, now: 0 });
  const s = feed.shake(10);
  assert.ok(Math.hypot(s.x, s.y) > 0, 'shakes near the camera');
  assert.ok(Math.abs(s.x) <= SHAKE_TILES && Math.abs(s.y) <= SHAKE_TILES, 'small');

  const far = createFeedback({ player: { play: () => 0 }, side: 0 });
  far.tick({ events: [{ e: 'hit', id: 1, by: 2 }], snap: snapOf(unit(1, 0, focus.x + SHAKE_RANGE + 5, focus.y)), focus, now: 0 });
  assert.deepEqual(far.shake(10), { x: 0, y: 0 });
});

test('camera shake settles to zero after SHAKE_MS and is the same every time (no random)', () => {
  const feed = createFeedback({ player: { play: () => 0 }, side: 0 });
  feed.tick({ events: [{ e: 'die', id: 1 }], snap: snapOf(unit(1, 0, focus.x, focus.y + 1)), focus, now: 0 });
  assert.deepEqual(feed.shake(SHAKE_MS + 1), { x: 0, y: 0 });
  assert.deepEqual(feed.shake(37), feed.shake(37));
});

test('a tick with no fight adds no flash, no shake, and sends only the acknowledgement', () => {
  const played = [];
  const feed = createFeedback({ player: { play: (list) => { played.push(...list); return list.length; } }, side: 0 });
  feed.tick({ events: [], snap: snapOf(), focus, now: 0, commands: [{ type: 'move', unit: 1, x: 3, y: 3 }] });
  assert.deepEqual(feed.flashes(0), []);
  assert.deepEqual(feed.shake(0), { x: 0, y: 0 });
  assert.deepEqual(played.map((c) => c.name), ['unit_move_ack']);
});
