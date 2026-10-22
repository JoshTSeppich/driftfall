// Driftfall effects: smooth movement between ticks plus short-lived overlays built from log events
// (attack beams and projectiles, hit rings, damage numbers, death bursts, spawn/done pulses, Shard pickups and
// deliveries, construction progress). No DOM at import time; drawing functions take a canvas 2D context.
//
// Usage (viewer): const fx = createFx({ log, colors });
//   on every show(tick):  fx.advance(replayer.state, tick, replayer.eventsAt(tick));
//   when drawing:         fx.unitPos(u, alpha), fx.flash(id, alpha), fx.drawSites(...), fx.drawEffects(...)
// alpha is 0..1, how far into the tick the picture is. Pass 1 when paused or stepping.

import { createReplayer } from './replay.mjs';

const SHARD = '#46dcc8';
const KEEP = 6; // ticks an effect stays alive (its own life is shorter)
const LIFE = { shot: 2, hit: 2, die: 4, spawn: 2.5, done: 4, mine: 3, deliver: 3.5, spark: 2, blocked: 2.5, text: 5 };

const smooth = (a) => a * a * (3 - 2 * a);
const clamp01 = (a) => (a < 0 ? 0 : a > 1 ? 1 : a);
const lerp = (a, b, k) => a + (b - a) * k;

// Small deterministic hash so bursts look the same every time you scrub to them.
function hash(n) {
  let h = (n | 0) * 374761393 + 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function statRow(stats, kind) {
  if (!stats) return null;
  return stats.units?.[kind] ?? stats.structures?.[kind] ?? stats[kind] ?? null;
}

function lighten(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const ch = (s) => Math.round(lerp((n >> s) & 255, 255, amt));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function createFx({ log = null, colors = ['#4aa3ff', '#ff9a3c'] } = {}) {
  const stats = log?.stats ?? null;
  let tick = null;
  let sequential = false; // true when the last advance moved exactly one tick forward
  let prev = new Map(); // id -> {x,y} before the current tick
  let cur = new Map(); // id -> {x,y} now
  const seen = new Map(); // id -> {x,y,kind,owner,structure} last known, so dead attackers still have a position
  let effects = [];
  let helper = null; // private replayer used to rebuild effects after a jump

  const center = (id) => seen.get(id) ?? null;
  const rangeOf = (kind) => statRow(stats, kind)?.range ?? 1;

  function addFrom(events, born) {
    for (const ev of events) {
      switch (ev?.e) {
        case 'hit': {
          const a = center(ev.by), b = center(ev.id);
          if (!b) break;
          effects.push({ k: 'shot', born, a, b, by: ev.by, ranged: a ? rangeOf(a.kind) > 1 : false, owner: a?.owner ?? 0 });
          effects.push({ k: 'hit', born, id: ev.id, b, dmg: ev.dmg });
          effects.push({ k: 'text', born, x: b.x, y: b.y, text: `-${ev.dmg}`, color: '#ff8a7a', id: ev.id });
          break;
        }
        case 'die': {
          const b = center(ev.id);
          if (b) effects.push({ k: 'die', born, id: ev.id, b });
          break;
        }
        case 'spawn': {
          const r = ev.unit ?? ev.structure;
          if (r) effects.push({ k: 'spawn', born, b: { x: r.x, y: r.y, owner: r.owner, structure: !!ev.structure } });
          break;
        }
        case 'done': {
          const b = center(ev.id);
          if (b) effects.push({ k: 'done', born, b });
          break;
        }
        case 'progress': {
          const b = center(ev.id);
          if (b) effects.push({ k: 'spark', born, id: ev.id, b });
          break;
        }
        case 'mine': {
          const w = center(ev.id);
          effects.push({ k: 'mine', born, c: { x: ev.x, y: ev.y }, w, amount: ev.amount });
          break;
        }
        case 'deliver': {
          const w = center(ev.id);
          const core = w ? findCore(w.owner) : null;
          if (w && core) effects.push({ k: 'deliver', born, w, core, amount: ev.amount, owner: w.owner });
          break;
        }
        case 'blocked': {
          const b = center(ev.id);
          if (b) effects.push({ k: 'blocked', born, b });
          break;
        }
        default:
      }
    }
  }

  function findCore(owner) {
    for (const [, e] of seen) if (e.structure && e.kind === 'core' && e.owner === owner) return e;
    return null;
  }

  function snapshot(state) {
    const m = new Map();
    for (const s of state.structures) { m.set(s.id, { x: s.x, y: s.y }); seen.set(s.id, { x: s.x, y: s.y, kind: s.kind, owner: s.owner, structure: true }); }
    for (const u of state.units) { m.set(u.id, { x: u.x, y: u.y }); seen.set(u.id, { x: u.x, y: u.y, kind: u.kind, owner: u.owner, structure: false }); }
    return m;
  }

  // Call whenever the displayed tick changes. `events` are the events that produced `state`.
  function advance(state, t, events = []) {
    const forward = tick !== null && t === tick + 1;
    // Entities that vanished (dead) keep their last seen position because `seen` is never pruned.
    // Spawns in this tick's events are not in `seen` yet when the hit comes from a unit spawned this tick, so
    // seed them first.
    for (const ev of events) {
      const r = ev?.e === 'spawn' ? ev.unit ?? ev.structure : null;
      if (r) seen.set(r.id, { x: r.x, y: r.y, kind: r.kind, owner: r.owner, structure: !!ev.structure });
    }
    if (forward) {
      prev = cur;
      cur = snapshot(state);
      addFrom(events, t);
    } else {
      // A jump, scrub or step back: replay the last few ticks privately so the effects of the moment (and the
      // positions one tick earlier, for smooth movement) are exactly what they would have been playing through.
      effects = [];
      prev = new Map();
      cur = snapshot(state);
      if (log) {
        helper ??= createReplayer(log);
        const w0 = Math.max(log.initial?.tick ?? 0, t - KEEP);
        helper.seek(w0);
        let last = snapshot(helper.state);
        for (let i = w0 + 1; i <= t; i++) {
          prev = last;
          helper.seek(i);
          last = snapshot(helper.state);
          addFrom(helper.eventsAt(i), i);
        }
        if (t > w0) cur = last; else prev = new Map();
      } else {
        addFrom(events, t);
      }
    }
    tick = t;
    sequential = prev.size > 0;
    effects = effects.filter((e) => t - e.born < KEEP);
  }

  function unitPos(u, alpha = 1) {
    const p = sequential ? prev.get(u.id) : null;
    if (!p || (p.x === u.x && p.y === u.y)) return { x: u.x, y: u.y };
    const k = smooth(clamp01(alpha));
    return { x: lerp(p.x, u.x, k), y: lerp(p.y, u.y, k) };
  }

  // 0..1 strength of a hit tint on entity `id` right now.
  function flash(id, alpha = 1) {
    if (tick === null) return 0;
    let best = 0;
    for (const e of effects) {
      if (e.k !== 'hit' || e.id !== id) continue;
      const age = tick + alpha - e.born;
      best = Math.max(best, clamp01(1 - age / 1.6));
    }
    return best;
  }

  function drawSites(ctx, cell, state, alpha = 1) {
    for (const s of state.structures) {
      if (s.complete) continue;
      const total = statRow(stats, s.kind)?.buildTicks;
      if (!total) continue;
      const frac = clamp01((s.progress ?? 0) / total);
      const cx = (s.x + 0.5) * cell, cy = (s.y + 0.5) * cell, r = cell * 0.5;
      const col = colors[s.owner] ?? '#ccc';
      ctx.save();
      ctx.lineWidth = Math.max(2, cell * 0.08);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = lighten(col, 0.4);
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
      // rising fill so the footprint looks like it is being raised
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = col;
      const h = (cell - 4) * frac;
      ctx.fillRect(s.x * cell + 2, (s.y + 1) * cell - 2 - h, cell - 4, h);
      // four scaffold corners
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#ffd36a';
      ctx.lineWidth = 1.5;
      const L = cell * 0.22, x0 = s.x * cell + 1, y0 = s.y * cell + 1, x1 = (s.x + 1) * cell - 1, y1 = (s.y + 1) * cell - 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
      ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
      ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1);
      ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEffects(ctx, cell, alpha = 1) {
    if (tick === null) return;
    const t = tick + alpha;
    const px = (p) => (p.x + 0.5) * cell;
    const py = (p) => (p.y + 0.5) * cell;
    ctx.save();
    ctx.lineCap = 'round';
    for (const e of effects) {
      const age = t - e.born;
      const life = LIFE[e.k] ?? 2;
      if (age < 0 || age > life) continue;
      const f = age / life; // 0..1 through the effect
      const fade = 1 - f;
      switch (e.k) {
        case 'shot': {
          if (!e.a) break;
          const col = lighten(colors[e.owner] ?? '#fff', 0.55);
          ctx.globalAlpha = 0.9 * fade;
          ctx.strokeStyle = col;
          ctx.lineWidth = e.ranged ? Math.max(1, cell * 0.06) : Math.max(1.5, cell * 0.1);
          const ax = px(e.a), ay = py(e.a), bx = px(e.b), by = py(e.b);
          if (e.ranged) {
            // a bolt that travels to the target over the first tick, leaving a thin trail
            const k = clamp01(age / 1);
            const hx = lerp(ax, bx, k), hy = lerp(ay, by, k);
            const tk = clamp01(k - 0.35);
            ctx.beginPath(); ctx.moveTo(lerp(ax, bx, tk), lerp(ay, by, tk)); ctx.lineTo(hx, hy); ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.5, cell * 0.09), 0, Math.PI * 2); ctx.fill();
          } else {
            // melee: a quick slash across the target, drawn from the attacker's side
            const dx = ax - bx, dy = ay - by, d = Math.hypot(dx, dy) || 1;
            const nx = -dy / d, ny = dx / d, s = cell * 0.35;
            const sx = bx + (dx / d) * cell * 0.3;
            const sy = by + (dy / d) * cell * 0.3;
            const sweep = lerp(-1, 1, clamp01(age / 0.8));
            ctx.beginPath();
            ctx.moveTo(sx + nx * s * sweep - nx * s * 0.6, sy + ny * s * sweep - ny * s * 0.6);
            ctx.lineTo(sx + nx * s * sweep + nx * s * 0.6, sy + ny * s * sweep + ny * s * 0.6);
            ctx.stroke();
          }
          break;
        }
        case 'hit': {
          const arrive = clamp01((age - 0.3) / 0.7);
          if (arrive <= 0) break;
          ctx.globalAlpha = fade;
          ctx.strokeStyle = '#ffe9d0';
          ctx.lineWidth = Math.max(1.5, cell * 0.07);
          ctx.beginPath(); ctx.arc(px(e.b), py(e.b), cell * (0.2 + 0.4 * arrive), 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'text': {
          if (cell < 14) break;
          ctx.globalAlpha = clamp01(2 * fade);
          ctx.fillStyle = e.color;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.lineWidth = 3;
          ctx.font = `bold ${Math.floor(cell * 0.42)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          const jitter = (hash(e.id ?? 0) - 0.5) * cell * 0.5;
          const x = px(e) + jitter, y = py(e) - cell * (0.45 + 0.7 * f);
          ctx.strokeText(e.text, x, y); ctx.fillText(e.text, x, y);
          break;
        }
        case 'die': {
          const big = e.b.structure || false;
          const n = big ? 14 : 9;
          ctx.fillStyle = lighten(colors[e.b.owner] ?? '#fff', 0.3);
          for (let i = 0; i < n; i++) {
            const ang = hash(e.id * 31 + i) * Math.PI * 2;
            const spd = (0.5 + hash(e.id * 17 + i * 3)) * cell * (big ? 1.1 : 0.8);
            const d = spd * Math.sqrt(f);
            const sz = Math.max(1.5, cell * (big ? 0.16 : 0.11) * (1 - f));
            ctx.globalAlpha = fade;
            ctx.fillRect(px(e.b) + Math.cos(ang) * d - sz / 2, py(e.b) + Math.sin(ang) * d - sz / 2, sz, sz);
          }
          ctx.globalAlpha = 0.8 * fade;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(1.5, cell * 0.08 * fade);
          ctx.beginPath(); ctx.arc(px(e.b), py(e.b), cell * (0.3 + 0.9 * Math.sqrt(f)), 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'spawn': {
          ctx.globalAlpha = 0.8 * fade;
          ctx.strokeStyle = lighten(colors[e.b.owner] ?? '#fff', 0.5);
          ctx.lineWidth = Math.max(1.5, cell * 0.07);
          ctx.beginPath(); ctx.arc(px(e.b), py(e.b), cell * (0.9 - 0.5 * f), 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'done': {
          ctx.globalAlpha = 0.9 * fade;
          ctx.strokeStyle = '#ffe28a';
          ctx.lineWidth = Math.max(2, cell * 0.1 * fade);
          const r = cell * (0.5 + 0.8 * f);
          ctx.strokeRect(px(e.b) - r, py(e.b) - r, r * 2, r * 2);
          break;
        }
        case 'spark': {
          ctx.fillStyle = '#ffd36a';
          for (let i = 0; i < 3; i++) {
            const ang = hash(e.id * 7 + e.born * 13 + i) * Math.PI * 2;
            const d = cell * (0.25 + 0.5 * f) ;
            ctx.globalAlpha = fade;
            ctx.fillRect(px(e.b) + Math.cos(ang) * d - 1, py(e.b) + Math.sin(ang) * d - 1, 2.5, 2.5);
          }
          break;
        }
        case 'mine': {
          ctx.fillStyle = SHARD;
          ctx.globalAlpha = fade;
          for (let i = 0; i < 4; i++) {
            const ang = (i / 4) * Math.PI * 2 + f * 2;
            const d = cell * 0.45 * (0.4 + f);
            const x = px(e.c) + Math.cos(ang) * d, y = py(e.c) + Math.sin(ang) * d - cell * 0.1 * f;
            const s = Math.max(1.5, cell * 0.09);
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
          }
          if (e.w) {
            // the picked-up load hops from the field to the worker
            const k = smooth(clamp01(f * 1.4));
            ctx.globalAlpha = 1 - clamp01((f - 0.7) / 0.3);
            gem(ctx, lerp(px(e.c), px(e.w), k), lerp(py(e.c), py(e.w), k) - Math.sin(k * Math.PI) * cell * 0.4, cell * 0.14);
          }
          break;
        }
        case 'deliver': {
          const k = smooth(clamp01(f * 1.6));
          ctx.globalAlpha = 1 - clamp01((f - 0.75) / 0.25);
          gem(ctx, lerp(px(e.w), px(e.core), k), lerp(py(e.w), py(e.core), k) - Math.sin(k * Math.PI) * cell * 0.5, cell * 0.16);
          if (cell >= 14) {
            ctx.globalAlpha = clamp01(2 * fade);
            ctx.fillStyle = SHARD;
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.lineWidth = 3;
            ctx.font = `bold ${Math.floor(cell * 0.42)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            const x = px(e.core), y = py(e.core) - cell * (0.7 + 0.6 * f);
            ctx.strokeText(`+${e.amount}`, x, y); ctx.fillText(`+${e.amount}`, x, y);
          }
          break;
        }
        case 'blocked': {
          if (cell < 14) break;
          ctx.globalAlpha = fade;
          ctx.fillStyle = '#ffcc55';
          ctx.font = `bold ${Math.floor(cell * 0.5)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('!', px(e.b), py(e.b) - cell * 0.5 - cell * 0.2 * f);
          break;
        }
        default:
      }
    }
    ctx.restore();
  }

  return {
    advance, unitPos, flash, drawSites, drawEffects,
    get tick() { return tick; },
    get effects() { return effects; },
  };
}

function gem(ctx, x, y, r) {
  ctx.fillStyle = SHARD;
  ctx.strokeStyle = '#eafffb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.8, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.8, y);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}
