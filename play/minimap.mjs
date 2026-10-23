// Minimap: pure helpers plus a 2d-canvas drawer, so a node test can drive it with a stub context.
// Click or drag with the left button moves the camera; the right button is a command (the caller decides what).
import { drawFog } from './fog.mjs';

export const MINIMAP = { rock: '#3a3f55', shard: '#35e0ff', mine: '#4aa8ff', foe: '#ff8a3d', ground: '#10131d', view: '#ffffff' };

// Screen pixel on the minimap -> tile centre (tile x covers [x - 0.5, x + 0.5), as the camera rig uses).
export function minimapToTile(px, py, width, height, mapW, mapH) {
  const x = Math.max(0, Math.min(mapW - 1, (px / width) * mapW - 0.5));
  const y = Math.max(0, Math.min(mapH - 1, (py / height) * mapH - 0.5));
  return { x, y };
}

// Tile -> minimap pixel (the tile's centre).
export function tileToMinimap(x, y, width, height, mapW, mapH) {
  return { px: ((x + 0.5) / mapW) * width, py: ((y + 0.5) / mapH) * height };
}

// Draw everything. `snap` has rocks, crystals, units, structures, width, height. `fog` is optional (createFog result):
// with it, enemy pieces show only on visible tiles and the fog is painted over terrain. `view` is the camera footprint
// as four {x, y} tile corners.
export function drawMinimap(ctx, snap, { side, fog = null, view = null, size, makeCanvas, scratch } = {}) {
  const W = size?.width ?? ctx.canvas.width, H = size?.height ?? ctx.canvas.height;
  const sx = W / snap.width, sy = H / snap.height;
  ctx.fillStyle = MINIMAP.ground; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = MINIMAP.rock;
  for (const [x, y] of snap.rocks) ctx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
  ctx.fillStyle = MINIMAP.shard;
  for (const c of snap.crystals) if (c.amount > 0 && (!fog || fog.level(c.x, c.y) > 0)) ctx.fillRect(c.x * sx, c.y * sy, Math.ceil(sx), Math.ceil(sy));
  const shown = (e) => e.owner === side || !fog || fog.canSee(e.x, e.y);
  const colour = (o) => (o === side ? MINIMAP.mine : MINIMAP.foe);
  for (const s of snap.structures) {
    if (!shown(s)) continue;
    ctx.fillStyle = colour(s.owner);
    ctx.fillRect(s.x * sx - 1, s.y * sy - 1, sx * 1.6 + 2, sy * 1.6 + 2);
  }
  for (const u of snap.units) {
    if (!shown(u)) continue;
    ctx.fillStyle = colour(u.owner);
    ctx.fillRect(u.x * sx, u.y * sy, Math.max(2, sx), Math.max(2, sy));
  }
  if (fog && makeCanvas) drawFog(ctx, fog, snap.width, snap.height, sx, makeCanvas, scratch);
  if (view) {
    ctx.strokeStyle = MINIMAP.view; ctx.lineWidth = 1; ctx.beginPath();
    view.forEach((c, i) => {
      const p = tileToMinimap(c.x, c.y, W, H, snap.width, snap.height);
      if (i) ctx.lineTo(p.px, p.py); else ctx.moveTo(p.px, p.py);
    });
    ctx.closePath(); ctx.stroke();
  }
}

// Wire mouse handling onto a canvas element. Callbacks: onMove(tile) for the camera, onCommand(tile) for right-click.
// Returns a dispose function.
export function attachMinimap(canvas, mapW, mapH, { onMove, onCommand, win = globalThis.window } = {}) {
  const toTile = (e) => {
    const r = canvas.getBoundingClientRect();
    return minimapToTile(e.clientX - r.left, e.clientY - r.top, r.width, r.height, mapW, mapH);
  };
  let drag = false;
  const down = (e) => {
    if (e.button === 2) { onCommand?.(toTile(e)); return; }
    drag = true; onMove?.(toTile(e));
  };
  const move = (e) => { if (drag) onMove?.(toTile(e)); };
  const up = () => { drag = false; };
  const noMenu = (e) => e.preventDefault();
  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('contextmenu', noMenu);
  win.addEventListener('mousemove', move);
  win.addEventListener('mouseup', up);
  return () => {
    canvas.removeEventListener('mousedown', down);
    canvas.removeEventListener('contextmenu', noMenu);
    win.removeEventListener('mousemove', move);
    win.removeEventListener('mouseup', up);
  };
}
