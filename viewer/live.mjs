// Driftfall TV match screen (owner: haiku). A full-screen page for a big screen: plays one match log, or a list of
// logs, on a loop, showing both players' names and colors, the board, effects and a HUD.
//
// Everything above the browser wiring is plain logic with no DOM, so tests/live-viewer.test.mjs can import it in node.
// Replay uses viewer/replay.mjs, which must exist. The optional pieces are loaded only if their file exists; a
// missing or broken piece falls back to simple shapes (or no HUD panel) and the page keeps running:
//   art.mjs  (fable)  drawTerrain(ctx, state, {cell, time, fullCrystal}), drawStructure(ctx, s, {cell, time, maxHp,
//                     buildTicks, hit}), drawUnit(ctx, u, {cell, time, maxHp, hit, ox, oy}). Drawn in board pixels.
//   fx.mjs   (sonnet) createFx({log, colors}) -> { advance(state, tick, events), unitPos(u, alpha), drawSites(ctx, cell,
//                     state, alpha), drawEffects(ctx, cell, alpha) }. One instance per match.
//   hud.mjs  (sonnet) mountHud(root, {log, colors, onSeek, onPlay, onPause, onSpeed}) -> { update({state, tick, last,
//                     playing, speed}) }. A DOM panel; it takes the right-hand side of the screen when present.
import { createReplayer, valueOf, countsOf, statFor } from './replay.mjs';

export const SIDE_COLORS = ['#4aa3ff', '#ff9a3c'];
export const HIT_COLOR = '#ff4040';
export const DEFAULT_SPEED = 10; // ticks per second
export const DEFAULT_HOLD_MS = 6000; // how long the final board stays up before the next match
export const HUD_PANEL_MAX = 340; // widest the HUD panel gets, in CSS pixels
const MIN_SPEED = 1;
const MAX_SPEED = 200;
const OPTIONAL_MODULES = ['art', 'fx', 'hud'];
const REASON_TEXT = {
  core: 'enemy Core destroyed',
  'both-cores': 'both Cores destroyed',
  timeout: 'more value at the time limit',
  forfeit: 'opponent forfeited',
  errors: 'too many errors',
  load: 'could not load',
};

const clamp = (s) => Math.max(MIN_SPEED, Math.min(MAX_SPEED, s));
const clamp01 = (a) => (a < 0 ? 0 : a > 1 ? 1 : a);

// ---------- inputs ----------

// Returns a plain-English problem with a log, or null when it can be played.
export function problemWith(data) {
  if (!data || typeof data !== 'object') return 'the file is not a JSON object';
  if (data.format !== 'driftfall-log') return 'this is not a Driftfall match log';
  if (!data.initial || typeof data.initial !== 'object') return 'the log has no starting state';
  if (!Array.isArray(data.ticks)) return 'the log has no list of ticks';
  return null;
}

// Reads the page address: ?log=a.json (repeat for more), ?list=matches.json, ?speed=10 (ticks a second), ?hold=6 (seconds).
export function parseSearch(search) {
  const p = new URLSearchParams(search);
  const positive = (key, fallback) => {
    const n = Number(p.get(key));
    return p.has(key) && Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    logs: p.getAll('log'),
    list: p.get('list'),
    speed: clamp(positive('speed', DEFAULT_SPEED)),
    holdMs: positive('hold', DEFAULT_HOLD_MS / 1000) * 1000,
  };
}

// A list file is either an array of paths or { "matches": [paths] }. Paths are relative to the list file.
export function expandList(json, listUrl) {
  const items = Array.isArray(json) ? json : Array.isArray(json?.matches) ? json.matches : null;
  if (!items) throw new Error('the list must be an array of log paths, or an object with a "matches" array');
  return items.filter((s) => typeof s === 'string' && s.trim()).map((s) => new URL(s, listUrl).href);
}

// ---------- matches and players ----------

export function sideOf(log, p) {
  const name = String(log?.players?.[p] ?? '').trim();
  return { index: p, name: name || `Player ${p + 1}`, color: SIDE_COLORS[p] };
}

// Wraps one log for playback. Throws with a plain message when the log is not playable.
export function createMatch(data, name = '') {
  const problem = problemWith(data);
  if (problem) throw new Error(problem);
  const replayer = createReplayer(data);
  let crystalMax = 1;
  for (const c of data.initial.crystals ?? []) crystalMax = Math.max(crystalMax, c.amount);
  return {
    log: data,
    name,
    seed: data.seed,
    players: [sideOf(data, 0), sideOf(data, 1)],
    result: data.result ?? null,
    crystalMax,
    get last() { return replayer.last; },
    get state() { return replayer.state; },
    seek: (t) => replayer.seek(t),
    eventsAt: (t) => replayer.eventsAt(t),
  };
}

// Plays a list of matches in order on a loop. The clock is driven by update(dtMs), so it never needs real timers.
// onTick(events, tick, match) runs for every tick passed, after the state has been moved to that tick, so effects
// see every event. onMatch(match, index) runs when a match starts.
export function createTheater({ matches, speed = DEFAULT_SPEED, holdMs = DEFAULT_HOLD_MS, onTick, onMatch }) {
  if (!matches?.length) throw new Error('no matches to play');
  let holdLeft = 0;
  let acc = 0;
  const theater = {
    index: 0,
    tick: 0,
    playing: true,
    speed: clamp(speed),
    holdMs,
    get match() { return matches[theater.index]; },
    get count() { return matches.length; },
    get holding() { return theater.tick >= theater.match.last; },
    // How far into the next tick the picture is, 0..1. Paused or finished boards show a whole tick.
    get fraction() { return theater.playing && !theater.holding ? clamp01(acc) : 1; },
    update(dtMs) {
      if (!theater.playing) return;
      const m = theater.match;
      if (theater.tick >= m.last) {
        holdLeft -= dtMs;
        if (holdLeft <= 0) show(theater.index + 1);
        return;
      }
      acc += (dtMs / 1000) * theater.speed;
      const n = Math.floor(acc);
      if (n <= 0) return;
      acc -= n;
      advanceTo(Math.min(m.last, theater.tick + n));
      if (theater.tick >= m.last) holdLeft = theater.holdMs;
    },
    // Jump to any tick. Backwards jumps rebuild the picture from the log.
    jump(t) {
      const m = theater.match;
      const target = Math.max(0, Math.min(m.last, Math.floor(t)));
      acc = 0;
      if (target > theater.tick) {
        advanceTo(target);
      } else {
        m.seek(target);
        theater.tick = target;
        onTick?.(m.eventsAt(target), target, m);
      }
    },
    togglePause() { theater.playing = !theater.playing; acc = 0; },
    setSpeed(tps) { theater.speed = clamp(tps); },
    next() { show(theater.index + 1); },
    prev() { show(theater.index - 1); },
    restart() { show(theater.index); },
    faster() { theater.speed = clamp(theater.speed * 1.5); },
    slower() { theater.speed = clamp(theater.speed / 1.5); },
  };

  function show(i) {
    const n = matches.length;
    theater.index = ((i % n) + n) % n;
    theater.tick = 0;
    acc = 0;
    holdLeft = 0;
    theater.match.seek(0);
    onMatch?.(theater.match, theater.index);
  }

  function advanceTo(target) {
    const m = theater.match;
    for (let t = theater.tick + 1; t <= target; t++) {
      m.seek(t);
      onTick?.(m.eventsAt(t), t, m);
    }
    m.seek(target);
    theater.tick = target;
  }

  show(0);
  return theater;
}

// ---------- optional modules ----------

// Loads art, fx and hud if they exist. A missing or broken file gives null for that name, so the page still runs.
export async function loadOptional(load = (name) => import(`./${name}.mjs`)) {
  const mods = {};
  for (const name of OPTIONAL_MODULES) {
    try {
      mods[name] = await load(name);
    } catch (err) {
      console.warn(`${name}.mjs not loaded, using simple shapes: ${err.message}`);
      mods[name] = null;
    }
  }
  return mods;
}

// `mods.fx` is the effects module (it provides createFx) and `mods.hud` the HUD module (it provides mountHud). The
// effects instance for the current match is kept in screen.mods.fx; the HUD panel is screen.hud when hudOn is true.
export function createScreen(mods = {}) {
  return {
    mods: { art: mods.art ?? null, fx: null, hud: mods.hud ?? null },
    fxFactory: mods.fx ?? null,
    hudModule: mods.hud ?? null,
    hud: null,
    hudOn: false,
    hudKey: '',
    clock: 0,
    faults: [],
  };
}

// Calls one function of an optional module. Returns true when it ran, false when it is missing or failed. If it throws,
// that module is switched off for the rest of the match and the fault is recorded.
function callMod(screen, name, method, args) {
  const mod = screen.mods[name];
  if (!mod || typeof mod[method] !== 'function') return false;
  try {
    mod[method](...args);
    return true;
  } catch (err) {
    screen.mods[name] = null;
    screen.faults.push(`${name}.${method}`);
    console.error(`${name}.mjs failed in ${method}, using simple shapes from now on:`, err);
    return false;
  }
}

// A fresh effects instance for each match, so a new match never inherits the last one's overlays.
export function startEffects(screen, match) {
  screen.mods.fx = null;
  const create = screen.fxFactory?.createFx;
  if (typeof create !== 'function') return;
  try {
    screen.mods.fx = create({ log: match.log, colors: SIDE_COLORS });
  } catch (err) {
    screen.faults.push('fx.createFx');
    console.error('fx.mjs could not start for this match:', err);
  }
}

export function feedEffects(screen, events, tick, match) {
  callMod(screen, 'fx', 'advance', [match.state, tick, events]);
}

export function updateScreen(screen, dtMs) {
  screen.clock += dtMs;
}

// Keeps the HUD panel in step with the clock. Called every frame; it only updates the panel when something changed.
export function updateHud(screen, theater) {
  if (!screen.hudOn || !screen.hud) return;
  const m = theater.match;
  const key = `${theater.index}:${theater.tick}:${theater.playing}:${theater.speed}`;
  if (key === screen.hudKey) return;
  screen.hudKey = key;
  try {
    screen.hud.update({ state: m.state, tick: theater.tick, last: m.last, playing: theater.playing, speed: theater.speed });
  } catch (err) {
    screen.hudOn = false;
    screen.hud = null;
    screen.faults.push('hud.update');
    console.error('hud.mjs failed in update, using the simple header and footer from now on:', err);
  }
}

// ---------- layout ----------

// Width of the HUD panel on a screen this wide, in CSS pixels. The page sizes the panel with the same number.
export function panelWidthFor(width) {
  return Math.min(HUD_PANEL_MAX, Math.round(width * 0.3));
}

// Without the HUD panel: a header across the top, a footer across the bottom, and the square board centred between.
// With the HUD panel (side = true): the board fills the screen to the left of a panel on the right.
export function layout(width, height, mapWidth, mapHeight, { side = false } = {}) {
  if (side) {
    const panelW = panelWidthFor(width);
    const areaW = width - panelW;
    const cell = Math.max(1, Math.floor(Math.min(areaW / mapWidth, height / mapHeight)));
    const w = cell * mapWidth;
    const h = cell * mapHeight;
    return {
      width,
      height,
      header: { x: 0, y: 0, w: 0, h: 0 },
      footer: { x: 0, y: height, w: 0, h: 0 },
      panel: { x: areaW, y: 0, w: panelW, h: height },
      board: { x: Math.floor((areaW - w) / 2), y: Math.floor((height - h) / 2), w, h, cell },
    };
  }
  const headerH = Math.round(height * 0.14);
  const footerH = Math.round(height * 0.08);
  const areaH = height - headerH - footerH;
  const cell = Math.max(1, Math.floor(Math.min(width / mapWidth, areaH / mapHeight)));
  const w = cell * mapWidth;
  const h = cell * mapHeight;
  return {
    width,
    height,
    header: { x: 0, y: 0, w: width, h: headerH },
    footer: { x: 0, y: height - footerH, w: width, h: footerH },
    panel: null,
    board: { x: Math.floor((width - w) / 2), y: headerH + Math.floor((areaH - h) / 2), w, h, cell },
  };
}

// ---------- drawing with simple shapes (used until the art lands) ----------

function polygon(ctx, cx, cy, r, sides, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function hpBar(ctx, box, hp, maxHp) {
  const max = maxHp || hp || 1;
  const frac = clamp01(hp / max);
  if (frac >= 1) return;
  ctx.fillStyle = '#000a';
  ctx.fillRect(box.x + 2, box.y + box.h - 4, box.w - 4, 3);
  ctx.fillStyle = frac > 0.5 ? '#5fd35f' : frac > 0.25 ? '#e0c040' : '#e05050';
  ctx.fillRect(box.x + 2, box.y + box.h - 4, (box.w - 4) * frac, 3);
}

// box is in board pixels: { x, y, w, h } with w = h = cell.
function shapeTerrain(ctx, tile, box, crystalMax) {
  if (tile.kind === 'rock') {
    ctx.fillStyle = '#4a515c';
    ctx.fillRect(box.x + 1, box.y + 1, box.w - 1, box.h - 1);
    return;
  }
  ctx.fillStyle = tile.amount > 0 ? `rgba(70,220,200,${0.35 + 0.65 * clamp01(tile.amount / crystalMax)})` : '#2a3a3a';
  polygon(ctx, box.x + box.w / 2, box.y + box.h / 2, box.w / 2 - 1, 4, -Math.PI / 2);
  ctx.fill();
}

function shapeUnit(ctx, u, box, color, hit, maxHp) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = box.w * 0.36;
  ctx.fillStyle = hit ? HIT_COLOR : color;
  ctx.strokeStyle = '#0008';
  ctx.lineWidth = 1;
  switch (u.kind) {
    case 'worker':
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case 'grunt':
      ctx.beginPath();
      ctx.rect(cx - r, cy - r, r * 2, r * 2);
      break;
    case 'lancer':
      polygon(ctx, cx, cy + 1, r * 1.2, 3, -Math.PI / 2);
      break;
    case 'brute':
      ctx.beginPath();
      ctx.rect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
      break;
    default:
      polygon(ctx, cx, cy, r, 5);
  }
  ctx.fill();
  ctx.stroke();
  if (u.kind === 'worker' && u.carrying > 0) {
    ctx.fillStyle = '#46dcc8';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
  }
  hpBar(ctx, box, u.hp, maxHp);
}

function shapeStructure(ctx, s, box, color, hit, maxHp, buildTicks) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = box.w * 0.46;
  ctx.lineWidth = 2;
  ctx.strokeStyle = hit ? HIT_COLOR : color;
  ctx.fillStyle = hit ? HIT_COLOR : color;
  ctx.globalAlpha = s.complete ? 1 : 0.4;
  if (!s.complete) ctx.setLineDash([3, 3]);
  switch (s.kind) {
    case 'core':
      polygon(ctx, cx, cy, r * 1.15, 4, 0);
      ctx.fill();
      break;
    case 'forge':
      polygon(ctx, cx, cy, r, 6, 0);
      ctx.fill();
      break;
    case 'turret':
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.strokeRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (!s.complete) {
    if (buildTicks) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(box.x + 2, box.y + 1, (box.w - 4) * clamp01((s.progress ?? 0) / buildTicks), 2);
    }
  } else {
    hpBar(ctx, box, s.hp, maxHp);
    if (s.queue?.length) {
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.floor(box.w * 0.4)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(String(s.queue.length), cx, cy + box.h * 0.15);
    }
  }
}

function hitIdsAt(match, tick) {
  const ids = new Set();
  for (const ev of match.eventsAt(tick)) if (ev.e === 'hit') ids.add(ev.id);
  return ids;
}

// Draws the play area in board pixels: grid, terrain, sites and structures, units, then effects.
// Art is used when it is there; otherwise the simple shapes above. `alpha` is how far into the tick the picture is.
export function drawBoard(ctx, screen, match, tick, board, alpha = 1) {
  const st = match.state;
  const cell = board.cell;
  const time = screen.clock / 1000;
  const stats = match.log.stats;
  const hit = hitIdsAt(match, tick);
  const fx = screen.mods.fx;

  ctx.save();
  ctx.translate(board.x, board.y);
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, board.w, board.h);

  if (!callMod(screen, 'art', 'drawTerrain', [ctx, st, { cell, time, fullCrystal: match.crystalMax }])) {
    ctx.strokeStyle = '#1a1f27';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= st.width; i++) {
      ctx.moveTo(i * cell + 0.5, 0);
      ctx.lineTo(i * cell + 0.5, st.height * cell);
    }
    for (let j = 0; j <= st.height; j++) {
      ctx.moveTo(0, j * cell + 0.5);
      ctx.lineTo(st.width * cell, j * cell + 0.5);
    }
    ctx.stroke();
    for (const [x, y] of st.rocks) shapeTerrain(ctx, { kind: 'rock' }, tileBox(x, y, cell), match.crystalMax);
    for (const c of st.crystals) shapeTerrain(ctx, { kind: 'crystal', amount: c.amount }, tileBox(c.x, c.y, cell), match.crystalMax);
  }

  for (const s of st.structures) {
    const color = SIDE_COLORS[s.owner] ?? '#ccc';
    const maxHp = statFor(stats, s.kind)?.hp;
    const buildTicks = statFor(stats, s.kind)?.buildTicks;
    const isHit = hit.has(s.id);
    if (!callMod(screen, 'art', 'drawStructure', [ctx, s, { cell, time, maxHp, buildTicks, hit: isHit }])) {
      shapeStructure(ctx, s, tileBox(s.x, s.y, cell), color, isHit, maxHp, buildTicks);
    }
  }
  if (fx) callMod(screen, 'fx', 'drawSites', [ctx, cell, st, alpha]);

  for (const u of st.units) {
    const color = SIDE_COLORS[u.owner] ?? '#ccc';
    const maxHp = statFor(stats, u.kind)?.hp;
    const isHit = hit.has(u.id);
    const at = fx?.unitPos ? fx.unitPos(u, alpha) : { x: u.x, y: u.y };
    const ox = (at.x - u.x) * cell;
    const oy = (at.y - u.y) * cell;
    if (!callMod(screen, 'art', 'drawUnit', [ctx, u, { cell, time, maxHp, hit: isHit, ox, oy }])) {
      shapeUnit(ctx, u, { x: u.x * cell + ox, y: u.y * cell + oy, w: cell, h: cell }, color, isHit, maxHp);
    }
  }
  if (fx) callMod(screen, 'fx', 'drawEffects', [ctx, cell, alpha]);
  ctx.restore();
}

function tileBox(x, y, cell) {
  return { x: x * cell, y: y * cell, w: cell, h: cell };
}

// ---------- HUD text (shared by the canvas fallback and the result line) ----------

export function resultText(match) {
  const r = match.state.result;
  if (!r) return null;
  const who = r.winner === null || r.winner === undefined ? 'Draw' : `${match.players[r.winner].name} wins`;
  const why = REASON_TEXT[r.reason] ?? r.reason;
  return `${who}: ${why}, at tick ${r.tick}`;
}

export function infoFor(theater, lay) {
  const m = theater.match;
  const st = m.state;
  const sides = m.players.map((p, i) => {
    const counts = countsOf(st, i);
    const buildings = Object.values(counts.structures).reduce((a, b) => a + b, 0);
    return {
      ...p,
      shards: st.shards[i],
      value: valueOf(st, i, m.log.stats),
      units: counts.totalUnits,
      buildings,
    };
  });
  return {
    match: { name: m.name, index: theater.index, count: theater.count, seed: m.seed },
    tick: theater.tick,
    last: m.last,
    playing: theater.playing,
    speed: theater.speed,
    sides,
    resultText: resultText(m),
    board: lay.board,
  };
}

// Header and footer drawn on the canvas, used when the HUD panel is not there.
function drawFallbackHud(ctx, info, lay) {
  const { header, footer, width } = lay;
  ctx.fillStyle = '#12161d';
  ctx.fillRect(header.x, header.y, header.w, header.h);
  const big = Math.max(14, Math.round(header.h * 0.26));
  const small = Math.max(11, Math.round(header.h * 0.17));
  const pad = Math.round(header.h * 0.14);

  info.sides.forEach((s, i) => {
    const left = i === 0;
    const x = left ? pad * 1.5 : width - pad * 1.5;
    ctx.textAlign = left ? 'left' : 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = s.color;
    ctx.font = `bold ${big}px system-ui`;
    ctx.fillText(s.name, x, pad);
    ctx.fillStyle = '#cfd6df';
    ctx.font = `${small}px system-ui`;
    ctx.fillText(`Shards ${s.shards} · Value ${s.value}`, x, pad + big * 1.5);
    ctx.fillText(`Units ${s.units} · Buildings ${s.buildings}`, x, pad + big * 1.5 + small * 1.4);
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#cfd6df';
  ctx.font = `${small}px system-ui`;
  const where = info.match.name ? ` · ${info.match.name}` : '';
  ctx.fillText(`Match ${info.match.index + 1} of ${info.match.count}${where} · seed ${info.match.seed}`, width / 2, pad);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${big}px system-ui`;
  ctx.fillText(`tick ${info.tick} / ${info.last}`, width / 2, pad + small * 1.6);
  if (info.resultText) {
    ctx.fillStyle = '#ffd966';
    ctx.font = `bold ${small}px system-ui`;
    ctx.fillText(info.resultText, width / 2, pad + big * 2.6);
  }

  ctx.fillStyle = '#2a303a';
  ctx.fillRect(footer.x, footer.y, footer.w, 4);
  ctx.fillStyle = '#e0c040';
  ctx.fillRect(footer.x, footer.y, footer.w * clamp01(info.tick / Math.max(1, info.last)), 4);
  ctx.fillStyle = '#cfd6df';
  ctx.font = `${small}px system-ui`;
  ctx.textBaseline = 'middle';
  const fy = footer.y + footer.h / 2 + 2;
  ctx.textAlign = 'left';
  ctx.fillText(`${info.playing ? 'Playing' : 'Paused'} · ${info.speed} ticks a second`, pad * 1.5, fy);
  ctx.textAlign = 'right';
  ctx.fillText('space pause · N next · P previous · R restart · + / - speed', width - pad * 1.5, fy);
}

// Draws one whole frame of the canvas. `width` and `height` are the canvas size in CSS pixels. When the HUD panel is
// mounted (screen.hudOn), the panel's own DOM covers the right-hand side and nothing is drawn there.
export function drawFrame(ctx, { width, height, theater, screen }) {
  const m = theater.match;
  const st = m.state;
  const lay = layout(width, height, st.width, st.height, { side: screen.hudOn });
  const info = infoFor(theater, lay);

  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, width, height);
  drawBoard(ctx, screen, m, theater.tick, lay.board, theater.fraction);
  if (st.result) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(lay.board.x, lay.board.y, lay.board.w, lay.board.h);
  }
  if (!screen.hudOn) drawFallbackHud(ctx, info, lay);
  return info;
}

// ---------- browser wiring (runs only in a page, never in node tests) ----------

async function boot() {
  const canvas = document.getElementById('screen');
  const status = document.getElementById('status');
  const fileInput = document.getElementById('file');
  const hudRoot = document.getElementById('hud');
  const ctx = canvas.getContext('2d');
  const say = (text) => { status.textContent = text; };
  const opts = parseSearch(location.search);
  const screen = createScreen(await loadOptional());

  const matches = [];
  let theater = null;
  const problems = [];

  // The panel is as wide as the HUD is on, and collapses to nothing when it is off, so the board layout follows it.
  function sizePanel() {
    if (hudRoot) hudRoot.style.width = screen.hudOn ? `${panelWidthFor(window.innerWidth)}px` : '0px';
  }

  // Mounts the HUD panel for one match. Its ribbon is built from the log, so it is mounted again for each match.
  function mountPanel(m) {
    if (!screen.hudModule?.mountHud || !hudRoot) return;
    try {
      hudRoot.replaceChildren();
      screen.hud = screen.hudModule.mountHud(hudRoot, {
        log: m.log,
        colors: SIDE_COLORS,
        onSeek: (t) => theater.jump(t),
        onPlay: () => { theater.playing = true; },
        onPause: () => { theater.playing = false; },
        onSpeed: (tps) => theater.setSpeed(tps),
      });
      screen.hudOn = true;
      screen.hudKey = '';
      sizePanel();
    } catch (err) {
      screen.hudOn = false;
      screen.hud = null;
      screen.faults.push('hud.mountHud');
      hudRoot?.replaceChildren();
      sizePanel();
      console.error('hud.mjs could not mount, using the simple header and footer:', err);
    }
  }

  function addMatch(data, name) {
    matches.push(createMatch(data, name));
    if (!theater) {
      theater = createTheater({
        matches,
        speed: opts.speed,
        holdMs: opts.holdMs,
        onTick: (events, tick, m) => feedEffects(screen, events, tick, m),
        onMatch: (m) => {
          startEffects(screen, m);
          mountPanel(m);
        },
      });
    }
  }

  async function readUrl(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      addMatch(await r.json(), url.split('/').pop());
    } catch (err) {
      problems.push(`${url}: ${err.message}`);
    }
  }

  async function readFile(file) {
    try {
      addMatch(JSON.parse(await file.text()), file.name);
    } catch (err) {
      problems.push(`${file.name}: ${err.message}`);
    }
    refreshStatus();
  }

  function refreshStatus() {
    if (!matches.length) {
      say('No match loaded. Add ?log=match.json to the address, or drop a match log on this page.');
    } else {
      say(problems.join('\n'));
    }
  }

  for (const log of opts.logs) await readUrl(new URL(log, location.href).href);
  if (opts.list) {
    try {
      const listUrl = new URL(opts.list, location.href).href;
      const r = await fetch(listUrl);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      for (const url of expandList(await r.json(), listUrl)) await readUrl(url);
    } catch (err) {
      problems.push(`${opts.list}: ${err.message}`);
    }
  }
  refreshStatus();

  fileInput.onchange = () => { for (const f of fileInput.files) readFile(f); fileInput.value = ''; };
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) readFile(f);
  });
  window.addEventListener('keydown', (e) => {
    if (!theater) return;
    if (e.key === ' ') { e.preventDefault(); theater.togglePause(); }
    else if (e.key === 'n' || e.key === 'ArrowRight') theater.next();
    else if (e.key === 'p' || e.key === 'ArrowLeft') theater.prev();
    else if (e.key === 'r') theater.restart();
    else if (e.key === '+' || e.key === '=') theater.faster();
    else if (e.key === '-') theater.slower();
    else if (e.key === 'o') fileInput.click();
  });

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizePanel();
  };
  resize();
  window.addEventListener('resize', resize);

  let last = performance.now();
  let panelShown = screen.hudOn;
  function frame(now) {
    const dt = Math.min(250, now - last);
    last = now;
    if (theater) {
      theater.update(dt);
      updateScreen(screen, dt);
      updateHud(screen, theater);
      if (screen.hudOn !== panelShown) {
        panelShown = screen.hudOn;
        sizePanel();
      }
      drawFrame(ctx, { width: window.innerWidth, height: window.innerHeight, theater, screen });
    } else {
      ctx.fillStyle = '#0d0f13';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined' && document.getElementById('screen')) boot();
