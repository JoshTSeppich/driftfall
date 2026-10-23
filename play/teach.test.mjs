// In-game teaching: button text, idle workers, first-3-minutes coach, alerts, hotkey grid. Pure, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, idleWorkers, nextIdleWorker, idleButtonHtml, createCoach, createAlerts, gridAudit, GRID_CELLS, COACH_WINDOW_TICKS } from './teach.mjs';
import { GRID_KEYS } from './command-card.mjs';

const TPS = 24;
const snapOf = (o = {}) => ({
  tick: 0, shards: [200, 200],
  units: [{ id: 1, kind: 'worker', owner: 0, x: 5, y: 5, order: null, carrying: 0 }],
  structures: [{ id: 9, kind: 'core', owner: 0, x: 3, y: 3, complete: true, queue: [] }],
  ...o,
});

test('every button gets a hotkey, a cost where it has one, and one plain sentence', () => {
  for (const e of [
    { key: 'a', label: 'Attack', action: 'amove' }, { key: 's', label: 'Stop', action: 'stop' },
    { key: 'f', label: 'forge', kind: 'forge', action: 'build', cost: 100 },
    { key: 'g', label: 'grunt', kind: 'grunt', action: 'train', cost: 50 },
    { key: 'r', label: 'Rally', action: 'rally' },
    { key: 'x', label: 'mystery', kind: 'mystery', action: 'train', cost: 7 },
  ]) {
    const d = describe(e);
    assert.equal(d.key, e.key.toUpperCase());
    assert.ok(d.sentence.length > 8 && !/undefined|null/.test(d.sentence), e.label);
    assert.equal(d.sentence.split(/[.!?]\s/).length, 1, 'one sentence');
    assert.ok(d.title.includes(`(${d.key})`));
    if (e.cost !== undefined) assert.ok(d.title.includes(String(e.cost)));
  }
});

test('describe shows the current market price when given', () => {
  const d = describe({ key: 'g', label: 'grunt', kind: 'grunt', action: 'train', cost: 50 }, { prices: { grunt: 75 } });
  assert.equal(d.cost, 75);
  assert.ok(d.title.includes('75'));
});

test('idle workers: only own workers with no order', () => {
  const s = snapOf({ units: [
    { id: 1, kind: 'worker', owner: 0, order: null }, { id: 2, kind: 'worker', owner: 0, order: { type: 'gather' } },
    { id: 3, kind: 'worker', owner: 1, order: null }, { id: 4, kind: 'grunt', owner: 0, order: null }] });
  assert.deepEqual(idleWorkers(s, 0).map((u) => u.id), [1]);
  assert.equal(idleButtonHtml(0), '');
  assert.match(idleButtonHtml(2), /data-action="idle"[^>]*>.*2/s);
  assert.match(idleButtonHtml(2), /\(\.\)/);
});

test('the idle key cycles through idle workers and wraps', () => {
  const s = snapOf({ units: [1, 2, 3].map((id) => ({ id, kind: 'worker', owner: 0, order: null })) });
  const memo = {};
  assert.deepEqual([1, 2, 3, 1].map(() => nextIdleWorker(s, 0, memo).id), [1, 2, 3, 1]);
  assert.equal(nextIdleWorker(snapOf({ units: [] }), 0, memo), null);
});

test('coach: the first prompt says to select a Worker, then moves on and never repeats it', () => {
  const coach = createCoach({ side: 0, tps: TPS });
  assert.equal(coach.next(snapOf(), { selected: [] }).id, 'select-worker');
  assert.notEqual(coach.next(snapOf({ tick: 24 }), { selected: [{ kind: 'worker' }] })?.id, 'select-worker');
  assert.notEqual(coach.next(snapOf({ tick: 48 }), { selected: [] })?.id, 'select-worker');
});

test('coach: over the first minute it suggests training or building', () => {
  const coach = createCoach({ side: 0, tps: TPS });
  const ids = new Set();
  for (let t = 0; t < 60 * TPS; t += TPS) {
    const p = coach.next(snapOf({ tick: t }), { selected: [{ kind: 'worker' }] });
    if (p) { ids.add(p.id); coach.done(p.id); }
  }
  assert.ok(ids.has('train-worker') && ids.has('build-forge'), [...ids].join());
});

test('coach: silent after the first 3 minutes', () => {
  const coach = createCoach({ side: 0, tps: TPS });
  assert.equal(COACH_WINDOW_TICKS, 180 * TPS);
  assert.equal(coach.next(snapOf({ tick: COACH_WINDOW_TICKS + 1 }), { selected: [] }), null);
});

test('coach: every prompt is short and plain', () => {
  const coach = createCoach({ side: 0, tps: TPS });
  const seen = [];
  for (let t = 0; t < COACH_WINDOW_TICKS; t += 12) {
    const p = coach.next(snapOf({ tick: t, shards: [500, 0] }), { selected: [], keys: { worker: 'w', forge: 'f' } });
    if (p) { seen.push(p); coach.done(p.id); }
  }
  assert.ok(seen.length >= 3);
  for (const p of seen) assert.ok(p.text.length <= 90 && p.text.length > 10, `${p.id}: ${p.text}`);
});

test('alerts: Space jumps to the newest, Shift-Space to older ones, wrapping', () => {
  const a = createAlerts({ tps: TPS });
  a.push({ x: 1, y: 1, text: 'Under attack', tick: 10 });
  a.push({ x: 9, y: 9, text: 'Construction complete', tick: 50 });
  assert.equal(a.jump().text, 'Construction complete');
  assert.equal(a.jump({ older: true }).text, 'Under attack');
  assert.equal(a.jump({ older: true }).text, 'Construction complete');
  assert.equal(createAlerts({ tps: TPS }).jump(), null);
});

test('alerts: the same alert near the same spot within 3 seconds does not stack', () => {
  const a = createAlerts({ tps: TPS });
  a.push({ x: 1, y: 1, text: 'Under attack', tick: 10 });
  a.push({ x: 2, y: 1, text: 'Under attack', tick: 20 });
  assert.equal(a.list().length, 1);
  assert.equal(a.list()[0].tick, 20);
  a.push({ x: 2, y: 1, text: 'Under attack', tick: 20 + 4 * TPS });
  assert.equal(a.list().length, 2);
});

test('alerts: html shows fresh ones with the jump key and nothing when stale', () => {
  const a = createAlerts({ tps: TPS });
  a.push({ x: 1, y: 1, text: 'Under attack', tick: 10 });
  assert.match(a.html(20), /Under attack.*Space/s);
  assert.equal(a.html(10 + 20 * TPS), '');
});

test('the audit grid is the command card grid', () => assert.deepEqual([...GRID_CELLS], [...GRID_KEYS]));

test('hotkey grid audit flags buttons that are off the fixed grid, or share a key', () => {
  assert.deepEqual(gridAudit([{ key: 'a' }, { key: 'f' }]), { ok: true, off: [], dupes: [] });
  assert.deepEqual(gridAudit([{ key: 'a' }, { key: 't' }]), { ok: false, off: ['t'], dupes: [] });
  assert.deepEqual(gridAudit([{ key: 'a' }, { key: 'a' }]), { ok: false, off: [], dupes: ['a'] });
});
