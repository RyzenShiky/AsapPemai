/**
 * Shared AI blackboard — loud sounds broadcast reduced confidence to other monsters.
 */
export class AIBlackboard {
  constructor() {
    this.lastGlobalSound = null; // { position, intensity, time, sourceId }
  }

  reportHeard(monsterId, position, intensity, now) {
    if (intensity < 0.45) return;
    if (
      !this.lastGlobalSound ||
      intensity > this.lastGlobalSound.intensity ||
      now - this.lastGlobalSound.time > 2
    ) {
      this.lastGlobalSound = {
        position: { ...position },
        intensity,
        time: now,
        sourceId: monsterId,
      };
    }
  }

  /** Other monsters get a weaker "hint" */
  pollHint(monsterId, now) {
    const g = this.lastGlobalSound;
    if (!g || g.sourceId === monsterId) return null;
    if (now - g.time > 4) return null;
    return {
      position: g.position,
      intensity: g.intensity * 0.35,
      age: now - g.time,
    };
  }
}

export const sharedBlackboard = new AIBlackboard();
