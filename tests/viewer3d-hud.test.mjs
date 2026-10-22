// Node tests for viewer3d/hud.mjs pure logic (owner: haiku). No browser: the DOM part is only loaded, not run.
// Run with: node --test tests/viewer3d-hud.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createWorld } from "../viewer3d/world.mjs";
import {
  formatNumber, kindLabel, summarizeSides, unitRows, valueShare, tickLabel, buildingsText,
  scrubFraction, tickFromFraction, minimapCoords, minimapTile, resultBanner, SPEEDS,
} from "../viewer3d/hud.mjs";
import { UNIT_KINDS, STATS, sideValue } from "../env/stats.mjs";

const sample = JSON.parse(fs.readFileSync(new URL("../matches/sample-7.json", import.meta.url), "utf8"));

function miniState(over = {}) {
  return {
    tick: 0, seed: 1, width: 32, height: 32, rocks: [], crystals: [], shards: [100, 40],
    units: [], structures: [], events: [], result: null, ...over,
  };
}

test("formatNumber groups digits the same on every machine", () => {
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(999), "999");
  assert.equal(formatNumber(1234), "1,234");
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.equal(formatNumber(-4200), "-4,200");
  assert.equal(formatNumber(NaN), "0");
});

test("kindLabel capitalises the kind for the unit list", () => {
  assert.equal(kindLabel("grunt"), "Grunt");
  assert.equal(kindLabel(""), "");
});

test("summarizeSides counts Shards, value, units and the Core on the empty start", () => {
  const state = miniState({
    units: [
      { id: 3, owner: 0, kind: "worker", x: 4, y: 3, hp: 40 },
      { id: 4, owner: 0, kind: "grunt", x: 3, y: 4, hp: 60 },
      { id: 7, owner: 1, kind: "lancer", x: 27, y: 27, hp: 40 },
    ],
    structures: [
      { id: 1, owner: 0, kind: "core", x: 3, y: 3, hp: 800, complete: true, progress: 0, queue: [] },
      { id: 2, owner: 1, kind: "core", x: 28, y: 28, hp: 1000, complete: true, progress: 0, queue: [] },
      { id: 9, owner: 0, kind: "forge", x: 6, y: 6, hp: 50, complete: false, progress: 4, queue: [] },
    ],
  });
  const [a, b] = summarizeSides(state);
  assert.equal(a.shards, 100);
  assert.equal(b.shards, 40);
  assert.equal(a.unitTotal, 2);
  assert.equal(a.units.worker, 1);
  assert.equal(a.units.grunt, 1);
  assert.equal(a.units.brute, 0);
  assert.equal(b.units.lancer, 1);
  assert.equal(a.value, 100 + 50 + 50 + 0);
  assert.equal(a.value, sideValue(state, 0));
  assert.deepEqual(a.buildings, { complete: 1, sites: 1 });
  assert.equal(a.coreHp, 800);
  assert.equal(a.coreMaxHp, STATS.core.hp);
  assert.equal(b.coreHp, 1000);
  assert.equal(a.unitCap, STATS.match.unitCap);
});

test("unit rows cover every roster kind, so new units appear without editing the HUD", () => {
  const summary = summarizeSides(miniState())[0];
  const rows = unitRows(summary);
  assert.deepEqual(rows.map((r) => r.kind), UNIT_KINDS);
  assert.ok(rows.every((r) => r.count === 0));
  assert.equal(rows[0].label, kindLabel(UNIT_KINDS[0]));
});

test("units of a kind the table does not know still count in the total", () => {
  const state = miniState({ units: [{ id: 3, owner: 0, kind: "future-unit", x: 1, y: 1, hp: 5 }] });
  const a = summarizeSides(state)[0];
  assert.equal(a.unitTotal, 1);
  assert.equal(Object.hasOwn(a.units, "future-unit"), false);
});

test("valueShare is the side 0 fraction, and half when nobody has value", () => {
  assert.equal(valueShare(0, 0), 0.5);
  assert.equal(valueShare(300, 100), 0.75);
  assert.equal(valueShare(-5, 10), 0);
  assert.equal(valueShare(10, 0), 1);
});

test("tick label and scrub map a tick to the bar and back", () => {
  assert.equal(tickLabel(340, 2000), "Tick 340 / 2,000");
  assert.equal(scrubFraction(0, 2000), 0);
  assert.equal(scrubFraction(1000, 2000), 0.5);
  assert.equal(scrubFraction(5, 0), 0);
  assert.equal(tickFromFraction(0.5, 2000), 1000);
  assert.equal(tickFromFraction(1.7, 2000), 2000);
  assert.equal(tickFromFraction(-1, 2000), 0);
  assert.equal(tickFromFraction(0.5, 0), 0);
});

test("buildingsText notes sites still going up", () => {
  assert.equal(buildingsText({ buildings: { complete: 3, sites: 0 } }), "3");
  assert.equal(buildingsText({ buildings: { complete: 3, sites: 2 } }), "3 (+2 building)");
});

test("minimap tile and pixel conversions are inverse and clamped", () => {
  const p = minimapCoords(5, 7, 32, 32, 320);
  assert.deepEqual(minimapTile(p.x, p.y, 32, 32, 320), { x: 5, y: 7 });
  assert.deepEqual(minimapTile(-10, 9999, 32, 32, 320), { x: 0, y: 31 });
});

test("resultBanner says who won and why, or null while the match runs", () => {
  assert.equal(resultBanner(null), null);
  const core = resultBanner({ winner: 0, reason: "core", tick: 500, value: [1, 2] }, ["Blue", "Amber"]);
  assert.equal(core.title, "Blue wins");
  assert.equal(core.side, 0);
  assert.equal(core.detail, "Enemy Core destroyed");
  const time = resultBanner({ winner: 1, reason: "timeout", tick: 2000, value: [3460, 3520] }, ["A", "B"]);
  assert.equal(time.title, "B wins");
  assert.equal(time.detail, "Time is up: value 3,460 to 3,520");
  const draw = resultBanner({ winner: null, reason: "both-cores", tick: 90, value: [0, 0] });
  assert.equal(draw.title, "Draw");
  assert.equal(draw.side, null);
  assert.equal(draw.detail, "Both Cores fell");
});

test("speed steps are 1, 2 and 4", () => {
  assert.deepEqual(SPEEDS, [1, 2, 4]);
});

test("real sample match: the HUD summary matches the sim's own value at the end", () => {
  const world = createWorld(sample);
  assert.equal(world.ticks, 2000);
  const last = world.frame(world.ticks);
  const [a, b] = summarizeSides(last.next);
  assert.deepEqual([a.value, b.value], sample.result.value);
  assert.equal(resultBanner(last.next.result, world.players).title, "Driftfall" === "" ? "" : `${world.players[1]} wins`);
});

test("real sample match: frame events the HUD does not show never break summaries", () => {
  const world = createWorld(sample);
  for (const t of [0, 1, 50.5, 400, 1200, 2000]) {
    const f = world.frame(t);
    const [a, b] = summarizeSides(f.alpha < 0.5 && f.prev ? f.prev : f.next);
    assert.ok(a.unitTotal <= STATS.match.unitCap && b.unitTotal <= STATS.match.unitCap);
    assert.ok(Number.isFinite(a.value) && Number.isFinite(b.value));
  }
});
