// Drift schedule tests (node --test). These import the real env/drift.mjs and never stub it.
// Timings come from TERRITORY.md section 4 and are written out here by hand: 24 ticks a second,
// announcements 30 s (720 ticks) ahead, Flood 60 s, Squall 45 s, one Outer Reach every 20 s.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createDrift, squallBand, TICKS_PER_SECOND, ANNOUNCE_TICKS, MAP_SIZE, DRIFT_KINDS } from "../env/drift.mjs";

const SEEDS = [1, 2, 3, 7, 42, 1234, 99999, 123456789, 0xdeadbeef, 2026];

const at = (minutes, seconds = 0) => (minutes * 60 + seconds) * TICKS_PER_SECOND;
const SIDE_ROLES = ["main", "natural", "vent", "flank", "mesa", "pocket", "rich", "outer"];

// Collect every step over the whole schedule so each test can look at the same run.
function runAll(drift, lastTick) {
  const announced = new Map();
  const applied = new Map();
  const expired = new Map();
  for (let tick = 0; tick <= lastTick; tick++) {
    const { announce, apply, expire } = drift.step(tick);
    for (const ev of announce) announced.set(ev.id, (announced.get(ev.id) || []).concat(tick));
    for (const ev of apply) applied.set(ev.id, (applied.get(ev.id) || []).concat(tick));
    for (const ev of expire) expired.set(ev.id, (expired.get(ev.id) || []).concat(tick));
  }
  return { announced, applied, expired };
}

describe("same seed, same Drift", () => {
  test("the same seed gives an identical schedule every time", () => {
    for (const seed of SEEDS) {
      const a = JSON.stringify(createDrift(seed).events);
      const b = JSON.stringify(createDrift(seed).events);
      assert.equal(a, b, `seed ${seed}`);
    }
  });

  test("different seeds give different Drifts", () => {
    const base = JSON.stringify(createDrift(1).events);
    const differing = SEEDS.filter((seed) => seed !== 1 && JSON.stringify(createDrift(seed).events) !== base);
    assert.equal(differing.length, SEEDS.length - 1);
  });

  test("step() is pure: asking for the same tick twice, in any order, gives the same answer", () => {
    const drift = createDrift(42);
    const ticks = [at(3), at(0, 5), at(5), at(2, 30), at(3), at(14), at(0, 5)];
    const first = ticks.map((t) => JSON.stringify(drift.step(t)));
    const again = ticks.slice().reverse().map((t) => JSON.stringify(drift.step(t))).reverse();
    assert.deepEqual(again, first);
  });

  test("the module uses no clock, timers or Math.random", () => {
    const src = fs.readFileSync(new URL("../env/drift.mjs", import.meta.url), "utf8");
    for (const banned of ["Math.random", "Date", "setTimeout", "setInterval", "performance"]) {
      assert.equal(src.includes(banned), false, `env/drift.mjs must not use ${banned}`);
    }
  });
});

describe("the scheduled Drift (TERRITORY.md section 4)", () => {
  test("3:00 Bloom in both Flanks", () => {
    const { events } = createDrift(7);
    const blooms = events.filter((ev) => ev.tick === at(3) && ev.kind === "bloom");
    assert.equal(blooms.length, 1);
    const sides = blooms[0].targets.map((t) => t.side).sort();
    assert.deepEqual(sides, [0, 1]);
    for (const t of blooms[0].targets) assert.equal(t.role, "flank");
  });

  test("5:00 Squall over the Centre and a Bloom in the Centre, the same tick", () => {
    const { events } = createDrift(7);
    const at5 = events.filter((ev) => ev.tick === at(5));
    const squall = at5.find((ev) => ev.kind === "squall");
    const bloom = at5.find((ev) => ev.kind === "bloom");
    assert.ok(squall, "a squall at 5:00");
    assert.ok(bloom, "a bloom at 5:00");
    assert.deepEqual(bloom.targets, [{ side: "centre", role: "centre", index: 0 }]);
    // The band covers the middle of the map and does not move while it is over the Centre.
    const mid = squallBand(squall, squall.tick);
    assert.ok(mid.lo <= MAP_SIZE / 2 && mid.hi > MAP_SIZE / 2, "band covers the middle");
    assert.equal(squallBand(squall, squall.tick + at(0, 40)).lo, mid.lo);
  });

  test("7:00 and 8:00 Floods hit each side's Natural, one side each, the first side chosen by the seed", () => {
    for (const seed of SEEDS) {
      const { events } = createDrift(seed);
      const f7 = events.find((ev) => ev.tick === at(7) && ev.kind === "flood");
      const f8 = events.find((ev) => ev.tick === at(8) && ev.kind === "flood");
      assert.ok(f7 && f8, `seed ${seed}: floods at 7:00 and 8:00`);
      assert.equal(f7.targets[0].role, "natural");
      assert.equal(f8.targets[0].role, "natural");
      assert.notEqual(f7.targets[0].side, f8.targets[0].side, `seed ${seed}: one flood per side`);
    }
  });

  test("9:00 Quake closes one side's main ramp and opens the Mesa ramp on the other side", () => {
    for (const seed of SEEDS) {
      const { events } = createDrift(seed);
      const quake = events.find((ev) => ev.tick === at(9) && ev.kind === "quake");
      assert.ok(quake, `seed ${seed}: quake at 9:00`);
      const [close, open] = quake.targets;
      assert.equal(close.role, "main");
      assert.equal(open.role, "mesa");
      assert.notEqual(close.side, open.side, `seed ${seed}: the new ramp goes on the other side`);
    }
  });

  test("14:00 The Fall crumbles the four Outer Reaches, one every 20 s", () => {
    for (const seed of SEEDS) {
      const { events } = createDrift(seed);
      const falls = events.filter((ev) => ev.kind === "fall").sort((a, b) => a.tick - b.tick);
      assert.equal(falls.length, 4, `seed ${seed}`);
      assert.deepEqual(falls.map((ev) => ev.tick), [at(14), at(14, 20), at(14, 40), at(15)]);
      const reaches = falls.map((ev) => `${ev.targets[0].side}-${ev.targets[0].index}`).sort();
      assert.deepEqual(reaches, ["0-0", "0-1", "1-0", "1-1"], `seed ${seed}: each Outer Reach once`);
      for (const ev of falls) assert.equal(ev.targets[0].role, "outer");
    }
  });

  test("the schedule has the scheduled events only at their ticks, and random ones at 11:00 and 13:00", () => {
    const { events } = createDrift(99);
    const fixed = new Set([at(3), at(5), at(7), at(8), at(9), at(14), at(14, 20), at(14, 40), at(15)]);
    const random = events.filter((ev) => !fixed.has(ev.tick));
    assert.equal(random.length, 2 * 1, "two random slots, one event each");
    assert.deepEqual(random.map((ev) => ev.tick).sort((a, b) => a - b), [at(11), at(13)]);
  });
});

describe("announcements and application", () => {
  test("every event is announced exactly 30 s before it applies, and applied exactly once", () => {
    for (const seed of SEEDS) {
      const drift = createDrift(seed);
      const { announced, applied } = runAll(drift, at(15, 30));
      for (const ev of drift.events) {
        assert.equal(ev.announceTick, ev.tick - ANNOUNCE_TICKS, `seed ${seed} event ${ev.id}`);
        assert.deepEqual(announced.get(ev.id), [ev.announceTick], `seed ${seed} event ${ev.id} announced`);
        assert.deepEqual(applied.get(ev.id), [ev.tick], `seed ${seed} event ${ev.id} applied`);
      }
      assert.equal(ANNOUNCE_TICKS, 30 * TICKS_PER_SECOND);
    }
  });

  test("Flood lasts 60 s and Squall 45 s, and both then expire on the same tick they started plus duration", () => {
    const { events } = createDrift(5);
    for (const ev of events) {
      if (ev.kind === "flood") assert.equal(ev.expireTick, ev.tick + 60 * TICKS_PER_SECOND);
      else if (ev.kind === "squall") assert.equal(ev.expireTick, ev.tick + 45 * TICKS_PER_SECOND);
      else assert.equal(ev.expireTick, null, `${ev.kind} is permanent`);
    }
  });

  test("expiry is reported on the exact tick it ends, and only for timed events", () => {
    const drift = createDrift(5);
    const { expired } = runAll(drift, at(15, 30));
    for (const ev of drift.events) {
      if (ev.expireTick === null) assert.equal(expired.has(ev.id), false);
      else assert.deepEqual(expired.get(ev.id), [ev.expireTick]);
    }
  });

  test("active() lists the events that have applied and not yet expired", () => {
    const drift = createDrift(5);
    const flood = drift.events.find((ev) => ev.kind === "flood" && ev.tick === at(7));
    assert.equal(drift.active(flood.tick - 1).some((ev) => ev.id === flood.id), false);
    assert.equal(drift.active(flood.tick).some((ev) => ev.id === flood.id), true);
    assert.equal(drift.active(flood.expireTick - 1).some((ev) => ev.id === flood.id), true);
    assert.equal(drift.active(flood.expireTick).some((ev) => ev.id === flood.id), false);
  });
});

describe("random slots", () => {
  test("random events come from the table and target real Reach roles only", () => {
    const allowed = new Set(DRIFT_KINDS);
    for (const seed of SEEDS) {
      const { events } = createDrift(seed);
      for (const ev of events.filter((e) => e.tick === at(11) || e.tick === at(13))) {
        assert.ok(allowed.has(ev.kind), `seed ${seed}: ${ev.kind} is a Drift kind`);
        assert.notEqual(ev.kind, "fall");
        for (const t of ev.targets) {
          assert.ok([0, 1, "centre"].includes(t.side), `seed ${seed}: side ${t.side}`);
          assert.ok(SIDE_ROLES.includes(t.role) || t.role === "centre", `seed ${seed}: role ${t.role}`);
        }
      }
    }
  });

  test("Dry-outs are the most likely random event, about 3 in 7", () => {
    const counts = {};
    let total = 0;
    for (let seed = 1; seed <= 500; seed++) {
      for (const ev of createDrift(seed).events) {
        if (ev.tick !== at(11) && ev.tick !== at(13)) continue;
        counts[ev.kind] = (counts[ev.kind] || 0) + 1;
        total++;
      }
    }
    const share = counts["dry-out"] / total;
    assert.ok(share > 0.36 && share < 0.5, `dry-out share ${share.toFixed(3)}`);
    for (const kind of ["bloom", "flood", "quake", "squall"]) {
      assert.ok(counts["dry-out"] > counts[kind], `dry-out beats ${kind}`);
    }
  });
});

describe("squall band", () => {
  test("a band drifts at its speed and keeps its width; the 5:00 Centre band stays put", () => {
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const ev of createDrift(seed).events) {
        if (ev.kind !== "squall") continue;
        const { band } = ev.detail;
        const b0 = squallBand(ev, ev.tick);
        const b1 = squallBand(ev, ev.tick + TICKS_PER_SECOND * 4);
        assert.equal(b1.lo - b0.lo, band.direction * band.speed * 4, `seed ${seed}`);
        assert.equal(b1.hi - b1.lo, band.width, `seed ${seed}`);
        checked++;
      }
    }
    assert.ok(checked > 0, "some random squall was checked");
  });

  test("squallBand is null before a squall starts and after it expires", () => {
    const { events } = createDrift(3);
    const squall = events.find((ev) => ev.kind === "squall");
    assert.equal(squallBand(squall, squall.tick - 1), null);
    assert.equal(squallBand(squall, squall.expireTick), null);
    assert.notEqual(squallBand(squall, squall.tick), null);
  });
});
