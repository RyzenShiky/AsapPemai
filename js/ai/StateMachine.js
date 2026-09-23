/**
 * PATROL --sound/suspicion--> INVESTIGATE --timeout--> SEARCH --timeout--> PATROL
 * Ghost investigate: false alarm near player (dread, no attack window)
 * STUNNED: vehicle knock-down
 * Any state --suspicion high + recent sound--> CHASE
 * CHASE --lost (low suspicion)--> SEARCH
 */
export function updateMonsterState(current, ctx) {
  const hasRecentSound = ctx.recentSounds.length > 0;
  const timeSinceHeard = ctx.now - (ctx.memory.lastHeardTime || 0);
  const sus = ctx.memory.suspicion;

  if (current === 'STUNNED') {
    if (ctx.now < (ctx.monster?.stunnedUntil || 0)) return 'STUNNED';
    return 'SEARCH';
  }

  // Enter CHASE from any non-chase state (not during pure ghost investigate)
  if (current !== 'CHASE' && !ctx.memory._ghostInvestigate) {
    if (sus >= 70 && (hasRecentSound || timeSinceHeard < 4)) {
      return 'CHASE';
    }
    if (sus >= 90) return 'CHASE';
  }

  switch (current) {
    case 'PATROL':
    case 'IDLE':
      if (hasRecentSound || sus > 25) {
        ctx.memory._ghostInvestigate = false;
        return 'INVESTIGATE';
      }
      if (!ctx.memory._nextGhostCheck) {
        ctx.memory._nextGhostCheck = ctx.now + 20 + Math.random() * 25;
      }
      if (
        ctx.pacingOk &&
        ctx.now > ctx.memory._nextGhostCheck &&
        ctx.distToPlayer < 60
      ) {
        ctx.memory._nextGhostCheck = ctx.now + 30 + Math.random() * 30;
        ctx.memory._ghostInvestigate = true;
        // Fake lead: offset near player, not exact position
        const ang = Math.random() * Math.PI * 2;
        const r = 5 + Math.random() * 5;
        const px = ctx.playerPos?.x || 0;
        const pz = ctx.playerPos?.z || 0;
        ctx.memory.lastHeardPosition = {
          x: px + Math.cos(ang) * r,
          y: 0,
          z: pz + Math.sin(ang) * r,
        };
        ctx.memory.lastHeardTime = ctx.now;
        ctx.memory.lastHeardIntensity = 0.2;
        if (ctx.onGhostEvent) ctx.onGhostEvent();
        return 'INVESTIGATE';
      }
      return current;

    case 'INVESTIGATE':
      if (ctx.memory._ghostInvestigate) {
        if (timeSinceHeard > 6) {
          ctx.memory._ghostInvestigate = false;
          return 'PATROL';
        }
        return 'INVESTIGATE';
      }
      if (hasRecentSound) return 'INVESTIGATE';
      if (timeSinceHeard > ctx.investigateTimeout) return 'SEARCH';
      if (sus < 5) return 'PATROL';
      return 'INVESTIGATE';

    case 'SEARCH':
      if (hasRecentSound) return 'INVESTIGATE';
      if (timeSinceHeard > ctx.searchTimeout) return 'PATROL';
      return 'SEARCH';

    case 'CHASE':
      if (sus < 30 && timeSinceHeard > 5) return 'SEARCH';
      if (sus < 15) return 'PATROL';
      return 'CHASE';

    default:
      return 'PATROL';
  }
}

export function pickSearchTarget(mem) {
  if (!mem.lastHeardPosition) return null;
  const r = mem.searchRadius * (0.3 + Math.random() * 0.7);
  const a = Math.random() * Math.PI * 2;
  return {
    x: mem.lastHeardPosition.x + Math.cos(a) * r,
    y: mem.lastHeardPosition.y,
    z: mem.lastHeardPosition.z + Math.sin(a) * r,
  };
}
