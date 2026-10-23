// Probe: does a batch that outgrows its capacity in the middle of one frame keep the instances written before the growth?
import * as THREE from 'three';
import { createInstancedUnits } from '../play/units-instanced.mjs';

const scene = new THREE.Scene();
const ctx = { scene, tileSize: 1, gridToWorld: (x, y, z, out) => (out ? out.set(x, z ?? 0, y) : new THREE.Vector3(x, z ?? 0, y)) };
const units = createInstancedUnits(ctx, { side: 0 });
const N = 40;
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, owner: 0, kind: 'worker', x: i % 8, y: Math.floor(i / 8), hp: 40, carrying: 0 }));
const next = { tick: 5, units: mk(N), structures: [] };
const prev = { tick: 4, units: mk(N), structures: [] };
units.update({ prev, next, alpha: 1, tick: 5, events: [] }, 0.04);
const batch = units._batches.kinds.get('worker').batch;
console.log('drawn this frame (expect', N, '):', batch.mesh.count, '| batch capacity now:', batch.cap);
