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
    this.ambience = this.ctx.createGain();   // bus ducking
    this.musicGain = this.ctx.createGain();  // slider volume musik
    this.sfx.connect(this.master);
    this.ambience.connect(this.musicGain);   // music through volume slider
    this.musicGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.master.gain.value = 0.8;
    this.sfx.gain.value = 1;
    this.ambience.gain.value = 1;
    this.musicGain.gain.value = 0.55;
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

  playFootstep(x, y, z, intensity = 1, mat = 'grass') {
    if (!this.ctx || !this.sfx) return;
    const MAT = {
      grass:    { f: 900,  g: 0.5 },
      gravel:   { f: 2500, g: 1.0 },
      wood:     { f: 600,  g: 0.9 },
      concrete: { f: 1500, g: 0.8 },
    };
    const m = MAT[mat] || MAT.grass;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const lowpass = this.ctx.createBiquadFilter();
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 50;
    panner.rolloffFactor = 1.2;
    osc.type = 'triangle';
    osc.frequency.value = 80 + Math.random() * 40;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = m.f;
    const g = 0.12 * intensity * m.g;
    gain.gain.setValueAtTime(g, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
    osc.connect(gain);
    gain.connect(lowpass);
    lowpass.connect(panner);
    panner.connect(this.sfx);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.13);
  }

  /** Briefly duck ambience (e.g. before monster approaches). */
  duckAmbience(sec = 4) {
    if (!this.ambience || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.ambience.gain.setTargetAtTime(0.05, t, 0.3);
    setTimeout(() => {
      if (this.ambience) this.ambience.gain.setTargetAtTime(1, this.ctx.currentTime, 2);
    }, sec * 1000);
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

  playWhisper(intensity = 0.3, x = null, y = null, z = null) {
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
    if (x != null) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 40;
      panner.rolloffFactor = 1.1;
      panner.positionX.value = x;
      panner.positionY.value = y ?? 1.5;
      panner.positionZ.value = z ?? 0;
      g.connect(panner);
      panner.connect(this.sfx);
    } else {
      g.connect(this.sfx);
    }
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

  playSiren(x, y, z, vol = 0.5) {
    if (!this.ctx || !this.sfx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.refDistance = 12;
    panner.maxDistance = 300;
    panner.positionX.value = x;
    panner.positionY.value = (y || 0) + 8;
    panner.positionZ.value = z;
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(260, t);
    o.frequency.linearRampToValueAtTime(820, t + 2.2);
    o.frequency.linearRampToValueAtTime(300, t + 4.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.4);
    g.gain.linearRampToValueAtTime(0, t + 4.5);
    o.connect(g);
    g.connect(panner);
    panner.connect(this.sfx);
    o.start(t);
    o.stop(t + 4.6);
  }


  setMusicVolume(v) {
    if (this.musicGain) this.musicGain.gain.value = Math.max(0, Math.min(1, v));
  }

  _makeNoise(sec = 2) {
    const n = Math.floor(this.ctx.sampleRate * sec);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeReverb() {
    const ctx = this.ctx;
    const convolver = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      }
    }
    convolver.buffer = buf;
    return convolver;
  }

  stopMusic(fade = 1.5) {
    const mus = this._mus;
    if (!mus || !this.ctx) return;
    this._mus = null; // free slot so playMusic() can start again immediately
    const t = this.ctx.currentTime;
    try {
      mus.out.gain.cancelScheduledValues(t);
      mus.out.gain.setValueAtTime(mus.out.gain.value, t);
      mus.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    } catch (e) { /* */ }
    for (const id of mus.timers || []) clearTimeout(id);
    mus.timers?.clear?.();
    setTimeout(() => {
      for (const o of mus.nodes || []) {
        try { o.stop(); } catch (e) { /* */ }
      }
      try { mus.out.disconnect(); } catch (e) { /* */ }
    }, (fade + 0.15) * 1000);
  }

  playMusic(fade = 3) {
    if (!this.ctx || !this.ambience || this._mus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const nodes = [];
    const timers = new Set();
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.linearRampToValueAtTime(1, t0 + fade);
    const dry = ctx.createGain();
    dry.gain.value = 0.75;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const rev = this._makeReverb();
    out.connect(dry);
    dry.connect(this.ambience);
    out.connect(rev);
    rev.connect(wet);
    wet.connect(this.ambience);

    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 1500;
    muffle.Q.value = 0.5;
    const body = ctx.createGain();
    body.gain.value = 0.35;
    body.connect(muffle);
    muffle.connect(out);

    this._mus = { out, nodes, timers };

    const lfo = (freq, depth, target) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.value = depth;
      o.connect(g);
      g.connect(target);
      o.start();
      nodes.push(o);
    };

    const swell = () => {
      if (this._mus?.out !== out) return;
      const t = ctx.currentTime;
      const L = rnd(32, 42);
      const g = body.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.35, t + L * 0.25);
      g.linearRampToValueAtTime(1.0, t + L * 0.45);
      g.linearRampToValueAtTime(1.0, t + L * 0.65);
      g.linearRampToValueAtTime(0.3, t + L * 0.8);
      g.linearRampToValueAtTime(0.3, t + L);
      const id = setTimeout(() => {
        timers.delete(id);
        swell();
      }, L * 1000);
      timers.add(id);
    };
    swell();

    const droneLP = ctx.createBiquadFilter();
    droneLP.type = 'lowpass';
    droneLP.frequency.value = 520;
    droneLP.Q.value = 3;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.16;
    droneLP.connect(droneGain);
    droneGain.connect(body);
    [
      [123.47, 'sawtooth', 6],
      [123.47, 'sawtooth', -6],
      [61.74, 'sine', 0],
      [185.0, 'triangle', 0],
      [246.94, 'sine', 0],
    ].forEach(([f, type, cents]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(droneLP);
      o.start();
      nodes.push(o);
    });
    lfo(0.07, 150, droneLP.frequency);
    lfo(0.05, 0.05, droneGain.gain);

    const padLP = ctx.createBiquadFilter();
    padLP.type = 'lowpass';
    padLP.frequency.value = 900;
    padLP.connect(body);
    [185.0, 246.94, 293.66, 311.13, 369.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 20;
      const g = ctx.createGain();
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(padLP);
      lfo(0.03 + Math.random() * 0.06, 0.03, g.gain);
      o.start();
      nodes.push(o);
    });

    const throbG = ctx.createGain();
    throbG.gain.value = 0.05;
    const th = ctx.createOscillator();
    th.type = 'triangle';
    th.frequency.value = 123.47;
    th.connect(throbG);
    throbG.connect(body);
    th.start();
    nodes.push(th);
    lfo(1.133, 0.05, throbG.gain);

    const noiseBuf = this._makeNoise(3);

    const boom = () => {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(rnd(70, 90), t);
      o.frequency.exponentialRampToValueAtTime(32, t + 2.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      o.connect(g);
      g.connect(body);
      o.start(t);
      o.stop(t + 3.1);
    };

    const shimmer = () => {
      const t = ctx.currentTime;
      const dur = rnd(4, 7);
      const f = rnd(500, 900);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * rnd(0.94, 1.06), t + dur);
      const vib = ctx.createOscillator();
      vib.frequency.value = rnd(4, 7);
      const vg = ctx.createGain();
      vg.gain.value = f * 0.01;
      vib.connect(vg);
      vg.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.03, t + dur * 0.5);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(body);
      o.start(t);
      vib.start(t);
      o.stop(t + dur + 0.1);
      vib.stop(t + dur + 0.1);
    };

    const whoosh = () => {
      const t = ctx.currentTime;
      const dur = rnd(3, 5);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 6;
      const f0 = rnd(150, 350);
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(f0 * rnd(2.5, 4), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + dur * 0.5);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(body);
      src.start(t);
      src.stop(t + dur + 0.1);
    };

    const SCALE = [246.94, 261.63, 293.66, 329.63, 369.99, 392.0, 440.0];
    const pluckNote = (f, delay = 0) => {
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = f * 2.01;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      o.connect(g);
      o2.connect(g2);
      g2.connect(g);
      g.connect(body);
      o.start(t);
      o2.start(t);
      o.stop(t + 3.6);
      o2.stop(t + 3.6);
    };
    const pluck = () => {
      const f = pick(SCALE);
      pluckNote(f);
      if (Math.random() < 0.4) pluckNote(f * 1.0595, rnd(0.35, 0.65));
    };

    const schedule = (fn, minS, maxS) => {
      const loop = () => {
        const id = setTimeout(() => {
          timers.delete(id);
          if (this._mus?.out !== out) return;
          fn();
          loop();
        }, rnd(minS, maxS) * 1000);
        timers.add(id);
      };
      loop();
    };
    schedule(pluck, 4, 9);
    schedule(boom, 20, 40);
    schedule(shimmer, 14, 30);
    schedule(whoosh, 14, 30);
  }


}
