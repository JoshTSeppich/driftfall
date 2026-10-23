// Always-live editions (TERRITORY.md section 10). Owner: sonnet (Playable Client).
// The page watches live/status.json. A NEW green build shows "Edition N: what changed" for 3 s, then reloads
// into a fresh match. A red build never reloads; it only says it is being fixed.

const num = (v) => (Number.isFinite(v) ? v : null);

export function whatChanged(status) {
  if (!status) return 'A new build.';
  if (typeof status.what === 'string' && status.what) return status.what;
  const c = status.changed;
  if (!c) return status.headline || 'A new build.';
  if (c.first) return 'First edition.';
  const files = [...(c.added || []), ...(c.changed || []), ...(c.removed || [])].map((f) => (typeof f === 'string' ? f : f.file)).filter(Boolean);
  if (!files.length) return status.headline || 'A new build.';
  const shown = files.slice(0, 3).join(', ');
  const more = files.length > 3 ? `, +${files.length - 3} more` : '';
  return `${files.length} file${files.length === 1 ? '' : 's'} changed: ${shown}${more}`;
}

// state: { loaded, announced, fixing }. Returns { action: none|announce|fixing, build, text, state }.
export function decide(state, status) {
  const s = { ...state };
  const build = num(status?.build);
  const none = { action: 'none', state: s };
  if (build === null || (status.state !== 'green' && status.state !== 'red')) return none;
  if (s.loaded == null) {
    s.loaded = status.state === 'green' ? build : (num(status.previous?.build) ?? build - 1);
    return none;
  }
  if (build <= s.loaded) return none;
  if (status.state === 'green') {
    if (s.announced === build) return none;
    s.announced = build;
    return { action: 'announce', build, text: `Edition ${build}: ${whatChanged(status)}`, state: s };
  }
  if (s.fixing === build) return none;
  s.fixing = build;
  return { action: 'fixing', build, text: `Edition ${build} is being fixed`, state: s };
}

// Archived editions (editions/N/...) and ?edition=off stay put.
export function isArchived(href) {
  return /\/editions\/\d+\//.test(href) || /[?&]edition=off\b/.test(href);
}

export function startEditions({ win = globalThis.window, fetchImpl = globalThis.fetch, setTimeoutImpl = globalThis.setTimeout, intervalMs = 5000, auto = true, statusUrl } = {}) {
  let state = {};
  let banner = null;
  let reloading = false;
  let timer = null;
  const doc = win?.document;
  const show = (text, bad) => {
    if (!doc) return;
    banner?.remove?.();
    banner = doc.createElement('div');
    banner.textContent = text;
    Object.assign(banner.style, { position: 'fixed', left: '50%', top: '120px', transform: 'translateX(-50%)', padding: '8px 18px', background: bad ? '#3a2a10e6' : '#0b0918e6', color: bad ? '#ffb13b' : '#33e0ff', border: '1px solid #4a4568', borderRadius: '4px', font: '600 15px system-ui, sans-serif', zIndex: 50, pointerEvents: 'none' });
    doc.body.appendChild(banner);
  };
  const url = statusUrl || (win?.location?.href ? new URL('../live/status.json', win.location.href).href : '/preview/rts/live/status.json');
  async function poll() {
    let status;
    try {
      const r = await fetchImpl(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      status = await r.json();
    } catch { return; }
    const d = decide(state, status);
    state = d.state;
    if (d.action === 'fixing') show(d.text, true);
    if (d.action === 'announce' && !reloading) {
      reloading = true;
      show(d.text, false);
      setTimeoutImpl(() => win.location.reload(), 3000);
    }
  }
  const stop = () => { if (timer) clearInterval(timer); };
  if (auto) { poll(); timer = setInterval(poll, intervalMs); }
  return { poll, stop, get state() { return state; } };
}

// Called from play/index.html. Does nothing in archived editions or with ?edition=off.
export function watchEditions(win = globalThis.window) {
  if (!win?.location || isArchived(win.location.href)) return null;
  return startEditions({ win });
}
