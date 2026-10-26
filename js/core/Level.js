import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildSpatialGrid } from './Collision.js';
import { WORLD_FLAGS } from './WorldConfig.js';

/* ======================= TUNING ======================= */
const CELL = 4.8;
const CH = 24;
const CPC = Math.round(CH / CELL);
const WALL_H = 2.8;
const WALL_HT = 0.15;
const WALL_LEN = CELL * 0.62;
const PILLAR_HW = 0.45;
const LOAD = 3;
const STYLE_R = 7;
const DARK_R = 48;
const LAMP_X = 3.0, LAMP_Z = 2.4;
const LAMP_NX = Math.round(CH / LAMP_X);
const LAMP_NZ = Math.round(CH / LAMP_Z);
const AMBIENT = 2.2;
const POOL_I = 12;
const POOL_DIST = 10;
const HUM_BASE = 0.05;

/* ============================ HASH & LAYOUT ============================ */
const h = (a, b, c) => {
  let x = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + c, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};

const HALL = 0, CORR_X = 1, CORR_Z = 2, ROOMS = 3, MAZE = 4;
const DENS = [[0.05, 0.05], [0.85, 0.07], [0.07, 0.85], [0.5, 0.5], [0.65, 0.65]];

const style = (i, j) => {
  const r = h(Math.floor(i / STYLE_R), Math.floor(j / STYLE_R), 7);
  if (r < 0.15) return HALL;
  if (r < 0.32) return CORR_X;
  if (r < 0.49) return CORR_Z;
  if (r < 0.80) return ROOMS;
  return MAZE;
};
const spawnClear = (i, j) => i >= -1 && i <= 2 && j >= 0 && j <= 3;

const edge = (i, j, axis) => {
  if (spawnClear(i, j)) return 0;
  const p = DENS[style(i, j)][axis - 1];
  if (h(i * 7 + 3, j * 13 + 5, axis) >= p) return 0;
  return h(i * 5 + 1, j * 11 + 9, axis + 10) < 0.5 ? 1 : 2;
};
const edgeN = (i, j) => edge(i, j, 1);
const edgeW = (i, j) => edge(i, j, 2);
const gapOff = (t) => (t === 1 ? (WALL_LEN + CELL) / 2 : (CELL - WALL_LEN) / 2);
const gapN = (i, j) => { const t = edgeN(i, j); return t ? { x: i * CELL + gapOff(t), z: j * CELL } : null; };
const gapW = (i, j) => { const t = edgeW(i, j); return t ? { x: i * CELL, z: j * CELL + gapOff(t) } : null; };

/* ============================ LAMPU NEON ============================ */
const ON = 0, FLK = 1, DEAD = 2;
const lampX = (gx) => gx * LAMP_X + LAMP_X / 2;
const lampZ = (gz) => gz * LAMP_Z + 0.6;
const lampId = (gx, gz) => (Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663)) | 0;

const dval = (a, b) => { const r = h(a, b, 31); return r < 0.10 ? 1 : r < 0.24 ? 0.5 : 0; };
const smooth = (t) => t * t * (3 - 2 * t);
const darkness = (x, z) => {
  const u = x / DARK_R - 0.5, v = z / DARK_R - 0.5;
  const a = Math.floor(u), b = Math.floor(v);
  const su = smooth(u - a), sv = smooth(v - b);
  const d = (dval(a, b) * (1 - su) + dval(a + 1, b) * su) * (1 - sv) +
            (dval(a, b + 1) * (1 - su) + dval(a + 1, b + 1) * su) * sv;
  const near = Math.min(1, Math.max(0, (Math.hypot(x - 1.5, z - 7.5) - 40) / 40));
  return d * near;
};
const lampKind = (gx, gz) => {
  const d = darkness(lampX(gx), lampZ(gz));
  const r = h(gx, gz, 21);
  const dead = 0.025 + 0.92 * d;
  if (r < dead) return DEAD;
  if (r < dead + 0.07) return FLK;
  return ON;
};
const flick = (id, t) => {
  const u = (id >>> 0) / 4294967296;
  const P = 3 + u * 7;
  if ((t + u * 97) % P > 0.9) return 1;
  return h(Math.floor(t * 28), id, 5) > 0.45 ? 1 : 0.1;
};

/* ============================ TEKSTUR ============================ */
const rnd = Math.random;
const speckle = (g, s, n, a, sz = 2) => {
  for (let i = 0; i < n; i++) {
    const v = (rnd() * 255) | 0;
    g.fillStyle = `rgba(${v},${v},${v},${a})`;
    g.fillRect(rnd() * s, rnd() * s, sz, sz);
  }
};
const blob = (g, s, x, y, r, rgb, a) => {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const X = x + dx * s, Y = y + dy * s;
    const gr = g.createRadialGradient(X, Y, 0, X, Y, r);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(X - r, Y - r, r * 2, r * 2);
  }
};

const drawWall = (g, s) => {
  g.fillStyle = '#cbb95a'; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 16) {
    g.fillStyle = 'rgba(120,100,25,.10)'; g.fillRect(x, 0, 6, s);
    g.fillStyle = 'rgba(255,240,150,.07)'; g.fillRect(x + 8, 0, 2, s);
  }
  g.strokeStyle = 'rgba(120,100,30,.07)'; g.lineWidth = 1;
  for (let y = 0; y < s; y += 64) for (let x = 0; x < s; x += 64) {
    g.beginPath();
    g.moveTo(x + 32, y + 12); g.lineTo(x + 52, y + 32);
    g.lineTo(x + 32, y + 52); g.lineTo(x + 12, y + 32);
    g.closePath(); g.stroke();
  }
  for (let k = 0; k < 5; k++) {
    const w = 10 + rnd() * 30, x = rnd() * (s - w), len = s * (0.25 + rnd() * 0.4);
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, 'rgba(90,70,15,.22)'); gr.addColorStop(1, 'rgba(90,70,15,0)');
    g.fillStyle = gr; g.fillRect(x, 0, w, len);
  }
  const gb = g.createLinearGradient(0, s - 150, 0, s - 18);
  gb.addColorStop(0, 'rgba(60,45,10,0)'); gb.addColorStop(1, 'rgba(60,45,10,.35)');
  g.fillStyle = gb; g.fillRect(0, s - 150, s, 132);
  const gt = g.createLinearGradient(0, 0, 0, 40);
  gt.addColorStop(0, 'rgba(70,55,10,.25)'); gt.addColorStop(1, 'rgba(70,55,10,0)');
  g.fillStyle = gt; g.fillRect(0, 0, s, 40);
  g.fillStyle = '#4a3f1c'; g.fillRect(0, s - 18, s, 18);
  g.fillStyle = 'rgba(255,235,150,.35)'; g.fillRect(0, s - 20, s, 2);
  speckle(g, s, 7000, 0.05, 1.5);
};
const drawCarpet = (g, s) => {
  g.fillStyle = '#857636'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 10; i++) blob(g, s, rnd() * s, rnd() * s, 60 + rnd() * 90, '50,40,12', 0.2);
  for (let i = 0; i < 6; i++) blob(g, s, rnd() * s, rnd() * s, 50 + rnd() * 80, '170,150,70', 0.1);
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(40,30,5,.18)' : 'rgba(190,170,90,.14)';
    g.fillRect(rnd() * s, rnd() * s, 1, 2 + rnd() * 2);
  }
};
const drawCeil = (g, s) => {
  g.fillStyle = '#d6cda3'; g.fillRect(0, 0, s, s);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '120,100,40' : '255,250,210'},${0.03 + rnd() * 0.05})`;
    g.fillRect(c * 128, r * 256, 128, 256);
  }
  for (let i = 0; i < 2200; i++) { g.fillStyle = 'rgba(70,60,30,.35)'; g.fillRect(rnd() * s, rnd() * s, 1, 1); }
  for (let i = 0; i < 4; i++) blob(g, s, rnd() * s, rnd() * s, 40 + rnd() * 60, '110,85,30', 0.15);
  g.fillStyle = '#6d6538';
  for (let c = 0; c <= 4; c++) g.fillRect(c * 128 - 2, 0, 4, s);
  for (let r = 0; r <= 2; r++) g.fillRect(0, r * 256 - 2, s, 4);
};
const makeTex = (draw, rx, ry) => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  draw(c.getContext('2d'), 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const planeGeo = new THREE.PlaneGeometry(CH, CH).rotateX(-Math.PI / 2);
const lampGeo = new THREE.PlaneGeometry(0.56, 1.16).rotateX(Math.PI / 2);

let MATS = null;
const mats = () => {
  if (MATS) return MATS;
  const wt = makeTex(drawWall, WALL_LEN / 2, 1);
  const pt = wt.clone();
  pt.repeat.set((PILLAR_HW * 2) / 2, 1);
  pt.needsUpdate = true;
  MATS = {
    wall: new THREE.MeshStandardMaterial({ map: wt, roughness: 1 }),
    pillar: new THREE.MeshStandardMaterial({ map: pt, roughness: 1 }),
    floors: [0, 1, 2].map(() => new THREE.MeshStandardMaterial({
      map: makeTex(drawCarpet, CH / 2, CH / 2), roughness: 1, side: THREE.DoubleSide,
    })),
    ceil: new THREE.MeshStandardMaterial({
      map: makeTex(drawCeil, CH / 2.4, CH / 2.4), roughness: 0.95, side: THREE.DoubleSide,
    }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }),
  };
  return MATS;
};
const C_ON = new THREE.Color(1, 0.97, 0.82);
const C_DEAD = new THREE.Color(0.28, 0.27, 0.2);
const C_DIM = new THREE.Color(0.22, 0.21, 0.15);

/* ============================ SPAWN & A* ============================ */
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
      [i, j - 1, gapN(i, j)],
      [i, j + 1, gapN(i, j + 1)],
      [i - 1, j, gapW(i, j)],
      [i + 1, j, gapW(i + 1, j)],
    ];
    for (const [ni, nj, gap] of nb) {
      const nk = ck(ni, nj);
      if (closed.has(nk)) continue;
      const g = cur.g + CELL + (gap ? 1.5 : 0);
      const old = info.get(nk);
      if (old && old.g <= g) continue;
      info.set(nk, { g, p: k, gap, i: ni, j: nj });
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

/* ============================ LEVEL 0 ============================ */
export const LEVELS = {};
export const registerLevel = (id, def) => { LEVELS[id] = def; };

registerLevel('backrooms0', {
  fog: 0xa59744, fogDensity: 0.02, humHz: 60, drain: 0.8,
  buildChunk(cx, cz) {
    const m = mats(), x0 = cx * CH, z0 = cz * CH;
    const i0 = cx * CPC, j0 = cz * CPC;
    const walls = [], wTint = [], pillars = [], pTint = [];

    for (let i = i0; i < i0 + CPC; i++) {
      for (let j = j0; j < j0 + CPC; j++) {
        const px = i * CELL, pz = j * CELL;
        const tn = edgeN(i, j);
        if (tn) {
          const a = px + (tn === 1 ? 0 : CELL - WALL_LEN);
          walls.push({ type: 'wall', minX: a, maxX: a + WALL_LEN, minZ: pz - WALL_HT, maxZ: pz + WALL_HT });
          wTint.push(h(i, j, 41));
        }
        const tw = edgeW(i, j);
        if (tw) {
          const a = pz + (tw === 1 ? 0 : CELL - WALL_LEN);
          walls.push({ type: 'wall', minX: px - WALL_HT, maxX: px + WALL_HT, minZ: a, maxZ: a + WALL_LEN });
          wTint.push(h(i, j, 42));
        }
        if (style(i, j) === HALL && !spawnClear(i, j) && (i & 1) === 0 && (j & 1) === 0 &&
            h(i, j, 51) < 0.75 &&
            !edgeN(i, j) && !edgeN(i - 1, j) && !edgeW(i, j) && !edgeW(i, j - 1)) {
          pillars.push({ type: 'wall', minX: px - PILLAR_HW, maxX: px + PILLAR_HW, minZ: pz - PILLAR_HW, maxZ: pz + PILLAR_HW });
          pTint.push(h(i, j, 52));
        }
      }
    }

    const group = new THREE.Group();
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();

    const buildBoxes = (list, tints, mat, hgt) => {
      const im = new THREE.InstancedMesh(boxGeo, mat, Math.max(1, list.length));
      list.forEach((w, k) => {
        p.set((w.minX + w.maxX) / 2, hgt / 2, (w.minZ + w.maxZ) / 2);
        sc.set(w.maxX - w.minX, hgt, w.maxZ - w.minZ);
        im.setMatrixAt(k, mt.compose(p, q, sc));
        const v = 0.86 + tints[k] * 0.14;
        im.setColorAt(k, col.setRGB(v, v * 0.99, v * 0.95));
      });
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      return im;
    };
    group.add(buildBoxes(walls, wTint, m.wall, WALL_H));
    if (pillars.length) group.add(buildBoxes(pillars, pTint, m.pillar, WALL_H));

    const floor = new THREE.Mesh(planeGeo, m.floors[Math.floor(h(cx, cz, 3) * 3) % 3]);
    floor.position.set(x0 + CH / 2, 0.03, z0 + CH / 2);
    const ceil = new THREE.Mesh(planeGeo, m.ceil);
    ceil.position.set(x0 + CH / 2, WALL_H, z0 + CH / 2);
    group.add(floor, ceil);

    const lampMesh = new THREE.InstancedMesh(lampGeo, m.lamp, LAMP_NX * LAMP_NZ);
    const flk = [];
    let n = 0;
    for (let gx = cx * LAMP_NX; gx < (cx + 1) * LAMP_NX; gx++) {
      for (let gz = cz * LAMP_NZ; gz < (cz + 1) * LAMP_NZ; gz++) {
        p.set(lampX(gx), WALL_H - 0.015, lampZ(gz));
        lampMesh.setMatrixAt(n, mt.compose(p, q, sc.set(1, 1, 1)));
        const k = lampKind(gx, gz);
        lampMesh.setColorAt(n, k === DEAD ? C_DEAD : C_ON);
        if (k === FLK) flk.push({ idx: n, id: lampId(gx, gz), on: true });
        n++;
      }
    }
    lampMesh.instanceMatrix.needsUpdate = true;
    if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
    lampMesh.computeBoundingSphere();
    group.add(lampMesh);

    return { group, walls: walls.concat(pillars), lamps: { mesh: lampMesh, flick: flk } };
  },
});


/* ====================== LEVEL 37 — POOLROOMS ====================== */
const P_H = 3.8, P_WT = 0.15, P_DOOR = 2.4, P_DOOR_H = 2.5, P_COL = 0.42, P_SEG = 30;
const P_TILE = 2.4, P_WATER = 0, P_BASE = 0.14, P_SLOPE = 2.4, P_DEEP = 0.95, P_FLOOR = -1.3;
const P_AMB = 2.5, P_LIGHT = 22, P_GRID = 8;
const P_HALL = 0, P_LANES = 1, P_ROUND = 2, P_FLOOD = 3;

const pmod = (a, n) => ((a % n) + n) % n;
const sstep = (a, b, x) => smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));

const pType = (cx, cz) => {
  if (cz === 0 && (cx === 0 || cx === -1)) return P_HALL;
  const r = h(cx, cz, 371);
  return r < 0.28 ? P_HALL : r < 0.50 ? P_LANES : r < 0.72 ? P_ROUND : P_FLOOD;
};

const pPool = (x, z) => {
  const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
  const u = x - cx * CH, v = z - cz * CH, t = pType(cx, cz);
  if (t === P_HALL) {
    const ins = 5.4 + h(cx, cz, 372) * 1.2;
    return P_DEEP * sstep(0, P_SLOPE, Math.min(u - ins, CH - ins - u, v - ins, CH - ins - v));
  }
  if (t === P_LANES) {
    const [a, b] = h(cx, cz, 373) < 0.5 ? [u, v] : [v, u];
    const lane = (b0, b1) => Math.min(a - 3.6, CH - 3.6 - a, b - b0, b1 - b);
    return P_DEEP * 0.9 * sstep(0, P_SLOPE, Math.max(lane(3.6, 8.4), lane(15.6, 20.4)));
  }
  if (t === P_ROUND) {
    const R = 7.2 + h(cx, cz, 374) * 1.2;
    return P_DEEP * sstep(0, P_SLOPE, R - Math.hypot(u - 12, v - 12));
  }
  const edgeD = Math.min(u, v, CH - u, CH - v);
  const hx = 8.4 + h(cx, cz, 375) * 7.2, hz = 8.4 + h(cx, cz, 376) * 7.2;
  return 0.3 * sstep(0, 3, edgeD) + 0.45 * sstep(0, 2.4, 3.2 - Math.hypot(u - hx, v - hz));
};
const pDepth = (x, z) => P_BASE + pPool(x, z);

const pInner = (i, j, ax) => {
  if (h(i * 7 + 3, j * 13 + 5, ax + 390) >= 0.34) return 0;
  return h(i * 5 + 1, j * 11 + 9, ax + 395) < 0.7 ? 2 : 1;
};
const pEdge = (i, j, ax) => {
  const bi = pmod(i, CPC), bj = pmod(j, CPC), ci = Math.floor(i / CPC), cj = Math.floor(j / CPC);
  const k = ax === 1 ? bi : bj;
  if ((ax === 1 ? bj : bi) === 0) {
    if (h(ci, cj, 380 + ax) < 0.28) return k >= 1 && k <= 3 ? 3 : 1;
    return k === 2 ? 2 : 1;
  }
  return pType(ci, cj) === P_FLOOD ? pInner(i, j, ax) : 0;
};

function path37(start, goal, maxNodes = 700) {
  const si = Math.floor(start.x / CELL), sj = Math.floor(start.z / CELL);
  const gi = Math.floor(goal.x / CELL), gj = Math.floor(goal.z / CELL);
  if (si === gi && sj === gj) return [{ x: goal.x, z: goal.z }];
  const hc = (i, j) => (Math.abs(i - gi) + Math.abs(j - gj)) * CELL;
  const open = new MinHeap(), closed = new Set(), info = new Map(), sk = ck(si, sj);
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
    for (const [ni, nj, e, gx, gz] of [
      [i, j - 1, pEdge(i, j, 1), i * CELL + CELL / 2, j * CELL],
      [i, j + 1, pEdge(i, j + 1, 1), i * CELL + CELL / 2, (j + 1) * CELL],
      [i - 1, j, pEdge(i, j, 2), i * CELL, j * CELL + CELL / 2],
      [i + 1, j, pEdge(i + 1, j, 2), (i + 1) * CELL, j * CELL + CELL / 2],
    ]) {
      if (e === 1) continue;
      const nk = ck(ni, nj), g = cur.g + CELL + (e === 2 ? 1.5 : 0), old = info.get(nk);
      if (closed.has(nk) || (old && old.g <= g)) continue;
      info.set(nk, { g, p: k, gap: e === 2 ? { x: gx, z: gz } : null, i: ni, j: nj });
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

const pdrawTile = (g, s, band) => {
  const n = 4, t = s / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = 230 + ((rnd() * 10) | 0), blue = band && r === n - 1;
    g.fillStyle = blue ? `rgb(${v - 40},${v - 6},${v - 2})` : `rgb(${v},${v + 6},${v + 6})`;
    g.fillRect(c * t, r * t, t, t);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(c * t, r * t, t, 3); g.fillRect(c * t, r * t, 3, t);
    g.fillStyle = 'rgba(60,100,110,.18)'; g.fillRect(c * t, (r + 1) * t - 4, t, 4); g.fillRect((c + 1) * t - 4, r * t, 4, t);
  }
  g.fillStyle = '#a9bcbd';
  for (let k = 0; k <= n; k++) { g.fillRect(k * t - 1.5, 0, 3, s); g.fillRect(0, k * t - 1.5, s, 3); }
  speckle(g, s, 3500, 0.05, 1.5);
};
const pdrawWater = (g, s) => {
  g.fillStyle = 'rgb(118,204,214)'; g.fillRect(0, 0, s, s);
  g.lineWidth = 2;
  for (let k = 0; k < 110; k++) {
    const x = rnd() * s, y = rnd() * s, r = 12 + rnd() * 34, q = 0.4 + rnd() * 0.4, a = rnd() * 3.14;
    g.strokeStyle = `rgba(255,255,255,${0.1 + rnd() * 0.16})`;
    for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
      g.beginPath(); g.ellipse(x + dx, y + dy, r, r * q, a, 0, 6.283); g.stroke();
    }
  }
};

let PM = null;
const pMats = () => {
  if (PM) return PM;
  PM = {
    floor: new THREE.MeshStandardMaterial({ map: makeTex((g, s) => pdrawTile(g, s, false), CH / P_TILE, CH / P_TILE), vertexColors: true, roughness: 0.3, metalness: 0.05 }),
    wall: new THREE.MeshStandardMaterial({ map: makeTex((g, s) => pdrawTile(g, s, true), 1, 1), roughness: 0.38 }),
    ceil: new THREE.MeshBasicMaterial({ map: makeTex((g, s) => pdrawTile(g, s, false), CH / P_TILE, CH / P_TILE), color: 0xe6f6f6, side: THREE.DoubleSide }),
    water: new THREE.MeshStandardMaterial({
      map: makeTex(pdrawWater, CH / 12, CH / 12), color: 0xb8f0f2, transparent: true, opacity: 0.55,
      roughness: 0.05, metalness: 0.15, depthWrite: false, emissive: 0x1c6f78, emissiveIntensity: 0.55,
    }),
  };
  return PM;
};

const ptbox = (x0, x1, y0, y1, z0, z1) => {
  const g = boxGeo.clone();
  g.scale(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  for (let k = 0; k < P.count; k++) {
    const x = P.getX(k), y = P.getY(k), z = P.getZ(k);
    if (Math.abs(N.getX(k)) > 0.5) U.setXY(k, z / P_TILE, y / P_TILE);
    else if (Math.abs(N.getY(k)) > 0.5) U.setXY(k, x / P_TILE, z / P_TILE);
    else U.setXY(k, x / P_TILE, y / P_TILE);
  }
  return g;
};

const pOut = (a) => a.sfx || a.master || a.ctx.destination;
const pAmbience = (audio) => {
  const ctx = audio.ctx, out = ctx.createGain(), src = [];
  out.gain.value = 0; out.connect(pOut(audio));
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const noise = (type, f, q, gain) => {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), gn = ctx.createGain();
    s.buffer = buf; s.loop = true; fl.type = type; fl.frequency.value = f; fl.Q.value = q; gn.gain.value = gain;
    s.connect(fl); fl.connect(gn); gn.connect(out); s.start(); src.push(s);
  };
  noise('bandpass', 650, 0.5, 0.06);
  noise('lowpass', 110, 0.7, 0.6);
  const hum = ctx.createOscillator(), hg = ctx.createGain();
  hum.type = 'sine'; hum.frequency.value = 50; hg.gain.value = 0.05; hum.connect(hg); hg.connect(out); hum.start(); src.push(hum);
  const ir = ctx.createBuffer(2, ctx.sampleRate * 2.8, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const a = ir.getChannelData(c);
    for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / a.length, 2.6);
  }
  const conv = ctx.createConvolver(), wet = ctx.createGain();
  conv.buffer = ir; wet.gain.value = 0.9; conv.connect(wet); wet.connect(pOut(audio));
  return { out, src, buf, conv, wet };
};
const pDrip = (audio, A) => {
  const ctx = audio.ctx, now = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = 900 + Math.random() * 900;
  o.type = 'sine'; o.frequency.setValueAtTime(f, now); o.frequency.exponentialRampToValueAtTime(f * 0.45, now + 0.14);
  g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.09, now + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  o.connect(g); g.connect(A.conv); g.connect(A.out);
  o.start(now); o.stop(now + 0.25);
};
const pSplash = (audio, A, depth) => {
  const ctx = audio.ctx, now = ctx.currentTime, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = A.buf; fl.type = 'bandpass'; fl.frequency.value = 1100 + Math.random() * 500; fl.Q.value = 0.8;
  g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.05 + 0.1 * depth, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  s.connect(fl); fl.connect(g); g.connect(pOut(audio)); g.connect(A.conv);
  s.start(now, Math.random() * 1.5, 0.25);
};

registerLevel('backrooms37', {
  mission: 'pool',
  fog: 0xbfe6e8, fogDensity: 0.024, humHz: 50, drain: 0.35, path: path37,

  setup(m) {
    WORLD_FLAGS.floorFn = (x, z) => -pDepth(x, z);
    m.r.ambientLight?.color.setHex(0xe4fbff);
    for (const s of m.pool) { s.L.color.setHex(0xeafdff); s.L.distance = 20; }
    m._p = { drip: 2, step: 0, A: null, lt: 0 };
  },

  tick(m, pos, dt, p, audio) {
    const S = m._p, amb = m.r.ambientLight;
    if (amb) amb.intensity += (P_AMB - amb.intensity) * Math.min(1, dt * 2);
    pMats().water.map.offset.set(m.t * 0.006, m.t * 0.004);

    const gx = Math.floor(pos.x / P_GRID), gz = Math.floor(pos.z / P_GRID), cand = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const lx = (gx + a + 0.5) * P_GRID, lz = (gz + b + 0.5) * P_GRID;
      cand.push({ lx, lz, d2: (lx - pos.x) ** 2 + (lz - pos.z) ** 2 });
    }
    cand.sort((u, v) => u.d2 - v.d2);
    const kk = 1 - Math.exp(-dt * 6);
    m.pool.forEach((s, n) => {
      const c = cand[n];
      if (!c) return;
      if (!s.init) { s.L.position.set(c.lx, P_H - 0.5, c.lz); s.init = true; }
      else { s.L.position.x += (c.lx - s.L.position.x) * kk; s.L.position.z += (c.lz - s.L.position.z) * kk; }
      s.L.intensity = P_LIGHT;
    });

    const d = pDepth(pos.x, pos.z);
    const w = d - P_BASE;
    if (p && !p.isHiding) p._weatherSpeed = 0.95 - 0.27 * Math.min(1, w / P_DEEP);

    if (!audio?.ctx) return;
    if (!S.A) S.A = pAmbience(audio);
    const A = S.A;
    A.out.gain.setTargetAtTime(0.5, audio.ctx.currentTime, 0.4);
    if ((S.drip -= dt) <= 0) { pDrip(audio, A); S.drip = 1.5 + Math.random() * 5; }
    if ((p?.moveState === 'walk' || p?.moveState === 'run') && (S.step -= dt) <= 0) {
      pSplash(audio, A, w); S.step = p.moveState === 'run' ? 0.3 : 0.52;
    }
  },

  teardown(m) {
    WORLD_FLAGS.floorFn = null;
    const A = m._p?.A;
    if (A) { try { A.src.forEach((s) => s.stop()); A.out.disconnect(); A.wet.disconnect(); } catch (e) { /* */ } }
  },

  buildChunk(cx, cz) {
    const M = pMats(), x0 = cx * CH, z0 = cz * CH, i0 = cx * CPC, j0 = cz * CPC, t = pType(cx, cz);
    const boxes = [], hit = [], geos = [];
    const solid = (a0, a1, b0, b1) => {
      boxes.push([a0, a1, P_FLOOR, P_H, b0, b1]);
      hit.push({ type: 'wall', minX: a0, maxX: a1, minZ: b0, maxZ: b1 });
    };
    const column = (x, z) => solid(x - P_COL, x + P_COL, z - P_COL, z + P_COL);
    const beam = (a0, a1, b0, b1, y0 = P_DOOR_H) => boxes.push([a0, a1, y0, P_H, b0, b1]);
    const da = (CELL - P_DOOR) / 2;

    for (let i = i0; i < i0 + CPC; i++) for (let j = j0; j < j0 + CPC; j++) {
      const px = i * CELL, pz = j * CELL;
      const eN = pEdge(i, j, 1), eW = pEdge(i, j, 2);
      if (eN === 1) solid(px - P_WT, px + CELL + P_WT, pz - P_WT, pz + P_WT);
      else if (eN === 2) {
        solid(px - P_WT, px + da, pz - P_WT, pz + P_WT);
        solid(px + da + P_DOOR, px + CELL + P_WT, pz - P_WT, pz + P_WT);
        beam(px + da, px + da + P_DOOR, pz - P_WT, pz + P_WT);
      } else if (eN === 3) {
        beam(px, px + CELL, pz - 0.25, pz + 0.25, 2.9);
        if (pmod(i, CPC) >= 2) column(px, pz);
      }
      if (eW === 1) solid(px - P_WT, px + P_WT, pz - P_WT, pz + CELL + P_WT);
      else if (eW === 2) {
        solid(px - P_WT, px + P_WT, pz - P_WT, pz + da);
        solid(px - P_WT, px + P_WT, pz + da + P_DOOR, pz + CELL + P_WT);
        beam(px - P_WT, px + P_WT, pz + da, pz + da + P_DOOR);
      } else if (eW === 3) {
        beam(px - 0.25, px + 0.25, pz, pz + CELL, 2.9);
        if (pmod(j, CPC) >= 2) column(px, pz);
      }
    }

    if (t === P_HALL) {
      const ins = 5.4 + h(cx, cz, 372) * 1.2, a = ins - 1.6, b = CH - ins + 1.6;
      for (const u of [a, 6, 18, b]) for (const v of [a, b]) column(x0 + u, z0 + v);
      for (const v of [6, 18]) { column(x0 + a, z0 + v); column(x0 + b, z0 + v); }
    } else if (t === P_LANES) {
      const hz = h(cx, cz, 373) < 0.5;
      for (const a of [6, 12, 18]) for (const b of [9.6, 14.4]) column(x0 + (hz ? a : b), z0 + (hz ? b : a));
    } else if (t === P_ROUND) {
      const R = 7.2 + h(cx, cz, 374) * 1.2;
      for (let k = 0; k < 8; k++) {
        const an = (k + 0.5) * Math.PI / 4;
        column(x0 + 12 + Math.cos(an) * (R + 2.2), z0 + 12 + Math.sin(an) * (R + 2.2));
      }
    }

    for (const b of boxes) geos.push(ptbox(...b));
    const group = new THREE.Group();
    const wallGeo = geos.length ? mergeGeometries(geos) : new THREE.BufferGeometry();
    geos.forEach((g) => g.dispose());
    if (wallGeo.attributes.position) group.add(new THREE.Mesh(wallGeo, M.wall));

    const fg = new THREE.PlaneGeometry(CH, CH, P_SEG, P_SEG).rotateX(-Math.PI / 2);
    const fp = fg.attributes.position, col = new Float32Array(fp.count * 3);
    for (let k = 0; k < fp.count; k++) {
      const d = pDepth(x0 + CH / 2 + fp.getX(k), z0 + CH / 2 + fp.getZ(k)), q = Math.min(1, (d - P_BASE) / P_DEEP);
      fp.setY(k, -d);
      col[k * 3] = 1 - 0.45 * q; col[k * 3 + 1] = 1 - 0.18 * q; col[k * 3 + 2] = 1 - 0.08 * q;
    }
    fg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    fg.computeVertexNormals();
    const floor = new THREE.Mesh(fg, M.floor);
    floor.position.set(x0 + CH / 2, 0, z0 + CH / 2);

    const wg = new THREE.PlaneGeometry(CH, CH).rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, M.water);
    water.position.set(x0 + CH / 2, P_WATER, z0 + CH / 2);
    water.renderOrder = 1;

    const cg = new THREE.PlaneGeometry(CH, CH).rotateX(Math.PI / 2);
    const ceil = new THREE.Mesh(cg, M.ceil);
    ceil.position.set(x0 + CH / 2, P_H, z0 + CH / 2);

    group.add(floor, water, ceil);
    return { group, walls: hit, dispose() { wallGeo.dispose(); fg.dispose(); wg.dispose(); cg.dispose(); } };
  },
});


/* ====================== DESERT — KOMPLEKS PIRAMIDA DJOSER ====================== */
const D_CH = 64, D_SEG = 24, D_FOG = 0xb98660;
const DJ = { cx: 0, cz: -500, hx: 138.8, hz: 272.45, wt: 3, wh: 10.5, gate: [120, 129], col: 54 };
const PYR = {
  x: 0, z: -470, batter: 0.3,
  tiers: [[60.5, 54.5, 11.6], [53.5, 47.9, 11.2], [46.5, 41.3, 10.7], [39.5, 34.7, 10.2], [32.5, 28.1, 9.7], [25.5, 21.5, 9.1]],
};
const D_SUN = new THREE.Vector3(0.25, 0.2, -0.95).normalize();
const clamp01 = (t) => Math.min(1, Math.max(0, t));

const vn = (x, z) => {
  const i = Math.floor(x), j = Math.floor(z), u = smooth(x - i), v = smooth(z - j);
  return (h(i, j, 91) * (1 - u) + h(i + 1, j, 91) * u) * (1 - v) + (h(i, j + 1, 91) * (1 - u) + h(i + 1, j + 1, 91) * u) * v;
};
const dunes = (x, z) => {
  const u = x * 0.8 + z * 0.6, w = -x * 0.6 + z * 0.8;
  const big = (vn(u / 70, w / 160) - 0.5) * 2;
  const ridge = 1 - Math.abs(vn(u / 34 + 9, w / 90) * 2 - 1);
  return big * 4.5 + ridge * ridge * 3.2 + (vn(u / 17 + 3, w / 40) - 0.5) * 1.4;
};
const pyrOut = (x, z) => Math.max(Math.abs(x - PYR.x) - PYR.tiers[0][0], Math.abs(z - PYR.z) - PYR.tiers[0][1]);
const flatMask = (x, z) => {
  const c = clamp01((Math.hypot(x, z - 8) - 30) / 45);
  const out = Math.max(Math.abs(x - DJ.cx) - DJ.hx, Math.abs(z - DJ.cz) - DJ.hz);
  return smooth(c) * smooth(clamp01(out / 45));
};
const rubble = (x, z) => {
  const out = pyrOut(x, z);
  if (out > 14 || out < -4) return 0;
  return 4.5 * (0.65 + 0.7 * vn(x / 6, z / 6)) * (1 - (out + 4) / 18) ** 2;
};
const pyrH = (x, z) => {
  const dx = Math.abs(x - PYR.x), dz = Math.abs(z - PYR.z);
  let y0 = 0, best = 0;
  for (const [ax, az, th] of PYR.tiers) {
    const b = th * PYR.batter;
    if (dx <= ax && dz <= az) best = Math.max(best, y0 + th * Math.min(1, (ax - dx) / b, (az - dz) / b));
    y0 += th;
  }
  return best;
};
const terrainH = (x, z) => dunes(x, z) * flatMask(x, z) + rubble(x, z);
const floorH = (x, z) => Math.max(terrainH(x, z), pyrH(x, z));

const inCx = (x, z, m = 0) => x > DJ.cx - DJ.hx - m && x < DJ.cx + DJ.hx + m && z > DJ.cz - DJ.hz - m && z < DJ.cz + DJ.hz + m;
const dWx0 = DJ.cx - DJ.hx, dWx1 = DJ.cx + DJ.hx, dWz0 = DJ.cz - DJ.hz, dWz1 = DJ.cz + DJ.hz;
const D_SLABS = [
  [dWx0 - DJ.wt, dWx1 + DJ.wt, dWz0 - DJ.wt, dWz0],
  [dWx0 - DJ.wt, dWx0, dWz0, dWz1],
  [dWx1, dWx1 + DJ.wt, dWz0, dWz1],
  [dWx0 - DJ.wt, DJ.gate[0], dWz1, dWz1 + DJ.wt],
  [DJ.gate[1], dWx1 + DJ.wt, dWz1, dWz1 + DJ.wt],
];
const D_COLN_WALLS = [
  [DJ.gate[0] - 3, DJ.gate[0], dWz1 - DJ.col, dWz1], [DJ.gate[1], DJ.gate[1] + 3, dWz1 - DJ.col, dWz1],
];
const D_COLS = [];
for (let k = 0; k < 10; k++) for (const x of [DJ.gate[0] + 0.9, DJ.gate[1] - 0.9]) D_COLS.push({ x, z: dWz1 - 4.5 - k * 5.4 });
const D_SHRINES = [];
for (let k = 0; k < 11; k++) for (const x of [92, 118]) D_SHRINES.push({ x, z: -540 + k * 14 });
const D_SERDAB = { x: 6, z: -534 };
const D_TENTS = [{ x: -9, z: 15 }, { x: 8, z: 17 }, { x: 11, z: 3 }, { x: -10, z: -3 }];
const aabb = (a, b, c, d) => ({ type: 'wall', minX: a, maxX: b, minZ: c, maxZ: d });
const D_FIXED = [
  ...D_SLABS.map((s) => aabb(...s)), ...D_COLN_WALLS.map((s) => aabb(...s)),
  ...D_COLS.map((c) => ({ type: 'rock', x: c.x, z: c.z, r: 0.65 })),
  ...D_SHRINES.map((s) => aabb(s.x - 2.2, s.x + 2.2, s.z - 2.2, s.z + 2.2)),
  aabb(D_SERDAB.x - 1.6, D_SERDAB.x + 1.6, D_SERDAB.z - 1.6, D_SERDAB.z + 1.6),
  ...D_TENTS.map((t) => ({ type: 'rock', x: t.x, z: t.z, r: 2 })),
];
const D_BLOCK = (x, z, m = 1) => D_FIXED.some((c) => (c.type === 'wall'
  ? x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m
  : Math.hypot(x - c.x, z - c.z) < c.r + m));
const dSpawn = (pos, min = 25, max = 70) => {
  for (let k = 0; k < 10; k++) {
    const a = Math.random() * 6.283, r = min + Math.random() * (max - min);
    const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
    if (!D_BLOCK(x, z, 2)) return { x, y: 0, z };
  }
  return { x: pos.x + min, y: 0, z: pos.z };
};
const GATE_OUT = { x: (DJ.gate[0] + DJ.gate[1]) / 2, z: dWz1 + 10 };
const GATE_IN = { x: GATE_OUT.x, z: dWz1 - DJ.col - 8 };
const dPath = (s, g) => {
  const a = inCx(s.x, s.z), b = inCx(g.x, g.z), goal = { x: g.x, z: g.z };
  if (a === b) return [goal];
  return b ? [GATE_OUT, GATE_IN, goal] : [GATE_IN, GATE_OUT, goal];
};

const drawSand = (g, s) => { g.fillStyle = '#e6dfd0'; g.fillRect(0, 0, s, s); speckle(g, s, 9000, 0.09, 2); };
const drawFacade = (g, s) => {
  g.fillStyle = '#d8cba8'; g.fillRect(0, 0, s, s);
  speckle(g, s, 6000, 0.07, 2);
  g.strokeStyle = 'rgba(110,90,55,.25)'; g.lineWidth = 1;
  for (let y = 0; y < s; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
  for (let k = 0; k < 2; k++) {
    const x = k * 256 + 40, w = 176;
    g.fillStyle = 'rgba(70,52,28,.38)'; g.fillRect(x, 70, w, 400);
    g.fillStyle = 'rgba(40,28,12,.5)'; g.fillRect(x, 70, 14, 400); g.fillRect(x, 70, w, 12);
    g.fillStyle = 'rgba(255,240,200,.35)'; g.fillRect(x + w - 8, 70, 8, 400);
    g.fillStyle = 'rgba(40,28,12,.28)';
    for (let r = x + 30; r < x + w - 20; r += 18) g.fillRect(r, 96, 6, 360);
  }
  const gb = g.createLinearGradient(0, s - 90, 0, s);
  gb.addColorStop(0, 'rgba(120,95,55,0)'); gb.addColorStop(1, 'rgba(120,95,55,.45)');
  g.fillStyle = gb; g.fillRect(0, s - 90, s, 90);
};
const drawStone = (g, s) => {
  g.fillStyle = '#d9ccaa'; g.fillRect(0, 0, s, s);
  for (let r = 0; r < 8; r++) {
    const y = r * 64; let x = -(r % 2) * 64 - rnd() * 20;
    while (x < s) {
      const w = 90 + rnd() * 80, v = 0.88 + rnd() * 0.2;
      g.fillStyle = `rgba(${(190 * v) | 0},${(172 * v) | 0},${(130 * v) | 0},.55)`;
      g.fillRect(x, y, w, 64);
      g.strokeStyle = 'rgba(70,55,30,.55)'; g.lineWidth = 3; g.strokeRect(x, y, w, 64);
      x += w;
    }
  }
  speckle(g, s, 9000, 0.1, 2);
  for (let i = 0; i < 8; i++) blob(g, s, rnd() * s, rnd() * s, 50 + rnd() * 80, '90,70,40', 0.12);
};
let DMATS = null;
const dmats = () => {
  if (DMATS) return DMATS;
  const sand = makeTex(drawSand, 10, 10);
  DMATS = {
    sand: new THREE.MeshStandardMaterial({ map: sand, vertexColors: true, roughness: 1 }),
    facade: new THREE.MeshStandardMaterial({ map: makeTex(drawFacade, 1, 1), roughness: 0.95 }),
    stone: new THREE.MeshStandardMaterial({ map: makeTex(drawStone, 1, 1), vertexColors: true, roughness: 0.95, flatShading: true }),
    plain: new THREE.MeshStandardMaterial({ color: 0xcdbd96, roughness: 0.95 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8c6c47, roughness: 1, flatShading: true }),
    tent: new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1, side: THREE.DoubleSide }),
  };
  return DMATS;
};

const dbox = (x0, x1, y0, y1, z0, z1, tu = 6, tv = 6) => {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  const uv = g.attributes.uv, dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const ext = [[dz, dy], [dz, dy], [dx, dz], [dx, dz], [dx, dy], [dx, dy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * ext[f][0] / tu, uv.getY(i) * ext[f][1] / tv);
  }
  return g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
};

const pyramidGroup = () => {
  const mat = dmats().stone, grp = new THREE.Group(), tot = PYR.tiers.reduce((s, t) => s + t[2], 0);
  const col = new THREE.Color();
  let y0 = 0;
  PYR.tiers.forEach(([ax, az, th], ti) => {
    const b = th * PYR.batter, WS = 28, HS = 5;
    const g = new THREE.BoxGeometry(2 * ax, th, 2 * az, WS, HS, WS);
    const p = g.attributes.position, uv = g.attributes.uv;
    const cnt = [(WS + 1) * (HS + 1), (WS + 1) * (HS + 1), (WS + 1) * (WS + 1), (WS + 1) * (WS + 1), (WS + 1) * (HS + 1), (WS + 1) * (HS + 1)];
    const ext = [[2 * az, th], [2 * az, th], [2 * ax, 2 * az], [2 * ax, 2 * az], [2 * ax, th], [2 * ax, th]];
    let f = 0, left = cnt[0];
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      while (left === 0) left = cnt[++f];
      left--;
      uv.setXY(i, uv.getX(i) * ext[f][0] / 6, uv.getY(i) * ext[f][1] / 4.4);
      const t = (p.getY(i) + th / 2) / th;
      let x = p.getX(i) * (ax - b * t) / ax, z = p.getZ(i) * (az - b * t) / az, y = p.getY(i);
      const hx = ax - b * t, ez = az - b * t;
      const nz = vn((x + 500) / 5 + ti * 7, (y + y0 + 500) / 4) - 0.5;
      const nx = vn((z + 500) / 5 + ti * 3, (y + y0 + 500) / 4) - 0.5;
      const edge = Math.abs(x) > hx - 0.01, edgeZ = Math.abs(z) > ez - 0.01;
      const chip = t > 0.9 ? vn(x / 2 + 40, z / 2) * 0.25 : 0;
      if (edge) x += Math.sign(x) * (nx * 0.3 - chip);
      if (edgeZ) z += Math.sign(z) * (nz * 0.3 - chip);
      p.setXYZ(i, x, y, z);
      const k = 0.9 + vn(x / 3 + 11, (y + y0) / 2 + z / 3) * 0.14;
      const gt = (y0 + th * t) / tot;
      col.setRGB((0.80 + 0.14 * gt) * k, (0.69 + 0.17 * gt) * k, (0.5 + 0.22 * gt) * k);
      colors.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.position.set(PYR.x, y0 + th / 2, PYR.z);
    grp.add(m);
    y0 += th;
  });
  return grp;
};

const complexGroup = () => {
  const M = dmats(), grp = new THREE.Group(), geos = [];
  const merged = (list, mat) => { const g = mergeGeometries(list); if (g) { geos.push(g); grp.add(new THREE.Mesh(g, mat)); } };
  merged(D_SLABS.map(([a, b, c, d]) => dbox(a, b, 0, DJ.wh, c, d, 10.8, 10.5)), M.facade);
  merged(D_SLABS.map(([a, b, c, d]) => dbox(a - 0.4, b + 0.4, DJ.wh, DJ.wh + 0.6, c - 0.4, d + 0.4)), M.plain);
  const zN = dWz1 - DJ.col, zS = dWz1 + DJ.wt;
  merged([...D_COLN_WALLS.map(([a, b, c, d]) => dbox(a, b, 0, 8, c, d + DJ.wt)),
    dbox(DJ.gate[0] - 3, DJ.gate[1] + 3, 7, 8.2, zN, zS)], M.plain);
  merged(D_COLS.map((c) => new THREE.CylinderGeometry(0.6, 0.7, 7, 12).translate(c.x, 3.5, c.z)), M.plain);
  const ch = [];
  for (const s of D_SHRINES) {
    ch.push(dbox(s.x - 2.2, s.x + 2.2, 0, 3.6, s.z - 2.2, s.z + 2.2));
    ch.push(new THREE.CylinderGeometry(2.2, 2.2, 4.6, 12).rotateX(Math.PI / 2).translate(s.x, 3.6, s.z));
  }
  ch.push(dbox(D_SERDAB.x - 1.6, D_SERDAB.x + 1.6, 0, 3, D_SERDAB.z - 1.6, D_SERDAB.z + 1.6));
  merged(ch, M.plain);
  for (const t of D_TENTS) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.4, 4).rotateY(Math.PI / 4).translate(0, 1.2, 0), M.tent);
    m.position.set(t.x, floorH(t.x, t.z), t.z);
    grp.add(m); geos.push(m.geometry);
  }
  grp.userData.geos = geos;
  return grp;
};

const skyDome = () => {
  const R = 900, g = new THREE.SphereGeometry(R, 24, 14), p = g.attributes.position, c = new Float32Array(p.count * 3);
  const hz = new THREE.Color(D_FOG), zn = new THREE.Color(0x1d2547), k = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    k.copy(hz).lerp(zn, clamp01(p.getY(i) / R) ** 0.55);
    c.set([k.r, k.g, k.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const dome = new THREE.Group();
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  const disc = (r, col, op, add) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({
      color: col, transparent: op < 1, opacity: op, fog: false, depthWrite: false,
      blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    m.position.copy(D_SUN).multiplyScalar(R * 0.94); m.lookAt(0, 0, 0);
    return m;
  };
  dome.add(sky, disc(130, 0xff9a52, 0.3, true), disc(36, 0xffe6b8, 1, false));
  dome.traverse((o) => { o.frustumCulled = false; o.renderOrder = -10; });
  return dome;
};

const windOn = (audio) => {
  const ctx = audio.ctx, out = ctx.createGain();
  out.gain.value = 0; out.connect(audio.sfx || audio.master || ctx.destination);
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
  s.buffer = buf; s.loop = true; f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 0.5;
  lfo.frequency.value = 0.12; lg.gain.value = 160; lfo.connect(lg); lg.connect(f.frequency);
  s.connect(f); f.connect(out); s.start(); lfo.start();
  return { g: out, src: [s, lfo] };
};

const dRockGeo = new THREE.IcosahedronGeometry(1, 1);

registerLevel('desert', {
  outdoor: true, hilly: true, mission: 'desert', ch: D_CH, load: 4,
  fog: D_FOG, fogDensity: 0.0032, drain: 0.05, start: { x: 1.5, z: 7.5 },
  fixed: D_FIXED, path: dPath, spawn: dSpawn, patrol: (pos) => dSpawn(pos, 15, 40),
  pickups: () => {
    const P = {}, put = (id, type, x, z) => { P[id] = { type, x, z, taken: false }; };
    put('bat_a', 'battery', -4, 4); put('wat_a', 'water', 6, 11); put('food_a', 'food', -12, 9);
    put('bat_b', 'battery', 14, -120); put('wat_b', 'water', -30, -190);
    put('bat_c', 'battery', 124, -250); put('med_a', 'medkit', 60, -320); put('food_b', 'food', -60, -330);
    put('bat_d', 'battery', 105, -420); put('wat_c', 'water', 105, -520); put('bat_e', 'battery', -40, -560);
    put('med_b', 'medkit', 0, -545);
    return P;
  },
  setup(m) {
    const r = m.r;
    WORLD_FLAGS.floorFn = floorH;
    if (r.ambientLight) { r.ambientLight.color.setHex(0xc9916c); r.ambientLight.intensity = 1.1; }
    if (r.sunLight) {
      r.sunLight.color.setHex(0xffb676); r.sunLight.intensity = 2.4; r.sunLight.castShadow = false;
      r.sunLight.position.copy(D_SUN).multiplyScalar(200);
    }
    m._far = r.camera.far; r.camera.far = 1600; r.camera.updateProjectionMatrix();
    m._hid = [r.billboardMesh?.parent, ...(r.lampPool || []), ...(r.tvLights || [])].filter(Boolean);
    m._hid.forEach((o) => { o.visible = false; });
    // hide westwood ground/trees if still visible
    for (const o of [r.ground, r.treeGroup, r.rockGroup, r.buildingGroup, r.roadMesh, r.riverMesh, r.landmarkGroup, r.pyramidGroup, r.pyramidMesh]) {
      if (o) o.visible = false;
    }
    m.sky = skyDome(); m.pyr = pyramidGroup(); m.cx = complexGroup();
    m.fire = new THREE.PointLight(0xff8a3a, 12, 24, 2); m.fire.position.set(-3, floorH(-3, 12) + 1.2, 12);
    r.scene.add(m.sky, m.pyr, m.cx, m.fire);
  },
  tick(m, pos, dt, p, audio) {
    if (m.sky) m.sky.position.set(pos.x, 0, pos.z);
    if (m.fire) m.fire.intensity = 11 + Math.sin(m.t * 13) * 1.5 + Math.sin(m.t * 5.3);
    if (!m.wind && audio?.ctx) m.wind = windOn(audio);
    m.wind?.g.gain.setTargetAtTime(0.16 + 0.06 * Math.sin(m.t * 0.2), audio.ctx.currentTime, 0.5);
  },
  teardown(m) {
    WORLD_FLAGS.floorFn = null;
    if (m._far) { m.r.camera.far = m._far; m.r.camera.updateProjectionMatrix(); }
    (m._hid || []).forEach((o) => { o.visible = true; });
    for (const o of [m.sky, m.pyr, m.cx, m.fire]) if (o) m.r.scene.remove(o);
    m.pyr?.traverse((o) => o.geometry?.dispose());
    m.cx?.userData.geos?.forEach((g) => g.dispose());
    try { m.wind?.src.forEach((s) => s.stop()); m.wind?.g.disconnect(); } catch (e) { /* */ }
  },
  buildChunk(cx, cz) {
    const M = dmats(), S = D_CH, x0 = cx * S, z0 = cz * S, group = new THREE.Group();
    const g = new THREE.PlaneGeometry(S, S, D_SEG, D_SEG).rotateX(-Math.PI / 2);
    const p = g.attributes.position, nr = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const wx = x0 + S / 2 + p.getX(i), wz = z0 + S / 2 + p.getZ(i), y = terrainH(wx, wz), e = 0.6;
      p.setY(i, y);
      const nx = terrainH(wx - e, wz) - terrainH(wx + e, wz), nz = terrainH(wx, wz - e) - terrainH(wx, wz + e);
      const l = Math.hypot(nx, 2 * e, nz) || 1;
      nr.setXYZ(i, nx / l, 2 * e / l, nz / l);
      const t = clamp01((y + 4) / 12), n = (vn(wx / 3, wz / 3) - 0.5) * 0.16;
      c.setRGB(0.66 + t * 0.2 + n, 0.49 + t * 0.17 + n, 0.29 + t * 0.12 + n * 0.8);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const ground = new THREE.Mesh(g, M.sand);
    ground.position.set(x0 + S / 2, 0, z0 + S / 2);
    group.add(ground);

    const rocks = [], walls = [];
    for (let k = 0; k < 7; k++) {
      const x = x0 + h(cx, cz, 200 + k) * S, z = z0 + h(cx, cz, 300 + k) * S;
      if (inCx(x, z, 25) || Math.hypot(x, z - 8) < 22 || pyrOut(x, z) < 24) continue;
      const s = 0.7 + h(cx, cz, 400 + k) * 2.6;
      rocks.push({ x, z, s, rot: h(cx, cz, 500 + k) * 6.283 });
      walls.push({ type: 'rock', x, z, r: s * 0.8 });
    }
    if (rocks.length) {
      const im = new THREE.InstancedMesh(dRockGeo, M.rock, rocks.length);
      const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3();
      rocks.forEach((k, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k.rot);
        im.setMatrixAt(i, mt.compose(pp.set(k.x, terrainH(k.x, k.z) + k.s * 0.2, k.z), q, sc.set(k.s, k.s * 0.6, k.s * 0.8)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    }
    return { group, walls, dispose() { g.dispose(); } };
  },
});

export class LevelManager {
  constructor(renderer, id) {
    this.r = renderer;
    this.def = LEVELS[id];
    this.id = id;
    this.CH = this.def.ch || CH;
    this.chunks = new Map();
    this.spatial = buildSpatialGrid([]);
    this._path = this.def.path || cellPath;
    this.spatial.levelPath = this._path;
    this.spawn = this.def.spawn || ((pos, min = 20, max = 70) => spawnCell(pos, min, Math.min(max, 70)));
    this.patrol = this.def.patrol || patrolPoint;
    this._ck = '';
    this.hum = null;
    this.t = 0;
    this._fa = 0;
    this._lc = 0;
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
      renderer.ambientLight.intensity = AMBIENT;
      renderer.ambientLight.color.setHex(0xfff0c0);
    }
    if (renderer.sunLight) renderer.sunLight.intensity = 0;

    const touch = 'ontouchstart' in window || window.matchMedia?.('(pointer: coarse)').matches;
    this.load = this.def.load ? this.def.load - (touch ? 1 : 0) : LOAD;
    this.pool = [];
    for (let k = 0; k < (touch ? 2 : 4); k++) {
      const L = new THREE.PointLight(0xfff0c8, 0, POOL_DIST, 2);
      L.position.set(0, WALL_H - 0.35, 0);
      renderer.scene.add(L);
      this.pool.push({ L, init: false, off: false });
    }
    this.def.setup?.(this);
  }

  update(pos, dt, p, audio) {
    this.t += dt;
    const cx = Math.floor(pos.x / this.CH), cz = Math.floor(pos.z / this.CH), key = cx + ',' + cz;
    if (key !== this._ck) {
      this._ck = key;
      const want = new Set();
      for (let i = -this.load; i <= this.load; i++)
        for (let j = -this.load; j <= this.load; j++) {
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
        c.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
        c.dispose?.();
        this.chunks.delete(k);
      }
      Object.assign(this.spatial, buildSpatialGrid([...this.chunks.values()].flatMap((c) => c.walls).concat(this.def.fixed || [])));
      this.spatial.levelPath = this._path;
    }
    if (p && p.alive !== false) p.sanity = Math.max(0, (p.sanity ?? 100) - this.def.drain * dt);

    if (this.def.tick) this.def.tick(this, pos, dt, p, audio);
    else {
      this._flicker(dt);
      this._lights(pos, dt, audio);
      this._ambient(pos, dt);
      this._hum(audio, p, pos);
    }
  }

  _flicker(dt) {
    this._fa += dt;
    if (this._fa < 0.033) return;
    this._fa = 0;
    for (const c of this.chunks.values()) {
      const L = c.lamps;
      if (!L || !L.flick.length) continue;
      let dirty = false;
      for (const f of L.flick) {
        const on = flick(f.id, this.t) > 0.5;
        if (on !== f.on) { f.on = on; L.mesh.setColorAt(f.idx, on ? C_ON : C_DIM); dirty = true; }
      }
      if (dirty) L.mesh.instanceColor.needsUpdate = true;
    }
  }

  _lights(pos, dt, audio) {
    if (!this.pool.length) return;
    const gxc = Math.round((pos.x - LAMP_X / 2) / LAMP_X);
    const gzc = Math.round((pos.z - 0.6) / LAMP_Z);
    const cand = [];
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const gx = gxc + a, gz = gzc + b, k = lampKind(gx, gz);
      if (k === DEAD) continue;
      const lx = lampX(gx), lz = lampZ(gz);
      cand.push({ gx, gz, k, lx, lz, d2: (lx - pos.x) ** 2 + (lz - pos.z) ** 2 });
    }
    cand.sort((u, v) => u.d2 - v.d2);
    const kk = 1 - Math.exp(-dt * 8);
    this.pool.forEach((s, n) => {
      const t = cand[n];
      if (!t) { s.L.intensity = 0; return; }
      const f = t.k === FLK ? flick(lampId(t.gx, t.gz), this.t) : 1;
      if (!s.init) { s.L.position.set(t.lx, WALL_H - 0.35, t.lz); s.init = true; }
      else {
        s.L.position.x += (t.lx - s.L.position.x) * kk;
        s.L.position.z += (t.lz - s.L.position.z) * kk;
      }
      s.L.intensity = POOL_I * f;
      const off = f < 0.5;
      if (t.k === FLK && off !== s.off) {
        s.off = off;
        if (t.d2 < 64) this._click(audio, 0.05 * (1 - Math.sqrt(t.d2) / 8));
      }
    });
  }

  _ambient(pos, dt) {
    const amb = this.r.ambientLight;
    if (!amb) return;
    const target = AMBIENT * (1 - 0.6 * darkness(pos.x, pos.z));
    amb.intensity += (target - amb.intensity) * Math.min(1, dt * 2);
  }

  _click(audio, vol) {
    const ctx = audio?.ctx;
    if (!ctx || this.t - this._lc < 0.08) return;
    this._lc = this.t;
    const o = ctx.createOscillator(), g = ctx.createGain(), now = ctx.currentTime;
    o.type = 'square';
    o.frequency.value = 90 + Math.random() * 60;
    g.gain.setValueAtTime(Math.max(0.001, vol), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    o.connect(g);
    g.connect(audio.sfx || audio.master || ctx.destination);
    o.start(now); o.stop(now + 0.06);
  }

  _makeHum(audio) {
    const ctx = audio.ctx, hz = this.def.humHz;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(audio.sfx || audio.master || ctx.destination);
    const src = [];
    const osc = (type, f, gain, lp) => {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type; o.frequency.value = f; gn.gain.value = gain;
      if (lp) {
        const fl = ctx.createBiquadFilter();
        fl.type = 'lowpass'; fl.frequency.value = lp;
        o.connect(fl); fl.connect(gn);
      } else o.connect(gn);
      gn.connect(out); o.start(); src.push(o);
      return gn;
    };
    const buzz = osc('sawtooth', hz, 0.35, 700);
    osc('sine', hz * 2.003, 0.5);
    osc('sine', hz * 3.01, 0.18);
    osc('square', hz * 4, 0.04, 2500);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = (type, f, qv, gain) => {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), gn = ctx.createGain();
      s.buffer = buf; s.loop = true;
      fl.type = type; fl.frequency.value = f; fl.Q.value = qv; gn.gain.value = gain;
      s.connect(fl); fl.connect(gn); gn.connect(out); s.start(); src.push(s);
    };
    noise('bandpass', 5200, 0.7, 0.05);
    noise('lowpass', 140, 0.5, 0.9);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.23; lg.gain.value = 0.08;
    lfo.connect(lg); lg.connect(buzz.gain); lfo.start(); src.push(lfo);
    return { g: out, src };
  }

  _hum(audio, p, pos) {
    if (!this.hum && audio?.ctx) this.hum = this._makeHum(audio);
    if (!this.hum) return;
    const v = (HUM_BASE + (1 - (p?.sanity ?? 100) / 100) * 0.08) * (1 - 0.55 * darkness(pos.x, pos.z));
    this.hum.g.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.3);
  }

  dispose() {
    try { this.hum?.src.forEach((s) => s.stop()); this.hum?.g.disconnect(); } catch (e) { /* */ }
    for (const s of this.pool) { this.r.scene.remove(s.L); s.L.dispose?.(); }
    this.pool = [];
    for (const c of this.chunks.values()) {
      this.r.scene.remove(c.group);
      c.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      c.dispose?.();
    }
    this.chunks.clear();
    this.def.teardown?.(this);
    WORLD_FLAGS.endless = false;
  }
}
