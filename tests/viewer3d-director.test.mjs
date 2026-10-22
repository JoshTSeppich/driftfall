// Tests for viewer3d/camera.mjs: easing, the grid-to-ground map, orbit/pan/zoom limits, event interest,
// the TV director (hold, idle, final moments, scrubbing) and a run over a real sample match.
// Owner: haiku. Run with: node --test tests/viewer3d-director.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CAMERA_DEFAULTS as CFG,
  ease,
  gridMap,
  clampRig,
  rigToCamera,
  orbitRig,
  zoomRig,
  panRig,
  focusBounds,
  pointsFromEvents,
  createInterest,
  isEnding,
  finalShot,
  createDirector,
  createCamera,
} from "../viewer3d/camera.mjs";
import { initialState, applyTick } from "../viewer/replay.mjs";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} to be close to ${b}`);
const BOUNDS = focusBounds(32, 32);

// A plain grid map: grid x -> world x, grid y -> world z, origin at (-16, 0, -16).
const plain = (x, y) => ({ x: x - 16, y: 0, z: y - 16 });
// A scaled and rotated map, to check nothing depends on the engine's axis layout.
const turned = (x, y) => ({ x: 2 * y + 5, y: 0.5, z: -3 * x + 7 });

function frameAt(tick, { next, prev, events = [] } = {}) {
  return { tick, alpha: 0, prev: prev ?? next, next: next ?? prev, events };
}

function structure(id, kind, x, y, extra = {}) {
  return { id, owner: 0, kind, x, y, hp: 100, progress: 0, complete: true, queue: [], ...extra };
}

function unit(id, kind, x, y) {
  return { id, owner: 1, kind, x, y, hp: 40, carrying: 0, order: null };
}

test("ease closes the gap the same way however the time is split", () => {
  const once = ease(0, 10, 0.4, 0.7);
  const twice = ease(ease(0, 10, 0.2, 0.7), 10, 0.2, 0.7);
  near(once, twice, 1e-9);
});

test("ease closes half the gap after one half-life and never overshoots", () => {
  near(ease(0, 10, 1.1, 1.1), 5, 1e-9);
  assert.equal(ease(3, 3, 5, 0.7), 3);
  let v = 0;
  for (let i = 0; i < 1000; i++) {
    const next = ease(v, 10, 0.016, 0.7);
    assert.ok(next >= v && next <= 10, "moves toward the goal without overshoot");
    v = next;
  }
  near(v, 10, 1e-3);
});

test("ease with no half-life jumps straight to the goal and zero time does not move", () => {
  assert.equal(ease(0, 4, 0.1, 0), 4);
  assert.equal(ease(1, 4, 0, 0.7), 1);
});

test("gridMap round-trips tiles and reports the tile size on both layouts", () => {
  for (const f of [plain, turned]) {
    const map = gridMap(f);
    for (const [x, y] of [[0, 0], [5.5, 9], [31, 2]]) {
      const w = map.toWorld(x, y);
      const g = map.toGrid(w.x, w.z);
      near(g.x, x, 1e-9);
      near(g.y, y, 1e-9);
    }
  }
  near(gridMap(plain).tile, 1, 1e-9);
  near(gridMap(turned).tile, Math.sqrt(2 * 3), 1e-9);
});

test("gridMap refuses a mapping that flattens the grid", () => {
  assert.throws(() => gridMap(() => ({ x: 0, y: 0, z: 0 })), /ground/);
});

test("clampRig keeps pitch, distance and focus inside the limits", () => {
  const r = clampRig({ x: 99, y: -99, yaw: 0, pitch: 5, distance: 500 }, BOUNDS);
  assert.equal(r.x, BOUNDS.maxX);
  assert.equal(r.y, BOUNDS.minY);
  assert.equal(r.pitch, CFG.maxPitch);
  assert.equal(r.distance, CFG.maxDistance);
});

test("orbit and zoom respect the limits; zoom in shrinks the distance", () => {
  const rig = { x: 16, y: 16, yaw: 0, pitch: 0.95, distance: 20 };
  assert.equal(orbitRig(rig, 0, 10).pitch, CFG.maxPitch);
  assert.equal(orbitRig(rig, 0, -10).pitch, CFG.minPitch);
  assert.ok(zoomRig(rig, 0.5).distance < rig.distance);
  assert.equal(zoomRig(rig, 1e6).distance, CFG.maxDistance);
  assert.equal(zoomRig(rig, 1e-6).distance, CFG.minDistance);
});

test("the camera sits above the ground and looks at the focus at the right distance", () => {
  const rig = { x: 10, y: 12, yaw: 0.3, pitch: 0.9, distance: 18 };
  for (const f of [plain, turned]) {
    const map = gridMap(f);
    const cam = rigToCamera(rig, map);
    assert.ok(cam.position.y > cam.target.y, "camera above the focus");
    const d = Math.hypot(cam.position.x - cam.target.x, cam.position.y - cam.target.y, cam.position.z - cam.target.z);
    near(d, rig.distance * map.tile, 1e-9);
  }
});

test("dragging right pans the ground right, and dragging down moves away from the viewer", () => {
  const map = gridMap(plain);
  const rig = { x: 16, y: 16, yaw: 0, pitch: 0.95, distance: 20 };
  const right = panRig(rig, map, 100, 0, BOUNDS);
  assert.ok(right.x < rig.x, "drag right: focus moves left in grid x, so the ground follows the mouse");
  near(right.y, rig.y, 1e-9);
  const down = panRig(rig, map, 0, 100, BOUNDS);
  assert.ok(down.y < rig.y, "drag down: focus moves toward the far (low y) edge when yaw is zero");
});

test("panning stops at the map edge", () => {
  const map = gridMap(plain);
  let rig = { x: 16, y: 16, yaw: 0, pitch: 0.95, distance: 20 };
  for (let i = 0; i < 200; i++) rig = panRig(rig, map, 500, 0, BOUNDS);
  assert.ok(rig.x >= BOUNDS.minX && rig.x <= BOUNDS.maxX);
  assert.equal(rig.x, BOUNDS.minX);
});

test("events become interest: hits at the target and attacker, deaths, big builds and spawns", () => {
  const prev = { units: [unit(7, "grunt", 3, 3)], structures: [structure(9, "forge", 10, 10, { complete: false })] };
  const next = { units: [unit(8, "lancer", 4, 3)], structures: [structure(9, "forge", 10, 10)] };
  const pts = pointsFromEvents({
    tick: 5,
    prev,
    next,
    events: [
      { e: "hit", id: 7, by: 8, dmg: 10, hp: 30 },
      { e: "die", id: 7 },
      { e: "done", id: 9 },
      { e: "spawn", structure: structure(11, "turret", 20, 20, { complete: false }) },
      { e: "deliver", id: 8, amount: 10, shards: 100 },
    ],
  });
  const fight = pts.filter((p) => p.kind === "fight");
  const build = pts.filter((p) => p.kind === "build");
  assert.equal(fight.length, 3, "target, attacker, and the death");
  assert.equal(build.length, 2, "the finished Forge and the new Turret site");
  assert.ok(!pts.some((p) => p.x === 0), "deliveries add nothing");
});

test("a finished Worker or Core is not a big build", () => {
  const next = { units: [], structures: [structure(2, "core", 3, 3), structure(4, "forge", 5, 5)] };
  const pts = pointsFromEvents({ tick: 1, next, events: [{ e: "done", id: 2 }] });
  assert.equal(pts.length, 0);
});

test("interest fades per tick, drops tiny weights and totals what is left", () => {
  const i = createInterest(CFG);
  i.add([{ x: 1, y: 1, w: 1, kind: "fight" }]);
  i.age(10);
  near(i.total(), Math.pow(CFG.decay, 10), 1e-9);
  i.age(10000);
  assert.equal(i.total(), 0);
  assert.equal(i.best(), null);
});

test("the busiest bin wins, its centroid is weighted, and builds read as a build shot", () => {
  const i = createInterest(CFG);
  i.add([
    { x: 1, y: 1, w: 3, kind: "fight" },
    { x: 2, y: 2, w: 3, kind: "fight" },
    { x: 25, y: 25, w: 2, kind: "fight" },
  ]);
  const b = i.best();
  assert.equal(b.mode, "fight");
  near(b.x, 1.5, 1e-9);
  near(b.y, 1.5, 1e-9);
  const j = createInterest(CFG);
  j.add([{ x: 20, y: 20, w: 2, kind: "build" }, { x: 1, y: 1, w: 1, kind: "fight" }]);
  assert.equal(j.best().mode, "build");
});

test("the final shot is on the Core that fell, else the midpoint of the Cores, else the map centre", () => {
  const cores = [structure(1, "core", 3, 3), structure(2, "core", 28, 28)];
  const mid = finalShot({ tick: 1900, next: { structures: cores }, events: [] }, 32, 32);
  near(mid.x, 15.5, 1e-9);
  near(mid.y, 15.5, 1e-9);
  const fallen = finalShot({ tick: 1900, next: { structures: cores.slice(1) }, events: [] }, 32, 32, CFG, { x: 3, y: 3 });
  assert.deepEqual([fallen.x, fallen.y], [3, 3]);
  const none = finalShot({ tick: 1900, next: { structures: [] } }, 32, 32);
  assert.deepEqual([none.x, none.y], [16, 16]);
});

test("the match is in its final moments near the end or once a result exists", () => {
  assert.equal(isEnding(frameAt(1000)), false);
  assert.equal(isEnding(frameAt(CFG.maxTicks - CFG.endingTicks)), true);
  assert.equal(isEnding({ tick: 10, next: {}, result: { winner: 0 } }), true);
});

test("the director holds a shot for the hold time, then switches to a new fight", () => {
  const d = createDirector({ holdSeconds: 3 });
  const a = structure(1, "core", 3, 3);
  const f1 = frameAt(10, { next: { structures: [a], units: [unit(20, "grunt", 4, 4), unit(21, "grunt", 5, 4)] }, events: [{ e: "hit", id: 20, by: 21 }] });
  const first = d.update(f1, 0.1);
  assert.ok(first && first.mode === "fight");
  const farFight = frameAt(11, {
    next: { structures: [a], units: [unit(30, "lancer", 25, 25), unit(31, "lancer", 26, 25)] },
    events: [{ e: "hit", id: 30, by: 31 }, { e: "hit", id: 30, by: 31 }],
  });
  const during = d.update(farFight, 1);
  assert.equal(during.x, first.x, "no cut before the hold time is over");
  let shot = during;
  for (let t = 12; t < 60; t++) shot = d.update(frameAt(t, { next: { structures: [a], units: [] }, events: [] }), 0.2);
  assert.ok(shot.x > 20, "after the hold time the shot moves to the new fight");
});

test("with no action the director goes back to the overview after the idle time", () => {
  const d = createDirector({ idleSeconds: 2, width: 32, height: 32 });
  const quiet = frameAt(1, { next: { structures: [] } });
  d.update(quiet, 0.5);
  const later = d.update(frameAt(2, { next: { structures: [] } }), 2);
  assert.equal(later.mode, "overview");
  near(later.x, 16, 1e-9);
});

test("the director takes the final shot at once, even inside a hold", () => {
  const d = createDirector({ holdSeconds: 100 });
  const cores = [structure(1, "core", 3, 3), structure(2, "core", 28, 28)];
  d.update(frameAt(10, { next: { structures: cores, units: [unit(20, "grunt", 4, 4)] }, events: [{ e: "hit", id: 20, by: 20 }] }), 0.1);
  const end = d.update(frameAt(CFG.maxTicks - 1, { next: { structures: cores, units: [] }, events: [] }), 0.1);
  assert.equal(end.mode, "final");
  near(end.x, 15.5, 1e-9);
});

test("the director keeps the Core that fell in the final shot after the match ends", () => {
  const d = createDirector({});
  const prev = { structures: [structure(1, "core", 3, 3), structure(2, "core", 28, 28)], units: [] };
  const next = { structures: [structure(2, "core", 28, 28)], units: [] };
  d.update(frameAt(900, { prev, next, events: [{ e: "die", id: 1 }] }), 0.1);
  const end = d.update({ tick: 1000, prev: next, next, result: { winner: 1 }, events: [] }, 0.1);
  assert.equal(end.mode, "final");
  assert.deepEqual([end.x, end.y], [3, 3]);
});

test("scrubbing back clears the interest, and repeating a tick adds nothing new", () => {
  const d = createDirector({});
  const next = { structures: [structure(1, "core", 3, 3)], units: [unit(20, "grunt", 4, 4)] };
  const hit = { tick: 50, prev: next, next, events: [{ e: "hit", id: 20, by: 20 }] };
  d.update(hit, 0.1);
  const once = d.interest();
  d.update(hit, 0.1);
  near(d.interest(), once, 1e-9);
  d.update(frameAt(3, { next, events: [] }), 0.1);
  near(d.interest(), 0, 1e-9);
});

test("the director never returns NaN or throws on empty or odd frames", () => {
  const d = createDirector({});
  assert.equal(d.update(null, 0.1), null);
  assert.equal(d.update({ tick: 4 }, 0.1), null);
  const s = d.update(frameAt(5, { next: { structures: [], units: [] }, events: [{ e: "hit", id: 99, by: 98 }, { e: "weird" }] }), 0.1);
  assert.ok(s === null || Object.values(s).every((v) => typeof v !== "number" || Number.isFinite(v)));
});

test("createCamera moves ctx.camera, lets the director drive it, and yields to the mouse", () => {
  const calls = { pos: [], look: [] };
  const THREE = { Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } } };
  const camera = {
    position: { set: (x, y, z) => calls.pos.push([x, y, z]) },
    lookAt: (v) => calls.look.push([v.x, v.y, v.z]),
  };
  const ctx = { THREE, camera, gridToWorld: plain };
  const cam = createCamera(ctx, { tv: true, width: 32, height: 32, canvas: null });
  assert.equal(calls.pos.length, 1, "applies the home view once at creation");

  const next = { structures: [structure(1, "core", 3, 3)], units: [unit(20, "grunt", 25, 25), unit(21, "grunt", 26, 25)] };
  for (let t = 1; t < 30; t++) cam.update(frameAt(t, { next, events: [{ e: "hit", id: 20, by: 21 }] }), 0.05);
  const s = cam.state();
  assert.equal(s.directorOn, true);
  assert.ok(s.x > 16, "the camera eases toward the fight at (25,25)");
  assert.ok(calls.pos.length > 1, "ctx.camera was moved");

  cam.update(frameAt(31, { next, events: [] }), 0.05);
  cam.reset();
  cam.setDirector(false);
  cam.dispose();
  assert.equal(cam.state().directorOn, false);
});

test("createCamera with the director off holds the home view", () => {
  const calls = [];
  const THREE = { Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } } };
  const camera = { position: { set: (...a) => calls.push(a) }, lookAt() {} };
  const cam = createCamera({ THREE, camera, gridToWorld: plain }, { tv: false, width: 32, height: 32 });
  const before = cam.state();
  const next = { structures: [structure(1, "core", 3, 3)], units: [unit(20, "grunt", 25, 25)] };
  cam.update(frameAt(3, { next, events: [{ e: "hit", id: 20, by: 20 }] }), 0.5);
  const after = cam.state();
  assert.equal(after.x, before.x);
  assert.equal(after.distance, before.distance);
});

test("the director runs over a real sample match without NaN and ends on the final shot", () => {
  const url = new URL("../matches/sample-7.json", import.meta.url);
  if (!fs.existsSync(url)) return; // the sample log is optional for this test
  const log = JSON.parse(fs.readFileSync(url, "utf8"));
  const state = initialState(log);
  const d = createDirector({ maxTicks: log.stats.match.maxTicks });
  let shots = 0;
  let last = null;
  const start = state.tick;
  for (let i = 0; i < log.ticks.length; i++) {
    const entry = log.ticks[i];
    const prev = structuredClone(state);
    applyTick(state, entry, log.stats);
    state.tick = start + i + 1; // applyTick only applies events; the tick is counted here
    const ended = i === log.ticks.length - 1;
    const frame = { tick: state.tick, alpha: 0, prev, next: structuredClone(state), events: entry.events, result: ended ? log.result : null };
    last = d.update(frame, 0.05);
    if (last) {
      shots++;
      assert.ok(Number.isFinite(last.x) && Number.isFinite(last.y) && Number.isFinite(last.distance));
    }
  }
  assert.ok(shots > 0, "the director had something to show");
  assert.equal(last.mode, "final");
});
