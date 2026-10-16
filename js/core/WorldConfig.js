/** ~575×575 m world (2048 studs × 0.28 m) */
const STUD = 0.28;
const SIDE_STUDS = 2048;
const TILES = 23;
export const WORLD = {
  size: TILES * 25,
  half: TILES * 12.5,
  tileSize: 25,
  tilesPerSide: TILES,
  areaM2: (TILES * 25) ** 2,
};
export const WORLD_FLAGS = { endless: false };

export function worldToTile(x, z) {
  const tx = Math.floor((x + WORLD.half) / WORLD.tileSize);
  const tz = Math.floor((z + WORLD.half) / WORLD.tileSize);
  return {
    tx: Math.max(0, Math.min(WORLD.tilesPerSide - 1, tx)),
    tz: Math.max(0, Math.min(WORLD.tilesPerSide - 1, tz)),
  };
}

export function tileIndex(tx, tz) {
  return tz * WORLD.tilesPerSide + tx;
}

export function clampToWorld(x, z) {
  if (WORLD_FLAGS.endless) return { x, z };
  const m = WORLD.half - 1;
  return {
    x: Math.max(-m, Math.min(m, x)),
    z: Math.max(-m, Math.min(m, z)),
  };
}

export function tileSeed(tx, tz, i) {
  let h = (tx * 73856093) ^ (tz * 19349663) ^ (i * 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Main road + branch toward house_s — aligned with BUILDING_DEFS, spawn (0,8) on road. */
const E = WORLD.half - 12;
export const ROADS = [
  { w: 6, pts: [[-E, -18], [-150, -10], [-95, -4], [0, 6], [95, 11], [190, 8], [E, 24]] },
  { w: 4, pts: [[0, 6], [8, 50], [24, 100], [16, 150], [-8, 200]] },
  { w: 4, pts: [[0, 6], [-3, -50], [2, -100], [8, -140]] },
  { w: 4, pts: [[95, 11], [130, -30], [185, -90], [205, -110]] },
];

export const RIVER = {
  w: 12,
  pts: [[-140, -287], [-125, -200], [-100, -100], [-95, -4], [-108, 80], [-90, 170], [-98, 287]],
};
export const LANDMARKS = {
  waterTower: { x: -55, z: -60 },
  summoningCircle: { x: -215, z: -170 },
};

/** Yield [x, z, normalX, normalZ] every `step` meters along polyline. */
export function* sample(pts, step) {
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    let d = carry;
    for (; d < L; d += step) yield [ax + ux * d, az + uz * d, -uz, ux];
    carry = d - L;
  }
}

const seg = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax;
  const dz = bz - az;
  const den = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / den));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};

export function distToRoad(x, z) {
  let d = Infinity;
  for (const r of ROADS) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      d = Math.min(d, seg(x, z, ...r.pts[i], ...r.pts[i + 1]) - r.w / 2);
    }
  }
  return d;
}

export function distToRiver(x, z) {
  let d = Infinity;
  for (let i = 0; i < RIVER.pts.length - 1; i++)
    d = Math.min(d, seg(x, z, ...RIVER.pts[i], ...RIVER.pts[i + 1]));
  return d - RIVER.w / 2;
}
export const onRoad = (x, z, m = 0) => distToRoad(x, z) < m || distToRiver(x, z) < m;
