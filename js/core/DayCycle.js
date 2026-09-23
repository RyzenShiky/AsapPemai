/** 3-minute cycle: afternoon → sunset → night */
export const MATCH_SECONDS = 180;

/**
 * Progress 0..1 over match maps to visual phase.
 * afternoon (0–0.35) → sunset (0.35–0.65) → night (0.65–1)
 */
export function phaseFromProgress(p) {
  if (p < 0.35) return 'afternoon';
  if (p < 0.65) return 'sunset';
  return 'night';
}

export function lightingForProgress(p) {
  // interpolate key colors
  const afternoon = {
    ambient: 0x3a4038,
    ambientInt: 0.45,
    sun: 0xfff0c8,
    sunInt: 0.85,
    fog: 0x8a9a88,
    fogDensity: 0.012,
    clear: 0x87a0b0,
  };
  const sunset = {
    ambient: 0x2a1810,
    ambientInt: 0.28,
    sun: 0xff6a30,
    sunInt: 0.55,
    fog: 0x4a2a28,
    fogDensity: 0.018,
    clear: 0x3a1a18,
  };
  const night = {
    ambient: 0x0a0c12,
    ambientInt: 0.12,
    sun: 0x6a7a98,
    sunInt: 0.18,
    fog: 0x07080a,
    fogDensity: 0.026,
    clear: 0x050608,
  };

  if (p < 0.35) {
    const t = p / 0.35;
    const a = lerpLight(afternoon, sunset, t * 0.35); a._key = Math.floor(p * 40); return a;
  }
  if (p < 0.65) {
    const t = (p - 0.35) / 0.3;
    const b = lerpLight(sunset, night, t); b._key = Math.floor(p * 40); return b;
  }
  const nightOut = { ...night };
  nightOut._key = Math.floor(p * 40);
  return nightOut;
}

function lerpLight(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return {
    ambient: lerpColor(a.ambient, b.ambient, t),
    ambientInt: a.ambientInt + (b.ambientInt - a.ambientInt) * t,
    sun: lerpColor(a.sun, b.sun, t),
    sunInt: a.sunInt + (b.sunInt - a.sunInt) * t,
    fog: lerpColor(a.fog, b.fog, t),
    fogDensity: a.fogDensity + (b.fogDensity - a.fogDensity) * t,
    clear: lerpColor(a.clear, b.clear, t),
  };
}

function lerpColor(c1, c2, t) {
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  const r = (r1 + (r2 - r1) * t) | 0;
  const g = (g1 + (g2 - g1) * t) | 0;
  const b = (b1 + (b2 - b1) * t) | 0;
  return (r << 16) | (g << 8) | b;
}

/** Random spawn on ring around player, away from center clear zone */
export function randomMonsterSpawn(playerPos, minR = 45, maxR = 110) {
  const ang = Math.random() * Math.PI * 2;
  const r = minR + Math.random() * (maxR - minR);
  let x = (playerPos?.x || 0) + Math.cos(ang) * r;
  let z = (playerPos?.z || 0) + Math.sin(ang) * r;
  const lim = 200;
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(lim, z));
  return { x, y: 0, z };
}
