const MIN_INTERVAL = 45;
const START_GRACE = 12;
const FIRE_AT = 0.55;
const KINDS = ['monster', 'doorSlam', 'flyby', 'falseAlarm', 'hallucination'];

/**
 * Tension-gated jumpscare system.
 * Builds tension over time / near-monster, only fires when tension is high.
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

  update(dt, ctx) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!ctx.playerAlive) return null;

    const nearMonster = ctx.nearestMonsterDist < 25;
    const eventBonus = ctx.eventBonus || 0;
    this.tension = Math.max(0, Math.min(1,
      this.tension + dt * (nearMonster ? 0.06 : 0.02) + eventBonus));

    if (this.cooldown > 0 || this.tension < FIRE_AT) return null;

    const suddenClose = ctx.nearestMonsterDist < 6 && ctx.nearestMonsterState === 'CHASE';
    if (suddenClose) {
      this.cooldown = MIN_INTERVAL; this.tension = 0.15; this.lastKind = 'monster';
      return 'monster';
    }

    let pool = KINDS.filter((k) => k !== this.lastKind);
    if (ctx.sanityTier === 'stable') pool = pool.filter((k) => k !== 'hallucination');
    if (!(ctx.nearestMonsterDist < 45)) pool = pool.filter((k) => k !== 'monster');
    const kind = pool[Math.floor(Math.random() * pool.length)] || 'falseAlarm';

    this.cooldown = MIN_INTERVAL;
    this.lastKind = kind;
    this.tension = kind === 'falseAlarm' ? 0.2 : 0.1;
    return kind;
  }
}
