// Neutral camps: TERRITORY.md section 14. Pure module, OFF until enableNeutrals(state) is called.
//
// Every Reach but a Main holds a camp of strength 1-3 (STATS.neutrals.byRole). Its creatures live in
// state.neutrals.creatures, NOT in state.units, so the current sim, territory and combat never see them until a wiring
// step opts in. They wake when a unit comes into sight, chase it no farther than the leash from the camp, then walk
// home and heal. You cannot claim a Reach while a camp stands there. Clearing the last creature pays the bounty to the
// killer's side, drops an item (when env/items.mjs is on) and starts the respawn clock: 4 minutes of the Reach going
// unheld sends the camp back at full strength. Drift hooks: floodCamp drives a camp to higher ground, wakeCamp adds a
// new camp beside a Bloom's field.
//
// Shared contract (what other files call):
//   enableNeutrals(state, {autoFight=true})   needs state.territory; builds the camps, deterministic from state.seed
//   campOf(state, reach)  creaturesOf(state, reach)  canClaim(state, reach) -> {ok} | {ok:false, reason:'camp'}
//   stepNeutrals(state)                       once a tick, after combat: creatures act, respawn clock runs
//   damageCreature(state, id, amount, byOwner, byUnitId)   combat.mjs calls this when it is wired in; with
//                                             autoFight on, stepNeutrals does the units' side of the fight itself
//   floodCamp(state, reach, on, highGround)   wakeCamp(state, reach, {x, y}) -> camp
//   observeNeutrals(state) -> [{reach, pips, standing, creatures:[{id,name,x,y,hp,maxHp}]}]
import { STATS, kindStats } from './stats.mjs';
import { allocId, emit, distance } from './state.mjs';
import { makeRng } from './rng.mjs';
import { creditResource } from './economy.mjs';
import { dropPickup, awardKill, onUnitDeath, unitMods } from './items.mjs';

const N = () => STATS.neutrals;
const TPS = STATS.clock.ticksPerSecond;

export function enableNeutrals(state, opts = {}) {
  if (!state.territory) throw new Error('enableNeutrals needs state.territory (createTerritory first)');
  if (state.neutrals) return state.neutrals;
  state.neutrals = { camps: [], creatures: [], autoFight: opts.autoFight !== false };
  for (const r of state.territory.map.reaches) {
    const strength = N().byRole[r.role] || 0;
    if (strength > 0 && r.centre) addCamp(state, r.id, strength, r.centre, false);
  }
  return state.neutrals;
}

function tileOk(state, x, y) {
  return x >= 0 && y >= 0 && x < state.width && y < state.height && !state.rockSet.has(`${x},${y}`)
    && !state.structures.some((s) => s.x === x && s.y === y);
}

function spawnCreatures(state, camp) {
  const row = N().strengths[camp.strength];
  const rng = makeRng((Number(state.seed) | 0) * 7919 + camp.reach * 131 + camp.id * 17 + (camp.waves || 0));
  const offsets = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (row.count === 1 || dx || dy) offsets.push([dx, dy]);
  for (let i = offsets.length - 1; i > 0; i--) { const j = rng.int(i + 1); [offsets[i], offsets[j]] = [offsets[j], offsets[i]]; }
  const ok = offsets.filter(([dx, dy]) => {
    const x = camp.home.x + dx;
    const y = camp.home.y + dy;
    return tileOk(state, x, y) && state.territory.map.reachAt(x, y) === camp.reach;
  });
  camp.creatures = [];
  for (let i = 0; i < row.count; i++) {
    const [dx, dy] = ok[i % Math.max(1, ok.length)] || [0, 0];
    const c = {
      id: allocId(state), camp: camp.id, name: row.creature, x: camp.home.x + dx, y: camp.home.y + dy, post: { dx, dy },
      hp: row.hp, maxHp: row.hp, damage: row.damage, range: row.range, attackEvery: row.attackEvery, lastAttack: -999,
    };
    state.neutrals.creatures.push(c);
    camp.creatures.push(c.id);
  }
  camp.standing = true;
  camp.waves = (camp.waves || 0) + 1;
}

function addCamp(state, reach, strength, centre, extra) {
  const camp = {
    id: state.neutrals.camps.length, reach, strength, extra, home: { x: Math.round(centre.x), y: Math.round(centre.y) },
    creatures: [], standing: false, clearedTick: null, unheldTicks: 0, dryHome: null, waves: 0,
  };
  state.neutrals.camps.push(camp);
  spawnCreatures(state, camp);
  return camp;
}

export const campOf = (state, reach) => (state.neutrals ? state.neutrals.camps.find((c) => c.reach === reach && !c.extra) || null : null);
export const creaturesOf = (state, reach) => (state.neutrals
  ? state.neutrals.creatures.filter((c) => state.neutrals.camps[c.camp].reach === reach) : []);

export function canClaim(state, reach) {
  if (!state.neutrals) return { ok: true };
  return state.neutrals.camps.some((c) => c.reach === reach && c.standing) ? { ok: false, reason: 'camp' } : { ok: true };
}

export function wakeCamp(state, reach, at) {
  if (!state.neutrals) return null;
  const camp = addCamp(state, reach, 1, at, true);
  emit(state, { e: 'camp-woke', reach, camp: camp.id });
  return camp;
}

export function floodCamp(state, reach, on, highGround = null) {
  if (!state.neutrals) return;
  for (const camp of state.neutrals.camps) {
    if (camp.reach !== reach) continue;
    if (on && highGround && !camp.dryHome) { camp.dryHome = camp.home; camp.home = { x: highGround.x, y: highGround.y }; }
    else if (!on && camp.dryHome) { camp.home = camp.dryHome; camp.dryHome = null; }
  }
}

function clearCamp(state, camp, byOwner) {
  const row = N().strengths[camp.strength];
  camp.standing = false;
  camp.clearedTick = state.tick;
  camp.unheldTicks = 0;
  const side = byOwner === 0 || byOwner === 1 ? byOwner : null;
  const rare = N().rareBounty[camp.strength] || null;
  if (side !== null) {
    state.shards[side] += row.bounty;
    if (rare) creditResource(state, side, rare.resource, rare.amount);
  }
  let item = null;
  if (state.items) {
    const pool = N().dropPools[row.drop];
    const rng = makeRng((Number(state.seed) | 0) * 977 + camp.id * 31 + camp.waves);
    item = pool[rng.int(pool.length)];
    dropPickup(state, item, camp.home.x, camp.home.y);
  }
  emit(state, { e: 'camp-cleared', reach: camp.reach, camp: camp.id, player: side, bounty: row.bounty, rare, item });
}

export function damageCreature(state, id, amount, byOwner = null, byUnitId = null) {
  const list = state.neutrals.creatures;
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return false;
  const c = list[i];
  c.hp -= amount;
  emit(state, { e: 'hit', id: c.id, by: byUnitId, dmg: amount, hp: Math.max(0, c.hp) });
  if (c.hp > 0) return true;
  list.splice(i, 1);
  emit(state, { e: 'die', id: c.id });
  if (byUnitId !== null) awardKill(state, state.units.find((u) => u.id === byUnitId));
  const camp = state.neutrals.camps[c.camp];
  camp.creatures = camp.creatures.filter((x) => x !== c.id);
  if (camp.creatures.length === 0 && camp.standing) clearCamp(state, camp, byOwner);
  return true;
}

function stepToward(state, c, tx, ty) {
  const sx = Math.sign(tx - c.x);
  const sy = Math.sign(ty - c.y);
  for (const [dx, dy] of [[sx, sy], [sx, 0], [0, sy]]) {
    if ((dx || dy) && tileOk(state, c.x + dx, c.y + dy)) { c.x += dx; c.y += dy; return; }
  }
}

function hurtUnit(state, c, u) {
  const armour = state.items ? unitMods(u).armour : 0;
  const dmg = Math.max(1, c.damage - armour);
  u.hp -= dmg;
  emit(state, { e: 'hit', id: u.id, by: c.id, dmg, hp: Math.max(0, u.hp) });
  if (u.hp > 0) return;
  if (state.items) onUnitDeath(state, u);
  state.units.splice(state.units.indexOf(u), 1);
  emit(state, { e: 'die', id: u.id });
}

export function stepNeutrals(state) {
  const ns = state.neutrals;
  if (!ns) return;
  const row = (c) => N().strengths[ns.camps[c.camp].strength];
  const prey = state.units.filter((u) => u.hp > 0 && !u.inside && (u.owner === 0 || u.owner === 1));

  for (const c of ns.creatures.slice()) {
    const camp = ns.camps[c.camp];
    const r = row(c);
    let target = null;
    for (const u of prey) {
      if (u.hp <= 0 || distance(c, u) > r.aggro || distance(camp.home, u) > r.leash) continue;
      if (!target || distance(c, u) < distance(c, target)) target = u;
    }
    if (target && distance(c, camp.home) <= r.leash) {
      if (distance(c, target) <= c.range) {
        if (state.tick - c.lastAttack >= c.attackEvery) { c.lastAttack = state.tick; hurtUnit(state, c, target); }
      } else if (state.tick % N().moveEveryTicks === 0) stepToward(state, c, target.x, target.y);
    } else {
      const px = camp.home.x + c.post.dx;
      const py = camp.home.y + c.post.dy;
      if ((c.x !== px || c.y !== py) && state.tick % N().moveEveryTicks === 0) stepToward(state, c, px, py);
      if (state.tick % TPS === 0 && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + Math.ceil(c.maxHp * N().regenPerSecond));
    }
  }

  if (ns.autoFight) {
    for (const u of prey) {
      if (u.hp <= 0 || u.kind === 'worker' || (state.tick + u.id) % N().unitAttackEvery !== 0) continue;
      const stats = kindStats(u.kind);
      if (!stats || stats.damage === undefined) continue;
      const m = state.items ? unitMods(u) : { range: 0, damageMul: 1 };
      let best = null;
      for (const c of ns.creatures) {
        if (distance(u, c) <= stats.range + m.range && (!best || distance(u, c) < distance(u, best))) best = c;
      }
      if (best) damageCreature(state, best.id, Math.round(stats.damage * m.damageMul), u.owner, u.id);
    }
  }

  for (const camp of ns.camps) {
    if (camp.standing || camp.extra || camp.clearedTick === null) continue;
    camp.unheldTicks = state.territory.reaches[camp.reach].claimedBy === null ? camp.unheldTicks + 1 : 0;
    if (camp.unheldTicks >= N().respawnTicks) {
      camp.clearedTick = null;
      spawnCreatures(state, camp);
      emit(state, { e: 'camp-respawn', reach: camp.reach, camp: camp.id });
    }
  }
}

export function observeNeutrals(state) {
  if (!state.neutrals) return [];
  return state.neutrals.camps.map((camp) => ({
    reach: camp.reach, pips: camp.strength, standing: camp.standing, extra: camp.extra, home: { ...camp.home },
    creatures: state.neutrals.creatures.filter((c) => c.camp === camp.id).map((c) => ({ id: c.id, name: c.name, x: c.x, y: c.y, hp: c.hp, maxHp: c.maxHp })),
  }));
}
