// Tier gating, pause/resume when Hold drops, and research queues (TERRITORY.md sections 5 and 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { step } from '../env/sim.mjs';
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { sideTier, kindTier, TIER_RULES } from '../env/tiers.mjs';
import { STATS, upgradeById } from '../env/stats.mjs';

const run = (s, n, cmds = [[], []]) => { for (let i = 0; i < n; i++) step(s, cmds); };
const rejected = (s) => s.events.find((e) => e.e === 'reject')?.reason;
const forge = (s, owner = 0) => {
  const f = { id: 900 + s.structures.length, owner, kind: 'forge', x: 6, y: 6, hp: 400, progress: 40, complete: true, queue: [] };
  s.structures.push(f);
  return f;
};

test('kindTier reads STATS.tiers unlock lists; unknown kinds are tier 1', () => {
  assert.equal(kindTier('grunt'), 1);
  assert.equal(kindTier('brute'), 2);
  assert.equal(kindTier('skiff'), 3);
  assert.equal(kindTier('nonsense'), 1);
});

test('sideTier needs the Hold: tier 1 always, 2 at Hold 3, 3 at Hold 6 (buildings not yet in the game do not block)', () => {
  const s = createTerritoryMatch(3);
  const holds = (n) => { s.holdOverride = () => n; return sideTier(s, 0); };
  assert.equal(holds(0), 1);
  assert.equal(holds(2), 1);
  assert.equal(holds(3), 2);
  assert.equal(holds(6), 3);
  assert.equal(TIER_RULES.buildingsInGame('foundry'), 'foundry' in STATS.structures);
});

test('training a tier-2 unit below Hold 3 is refused as tier-locked; at Hold 3 it is accepted', () => {
  const s = createTerritoryMatch(3);
  const f = forge(s);
  run(s, 1);
  step(s, [[{ type: 'train', building: f.id, kind: 'brute' }], []]);
  assert.equal(rejected(s), 'tier-locked');
  s.holdOverride = () => 3;
  step(s, [[{ type: 'train', building: f.id, kind: 'brute' }], []]);
  assert.equal(rejected(s), undefined);
  assert.equal(f.queue.length, 1);
});

test('a queued tier-2 unit pauses (no progress, no draw) when Hold drops, and resumes when it returns', () => {
  const s = createTerritoryMatch(3);
  s.testHold = [3, 0];
  s.holdOverride = (st, side) => st.testHold[side];
  const f = forge(s);
  s.shards[0] = 1000;
  step(s, [[{ type: 'train', building: f.id, kind: 'brute' }], []]);
  assert.equal(rejected(s), undefined);
  run(s, 5);
  const progressed = f.training;
  const bank = s.shards[0];
  assert.ok(progressed < STATS.units.brute.trainTicks);
  s.testHold = [2, 0];
  run(s, 30);
  assert.equal(f.paused, true);
  assert.equal(f.training, progressed, 'countdown frozen');
  assert.equal(s.shards[0], bank, 'no draw while paused');
  s.testHold = [3, 0];
  run(s, 3);
  assert.equal(f.paused, false);
  assert.ok(f.training < progressed, 'resumed');
});

test('research: queue at a building, pay, count down, finish, record', () => {
  const s = createTerritoryMatch(3);
  const f = forge(s);
  const up = upgradeById('weaponsGround1');
  s.shards[0] = 1000; s.flux[0] = 1000;
  step(s, [[{ type: 'research', building: f.id, upgrade: 'weaponsGround1' }], []]);
  assert.equal(rejected(s), undefined);
  assert.equal(s.shards[0], 1000 - up.cost.shards);
  assert.equal(s.flux[0], 1000 - up.cost.flux);
  run(s, up.ticks - 2);
  assert.equal(s.research.done[0].includes('weaponsGround1'), false);
  let seen = false;
  for (let i = 0; i < 3; i++) { step(s, [[], []]); seen ||= s.events.some((e) => e.e === 'researched' && e.upgrade === 'weaponsGround1'); }
  assert.equal(s.research.done[0].includes('weaponsGround1'), true);
  assert.ok(seen);
});

test('research rejections: unknown, tier-locked, needs earlier level, not enough, already done, wrong faction, not yours', () => {
  const s = createTerritoryMatch(3);
  const f = forge(s);
  s.shards[0] = 1000; s.flux[0] = 1000; s.alloy[0] = 1000;
  const r = (upgrade, extra = {}) => { step(s, [[{ type: 'research', building: f.id, upgrade, ...extra }], []]); return rejected(s); };
  assert.equal(r('nope'), 'bad-target');
  assert.equal(r('weaponsGround2'), 'tier-locked');
  s.holdOverride = () => 3;
  assert.equal(r('weaponsGround2'), 'needs-earlier');
  s.flux[0] = 0;
  assert.equal(r('weaponsGround1'), 'no-flux');
  s.flux[0] = 1000;
  assert.equal(r('weaponsGround1'), undefined);
  assert.equal(r('weaponsGround1'), 'already-queued');
  step(s, [[], [{ type: 'research', building: f.id, upgrade: 'weaponsAir1' }]]);
  assert.equal(rejected(s), 'not-yours');
  assert.equal(r('tunnels'), 'wrong-faction');
});

test('research pauses in debt and does not charge twice; default game has no research command', async () => {
  const s = createTerritoryMatch(3);
  const f = forge(s);
  s.shards[0] = 1000; s.flux[0] = 1000;
  step(s, [[{ type: 'research', building: f.id, upgrade: 'weaponsGround1' }], []]);
  const left = f.research[0].ticksLeft;
  s.shards[0] = -10;
  run(s, 20);
  assert.equal(f.research[0].ticksLeft, left, 'frozen in debt');
  const { createMatch } = await import('../env/sim.mjs');
  const d = createMatch(3);
  step(d, [[{ type: 'research', building: 1, upgrade: 'weaponsGround1' }], []]);
  assert.equal(rejected(d), 'bad-command');
});
