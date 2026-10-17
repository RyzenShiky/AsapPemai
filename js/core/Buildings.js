export const DOOR_W = 1.7;
export const DOOR_H = 2.3;
const WALL_T = 0.35;

/** Billboard facing road. */
export const DOORS = [];
export const setDoor = (d, open) => { d.open = open; if (d.col) d.col.type = open ? 'door-open' : 'wall'; };

export function camsFor(def) {
  const { x, z, w, d, h, door } = def;
  const v = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[door] || [0, 1];
  const hd = (v[0] ? w : d) / 2;
  const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
  const P = (k, y, dx, dz, pitch, name) => ({
    name, x: x + v[0] * k, y, z: z + v[1] * k, yaw: yawOf(dx, dz), pitch,
  });
  return [
    P(-(hd - 0.7), h - 0.5, v[0], v[1], -0.28, 'RUANG TAMU'),
    P(hd + 0.4, 3.1, v[0], v[1], -0.2, 'HALAMAN DEPAN'),
    P(-(hd + 0.4), 3.1, -v[0], -v[1], -0.2, 'HALAMAN BELAKANG'),
  ];
}

export const BILLBOARD = { x: 62, z: -34, yaw: 0, w: 36, h: 20, base: 4 };
export const TV_HOUSES = ['tavern', 'store', 'house_1', 'house_3', 'house_5', 'house_9', 'house_11'];

export const BUILDING_DEFS = [
  { id: 'tavern', name: "Joe's Tavern", x: 30, z: -13, w: 14, d: 10, h: 4.2, door: 's', type: 'building', color: 0x4a3322 },
  { id: 'store', name: 'General Store', x: -30, z: -12, w: 12, d: 9, h: 3.8, door: 's', type: 'building', color: 0x3a3430 },
  { id: 'info', name: 'Information Center', x: 21, z: 22, w: 13, d: 9, h: 3.8, door: 'w', type: 'building', color: 0x30383a },
  { id: 'church', name: 'Gereja', x: 8, z: -155, w: 12, d: 20, h: 8, door: 's', type: 'building', color: 0x2a2a30 },
  { id: 'power', name: 'Power Station', x: 225, z: -110, w: 22, d: 16, h: 7, door: 'w', type: 'building', color: 0x22262a },
  { id: 'house_1', x: -14, z: 58, w: 10, d: 8, h: 3.6, door: 'e', type: 'house', color: 0x4a3a2e },
  { id: 'house_2', x: 38, z: 76, w: 9, d: 8, h: 3.4, door: 'w', type: 'house', color: 0x3d3228 },
  { id: 'house_3', x: -6, z: 118, w: 11, d: 9, h: 3.8, door: 'e', type: 'house', color: 0x3a2a1c },
  { id: 'house_4', x: 46, z: 140, w: 10, d: 8, h: 3.6, door: 'w', type: 'house', color: 0x2e2418 },
  { id: 'house_5', x: -24, z: 176, w: 9, d: 8, h: 3.4, door: 'e', type: 'house', color: 0x4a3a2e },
  { id: 'house_6', x: -170, z: 14, w: 10, d: 8, h: 3.6, door: 'n', type: 'house', color: 0x3d3228 },
  { id: 'house_7', x: -215, z: -40, w: 9, d: 8, h: 3.4, door: 's', type: 'house', color: 0x2e2418 },
  { id: 'house_8', x: -248, z: 8, w: 11, d: 9, h: 3.8, door: 'n', type: 'house', color: 0x3a2a1c },
  { id: 'house_9', x: 150, z: 34, w: 10, d: 8, h: 3.6, door: 'n', type: 'house', color: 0x4a3a2e },
  { id: 'house_10', x: 175, z: -18, w: 9, d: 8, h: 3.4, door: 's', type: 'house', color: 0x3d3228 },
  { id: 'house_11', x: 238, z: 34, w: 10, d: 9, h: 3.6, door: 'n', type: 'house', color: 0x2e2418 },
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
  DOORS.length = 0;
  const WALL_T = 0.35;
  for (const def of BUILDING_DEFS) {
    out.push(...buildingWallColliders(def));
    const { x, z, w, d, door } = def;
    const ns = door === 'n' || door === 's';
    const dx = door === 'e' ? w / 2 : door === 'w' ? -w / 2 : 0;
    const dz = door === 's' ? d / 2 : door === 'n' ? -d / 2 : 0;
    const col = {
      minX: x + dx - (ns ? DOOR_W / 2 : WALL_T),
      maxX: x + dx + (ns ? DOOR_W / 2 : WALL_T),
      minZ: z + dz - (ns ? WALL_T : DOOR_W / 2),
      maxZ: z + dz + (ns ? WALL_T : DOOR_W / 2),
      type: 'wall',
    };
    out.push(col);
    DOORS.push({ id: def.id, x: x + dx, z: z + dz, open: false, col });
  }
  try {
    for (const sx of [-0.3, 0.3]) {
      const cx = BILLBOARD.x + sx * BILLBOARD.w;
      out.push({ minX: cx - 0.7, maxX: cx + 0.7, minZ: BILLBOARD.z - 1, maxZ: BILLBOARD.z + 0.3, type: 'wall' });
    }
  } catch (e) { /* */ }
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
    try {
    const B = BILLBOARD;
    if (Math.abs(px - B.x) < B.w / 2 + margin && Math.abs(pz - B.z) < 1.5 + margin) return true;
  } catch (e) { /* */ }
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

export function containersFor(defs) {
  const out = {};
  for (const b of defs) {
    const n = b.type === 'building' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = 0.7 + (i / n) * Math.PI * 2;
      out[`box_${b.id}_${i}`] = {
        kind: 'container',
        table: b.type === 'building' ? 'depot' : 'house',
        taken: false,
        x: b.x + Math.cos(a) * (b.w / 2 - 1.2),
        z: b.z + Math.sin(a) * (b.d / 2 - 1.2),
      };
    }
  }
  return out;
}
