// Camera rig for the playable client: a fixed tilted orthographic view. Pure (no DOM), so node tests cover it.
// `x, y` is the tile the camera looks at; `zoom` is the visible height in tiles.
// Scrolling: arrow keys, the mouse within `edge` px of a window edge (faster the closer it is), or a middle-button drag.
// With the pointer locked the cursor is virtual (`rig.cursor`, moved by deltas); pushing it past an edge pans too.
export const CAMERA = { pitch: 42 * Math.PI / 180, minZoom: 12, maxZoom: 40, edge: 16, speed: 22, distance: 60 };

const OPEN_ZOOM = 16; // visible height in tiles when a game opens

// Push strength -1..1 for one axis: 0 outside the edge band, 0.3 at its inner rim, 1 at (or past) the window edge.
export function edgeAxis(pos, size, edge = CAMERA.edge) {
  const ramp = (d) => (d <= edge ? Math.min(1, 0.3 + 0.7 * Math.max(0, (edge - d) / edge)) : 0);
  return ramp(size - 1 - pos) - ramp(pos);
}

// Clamp each axis to one unit and keep a diagonal from being faster than a straight line.
function limit(vx, vy) {
  vx = Math.max(-1, Math.min(1, vx));
  vy = Math.max(-1, Math.min(1, vy));
  const len = Math.hypot(vx, vy);
  return len > 1 ? { x: vx / len, y: vy / len } : { x: vx, y: vy };
}

// Screen-space edge push from a cursor position; a corner is diagonal.
export function edgeVector(mouse, size, edge = CAMERA.edge) {
  if (!mouse) return { x: 0, y: 0 };
  return limit(edgeAxis(mouse.x, size.width, edge), edgeAxis(mouse.y, size.height, edge));
}

export function createCameraRig(width, height, start = { x: width / 2, y: height / 2 }) {
  // Open on the start tile with the whole view on the map: clamp the centre to the view's half extents (16:9 until
  // the page knows its real size); a view wider than the map centres on the map.
  const halfW = (OPEN_ZOOM * 16 / 9) / 2, halfH = OPEN_ZOOM / 2 / Math.sin(CAMERA.pitch);
  const fit = (v, half, size) => (size <= 2 * half ? size / 2 : Math.max(half, Math.min(size - half, v)));
  const rig = { x: fit(start.x, halfW, width), y: fit(start.y, halfH, height), zoom: OPEN_ZOOM, keys: new Set(), mouse: null, size: { width: 1280, height: 720 }, locked: false, cursor: null };
  const clampXY = () => {
    rig.x = Math.max(0, Math.min(width - 1, rig.x));
    rig.y = Math.max(0, Math.min(height - 1, rig.y));
  };
  rig.centerOn = (x, y) => { rig.x = x; rig.y = y; clampXY(); };
  rig.zoomBy = (factor) => { rig.zoom = Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, rig.zoom * factor)); };
  // Mouse position in CSS pixels inside the game window, or null when the pointer left it (no edge-scroll then).
  rig.setMouse = (x, y) => { rig.mouse = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null; };
  // Screen-space velocity in tiles per second. Arrows and edge push add up; a diagonal is not faster than a straight line.
  rig.velocity = () => {
    let vx = 0, vy = 0;
    if (rig.keys.has('ArrowLeft')) vx -= 1;
    if (rig.keys.has('ArrowRight')) vx += 1;
    if (rig.keys.has('ArrowUp')) vy -= 1;
    if (rig.keys.has('ArrowDown')) vy += 1;
    const e = edgeVector(rig.mouse, rig.size);
    const d = limit(vx + e.x, vy + e.y);
    const k = CAMERA.speed * (rig.zoom / 24);
    return { x: d.x * k, y: d.y * k };
  };
  // Pointer Lock: the cursor becomes virtual, moved by mouse deltas and kept inside the window.
  rig.lock = (x, y) => { rig.locked = true; rig.cursor = { x, y }; rig.mouse = { x, y }; };
  rig.unlock = () => { rig.locked = false; rig.cursor = null; rig.mouse = null; };
  rig.moveCursor = (dx, dy) => {
    if (!rig.cursor) return;
    rig.cursor = { x: Math.max(0, Math.min(rig.size.width - 1, rig.cursor.x + dx)), y: Math.max(0, Math.min(rig.size.height - 1, rig.cursor.y + dy)) };
    rig.mouse = { ...rig.cursor };
  };
  // Middle-drag: the map follows the hand. `zoom` is the visible height in tiles; ground y is foreshortened by the pitch.
  rig.dragBy = (dxPx, dyPx) => {
    rig.x -= dxPx * rig.zoom / rig.size.height;
    rig.y -= dyPx * rig.zoom / (rig.size.height * Math.sin(CAMERA.pitch));
    clampXY();
  };
  rig.update = (dt) => {
    const v = rig.velocity();
    rig.x += v.x * dt;
    rig.y += v.y * dt;
    clampXY();
  };
  return rig;
}
