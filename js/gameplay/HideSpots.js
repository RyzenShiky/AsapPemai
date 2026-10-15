import { SPOTS } from './Items.js';
import { isInsideBuilding } from '../core/Buildings.js';

/**
 * Typed hide spots. When player toggles hide, we assign the nearest matching type.
 * Monster inspect() rolls chance based on spot type + confidence + noise + breath.
 */
const DEFAULT_SPOTS = [
  // Approximate interior spots — refined at runtime by position
  { id: 'cabin_locker', type: 'locker', x: 0, z: 0, r: 4, eye: { y: 1.45 } },
  { id: 'cabin_bed', type: 'bed', x: 0, z: 0, r: 4, eye: { y: 1.2 } },
  { id: 'bush_a', type: 'bush', x: 25, z: -18, r: 3, eye: { y: 1.3 } },
  { id: 'bush_b', type: 'bush', x: -40, z: 30, r: 3, eye: { y: 1.3 } },
  { id: 'room_default', type: 'room', x: 0, z: 0, r: 20, eye: { y: 1.5 } },
];

export function nearestSpot(px, pz, spots = DEFAULT_SPOTS) {
  let best = null;
  let bestD = Infinity;
  for (const s of spots) {
    const d = Math.hypot(s.x - px, s.z - pz);
    if (d < s.r && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  // Fallback: any interior counts as "room"
  if (!best && isInsideBuilding(px, pz)) {
    return { id: 'room_auto', type: 'room', x: px, z: pz, r: 8, eye: { y: 1.5 } };
  }
  return best;
}

/**
 * Monster inspect roll when SEARCH arrives within 3 m of a hide spot the player is in.
 * @returns {boolean} true = player found
 */
export function inspectSpot(m, spot, p) {
  const base = SPOTS[spot?.type] ?? 0.4;
  let f = 1 - base;
  f += (m.memory?.confidence || 0) * 0.25;
  if ((p.noiseAge ?? 99) < 2) f += 0.3;
  if (p.isHoldingBreath) f *= 0.5;
  if ((p.breath ?? 100) <= 0) f += 0.2;
  return Math.random() < Math.min(0.85, Math.max(0.05, f));
}

export { DEFAULT_SPOTS };
