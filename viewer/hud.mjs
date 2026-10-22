// Driftfall HUD: scoreboard (Shards, value share, unit counts), minimap, time bar (play / pause / speed / scrub
// with a value-lead ribbon) and a result banner. The data helpers are pure so node tests can run them; only
// mountHud touches the DOM, and it injects its own CSS (classes start with df-).
//
// const hud = mountHud(rootEl, { log, colors, onSeek(t), onPlay(), onPause(), onSpeed(ticksPerSecond), onMapClick(x, y) });
// hud.update({ state, tick, last, playing, speed });
import { createReplayer, valueOf, countsOf } from './replay.mjs';

export const SPEEDS = [
  { label: '0.2×', tps: 2 },
  { label: '1×', tps: 10 },
  { label: '3×', tps: 30 },
  { label: '10×', tps: 100 },
];
const UNIT_KINDS = ['worker', 'grunt', 'lancer', 'brute'];
const SHARD = '#46dcc8';
const TICKS_PER_SECOND = 10; // "1×" speed; used only to print a game clock

export function formatClock(tick) {
  const s = Math.floor(tick / TICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Everything the scoreboard shows for one moment. Pure.
export function hudModel(state, log) {
  const sides = [0, 1].map((p) => {
    const c = countsOf(state, p);
    return {
      player: p,
      name: log?.players?.[p] ?? `Player ${p}`,
      shards: state.shards[p] ?? 0,
      value: valueOf(state, p, log?.stats),
      units: Object.fromEntries(UNIT_KINDS.map((k) => [k, c.units[k] ?? 0])),
      totalUnits: c.totalUnits,
      forges: c.structures.forge ?? 0,
      turrets: c.structures.turret ?? 0,
      sites: c.sites,
      core: (state.structures.find((s) => s.kind === 'core' && s.owner === p)?.hp) ?? 0,
    };
  });
  const total = sides[0].value + sides[1].value;
  return { sides, share0: total > 0 ? sides[0].value / total : 0.5 };
}

// Share of total value held by side 0, for every tick 0..last. Used for the ribbon behind the scrub bar.
export function valueSeries(log) {
  const r = createReplayer(log);
  const out = [];
  for (let t = 0; t <= r.last; t++) {
    r.seek(t);
    const a = valueOf(r.state, 0, log.stats), b = valueOf(r.state, 1, log.stats);
    out.push(a + b > 0 ? a / (a + b) : 0.5);
  }
  return out;
}

export function bannerText(result, log) {
  if (!result) return null;
  const name = (p) => log?.players?.[p] ?? `Player ${p}`;
  const draw = result.winner === null || result.winner === undefined;
  const reasons = { core: 'Core destroyed', 'both-cores': 'both Cores destroyed', timeout: draw ? 'time ran out with equal value' : 'time ran out, higher value wins', forfeit: 'forfeit', errors: 'too many errors', load: 'could not load' };
  return {
    title: draw ? 'Draw' : `${name(result.winner)} wins`,
    winner: draw ? null : result.winner,
    detail: `${reasons[result.reason] ?? result.reason} · tick ${result.tick} · final value ${result.value?.[0] ?? '?'} to ${result.value?.[1] ?? '?'}`,
  };
}

// Where each thing goes on the minimap. Pure; returns rectangles in pixel space.
export function minimapShapes(state, size) {
  const cell = size / Math.max(state.width, state.height);
  return {
    cell,
    rocks: state.rocks.map(([x, y]) => ({ x: x * cell, y: y * cell })),
    crystals: state.crystals.filter((c) => c.amount > 0).map((c) => ({ x: c.x * cell, y: c.y * cell })),
    structures: state.structures.map((s) => ({ x: s.x * cell, y: s.y * cell, owner: s.owner, kind: s.kind, complete: s.complete })),
    units: state.units.map((u) => ({ x: (u.x + 0.5) * cell, y: (u.y + 0.5) * cell, owner: u.owner, kind: u.kind })),
  };
}

export function drawMinimap(ctx, state, size, colors) {
  const m = minimapShapes(state, size);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#4a515c';
  for (const r of m.rocks) ctx.fillRect(r.x, r.y, m.cell, m.cell);
  ctx.fillStyle = SHARD;
  for (const c of m.crystals) ctx.fillRect(c.x + m.cell * 0.2, c.y + m.cell * 0.2, m.cell * 0.6, m.cell * 0.6);
  for (const s of m.structures) {
    ctx.fillStyle = colors[s.owner] ?? '#ccc';
    ctx.globalAlpha = s.complete ? 1 : 0.4;
    const pad = s.kind === 'core' ? -m.cell * 0.4 : 0;
    ctx.fillRect(s.x + pad, s.y + pad, m.cell - 2 * pad, m.cell - 2 * pad);
  }
  ctx.globalAlpha = 1;
  for (const u of m.units) {
    ctx.fillStyle = colors[u.owner] ?? '#ccc';
    ctx.beginPath();
    ctx.arc(u.x, u.y, Math.max(1.2, m.cell * (u.kind === 'brute' ? 0.45 : 0.32)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#2b323d';
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}

const CSS = `
.df-hud{display:flex;flex-direction:column;gap:10px;font:13px/1.35 system-ui,sans-serif;color:#e6e9ee;position:relative}
.df-score{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.df-side{background:#1d222a;border:1px solid #2b323d;border-top:3px solid var(--c);border-radius:6px;padding:6px 10px}
.df-side h4{margin:0 0 2px;font-size:13px;color:var(--c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.df-big{display:flex;gap:14px}
.df-big span{display:block;font-size:10px;color:#8b95a5;text-transform:uppercase;letter-spacing:.05em}
.df-big b{font-size:19px;font-variant-numeric:tabular-nums}
.df-big .df-shards b{color:${SHARD}}
.df-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.df-chip{background:#0006;border-radius:10px;padding:0 7px;font-size:11px;font-variant-numeric:tabular-nums;color:#c5ccd8}
.df-chip.df-zero{opacity:.35}
.df-share{height:8px;border-radius:4px;overflow:hidden;display:flex;background:#2b323d}
.df-share i{display:block;height:100%;transition:width .12s}
.df-mini{align-self:flex-start;border:1px solid #2b323d;border-radius:4px;cursor:crosshair;display:block}
.df-bar{background:#1d222a;border:1px solid #2b323d;border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:4px}
.df-row{display:flex;align-items:center;gap:8px}
.df-btn{background:#262c36;color:#e6e9ee;border:1px solid #2b323d;border-radius:5px;padding:3px 9px;cursor:pointer;font:inherit;min-width:34px}
.df-btn:hover{border-color:#8b95a5}
.df-btn.df-on{background:#37465c;border-color:#6d86a8}
.df-time{font-variant-numeric:tabular-nums;color:#8b95a5;min-width:150px;text-align:right;margin-left:auto}
.df-track{position:relative;height:34px}
.df-ribbon{position:absolute;left:0;top:0;width:100%;height:18px;border-radius:3px;background:#2b323d}
.df-track input{position:absolute;left:0;top:14px;width:100%;margin:0;height:18px}
.df-banner{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none}
.df-banner.df-on{display:flex}
.df-card{background:rgba(10,12,16,.88);border:2px solid var(--c,#8b95a5);border-radius:10px;padding:16px 28px;text-align:center;animation:df-pop .5s ease-out;box-shadow:0 0 40px #000a}
.df-card h2{margin:0;font-size:30px;letter-spacing:.04em;color:var(--c,#e6e9ee)}
.df-card p{margin:6px 0 0;color:#c5ccd8}
@keyframes df-pop{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountHud(root, { log, colors = ['#4aa3ff', '#ff9a3c'], onSeek, onPlay, onPause, onSpeed, onMapClick } = {}) {
  if (!document.getElementById('df-hud-css')) {
    const st = el('style');
    st.id = 'df-hud-css';
    st.textContent = CSS;
    document.head.append(st);
  }
  const hud = el('div', 'df-hud');
  root.append(hud);

  // scoreboard
  const score = el('div', 'df-score');
  const sideEls = [0, 1].map((p) => {
    const box = el('div', 'df-side');
    box.style.setProperty('--c', colors[p]);
    const name = el('h4');
    const big = el('div', 'df-big');
    const mk = (label, cls) => { const d = el('div', cls); d.append(el('span', '', label)); const b = el('b', '', '0'); d.append(b); big.append(d); return b; };
    const shards = mk('Shards', 'df-shards'), value = mk('Value'), units = mk('Units');
    const chips = el('div', 'df-chips');
    box.append(name, big, chips);
    score.append(box);
    return { name, shards, value, units, chips };
  });
  const share = el('div', 'df-share');
  const s0 = el('i'), s1 = el('i');
  s0.style.background = colors[0]; s1.style.background = colors[1];
  share.append(s0, s1);

  // minimap
  const MINI = 160;
  const mini = el('canvas', 'df-mini');
  mini.width = MINI; mini.height = MINI;
  mini.style.width = mini.style.height = `${MINI}px`;
  const mctx = mini.getContext('2d');
  let lastState = null;
  mini.addEventListener('click', (e) => {
    if (!lastState || !onMapClick) return;
    const r = mini.getBoundingClientRect();
    const cell = r.width / Math.max(lastState.width, lastState.height);
    onMapClick(Math.floor((e.clientX - r.left) / cell), Math.floor((e.clientY - r.top) / cell));
  });

  // time bar
  const bar = el('div', 'df-bar');
  const row = el('div', 'df-row');
  const first = el('button', 'df-btn', '⏮'), back = el('button', 'df-btn', '◀'), play = el('button', 'df-btn', '▶ Play');
  const fwd = el('button', 'df-btn', '▶|'), end = el('button', 'df-btn', '⏭');
  first.title = 'Back to the start'; back.title = 'One tick back'; fwd.title = 'One tick forward'; end.title = 'Jump to the end';
  const speedBtns = SPEEDS.map((s) => { const b = el('button', 'df-btn', s.label); b.onclick = () => onSpeed?.(s.tps); return b; });
  const time = el('span', 'df-time', '0:00 · tick 0 / 0');
  row.append(first, back, play, fwd, end, ...speedBtns, time);
  const track = el('div', 'df-track');
  const ribbon = el('canvas', 'df-ribbon');
  const scrub = el('input');
  scrub.type = 'range'; scrub.min = '0'; scrub.max = '0'; scrub.value = '0'; scrub.step = '1';
  track.append(ribbon, scrub);
  bar.append(row, track);

  const banner = el('div', 'df-banner');
  hud.append(score, share, mini, bar, banner);

  let tickNow = 0, lastTick = 0, playing = false;
  play.onclick = () => (playing ? onPause?.() : onPlay?.());
  first.onclick = () => onSeek?.(0);
  back.onclick = () => onSeek?.(Math.max(0, tickNow - 1));
  fwd.onclick = () => onSeek?.(Math.min(lastTick, tickNow + 1));
  end.onclick = () => onSeek?.(lastTick);
  scrub.oninput = () => onSeek?.(Number(scrub.value));

  // The ribbon shows who is ahead on value over the whole match: side 0's share fills from the top down.
  let series = null;
  function drawRibbon() {
    if (!series) { try { series = log ? valueSeries(log) : []; } catch { series = []; } }
    const w = ribbon.clientWidth || 300;
    ribbon.width = w; ribbon.height = 18;
    const c = ribbon.getContext('2d');
    c.clearRect(0, 0, w, 18);
    for (let x = 0; x < w; x++) {
      const i = series.length ? Math.round((x / Math.max(1, w - 1)) * (series.length - 1)) : 0;
      const k = series[i] ?? 0.5;
      c.fillStyle = colors[0]; c.globalAlpha = 0.75; c.fillRect(x, 0, 1, 18 * k);
      c.fillStyle = colors[1]; c.fillRect(x, 18 * k, 1, 18 * (1 - k));
    }
    c.globalAlpha = 1;
    c.fillStyle = '#ffffff55'; c.fillRect(0, 8, w, 1);
  }
  let ribbonDrawn = false, bannerKey = '';

  function update({ state, tick, last, playing: isPlaying, speed }) {
    lastState = state; tickNow = tick; lastTick = last; playing = !!isPlaying;
    const m = hudModel(state, log);
    m.sides.forEach((s, i) => {
      const e = sideEls[i];
      e.name.textContent = s.name;
      e.shards.textContent = String(s.shards);
      e.value.textContent = String(s.value);
      e.units.textContent = String(s.totalUnits);
      e.chips.replaceChildren(
        ...UNIT_KINDS.map((k) => el('span', 'df-chip' + (s.units[k] ? '' : ' df-zero'), `${k} ${s.units[k]}`)),
        el('span', 'df-chip' + (s.forges ? '' : ' df-zero'), `forge ${s.forges}`),
        el('span', 'df-chip' + (s.turrets ? '' : ' df-zero'), `turret ${s.turrets}`),
        ...(s.sites ? [el('span', 'df-chip', `building ${s.sites}`)] : []),
        el('span', 'df-chip', `core hp ${s.core}`),
      );
    });
    s0.style.width = `${m.share0 * 100}%`;
    s1.style.width = `${(1 - m.share0) * 100}%`;
    drawMinimap(mctx, state, MINI, colors);
    play.textContent = playing ? '⏸ Pause' : '▶ Play';
    speedBtns.forEach((b, i) => b.classList.toggle('df-on', SPEEDS[i].tps === speed));
    scrub.max = String(last);
    scrub.value = String(tick);
    time.textContent = `${formatClock(tick)} · tick ${tick} / ${last}`;
    if (!ribbonDrawn) { drawRibbon(); ribbonDrawn = true; }
    const b = bannerText(state.result, log);
    banner.classList.toggle('df-on', !!b);
    const key = b ? b.title + b.detail : '';
    if (b && key !== bannerKey) {
      bannerKey = key;
      banner.replaceChildren();
      const card = el('div', 'df-card');
      if (b.winner !== null) card.style.setProperty('--c', colors[b.winner]);
      card.append(el('h2', '', b.title), el('p', '', b.detail));
      banner.append(card);
    } else if (!b) bannerKey = '';
  }

  return { update, el: hud, redrawRibbon: () => { ribbonDrawn = false; } };
}
