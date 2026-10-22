// Driftfall viewer: loads a match log, draws the grid on a canvas, play / pause / step / scrub, side panel.
import { createReplayer, valueOf, countsOf } from './replay.mjs';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const COLORS = ['#4aa3ff', '#ff9a3c'];
const UNIT_KINDS = ['worker', 'grunt', 'lancer', 'brute'];
const STRUCT_KINDS = ['core', 'forge', 'turret'];

let log = null;
let replayer = null;
let tick = 0;
let playing = false;
let lastFrame = 0;
let acc = 0;

function loadLog(data, name = '') {
  if (!data || data.format !== 'driftfall-log' || !data.initial || !Array.isArray(data.ticks)) {
    $('title').textContent = 'That file is not a Driftfall match log.';
    return;
  }
  log = data;
  replayer = createReplayer(log);
  const last = replayer.last;
  $('scrub').max = String(last);
  const [a, b] = log.players ?? ['player 0', 'player 1'];
  $('title').textContent = `${a} vs ${b} · seed ${log.seed}${name ? ' · ' + name : ''}`;
  playing = false;
  show(0);
}

function show(t) {
  if (!replayer) return;
  tick = Math.max(0, Math.min(t, replayer.last));
  replayer.seek(tick);
  $('scrub').value = String(tick);
  $('tickLabel').textContent = `tick ${tick} / ${replayer.last}`;
  $('play').textContent = playing ? 'Pause' : 'Play';
  draw();
  updatePanel();
}

// ---------- drawing ----------

function draw() {
  const st = replayer.state;
  const W = st.width, H = st.height;
  const cell = Math.floor(Math.min(canvas.width / W, canvas.height / H));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, cell * W, cell * H);

  ctx.strokeStyle = '#1a1f27';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= W; i++) { ctx.moveTo(i * cell + 0.5, 0); ctx.lineTo(i * cell + 0.5, H * cell); }
  for (let j = 0; j <= H; j++) { ctx.moveTo(0, j * cell + 0.5); ctx.lineTo(W * cell, j * cell + 0.5); }
  ctx.stroke();

  ctx.fillStyle = '#4a515c';
  for (const [x, y] of st.rocks) ctx.fillRect(x * cell + 1, y * cell + 1, cell - 1, cell - 1);

  for (const c of st.crystals) {
    const px = c.x * cell, py = c.y * cell;
    const full = c.amount > 0;
    ctx.fillStyle = full ? `rgba(70,220,200,${0.35 + 0.65 * Math.min(1, c.amount / 400)})` : '#2a3a3a';
    ctx.beginPath();
    ctx.moveTo(px + cell / 2, py + 1);
    ctx.lineTo(px + cell - 2, py + cell / 2);
    ctx.lineTo(px + cell / 2, py + cell - 1);
    ctx.lineTo(px + 2, py + cell / 2);
    ctx.closePath();
    ctx.fill();
  }

  const hitIds = new Set();
  for (const ev of replayer.eventsAt(tick)) if (ev.e === 'hit') hitIds.add(ev.id);

  for (const s of st.structures) drawStructure(s, cell, hitIds.has(s.id));
  for (const u of st.units) drawUnit(u, cell, hitIds.has(u.id));

  if (st.result) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, cell * W, cell * H);
  }
}

function maxHpOf(kind) {
  const row = log.stats && (log.stats[kind] ?? log.stats.units?.[kind] ?? log.stats.structures?.[kind]);
  return row?.hp ?? null;
}

function hpBar(px, py, cell, hp, kind, id) {
  const max = maxHpOf(kind) ?? hp;
  const frac = Math.max(0, Math.min(1, hp / (max || 1)));
  if (frac >= 1) return;
  ctx.fillStyle = '#000a';
  ctx.fillRect(px + 2, py + cell - 4, cell - 4, 3);
  ctx.fillStyle = frac > 0.5 ? '#5fd35f' : frac > 0.25 ? '#e0c040' : '#e05050';
  ctx.fillRect(px + 2, py + cell - 4, (cell - 4) * frac, 3);
}

function polygon(cx, cy, r, sides, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawUnit(u, cell, hit) {
  const px = u.x * cell, py = u.y * cell, cx = px + cell / 2, cy = py + cell / 2;
  ctx.fillStyle = hit ? '#ff4040' : COLORS[u.owner] ?? '#ccc';
  ctx.strokeStyle = '#0008';
  ctx.lineWidth = 1;
  const r = cell * 0.36;
  switch (u.kind) {
    case 'worker': ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); break;
    case 'grunt': ctx.beginPath(); ctx.rect(cx - r, cy - r, r * 2, r * 2); break;
    case 'lancer': polygon(cx, cy + 1, r * 1.2, 3, -Math.PI / 2); break;
    case 'brute': ctx.beginPath(); ctx.rect(px + 1, py + 1, cell - 2, cell - 2); break;
    default: polygon(cx, cy, r, 5);
  }
  ctx.fill();
  ctx.stroke();
  if (u.kind === 'worker' && u.carrying > 0) {
    ctx.fillStyle = '#46dcc8';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
  }
  hpBar(px, py, cell, u.hp, u.kind, u.id);
}

function drawStructure(s, cell, hit) {
  const px = s.x * cell, py = s.y * cell, cx = px + cell / 2, cy = py + cell / 2;
  const col = hit ? '#ff4040' : COLORS[s.owner] ?? '#ccc';
  ctx.lineWidth = 2;
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.globalAlpha = s.complete ? 1 : 0.4;
  if (!s.complete) ctx.setLineDash([3, 3]);
  const r = cell * 0.46;
  switch (s.kind) {
    case 'core': polygon(cx, cy, r * 1.15, 4, 0); ctx.fill(); break;
    case 'forge': polygon(cx, cy, r, 6, 0); ctx.fill(); break;
    case 'turret':
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.3, 0, 7); ctx.fill();
      break;
    default: ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (!s.complete) {
    const total = log.stats?.[s.kind]?.buildTicks ?? log.stats?.structures?.[s.kind]?.buildTicks;
    if (total) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(px + 2, py + 1, (cell - 4) * Math.min(1, s.progress / total), 2);
    }
  } else {
    hpBar(px, py, cell, s.hp, s.kind, s.id);
  }
  if (s.complete && s.queue?.length) {
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.floor(cell * 0.4)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(String(s.queue.length), cx, cy + cell * 0.15);
  }
}

// ---------- side panel ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function updatePanel() {
  const st = replayer.state;
  const root = $('sides');
  root.replaceChildren();
  for (const p of [0, 1]) {
    const box = el('div', 'side');
    box.style.setProperty('--c', COLORS[p]);
    box.append(el('h2', '', `${log.players?.[p] ?? 'Player ' + p} (side ${p})`));
    const big = el('div', 'big');
    for (const [label, val] of [['Shards', st.shards[p]], ['Value', valueOf(st, p, log.stats)]]) {
      const d = el('div');
      d.append(el('span', '', label), el('b', '', String(val)));
      big.append(d);
    }
    box.append(big);
    const counts = countsOf(st, p);
    const table = el('table');
    const row = (k, v) => { const tr = el('tr'); tr.append(el('td', '', k), el('td', '', String(v))); table.append(tr); };
    for (const k of UNIT_KINDS) row(k, counts.units[k] ?? 0);
    for (const k of Object.keys(counts.units)) if (!UNIT_KINDS.includes(k)) row(k, counts.units[k]);
    row('units total', counts.totalUnits);
    for (const k of STRUCT_KINDS) if (k !== 'core' || counts.structures[k]) row(k, counts.structures[k] ?? 0);
    if (counts.sites) row('building sites', counts.sites);
    box.append(table);
    root.append(box);
  }
  const res = $('result');
  if (st.result) {
    const r = st.result;
    const who = r.winner === null || r.winner === undefined ? 'Draw' : `${log.players?.[r.winner] ?? 'Side ' + r.winner} wins`;
    res.textContent = `${who} (${r.reason}) at tick ${r.tick}. Final value ${r.value?.join(' to ')}.`;
    res.classList.add('on');
  } else {
    res.classList.remove('on');
  }
}

// ---------- controls ----------

function setPlaying(p) {
  if (p && replayer && tick >= replayer.last) show(0);
  playing = p;
  lastFrame = 0;
  acc = 0;
  $('play').textContent = playing ? 'Pause' : 'Play';
  if (playing) requestAnimationFrame(frame);
}

function frame(now) {
  if (!playing) return;
  if (lastFrame) acc += (now - lastFrame) / 1000;
  lastFrame = now;
  const perSec = Number($('speed').value);
  const n = Math.floor(acc * perSec);
  if (n > 0) {
    acc -= n / perSec;
    show(tick + n);
    if (tick >= replayer.last) { playing = false; $('play').textContent = 'Play'; return; }
  }
  requestAnimationFrame(frame);
}

$('play').onclick = () => setPlaying(!playing);
$('step').onclick = () => { playing = false; show(tick + 1); };
$('back').onclick = () => { playing = false; show(tick - 1); };
$('first').onclick = () => { playing = false; show(0); };
$('last').onclick = () => { playing = false; replayer && show(replayer.last); };
$('scrub').oninput = (e) => { playing = false; show(Number(e.target.value)); };

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'ArrowRight') { playing = false; show(tick + (e.shiftKey ? 10 : 1)); }
  else if (e.key === 'ArrowLeft') { playing = false; show(tick - (e.shiftKey ? 10 : 1)); }
});

async function readFile(file) {
  try {
    loadLog(JSON.parse(await file.text()), file.name);
  } catch (err) {
    $('title').textContent = `Could not read ${file.name}: ${err.message}`;
  }
}

$('file').onchange = (e) => e.target.files[0] && readFile(e.target.files[0]);
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
});

const logUrl = new URLSearchParams(location.search).get('log');
if (logUrl) {
  fetch(logUrl)
    .then((r) => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); })
    .then((d) => loadLog(d, logUrl))
    .catch((err) => { $('title').textContent = `Could not load ${logUrl}: ${err.message}`; });
}
