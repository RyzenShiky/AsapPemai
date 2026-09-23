import { processHearing } from './Hearing.js';
import { SuspicionSystem } from './Suspicion.js';
import { updateMonsterState } from './StateMachine.js';

export class MonsterPerception {
  constructor() {
    this.suspicion = new SuspicionSystem();
  }

  /**
   * @param {object} extra optional: playerPos, distToPlayer, pacingOk, onGhostEvent, monster
   */
  update(monster, events, now, dt, weatherMul = 1, extra = {}) {
    this.suspicion.update(dt);
    const heard = processHearing(monster, events, now, this.suspicion, weatherMul);
    monster.memory.suspicion = this.suspicion.value;
    monster.aiState = updateMonsterState(monster.aiState, {
      memory: monster.memory,
      recentSounds: heard,
      now,
      dt,
      investigateTimeout: 6,
      searchTimeout: 18,
      playerPos: extra.playerPos,
      distToPlayer: extra.distToPlayer ?? 999,
      pacingOk: extra.pacingOk !== false,
      onGhostEvent: extra.onGhostEvent,
      monster,
    });
  }
}
