import { MONSTER_TYPES, ROSTER } from './MonsterTypes.js';

const rnd = (a, b) => {
  let x = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function pickSpawn(players) {
  if (!players.length) return null;
  for (let k = 0; k < 16; k++) {
    const b = players[(Math.random() * players.length) | 0];
    const a = Math.random() * 6.283;
    const r = 70 + Math.random() * 50;
    const x = b.x + Math.cos(a) * r;
    const z = b.z + Math.sin(a) * r;
    if (Math.abs(x) > 195 || Math.abs(z) > 195) continue;
    const ok = players.every(
      (p) =>
        Math.hypot(p.x - x, p.z - z) >= 60 &&
        Math.abs(wrap(Math.atan2(-(x - p.x), -(z - p.z)) - (p.yaw || 0))) > 1.3
    );
    if (ok) return { x, y: 0, z };
  }
  // fallback: ignore "behind player" requirement
  for (let k = 0; k < 24; k++) {
    const b = players[(Math.random() * players.length) | 0];
    const a = Math.random() * 6.283;
    const r = 50 + Math.random() * 60;
    const x = b.x + Math.cos(a) * r;
    const z = b.z + Math.sin(a) * r;
    if (Math.abs(x) > 195 || Math.abs(z) > 195) continue;
    if (players.every((p) => Math.hypot(p.x - x, p.z - z) >= 40)) return { x, y: 0, z };
  }
  return null;
}

/**
 * Host/solo only. Activates roster monsters at night, despawns at dawn.
 */
export function updateSchedule(state, players, dayP, dayIndex) {
  const force = !!state._forceMonsters;
  const cap = force
    ? ROSTER.length
    : Math.min(ROSTER.length, 3 + Math.floor(players.length / 2));
  const ranked = ROSTER.map((_, i) => [rnd(dayIndex, i), i]).sort((a, b) => a[0] - b[0]);
  const tonight = new Set(ranked.slice(0, cap).map((x) => x[1]));

  state.data.monsters.forEach((m, i) => {
    const cfg = MONSTER_TYPES[ROSTER[i]] || MONSTER_TYPES.shadow;
    const want = force || (tonight.has(i) && dayP >= cfg.nightAt && dayP < 0.9);
    if (want && !m.active) {
      const p =
        pickSpawn(players) ||
        (force && players[0]
          ? { x: players[0].x + 45, y: 0, z: players[0].z }
          : null);
      if (p) {
        m.active = true;
        m.aiState = 'PATROL';
        m.memory.suspicion = 0;
        Object.assign(m.position, p);
      }
    } else if (!want && m.active) {
      m.aiState = 'PATROL';
      m.memory.suspicion = 0;
      if (
        dayP >= 0.97 ||
        players.every((q) => Math.hypot(q.x - m.position.x, q.z - m.position.z) > 45)
      ) {
        m.active = false;
      }
    }
  });
}
