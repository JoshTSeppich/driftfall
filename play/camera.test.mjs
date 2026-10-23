import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraRig, CAMERA, edgeAxis, edgeVector } from './camera.mjs';
import { installPointerControls } from './input.mjs';

const size = { width: 1000, height: 600 };

test('edge band is 16 px and the push ramps up toward the edge', () => {
  assert.equal(CAMERA.edge, 16);
  assert.equal(edgeAxis(500, 1000), 0);
  assert.equal(edgeAxis(17, 1000), 0);
  const far = edgeAxis(14, 1000), near = edgeAxis(4, 1000);
  assert.ok(far < 0 && near < far, 'left side is negative and stronger nearer the edge');
  assert.equal(edgeAxis(0, 1000), -1);
  assert.equal(edgeAxis(-30, 1000), -1);
  assert.equal(edgeAxis(999, 1000), 1);
  assert.ok(edgeAxis(990, 1000) > 0 && edgeAxis(990, 1000) < 1);
});

test('corners pan diagonally and never faster than a straight push', () => {
  const v = edgeVector({ x: 0, y: 0 }, size);
  assert.ok(v.x < 0 && v.y < 0);
  assert.ok(Math.hypot(v.x, v.y) <= 1 + 1e-9);
  assert.deepEqual(edgeVector(null, size), { x: 0, y: 0 });
});

test('rig: edge speed grows toward the edge, arrows still work, clamp holds', () => {
  const a = createCameraRig(64, 64, { x: 32, y: 32 }); a.size = size;
  const b = createCameraRig(64, 64, { x: 32, y: 32 }); b.size = size;
  a.setMouse(986, 300); b.setMouse(999, 300);
  assert.ok(b.velocity().x > a.velocity().x && a.velocity().x > 0);
  const c = createCameraRig(64, 64, { x: 32, y: 32 }); c.size = size;
  c.keys.add('ArrowLeft'); c.keys.add('ArrowUp');
  const v = c.velocity();
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - CAMERA.speed * (c.zoom / 24)) < 1e-9, 'diagonal arrows = one speed');
  c.update(1000); assert.equal(c.x, 0); assert.equal(c.y, 0);
});

test('locked cursor moves by deltas, stays in the window, and pushing past an edge pans', () => {
  const r = createCameraRig(64, 64, { x: 32, y: 32 }); r.size = size;
  r.lock(500, 300);
  assert.equal(r.locked, true);
  r.moveCursor(100, -50);
  assert.deepEqual(r.cursor, { x: 600, y: 250 });
  assert.equal(r.velocity().x, 0);
  r.moveCursor(900, 0); // far past the right edge
  assert.equal(r.cursor.x, size.width - 1);
  assert.ok(r.velocity().x > 0);
  const x0 = r.x; r.update(0.5); assert.ok(r.x > x0);
  r.unlock(); assert.equal(r.locked, false); assert.equal(r.mouse, null);
});

test('middle-drag moves the map with the hand, scaled by zoom', () => {
  const r = createCameraRig(200, 200, { x: 100, y: 100 }); r.size = size;
  r.dragBy(100, 0);
  assert.ok(r.x < 100 && r.y === 100, 'dragging right moves the camera left');
  const dx = 100 - r.x;
  const r2 = createCameraRig(200, 200, { x: 100, y: 100 }); r2.size = size; r2.zoomBy(2);
  r2.dragBy(100, 0);
  assert.ok(100 - r2.x > dx, 'zoomed out drags farther');
  r.dragBy(0, 50); assert.ok(r.y < 100);
});

// A fake window/document just big enough for installPointerControls.
function emitter() {
  const l = {};
  return { l, addEventListener(t, f) { (l[t] ??= []).push(f); }, fire(t, e = {}) { (l[t] ?? []).forEach((f) => f(e)); } };
}
function fakeDom() {
  const win = emitter(), overlay = emitter(), docEl = emitter();
  const doc = emitter();
  Object.assign(overlay, {
    requestPointerLock() { doc.pointerLockElement = overlay; doc.fire('pointerlockchange'); },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  });
  Object.assign(docEl, { requestFullscreen() { doc.fullscreenElement = docEl; return Promise.resolve(); } });
  Object.assign(doc, {
    pointerLockElement: null, fullscreenElement: null, documentElement: docEl,
    exitPointerLock() { doc.pointerLockElement = null; doc.fire('pointerlockchange'); },
    exitFullscreen() { doc.fullscreenElement = null; return Promise.resolve(); },
    elementFromPoint: () => overlay,
    createElement: () => Object.assign(emitter(), { style: {}, dataset: {}, setAttribute() {}, append() {} }),
    body: { append() {} },
  });
  return { win, doc, overlay };
}

test('pointer controls: click-in locks, unlock frees, edge exit keeps panning, F11 toggles fullscreen', () => {
  const { win, doc, overlay } = fakeDom();
  const rig = createCameraRig(64, 64, { x: 32, y: 32 }); rig.size = size;
  const p = installPointerControls({ win, doc, overlay, rig });
  doc.documentElement.fire('mouseleave', { clientX: 1000, clientY: 300 });
  assert.ok(rig.velocity().x > 0, 'still panning after leaving the window');
  win.fire('mousemove', { clientX: 500, clientY: 300, target: overlay });
  assert.equal(rig.velocity().x, 0);
  overlay.fire('mousedown', { button: 0, clientX: 500, clientY: 300 });
  assert.equal(rig.locked, true);
  assert.deepEqual(p.rel({ clientX: 1, clientY: 1 }), { x: 500, y: 300 });
  win.fire('mousemove', { movementX: 40, movementY: 10, target: overlay });
  assert.deepEqual(p.rel({ clientX: 1, clientY: 1 }), { x: 540, y: 310 });
  doc.exitPointerLock();
  assert.equal(rig.locked, false);
  assert.deepEqual(p.rel({ clientX: 7, clientY: 8 }), { x: 7, y: 8 });
  let prevented = false;
  win.fire('keydown', { key: 'F11', target: {}, preventDefault() { prevented = true; } });
  assert.ok(prevented && doc.fullscreenElement);
  win.fire('keydown', { key: 'F11', target: {}, preventDefault() {} });
  assert.equal(doc.fullscreenElement, null);
});

test('pointer controls: middle-drag pans the camera', () => {
  const { win, doc, overlay } = fakeDom();
  const rig = createCameraRig(200, 200, { x: 100, y: 100 }); rig.size = size;
  installPointerControls({ win, doc, overlay, rig });
  let prevented = false;
  overlay.fire('mousedown', { button: 1, clientX: 400, clientY: 300, preventDefault() { prevented = true; } });
  assert.ok(prevented);
  win.fire('mousemove', { clientX: 450, clientY: 300, movementX: 50, movementY: 0, target: overlay });
  assert.ok(rig.x < 100);
  const x = rig.x;
  win.fire('mouseup', { button: 1 });
  win.fire('mousemove', { clientX: 500, clientY: 300, movementX: 50, movementY: 0, target: overlay });
  assert.equal(rig.x, x);
});
