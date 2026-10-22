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
      getContext: (kind) => (kind === "2d" ? anything() : null), focus: noop, textContent: "", innerHTML: "",
      ownerDocument: null, setPointerCapture: noop, releasePointerCapture: noop, toDataURL: () => "data:,",
    };
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
    const frames = await framesFor(log);

    const before = countScene(ctx.THREE, ctx.scene);
    let sys;
    try { sys = await r.mod[spec.factory](ctx, { log }); } catch (e) { return fail(`${spec.factory}(ctx) threw: ${e.stack?.split("\n").slice(0, 2).join(" | ")}`); }
    if (!sys || typeof sys.update !== "function" || typeof sys.dispose !== "function") {
      return fail(`${spec.factory}(ctx) must return { update(frame, dt), dispose() }; got keys ${sys ? Object.keys(sys).join(", ") : String(sys)}`);
    }

    const t0 = performance.now();
    try {
      for (const f of frames) sys.update(f, 1 / 60);
      // Play 120 consecutive sub-frames through the busiest stretch so per-frame allocation shows up.
      const w = imported["world.mjs"];
      if (w?.ok) { const world = w.mod.createWorld(log); for (let t = 300; t < 330; t += 0.25) sys.update(world.frame(t), 1 / 60); }
    } catch (e) { return fail(`update(frame, dt) threw: ${e.stack?.split("\n").slice(0, 3).join(" | ")}`); }
    const n = frames.length + (imported["world.mjs"]?.ok ? 120 : 0);
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
