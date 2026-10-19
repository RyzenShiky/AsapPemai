import { MonsterPerception } from '../ai/Perception.js';
import { pickSearchTarget } from '../ai/StateMachine.js';
import { clampToWorld, WORLD } from '../core/WorldConfig.js';
import { resolveCollisions, groundHeight } from '../core/Collision.js';
import { canSee, openness } from '../ai/Vision.js';
import { findPath } from '../ai/Pathfinding.js';
import { inspectSpot } from './HideSpots.js';
import { MONSTER_TYPES, ROSTER } from '../core/MonsterTypes.js';
import { weatherVis } from '../core/Weather.js';
import { DOORS, isInsideBuilding, setDoor } from '../core/Buildings.js';

function distXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const BREACH = {
  stab:  [0.9, 0.8, 0.6],
  smash: [1.2, 0, 0.5],
  open:  [0.8, 0.7, 0],
  phase: [1.4, 0, 0],
};
const DOOR_REACH = 2.4;
const DOOR_STANDOFF = 1.2;
const STATE_SPEED = { INVESTIGATE: 1.3, SEARCH: 1, CHASE: 2, LOST_TARGET: 1.6, AMBUSH: 1.8 };

const PATROL_ANCHORS = [
  { x: -150, z: -150 },
  { x: 150, z: -150 },
  { x: 150, z: 150 },
  { x: -150, z: 150 },
  { x: 0, z: 0 },
  { x: -80, z: 100 },
  { x: 100, z: -60 },
];

export class MonsterController {
  constructor(state, index = 0, colliders = [], room = null, wallsOnly = null) {
    this.state = state;
    this.index = index;
    this.cfg = MONSTER_TYPES[ROSTER[index]] || MONSTER_TYPES.shadow;
    // Siren ignores trees but still blocked by walls
    this.colliders = this.cfg.ignoresTrees && wallsOnly ? wallsOnly : colliders;
    this.room = room;
    this.perception = new MonsterPerception();
    this.target = null;
    this.moveSpeed = this.cfg.speed;
    this.attackCooldown = 0;
    this.anchorIdx = index % PATROL_ANCHORS.length;
    this.patrolAnchors = PATROL_ANCHORS.map((a, i) => ({
      x: a.x + ((index * 37 + i * 13) % 40) - 20,
      z: a.z + ((index * 29 + i * 17) % 40) - 20,
    }));
    this._visionAcc = 0;
    this._stuck = 0;
    this._lastPos = null;
    this._path = null;
    this._pathIdx = 0;
    this._pathAcc = 0;
  }

  setRoom(room) {
    this.room = room;
  }

  /** Nearest living player (host + remotes), with hysteresis. */
  _pickTarget(m) {
    const me = this.state.data.player;
    const list = [];
    if (me.alive !== false)
      list.push({ uid: 'me', pos: me.position, hiding: !!me.isHiding, flash: !!me.flashlight || !!me.lighter });
    if (this.room?.isHost && this.room.remotePlayers) {
      for (const [uid, rp] of Object.entries(this.room.remotePlayers)) {
        if (uid === this.room.uid || rp.alive === false) continue;
        list.push({
          uid,
          pos: { x: rp.x, y: rp.y ?? 1.7, z: rp.z },
          hiding: !!rp.hiding,
          flash: !!rp.fl,
        });
      }
    }
    if (!list.length) return { uid: 'me', pos: me.position, hiding: !!me.isHiding, flash: !!me.flashlight };
    let best = null, bd = Infinity;
    for (const tg of list) {
      let d = Math.hypot(m.position.x - tg.pos.x, m.position.z - tg.pos.z);
      if (tg.uid === this._tgtUid) d -= 8;
      if (d < bd) { bd = d; best = tg; }
    }
    this._tgtUid = best.uid;
    return best;
  }

  _frenzyMul(m) {
    const sus = m.memory.suspicion || 0;
    const intens = m.memory.lastHeardIntensity || 0;
    return 1 + (sus / 100) * 0.7 + Math.min(1, intens) * 0.5;
  }

  /** Weakness multipliers: light (flashlight cone) / silence (quiet player). */
  _weakMul(m, dt) {
    const p = this.state.data.player;
    if (!p) return 1;

    if (this.cfg.weak === 'light' && p.flashlight) {
      const dx = m.position.x - p.position.x;
      const dz = m.position.z - p.position.z;
      const d = Math.hypot(dx, dz);
      const yaw = p.rotation.yaw;
      const facing = d > 0 ? (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / d : 0;
      if (d < 16 && facing > 0.94) return 0.45;
    }

    if (this.cfg.weak === 'silence' && (p.noiseAge ?? 99) > 4 && !m.memory.canSeePlayer) {
      const s = this.perception?.suspicion;
      if (s && typeof s.value === 'number') s.value = Math.max(0, s.value - 10 * dt);
    }
    return 1;
  }

  update(dt, now) {
    const m = this.state.data.monsters[this.index];
    if (!m || m.active === false) return; // night schedule
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    m.attackCooldown = this.attackCooldown;

    const events = this.state.data.world.activeSoundEvents.filter((e) => now - e.timestamp < 2.5);
    // weatherMul floor 0.6 so rain never fully silences the player
    const weatherMul =
      this.state.data.world.weather === 'rain'
        ? 0.7
        : this.state.data.world.weather === 'storm'
          ? 0.55
          : 1;
    const weatherMulClamped = Math.max(0.6, weatherMul) * (this.state._hearingMask ?? 1) * (this.cfg.sense?.hear ?? this.cfg.hearMul ?? 1);

    // Build target list once
    const me = this.state.data.player;
    const targets = [];
    if (me.alive !== false)
      targets.push({ uid: 'me', pos: me.position, hiding: !!me.isHiding, flash: !!me.flashlight || !!me.lighter });
    if (this.room?.isHost && this.room.remotePlayers) {
      for (const [uid, rp] of Object.entries(this.room.remotePlayers)) {
        if (uid === this.room.uid || rp.alive === false) continue;
        targets.push({ uid, pos: { x: rp.x, y: rp.y ?? 1.7, z: rp.z }, hiding: !!rp.hiding, flash: !!rp.fl });
      }
    }
    const tgt = this._pickTarget(m);
    const ppos = tgt.pos;
    const distP = Math.hypot(m.position.x - ppos.x, m.position.z - ppos.z);

    // Vision ~5×/s: check ALL players
    this._visionAcc += dt;
    if (this._visionAcc >= 0.2) {
      this._visionAcc = 0;
      const light = typeof weatherVis === 'function'
        ? weatherVis(this.state.data.world.weather)
        : (this.state.data.world.weather === 'fog' ? 0.45 : this.state.data.world.weather === 'rain' ? 0.8 : 1);
      const sense = this.cfg.sense || {};
      const fov = sense.fov ?? 1.9;
      const lampSites = this.state._lampSites || null;
      let seen = null, seenD = Infinity;
      for (const t of targets) {
        let range = t.hiding ? 7 : (sense.sightRange ?? 28);
        if (t.flash) range *= 1.25;
        if (!canSee(m, t.pos, this.colliders, { light, range, fov, lampSites })) continue;
        const d = Math.hypot(m.position.x - t.pos.x, m.position.z - t.pos.z);
        if (d < seenD) { seen = t; seenD = d; }
      }
      this._seenUid = seen ? seen.uid : null;
      m.memory.canSeePlayer = !!seen;
      if (seen) {
        m.memory.lastSeenPosition = { x: seen.pos.x, y: seen.pos.y ?? 1.7, z: seen.pos.z };
        m.memory.lastSeenTime = now;
      }
    }
    // FIX: seeing player raises suspicion (was sound-only)
    if (m.memory.canSeePlayer) {
      const near = 1 - Math.min(1, distP / (this.cfg.sense?.sightRange ?? 28));
      this.perception.suspicion.add((tgt.hiding ? 10 : 35 + 65 * near) * dt);
    }

    this.perception.update(m, events, now, dt, weatherMulClamped, {
      playerPos: ppos,
      distToPlayer: distP,
      pacingOk: this._pacingOk !== false,
      onGhostEvent: this._onGhostEvent,
      canSee: m.memory.canSeePlayer,
    });

    const frenzy = this._frenzyMul(m) * this._weakMul(m, dt);
    const base = this.moveSpeed;
    const prevX = m.position.x;
    const prevZ = m.position.z;

    if (m.aiState !== this._prevAi) {
      if (m.aiState === 'SEARCH') this._searchStep = 0;
      this._prevAi = m.aiState;
    }

    if (m.possessed) {
      if (this._br) this._breachTick(m, dt);
      return;
    }

    if (this._br) {
      this._breachTick(m, dt);
    } else {
      const goal = this._goal(m, tgt);
      const door = m.aiState === 'STUNNED' ? null : this._doorFor(m, goal);
      if (door) this._breachStart(m, door);
      else this._aiMove(m, tgt, dt, base, frenzy);
    }

    // legacy switch disabled when _aiMove used
    if (false) switch (m.aiState) {
      case 'STUNNED':
        break;
      case 'PATROL':
        this.widePatrol(m, dt, base * 0.8 * Math.min(1.2, frenzy));
        break;
      case 'INVESTIGATE':
        if (m.memory.lastHeardPosition) {
          this.moveToward(m, m.memory.lastHeardPosition, dt, base * 1.3 * frenzy);
        }
        break;
      case 'SEARCH':
        if (!this.target || distXZ(m.position, this.target) < 1.5) {
          this.target = pickSearchTarget(m.memory, this.cfg.search, this._searchStep++);
        }
        if (this.target) this.moveToward(m, this.target, dt, base * frenzy);
        break;
      case 'CHASE': {
        // Prefer live sight, else last seen, else last heard
        const t = m.memory.canSeePlayer
          ? ppos
          : m.memory.lastSeenPosition ?? m.memory.lastHeardPosition;
        if (t) this.moveToward(m, t, dt, base * 2.0 * frenzy);
        break;
      }
      case 'LOST_TARGET': {
        // Extrapolate from last seen position (not live player)
        const t = m.memory.lastSeenPosition ?? m.memory.lastHeardPosition;
        if (t) this.moveToward(m, t, dt, base * 1.6 * frenzy);
        break;
      }
      case 'AMBUSH':
        // Stay still / slow until player is close enough
        if (distP < 14) {
          this.moveToward(m, ppos, dt, base * 1.8 * frenzy);
        }
        break;
    }

    // Stuck watchdog
    const moved = Math.hypot(m.position.x - prevX, m.position.z - prevZ);
    const expected = base * dt * 0.3;
    if ((this.target || m.aiState === 'PATROL') && moved < expected) this._stuck += dt;
    else this._stuck = 0;
    if (this._stuck > 2) {
      this.target = null;
      this._pp = null;
      this.anchorIdx = (this.anchorIdx + 1) % this.patrolAnchors.length;
      this._stuck = 0;
    }

    resolveCollisions(m.position, this.cfg.radius, this.colliders);
    const c = clampToWorld(m.position.x, m.position.z);
    m.position.x = c.x;
    m.position.z = c.z;
    m.position.y = groundHeight(m.position.x, m.position.z);
    // Inspect nearby hide spots while searching
    const localP = this.state.data.player;
    if (localP?.isHiding) this.tryInspectHide(m, localP);

    this._tryAttack(m);
    this._sepFromPeers(m, dt);

    if (this.index === 0) {
      const ind = document.getElementById('suspicion-indicator');
      if (ind) {
        let maxS = 0;
        for (const mon of this.state.data.monsters) maxS = Math.max(maxS, mon.memory.suspicion || 0);
        ind.className = '';
        if (maxS >= 70) ind.classList.add('high');
        else if (maxS >= 40) ind.classList.add('mid');
        else if (maxS >= 15) ind.classList.add('low');
      }
    }
  }


  _goal(m, tgt) {
    const mem = m.memory;
    switch (m.aiState) {
      case 'INVESTIGATE':
        return mem.lastHeardPosition || null;
      case 'SEARCH':
        return this.target || null;
      case 'CHASE':
        return mem.canSeePlayer ? tgt.pos : (mem.lastSeenPosition ?? mem.lastHeardPosition ?? null);
      case 'LOST_TARGET':
        return mem.lastSeenPosition ?? mem.lastHeardPosition ?? null;
      case 'AMBUSH':
        return distXZ(m.position, tgt.pos) < 14 ? tgt.pos : null;
      default:
        return null;
    }
  }

  _blockingDoor(m, goal) {
    const from = isInsideBuilding(m.position.x, m.position.z);
    const to = isInsideBuilding(goal.x, goal.z);
    if (from === to) return null;
    const b = from || to;
    const d = DOORS.find((x) => x.id === b.id);
    return d && !d.open && !d.broken ? d : null;
  }

  _doorFor(m, goal) {
    if (!goal) return null;
    const d = this._blockingDoor(m, goal);
    return d && distXZ(m.position, d) < DOOR_REACH ? d : null;
  }

  _doorApproach(m, d) {
    const k = Math.min(1, DOOR_STANDOFF / (distXZ(m.position, d) || 1));
    return { x: d.x + (m.position.x - d.x) * k, z: d.z + (m.position.z - d.z) * k };
  }

  _aiMove(m, tgt, dt, base, frenzy) {
    const s = m.aiState;
    if (s === 'STUNNED') return;
    if (s === 'PATROL' || s === 'IDLE') {
      this.widePatrol(m, dt, base * 0.8 * Math.min(1.2, frenzy));
      return;
    }
    if (s === 'SEARCH' && (!this.target || distXZ(m.position, this.target) < 1.5)) {
      this.target = pickSearchTarget(m.memory, this.cfg.search, this._searchStep++);
    }
    const goal = this._goal(m, tgt);
    if (!goal) return;
    const door = this._blockingDoor(m, goal);
    this.moveToward(m, door ? this._doorApproach(m, door) : goal, dt, base * (STATE_SPEED[s] ?? 1) * frenzy);
  }

  _breachStart(m, d) {
    const style = BREACH[this.cfg.breach] ? this.cfg.breach : 'smash';
    const dx = d.x - m.position.x;
    const dz = d.z - m.position.z;
    const len = Math.hypot(dx, dz) || 1;
    this._br = { d, style, ph: 0, t: 0, dx: dx / len, dz: dz / len };
    m.breach = { id: d.id, ph: 0, style };
    m.rotation.yaw = Math.atan2(-dx, -dz);
  }

  _breachTick(m, dt) {
    const br = this._br;
    if (!br) return;
    if (m.aiState === 'STUNNED' || m._teleported || br.d.open || br.d.broken) {
      this._breachEnd(m, false);
      return;
    }
    this._stuck = 0;
    const times = BREACH[br.style];
    br.t += dt;
    while (br.ph < times.length && br.t >= times[br.ph]) br.t -= times[br.ph++];
    if (br.ph >= times.length) this._breachEnd(m, true);
    else m.breach.ph = br.ph;
  }

  _breachEnd(m, done) {
    const { d, style, dx, dz } = this._br;
    this._br = null;
    m.breach = null;
    this._path = null;
    if (!done) return;
    if (style === 'phase') {
      const alongZ = d.col && (d.col.maxX - d.col.minX > d.col.maxZ - d.col.minZ);
      m.position.x = alongZ ? d.x : d.x + (dx >= 0 ? 1.6 : -1.6);
      m.position.z = alongZ ? d.z + (dz >= 0 ? 1.6 : -1.6) : d.z;
    } else if (typeof this.state._doorFx === 'function') {
      this.state._doorFx(d, style === 'open' ? 'open' : 'break', dx, dz);
    } else {
      if (style !== 'open') d.broken = true;
      setDoor(d, true);
    }
  }

  /** Soft separation so 2 monsters don't stack */
  _sepFromPeers(m, dt) {
    for (let i = 0; i < this.state.data.monsters.length; i++) {
      if (i === this.index) continue;
      const o = this.state.data.monsters[i];
      const d = distXZ(m.position, o.position);
      if (d > 0 && d < 3.5) {
        const push = ((3.5 - d) / 3.5) * 2.2 * dt;
        const dx = (m.position.x - o.position.x) / d;
        const dz = (m.position.z - o.position.z) / d;
        m.position.x += dx * push;
        m.position.z += dz * push;
      }
    }
  }

  _tryAttack(m) {
    if (m.memory && m.memory._ghostInvestigate) return;
    if (this.attackCooldown > 0) return;
    const canAttack =
      m.aiState === 'CHASE' ||
      m.aiState === 'LOST_TARGET' ||
      m.aiState === 'INVESTIGATE' ||
      (m.memory.suspicion || 0) > 40;
    if (!canAttack) return;
    const targets = [];
    const local = this.state.data.player;
    if (local && local.alive !== false) {
      targets.push({
        pos: local.position,
        apply: (dmg) => {
          if (local.isDowned) {
            local.alive = false;
            local.isDowned = false;
            this.state.data.progress.deaths += 1;
            if (!this.room) {
              this.state.data.progress.gameOver = true;
              this.state.data.progress.win = false;
            }
          } else {
            local.health = Math.max(0, local.health - dmg);
            if (local.health <= 0) {
              local.health = 0;
              local.isDowned = true;
              local.downedTimer = 45;
              local.isHiding = false;
            }
          }
        },
      });
    }
    if (this.room?.isHost && this.room.remotePlayers) {
      for (const [uid, rp] of Object.entries(this.room.remotePlayers)) {
        if (uid === this.room.uid || rp.alive === false) continue;
        targets.push({
          pos: { x: rp.x, z: rp.z },
          apply: (dmg) => this.room.applyDamage(uid, dmg),
        });
      }
    }
    targets.sort((a, b) => Math.hypot(m.position.x - a.pos.x, m.position.z - a.pos.z) - Math.hypot(m.position.x - b.pos.x, m.position.z - b.pos.z));
    for (const t of targets) {
      // Require open line (no thin-wall punches)
      if (
        distXZ(m.position, t.pos) < this.cfg.reach &&
        openness(this.colliders, m.position, t.pos) > 0
      ) {
        t.apply(this.cfg.dmg);
        this.attackCooldown = 1.2;
        this.state.emitSound({
          position: { ...m.position },
          intensity: 1,
          radius: 40,
          type: 'impact',
        });
        break;
      }
    }
  }

  moveToward(m, target, dt, speed) {
    // Refresh local A* path every ~0.8 s when chasing/searching
    this._pathAcc = (this._pathAcc || 0) + dt;
    const exhausted = !this._path || this._pathIdx >= (this._path?.length || 0);
    if (this._path === undefined || this._pathAcc > 0.8 || (exhausted && this._pathAcc > 0.25)) {
      this._pathAcc = 0;
      this._path = findPath(this.colliders, m.position, target) || null;
      this._pathIdx = 0;
    }
    let aim = target;
    if (this._path && this._pathIdx < this._path.length) {
      aim = this._path[this._pathIdx];
      const reach = this.colliders?.levelPath ? 0.9 : 2.2;
      if (Math.hypot(aim.x - m.position.x, aim.z - m.position.z) < reach) {
        this._pathIdx++;
        if (this._pathIdx < this._path.length) aim = this._path[this._pathIdx];
      }
    }
    const dx = aim.x - m.position.x;
    const dz = aim.z - m.position.z;
    const d = Math.hypot(dx, dz) || 1;
    m.position.x += (dx / d) * speed * dt;
    m.position.z += (dz / d) * speed * dt;
    m.rotation.yaw = Math.atan2(-dx, -dz);
  }

  /** Called when SEARCH is near a player who is hiding. */
  tryInspectHide(m, p) {
    if (!p.isHiding || !p.hideSpot) return false;
    const d = Math.hypot(m.position.x - p.hideSpot.x, m.position.z - p.hideSpot.z);
    if (d > 3) return false;
    if (m.aiState !== 'SEARCH' && m.aiState !== 'INVESTIGATE') return false;
    const found = inspectSpot(m, p.hideSpot, p);
    if (found) {
      p.isHiding = false;
      p.hideSpot = null;
      p.isHoldingBreath = false;
      m.memory.suspicion = Math.max(m.memory.suspicion || 0, 80);
      m.memory.canSeePlayer = true;
      m.memory.lastSeenPosition = { ...p.position };
      return true;
    }
    return false;
  }

  widePatrol(m, dt, speed) {
    if (m._teleported) {
      this._pp = null;
      this.target = null;
      this._path = null;
      m._teleported = false;
    }
    const lv = this.state._level;
    if (lv && lv.patrol) {
      this._ppT = (this._ppT || 0) + dt;
      if (!this._pp || this._ppT > 10 || distXZ(m.position, this._pp) < 1.5) {
        this._pp = lv.patrol(Math.random() < 0.65 ? this.state.data.player.position : m.position);
        this._ppT = 0;
      }
      this.moveToward(m, this._pp, dt, speed);
      return;
    }
    this._ppT = (this._ppT || 0) + dt;
    if (!this._pp || this._ppT > 25 || distXZ(m.position, this._pp) < 5) {
      this._pp = this._randomPatrolPoint(m);
      this._ppT = 0;
    }
    this.moveToward(m, this._pp, dt, speed);
  }


  _randomPatrolPoint(m) {
    const H = WORLD.half - 20;
    const seen = (this._visit ||= new Map());
    let best = null, bestT = Infinity;
    for (let k = 0; k < 4; k++) {
      const x = (Math.random() * 2 - 1) * H, z = (Math.random() * 2 - 1) * H;
      const key = (((x + H) / 72) | 0) + ',' + (((z + H) / 72) | 0);
      const test = { x, z };
      resolveCollisions(test, 1.2, this.colliders);
      if (Math.hypot(test.x - x, test.z - z) > 0.05) continue;
      const t = seen.get(key) ?? 0;
      if (t < bestT) { bestT = t; best = { x, z, key }; }
    }
    if (!best) {
      return {
        x: m.position.x + (Math.random() - 0.5) * 80,
        z: m.position.z + (Math.random() - 0.5) * 80,
      };
    }
    seen.set(best.key, performance.now());
    return best;
  }
}
