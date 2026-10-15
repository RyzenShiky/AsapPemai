/**
 * Day cycle: afternoon → sunset → night → dawn (loop).
 * DAY_SECONDS = length of one full day for lighting/phase.
 */
export const DAY_SECONDS = 480; // 8 minutes full cycle (was 180)
/** @deprecated use DAY_SECONDS — kept for older imports */
export const MATCH_SECONDS = DAY_SECONDS;

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

// Longer night: afternoon 25% · sunset 15% · night 50% · dawn 10%
const KEYS = [
  { t: 0.0, ...afternoon },
  { t: 0.25, ...sunset },
  { t: 0.40, ...night },
  { t: 0.90, ...night },
  { t: 1.0, ...afternoon },
];

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Progress within a single day (0..1).
 * afternoon (0–0.25) → sunset (0.25–0.40) → night (0.40–0.90) → dawn (0.90–1)
 */
export function phaseFromProgress(p) {
  const x = ((p % 1) + 1) % 1;
  if (x < 0.25) return 'afternoon';
  if (x < 0.40) return 'sunset';
  if (x < 0.90) return 'night';
  return 'dawn';
}

export function lightingForProgress(p) {
  const x = ((p % 1) + 1) % 1;
  let i = 0;
  for (let n = 0; n < KEYS.length - 1; n++) {
    if (x < KEYS[n + 1].t) {
      i = n;
      break;
    }
    i = n;
  }
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth((x - a.t) / (b.t - a.t || 1e-6));
  return lerpLight(a, b, t);
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

function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = (ar + (br - ar) * t) | 0;
  const g = (ag + (bg - ag) * t) | 0;
  const bl = (ab + (bb - ab) * t) | 0;
  return (r << 16) | (g << 8) | bl;
}

/**
 * Random spawn away from players.
 * Accepts: players array, OR single {x,z}, OR (pos, minDist, maxDist) legacy args.
 */
export function randomMonsterSpawn(playersOrPos = [], minDist = 28, maxDist = null) {
  let list = playersOrPos;
  if (!list) list = [];
  else if (!Array.isArray(list)) {
    // single player position object
    list = [list];
  }
  const minR = typeof minDist === 'number' ? minDist : 28;
  const maxR = typeof maxDist === 'number' && maxDist > minR ? maxDist : minR + 50;

  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = minR + Math.random() * (maxR - minR);
    const origin = list[0] || { x: 0, z: 8 };
    const x = (origin.x || 0) + Math.cos(a) * r;
    const z = (origin.z || 0) + Math.sin(a) * r;
    let ok = true;
    for (const p of list) {
      if (!p) continue;
      if (Math.hypot((p.x || 0) - x, (p.z || 0) - z) < minR) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, y: 0, z };
  }
  return { x: 40, y: 0, z: -40 };
}
