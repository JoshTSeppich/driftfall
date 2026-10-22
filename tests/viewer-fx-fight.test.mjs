// Tests for viewer/fx.mjs on a hand-made fight (the sample player never fights, so the real log has no combat).
// Runs with: node --test tests/viewer-fx-fight.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayer } from '../viewer/replay.mjs';
import { createFx } from '../viewer/fx.mjs';

function fakeCtx() {
  const calls = [];
  return new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      return (...args) => {
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`non-finite arg in ${String(name)}`);
        calls.push(String(name));
      };
    },
    set() { return true; },
  });
}

const unit = (id, owner, kind, x, y, hp) => ({ id, owner, kind, x, y, hp, carrying: 0, order: null });
const fightLog = {
  format: 'driftfall-log', version: 1, seed: 0, players: ['a', 'b'],
  stats: { units: { lancer: { range: 4, cost: 75 }, grunt: { range: 1, cost: 50 } }, structures: { forge: { buildTicks: 40, cost: 150 }, core: {} } },
  initial: {
    tick: 0, width: 16, height: 16, rocks: [], crystals: [], shards: [0, 0],
    units: [unit(3, 0, 'lancer', 2, 2, 40), unit(4, 1, 'grunt', 5, 2, 10)],
    structures: [{ id: 1, owner: 0, kind: 'core', x: 1, y: 1, hp: 1000, progress: 0, complete: true, queue: [] }],
  },
  ticks: [
    { tick: 0, commands: [[], []], events: [{ e: 'hit', id: 4, by: 3, dmg: 10, hp: 0 }, { e: 'die', id: 4 }] },
    { tick: 1, commands: [[], []], events: [{ e: 'spawn', structure: { id: 5, owner: 0, kind: 'forge', x: 3, y: 3, hp: 5, progress: 0, complete: false, queue: [] } }] },
    { tick: 2, commands: [[], []], events: [{ e: 'progress', id: 5, progress: 10, hp: 40 }] },
  ],
  result: null,
};

test('a ranged hit gives a bolt, hit ring, damage number and death burst that then expire', () => {
  const r = createReplayer(fightLog);
  const fx = createFx({ log: fightLog });
  const ctx = fakeCtx();
  r.seek(1);
  fx.advance(r.state, 1, r.eventsAt(1));
  assert.deepEqual(fx.effects.map((e) => e.k).sort(), ['die', 'hit', 'shot', 'text']);
  assert.equal(fx.effects.find((e) => e.k === 'shot').ranged, true);
  for (const a of [0, 0.5, 1, 2, 4]) fx.drawEffects(ctx, 24, a);
  assert.ok(ctx.calls.includes('arc') && ctx.calls.includes('fillText'));
  assert.ok(fx.flash(4, 0.2) > fx.flash(4, 1.4));
  for (let t = 2; t <= 9; t++) { r.seek(Math.min(t, 3)); fx.advance(r.state, t, []); }
  assert.equal(fx.effects.length, 0);
});

test('scrubbing straight to a tick right after a death still shows the burst', () => {
  const r = createReplayer(fightLog);
  const fx = createFx({ log: fightLog });
  r.seek(2); fx.advance(r.state, 2, r.eventsAt(2));
  assert.ok(fx.effects.some((e) => e.k === 'spawn'));
});

test('construction rings draw for unfinished sites only', () => {
  const r = createReplayer(fightLog);
  const fx = createFx({ log: fightLog });
  r.seek(3); fx.advance(r.state, 3, r.eventsAt(3));
  const ctx = fakeCtx();
  fx.drawSites(ctx, 24, r.state, 1);
  assert.ok(ctx.calls.includes('arc'));
  const done = fakeCtx();
  fx.drawSites(done, 24, { structures: [{ id: 1, owner: 0, kind: 'core', x: 1, y: 1, complete: true }] }, 1);
  assert.equal(done.calls.length, 0);
});
