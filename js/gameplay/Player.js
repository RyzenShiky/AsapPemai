import { clampToWorld } from '../core/WorldConfig.js';
import { isInsideBuilding } from '../core/Buildings.js';
import { resolveCollisions, groundHeight } from '../core/Collision.js';
import { binds, isBound } from '../input/Bindings.js';
import { inputMode } from '../core/Device.js';
import { nearestSpot } from './HideSpots.js';
import { seatToWorld } from './Vehicle.js';
import { ITEMS, invWeight, MAX_WEIGHT } from './Items.js';
const HUNGER_RATE = 0.12, THIRST_RATE = 0.18;

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
    this.touchSensitivity = 0.0052;
    this.invertY = localStorage.getItem('longway_invertY') === '1';
    this._lookDX = 0;
    this._lookDY = 0;
    this._footAcc = 0;
    this._spaceDown = false;
    this.flashlightOn = false;

    this._abort = new AbortController();
    const opt = { signal: this._abort.signal };
    const typing = (e) => {
      const t = e.target;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };

    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      // Prevent default for any currently-bound movement/action key
      if (isBound(e.code) || e.code === 'Space') e.preventDefault();
      if (e.code === 'Space') this._spaceDown = true;
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === binds.flash) {
        const bat = this.state.data.player?.battery ?? 100;
        if (!this.flashlightOn && bat <= 0) {
          // dead battery — ignore toggle on
          this.state.data.player._batWarn = 2;
        } else {
          this.flashlightOn = !this.flashlightOn;
          if (this.state.data.player) this.state.data.player.flashlight = this.flashlightOn;
        }
      }
      if (e.code === binds.hide) this.toggleHide();
      if (e.code === binds.lighter) this.toggleLighter();
      if (e.code === 'Digit1') this.consume('water');
      if (e.code === 'Digit2') this.consume('food');
      if (e.code === 'Digit3') this.consume('fuel');
      if (e.code === binds.throw) this.throwDistraction();
    }, opt);

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this._spaceDown = false;
      this.keys.delete(e.code);
    }, opt);

    window.addEventListener('blur', () => {
      this.keys.clear();
      this._spaceDown = false;
    }, opt);

    // Pointer lock only when input mode is mouse
    canvas.addEventListener('click', () => {
      if (inputMode() === 'mouse') canvas.requestPointerLock?.();
    }, opt);
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    }, opt);
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.applyLook(e.movementX, e.movementY, this.sensitivity);
    }, opt);
  }

  dispose() {
    this._abort.abort();
    this.keys.clear();
  }

  /** Helper: is the given action currently held? */
  _down(action) {
    return this.keys.has(binds[action]);
  }

  _fitness() {
    const p = this.state.data.player;
    return Math.min(1, 0.4 + Math.min(p.hunger ?? 100, p.thirst ?? 100) / 50);
  }
  _needs(dt, moving) {
    const p = this.state.data.player;
    const k = p.isRunning && moving ? 2 : 1;
    p.hunger = Math.max(0, (p.hunger ?? 100) - HUNGER_RATE * dt * k);
    p.thirst = Math.max(0, (p.thirst ?? 100) - THIRST_RATE * dt * k);
    const h = document.getElementById('hunger-fill'), th = document.getElementById('thirst-fill');
    if (h) h.style.width = `${p.hunger}%`;
    if (th) th.style.width = `${p.thirst}%`;
  }
  consume(type) {
    const p = this.state.data.player, inv = this.state.data.inventory;
    const i = inv ? inv.items.findIndex((it) => it.type === type) : -1;
    if (i < 0) return false;
    ITEMS[type]?.use?.(p, this.state);
    inv.items.splice(i, 1);
    return true;
  }
  toggleLighter() {
    const p = this.state.data.player;
    if (!p || (!this.lighterOn && (p.lighterFuel ?? 100) <= 0)) return;
    this.lighterOn = !this.lighterOn;
    p.lighter = this.lighterOn;
  }

  toggleHide() {
    const p = this.state.data.player;
    if (p.isDowned) return;
    if (p.isHiding) {
      p.isHiding = false;
      p.isHoldingBreath = false;
      p.hideSpot = null;
      return;
    }
    // Prefer typed spot (locker/bed/bush/room); bush works outdoors
    const spot = nearestSpot(p.position.x, p.position.z);
    if (!spot) return;
    p.isHiding = true;
    p.hideSpot = { id: spot.id, type: spot.type, x: spot.x, z: spot.z };
    p.noiseAge = 99;
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
    // Accumulate — applied once per frame in update() for smooth, lighter feel
    this._lookDX = (this._lookDX || 0) + dx * sens;
    this._lookDY = (this._lookDY || 0) + dy * sens;
  }

  _flushLook() {
    const p = this.state.data.player;
    if (!this._lookDX && !this._lookDY) return;
    p.rotation.yaw -= this._lookDX;
    // invertY support
    p.rotation.pitch -= this._lookDY * (this.invertY ? -1 : 1);
    p.rotation.pitch = Math.max(-1.35, Math.min(1.35, p.rotation.pitch));
    this._lookDX = 0;
    this._lookDY = 0;
  }

  /** Shared movement vector from current binds. */
  _moveVector(yaw) {
    const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    let mx = 0, mz = 0;
    if (this._down('forward')) { mx += forward.x; mz += forward.z; }
    if (this._down('back'))    { mx -= forward.x; mz -= forward.z; }
    if (this._down('left'))    { mx -= right.x;   mz -= right.z; }
    if (this._down('right'))   { mx += right.x;   mz += right.z; }
    return { mx, mz };
  }

  update(dt) {
    const p = this.state.data.player;
    if (!p.alive) return;
    this._flushLook();
    p.flashlight = this.flashlightOn;
    if (this.lighterOn) {
      p.lighterFuel = Math.max(0, (p.lighterFuel ?? 100) - dt * 0.4);
      if (p.lighterFuel <= 0) this.lighterOn = false;
    }
    p.lighter = this.lighterOn;

    // Battery: slow drain when on (~14 min full); tiny recharge when off
    if (this.flashlightOn) {
      p.battery = Math.max(0, (p.battery ?? 100) - dt * 0.12);
      if (p.battery <= 0) {
        this.flashlightOn = false;
        p.flashlight = false;
        p._batWarn = 2;
      }
      // Flicker harder under 20%
      if (p.battery < 20) p._flashFlicker = 0.35 + Math.random() * 0.65;
      else if (p.battery < 40) p._flashFlicker = 0.75 + Math.random() * 0.25;
      else p._flashFlicker = 1;
    } else {
      p.battery = Math.min(100, (p.battery ?? 100) + dt * 0.04); // slow passive charge
      p._flashFlicker = 1;
    }
    if (p._batWarn > 0) p._batWarn -= dt;
    // Age since last noise (for hide inspect)
    p.noiseAge = (p.noiseAge ?? 99) + dt;

    // Riding vehicle — camera look stays free; WASD only if driver
    if (p.ridingVehicleId) {
      const vData = this.state.getVehicle(p.ridingVehicleId);
      if (!vData) {
        p.ridingVehicleId = null;
        p.ridingRole = null;
      } else {
        const role = p.ridingRole || 'passenger';
        const seatLocal =
          role === 'driver'
            ? (vData.seatOffsets?.DriverSeat || { x: 0, y: 1, z: 0.2 })
            : (vData.seatOffsets?.PassengerSeat ||
               vData.seatOffsets?.PassengerSeatFront ||
               { x: 0, y: 1, z: -0.4 });
        if (role === 'driver') {
          const last = this._lastV;
          if (last && last.id === vData.id) p.rotation.yaw += vData.rotation.yaw - last.yaw;
          this._lastV = { id: vData.id, yaw: vData.rotation.yaw };
        }
        const w = seatToWorld(vData, seatLocal);
        p.position.x = w.x;
        p.position.y = w.y;
        p.position.z = w.z;
        p.moveState = 'riding';
        p.isRunning = false;
        return;
      }
    }

    this._lastV = null;

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
      const { mx, mz } = this._moveVector(p.rotation.yaw);
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
        p.breath = Math.max(0, (p.breath ?? 100) - 12 * dt);
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
        p.breath = Math.min(100, (p.breath ?? 100) + 20 * dt);
      }
      p.position.y = 1.35 + groundHeight(p.position.x, p.position.z);
      return; // no footsteps while hiding
    }

    p.isCrouching = this._down('crouch');
    p.isRunning = this._down('run') && !p.isCrouching && p.stamina > 5;

    let speed = WALK;
    if (p.isCrouching) speed = CROUCH;
    else if (p.isRunning) speed = RUN;
    speed *= p._weatherSpeed ?? 1;
    if ((p.thirst ?? 100) <= 0) speed *= 0.85;
    try {
      const load = invWeight(this.state.data.inventory) / MAX_WEIGHT;
      speed *= 1 - 0.3 * Math.max(0, (load - 0.6) / 0.4);
    } catch (e) { /* */ }

    const { mx: rawMx, mz: rawMz } = this._moveVector(p.rotation.yaw);
    const len = Math.hypot(rawMx, rawMz) || 1;
    const moving = rawMx !== 0 || rawMz !== 0;
    p.moveState = !moving ? 'idle' : (p.isRunning ? 'run' : 'walk');
    const mx = (rawMx / len) * speed;
    const mz = (rawMz / len) * speed;

    p.position.x += mx * dt;
    p.position.z += mz * dt;
    resolveCollisions(p.position, PLAYER_RADIUS, this.colliders);
    const c = clampToWorld(p.position.x, p.position.z);
    p.position.x = c.x;
    p.position.z = c.z;
    p.position.y = 1.7 + groundHeight(p.position.x, p.position.z);

    const fit = this._fitness();
    this._needs(dt, moving);
    if (p.isRunning && moving) {
      p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * (2 - fit) * dt);
      this._footAcc += dt * 4;
    } else {
      p.stamina = Math.min(100, p.stamina + STAMINA_REGEN * fit * dt);
      if (moving) this._footAcc += dt * (p.isCrouching ? 1.2 : 2.2);
    }

    while (this._footAcc >= 1) {
      this._footAcc -= 1;
      if (!moving) break;
      const intensity = p.isRunning ? 1.0 : p.isCrouching ? 0.15 : 0.6;
      const radius = p.isRunning ? 50 : p.isCrouching ? 10 : 28;
      p.noiseAge = 0;
      this.state.emitSound({
        position: { ...p.position },
        intensity,
        radius,
        type: 'footstep',
      });
      if (this.audio) {
        // Material-aware footstep (wood/concrete inside, grass outside)
        const mat = isInsideBuilding(p.position.x, p.position.z) ? 'wood' : 'grass';
        this.audio.playFootstep(p.position.x, p.position.y, p.position.z, intensity, mat);
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
