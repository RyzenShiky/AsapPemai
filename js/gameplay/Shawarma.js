import * as THREE from 'three';

export const SH = { WALK_MS: 3500, WAIT_MS: 30000, GAP_MS: 3500, GRACE_MS: 7000, MAX_STRIKES: 3, PRICE: 15, QUOTA: (n) => 8 + 2 * n };
const O = { x: 4000, z: 4000 };
const MENU = ['Ayam', 'Daging', 'Bawang', 'Tomat', 'Selada', 'Saus', 'Acar', 'Pedas'];
const CODE = { serve: 'Enter', reject: 'KeyX', cctv: 'KeyV' };

const TRAITS = {
  tall:  ['Tubuh terlalu tinggi', (c) => { c.g.scale.y = 1.4; }],
  eyes:  ['Mata menyala merah', (c) => c.eye.color.set(0xff1020)],
  smile: ['Senyum terlalu lebar', (c) => c.add(new THREE.BoxGeometry(0.34, 0.05, 0.02), c.white, 0, -0.08, 0.18, c.head)],
  tilt:  ['Kepala miring tidak wajar', (c) => { c.head.rotation.z = 0.8; }],
  blank: ['Tidak punya wajah', (c) => c.eye.color.copy(c.skin.color)],
  arms:  ['Lengan ekstra', (c) => [-0.38, 0.38].forEach((x) => c.add(c.armGeo, c.cloth, x, 0.95, -0.14))],
  ghost: ['Tidak muncul di CCTV', (c) => { c.g.userData.ghost = true; }],
  still: ['Tidak bernapas / tidak bergerak', (c) => { c.g.userData.still = true; }],
  voice: ['Ucapan terdistorsi', () => {}],
};

const rng = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const customer = (seed, i) => {
  const r = rng((seed ^ Math.imul(i + 1, 0x9e3779b1)) | 0);
  const idx = [...MENU.keys()];
  for (let k = idx.length - 1; k > 0; k--) { const j = (r() * (k + 1)) | 0; [idx[k], idx[j]] = [idx[j], idx[k]]; }
  const order = idx.slice(0, 2 + ((r() * 2) | 0)).sort((a, b) => a - b);
  const keys = Object.keys(TRAITS), anomaly = r() < Math.min(0.6, 0.3 + i * 0.03);
  return { order, anomaly, trait: anomaly ? keys[(r() * keys.length) | 0] : null, look: (r() * 1e9) | 0 };
};

const say = (c) => {
  const t = `Satu shawarma: ${c.order.map((k) => MENU[k]).join(', ')}.`;
  return c.trait === 'voice' ? t.replace(/[aiueo]/g, (m, o) => (o % 2 ? '▒' : m)) : t;
};

function person(r, trait) {
  const g = new THREE.Group(), head = new THREE.Group();
  const M = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const skin = M(new THREE.Color().setHSL(0.06 + r() * 0.05, 0.4, 0.3 + r() * 0.35));
  const cloth = M(new THREE.Color().setHSL(r(), 0.35, 0.25));
  const eye = new THREE.MeshBasicMaterial({ color: 0x0a0a0a }), white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const add = (geo, mat, x, y, z, p = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); p.add(m); return m; };
  const armGeo = new THREE.BoxGeometry(0.14, 0.7, 0.14);
  [-0.13, 0.13].forEach((x) => add(new THREE.BoxGeometry(0.2, 0.8, 0.2), cloth, x, 0.4, 0));
  add(new THREE.BoxGeometry(0.55, 0.7, 0.28), cloth, 0, 1.15, 0);
  [-0.38, 0.38].forEach((x) => add(armGeo, cloth, x, 1.1, 0));
  head.position.y = 1.78; g.add(head);
  add(new THREE.SphereGeometry(0.19, 16, 12), skin, 0, 0, 0, head);
  [-0.07, 0.07].forEach((x) => add(new THREE.SphereGeometry(0.03, 8, 6), eye, x, 0.03, 0.17, head));
  if (trait) TRAITS[trait][1]({ g, head, skin, cloth, eye, white, add, armGeo });
  return g;
}

export class Shawarma {
  constructor({ room = null, state, renderer, audio }) {
    Object.assign(this, { room, state, r: renderer, audio, plate: new Set(), btn: [], _seen: {}, _local: {}, _n: 0,
      _ci: -1, _pk: null, _k: null, _over: 0, _shut: -1e9, _last: 0, cam: false, cust: null, cur: null });
    state._pickOneOn = true;
    this._scene();
    this._ui();
    this._key = (e) => this._onKey(e);
    addEventListener('keydown', this._key);
  }

  get pk() { const p = this.room ? this.room.remotePick : this._pk; return p?.mode === 'shawarma' ? p : null; }
  get host() { return !this.room || this.room.isHost; }
  now() { return this.room ? this.room.serverNow() : Date.now(); }

  resetLocal() {
    this._ignoreT = this.pk?.t;
    this._over = 0;
    this._ci = -1;
    this._k = null;
    if (this.$?.flash) this.$.flash.style.opacity = 0;
  }

  async hostBegin() {
    if (!this.host) return;
    await this.room?.clearPick();
    const n = this.room ? Object.keys(this.room.remotePlayers || {}).length : 1;
    this._put({ mode: 'shawarma', phase: 'shift', seed: (Math.random() * 2 ** 31) | 0, i: 0, at: this.now() + SH.GRACE_MS,
      quota: SH.QUOTA(n), done: 0, strikes: 0, money: 0, last: null });
  }

  _put(p) { return this.room ? this.room.writePick(p) : void (this._pk = { ...p, t: performance.now() }); }
  _adv(pk, patch) { if (this._k === pk.t) return; this._k = pk.t; this._put({ ...pk, ...patch }); }

  _hostTick(pk, now) {
    if (pk.phase !== 'shift' || now < pk.at) return;
    const acts = this.room ? this.room.remotePickAct || {} : this._local;
    for (const [u, a] of Object.entries(acts)) {
      if (a.n === this._seen[u]) continue;
      this._seen[u] = a.n;
      const [i, plate = ''] = String(a.id || '').split(':');
      if (+i === pk.i && now >= pk.at + SH.WALK_MS && (a.k === 'serve' || a.k === 'reject')) return this._resolve(pk, a.k, plate, now);
    }
    if (now > pk.at + SH.WAIT_MS) this._resolve(pk, 'timeout', '', now);
  }

  _resolve(pk, k, plate, now) {
    const c = customer(pk.seed, pk.i);
    const ok = c.anomaly ? k === 'reject' : k === 'serve' && plate === c.order.join(',');
    if (c.anomaly && !ok) return this._adv(pk, { phase: 'over', win: false, kill: true, text: 'Anomali masuk ke kiosk…' });
    const strikes = pk.strikes + (ok ? 0 : 1), done = pk.done + (ok ? 1 : 0);
    if (strikes >= SH.MAX_STRIKES) return this._adv(pk, { phase: 'over', win: false, text: 'Kamu dipecat: terlalu banyak kesalahan.' });
    if (done >= pk.quota) return this._adv(pk, { phase: 'over', win: true, text: 'Shift selesai. Kamu selamat sampai pagi!' });
    this._adv(pk, { i: pk.i + 1, at: now + SH.GAP_MS, done, strikes, last: k, money: pk.money + (ok && !c.anomaly ? SH.PRICE : 0) });
  }

  tick() {
    const n = performance.now(), gap = n - (this._tk ?? n); this._tk = n;
    if (!this.room && gap > 400 && this._pk) this._pk.at += gap;
    const pk = this.pk, now = this.now();
    this._lock(this.state.data.player);
    if (pk && this.host) this._hostTick(pk, now);
    this._env();
    if (pk) { this._sync(pk, now); this._hud(pk, now); } else this.$.hud.textContent = 'Menunggu host…';
  }

  _lock(p) {
    const ids = this.room ? Object.keys(this.room.remotePlayers || {}).sort() : ['me'];
    const s = Math.max(0, ids.indexOf(this.room?.uid ?? 'me'));
    Object.assign(p.position, { x: O.x + (s - (ids.length - 1) / 2) * 0.8, y: 1.7, z: O.z - 0.1 });
    if (p.velocity) Object.assign(p.velocity, { x: 0, y: 0, z: 0 });
    Object.assign(p, { isRunning: false, moveState: 'idle', hunger: 100, thirst: 100, stamina: 100 });
    p.rotation.yaw = Math.max(-1, Math.min(1, p.rotation.yaw));
    p.rotation.pitch = Math.max(-0.6, Math.min(0.6, p.rotation.pitch));
  }

  _env() {
    const R = this.r, f = R.scene.fog, t = performance.now() / 1000;
    if (R.sunLight) R.sunLight.intensity = 0;
    if (R.ambientLight) R.ambientLight.intensity = 0.3;
    if (f) { f.color.setHex(0x050608); f.density = 0.045; }
    R.scene.background?.setHex?.(0x050608);
    this.lamp.intensity = 25 * (0.75 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.3));
    this.grill.intensity = 4 + Math.sin(t * 9) * 0.8;
    const closed = performance.now() - this._shut < 1300;
    this.shutter.position.y += ((closed ? 1.55 : 2.85) - this.shutter.position.y) * 0.18;
  }

  _sync(pk, now) {
    if (this._ci !== pk.i) {
      this._ci = pk.i; this.plate.clear(); this._drop();
      this.btn.forEach((n) => { n.style.background = '#111c'; });
      this.cur = customer(pk.seed, pk.i);
      this.cust = person(rng(this.cur.look), this.cur.trait);
      this.g.add(this.cust);
      if (pk.last === 'reject') this._shut = performance.now();
    }
    const c = this.cust, t = performance.now() / 1000;
    if (!c) return;
    const u = Math.max(0, Math.min(1, (now - pk.at) / SH.WALK_MS)), still = c.userData.still;
    c.visible = now >= pk.at && !(this.cam && c.userData.ghost);
    c.position.set(still ? 0 : Math.sin(t * 1.3) * 0.04, u < 1 && !still ? Math.abs(Math.sin(t * 7)) * 0.05 : 0, -12 + 8.8 * u);
    c.rotation.z = still ? 0 : Math.sin(t * 2) * 0.02;
    if (pk.phase === 'over' && pk.t === this._ignoreT) return;
    if (pk.phase !== 'over') return;
    if (!this._over) {
      this._over = performance.now();
      if (pk.kill) { this.audio?.playJumpscareStinger?.(); this.$.flash.style.opacity = 1; }
    }
    if (pk.kill) { c.position.z += (-1.05 - c.position.z) * 0.25; c.scale.setScalar(1.5); c.visible = true; }
    if (performance.now() - this._over > (pk.kill ? 1800 : 1000)) Object.assign(this.state.data.progress, { gameOver: true, win: !!pk.win });
  }

  _hud(pk, now) {
    const u = this.$, ready = pk.phase === 'shift' && now >= pk.at + SH.WALK_MS;
    u.hud.textContent = `KUOTA ${pk.done}/${pk.quota}  ·  STRIKE ${'✖'.repeat(pk.strikes)}${'·'.repeat(SH.MAX_STRIKES - pk.strikes)}  ·  Rp ${pk.money}k`;
    u.say.textContent = ready && this.cur ? say(this.cur) : '';
  }

  _onKey(e) {
    if (e.repeat) return;
    if (/^Digit[1-8]$/.test(e.code)) this._toggle(+e.code.slice(5) - 1);
    else if (e.code === CODE.serve) this._act('serve');
    else if (e.code === CODE.reject) this._act('reject');
    else if (e.code === CODE.cctv) this._cam();
  }

  _toggle(k) {
    this.plate.has(k) ? this.plate.delete(k) : this.plate.add(k);
    if (this.btn[k]) this.btn[k].style.background = this.plate.has(k) ? '#a52a' : '#111c';
  }

  _cam() {
    this.cam = !this.cam;
    this.$.scan.style.display = this.cam ? 'block' : 'none';
    const c = document.getElementById('game-canvas');
    if (c) c.style.filter = this.cam ? 'grayscale(1) contrast(1.25) brightness(1.2)' : '';
  }

  _act(k) {
    const pk = this.pk, t = performance.now();
    if (!pk || pk.phase !== 'shift' || this.now() < pk.at + SH.WALK_MS || t - this._last < 500) return;
    this._last = t;
    const id = `${pk.i}:${[...this.plate].sort((a, b) => a - b).join(',')}`;
    if (this.room) return this.room.writePickAct(k, id).catch(() => {});
    this._local.me = { k, id, n: ++this._n, t: Date.now() };
  }

  _scene() {
    const g = (this.g = new THREE.Group());
    g.position.set(O.x, 0, O.z);
    const box = (w, h, d, c, x, y, z, e = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, emissive: e }));
      m.position.set(x, y, z); g.add(m); return m;
    };
    const light = (c, i, d, x, y, z) => { const l = new THREE.PointLight(c, i, d, 2); l.position.set(x, y, z); g.add(l); return l; };
    box(60, 0.2, 60, 0x101214, 0, -0.1, -20);
    box(3.4, 0.1, 3.2, 0x2a2622, 0, 0, 0);
    box(3.4, 3, 0.15, 0x2b2f33, 0, 1.5, 1.6);
    box(0.15, 3, 3.2, 0x2b2f33, -1.7, 1.5, 0);
    box(0.15, 3, 3.2, 0x2b2f33, 1.7, 1.5, 0);
    box(3.4, 0.12, 3.4, 0x1b1d20, 0, 3, 0);
    box(3.4, 0.9, 0.5, 0x3a3d42, 0, 0.45, -1.5);
    box(3.4, 0.8, 0.2, 0x2b2f33, 0, 2.6, -1.5);
    box(1.2, 0.5, 0.5, 0x3a2a20, -1.0, 1.0, 1.2, 0x331100);
    box(0.12, 4, 0.12, 0x222428, 3, 2, -5);
    this.shutter = box(3.4, 1.3, 0.08, 0x555a60, 0, 2.85, -1.62);
    light(0xffe0b0, 12, 9, 0, 2.7, 0);
    this.grill = light(0xff6a20, 4, 4, -1, 1.4, 1.1);
    this.lamp = light(0xaad0ff, 25, 16, 3, 4, -5);
    this.r.scene.add(g);
  }

  _ui() {
    const el = (this.ui = document.createElement('div'));
    el.style.cssText = 'position:fixed;inset:0;z-index:60;pointer-events:none;color:#eee;text-shadow:0 1px 6px #000';
    el.innerHTML =
      '<div data-k=hud style="position:absolute;top:10px;left:0;right:0;text-align:center;font-size:16px;letter-spacing:.08em"></div>' +
      '<div data-k=say style="position:absolute;top:18%;left:0;right:0;text-align:center;font-size:20px"></div>' +
      '<div data-k=bar style="position:absolute;left:0;right:0;bottom:14px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;pointer-events:auto"></div>' +
      '<div data-k=book style="display:none;position:absolute;inset:12% 18%;background:#000d;padding:16px;overflow:auto;pointer-events:auto"></div>' +
      '<div data-k=scan style="display:none;position:absolute;inset:0;background:repeating-linear-gradient(#0000 0 2px,#0004 2px 3px)"></div>' +
      '<div data-k=flash style="position:absolute;inset:0;background:#a00;opacity:0;transition:opacity 1.2s"></div>';
    document.body.appendChild(el);
    this.$ = {};
    el.querySelectorAll('[data-k]').forEach((n) => { this.$[n.dataset.k] = n; });
    this.$.book.innerHTML = '<b>BUKU ATURAN</b><br>Sajikan pesanan pelanggan asli. TOLAK anomali (shutter turun). ' +
      'Menyajikan atau membiarkan anomali masuk = game over. 3 kesalahan = dipecat.<br><br><b>Ciri anomali</b><br>' +
      Object.values(TRAITS).map((t) => '• ' + t[0]).join('<br>') +
      '<br><br>Tombol: 1-8 bahan · Enter sajikan · X tolak · V CCTV';
    const mk = (txt, fn) => {
      const n = document.createElement('button');
      n.textContent = txt; n.onclick = fn; n.onmousedown = (e) => e.preventDefault();
      n.style.cssText = 'padding:8px 12px;background:#111c;color:#fff;border:1px solid #666;border-radius:6px;font:inherit';
      this.$.bar.append(n); return n;
    };
    MENU.forEach((m, k) => { this.btn[k] = mk(`${k + 1} ${m}`, () => this._toggle(k)); });
    mk('SAJIKAN', () => this._act('serve'));
    mk('TOLAK', () => this._act('reject'));
    mk('CCTV', () => this._cam());
    mk('BUKU', () => { this.$.book.style.display = this.$.book.style.display === 'none' ? 'block' : 'none'; });
  }

  _drop() {
    if (!this.cust) return;
    this.g.remove(this.cust);
    this.cust.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    this.cust = null;
  }

  dispose() {
    removeEventListener('keydown', this._key);
    const c = document.getElementById('game-canvas');
    if (c) c.style.filter = '';
    this._drop();
    this.r.scene.remove(this.g);
    this.g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    this.ui?.remove();
    this.state._pickOneOn = false;
    // restore outdoor look (applyDayLighting will refine next frame)
    const R = this.r;
    if (R.scene.fog) { R.scene.fog.color.setHex(0x8899aa); R.scene.fog.density = 0.012; }
    R.scene.background?.setHex?.(0x87a0b8);
    if (R.ambientLight) R.ambientLight.intensity = 0.6;
    if (R.sunLight) R.sunLight.intensity = 1.2;
  }
}
