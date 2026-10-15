/** Forces calm gaps between horror events so tension can reset.
 *  Uses a shuffled deck so events don't repeat until the bag is empty.
 */
const DECK = ['approachingSound', 'distantSighting', 'trace', 'routeBlocked', 'falseAlarm'];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class PacingDirector {
  constructor() {
    this.cooldownUntil = 0;
    this.calmUntil = 0;
    this.bag = [];
  }

  canTriggerEvent(now) {
    return now > this.cooldownUntil;
  }

  next() {
    if (!this.bag.length) this.bag = shuffle([...DECK]);
    return this.bag.pop();
  }

  onEventFired(now, calmMin = 40, calmMax = 90) {
    this.cooldownUntil = now + calmMin + Math.random() * (calmMax - calmMin);
  }

  /** After a chase ends: long calm + one delayed trace so silence itself feels wrong. */
  onChaseEnd(now) {
    this.cooldownUntil = now + 40;
    this.calmUntil = now + 40;
  }

  reset() {
    this.cooldownUntil = 0;
    this.calmUntil = 0;
    this.bag = [];
  }
}
