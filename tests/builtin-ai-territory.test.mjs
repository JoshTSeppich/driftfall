// Built-in AI on the territory rules (TERRITORY.md section 11, players/builtin/ai.mjs). The AI reads an optional
// obs.rules = { territory, drift, budget }; without it the AI plays exactly as before (tests/builtin-ai.test.mjs).
// These tests hand-build the rules block on top of a real observation, so they run before env/state.mjs exposes it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMatch } from '../env/sim.mjs';
import { observe } from '../env/state.mjs';
import { STATS } from '../env/stats.mjs';
import { createPlayer } from '../players/builtin/ai.mjs';

function reach(id, role, side, x, y, extra = {}) {
  return { id, name: role, role, side, centre: { x, y }, bounds: { x0: x - 4, y0: y - 4, x1: x + 4, y1: y + 4 }, claimedBy: null, holder: null, contested: false, ...extra };
}

// A match observation for `side` at `tick`, with a rules block.
// Reach ids: 1 main, 2 natural, 3 vent, 4 flank, 5 centre, 11 the enemy's natural.
function world({ side = 0, tick = 3000, shards = 400, reaches, drift = {}, net = 50 } = {}) {
  const s = createMatch(1);
  s.tick = tick;
  s.shards[side] = shards;
  const obs = observe(s, side);
  const core = obs.structures.find((x) => x.owner === side && x.kind === 'core');
  const sg = core.x < obs.width / 2 ? 1 : -1;
  const rs = reaches ?? [
    reach(1, 'main', side, core.x, core.y, { claimedBy: side, holder: side }),
    reach(2, 'natural', side, core.x + sg * 6, core.y + sg * 6),
    reach(3, 'vent', side, core.x + sg * 3, core.y + sg * 10),
    reach(4, 'flank', side, core.x + sg * 12, core.y + sg * 3),
    reach(5, 'centre', null, obs.width / 2, obs.height / 2),
    reach(11, 'natural', 1 - side, obs.width - core.x - sg * 6, obs.height - core.y - sg * 6),
  ];
  setHold(obs, rs, side);
  obs.rules.drift = { upcoming: drift.upcoming ?? [], active: drift.active ?? [] };
  obs.rules.budget = { income: 600, upkeep: 600 - net, net };
  return { obs, core, state: s };
}
function setHold(obs, rs, side) {
  const mine = rs.filter((r) => r.claimedBy === side).length;
  obs.rules = { ...(obs.rules ?? {}), territory: { hold: side === 0 ? [mine, 0] : [0, mine], reaches: rs } };
}
const claims = (cmds) => cmds.filter((c) => c.type === 'claim');
const ai = (difficulty = 'normal', side = 0) => createPlayer({ side, seed: 1, stats: STATS, difficulty });

test('no rules block: no claim commands and no crash (the default game is unchanged)', () => {
  const s = createMatch(1);
  s.tick = 3000;
  s.shards[0] = 900;
  assert.equal(claims(ai().act(observe(s, 0))).length, 0);
});

test('normal claims the Natural first, with one of its Workers, once it is due and affordable', () => {
  const { obs } = world({ tick: 3000 });
  const cmds = claims(ai().act(obs));
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].reach, 2);
  const w = obs.units.find((u) => u.id === cmds[0].unit);
  assert.equal(w.kind, 'worker');
  assert.equal(w.owner, 0);
});

test('never claims with too few Shards, and never an enemy-side or already-held Reach', () => {
  assert.equal(claims(ai().act(world({ tick: 3000, shards: 40 }).obs)).length, 0);
  const { obs } = world({ tick: 9000 });
  const p = ai();
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    obs.tick += 24 * 60;
    for (const c of claims(p.act(obs))) {
      seen.add(c.reach);
      const r = obs.rules.territory.reaches.find((x) => x.id === c.reach);
      r.claimedBy = 0;
      r.holder = 0;
    }
    setHold(obs, obs.rules.territory.reaches, 0);
  }
  assert.ok(!seen.has(11), 'the enemy-side Reach is never claimed');
  assert.ok(!seen.has(1), 'the own Main is never re-claimed');
  assert.ok(seen.size >= 3, 'it kept expanding: ' + [...seen]);
});

test('one claim at a time: a second waits until the first shows as claimed or times out', () => {
  const { obs } = world({ tick: 3000 });
  const p = ai();
  assert.equal(claims(p.act(obs)).length, 1);
  obs.tick += 24;
  assert.equal(claims(p.act(obs)).length, 0, 'still walking to the first site');
  obs.tick += 24 * 90;
  assert.equal(claims(p.act(obs)).length, 1, 'retried after the timeout');
});

test('normal starts early; easy claims later and less', () => {
  assert.equal(claims(ai('normal').act(world({ tick: 1000 }).obs)).length, 0, 'nothing due at 0:41');
  assert.equal(claims(ai('normal').act(world({ tick: 3000 }).obs)).length, 1);
  assert.equal(claims(ai('easy').act(world({ tick: 3000 }).obs)).length, 0, 'easy has no extra claim due by 2:05');
  assert.equal(claims(ai('easy').act(world({ tick: 7000 }).obs)).length, 1, 'easy claims one by 4:50');
});

test('stops claiming once the Hold plan is met', () => {
  const rs = [
    reach(1, 'main', 0, 10, 10, { claimedBy: 0, holder: 0 }),
    reach(2, 'natural', 0, 20, 20, { claimedBy: 0, holder: 0 }),
    reach(3, 'vent', 0, 14, 30, { claimedBy: 0, holder: 0 }),
    reach(4, 'flank', 0, 30, 14),
  ];
  assert.equal(claims(ai().act(world({ tick: 4200, reaches: rs }).obs)).length, 0);
});

test('a Bloom announced in an unclaimed Reach goes to the front of the claim line', () => {
  const { obs } = world({ tick: 5000 });
  obs.rules.drift.upcoming = [{ kind: 'bloom', tick: 5500, reaches: [4], targets: [{ reach: 4 }] }];
  assert.equal(claims(ai().act(obs))[0]?.reach, 4);
});

test('a Flood about to hit a Reach: units inside move out, and no claim is sent there', () => {
  const { obs } = world({ tick: 3000 });
  const natural = obs.rules.territory.reaches.find((r) => r.id === 2);
  const w = obs.units.find((u) => u.owner === 0 && u.kind === 'worker');
  w.x = natural.centre.x;
  w.y = natural.centre.y;
  obs.rules.drift.upcoming = [{ kind: 'flood', tick: obs.tick + 100, reaches: [2], targets: [{ reach: 2 }] }];
  const cmds = ai().act(obs);
  assert.ok(!claims(cmds).some((c) => c.reach === 2));
  const out = cmds.filter((c) => c.type === 'move' && c.unit === w.id).pop();
  assert.ok(out, 'worker told to move out');
  const b = natural.bounds;
  assert.ok(out.x < b.x0 || out.x > b.x1 || out.y < b.y0 || out.y > b.y1, 'to a tile outside the flooded Reach');
});

test('upkeep: with a negative budget and an army already built, no more soldiers are queued', () => {
  const run = (net) => {
    const { obs } = world({ tick: 4000, shards: 800, net });
    const core = obs.structures.find((x) => x.kind === 'core' && x.owner === 0);
    obs.structures.push({ id: 900, owner: 0, kind: 'forge', x: core.x + 2, y: core.y + 2, hp: 100, progress: 1, complete: true, queue: [] });
    for (let i = 0; i < 6; i++) obs.units.push({ id: 800 + i, owner: 0, kind: 'grunt', x: core.x + 3, y: core.y + 3, hp: 100, carrying: 0, order: null });
    return ai().act(obs).filter((c) => c.type === 'train' && c.building === 900).length;
  };
  assert.ok(run(80) > 0, 'positive budget keeps training');
  assert.equal(run(-30), 0, 'negative budget pauses new soldiers');
});

test('side 1 plays the same rules', () => {
  const { obs } = world({ side: 1, tick: 3000 });
  const cmds = claims(ai('normal', 1).act(obs));
  assert.equal(cmds.length, 1);
  assert.equal(obs.units.find((u) => u.id === cmds[0].unit).owner, 1);
});
