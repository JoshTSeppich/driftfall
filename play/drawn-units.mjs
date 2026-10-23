// Snakenator ink silhouettes: one instanced billboard per kind, one shared team-foot-ring batch.
import * as THREE from 'three';
export const DRAWN_KINDS = Object.freeze({
  worker: 'siphoner', grunt: 'fang', lancer: 'spitter', brute: 'constrictor',
  spiker: 'hisser', howler: 'boomslang',
  dart: null, mender: null, shade: null, conduit: null, skiff: null, barge: null, seer: null,
});
const HEIGHT = { worker: 0.85, grunt: 1.12, lancer: 1.32, brute: 1.8, spiker: 1.4, howler: 1.45 };
// Literal URLs are also discovered by the production build's asset crawler.
const SPRITES = Object.freeze({
  siphoner: '../assets/sprites/snakenators/siphoner.png',
  fang: '../assets/sprites/snakenators/fang.png',
  spitter: '../assets/sprites/snakenators/spitter.png',
  constrictor: '../assets/sprites/snakenators/constrictor.png',
  hisser: '../assets/sprites/snakenators/hisser.png',
  boomslang: '../assets/sprites/snakenators/boomslang.png',
});
export function spriteFor(kind) {
  return Object.hasOwn(DRAWN_KINDS, kind) ? SPRITES[DRAWN_KINDS[kind]] ?? null : null;
}
export const billboardSize = (kind) => HEIGHT[kind] ?? 1;

// Texture loading is injectable so the actual batching/visibility/fallback path can be tested without a DOM.
export function createDrawnUnits(ctx, { scale = 1.45, side = null, loadTexture } = {}) {
  const root = new THREE.Group(); root.name = 'drawn-units'; ctx.scene.add(root);
  const unitScale = scale * (ctx.tileSize ?? 1);
  const loader = loadTexture ?? ((url, ok, fail) => new THREE.TextureLoader().load(url, ok, undefined, fail));
  let disposed = false;
  const kinds = new Map(), batches = [];
  const dummy = new THREE.Object3D(), right = new THREE.Vector3();
  const cyan = new THREE.Color('#35e5ff'), orange = new THREE.Color('#ff8a3d');
  function grow(b, cap) {
    const old = b.mesh, mesh = new THREE.InstancedMesh(b.geo, b.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
    mesh.count = 0;
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, b.used * 16));
      if (old.instanceColor) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, b.used * 3));
      }
      root.remove(old); old.dispose();
    }
    root.add(mesh); b.mesh = mesh; b.cap = cap;
  }
  function batch(geo, mat) {
    const b = { geo, mat, cap: 0, used: 0 }; grow(b, 32); batches.push(b); return b;
  }
  function put(b, color) {
    if (b.used === b.cap) grow(b, b.cap * 2);
    const i = b.used++; dummy.updateMatrix(); b.mesh.setMatrixAt(i, dummy.matrix);
    if (color) b.mesh.setColorAt(i, color);
  }
  const rings = batch(new THREE.RingGeometry(0.42, 0.5, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  for (const kind of Object.keys(HEIGHT)) {
    const e = { ready: false, texture: null, aspect: 0.75, batch: null }; kinds.set(kind, e);
    e.batch = batch(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.12, depthWrite: true, side: THREE.DoubleSide }));
    e.texture = loader(new URL(spriteFor(kind), import.meta.url).href, (tex) => {
      if (disposed) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      e.aspect = tex.image.width / tex.image.height;
      e.batch.mat.map = tex; e.batch.mat.needsUpdate = true; e.ready = true;
    }, () => { e.ready = false; });
  }
  function begin() { for (const b of batches) b.used = 0; }
  function emit(v, tr) {
    const e = kinds.get(v.kind);
    if (!e?.ready) return false; // missing/loading/failed art keeps the original 3D silhouette
    if (ctx.camera) right.set(1, 0, 0).applyQuaternion(ctx.camera.quaternion);
    else right.set(1, 0, 0);
    const heading = Math.sin(v.yaw) * right.x + Math.cos(v.yaw) * right.z;
    // Sheets face left. Keep the last facing around the near-vertical movement dead zone.
    if (Math.abs(heading) > 0.12) v.drawnFacing = heading > 0 ? -1 : 1;
    dummy.position.copy(v.pos); dummy.position.y += tr.dy * unitScale;
    if (ctx.camera) dummy.quaternion.copy(ctx.camera.quaternion); else dummy.rotation.set(0, 0, 0);
    const h = billboardSize(v.kind) * unitScale * tr.scale;
    dummy.scale.set(h * e.aspect * (v.drawnFacing ?? 1), h, 1); put(e.batch);
    if (!v.dying) {
      dummy.position.copy(v.pos); dummy.position.y += 0.025;
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar((v.spec.size ?? 0.5) * unitScale * 1.1);
      put(rings, v.owner === (side ?? 0) ? cyan : orange);
    }
    return true;
  }
  function end() {
    for (const b of batches) {
      b.mesh.count = b.used; b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    }
  }
  function dispose() {
    disposed = true;
    for (const b of batches) { b.mesh.dispose(); b.geo.dispose(); b.mat.dispose(); }
    for (const e of kinds.values()) e.texture?.dispose();
    ctx.scene.remove(root);
  }
  return { begin, emit, end, dispose, root, kinds,
    height: (kind) => kinds.get(kind)?.ready ? billboardSize(kind) : null,
    get draws() { return batches.filter((b) => b.used).length; },
  };
}
