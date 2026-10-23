// Camera for the 3D viewer: orbit, pan and zoom with the mouse, plus the TV auto-director (?tv=1).
// Owner: haiku. Most of this file is plain math on numbers so node can test it; createCamera() is the thin layer
// that moves ctx.camera. Focus and distance are kept in grid tiles, so the director never needs THREE.
//
// Controls: drag = orbit, right-drag or shift-drag = pan, wheel = zoom, V = toggle the director, R = reset view.
// Any mouse input pauses the director for a few seconds, then it takes over again.

export const CAMERA_DEFAULTS = {
  yaw: Math.PI / 4, // 45 degrees, the three-quarter view
  pitch: 0.95, // radians above the ground
  distance: 22, // tiles from the focus point to the camera
  overviewDistance: 28,
  minDistance: 6,
  maxDistance: 40,
  minPitch: 0.35,
  maxPitch: 1.3,
  halfLife: { focus: 0.7, distance: 1.1 }, // seconds for the camera to close half the gap to its goal
  holdSeconds: 3, // TV: minimum time on one shot before the director switches
  idleSeconds: 6, // TV: no action this long -> back to the overview
  manualSeconds: 10, // mouse input pauses the director this long
  endingTicks: 240, // the last ticks of the match get the final-moments shot
  maxTicks: 2000, // STATS.match.maxTicks
  bin: 6, // interest grid cell size, in tiles
  decay: 0.96, // interest fades by this factor per tick
  maxJump: 60, // a jump of more ticks than this (scrubbing) clears the interest
  buildBonus: 1.2, // big builds count a little more than fights of the same weight
  minShotMove: 3, // tiles: a new goal this close to the current shot is not worth a cut
};

// Weights per event kind. A destroyed structure is worth more than a destroyed unit; a finished Forge or Turret
// is a big build. Deliveries are economy, not action, so they do not count.
export const EVENT_WEIGHTS = { hit: 1, dieUnit: 4, dieStructure: 6, done: 6, spawnStructure: 2 };

// Any finished structure except the Core is a build worth a cut, so new buildings need no change here.
export function isBigBuild(kind) {
  return kind !== "core";
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Frame-rate independent easing: after `dt` seconds the value has closed 1 - 0.5^(dt/halfLife) of the gap.
export function ease(current, goal, dt, halfLife) {
  if (!(halfLife > 0)) return goal;
  const k = 1 - Math.pow(0.5, Math.max(0, dt) / halfLife);
  return current + (goal - current) * k;
}

// Maps grid tiles to the ground plane using ctx.gridToWorld, so the camera works whatever the engine's
// axis layout is. gridToWorld must be linear over the grid (the usual case) and must put the grid on the x/z plane.
export function gridMap(gridToWorld) {
  const o = gridToWorld(0, 0);
  const ex = gridToWorld(1, 0);
  const ey = gridToWorld(0, 1);
  const ax = ex.x - o.x;
  const az = ex.z - o.z;
  const bx = ey.x - o.x;
  const bz = ey.z - o.z;
  const det = ax * bz - bx * az;
  if (!(Math.abs(det) > 1e-9)) throw new Error("gridToWorld must map the grid onto the ground (x and z) plane");
  return {
    origin: { x: o.x, y: o.y, z: o.z },
    // Ground tile size in world units (the side of one tile's square on the ground).
    tile: Math.sqrt(Math.abs(det)),
    toWorld(gx, gy) {
      return { x: o.x + gx * ax + gy * bx, y: o.y, z: o.z + gx * az + gy * bz };
    },
    // Grid position for a world (x, z) on the ground.
    toGrid(wx, wz) {
      const dx = wx - o.x;
      const dz = wz - o.z;
      return { x: (dx * bz - bx * dz) / det, y: (ax * dz - az * dx) / det };
    },
    // Grid offset for a world offset (dx, dz) with no origin shift.
    toGridDelta(dx, dz) {
      return { x: (dx * bz - bx * dz) / det, y: (ax * dz - az * dx) / det };
    },
  };
}

// A rig is the camera's orbit around a focus point: { x, y, yaw, pitch, distance } (x, y in tiles, angles in radians).
export function clampRig(rig, bounds, limits = CAMERA_DEFAULTS) {
  return {
    ...rig,
    x: clamp(rig.x, bounds.minX, bounds.maxX),
    y: clamp(rig.y, bounds.minY, bounds.maxY),
    pitch: clamp(rig.pitch, limits.minPitch, limits.maxPitch),
    distance: clamp(rig.distance, limits.minDistance, limits.maxDistance),
  };
}

// Camera position and look-at point in world units for a rig.
export function rigToCamera(rig, map) {
  const dist = rig.distance * map.tile;
  const flat = dist * Math.cos(rig.pitch);
  const focus = map.toWorld(rig.x, rig.y);
  return {
    position: {
      x: focus.x + flat * Math.sin(rig.yaw),
      y: focus.y + dist * Math.sin(rig.pitch),
      z: focus.z + flat * Math.cos(rig.yaw),
    },
    target: focus,
  };
}

export function orbitRig(rig, dYaw, dPitch, limits = CAMERA_DEFAULTS) {
  return { ...rig, yaw: rig.yaw + dYaw, pitch: clamp(rig.pitch + dPitch, limits.minPitch, limits.maxPitch) };
}

export function zoomRig(rig, factor, limits = CAMERA_DEFAULTS) {
  return { ...rig, distance: clamp(rig.distance * factor, limits.minDistance, limits.maxDistance) };
}

// Moves the focus across the ground by a screen-space drag (pixels). Drag right moves the ground right on screen;
// drag down moves the focus away from the viewer (toward the far edge), like grabbing the ground.
export function panRig(rig, map, dxPx, dyPx, bounds, limits = CAMERA_DEFAULTS) {
  const worldPerPx = rig.distance * map.tile * 0.0015;
  const right = { x: Math.cos(rig.yaw), z: -Math.sin(rig.yaw) };
  const away = { x: -Math.sin(rig.yaw), z: -Math.cos(rig.yaw) };
  const dx = (-dxPx * right.x + dyPx * 1.5 * away.x) * worldPerPx;
  const dz = (-dxPx * right.z + dyPx * 1.5 * away.z) * worldPerPx;
  const g = map.toGridDelta(dx, dz);
  return clampRig({ ...rig, x: rig.x + g.x, y: rig.y + g.y }, bounds, limits);
}

// Bounds the focus to the map plus a small margin.
export function focusBounds(width, height, margin = 2) {
  return { minX: -margin, maxX: width - 1 + margin, minY: -margin, maxY: height - 1 + margin };
}

// Finds where an entity was: in the tick's state first, then in the state before it (for things that died).
function locate(frame, id) {
  for (const state of [frame.next, frame.prev]) {
    if (!state) continue;
    const u = state.units?.find((e) => e.id === id);
    if (u) return { x: u.x, y: u.y, structure: false, kind: u.kind };
    const s = state.structures?.find((e) => e.id === id);
    if (s) return { x: s.x, y: s.y, structure: true, kind: s.kind };
  }
  return null;
}

// Turns one tick's events into weighted points of interest: { x, y, w, kind } with kind 'fight' or 'build'.
export function pointsFromEvents(frame) {
  const out = [];
  const W = EVENT_WEIGHTS;
  for (const ev of frame.events ?? []) {
    if (ev.e === "hit") {
      const t = locate(frame, ev.id);
      if (t) out.push({ x: t.x, y: t.y, w: W.hit, kind: "fight" });
      const a = locate(frame, ev.by);
      if (a) out.push({ x: a.x, y: a.y, w: W.hit * 0.5, kind: "fight" });
    } else if (ev.e === "die") {
      const t = locate(frame, ev.id);
      if (t) out.push({ x: t.x, y: t.y, w: t.structure ? W.dieStructure : W.dieUnit, kind: "fight" });
    } else if (ev.e === "done") {
      const s = frame.next?.structures?.find((e) => e.id === ev.id);
      if (s && isBigBuild(s.kind)) out.push({ x: s.x, y: s.y, w: W.done, kind: "build" });
    } else if (ev.e === "spawn" && ev.structure) {
      out.push({ x: ev.structure.x, y: ev.structure.y, w: W.spawnStructure, kind: "build" });
    }
  }
  return out;
}

// Weighted interest that fades over time. Points are kept in tiles.
export function createInterest(cfg = CAMERA_DEFAULTS) {
  let points = [];
  return {
    add(list) {
      for (const p of list) points.push(p);
    },
    age(ticks) {
      if (ticks <= 0) return;
      const k = Math.pow(cfg.decay, ticks);
      for (const p of points) p.w *= k;
      points = points.filter((p) => p.w > 0.02);
    },
    clear() {
      points = [];
    },
    total() {
      let sum = 0;
      for (const p of points) sum += p.w;
      return sum;
    },
    // The busiest area: the best bin (and its neighbours) with a centroid and a radius that says how spread out it is.
    // Returns null when nothing is happening.
    best() {
      const bins = new Map();
      for (const p of points) {
        const bx = Math.floor(p.x / cfg.bin);
        const by = Math.floor(p.y / cfg.bin);
        const key = `${bx},${by}`;
        let b = bins.get(key);
        if (!b) bins.set(key, (b = { bx, by, fight: 0, build: 0 }));
        b[p.kind] += p.w;
      }
      let top = null;
      for (const b of bins.values()) {
        const score = b.fight + b.build * cfg.buildBonus;
        if (score > 0 && (!top || score > top.score)) top = { ...b, score };
      }
      if (!top) return null;
      let sw = 0;
      let sx = 0;
      let sy = 0;
      const near = [];
      for (const p of points) {
        const bx = Math.floor(p.x / cfg.bin);
        const by = Math.floor(p.y / cfg.bin);
        if (Math.abs(bx - top.bx) <= 1 && Math.abs(by - top.by) <= 1) {
          near.push(p);
          sw += p.w;
          sx += p.x * p.w;
          sy += p.y * p.w;
        }
      }
      const x = sx / sw;
      const y = sy / sw;
      let spread = 0;
      for (const p of near) spread += p.w * ((p.x - x) ** 2 + (p.y - y) ** 2);
      return {
        x,
        y,
        radius: Math.sqrt(spread / sw),
        score: top.score,
        mode: top.build * cfg.buildBonus > top.fight ? "build" : "fight",
      };
    },
  };
}

export function isEnding(frame, cfg = CAMERA_DEFAULTS) {
  if (frame.result ?? frame.next?.result) return true;
  return frame.tick >= cfg.maxTicks - cfg.endingTicks;
}

// Final moments: stay on the Core that fell, or on the midpoint between the two Cores while both stand.
// `fallen` is the last Core that died, as remembered by the director ({ x, y }), or null.
export function finalShot(frame, width, height, cfg = CAMERA_DEFAULTS, fallen = null) {
  if (fallen) return { x: fallen.x, y: fallen.y, distance: 14, mode: "final" };
  const cores = (frame.next?.structures ?? []).filter((s) => s.kind === "core");
  if (cores.length) {
    const x = cores.reduce((s, c) => s + c.x, 0) / cores.length;
    const y = cores.reduce((s, c) => s + c.y, 0) / cores.length;
    return { x, y, distance: 24, mode: "final" };
  }
  return { x: width / 2, y: height / 2, distance: cfg.overviewDistance, mode: "final" };
}

// The TV director. Feed it frames; it returns the shot it wants: { x, y, distance, mode }.
// Shots change only after the hold time, unless the match reaches its final moments.
export function createDirector(opts = {}) {
  const cfg = { ...CAMERA_DEFAULTS, ...opts };
  const interest = createInterest(cfg);
  let lastTick = null;
  let shot = null;
  let holdLeft = 0;
  let idle = 0;
  let width = 32;
  let height = 32;
  let fallen = null; // the last Core that died, kept for the final shot

  function ingest(frame) {
    const t = frame.tick;
    if (lastTick !== null && t < lastTick) fallen = null; // scrubbed back: the death may not have happened yet
    if (lastTick === null || t < lastTick || t - lastTick > cfg.maxJump) {
      interest.clear();
    } else if (t > lastTick) {
      interest.age(t - lastTick);
    } else {
      return; // same tick again (paused or a render between ticks): nothing new
    }
    lastTick = t;
    for (const ev of frame.events ?? []) {
      if (ev.e !== "die") continue;
      const core = frame.prev?.structures?.find((s) => s.id === ev.id && s.kind === "core");
      if (core) fallen = { x: core.x, y: core.y };
    }
    interest.add(pointsFromEvents(frame));
  }

  function candidate(frame, dt) {
    if (isEnding(frame, cfg)) return finalShot(frame, width, height, cfg, fallen);
    const b = interest.best();
    if (!b) {
      idle += dt;
      if (idle < cfg.idleSeconds) return shot && shot.mode !== "overview" ? shot : null;
      return { x: width / 2, y: height / 2, distance: cfg.overviewDistance, mode: "overview" };
    }
    idle = 0;
    // A tight fight reads close, a spread-out one pulls back, and both stay inside the zoom limits.
    const distance = clamp(cfg.distance * 0.6 + b.radius * 1.4 + 4, cfg.minDistance, cfg.maxDistance);
    return { x: b.x, y: b.y, distance, mode: b.mode };
  }

  return {
    // Map size from the state, so the overview centres correctly on any map.
    setSize(w, h) {
      width = w;
      height = h;
    },
    // Advances the director by one frame. Returns the current committed shot (or null before the first one).
    update(frame, dt) {
      if (!frame || !frame.next) return shot;
      if (frame.next.width) width = frame.next.width;
      if (frame.next.height) height = frame.next.height;
      ingest(frame);
      holdLeft -= dt;
      const want = candidate(frame, dt);
      if (!want) return shot;
      const final = want.mode === "final";
      const modeChanged = !shot || shot.mode !== want.mode;
      const far = !shot || Math.hypot(want.x - shot.x, want.y - shot.y) > cfg.minShotMove;
      if (final ? !shot || shot.mode !== "final" : holdLeft <= 0 && (modeChanged || far)) {
        shot = want;
        holdLeft = cfg.holdSeconds;
      } else if (final && shot.mode === "final") {
        // Keep following the final focus so a Core falling mid-shot is seen.
        shot = want;
      }
      return shot;
    },
    shot: () => shot,
    interest: () => interest.total(),
  };
}

// Thin layer: wires the rig to ctx.camera and the mouse, keyboard and director. Returns { update, dispose, state }.
export function createCamera(ctx, opts = {}) {
  const cfg = { ...CAMERA_DEFAULTS, ...opts };
  const { THREE, camera, gridToWorld } = ctx;
  const map = gridMap(gridToWorld);
  const el = opts.canvas ?? ctx.renderer?.domElement ?? null;
  const search = globalThis.location?.search ?? "";
  let directorOn = opts.tv ?? new URLSearchParams(search).has("tv");
  const director = createDirector(cfg);
  const width = opts.width ?? 32;
  const height = opts.height ?? 32;
  director.setSize(width, height);
  const bounds = focusBounds(width, height);
  const home = { x: width / 2, y: height / 2, yaw: cfg.yaw, pitch: cfg.pitch, distance: cfg.distance };
  let rig = { ...home };
  let manualLeft = 0;
  let goal = null;
  let drag = null;

  const touch = () => {
    manualLeft = cfg.manualSeconds;
  };

  const onDown = (e) => {
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    el?.setPointerCapture?.(e.pointerId);
    touch();
  };
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) rig = panRig(rig, map, dx, dy, bounds, cfg);
    else rig = orbitRig(rig, dx * 0.006, -dy * 0.004, cfg);
    touch();
  };
  const onUp = () => {
    drag = null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    rig = zoomRig(rig, Math.exp(e.deltaY * 0.001), cfg);
    touch();
  };
  const onKey = (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === "v" || e.key === "V") directorOn = !directorOn;
    if (e.key === "r" || e.key === "R") {
      rig = { ...home };
      manualLeft = 0;
    }
  };
  const onContext = (e) => e.preventDefault();

  el?.addEventListener("pointerdown", onDown);
  el?.addEventListener("wheel", onWheel, { passive: false });
  el?.addEventListener("contextmenu", onContext);
  globalThis.addEventListener?.("pointermove", onMove);
  globalThis.addEventListener?.("pointerup", onUp);
  globalThis.addEventListener?.("keydown", onKey);

  function apply() {
    const cam = rigToCamera(rig, map);
    camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    camera.lookAt(new THREE.Vector3(cam.target.x, cam.target.y, cam.target.z));
  }

  apply();

  return {
    update(frame, dt) {
      const step = clamp(dt ?? 0, 0, 0.1);
      const shot = director.update(frame, step);
      if (manualLeft > 0) manualLeft -= step;
      else if (directorOn && shot) {
        goal = shot;
        rig = clampRig(
          {
            ...rig,
            x: ease(rig.x, goal.x, step, cfg.halfLife.focus),
            y: ease(rig.y, goal.y, step, cfg.halfLife.focus),
            distance: ease(rig.distance, goal.distance, step, cfg.halfLife.distance),
          },
          bounds,
          cfg,
        );
      }
      apply();
    },
    dispose() {
      el?.removeEventListener("pointerdown", onDown);
      el?.removeEventListener("wheel", onWheel);
      el?.removeEventListener("contextmenu", onContext);
      globalThis.removeEventListener?.("pointermove", onMove);
      globalThis.removeEventListener?.("pointerup", onUp);
      globalThis.removeEventListener?.("keydown", onKey);
    },
    // For the HUD and tests: where the camera is looking and what the director wants.
    state: () => ({ ...rig, directorOn, goal, manualLeft }),
    setDirector(on) {
      directorOn = !!on;
    },
    reset() {
      rig = { ...home };
      manualLeft = 0;
    },
  };
}
