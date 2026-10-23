// Glue between the live page and the territory readouts (NORTHSTAR priority 2). Pure helpers: no DOM, canvas passed in.
// Owner: sonnet (Playable Client). Territory is opt-in with ?territory=1 until the default match flips (LAUNCH.md section 4).
import { createTerritoryMatch } from '../env/sim-territory.mjs';
import { territoryHud } from './territory-hud.mjs';
import { reachViews, reachBorderLines, toneColour } from './reach-view.mjs';
import { marketStrip } from './market-strip.mjs';

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
