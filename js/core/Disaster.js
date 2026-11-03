import * as THREE from 'three';
import { groundHeight } from './Collision.js';
import { isInsideBuilding } from './Buildings.js';

const rngFrom = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const hashStr = (s) => {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.ceil(s % 60) % 60).padStart(2, '0')}`;

export const DISASTERS = {
  earthquake:   { label: 'GEMPA BUMI',        warn: 4,  dur: [14, 24], w: 3, shake: 1.0,  speed: 0.7,  dmg: 3,   hit: 'indoor',  fx: ['dust'],          tint: 0x6a5a48, fog: 1.2, sound: 70,  tip: 'Keluar dari bangunan, menjauh dari dinding!' },
  volcano:      { label: 'ERUPSI GUNUNG API', warn: 12, dur: [50, 80], w: 2, shake: 0.35, speed: 0.85, dmg: 4,   hit: 'outdoor', fx: ['ash', 'ember'], tint: 0x7a3414, fog: 2.4, weather: 'cloudy', sound: 55, tip: 'Hujan abu! Berlindung di dalam bangunan.' },
  tsunami:      { label: 'TSUNAMI',           warn: 18, dur: [35, 50], w: 2, shake: 0.3,  speed: 0.5,  dmg: 14,  hit: 'water',   special: 'water', level: 2.6, fx: ['rain'], tint: 0x244a62, fog: 1.6, weather: 'cloudy', sound: 60, tip: 'Air laut naik! Cari tempat tinggi atau masuk bangunan.' },
  liquefaction: { label: 'LIKUEFAKSI',        warn: 5,  dur: [25, 40], w: 2, shake: 0.6,  speed: 0.4,  dmg: 2,   hit: 'outdoor', special: 'sink', fx: ['dust'], tint: 0x5a4a38, fog: 1.2, sound: 65, tip: 'Tanah melunak! Jangan diam, cari tanah keras.' },
  flood:        { label: 'BANJIR',            warn: 12, dur: [60, 90], w: 3, shake: 0.05, speed: 0.6,  dmg: 2.5, hit: 'water',   special: 'water', level: 1.3, fx: ['rain'], tint: 0x34505a, fog: 1.6, weather: 'rain', sound: 80, tip: 'Banjir naik! Hindari area rendah.' },
  drought:      { label: 'KEKERINGAN',        warn: 6,  dur: [70, 100], w: 2, shake: 0,   speed: 0.92, dmg: 0,   hit: 'any',     drain: { thirst: 0.4, hunger: 0.1 }, fx: ['dust'], tint: 0xd8a050, fog: 1.3, weather: 'clear', sound: 0, tip: 'Haus meningkat cepat. Cari air!' },
  cyclone:      { label: 'BADAI SIKLON',      warn: 10, dur: [55, 80], w: 2, shake: 0.25, speed: 0.75, dmg: 2,   hit: 'outdoor', fx: ['rain', 'debris'], tint: 0x38424a, fog: 1.9, weather: 'storm', sound: 110, wind: 1, tip: 'Angin siklon! Masuk bangunan.' },
  tornado:      { label: 'TORNADO',           warn: 8,  dur: [45, 70], w: 2, shake: 0,    speed: 0.9,  dmg: 22,  hit: 'near',    special: 'tornado', fx: ['dust', 'debris'], tint: 0x4a5048, fog: 1.4, weather: 'wind', sound: 100, wind: 1, tip: 'Tornado terlihat! Jauhi pusaran.' },
  typhoon:      { label: 'TOPAN',             warn: 14, dur: [60, 90], w: 2, shake: 0.35, speed: 0.65, dmg: 2.5, hit: 'outdoor', fx: ['rain', 'debris'], tint: 0x2c363e, fog: 2.2, weather: 'storm', sound: 120, wind: 1.3, tip: 'Topan! Berlindung dan tunggu reda.' },
  wildfire:     { label: 'KEBAKARAN HUTAN',   warn: 10, dur: [60, 90], w: 2, shake: 0.05, speed: 0.9,  dmg: 14,  hit: 'zone',    special: 'fireZones', fx: ['ember', 'ash'], tint: 0x7a3410, fog: 2.0, weather: 'wind', sound: 90, wind: 0.5, tip: 'Api menyebar! Jauhi lingkaran api.' },
  blizzard:     { label: 'BADAI SALJU',       warn: 8,  dur: [50, 80], w: 2, shake: 0.1,  speed: 0.6,  dmg: 1.5, hit: 'outdoor', fx: ['snow'], tint: 0xcfd8e0, fog: 2.8, weather: 'fog', sound: 130, wind: 1.2, tip: 'Badai salju! Cari tempat hangat.' },
  rainstorm:    { label: 'BADAI HUJAN',       warn: 6,  dur: [45, 70], w: 3, shake: 0.05, speed: 0.85, dmg: 0.8, hit: 'outdoor', fx: ['rain'], tint: 0x2c3a44, fog: 1.7, weather: 'storm', sound: 140, wind: 0.6, tip: 'Hujan deras dan petir. Berlindung.' },
  meteor:       { label: 'HANTAMAN METEORIT', warn: 10, dur: [30, 45], w: 1, shake: 0,    speed: 0.95, dmg: 45,  hit: 'near',    special: 'meteor', fx: ['ember'], tint: 0x5a2a10, fog: 1.4, weather: 'clear', sound: 45, tip: 'Meteorit jatuh! Perhatikan bayangan di tanah.' },
  solar:        { label: 'BADAI MATAHARI',    warn: 15, dur: [40, 60], w: 1, shake: 0,    speed: 1.0,  dmg: 0,   hit: 'any',     special: 'sunstorm', drain: { battery: 0.8, sanity: 0.6 }, fx: [], tint: 0x7a40c0, fog: 1.0, sound: 0, tip: 'Gangguan elektronik! Baterai & sanity terkuras.' },
};

const GAP = [75, 150];
const FIRST = [50, 80];
const RAMP = 0.2;

export class DisasterDirector {
  constructor(o) {
    Object.assign(this, { state: o.state, renderer: o.renderer, audio: o.audio, getTime: o.getTime, authority: o.authority !== false, toast: o.toast || (() => {}), touch: !!o.touch });
    this._THREE = THREE; this._ground = groundHeight; this._isInside = isInsideBuilding; this._col = new THREE.Color();
    this.seed = (o.seed ?? Math.random() * 4294967296) >>> 0;
    this.sched = [];
    this.rng = rngFrom(this.seed);
    this.cur = null;
    this.intensity = 0;
    this.stats = { count: 0, survived: 0 };
    this._objs = [];
    this._parts = [];
    this._ui();
    this._extend(2);
  }

  _extend(n) {
    while (this.sched.length < n) {
      const prev = this.sched[this.sched.length - 1];
      const start = prev ? prev.end + GAP[0] + this.rng() * (GAP[1] - GAP[0]) : FIRST[0] + this.rng() * (FIRST[1] - FIRST[0]);
      const keys = Object.keys(DISASTERS).filter((k) => k !== prev?.id);
      let r = this.rng() * keys.reduce((a, k) => a + DISASTERS[k].w, 0), id = keys[0];
      for (const k of keys) { r -= DISASTERS[k].w; if (r <= 0) { id = k; break; } }
      const d = DISASTERS[id];
      const dur = d.dur[0] + this.rng() * (d.dur[1] - d.dur[0]);
      this.sched.push({ id, def: d, start, on: start + d.warn, end: start + d.warn + dur, seed: (this.rng() * 4294967296) >>> 0 });
    }
  }

  _ui() {
    if (!document.getElementById('dz-style')) {
      const s = document.createElement('style'); s.id = 'dz-style';
      s.textContent = `#dz-root{position:fixed;inset:0;pointer-events:none;z-index:40}
#dz-cv{position:absolute;inset:0;width:100%;height:100%}
#dz-tint{position:absolute;inset:0;opacity:0;transition:opacity .4s}
#dz-vig{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(120,0,0,.55) 100%)}
#dz-bar{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);left:50%;transform:translateX(-50%);min-width:220px;max-width:88vw;text-align:center;padding:.45rem .9rem;border-radius:8px;background:rgba(10,10,12,.78);border:1px solid #555;color:#eee;font:600 .82rem/1.3 system-ui,sans-serif;letter-spacing:.04em;opacity:0;transition:opacity .3s}
#dz-bar.on{opacity:1}#dz-bar.warn{border-color:#e0a030;color:#ffd27a;animation:dzp .9s infinite}#dz-bar.act{border-color:#d04040;color:#ff9a9a}
#dz-bar small{display:block;font-weight:400;opacity:.85;letter-spacing:0}
@keyframes dzp{50%{box-shadow:0 0 14px rgba(224,160,48,.7)}}`;
      document.head.appendChild(s);
    }
    this.root = document.getElementById('dz-root') || Object.assign(document.createElement('div'), { id: 'dz-root', innerHTML: '<div id="dz-tint"></div><canvas id="dz-cv"></canvas><div id="dz-vig"></div><div id="dz-bar"></div>' });
    if (!this.root.isConnected) document.body.appendChild(this.root);
    this.cv = this.root.querySelector('#dz-cv'); this.cx = this.cv.getContext('2d');
    this.elTint = this.root.querySelector('#dz-tint'); this.elVig = this.root.querySelector('#dz-vig'); this.elBar = this.root.querySelector('#dz-bar');
    this._resize = () => { const r = Math.min(window.devicePixelRatio || 1, this.touch ? 1 : 1.5); this.cv.width = innerWidth * r; this.cv.height = innerHeight * r; this._r = r; };
    this._resize(); addEventListener('resize', this._resize);
  }

  _bar(cls, title, sub) {
    this.elBar.className = cls ? `on ${cls}` : '';
    if (cls) { this.elBar.textContent = title; if (sub) { const s = document.createElement('small'); s.textContent = sub; this.elBar.appendChild(s); } }
  }

  update(dt, now) {
    const t = this.getTime();
    let i0 = this.sched.findIndex((e) => e.end > t); if (i0 < 0) i0 = this.sched.length;
    this._extend(i0 + 3);
    const ev = this.sched.find((e) => t >= e.start && t < e.end) || null;
    const next = this.sched.find((e) => e.start > t);
    const world = this.state.data.world;

    if (ev !== this.cur) { this._finish(); if (ev) this._begin(ev); }
    if (!this.cur) {
      this.intensity = 0;
      this._bar(next && next.start - t < 20 ? 'warn' : '', next ? `Bencana berikutnya: ${fmt(next.start - t)}` : '');
      this._apply(0, dt, now, null);
      return;
    }

    const d = this.cur.def, warming = t < this.cur.on;
    const span = this.cur.end - this.cur.on, k = clamp01((t - this.cur.on) / span);
    this.intensity = warming ? clamp01(1 - (this.cur.on - t) / d.warn) * 0.18
      : Math.min(clamp01(k / RAMP), clamp01((1 - k) / RAMP));
    this._bar(warming ? 'warn' : 'act', `${warming ? '⚠ PERINGATAN: ' : ''}${d.label}`, warming ? `${d.tip} (${Math.ceil(this.cur.on - t)} dtk)` : `Sisa ${fmt(this.cur.end - t)}`);

    if (d.weather && this.authority && !warming) { world.weather = d.weather; world.weatherTimer = 0; world.weatherNextChange = 9999; }
    this._apply(this.intensity, dt, now, d, warming);
  }

  _begin(ev) {
    this.cur = ev; this.stats.count++; this._objs = []; this._r2 = rngFrom(ev.seed);
    const d = ev.def;
    this.toast(`⚠ ${d.label} — ${d.tip}`, 5000);
    if (d.special === 'water') this._mkWater(d);
    if (d.special === 'tornado') this._mkTornado();
    if (d.special === 'fireZones') this._mkFire();
    if (d.special === 'meteor') this._nextMeteor = 0;
    this._startSound(d);
  }

  _finish() {
    if (!this.cur) return;
    for (const o of this._objs) { this.renderer.scene.remove(o); o.geometry?.dispose(); o.material?.dispose(); }
    this._objs = []; this._water = null; this._funnel = null; this._zones = null; this._meteors = null;
    if (this.state.data.player.alive) this.stats.survived++;
    if (this.authority) this.state.data.world.weatherNextChange = 20;
    this.state.data.player._disasterSpeed = 1;
    this.renderer._shake = 0; this.renderer._dip = 0;
    this._stopSound();
    this.cur = null;
    this.toast('Bencana mereda.', 2500);
  }

  _apply(I, dt, now, d, warming) {
    const R = this.renderer, p = this.state.data.player;
    let shake = d ? d.shake * I : 0;
    if (d && warming) shake = Math.max(shake, d.shake * 0.25 * this.intensity * 5);
    if (this._pulse > 0) { shake = Math.max(shake, this._pulse); this._pulse = Math.max(0, this._pulse - dt * 1.6); }
    R._shake = shake;
    R._dip = d?.special === 'sink' ? 0.55 * I : 0;
    if (R.scene?.fog) {
      const mul = d ? 1 + (d.fog - 1) * I : 1;
      R.scene.fog.density = Math.min(0.06, (R.scene.fog.density || 0.01) * mul);
      if (d && I > 0) R.scene.fog.color.lerp(this._col.setHex(d.tint), I * 0.6);
    }
    this.elTint.style.background = d ? `#${d.tint.toString(16).padStart(6, '0')}` : 'transparent';
    this.elTint.style.opacity = d ? (I * (d.special === 'sunstorm' ? 0.28 : 0.22)).toFixed(3) : 0;
    this.elVig.style.opacity = (this._hurt = Math.max(0, (this._hurt || 0) - dt * 1.2)).toFixed(2);
    p._disasterSpeed = d ? 1 + (d.speed - 1) * I : 1;
    if (!d || warming || !p.alive) { this._particles(dt, d, 0); this._sound(0); return; }

    const ins = !!this._isb(p), exposed = !ins;
    let dmg = 0;
    switch (d.hit) {
      case 'outdoor': dmg = exposed ? d.dmg * I : d.dmg * I * 0.05; break;
      case 'indoor': dmg = ins ? d.dmg * I : 0; break;
      case 'any': dmg = d.dmg * I; break;
    }
    if (d.drain) {
      if (d.drain.thirst) p.thirst = Math.max(0, (p.thirst ?? 100) - d.drain.thirst * I * dt);
      if (d.drain.hunger) p.hunger = Math.max(0, (p.hunger ?? 100) - d.drain.hunger * I * dt);
      if (d.drain.battery) { p.battery = Math.max(0, (p.battery ?? 100) - d.drain.battery * I * dt); p._flashFlicker = 0.35 + Math.random() * 0.65; }
      if (d.drain.sanity) p.sanity = Math.max(0, (p.sanity ?? 100) - d.drain.sanity * I * dt);
      if (d.drain.thirst && (p.thirst ?? 1) <= 0 && exposed) dmg += 1.5;
    }
    if (d.special === 'water') dmg += this._tickWater(I, dt, p, exposed);
    if (d.special === 'tornado') dmg += this._tickTornado(I, dt, now, p);
    if (d.special === 'fireZones') dmg += this._tickFire(I, dt, now, p);
    if (d.special === 'meteor') this._tickMeteor(I, dt, now, p);
    if (d.special === 'sunstorm') this.elTint.style.opacity = (I * (0.18 + 0.12 * Math.sin(now * 9) * Math.random())).toFixed(3);
    if (dmg > 0) this._damage(dmg * dt);
    this._particles(dt, d, I);
    this._sound(I);
  }

  _damage(v) {
    const p = this.state.data.player;
    if (!this.authority || !p.alive || p.isDowned) return;
    p.health = Math.max(0, p.health - v);
    this._hurt = Math.min(1, (this._hurt || 0) + v * 0.6);
    if (p.health <= 0) { p.isDowned = true; p.downedTimer = 45; }
  }
  _hit(v) { this._damage(v); this._pulse = Math.max(this._pulse || 0, 0.9); }
  _isb(p) { try { return this._isInside(p.position.x, p.position.z); } catch (e) { return false; } }

  _mkWater(d) {
    const T = this._THREE;
    const m = new T.Mesh(new T.PlaneGeometry(600, 600), new T.MeshBasicMaterial({ color: 0x2f6f86, transparent: true, opacity: 0.55, depthWrite: false, fog: true }));
    m.rotation.x = -Math.PI / 2; m.position.y = -1; m.renderOrder = 5;
    this.renderer.scene.add(m); this._objs.push(m); this._water = m;
  }
  _tickWater(I, dt, p, exposed) {
    const d = this.cur.def, m = this._water; if (!m) return 0;
    const lvl = d.level * I, px = p.position.x, pz = p.position.z;
    m.position.set(px, lvl + Math.sin(performance.now() * 0.002) * 0.05 * I, pz);
    const depth = lvl - this._ground(px, pz);
    const onVehicle = !!p.ridingVehicleId;
    if (depth <= 0.35 || onVehicle) return 0;
    p._disasterSpeed *= clamp01(1 - depth * 0.25);
    return d.dmg * clamp01(depth / d.level) * (exposed ? 1 : 0.35);
  }

  _mkTornado() {
    const T = this._THREE, g = new T.CylinderGeometry(9, 1.2, 38, 20, 1, true);
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0x55584f, transparent: true, opacity: 0.42, side: T.DoubleSide, depthWrite: false }));
    const a = this._r2() * Math.PI * 2, r = 70, hp = this.state.data.player.position;
    m.position.set(hp.x + Math.cos(a) * r, 19, hp.z + Math.sin(a) * r);
    this._tv = { ang: this._r2() * 6.28 };
    this.renderer.scene.add(m); this._objs.push(m); this._funnel = m;
  }
  _tickTornado(I, dt, now, p) {
    const f = this._funnel; if (!f) return 0;
    const dx = p.position.x - f.position.x, dz = p.position.z - f.position.z, dist = Math.hypot(dx, dz) || 1;
    this._tv.ang += (this._r2() - 0.5) * dt * 1.4;
    const sp = 5.5 * I;
    f.position.x += (Math.cos(this._tv.ang) * 0.7 + (dx / dist) * 0.3) * sp * dt;
    f.position.z += (Math.sin(this._tv.ang) * 0.7 + (dz / dist) * 0.3) * sp * dt;
    f.rotation.y += dt * 6; f.scale.setScalar(0.4 + 0.6 * I);
    this.renderer._shake = Math.max(this.renderer._shake || 0, clamp01(1 - dist / 40) * 0.9);
    const R = 9 * f.scale.x + 4;
    if (dist < R) { p._disasterSpeed *= 0.5; return this.cur.def.dmg * clamp01(1 - dist / R); }
    return 0;
  }

  _mkFire() {
    const T = this._THREE, hp = this.state.data.player.position; this._zones = [];
    const n = this.touch ? 5 : 8;
    for (let i = 0; i < n; i++) {
      const a = this._r2() * 6.28, r = 18 + this._r2() * 55, rad = 7 + this._r2() * 7;
      const m = new T.Mesh(new T.CircleGeometry(1, 28), new T.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      const x = hp.x + Math.cos(a) * r, z = hp.z + Math.sin(a) * r;
      m.position.set(x, this._ground(x, z) + 0.08, z); m.scale.setScalar(0.01);
      this.renderer.scene.add(m); this._objs.push(m); this._zones.push({ m, rad, ph: this._r2() * 6 });
    }
  }
  _tickFire(I, dt, now, p) {
    let dmg = 0;
    for (const z of this._zones || []) {
      const rad = z.rad * (0.3 + 0.7 * I) * (1 + 0.04 * Math.sin(now * 5 + z.ph));
      z.m.scale.setScalar(rad); z.m.material.opacity = 0.35 + 0.2 * Math.sin(now * 9 + z.ph);
      const d = Math.hypot(p.position.x - z.m.position.x, p.position.z - z.m.position.z);
      if (d < rad) dmg = Math.max(dmg, this.cur.def.dmg * clamp01(1 - d / rad * 0.5));
    }
    return dmg;
  }

  _tickMeteor(I, dt, now, p) {
    const T = this._THREE, S = this.renderer.scene; this._meteors ||= [];
    if (now >= (this._nextMeteor || 0)) {
      this._nextMeteor = now + (1.8 - 1.1 * I) * (0.6 + this._r2() * 0.8);
      const a = this._r2() * 6.28, r = 6 + this._r2() * 38, x = p.position.x + Math.cos(a) * r, z = p.position.z + Math.sin(a) * r;
      const body = new T.Mesh(new T.SphereGeometry(1.1, 10, 8), new T.MeshBasicMaterial({ color: 0xffa040 }));
      const mark = new T.Mesh(new T.RingGeometry(2.6, 3.2, 28), new T.MeshBasicMaterial({ color: 0xff3010, transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false }));
      mark.rotation.x = -Math.PI / 2; mark.position.set(x, this._ground(x, z) + 0.1, z);
      body.position.set(x + 30, 90, z - 30);
      S.add(body); S.add(mark); this._objs.push(body, mark);
      this._meteors.push({ body, mark, x, z, t: 0, fall: 1.6 });
    }
    for (let i = this._meteors.length - 1; i >= 0; i--) {
      const m = this._meteors[i]; m.t += dt; const k = clamp01(m.t / m.fall);
      m.body.position.set(m.x + 30 * (1 - k), 90 * (1 - k) + 0.4, m.z - 30 * (1 - k));
      m.mark.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(now * 14));
      if (k >= 1) {
        const d = Math.hypot(p.position.x - m.x, p.position.z - m.z);
        if (d < 11) this._hit(this.cur.def.dmg * clamp01(1 - d / 11) + 4);
        this._pulse = Math.max(this._pulse || 0, clamp01(1 - d / 60) * 1.0);
        if (d < 60) this._boom(clamp01(1 - d / 60));
        for (const o of [m.body, m.mark]) { S.remove(o); o.geometry.dispose(); o.material.dispose(); const j = this._objs.indexOf(o); if (j >= 0) this._objs.splice(j, 1); }
        this._meteors.splice(i, 1);
      }
    }
  }

  _particles(dt, d, I) {
    const c = this.cx, W = this.cv.width, H = this.cv.height, r = this._r || 1;
    c.clearRect(0, 0, W, H);
    if (!d || !d.fx?.length || I <= 0.02) return;
    const max = (this.touch ? 90 : 200), want = Math.floor(max * I), wind = (d.wind || 0.2) * 90;
    while (this._parts.length < want) {
      const k = d.fx[(Math.random() * d.fx.length) | 0];
      this._parts.push({ k, x: Math.random() * W, y: -10, z: 0.5 + Math.random(), s: Math.random() });
    }
    if (this._parts.length > want + 20) this._parts.length = want + 20;
    for (const q of this._parts) {
      const z = q.z * r;
      let vx = wind * q.z, vy = 0;
      switch (q.k) {
        case 'rain': vy = 900 * q.z; vx *= 1.4; c.strokeStyle = 'rgba(190,210,230,.45)'; c.lineWidth = z; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - vx * 0.03, q.y - vy * 0.03); c.stroke(); break;
        case 'snow': vy = 90 * q.z; vx += Math.sin(q.y * 0.02 + q.s * 9) * 30; c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(q.x, q.y, 1.4 * z, 0, 6.3); c.fill(); break;
        case 'ash': vy = 70 * q.z; c.fillStyle = 'rgba(70,66,62,.7)'; c.fillRect(q.x, q.y, 2.5 * z, 2.5 * z); break;
        case 'ember': vy = (q.s > 0.5 ? 120 : -80) * q.z; vx += Math.sin(q.y * 0.03 + q.s * 7) * 40; c.fillStyle = `rgba(255,${120 + (q.s * 90) | 0},40,.9)`; c.beginPath(); c.arc(q.x, q.y, 1.6 * z, 0, 6.3); c.fill(); break;
        case 'dust': vy = 12 * q.z; vx *= 1.8; c.fillStyle = 'rgba(150,125,95,.35)'; c.fillRect(q.x, q.y, 3 * z, 3 * z); break;
        case 'debris': vy = 40 * q.z; vx *= 3.2; c.fillStyle = 'rgba(40,36,30,.8)'; c.fillRect(q.x, q.y, 6 * z, 1.5 * z); break;
      }
      q.x += vx * dt * r; q.y += vy * dt * r;
      if (q.y > H + 12 || q.y < -40 || q.x > W + 20 || q.x < -20) { q.x = Math.random() * W; q.y = q.k === 'ember' && q.s <= 0.5 ? H + 5 : -10; }
    }
  }

  _startSound(d) {
    const a = this.audio, ctx = a?.ctx; if (!ctx || !d.sound) return;
    try {
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0); let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; ch[i] = last * 3.5; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = d.sound * 4;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(g); g.connect(a.sfx || ctx.destination); src.start();
      this._snd = { src, g, lp };
    } catch (e) { this._snd = null; }
  }
  _sound(I) { const s = this._snd; if (s) s.g.gain.setTargetAtTime(I * 0.9, s.g.context.currentTime, 0.25); }
  _stopSound() { const s = this._snd; if (!s) return; try { s.g.gain.setTargetAtTime(0, s.g.context.currentTime, 0.2); setTimeout(() => s.src.stop(), 900); } catch (e) { /* */ } this._snd = null; }
  _boom(k) {
    const ctx = this.audio?.ctx; if (!ctx) return;
    try { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(90, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(28, ctx.currentTime + 0.8);
      g.gain.setValueAtTime(0.9 * k, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9); o.connect(g); g.connect(this.audio.sfx || ctx.destination); o.start(); o.stop(ctx.currentTime + 1); } catch (e) { /* */ }
  }

  dispose() {
    this._finish();
    try { const k = 'asap_disaster_best', b = +localStorage.getItem(k) || 0; if (this.stats.survived > b) localStorage.setItem(k, String(this.stats.survived)); } catch (e) { /* */ }
    this.state.data.player._disasterSpeed = 1; this.renderer._shake = 0; this.renderer._dip = 0;
    removeEventListener('resize', this._resize); this.root?.remove();
  }
}

export const disasterSeed = (roomCode, t0) => hashStr(`${roomCode || 'solo'}:${t0 || 0}`);
