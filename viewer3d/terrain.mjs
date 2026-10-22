// viewer3d/terrain.mjs — alien plateau: ground, rock cliffs, Shard crystals, dusk sky, fog.
// Contract: createTerrain(ctx) -> { update(frame, dt), dispose() }  (see VISUAL-3D.md).
// Reads ctx.THREE, ctx.scene, ctx.gridToWorld(x, y), ctx.tileSize and optional ctx.palette.terrain overrides.
// The map is built on the first frame (and rebuilt if a different map is scrubbed in).
// Pure layout helpers are exported so node tests can check them without a renderer.

// ---------- pure helpers (no THREE) ----------

export function hash2(x, y, salt = 0) {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

export function valueNoise(x, y, salt = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(x0, y0, salt), b = hash2(x0 + 1, y0, salt);
  const c = hash2(x0, y0 + 1, salt), d = hash2(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

// Tile brightness 0..1 with large patches plus per-tile grain.
export function tileShade(x, y, seed = 0) {
  const big = valueNoise(x / 5, y / 5, seed) * 0.6 + valueNoise(x / 2, y / 2, seed + 1) * 0.3;
  return Math.min(1, Math.max(0, big + hash2(x, y, seed + 2) * 0.1));
}

// Fraction of a crystal tile that is still full: 0..1.
export function crystalFraction(amount, max) {
  if (!(max > 0)) return amount > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, amount / max));
}

export const SHARDS_PER_TILE = 5;

// How big shard k of n is for a tile fraction f. Shards drop out one by one, the rest shrink.
export function shardScale(f, k, n = SHARDS_PER_TILE) {
  if (f <= 0) return 0;
  const gone = (k / n) * 0.7; // the last shard to go is k = 0
  if (f <= gone) return 0;
  const rise = Math.min(1, (f - gone) / 0.3);
  return 0.3 + 0.7 * smooth(rise) * (0.55 + 0.45 * f);
}

// Rocks: each gets a height from its rock neighbours so clusters read as one massif.
export function rockLayout(rocks, seed = 0) {
  const set = new Set(rocks.map(([x, y]) => x + ',' + y));
  return rocks.map(([x, y]) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && set.has((x + dx) + ',' + (y + dy))) n++;
    }
    const r = (s) => hash2(x, y, seed + s);
    return {
      x, y, neighbours: n,
      height: 1.1 + n * 0.22 + r(1) * 0.9,   // in tiles
      radius: 0.5 + r(2) * 0.12,
      spin: r(3) * Math.PI * 2,
      lean: [(r(4) - 0.5) * 0.12, (r(5) - 0.5) * 0.12],
      tone: r(6),
      boulders: [0, 1].map((i) => ({
        dx: (r(10 + i) - 0.5) * 0.9, dy: (r(12 + i) - 0.5) * 0.9,
        size: 0.18 + r(14 + i) * 0.2, spin: r(16 + i) * 6.28,
      })),
    };
  });
}

// Shards: fixed cluster of SHARDS_PER_TILE spikes per crystal tile.
export function crystalLayout(crystals, seed = 0, richKeys = new Set()) {
  return crystals.map(({ x, y, rich }) => {
    const spikes = [];
    for (let k = 0; k < SHARDS_PER_TILE; k++) {
      const r = (s) => hash2(x * 7 + k, y * 13 + k, seed + s);
      // k = 0 is the tall centre spike, the rest ring it.
      const ang = r(1) * Math.PI * 2 + k * 1.26;
      const rad = k === 0 ? 0.04 : 0.16 + r(2) * 0.18;
      spikes.push({
        dx: Math.cos(ang) * rad, dy: Math.sin(ang) * rad,
        height: (k === 0 ? 1.15 : 0.6 + r(3) * 0.4),
        width: (k === 0 ? 0.2 : 0.11 + r(4) * 0.06),
        tiltX: (r(5) - 0.5) * (k === 0 ? 0.1 : 0.5),
        tiltZ: (r(6) - 0.5) * (k === 0 ? 0.1 : 0.5),
        spin: r(7) * 6.28,
      });
    }
    // Rich fields get one extra, taller spike.
    if (rich || richKeys.has(x + "," + y)) {
      spikes.push({ dx: 0.12, dy: -0.1, height: 1.7, width: 0.17, tiltX: 0.06, tiltZ: -0.05, spin: hash2(x, y, seed + 55) * 6.28 });
    }
    return { x, y, phase: hash2(x, y, seed + 99) * Math.PI * 2, spikes };
  });
}

// Pulse 0..1, slow breathing with a faster shimmer, offset by phase.
export function pulse(time, phase = 0) {
  return 0.5 + 0.35 * Math.sin(time * 1.6 + phase) + 0.15 * Math.sin(time * 4.1 + phase * 2.3);
}

// ----- v3 tile grid (heights 0..2, ramp, cliff, vent, rubble, rich-shard) -----
// Accepted input on a state (first match wins):  state.tiles  or  state.map.tiles
//   either rows [y][x] or a flat array of length width*height; each entry is a type string
//   ('floor','ramp','cliff','rock','vent','shard','rich-shard','rubble') or { type, h } (also 'height').
// Optional parallel heights:  state.heights  (rows or flat, numbers).
// Old maps with none of these are all-floor at height 0; rocks and crystals still come from
// state.rocks / state.crystals (a crystal with .rich === true, or a 'rich-shard' tile, gets the extra spike).
export const TILE_TYPES = ['floor', 'ramp', 'cliff', 'rock', 'vent', 'shard', 'rich-shard', 'rubble'];
export const ELEV_STEP = 0.75; // world height of one level, in tiles

const pick = (grid, x, y, W) => {
  if (!grid) return undefined;
  if (Array.isArray(grid[0])) return grid[y] && grid[y][x];
  return grid[y * W + x];
};

export function normType(t) {
  const s = String(t || 'floor').toLowerCase().replace(/[_\s]/g, '-');
  if (s === 'richshard') return 'rich-shard';
  return TILE_TYPES.includes(s) ? s : 'floor';
}

// -> flat array of { type, h } for every tile (row-major, y*W + x).
export function readTiles(state) {
  const W = state.width, H = state.height;
  const tiles = state.tiles || (state.map && state.map.tiles);
  const out = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = pick(tiles, x, y, W);
    let type = 'floor', h;
    if (typeof e === 'string') type = normType(e);
    else if (e && typeof e === 'object') { type = normType(e.type || e.kind); h = e.h ?? e.height; }
    const hh = pick(state.heights, x, y, W);
    if (hh !== undefined) h = hh;
    out[y * W + x] = { type, h: Math.max(0, Math.round(h || 0)) };
  }
  return out;
}

// Cheap string that changes when any tile type/height changes (e.g. rubble destroyed).
export function tilesSignature(state) {
  if (!state.tiles && !(state.map && state.map.tiles) && !state.heights) return '-';
  return readTiles(state).map((t) => TILE_TYPES.indexOf(t.type) + '' + t.h).join('');
}

// Which way a ramp climbs: unit vector toward its higher neighbour plus the two heights.
export function rampInfo(tiles, W, H, x, y) {
  const me = tiles[y * W + x];
  let best = null;
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const t = tiles[ny * W + nx];
    if (t.type === 'ramp' || t.type === 'cliff') continue;
    if (!best || t.h > best.h) best = { dx, dy, h: t.h };
  }
  const high = best ? Math.max(best.h, me.h) : me.h + 1;
  return { dx: best ? best.dx : 1, dy: best ? best.dy : 0, low: Math.max(0, high - 1), high };
}

// World surface height of a tile (ramps give their midpoint).
export function surfaceHeight(tiles, W, H, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return 0;
  const t = tiles[y * W + x];
  if (t.type === 'ramp') { const r = rampInfo(tiles, W, H, x, y); return (r.low + r.high) / 2 * ELEV_STEP; }
  return t.h * ELEV_STEP;
}

// ---------- THREE scene ----------

const DEFAULTS = {
  ground: 0x3a3548, groundHi: 0x5a5068, seam: 0x15121d,
  rock: 0x6b6478, rockDark: 0x3d3848,
  crystal: 0x35e8d0, crystalCore: 0xb8fff4, crystalDead: 0x23303a,
  crack: 0x7a5cff,
  cliff: 0x2a2436, cliffLip: 0x8a7aa8, ramp: 0x6a5f80, rampMark: 0xd8c8a0,
  vent: 0xff7a30, ventFloor: 0x2a1a1a, rubble: 0x5a5260,
  skyTop: 0x120a2a, skyMid: 0x5a2a66, skyHorizon: 0xff8a5a,
  fog: 0x4a2a52,
  hemiSky: 0x8a78c8, hemiGround: 0x2a2030,
};

export function createTerrain(ctx) {
  const THREE = ctx.THREE;
  const scene = ctx.scene;
  const ts = ctx.tileSize || 1;
  const P = { ...DEFAULTS, ...(ctx.palette && ctx.palette.terrain) };
  const col = (hex) => new THREE.Color(hex);

  const root = new THREE.Group();
  root.name = 'terrain';
  scene.add(root);

  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const dummy = new THREE.Object3D();

  // ----- placement helpers -----
  const toWorldRaw = (x, y) => {
    if (ctx.gridToWorld) { const v = ctx.gridToWorld(x, y); return { x: v.x, z: v.z, y: v.y || 0 }; }
    return { x: x * ts, z: y * ts, y: 0 };
  };
  // Tile surface height (level * ELEV_STEP * ts) for the map currently built; units/buildings can ask heightAt.
  let curTiles = null, curW = 0, curH = 0;
  const heightAt = (x, y) => {
    if (!curTiles) return 0;
    return surfaceHeight(curTiles, curW, curH, Math.round(x), Math.round(y)) * ts;
  };
  const toWorld = (x, y) => { const w = toWorldRaw(x, y); w.y += heightAt(x, y); return w; };
  let ventSteam = null, ventRimMat = null;

  // ----- sky + fog (built once; independent of the map) -----
  const skyUniforms = {
    top: { value: col(P.skyTop) }, mid: { value: col(P.skyMid) }, horizon: { value: col(P.skyHorizon) },
  };
  const sky = new THREE.Mesh(
    track(new THREE.SphereGeometry(900 * ts, 32, 16)),
    track(new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.1, 1.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
          c = mix(c, top, smoothstep(0.18, 0.75, h));
          gl_FragColor = vec4(c, 1.0); }`,
    }))
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  root.add(sky);

  // Stars: fixed points on the upper dome.
  {
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 1, 5) * Math.PI * 2, e = 0.12 + hash2(i, 2, 5) * 1.3;
      const r = 850 * ts;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, track(new THREE.PointsMaterial({
      color: 0xdfe6ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false, depthWrite: false,
    })));
    stars.frustumCulled = false;
    root.add(stars);
  }

  // A huge pale moon low on the dusk horizon.
  {
    const moon = new THREE.Mesh(
      track(new THREE.SphereGeometry(70 * ts, 24, 16)),
      track(new THREE.MeshBasicMaterial({ color: 0xffd9c0, fog: false }))
    );
    moon.position.set(-420 * ts, 190 * ts, -640 * ts);
    root.add(moon);
    const halo = new THREE.Mesh(
      track(new THREE.SphereGeometry(110 * ts, 24, 16)),
      track(new THREE.MeshBasicMaterial({ color: 0xff9a70, transparent: true, opacity: 0.18, fog: false, depthWrite: false }))
    );
    halo.position.copy(moon.position);
    root.add(halo);
  }

  const prevFog = scene.fog;
  const prevBg = scene.background;
  scene.background = col(P.fog);
  scene.fog = new THREE.Fog(col(P.fog), 48 * ts, 150 * ts);

  // Fallback light only if the engine added none.
  let fallbackLight = null;
  let hasLight = false;
  scene.traverse((o) => { if (o.isLight) hasLight = true; });
  if (!hasLight) {
    fallbackLight = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, 1.1);
    root.add(fallbackLight);
  }

  // ----- dust motes -----
  const DUST = 140;
  const dustBase = new Float32Array(DUST * 3);
  const dustPos = new Float32Array(DUST * 3);
  const dustGeo = track(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, track(new THREE.PointsMaterial({
    color: 0xffc9a0, size: 0.07 * ts * 10, sizeAttenuation: true, transparent: true, opacity: 0.35, depthWrite: false,
  })));
  dust.frustumCulled = false;
  root.add(dust);

  // ----- map-dependent group -----
  let mapGroup = null;
  let mapKey = '';
  const mapKeyOf = (st) => `${st.seed | 0}:${st.width}:${st.height}:${st.rocks.length}:${st.crystals.length}:${tilesSignature(st)}`;
  let mapDisposables = [];
  let crystalState = null;   // { layout, meshes, max[], last[] }
  let glowMat = null;
  let time = 0;

  const dropMap = () => {
    if (mapGroup) root.remove(mapGroup);
    for (const d of mapDisposables) d.dispose && d.dispose();
    mapDisposables = [];
    mapGroup = null;
    crystalState = null;
  };
  const mtrack = (o) => { mapDisposables.push(o); return o; };

  function buildMap(state) {
    dropMap();
    const W = state.width, H = state.height;
    mapGroup = new THREE.Group();
    root.add(mapGroup);
    const seed = (state.seed | 0) || 0;

    curTiles = readTiles(state); curW = W; curH = H;
    const tileAt = (x, y) => curTiles[y * W + x];
    const c00 = toWorldRaw(0, 0), c11 = toWorldRaw(W - 1, H - 1);
    const cx = (c00.x + c11.x) / 2, cz = (c00.z + c11.z) / 2;
    const baseY = c00.y;
    const spanX = Math.abs(c11.x - c00.x) + ts, spanZ = Math.abs(c11.z - c00.z) + ts;

    // Ground tiles: slightly inset boxes over a dark slab so seams show.
    const slabDepth = 14 * ts;
    {
      const slab = new THREE.Mesh(
        mtrack(new THREE.BoxGeometry(spanX + 0.2 * ts, slabDepth, spanZ + 0.2 * ts)),
        mtrack(new THREE.MeshStandardMaterial({ color: P.seam, roughness: 1 }))
      );
      slab.position.set(cx, baseY - slabDepth / 2 - 0.12 * ts, cz);
      slab.receiveShadow = true;
      mapGroup.add(slab);

      // Strata bands on the cliff walls: slightly wider thin plates in alternating tones.
      for (let i = 0; i < 6; i++) {
        const inflate = (i % 2 ? 0.0 : 0.22) * ts + 0.2 * ts;
        const th = (0.8 + hash2(i, 3, seed) * 1.4) * ts;
        const band = new THREE.Mesh(
          mtrack(new THREE.BoxGeometry(spanX + inflate, th, spanZ + inflate)),
          mtrack(new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2b2636 : 0x4a4058, roughness: 1, flatShading: true }))
        );
        band.position.set(cx, baseY - (1.0 + i * 1.7) * ts, cz);
        band.receiveShadow = true;
        mapGroup.add(band);
      }
    }

    // Ground: top-aligned boxes (top at y=0, scaled down to the slab) so raised levels show their sides.
    const tileGeo = mtrack(new THREE.BoxGeometry(ts * 0.97, 1, ts * 0.97));
    tileGeo.translate(0, -0.5, 0);
    const tileMat = mtrack(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.05 }));
    const tiles = new THREE.InstancedMesh(tileGeo, tileMat, W * H);
    tiles.receiveShadow = true; tiles.castShadow = true;
    const lips = [];   // cliff lips: [x, z, y]
    const ramps = [];  // { x, y, info }
    const vents = [], rubbles = [];
    {
      const lo = col(P.ground), hi = col(P.groundHi), cliffC = col(P.cliff), ventC = col(P.ventFloor), c = new THREE.Color();
      let i = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const t = tileAt(x, y);
        const w = toWorldRaw(x, y);
        const drop = hash2(x, y, seed + 7) < 0.12 ? 0.025 * ts : 0; // a few sunken plates
        let top = t.h * ELEV_STEP * ts - drop;
        c.copy(lo).lerp(hi, tileShade(x, y, seed));
        c.offsetHSL((valueNoise(x / 9, y / 9, seed + 3) - 0.5) * 0.03, 0, 0.02 * t.h); // high ground a touch lighter
        if (t.type === 'cliff') {
          top += (0.55 + hash2(x, y, seed + 31) * 0.45) * ts;
          c.copy(cliffC).offsetHSL(0, 0, (hash2(x, y, seed + 32) - 0.5) * 0.05);
          lips.push([w.x, w.z, w.y + top]);
        } else if (t.type === 'ramp') {
          const ri = rampInfo(curTiles, W, H, x, y);
          ramps.push({ x, y, info: ri });
          top = ri.low * ELEV_STEP * ts - 0.01 * ts; // base under the wedge so no gap shows
        } else if (t.type === 'vent') {
          c.lerp(ventC, 0.55);
          vents.push([x, y]);
        } else if (t.type === 'rubble') {
          rubbles.push([x, y]);
        }
        dummy.position.set(w.x, w.y + top, w.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, Math.max(0.05 * ts, top + 0.3 * ts), 1);
        dummy.updateMatrix();
        tiles.setMatrixAt(i, dummy.matrix);
        tiles.setColorAt(i, c);
        i++;
      }
      tiles.instanceMatrix.needsUpdate = true;
      tiles.instanceColor.needsUpdate = true;
    }
    mapGroup.add(tiles);

    // Cliff lips: a bright thin cap so edges read at a glance.
    if (lips.length) {
      const lipGeo = mtrack(new THREE.BoxGeometry(ts * 0.99, 0.05 * ts, ts * 0.99));
      const lipMat = mtrack(new THREE.MeshStandardMaterial({ color: P.cliffLip, emissive: P.cliffLip, emissiveIntensity: 0.25, roughness: 0.7 }));
      const lm = new THREE.InstancedMesh(lipGeo, lipMat, lips.length);
      lips.forEach(([x, z, y], i) => {
        dummy.position.set(x, y + 0.02 * ts, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); lm.setMatrixAt(i, dummy.matrix);
      });
      mapGroup.add(lm);
    }

    // Ramps: wedges rising toward the high neighbour, with chevron bars.
    if (ramps.length) {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const isTop = pos.getY(i) > 0;
        pos.setY(i, isTop ? (pos.getX(i) > 0 ? 1 : 0) : -1); // profile climbs along local +x
      }
      g.computeVertexNormals();
      mtrack(g);
      const rm = new THREE.InstancedMesh(g, mtrack(new THREE.MeshStandardMaterial({ color: P.ramp, roughness: 0.8, flatShading: true })), ramps.length);
      rm.receiveShadow = true; rm.castShadow = true;
      const barGeo = mtrack(new THREE.BoxGeometry(ts * 0.08, ts * 0.025, ts * 0.7));
      const bm = new THREE.InstancedMesh(barGeo, mtrack(new THREE.MeshStandardMaterial({ color: P.rampMark, emissive: P.rampMark, emissiveIntensity: 0.35 })), ramps.length * 3);
      let bi = 0;
      ramps.forEach(({ x, y, info }, i) => {
        const w = toWorldRaw(x, y);
        const rise = (info.high - info.low) * ELEV_STEP * ts;
        const baseY = w.y + info.low * ELEV_STEP * ts;
        const ang = Math.atan2(-info.dy, info.dx); // rotateY(a) sends local +x to world (cos a, 0, -sin a)
        dummy.position.set(w.x, baseY, w.z);
        dummy.rotation.set(0, ang, 0);
        dummy.scale.set(ts * 0.97, rise, ts * 0.97);
        dummy.updateMatrix();
        rm.setMatrixAt(i, dummy.matrix);
        for (let k = 0; k < 3; k++) {
          const u = (k - 1) * 0.28; // along the slope
          dummy.position.set(w.x + Math.cos(ang) * u * ts, baseY + (u + 0.5) * rise + 0.02 * ts, w.z - Math.sin(ang) * u * ts);
          dummy.rotation.set(0, ang, Math.atan2(rise, ts * 0.97), 'YXZ');
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          bm.setMatrixAt(bi++, dummy.matrix);
        }
      });
      mapGroup.add(rm, bm);
    }

    // Vents: a dark hole, a warm glowing rim, and rising steam.
    ventSteam = null; ventRimMat = null;
    if (vents.length) {
      const holeGeo = mtrack(new THREE.CircleGeometry(ts * 0.34, 20)); holeGeo.rotateX(-Math.PI / 2);
      const rimGeo = mtrack(new THREE.RingGeometry(ts * 0.34, ts * 0.46, 20)); rimGeo.rotateX(-Math.PI / 2);
      const hm = new THREE.InstancedMesh(holeGeo, mtrack(new THREE.MeshBasicMaterial({ color: 0x07040a })), vents.length);
      ventRimMat = mtrack(new THREE.MeshBasicMaterial({ color: P.vent, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      const rm2 = new THREE.InstancedMesh(rimGeo, ventRimMat, vents.length);
      const STEAM = 7;
      const sp = new Float32Array(vents.length * STEAM * 3);
      vents.forEach(([x, y], i) => {
        const w = toWorld(x, y);
        dummy.position.set(w.x, w.y + 0.015 * ts, w.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        hm.setMatrixAt(i, dummy.matrix); rm2.setMatrixAt(i, dummy.matrix);
      });
      mapGroup.add(hm, rm2);
      const sg = mtrack(new THREE.BufferGeometry());
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      const pts = new THREE.Points(sg, mtrack(new THREE.PointsMaterial({
        color: P.vent, size: 0.35 * ts, sizeAttenuation: true, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending,
      })));
      pts.frustumCulled = false;
      mapGroup.add(pts);
      ventSteam = { pos: sp, geo: sg, at: vents.map(([x, y]) => toWorld(x, y)), n: STEAM };
    }

    // Rubble: loose chunks, destructible obstacle.
    if (rubbles.length) {
      const geo = mtrack(new THREE.DodecahedronGeometry(ts * 0.2, 0));
      const mat = mtrack(new THREE.MeshStandardMaterial({ color: P.rubble, roughness: 1, flatShading: true }));
      const rm = new THREE.InstancedMesh(geo, mat, rubbles.length * 6);
      rm.castShadow = true; rm.receiveShadow = true;
      let n = 0;
      rubbles.forEach(([x, y]) => {
        const w = toWorld(x, y);
        for (let k = 0; k < 6; k++) {
          const r = (s) => hash2(x * 5 + k, y * 3 + k, seed + s);
          const sc = 0.6 + r(1) * (k < 2 ? 1.1 : 0.7);
          dummy.position.set(w.x + (r(2) - 0.5) * 0.7 * ts, w.y + 0.08 * ts * sc + (k > 3 ? 0.14 * ts : 0), w.z + (r(3) - 0.5) * 0.7 * ts);
          dummy.rotation.set(r(4) * 6, r(5) * 6, r(6) * 6);
          dummy.scale.set(sc, sc * 0.7, sc);
          dummy.updateMatrix();
          rm.setMatrixAt(n++, dummy.matrix);
        }
      });
      mapGroup.add(rm);
    }

    // Glow cracks: thin additive strips, a few per ~10 tiles, slow pulse.
    {
      const crackGeo = mtrack(new THREE.PlaneGeometry(ts * 0.9, ts * 0.045));
      crackGeo.rotateX(-Math.PI / 2);
      glowMat = mtrack(new THREE.MeshBasicMaterial({
        color: P.crack, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
      }));
      const spots = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (tileAt(x, y).type === "floor" && hash2(x, y, seed + 21) < 0.085) spots.push([x, y]);
      }
      const cracks = new THREE.InstancedMesh(crackGeo, glowMat, Math.max(1, spots.length * 2));
      let n = 0;
      for (const [x, y] of spots) {
        const w = toWorld(x, y);
        for (let k = 0; k < 2; k++) {
          dummy.position.set(
            w.x + (hash2(x, y, 30 + k) - 0.5) * 0.4 * ts, w.y + 0.004 * ts, w.z + (hash2(x, y, 40 + k) - 0.5) * 0.4 * ts);
          dummy.rotation.set(0, hash2(x, y, 50 + k) * Math.PI, 0);
          dummy.scale.set(0.4 + hash2(x, y, 60 + k) * 0.9, 1, 1);
          dummy.updateMatrix();
          cracks.setMatrixAt(n++, dummy.matrix);
        }
      }
      cracks.count = n;
      cracks.instanceMatrix.needsUpdate = true;
      mapGroup.add(cracks);
    }

    // Drift streaks: long faint strokes along the wind, pale on dark.
    {
      const streakGeo = mtrack(new THREE.PlaneGeometry(ts * 3.2, ts * 0.12));
      streakGeo.rotateX(-Math.PI / 2);
      const streakMat = mtrack(new THREE.MeshBasicMaterial({
        color: 0xb8a8d8, transparent: true, opacity: 0.07, depthWrite: false,
      }));
      const count = Math.round(W * H / 14);
      const streaks = new THREE.InstancedMesh(streakGeo, streakMat, count);
      for (let i = 0; i < count; i++) {
        dummy.position.set(
          c00.x + hash2(i, 1, seed + 70) * (spanX - ts), baseY + 0.006 * ts, c00.z + hash2(i, 2, seed + 70) * (spanZ - ts));
        dummy.rotation.set(0, -0.35 + (hash2(i, 3, seed + 70) - 0.5) * 0.2, 0);
        dummy.scale.set(0.5 + hash2(i, 4, seed + 70), 1, 0.6 + hash2(i, 5, seed + 70));
        dummy.updateMatrix();
        streaks.setMatrixAt(i, dummy.matrix);
      }
      mapGroup.add(streaks);
    }

    // Pebbles on open ground.
    {
      const rockSet = new Set(state.rocks.map(([x, y]) => x + ',' + y));
      const crySet = new Set(state.crystals.map((c) => c.x + ',' + c.y));
      const spots = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = x + ',' + y;
        if (rockSet.has(k) || crySet.has(k) || ["cliff", "ramp", "vent", "rubble"].includes(tileAt(x, y).type)) continue;
        if (hash2(x, y, seed + 80) < 0.3) spots.push([x, y]);
      }
      const geo = mtrack(new THREE.DodecahedronGeometry(ts * 0.07, 0));
      const mat = mtrack(new THREE.MeshStandardMaterial({ color: 0x6a6178, roughness: 1, flatShading: true }));
      const peb = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
      spots.forEach(([x, y], i) => {
        const w = toWorld(x, y);
        dummy.position.set(w.x + (hash2(x, y, 81) - 0.5) * 0.8 * ts, w.y + 0.01 * ts, w.z + (hash2(x, y, 82) - 0.5) * 0.8 * ts);
        dummy.rotation.set(hash2(x, y, 83) * 6, hash2(x, y, 84) * 6, 0);
        const s = 0.5 + hash2(x, y, 85) * 1.1;
        dummy.scale.set(s, s * 0.6, s);
        dummy.updateMatrix();
        peb.setMatrixAt(i, dummy.matrix);
      });
      peb.count = spots.length;
      peb.castShadow = true;
      peb.receiveShadow = true;
      mapGroup.add(peb);
    }

    // Rocks: chunky cliffs.
    {
      const layout = rockLayout(state.rocks, seed);
      const pillarGeo = mtrack(new THREE.CylinderGeometry(0.62, 0.9, 1, 6, 1));
      pillarGeo.translate(0, 0.5, 0);
      const capGeo = mtrack(new THREE.DodecahedronGeometry(0.7, 0));
      const mat = mtrack(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.02, flatShading: true }));
      const pillars = new THREE.InstancedMesh(pillarGeo, mat, Math.max(1, layout.length));
      const caps = new THREE.InstancedMesh(capGeo, mat, Math.max(1, layout.length));
      const boulders = new THREE.InstancedMesh(capGeo, mat, Math.max(1, layout.length * 2));
      const lo = col(P.rockDark), hi = col(P.rock), c = new THREE.Color();
      let bi = 0;
      layout.forEach((r, i) => {
        const w = toWorld(r.x, r.y);
        const h = r.height * ts, rad = r.radius * ts * 2;
        dummy.position.set(w.x, w.y, w.z);
        dummy.rotation.set(r.lean[0], r.spin, r.lean[1]);
        dummy.scale.set(rad, h, rad);
        dummy.updateMatrix();
        pillars.setMatrixAt(i, dummy.matrix);
        c.copy(lo).lerp(hi, 0.35 + r.tone * 0.5);
        pillars.setColorAt(i, c);

        dummy.position.set(w.x, w.y + h * 0.98, w.z);
        dummy.rotation.set(r.lean[0] * 2, r.spin * 1.7, r.lean[1] * 2);
        dummy.scale.set(rad * 0.62, rad * 0.34, rad * 0.62);
        dummy.updateMatrix();
        caps.setMatrixAt(i, dummy.matrix);
        c.lerp(hi, 0.35);
        caps.setColorAt(i, c);

        for (const b of r.boulders) {
          const s = b.size * ts;
          dummy.position.set(w.x + b.dx * ts, w.y + s * 0.35, w.z + b.dy * ts);
          dummy.rotation.set(b.spin, b.spin * 1.3, 0);
          dummy.scale.set(s, s * 0.75, s);
          dummy.updateMatrix();
          boulders.setMatrixAt(bi, dummy.matrix);
          c.copy(lo).lerp(hi, 0.2 + r.tone * 0.4);
          boulders.setColorAt(bi, c);
          bi++;
        }
      });
      pillars.count = caps.count = layout.length;
      boulders.count = bi;
      for (const m of [pillars, caps, boulders]) {
        m.castShadow = true; m.receiveShadow = true;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        mapGroup.add(m);
      }
    }

    // Shard crystals.
    {
      const richKeys = new Set();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tileAt(x, y).type === "rich-shard") richKeys.add(x + "," + y);
      const layout = crystalLayout(state.crystals, seed, richKeys);
      const spikeGeo = mtrack(new THREE.ConeGeometry(1, 1, 5, 1));
      spikeGeo.translate(0, 0.5, 0);
      // 3 pulse buckets so the field shimmers instead of blinking in unison, plus a dead bucket.
      const buckets = [0, 1, 2].map((b) => {
        const m = mtrack(new THREE.MeshStandardMaterial({
          color: P.crystal, emissive: P.crystal, emissiveIntensity: 1.2, roughness: 0.25, metalness: 0.1, flatShading: true,
        }));
        const im = new THREE.InstancedMesh(spikeGeo, m, Math.max(1, layout.length * (SHARDS_PER_TILE + 1)));
        im.castShadow = true;
        im.count = 0;
        mapGroup.add(im);
        return { mesh: im, mat: m, n: 0 };
      });
      const deadMat = mtrack(new THREE.MeshStandardMaterial({ color: P.crystalDead, roughness: 0.9, flatShading: true }));
      const dead = new THREE.InstancedMesh(spikeGeo, deadMat, Math.max(1, layout.length));
      dead.castShadow = true; dead.receiveShadow = true; dead.count = 0;
      mapGroup.add(dead);

      // Glowing floor pad under each field tile.
      const padGeo = mtrack(new THREE.CircleGeometry(ts * 0.62, 24));
      padGeo.rotateX(-Math.PI / 2);
      const padMat = mtrack(new THREE.MeshBasicMaterial({
        color: P.crystal, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const pads = new THREE.InstancedMesh(padGeo, padMat, Math.max(1, layout.length));
      layout.forEach((cl, i) => {
        const w = toWorld(cl.x, cl.y);
        dummy.position.set(w.x, w.y + 0.012 * ts, w.z);
        dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        pads.setMatrixAt(i, dummy.matrix);
      });
      pads.count = layout.length;
      mapGroup.add(pads);

      crystalState = {
        layout, buckets, dead, deadMat, padMat,
        max: state.crystals.map((c) => Math.max(1, c.amount)),
        lastKey: '',
      };
    }

    // Distant mesas ringing the plateau (silhouettes in the fog) and fallen boulders on the rim.
    {
      const geo = mtrack(new THREE.CylinderGeometry(0.6, 1, 1, 7, 1));
      geo.translate(0, 0.5, 0);
      const mat = mtrack(new THREE.MeshStandardMaterial({ color: 0x3a2f4a, roughness: 1, flatShading: true }));
      const n = 34;
      const mesas = new THREE.InstancedMesh(geo, mat, n);
      const R = Math.max(spanX, spanZ);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + hash2(i, 1, seed + 90) * 0.3;
        const dist = R * (1.25 + hash2(i, 2, seed + 90) * 1.6);
        const h = R * (0.1 + hash2(i, 3, seed + 90) * 0.35);
        const wdt = R * (0.07 + hash2(i, 4, seed + 90) * 0.12);
        dummy.position.set(cx + Math.cos(a) * dist, baseY - 3 * ts - R * 0.1, cz + Math.sin(a) * dist);
        dummy.rotation.set(0, hash2(i, 5, seed + 90) * 3, 0);
        dummy.scale.set(wdt, h + R * 0.1, wdt);
        dummy.updateMatrix();
        mesas.setMatrixAt(i, dummy.matrix);
      }
      mesas.instanceMatrix.needsUpdate = true;
      mapGroup.add(mesas);
    }

    // Dust motes spread over the plateau.
    for (let i = 0; i < DUST; i++) {
      dustBase[i * 3] = c00.x + hash2(i, 1, seed + 95) * spanX;
      dustBase[i * 3 + 1] = baseY + (0.2 + hash2(i, 2, seed + 95) * 2.2) * ts;
      dustBase[i * 3 + 2] = c00.z + hash2(i, 3, seed + 95) * spanZ;
    }
    mapKey = mapKeyOf(state);
  }

  // Crystals change with frame time: scale spikes from the tile amount (blended between ticks).
  function updateCrystals(frame) {
    const cs = crystalState;
    if (!cs) return;
    const a = frame.prev || frame.next, b = frame.next || frame.prev;
    const alpha = frame.alpha || 0;
    const amounts = cs.layout.map((_, i) => {
      const pa = a.crystals[i] ? a.crystals[i].amount : 0;
      const pb = b.crystals[i] ? b.crystals[i].amount : pa;
      return pa + (pb - pa) * alpha;
    });
    // Remember the biggest amount seen so far per tile (in case the first frame was mid-mining).
    amounts.forEach((v, i) => { if (v > cs.max[i]) cs.max[i] = v; });
    const key = amounts.map((v) => v.toFixed(1)).join(',') + '|' + cs.max.join(',');
    if (key === cs.lastKey) return;
    cs.lastKey = key;

    cs.buckets.forEach((bk) => { bk.n = 0; });
    let deadN = 0;
    const c = new THREE.Color();
    cs.layout.forEach((cl, i) => {
      const w = toWorld(cl.x, cl.y);
      const f = crystalFraction(amounts[i], cs.max[i]);
      if (amounts[i] < 0.5) {
        // Dull stump left on an empty tile.
        dummy.position.set(w.x + 0.08 * ts, w.y, w.z - 0.05 * ts);
        dummy.rotation.set(0.1, cl.phase, 0.15);
        dummy.scale.set(0.2 * ts, 0.16 * ts, 0.2 * ts);
        dummy.updateMatrix();
        cs.dead.setMatrixAt(deadN++, dummy.matrix);
        return;
      }
      const bk = cs.buckets[i % 3];
      cl.spikes.forEach((sp, k) => {
        const s = shardScale(f, k, cl.spikes.length);
        if (s <= 0) return;
        dummy.position.set(w.x + sp.dx * ts, w.y, w.z + sp.dy * ts);
        dummy.rotation.set(sp.tiltX, sp.spin, sp.tiltZ);
        dummy.scale.set(sp.width * ts * (0.7 + 0.3 * s), sp.height * ts * 1.5 * s, sp.width * ts * (0.7 + 0.3 * s));
        dummy.updateMatrix();
        bk.mesh.setMatrixAt(bk.n++, dummy.matrix);
      });
    });
    cs.buckets.forEach((bk) => { bk.mesh.count = bk.n; bk.mesh.instanceMatrix.needsUpdate = true; });
    cs.dead.count = deadN;
    cs.dead.instanceMatrix.needsUpdate = true;
  }

  function update(frame, dt) {
    time += dt || 0;
    const state = frame && (frame.prev || frame.next);
    if (state) {
      if (mapKeyOf(state) !== mapKey) buildMap(state);
      updateCrystals(frame);
    }
    if (crystalState) {
      crystalState.buckets.forEach((bk, i) => {
        bk.mat.emissiveIntensity = 0.7 + 1.5 * pulse(time, i * 2.1);
      });
      crystalState.padMat.opacity = 0.2 + 0.25 * pulse(time, 0.7);
    }
    if (ventRimMat) ventRimMat.opacity = 0.55 + 0.35 * pulse(time * 1.3, 0.4);
    if (ventSteam) {
      const v = ventSteam;
      for (let vi = 0; vi < v.at.length; vi++) for (let k = 0; k < v.n; k++) {
        const ph = (time * 0.35 + k / v.n + hash2(vi, k, 3)) % 1, i3 = (vi * v.n + k) * 3;
        v.pos[i3] = v.at[vi].x + Math.sin(ph * 5 + k) * 0.12 * ts;
        v.pos[i3 + 1] = v.at[vi].y + ph * 1.6 * ts;
        v.pos[i3 + 2] = v.at[vi].z + Math.cos(ph * 4 + k * 2) * 0.12 * ts;
      }
      v.geo.attributes.position.needsUpdate = true;
    }
    if (glowMat) glowMat.opacity = 0.22 + 0.2 * pulse(time * 0.4, 1.9);

    // Dust drifts along the wind and wraps.
    if (mapGroup) {
      const span = 40 * ts;
      for (let i = 0; i < DUST; i++) {
        const drift = time * (0.25 + hash2(i, 9, 1) * 0.35) * ts;
        dustPos[i * 3] = dustBase[i * 3] + ((drift % span) + span) % span - span / 2 + Math.sin(time * 0.5 + i) * 0.2 * ts;
        dustPos[i * 3 + 1] = dustBase[i * 3 + 1] + Math.sin(time * 0.7 + i * 1.7) * 0.15 * ts;
        dustPos[i * 3 + 2] = dustBase[i * 3 + 2] + drift * 0.3 % span;
      }
      dustGeo.attributes.position.needsUpdate = true;
    }
  }

  function dispose() {
    dropMap();
    scene.remove(root);
    for (const d of disposables) d.dispose && d.dispose();
    scene.fog = prevFog;
    scene.background = prevBg;
  }

  return { update, dispose, root, heightAt };
}
