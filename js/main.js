import { GameState } from './core/GameState.js';
import { Clock } from './core/Clock.js';
import { buildColliders, buildSpatialGrid } from './core/Collision.js';
import { isTouchDevice } from './core/Device.js';
import { onOrientationChange, updateRotateHint, tryLandscapeLock, installLandscapeAutoLock, cycleScreenRotation, autoSyncFromDevice } from './core/Orientation.js';
import { loadProfile, saveProfile, ensureUid } from './core/Profile.js';
import { PlayerController } from './gameplay/Player.js';
import { MonsterController } from './gameplay/Monster.js';
import { nearestMonsterDist, heartFromDistance } from './gameplay/Proximity.js';
import { MATCH_SECONDS, phaseFromProgress, lightingForProgress, randomMonsterSpawn } from './core/DayCycle.js';
import { isInsideBuilding } from './core/Buildings.js';
import { SanityManager } from './gameplay/Sanity.js';
import { JumpscareManager } from './gameplay/Jumpscare.js';
import { PacingDirector } from './core/PacingDirector.js';
import { DreadSequencer } from './audio/DreadSequencer.js';
import { installSecretCodes } from './input/SecretCode.js';
import { VehicleController, findDismountSpot } from './gameplay/Vehicle.js';
import { MultiplayerRoom, roomCode as genRoomCode, initFirebase, deviceUid, uploadBillboardMedia } from './net/firebase.js';
import { AudioManager } from './audio/AudioManager.js';
import { Renderer } from './renderer/Renderer.js';
import { TouchControls } from './input/TouchControls.js';
import {
  getAuth, signInAnonymously, GoogleAuthProvider, signInWithRedirect, getRedirectResult,
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';

let renderer, player, monsters, audio, clock, state, colliders, touch;
let running = false;
let room = null;
let mode = 'solo';
let netWriteAcc = 0;
let profile = loadProfile();
const ESCAPE_TIME = MATCH_SECONDS;
let heartAcc = 0;
let lastNearDist = Infinity;
let sanity = new SanityManager();
let jumpscare = new JumpscareManager();
let pacing = new PacingDirector();
let dread = null;
let vehicleControllers = [];
let jumpscareHideTimer = null;

async function init() {
  const canvas = document.getElementById('game-canvas');
  try { initFirebase(); } catch (e) { console.warn('Firebase', e); }

  // Complete Google redirect sign-in if returning from Google (timeout so init never hangs)
  try {
    initFirebase();
    const auth = getAuth();
    const cred = await Promise.race([
      getRedirectResult(auth),
      new Promise((res) => setTimeout(() => res(null), 3000)),
    ]);
    if (cred && cred.user) {
      profile.displayName = (cred.user.displayName || 'Player').slice(0, 16);
      profile.uid = cred.user.uid;
      profile.provider = 'google';
      localStorage.setItem('longway_uid', profile.uid);
      saveProfile(profile);
      const nameInput = document.getElementById('profile-name');
      if (nameInput) nameInput.value = profile.displayName;
      window.__longwayGoogleLogin = true;
    }
  } catch (e) {
    console.warn('getRedirectResult', e);
  }

  // Profile form defaults
  const nameInput = document.getElementById('profile-name');
  if (nameInput) nameInput.value = profile.displayName || '';
  document.querySelectorAll('.color-swatch').forEach((el) => {
    el.classList.toggle('selected', el.dataset.color === profile.avatarColor);
    el.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
      el.classList.add('selected');
      profile.avatarColor = el.dataset.color;
    });
  });

  audio = new AudioManager();
  await audio.init();
  dread = new DreadSequencer(audio);
  colliders = buildSpatialGrid(buildColliders());
  renderer = new Renderer();
  await renderer.init(canvas);

  const onResize = () => renderer.resize(canvas.clientWidth, canvas.clientHeight);
  window.addEventListener('resize', onResize);
  onResize();
  clock = new Clock();
  wireUI(canvas);
  installSecretCodes({
    onTrue: () => {
      document.getElementById('billboard-panel')?.classList.toggle('open');
    },
    onMotor: () => spawnVehicle('motor'),
    onMobil: () => spawnVehicle('mobil'),
  });
  document.getElementById('bb-close')?.addEventListener('click', () => {
    document.getElementById('billboard-panel')?.classList.remove('open');
  });
  document.getElementById('bb-upload')?.addEventListener('click', async () => {
    const file = document.getElementById('bb-file')?.files?.[0];
    const st = document.getElementById('bb-status');
    if (!file) { if (st) st.textContent = 'Pilih file dulu'; return; }
    if (file.size > 8 * 1024 * 1024) { if (st) st.textContent = 'Max 8MB'; return; }
    try {
      if (st) st.textContent = 'Uploading…';
      const code = room?.code || 'solo';
      if (room && !room.isHost) {
        if (st) st.textContent = 'Hanya host yang boleh upload';
        return;
      }
      const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image';
      const url = await uploadBillboardMedia(file, code);
      if (room) await room.setBillboard(url, type);
      else if (renderer) renderer.applyBillboardMedia({ url, type }, audio);
      if (st) st.textContent = 'OK';
    } catch (e) {
      console.error(e);
      if (st) st.textContent = e.message || 'Upload gagal (cek Storage rules)';
    }
  });
  {
    const st = document.getElementById('login-status');
    if (st) st.textContent = 'Siap — pilih Guest atau Google';
    const bg = document.getElementById('btn-guest');
    const bgg = document.getElementById('btn-google');
    if (bg) bg.disabled = false;
    if (bgg) bgg.disabled = false;
    if (window.__longwayGoogleLogin) {
      window.__longwayGoogleLogin = false;
      enterMenu();
    }
  }

  onOrientationChange(() => {
    updateRotateHint();
    if (touch && touch.active) touch._syncLayout();
    if (renderer) {
      const canvas = document.getElementById('game-canvas');
      if (canvas) renderer.resize(canvas.clientWidth, canvas.clientHeight);
    }
  });
  updateRotateHint();
  installLandscapeAutoLock();
  document.getElementById('btn-force-landscape')?.addEventListener('click', async () => {
    await tryLandscapeLock();
    updateRotateHint();
  });
  const rotHandler = () => {
    window.__longwayManualRot = true;
    cycleScreenRotation();
    updateRotateHint();
    const canvas = document.getElementById('game-canvas');
    if (renderer && canvas) renderer.resize(canvas.clientWidth, canvas.clientHeight);
  };
  document.getElementById('btn-rotate-screen')?.addEventListener('click', rotHandler);
  document.getElementById('btn-settings-rotate')?.addEventListener('click', rotHandler);

  // If already guest profile saved, skip login optional — still show login first
}

function refreshContinueBtn() {
  const btn = document.getElementById('btn-continue');
  if (btn) btn.disabled = !GameState.hasSave();
}

function enterMenu() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');
  document.getElementById('menu-player-name').textContent =
    `${profile.displayName} · ${profile.provider}`;
  refreshContinueBtn();
}

function setupLocalGame(fromSave = false) {
  if (fromSave) state = GameState.loadLocal() || new GameState();
  else {
    if (mode === 'solo') GameState.clearSave();
    state = new GameState();
  }
  player = new PlayerController(
    document.getElementById('game-canvas'),
    state,
    colliders,
    audio
  );
  const MONSTER_COUNT = 2;
  state.data.monsters = Array.from({ length: MONSTER_COUNT }, (_, i) => ({
    id: 'm' + i,
    position: { x: 0, y: 0, z: 0 },
    rotation: { yaw: 0 },
    aiState: 'PATROL',
    active: true,
    memory: {
      lastHeardPosition: null, lastHeardTime: 0, lastHeardIntensity: 0,
      confidence: 0, suspicion: 0, searchRadius: 14,
    },
    path: [],
  }));
  const used = [];
  for (let i = 0; i < MONSTER_COUNT; i++) {
    let spawn;
    for (let tries = 0; tries < 12; tries++) {
      spawn = randomMonsterSpawn(state.data.player.position, 50 + i * 20, 120 + i * 30);
      if (used.every((u) => Math.hypot(u.x - spawn.x, u.z - spawn.z) > 40)) break;
    }
    used.push(spawn);
    const mon = state.data.monsters[i];
    mon.position.x = spawn.x;
    mon.position.y = 0;
    mon.position.z = spawn.z;
    mon.active = true;
    mon.aiState = 'PATROL';
    mon.memory.suspicion = 0;
  }
  state.data.world.elapsed = 0;
  state.data.world.timeLimit = MATCH_SECONDS;
  state.data.progress.timeUp = false;
  sanity = new SanityManager();
  jumpscare = new JumpscareManager();
  pacing = new PacingDirector();
  vehicleControllers = [];
  state.data.vehicles = [];
  hideJumpscare();

  player.onThrow = (from, to) => {
    if (renderer && renderer.spawnThrowable) renderer.spawnThrowable(from, to);
  };
  monsters = state.data.monsters.map((_, i) => new MonsterController(state, i, colliders, room));

  // Touch controls
  if (isTouchDevice()) {
    if (!touch) {
      touch = new TouchControls(document.getElementById('ui-root'), player.keys, (dx, dy) => {
        player.applyLook(dx, dy);
      });
    } else {
      touch.keys = player.keys;
    }
    touch.onHide = () => player.toggleHide();
      touch.onThrowBtn = () => player.throwDistraction();
      touch.onFlashToggle = () => {
        player.flashlightOn = !player.flashlightOn;
        if (state.data.player) state.data.player.flashlight = player.flashlightOn;
      };
      touch.show();
  }
}

function hideTouch() {
  if (touch) touch.hide();
}

function renderLobbyPlayers() {
  const ul = document.getElementById('lobby-players');
  const startBtn = document.getElementById('btn-start-multi');
  const status = document.getElementById('lobby-status');
  if (!ul || !room) return;
  const entries = Object.entries(room.remotePlayers).sort(
    (a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0)
  );
  ul.innerHTML = '';
  for (const [uid, p] of entries) {
    const li = document.createElement('li');
    const isHost = room.meta?.hostUid === uid;
    const isYou = uid === room.uid;
    li.textContent = `${p.name || uid.slice(-6)}${isHost ? ' ★ HOST' : ''}${isYou ? ' (you)' : ''}`;
    li.style.padding = '0.25rem 0';
    ul.appendChild(li);
  }
  if (room.isHost) {
    startBtn.classList.remove('hidden');
    status.textContent = `${entries.length} player(s) — Start when ready`;
  } else {
    startBtn.classList.add('hidden');
    status.textContent = room.meta?.started ? 'Host started…' : 'Waiting for host…';
  }
  if (!room.isHost && room.meta?.started && !running) beginMultiGame();
}

function enterLobby() {
  document.getElementById('lobby-code').textContent = room.code;
  document.getElementById('multi-screen').classList.add('hidden');
  document.getElementById('lobby-screen').classList.remove('hidden');
  renderLobbyPlayers();
  room.onUpdate = () => {
    renderLobbyPlayers();
    if (room.meta?.started && !running && !room.isHost) beginMultiGame();
  };
}

async function beginMultiGame() {
  if (running) return;
  mode = 'multi';
  document.getElementById('lobby-screen').classList.add('hidden');
  document.getElementById('loading-screen').classList.remove('hidden');
  setupLocalGame(false);
  await audio.resume();
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('room-hud').textContent =
    `Room ${room.code}${room.isHost ? ' (HOST)' : ''}`;
  document.getElementById('room-hud').classList.remove('hidden');
  document.getElementById('game-canvas').focus();
  startLoop();
}

function wireUI(canvas) {
  // Login
  document.getElementById('btn-guest').addEventListener('click', async () => {
    const btn = document.getElementById('btn-guest');
    const err = document.getElementById('login-error');
    const st = document.getElementById('login-status');
    if (btn) btn.disabled = true;
    if (err) err.textContent = '';
    if (st) st.textContent = 'Masuk sebagai guest…';
    try {
      const name = document.getElementById('profile-name').value.trim() || profile.displayName;
      profile.displayName = name.slice(0, 16);
      profile.provider = 'guest';
      ensureUid(profile);
      localStorage.setItem('longway_uid', profile.uid);
      saveProfile(profile);
      try {
        initFirebase();
        const auth = getAuth();
        await Promise.race([
          signInAnonymously(auth),
          new Promise((_, rej) => setTimeout(() => rej(new Error('auth-timeout')), 2500)),
        ]);
        // IMPORTANT: the Firebase security rules gate writes to
        // /rooms/{code}/players/{uid} on `auth.uid === $uid`. That only
        // works if the id we use as $uid is the *real* Firebase Auth uid —
        // not a separate random id we made up ourselves. Re-align them here
        // so multiplayer writes don't silently fail as permission-denied.
        if (auth.currentUser) {
          profile.uid = auth.currentUser.uid;
          localStorage.setItem('longway_uid', profile.uid);
          saveProfile(profile);
        }
      } catch (e) {
        console.warn('Anonymous auth skipped:', e.message || e);
      }
      await tryLandscapeLock();
      enterMenu();
    } catch (e) {
      console.error(e);
      if (err) err.textContent = e.message || 'Gagal masuk';
      if (btn) btn.disabled = false;
      if (st) st.textContent = '';
    }
  });

  document.getElementById('btn-google').addEventListener('click', async () => {
    const err = document.getElementById('login-error');
    const st = document.getElementById('login-status');
    const btn = document.getElementById('btn-google');
    if (err) err.textContent = '';
    if (st) st.textContent = 'Mengalihkan ke Google…';
    if (btn) btn.disabled = true;
    try {
      initFirebase();
      const auth = getAuth();
      const provider = new GoogleAuthProvider();
      await signInWithRedirect(auth, provider);
    } catch (e) {
      console.error(e);
      let msg = e.message || 'Google gagal';
      const code = String(e.code || '');
      if (code.includes('operation-not-allowed')) {
        msg = 'Google Auth belum aktif di Firebase Console. Pakai Guest.';
      } else if (code.includes('unauthorized-domain')) {
        msg = 'Domain belum di-authorize di Firebase. Pakai Guest.';
      }
      if (err) err.textContent = msg;
      if (st) st.textContent = '';
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('btn-profile').addEventListener('click', () => {
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
  });

  document.getElementById('btn-start').addEventListener('click', async () => {
    mode = 'solo';
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('loading-screen').classList.remove('hidden');
    setupLocalGame(false);
    await audio.resume();
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    canvas.focus();
    startLoop();
  });

  document.getElementById('btn-continue').addEventListener('click', async () => {
    if (!GameState.hasSave()) return;
    mode = 'solo';
    document.getElementById('menu-screen').classList.add('hidden');
    setupLocalGame(true);
    await audio.resume();
    document.getElementById('hud').classList.remove('hidden');
    canvas.focus();
    startLoop();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('settings-screen').classList.remove('hidden');
  });
  document.getElementById('btn-settings-back').addEventListener('click', () => {
    document.getElementById('settings-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
  });

  document.getElementById('btn-multi').addEventListener('click', () => {
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('multi-screen').classList.remove('hidden');
  });
  document.getElementById('btn-multi-back').addEventListener('click', () => {
    document.getElementById('multi-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
  });

  document.getElementById('btn-host').addEventListener('click', async () => {
    try {
      const code = genRoomCode();
      room = new MultiplayerRoom(code, true);
      // use profile name in join
      await room.create();
      // patch name after join
      await room.writePlayer({
        position: { x: 0, y: 1.7, z: 8 },
        rotation: { yaw: 0 },
        alive: true,
        health: 100,
      });
      // force name in firebase
      const { ref, update } = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js');
      const { getDb } = await import('./net/firebase.js');
      await update(ref(getDb(), `rooms/${code}/players/${room.uid}`), {
        name: profile.displayName,
      });
      enterLobby();
    } catch (e) {
      alert('Failed to create room: ' + (e.message || e));
    }
  });

  document.getElementById('btn-join').addEventListener('click', async () => {
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!code) return alert('Enter room code');
    try {
      room = new MultiplayerRoom(code, false);
      await room.join();
      const { ref, update } = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js');
      const { getDb } = await import('./net/firebase.js');
      await update(ref(getDb(), `rooms/${code}/players/${room.uid}`), {
        name: profile.displayName,
      });
      enterLobby();
    } catch (e) {
      alert(e.message || 'Join failed');
    }
  });

  document.getElementById('btn-copy-code').addEventListener('click', async () => {
    const code = document.getElementById('lobby-code').textContent;
    try {
      await navigator.clipboard.writeText(code);
      document.getElementById('btn-copy-code').textContent = 'Copied!';
      setTimeout(() => { document.getElementById('btn-copy-code').textContent = 'Copy code'; }, 1500);
    } catch (e) {
      prompt('Copy code:', code);
    }
  });

  document.getElementById('btn-start-multi').addEventListener('click', async () => {
    if (!room || !room.isHost) return;
    try {
      await room.setStarted(true);
      await beginMultiGame();
    } catch (e) {
      alert('Failed to start: ' + (e.message || e));
    }
  });

  document.getElementById('btn-lobby-leave').addEventListener('click', () => {
    if (room) { room.dispose(); room = null; }
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('multi-screen').classList.remove('hidden');
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    document.getElementById('gameover-screen').classList.add('hidden');
    running = false;
    hideTouch();
    mode = 'solo';
    setupLocalGame(false);
    document.getElementById('hud').classList.remove('hidden');
    startLoop();
  });
  document.getElementById('btn-menu').addEventListener('click', () => {
    running = false;
    hideTouch();
    if (room) { room.dispose(); room = null; }
    document.getElementById('gameover-screen').classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
    refreshContinueBtn();
  });

  document.getElementById('vol-master').addEventListener('input', (e) => {
    audio.setMasterVolume(Number(e.target.value));
  });
  document.getElementById('vol-sfx').addEventListener('input', (e) => {
    audio.setSfxVolume(Number(e.target.value));
  });
}

function showGameOver(win) {
  running = false;
  hideTouch();
  document.exitPointerLock?.();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('gameover-screen').classList.remove('hidden');
  document.getElementById('go-title').textContent = win ? 'YOU ESCAPED' : 'YOU DIED';
  document.getElementById('go-sub').textContent = win
    ? (state?.data?.progress?.timeUp ? 'Bertahan 3 menit — kamu selamat.' : 'Survived the forest.')
    : 'The forest claimed another soul.';
  if (mode === 'solo') {
    state.saveLocal();
    refreshContinueBtn();
  }
}



function updateProximityUI(dist) {
  const el = document.getElementById('danger-overlay');
  const bpmEl = document.getElementById('heart-bpm');
  const icon = document.getElementById('heart-icon');
  const distEl = document.getElementById('monster-dist');
  const { bpm, danger, near } = heartFromDistance(dist);
  lastNearDist = dist;

  if (distEl) {
    if (Number.isFinite(dist) && dist < 40) {
      distEl.textContent = dist < 2 ? 'VERY CLOSE' : dist.toFixed(1) + ' m';
      distEl.style.color = dist < 6 ? '#c44' : dist < 14 ? '#c9a227' : 'rgba(180,170,160,0.7)';
    } else {
      distEl.textContent = '';
    }
  }

  if (bpmEl) bpmEl.textContent = String(Math.round(bpm));

  if (el) {
    const op = danger;
    el.style.setProperty('--danger-op', String(0.25 + op * 0.75));
    el.style.opacity = String(op * 0.95);
    if (op > 0.55) el.classList.add('pulse');
    else el.classList.remove('pulse');
  }

  // schedule heartbeats by BPM
  return bpm;
}

function tickHeartbeat(dt, bpm, danger) {
  if (!audio || bpm < 60) return;
  const interval = 60 / bpm;
  heartAcc += dt;
  if (heartAcc >= interval) {
    heartAcc -= interval;
    const vol = 0.08 + danger * 0.35;
    audio.playHeartbeat(vol);
    const icon = document.getElementById('heart-icon');
    if (icon) {
      icon.classList.remove('beat');
      void icon.offsetWidth;
      icon.classList.add('beat');
    }
  }
}


function tickSanity(dt, nearestMonsterDistVal, isDark) {
  if (!state) return;
  const { tier, value } = sanity.update(state.data.player, dt, nearestMonsterDistVal, isDark);
  const fill = document.getElementById('sanity-fill');
  if (fill) fill.style.width = `${value}%`;
  const app = document.getElementById('app');
  if (app) {
    app.classList.toggle('sanity-shaken', tier === 'shaken');
    app.classList.toggle('sanity-low', tier === 'low');
    app.classList.toggle('sanity-critical', tier === 'critical');
  }
  if (audio) audio.setSanityFilter(tier === 'stable' ? 0 : tier === 'shaken' ? 0.15 : tier === 'low' ? 0.4 : 0.75);
  if (audio && sanity.tickWhisper(dt, tier)) {
    audio.playWhisper(tier === 'critical' ? 0.6 : 0.3);
    const wl = document.getElementById('whisper-caption');
    if (wl) {
      wl.classList.remove('hidden');
      wl.classList.add('flash-out');
      setTimeout(() => { wl.classList.add('hidden'); wl.classList.remove('flash-out'); }, 900);
    }
  }
}

function tickJumpscare(dt, nearestMonsterDistVal, nearestMonsterState) {
  const kind = jumpscare.update(dt, {
    nearestMonsterDist: nearestMonsterDistVal,
    nearestMonsterState,
    sanityTier: sanity.lastTier,
    playerAlive: state ? state.data.player.alive : false,
  });
  if (kind) showJumpscare(kind);
}

function showJumpscare(kind) {
  const overlay = document.getElementById('jumpscare-overlay');
  if (audio) audio.playJumpscareStinger();
  const app = document.getElementById('app');
  if (app) {
    app.classList.remove('screen-shake');
    void app.offsetWidth;
    app.classList.add('screen-shake');
  }
  if (!overlay) return;
  overlay.classList.remove('hidden', 'hallucination');
  if (kind === 'hallucination') overlay.classList.add('hallucination');
  void overlay.offsetWidth;
  overlay.classList.add('visible');
  clearTimeout(jumpscareHideTimer);
  jumpscareHideTimer = setTimeout(hideJumpscare, 420);
}

function hideJumpscare() {
  const overlay = document.getElementById('jumpscare-overlay');
  if (overlay) overlay.classList.remove('visible', 'hallucination');
  clearTimeout(jumpscareHideTimer);
}

function spawnVehicle(type) {
  if (!state || !player) return;
  const p = state.data.player.position;
  const yaw = state.data.player.rotation.yaw;
  const pos = {
    x: p.x - Math.sin(yaw) * 4,
    y: 0,
    z: p.z - Math.cos(yaw) * 4,
  };
  const v = new VehicleController(type, pos);
  if (!state.data.vehicles) state.data.vehicles = [];
  state.data.vehicles.push(v);
  vehicleControllers.push(v);
  if (renderer) renderer.syncVehicles(state.data.vehicles);
}

function tryVehicleInteract() {
  if (!state || !player) return;
  const p = state.data.player;
  const myUid = room?.uid || deviceUid();
  // Dismount
  if (p.ridingVehicleId && player.keys.has('KeyE')) {
    if (player._eLatch) return;
    player._eLatch = true;
    const v = state.getVehicle(p.ridingVehicleId);
    if (v) {
      const spot = findDismountSpot(v, colliders);
      p.position.x = spot.x;
      p.position.z = spot.z;
      p.position.y = 1.7;
      v.dismount(myUid);
    }
    p.ridingVehicleId = null;
    p.ridingRole = null;
    return;
  }
  if (!player.keys.has('KeyE')) player._eLatch = false;
  if (p.ridingVehicleId) return;
  if (!player.keys.has('KeyE') || player._eLatch) return;
  for (const v of state.data.vehicles || []) {
    const d = Math.hypot(v.position.x - p.position.x, v.position.z - p.position.z);
    if (d < 2.2) {
      player._eLatch = true;
      const role = v.mount(myUid, !v.driverUid);
      if (role) {
        p.ridingVehicleId = v.id;
        p.ridingRole = role;
      }
      break;
    }
  }
}

function startLoop() {
  if (running) return;
  running = true;
  tryLandscapeLock();
  function frame() {
    if (!running) return;
    const dt = Math.min(0.05, clock.tick()); // clamp: avoid spiral on lag spikes
    const now = performance.now() / 1000;
    const isAuthority = mode === 'solo' || (room && room.isHost);

    player.update(dt);
    tryVehicleInteract();

    // Vehicle physics (local driver or host)
    const myUid = room?.uid || deviceUid();
    for (const v of vehicleControllers) {
      if (v.driverUid === myUid) {
        v.driveUpdate(dt, player.keys, colliders, state, audio, myUid);
        v.checkMonsterHits(state.data.monsters, now, (dmg) => {
          const pl = state.data.player;
          if (pl.isDowned) {
            pl.alive = false;
            state.data.progress.gameOver = true;
          } else {
            pl.health = Math.max(0, pl.health - dmg);
            if (pl.health <= 0) {
              pl.isDowned = true;
              pl.downedTimer = 45;
            }
          }
        });
      }
    }
    // Sync vehicle data objects with controllers
    state.data.vehicles = vehicleControllers;
    if (renderer) renderer.syncVehicles(vehicleControllers);

    // Remote vehicles (non-host)
    if (room && !room.isHost && room.remoteVehicles) {
      const list = [];
      for (const [id, rv] of Object.entries(room.remoteVehicles)) {
        let v = vehicleControllers.find((x) => x.id === id);
        if (!v) {
          v = new VehicleController(rv.type || 'motor', { x: rv.x, y: rv.y, z: rv.z }, id);
          vehicleControllers.push(v);
        }
        v.position.x = rv.x; v.position.y = rv.y || 0; v.position.z = rv.z;
        v.rotation.yaw = rv.yaw || 0;
        v.driverUid = rv.driver;
        v.passengerUids = rv.passengers || [];
        v.speed = rv.speed || 0;
        list.push(v);
      }
      if (renderer) renderer.syncVehicles(vehicleControllers);
    }

    if (isAuthority) {
      for (const m of monsters) {
        m._pacingOk = pacing.canTriggerEvent(now);
        m._onGhostEvent = () => {
          if (pacing.canTriggerEvent(now)) {
            pacing.onEventFired(now, 50, 110);
            if (dread) dread.trigger('distant-knock');
          }
        };
        m.update(dt, now);
      }
    } else if (room) {
      const rm = room.remoteMonsters;
      state.data.monsters.forEach((m, i) => {
        const id = m.id || `m${i}`;
        const r = rm[id];
        if (!r) return;
        m.position.x = r.x; m.position.y = r.y; m.position.z = r.z;
        m.rotation.yaw = r.yaw;
        m.aiState = r.aiState;
        m.memory.suspicion = r.suspicion || 0;
        m.attackCooldown = r.attackCooldown || 0;
      });

      // Apply host-written health to local player (non-host clients)
      if (room && !room.isHost && room.remotePlayers[room.uid]) {
        const me = room.remotePlayers[room.uid];
        if (typeof me.health === 'number') {
          state.data.player.health = me.health;
          state.data.player.alive = me.alive !== false;
          if (!state.data.player.alive) {
            state.data.progress.gameOver = true;
            state.data.progress.win = false;
          }
        }
      }

      if (room.gameStatus.gameOver) {
        state.data.progress.gameOver = true;
        state.data.progress.win = !!room.gameStatus.win;
      }
    }

    state.data.world.activeSoundEvents = state.data.world.activeSoundEvents.filter(
      (e) => now - e.timestamp < 3
    );
    state.data.progress.playTime = clock.elapsed;

    if (mode === 'solo' && !state.data.progress.gameOver && state.data.player.alive && clock.elapsed >= ESCAPE_TIME) {
      state.data.progress.gameOver = true;
      state.data.progress.win = true;
    }

    if (state.data.progress.gameOver) {
      showGameOver(state.data.progress.win);
      if (room && room.isHost) room.writeGame(state.data.progress, state.data.world.weather);
      return;
    }

    if (mode === 'solo' && Math.floor(clock.elapsed) % 20 === 0 && dt > 0 && Math.random() < dt) {
      state.saveLocal();
      refreshContinueBtn();
    }

    if (room) {
      netWriteAcc += dt;
      if (netWriteAcc >= 0.1) {
        netWriteAcc = 0;
        room.writePlayer(state.data.player);
        // ensure name on write
        if (room.remotePlayers[room.uid]) {
          /* name already set */
        }
        if (room.isHost) {
          room.writeMonsters(state.data.monsters);
          room.writeVehicles(vehicleControllers);
          room.writeGame(state.data.progress, state.data.world.weather);
        }
        const last = state.data.world.activeSoundEvents.at(-1);
        if (last && now - last.timestamp < 0.15) room.writeSound(last);
      }
      if (room.isHost) {
        for (const s of room.remoteSounds) {
          if (!s || performance.now() - (s.t || 0) > 2000) continue;
          state.data.world.activeSoundEvents.push({
            id: 'net_' + s.t,
            position: { x: s.x, y: s.y || 0, z: s.z },
            intensity: s.intensity || 0.4,
            radius: s.radius || 14,
            type: s.type || 'footstep',
            timestamp: now,
          });
        }
      }
      const active = new Set();
      for (const [uid, p] of Object.entries(room.remotePlayers)) {
        active.add(uid);
        renderer.syncRemotePlayer(uid, {
          ...p,
          name: p.name || profile.displayName,
        }, room.uid);
      }
      renderer.pruneRemotePlayers(active);
    }

    const ph = document.getElementById('pill-hide');
    const pb = document.getElementById('pill-breath');
    const pt = document.getElementById('pill-throw');
    if (ph) ph.classList.toggle('hidden', !state.data.player.isHiding);
    if (pb) pb.classList.toggle('hidden', !state.data.player.isHoldingBreath);
    if (pt) pt.textContent = '×' + (state.data.player.throwables ?? 0);
    const hp = document.getElementById('health-fill');
    if (hp) hp.style.width = `${state.data.player.health}%`;

    const eye = player.eyePosition;
    const yaw = state.data.player.rotation.yaw;
    audio.setListenerPosition(eye.x, eye.y, eye.z, -Math.sin(yaw), -Math.cos(yaw));
    // --- 3 min day cycle (afternoon → sunset → night) ---
    const limit = state.data.world.timeLimit || MATCH_SECONDS;
    state.data.world.elapsed = (state.data.world.elapsed || 0) + dt;
    const progress = Math.min(1, state.data.world.elapsed / limit);
    state.data.world.timeOfDay = 0.55 + progress * 0.4;
    const lights = lightingForProgress(progress);
    if (renderer.applyDayLighting) renderer.applyDayLighting(lights);
    const phase = phaseFromProgress(progress);
    const remain = Math.max(0, limit - state.data.world.elapsed);
    const mm = Math.floor(remain / 60);
    const ss = Math.floor(remain % 60);
    const timerEl = document.getElementById('match-timer');
    if (timerEl) {
      timerEl.textContent = mm + ':' + String(ss).padStart(2, '0');
      timerEl.classList.toggle('urgent', remain <= 30);
    }
    const phaseEl = document.getElementById('phase-label');
    if (phaseEl) {
      phaseEl.textContent =
        phase === 'afternoon' ? 'SORE' : phase === 'sunset' ? 'SENJA' : 'MALAM';
    }
    // Survive full 3 minutes = win
    if (remain <= 0 && !state.data.progress.gameOver && state.data.player.alive) {
      state.data.progress.gameOver = true;
      state.data.progress.win = true;
      state.data.progress.timeUp = true;
      state.data.progress.escaped = true;
    }
    // Keep max 1 monster
    
    
    // Dynamic weather (host authority in multi)
    if (mode === 'solo' || (room && room.isHost)) {
      const w = state.data.world;
      w.weatherTimer = (w.weatherTimer || 0) + dt;
      if (w.weatherTimer >= (w.weatherNextChange || 50)) {
        w.weatherTimer = 0;
        w.weatherNextChange = 40 + Math.random() * 35;
        w.weather = w.weather === 'rain' ? 'clear' : 'rain';
      }
    } else if (room && room.gameStatus && room.gameStatus.weather) {
      state.data.world.weather = room.gameStatus.weather;
    }
    const raining = state.data.world.weather === 'rain';
    if (raining !== state._lastRaining) {
      state._lastRaining = raining;
      if (renderer.setRain) renderer.setRain(raining);
      if (audio.setRain) audio.setRain(raining);
      const wx = document.getElementById('weather-label');
      if (wx) wx.textContent = raining ? 'HUJAN' : '';
      // force lighting refresh on weather flip
      if (renderer._lastLightKey != null) renderer._lastLightKey = -1;
    }

    // Revive hold E
    if (room && !state.data.player.isDowned) {
      let nearDowned = null;
      for (const [uid, rp] of Object.entries(room.remotePlayers || {})) {
        if (uid === room.uid || !rp.isDowned) continue;
        const d = Math.hypot(rp.x - state.data.player.position.x, rp.z - state.data.player.position.z);
        if (d < 2.4) { nearDowned = uid; break; }
      }
      const bar = document.getElementById('revive-bar');
      if (nearDowned && (player.keys.has('KeyE') || player._reviveHold)) {
        player._reviveAcc = (player._reviveAcc || 0) + dt;
        if (bar) {
          bar.classList.remove('hidden');
          bar.textContent = 'Revive ' + Math.min(100, Math.floor((player._reviveAcc / 3) * 100)) + '%';
        }
        if (player._reviveAcc >= 3) {
          player._reviveAcc = 0;
          room.revivePlayer(nearDowned);
          // Host self-sync if somehow - N/A for other
        }
      } else {
        player._reviveAcc = 0;
        if (bar) bar.classList.add('hidden');
      }
    }
    // Host revived by peer: read own remote entry
    if (room && room.remotePlayers[room.uid]) {
      const me = room.remotePlayers[room.uid];
      if (state.data.player.isDowned && me.isDowned === false && (me.health || 0) > 0) {
        state.data.player.isDowned = false;
        state.data.player.health = me.health || 40;
        state.data.player.downedTimer = 0;
        state.data.player.alive = true;
      }
      if (typeof me.isDowned === 'boolean' && me.isDowned && !state.data.player.isDowned && room.uid) {
        // remote damage applied to us
        if ((me.health || 0) === 0 || me.isDowned) {
          state.data.player.isDowned = true;
          state.data.player.health = 0;
          state.data.player.downedTimer = me.downedTimer || 45;
        }
      }
    }

    const { dist: mDist, monster: nearestMon } = nearestMonsterDist(state.data.player.position, state.data.monsters);
    const { bpm, danger } = heartFromDistance(mDist);
    updateProximityUI(mDist);
    tickHeartbeat(dt, bpm, danger);
    const inside = isInsideBuilding(state.data.player.position.x, state.data.player.position.z);
    const isDarkOutside = !inside && !state.data.player.flashlight && phase !== 'afternoon';
    tickSanity(dt, mDist, isDarkOutside);
    tickJumpscare(dt, mDist, nearestMon ? nearestMon.aiState : null);

    // Pacing-driven dread / world mutation
    if (pacing.canTriggerEvent(now) && state.data.world.elapsed > 25) {
      if (Math.random() < 0.0008) {
        pacing.onEventFired(now, 60, 120);
        dread?.trigger(Math.random() < 0.5 ? 'distant-knock' : 'branch-snap');
      }
      if (state.data.world.elapsed > 90 && (state.data.world.worldEvents?.familyPhoto?.stage || 0) === 0 && Math.random() < 0.0004) {
        pacing.onEventFired(now, 80, 140);
        state.triggerWorldEvent('familyPhoto', 1);
      }
    }
    // Billboard from multiplayer
    if (room?.remoteBillboard && renderer) {
      renderer.applyBillboardMedia(room.remoteBillboard, audio);
    }
    const loc = document.getElementById('location-hint');
    if (loc) {
      if (inside) {
        loc.textContent = inside.type === 'building' ? 'Gedung' : 'Rumah';
        loc.classList.remove('hidden');
      } else loc.classList.add('hidden');
    }
    renderer.render(state.data, eye, yaw, state.data.player.rotation.pitch, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

init().catch((err) => {
  console.error(err);
  const el = document.getElementById('login-error') || document.getElementById('login-screen');
  if (el) {
    const p = document.createElement('p');
    p.style.color = '#c44';
    p.textContent = 'Error: ' + (err.message || err);
    (document.getElementById('login-screen') || el).appendChild(p);
  }
});
