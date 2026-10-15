const MIN_INTERVAL = 90; // seconds — rare, tension-gated
const START_GRACE = 12;

const KINDS = ['monster', 'doorSlam', 'flyby', 'falseAlarm'];

/**
 * Tension-gated jumpscare system.
 * Builds tension over time / near-monster, only fires when tension is high.
 * falseAlarm: shadow only, no stinger, meaningful tension release.
 */
export class JumpscareManager {
  constructor() {
    this.cooldown = START_GRACE;
    this.tension = 0;
    this.lastKind = null;
  }

  reset() {
    this.cooldown = START_GRACE;
    this.tension = 0;
    this.lastKind = null;
  }

  /**
   * @param {number} dt
   * @param {object} ctx
   * @param {number} ctx.nearestMonsterDist
   * @param {string} ctx.nearestMonsterState
   * @param {string} ctx.sanityTier
   * @param {boolean} ctx.playerAlive
   * @param {number} [ctx.eventBonus]
   * @returns {string|null} kind or null
   */
  update(dt, ctx) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!ctx.playerAlive) return null;

    const nearMonster = ctx.nearestMonsterDist < 25;
    const eventBonus = ctx.eventBonus || 0;
    this.tension = Math.max(
      0,
      Math.min(1, this.tension + dt * (nearMonster ? 0.05 : 0.01) + eventBonus)
    );

    if (this.cooldown > 0 || this.tension < 0.7) return null;

    // Prefer real monster scare if it is truly close and hunting
    const suddenClose =
      ctx.nearestMonsterDist < 6 && ctx.nearestMonsterState === 'CHASE';
    if (suddenClose) {
      this.cooldown = MIN_INTERVAL;
      this.tension = 0.15;
      this.lastKind = 'monster';
      return 'monster';
    }

    // Pick a non-repeating kind
    let pool = KINDS.filter((k) => k !== this.lastKind);
    if (ctx.sanityTier !== 'critical' && ctx.sanityTier !== 'low') {
      pool = pool.filter((k) => k !== 'hallucination');
    }
    const kind = pool[Math.floor(Math.random() * pool.length)] || 'falseAlarm';

    this.cooldown = MIN_INTERVAL;
    this.lastKind = kind;
    if (kind === 'falseAlarm') {
      this.tension = 0.2; // meaningful release without a stinger
    } else {
      this.tension = 0.1;
    }
    return kind;
  }
}
