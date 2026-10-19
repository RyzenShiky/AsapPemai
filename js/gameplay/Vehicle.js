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

/** GLB forward = +Z, game forward movement = -Z */
export const VEHICLE_FACE = Math.PI;

export function seatToWorld(v, s) {
  const a = v.rotation.yaw + VEHICLE_FACE;
  const c = Math.cos(a);
  const n = Math.sin(a);
  return {
    x: v.position.x + s.x * c + s.z * n,
    y: (v.position.y || 0) + s.y,
    z: v.position.z - s.x * n + s.z * c,
  };
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
      this.speed = 0;
      this._steer = 0;
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
    return seatToWorld(this, this.seatOffsets[key] || { x: 0, y: 1, z: 0 });
  }

  /**
   * Driver-only physics. Call from host or local driver.
   */
  driveUpdate(dt, keys, colliders, state, audio, myUid) {
    this.crashShake = Math.max(0, this.crashShake - dt * 2);
    if (this.driverUid !== myUid) return;

    const down = (codes) => codes.some((c) => keys.has(c));
    const ax = keys.axis;
    const dead = 0.15;
    const f = (v) => (Math.abs(v) < dead ? 0 : (Math.sign(v) * (Math.abs(v) - dead)) / (1 - dead));
    const useAx = ax && (Math.abs(ax.x) > dead || Math.abs(ax.y) > dead);
    const turn = useAx ? -f(ax.x) : (down(['KeyA', 'ArrowLeft']) ? 1 : 0) - (down(['KeyD', 'ArrowRight']) ? 1 : 0);
    const throttle = useAx ? -f(ax.y) : (down(['KeyW', 'ArrowUp']) ? 1 : 0) - (down(['KeyS', 'ArrowDown']) ? 1 : 0);
    const maxSpd = this.type === 'motor' ? 13 : 18;
    const turnRate = this.type === 'motor' ? 1.8 : 1.0;

    this.targetSpeed = throttle * maxSpd;
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, 3 * dt);
    if (Math.abs(this.speed) > 0.3) {
      this._steer = (this._steer || 0) + (turn - (this._steer || 0)) * Math.min(1, 8 * dt);
      const rate = turnRate * (1 - 0.45 * Math.min(1, Math.abs(this.speed) / maxSpd));
      this.rotation.yaw += this._steer * rate * dt * Math.sign(this.speed || 1);
    }

    const prev = { x: this.position.x, z: this.position.z };
    const dx = -Math.sin(this.rotation.yaw) * this.speed * dt;
    const dz = -Math.cos(this.rotation.yaw) * this.speed * dt;
    this.position.x += dx;
    this.position.z += dz;

    const radius = this.type === 'mobil' ? 1.1 : 0.55;
    resolveCollisions(this.position, radius, colliders);
    const c = clampToWorld(this.position.x, this.position.z);
    this.position.x = c.x;
    this.position.z = c.z;
    this.position.y = groundHeight(this.position.x, this.position.z);

    const expectedX = prev.x + dx;
    const expectedZ = prev.z + dz;
    this._crashCd = Math.max(0, (this._crashCd || 0) - dt);
    const step = Math.hypot(dx, dz) || 1e-6;
    const pushed = Math.hypot(this.position.x - expectedX, this.position.z - expectedZ);
    const head = Math.min(1, pushed / step); // 0 = menyamping, 1 = lurus
    if (head > 0.35 && Math.abs(this.speed) > 5 && this._crashCd <= 0) {
      this._crashCd = 0.6;
      this.crashShake = Math.min(1, Math.abs(this.speed) / 10 + 0.4);
      this.speed *= 1 - 0.6 * head;
      state.emitSound({
        position: { ...this.position },
        intensity: 1,
        radius: 70,
        type: 'crash',
      });
      if (audio?.playCrashThud) audio.playCrashThud(pushed);
    } else if (pushed > 0.01) {
      this.speed *= 1 - Math.min(0.12, head * 0.3); // senggol: sedikit melambat
    }

    // Engine noise ~4×/s (not every frame) so suspicion stays fair
    this._engAcc = (this._engAcc || 0) + dt;
    if (Math.abs(this.speed) > 1.5 && this._engAcc >= 0.25) {
      this._engAcc = 0;
      const intens = Math.min(1, Math.abs(this.speed) / maxSpd);
      state.emitSound({
        position: { ...this.position },
        intensity: 0.35 + intens * 0.55,
        radius: 35 + intens * 25,
        type: 'engine',
      });
    }
  }

  /** High-speed hit stuns monster; low-speed hurts rider (with cooldown). */
  checkMonsterHits(monsters, now, applyDamageToRiders) {
    for (const m of monsters) {
      if (!m || m.active === false) continue;
      if (m.aiState === 'STUNNED' && m.stunnedUntil && now < m.stunnedUntil) continue;
      const hitR = this.type === 'mobil' ? 1.6 : 1.0;
      if (distXZ(this.position, m.position) >= hitR) continue;
      if (Math.abs(this.speed) > 6) {
        m.aiState = 'STUNNED';
        m.stunnedUntil = now + (this.type === 'mobil' ? 4 : 2);
        this.speed *= 0.5;
      } else if (Math.abs(this.speed) < 3 && now >= (this._nextRiderHitAt || 0)) {
        this._nextRiderHitAt = now + 1.2;
        applyDamageToRiders?.(25);
      }
    }
  }
}

export function findDismountSpot(vehicle, colliders, playerRadius = 0.4) {
  const tryAngles = [90, -90, 135, -135, 0, 45, -45];
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
