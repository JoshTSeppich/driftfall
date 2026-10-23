// Reach borders for the Classic client (TERRITORY.md sections 3 and 11). Pure helpers: data in, lines or strokes out.
// Owner: haiku (Classic play UI). The ground borders come from reachBorderLines (the renderer draws them); the minimap
// uses drawReachMinimap. Colours follow the team palette: yours in your team colour, the other side's in theirs, open
// Reaches in a quiet grey. A contested Reach flashes so you see it without a banner.
import { TEAM } from '../viewer3d/palette.mjs';

export const FLASH_TICKS = 12; // half a second on, half a second off, at 24 ticks a second
export const OPEN_COLOUR = '#7d8594';

/** Merge the map's Reach outlines with the live holders. Empty until territory is on. */
export function reachViews(territory) {
  if (!territory?.map?.reaches) return [];
  return territory.map.reaches.map((r, i) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    outline: r.outline,
    holder: territory.reaches[i]?.holder ?? null,
    contested: !!territory.reaches[i]?.contested,
  }));
}

/** On half of the flash period. A pure function of the tick, so a replay flashes the same way. */
export const flashOn = (tick) => Math.floor(tick / FLASH_TICKS) % 2 === 0;

/** 'open' when nobody holds it, 'mine' when `side` holds it, 'foe' otherwise. */
export function tone(holder, side) {
  if (holder === null || holder === undefined) return 'open';
  return holder === side ? 'mine' : 'foe';
}

/** The stroke colour for a tone, from the palette (side 0 is cobalt, side 1 ember). */
export function toneColour(kind, side) {
  if (kind === 'open') return OPEN_COLOUR;
  const mine = TEAM[side]?.main ?? OPEN_COLOUR;
  if (kind === 'mine') return mine;
  return TEAM[1 - side]?.main ?? OPEN_COLOUR;
}

/**
 * Ground borders, in tile coordinates: one entry per Reach with its outline edges as [x0, y0, x1, y1] segments.
 * A contested Reach is visible only on the flash's on-phase; everything else is always visible.
 */
export function reachBorderLines(views, side, tick) {
  return views.map((v) => {
    const pts = v.outline;
    const segments = pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return [p[0], p[1], q[0], q[1]];
    });
    return { id: v.id, tone: tone(v.holder, side), visible: !v.contested || flashOn(tick), segments };
  });
}

/**
 * Draw Reach outlines on the minimap. `size` is the minimap's pixel size; the map is mapW x mapH tiles.
 * Strokes are closed loops. A contested Reach draws only on the flash's on-phase.
 */
export function drawReachMinimap(ctx, views, { side, tick, mapW, mapH, width = ctx.canvas.width, height = ctx.canvas.height }) {
  const sx = width / mapW;
  const sy = height / mapH;
  for (const line of reachBorderLines(views, side, tick)) {
    if (!line.visible) continue;
    const v = views.find((x) => x.id === line.id);
    ctx.strokeStyle = toneColour(line.tone, side);
    ctx.lineWidth = v.contested ? 2 : 1;
    ctx.beginPath();
    v.outline.forEach((p, i) => {
      if (i) ctx.lineTo(p[0] * sx, p[1] * sy);
      else ctx.moveTo(p[0] * sx, p[1] * sy);
    });
    ctx.closePath();
    ctx.stroke();
  }
}
