export const SANITY_MAX = 100;

/**
 * Tiers, from calmest to most broken. Thresholds are inclusive upper bounds.
 */
const TIERS = [
  { max: 20, name: 'critical' },
  { max: 45, name: 'low' },
  { max: 70, name: 'shaken' },
  { max: Infinity, name: 'stable' },
];

/**
 * Drives the player's mental state ("sanity"). This is deliberately simple
 * and deterministic (no external RNG dependency for the core drain/regen
 * math) so it stays easy to tune and easy to test.
 */
export class SanityManager {
  constructor() {
    this.lastTier = 'stable';
    this._whisperAcc = 0;
  }

  tierFor(value) {
    for (const t of TIERS) if (value <= t.max) return t.name;
    return 'stable';
  }

  /**
   * @param {object} playerData        state.data.player
   * @param {number} dt                delta time, seconds
   * @param {number} nearestMonsterDist distance in world units to closest monster
   * @param {boolean} isDark           true when unlit (no flashlight) at night/sunset and outdoors
   * @returns {{ tier: string, changed: boolean, value: number }}
   */
  update(playerData, dt, nearestMonsterDist, isDark) {
    const p = playerData;
    if (p.sanity == null) p.sanity = SANITY_MAX;
    if (!p.alive) return { tier: this.lastTier, changed: false, value: p.sanity };

    let delta = 0;

    // Darkness is unsettling, but hiding indoors feels safer even in the dark.
    if (isDark && !p.isHiding) delta -= 1.1 * dt;

    // Fear ramps sharply as a monster gets close — proximity, not just detection.
    if (nearestMonsterDist < 25) {
      const closeness = 1 - Math.min(1, Math.max(0, nearestMonsterDist) / 25);
      delta -= closeness * closeness * 9 * dt;
    }

    // Holding your breath while hiding for a long time frays your nerves too.
    if (p.isHiding && p.isHoldingBreath) delta -= 0.6 * dt;

    // Slow natural recovery only when nothing threatening is nearby.
    if (delta === 0 && nearestMonsterDist > 40) {
      delta += 3.2 * dt;
    }

    p.sanity = Math.max(0, Math.min(SANITY_MAX, p.sanity + delta));

    const tier = this.tierFor(p.sanity);
    const changed = tier !== this.lastTier;
    this.lastTier = tier;
    return { tier, changed, value: p.sanity };
  }

  /**
   * Call every frame with the current tier; returns true on the frames a
   * hallucinated whisper should play. Keeps its own internal timer so the
   * caller doesn't need to.
   */
  tickWhisper(dt, tier) {
    if (tier !== 'low' && tier !== 'critical') {
      this._whisperAcc = 0;
      return false;
    }
    this._whisperAcc += dt;
    const interval = tier === 'critical' ? 5 + Math.random() * 4 : 10 + Math.random() * 8;
    if (this._whisperAcc >= interval) {
      this._whisperAcc = 0;
      return true;
    }
    return false;
  }
}
