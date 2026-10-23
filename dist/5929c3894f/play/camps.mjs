// Neutral camps and ground pickups on the live page (TERRITORY s14). Pure helpers: data in, drawing calls out.
// Owner: haiku (play display). The sim's data is state.neutrals and state.groundItems; with neither present nothing
// is drawn, so the page is unchanged until the camps and items land. Shapes are placeholders until the art arrives.

// Original palette for camps and pickups (not from any game).
export const CAMP = Object.freeze({ body: '#8a6d4a', edge: '#1d1a14', pip: '#ffd45c', pipOff: '#4a3f2e', minimap: '#c9a46a', hp: '#e8e0c8', glow: '#7cf6ff', core: '#e9fdff' });

/** Strength pips for a camp: 1 to 3, whatever the sim sends. */
export function pipCount(strength) {
  const n = Math.round(Number(strength));
  return Number.isFinite(n) ? Math.max(1, Math.min(3, n)) : 1;
}

/**
 * The camps worth drawing: alive, and (with fog) on a tile the side has seen before.
 * Returns { id, kind, x, y, pips, frac } where frac is the health left, 0..1.
 */
export function campMarks(neutrals, { fog = null } = {}) {
  if (!Array.isArray(neutrals)) return [];
  const marks = [];
  for (const n of neutrals) {
    if (!n || n.dead || !(n.hp > 0) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    if (fog && fog.level(n.x, n.y) <= 0) continue;
    const max = n.maxHp > 0 ? n.maxHp : n.hp;
    marks.push({ id: n.id, kind: n.kind, x: n.x, y: n.y, pips: pipCount(n.strength), frac: Math.min(1, n.hp / max) });
  }
  return marks;
}

/** Minimap: one dot per camp and one tick per pip beside it. sx and sy are minimap pixels per tile. */
export function drawCampsMinimap(ctx, marks, sx, sy) {
  ctx.fillStyle = CAMP.minimap;
  for (const m of marks) {
    const px = m.x * sx, py = m.y * sy;
    ctx.fillRect(px, py, Math.max(2, sx), Math.max(2, sy));
    for (let i = 0; i < m.pips; i++) ctx.fillRect(px + i * 2, py - 3, 1, 1);
  }
}

/**
 * On the map: a placeholder body (a diamond with an ink edge), a health line under it and one pip dot per strength
 * above it. project(x, y) gives screen pixels; tp is the pixels per tile.
 */
export function drawCampsOverlay(ctx, marks, project, tp) {
  for (const m of marks) {
    const p = project(m.x, m.y, 0);
    const r = tp * 0.42;
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy - r); ctx.lineTo(p.sx + r, p.sy); ctx.lineTo(p.sx, p.sy + r); ctx.lineTo(p.sx - r, p.sy); ctx.closePath();
    ctx.fillStyle = CAMP.body; ctx.fill();
    ctx.strokeStyle = CAMP.edge; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = CAMP.hp; ctx.fillRect(p.sx - r, p.sy + r + 3, 2 * r * m.frac, 3);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(p.sx + (i - 1) * tp * 0.2, p.sy - r - 6, tp * 0.07, 0, Math.PI * 2);
      ctx.fillStyle = i < m.pips ? CAMP.pip : CAMP.pipOff; ctx.fill();
    }
  }
}

/**
 * Items on the ground glow: a soft halo that breathes with time (now, in ms) and a bright core.
 * Items with missing coordinates are skipped.
 */
export function drawPickups(ctx, items, project, tp, now) {
  if (!Array.isArray(items)) return;
  const pulse = 0.5 + 0.5 * Math.sin(now / 300);
  for (const it of items) {
    if (!it || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
    const p = project(it.x, it.y, 0);
    ctx.beginPath(); ctx.arc(p.sx, p.sy, tp * (0.3 + 0.1 * pulse), 0, Math.PI * 2);
    ctx.fillStyle = CAMP.glow; ctx.fill();
    ctx.beginPath(); ctx.arc(p.sx, p.sy, tp * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = CAMP.core; ctx.fill();
  }
}
