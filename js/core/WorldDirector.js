/** Subtle world unease: flicker lights, shift marked props, empty-room audio. */
import { Vector3 } from 'three';

const _v = new Vector3();

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

function unseen(o, cam, minDist = 12) {
  if (!cam || !o || typeof o.getWorldPosition !== 'function') return false;
  o.getWorldPosition(_v);
  const dx = _v.x - cam.position.x;
  const dz = _v.z - cam.position.z;
  if (Math.hypot(dx, dz) < minDist) return false;
  const fx = -Math.sin(cam.rotation.y);
  const fz = -Math.cos(cam.rotation.y);
  return dx * fx + dz * fz <= 0; // behind player only
}

export class WorldDirector {
  constructor(scene, pacing, audio = null) {
    this.scene = scene;
    this.pacing = pacing;
    this.audio = audio;
    this.t = 5 + Math.random() * 10;
  }

  update(dt, now, cam, sanity = 100) {
    if (!this.pacing.wantsUnease(now)) return;
    const ev = pick([this.flicker, this.shiftProp, this.emptyRoomSound]);
    if (ev.call(this, cam)) {
      this.pacing.onEventFired(now, 40, 90);
    }
  }

  flicker(cam) {
    let found = false;
    this.scene.traverse((o) => {
      if (found || !o.isPointLight) return;
      if (!unseen(o, cam)) return;
      const orig = o.intensity;
      o.intensity = orig * 0.15;
      setTimeout(() => {
        o.intensity = orig;
      }, 200 + Math.random() * 400);
      found = true;
    });
    return found;
  }

  shiftProp(cam) {
    let found = false;
    this.scene.traverse((o) => {
      if (found || !o.isMesh || !o.userData?.shiftable) return;
      if (!unseen(o, cam)) return;
      if ((o.geometry?.boundingSphere?.radius || 1) > 2) return;
      o.position.x += (Math.random() - 0.5) * 0.4;
      o.position.z += (Math.random() - 0.5) * 0.4;
      found = true;
    });
    return found;
  }

  emptyRoomSound(cam) {
    if (!this.audio) return false;
    if (Math.random() >= 0.5) return false;
    try {
      if (this.audio.playKnock) this.audio.playKnock(0.15 + Math.random() * 0.2);
      else if (this.audio.playFootstep) {
        const a = Math.random() * Math.PI * 2;
        this.audio.playFootstep(
          cam.position.x + Math.cos(a) * 25,
          0,
          cam.position.z + Math.sin(a) * 25,
          0.2,
          'wood'
        );
      }
      return true;
    } catch (e) {
      return false;
    }
  }
}
