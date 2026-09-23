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
