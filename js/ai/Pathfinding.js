/**
 * Lightweight A* on a 4 m grid using nearbyColliders occupancy.
 * Grid lokal 25x25 dengan typed array, binary heap, cache "blocked" per panggilan.
 */
import { nearbyColliders } from '../core/Collision.js';

const CELL = 4;
const HALF = 12;
const W = HALF * 2 + 1;
const N = W * W;
const HEAP_CAP = N * 8 + 8;

const gScore = new Float32Array(N);
const came = new Int16Array(N);
const closed = new Uint8Array(N);
const blockedC = new Int8Array(N);
const heapI = new Int16Array(HEAP_CAP);
const heapF = new Float32Array(HEAP_CAP);
let heapN = 0;

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const DC = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];

function push(i, f) {
  if (heapN >= HEAP_CAP) return;
  let k = heapN++;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (heapF[p] <= f) break;
    heapI[k] = heapI[p]; heapF[k] = heapF[p];
    k = p;
  }
  heapI[k] = i; heapF[k] = f;
}

function pop() {
  const top = heapI[0];
  heapN--;
  if (heapN > 0) {
    const li = heapI[heapN], lf = heapF[heapN];
    let k = 0;
    for (;;) {
      let c = k * 2 + 1;
      if (c >= heapN) break;
      if (c + 1 < heapN && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heapI[k] = heapI[c]; heapF[k] = heapF[c];
      k = c;
    }
    heapI[k] = li; heapF[k] = lf;
  }
  return top;
}

function blocked(spatial, wx, wz, radius = 0.55) {
  const list = nearbyColliders(spatial, wx, wz);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.type === 'wall') {
      if (wx > c.minX - radius && wx < c.maxX + radius && wz > c.minZ - radius && wz < c.maxZ + radius) return true;
    } else if (Math.hypot(wx - c.x, wz - c.z) < (c.r || 0.5) + radius) {
      return true;
    }
  }
  return false;
}

/** @returns {{x,z}[]|null} path from start toward goal (excluding start), or null */
export function findPath(spatial, start, goal, maxNodes = 400) {
  if (spatial && spatial.levelPath) return spatial.levelPath(start, goal);
  const sx = Math.round(start.x / CELL);
  const sz = Math.round(start.z / CELL);
  const gx = Math.round(goal.x / CELL);
  const gz = Math.round(goal.z / CELL);
  const cgx = Math.max(sx - HALF, Math.min(sx + HALF, gx));
  const cgz = Math.max(sz - HALF, Math.min(sz + HALF, gz));
  const goalI = (cgx - sx + HALF) * W + (cgz - sz + HALF);
  const startI = HALF * W + HALF;

  gScore.fill(1e9); came.fill(-1); closed.fill(0); blockedC.fill(-1);
  heapN = 0;
  gScore[startI] = 0;
  push(startI, Math.hypot(cgx - sx, cgz - sz));

  let nodes = 0;
  while (heapN > 0 && nodes < maxNodes) {
    const cur = pop();
    if (closed[cur]) continue;
    nodes++;
    closed[cur] = 1;

    if (cur === goalI) {
      const path = [];
      for (let k = cur; k !== startI && k !== -1; k = came[k]) {
        path.push({ x: (sx + ((k / W) | 0) - HALF) * CELL, z: (sz + (k % W) - HALF) * CELL });
      }
      return path.reverse();
    }

    const ci = (cur / W) | 0, cj = cur % W;
    for (let d = 0; d < 8; d++) {
      const ni = ci + DX[d], nj = cj + DZ[d];
      if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
      const n = ni * W + nj;
      if (closed[n]) continue;
      let b = blockedC[n];
      if (b < 0) {
        b = blocked(spatial, (sx + ni - HALF) * CELL, (sz + nj - HALF) * CELL) ? 1 : 0;
        blockedC[n] = b;
      }
      if (b) continue;
      const tent = gScore[cur] + DC[d];
      if (tent < gScore[n]) {
        came[n] = cur;
        gScore[n] = tent;
        push(n, tent + Math.hypot(cgx - (sx + ni - HALF), cgz - (sz + nj - HALF)));
      }
    }
  }
  return null;
}
