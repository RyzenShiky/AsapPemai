const MIN_INTERVAL = 14; // seconds — floor between any two jumpscares
const START_GRACE = 8; // seconds — no jumpscares right after a match starts

/**
 * Two distinct triggers:
 *  - "monster": a real monster closes to lunge range while actively hunting.
 *  - "hallucination": low sanity occasionally fabricates a scare with nothing
 *    actually there — rare, and only while sanity stays critical.
 */
export class JumpscareManager {
  constructor() {
    this.cooldown = START_GRACE;
  }

  reset() {
    this.cooldown = START_GRACE;
  }

  /**
   * @param {number} dt
   * @param {object} ctx
   * @param {number} ctx.nearestMonsterDist
   * @param {string} ctx.nearestMonsterState  aiState of the closest monster
   * @param {string} ctx.sanityTier
   * @param {boolean} ctx.playerAlive
   * @returns {'monster'|'hallucination'|null}
   */
  update(dt, ctx) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!ctx.playerAlive || this.cooldown > 0) return null;

    const suddenClose = ctx.nearestMonsterDist < 6 && ctx.nearestMonsterState === 'CHASE';
    if (suddenClose) {
      this.cooldown = MIN_INTERVAL;
      return 'monster';
    }

    if (ctx.sanityTier === 'critical' && Math.random() < 0.0025) {
      this.cooldown = MIN_INTERVAL;
      return 'hallucination';
    }

    return null;
  }
}
