// Driftfall 3D viewer integration checks (owner: fable, 3D visual QA and performance).
//
// What this file holds everyone to, straight from VISUAL-3D.md:
//   1. every viewer3d/*.mjs (and viewer3d/shaders/*.mjs) parses and imports in node;
//   2. each module exports the factory named in the contract (createWorld, createEngine, loadAssets, createXxx)
//      and the factories that can run without a GPU return { update, dispose };
//   3. viewer3d/index.html has the Three.js import map and imports every module that exists;
//   4. every file named in assets/models/MANIFEST.json, assets/audio/MANIFEST.json and assets/sprites/MANIFEST.json
//      is really on disk;
//   5. every unit, structure and tile kind in ENV-SPEC.md (read live from env/stats.mjs, so the v3 roster is picked
//      up as soon as it lands there) is named in the module that must render it;
//   6. world.mjs frames are correct and fast on the real matches/sample-7.json;
//   7. the CPU side of each scene system stays inside a frame budget when fed real frames.
//
// A module that has not landed yet is reported as "not landed" and skipped, so the suite stays green until an owner
// ships a file; from then on the contract is enforced. Modules that need a browser (hud, audio, camera controls,
// engine) are imported and checked for exports only; their factories are tried with stub DOM and the result is
// reported, not asserted. Nothing here opens a window or a server.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V3D = path.join(ROOT, "viewer3d");
const SAMPLE = path.join(ROOT, "matches", "sample-7.json");

// ---------- the contract (VISUAL-3D.md "Shared interfaces" and "Owners") ----------

// file → { owner, factory, kind }   kind: 'world' | 'engine' | 'assets' | 'palette' | 'system' | 'browser-system'
const CONTRACT = {
  "world.mjs": { owner: "sonnet", factory: "createWorld", kind: "world" },
  "engine.mjs": { owner: "fable", factory: "createEngine", kind: "engine" },
  "palette.mjs": { owner: "fable", factory: null, kind: "palette" },
  "assets.mjs": { owner: "fable", factory: "loadAssets", kind: "assets" },
  "terrain.mjs": { owner: "sonnet", factory: "createTerrain", kind: "system" },
  "units.mjs": { owner: "fable", factory: "createUnits", kind: "system" },
  "buildings.mjs": { owner: "haiku", factory: "createBuildings", kind: "system" },
  "vfx.mjs": { owner: "sonnet", factory: "createVfx", kind: "system" },
  "camera.mjs": { owner: "haiku", factory: "createCamera", kind: "browser-system" },
  "hud.mjs": { owner: "haiku", factory: "createHud", kind: "browser-system" },
  "audio.mjs": { owner: "haiku", factory: "createAudio", kind: "browser-system" },
  // Extra files from roles/ROLES.md; optional, but if present they follow the createXxx(ctx) rule.
  "anim.mjs": { owner: "animation programmer", factory: "createAnim", kind: "system", optional: true },
  "physics.mjs": { owner: "physics programmer", factory: "createPhysics", kind: "system", optional: true },
  "platform.mjs": { owner: "platform programmer", factory: "createPlatform", kind: "browser-system", optional: true },
};

// Which module must know about which kinds. Tile kinds come from ENV-SPEC §2.
const RENDER_OWNERS = {
  units: "units.mjs",
  structures: "buildings.mjs",
  terrain: "terrain.mjs",
};
// Each entry lists the accepted spellings (the v3 draft calls open tiles "floor" and crystal tiles "shard").
const TILE_KINDS = [["open", "floor"], ["rock"], ["crystal", "shard"]];

// Budgets (CPU only, node, no GPU): generous enough for a laptop running the suite, tight enough to catch a
// per-frame rebuild of the whole scene.
const BUDGET = {
  worldBuildMs: 1500, // createWorld on a 2000-tick log
  worldFrameMs: 4, // average per frame(t) while playing straight through
  systemUpdateMs: 6, // average per update(frame, dt) per system
};

// ---------- helpers ----------

const exists = (p) => fs.existsSync(p);
const listModules = () => {
  if (!exists(V3D)) return [];
  const out = [];
  for (const f of fs.readdirSync(V3D)) if (f.endsWith(".mjs")) out.push(f);
  const shaders = path.join(V3D, "shaders");
  if (exists(shaders)) for (const f of fs.readdirSync(shaders)) if (f.endsWith(".mjs")) out.push(path.join("shaders", f));
  return out.sort();
};

function nodeCheck(file) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  return { ok: r.status === 0, err: (r.stderr || "").trim() };
}

// Minimal browser stand-ins so modules that touch the DOM at import or factory time can at least be inspected.
// Anything at all: calling it, reading it or using it as a number gives back another one. Used as a 2D canvas
// context so modules that paint a texture (gradients, text) at factory time can run in node.
function anything() {
  return new Proxy(function () {}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "then") return undefined;
      return anything();
    },
    set(target, prop, value) { target[prop] = value; return true; },
    apply() { return anything(); },
  });
}

// A proxy WebGL2 context: enough for THREE.WebGLRenderer, the composer and the materials to be built in node and
// stepped, with every draw a no-op (credit: the Classic renderer fable's .sandbox/fable-classic/smoke-render.mjs).
function glProxy(canvasRef) {
  const noop = () => {};
  return new Proxy({}, {
    get(_, k) {
      if (k === "getParameter") return (p) => (p === 7938 ? "WebGL 2.0" : p === 7937 ? "stub" : 16);
      if (k === "getExtension") return () => null;
      if (k === "getSupportedExtensions") return () => [];
      if (k === "getShaderPrecisionFormat") return () => ({ rangeMin: 127, rangeMax: 127, precision: 23 });
      if (k === "getContextAttributes") return () => ({ alpha: false, antialias: true, premultipliedAlpha: true, stencil: false, depth: true });
      if (k === "getShaderParameter" || k === "getProgramParameter") return () => true;
      if (k === "getShaderInfoLog" || k === "getProgramInfoLog") return () => "";
      if (k === "getActiveUniform" || k === "getActiveAttrib") return () => ({ name: "x", size: 1, type: 5126 });
      if (k === "getUniformLocation" || k === "getAttribLocation") return () => 0;
      if (/^create(Buffer|Texture|Framebuffer|Renderbuffer|VertexArray|Shader|Program|Query)$/.test(String(k))) return () => ({});
      if (k === "canvas") return canvasRef.el;
      if (k === "drawingBufferWidth" || k === "drawingBufferHeight") return 100;
      if (k === "VERSION") return 7938;
      if (k === "RENDERER") return 7937;
      if (k === "VENDOR") return 7936;
      if (typeof k === "string" && /^[A-Z_0-9]+$/.test(k)) return 1;
      return noop;
    },
  });
}

function installDomStubs() {
  if (globalThis.__v3dStubs) return;
  globalThis.__v3dStubs = true;
  const noop = () => {};
  const el = () => {
    const e = {
      style: {}, children: [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      dataset: {}, width: 1920, height: 1080, clientWidth: 1920, clientHeight: 1080,
      addEventListener: noop, removeEventListener: noop, setAttribute: noop, getAttribute: () => null,
      appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); },
      removeChild: noop, remove: noop, querySelector: () => el(), querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
      getContext: (kind) => (kind === "2d" ? anything() : gl), focus: noop, textContent: "", innerHTML: "",
      ownerDocument: null, setPointerCapture: noop, releasePointerCapture: noop, toDataURL: () => "data:,",
      parentElement: null,
    };
    const ref = { el: e };
    const gl = glProxy(ref);
    e.style.setProperty = noop;
    e.style.removeProperty = noop;
    return e;
  };
  globalThis.window ??= {
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1, addEventListener: noop, removeEventListener: noop,
    requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 16), cancelAnimationFrame: clearTimeout,
    location: { search: "", href: "http://localhost/viewer3d/index.html" }, matchMedia: () => ({ matches: false, addEventListener: noop }),
  };
  globalThis.document ??= {
    body: el(), head: el(), documentElement: el(), createElement: () => el(), createElementNS: () => el(),
    getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop, hidden: false,
  };
  globalThis.document.defaultView ??= globalThis.window;
  globalThis.requestAnimationFrame ??= globalThis.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame ??= clearTimeout;
  globalThis.navigator ??= { userAgent: "node", hardwareConcurrency: 4 };
  globalThis.self ??= globalThis;
}

async function importModule(rel) {
  installDomStubs();
  const file = path.join(V3D, rel);
  try {
    const mod = await import(pathToFileURL(file).href);
    return { ok: true, mod };
  } catch (e) {
    return { ok: false, err: e };
  }
}

// A stand-in for engine ctx from VISUAL-3D.md, using the real Three.js so systems build real geometry.
async function fakeCtx(paletteMod) {
  const THREE = await import("three");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
  camera.position.set(20, 30, 40);
  const tileSize = 1;
  const gridToWorld = (x, y) => new THREE.Vector3((x - 15.5) * tileSize, 0, (y - 15.5) * tileSize);
  const noop = () => {};
  const domElement = globalThis.document.createElement("canvas");
  const renderer = {
    domElement, shadowMap: { enabled: false }, capabilities: { isWebGL2: true, maxTextureSize: 4096 },
    setSize: noop, setPixelRatio: noop, render: noop, getSize: (v) => (v ? v.set(1920, 1080) : { x: 1920, y: 1080 }),
    getPixelRatio: () => 1, setClearColor: noop, dispose: noop, info: { render: { calls: 0, triangles: 0 } },
    toneMapping: 0, toneMappingExposure: 1, outputColorSpace: "srgb",
  };
  const composer = { addPass: noop, removePass: noop, render: noop, setSize: noop, passes: [] };
  const palette = paletteMod?.PALETTE ?? paletteMod?.palette ?? paletteMod?.default ?? paletteMod ?? {};
  return {
    THREE, scene, camera, renderer, composer, clock: new THREE.Clock(false), palette, assets: { models: {}, sounds: {}, get: () => null },
    gridToWorld, tileSize, canvas: domElement, log: null,
  };
}

function loadSample() {
  assert.ok(exists(SAMPLE), `missing ${path.relative(ROOT, SAMPLE)}; record one with env/run-match.mjs`);
  return JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
}

// ---------- a match with builds, training and fights, made in-process with the real sim ----------
// matches/sample-7.json is the sample player against itself: it mines for 2000 ticks and never builds or fights, so
// systems fed only that log never see a hit, die, done or structure spawn event (haiku's camera bug hid there). This
// scripted match on the same seed builds a Forge and a Turret on each side, trains Grunts and Lancers and sends them
// at the enemy Core, so every event kind shows up within a few hundred ticks.

function scriptedPlayer(side, firstBuilding) {
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  return (obs) => {
    const cmds = [];
    const mine = obs.units.filter((u) => u.owner === side);
    const workers = mine.filter((u) => u.kind === "worker");
    const fighters = mine.filter((u) => u.kind !== "worker");
    const own = obs.structures.filter((s) => s.owner === side);
    const core = own.find((s) => s.kind === "core");
    const enemyCore = obs.structures.find((s) => s.owner !== side && s.kind === "core");
    const forge = own.find((s) => s.kind === "forge");
    const turret = own.find((s) => s.kind === "turret");
    if (!core) return cmds;
    const fields = obs.crystals.filter((c) => c.amount > 0).sort((a, b) => dist(a, core) - dist(b, core) || a.y - b.y || a.x - b.x);
    const taken = new Set([
      ...obs.rocks.map(([x, y]) => `${x},${y}`), ...obs.crystals.map((c) => `${c.x},${c.y}`),
      ...obs.units.map((u) => `${u.x},${u.y}`), ...obs.structures.map((s) => `${s.x},${s.y}`),
    ]);
    const freeTileNear = (c) => {
      for (let d = 1; d <= 3; d++) for (let y = c.y - d; y <= c.y + d; y++) for (let x = c.x - d; x <= c.x + d; x++) {
        if (x < 0 || y < 0 || x >= obs.width || y >= obs.height || dist({ x, y }, c) !== d) continue;
        if (!taken.has(`${x},${y}`)) return { x, y };
      }
      return null;
    };
    workers.forEach((w, i) => {
      if (w.order === null && fields.length) { const c = fields[i % fields.length]; cmds.push({ type: "gather", unit: w.id, x: c.x, y: c.y }); }
    });
    const order = firstBuilding === "forge" ? ["forge", "turret"] : ["turret", "forge"];
    const want = order.find((k) => !own.some((s) => s.kind === k));
    const cost = { forge: 150, turret: 100 };
    if (want && !own.some((s) => !s.complete) && workers.length && obs.shards[side] >= cost[want]) {
      const tile = freeTileNear(core);
      if (tile) cmds.push({ type: "build", unit: workers[0].id, kind: want, x: tile.x, y: tile.y });
    }
    if (forge?.complete && forge.queue.length < 2 && obs.shards[side] >= 75) cmds.push({ type: "train", building: forge.id, kind: side === 0 ? "grunt" : "lancer" });
    for (const f of fighters) if (f.order === null && enemyCore) cmds.push({ type: "attack", unit: f.id, target: enemyCore.id });
    void turret;
    return cmds;
  };
}

let fightLogPromise = null;
function fightLog() {
  fightLogPromise ??= (async () => {
    const u = (p) => pathToFileURL(path.join(ROOT, p)).href;
    const [sim, st, lg, stats] = await Promise.all([import(u("env/sim.mjs")), import(u("env/state.mjs")), import(u("env/log.mjs")), import(u("env/stats.mjs"))]);
    const state = sim.createMatch(7);
    const strip = (o) => { const c = structuredClone(o); delete c.you; return c; };
    const log = lg.createLog({ seed: 7, players: ["qa-forge-first", "qa-turret-first"], stats: stats.STATS, initial: strip(st.observe(state, 0)) });
    const players = [scriptedPlayer(0, "forge"), scriptedPlayer(1, "turret")];
    let result = null;
    for (let i = 0; i < 900 && !result; i++) {
      const cmds = [players[0](st.observe(state, 0)), players[1](st.observe(state, 1))];
      const tick = state.tick;
      const events = sim.step(state, structuredClone(cmds));
      lg.appendTick(log, { tick, commands: cmds, events: structuredClone(events) }, [0, 0]);
      result = state.result ?? sim.checkEnd(state);
    }
    lg.finishLog(log, result ?? { winner: null, reason: "timeout", tick: state.tick, value: [stats.sideValue(state, 0), stats.sideValue(state, 1)] });
    return { log, validate: lg.validateLog };
  })();
  return fightLogPromise;
}

// Ticks worth looking at in the fight log: the first few of each interesting event kind, with neighbours.
function interestingTicks(log) {
  const firsts = { hit: [], die: [], done: [], spawnStructure: [], spawnUnit: [] };
  log.ticks.forEach((entry, i) => {
    for (const ev of entry.events) {
      const key = ev.e === "spawn" ? (ev.structure ? "spawnStructure" : "spawnUnit") : ev.e;
      if (firsts[key] && firsts[key].length < 3) firsts[key].push(i + 1);
    }
  });
  const ticks = new Set();
  for (const list of Object.values(firsts)) for (const t of list) for (const d of [-1, 0, 1, 2]) if (t + d >= 0 && t + d <= log.ticks.length) ticks.add(t + d);
  return { firsts, ticks: [...ticks].sort((a, b) => a - b) };
}

async function fightFrames() {
  const { log } = await fightLog();
  const { ticks } = interestingTicks(log);
  const w = imported["world.mjs"];
  if (w?.ok && typeof w.mod.createWorld === "function") {
    const world = w.mod.createWorld(log);
    return ticks.flatMap((t) => [0, 0.5].map((a) => world.frame(Math.min(t + a, world.ticks))));
  }
  const { replayTo } = await import(pathToFileURL(path.join(ROOT, "viewer", "replay.mjs")).href);
  return ticks.flatMap((t) => {
    const prev = replayTo(log, t), next = replayTo(log, Math.min(t + 1, log.ticks.length));
    return [0, 0.5].map((alpha) => ({ tick: t, alpha, prev, next, events: log.ticks[t - 1]?.events ?? [] }));
  });
}

// Strings that name a file in a manifest, wherever they sit in the JSON.
// A real path: no spaces, no globs, no a..f ranges; prose notes that merely mention a file are skipped.
const FILE_RE = /^[\w./-]+\.(glb|gltf|bin|png|jpg|jpeg|webp|ktx2|ogg|mp3|wav|ttf|otf|woff2?)$/i;
const RANGE_RE = /\.\.[a-z0-9]/i;
function fileRefs(node, out = []) {
  if (typeof node === "string") {
    const s = node.trim();
    if (FILE_RE.test(s) && !RANGE_RE.test(s)) out.push(s);
    else if (/\s/.test(s) && /\.(ttf|otf)$/i.test(s) && !/[;,*]/.test(s)) out.push(s); // "Kenney Future.ttf"
  } else if (Array.isArray(node)) node.forEach((n) => fileRefs(n, out));
  else if (node && typeof node === "object") Object.values(node).forEach((n) => fileRefs(n, out));
  return out;
}

function checkManifest(relManifest) {
  const file = path.join(ROOT, relManifest);
  if (!exists(file)) return { landed: false, missing: [], total: 0 };
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const dir = path.dirname(file);
  const roots = [dir, ROOT];
  if (typeof json.root === "string") roots.unshift(path.join(ROOT, json.root));
  const refs = fileRefs(json);
  const missing = refs.filter((r) => !roots.some((base) => exists(path.join(base, r))));
  return { landed: true, missing, total: refs.length, json };
}

const report = [];
const note = (line) => { report.push(line); };

// ---------- 1 + 2: parse, import, exports ----------

const modules = listModules();

test("viewer3d folder: what has landed", () => {
  const landed = Object.keys(CONTRACT).filter((f) => modules.includes(f));
  const waiting = Object.keys(CONTRACT).filter((f) => !modules.includes(f) && !CONTRACT[f].optional);
  note(`landed: ${landed.join(", ") || "(nothing yet)"}`);
  note(`not landed: ${waiting.map((f) => `${f} (${CONTRACT[f].owner})`).join(", ") || "(all present)"}`);
  const strangers = modules.filter((f) => !CONTRACT[f] && !f.startsWith("shaders/"));
  if (strangers.length) note(`files outside the contract (fine, but say what they are in the chat): ${strangers.join(", ")}`);
});

for (const rel of modules) {
  test(`${rel} parses (node --check)`, () => {
    const r = nodeCheck(path.join(V3D, rel));
    assert.ok(r.ok, `${rel} does not parse:\n${r.err}`);
  });
}

const imported = {};
for (const rel of modules) {
  test(`${rel} imports in node`, async () => {
    const r = await importModule(rel);
    imported[rel] = r;
    if (!r.ok) {
      const msg = String(r.err?.stack || r.err);
      // A module that needs a real browser at import time is a contract smell (factories should take ctx), but
      // only a hard failure for the pure modules.
      const spec = CONTRACT[rel];
      if (spec && (spec.kind === "browser-system" || spec.kind === "engine")) {
        note(`${rel} (${spec.owner}) cannot import in node: ${msg.split("\n")[0]}`);
        return;
      }
      assert.fail(`${rel} failed to import: ${msg}`);
    }
  });
}

for (const [rel, spec] of Object.entries(CONTRACT)) {
  if (!modules.includes(rel)) continue;
  test(`${rel} exports what VISUAL-3D.md says (${spec.factory ?? "colors + materials"})`, () => {
    const r = imported[rel];
    if (!r?.ok) return; // reported above
    const names = Object.keys(r.mod);
    if (spec.factory) {
      assert.equal(typeof r.mod[spec.factory], "function", `${rel} (${spec.owner}) must export ${spec.factory}; it exports: ${names.join(", ") || "nothing"}`);
    } else {
      assert.ok(names.length > 0, `${rel} (${spec.owner}) exports nothing`);
    }
  });
}

for (const rel of modules.filter((f) => f.startsWith("shaders/"))) {
  test(`${rel} exports something`, () => {
    const r = imported[rel];
    if (!r?.ok) return;
    assert.ok(Object.keys(r.mod).length > 0, `${rel} exports nothing`);
  });
}

// ---------- 3: index.html wiring ----------

test("viewer3d/index.html wires the import map and every module", () => {
  const file = path.join(V3D, "index.html");
  if (!exists(file)) { note("index.html (fable) not landed"); return; }
  const html = fs.readFileSync(file, "utf8");
  const map = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(map, "index.html has no <script type=\"importmap\">");
  let imports;
  try { imports = JSON.parse(map[1]).imports; } catch (e) { assert.fail(`import map is not valid JSON: ${e.message}`); }
  assert.equal(imports?.three, "../node_modules/three/build/three.module.js", "import map: three");
  assert.equal(imports?.["three/addons/"], "../node_modules/three/examples/jsm/", "import map: three/addons/");
  assert.ok(exists(path.join(ROOT, "node_modules/three/build/three.module.js")), "node_modules/three is missing; run npm install");

  // Collect every ./x.mjs the page loads. Static imports must exist; dynamic import('./x.mjs') calls are treated as
  // optional (the page is meant to keep working while a module is missing), so a missing one is only noted.
  const required = new Set(), referenced = new Set();
  const scan = (src) => {
    for (const m of src.matchAll(/from\s+["']\.\/([\w-]+\.mjs)["']/g)) { required.add(m[1]); referenced.add(m[1]); }
    for (const m of src.matchAll(/<script[^>]*src=["'](?:\.\/)?([\w-]+\.mjs)["']/g)) { required.add(m[1]); referenced.add(m[1]); }
    for (const m of src.matchAll(/["'`]\.\/([\w-]+\.mjs)["'`]/g)) referenced.add(m[1]);
  };
  scan(html);
  // Modules imported by a module the page loads also count as wired (the page may use a main.mjs).
  const seen = new Set();
  const queue = [...referenced];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const p = path.join(V3D, f);
    if (!exists(p)) continue;
    const before = new Set(referenced);
    scan(fs.readFileSync(p, "utf8"));
    for (const x of referenced) if (!before.has(x)) queue.push(x);
  }
  const landed = Object.keys(CONTRACT).filter((f) => modules.includes(f));
  const unwired = landed.filter((f) => !referenced.has(f));
  assert.deepEqual(unwired, [], `index.html never loads these landed modules: ${unwired.join(", ")}`);
  const ghosts = [...required].filter((f) => !exists(path.join(V3D, f)));
  assert.deepEqual(ghosts, [], `index.html (or a module it loads) statically imports files that do not exist: ${ghosts.join(", ")}`);
  const waiting = [...referenced].filter((f) => !required.has(f) && !exists(path.join(V3D, f)));
  if (waiting.length) note(`index.html loads these optionally and they have not landed: ${waiting.join(", ")}`);
  for (const q of ["log", "playlist", "tv"]) {
    if (!html.includes(q)) note(`index.html does not mention the ?${q}= query parameter from VISUAL-3D.md`);
  }
});

// ---------- 4: manifests ----------

for (const rel of ["assets/models/MANIFEST.json", "assets/audio/MANIFEST.json", "assets/sprites/MANIFEST.json"]) {
  test(`${rel}: every file it names exists`, () => {
    const r = checkManifest(rel);
    if (!r.landed) { note(`${rel} not landed`); return; }
    assert.deepEqual(r.missing, [], `${rel} names ${r.missing.length} missing file(s): ${r.missing.join(", ")}`);
    note(`${rel}: ${r.total} file reference(s), all present`);
  });
}

test("assets/models: LICENSES.md sits next to any model", () => {
  const dir = path.join(ROOT, "assets", "models");
  if (!exists(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => /\.(glb|gltf)$/i.test(f));
  if (files.length) assert.ok(exists(path.join(dir, "LICENSES.md")) || exists(path.join(ROOT, "assets", "LICENSES.md")), "models present but no LICENSES.md");
});

// ---------- 5: the full roster is rendered ----------

test("every unit, structure and tile kind is named by the module that renders it", async () => {
  const stats = await import(pathToFileURL(path.join(ROOT, "env", "stats.mjs")).href);
  const unitKinds = stats.UNIT_KINDS ?? Object.keys(stats.STATS.units ?? {});
  const structureKinds = ["core", ...(stats.STRUCTURE_KINDS ?? Object.keys(stats.STATS.structures ?? {}))];
  const problems = [];
  const check = (file, kinds, label) => {
    if (!modules.includes(file)) { note(`${file} not landed, so ${label} ${kinds.join("/")} are not rendered yet`); return; }
    const src = fs.readFileSync(path.join(V3D, file), "utf8");
    for (const k of kinds) {
      const names = Array.isArray(k) ? k : [k];
      const named = names.some((n) => new RegExp(`['"\`]${n}['"\`]|\\b${n}\\b\\s*[:(]`, "i").test(src));
      if (!named) problems.push(`${file} (${CONTRACT[file].owner}) never names ${label} kind '${names.join("/")}'`);
    }
  };
  check(RENDER_OWNERS.units, unitKinds, "unit");
  check(RENDER_OWNERS.structures, structureKinds, "structure");
  check(RENDER_OWNERS.terrain, TILE_KINDS, "tile");
  note(`roster from env/stats.mjs: units ${unitKinds.join(", ")}; structures ${structureKinds.join(", ")}; tiles ${TILE_KINDS.map((k) => k[0]).join(", ")}`);
  assert.deepEqual(problems, [], problems.join("\n"));
});

// ---------- 6: world.mjs on a real match ----------

test("world.mjs: createWorld(log) gives correct, fast frames on matches/sample-7.json", async () => {
  if (!modules.includes("world.mjs")) { note("world.mjs (sonnet) not landed; frames cannot be checked"); return; }
  const r = imported["world.mjs"];
  if (!r?.ok) return;
  const log = loadSample();
  const { replayTo } = await import(pathToFileURL(path.join(ROOT, "viewer", "replay.mjs")).href);

  let t0 = performance.now();
  const world = r.mod.createWorld(log);
  const buildMs = performance.now() - t0;
  assert.ok(world && typeof world === "object", "createWorld returned nothing");
  assert.equal(typeof world.ticks, "number", "world.ticks must be a number");
  assert.equal(world.ticks, log.ticks.length, "world.ticks must equal the number of tick entries");
  assert.equal(typeof world.stateAt, "function", "world.stateAt(tick) missing");
  assert.equal(typeof world.frame, "function", "world.frame(t) missing");

  // stateAt agrees with viewer/replay.mjs at a few ticks (units, structures, shards, crystals).
  for (const tick of [0, 1, 60, 500, world.ticks]) {
    const a = world.stateAt(tick);
    const b = replayTo(log, tick);
    assert.ok(a, `stateAt(${tick}) returned nothing`);
    assert.deepEqual(a.shards, b.shards, `stateAt(${tick}).shards`);
    assert.deepEqual(a.units.map((u) => [u.id, u.x, u.y, u.hp]), b.units.map((u) => [u.id, u.x, u.y, u.hp]), `stateAt(${tick}).units`);
    assert.deepEqual(a.structures.map((s) => [s.id, s.hp, s.complete]), b.structures.map((s) => [s.id, s.hp, s.complete]), `stateAt(${tick}).structures`);
    assert.deepEqual(a.crystals.map((c) => c.amount), b.crystals.map((c) => c.amount), `stateAt(${tick}).crystals`);
  }

  // frame(t) shape and alpha.
  const f = world.frame(10.25);
  for (const k of ["tick", "alpha", "prev", "next", "events"]) assert.ok(k in f, `frame(t) is missing '${k}'`);
  assert.equal(f.tick, 10, "frame(10.25).tick should be floor(t)");
  assert.ok(Math.abs(f.alpha - 0.25) < 1e-9, "frame(10.25).alpha should be 0.25");
  assert.ok(Array.isArray(f.events), "frame(t).events must be an array");
  assert.equal(f.prev.tick, 10, "frame(10.25).prev is the state at tick 10");
  assert.equal(f.next.tick, 11, "frame(10.25).next is the state at tick 11");
  const whole = world.frame(10);
  assert.equal(whole.alpha, 0, "frame(10).alpha should be 0");
  const end = world.frame(world.ticks + 5);
  assert.ok(end.tick <= world.ticks, "frame past the end must clamp");

  // Events: a mine event appears somewhere in the first 100 ticks of a sample match (Workers mine).
  let sawEvent = false;
  for (let t = 1; t <= 100 && !sawEvent; t++) sawEvent = world.frame(t).events.length > 0;
  assert.ok(sawEvent, "no frame in the first 100 ticks carried any events, but the sample match has mine/deliver events");

  // Speed: play straight through at 4 sub-steps per tick.
  t0 = performance.now();
  let n = 0;
  for (let t = 0; t <= world.ticks; t += 0.25) { world.frame(t); n++; }
  const perFrame = (performance.now() - t0) / n;
  // And scrub backwards (the TV director and the time bar both do this).
  t0 = performance.now();
  for (const t of [1500, 20, 1999, 700, 0, 1234.5]) world.frame(t);
  const scrubMs = performance.now() - t0;
  note(`world.mjs: build ${buildMs.toFixed(0)} ms, ${perFrame.toFixed(3)} ms/frame forward, 6 scrubs ${scrubMs.toFixed(0)} ms`);
  assert.ok(buildMs < BUDGET.worldBuildMs, `createWorld took ${buildMs.toFixed(0)} ms (budget ${BUDGET.worldBuildMs})`);
  assert.ok(perFrame < BUDGET.worldFrameMs, `frame(t) averages ${perFrame.toFixed(2)} ms (budget ${BUDGET.worldFrameMs})`);
  assert.ok(scrubMs < 500, `six random scrubs took ${scrubMs.toFixed(0)} ms; keep snapshots so seeking stays cheap`);
});

// ---------- 6b: the scripted fight log really has builds and fights ----------

test("scripted fight log (real sim, seed 7): builds, spawns, hits and deaths all happen and the log validates", async () => {
  const { log, validate } = await fightLog();
  const problems = validate(log);
  assert.deepEqual(problems, [], `fight log fails validateLog: ${problems.join("; ")}`);
  const { firsts } = interestingTicks(log);
  for (const k of ["hit", "die", "done", "spawnStructure", "spawnUnit"]) assert.ok(firsts[k].length > 0, `fight log never produced a ${k} event in ${log.ticks.length} ticks; the scripted players need fixing`);
  note(`fight log: ${log.ticks.length} ticks, result ${log.result.reason} (winner ${log.result.winner}); first hit at tick ${firsts.hit[0]}, first death ${firsts.die[0]}, first building done ${firsts.done[0]}`);
});

// ---------- 7: scene systems against real frames ----------

// Frames to feed each system: early game, mid game and the end, with a few sub-steps each.
function sampleFrames(world) {
  const ts = [];
  for (const base of [0, 1, 2, 50, 51, 400, 400.5, 1000, 1999, world.ticks]) ts.push(base, base + 0.33, base + 0.66);
  return ts.filter((t) => t <= world.ticks).map((t) => world.frame(t));
}

// Without world.mjs, hand-build frames from viewer/replay.mjs so systems can still be smoke-tested.
async function fallbackFrames(log) {
  const { replayTo } = await import(pathToFileURL(path.join(ROOT, "viewer", "replay.mjs")).href);
  const out = [];
  for (const t of [0, 1, 50, 400, 1000, 1999]) {
    const prev = replayTo(log, t), next = replayTo(log, Math.min(t + 1, log.ticks.length));
    for (const alpha of [0, 0.5]) out.push({ tick: t, alpha, prev, next, events: log.ticks[t]?.events ?? [] });
  }
  return out;
}

async function framesFor(log) {
  const w = imported["world.mjs"];
  if (w?.ok && typeof w.mod.createWorld === "function") {
    try { return sampleFrames(w.mod.createWorld(log)); } catch { /* reported by the world test */ }
  }
  return fallbackFrames(log);
}

function countScene(THREE, scene) {
  let meshes = 0, instanced = 0, instances = 0, lights = 0, points = 0, tris = 0;
  scene.traverse((o) => {
    if (o.isInstancedMesh) { instanced++; instances += o.count; }
    else if (o.isMesh) meshes++;
    if (o.isPoints) points++;
    if (o.isLight) lights++;
    const g = o.geometry;
    if (g && g.attributes?.position) {
      const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
    }
  });
  return { meshes, instanced, instances, lights, points, tris: Math.round(tris) };
}

for (const [rel, spec] of Object.entries(CONTRACT)) {
  if (spec.kind !== "system" && spec.kind !== "browser-system") continue;
  test(`${rel}: ${spec.factory}(ctx) builds, updates on real frames, disposes${spec.kind === "browser-system" ? " (reported, not asserted)" : ""}`, async () => {
    if (!modules.includes(rel)) return;
    const r = imported[rel];
    if (!r?.ok || typeof r.mod[spec.factory] !== "function") return;
    const soft = spec.kind === "browser-system";
    const fail = (msg) => { if (soft) note(`${rel} (${spec.owner}) in node: ${msg}`); else assert.fail(msg); };

    const log = loadSample();
    const ctx = await fakeCtx(imported["palette.mjs"]?.ok ? imported["palette.mjs"].mod : null);
    ctx.log = log;
    ctx.stats = log.stats;
    const frames = await framesFor(log);
    // Then the scripted fight on the same seed (same initial state, same ids): builds, spawns, hits and deaths.
    const fight = await fightFrames();

    const before = countScene(ctx.THREE, ctx.scene);
    let sys;
    try { sys = await r.mod[spec.factory](ctx, { log, stats: log.stats, tv: true }); } catch (e) { return fail(`${spec.factory}(ctx) threw: ${e.stack?.split("\n").slice(0, 2).join(" | ")}`); }
    if (!sys || typeof sys.update !== "function" || typeof sys.dispose !== "function") {
      return fail(`${spec.factory}(ctx) must return { update(frame, dt), dispose() }; got keys ${sys ? Object.keys(sys).join(", ") : String(sys)}`);
    }

    const t0 = performance.now();
    try {
      for (const f of frames) sys.update(f, 1 / 60);
      // Play 120 consecutive sub-frames through the busiest stretch so per-frame allocation shows up.
      const w = imported["world.mjs"];
      if (w?.ok) { const world = w.mod.createWorld(log); for (let t = 300; t < 330; t += 0.25) sys.update(world.frame(t), 1 / 60); }
    } catch (e) { return fail(`update(frame, dt) threw on a sample-7 frame: ${e.stack?.split("\n").slice(0, 3).join(" | ")}`); }
    try {
      for (const f of fight) sys.update(f, 1 / 60);
    } catch (e) { return fail(`update(frame, dt) threw on a fight frame (events: ${[...new Set(fight.flatMap((f) => f.events.map((ev) => ev.e)))].join(", ")}): ${e.stack?.split("\n").slice(0, 3).join(" | ")}`); }
    const n = frames.length + fight.length + (imported["world.mjs"]?.ok ? 120 : 0);
    const perUpdate = (performance.now() - t0) / n;
    const after = countScene(ctx.THREE, ctx.scene);
    note(`${rel}: ${perUpdate.toFixed(3)} ms/update over ${n} frames; scene now ${after.meshes} meshes, ${after.instanced} instanced (${after.instances} instances), ${after.points} point clouds, ${after.lights} lights, ~${after.tris} tris`);

    if (spec.kind === "system" && rel !== "anim.mjs" && rel !== "physics.mjs") {
      assert.ok(after.meshes + after.instanced + after.points > before.meshes + before.instanced + before.points, `${rel} added nothing to the scene after ${n} real frames`);
    }
    if (perUpdate > BUDGET.systemUpdateMs) fail(`update averages ${perUpdate.toFixed(2)} ms on the CPU (budget ${BUDGET.systemUpdateMs} ms); 60 fps leaves 16 ms for everything, GPU included`);
    if (after.tris > 400000) note(`${rel} (${spec.owner}): ~${after.tris} triangles in the scene is a lot for a Mac mini at 1080p; consider instancing or lower poly`);
    if (after.lights > 8) note(`${rel} (${spec.owner}): ${after.lights} lights; each shadow-casting light is a full extra pass`);

    try { sys.dispose(); } catch (e) { return fail(`dispose() threw: ${e.message}`); }
    const gone = countScene(ctx.THREE, ctx.scene);
    if (gone.meshes + gone.instanced + gone.points > before.meshes + before.instanced + before.points) {
      fail(`dispose() left ${gone.meshes + gone.instanced + gone.points - (before.meshes + before.instanced + before.points)} object(s) in the scene; a playlist will leak`);
    }
  });
}

// ---------- 7b: CLASSIC.md stress: 200 units at once ----------

// A synthetic frame: the sample map with 100 units per side of every kind in stats, half of them walking, all at once.
// This is what CLASSIC.md asks the renderer to hold at 60 fps with instancing. CPU cost and object counts only here.
async function stressFrames(log, unitKinds) {
  const { replayTo } = await import(pathToFileURL(path.join(ROOT, "viewer", "replay.mjs")).href);
  const base = replayTo(log, 0);
  const taken = new Set([...base.rocks.map(([x, y]) => `${x},${y}`), ...base.crystals.map((c) => `${c.x},${c.y}`), ...base.units.map((u) => `${u.x},${u.y}`), ...base.structures.map((s) => `${s.x},${s.y}`)]);
  const stats = log.stats;
  const mk = (tick) => {
    const s = structuredClone(base);
    s.tick = tick;
    let id = 1000, placed = 0;
    for (let y = 1; y < s.height - 1 && placed < 200; y++) for (let x = 1; x < s.width - 1 && placed < 200; x++) {
      if (taken.has(`${x},${y}`) || (x + y) % 3 !== 0) continue;
      const kind = unitKinds[placed % unitKinds.length];
      const owner = placed % 2;
      const moving = placed % 2 === 0;
      const hp = stats.units?.[kind]?.hp ?? 60;
      s.units.push({ id: id++, owner, kind, x: x + (moving && tick ? 1 : 0), y, hp: placed % 3 ? hp : Math.floor(hp / 2), carrying: 0, order: moving ? { type: "move", x: x + 5, y } : null });
      placed++;
    }
    s.units.sort((a, b) => a.id - b.id);
    return s;
  };
  const prev = mk(0), next = mk(1);
  return [0, 0.25, 0.5, 0.75].map((alpha) => ({ tick: 0, alpha, prev, next, events: [] }));
}

test("units.mjs: 200 units at once (CLASSIC.md) stay inside the CPU budget and the scene stays instanced or baked", async () => {
  if (!modules.includes("units.mjs")) return;
  const r = imported["units.mjs"];
  if (!r?.ok || typeof r.mod.createUnits !== "function") return;
  const log = loadSample();
  const stats = await import(pathToFileURL(path.join(ROOT, "env", "stats.mjs")).href);
  const unitKinds = stats.UNIT_KINDS ?? Object.keys(log.stats.units);
  const ctx = await fakeCtx(imported["palette.mjs"]?.ok ? imported["palette.mjs"].mod : null);
  ctx.log = log; ctx.stats = log.stats;
  const frames = await stressFrames(log, unitKinds);
  const before = countScene(ctx.THREE, ctx.scene);
  const sys = await r.mod.createUnits(ctx, { log, stats: log.stats });
  sys.update(frames[0], 1 / 60); // first frame builds 200 models; not timed
  const t0 = performance.now();
  let n = 0;
  for (let i = 0; i < 30; i++) for (const f of frames) { sys.update(f, 1 / 60); n++; }
  const perUpdate = (performance.now() - t0) / n;
  const after = countScene(ctx.THREE, ctx.scene);
  const objects = after.meshes + after.instanced - (before.meshes + before.instanced);
  const units = frames[0].prev.units.length;
  note(`units.mjs stress: ${units} units, ${perUpdate.toFixed(2)} ms/update CPU, ${after.meshes - before.meshes} meshes + ${after.instanced - before.instanced} instanced meshes (${(objects / units).toFixed(1)} draw objects per unit), ~${after.tris} tris`);
  sys.dispose();
  assert.ok(perUpdate < BUDGET.systemUpdateMs, `units.mjs spends ${perUpdate.toFixed(2)} ms per update on the CPU with ${units} units (budget ${BUDGET.systemUpdateMs} ms)`);
  if (objects / units > 4) note(`units.mjs (fable): ${(objects / units).toFixed(1)} draw objects per unit; CLASSIC.md wants instancing so 200 units hold 60 fps (aim for one InstancedMesh per part per kind, a handful of draw calls total)`);
});

// The Classic renderer's instanced units (play/units-instanced.mjs) take the same frame shape; measure it the same way.
test("play/units-instanced.mjs: 200 units at once stay inside the CPU budget and use instancing (CLASSIC.md)", async () => {
  const file = path.join(ROOT, "play", "units-instanced.mjs");
  if (!exists(file)) { note("play/units-instanced.mjs not landed"); return; }
  installDomStubs();
  let mod;
  try { mod = await import(pathToFileURL(file).href); } catch (e) { assert.fail(`play/units-instanced.mjs failed to import: ${e.stack?.split("\n").slice(0, 2).join(" | ")}`); }
  assert.equal(typeof mod.createInstancedUnits, "function", "play/units-instanced.mjs must export createInstancedUnits");
  const log = loadSample();
  const stats = await import(pathToFileURL(path.join(ROOT, "env", "stats.mjs")).href);
  const unitKinds = stats.UNIT_KINDS ?? Object.keys(log.stats.units);
  const ctx = await fakeCtx(imported["palette.mjs"]?.ok ? imported["palette.mjs"].mod : null);
  ctx.log = log; ctx.stats = log.stats;
  const frames = await stressFrames(log, unitKinds);
  const before = countScene(ctx.THREE, ctx.scene);
  let sys;
  try { sys = await mod.createInstancedUnits(ctx, { log, stats: log.stats }); } catch (e) { assert.fail(`createInstancedUnits threw: ${e.stack?.split("\n").slice(0, 3).join(" | ")}`); }
  assert.ok(sys && typeof sys.update === "function" && typeof sys.dispose === "function", "createInstancedUnits must return { update, dispose }");
  try { sys.update(frames[0], 1 / 60); } catch (e) { assert.fail(`first update threw: ${e.stack?.split("\n").slice(0, 3).join(" | ")}`); }
  const t0 = performance.now();
  let n = 0;
  for (let i = 0; i < 30; i++) for (const f of frames) { sys.update(f, 1 / 60); n++; }
  const perUpdate = (performance.now() - t0) / n;
  const after = countScene(ctx.THREE, ctx.scene);
  const units = frames[0].prev.units.length;
  const draws = after.meshes + after.instanced - (before.meshes + before.instanced);
  note(`play/units-instanced.mjs stress: ${units} units, ${perUpdate.toFixed(2)} ms/update CPU, ${after.meshes - before.meshes} meshes + ${after.instanced - before.instanced} instanced meshes (${after.instances} instances), ~${after.tris} tris`);
  sys.dispose();
  assert.ok(perUpdate < BUDGET.systemUpdateMs, `instanced units spend ${perUpdate.toFixed(2)} ms per update on the CPU with ${units} units (budget ${BUDGET.systemUpdateMs} ms)`);
  assert.ok(draws <= 60, `instanced units still make ${draws} draw objects for ${units} units; CLASSIC.md wants a few dozen at most`);
});

// ---------- 8: Joshua's Classic playtest (21:52): DEFEAT at 0:10 and an off-centre opening camera ----------

const CLASSIC_TPS = 24;
const MIN_SAFE_SECONDS = 180; // no Core may fall before 3:00 against the default AI with an idle human

// Drive env/live.mjs by hand (no timers, no wall clock) with the human side idle and the given AI module.
async function coreSurvival(aiFile, { seed = 7, difficulty = "normal", maxTicks = MIN_SAFE_SECONDS * CLASSIC_TPS } = {}) {
  const live = await import(pathToFileURL(path.join(ROOT, "env", "live.mjs")).href);
  const aiMod = await import(pathToFileURL(path.join(ROOT, aiFile)).href);
  const driver = live.createLiveMatch({ seed, human: 0, ai: aiMod, difficulty, tps: CLASSIC_TPS, now: () => 0, setTimer: () => 0, clearTimer: () => {} });
  await driver.ready();
  let firstHit = null;
  for (let i = 0; i < maxTicks && !driver.state.result; i++) {
    await driver.tick();
    if (firstHit == null) {
      const core = driver.state.structures.find((s) => s.kind === "core" && s.owner === 0);
      if (core && core.hp < (driver.state.stats?.core?.hp ?? 1000)) firstHit = driver.state.tick;
    }
  }
  const core = driver.state.structures.find((s) => s.kind === "core" && s.owner === 0);
  return { result: driver.state.result, tick: driver.state.tick, firstHit, coreHp: core?.hp ?? 0, coreAlive: !!core };
}

for (const [label, aiFile, opts] of [
  ["the page's default AI (?ai=sonnet, players/sonnet/bot.mjs)", "players/sonnet/bot.mjs", {}],
  ["the built-in AI, normal (players/builtin/ai.mjs)", "players/builtin/ai.mjs", { difficulty: "normal" }],
  ["the built-in AI, easy (players/builtin/ai.mjs)", "players/builtin/ai.mjs", { difficulty: "easy" }],
]) {
  test(`Classic: no Core falls before 3:00 against ${label} with an idle human (seed 7)`, async () => {
    if (!exists(path.join(ROOT, "env", "live.mjs"))) { note("env/live.mjs not landed; Core-survival check skipped"); return; }
    if (!exists(path.join(ROOT, aiFile))) { note(`${aiFile} not landed; Core-survival check skipped`); return; }
    const r = await coreSurvival(aiFile, opts);
    const secs = (t) => (t / CLASSIC_TPS).toFixed(1);
    note(`Classic survival vs ${label}: ${r.result ? `${r.result.reason} at tick ${r.result.tick} (${secs(r.result.tick)} s), winner ${r.result.winner}` : `no result by tick ${r.tick}`}; first Core hit ${r.firstHit == null ? "never" : `tick ${r.firstHit} (${secs(r.firstHit)} s)`}; human Core hp ${r.coreHp}`);
    assert.ok(!r.result || r.result.tick >= MIN_SAFE_SECONDS * CLASSIC_TPS, `the human's Core fell at tick ${r.result?.tick} (${secs(r.result?.tick ?? 0)} s of real time at ${CLASSIC_TPS} tps) against ${label}; CLASSIC.md wants a 10 to 15 minute match, Joshua saw DEFEAT at 0:10. Owners: Classic AI (sonnet) and the stats rescale (haiku/fable)`);
    assert.ok(r.coreAlive, `the human's Core is gone before 3:00 against ${label}`);
  });
}

// The opening camera must frame our own base: the Core inside the visible ground rectangle, and at most a quarter
// of that rectangle hanging off the map (Joshua: "opens off-centre with big dark empty areas").
function visibleGround(rig, CAMERA, aspect = 16 / 9) {
  const halfH = rig.zoom / 2 / Math.sin(CAMERA.pitch); // the tilted view stretches the ground extent vertically
  const halfW = (rig.zoom * aspect) / 2;
  return { x0: rig.x - halfW, x1: rig.x + halfW, y0: rig.y - halfH, y1: rig.y + halfH };
}
function offMapFraction(rect, width, height) {
  const area = (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
  const ox = Math.max(0, Math.min(rect.x1, width) - Math.max(rect.x0, 0));
  const oy = Math.max(0, Math.min(rect.y1, height) - Math.max(rect.y0, 0));
  return 1 - (ox * oy) / area;
}

for (const [label, file] of [["play/app.mjs (what the page runs today)", "play/app.mjs"], ["play/camera.mjs (the drop-in rig)", "play/camera.mjs"]]) {
  test(`Classic: the opening camera from ${label} frames the human's base`, async () => {
    const p = path.join(ROOT, file);
    if (!exists(p)) { note(`${file} not landed; opening-camera check skipped`); return; }
    installDomStubs();
    const mod = await import(pathToFileURL(p).href);
    if (typeof mod.createCameraRig !== "function" || !mod.CAMERA) { note(`${file} does not export createCameraRig + CAMERA; opening-camera check skipped`); return; }
    const log = loadSample();
    const { replayTo } = await import(pathToFileURL(path.join(ROOT, "viewer", "replay.mjs")).href);
    const s0 = replayTo(log, 0);
    for (const side of [0, 1]) {
      const core = s0.structures.find((s) => s.kind === "core" && s.owner === side);
      const rig = mod.createCameraRig(s0.width, s0.height, core); // exactly how app.mjs opens (startGame line ~279)
      const rect = visibleGround(rig, mod.CAMERA);
      const off = offMapFraction(rect, s0.width, s0.height);
      const inside = core.x >= rect.x0 && core.x <= rect.x1 && core.y >= rect.y0 && core.y <= rect.y1;
      note(`opening camera (${file}, side ${side}): centre (${rig.x.toFixed(1)}, ${rig.y.toFixed(1)}) zoom ${rig.zoom}, ground view x ${rect.x0.toFixed(0)}..${rect.x1.toFixed(0)} y ${rect.y0.toFixed(0)}..${rect.y1.toFixed(0)}, ${(off * 100).toFixed(0)}% of the view is off the map, Core ${inside ? "in" : "NOT in"} view`);
      assert.ok(inside, `side ${side}: the Core at (${core.x}, ${core.y}) is outside the opening view`);
      assert.ok(off <= 0.25, `side ${side}: ${(off * 100).toFixed(0)}% of the opening view is empty void past the map edge (limit 25%); clamp the centre so the view stays on the map, like play/render.mjs clampCenter with its margin. Owner: Playable Client (sonnet), rig in ${file}`);
    }
  });
}

// ---------- 9: the Classic page's renderer path and a whole-renderer headless smoke ----------

test("Classic: play/app.mjs draws units through the instanced path (CLASSIC.md: 200 units at 60 fps on the page, not just in a module)", () => {
  const p = path.join(ROOT, "play", "app.mjs");
  if (!exists(p)) { note("play/app.mjs not landed"); return; }
  const src = fs.readFileSync(p, "utf8");
  const usesRenderer = /createPlayRenderer/.test(src);
  const unitsRow = src.match(/\[\s*['"]units['"]\s*,\s*['"]([^'"]+)['"]/);
  const unitsFile = unitsRow?.[1] ?? "(no units row found)";
  const instanced = usesRenderer || /units-instanced\.mjs/.test(unitsFile);
  note(`play/app.mjs units path: ${usesRenderer ? "createPlayRenderer" : unitsFile}${instanced ? "" : " (about 13 draw calls per unit; the page will not hold 60 fps with a 100-unit army)"}`);
  assert.ok(instanced, `play/app.mjs still wires ${unitsFile} for units; switch the row to './units-instanced.mjs' with createInstancedUnits (two lines, Classic renderer's message 292) or use createPlayRenderer. Owner: Playable Client (sonnet)`);
});

test("Classic: play/render.mjs builds the whole renderer headless, steps 30 frames with no system switched off, picks a unit, takes fog, disposes", async () => {
  const p = path.join(ROOT, "play", "render.mjs");
  if (!exists(p)) { note("play/render.mjs not landed; whole-renderer smoke skipped"); return; }
  installDomStubs();
  const { createPlayRenderer } = await import(pathToFileURL(p).href);
  assert.equal(typeof createPlayRenderer, "function", "play/render.mjs must export createPlayRenderer");
  const w = imported["world.mjs"];
  if (!w?.ok) { note("world.mjs not importable; whole-renderer smoke skipped"); return; }
  const log = loadSample();
  const world = w.mod.createWorld(log);
  const canvas = globalThis.document.createElement("canvas");
  let r;
  try { r = createPlayRenderer(canvas, { width: world.map?.width ?? log.initial.width, height: world.map?.height ?? log.initial.height, stats: log.stats, side: 0, shadows: false }); }
  catch (e) { assert.fail(`createPlayRenderer threw under the proxy WebGL context: ${e.stack?.split("\n").slice(0, 3).join(" | ")}`); }
  await r.ready;
  assert.deepEqual(r.failures ?? [], [], `systems failed to build: ${JSON.stringify(r.failures)}`);
  note(`play/render.mjs headless: systems ${Object.keys(r.made ?? {}).join(", ")}`);
  r.setWorld(world);
  let stepped = 0;
  try { for (let i = 0; i < 30; i++) { r.engine.step(1 / 60); stepped++; } }
  catch (e) { assert.fail(`engine.step threw at frame ${stepped}: ${e.stack?.split("\n").slice(0, 3).join(" | ")}`); }
  const off = r.ctx?.failures ?? [];
  assert.deepEqual(off, [], `a system was switched off by the engine during the first 30 frames (the dead-HUD class of bug): ${JSON.stringify(off)}`);
  assert.ok((r.units?.count ?? 0) > 0, "no units drawn after 30 frames of the sample match");
  const live = typeof r.live === "function" ? r.live() : [];
  if (live.length && typeof r.pickUnit === "function") {
    // Frame side 0's start area first (the opening camera is elsewhere), as the Classic owner's smoke script does.
    r.camera?.setZoom?.(16); r.camera?.center?.(5, 5); r.engine.step(1 / 60);
    const u = live[0];
    const v = u.pos.clone(); v.y += (u.height ?? 0.5) * 0.5; v.project(r.ctx.camera);
    const cw = canvas.clientWidth || 1280, ch = canvas.clientHeight || 720; // pickUnit takes CSS pixels on the canvas
    const sx = ((v.x + 1) / 2) * cw, sy = ((1 - v.y) / 2) * ch;
    assert.equal(r.pickUnit(sx, sy), u.id, `pickUnit at the projected screen position of unit ${u.id} returned something else`);
    assert.equal(r.pickUnit(5, 5), null, "pickUnit in an empty corner should return null");
    r.setSelection([u.id]);
  }
  if (typeof r.setFog === "function") {
    const W = world.map?.width ?? log.initial.width, H = world.map?.height ?? log.initial.height;
    const fog = new Uint8Array(W * H);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) fog[y * W + x] = 2;
    r.setFog(fog);
    r.engine.step(1 / 60);
    const drawn = typeof r.units?.live === "function" ? r.units.live().length : null;
    note(`play/render.mjs headless: ${r.units.count} units in scene, ${drawn ?? "?"} drawn with a 12x12 visible window, ${r.units.draws ?? "?"} draw calls for units`);
  }
  r.dispose();
});

test("engine.mjs: createEngine exists and is shaped right (reported; needs WebGL to run)", async () => {
  if (!modules.includes("engine.mjs")) return;
  const r = imported["engine.mjs"];
  if (!r?.ok) return;
  assert.equal(typeof r.mod.createEngine, "function");
  const src = fs.readFileSync(path.join(V3D, "engine.mjs"), "utf8");
  for (const [word, why] of [["shadowMap", "soft shadows"], ["toneMapping", "tone mapping"], ["UnrealBloomPass", "bloom"], ["resize", "resize handling"], ["Fog", "distance fog"]]) {
    if (!src.includes(word)) note(`engine.mjs (fable) has no '${word}' yet (${why} from VISUAL-3D.md)`);
  }
});

test("assets.mjs: loadAssets falls back cleanly when files are missing", async () => {
  if (!modules.includes("assets.mjs")) return;
  const r = imported["assets.mjs"];
  if (!r?.ok) return;
  const ctx = await fakeCtx(imported["palette.mjs"]?.ok ? imported["palette.mjs"].mod : null);
  let out;
  try { out = await Promise.race([r.mod.loadAssets(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error("loadAssets did not settle in 5 s")), 5000))]); }
  catch (e) {
    note(`assets.mjs in node: loadAssets threw: ${e.message.split("\n")[0]} (fine if it only needs fetch/GLTFLoader in a browser; must not throw there when a file is missing)`);
    return;
  }
  assert.ok(out && typeof out === "object", "loadAssets must resolve to an object of models/sounds");
  note(`assets.mjs: loadAssets resolved with keys ${Object.keys(out).join(", ")}`);
});

// ---------- the report ----------

test("QA report (plain English, copy into viewer3d/QA.md)", () => {
  console.log("\n=== viewer3d QA report ===");
  for (const line of report) console.log("- " + line);
  console.log("=== end report ===\n");
});
