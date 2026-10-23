// TV match screen tests (owner: haiku). Covers viewer/live.mjs, the page logic behind viewer/live.html.
//
// Real matches come from env/run-match.mjs (two seeds, sample player on both sides), so the logs are the same kind
// a person gets from the command line. The screen code runs unchanged in node. Two kinds of stand-in are used, and
// only for things a browser provides: a canvas context that accepts any drawing call and counts them, and a fake
// document/window/fetch for the page-boot test. The optional art, fx and hud modules are the real files wherever a
// test runs the page; the failure-path tests use small test doubles to make a module throw on purpose.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_MATCH = path.join(ROOT, "env", "run-match.mjs");
const SAMPLE_PLAYER = path.join(ROOT, "players", "sample-player.mjs");
const LIVE = await import(pathToFileURL(path.join(ROOT, "viewer", "live.mjs")).href);

let dir;
const logs = {};

function runSample(seed) {
  const out = path.join(dir, `match-${seed}.json`);
  const run = spawnSync(
    process.execPath,
    [RUN_MATCH, "--seed", String(seed), "--p0", SAMPLE_PLAYER, "--p1", SAMPLE_PLAYER, "--out", out, "--quiet", "--classic"],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(run.status, 0, `run-match failed for seed ${seed}: ${run.stdout}${run.stderr}`);
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

// Anything at all: calling it, reading it or using it as a number gives back another one of the same. Used for the
// values a drawing call returns (gradients, text measures) so their methods never fail.
function anything() {
  return new Proxy(function () {}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === Symbol.toPrimitive) return () => 0;
      return anything();
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    apply() {
      return anything();
    },
  });
}

// A stand-in for a 2D canvas context: every method exists and does nothing. Calls are counted and text drawn with
// fillText is recorded.
function recordingContext() {
  const calls = { count: 0, texts: [] };
  const ctx = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === "fillText") {
          return (text) => {
            calls.count++;
            calls.texts.push(String(text));
          };
        }
        return () => {
          calls.count++;
          return anything();
        };
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    },
  );
  return { ctx, calls };
}

// A stand-in for a DOM element that accepts any property, method or child, for the HUD mount test.
function fakeNode() {
  const store = {};
  const node = new Proxy(function () {}, {
    get(_, prop) {
      if (prop in store) return store[prop];
      if (prop === "style") return (store.style = fakeNode());
      if (prop === "getContext") return () => recordingContext().ctx;
      if (prop === "clientWidth") return 300;
      if (prop === Symbol.toPrimitive) return () => "";
      return fakeNode();
    },
    set(_, prop, value) {
      store[prop] = value;
      return true;
    },
    apply() {
      return fakeNode();
    },
  });
  return node;
}

function screenWith(mods = {}) {
  return LIVE.createScreen(mods);
}

// A theater with effects wired the way the page wires them.
function theaterFor(matches, { screen = screenWith(), holdMs = 1000, speed = 200 } = {}) {
  const theater = LIVE.createTheater({
    matches,
    speed,
    holdMs,
    onTick: (events, tick, m) => LIVE.feedEffects(screen, events, tick, m),
    onMatch: (m) => LIVE.startEffects(screen, m),
  });
  return { theater, screen };
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftfall-live-"));
  logs[7] = runSample(7);
  logs[8] = runSample(8);
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("problemWith rejects things that are not a playable match log", () => {
  assert.match(LIVE.problemWith(null), /not a JSON object/);
  assert.match(LIVE.problemWith("hello"), /not a JSON object/);
  assert.match(LIVE.problemWith({ format: "other" }), /not a Driftfall match log/);
  assert.match(LIVE.problemWith({ format: "driftfall-log" }), /no starting state/);
  assert.match(LIVE.problemWith({ format: "driftfall-log", initial: {} }), /no list of ticks/);
  assert.equal(LIVE.problemWith(logs[7]), null);
});

test("createMatch throws a plain message for a bad log and never for a good one", () => {
  assert.throws(() => LIVE.createMatch({ format: "driftfall-log" }), /no starting state/);
  assert.doesNotThrow(() => LIVE.createMatch(logs[7], "seed 7.json"));
});

test("a sample match gives both players' names and colors and its real length and result", () => {
  const log = logs[7];
  const m = LIVE.createMatch(log, "seed 7.json");
  assert.deepEqual(
    m.players.map((p) => p.color),
    LIVE.SIDE_COLORS,
  );
  assert.equal(m.players[0].name, log.players[0]);
  assert.equal(m.players[1].name, log.players[1]);
  assert.equal(m.last, log.initial.tick + log.ticks.length);
  assert.ok(m.crystalMax > 0);
  m.seek(m.last);
  assert.deepEqual(m.state.result, log.result);
});

test("sideOf gives a fallback name when the log has none", () => {
  assert.equal(LIVE.sideOf({}, 0).name, "Player 1");
  assert.equal(LIVE.sideOf({ players: ["  ", "Lancer Lab"] }, 1).name, "Lancer Lab");
});

test("the page address is read into sources and settings", () => {
  const d = LIVE.parseSearch("");
  assert.deepEqual(d.logs, []);
  assert.equal(d.list, null);
  assert.equal(d.speed, LIVE.DEFAULT_SPEED);
  assert.equal(d.holdMs, LIVE.DEFAULT_HOLD_MS);

  const p = LIVE.parseSearch("?log=a.json&log=b.json&list=m.json&speed=25&hold=4");
  assert.deepEqual(p.logs, ["a.json", "b.json"]);
  assert.equal(p.list, "m.json");
  assert.equal(p.speed, 25);
  assert.equal(p.holdMs, 4000);

  assert.equal(LIVE.parseSearch("?speed=banana&hold=-3").speed, LIVE.DEFAULT_SPEED);
});

test("a match list can be an array or an object, with paths relative to the list file", () => {
  const base = "http://localhost:8000/viewer/live.html";
  assert.deepEqual(LIVE.expandList(["../a.json", "b.json", ""], base), [
    "http://localhost:8000/a.json",
    "http://localhost:8000/viewer/b.json",
  ]);
  assert.deepEqual(LIVE.expandList({ matches: ["x.json"] }, base), ["http://localhost:8000/viewer/x.json"]);
  assert.throws(() => LIVE.expandList({ other: 1 }, base), /array of log paths/);
});

test("the layout keeps the board clear of the header and footer, or of the HUD panel, on several screen sizes", () => {
  for (const [w, h] of [
    [1920, 1080],
    [1280, 720],
    [800, 600],
    [3840, 2160],
  ]) {
    const lay = LIVE.layout(w, h, 32, 32);
    const b = lay.board;
    assert.ok(b.x >= 0 && b.x + b.w <= w, `board fits across ${w}x${h}`);
    assert.ok(b.y >= lay.header.h, `board starts below the header at ${w}x${h}`);
    assert.ok(b.y + b.h <= lay.footer.y, `board ends above the footer at ${w}x${h}`);
    assert.equal(b.w, b.cell * 32);

    const side = LIVE.layout(w, h, 32, 32, { side: true });
    const sb = side.board;
    assert.ok(sb.x >= 0 && sb.x + sb.w <= side.panel.x, `board stays left of the HUD panel at ${w}x${h}`);
    assert.ok(sb.y >= 0 && sb.y + sb.h <= h, `board fits the height at ${w}x${h}`);
    assert.equal(side.panel.x + side.panel.w, w, `the HUD panel reaches the right edge at ${w}x${h}`);
  }
});

test("a sample match plays from the first tick to the end without errors, feeding every tick's events once", () => {
  const log = logs[7];
  const m = LIVE.createMatch(log, "seed 7.json");
  let fed = 0;
  let eventsFed = 0;
  const screen = screenWith();
  const theater = LIVE.createTheater({
    matches: [m],
    speed: 200,
    holdMs: 1000,
    onMatch: (match) => LIVE.startEffects(screen, match),
    onTick: (events, tick, match) => {
      fed++;
      eventsFed += events.length;
      LIVE.feedEffects(screen, events, tick, match);
    },
  });

  let frames = 0;
  while (theater.tick < m.last && frames < 100000) {
    theater.update(100);
    frames++;
  }
  assert.equal(theater.tick, m.last, "reached the last tick");
  assert.equal(fed, log.ticks.length, "every tick was passed exactly once");
  assert.equal(eventsFed, log.ticks.reduce((n, t) => n + t.events.length, 0), "every event was passed exactly once");
  assert.ok(m.state.result, "the final state carries the result");
  assert.deepEqual(screen.faults, [], "no optional module faulted");
});

test("after the result is held, a single match starts again from tick 0", () => {
  const m = LIVE.createMatch(logs[7], "seed 7.json");
  const { theater } = theaterFor([m]);
  while (theater.tick < m.last) theater.update(100);
  theater.update(500);
  assert.equal(theater.tick, m.last, "still holding the result");
  theater.update(600);
  assert.equal(theater.tick, 0);
  assert.equal(theater.index, 0);
});

test("a playlist loops through its matches in order, and next and prev move around it", () => {
  const first = LIVE.createMatch(logs[7], "seed 7.json");
  const second = LIVE.createMatch(logs[8], "seed 8.json");
  const { theater } = theaterFor([first, second]);
  assert.equal(theater.count, 2);
  assert.equal(theater.match.name, "seed 7.json");

  while (theater.index === 0) theater.update(100);
  assert.equal(theater.index, 1, "moved to the second match after the first ended and was held");
  assert.equal(theater.tick, 0);

  while (theater.index === 1) theater.update(100);
  assert.equal(theater.index, 0, "wrapped back to the first match");

  theater.next();
  assert.equal(theater.index, 1);
  theater.prev();
  theater.prev();
  assert.equal(theater.index, 1, "previous from the first match wraps to the last");
});

test("pause, jump and speed changes stay within limits", () => {
  const m = LIVE.createMatch(logs[7], "seed 7.json");
  const { theater } = theaterFor([m]);
  theater.togglePause();
  theater.update(1000);
  assert.equal(theater.tick, 0);
  theater.togglePause();
  theater.update(1000);
  assert.equal(theater.tick, 200);
  theater.jump(50);
  assert.equal(theater.tick, 50, "jump forward");
  theater.jump(10);
  assert.equal(theater.tick, 10, "jump back rebuilds the picture");
  assert.equal(m.state.tick, 10);
  theater.jump(1e9);
  assert.equal(theater.tick, m.last, "jump is capped at the end");
  for (let i = 0; i < 50; i++) theater.faster();
  assert.equal(theater.speed, 200, "speed is capped");
  for (let i = 0; i < 50; i++) theater.slower();
  assert.equal(theater.speed, 1, "speed has a floor");
  theater.setSpeed(30);
  assert.equal(theater.speed, 30);
});

test("the frame draws with simple shapes when no art, fx or hud module exists, and reports the result at the end", () => {
  const m = LIVE.createMatch(logs[7], "seed 7.json");
  const { theater, screen } = theaterFor([m]);
  const { ctx, calls } = recordingContext();
  const frameArgs = { width: 1920, height: 1080, theater, screen };

  const first = LIVE.drawFrame(ctx, frameArgs);
  assert.ok(calls.count > 0, "something was drawn");
  assert.equal(first.sides[0].name, logs[7].players[0]);
  assert.equal(first.sides[1].color, LIVE.SIDE_COLORS[1]);
  assert.equal(first.resultText, null);
  assert.ok(calls.texts.includes(logs[7].players[0]), "the simple header draws player 0's name");

  while (theater.tick < m.last) theater.update(100);
  const last = LIVE.drawFrame(ctx, frameArgs);
  assert.ok(last.resultText, "result text is shown at the end");
  const winner = logs[7].result.winner;
  const expected = winner === null ? "Draw" : logs[7].players[winner];
  assert.ok(last.resultText.startsWith(expected), `"${last.resultText}" names the winner`);
  assert.deepEqual(screen.faults, []);
});

test("the sample match draws cleanly at many ticks, including the very first and the very last", () => {
  const m = LIVE.createMatch(logs[8], "seed 8.json");
  const { theater, screen } = theaterFor([m]);
  const { ctx } = recordingContext();
  const frameArgs = { width: 1280, height: 720, theater, screen };
  for (let t = 0; t <= m.last; t += 97) {
    theater.jump(t);
    assert.doesNotThrow(() => LIVE.drawFrame(ctx, frameArgs), `tick ${t}`);
  }
  assert.deepEqual(screen.faults, []);
});

test("optional modules that are not there give null, and loading them never throws", async () => {
  const absent = await LIVE.loadOptional(async (name) => {
    throw new Error(`Cannot find module ${name}.mjs`);
  });
  assert.deepEqual(absent, { art: null, fx: null, hud: null });

  const real = await LIVE.loadOptional();
  for (const name of ["art", "fx", "hud"]) {
    assert.ok(real[name] === null || typeof real[name] === "object", `${name} is a module or null`);
  }
});

test("the real art and effects modules, when they are there, play a sample match with no faults", async () => {
  const real = await LIVE.loadOptional();
  const m = LIVE.createMatch(logs[7], "seed 7.json");
  const screen = LIVE.createScreen(real);
  const { theater } = theaterFor([m], { screen });
  const { ctx } = recordingContext();
  const frameArgs = { width: 1920, height: 1080, theater, screen };
  while (theater.tick < m.last) {
    theater.update(200);
    LIVE.drawFrame(ctx, frameArgs);
  }
  assert.deepEqual(screen.faults, []);
  if (real.art) assert.ok(screen.mods.art, "the art module is in use");
  if (real.fx) assert.ok(screen.mods.fx, "effects are running for this match");
});

test("when art draws every piece, it gets the right options for each one", () => {
  const m = LIVE.createMatch(logs[7], "seed 7.json");
  const seen = { terrain: 0, units: 0, structures: 0 };
  const art = {
    drawTerrain: (ctx, state, opts) => {
      seen.terrain++;
      assert.equal(state.width, 32);
      assert.ok(opts.cell > 0);
      assert.ok(opts.fullCrystal > 0);
    },
    drawUnit: (ctx, unit, opts) => {
      seen.units++;
      assert.ok(opts.cell > 0);
      assert.equal(typeof opts.hit, "boolean");
      assert.equal(typeof opts.ox, "number");
    },
    drawStructure: (ctx, structure, opts) => {
      seen.structures++;
      assert.equal(typeof opts.hit, "boolean");
      assert.equal(typeof opts.complete, "undefined");
    },
  };
  const { theater, screen } = theaterFor([m], { screen: screenWith({ art }) });
  const { ctx } = recordingContext();
  theater.jump(400);
  LIVE.drawFrame(ctx, { width: 1920, height: 1080, theater, screen });
  assert.equal(seen.terrain, 1);
  assert.equal(seen.units, m.state.units.length);
  assert.equal(seen.structures, m.state.structures.length);
  assert.deepEqual(screen.faults, []);
});

test("a module that throws is switched off, the fault is recorded and the frame still draws", () => {
  const m = LIVE.createMatch(logs[7], "seed 7.json");
  const art = {
    drawUnit: () => {
      throw new Error("boom");
    },
  };
  const fxInstance = {
    advance: () => {},
    unitPos: (u) => ({ x: u.x, y: u.y }),
    drawSites: () => {},
    drawEffects: () => {
      throw new Error("fx boom");
    },
  };
  const fx = { createFx: () => fxInstance };
  const origError = console.error;
  console.error = () => {};
  try {
    const { theater, screen } = theaterFor([m], { screen: screenWith({ art, fx }) });
    const { ctx, calls } = recordingContext();
    theater.jump(300);
    const frameArgs = { width: 1920, height: 1080, theater, screen };
    assert.doesNotThrow(() => LIVE.drawFrame(ctx, frameArgs));
    assert.doesNotThrow(() => LIVE.drawFrame(ctx, frameArgs));
    assert.ok(calls.count > 0);
    assert.deepEqual(screen.faults, ["art.drawUnit", "fx.drawEffects"]);
    assert.equal(screen.mods.art, null);
    assert.equal(screen.mods.fx, null);
  } finally {
    console.error = origError;
  }
});

test("the page boots from its address, loads the log, mounts the HUD panel and draws both player names", async () => {
  // Stand-ins for the browser objects the page touches. The log comes from the fetch stand-in. The real art, fx and
  // hud modules load and run; the HUD mounts into a fake panel element.
  const { ctx, calls } = recordingContext();
  const canvas = { getContext: () => ctx, width: 0, height: 0 };
  const status = { textContent: "" };
  const elements = { screen: canvas, status, hud: fakeNode(), file: { onchange: null, click() {} } };
  const href = "http://localhost:8000/viewer/live.html";
  const fetched = [];
  const frames = { left: 40 };
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  const errors = [];

  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    fetch: globalThis.fetch,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    performance: globalThis.performance,
  };
  globalThis.document = {
    getElementById: (id) => elements[id] ?? null,
    createElement: () => fakeNode(),
    head: fakeNode(),
  };
  globalThis.location = { href, search: "?log=match-7.json&hold=2" };
  globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {} };
  globalThis.fetch = async (url) => {
    fetched.push(url);
    return { ok: true, status: 200, statusText: "OK", json: async () => logs[7] };
  };
  // The page's own frame loop runs through this stand-in; after a few dozen frames the test takes over.
  globalThis.requestAnimationFrame = (frame) => {
    if (--frames.left <= 0) return finish();
    setTimeout(() => frame(saved.performance.now()), 0);
  };
  const origError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    await import(pathToFileURL(path.join(ROOT, "viewer", "live.mjs")).href + "?boot=1");
    await done;
    assert.deepEqual(fetched, ["http://localhost:8000/viewer/match-7.json"]);
    assert.equal(status.textContent, "", "no message when the log loads");
    assert.ok(calls.count > 1000, "the board was drawn");
    assert.deepEqual(errors, [], "no module faulted while the page ran");
    assert.equal(elements.hud.style.width, "340px", "the HUD panel was mounted and sized for the side layout");
  } finally {
    console.error = origError;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
});
