import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const cache = new Map();
let material = null;

function part(geo, color, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]) {
  geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz);
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const box = (w, h, d, c, p, r) => part(new THREE.BoxGeometry(w, h, d), c, p, r);
const cyl = (rt, rb, h, c, p, r, seg = 14) => part(new THREE.CylinderGeometry(rt, rb, h, seg), c, p, r);
const ring = (R, t, c, p, r) => part(new THREE.TorusGeometry(R, t, 6, 14), c, p, r);

const MODELS = {
  battery: { s: 1.6, build: () => [
    cyl(0.05, 0.05, 0.15, 0x2b2f33, [0, 0.075, 0]),
    cyl(0.0515, 0.0515, 0.06, 0xd9a21b, [0, 0.07, 0]),
    cyl(0.05, 0.05, 0.03, 0xc0c4c8, [0, 0.165, 0]),
    cyl(0.018, 0.018, 0.02, 0xc0c4c8, [0, 0.19, 0]),
  ] },
  medkit: { s: 1.3, build: () => [
    box(0.34, 0.12, 0.22, 0xeeeeee, [0, 0.06, 0]),
    box(0.16, 0.006, 0.045, 0xc8281e, [0, 0.123, 0]),
    box(0.045, 0.006, 0.16, 0xc8281e, [0, 0.123, 0]),
    box(0.03, 0.04, 0.012, 0x444444, [-0.1, 0.07, 0.113]),
    box(0.03, 0.04, 0.012, 0x444444, [0.1, 0.07, 0.113]),
    box(0.12, 0.03, 0.03, 0x555555, [0, 0.135, -0.07]),
  ] },
  water: { s: 1.5, build: () => [
    cyl(0.045, 0.045, 0.2, 0x7fc4e8, [0, 0.1, 0]),
    cyl(0.0465, 0.0465, 0.07, 0x2e6fb5, [0, 0.1, 0]),
    cyl(0.02, 0.045, 0.05, 0x7fc4e8, [0, 0.225, 0]),
    cyl(0.02, 0.02, 0.03, 0x7fc4e8, [0, 0.265, 0]),
    cyl(0.025, 0.025, 0.025, 0xffffff, [0, 0.292, 0]),
  ] },
  food: { s: 1.6, build: () => [
    cyl(0.045, 0.045, 0.11, 0xb9bdc2, [0, 0.055, 0]),
    cyl(0.0465, 0.0465, 0.07, 0xc4472a, [0, 0.055, 0]),
    cyl(0.048, 0.048, 0.008, 0x9a9ea3, [0, 0.004, 0]),
    cyl(0.048, 0.048, 0.008, 0x9a9ea3, [0, 0.106, 0]),
  ] },
  fuel: { s: 1.15, build: () => [
    box(0.32, 0.4, 0.14, 0xb3271f, [0, 0.2, 0]),
    cyl(0.03, 0.03, 0.07, 0xe6c229, [-0.09, 0.435, 0]),
    box(0.14, 0.04, 0.05, 0x8f1d17, [0.07, 0.42, 0]),
    box(0.2, 0.18, 0.005, 0x8f1d17, [0, 0.2, 0.0725]),
  ] },
  key: { s: 2.4, build: () => [
    ring(0.04, 0.01, 0xd4af37, [0, 0.012, 0.05], [PI / 2, 0, 0]),
    box(0.012, 0.008, 0.09, 0xd4af37, [0, 0.012, -0.02]),
    box(0.02, 0.008, 0.012, 0xd4af37, [0.014, 0.012, -0.055]),
    box(0.02, 0.008, 0.012, 0xd4af37, [0.014, 0.012, -0.033]),
  ] },
  crowbar: { s: 1.2, build: () => [
    cyl(0.012, 0.012, 0.6, 0x30343a, [0, 0.012, 0], [0, 0, PI / 2], 8),
    cyl(0.0125, 0.0125, 0.12, 0xb3271f, [-0.26, 0.012, 0], [0, 0, PI / 2], 8),
    cyl(0.012, 0.012, 0.13, 0x30343a, [0.3, 0.012, 0.05], [PI / 2, 0, 0], 8),
  ] },
  radio: { s: 1.4, build: () => [
    box(0.24, 0.08, 0.15, 0x2c3a31, [0, 0.04, 0]),
    box(0.1, 0.006, 0.09, 0x14181a, [-0.05, 0.083, 0]),
    cyl(0.02, 0.02, 0.012, 0xd0d0d0, [0.07, 0.086, 0.025]),
    cyl(0.015, 0.015, 0.012, 0xd0d0d0, [0.07, 0.086, -0.03]),
    cyl(0.005, 0.005, 0.2, 0xc8c8c8, [0.1, 0.15, -0.05], [0, 0, -0.6], 6),
  ] },
  parcel: { s: 1.2, build: () => [
    box(0.36, 0.22, 0.26, 0xb08a5a, [0, 0.11, 0]),
    box(0.07, 0.224, 0.264, 0xd9c9a0, [0, 0.11, 0]),
    box(0.12, 0.004, 0.08, 0xf2f2f2, [0.12, 0.222, 0.05]),
  ] },
  scrap: { s: 1.5, build: () => [
    box(0.18, 0.05, 0.06, 0x6b6f73, [0, 0.025, 0], [0, 0.4, 0]),
    box(0.12, 0.04, 0.1, 0x7a4a2a, [0.05, 0.06, 0.04], [0, -0.6, 0.2]),
    cyl(0.02, 0.02, 0.2, 0x555a5f, [-0.04, 0.04, -0.06], [0, 0, PI / 2], 8),
    box(0.08, 0.03, 0.08, 0x8a8f94, [-0.08, 0.015, 0.07], [0, 0.9, 0]),
  ] },
  cloth: { s: 1.5, build: () => [
    box(0.26, 0.03, 0.18, 0xd8cdb2, [0, 0.015, 0]),
    box(0.24, 0.03, 0.17, 0xc9bd9f, [0, 0.045, 0], [0, 0.15, 0]),
    box(0.22, 0.03, 0.16, 0xb8ac8e, [0, 0.075, 0], [0, -0.1, 0]),
  ] },
  container_house: { s: 1, build: () => [
    box(0.9, 0.5, 0.55, 0x6b4a2b, [0, 0.25, 0]),
    box(0.94, 0.06, 0.59, 0x5a3d22, [0, 0.53, 0]),
    ...[[-0.44, -0.27], [0.44, -0.27], [-0.44, 0.27], [0.44, 0.27]].map(([x, z]) => box(0.06, 0.56, 0.06, 0x3d2a17, [x, 0.28, z])),
    box(0.07, 0.09, 0.02, 0xa0a0a0, [0, 0.46, 0.285]),
  ] },
  container_depot: { s: 1, build: () => [
    box(0.9, 0.55, 0.55, 0x4b5a3a, [0, 0.275, 0]),
    box(0.92, 0.07, 0.57, 0xd8b230, [0, 0.42, 0]),
    box(0.94, 0.04, 0.59, 0x3b4730, [0, 0.57, 0]),
    box(0.16, 0.04, 0.03, 0x222222, [0, 0.5, 0.29]),
  ] },
  generator: { s: 1, build: () => [
    box(0.9, 0.08, 0.55, 0x222222, [0, 0.04, 0]),
    box(0.8, 0.45, 0.5, 0xc2601a, [0, 0.305, 0]),
    box(0.25, 0.2, 0.02, 0x1c1c1c, [0.2, 0.3, 0.26]),
    cyl(0.05, 0.05, 0.04, 0x222222, [0.2, 0.55, 0]),
    cyl(0.03, 0.03, 0.3, 0x555555, [-0.3, 0.68, 0]),
  ] },
  board: { s: 1, build: () => [
    cyl(0.04, 0.04, 1.8, 0x4a3a28, [-0.5, 0.9, 0], [0, 0, 0], 8),
    cyl(0.04, 0.04, 1.8, 0x4a3a28, [0.5, 0.9, 0], [0, 0, 0], 8),
    box(1.2, 0.8, 0.05, 0x6e4f2f, [0, 1.3, 0]),
    box(1.1, 0.7, 0.02, 0xb88a52, [0, 1.3, 0.03]),
    box(0.25, 0.3, 0.005, 0xf0ecd8, [-0.3, 1.35, 0.045]),
    box(0.2, 0.25, 0.005, 0xe8e0c0, [0.05, 1.3, 0.045], [0, 0, 0.1]),
    box(0.22, 0.28, 0.005, 0xf4f0e0, [0.35, 1.28, 0.045], [0, 0, -0.08]),
  ] },
  dropoff: { s: 1, build: () => [
    cyl(0.06, 0.06, 0.9, 0x444444, [0, 0.45, 0], [0, 0, 0], 8),
    box(0.55, 0.4, 0.35, 0x2f6fb0, [0, 1.1, 0]),
    cyl(0.175, 0.175, 0.55, 0x2f6fb0, [0, 1.3, 0], [0, 0, PI / 2], 14),
    box(0.3, 0.02, 0.01, 0x111111, [0, 1.15, 0.176]),
    box(0.2, 0.1, 0.005, 0xffffff, [0, 1.0, 0.176]),
  ] },
};

export function modelKey(pk) {
  if (pk.kind === 'container') return pk.table === 'depot' ? 'container_depot' : 'container_house';
  const k = pk.kind || pk.type;
  return MODELS[k] ? k : 'parcel';
}

function geometryFor(key) {
  let g = cache.get(key);
  if (!g) {
    const parts = MODELS[key].build();
    g = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    g.computeBoundingSphere();
    cache.set(key, g);
  }
  return g;
}

function materialShared() {
  return (material ??= new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.75, metalness: 0.15, emissive: 0x120d06,
  }));
}

const hash01 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

export function itemMeshFor(pk, id, groundY) {
  const key = modelKey(pk);
  const m = new THREE.Mesh(geometryFor(key), materialShared());
  m.position.set(pk.x, groundY + 0.01, pk.z);
  m.rotation.y = hash01(String(id)) * PI * 2;
  m.scale.setScalar(MODELS[key].s);
  m.castShadow = false;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

export function disposeItemModels() {
  cache.forEach((g) => g.dispose());
  cache.clear();
  material?.dispose();
  material = null;
}
