/** Tension model + event deck. Unease only when player has been calm. */
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
    this.tension = 0;
    this.calmFor = 0;
  }

  update(dt, { monsterDist = 99, chasing = false, sanity = 100 } = {}) {
    const threat = Math.max(chasing ? 1 : 0, 1 - Math.min(1, monsterDist / 40));
    const target = Math.min(1, threat + (1 - sanity / 100) * 0.3);
    const rate = target > this.tension ? 1.5 : 0.25;
    this.tension += (target - this.tension) * Math.min(1, dt * rate);
    this.calmFor = this.tension > 0.3 ? 0 : this.calmFor + dt;
  }

  wantsUnease(now) {
    return this.calmFor > 45 && now > this.cooldownUntil;
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
    this.calmFor = 0;
  }

  onChaseEnd(now) {
    this.cooldownUntil = now + 40;
    this.calmUntil = now + 40;
    this.calmFor = 0;
  }

  reset() {
    this.cooldownUntil = 0;
    this.calmUntil = 0;
    this.bag = [];
    this.tension = 0;
    this.calmFor = 0;
  }
}
