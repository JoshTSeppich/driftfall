// Buildings for the 3D view: Core, Forge and Turret, plus construction sites and collapses.
// Owner: haiku. Contract: VISUAL-3D.md. createBuildings(ctx) -> { update(frame, dt), dispose() }.
// Everything here is original low-poly geometry built in code. The pure helpers at the top have no THREE
// dependency, so tests/viewer3d-buildings.test.mjs can run them in node.
import { STATS } from "../env/stats.mjs";

// Fallback colours, used until palette.mjs provides its own (see teamGlowHex).
const TEAM_HEX = [0x3fd8ff, 0xffb23a];
const SHARD_HEX = 0x2fc9b5;
const FURNACE_HEX = 0xff7a2a;
const SMOKE_HEX = 0x6b6f78;
const DUSK_HEX = 0x1a1d24;

// Building heights in tile units (1 = one grid tile). Used to place the rise and the scaffold.
const HEIGHT = { core: 0.95, forge: 0.8, turret: 0.85, generic: 0.6 };

// ---------- pure helpers (no THREE, no DOM) ----------

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Smooth ease in and out, 0..1 -> 0..1.
export function smooth(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

// Damage stage from hp: 0 healthy, 1 light smoke (under 66%), 2 heavy smoke (under 33%), 3 critical (under 15%).
export function damageStage(hp, maxHp) {
  if (!(maxHp > 0)) return 0;
  const r = hp / maxHp;
  if (r < 0.15) return 3;
  if (r < 0.33) return 2;
  if (r < 0.66) return 1;
  return 0;
}

// Share of a construction done, 0..1. A complete structure (no buildTicks) is 1.
export function buildFraction(progress, buildTicks) {
  return buildTicks > 0 ? clamp01(progress / buildTicks) : 1;
}

// Vertical offset of the building body (tile units). At fraction 0 it sits fully under the ground, at 1 it is level.
export function riseOffset(fraction, height) {
  return -(1 - smooth(fraction)) * height;
}

// Scaffold height multiplier: starts at 0.2 so the frame shows as soon as building starts, grows to 1.
export function scaffoldScale(fraction) {
  return 0.2 + 0.8 * clamp01(fraction);
}

// Spec distance (§6): the larger of |dx| and |dy|.
export function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// The enemy a complete Turret shoots (spec §7): nearest within range, ties go to the lower id.
// candidates: [{ id, owner, x, y, hp }] (units, structures and sites). Returns the chosen candidate or null.
export function pickTurretTarget(turret, candidates, range = 5) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c.owner === turret.owner || !(c.hp > 0)) continue;
    const d = chebyshev(turret, c);
    if (d > range) continue;
    if (best === null || d < bestD || (d === bestD && c.id < best.id)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// Turn an angle toward a target along the shortest arc, damped so it eases in. rate is 1/s.
export function turnToward(current, target, rate, dt) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-rate * dt));
}

// Idle scan of an unmanned Turret: a slow sweep of about 50 degrees either side of straight ahead.
export function scanAngle(time, phase = 0) {
  return Math.sin(time * 0.45 + phase) * 0.9;
}

// Particles per second for a damage stage: [smoke, sparks].
export function smokeRate(stage) {
  if (stage === 1) return [1.2, 0];
  if (stage === 2) return [3, 0.6];
  if (stage === 3) return [6, 2];
  return [0, 0];
}

// Collapse animation: 0..1 over the time it takes a destroyed building to sink.
export function collapseProgress(ageSec, duration = 1.2) {
  return clamp01(ageSec / duration);
}

// Team glow colour. side 0 cyan, side 1 amber. palette.mjs can override via palette.team[owner] (a number).
export function teamGlowHex(owner, palette) {
  const fromPalette = palette && palette.team && palette.team[owner];
  if (typeof fromPalette === "number") return fromPalette;
  return TEAM_HEX[owner === 1 ? 1 : 0];
}

// ---------- scene code (needs ctx.THREE, the scene and the grid helper) ----------

export function createBuildings(ctx) {
  const T = ctx.THREE;
  const tile = ctx.tileSize || 1;
  const palette = ctx.palette || null;
  const root = new T.Group();
  root.name = "buildings";
  ctx.scene.add(root);

  // Shared geometry and materials, built once and reused by every building.
  const geos = new Map();
  const mats = new Map();
  const geo = (key, make) => {
    let g = geos.get(key);
    if (!g) geos.set(key, (g = make()));
    return g;
  };
  const mat = (key, make) => {
    let m = mats.get(key);
    if (!m) mats.set(key, (m = make()));
    return m;
  };
  const metal = () => mat("metal", () => new T.MeshStandardMaterial({ color: 0x3b4250, roughness: 0.55, metalness: 0.6 }));
  const plate = () => mat("plate", () => new T.MeshStandardMaterial({ color: 0x566070, roughness: 0.4, metalness: 0.7 }));
  const dark = () => mat("dark", () => new T.MeshStandardMaterial({ color: 0x252a35, roughness: 0.75, metalness: 0.4 }));
  const brass = () => mat("brass", () => new T.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.8, metalness: 0.3 }));
  const shard = () =>
    mat("shard", () => new T.MeshStandardMaterial({ color: SHARD_HEX, emissive: SHARD_HEX, emissiveIntensity: 1.2, roughness: 0.2 }));
  const furnace = () => mat("furnace", () => new T.MeshBasicMaterial({ color: new T.Color(FURNACE_HEX).multiplyScalar(1.6) }));
  const well = () => mat("well", () => new T.MeshBasicMaterial({ color: 0x06202a }));
  // Team glow: unlit and over-bright so bloom picks it up. Shared per owner.
  const glow = (owner) =>
    mat("glow" + owner, () => {
      const m = new T.MeshBasicMaterial({ color: new T.Color(teamGlowHex(owner, palette)).multiplyScalar(1.5) });
      m.toneMapped = false;
      return m;
    });

  // Smoke puff texture: a soft radial dot, made only where a canvas exists (browser). Node runs get null.
  let smokeTex = null;
  if (typeof document !== "undefined") {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.5, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    smokeTex = new T.CanvasTexture(cv);
  }

  // Particle pools: one Points object per pool, a ring buffer of particles, CPU-simulated.
  function makePool(n, { color, size, additive }) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const life = new Float32Array(n);
    const maxLife = new Float32Array(n);
    const base = new Float32Array(n * 3);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(pos, 3));
    geometry.setAttribute("color", new T.BufferAttribute(col, 3));
    const material = new T.PointsMaterial({
      size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      map: smokeTex,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
    });
    const points = new T.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 2;
    ctx.scene.add(points);
    let cursor = 0;
    const c = new T.Color();
    for (let i = 0; i < n; i++) {
      pos[i * 3 + 1] = -1e4;
    }
    return {
      emit(x, y, z, vx, vy, vz, lifeSec, hex) {
        const i = cursor;
        cursor = (cursor + 1) % n;
        c.setHex(hex);
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = z;
        vel[i * 3] = vx;
        vel[i * 3 + 1] = vy;
        vel[i * 3 + 2] = vz;
        base[i * 3] = c.r;
        base[i * 3 + 1] = c.g;
        base[i * 3 + 2] = c.b;
        life[i] = lifeSec;
        maxLife[i] = lifeSec;
      },
      update(dt) {
        for (let i = 0; i < n; i++) {
          if (life[i] <= 0) continue;
          life[i] -= dt;
          const k = i * 3;
          if (life[i] <= 0) {
            pos[k + 1] = -1e4;
            continue;
          }
          const drag = Math.exp(-1.6 * dt);
          vel[k] *= drag;
          vel[k + 1] = vel[k + 1] * drag + (additive ? -0.6 : 0.25) * dt;
          vel[k + 2] *= drag;
          pos[k] += vel[k] * dt;
          pos[k + 1] += vel[k + 1] * dt;
          pos[k + 2] += vel[k + 2] * dt;
          // Smoke fades into the dusk colour; sparks fade to black, which is transparent when additive.
          const fade = Math.min(1, life[i] / maxLife[i]);
          const toward = additive ? 0 : 1;
          const f = additive ? fade : 1 - fade;
          col[k] = base[k] * (additive ? fade : 1) + (additive ? 0 : ((DUSK_HEX >> 16) & 255) / 255 - base[k]) * f * toward;
          col[k + 1] = base[k + 1] * (additive ? fade : 1) + (additive ? 0 : ((DUSK_HEX >> 8) & 255) / 255 - base[k + 1]) * f * toward;
          col[k + 2] = base[k + 2] * (additive ? fade : 1) + (additive ? 0 : (DUSK_HEX & 255) / 255 - base[k + 2]) * f * toward;
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
      },
      dispose() {
        ctx.scene.remove(points);
        geometry.dispose();
        material.dispose();
      },
    };
  }
  const smoke = makePool(360, { color: SMOKE_HEX, size: 0.42 * tile, additive: false });
  const sparks = makePool(200, { color: FURNACE_HEX, size: 0.12 * tile, additive: true });

  // Random helper for visual-only variety (the sim never uses this).
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Build the meshes for one kind. Returns the parts the per-frame animation needs.
  function buildBody(kind, owner) {
    const body = new T.Group();
    const g = glow(owner);
    const shadowed = (m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const parts = { kind, body, spin: [], pulse: [], head: null, furnace: null, muzzle: null, barrels: [] };

    if (kind === "core") {
      // Octagonal plinth with a glowing team rim, a tower and a shard crown with three shards orbiting.
      body.add(shadowed(new T.Mesh(geo("corePlinth", () => new T.CylinderGeometry(0.46, 0.52, 0.28, 8)), metal())));
      body.getObjectByProperty("type", "Mesh").position.y = 0.14;
      const cap = shadowed(new T.Mesh(geo("coreCap", () => new T.CylinderGeometry(0.36, 0.4, 0.12, 8)), plate()));
      cap.position.y = 0.34;
      body.add(cap);
      const hole = new T.Mesh(geo("coreHole", () => new T.CircleGeometry(0.24, 16)), well());
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.41;
      body.add(hole);
      const rim = new T.Mesh(geo("coreRim", () => new T.TorusGeometry(0.43, 0.025, 6, 8)), g);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.295;
      body.add(rim);
      const tower = shadowed(new T.Mesh(geo("coreTower", () => new T.CylinderGeometry(0.16, 0.22, 0.5, 8)), metal()));
      tower.position.y = 0.6;
      body.add(tower);
      const crown = new T.Mesh(geo("coreCrown", () => new T.OctahedronGeometry(0.2)), shard());
      crown.position.y = 1.02;
      body.add(crown);
      parts.crown = crown;
      // Dashed glow ring around the base, slowly turning.
      const dashes = new T.Group();
      for (let i = 0; i < 8; i++) {
        const d = new T.Mesh(geo("coreDash", () => new T.BoxGeometry(0.12, 0.02, 0.04)), g);
        const a = (i / 8) * Math.PI * 2;
        d.position.set(Math.cos(a) * 0.62, 0.03, Math.sin(a) * 0.62);
        d.rotation.y = -a;
        dashes.add(d);
      }
      body.add(dashes);
      parts.spin.push({ obj: dashes, speed: 0.35 });
      // Three shards orbit the crown.
      const orbit = new T.Group();
      orbit.position.y = 0.55;
      for (let i = 0; i < 3; i++) {
        const s = new T.Mesh(geo("coreOrbit", () => new T.OctahedronGeometry(0.07)), shard());
        const a = (i / 3) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
        orbit.add(s);
      }
      body.add(orbit);
      parts.spin.push({ obj: orbit, speed: 0.8 });
      parts.pulse.push({ obj: rim, base: 1, amp: 0.08, speed: 2.2 });
    } else if (kind === "forge") {
      // Chamfered block with a glowing furnace mouth, a team plate under it and a smoking stack.
      const block = shadowed(new T.Mesh(geo("forgeBlock", () => new T.BoxGeometry(0.66, 0.5, 0.66)), metal()));
      block.position.y = 0.25;
      body.add(block);
      const bevel = shadowed(new T.Mesh(geo("forgeBevel", () => new T.BoxGeometry(0.72, 0.08, 0.72)), plate()));
      bevel.position.y = 0.54;
      body.add(bevel);
      const base = new T.Mesh(geo("forgeBase", () => new T.BoxGeometry(0.72, 0.03, 0.72)), g);
      base.position.y = 0.015;
      body.add(base);
      const mouth = new T.Mesh(geo("forgeMouth", () => new T.PlaneGeometry(0.34, 0.2)), furnace());
      mouth.position.set(0, 0.2, 0.332);
      body.add(mouth);
      parts.furnace = mouth;
      const stack = shadowed(new T.Mesh(geo("forgeStack", () => new T.CylinderGeometry(0.07, 0.09, 0.45, 8)), dark()));
      stack.position.set(0.2, 0.75, -0.18);
      body.add(stack);
      const stackRing = new T.Mesh(geo("forgeStackRing", () => new T.TorusGeometry(0.075, 0.015, 4, 10)), g);
      stackRing.rotation.x = Math.PI / 2;
      stackRing.position.set(0.2, 0.98, -0.18);
      body.add(stackRing);
      parts.pulse.push({ obj: base, base: 1, amp: 0.06, speed: 1.6 });
      parts.stackTop = new T.Vector3(0.2, 1.02, -0.18);
    } else if (kind === "turret") {
      // Hexagonal bolted disc, pedestal, and a head with twin barrels that turns to aim.
      const disc = shadowed(new T.Mesh(geo("turretDisc", () => new T.CylinderGeometry(0.34, 0.38, 0.12, 6)), plate()));
      disc.position.y = 0.06;
      body.add(disc);
      const ring = new T.Mesh(geo("turretRing", () => new T.TorusGeometry(0.34, 0.02, 4, 24)), g);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.13;
      body.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const bolt = new T.Mesh(geo("turretBolt", () => new T.SphereGeometry(0.03, 6, 4)), metal());
        bolt.position.set(Math.cos(a) * 0.31, 0.14, Math.sin(a) * 0.31);
        body.add(bolt);
      }
      const pedestal = shadowed(new T.Mesh(geo("turretPedestal", () => new T.CylinderGeometry(0.16, 0.2, 0.25, 8)), metal()));
      pedestal.position.y = 0.25;
      body.add(pedestal);
      const head = new T.Group();
      head.position.y = 0.42;
      const housing = shadowed(new T.Mesh(geo("turretHousing", () => new T.BoxGeometry(0.3, 0.16, 0.26)), plate()));
      head.add(housing);
      for (const z of [-0.08, 0.08]) {
        const barrel = shadowed(new T.Mesh(geo("turretBarrel", () => new T.CylinderGeometry(0.035, 0.035, 0.42, 6)), dark()));
        barrel.rotation.z = Math.PI / 2;
        barrel.position.set(0.3, 0, z);
        head.add(barrel);
        parts.barrels.push(barrel);
      }
      const beacon = new T.Mesh(geo("turretBeacon", () => new T.SphereGeometry(0.04, 6, 4)), g);
      beacon.position.set(-0.05, 0.12, 0);
      head.add(beacon);
      const muzzle = new T.Sprite(
        new T.SpriteMaterial({
          map: smokeTex,
          color: 0xffe2a0,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      );
      muzzle.position.set(0.58, 0, 0);
      muzzle.scale.setScalar(0.2);
      head.add(muzzle);
      body.add(head);
      parts.head = head;
      parts.muzzle = muzzle;
      parts.pulse.push({ obj: ring, base: 1, amp: 0.1, speed: 3 });
    } else {
      // Unknown structure kind (a new kind from the roster): a plain block with team glow, so nothing is skipped.
      const block = shadowed(new T.Mesh(geo("genericBlock", () => new T.BoxGeometry(0.6, 0.6, 0.6)), metal()));
      block.position.y = 0.3;
      body.add(block);
      const base = new T.Mesh(geo("genericBase", () => new T.BoxGeometry(0.64, 0.03, 0.64)), g);
      base.position.y = 0.015;
      body.add(base);
    }
    return parts;
  }

  // Scaffold frame: four corner posts, three rails on each face, team-coloured caps. Scaled up in y as work goes on.
  function buildScaffold(kind, owner, height) {
    const frame = new T.Group();
    const g = glow(owner);
    const h = height;
    const half = 0.4;
    const post = geo("scaffoldPost", () => new T.BoxGeometry(0.04, 1, 0.04));
    const rail = geo("scaffoldRail", () => new T.BoxGeometry(0.8, 0.035, 0.035));
    const railZ = geo("scaffoldRailZ", () => new T.BoxGeometry(0.035, 0.035, 0.8));
    for (const [px, pz] of [
      [-half, -half],
      [half, -half],
      [-half, half],
      [half, half],
    ]) {
      const p = new T.Mesh(post, brass());
      p.scale.y = h;
      p.position.set(px, h / 2, pz);
      p.castShadow = true;
      frame.add(p);
      const cap = new T.Mesh(geo("scaffoldCap", () => new T.BoxGeometry(0.07, 0.05, 0.07)), g);
      cap.position.set(px, h + 0.02, pz);
      frame.add(cap);
    }
    for (const level of [0.33, 0.66, 1]) {
      for (const z of [-half, half]) {
        const r = new T.Mesh(rail, brass());
        r.position.set(0, level * h, z);
        frame.add(r);
      }
      for (const x of [-half, half]) {
        const r = new T.Mesh(railZ, brass());
        r.position.set(x, level * h, 0);
        frame.add(r);
      }
    }
    return frame;
  }

  const records = new Map();
  const dying = [];
  let lastTick = -1;
  let clock = 0;
  const hpOf = (kind) => (kind === "core" ? STATS.core.hp : (STATS.structures[kind] || {}).hp || 1);
  const buildTicksOf = (kind) => (STATS.structures[kind] || {}).buildTicks || 0;

  function makeRecord(s) {
    const height = HEIGHT[s.kind] ?? HEIGHT.generic;
    const rootG = new T.Group();
    rootG.name = `structure-${s.id}`;
    const p = ctx.gridToWorld(s.x, s.y);
    rootG.position.copy(p);
    rootG.scale.setScalar(tile);
    root.add(rootG);
    const parts = buildBody(s.kind, s.owner);
    rootG.add(parts.body);
    const scaffold = buildScaffold(s.kind, s.owner, height);
    scaffold.visible = false;
    rootG.add(scaffold);
    const rec = {
      id: s.id,
      owner: s.owner,
      kind: s.kind,
      height,
      root: rootG,
      parts,
      scaffold,
      riseShown: s.complete ? 1 : 0,
      scaffoldK: 1,
      stage: 0,
      smokeAcc: 0,
      sparkAcc: 0,
      flash: 0,
      heading: 0,
      target: null,
      collapse: null,
    };
    return rec;
  }

  function localToWorld(rec, lx, ly, lz) {
    // Manual transform: root is uniformly scaled and the body rises, so read the offsets directly.
    const s = tile;
    return new T.Vector3(
      rec.root.position.x + lx * s,
      rec.root.position.y + (ly + rec.parts.body.position.y) * s,
      rec.root.position.z + lz * s,
    );
  }

  function burst(rec, count, smokeCount, sparkCount) {
    const c = localToWorld(rec, 0, rec.height * 0.5, 0);
    for (let i = 0; i < smokeCount; i++) {
      smoke.emit(c.x + rnd(-0.3, 0.3) * tile, c.y + rnd(0, 0.3) * tile, c.z + rnd(-0.3, 0.3) * tile, rnd(-0.6, 0.6) * tile, rnd(0.6, 1.4) * tile, rnd(-0.6, 0.6) * tile, rnd(1.4, 2.4), SMOKE_HEX);
    }
    for (let i = 0; i < sparkCount; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(1.5, 4.5) * tile;
      sparks.emit(c.x, c.y, c.z, Math.cos(a) * v, rnd(1, 3) * tile, Math.sin(a) * v, rnd(0.4, 0.9), FURNACE_HEX);
    }
    void count;
  }

  function startCollapse(rec) {
    rec.collapse = { age: 0, tilt: rnd(-0.12, 0.12) };
    dying.push(rec);
    burst(rec, 0, 34, 26);
  }

  function disposeRecord(rec) {
    root.remove(rec.root);
    if (rec.parts.muzzle) rec.parts.muzzle.material.dispose();
  }

  // Events are handled once per tick, not once per render frame.
  function handleEvent(ev) {
    if (!ev) return;
    if (ev.e === "hit") {
      const rec = records.get(ev.id);
      if (rec) {
        const c = localToWorld(rec, rnd(-0.3, 0.3), rec.height * rnd(0.3, 0.8), rnd(-0.3, 0.3));
        for (let i = 0; i < 5; i++) {
          const a = rnd(0, Math.PI * 2);
          sparks.emit(c.x, c.y, c.z, Math.cos(a) * 1.2 * tile, rnd(0.6, 1.8) * tile, Math.sin(a) * 1.2 * tile, rnd(0.25, 0.5), FURNACE_HEX);
        }
      }
      const shooter = records.get(ev.by);
      if (shooter && shooter.kind === "turret") shooter.flash = 1;
    } else if (ev.e === "progress") {
      // Sparks are emitted in updateRecord while a site works; nothing extra here.
    } else if (ev.e === "done") {
      const rec = records.get(ev.id);
      if (rec) {
        rec.done = true;
        burst(rec, 0, 10, 0);
      }
    } else if (ev.e === "die") {
      const rec = records.get(ev.id);
      if (rec) {
        records.delete(ev.id);
        startCollapse(rec);
      }
    }
  }

  function updateRecord(rec, s, prevS, alpha, dt) {
    const complete = s.complete === true;
    const maxHp = hpOf(rec.kind);
    const hp = prevS ? prevS.hp + (s.hp - prevS.hp) * alpha : s.hp;
    const prog = prevS ? prevS.progress + (s.progress - prevS.progress) * alpha : s.progress;
    const f = complete ? 1 : buildFraction(prog, buildTicksOf(rec.kind));

    // Rise: the body climbs out of the ground as work goes on. Eased so the motion does not snap.
    rec.riseShown += (f - rec.riseShown) * (1 - Math.exp(-6 * dt));
    rec.parts.body.position.y = riseOffset(rec.riseShown, rec.height);

    // Scaffold: grows with progress, then sinks away after completion.
    rec.scaffoldK += ((complete ? 0 : 1) - rec.scaffoldK) * (1 - Math.exp(-5 * dt));
    rec.scaffold.visible = rec.scaffoldK > 0.01;
    rec.scaffold.scale.set(1, Math.max(0.001, scaffoldScale(f) * rec.scaffoldK), 1);
    rec.scaffold.scale.set(1, Math.max(0.001, scaffoldScale(f)), 1);
    rec.scaffold.scale.y = Math.max(0.001, scaffoldScale(f) * rec.scaffoldK);
    rec.scaffold.position.y = 0;

    // Construction sparks while a site is building.
    if (!complete) {
      rec.sparkAcc += dt * 6;
      while (rec.sparkAcc >= 1) {
        rec.sparkAcc -= 1;
        const c = localToWorld(rec, rnd(-0.4, 0.4), rec.height * (0.2 + 0.8 * f), rnd(-0.4, 0.4));
        sparks.emit(c.x, c.y, c.z, rnd(-0.5, 0.5) * tile, rnd(0.8, 2) * tile, rnd(-0.5, 0.5) * tile, rnd(0.3, 0.6), FURNACE_HEX);
      }
    }

    // Damage smoke, by stage. A finished Forge always breathes a little from its stack.
    const stage = complete ? damageStage(hp, maxHp) : 0;
    rec.stage = stage;
    const [smokePerSec, sparksPerSec] = smokeRate(stage);
    const extra = complete && rec.kind === "forge" ? 1.5 : 0;
    rec.smokeAcc += (smokePerSec + extra) * dt;
    const emitPoint = rec.kind === "forge" ? rec.parts.stackTop : null;
    while (rec.smokeAcc >= 1) {
      rec.smokeAcc -= 1;
      const c = emitPoint
        ? localToWorld(rec, emitPoint.x, emitPoint.y, emitPoint.z)
        : localToWorld(rec, rnd(-0.25, 0.25), rec.height * rnd(0.7, 1.0), rnd(-0.25, 0.25));
      smoke.emit(c.x, c.y, c.z, rnd(-0.1, 0.1) * tile, rnd(0.5, 0.9) * tile, rnd(-0.1, 0.1) * tile, rnd(1.6, 2.6), SMOKE_HEX);
    }
    rec.sparkAcc2 = (rec.sparkAcc2 || 0) + sparksPerSec * dt;
    while (rec.sparkAcc2 >= 1) {
      rec.sparkAcc2 -= 1;
      const c = localToWorld(rec, rnd(-0.25, 0.25), rec.height * rnd(0.3, 0.9), rnd(-0.25, 0.25));
      sparks.emit(c.x, c.y, c.z, rnd(-0.8, 0.8) * tile, rnd(1, 2.5) * tile, rnd(-0.8, 0.8) * tile, rnd(0.25, 0.5), FURNACE_HEX);
    }

    // Per-kind animation.
    const parts = rec.parts;
    for (const sp of parts.spin) sp.obj.rotation.y += sp.speed * dt;
    for (const pu of parts.pulse) {
      const k = pu.base + pu.amp * Math.sin(clock * pu.speed + rec.id);
      pu.obj.scale.set(k, 1, k);
    }
    if (parts.furnace) parts.furnace.scale.y = 1 + 0.12 * Math.sin(clock * 9 + rec.id) * (stage >= 2 ? 1.6 : 0.6);
    if (parts.crown) parts.crown.position.y = 1.02 + 0.05 * Math.sin(clock * 1.7 + rec.id);

    if (rec.kind === "turret" && parts.head) {
      updateTurret(rec, s, complete, dt);
    }
  }

  // Turret aim: pick the nearest enemy in range (spec §7), turn the head toward it, flash on each shot.
  function updateTurret(rec, s, complete, dt) {
    const parts = rec.parts;
    const range = (STATS.structures.turret || {}).range || 5;
    let desired;
    rec.target = null;
    if (complete) {
      const candidates = [];
      for (const u of rec.nextUnits || []) candidates.push({ id: u.id, owner: u.owner, x: u.x, y: u.y, hp: u.hp });
      for (const o of rec.nextStructures || []) candidates.push({ id: o.id, owner: o.owner, x: o.x, y: o.y, hp: o.hp });
      const t = pickTurretTarget(s, candidates, range);
      rec.target = t;
    }
    if (rec.target) {
      const a = ctx.gridToWorld(s.x, s.y);
      const b = ctx.gridToWorld(rec.target.x, rec.target.y);
      desired = Math.atan2(-(b.z - a.z), b.x - a.x);
    } else {
      desired = scanAngle(clock, rec.id * 0.7);
    }
    rec.heading = turnToward(rec.heading, desired, 7, dt);
    parts.head.rotation.y = rec.heading;
    rec.flash = Math.max(0, rec.flash - dt * 6);
    parts.muzzle.material.opacity = rec.flash;
    parts.muzzle.scale.setScalar(0.2 + 0.15 * rec.flash);
    for (const b of parts.barrels) b.position.x = 0.3 - 0.04 * rec.flash;
  }

  function update(frame, dt) {
    if (!frame || !frame.next) return;
    clock += dt;
    const next = frame.next;
    const prev = frame.prev || null;
    const alpha = typeof frame.alpha === "number" ? frame.alpha : 1;
    const structures = next.structures || [];
    const prevById = new Map();
    if (prev && prev.structures) for (const s of prev.structures) prevById.set(s.id, s);

    if (frame.tick !== lastTick) {
      lastTick = frame.tick;
      for (const ev of frame.events || []) handleEvent(ev);
    }

    // Sync: create records for new structures, start collapses for ones that vanished.
    const seen = new Set();
    for (const s of structures) {
      seen.add(s.id);
      let rec = records.get(s.id);
      if (!rec) {
        rec = makeRecord(s);
        records.set(s.id, rec);
      }
      rec.nextUnits = next.units || [];
      rec.nextStructures = structures;
      updateRecord(rec, s, prevById.get(s.id), alpha, dt);
    }
    for (const [id, rec] of [...records]) {
      if (!seen.has(id)) {
        records.delete(id);
        startCollapse(rec);
      }
    }

    // Collapsing buildings sink, tilt and smoke out, then they are removed.
    for (let i = dying.length - 1; i >= 0; i--) {
      const rec = dying[i];
      rec.collapse.age += dt;
      const t = collapseProgress(rec.collapse.age);
      rec.root.scale.set(tile * (1 + 0.05 * t), tile * (1 - 0.85 * t), tile * (1 + 0.05 * t));
      rec.root.rotation.z = rec.collapse.tilt * smooth(t);
      if (t < 1 && Math.random() < dt * 4) {
        const c = localToWorld(rec, 0, rec.height * 0.5, 0);
        smoke.emit(c.x, c.y, c.z, rnd(-0.4, 0.4) * tile, rnd(0.5, 1.2) * tile, rnd(-0.4, 0.4) * tile, rnd(1.4, 2.2), SMOKE_HEX);
      }
      if (t >= 1) {
        disposeRecord(rec);
        dying.splice(i, 1);
      }
    }

    smoke.update(dt);
    sparks.update(dt);
  }

  function dispose() {
    for (const rec of records.values()) disposeRecord(rec);
    for (const rec of dying) disposeRecord(rec);
    records.clear();
    dying.length = 0;
    for (const g of geos.values()) g.dispose();
    for (const m of mats.values()) m.dispose();
    geos.clear();
    mats.clear();
    if (smokeTex) smokeTex.dispose();
    smoke.dispose();
    sparks.dispose();
    ctx.scene.remove(root);
  }

  return { update, dispose };
}
