// Driftfall live TV page. Polls the Control Room (same origin) and repaints; no reloads.
// Optional inputs, all tolerated when missing or shaped differently than expected:
//   live/status.json   build status   (ok|green|status, summary, tests{pass,fail}, failures[], t)
//   live/threads.json  chat threads   (array, or {threads:[{title|topic, count|messages, decision}]})
//   live/scene.json    show director  ({scene:'match'|'chat'|'agents'|'default', agent:<node id>, title})
const BASE = '/preview/rts/';
const $ = (id) => document.getElementById(id);
const get = async (url, kind = 'json') => {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return kind === 'json' ? await r.json() : await r.text();
  } catch { return null; }
};
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 90 ? s + 's ago' : Math.round(s / 60) + 'm ago';
};

// ---- clock ----
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString(); }, 1000);

// ---- scene (show director: live/show.mjs decides, we lay out) ----
let spotlight = null;
const FOCUS = { match: 'stage', moment: 'chat', wall: 'wall', spotlight: 'wall', build: 'status' };
function applyScene(cue, text) {
  const grid = $('grid');
  const f = FOCUS[cue && cue.scene];
  if (f) grid.dataset.focus = f; else delete grid.dataset.focus;
  const d = cue && cue.data;
  spotlight = cue && cue.scene === 'spotlight' && d ? String(d.id || d.node || d) : null;
  const pill = $('scene');
  pill.textContent = text || (cue ? 'scene: ' + cue.scene : '');
  pill.style.display = pill.textContent ? '' : 'none';
}
async function startShow() {
  const { createShow } = await import('./show.mjs');
  const show = createShow();
  show.on('scene', (cue) => applyScene(cue, show.describe()));
  show.start();
}
startShow().catch(() => {});   // without the show module the page just keeps the default layout

// ---- match stage: newest 3D build if it exists, else the 2D viewer ----
let stageKey = '', stageMtime = 0, lastReload = 0;
async function pickStage() {
  const proj = await get('/api/project?p=rts');
  const files = (proj && proj.files) || [];
  const logs = files.filter((f) => /^matches\/.+\.json$/.test(f.path)).sort((a, b) => b.mtime - a.mtime);
  const latest = logs.find((f) => /latest/.test(f.path)) || logs[0];
  const log = '../' + (latest ? latest.path : 'matches/sample-7.json');
  const has3d = files.some((f) => f.path === 'viewer3d/index.html') &&
    (await fetch(BASE + 'viewer3d/index.html', { method: 'HEAD' }).then((r) => r.ok).catch(() => false));
  const page = has3d ? 'viewer3d/index.html' : 'viewer/live.html';
  const key = page + '|' + log;
  const mtime = latest ? latest.mtime : 0;
  const stale = mtime !== stageMtime && Date.now() - lastReload > 120000;   // new recording of the same file
  if (key !== stageKey || stale) {
    stageKey = key;
    stageMtime = mtime;
    lastReload = Date.now();
    $('matchFrame').src = BASE + page + '?log=' + encodeURIComponent(log) + '&tv=1';
  }
  $('stageTitle').textContent = has3d ? 'Match · 3D' : 'Match · 2D';
  $('stageSrc').textContent = latest ? latest.path.replace('matches/', '') + ' · ' + ago(latest.mtime) : 'sample match';
}

// ---- build status ----
function row(parent, k, v, cls) {
  const r = el('div', 'srow');
  r.append(el('span', 'k', k), el('span', cls || '', v));
  parent.append(r);
}
async function pollStatus() {
  const s = await get(BASE + 'live/status.json');
  const body = $('statusBody'), pill = $('build');
  body.replaceChildren();
  if (!s || typeof s !== 'object') {
    pill.textContent = 'build: no report yet';
    pill.className = 'pill warn';
    body.append(el('div', 'dim', 'The compiler has not published live/status.json yet.'));
    return;
  }
  const raw = s.state ?? s.ok ?? s.green ?? s.status;
  const good = raw === true || /^(green|ok|pass|passing|good)$/i.test(String(raw));
  const bad = raw === false || /^(red|fail|failing|broken|bad)$/i.test(String(raw));
  pill.textContent = 'build ' + (s.build ?? '') + ': ' + (good ? 'GREEN' : bad ? 'RED' : String(raw ?? 'unknown'));
  pill.className = 'pill ' + (good ? 'ok' : bad ? 'bad' : 'warn');
  const head = s.headline || s.summary;
  if (head) body.append(el('div', 'srow', clip(String(head), 220)));
  const t = s.tests || s.test || {};
  const pass = t.pass ?? t.passed ?? s.pass, fail = t.fail ?? t.failed ?? s.fail;
  if (pass != null || fail != null) row(body, 'Tests', `${pass ?? '?'} pass · ${fail ?? 0} fail` + (t.files ? ` · ${t.files} files` : ''), fail ? 'fail' : '');
  const when = s.at || s.t || s.time || s.updated;
  if (when) row(body, 'Checked', ago(new Date(when).getTime()));
  if (s.nextBuildAt) row(body, 'Next build', 'in ' + Math.max(0, Math.round((new Date(s.nextBuildAt) - Date.now()) / 1000)) + 's');
  const fails = s.failures || s.broken || s.failing || [];
  for (const f of (Array.isArray(fails) ? fails : [fails]).slice(0, 5)) {
    const owners = [].concat(f.owners || f.owner || []).join(', ');
    const text = typeof f === 'string' ? f : [f.name || f.file || f.module, owners && '(' + owners + ')', f.reason || f.error].filter(Boolean).join(' ');
    body.append(el('div', 'fail', '✗ ' + clip(text, 170)));
  }
}

// ---- chat + threads ----
let seenChat = 0;
async function pollChat() {
  const text = await get(BASE + 'channel.jsonl', 'text');
  if (!text) return;
  const msgs = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { msgs.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  const box = $('chatLines');
  const shown = msgs.slice(-9);
  const fresh = msgs.length - seenChat;
  seenChat = msgs.length;
  box.replaceChildren();
  shown.forEach((m, i) => {
    const d = el('div', 'msg' + (/\bAGREE\b/.test(m.text || '') ? ' agree' : '') + (i >= shown.length - fresh ? ' new' : ''));
    d.append(el('span', 'who ' + (m.from || ''), m.from || '?'), document.createTextNode(clip(String(m.text || ''), 260)));
    box.append(d);
  });
  $('chatMode').textContent = msgs.length + ' messages';
}
async function pollThreads() {
  const t = await get(BASE + 'live/threads.json');
  const list = Array.isArray(t) ? t : (t && t.threads) || [];
  const box = $('threads');
  box.replaceChildren();
  for (const th of list.slice(0, 6)) {
    const title = th.title || th.topic || th.name || '';
    if (!title) continue;
    const n = th.count ?? (Array.isArray(th.messages) ? th.messages.length : null);
    const d = el('div', 'thread');
    d.append(el('b', '', clip(String(title), 40)));
    if (n != null) d.append(document.createTextNode(' · ' + n));
    if (th.decision || th.status) d.append(document.createTextNode(' · ' + clip(String(th.decision || th.status), 50)));
    box.append(d);
  }
}

// ---- agent wall ----
const feedLines = (arr) =>
  arr.filter((l) => l && l.text && !/^\s*↳/.test(l.text)).slice(-4)
    .map((l) => clip(l.text.replace(/\s+/g, ' ').trim(), 150)).join('\n');
async function pollAgents() {
  const g = await get('/api/graph');
  if (!g || !g.nodes) return;
  const mine = g.nodes.filter((n) => (n.kind === 'job' || n.kind === 'subagent') && n.src && String(n.src.cwd || '').endsWith('/rts'));
  const running = mine.filter((n) => n.state === 'running').sort((a, b) => b.last - a.last);
  const spot = running.find((n) => n.id === spotlight);
  const pick = (spot ? [spot, ...running.filter((n) => n !== spot)] : running).slice(0, 12);
  const feeds = await Promise.all(pick.map((n) => get('/api/feed?id=' + encodeURIComponent(n.id))));
  const box = $('agents');
  box.replaceChildren();
  pick.forEach((n, i) => {
    const c = el('div', 'agent' + (n.id === spotlight ? ' spot' : ''));
    const h = el('h4');
    h.append(el('span', 'dot'), document.createTextNode(clip(n.label || n.id, 60)));
    if (n.src.model) h.append(el('i', '', ' · ' + n.src.model));
    c.append(h, el('pre', '', feedLines(feeds[i] || []) || '…'));
    box.append(c);
  });
  $('wallCount').textContent = `${running.length} working · ${mine.length - running.length} finished`;
}

// ---- captions ----
let capSince = 0, capQueue = [], capBusy = false;
async function pollCaptions() {
  const s = await get('/api/subtitles?since=' + capSince);
  if (!s || !s.items) return;
  if (capSince === 0) capQueue = s.items.slice(-1);        // first load: just the latest line
  else capQueue.push(...s.items);
  capSince = s.total ?? capSince;
  if (capQueue.length > 4) capQueue = capQueue.slice(-4);
  if (!capBusy) playCaption();
}
function playCaption() {
  const item = capQueue.shift();
  if (!item) { capBusy = false; return; }
  capBusy = true;
  $('capText').textContent = item.text;
  setTimeout(playCaption, capQueue.length ? 4500 : 9000);
}

// ---- loops ----
const loop = (fn, ms) => { const run = () => fn().catch(() => {}).finally(() => setTimeout(run, ms)); run(); };
loop(pickStage, 10000);
loop(pollStatus, 5000);
loop(pollChat, 3000);
loop(pollThreads, 8000);
loop(pollAgents, 3000);
loop(pollCaptions, 5000);
