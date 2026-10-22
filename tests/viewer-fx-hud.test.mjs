// Tests for viewer/fx.mjs and the pure parts of viewer/hud.mjs, run against a real simulated match.
// Runs with: node --test tests/viewer-fx-hud.test.mjs
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { runMatch } from '../env/referee.mjs';
import { createReplayer } from '../viewer/replay.mjs';
import { createFx } from '../viewer/fx.mjs';
import { hudModel, valueSeries, bannerText, minimapShapes, drawMinimap, formatClock } from '../viewer/hud.mjs';

// A canvas context that records calls and rejects NaN coordinates.
function fakeCtx() {
  const calls = [];
  const proxy = new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      return (...args) => {
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`non-finite arg in ${String(name)}`);
        calls.push(String(name));
      };
    },
    set() { return true; },
  });
  return proxy;
}

let log;
before(async () => {
  const sample = new URL('../players/sample-player.mjs', import.meta.url).pathname;
  ({ log } = await runMatch({ seed: 7, players: [sample, sample], maxTicks: 400 }));
});

describe('fx', () => {
  test('stepping through a whole match draws every effect with finite numbers', () => {
    const r = createReplayer(log);
    const fx = createFx({ log });
    const ctx = fakeCtx();
    const kinds = new Set();
    for (let t = 0; t <= r.last; t++) {
      r.seek(t);
      fx.advance(r.state, t, r.eventsAt(t));
      for (const e of fx.effects) kinds.add(e.k);
      for (const alpha of [0, 0.5, 1]) {
        fx.drawSites(ctx, 20, r.state, alpha);
        fx.drawEffects(ctx, 20, alpha);
        for (const u of r.state.units) {
          const p = fx.unitPos(u, alpha);
          assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
          assert.ok(Math.abs(p.x - u.x) <= 1 && Math.abs(p.y - u.y) <= 1, 'never more than a tile from the real position');
        }
      }
    }
    assert.ok(kinds.has('mine') && kinds.has('deliver') && kinds.has('spawn'), `saw ${[...kinds]}`);
  });

  test('a moving unit starts one tile back and ends on its tile', () => {
    const r = createReplayer(log);
    const fx = createFx({ log });
    let checked = 0;
    for (let t = 0; t <= 60 && checked < 5; t++) {
      r.seek(t);
      fx.advance(r.state, t, r.eventsAt(t));
      for (const ev of r.eventsAt(t)) {
        if (ev.e !== 'move') continue;
        const u = r.state.units.find((x) => x.id === ev.id);
        const p0 = fx.unitPos(u, 0), p1 = fx.unitPos(u, 1);
        if (p0.x !== u.x || p0.y !== u.y) checked++;
        assert.deepEqual(p1, { x: u.x, y: u.y });
        assert.equal(Math.abs(p0.x - u.x) + Math.abs(p0.y - u.y), 1);
      }
    }
    assert.ok(checked > 0);
  });

  test('jumping around never throws and units stay within a tile of their real spot', () => {
    const r = createReplayer(log);
    const fx = createFx({ log });
    const ctx = fakeCtx();
    for (const t of [200, 5, 399, 0, 150, 151, 100]) {
      r.seek(t);
      fx.advance(r.state, t, r.eventsAt(t));
      fx.drawEffects(ctx, 16, 0.3);
    }
    r.seek(100);
    fx.advance(r.state, 100, r.eventsAt(100));
    for (const u of r.state.units) {
      const p = fx.unitPos(u, 0);
      assert.ok(Math.abs(p.x - u.x) + Math.abs(p.y - u.y) <= 1);
      assert.deepEqual(fx.unitPos(u, 1), { x: u.x, y: u.y });
    }
  });

  test('hits give a flash on the target that fades', () => {
    const r = createReplayer(log);
    const fx = createFx({ log });
    let found = false;
    for (let t = 0; t <= r.last && !found; t++) {
      r.seek(t);
      fx.advance(r.state, t, r.eventsAt(t));
      const hit = r.eventsAt(t).find((e) => e.e === 'hit');
      if (hit) {
        found = true;
        assert.ok(fx.flash(hit.id, 0.2) > fx.flash(hit.id, 1.5));
        assert.equal(fx.flash(hit.id, 3), 0);
      }
    }
    // Sample-player matches may be peaceful this early; the check above only runs when a hit exists.
  });
});

describe('hud', () => {
  test('hudModel matches the final state and result', () => {
    const r = createReplayer(log);
    r.seek(r.last);
    const m = hudModel(r.state, log);
    assert.equal(m.sides.length, 2);
    assert.equal(m.sides[0].value, log.result.value[0]);
    assert.equal(m.sides[1].value, log.result.value[1]);
    assert.ok(m.share0 >= 0 && m.share0 <= 1);
  });

  test('valueSeries has one entry per tick and stays within 0..1', () => {
    const s = valueSeries(log);
    assert.equal(s.length, log.ticks.length + 1);
    assert.ok(s.every((v) => v >= 0 && v <= 1));
  });

  test('bannerText names the winner, a draw, and nothing before the end', () => {
    assert.equal(bannerText(null, log), null);
    assert.match(bannerText({ winner: 1, reason: 'core', tick: 9, value: [1, 2] }, log).title, /wins/);
    assert.equal(bannerText({ winner: null, reason: 'timeout', tick: 9, value: [3, 3] }, log).title, 'Draw');
  });

  test('minimap places everything inside its square and draws cleanly', () => {
    const r = createReplayer(log);
    r.seek(100);
    const m = minimapShapes(r.state, 160);
    for (const group of [m.rocks, m.crystals, m.structures, m.units]) {
      for (const p of group) assert.ok(p.x >= 0 && p.x <= 160 && p.y >= 0 && p.y <= 160);
    }
    drawMinimap(fakeCtx(), r.state, 160, ['#00f', '#f80']);
  });

  test('formatClock', () => {
    assert.equal(formatClock(0), '0:00');
    assert.equal(formatClock(1250), '2:05');
  });
});
