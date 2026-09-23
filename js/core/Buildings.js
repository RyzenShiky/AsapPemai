const DOOR_W = 1.7;
const WALL_T = 0.35;

export const BUILDING_DEFS = [
  { id: 'cabin_n', x: -28, z: -42, w: 8, d: 7, h: 3.2, door: 's', type: 'house', color: 0x3a2a1c },
  { id: 'cabin_e', x: 48, z: -22, w: 7, d: 6, h: 3.0, door: 'w', type: 'house', color: 0x2e2418 },
  { id: 'house_w', x: -55, z: 18, w: 11, d: 9, h: 3.8, door: 'e', type: 'house', color: 0x4a3a2e },
  { id: 'house_s', x: 12, z: 52, w: 10, d: 8, h: 3.6, door: 'n', type: 'house', color: 0x3d3228 },
  { id: 'warehouse', x: 62, z: 40, w: 16, d: 12, h: 5.5, door: 'w', type: 'building', color: 0x2a2e32 },
  { id: 'office', x: -40, z: 55, w: 14, d: 10, h: 4.8, door: 's', type: 'building', color: 0x252830 },
  { id: 'shack', x: 25, z: -55, w: 6, d: 5, h: 2.6, door: 'n', type: 'house', color: 0x2a2018 },
  { id: 'barn', x: -70, z: -30, w: 12, d: 10, h: 4.2, door: 'e', type: 'building', color: 0x3a2820 },
  // outer map
  { id: 'cabin_far1', x: 160, z: -120, w: 8, d: 7, h: 3.2, door: 'w', type: 'house', color: 0x3a2a1c },
  { id: 'cabin_far2', x: -160, z: 130, w: 9, d: 8, h: 3.4, door: 's', type: 'house', color: 0x2e2418 },
  { id: 'warehouse_far', x: 140, z: 150, w: 18, d: 14, h: 6, door: 'n', type: 'building', color: 0x22262a },
  { id: 'house_far', x: -150, z: -140, w: 12, d: 10, h: 4, door: 'e', type: 'house', color: 0x4a3a2e },
];

export function buildingWallColliders(def) {
  const { x, z, w, d, door } = def;
  const hx = w / 2, hz = d / 2, t = WALL_T;
  const walls = [];
  if (door === 'n') {
    const gap = DOOR_W / 2;
    walls.push({ minX: x - hx, maxX: x - gap, minZ: z - hz - t, maxZ: z - hz + t });
    walls.push({ minX: x + gap, maxX: x + hx, minZ: z - hz - t, maxZ: z - hz + t });
  } else {
    walls.push({ minX: x - hx - t, maxX: x + hx + t, minZ: z - hz - t, maxZ: z - hz + t });
  }
  if (door === 's') {
    const gap = DOOR_W / 2;
    walls.push({ minX: x - hx, maxX: x - gap, minZ: z + hz - t, maxZ: z + hz + t });
    walls.push({ minX: x + gap, maxX: x + hx, minZ: z + hz - t, maxZ: z + hz + t });
  } else {
    walls.push({ minX: x - hx - t, maxX: x + hx + t, minZ: z + hz - t, maxZ: z + hz + t });
  }
  if (door === 'w') {
    const gap = DOOR_W / 2;
    walls.push({ minX: x - hx - t, maxX: x - hx + t, minZ: z - hz, maxZ: z - gap });
    walls.push({ minX: x - hx - t, maxX: x - hx + t, minZ: z + gap, maxZ: z + hz });
  } else {
    walls.push({ minX: x - hx - t, maxX: x - hx + t, minZ: z - hz - t, maxZ: z + hz + t });
  }
  if (door === 'e') {
    const gap = DOOR_W / 2;
    walls.push({ minX: x + hx - t, maxX: x + hx + t, minZ: z - hz, maxZ: z - gap });
    walls.push({ minX: x + hx - t, maxX: x + hx + t, minZ: z + gap, maxZ: z + hz });
  } else {
    walls.push({ minX: x + hx - t, maxX: x + hx + t, minZ: z - hz - t, maxZ: z + hz + t });
  }
  return walls.map((w) => ({ ...w, type: 'wall' }));
}

export function allBuildingColliders() {
  const out = [];
  for (const def of BUILDING_DEFS) out.push(...buildingWallColliders(def));
  return out;
}

export function nearBuilding(px, pz, margin = 8) {
  for (const b of BUILDING_DEFS) {
    if (
      px > b.x - b.w / 2 - margin &&
      px < b.x + b.w / 2 + margin &&
      pz > b.z - b.d / 2 - margin &&
      pz < b.z + b.d / 2 + margin
    ) return true;
  }
  return false;
}

export function isInsideBuilding(px, pz) {
  for (const b of BUILDING_DEFS) {
    if (
      px > b.x - b.w / 2 + 0.2 &&
      px < b.x + b.w / 2 - 0.2 &&
      pz > b.z - b.d / 2 + 0.2 &&
      pz < b.z + b.d / 2 - 0.2
    ) return b;
  }
  return null;
}
