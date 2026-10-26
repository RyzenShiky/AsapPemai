/** Scripted beat sequences — relative to player origin. */
export class DreadSequencer {
  constructor(audio) {
    this.audio = audio;
    this.active = false;
    this._timers = [];
  }

  clear() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    this.active = false;
  }

  schedule(beats) {
    this.active = true;
    let t = 0;
    for (const b of beats) {
      t += b.delay;
      const id = setTimeout(() => {
        if (this.active && b.fn) b.fn(this.audio);
      }, t * 1000);
      this._timers.push(id);
    }
  }

  trigger(name, origin = { x: 0, z: 0 }) {
    this.clear();
    this.active = true;
    const at = (dx, dz) => [origin.x + dx, 1.5, origin.z + dz];

    if (name === 'door-slam') {
      this.schedule([
        { delay: 0,   fn: (a) => a.playCrashThud?.(0.9) },
        { delay: 1.6, fn: (a) => a.playFootstep(...at(-8, 6), 0.5, 'wood') },
        { delay: 1.2, fn: (a) => a.playFootstep(...at(-6, 4), 0.6, 'wood') },
        { delay: 1.0, fn: (a) => a.setSanityFilter?.(0.4) },
        { delay: 3.0, fn: (a) => a.setSanityFilter?.(0) },
      ]);
    } else if (name === 'footsteps-behind') {
      this.schedule([0, 0.55, 0.5, 0.45, 0.4].map((delay, i) => ({
        delay, fn: (a) => a.playFootstep(...at(0, 7 - i * 1.5), 0.45 + i * 0.1, 'grass'),
      })));
    } else if (name === 'branch-snap') {
      this.schedule([
        { delay: 0,   fn: (a) => a.playFootstep(...at(20, 15), 0.5) },
        { delay: 1.5, fn: (a) => a.playWhisper?.(0.25) },
      ]);
    } else if (name === 'distant-knock') {
      this.schedule([
        { delay: 0,   fn: (a) => a.playKnock?.(0.2) || a.playFootstep(...at(0, -12), 0.25) },
        { delay: 2.2, fn: (a) => a.playKnock?.(0.35) || a.playFootstep(...at(3, -10), 0.4) },
        { delay: 1.0, fn: (a) => a.setSanityFilter?.(0.35) },
        { delay: 4.0, fn: (a) => a.setSanityFilter?.(0) },
      ]);
    }
  }
}
