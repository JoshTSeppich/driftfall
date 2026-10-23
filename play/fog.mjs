// Fog of war drawing: unexplored (black), explored (dimmed, remembered terrain), visible (clear).
// Vision comes from env/vision.mjs. The pure part builds an alpha-per-tile mask; the canvas part paints it.
import { visionOf, createExplored, updateExplored, isSeen } from '../env/vision.mjs';

export const FOG = { unexplored: 255, explored: 140, visible: 0 };

// Tracks what one side has seen. Call update(state) once per tick; read .vision (now) and .explored (ever).
export function createFog(state, player) {
  const fog = { player, vision: [], explored: createExplored(state.width, state.height) };
  fog.update = (s) => {
    fog.vision = visionOf(s, player);
    fog.explored = updateExplored(fog.explored, fog.vision);
    return fog;
  };
  fog.update(state);
  fog.level = (x, y) => (isSeen(fog.vision, x, y) ? 2 : isSeen(fog.explored, x, y) ? 1 : 0);
  // May the player see an enemy piece at this tile right now? (Enemies are never remembered.)
  fog.canSee = (x, y) => isSeen(fog.vision, x, y);
  return fog;
}

// Alpha mask, one byte per tile (row-major): 255 unexplored, 140 explored, 0 visible.
export function fogMask(fog, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = [FOG.unexplored, FOG.explored, FOG.visible][fog.level(x, y)];
  }
  return out;
}

// RGBA bytes for the mask (black with that alpha), ready for ImageData.
export function fogPixels(fog, width, height, colour = [8, 10, 18]) {
  const mask = fogMask(fog, width, height);
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    px[i * 4] = colour[0]; px[i * 4 + 1] = colour[1]; px[i * 4 + 2] = colour[2]; px[i * 4 + 3] = mask[i];
  }
  return px;
}

// Paint the fog onto a 2d canvas context, one `scale`-pixel square per tile (the minimap's job), with `makeCanvas`
// supplying a scratch tile-sized canvas (document.createElement('canvas') in the browser). Cached per call site.
export function drawFog(ctx, fog, width, height, scale, makeCanvas, scratch = {}) {
  if (!scratch.canvas) {
    scratch.canvas = makeCanvas(width, height);
    scratch.g = scratch.canvas.getContext('2d');
  }
  const img = new ImageData(fogPixels(fog, width, height), width, height);
  scratch.g.putImageData(img, 0, 0);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(scratch.canvas, 0, 0, width * scale, height * scale);
  ctx.imageSmoothingEnabled = smooth;
}

// For the 3D view: the tile list a renderer should hide or dim. Returns [{x, y, level}] for tiles not visible.
export function hiddenTiles(fog, width, height) {
  const out = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const level = fog.level(x, y);
    if (level < 2) out.push({ x, y, level });
  }
  return out;
}
