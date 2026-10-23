# TOY-EDGES-GPT.md — GPT's edge-highlight + contact-shadow code (2026-10-23)

For the toy-render agent (RENDERING.md piece 3 and piece 2). GPT wrote this from our request. Review it, test it, and adapt it into play/toy-render.mjs. Don't paste it in blind.

## applyToyEdges + createToyBoxInstances

```js
import * as THREE from 'three';
// Requirements: centered BoxGeometry(1,1,1); InstancedMesh whose instanceMatrix encodes size;
// InstancedBufferAttribute "aHalf" = (w/2, h/2, d/2); no negative scale or shear. Geometry NOT modified.
// band: highlight width in object units; intensity 0..1; tint: colour; inset: darkening just inside the edge 0..1.
export function applyToyEdges(material, { band = 0.025, intensity = 0.18, tint = 0xfff0d5, inset = 0.07 } = {}) {
  if (!material.isMeshStandardMaterial) throw new TypeError('applyToyEdges requires THREE.MeshStandardMaterial');
  if (material.userData.toyEdges) throw new Error('Toy edges already applied to this material');
  const uniforms = {
    uToyBand: { value: Math.max(0.0001, band) },
    uToyIntensity: { value: THREE.MathUtils.clamp(intensity, 0, 1) },
    uToyTint: { value: new THREE.Color(tint) },
    uToyInset: { value: THREE.MathUtils.clamp(inset, 0, 1) },
  };
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 aHalf;
      varying vec3 vToyPos;
      varying vec3 vToyHalf;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      // Unit cube [-0.5,+0.5], physical half-size in aHalf; object/instance-local.
      vToyHalf = max(aHalf, vec3(0.0001));
      vToyPos = position * (2.0 * vToyHalf);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vToyPos;
      varying vec3 vToyHalf;
      uniform float uToyBand;
      uniform float uToyIntensity;
      uniform vec3  uToyTint;
      uniform float uToyInset;
      vec2 toyEdgeMasks(vec3 localPos, vec3 halfSize) {
        vec3 d = max(halfSize - abs(localPos), vec3(0.0));          // distance to the planes
        vec3 aa = max(fwidth(d), vec3(0.00001));                     // screen-space AA
        vec3 nearEdge = 1.0 - smoothstep(vec3(uToyBand) - aa, vec3(uToyBand) + aa, d);
        float highlight = max(nearEdge.x * nearEdge.y, max(nearEdge.x * nearEdge.z, nearEdge.y * nearEdge.z)); // TWO planes = edge
        float innerBand = uToyBand * 2.5;
        vec3 ip = 1.0 - smoothstep(vec3(innerBand) - aa, vec3(innerBand) + aa, d);
        float innerEdge = max(ip.x * ip.y, max(ip.x * ip.z, ip.y * ip.z));
        float insetMask = max(0.0, innerEdge - highlight);           // keep dark band off the bright edge
        return vec2(highlight, insetMask);
      }`);
    const marker = '#include <color_fragment>';
    if (!shader.fragmentShader.includes(marker)) throw new Error('THREE shader chunk color_fragment not found');
    shader.fragmentShader = shader.fragmentShader.replace(marker, `#include <color_fragment>
      vec2 toyMasks = toyEdgeMasks(vToyPos, vToyHalf);
      diffuseColor.rgb *= 1.0 - toyMasks.y * uToyInset;                       // linear space, before PBR lighting
      diffuseColor.rgb = mix(diffuseColor.rgb, uToyTint, toyMasks.x * uToyIntensity);`);
  };
  material.customProgramCacheKey = () => previousCacheKey() + '|toy-edges-r169-v1'; // params are uniforms, not variants
  material.userData.toyEdges = uniforms;
  material.needsUpdate = true;
  return {
    material,
    setBand(v) { uniforms.uToyBand.value = Math.max(0.0001, v); },
    setIntensity(v) { uniforms.uToyIntensity.value = THREE.MathUtils.clamp(v, 0, 1); },
    setTint(v) { uniforms.uToyTint.value.set(v); },
    setInset(v) { uniforms.uToyInset.value = THREE.MathUtils.clamp(v, 0, 1); },
  };
}

// Per-instance half-extents on an InstancedMesh. dimensions: [{x,y,z,width,height,depth,quaternion?}]
export function createToyBoxInstances(dimensions, material) {
  const count = dimensions.length;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const halves = new Float32Array(count * 3);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  dimensions.forEach((item, i) => {
    const { width, height, depth } = item;
    if (width <= 0 || height <= 0 || depth <= 0) throw new Error('Box dimensions must be positive');
    halves[i * 3] = width / 2; halves[i * 3 + 1] = height / 2; halves[i * 3 + 2] = depth / 2;
    pos.set(item.x ?? 0, item.y ?? 0, item.z ?? 0);
    scale.set(width, height, depth);
    if (item.quaternion) rotation.copy(item.quaternion); else rotation.identity();
    matrix.compose(pos, rotation, scale);
    mesh.setMatrixAt(i, matrix);
  });
  geometry.setAttribute('aHalf', new THREE.InstancedBufferAttribute(halves, 3));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// Usage
// const cream = new THREE.MeshStandardMaterial({ color: 0xf2d7a6, roughness: 0.48, metalness: 0 });
// const edges = applyToyEdges(cream, { band: 0.025, intensity: 0.18, tint: 0xfff0d5, inset: 0.07 });
// const bodies = createToyBoxInstances([{ x:-2,y:0.5,z:0,width:0.8,height:1.0,depth:0.7 }, ...], cream);
// bodies.castShadow = bodies.receiveShadow = true; scene.add(bodies);
// edges.setBand(0.018); edges.setIntensity(0.22); // runtime tweak, no recompile
```

## Contact shadows (64 px radial alpha, instanced)

```js
export function makeContactShadowTexture(size = 64) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'); const image = ctx.createImageData(size, size); const p = image.data;
  const c = (size - 1) * 0.5, r = size * 0.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x - c) / r, dy = (y - c) / r, d = Math.sqrt(dx * dx + dy * dy);
    const alpha = Math.exp(-5.0 * d * d) * (1.0 - THREE.MathUtils.smoothstep(d, 0.70, 1.0)); // gaussian, 0 at edge
    const i = (y * size + x) * 4; p[i] = p[i + 1] = p[i + 2] = 0; p[i + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture; // share ONE across all units
}

export function createContactShadows(count) {
  const texture = makeContactShadowTexture(64);
  const material = new THREE.MeshBasicMaterial({ map: texture, color: 0x18242b, transparent: true, opacity: 0.26,
    depthWrite: false, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1,
    polygonOffsetUnits: -1, toneMapped: false });
  const geometry = new THREE.PlaneGeometry(1, 1); geometry.rotateX(-Math.PI / 2); // XY -> XZ once
  const shadows = new THREE.InstancedMesh(geometry, material, count);
  shadows.castShadow = false; shadows.receiveShadow = false; shadows.frustumCulled = false;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), quat = new THREE.Quaternion();
  function setShadow(i, x, groundY, z, width, depth) {
    position.set(x, groundY + 0.012, z);
    scale.set(width * 1.12, depth * 1.12, 1); // NOTE (Claude): after rotateX the plane lies in XZ, so depth likely belongs in scale.z, not .y. Verify.
    matrix.compose(position, quat, scale); shadows.setMatrixAt(i, matrix);
  }
  function commit() { shadows.instanceMatrix.needsUpdate = true; }
  return { mesh: shadows, setShadow, commit, dispose() { geometry.dispose(); material.dispose(); texture.dispose(); } };
}
```

## GPT's pitfalls (10)
1. r169 / WebGL2: it relies on MeshStandardMaterial shader chunks, so re-check before upgrading three.
2. Use centred unit boxes. aHalf must equal half the instance-matrix scale, excluding any shared mesh scale.
3. aHalf is an InstancedBufferAttribute on the geometry. Set needsUpdate when dimensions change.
4. Works along local box axes: no shear, no negative scale, no unmatched parent scale.
5. Distances come from interpolated object-space positions, and fwidth() must stay in the fragment shader.
6. Shadow depth: it changes colour only, so instanced shadow casting needs no custom depth material. If you later deform or discard vertices, mirror that in customDepthMaterial and customDistanceMaterial.
7. customProgramCacheKey separates GLSL variants. Uniform changes don't recompile; changed GLSL needs a new key plus needsUpdate.
8. onBeforeCompile does not survive clone, copy or serialization, so re-apply it to new materials.
9. Decals don't follow terrain: compute the ground height per unit and avoid z-fighting with overlapping ground layers.
10. This is a tinted albedo band, not real bevel lighting. Benchmark the ALU cost at 200 units, and use a beveled LOD only for close-ups.

**Claude's integration note:** our toaster parts are animated per pivot. Feed createToyBoxInstances-style batches from the coil-motion part transforms each frame (setMatrixAt), and set aHalf once per part type.
