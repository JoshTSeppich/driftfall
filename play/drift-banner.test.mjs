// The Drift banner and countdown (TERRITORY.md section 4). Pure, uses env/drift.mjs schedules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrift, ANNOUNCE_TICKS } from '../env/drift.mjs';
import { driftBanner, activeCountdowns, describeTarget, driftMarkers, BANNER_TICKS, DRIFT_LABEL } from './drift-banner.mjs';

const TPS = 24;
const at = (m, s = 0) => (m * 60 + s) * TPS;
const drift = createDrift(7);
const byKind = (kind, tick) => drift.events.find((e) => e.kind === kind && e.tick === tick);

test('labels cover the five Drift kinds plus The Fall', () => {
  assert.deepEqual(Object.keys(DRIFT_LABEL).sort(), ['bloom', 'dry-out', 'flood', 'fall', 'quake', 'squall'].sort());
  assert.equal(DRIFT_LABEL.fall, 'The Fall');
});

test('nothing to show before the first announcement', () => {
  assert.equal(driftBanner(drift.events, 0, 0), null);
  assert.equal(driftBanner(drift.events, at(2, 29), 0), null);
});

test('the 3:00 Bloom is announced 30 s ahead with a whole-second countdown', () => {
  const announce = at(3) - ANNOUNCE_TICKS;
  const b = driftBanner(drift.events, announce, 0);
  assert.equal(b.phase, 'incoming');
  assert.equal(b.kind, 'bloom');
  assert.equal(b.secondsLeft, 30);
  assert.match(b.title, /^Bloom in 30 s: /);
  const later = driftBanner(drift.events, at(3) - 12 * TPS - 1, 0);
  assert.equal(later.secondsLeft, 13, 'rounds up so the banner never reads 0 early');
});

test('at the apply tick the banner switches to "now" and stays for BANNER_TICKS', () => {
  const b = driftBanner(drift.events, at(3), 0);
  assert.equal(b.phase, 'now');
  assert.equal(b.secondsLeft, null);
  assert.equal(driftBanner(drift.events, at(3) + BANNER_TICKS - 1, 0).phase, 'now');
  assert.equal(driftBanner(drift.events, at(3) + BANNER_TICKS, 0), null);
});

test('an incoming event outranks one that just landed', () => {
  // 5:00 Squall and Bloom are announced at 4:30. At 4:45 the Bloom at 3:00 has long landed; the 5:00 one is incoming.
  const b = driftBanner(drift.events, at(4, 45), 0);
  assert.equal(b.phase, 'incoming');
  assert.equal(b.tick, at(5));
});

test('describeTarget is relative to the viewer', () => {
  assert.equal(describeTarget({ side: 0, role: 'natural', index: 0 }, 0), 'your Natural');
  assert.equal(describeTarget({ side: 1, role: 'natural', index: 0 }, 0), 'their Natural');
  assert.equal(describeTarget({ side: 'centre', role: 'centre', index: 0 }, 0), 'the Centre');
  assert.equal(describeTarget({ side: 1, role: 'outer', index: 1 }, 0), 'their Outer Reach');
  assert.equal(describeTarget({ side: 0, role: 'rich', index: 0 }, 1), 'their Rich Reach');
});

test('activeCountdowns lists timed events in force with seconds left, not untimed Blooms or Quakes', () => {
  const flood = drift.events.find((e) => e.kind === 'flood');
  const mid = flood.tick + 10 * TPS;
  const list = activeCountdowns(drift.events, mid, 0);
  const f = list.find((x) => x.kind === 'flood');
  assert.ok(f, 'the Flood is counting down');
  assert.equal(f.secondsLeft, 50);
  assert.ok(!list.some((x) => x.kind === 'quake'));
  assert.equal(activeCountdowns(drift.events, flood.expireTick, 0).some((x) => x.id === flood.id), false);
});

test('driftMarkers pins announced and landed targeted events through locate(); skips untargeted ones', () => {
  const locate = (t) => ({ x: t.index * 10, y: 5 });
  const fall = drift.events.find((e) => e.kind === 'fall');
  const pins = driftMarkers(drift.events, fall.announceTick, locate);
  assert.ok(pins.some((p) => p.id === fall.id && p.kind === 'fall'));
  const squall = drift.events.find((e) => e.kind === 'squall' && e.tick === at(5));
  assert.equal(driftMarkers(drift.events, squall.announceTick, locate).some((p) => p.id === squall.id), false,
    'squalls have no target pin; the band is drawn separately');
  assert.ok(byKind('bloom', at(3)));
});
