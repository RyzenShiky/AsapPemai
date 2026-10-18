import { MONSTER_TYPES, ROSTER } from './MonsterTypes.js';
import { WORLD } from './WorldConfig.js';

const rnd = (a, b) => {
  let x = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Base gap (seconds) between successive monster spawns. */
const GAP = [12, 25];

function pickSpawn(players) {
  if (!players.length) return null;
  for (let k = 0; k < 16; k++) {
    const b = players[(Math.random() * players.length) | 0];
    const a = Math.random() * 6.283;
    const r = 70 + Math.random() * 50;
    const x = b.x + Math.cos(a) * r;
    const z = b.z + Math.sin(a) * r;
    if (Math.abs(x) > WORLD.half - 15 || Math.abs(z) > WORLD.half - 15) continue;
    const ok = players.every(
      (p) =>
        Math.hypot(p.x - x, p.z - z) >= 60 &&
        Math.abs(wrap(Math.atan2(-(x - p.x), -(z - p.z)) - (p.yaw || 0))) > 1.3
    );
    if (ok) return { x, y: 0, z };
  }
  // fallback: ignore "behind player"
  for (let k = 0; k < 24; k++) {
    const b = players[(Math.random() * players.length) | 0];
    const a = Math.random() * 6.283;
    const r = 50 + Math.random() * 60;
    const x = b.x + Math.cos(a) * r;
    const z = b.z + Math.sin(a) * r;
    if (Math.abs(x) > WORLD.half - 15 || Math.abs(z) > WORLD.half - 15) continue;
    if (players.every((p) => Math.hypot(p.x - x, p.z - z) >= 40)) return { x, y: 0, z };
  }
  return null;
}

/**
 * Host/solo only. Activates roster monsters at night, despawns at dawn.
 * @param {boolean} alwaysAll  multiplayer: raise cap to full roster; still respects night window
 */
export function updateSchedule(state, players, dayP, dayIndex, alwaysAll = false) {
  const force = !!state._forceMonsters;
  const now = state.data.world.elapsed || 0;
  const nightStart = Math.min(...ROSTER.map((r) => MONSTER_TYPES[r]?.nightAt ?? 0.42));

  const cap =
    force || alwaysAll
      ? ROSTER.length
      : Math.min(ROSTER.length, 3 + Math.floor(players.length / 2));
  const ranked = ROSTER.map((_, i) => [rnd(dayIndex, i), i]).sort((a, b) => a[0] - b[0]);
  const tonight = new Set(ranked.slice(0, cap).map((x) => x[1]));

  // Soft buffer at night start (~14s) unless force
  if (!force && dayP < nightStart + 0.03) {
    // still allow despawn path below for active monsters that should go inactive
  }

  // Scale gap slightly with player count
  const gapMul = 1 + 0.25 * Math.max(0, players.length - 1);
  const gapLo = GAP[0] * gapMul;
  const gapHi = GAP[1] * gapMul;

  for (const [, i] of ranked) {
    const m = state.data.monsters[i]; if (!m) continue;
    const cfg = MONSTER_TYPES[ROSTER[i]] || MONSTER_TYPES.shadow;
    const atNight =
      dayP >= (alwaysAll ? nightStart : cfg.nightAt) && dayP < 0.9;
    const want = force || (tonight.has(i) && atNight);

    // Optional soft start buffer
    if (want && !m.active && !force && dayP < nightStart + 0.03) continue;

    if (want && !m.active) {
      if (!force && now < (state._nextSpawnAt || 0)) continue;
      // Delay next if anyone is chasing
      if (
        !force &&
        state.data.monsters.some((x) => x.active && (x.aiState === 'CHASE' || x.aiState === 'ATTACK'))
      ) {
        state._nextSpawnAt = Math.max(state._nextSpawnAt || 0, now + 4);
        continue;
      }
      const p =
        (state._spawnFn ? state._spawnFn(players) : pickSpawn(players)) ||
        (force && players[0]
          ? { x: players[0].x + 45, y: 0, z: players[0].z }
          : null);
      if (p) {
        m.active = true;
        m.aiState = 'PATROL';
        m.memory.suspicion = 0;
        Object.assign(m.position, p);
        state._nextSpawnAt = now + gapLo + Math.random() * (gapHi - gapLo);
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
  }
}
