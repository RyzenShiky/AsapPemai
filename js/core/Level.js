import * as THREE from 'three';
import { buildSpatialGrid } from './Collision.js';
import { WORLD_FLAGS } from './WorldConfig.js';

const CH = 24, CELL = 6, WALL_H = 3.2, LOAD = 3;
const WALL_P = 0.4, WALL_LEN = CELL * 0.7, GAP = CELL * 0.85;

const h = (a, b, c) => {
  let x = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + c, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};
const wallN = (i, j) => h(i * CELL, j * CELL, 1) < WALL_P;
const wallW = (i, j) => h(i * CELL, j * CELL, 2) < WALL_P;

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const planeGeo = new THREE.PlaneGeometry(CH, CH).rotateX(-Math.PI / 2);

const speckle = (g, s, n, a) => {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() * 255) | 0;
    g.fillStyle = `rgba(${v},${v},${v},${a})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
};
const drawWall = (g, s) => {
  g.fillStyle = '#c9b458'; g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgba(110,90,30,.16)';
  for (let x = 0; x < s; x += 32) g.fillRect(x, 0, 10, s);
  g.fillStyle = 'rgba(60,45,10,.4)'; g.fillRect(0, s - 14, s, 14);
  speckle(g, s, 2500, 0.06);
};
const drawCarpet = (g, s) => {
  g.fillStyle = '#8a7a3a'; g.fillRect(0, 0, s, s);
  speckle(g, s, 9000, 0.12);
};
const drawCeil = (g, s) => {
  g.fillStyle = '#d9d2ac'; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(70,60,30,.55)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, s - 3, s - 3);
  g.fillStyle = 'rgba(255,250,215,.5)'; g.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.4);
  speckle(g, s, 1500, 0.05);
};
const makeTex = (draw, rx, ry) => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  draw(c.getContext('2d'), 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
let MATS = null;
const mats = () => (MATS ??= {
  wall: new THREE.MeshStandardMaterial({ map: makeTex(drawWall, WALL_LEN / 2, 1), roughness: 1 }),
  floor: new THREE.MeshStandardMaterial({ map: makeTex(drawCarpet, CH / 1.5, CH / 1.5), roughness: 1, side: THREE.DoubleSide }),
  ceil: new THREE.MeshStandardMaterial({ map: makeTex(drawCeil, CH / 1.5, CH / 1.5), roughness: 1, side: THREE.DoubleSide }),
});

export function spawnCell(pos, min = 25, max = 70) {
  const a = Math.random() * 6.283;
  const r = min + Math.random() * (max - min);
  const i = Math.floor((pos.x + Math.cos(a) * r) / CELL);
  const j = Math.floor((pos.z + Math.sin(a) * r) / CELL);
  return { x: (i + 0.5) * CELL, y: 0, z: (j + 0.5) * CELL };
}
export function patrolPoint(pos) {
  return spawnCell(pos, 15, 40);
}

// ---------- A* per-sel ----------
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    let c = a.length;
    a.push(n);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (a[p].f <= n.f) break;
      a[c] = a[p]; c = p;
    }
    a[c] = n;
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      let p = 0;
      for (;;) {
        let c = 2 * p + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
        if (a[c].f >= last.f) break;
        a[p] = a[c]; p = c;
      }
      a[p] = last;
    }
    return top;
  }
}
const ck = (i, j) => i * 65536 + j;

export function cellPath(start, goal, maxNodes = 700) {
  const si = Math.floor(start.x / CELL), sj = Math.floor(start.z / CELL);
  const gi = Math.floor(goal.x / CELL), gj = Math.floor(goal.z / CELL);
  if (si === gi && sj === gj) return [{ x: goal.x, z: goal.z }];
  const hc = (i, j) => (Math.abs(i - gi) + Math.abs(j - gj)) * CELL;
  const open = new MinHeap(), closed = new Set(), info = new Map();
  const sk = ck(si, sj);
  info.set(sk, { g: 0, p: null, gap: null, i: si, j: sj });
  open.push({ i: si, j: sj, g: 0, f: hc(si, sj) });
  let best = sk, bestH = hc(si, sj), reached = false, n = 0;
  while (open.size && n++ < maxNodes) {
    const cur = open.pop(), k = ck(cur.i, cur.j);
    if (closed.has(k)) continue;
    closed.add(k);
    const hh = hc(cur.i, cur.j);
    if (hh < bestH) { bestH = hh; best = k; }
    if (cur.i === gi && cur.j === gj) { best = k; reached = true; break; }
    const { i, j } = cur;
    const nb = [
      [i, j - 1, wallN(i, j), i * CELL + GAP, j * CELL],
      [i, j + 1, wallN(i, j + 1), i * CELL + GAP, (j + 1) * CELL],
      [i - 1, j, wallW(i, j), i * CELL, j * CELL + GAP],
      [i + 1, j, wallW(i + 1, j), (i + 1) * CELL, j * CELL + GAP],
    ];
    for (const [ni, nj, wall, gx, gz] of nb) {
      const nk = ck(ni, nj);
      if (closed.has(nk)) continue;
      const g = cur.g + CELL + (wall ? 1.5 : 0);
      const old = info.get(nk);
      if (old && old.g <= g) continue;
      info.set(nk, { g, p: k, gap: wall ? { x: gx, z: gz } : null, i: ni, j: nj });
      open.push({ i: ni, j: nj, g, f: g + hc(ni, nj) });
    }
  }
  if (best === sk) return null;
  const out = [];
  for (let k = best; k !== sk;) {
    const nd = info.get(k);
    out.push({ x: (nd.i + 0.5) * CELL, z: (nd.j + 0.5) * CELL });
    if (nd.gap) out.push(nd.gap);
    k = nd.p;
  }
  out.reverse();
  out.unshift({ x: (si + 0.5) * CELL, z: (sj + 0.5) * CELL });
  if (reached) out.push({ x: goal.x, z: goal.z });
  return out;
}

export const LEVELS = {};
export const registerLevel = (id, def) => { LEVELS[id] = def; };

registerLevel('backrooms0', {
  fog: 0x8f8140, fogDensity: 0.022, humHz: 60, drain: 0.8,
  buildChunk(cx, cz) {
    const x0 = cx * CH, z0 = cz * CH, walls = [], m = mats();
    for (let x = x0; x < x0 + CH; x += CELL)
      for (let z = z0; z < z0 + CH; z += CELL) {
        const i = x / CELL, j = z / CELL;
        if (wallN(i, j)) walls.push({ type: 'wall', minX: x, maxX: x + WALL_LEN, minZ: z - 0.15, maxZ: z + 0.15 });
        if (wallW(i, j)) walls.push({ type: 'wall', minX: x - 0.15, maxX: x + 0.15, minZ: z, maxZ: z + WALL_LEN });
      }
    const group = new THREE.Group();
    const im = new THREE.InstancedMesh(boxGeo, m.wall, Math.max(1, walls.length));
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    walls.forEach((w, k) => {
      p.set((w.minX + w.maxX) / 2, WALL_H / 2, (w.minZ + w.maxZ) / 2);
      sc.set(w.maxX - w.minX, WALL_H, w.maxZ - w.minZ);
      im.setMatrixAt(k, mt.compose(p, q, sc));
    });
    im.count = walls.length;
    im.instanceMatrix.needsUpdate = true;
    const floor = new THREE.Mesh(planeGeo, m.floor);
    floor.position.set(x0 + CH / 2, 0.03, z0 + CH / 2);
    const ceil = new THREE.Mesh(planeGeo, m.ceil);
    ceil.position.set(x0 + CH / 2, WALL_H, z0 + CH / 2);
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
    this.spatial.levelPath = cellPath;
    this.spawn = (pos, min = 20, max = 70) => spawnCell(pos, min, Math.min(max, 70));
    this.patrol = patrolPoint;
    this._ck = '';
    this.hum = null;
    WORLD_FLAGS.endless = true;
    for (const o of [
      renderer.ground, renderer.treeGroup, renderer.rockGroup, renderer.buildingGroup,
      renderer.roadMesh, renderer.lampPoles, renderer.lampHeads, renderer.lampBulbs,
      renderer.riverMesh, renderer.landmarkGroup,
    ]) {
      if (o) o.visible = false;
    }
    if (renderer.scene.fog) {
      renderer.scene.fog.color.setHex(this.def.fog);
      renderer.scene.fog.density = this.def.fogDensity;
    }
    if (renderer.scene.background?.setHex) renderer.scene.background.setHex(this.def.fog);
    if (renderer.ambientLight) {
      renderer.ambientLight.intensity = 0.35;
      renderer.ambientLight.color.setHex(0xfff0c0);
    }
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
          if (o.isInstancedMesh) o.dispose();
          else if (o.geometry && o.geometry !== planeGeo && o.geometry !== boxGeo) o.geometry.dispose();
        });
        this.chunks.delete(k);
      }
      Object.assign(this.spatial, buildSpatialGrid([...this.chunks.values()].flatMap((c) => c.walls)));
      this.spatial.levelPath = cellPath;
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
    for (const c of this.chunks.values()) {
      this.r.scene.remove(c.group);
      c.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    }
    this.chunks.clear();
    WORLD_FLAGS.endless = false;
  }
}
