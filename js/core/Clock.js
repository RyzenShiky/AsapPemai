export class Clock {
  constructor() {
    this.last = performance.now();
    this._dt = 0;
    this._elapsed = 0;
  }
  tick() {
    const now = performance.now();
    this._dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this._elapsed += this._dt;
    return this._dt;
  }
  get delta() { return this._dt; }
  get elapsed() { return this._elapsed; }
}
