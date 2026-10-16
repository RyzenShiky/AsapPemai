import * as THREE from 'three';
import { buildSpatialGrid } from './Collision.js';

const CH = 24, CELL = 6, WALL_H = 3.2, LOAD = 2;
const h = (a, b, c) => {
  let x = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + c, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9b458, roughness: 1 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 1, side: THREE.DoubleSide });

export const LEVELS = {};
export const registerLevel = (id, def) => { LEVELS[id] = def; };

registerLevel('backrooms0', {
  fog: 0xc9b458, fogDensity: 0.035, humHz: 60, drain: 0.8,
  buildChunk(cx, cz) {
    const x0 = cx * CH, z0 = cz * CH, walls = [];
    for (let x = x0; x < x0 + CH; x += CELL)
      for (let z = z0; z < z0 + CH; z += CELL) {
        if (h(x, z, 1) < 0.4)
          walls.push({ type: 'wall', minX: x, maxX: x + CELL * 0.7, minZ: z - 0.15, maxZ: z + 0.15 });
        if (h(x, z, 2) < 0.4)
          walls.push({ type: 'wall', minX: x - 0.15, maxX: x + 0.15, minZ: z, maxZ: z + CELL * 0.7 });
      }
    const group = new THREE.Group();
    const im = new THREE.InstancedMesh(boxGeo, wallMat, Math.max(1, walls.length));
    const m = new THREE.Matrix4();
    walls.forEach((w, i) => {
      m.compose(
        new THREE.Vector3((w.minX + w.maxX) / 2, WALL_H / 2, (w.minZ + w.maxZ) / 2),
        new THREE.Quaternion(),
        new THREE.Vector3(w.maxX - w.minX, WALL_H, w.maxZ - w.minZ)
      );
      im.setMatrixAt(i, m);
    });
    im.count = walls.length;
    im.instanceMatrix.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(CH, CH), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x0 + CH / 2, 0.03, z0 + CH / 2);
    const ceil = floor.clone();
    ceil.position.y = WALL_H;
    group.add(im, floor, ceil);
    return { group, walls };
  },
});

export class LevelManager {
  constructor(renderer, id) {
    this.r = renderer;
    this.def = LEVELS[id];
    this.chunks = new Map();
    this.spatial = buildSpatialGrid([]);
    this._ck = '';
    this.hum = null;
    for (const o of [renderer.ground, renderer.treeGroup, renderer.rockGroup, renderer.buildingGroup]) {
      if (o) o.visible = false;
    }
    if (renderer.scene.fog) {
      renderer.scene.fog.color.setHex(this.def.fog);
      renderer.scene.fog.density = this.def.fogDensity;
    }
    if (renderer.scene.background?.setHex) renderer.scene.background.setHex(this.def.fog);
    if (renderer.ambientLight) renderer.ambientLight.intensity = 1.1;
    if (renderer.sunLight) renderer.sunLight.intensity = 0;
  }

  update(pos, dt, p, audio) {
    const cx = Math.floor(pos.x / CH), cz = Math.floor(pos.z / CH), key = cx + ',' + cz;
    if (key !== this._ck) {
      this._ck = key;
      const want = new Set();
      for (let i = -LOAD; i <= LOAD; i++)
        for (let j = -LOAD; j <= LOAD; j++) {
          const k = (cx + i) + ',' + (cz + j);
          want.add(k);
          if (!this.chunks.has(k)) {
            const c = this.def.buildChunk(cx + i, cz + j);
            this.r.scene.add(c.group);
            this.chunks.set(k, c);
          }
        }
      for (const [k, c] of this.chunks) {
        if (want.has(k)) continue;
        this.r.scene.remove(c.group);
        c.group.traverse((o) => {
          if (o.geometry && o.geometry !== boxGeo) o.geometry.dispose();
        });
        this.chunks.delete(k);
      }
      Object.assign(this.spatial, buildSpatialGrid([...this.chunks.values()].flatMap((c) => c.walls)));
    }
    if (p && p.alive !== false) p.sanity = Math.max(0, (p.sanity ?? 100) - this.def.drain * dt);
    this._hum(audio, p);
  }

  _hum(audio, p) {
    if (!this.hum && audio?.ctx) {
      const ctx = audio.ctx, g = ctx.createGain();
      g.gain.value = 0.04;
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      a.frequency.value = this.def.humHz;
      b.frequency.value = this.def.humHz * 2.01;
      a.connect(g); b.connect(g);
      g.connect(audio.sfx || audio.master || ctx.destination);
      a.start(); b.start();
      this.hum = { a, b, g };
    }
    if (this.hum) this.hum.g.gain.value = 0.04 + (1 - (p?.sanity ?? 100) / 100) * 0.08;
  }

  dispose() {
    try { this.hum?.a.stop(); this.hum?.b.stop(); } catch (e) { /* */ }
    for (const c of this.chunks.values()) this.r.scene.remove(c.group);
    this.chunks.clear();
  }
}
