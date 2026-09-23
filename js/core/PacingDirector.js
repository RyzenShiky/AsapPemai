/** Forces calm gaps between horror events so tension can reset. */
export class PacingDirector {
  constructor() {
    this.cooldownUntil = 0;
    this.calmSince = 0;
  }

  canTriggerEvent(now) {
    return now > this.cooldownUntil;
  }

  onEventFired(now, calmMin = 45, calmMax = 100) {
    this.cooldownUntil = now + calmMin + Math.random() * (calmMax - calmMin);
  }

  reset() {
    this.cooldownUntil = 0;
  }
}
