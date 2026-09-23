export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfx = null;
  }

  async init() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.master.gain.value = 0.8;
    this.sfx.gain.value = 1;
  }

  resume() {
    return this.ctx?.resume();
  }

  setMasterVolume(v) {
    if (this.master) this.master.gain.value = v;
  }

  setSfxVolume(v) {
    if (this.sfx) this.sfx.gain.value = v;
  }

  setListenerPosition(x, y, z, fx = 0, fz = -1) {
    if (!this.ctx?.listener?.positionX) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    l.positionX.setValueAtTime(x, t);
    l.positionY.setValueAtTime(y, t);
    l.positionZ.setValueAtTime(z, t);
    l.forwardX.setValueAtTime(fx, t);
    l.forwardY.setValueAtTime(0, t);
    l.forwardZ.setValueAtTime(fz, t);
    l.upY.setValueAtTime(1, t);
  }

  playFootstep(x, y, z, intensity = 1) {
    if (!this.ctx || !this.sfx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 50;
    panner.rolloffFactor = 1.2;
    osc.type = 'triangle';
    osc.frequency.value = 80 + Math.random() * 40;
    gain.gain.setValueAtTime(0.12 * intensity, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.sfx);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.13);
  }

  setRain(on) {
    if (!this.ctx || !this.sfx) return;
    if (on && !this._rainNodes) {
      const bufSize = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.7;
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      src.connect(bp);
      bp.connect(g);
      g.connect(this.sfx);
      src.start();
      this._rainNodes = { src, g };
      g.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 1);
    } else if (!on && this._rainNodes) {
      const g = this._rainNodes.g;
      g.gain.cancelScheduledValues(this.ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 1);
      const nodes = this._rainNodes;
      this._rainNodes = null;
      setTimeout(() => {
        try {
          nodes.src.stop();
        } catch (e) {
          /* ignore */
        }
      }, 1200);
    }
  }

  playHeartbeat(volume = 0.2) {
    if (!this.ctx || !this.sfx || volume <= 0.01) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(55, t0);
    osc.frequency.exponentialRampToValueAtTime(28, t0 + 0.12);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.min(0.45, volume), t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  playJumpscareStinger() {
    if (!this.ctx || !this.sfx) return;
    const t0 = this.ctx.currentTime;

    const noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.4, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 400;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.9, t0 + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(this.sfx);
    noise.start(t0);
    noise.stop(t0 + 0.45);

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.5);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.55, t0 + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    osc.connect(og);
    og.connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + 0.6);
  }

  playWhisper(intensity = 0.3) {
    if (!this.ctx || !this.sfx) return;
    const t0 = this.ctx.currentTime;
    const bufSize = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 800;
    bp.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05 * intensity, t0 + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfx);
    src.start(t0);
    src.stop(t0 + 1.2);
  }

  setSanityFilter(intensity) {
    if (!this.ctx || !this.sfx || !this.master) return;
    if (!this._sanityFilter) {
      this._sanityFilter = this.ctx.createBiquadFilter();
      this._sanityFilter.type = 'lowpass';
      this._sanityFilter.frequency.value = 18000;
      this.sfx.disconnect();
      this.sfx.connect(this._sanityFilter);
      this._sanityFilter.connect(this.master);
    }
    const clamped = Math.max(0, Math.min(1, intensity));
    const freq = 18000 - clamped * 15000;
    this._sanityFilter.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.3);
  }

  playKnock(volume = 0.25) {
    if (!this.ctx || !this.sfx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.08);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.min(0.5, volume), t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + 0.22);
  }

  playCrashThud(force = 0.5) {
    if (!this.ctx || !this.sfx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(80, t0);
    osc.frequency.exponentialRampToValueAtTime(25, t0 + 0.25);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.4 * Math.min(1, force), t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + 0.4);
  }

  async playPositionalFile(url, pos) {
    if (!this.ctx || !this.sfx || !url) return;
    try {
      if (this._billboardAudio) {
        try {
          this._billboardAudio.stop();
        } catch (e) {
          /* ignore */
        }
        this._billboardAudio = null;
      }
      const res = await fetch(url);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.refDistance = 5;
      panner.maxDistance = 200;
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y || 2;
      panner.positionZ.value = pos.z;
      src.connect(panner);
      panner.connect(this.sfx);
      src.start();
      this._billboardAudio = src;
    } catch (e) {
      console.warn('playPositionalFile', e);
    }
  }
}
