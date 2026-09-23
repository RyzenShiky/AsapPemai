import { MonsterPerception } from '../ai/Perception.js';
import { pickSearchTarget } from '../ai/StateMachine.js';
import { clampToWorld, WORLD } from '../core/WorldConfig.js';
import { resolveCollisions, groundHeight } from '../core/Collision.js';

function distXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

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
  constructor(state, index = 0, colliders = [], room = null) {
    this.state = state;
    this.index = index;
    this.colliders = colliders;
    this.room = room;
    this.perception = new MonsterPerception();
    this.target = null;
    this.moveSpeed = 2.5;
    this.attackCooldown = 0;
    this.anchorIdx = index % PATROL_ANCHORS.length;
    this.patrolAnchors = PATROL_ANCHORS.map((a, i) => ({
      x: a.x + ((index * 37 + i * 13) % 40) - 20,
      z: a.z + ((index * 29 + i * 17) % 40) - 20,
    }));
  }

  setRoom(room) {
    this.room = room;
  }

  _frenzyMul(m) {
    const sus = m.memory.suspicion || 0;
    const intens = m.memory.lastHeardIntensity || 0;
    return 1 + (sus / 100) * 0.7 + Math.min(1, intens) * 0.5;
  }

  update(dt, now) {
    const m = this.state.data.monsters[this.index];
    if (!m || m.active === false) return;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    m.attackCooldown = this.attackCooldown;

    const events = this.state.data.world.activeSoundEvents.filter((e) => now - e.timestamp < 2.5);
    const weatherMul = this.state.data.world.weather === 'rain' ? 0.55 : 1;
    const ppos = this.state.data.player.position;
    const distP = Math.hypot(m.position.x - ppos.x, m.position.z - ppos.z);
    this.perception.update(m, events, now, dt, weatherMul, {
      playerPos: ppos,
      distToPlayer: distP,
      pacingOk: this._pacingOk !== false,
      onGhostEvent: this._onGhostEvent,
    });

    const frenzy = this._frenzyMul(m);
    const base = this.moveSpeed;

    switch (m.aiState) {
      case 'STUNNED':
        // frozen until StateMachine clears
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
          this.target = pickSearchTarget(m.memory);
        }
        if (this.target) this.moveToward(m, this.target, dt, base * frenzy);
        break;
      case 'CHASE':
        if (m.memory.lastHeardPosition) {
          this.moveToward(m, m.memory.lastHeardPosition, dt, base * 2.0 * frenzy);
        }
        break;
    }

    resolveCollisions(m.position, 0.55, this.colliders);
    const c = clampToWorld(m.position.x, m.position.z);
    m.position.x = c.x;
    m.position.z = c.z;
    m.position.y = groundHeight(m.position.x, m.position.z);
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
      m.aiState === 'CHASE' || m.aiState === 'INVESTIGATE' || (m.memory.suspicion || 0) > 40;
    if (!canAttack) return;
    const targets = [];
    const local = this.state.data.player;
    if (local && local.alive !== false) {
      targets.push({
        pos: local.position,
        apply: (dmg) => {
          if (local.isDowned) {
            // finishing blow
            local.alive = false;
            local.isDowned = false;
            this.state.data.progress.deaths += 1;
            this.state.data.progress.gameOver = true;
            this.state.data.progress.win = false;
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
    for (const t of targets) {
      if (distXZ(m.position, t.pos) < 1.6) {
        t.apply(34);
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
    const dx = target.x - m.position.x;
    const dz = target.z - m.position.z;
    const d = Math.hypot(dx, dz) || 1;
    m.position.x += (dx / d) * speed * dt;
    m.position.z += (dz / d) * speed * dt;
    m.rotation.yaw = Math.atan2(-dx, -dz);
  }

  widePatrol(m, dt, speed) {
    const anchor = this.patrolAnchors[this.anchorIdx];
    if (distXZ(m.position, anchor) < 4) {
      this.anchorIdx = (this.anchorIdx + 1) % this.patrolAnchors.length;
    }
    this.moveToward(m, this.patrolAnchors[this.anchorIdx], dt, speed);
  }
}
