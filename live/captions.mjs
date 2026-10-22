// Live Commentator: big lower-third captions from /api/subtitles, plus short "what just changed" callouts
// when the build status flips. Owner: haiku (Live Commentator). Only this file is mine.
//
//   import { mountCaptions } from "./captions.mjs";
//   const cap = mountCaptions(document.body, { origin: "http://localhost:4477" });
//   cap.stop();
//
// The pure helpers (normalizeCaptions, nextCursor, diffStatus) have no DOM and are tested in node.

const POLL_CAPTIONS_MS = 2000;
const POLL_STATUS_MS = 10000;
const MIN_SHOW_MS = 3500;      // a lower-third stays up at least this long so it can be read
const CALLOUT_MS = 6000;       // a "what just changed" callout stays up this long
const MAX_QUEUE = 12;          // if the swarm gets chatty, keep only the newest captions

// Accept the caption payload in whatever shape the server sends: a bare array, or an object wrapping one.
// Each item may be a string or an object with text/line/caption/message and an optional id/n/i.
export function normalizeCaptions(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.captions) ? payload.captions
    : Array.isArray(payload?.subtitles) ? payload.subtitles
    : Array.isArray(payload?.lines) ? payload.lines
    : Array.isArray(payload?.items) ? payload.items
    : [];
  const out = [];
  list.forEach((raw, i) => {
    const text = typeof raw === "string" ? raw : String(raw?.text ?? raw?.line ?? raw?.caption ?? raw?.message ?? "");
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    const id = typeof raw === "object" && raw && (raw.id ?? raw.n ?? raw.i);
    out.push({ id: Number.isFinite(Number(id)) ? Number(id) : i, text: clean });
  });
  return out;
}

// Where to poll from next. Prefer the server's own cursor; otherwise one past the highest id we have seen.
export function nextCursor(payload, captions, previous) {
  const fromServer = Number(payload?.next ?? payload?.since ?? payload?.cursor);
  if (Number.isFinite(fromServer)) return fromServer;
  let max = previous;
  for (const c of captions) if (c.id + 1 > max) max = c.id + 1;
  return max;
}

// Compare two build-status snapshots and describe what flipped, in plain English.
// Expected status shape (Live Build Compiler): { overall: "green"|"red"|..., checks: [...], owner?, broke? }.
// Anything missing is ignored, so a partial status never produces a wrong callout.
export function diffStatus(prev, next) {
  const out = [];
  if (!next || typeof next !== "object") return out;
  const was = prev?.overall, now = next.overall;
  if (now && was && now !== was) {
    if (now === "green") out.push("Build is green again. Everything passes.");
    else if (now === "red") out.push(`Build went red${next.broke ? `: ${next.broke}` : "."}`);
    else out.push(`Build status changed from ${was} to ${now}.`);
  }
  const prevChecks = new Map((prev?.checks ?? []).map((c) => [c.name, c.ok]));
  for (const c of next.checks ?? []) {
    if (!c?.name || !(prevChecks.has(c.name))) continue;
    const before = prevChecks.get(c.name);
    if (before === c.ok) continue;
    out.push(c.ok ? `${c.name} passes again.` : `${c.name} is failing${c.owner ? `, owned by ${c.owner}` : ""}.`);
  }
  return out;
}

// ---- browser side -------------------------------------------------------------------------------

const CSS = `
.cap-lower{position:fixed;left:4vw;right:4vw;bottom:6vh;z-index:9000;pointer-events:none;
  font:600 clamp(28px,3.6vw,64px)/1.2 "Kenney Future",system-ui,sans-serif;color:#f4f7fa;
  text-shadow:0 2px 14px rgba(0,0,0,.9);opacity:0;transform:translateY(12px);transition:opacity .4s,transform .4s}
.cap-lower.on{opacity:1;transform:none}
.cap-lower span{display:inline-block;background:rgba(8,14,22,.78);padding:.25em .6em;border-left:.12em solid #4fd1c5;
  border-radius:4px}
.cap-callout{position:fixed;right:4vw;top:6vh;z-index:9001;pointer-events:none;max-width:40vw;
  font:600 clamp(20px,2.2vw,38px)/1.25 "Kenney Future",system-ui,sans-serif;color:#ffd27a;
  background:rgba(8,14,22,.8);padding:.4em .7em;border-right:.14em solid #ffb347;border-radius:4px;
  opacity:0;transform:translateX(16px);transition:opacity .4s,transform .4s}
.cap-callout.on{opacity:1;transform:none}
`;

export function mountCaptions(root = document.body, opts = {}) {
  const origin = opts.origin ?? "";
  const statusUrl = opts.statusUrl ?? `${origin}/preview/rts/live/status.json`;
  const subsUrl = (since) => `${origin}/api/subtitles?since=${since}`;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const lower = document.createElement("div");
  lower.className = "cap-lower";
  lower.setAttribute("aria-live", "polite");
  const callout = document.createElement("div");
  callout.className = "cap-callout";
  callout.setAttribute("aria-live", "polite");
  root.append(lower, callout);

  let cursor = 0;
  let queue = [];
  let showing = false;
  let shownAt = 0;
  let hideTimer = 0;
  let nextTimer = 0;
  let calloutTimer = 0;
  let prevStatus = null;
  let stopped = false;
  const timers = [];

  function showNext() {
    if (stopped || showing || queue.length === 0) return;
    const c = queue.shift();
    showing = true;
    lower.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = c.text;
    lower.appendChild(span);
    lower.classList.add("on");
    const readMs = Math.max(MIN_SHOW_MS, c.text.length * 60);
    hideTimer = setTimeout(hideLower, readMs);
  }

  function hideLower() {
    lower.classList.remove("on");
    showing = false;
    nextTimer = setTimeout(showNext, 450);
  }

  function say(text) {
    queue.push({ text });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    showNext();
  }

  function flashCallout(text) {
    callout.textContent = text;
    callout.classList.add("on");
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => callout.classList.remove("on"), CALLOUT_MS);
  }

  async function pollCaptions() {
    if (stopped) return;
    try {
      const res = await fetch(subsUrl(cursor), { cache: "no-store" });
      if (res.ok) {
        const payload = await res.json();
        const caps = normalizeCaptions(payload);
        cursor = nextCursor(payload, caps, cursor);
        for (const c of caps) say(c.text);
      }
    } catch {
      // Control Room not reachable right now: keep showing what we have and try again.
    }
    if (!stopped) timers.push(setTimeout(pollCaptions, POLL_CAPTIONS_MS));
  }

  async function pollStatus() {
    if (stopped) return;
    try {
      const res = await fetch(statusUrl, { cache: "no-store" });
      if (res.ok) {
        const status = await res.json();
        if (prevStatus) {
          for (const line of diffStatus(prevStatus, status)) flashCallout(line);
        }
        prevStatus = status;
      }
    } catch {
      // Status file missing or mid-write: skip this round.
    }
    if (!stopped) timers.push(setTimeout(pollStatus, POLL_STATUS_MS));
  }

  pollCaptions();
  pollStatus();

  return {
    say,
    callout: flashCallout,
    stop() {
      stopped = true;
      clearTimeout(hideTimer);
      clearTimeout(nextTimer);
      clearTimeout(calloutTimer);
      timers.forEach(clearTimeout);
      lower.remove();
      callout.remove();
      style.remove();
    },
  };
}
