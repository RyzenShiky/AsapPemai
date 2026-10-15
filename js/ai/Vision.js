import { nearbyColliders } from '../core/Collision.js';
import { nearLitLamp } from '../core/StreetLamps.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Openness of line of sight: 1 = clear, 0 = fully blocked by wall. */
export function openness(sp, a, b) {
  let v = 1;
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
  for (let i = 1; i < n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n;
    const z = a.z + ((b.z - a.z) * i) / n;
    for (const c of nearbyColliders(sp, x, z)) {
      if (c.type === 'wall') {
        if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return 0;
      } else if (Math.hypot(x - c.x, z - c.z) < c.r + 0.4) {
        v -= 0.25; // vegetation thins the view
      }
    }
  }
  return Math.max(0, v);
}

/**
 * Can monster `m` see target position `t`?
 * @param {object} m  monster with position + rotation.yaw
 * @param {{x,z}} t   target position
 * @param {object} sp spatial grid / colliders
 * @param {{range?, fov?, light?}} opts
 */
export function canSee(m, t, sp, { range = 28, fov = 1.9, light = 1, lampSites = null } = {}) {
  const dx = t.x - m.position.x;
  const dz = t.z - m.position.z;
  const d = Math.hypot(dx, dz);
  // Standing under a lit street lamp increases visibility range for the monster
  let lightMul = light;
  if (lampSites && nearLitLamp(lampSites, t.x, t.z, 9)) lightMul = Math.max(lightMul, 1.25);
  if (d > range * lightMul) return false;
  if (d > 3 && Math.abs(wrap(Math.atan2(-dx, -dz) - m.rotation.yaw)) > fov / 2) return false;
  return openness(sp, m.position, t) > 0.35;
}
