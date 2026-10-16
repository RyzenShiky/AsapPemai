import { ROADS, sample, distToRoad, distToRiver } from './WorldConfig.js';
import { nearBuilding } from './Buildings.js';

const SLOT = 40;

const rnd = (a, b) => {
  let x = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};

export function buildLampSites() {
  const out = [];
  let flip = 0;
  for (const r of ROADS) {
    const o = r.w / 2 + 1.4;
    for (const [x, z, nx, nz] of sample(r.pts, 24)) {
      flip ^= 1;
      const s = flip ? 1 : -1;
      const lx = x + nx * s * o;
      const lz = z + nz * s * o;
      if (distToRoad(lx, lz) < 1.0) continue;
      if (distToRiver(lx, lz) < 2) continue;
      if (nearBuilding(lx, lz, 1.5)) continue;
      if (out.some((p) => Math.hypot(p.x - lx, p.z - lz) < 12)) continue;
      out.push({ id: out.length, x: lx, z: lz, level: 0 });
    }
  }
  return out;
}

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

/** True if standing within `range` m of a lamp that is currently on (uses s.level from updateLamps). */
export function nearLitLamp(sites, x, z, range = 9) {
  if (!sites) return false;
  for (const s of sites) {
    if (s.level > 0.2 && Math.hypot(s.x - x, s.z - z) < range) return true;
  }
  return false;
}
