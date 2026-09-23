import { resolveCollisions, groundHeight } from '../core/Collision.js';
import { clampToWorld } from '../core/WorldConfig.js';

const SEAT_DEFAULTS = {
  motor: {
    DriverSeat: { x: 0, y: 1.0, z: 0.15 },
    PassengerSeat: { x: 0, y: 1.05, z: -0.55 },
  },
  mobil: {
    DriverSeat: { x: -0.45, y: 0.9, z: 0.5 },
    PassengerSeatFront: { x: 0.45, y: 0.9, z: 0.5 },
    PassengerSeatRearL: { x: -0.45, y: 0.9, z: -0.55 },
    PassengerSeatRearR: { x: 0.45, y: 0.9, z: -0.55 },
  },
};

function distXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export class VehicleController {
  constructor(type, position, id = null) {
    this.id = id || `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.type = type; // 'motor' | 'mobil'
    this.position = { x: position.x, y: position.y || 0, z: position.z };
    this.rotation = { yaw: 0 };
    this.driverUid = null;
    this.passengerUids = [];
    this.speed = 0;
    this.targetSpeed = 0;
    this.crashShake = 0;
    this.seatOffsets = SEAT_DEFAULTS[type] || SEAT_DEFAULTS.motor;
  }

  maxPassengers() {
    return this.type === 'motor' ? 1 : 3;
  }

  mount(uid, preferDriver = true) {
    if (preferDriver && !this.driverUid) {
      this.driverUid = uid;
      return 'driver';
    }
    if (!this.driverUid && preferDriver !== false) {
      this.driverUid = uid;
      return 'driver';
    }
    if (this.passengerUids.length < this.maxPassengers()) {
      this.passengerUids.push(uid);
      return 'passenger';
    }
    return null;
  }

  dismount(uid) {
    if (this.driverUid === uid) {
      this.driverUid = null;
      // leave vehicle stopped; passenger must remount as driver
    } else {
      this.passengerUids = this.passengerUids.filter((u) => u !== uid);
    }
  }

  isOccupiedBy(uid) {
    return this.driverUid === uid || this.passengerUids.includes(uid);
  }

  seatNameForRole(role, passengerIndex = 0) {
    if (role === 'driver') return 'DriverSeat';
    if (this.type === 'motor') return 'PassengerSeat';
    const seats = ['PassengerSeatFront', 'PassengerSeatRearL', 'PassengerSeatRearR'];
    return seats[Math.min(passengerIndex, seats.length - 1)];
  }

  worldSeatPosition(role, passengerIndex = 0) {
    const key = this.seatNameForRole(role, passengerIndex);
    const local = this.seatOffsets[key] || { x: 0, y: 1, z: 0 };
    const cos = Math.cos(this.rotation.yaw);
    const sin = Math.sin(this.rotation.yaw);
    return {
      x: this.position.x + (local.x * cos - local.z * sin),
      y: this.position.y + local.y,
      z: this.position.z + (local.x * sin + local.z * cos),
    };
  }

  /**
   * Driver-only physics. Call from host or local driver.
   */
  driveUpdate(dt, keys, colliders, state, audio, myUid) {
    this.crashShake = Math.max(0, this.crashShake - dt * 2);
    if (this.driverUid !== myUid) return;

    const turn = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
    const throttle = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const maxSpd = this.type === 'motor' ? 9 : 14;
    const turnRate = this.type === 'motor' ? 2.2 : 1.3;

    this.targetSpeed = throttle * maxSpd;
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, 3 * dt);
    if (Math.abs(this.speed) > 0.3) {
      this.rotation.yaw += turn * turnRate * dt * Math.sign(this.speed || 1);
    }

    const prev = { x: this.position.x, z: this.position.z };
    const dx = -Math.sin(this.rotation.yaw) * this.speed * dt;
    const dz = -Math.cos(this.rotation.yaw) * this.speed * dt;
    this.position.x += dx;
    this.position.z += dz;

    const radius = this.type === 'mobil' ? 1.3 : 0.55;
    resolveCollisions(this.position, radius, colliders);
    const c = clampToWorld(this.position.x, this.position.z);
    this.position.x = c.x;
    this.position.z = c.z;
    this.position.y = groundHeight(this.position.x, this.position.z);

    const expectedX = prev.x + dx;
    const expectedZ = prev.z + dz;
    const pushed = Math.hypot(this.position.x - expectedX, this.position.z - expectedZ);
    if (pushed > 0.05 && Math.abs(this.speed) > 4) {
      this.speed *= 0.25;
      this.crashShake = Math.min(1, Math.abs(this.speed) / 10 + 0.4);
      state.emitSound({
        position: { ...this.position },
        intensity: 1,
        radius: 70,
        type: 'crash',
      });
      if (audio?.playCrashThud) audio.playCrashThud(pushed);
    }

    // Engine noise proportional to speed — feeds sound AI
    if (Math.abs(this.speed) > 1.5) {
      const intens = Math.min(1, Math.abs(this.speed) / maxSpd);
      state.emitSound({
        position: { ...this.position },
        intensity: 0.35 + intens * 0.55,
        radius: 55 + intens * 30,
        type: 'engine',
      });
    }
  }

  /** High-speed hit stuns monster; low-speed hurts rider. */
  checkMonsterHits(monsters, now, applyDamageToRiders) {
    for (const m of monsters) {
      if (!m || m.active === false) continue;
      if (m.aiState === 'STUNNED' && m.stunnedUntil && now < m.stunnedUntil) continue;
      const hitR = this.type === 'mobil' ? 1.6 : 1.0;
      if (distXZ(this.position, m.position) < hitR) {
        if (Math.abs(this.speed) > 6) {
          m.aiState = 'STUNNED';
          m.stunnedUntil = now + (this.type === 'mobil' ? 4 : 2);
          this.speed *= 0.5;
        } else if (Math.abs(this.speed) < 3) {
          applyDamageToRiders?.(25);
        }
      }
    }
  }
}

export function findDismountSpot(vehicle, colliders, playerRadius = 0.4) {
  const tryAngles = [90, -90, 135, -135, 180, 45, -45];
  const dismountRadius = vehicle.type === 'mobil' ? 2.4 : 1.4;
  for (const deg of tryAngles) {
    const a = vehicle.rotation.yaw + (deg * Math.PI) / 180;
    const spot = {
      x: vehicle.position.x + Math.sin(a) * dismountRadius,
      z: vehicle.position.z + Math.cos(a) * dismountRadius,
    };
    const test = { x: spot.x, z: spot.z };
    resolveCollisions(test, playerRadius, colliders);
    if (Math.hypot(test.x - spot.x, test.z - spot.z) < 0.08) return spot;
  }
  return {
    x: vehicle.position.x,
    z: vehicle.position.z + dismountRadius,
  };
}
