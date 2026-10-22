// Art smoke test: every draw function in viewer/art.mjs runs without throwing on a recording stub context,
// leaves save/restore balanced, and only ever calls real CanvasRenderingContext2D methods.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as art from '../viewer/art.mjs';

const METHODS = new Set(['save', 'restore', 'translate', 'scale', 'rotate', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'arc', 'ellipse', 'rect', 'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'clip', 'setLineDash',
  'createRadialGradient', 'createLinearGradient', 'drawImage', 'fillText', 'setTransform']);

function stubCtx() {
  const calls = [];
  let depth = 0, minDepth = 0;
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      if (name === 'depth') return depth;
      if (name === 'minDepth') return minDepth;
      if (typeof name !== 'string') return undefined;
      if (METHODS.has(name)) {
        return (...args) => {
          calls.push(name);
          if (name === 'save') depth++;
          if (name === 'restore') { depth--; minDepth = Math.min(minDepth, depth); }
          if (name.startsWith('create')) return gradient;
          for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${name} got ${a}`);
        };
      }
      return 1; // any property read (lineWidth, globalAlpha...) yields a number
    },
    set() { return true; },
  });
  return ctx;
}

const state = {
  width: 6, height: 6, seed: 3,
  rocks: [[1, 1], [4, 2]],
  crystals: [{ x: 2, y: 2, amount: 400 }, { x: 3, y: 2, amount: 0 }],
  structures: [],
  units: [],
};

test('terrain draws without a DOM and balances save/restore', () => {
  const ctx = stubCtx();
  art.drawTerrain(ctx, state, { cell: 20, time: 1.5 });
  assert.equal(ctx.depth, 0);
  assert.equal(ctx.minDepth, 0);
  assert.ok(ctx.calls.includes('fillRect'));
});

test('every unit kind, side and pose draws and balances save/restore', () => {
  for (const owner of [0, 1]) for (const kind of art.KINDS.units) for (const pose of art.POSES) {
    for (const cell of [12, 20, 48]) for (const carrying of [0, 10]) {
      const ctx = stubCtx();
      const unit = { id: 5, kind, owner, x: 1, y: 2, hp: 10, carrying, order: null };
      art.drawUnit(ctx, unit, { cell, time: 0.7, pose, deathT: 0.4, maxHp: 40, hit: pose === 'attack', facing: 1.2 });
      assert.equal(ctx.depth, 0, `${kind} ${pose} unbalanced`);
      assert.equal(ctx.minDepth, 0, `${kind} ${pose} restored too often`);
      assert.ok(ctx.calls.includes('fill'), `${kind} ${pose} drew nothing`);
    }
  }
});

test('every structure kind, side and build state draws and balances save/restore', () => {
  for (const owner of [0, 1]) for (const kind of art.KINDS.structures) for (const complete of [true, false]) {
    for (const queue of [[], ['grunt', 'grunt']]) {
      const ctx = stubCtx();
      const s = { id: 9, kind, owner, x: 0, y: 0, hp: 50, progress: 12, complete, queue };
      art.drawStructure(ctx, s, { cell: 20, time: 2, maxHp: 400, buildTicks: 40, hit: !complete });
      assert.equal(ctx.depth, 0, `${kind} complete=${complete} unbalanced`);
      assert.equal(ctx.minDepth, 0);
      assert.ok(ctx.calls.includes('fill'));
    }
  }
});

test('drawScene draws a whole state, including deaths and unknown kinds, without throwing', () => {
  const ctx = stubCtx();
  const full = {
    ...state,
    structures: [{ id: 1, kind: 'core', owner: 0, x: 0, y: 0, hp: 1000, complete: true, queue: [] },
      { id: 2, kind: 'mystery', owner: 1, x: 5, y: 5, hp: 10, complete: false, queue: [] }],
    units: [{ id: 3, kind: 'worker', owner: 0, x: 1, y: 0, hp: 40, carrying: 10, order: { type: 'gather', phase: 'toCore' } },
      { id: 4, kind: 'odd', owner: 1, x: 4, y: 4, hp: 1, order: { type: 'attack', target: 3 } }],
  };
  const stats = { units: { worker: { hp: 40 } }, structures: { core: { hp: 1000 } } };
  art.drawScene(ctx, full, { cell: 20, time: 3, stats, hitIds: new Set([3]), deaths: [{ unit: { id: 7, kind: 'grunt', owner: 1, x: 2, y: 2 }, t: 0.5 }] });
  assert.equal(ctx.depth, 0);
  assert.equal(ctx.minDepth, 0);
});

test('drawUnit and drawStructure return true for known kinds, false for unknown, and accept a pixel box', () => {
  const ctx = stubCtx();
  assert.equal(art.drawUnit(ctx, { id: 1, kind: 'grunt', owner: 0, x: 0, y: 0, hp: 1 }, { x: 100, y: 50, size: 32 }), true);
  assert.equal(art.drawUnit(ctx, { id: 1, kind: 'blob', owner: 0, x: 0, y: 0, hp: 1 }, { cell: 20 }), false);
  assert.equal(art.drawStructure(ctx, { id: 2, kind: 'turret', owner: 1, x: 0, y: 0, hp: 1, complete: true }, { x: 10, y: 10, size: 48 }), true);
  assert.equal(art.drawStructure(ctx, { id: 2, kind: 'wall', owner: 1, x: 0, y: 0, hp: 1, complete: true }, {}), false);
  assert.equal(ctx.depth, 0);
});

test('inferPose, defaultFacing, teamColors and hash are deterministic and sensible', () => {
  assert.equal(art.inferPose({ order: null }), 'idle');
  assert.equal(art.inferPose({ order: { type: 'move' } }), 'move');
  assert.equal(art.inferPose({ order: { type: 'attack' } }), 'attack');
  assert.equal(art.inferPose({ order: { type: 'gather', phase: 'mining' } }), 'attack');
  assert.equal(art.inferPose({ order: { type: 'gather', phase: 'toField' } }), 'move');
  assert.equal(art.inferPose({}), 'idle');
  assert.notEqual(art.defaultFacing(0), art.defaultFacing(1));
  assert.equal(art.teamColors(0).name, 'Cobalt');
  assert.equal(art.teamColors(1).name, 'Ember');
  assert.equal(art.teamColors(7).name, 'Drift');
  assert.equal(art.hash(3, 4, 5), art.hash(3, 4, 5));
  assert.notEqual(art.hash(3, 4, 5), art.hash(4, 3, 5));
  for (let i = 0; i < 200; i++) { const h = art.hash(i, i * 7, 1); assert.ok(h >= 0 && h < 1); }
});
