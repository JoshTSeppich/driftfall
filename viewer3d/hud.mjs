// Driftfall 3D HUD: a DOM overlay on top of the Three.js canvas (owner: haiku).
// Shows each side's name, Shards, value and unit counts, a value-share bar, a minimap, a time bar with scrub,
// play, speed and mute, and the result banner. It reads frames and sends commands; it never changes game state.
// The pure helpers at the top are what tests/viewer3d-hud.test.mjs covers; createHud is the DOM part.
import { UNIT_KINDS, STATS, sideValue } from "../env/stats.mjs";

export const SPEEDS = [1, 2, 4];
const DEFAULT_COLORS = ["#3fa9ff", "#ff8a3d"];
const DEFAULT_NAMES = ["Side 0", "Side 1"];
const END_DETAIL = {
  core: "Enemy Core destroyed",
  "both-cores": "Both Cores fell",
  forfeit: "The other side forfeited",
};

// Groups digits in threes: 1234 becomes "1,234". Done by hand so the output never depends on the browser's locale.
export function formatNumber(n) {
  const v = Math.trunc(Number(n) || 0);
  const digits = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (v < 0 ? "-" : "") + digits;
}

export function kindLabel(kind) {
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "";
}

// One summary per side, read from a state in the spec section 14 shape. Every kind in UNIT_KINDS gets a row, so new
// units from the roster show up without changing this file.
export function summarizeSides(state) {
  return [0, 1].map((side) => {
    const units = Object.fromEntries(UNIT_KINDS.map((kind) => [kind, 0]));
    let unitTotal = 0;
    for (const u of state.units) {
      if (u.owner !== side) continue;
      unitTotal += 1;
      if (Object.hasOwn(units, u.kind)) units[u.kind] += 1;
    }
    const core = state.structures.find((s) => s.owner === side && s.kind === "core") || null;
    let complete = 0;
    let sites = 0;
    for (const s of state.structures) {
      if (s.owner !== side) continue;
      if (s.complete === true) complete += 1;
      else sites += 1;
    }
    return {
      side,
      shards: state.shards[side],
      value: sideValue(state, side),
      units,
      unitTotal,
      unitCap: STATS.match.unitCap,
      buildings: { complete, sites },
      coreHp: core ? Math.max(0, core.hp) : 0,
      coreMaxHp: STATS.core.hp,
    };
  });
}

// Rows for the unit-count list, one per kind in roster order.
export function unitRows(summary) {
  return UNIT_KINDS.map((kind) => ({ kind, label: kindLabel(kind), count: summary.units[kind] }));
}

// Fraction of the total value that side 0 holds, 0..1. Half when nobody has anything.
export function valueShare(value0, value1) {
  const total = value0 + value1;
  if (!(total > 0)) return 0.5;
  return Math.min(1, Math.max(0, value0 / total));
}

// "Tick 340 / 2000", where `last` is the index of the final tick.
export function tickLabel(tick, last) {
  return `Tick ${formatNumber(tick)} / ${formatNumber(last)}`;
}

// "3" for three finished buildings, "3 (+2 building)" while sites are still going up.
export function buildingsText(summary) {
  const { complete, sites } = summary.buildings;
  return sites > 0 ? `${complete} (+${sites} building)` : `${complete}`;
}

export function scrubFraction(tick, last) {
  if (!(last > 0)) return 0;
  return Math.min(1, Math.max(0, tick / last));
}

export function tickFromFraction(fraction, last) {
  if (!(last > 0)) return 0;
  return Math.round(Math.min(1, Math.max(0, fraction)) * last);
}

// Tile (x, y) to a pixel on a square minimap of `px` pixels, at the centre of the tile.
export function minimapCoords(x, y, width, height, px) {
  return { x: ((x + 0.5) * px) / width, y: ((y + 0.5) * px) / height };
}

// Pixel on the minimap back to a tile, clamped to the map.
export function minimapTile(px, py, width, height, size) {
  const x = Math.floor((px / size) * width);
  const y = Math.floor((py / size) * height);
  return { x: Math.min(width - 1, Math.max(0, x)), y: Math.min(height - 1, Math.max(0, y)) };
}

// Banner text for a finished match (state.result), or null while the match is still running.
export function resultBanner(result, names = DEFAULT_NAMES) {
  if (!result) return null;
  let detail = END_DETAIL[result.reason] || "";
  if (result.reason === "timeout" && Array.isArray(result.value)) {
    detail = `Time is up: value ${formatNumber(result.value[0])} to ${formatNumber(result.value[1])}`;
  }
  if (result.winner === 0 || result.winner === 1) {
    return { title: `${names[result.winner]} wins`, detail, side: result.winner };
  }
  return { title: "Draw", detail: detail || "Nobody won", side: null };
}

const CSS = `
.df-hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.35 system-ui, -apple-system, sans-serif;
  color: #e6edf5; font-variant-numeric: tabular-nums; user-select: none; --c0: #3fa9ff; --c1: #ff8a3d; }
.df-top { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; align-items: flex-start; gap: 12px; }
.df-side { pointer-events: auto; width: 230px; padding: 10px 12px; border-radius: 10px;
  background: rgba(10, 14, 20, 0.62); backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, 0.08); }
.df-side[data-side="1"] { margin-left: auto; text-align: right; }
.df-side header { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: 0.02em; }
.df-side[data-side="1"] header { justify-content: flex-end; }
.df-chip { width: 10px; height: 10px; border-radius: 3px; background: var(--c); box-shadow: 0 0 10px var(--c); }
.df-row { display: flex; justify-content: space-between; margin-top: 4px; color: #aab6c4; }
.df-row strong { color: #e6edf5; font-size: 15px; }
.df-shards strong { color: #5ef2d0; }
.df-kinds { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; color: #8e9bab; font-size: 12px; }
.df-kinds b { color: #e6edf5; font-weight: 600; }
.df-core { height: 4px; margin-top: 8px; border-radius: 2px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.df-core i { display: block; height: 100%; width: 100%; background: var(--c); transition: width 0.25s ease; }
.df-share { flex: 1; align-self: center; height: 10px; margin-top: 0; border-radius: 5px; overflow: hidden;
  background: linear-gradient(90deg, var(--c1), var(--c1)); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
.df-share i { display: block; height: 100%; width: 50%; background: var(--c0); box-shadow: 0 0 14px var(--c0);
  transition: width 0.3s ease; }
.df-bottom { position: absolute; left: 12px; right: 12px; bottom: 12px; display: flex; align-items: flex-end; gap: 12px; }
.df-minimap { pointer-events: auto; display: block; width: 180px; height: 180px; border-radius: 10px; cursor: crosshair;
  border: 1px solid rgba(255, 255, 255, 0.1); background: #0d1116; box-shadow: 0 6px 24px rgba(0,0,0,0.45); }
.df-time { pointer-events: auto; flex: 1; display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border-radius: 10px; background: rgba(10, 14, 20, 0.62); backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.08); }
.df-time input[type=range] { flex: 1; accent-color: #5ef2d0; }
.df-time span { min-width: 150px; color: #aab6c4; text-align: right; }
.df-btn { pointer-events: auto; min-width: 64px; padding: 5px 10px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); color: #e6edf5; font: inherit; }
.df-btn:hover { background: rgba(255,255,255,0.14); }
.df-banner { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); text-align: center;
  padding: 18px 34px; border-radius: 14px; background: rgba(6, 9, 14, 0.78); backdrop-filter: blur(8px);
  border: 1px solid var(--c, #fff); box-shadow: 0 0 40px var(--c, #fff); animation: df-in 0.5s ease-out; }
.df-banner[hidden] { display: none; }
.df-banner b { display: block; font-size: 30px; letter-spacing: 0.04em; }
.df-banner span { color: #aab6c4; }
@keyframes df-in { from { opacity: 0; transform: translate(-50%, -46%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%); } }
`;

const TEMPLATE = `
<div class="df-top">
  <section class="df-side" data-side="0">
    <header><span class="df-chip"></span><b data-k="name0"></b></header>
    <div class="df-row df-shards"><span>Shards</span><strong data-k="shards0"></strong></div>
    <div class="df-row"><span>Value</span><strong data-k="value0"></strong></div>
    <div class="df-row"><span>Units</span><strong data-k="units0"></strong></div>
    <div class="df-kinds" data-k="kinds0"></div>
    <div class="df-core"><i data-k="core0"></i></div>
  </section>
  <div class="df-share"><i data-k="share"></i></div>
  <section class="df-side" data-side="1">
    <header><span class="df-chip"></span><b data-k="name1"></b></header>
    <div class="df-row df-shards"><span>Shards</span><strong data-k="shards1"></strong></div>
    <div class="df-row"><span>Value</span><strong data-k="value1"></strong></div>
    <div class="df-row"><span>Units</span><strong data-k="units1"></strong></div>
    <div class="df-kinds" data-k="kinds1"></div>
    <div class="df-core"><i data-k="core1"></i></div>
  </section>
</div>
<div class="df-bottom">
  <canvas class="df-minimap" data-k="minimap" width="180" height="180"></canvas>
  <div class="df-time">
    <button class="df-btn" data-k="play">Pause</button>
    <button class="df-btn" data-k="speed">1x</button>
    <input type="range" min="0" max="0" value="0" data-k="scrub" aria-label="Match time">
    <span data-k="tick"></span>
    <button class="df-btn" data-k="mute">Sound on</button>
  </div>
</div>
<div class="df-banner" data-k="banner" hidden><b data-k="title"></b><span data-k="detail"></span></div>
`;

// The DOM part. `world` is createWorld(log) from world.mjs. `control` is the playback the HUD drives:
//   { seek(tick), play(), pause(), isPlaying(), setSpeed(n) }   (setSpeed optional)
// `audio` is the object from audio.mjs (optional); `onToggleMute` is used when there is none.
// `onMinimapClick(x, y)` gets the tile under the pointer so the camera can focus on it.
export function createHud(ctx, opts = {}) {
  const world = opts.world;
  const control = opts.control || {};
  const colors = opts.colors || DEFAULT_COLORS;
  const names = opts.names || world?.players || DEFAULT_NAMES;
  const mount = opts.mount || (typeof document !== "undefined" ? document.body : null);
  const last = Math.max(0, (world?.ticks || 1) - 1);
  const doc = mount.ownerDocument || document;

  if (!doc.getElementById("df-hud-style")) {
    const style = doc.createElement("style");
    style.id = "df-hud-style";
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
  const root = doc.createElement("div");
  root.className = "df-hud";
  root.innerHTML = TEMPLATE;
  root.style.setProperty("--c0", colors[0]);
  root.style.setProperty("--c1", colors[1]);
  mount.appendChild(root);

  const $ = (key) => root.querySelector(`[data-k="${key}"]`);
  const minimap = $("minimap");
  const mini = minimap.getContext("2d");
  const scrub = $("scrub");
  scrub.max = String(last);
  $("name0").textContent = names[0];
  $("name1").textContent = names[1];
  root.querySelectorAll(".df-chip").forEach((chip, i) => chip.style.setProperty("--c", colors[i]));

  // Writes text only when it changed, so an idle HUD does no layout work.
  const shown = new Map();
  const put = (key, text) => {
    if (shown.get(key) === text) return;
    shown.set(key, text);
    $(key).textContent = text;
  };

  let lastTick = -1;
  let speedIndex = 0;
  let scrubbing = false;
  let kindsKey = "";
  let bannerKey = "";

  const playBtn = $("play");
  const speedBtn = $("speed");
  const muteBtn = $("mute");
  const isMuted = () => (audio && audio.isMuted ? audio.isMuted() : Boolean(opts.isMuted && opts.isMuted()));
  const toggleMute = () => {
    if (audio && audio.toggleMute) audio.toggleMute();
    else if (opts.onToggleMute) opts.onToggleMute();
    lastTick = -1; // redraw the labels on the next update
  };

  playBtn.addEventListener("click", () => {
    if (control.isPlaying && control.isPlaying()) control.pause && control.pause();
    else control.play && control.play();
  });
  speedBtn.addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    if (control.setSpeed) control.setSpeed(SPEEDS[speedIndex]);
    speedBtn.textContent = `${SPEEDS[speedIndex]}x`;
  });
  muteBtn.addEventListener("click", toggleMute);
  scrub.addEventListener("pointerdown", () => (scrubbing = true));
  scrub.addEventListener("pointerup", () => (scrubbing = false));
  scrub.addEventListener("input", () => control.seek && control.seek(Number(scrub.value)));

  minimap.addEventListener("click", (e) => {
    const rect = minimap.getBoundingClientRect();
    const size = rect.width || minimap.width;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const tile = minimapTile(px, py, world?.width || 32, world?.height || 32, size);
    if (opts.onMinimapClick) opts.onMinimapClick(tile.x, tile.y);
  });

  const onKey = (e) => {
    if (e.target && e.target.tagName === "INPUT" && e.target.type !== "range") return;
    if (e.key === " ") {
      e.preventDefault();
      playBtn.click();
    } else if (e.key === "m" || e.key === "M") {
      toggleMute();
    }
  };
  doc.defaultView.addEventListener("keydown", onKey);

  function drawMinimap(st) {
    const size = minimap.width;
    const w = st.width;
    const h = st.height;
    const cw = size / w;
    const ch = size / h;
    mini.fillStyle = "#0d1116";
    mini.fillRect(0, 0, size, size);
    mini.fillStyle = "#3a434e";
    for (const [x, y] of st.rocks) mini.fillRect(x * cw, y * ch, cw, ch);
    mini.fillStyle = "#5ef2d0";
    for (const c of st.crystals) if (c.amount > 0) mini.fillRect(c.x * cw + cw * 0.2, c.y * ch + ch * 0.2, cw * 0.6, ch * 0.6);
    for (const s of st.structures) {
      mini.fillStyle = colors[s.owner];
      const sz = Math.max(cw, ch) * 1.5;
      mini.globalAlpha = s.complete ? 1 : 0.45;
      mini.fillRect(s.x * cw + cw / 2 - sz / 2, s.y * ch + ch / 2 - sz / 2, sz, sz);
    }
    mini.globalAlpha = 1;
    for (const u of st.units) {
      mini.fillStyle = colors[u.owner];
      mini.beginPath();
      mini.arc(u.x * cw + cw / 2, u.y * ch + ch / 2, Math.max(1.5, Math.min(cw, ch) * 0.4), 0, Math.PI * 2);
      mini.fill();
    }
  }

  function update(frame) {
    const st = frame.alpha < 0.5 && frame.prev ? frame.prev : frame.next;
    const sides = summarizeSides(st);
    const [a, b] = sides;

    put("shards0", formatNumber(a.shards));
    put("shards1", formatNumber(b.shards));
    put("value0", formatNumber(a.value));
    put("value1", formatNumber(b.value));
    put("units0", `${a.unitTotal} / ${a.unitCap}`);
    put("units1", `${b.unitTotal} / ${b.unitCap}`);
    put("share", "");
    $("share").style.width = `${(valueShare(a.value, b.value) * 100).toFixed(1)}%`;
    $("core0").style.width = `${((a.coreHp / a.coreMaxHp) * 100).toFixed(1)}%`;
    $("core1").style.width = `${((b.coreHp / b.coreMaxHp) * 100).toFixed(1)}%`;

    const kindsText = [a, b].map((s) => unitRows(s).map((r) => `${r.label} <b>${r.count}</b>`).join("  "));
    const kKey = kindsText.join("|");
    if (kKey !== kindsKey) {
      kindsKey = kKey;
      $("kinds0").innerHTML = kindsText[0];
      $("kinds1").innerHTML = kindsText[1];
    }

    const tickChanged = frame.tick !== lastTick;
    if (tickChanged) {
      lastTick = frame.tick;
      drawMinimap(st);
      put("tick", tickLabel(frame.tick, world?.ticks || 1));
      if (!scrubbing) scrub.value = String(frame.tick);
      const playing = control.isPlaying ? control.isPlaying() : true;
      playBtn.textContent = playing ? "Pause" : "Play";
    }
    muteBtn.textContent = isMuted() ? "Sound off" : "Sound on";

    const banner = resultBanner(st.result, names);
    const bKey = banner ? `${banner.title}|${banner.detail}` : "";
    if (bKey !== bannerKey) {
      bannerKey = bKey;
      const el = $("banner");
      el.hidden = !banner;
      if (banner) {
        put("title", banner.title);
        put("detail", banner.detail);
        el.style.setProperty("--c", banner.side === null ? "#e6edf5" : colors[banner.side]);
      }
    }
  }

  function dispose() {
    doc.defaultView.removeEventListener("keydown", onKey);
    root.remove();
  }

  return { update, dispose, root };
}
