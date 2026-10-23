// Glue between the live page and the territory readouts (NORTHSTAR priority 2). Pure helpers: no DOM, canvas passed in.
// Owner: sonnet (Playable Client). Territory is opt-in with ?territory=1 until the default match flips (LAUNCH.md section 4).
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { territoryHud } from './territory-hud.mjs';
import { reachViews, reachBorderLines, toneColour } from './reach-view.mjs';
import { marketStrip } from './market-strip.mjs';
import { powerView, pentagon } from './power-view.mjs';

/** { on, createState } for a page query. createState(seed) is handed to createLiveMatch; undefined keeps the plain match. */
export function territoryOptions(q) {
  const on = q.get('territory') !== '0';   // Joshua 10-23 08:03: territory is the DEFAULT; ?territory=0 for the old classic match
  return { on, createState: on ? (seed) => createTerritoryMatch(seed) : undefined };
}

/** The tier / Drift / flow readout as HTML, or '' when the match has no territory rules. */
export function territoryPanel(state, side) {
  const hud = territoryHud(state, side);
  return hud ? hud.html + marketStrip(state, side) : '';
}

/** Stroke every visible Reach outline on the ground overlay. project(x, y) -> { sx, sy }. Returns how many were drawn. */
export function drawReachBorders(ov, territory, side, tick, project) {
  if (!territory) return 0;
  const views = reachViews(territory);
  let drawn = 0;
  for (const line of reachBorderLines(views, side, tick)) {
    if (!line.visible) continue;
    ov.strokeStyle = toneColour(line.tone, side);
    ov.lineWidth = line.tone === 'open' ? 1 : 2;
    ov.beginPath();
    for (const [x0, y0, x1, y1] of line.segments) {
      const a = project(x0, y0), b = project(x1, y1);
      ov.moveTo(a.sx, a.sy); ov.lineTo(b.sx, b.sy);
    }
    ov.stroke();
    drawn++;
  }
  return drawn;
}

/**
 * Cord power on the ground overlay (TERRITORY.md section 20): the lit network glow, faint cords (bright when a unit is
 * selected or taking a move order), the cord-limit pentagon on selection, cut sparks, and dark or blinking units.
 * project(x, y) -> { sx, sy }. Returns the number of cords drawn.
 */
export function drawPowerOverlay(ov, state, side, selection, project, tick, { cords = true, faint = false } = {}) {
  if (!state.power) return 0;
  const v = powerView(state, side, selection);
  const poly = (verts) => {
    ov.beginPath();
    verts.forEach((q, i) => { const p = project(q.x, q.y); if (i === 0) ov.moveTo(p.sx, p.sy); else ov.lineTo(p.sx, p.sy); });
    ov.closePath();
  };
  for (const g of v.glows) {
    if (!g.lit) continue;
    poly(pentagon(g.x, g.y, g.range));
    ov.fillStyle = 'rgba(255,214,102,0.07)';
    ov.fill();
  }
  for (const c of cords ? v.cords : []) {
    const a = project(c.x0, c.y0), b = project(c.x1, c.y1);
    ov.strokeStyle = faint ? 'rgba(30,30,36,0.22)' : c.bright ? 'rgba(30,30,36,0.9)' : 'rgba(30,30,36,0.25)';
    ov.lineWidth = faint ? 1 : c.bright ? 2 : 1;
    ov.beginPath(); ov.moveTo(a.sx, a.sy); ov.lineTo(b.sx, b.sy); ov.stroke();
  }
  ov.setLineDash([4, 4]);
  ov.strokeStyle = 'rgba(255,214,102,0.9)';
  ov.lineWidth = 1.5;
  for (const r of v.rings) { poly(r.vertices); ov.stroke(); }
  ov.setLineDash([]);
  for (const s of v.sparks) {
    const p = project(s.x, s.y);
    const len = 4 + 10 * s.age;
    ov.strokeStyle = `rgba(255,70,60,${(1 - s.age).toFixed(3)})`;
    ov.lineWidth = 2;
    ov.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * 2 * Math.PI;
      ov.moveTo(p.sx, p.sy); ov.lineTo(p.sx + len * Math.cos(a), p.sy + len * Math.sin(a));
    }
    ov.stroke();
  }
  for (const d of v.dark) {
    const p = project(d.x, d.y);
    if (d.state === 'battery') {
      ov.strokeStyle = tick % 12 < 6 ? 'rgba(255,60,60,0.95)' : 'rgba(255,60,60,0.2)';
      ov.lineWidth = 2;
      ov.beginPath(); ov.arc(p.sx, p.sy, 12, 0, 2 * Math.PI); ov.stroke();
    } else {
      ov.fillStyle = 'rgba(20,20,24,0.7)';
      ov.beginPath(); ov.arc(p.sx, p.sy, 7, 0, 2 * Math.PI); ov.fill();
    }
  }
  return v.cords.length;
}
