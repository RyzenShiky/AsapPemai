/**
 * PATROL --sound/suspicion--> INVESTIGATE --timeout--> SEARCH --timeout--> PATROL
 * Ghost investigate: false alarm near player (dread, no attack window)
 * STUNNED: vehicle knock-down
 * Any state --canSee + suspicion--> CHASE
 * CHASE --lost--> LOST_TARGET --timeout--> SEARCH
 * SEARCH --repeated player route--> AMBUSH
 */
export function updateMonsterState(current, ctx) {
  const hasRecentSound = ctx.recentSounds.length > 0;
  const timeSinceHeard = ctx.now - (ctx.memory.lastHeardTime || 0);
  const sus = ctx.memory.suspicion;
  const canSee = !!ctx.canSee;

  if (current === 'STUNNED') {
    if (ctx.now < (ctx.monster?.stunnedUntil || 0)) return 'STUNNED';
    return 'SEARCH';
  }

  // Enter CHASE from any non-chase state (not during pure ghost investigate)
  if (current !== 'CHASE' && current !== 'LOST_TARGET' && !ctx.memory._ghostInvestigate) {
    if (canSee && sus > 20) return 'CHASE';
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
      // Ambush: player keeps using the same route/spot
      if (ctx.memory.routeRepeats >= 3 && ctx.distToPlayer < 25) {
        ctx.memory.ambushUntil = ctx.now + 12 + Math.random() * 8;
        ctx.memory.routeRepeats = 0;
        return 'AMBUSH';
      }
      if (timeSinceHeard > ctx.searchTimeout) return 'PATROL';
      return 'SEARCH';

    case 'CHASE':
      // Lost target → go to last known + extrapolated heading
      if (sus < 30 && timeSinceHeard > (ctx.fastTarget ? 12 : 5) && !canSee) {
        ctx.memory.lostAt = ctx.now;
        return 'LOST_TARGET';
      }
      if (sus < 15) return 'PATROL';
      return 'CHASE';

    case 'LOST_TARGET':
      // Head toward last seen / last heard position, not live player
      if (hasRecentSound) return 'INVESTIGATE';
      if (canSee && sus > 20) return 'CHASE';
      return ctx.now - (ctx.memory.lostAt || 0) > (ctx.fastTarget ? 14 : 6) ? 'SEARCH' : current;

    case 'AMBUSH':
      if (ctx.distToPlayer < 12 && canSee) return 'CHASE';
      if (ctx.now > (ctx.memory.ambushUntil || 0)) return 'SEARCH';
      return current;

    default:
      return 'PATROL';
  }
}

export function pickSearchTarget(mem, style, step = 0) {
  const c = mem.lastHeardPosition;
  if (!c) return null;
  const R = mem.searchRadius || 12;

  if (style === 'spiral') {
    const a = step * 2.4;
    const r = Math.min(R, 3 + step * 2.2);
    return { x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r };
  }
  if (style === 'sweep') {
    const d = (mem._sweepDir ??= Math.random() * Math.PI);
    const side = step % 2 ? 1 : -1;
    const lane = ((Math.floor(step / 2) % 3) - 1) * R * 0.35;
    return {
      x: c.x + Math.cos(d) * side * R + Math.cos(d + Math.PI / 2) * lane,
      y: c.y,
      z: c.z + Math.sin(d) * side * R + Math.sin(d + Math.PI / 2) * lane,
    };
  }
  const r = R * (0.3 + Math.random() * 0.7);
  const a = Math.random() * Math.PI * 2;
  return { x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r };
}
