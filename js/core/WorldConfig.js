/** 425×425 m forest, center (0,0), tiles 25 m */
export const WORLD = {
  size: 425,
  half: 212.5,
  tileSize: 25,
  tilesPerSide: 17, // 17 * 25 = 425
  areaM2: 425 * 425,
};

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
export const ROADS = [
  { w: 6, pts: [[-195, -12], [-100, -6], [0, 6], [70, 10], [195, 22]] },
  { w: 4, pts: [[0, 6], [8, 28], [12, 42]] },
];

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

export const onRoad = (x, z, m = 0) => distToRoad(x, z) < m;
