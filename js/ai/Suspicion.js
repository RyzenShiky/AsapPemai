export class SuspicionSystem {
  constructor() {
    this.value = 0;
  }

  static intensityToSuspicion(perceived, atten = 1) {
    return Math.min(40, perceived * 55 * atten);
  }

  add(amount) {
    this.value = Math.min(100, this.value + amount);
  }

  /** Continuous decay — feels alive */
  update(dt) {
    const rate = this.value > 60 ? 4.5 : this.value > 30 ? 6 : 8;
    this.value = Math.max(0, this.value - rate * dt);
  }

  get level() {
    if (this.value >= 70) return 'high';
    if (this.value >= 40) return 'mid';
    if (this.value >= 15) return 'low';
    return 'none';
  }
}
