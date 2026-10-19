import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getDatabase, ref, set, update, onValue, onDisconnect, get, remove, push, onChildAdded, query, limitToLast,
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js';
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js';
import {
  getAuth, signInAnonymously, initializeAuth,
  indexedDBLocalPersistence, browserLocalPersistence,
  browserSessionPersistence, inMemoryPersistence,
  browserPopupRedirectResolver,
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import { MAX_PLAYERS, ROSTER } from '../core/MonsterTypes.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC5T3AoTWf6qn67JGMltq-j349oMAcqH9w',
  authDomain: 'longway-284bd.firebaseapp.com',
  databaseURL: 'https://longway-284bd-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'longway-284bd',
  storageBucket: 'longway-284bd.firebasestorage.app',
  messagingSenderId: '542390529535',
  appId: '1:542390529535:web:db7f515426a5fe94250bca',
  measurementId: 'G-N3P50GTL25',
};

let app, db;

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('auth-timeout')), ms))]);

export function initFirebase() {
  if (db) return db;
  app = initializeApp(firebaseConfig);
  try {
    initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence, browserLocalPersistence,
        browserSessionPersistence, inMemoryPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (e) { /* already */ }
  db = getDatabase(app);
  return db;
}

export function getDb() {
  return initFirebase();
}

export function getAppInstance() {
  if (!app) initFirebase();
  return app;
}

/** Wait for Firebase Auth; sign in anonymously if needed. Returns auth.uid. */
export async function ensureAuthUid(ms = 20000) {
  initFirebase();
  const auth = getAuth(app);
  const withTimeout = (p, ms) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('auth-timeout'), { code: 'auth/timeout' })), ms)),
  ]);
  for (let i = 0; i < 3; i++) {
    try {
      await withTimeout(auth.authStateReady(), ms);
      if (!auth.currentUser) await withTimeout(signInAnonymously(auth), ms);
      return auth.currentUser.uid;
    } catch (e) {
      const hard = e.code && String(e.code).startsWith('auth/') && e.code !== 'auth/network-request-failed' && e.code !== 'auth/timeout';
      if (i === 2 || hard) throw e;
    }
  }
}

export function getStorageRef() {
  if (!app) initFirebase();
  return getStorage(app);
}

export async function uploadBillboardMedia(file, roomCode) {
  if (file.size > 8 * 1024 * 1024) throw new Error('File terlalu besar (maks 8 MB)');
  const ok = /^(image\/|video\/mp4)/.test(file.type || '');
  if (!ok) throw new Error('Tipe file tidak diizinkan');
  const storage = getStorageRef();
  const safe = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `billboard/${roomCode || 'solo'}/${Date.now()}_${safe}`;
  const fileRef = sRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return getDownloadURL(fileRef);
}

/** Local-only fallback id (solo / offline). Prefer ensureAuthUid for multiplayer. */
export function deviceUid() {
  let id = localStorage.getItem('longway_uid');
  if (!id) {
    id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('longway_uid', id);
  }
  return id;
}

/** 6-char room code without ambiguous characters. */
export function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => A[x % A.length]).join('');
}

/**
 * Host-authority multiplayer with driver-writable vehicles and claim pickups.
 */
export class MultiplayerRoom {
  constructor(code, isHost) {
    this.code = code;
    this.db = getDb();
    const auth = getAuth(app);
    this.uid = auth.currentUser?.uid;
    if (!this.uid) throw new Error('Belum terhubung ke server. Coba login ulang.');
    this.isHost = !!isHost;
    this.unsubs = [];
    this.remotePlayers = {};
    this.remoteMonsters = {};
    this.remoteSounds = [];
    this.remoteVehicles = {};
    this.remotePickups = {};
    this.remoteClaims = {};
    this.remoteBillboard = null;
    this.gameStatus = { gameOver: false, win: false };
    this.remoteMission = null;
    this.remoteMissionActs = {};
    this.meta = { hostUid: null, started: false };
    this.onUpdate = null;
    this.skew = 0;
    this.t0 = null;
    try {
      onValue(ref(this.db, '.info/serverTimeOffset'), (s) => {
        this.skew = s.val() || 0;
      });
    } catch (e) { /* */ }
  }

  serverNow() {
    return Date.now() + (this.skew || 0);
  }

  async create() {
    this.isHost = true;
    await set(ref(this.db, `rooms/${this.code}/meta`), {
      level: this.level || 'world',
      hostUid: this.uid,
      createdAt: Date.now(),
      started: false,
    });
    await this._joinPlayer();
    this._setupDisconnect();
    this._listen();
  }

  async join() {
    const snap = await get(ref(this.db, `rooms/${this.code}/meta`));
    if (!snap.exists()) throw new Error('Room not found');
    const meta = snap.val();
    const want = meta?.level || 'world';
    if (this.level !== undefined && want !== this.level) {
      const err = new Error(`Host memakai map "${want}"`);
      err.mapMismatch = want;
      throw err;
    }
    this.meta = meta;
    this.isHost = meta.hostUid === this.uid;

    if (!meta.hostUid) await this.claimHost();

    await this._joinPlayer();
    this._setupDisconnect();
    this._listen();
  }

  async claimHost() {
    try {
      await update(ref(this.db, `rooms/${this.code}/meta`), { hostUid: this.uid });
      this.isHost = true;
      this.meta.hostUid = this.uid;
      return true;
    } catch (e) {
      return false;
    }
  }

  async setStarted(started = true) {
    if (!this.isHost) return;
    await update(ref(this.db, `rooms/${this.code}/meta`), { started: !!started });
    this.meta.started = !!started;
  }

  async _joinPlayer() {
    const ps = (await get(ref(this.db, `rooms/${this.code}/players`))).val() || {};
    if (!ps[this.uid] && Object.keys(ps).length >= MAX_PLAYERS) {
      throw new Error('Room penuh (maks. 6 pemain)');
    }
    const pref = ref(this.db, `rooms/${this.code}/players/${this.uid}`);
    await set(pref, {
      x: 0,
      y: 1.7,
      z: 8 + Math.random() * 2,
      yaw: 0,
      alive: true,
      health: 100,
      name: 'Player_' + this.uid.slice(-4),
      joinedAt: Date.now(),
    });
    // Re-register onDisconnect on every reconnect
    if (!this._connWatch) {
      this._connWatch = true;
      const unsub = onValue(ref(this.db, '.info/connected'), (s) => {
        if (s.val()) this._setupDisconnect();
      });
      this.unsubs.push(() => unsub());
    }
  }

  _setupDisconnect() {
    const pref = ref(this.db, `rooms/${this.code}/players/${this.uid}`);
    onDisconnect(pref).remove();
    if (this.isHost) {
      onDisconnect(ref(this.db, `rooms/${this.code}/meta/hostUid`)).set(null);
    }
  }

  _listen() {
    const root = ref(this.db, `rooms/${this.code}`);
    const unsub = onValue(root, (snap) => {
      const v = snap.val() || {};
      this.remotePlayers = v.players || {};
      this.remoteMonsters = v.monster || {};
      this.remoteSounds = v.soundEvents
        ? Object.values(v.soundEvents).flatMap((s) => (s.list || []).map((e) => ({ ...e, by: s.by, t: e.id })))
        : [];
      this.gameStatus = v.game || { gameOver: false, win: false };
      this.remoteVehicles = v.vehicles || {};
      this.remotePickups = v.pickups || {};
      this.remoteMission = v.mission || null;
      this.remoteMissionActs = v.missionActs || {};
      this.remotePick = v.pick || null;
      this.remotePickChoice = v.pickChoice || {};
      this.remotePickAct = v.pickAct || {};
      this.remoteClaims = v.pickupClaims || {};
      this.remoteBillboard = v.billboard || null;
      this.meta = v.meta || { hostUid: null, started: false };

      if (this.meta.hostUid === this.uid) this.isHost = true;
      else if (this.meta.hostUid) this.isHost = false;

      if (!this.meta.hostUid) {
        const order = Object.entries(this.remotePlayers)
          .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
          .map(([u]) => u);
        const rank = Math.max(0, order.indexOf(this.uid));
        clearTimeout(this._claimT);
        this._claimT = setTimeout(async () => {
          if (!this.meta.hostUid && (await this.claimHost())) this._setupDisconnect();
        }, rank * 1500);
      } else {
        clearTimeout(this._claimT);
      }

      if (typeof this.onUpdate === 'function') this.onUpdate();
    });
    this.unsubs.push(() => unsub());
    this._chatFrom = this.serverNow() - 15000;
    try {
      const cu = onChildAdded(
        query(ref(this.db, `rooms/${this.code}/chat`), limitToLast(30)),
        (s) => {
          const m = s.val();
          if (m && m.t >= this._chatFrom && this.onChat) this.onChat(m);
        }
      );
      this.unsubs.push(() => cu());
    } catch (e) { /* */ }
  }

  /** Client-owned fields only; host also writes own health/alive. Uses update() so host damage is not clobbered. */
  respawnSelf() {
    return update(ref(this.db, `rooms/${this.code}/players/${this.uid}`), {
      alive: true, isDowned: false, health: 100, downedTimer: 0,
      x: 0, y: 1.7, z: 8 + Math.random() * 2,
    });
  }

  writeSounds(list) {
    return set(ref(this.db, `rooms/${this.code}/soundEvents/${this.uid}`), {
      by: this.uid, t: Date.now(),
      list: (list || []).map((e) => ({
        id: e.id, x: e.position.x, y: e.position.y || 0, z: e.position.z,
        intensity: e.intensity, radius: e.radius, type: e.type,
      })),
    });
  }

  writeDoorBroken(id) {
    if (!this.code || !id) return Promise.resolve();
    return set(ref(this.db, `rooms/${this.code}/doorsBroken/${id}`), true);
  }

  listenDoorsBroken(cb) {
    if (!this.code || this._brokenListening) return;
    this._brokenListening = true;
    onValue(ref(this.db, `rooms/${this.code}/doorsBroken`), (snap) => {
      const v = snap.val() || {};
      for (const id of Object.keys(v)) {
        try { cb?.(id); } catch (e) { /* */ }
      }
    });
  }

  setMode(mode) {
    if (!this.isHost) return Promise.resolve();
    this.meta.mode = mode;
    return update(ref(this.db, `rooms/${this.code}/meta`), { mode });
  }

  writePick(p) {
    if (!this.isHost) return Promise.resolve();
    return set(ref(this.db, `rooms/${this.code}/pick`), { ...p, t: Date.now() });
  }

  clearPick() {
    if (!this.isHost) return Promise.resolve();
    return Promise.all(
      ['pick', 'pickChoice', 'pickAct'].map((k) => set(ref(this.db, `rooms/${this.code}/${k}`), null))
    );
  }

  writePickChoice(type) {
    return set(ref(this.db, `rooms/${this.code}/pickChoice/${this.uid}`), {
      type: String(type).slice(0, 16), t: Date.now(),
    });
  }

  writePickAct(k, id = null) {
    this._actN = (this._actN || 0) + 1;
    return set(ref(this.db, `rooms/${this.code}/pickAct/${this.uid}`), { k, id, n: this._actN, t: Date.now() });
  }

  writeDoor(id, open) {
    if (!this.code || !id) return Promise.resolve();
    return set(ref(this.db, `rooms/${this.code}/doors/${id}`), !!open);
  }

  listenDoors(cb) {
    if (!this.code || this._doorsListening) return;
    this._doorsListening = true;
    onValue(ref(this.db, `rooms/${this.code}/doors`), (snap) => {
      const v = snap.val() || {};
      for (const id of Object.keys(v)) {
        try { cb?.(id, !!v[id]); } catch (e) { /* */ }
      }
    });
  }

  sendChat(text, name) {
    if (Date.now() - (this._lc || 0) < 800) return Promise.resolve();
    this._lc = Date.now();
    return push(ref(this.db, `rooms/${this.code}/chat`), {
      uid: this.uid,
      name: String(name || 'Player').slice(0, 16),
      text: String(text).slice(0, 120),
      t: Date.now(),
    });
  }

  writePlayer(player) {
    const prev = this.remotePlayers[this.uid] || {};
    const eyeY = player.position.y;
    const footY = player.ridingVehicleId ? eyeY - 0.5
                : player.moveState === 'crawl' || player.isDowned ? eyeY - 0.9
                : eyeY - 1.7;
    const own = {
      x: player.position.x,
      y: eyeY,
      footY,
      z: player.position.z,
      yaw: player.rotation.yaw,
      moveState: player.moveState || 'idle',
      ridingVehicleId: player.ridingVehicleId || null,
      ridingRole: player.ridingRole || null,
      name: prev.name || 'Player_' + this.uid.slice(-4),
      joinedAt: prev.joinedAt || Date.now(),
      fl: !!player.flashlight,
      hiding: !!player.isHiding,
      pitch: +(player.rotation.pitch || 0).toFixed(2),
    };
    if (this.isHost || !this.remotePlayers[this.uid]) {
      Object.assign(own, {
        alive: player.alive !== false,
        health: player.health ?? 100,
        isDowned: !!player.isDowned,
        downedTimer: player.downedTimer || 0,
      });
    }
    return update(ref(this.db, `rooms/${this.code}/players/${this.uid}`), own);
  }

  applyDamage(uid, amount) {
    if (!this.isHost) return Promise.resolve();
    const prev = this.remotePlayers[uid];
    if (!prev) return Promise.resolve();
    let health = (prev.health ?? 100) - amount;
    let isDowned = !!prev.isDowned;
    let alive = true;
    if (isDowned) {
      alive = false;
      isDowned = false;
      health = 0;
    } else if (health <= 0) {
      health = 0;
      isDowned = true;
    }
    return update(ref(this.db, `rooms/${this.code}/players/${uid}`), {
      health,
      alive,
      isDowned,
      downedTimer: isDowned ? 45 : 0,
    });
  }

  writeMonsters(monsters) {
    if (!this.isHost) return Promise.resolve();
    const payload = {};
    monsters.forEach((m, i) => {
      payload[m.id || `m${i}`] = {
        x: m.position.x,
        y: m.position.y || 0,
        z: m.position.z,
        yaw: m.rotation.yaw,
        aiState: m.aiState,
        suspicion: m.memory?.suspicion || 0,
        attackCooldown: m.attackCooldown || 0,
        active: m.active !== false,
        type: ROSTER[i] || 'shadow',
        door: m.breach?.id ?? null,
        dph: m.breach?.ph ?? 0,
        dst: m.breach?.style ?? null,
      };
    });
    return set(ref(this.db, `rooms/${this.code}/monster`), payload);
  }

  writeSound(ev) {
    return set(ref(this.db, `rooms/${this.code}/soundEvents/${this.uid}`), {
      x: ev.position.x,
      y: ev.position.y || 0,
      z: ev.position.z,
      intensity: ev.intensity,
      radius: ev.radius,
      type: ev.type,
      t: Date.now(),
      by: this.uid,
    });
  }

  revivePlayer(uid) {
    const prev = this.remotePlayers[uid];
    if (!prev) return Promise.resolve();
    return update(ref(this.db, `rooms/${this.code}/players/${uid}`), {
      isDowned: false,
      health: 40,
      alive: true,
      downedTimer: 0,
    });
  }

  /** Per-vehicle write: driver or host (host won't overwrite another driver's vehicle). */
  writeVehicle(v) {
    const me = this.uid;
    if (v.driverUid && v.driverUid !== me && !this.isHost) return Promise.resolve();
    if (this.isHost && v.driverUid && v.driverUid !== me) return Promise.resolve();
    // Clear driver on disconnect so vehicle is not stuck
    if (v.driverUid === me && this._odv !== v.id) {
      this._odv = v.id;
      try {
        onDisconnect(ref(this.db, `rooms/${this.code}/vehicles/${v.id}/driver`)).set(null);
      } catch (e) { /* */ }
    }
    return set(ref(this.db, `rooms/${this.code}/vehicles/${v.id}`), {
      type: v.type,
      x: v.position.x,
      y: v.position.y || 0,
      z: v.position.z,
      yaw: v.rotation.yaw,
      driver: v.driverUid || null,
      passengers: v.passengerUids || [],
      speed: v.speed || 0,
    });
  }

  /** @deprecated prefer writeVehicle */
  writeVehicles(vehicles) {
    return Promise.all((vehicles || []).map((v) => this.writeVehicle(v)));
  }

  setBillboard(url, type) {
    return set(ref(this.db, `rooms/${this.code}/billboard`), {
      url,
      type,
      by: this.uid,
      t: Date.now(),
    });
  }

  writeGame(progress, weather) {
    if (!this.isHost) return Promise.resolve();
    const payload = {
      gameOver: !!progress.gameOver,
      win: !!progress.win,
      deaths: progress.deaths || 0,
    };
    if (weather) payload.weather = weather;
    const cfg = this.cfg || this.gameStatus;
    if (cfg && cfg.dayLimit) { payload.mode = cfg.mode; payload.dayLimit = cfg.dayLimit; }
    // Preserve existing t0 across host migration; optional ?t= for night testing
    if (!this.gameStatus.t0 && !this.t0 && typeof location !== 'undefined') {
      const q = parseFloat(new URLSearchParams(location.search).get('t') || '0');
      if (q > 0) this.t0 = this.serverNow() - q * 180 * 1000;
    }
    payload.t0 = this.gameStatus.t0 || (this.t0 ??= this.serverNow());
    return set(ref(this.db, `rooms/${this.code}/game`), payload);
  }

  writePickups(pickups) {
    if (!this.isHost) return Promise.resolve();
    return set(ref(this.db, `rooms/${this.code}/pickups`), pickups || {});
  }

  writeMission(state) {
    if (!this.isHost) return Promise.resolve();
    return set(ref(this.db, `rooms/${this.code}/mission`), state);
  }

  sendMissionAct(act) {
    return set(ref(this.db, `rooms/${this.code}/missionActs/${this.uid}`), {
      n: act.n, target: act.target, t: Date.now(),
    });
  }

  claimPickup(pickupId) {
    return set(ref(this.db, `rooms/${this.code}/pickupClaims/${this.uid}`), {
      pickupId,
      t: Date.now(),
    });
  }

  async leave() {
    clearTimeout(this._claimT);
    this.dispose();
    const base = `rooms/${this.code}`;
    try {
      await onDisconnect(ref(this.db, `${base}/players/${this.uid}`)).cancel();
      if (this.isHost) await onDisconnect(ref(this.db, `${base}/meta/hostUid`)).cancel();
    } catch (e) { /* */ }
    await remove(ref(this.db, `${base}/players/${this.uid}`));
    if (this.isHost) await set(ref(this.db, `${base}/meta/hostUid`), null);
  }

  dispose() {
    this.unsubs.forEach((u) => {
      try {
        u();
      } catch (e) { /* */ }
    });
    this.unsubs = [];
  }
}
