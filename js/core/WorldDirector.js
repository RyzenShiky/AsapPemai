/**
 * Subtle world atmosphere director.
 * Only mutates objects that are currently out of the camera frustum
 * and > 8 m away, so the player never sees the change happen.
 */
import * as THREE from 'three';

const FRUSTUM = new THREE.Frustum();
const MAT = new THREE.Matrix4();

function unseen(o, cam) {
  FRUSTUM.setFromProjectionMatrix(
    MAT.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
  );
  if (FRUSTUM.intersectsObject(o)) return false;
  return o.position.distanceTo(cam.position) > 8;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class WorldDirector {
  constructor(pacing, scene) {
    this.pacing = pacing;
    this.scene = scene;
    this.t = 5 + Math.random() * 10;
  }

  update(dt, now, cam, sanity = 100) {
    if ((this.t -= dt) > 0 || !this.pacing.canTriggerEvent(now)) return;
    const ev = pick([this.flicker, this.shiftProp, this.emptyRoomSound]);
    if (ev.call(this, cam)) {
      this.pacing.onEventFired(now, 40, 90);
    }
    // Lower sanity → more frequent events
    this.t = (10 + Math.random() * 15) * (0.5 + sanity / 100);
  }

  flicker(cam) {
    // Find a point light far from camera and briefly dim it
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
    // Nudge a small mesh that is out of view
    let found = false;
    this.scene.traverse((o) => {
      if (found || !o.isMesh || o.userData?.noShift) return;
      if (!unseen(o, cam)) return;
      if ((o.geometry?.boundingSphere?.radius || 1) > 2) return;
      o.position.x += (Math.random() - 0.5) * 0.4;
      o.position.z += (Math.random() - 0.5) * 0.4;
      found = true;
    });
    return found;
  }

  emptyRoomSound(cam) {
    // Handled by audio layer — signal only
    return Math.random() < 0.4;
  }
}
