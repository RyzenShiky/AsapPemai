/**
 * Lightweight A* on a 4 m grid using nearbyColliders occupancy.
 * Keep grid small (local window) so it stays cheap.
 */
import { nearbyColliders } from '../core/Collision.js';

const CELL = 4;
const HALF = 12; // search window in cells each direction

function key(cx, cz) {
  return cx + ',' + cz;
}

function blocked(spatial, wx, wz, radius = 0.55) {
  const list = nearbyColliders(spatial, wx, wz);
  for (const c of list) {
    if (c.type === 'wall') {
      if (wx > c.minX - radius && wx < c.maxX + radius && wz > c.minZ - radius && wz < c.maxZ + radius)
        return true;
    } else if (Math.hypot(wx - c.x, wz - c.z) < (c.r || 0.5) + radius) {
      return true;
    }
  }
  return false;
}

/**
 * @returns {{x,z}[]|null} path from start toward goal (excluding start), or null
 */
export function findPath(spatial, start, goal, maxNodes = 400) {
  const sx = Math.round(start.x / CELL);
  const sz = Math.round(start.z / CELL);
  const gx = Math.round(goal.x / CELL);
  const gz = Math.round(goal.z / CELL);

  // Clamp goal into local window around start
  const cgx = Math.max(sx - HALF, Math.min(sx + HALF, gx));
  const cgz = Math.max(sz - HALF, Math.min(sz + HALF, gz));

  const open = [];
  const came = new Map();
  const gScore = new Map();
  const fScore = new Map();
  const closed = new Set();

  const startK = key(sx, sz);
  open.push({ cx: sx, cz: sz });
  gScore.set(startK, 0);
  fScore.set(startK, Math.hypot(cgx - sx, cgz - sz));

  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  let nodes = 0;
  while (open.length && nodes < maxNodes) {
    nodes++;
    // pop lowest f
    open.sort((a, b) => (fScore.get(key(a.cx, a.cz)) ?? 1e9) - (fScore.get(key(b.cx, b.cz)) ?? 1e9));
    const cur = open.shift();
    const ck = key(cur.cx, cur.cz);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (cur.cx === cgx && cur.cz === cgz) {
      // reconstruct
      const path = [];
      let k = ck;
      while (came.has(k)) {
        const [cx, cz] = k.split(',').map(Number);
        path.push({ x: cx * CELL, z: cz * CELL });
        k = came.get(k);
      }
      path.reverse();
      return path;
    }

    for (const [dx, dz] of dirs) {
      const nx = cur.cx + dx;
      const nz = cur.cz + dz;
      if (Math.abs(nx - sx) > HALF || Math.abs(nz - sz) > HALF) continue;
      const nk = key(nx, nz);
      if (closed.has(nk)) continue;
      const wx = nx * CELL;
      const wz = nz * CELL;
      if (blocked(spatial, wx, wz)) continue;
      const step = dx && dz ? 1.414 : 1;
      const tent = (gScore.get(ck) ?? 1e9) + step;
      if (tent < (gScore.get(nk) ?? 1e9)) {
        came.set(nk, ck);
        gScore.set(nk, tent);
        fScore.set(nk, tent + Math.hypot(cgx - nx, cgz - nz));
        open.push({ cx: nx, cz: nz });
      }
    }
  }
  return null;
}
