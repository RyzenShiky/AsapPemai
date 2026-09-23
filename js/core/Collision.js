import { WORLD, tileSeed } from './WorldConfig.js';
import { allBuildingColliders, nearBuilding } from './Buildings.js';

const CELL = 20;

export function buildColliders() {
  const colliders = [];
  const half = WORLD.half;
  const ts = WORLD.tileSize;

  for (let tz = 0; tz < WORLD.tilesPerSide; tz++) {
    for (let tx = 0; tx < WORLD.tilesPerSide; tx++) {
      const ox = -half + tx * ts + ts * 0.5;
      const oz = -half + tz * ts + ts * 0.5;
      // slightly fewer trees per tile on larger map
      const treeCount = 6 + Math.floor(tileSeed(tx, tz, 0) * 5);
      for (let i = 0; i < treeCount; i++) {
        const sx = tileSeed(tx, tz, i * 3 + 1);
        const sz = tileSeed(tx, tz, i * 3 + 2);
        const scale = 0.7 + tileSeed(tx, tz, i * 3 + 3) * 0.9;
        const x = ox + (sx - 0.5) * (ts - 2);
        const z = oz + (sz - 0.5) * (ts - 2);
        if (Math.hypot(x, z) < 8) continue;
        if (nearBuilding(x, z, 9)) continue;
        colliders.push({
          x, z, r: 0.35 * scale, type: 'tree',
          scale, rot: tileSeed(tx, tz, i * 5) * Math.PI * 2,
        });
      }
      const rockCount = 1 + Math.floor(tileSeed(tx, tz, 99) * 2);
      for (let i = 0; i < rockCount; i++) {
        const sx = tileSeed(tx, tz, 200 + i * 2);
        const sz = tileSeed(tx, tz, 201 + i * 2);
        const x = ox + (sx - 0.5) * (ts - 3);
        const z = oz + (sz - 0.5) * (ts - 3);
        if (Math.hypot(x, z) < 6) continue;
        if (nearBuilding(x, z, 7)) continue;
        const sc = 0.6 + tileSeed(tx, tz, 300 + i) * 1.4;
        colliders.push({ x, z, r: 0.7 * sc, type: 'rock', scale: sc });
      }
    }
  }
  for (const w of allBuildingColliders()) colliders.push(w);
  return colliders;
}

export function buildSpatialGrid(colliders, cellSize = CELL) {
  const grid = new Map();
  for (const c of colliders) {
    if (c.type === 'wall') {
      const x0 = Math.floor(c.minX / cellSize);
      const x1 = Math.floor(c.maxX / cellSize);
      const z0 = Math.floor(c.minZ / cellSize);
      const z1 = Math.floor(c.maxZ / cellSize);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = cx + ',' + cz;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(c);
        }
      }
    } else {
      const cx = Math.floor(c.x / cellSize);
      const cz = Math.floor(c.z / cellSize);
      const key = cx + ',' + cz;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(c);
    }
  }
  return { grid, cellSize };
}

export function nearbyColliders(spatial, x, z) {
  const { grid, cellSize } = spatial;
  const cx = Math.floor(x / cellSize);
  const cz = Math.floor(z / cellSize);
  const out = [];
  const seen = new Set();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(cx + dx + ',' + (cz + dz));
      if (!list) continue;
      for (const c of list) {
        if (seen.has(c)) continue;
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

function resolveCircle(pos, radius, c) {
  const dx = pos.x - c.x;
  const dz = pos.z - c.z;
  const d = Math.hypot(dx, dz);
  const min = radius + c.r;
  if (d > 0 && d < min) {
    const push = (min - d) / d;
    pos.x += dx * push;
    pos.z += dz * push;
  }
}

function resolveAABB(pos, radius, box) {
  const cx = Math.max(box.minX, Math.min(pos.x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(pos.z, box.maxZ));
  let dx = pos.x - cx;
  let dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return;
  if (d2 < 1e-8) {
    const left = pos.x - box.minX;
    const right = box.maxX - pos.x;
    const top = pos.z - box.minZ;
    const bottom = box.maxZ - pos.z;
    const m = Math.min(left, right, top, bottom);
    if (m === left) pos.x = box.minX - radius;
    else if (m === right) pos.x = box.maxX + radius;
    else if (m === top) pos.z = box.minZ - radius;
    else pos.z = box.maxZ + radius;
    return;
  }
  const d = Math.sqrt(d2);
  const push = (radius - d) / d;
  pos.x += dx * push;
  pos.z += dz * push;
}

/** colliders arg may be full list OR spatial grid object */
export function resolveCollisions(pos, radius, collidersOrSpatial) {
  let list = collidersOrSpatial;
  if (collidersOrSpatial && collidersOrSpatial.grid) {
    list = nearbyColliders(collidersOrSpatial, pos.x, pos.z);
  }
  for (const c of list) {
    if (c.type === 'wall') resolveAABB(pos, radius, c);
    else if (c.r != null) resolveCircle(pos, radius, c);
  }
}

export function groundHeight(x, z) {
  return Math.sin(x * 0.12) * Math.cos(z * 0.1) * 0.4;
}
