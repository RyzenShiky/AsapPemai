import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getDatabase, ref, set, update, onValue, onDisconnect, get, push,
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js';
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js';

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

export function initFirebase() {
  if (db) return db;
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  return db;
}

export function getDb() {
  return initFirebase();
}

export function getStorageRef() {
  if (!app) initFirebase();
  return getStorage(app);
}

export async function uploadBillboardMedia(file, roomCode) {
  const storage = getStorageRef();
  const safe = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `billboard/${roomCode || 'solo'}/${Date.now()}_${safe}`;
  const fileRef = sRef(storage, path);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}

export function deviceUid() {
  let id = localStorage.getItem('longway_uid');
  if (!id) {
    id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('longway_uid', id);
  }
  return id;
}

export function roomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * Host-authority multiplayer.
 * /rooms/{code}/meta { hostUid, createdAt, started }
 * /rooms/{code}/players/{uid}
 * /rooms/{code}/monster/{id}
 * /rooms/{code}/soundEvents
 * /rooms/{code}/game
 */
export class MultiplayerRoom {
  constructor(code, isHost) {
    this.code = code;
    this.uid = deviceUid();
    this.isHost = !!isHost;
    this.db = getDb();
    this.unsubs = [];
    this.remotePlayers = {};
    this.remoteMonsters = {};
    this.remoteSounds = [];
    this.remoteVehicles = {};
    this.remoteBillboard = null;
    this.gameStatus = { gameOver: false, win: false };
    this.meta = { hostUid: null, started: false };
    this.onUpdate = null;
  }

  async create() {
    this.isHost = true;
    await set(ref(this.db, `rooms/${this.code}/meta`), {
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
    this.meta = meta;
    this.isHost = meta.hostUid === this.uid;

    // Host migration if previous host left
    if (!meta.hostUid) {
      await this.claimHost();
    }

    await this._joinPlayer();
    // AFTER isHost is final — register disconnect cleanup
    this._setupDisconnect();
    this._listen();
  }

  async claimHost() {
    await update(ref(this.db, `rooms/${this.code}/meta`), { hostUid: this.uid });
    this.isHost = true;
    this.meta.hostUid = this.uid;
  }

  async setStarted(started = true) {
    if (!this.isHost) return;
    await update(ref(this.db, `rooms/${this.code}/meta`), { started: !!started });
    this.meta.started = !!started;
  }

  async _joinPlayer() {
    const pref = ref(this.db, `rooms/${this.code}/players/${this.uid}`);
    await set(pref, {
      x: 0, y: 1.7, z: 8 + Math.random() * 2,
      yaw: 0,
      alive: true,
      health: 100,
      name: 'Player_' + this.uid.slice(-4),
      joinedAt: Date.now(),
    });
  }

  _setupDisconnect() {
    const pref = ref(this.db, `rooms/${this.code}/players/${this.uid}`);
    onDisconnect(pref).remove();
    if (this.isHost) {
      onDisconnect(ref(this.db, `rooms/${this.code}/meta/hostUid`)).set(null);
      // also reset started if host leaves before game? keep started true mid-game
    }
  }

  _listen() {
    const root = ref(this.db, `rooms/${this.code}`);
    const unsub = onValue(root, (snap) => {
      const v = snap.val() || {};
      this.remotePlayers = v.players || {};
      this.remoteMonsters = v.monster || {};
      this.remoteSounds = v.soundEvents ? Object.values(v.soundEvents) : [];
      this.gameStatus = v.game || { gameOver: false, win: false };
      this.remoteVehicles = v.vehicles || {};
      this.remoteBillboard = v.billboard || null;
      this.meta = v.meta || { hostUid: null, started: false };

      if (this.meta.hostUid === this.uid) this.isHost = true;
      else if (this.meta.hostUid) this.isHost = false;

      // Host migration: no host → earliest joiner claims
      if (!this.meta.hostUid) {
        const players = Object.entries(this.remotePlayers).sort(
          (a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0)
        );
        if (players[0] && players[0][0] === this.uid) {
          this.claimHost().then(() => this._setupDisconnect());
        }
      }

      if (typeof this.onUpdate === 'function') this.onUpdate();
    });
    this.unsubs.push(() => unsub());
  }

  writePlayer(player) {
    const prev = this.remotePlayers[this.uid] || {};
    const eyeY = player.position.y;
    const footY = eyeY - 1.7; // Player.position.y is eye height
    return set(ref(this.db, `rooms/${this.code}/players/${this.uid}`), {
      x: player.position.x,
      y: eyeY,
      footY,
      z: player.position.z,
      yaw: player.rotation.yaw,
      alive: player.alive !== false,
      health: player.health ?? 100,
      moveState: player.moveState || 'idle',
      isDowned: !!player.isDowned,
      downedTimer: player.downedTimer || 0,
      ridingVehicleId: player.ridingVehicleId || null,
      ridingRole: player.ridingRole || null,
      name: prev.name || ('Player_' + this.uid.slice(-4)),
      joinedAt: prev.joinedAt || Date.now(),
    });
  }

  /** Host applies damage to any player uid */
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
      };
    });
    return set(ref(this.db, `rooms/${this.code}/monster`), payload);
  }

  writeSound(ev) {
    const sref = push(ref(this.db, `rooms/${this.code}/soundEvents`));
    return set(sref, {
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

  
  writeVehicles(vehicles) {
    if (!this.isHost) return Promise.resolve();
    const payload = {};
    for (const v of vehicles || []) {
      payload[v.id] = {
        type: v.type,
        x: v.position.x,
        y: v.position.y || 0,
        z: v.position.z,
        yaw: v.rotation.yaw,
        driver: v.driverUid,
        passengers: v.passengerUids || [],
        speed: v.speed || 0,
      };
    }
    return set(ref(this.db, `rooms/${this.code}/vehicles`), payload);
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
    return set(ref(this.db, `rooms/${this.code}/game`), payload);
  }

  dispose() {
    this.unsubs.forEach((u) => {
      try { u(); } catch (e) { /* */ }
    });
    this.unsubs = [];
  }
}
