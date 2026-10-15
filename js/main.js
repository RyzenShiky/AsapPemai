import { GameState } from './core/GameState.js';
import { Clock } from './core/Clock.js';
import { buildColliders, buildSpatialGrid } from './core/Collision.js';
import { isTouchDevice, inputMode, watchInput, setInputPref } from './core/Device.js';
import { onOrientationChange, updateRotateHint, tryLandscapeLock, installLandscapeAutoLock, cycleScreenRotation, autoSyncFromDevice } from './core/Orientation.js';
import { loadProfile, saveProfile, ensureUid } from './core/Profile.js';
import { PlayerController } from './gameplay/Player.js';
import { MonsterController } from './gameplay/Monster.js';
import { nearestMonsterDist, heartFromDistance } from './gameplay/Proximity.js';
import { DAY_SECONDS, MATCH_SECONDS, phaseFromProgress, lightingForProgress, randomMonsterSpawn } from './core/DayCycle.js';
import { isInsideBuilding } from './core/Buildings.js';
import { SanityManager } from './gameplay/Sanity.js';
import { HallucinationDirector } from './gameplay/HallucinationDirector.js';
import { JumpscareManager } from './gameplay/Jumpscare.js';
import { PacingDirector } from './core/PacingDirector.js';
import { WorldDirector } from './core/WorldDirector.js';
import { WeatherController } from './core/Weather.js';
import { updateSchedule } from './core/MonsterSchedule.js';
import { ROSTER, MAX_PLAYERS } from './core/MonsterTypes.js';
import { weatherMul, weatherSpeed, weatherVis } from './core/Weather.js';
import { DreadSequencer } from './audio/DreadSequencer.js';
import { installSecretCodes } from './input/SecretCode.js';
import { VehicleController, findDismountSpot } from './gameplay/Vehicle.js';
import { MultiplayerRoom, roomCode as genRoomCode, initFirebase, deviceUid, uploadBillboardMedia, ensureAuthUid } from './net/firebase.js';
import { AudioManager } from './audio/AudioManager.js';
import { Renderer } from './renderer/Renderer.js';
import { TouchControls } from './input/TouchControls.js';
import { binds, rebind, resetBinds } from './input/Bindings.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';

let renderer, player, monsters, audio, clock, state, colliders, touch;
let running = false;
let room = null;
let mode = 'solo';
let netWriteAcc = 0;
let profile = loadProfile();
const DAY_LEN = DAY_SECONDS;
let heartAcc = 0;
let lastNearDist = Infinity;
let sanity = new SanityManager();
let jumpscare = new JumpscareManager();
let pacing = new PacingDirector();
let dread = null;
let vehicleControllers = [];
let worldDirector = null;
let hallu = null;
let weatherCtrl = new WeatherController();
let hearingMask = 1;
const claimedPickups = new Map();
const appliedPickups = new Set();

function toast(msg, ms = 3500) {
  const el = document.getElementById('toast');
  if (!el) { console.warn(msg); return; }
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function givePickupItem(pk) {
  const p = state.data.player;
  const inv = state.data.inventory || { slots: 4, items: [] };
  if (pk.type === 'battery') p.battery = Math.min(100, (p.battery ?? 100) + 40);
  else {
    if (pk.type === 'medkit') p.medkits = (p.medkits || 0) + 1;
    if (inv.items.length < inv.slots) inv.items.push({ type: pk.type });
  }
}

let jumpscareHideTimer = null;
let autosaveAcc = 0;
let startingMulti = false;
let lastSentSoundId = null;
const netSeen = new Map();

async function init() {
  const canvas = document.getElementById('game-canvas');
  try { initFirebase(); } catch (e) { console.warn('Firebase', e); }

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
  const _rawCol = buildColliders();
  colliders = buildSpatialGrid(_rawCol);
  window.__wallsOnly = buildSpatialGrid(_rawCol.filter((c) => c.type === 'wall'));
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

async function setupLocalGame(fromSave = false) {
  if (renderer?.monstersReady) {
    try { await renderer.monstersReady; } catch (e) { console.warn(e); }
  }
  if (player) player.dispose();

  let loaded = null;
  if (fromSave) {
    loaded = GameState.loadLocal();
    if (loaded && (loaded.data.progress.gameOver || loaded.data.player.alive === false)) loaded = null;
  }
  const resumed = !!loaded;
  if (!resumed && mode === 'solo') GameState.clearSave();
  state = loaded || new GameState();

  autosaveAcc = 0;
  lastSentSoundId = null;
  netSeen.clear();

  player = new PlayerController(
    document.getElementById('game-canvas'),
    state,
    colliders,
    audio
  );

  const MONSTER_COUNT = ROSTER.length;
  while (state.data.monsters.length < MONSTER_COUNT) {
    const i = state.data.monsters.length;
    state.data.monsters.push({
      id: 'm' + i,
      position: { x: 0, y: 0, z: 0 },
      rotation: { yaw: 0 },
      aiState: 'PATROL',
      active: false,
      memory: { lastHeardPosition: null, lastHeardTime: 0, lastHeardIntensity: 0, confidence: 0, suspicion: 0, searchRadius: 14, canSeePlayer: false, lastSeenPosition: null, lastSeenTime: 0, routeRepeats: 0 },
      path: [],
    });
  }
  if (!resumed) {
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
  } else {
    for (const mon of state.data.monsters) {
      mon.stunnedUntil = 0;
      mon.memory._ghostInvestigate = false;
      mon.memory._nextGhostCheck = 0;
    }
  }

  state.data.world.activeSoundEvents = [];
  state.data.progress.timeUp = false;
  if (!resumed) {
    const modeEl = document.getElementById('game-mode');
    const dayEl = document.getElementById('day-limit');
    state.data.world.gameMode = modeEl?.value === 'days' ? 'days' : 'endless';
    state.data.world.dayLimit = Math.max(1, parseInt(dayEl?.value || '3', 10) || 3);
    state.data.world.daysSurvived = 0;
    state.data.world.daySeconds = DAY_LEN;
    state.data.progress.daysReached = 0;
  }
  claimedPickups.clear();
  appliedPickups.clear();
  sanity = new SanityManager();
  jumpscare = new JumpscareManager();
  pacing = new PacingDirector();
  worldDirector = null;
  hallu = null;
  weatherCtrl = new WeatherController();
  hearingMask = 1;
  vehicleControllers = [];
  state.data.vehicles = [];
  hideJumpscare();

  player.onThrow = (from, to) => {
    if (renderer && renderer.spawnThrowable) renderer.spawnThrowable(from, to);
  };
  monsters = state.data.monsters.map(
    (_, i) => new MonsterController(state, i, colliders, mode === 'multi' ? room : null, window.__wallsOnly || null)
  );

  // Always create TouchControls; show/hide based on adaptive input mode
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

  const applyInputMode = (m) => {
    if (m === 'touch') {
      touch?.show();
    } else {
      touch?.hide();
      document.exitPointerLock?.();
    }
  };
  watchInput(applyInputMode);
  applyInputMode(inputMode());
  if (room?.isHost && state?.data?.pickups) room.writePickups(state.data.pickups);
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
}

function enterLobby() {
  document.getElementById('lobby-code').textContent = room.code;
  document.getElementById('multi-screen').classList.add('hidden');
  document.getElementById('lobby-screen').classList.remove('hidden');
  renderLobbyPlayers();
  room.onUpdate = () => {
    renderLobbyPlayers();
    if (room.meta?.started && !room.isHost) beginMultiGame();
  };
}

async function beginMultiGame() {
  if (running || startingMulti || !room) return;
  startingMulti = true;
  room.onUpdate = null;
  try {
    mode = 'multi';
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('loading-screen').classList.remove('hidden');
    await setupLocalGame(false);
    await audio.resume();
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('room-hud').textContent =
      `Room ${room.code}${room.isHost ? ' (HOST)' : ''}`;
    document.getElementById('room-hud').classList.remove('hidden');
    document.getElementById('game-canvas').focus();
    startLoop();
  } finally {
    startingMulti = false;
  }
}

async function leaveRoom() {
  if (!room) return;
  const r = room;
  room = null;
  try { await r.leave(); } catch (e) { console.warn('leave room', e); }
  renderer?.pruneRemotePlayers(new Set());
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
      let online = true;
      try {
        profile.uid = await ensureAuthUid(12000);
        localStorage.setItem('longway_uid', profile.uid);
        saveProfile(profile);
      } catch (e) {
        online = false;
        console.warn('auth', e);
        toast('Mode offline — multiplayer dinonaktifkan');
      }
      const multiBtn = document.getElementById('btn-multi');
      if (multiBtn) multiBtn.disabled = !online;
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
    if (st) st.textContent = 'Login Google…';
    if (btn) btn.disabled = true;
    try {
      initFirebase();
      const auth = getAuth();
      const provider = new GoogleAuthProvider();
      const { user } = await signInWithPopup(auth, provider);
      profile.displayName = (user.displayName || 'Player').slice(0, 16);
      profile.uid = user.uid;
      profile.provider = 'google';
      localStorage.setItem('longway_uid', profile.uid);
      saveProfile(profile);
      const multiBtn = document.getElementById('btn-multi');
      if (multiBtn) multiBtn.disabled = false;
      await tryLandscapeLock();
      enterMenu();
    } catch (e) {
      console.error(e);
      let msg = e.message || 'Google gagal';
      const code = String(e.code || '');
      if (code.includes('operation-not-allowed')) msg = 'Google Auth belum aktif di Firebase Console. Pakai Guest.';
      else if (code.includes('unauthorized-domain')) msg = 'Domain belum di-authorize di Firebase. Pakai Guest.';
      else if (code.includes('popup-blocked')) msg = 'Popup diblokir browser. Izinkan popup lalu coba lagi.';
      if (err) err.textContent = msg;
      if (st) st.textContent = '';
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('btn-profile').addEventListener('click', () => {
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
  });

    const modeSelect = document.getElementById('game-mode');
  const dayWrap = document.getElementById('day-limit-wrap');
  const syncModeUI = () => {
    if (dayWrap) dayWrap.style.display = modeSelect?.value === 'days' ? '' : 'none';
  };
  modeSelect?.addEventListener('change', syncModeUI);
  syncModeUI();

  document.getElementById('btn-start').addEventListener('click', async () => {
    mode = 'solo';
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('loading-screen').classList.remove('hidden');
    await setupLocalGame(false);
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
    await setupLocalGame(true);
    await audio.resume();
    document.getElementById('hud').classList.remove('hidden');
    canvas.focus();
    startLoop();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('settings-screen').classList.remove('hidden');
    // refresh bind labels + input select
    const sel = document.getElementById('input-mode-select');
    if (sel) sel.value = localStorage.getItem('longway_input') || 'auto';
    document.querySelectorAll('#bind-list [data-action]').forEach((row) => {
      const a = row.dataset.action;
      const btn = row.querySelector('.btn-bind');
      if (btn) btn.textContent = binds[a] || '—';
    });
    const inv = document.getElementById('invert-y');
    if (inv) inv.checked = localStorage.getItem('longway_invertY') === '1';
  });
  document.getElementById('btn-settings-back').addEventListener('click', () => {
    document.getElementById('settings-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
  });

  // Input mode select
  document.getElementById('input-mode-select')?.addEventListener('change', (e) => {
    setInputPref(e.target.value);
    // apply immediately if touch controls exist
    if (typeof touch !== 'undefined' && touch) {
      if (inputMode() === 'touch') touch.show();
      else { touch.hide(); document.exitPointerLock?.(); }
    }
  });

  // Sensitivity
  document.getElementById('look-sens')?.addEventListener('input', (e) => {
    if (player) player.sensitivity = parseFloat(e.target.value);
  });

  // Invert Y
  document.getElementById('invert-y')?.addEventListener('change', (e) => {
    localStorage.setItem('longway_invertY', e.target.checked ? '1' : '0');
    if (player) player.invertY = e.target.checked;
  });

  // Rebind buttons
  document.querySelectorAll('#bind-list [data-action]').forEach((row) => {
    const a = row.dataset.action;
    const btn = row.querySelector('.btn-bind');
    if (!btn) return;
    btn.addEventListener('click', () => {
      btn.textContent = 'Tekan tombol…';
      rebind(a, (code) => {
        btn.textContent = code || binds[a];
        // refresh other labels in case of swap
        document.querySelectorAll('#bind-list [data-action]').forEach((r) => {
          const b = r.querySelector('.btn-bind');
          if (b && r.dataset.action !== a) b.textContent = binds[r.dataset.action];
        });
      });
    });
  });
  document.getElementById('btn-reset-binds')?.addEventListener('click', () => {
    resetBinds();
    document.querySelectorAll('#bind-list [data-action]').forEach((row) => {
      const btn = row.querySelector('.btn-bind');
      if (btn) btn.textContent = binds[row.dataset.action];
    });
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
      room = null;
      for (let i = 0; i < 3; i++) {
        try {
          room = new MultiplayerRoom(genRoomCode(), true);
          await room.create();
          break;
        } catch (e) {
          room = null;
          if (i === 2) throw e;
        }
      }
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
      await update(ref(getDb(), `rooms/${room.code}/players/${room.uid}`), {
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

  document.getElementById('btn-lobby-leave').addEventListener('click', async () => {
    await leaveRoom();
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('multi-screen').classList.remove('hidden');
  });

  document.getElementById('btn-restart').addEventListener('click', async () => {
    document.getElementById('gameover-screen').classList.add('hidden');
    running = false;
    hideTouch();
    await leaveRoom();
    mode = 'solo';
    await setupLocalGame(false);
    await audio.resume();
    document.getElementById('room-hud').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('game-canvas').focus();
    startLoop();
  });
  document.getElementById('btn-menu').addEventListener('click', async () => {
    running = false;
    hideTouch();
    await leaveRoom();
    document.getElementById('gameover-screen').classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('room-hud').classList.add('hidden');
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
  audio?.setRain?.(false);
  audio?.setSanityFilter?.(0);
  if (state) state._lastRaining = false;
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('gameover-screen').classList.remove('hidden');
  document.getElementById('go-title').textContent = win ? 'YOU ESCAPED' : 'YOU DIED';
  const days = state?.data?.world?.daysSurvived || state?.data?.progress?.daysReached || 0;
  document.getElementById('go-sub').textContent = win
    ? (state?.data?.progress?.timeUp
        ? `Bertahan ${days} hari — kamu selamat.`
        : `Survived the forest (${days} hari).`)
    : `The forest claimed another soul. (${days} hari)`;
  if (mode === 'solo') {
    GameState.clearSave();
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
  if (p.ridingVehicleId && player.keys.has(binds.interact)) {
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
  if (!player.keys.has(binds.interact)) player._eLatch = false;
  if (p.ridingVehicleId) return;
  if (!player.keys.has(binds.interact) || player._eLatch) return;
  for (const v of state.data.vehicles || []) {
    const d = Math.hypot(v.position.x - p.position.x, v.position.z - p.position.z);
    if (d < 2.2) {
      player._eLatch = true;
      const role = v.mount(myUid, !v.driverUid);
      if (role) {
        p.ridingVehicleId = v.id;
        p.ridingRole = role;
        p.rotation.yaw = v.rotation.yaw; // face vehicle forward
      }
      break;
    }
  }
}

function startLoop() {
  if (running) return;
  running = true;
  tryLandscapeLock();
  function step() {
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
    if (room && room.remoteVehicles) {
      const list = [];
      for (const [id, rv] of Object.entries(room.remoteVehicles)) {
        if (rv.driver === myUid) continue;
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
        m.active = r.active !== false;
        if (r.type && ROSTER[i] && r.type !== ROSTER[i]) console.warn('Versi game berbeda, muat ulang halaman');
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
    state.data.progress.playTime = state.data.world.elapsed || 0;

    if (room?.isHost && !state.data.player.alive) {
      const others = Object.entries(room.remotePlayers).filter(([u]) => u !== room.uid);
      const allDead = others.length === 0 || others.every(([, p]) => p.alive === false);
      if (allDead) { state.data.progress.gameOver = true; state.data.progress.win = false; }
    }
    if (state.data.progress.gameOver) {
      showGameOver(state.data.progress.win);
      if (room && room.isHost) room.writeGame(state.data.progress, state.data.world.weather);
      return;
    }

    if (mode === 'solo') {
      autosaveAcc += dt;
      if (autosaveAcc >= 15) {
        autosaveAcc = 0;
        state.saveLocal();
        refreshContinueBtn();
      }
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
          for (const v of vehicleControllers) room.writeVehicle(v);
          room.writeGame(state.data.progress, state.data.world.weather);
        }
        let last = null;
        const evs = state.data.world.activeSoundEvents;
        for (let i = evs.length - 1; i >= 0; i--) {
          if (!evs[i].net) { last = evs[i]; break; }
        }
        if (last && last.id !== lastSentSoundId) {
          lastSentSoundId = last.id;
          room.writeSound(last);
        }
      }
      if (room.isHost) {
        const nowMs = performance.now();
        for (const s of room.remoteSounds) {
          if (!s || s.by === room.uid) continue;
          const id = `net_${s.by}_${s.t}`;
          if (netSeen.has(id)) continue;
          netSeen.set(id, nowMs);
          state.data.world.activeSoundEvents.push({
            id,
            net: true,
            position: { x: s.x, y: s.y || 0, z: s.z },
            intensity: s.intensity || 0.4,
            radius: s.radius || 14,
            type: s.type || 'footstep',
            timestamp: now,
          });
        }
        for (const [k, tt] of netSeen) if (nowMs - tt > 5000) netSeen.delete(k);
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
    // --- Day cycle (loops). Endless or win after N days. ---
    const daySec = state.data.world.daySeconds || DAY_LEN;
    const t0 = room?.gameStatus?.t0;
    state.data.world.elapsed = t0
      ? (room.serverNow() - t0) / 1000
      : (state.data.world.elapsed || 0) + dt;
    const totalDays = state.data.world.elapsed / daySec;
    const dayProgress = totalDays - Math.floor(totalDays);
    const dayIndex = Math.floor(totalDays);
    // Night-only monster schedule (host/solo)
    if (isAuthority) {
      const plist = [{ x: state.data.player.position.x, z: state.data.player.position.z, yaw: state.data.player.rotation.yaw }];
      if (room?.remotePlayers) {
        for (const [uid, rp] of Object.entries(room.remotePlayers)) {
          if (uid === room.uid || rp.alive === false) continue;
          plist.push({ x: rp.x, z: rp.z, yaw: rp.yaw || 0 });
        }
      }
      updateSchedule(state, plist, dayProgress, dayIndex);
    }
    // Street lamps (deterministic, no network)
    if (renderer?.updateLamps) {
      state._lampSites = renderer.lampSites;
      renderer.updateLamps(state.data.world.elapsed, dayProgress, state.data.player.position.x, state.data.player.position.z, dt);
    }
    state.data.world.daysSurvived = dayIndex;
    state.data.progress.daysReached = dayIndex;
    state.data.world.timeOfDay = dayProgress;
    const lights = lightingForProgress(dayProgress);
    if (renderer.applyDayLighting) renderer.applyDayLighting(lights);
    const phase = phaseFromProgress(dayProgress);
    const timerEl = document.getElementById('match-timer');
    if (timerEl) {
      const gMode = state.data.world.gameMode || 'endless';
      if (gMode === 'days') {
        const limit = state.data.world.dayLimit || 3;
        const left = Math.max(0, limit - dayIndex);
        timerEl.textContent = `Hari ${dayIndex + 1}/${limit}`;
        timerEl.classList.toggle('urgent', left <= 1 && dayProgress > 0.7);
      } else {
        timerEl.textContent = `Hari ${dayIndex + 1}`;
        timerEl.classList.remove('urgent');
      }
    }
    const phaseEl = document.getElementById('phase-label');
    if (phaseEl) {
      phaseEl.textContent =
        phase === 'afternoon' ? 'SORE' : phase === 'sunset' ? 'SENJA' : 'MALAM';
    }
    // Win only in "days" mode after surviving dayLimit full cycles
    if (
      (state.data.world.gameMode || 'endless') === 'days' &&
      dayIndex >= (state.data.world.dayLimit || 3) &&
      !state.data.progress.gameOver &&
      state.data.player.alive
    ) {
      state.data.progress.gameOver = true;
      state.data.progress.win = true;
      state.data.progress.timeUp = true;
      state.data.progress.escaped = true;
    }
    // Keep max 1 monster
    
    
    // Dynamic weather (host authority in multi) — clear/rain/fog/storm + lightning
    if (mode === 'solo' || (room && room.isHost)) {
      const wr = weatherCtrl.update(dt, now, state.data.world, renderer, audio);
      hearingMask = wr.hearingMask;
      state._hearingMask = hearingMask;
    } else if (room && room.gameStatus && room.gameStatus.weather) {
      state.data.world.weather = room.gameStatus.weather;
      const wr = weatherCtrl.update(0, now, state.data.world, renderer, audio);
      hearingMask = wr.hearingMask;
      state._hearingMask = hearingMask;
    }

    // Player speed modifier from weather
    const spdMul = weatherSpeed(state.data.world.weather);
    if (spdMul !== 1 && state.data.player && !state.data.player.isHiding) {
      // applied implicitly via reduced effective movement if needed — stash
      state.data.player._weatherSpeed = spdMul;
    }

    // World atmosphere director (unseen props only)
    if (!worldDirector && renderer?.scene) {
      worldDirector = new WorldDirector(pacing, renderer.scene);
    }
    if (worldDirector && renderer?.camera) {
      worldDirector.update(dt, now, renderer.camera, state.data.player.sanity ?? 100);
    }

    // Hallucinations (audio/visual only — never real AI stimuli)
    if (!hallu && audio && renderer) {
      hallu = new HallucinationDirector(audio, renderer);
    }
    if (hallu) {
      hallu.update(dt, sanity.lastTier, state.data.player, renderer?.camera);
    }


    // --- Pickups (solo local / multi host-authoritative) ---
    (function tickPickups() {
      const pickups = state.data.pickups || {};
      const pp = state.data.player.position;
      const near = (pk, x, z, r) => Math.hypot(pk.x - x, pk.z - z) < r;
      if (mode === 'solo' || room?.isHost) {
        let dirty = false;
        for (const pk of Object.values(pickups)) {
          if (pk.taken || !near(pk, pp.x, pp.z, 1.8)) continue;
          pk.taken = true;
          pk.takenBy = room?.uid || 'local';
          givePickupItem(pk);
          dirty = true;
        }
        if (room?.isHost) {
          for (const [uid, c] of Object.entries(room.remoteClaims || {})) {
            const pk = pickups[c.pickupId];
            const rp = room.remotePlayers[uid];
            if (!pk || pk.taken || !rp || !near(pk, rp.x, rp.z, 3)) continue;
            pk.taken = true;
            pk.takenBy = uid;
            dirty = true;
          }
          if (dirty) room.writePickups(pickups);
        }
      } else if (room) {
        const t = performance.now();
        for (const [id, pk] of Object.entries(room.remotePickups || {})) {
          if (!pk.taken && near(pk, pp.x, pp.z, 1.8) && t - (claimedPickups.get(id) || 0) > 2000) {
            claimedPickups.set(id, t);
            room.claimPickup(id);
          }
          if (pk.taken && pk.takenBy === room.uid && !appliedPickups.has(id)) {
            appliedPickups.add(id);
            givePickupItem(pk);
          }
          if (state.data.pickups[id]) state.data.pickups[id].taken = !!pk.taken;
        }
      }
    })();

    // Sanity filter strength
    if (audio?.setSanityFilter) {
      const s = state.data.player.sanity ?? 100;
      audio.setSanityFilter(Math.pow(1 - s / 100, 2));
    }

    // Duck ambience shortly before monster enters 25 m
    if (audio?.duckAmbience && monsters?.length) {
      let near = Infinity;
      for (const m of state.data.monsters) {
        if (!m.active && m.active !== undefined) continue;
        const d = Math.hypot(
          m.position.x - state.data.player.position.x,
          m.position.z - state.data.player.position.z
        );
        if (d < near) near = d;
      }
      if (near < 28 && near > 22 && !state._duckedNear) {
        state._duckedNear = true;
        audio.duckAmbience(4);
      }
      if (near > 35) state._duckedNear = false;
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
      if (nearDowned && (player.keys.has(binds.interact) || player._reviveHold)) {
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
  }

  function frame() {
    if (!running) return;
    try {
      step();
    } catch (e) {
      console.error('frame error', e);
    }
    if (running) requestAnimationFrame(frame);
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
