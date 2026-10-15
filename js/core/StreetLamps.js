import { ROADS, sample } from './WorldConfig.js';

const SLOT = 40; // seconds per lamp fate slot

const rnd = (a, b) => {
  let x = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};

export function buildLampSites() {
  const out = [];
  let id = 0;
  for (const r of ROADS) {
    for (const [x, z, nx, nz] of sample(r.pts, 24)) {
      const side = id % 2 ? 1 : -1;
      const o = r.w / 2 + 1.2;
      out.push({ id: id++, x: x + nx * side * o, z: z + nz * side * o, level: 0 });
    }
  }
  return out;
}

/** Deterministic lamp brightness 0..1 — identical on every client. */
export function lampLevel(id, t, dayP) {
  const ramp = Math.min(1, Math.max(0, (dayP - 0.38) / 0.04), Math.max(0, (0.92 - dayP) / 0.04));
  if (ramp <= 0) return 0;
  const slot = Math.floor(t / SLOT);
  const local = t - slot * SLOT;
  const risk = dayP > 0.65 ? 0.25 : 0.08;
  const dead = (s) => rnd(id, s) < risk;
  let v = dead(slot) ? 0 : 1;
  if (dead(slot) !== dead(slot - 1) && local < 1.4) {
    const strobe = rnd(id, Math.floor(t * 18)) > 0.5;
    v = dead(slot) ? (strobe ? 0.7 : 0) : strobe ? 1 : 0.1;
  }
  return v * ramp;
}

/** True if standing within `range` m of a lamp that is currently on. */
export function nearLitLamp(sites, x, z, range = 9) {
  if (!sites) return false;
  for (const s of sites) {
    if (s.level > 0.2 && Math.hypot(s.x - x, s.z - z) < range) return true;
  }
  return false;
}
