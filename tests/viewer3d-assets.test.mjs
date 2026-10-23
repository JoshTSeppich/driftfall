// viewer3d/assets.mjs: manifest parsing, real GLB loading in node, team re-paint, fit-to-tile, placeholders, sounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  loadAssets, normalizeModelManifest, normalizeAudioManifest, resolveModel, resolveSound, modelUrl, soundUrl,
  roleForMaterial, buildPlaceholder, fitToFootprint, MODEL_MANIFEST_URL, AUDIO_MANIFEST_URL, MODEL_ALIASES,
  kindsFromStats, wantedKinds,
} from '../viewer3d/assets.mjs';
import { createPalette, ROSTER, KIND_LOOK, lookFor, TEAM } from '../viewer3d/palette.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realModels = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/models/MANIFEST.json'), 'utf8'));
const realAudio = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/audio/MANIFEST.json'), 'utf8'));

const sizeOf = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
const minOf = (o) => new THREE.Box3().setFromObject(o).min;
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

test('normalizeModelManifest reads the scout shape and simpler shapes', () => {
  const m = normalizeModelManifest(realModels);
  assert.equal(m.root, 'assets/models');
  for (const k of ['worker', 'grunt', 'lancer', 'brute', 'core', 'forge', 'turret', 'rock', 'crystal']) assert.ok(m.entries[k], `entry ${k}`);
  assert.equal(m.entries.worker.file, 'space/rover.glb');
  assert.equal(m.entries.worker.category, 'unit');
  assert.equal(m.entries.core.category, 'structure');
  assert.equal(m.entries.rock.category, 'terrain');
  assert.equal(m.entries.scaffold.category, 'prop');
  assert.deepEqual(m.entries.turret.size, [0.9, 0.4, 0.6]);
  assert.ok(m.files.size >= 30);
  // bare map and { models: {} } shapes
  const bare = normalizeModelManifest({ worker: 'a.glb', core: { file: 'b.glb', scale: 2, yaw: 1.5 } });
  assert.equal(bare.entries.worker.file, 'a.glb');
  assert.equal(bare.entries.core.scale, 2);
  assert.equal(bare.entries.core.yaw, 1.5);
  const nested = normalizeModelManifest({ models: { grunt: { file: 'g.glb' } } });
  assert.equal(nested.entries.grunt.file, 'g.glb');
  assert.deepEqual(Object.keys(normalizeModelManifest(null).entries), []);
  assert.deepEqual(Object.keys(normalizeModelManifest({ version: 1, note: 'x' }).entries), []);
});

test('every file named in the real model manifest exists on disk', () => {
  const m = normalizeModelManifest(realModels);
  for (const f of m.files) assert.ok(fs.existsSync(path.join(ROOT, m.root, f)), `missing ${f}`);
});

test('resolveModel finds agreed v3 names through the aliases and spelling variants', () => {
  const m = normalizeModelManifest(realModels);
  assert.equal(resolveModel(m, 'worker').file, 'space/rover.glb');
  assert.equal(resolveModel(m, 'spiker'), resolveModel(m, 'skyspike'));
  assert.equal(resolveModel(m, 'howler'), resolveModel(m, 'bombard'));
  assert.equal(resolveModel(m, 'skiff'), resolveModel(m, 'gale'));
  assert.equal(resolveModel(m, 'barge'), resolveModel(m, 'ferry'));
  assert.equal(resolveModel(m, 'seer'), resolveModel(m, 'lumen'));
  assert.equal(resolveModel(m, 'conduit'), resolveModel(m, 'hexer'));
  assert.equal(resolveModel(m, 'hangar'), resolveModel(m, 'aerie'));
  assert.equal(resolveModel(m, 'sensor-mast'), resolveModel(m, 'beacon'));
  assert.equal(resolveModel(m, 'Sensor Mast'), resolveModel(m, 'beacon'));
  assert.equal(resolveModel(m, 'rich-crystal').file, 'space/rock_crystalsLargeB.glb');
  assert.equal(resolveModel(m, 'rich_shard').file, 'space/rock_crystalsLargeB.glb');
  assert.equal(resolveModel(m, 'debris'), resolveModel(m, 'rubble'));
  assert.equal(resolveModel(m, 'open').file, 'space/terrain.glb');
  assert.equal(resolveModel(m, 'quarters'), null, 'no model for quarters yet');
  assert.equal(resolveModel(m, 'nothing'), null);
  assert.equal(resolveModel(null, 'worker'), null);
  for (const k of Object.keys(MODEL_ALIASES)) assert.notEqual(lookFor(k).shape, 'unknown', `alias ${k} has a look`);
});

test('model and sound urls resolve under the repo root', () => {
  const m = normalizeModelManifest(realModels);
  const url = modelUrl(m, m.entries.worker);
  assert.ok(url.endsWith('/assets/models/space/rover.glb'), url);
  assert.ok(fs.existsSync(fileURLToPath(url)));
  assert.ok(MODEL_MANIFEST_URL.endsWith('/assets/models/MANIFEST.json'));
  assert.ok(AUDIO_MANIFEST_URL.endsWith('/assets/audio/MANIFEST.json'));
  const a = normalizeAudioManifest(realAudio);
  assert.equal(Object.keys(a.events).length, 16);
  assert.equal(a.events.ambient_loop.loop, true);
  assert.equal(a.events.melee_hit.loop, false);
  for (const e of Object.values(a.events)) assert.ok(fs.existsSync(fileURLToPath(soundUrl(a, e))), `sound ${e.file}`);
  assert.equal(resolveSound(a, 'ranged_shot').file, 'kenney-sci-fi/laserSmall_000.ogg');
  assert.equal(resolveSound(a, 'nope'), null);
  assert.equal(modelUrl(m, null), null);
});

test('roleForMaterial maps the kit material names to palette roles', () => {
  assert.equal(roleForMaterial('metalRed'), 'team');
  assert.equal(roleForMaterial('metal'), 'hull');
  assert.equal(roleForMaterial('metalDark'), 'hullDark');
  assert.equal(roleForMaterial('dark'), 'dark');
  assert.equal(roleForMaterial('crystal'), 'shard');
  assert.equal(roleForMaterial('rockTrack'), 'rockDark');
  assert.equal(roleForMaterial('rock'), 'rock');
  assert.equal(roleForMaterial('colormap'), 'keep', 'textured td materials keep their texture');
  assert.equal(roleForMaterial(''), 'hull');
  assert.equal(roleForMaterial('_defaultMat'), 'hull');
  assert.equal(roleForMaterial('metalRed', { metalRed: 'strip' }), 'strip', 'manifest parts override');
  // on units and structures the big metal areas take team paint, accents and crystals glow in the team colour
  assert.equal(roleForMaterial('metal', null, 'unit'), 'team');
  assert.equal(roleForMaterial('metalRed', null, 'unit'), 'strip');
  assert.equal(roleForMaterial('crystal', null, 'unit'), 'strip', 'teal means Shards only');
  assert.equal(roleForMaterial('crystal', null, 'terrain'), 'shard');
  assert.equal(roleForMaterial('metal', null, 'terrain'), 'hull');
});

test('loadAssets awaits only the kinds the match uses and streams the rest in behind, telling listeners', async () => {
  const palette = createPalette(THREE);
  const stats = JSON.parse(fs.readFileSync(path.join(ROOT, 'matches/sample-7.json'), 'utf8')).stats;
  assert.ok(kindsFromStats(stats).includes('worker') && kindsFromStats(stats).includes('turret'));
  assert.equal(kindsFromStats(null), null);
  const wanted = wantedKinds(['spiker', 'core']);
  assert.ok(wanted.has('skyspike') && wanted.has('core') && wanted.has('rock') && wanted.has('rich_shard'));
  const seen = [];
  const assets = await loadAssets({ THREE, palette, tileSize: 1, stats });
  assert.ok(assets.report.models.awaited.includes('space/rover.glb'), 'worker awaited');
  assert.ok(assets.report.models.awaited.includes('space/turret_double.glb'), 'turret awaited');
  assert.ok(assets.report.models.background.includes('space/craft_racer.glb'), 'dart streams in behind');
  assert.ok(assets.models.get('worker', 0), 'awaited model is ready at once');
  const off = assets.onLoad((e) => seen.push(...e.kinds));
  await assets.whenAll;
  off();
  assert.ok(assets.models.get('dart', 0), 'background model arrived');
  assert.ok(seen.includes('dart') || assets.report.models.loaded.includes('dart'), `listener told about dart (${seen.length} notices)`);
  assets.dispose();
});

test('loadAssets on the real manifests in node: never throws, loads the Space Kit, reports the textured files', async () => {
  const palette = createPalette(THREE);
  const assets = await loadAssets({ THREE, palette, tileSize: 2 }, { eager: true });
  assert.equal(assets.report.models.manifest, 'ok');
  assert.equal(assets.report.sounds.manifest, 'ok');
  assert.ok(assets.report.models.loaded.includes('worker'));
  assert.ok(assets.report.models.loaded.includes('core'));
  assert.ok(assets.report.models.loaded.length >= 30, `loaded ${assets.report.models.loaded.length}`);
  // td/ models reference a texture; node has no image loader, so they must be reported, not thrown
  for (const f of assets.report.models.failed) assert.ok(f.file.startsWith('td/'), `unexpected failure ${f.file}: ${f.error}`);
  assert.equal(assets.sounds.events().length, 16);
  assert.ok(assets.sounds.url('ranged_shot').endsWith('laserSmall_000.ogg'));
  assert.equal(assets.sounds.url('nope'), null);
  assert.equal(await assets.sounds.load('melee_hit', null), null, 'no audio context -> null, no throw');

  // a fitted, re-painted clone for side 1
  const worker = assets.models.get('worker', { owner: 1 });
  assert.ok(worker?.isObject3D);
  assert.equal(worker.userData.source, 'model');
  assert.equal(worker.userData.owner, 1);
  const s = sizeOf(worker);
  assert.ok(near(Math.max(s.x, s.z), lookFor('worker').size * 2, 1e-3), `footprint ${s.x} x ${s.z}`);
  assert.ok(near(minOf(worker).y, 0, 1e-3), 'base on the ground');
  const names = new Set();
  worker.traverse((o) => { if (o.isMesh) names.add(o.material.name); });
  assert.ok(names.has('df.team1.body'), `team paint applied: ${[...names]}`);
  assert.ok(!names.has('metalRed') && !names.has('metal'), 'kit materials replaced');
  // units.mjs calls get(kind, owner) with a bare number
  const grunt0 = assets.models.get('grunt', 0);
  let hasTeam0 = false; grunt0.traverse((o) => { if (o.isMesh && o.material.name === 'df.team0.body') hasTeam0 = true; });
  assert.ok(hasTeam0);
  // shared paint: the same material object for every unit of the team, so there is one draw state per team
  const grunt1 = assets.models.get('grunt', 1);
  const bodies = [];
  grunt1.traverse((o) => { if (o.isMesh && o.material.name === 'df.team1.body') bodies.push(o.material); });
  assert.ok(bodies.length > 0 && bodies.every((m) => m === palette.materials.team[1].body));
  // unique paint when asked
  const shade = assets.models.get('shade', { owner: 0, unique: true });
  let uniqueOk = true; shade.traverse((o) => { if (o.isMesh && o.material === palette.materials.team[0].body) uniqueOk = false; });
  assert.ok(uniqueOk, 'unique clones do not share palette materials');
  // crystals come out teal and emissive
  const crystal = assets.models.get('crystal');
  let shardMats = 0; crystal.traverse((o) => { if (o.isMesh && o.material === palette.materials.shard) shardMats++; });
  assert.ok(shardMats > 0);
  // clones are independent
  assert.notEqual(assets.models.get('worker', 0), assets.models.get('worker', 0));
  assert.equal(assets.models.get('quarters', 0), null, 'no model -> null from models.get');
  assert.equal(assets.get('quarters', 0).userData.source, 'placeholder', 'assets.get falls back to the placeholder');
  assert.equal(assets.get('worker', 0).userData.source, 'model');
  assets.dispose();
});

test('loadAssets with missing manifests and no THREE still resolves with fallbacks', async () => {
  const a = await loadAssets({}, { modelManifest: 'file:///nowhere/MANIFEST.json', audioManifest: 'file:///nowhere/AUDIO.json' });
  assert.match(a.report.models.manifest, /^missing/);
  assert.match(a.report.sounds.manifest, /^missing/);
  assert.deepEqual(a.models.kinds(), []);
  assert.equal(a.models.get('worker', 0), null);
  assert.equal(a.placeholder('worker', 0), null, 'no THREE -> no geometry');
  assert.equal(a.sounds.url('melee_hit'), null);
  // with THREE but no files: placeholders for everything
  const b = await loadAssets({ THREE, tileSize: 1 }, { modelManifest: { worker: 'space/does-not-exist.glb' }, audioManifest: { events: {} } });
  assert.equal(b.report.models.failed.length, 1);
  assert.equal(b.models.get('worker', 0), null);
  assert.equal(b.get('worker', 0).userData.source, 'placeholder');
});

test('a file that never finishes loading is reported after the timeout, not awaited forever', async () => {
  const never = () => new Promise(() => {});
  const t0 = performance.now();
  const a = await loadAssets({ THREE, tileSize: 1 }, { loadGLTF: never, timeoutMs: 50, modelManifest: { worker: 'w.glb' }, audioManifest: {} });
  assert.ok(performance.now() - t0 < 2000);
  assert.equal(a.report.models.failed.length, 1);
  assert.match(a.report.models.failed[0].error, /timed out/);
  assert.equal(a.get('worker', 0).userData.source, 'placeholder');
});

test('loadAssets accepts an injected loader (browser-free pipeline test)', async () => {
  const fake = async () => {
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial({ name: 'metal' }));
    m.position.y = 2; scene.add(m);
    const g = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'glass' }));
    g.position.y = 5; scene.add(g);
    return { scene, animations: [new THREE.AnimationClip('Walk', 1, [])] };
  };
  const a = await loadAssets({ THREE, tileSize: 1 }, { loadGLTF: fake, modelManifest: { units: { grunt: { file: 'x.glb', parts: { glass: 'strip' } } } }, audioManifest: {} });
  assert.deepEqual(a.report.models.loaded, ['grunt']);
  const g = a.models.get('grunt', 1);
  const s = sizeOf(g);
  // the fake is 3x taller than wide, so the height cap wins and the footprint ends up under the tile fraction
  assert.ok(near(s.y, lookFor('grunt').height * 1.6), `tall models are capped by height (${s.y})`);
  assert.ok(Math.max(s.x, s.z) <= lookFor('grunt').size + 1e-6, `footprint ${s.x}`);
  assert.ok(near(minOf(g).y, 0));
  const wide = await loadAssets({ THREE, tileSize: 1 }, { loadGLTF: async () => ({ scene: new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2)), animations: [] }), modelManifest: { brute: 'b.glb' }, audioManifest: {} });
  const bs = sizeOf(wide.models.get('brute', 0));
  assert.ok(near(Math.max(bs.x, bs.z), lookFor('brute').size), `wide model footprint ${bs.x}`);
  const mats = []; g.traverse((o) => { if (o.isMesh) mats.push(o.material.name); });
  assert.ok(mats.includes('df.team1.body') && mats.includes('df.team1.strip'), `parts override -> strip: ${mats}`);
  assert.equal(a.models.animations('grunt')[0].name, 'Walk');
});

test('placeholders exist for every roster kind, with a body and the right footprint, and air kinds float', () => {
  const palette = createPalette(THREE);
  const all = [...ROSTER.units, ...ROSTER.structures, ...ROSTER.terrain, 'gizmo'];
  for (const kind of all) {
    for (const owner of [0, 1, null]) {
      const category = lookFor(kind).category;
      const p = buildPlaceholder(THREE, palette.materials, kind, { owner, tileSize: 1 });
      assert.ok(p.isObject3D, `${kind} placeholder`);
      assert.equal(p.userData.source, 'placeholder');
      let meshes = 0, body = false;
      p.traverse((o) => { if (o.isMesh) { meshes++; if (o.name === 'body' || o.name === 'crystal') body = true; assert.ok(o.material?.isMaterial); } });
      assert.ok(meshes >= 1 && body, `${kind} has a body`);
      const s = sizeOf(p), lo = lookFor(kind, category);
      assert.ok(near(Math.max(s.x, s.z), lo.size, 1e-3), `${kind} footprint ${s.x.toFixed(3)} x ${s.z.toFixed(3)} vs ${lo.size}`);
      const minY = minOf(p).y;
      if (lo.air && category === 'unit') assert.ok(minY > 0.3, `${kind} floats (${minY})`);
      else assert.ok(near(minY, 0, 1e-3), `${kind} base at 0 (${minY})`);
      if (owner !== null && category !== 'terrain') {
        let teamPaint = false;
        p.traverse((o) => { if (o.isMesh && o.material.name.startsWith(`df.team${owner}.`)) teamPaint = true; });
        assert.ok(teamPaint, `${kind} wears team ${owner} paint`);
      }
    }
  }
  // different shapes for the four v2 units (silhouette rule): the mesh counts or sizes differ
  const sig = (k) => { const p = buildPlaceholder(THREE, palette.materials, k, { owner: 0 }); const s = sizeOf(p); let n = 0; p.traverse((o) => { if (o.isMesh) n++; }); return `${n}:${s.x.toFixed(2)}:${s.y.toFixed(2)}:${s.z.toFixed(2)}`; };
  assert.equal(new Set(['worker', 'grunt', 'lancer', 'brute'].map(sig)).size, 4);
});

test('fitToFootprint scales, centres and grounds any object', () => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1));
  o.position.set(10, 7, -3);
  const w = fitToFootprint(THREE, o, 0.5);
  const s = sizeOf(w), mn = minOf(w);
  assert.ok(near(s.x, 0.5) && near(s.z, 0.125) && near(s.y, 0.25));
  assert.ok(near(mn.y, 0) && near(mn.x, -0.25) && near(mn.z, -0.0625));
  const w2 = fitToFootprint(THREE, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), 1, { scale: 3, offset: [0, 0.5, 0] });
  assert.ok(near(sizeOf(w2).x, 3) && near(minOf(w2).y, 0.5));
  const w3 = fitToFootprint(THREE, new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1)), 1, { maxHeight: 2 });
  assert.ok(near(sizeOf(w3).y, 2));
});
