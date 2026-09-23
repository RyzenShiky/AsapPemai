/**
 * Single-pass nearest-monster distance for danger UI, heartbeat, and cues.
 */
export function nearestMonsterDist(playerPos, monsters) {
  let best = Infinity;
  let nearest = null;
  const px = playerPos.x;
  const pz = playerPos.z;
  for (let i = 0; i < monsters.length; i++) {
    const m = monsters[i];
    const dx = m.position.x - px;
    const dz = m.position.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < best * best) {
      // only sqrt when potentially closer
      const d = Math.sqrt(d2);
      if (d < best) {
        best = d;
        nearest = m;
      }
    }
  }
  return { dist: best, monster: nearest };
}

/** Map distance → heart BPM and danger 0..1 */
export function heartFromDistance(dist) {
  // calm 70 BPM far away; up to ~160 when on top of player
  if (!Number.isFinite(dist) || dist > 25) {
    return { bpm: 70, danger: 0, near: false };
  }
  if (dist >= 18) {
    const t = (25 - dist) / 7;
    return { bpm: 70 + t * 15, danger: t * 0.15, near: false };
  }
  if (dist >= 8) {
    const t = (18 - dist) / 10;
    return { bpm: 85 + t * 35, danger: 0.15 + t * 0.35, near: true };
  }
  if (dist >= 3.5) {
    const t = (8 - dist) / 4.5;
    return { bpm: 120 + t * 30, danger: 0.5 + t * 0.35, near: true };
  }
  const t = Math.max(0, Math.min(1, (3.5 - dist) / 3.5));
  return { bpm: 150 + t * 25, danger: 0.85 + t * 0.15, near: true };
}
