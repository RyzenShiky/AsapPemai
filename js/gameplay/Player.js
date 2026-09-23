import { clampToWorld } from '../core/WorldConfig.js';
import { isInsideBuilding } from '../core/Buildings.js';
import { resolveCollisions, groundHeight } from '../core/Collision.js';

const WALK = 2.8, RUN = 5.5, CROUCH = 1.4;
const STAMINA_DRAIN = 25, STAMINA_REGEN = 18;
const PLAYER_RADIUS = 0.4;

export class PlayerController {
  constructor(canvas, state, colliders = [], audio = null) {
    this.canvas = canvas;
    this.state = state;
    this.colliders = colliders;
    this.audio = audio;
    this.keys = new Set();
    this.pointerLocked = false;
    this.sensitivity = 0.0022;
    this.touchSensitivity = 0.0045;
    this._footAcc = 0;
    this.flashlightOn = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyF') {
        this.flashlightOn = !this.flashlightOn;
        if (this.state.data.player) this.state.data.player.flashlight = this.flashlightOn;
      }
      if (e.code === 'KeyH') this.toggleHide();
      if (e.code === 'KeyQ') this.throwDistraction();
    });
    this._spaceDown = false;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { this._spaceDown = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this._spaceDown = false;
    });

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('click', () => {
      if (!('ontouchstart' in window)) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.applyLook(e.movementX, e.movementY, this.sensitivity);
    });
  }


  toggleHide() {
    const p = this.state.data.player;
    if (p.isDowned) return;
    const inside = isInsideBuilding(p.position.x, p.position.z);
    if (!inside && !p.isHiding) return; // can only start hide inside
    p.isHiding = !p.isHiding;
    if (!p.isHiding) {
      p.isHoldingBreath = false;
    }
  }

  throwDistraction() {
    const p = this.state.data.player;
    if (p.isDowned || p.isHiding || (p.throwables || 0) <= 0) return false;
    p.throwables -= 1;
    const yaw = p.rotation.yaw;
    const dist = 11;
    const from = { x: p.position.x, y: p.position.y - 0.3, z: p.position.z };
    const to = {
      x: p.position.x - Math.sin(yaw) * dist,
      y: 0.4,
      z: p.position.z - Math.cos(yaw) * dist,
    };
    this.state.emitSound({
      position: { x: to.x, y: to.y, z: to.z },
      intensity: 1.0,
      radius: 42,
      type: 'throw',
    });
    if (this.onThrow) this.onThrow(from, to);
    return true;
  }

  applyLook(dx, dy, sens = this.touchSensitivity) {
    const p = this.state.data.player;
    p.rotation.yaw -= dx * sens;
    p.rotation.pitch -= dy * sens;
    p.rotation.pitch = Math.max(-1.4, Math.min(1.4, p.rotation.pitch));
  }

  update(dt) {
    const p = this.state.data.player;
    if (!p.alive) return;
    p.flashlight = this.flashlightOn;

    // Riding vehicle — camera look stays free; WASD only if driver
    if (p.ridingVehicleId) {
      const vData = this.state.getVehicle(p.ridingVehicleId);
      if (!vData) {
        p.ridingVehicleId = null;
        p.ridingRole = null;
      } else {
        // position lock to seat (drive physics run elsewhere for driver)
        const role = p.ridingRole || 'passenger';
        const seatLocal =
          role === 'driver'
            ? (vData.seatOffsets?.DriverSeat || { x: 0, y: 1, z: 0.2 })
            : (vData.seatOffsets?.PassengerSeat ||
               vData.seatOffsets?.PassengerSeatFront ||
               { x: 0, y: 1, z: -0.4 });
        const cos = Math.cos(vData.rotation.yaw);
        const sin = Math.sin(vData.rotation.yaw);
        p.position.x = vData.position.x + (seatLocal.x * cos - seatLocal.z * sin);
        p.position.z = vData.position.z + (seatLocal.x * sin + seatLocal.z * cos);
        p.position.y = (vData.position.y || 0) + seatLocal.y;
        p.moveState = 'riding';
        p.isRunning = false;
        return;
      }
    }

    // Downed: crawl only, countdown to death
    if (p.isDowned) {
      p.isHiding = false;
      p.isHoldingBreath = false;
      p.isRunning = false;
      p.moveState = 'crawl';
      p.downedTimer = (p.downedTimer || 45) - dt;
      if (p.downedTimer <= 0) {
        p.alive = false;
        p.isDowned = false;
        this.state.data.progress.deaths += 1;
        this.state.data.progress.gameOver = true;
        this.state.data.progress.win = false;
        return;
      }
      let speed = 0.7;
      const forward = { x: -Math.sin(p.rotation.yaw), z: -Math.cos(p.rotation.yaw) };
      const right = { x: Math.cos(p.rotation.yaw), z: -Math.sin(p.rotation.yaw) };
      let mx = 0, mz = 0;
      if (this.keys.has('KeyW')) { mx += forward.x; mz += forward.z; }
      if (this.keys.has('KeyS')) { mx -= forward.x; mz -= forward.z; }
      if (this.keys.has('KeyA')) { mx -= right.x; mz -= right.z; }
      if (this.keys.has('KeyD')) { mx += right.x; mz += right.z; }
      const len = Math.hypot(mx, mz) || 1;
      if (mx || mz) {
        p.position.x += (mx / len) * speed * dt;
        p.position.z += (mz / len) * speed * dt;
        resolveCollisions(p.position, PLAYER_RADIUS, this.colliders);
        const c = clampToWorld(p.position.x, p.position.z);
        p.position.x = c.x; p.position.z = c.z;
      }
      p.position.y = 1.0 + groundHeight(p.position.x, p.position.z);
      const fill = document.getElementById('stamina-fill');
      if (fill) fill.style.width = `${Math.max(0, (p.downedTimer / 45) * 100)}%`;
      return;
    }

    // Hiding: locked movement, optional hold breath (Space)
    if (p.isHiding) {
      p.isRunning = false;
      p.isCrouching = true;
      p.moveState = 'idle';
      p.isHoldingBreath = !!(this._spaceDown || this.keys.has('Space'));
      if (p.isHoldingBreath) {
        p.breath = Math.max(0, (p.breath ?? 100) - 28 * dt);
        if (p.breath <= 0) {
          p.isHoldingBreath = false;
          p.breath = 15;
          // gasp leaks position
          this.state.emitSound({
            position: { ...p.position },
            intensity: 0.55,
            radius: 16,
            type: 'gasp',
          });
        }
      } else {
        p.breath = Math.min(100, (p.breath ?? 100) + 18 * dt);
      }
      p.position.y = 1.35 + groundHeight(p.position.x, p.position.z);
      return; // no footsteps while hiding
    }

    p.isCrouching = this.keys.has('ControlLeft') || this.keys.has('KeyC');
    p.isRunning = this.keys.has('ShiftLeft') && !p.isCrouching && p.stamina > 5;

    let speed = WALK;
    if (p.isCrouching) speed = CROUCH;
    else if (p.isRunning) speed = RUN;

    const forward = { x: -Math.sin(p.rotation.yaw), z: -Math.cos(p.rotation.yaw) };
    const right = { x: Math.cos(p.rotation.yaw), z: -Math.sin(p.rotation.yaw) };
    let mx = 0, mz = 0;
    if (this.keys.has('KeyW')) { mx += forward.x; mz += forward.z; }
    if (this.keys.has('KeyS')) { mx -= forward.x; mz -= forward.z; }
    if (this.keys.has('KeyA')) { mx -= right.x; mz -= right.z; }
    if (this.keys.has('KeyD')) { mx += right.x; mz += right.z; }
    const len = Math.hypot(mx, mz) || 1;
    const moving = mx !== 0 || mz !== 0;
    p.moveState = !moving ? 'idle' : (p.isRunning ? 'run' : 'walk');
    mx = (mx / len) * speed;
    mz = (mz / len) * speed;

    p.position.x += mx * dt;
    p.position.z += mz * dt;
    resolveCollisions(p.position, PLAYER_RADIUS, this.colliders);
    const c = clampToWorld(p.position.x, p.position.z);
    p.position.x = c.x;
    p.position.z = c.z;
    p.position.y = 1.7 + groundHeight(p.position.x, p.position.z);

    if (p.isRunning && moving) {
      p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
      this._footAcc += dt * 4;
    } else {
      p.stamina = Math.min(100, p.stamina + STAMINA_REGEN * dt);
      if (moving) this._footAcc += dt * (p.isCrouching ? 1.2 : 2.2);
    }

    while (this._footAcc >= 1) {
      this._footAcc -= 1;
      if (!moving) break;
      const intensity = p.isRunning ? 0.9 : p.isCrouching ? 0.12 : 0.38;
      const radius = p.isRunning ? 38 : p.isCrouching ? 9 : 18;
      this.state.emitSound({
        position: { ...p.position },
        intensity,
        radius,
        type: 'footstep',
      });
      if (this.audio) {
        this.audio.playFootstep(p.position.x, p.position.y, p.position.z, intensity);
      }
    }

    const fill = document.getElementById('stamina-fill');
    if (fill) fill.style.width = `${p.stamina}%`;
  }

  get eyePosition() {
    const p = this.state.data.player;
    return {
      x: p.position.x,
      y: p.position.y - (p.isCrouching ? 0.55 : 0),
      z: p.position.z,
    };
  }
}
