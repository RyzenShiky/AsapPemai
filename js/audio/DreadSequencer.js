/** Scripted beat sequences — not random one-shots. */
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

  trigger(name) {
    this.clear();
    this.active = true;
    if (name === 'distant-knock') {
      this.schedule([
        {
          delay: 0,
          fn: (a) => a.playKnock?.(0.2) || a.playFootstep(0, 0, -35, 0.25),
        },
        {
          delay: 2.2,
          fn: (a) => a.playKnock?.(0.35) || a.playFootstep(5, 0, -30, 0.4),
        },
        {
          delay: 1.0,
          fn: (a) => a.setSanityFilter?.(0.35),
        },
        {
          delay: 4.0,
          fn: (a) => a.setSanityFilter?.(0),
        },
      ]);
    } else if (name === 'branch-snap') {
      this.schedule([
        {
          delay: 0,
          fn: (a) => a.playFootstep(20, 0, 15, 0.5),
        },
        {
          delay: 1.5,
          fn: (a) => a.playWhisper?.(0.25),
        },
      ]);
    }
  }
}
