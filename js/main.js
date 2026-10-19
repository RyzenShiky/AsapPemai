import { BUILDING_DEFS, DOORS, setDoor, camsFor } from './core/Buildings.js';
import { GameState } from './core/GameState.js';
import { Clock } from './core/Clock.js';
import { buildColliders, buildSpatialGrid } from './core/Collision.js';
import { isTouchDevice, inputMode, watchInput, setInputPref } from './core/Device.js';
import { onOrientationChange, updateRotateHint, tryLandscapeLock, installLandscapeAutoLock, cycleScreenRotation, autoSyncFromDevice } from './core/Orientation.js';
import { loadProfile, saveProfile, ensureUid } from './core/Profile.js';
import { PlayerController } from './gameplay/Player.js';
import { MonsterController } from './gameplay/Monster.js';
import { nearestMonsterDist, heartFromDistance } from './gameplay/Proximity.js';
import { LANDMARKS } from './core/WorldConfig.js';
import { DAY_SECONDS, MATCH_SECONDS, phaseFromProgress, lightingForProgress, randomMonsterSpawn } from './core/DayCycle.js';
import { ITEMS, RECIPES, SHOP, MAX_SLOTS, MAX_WEIGHT, canCraft, canCarry, invWeight, rollLoot, sellPrice, addItem, removeItems, countOf, NO_SELL } from './gameplay/Items.js';
import { Mission, Tutorial, Subtitles, MISSIONS, validateAnchors } from './gameplay/Mission.js';
import { PickOne } from './gameplay/PickOne.js';
import { isInsideBuilding } from './core/Buildings.js';
import { SanityManager } from './gameplay/Sanity.js';
import { HallucinationDirector } from './gameplay/HallucinationDirector.js';
import { JumpscareManager } from './gameplay/Jumpscare.js';
import { PacingDirector } from './core/PacingDirector.js';
import { WorldDirector } from './core/WorldDirector.js';
import { WeatherController } from './core/Weather.js';
import { updateSchedule } from './core/MonsterSchedule.js';
import { ROSTER, MAX_PLAYERS, applyBackroomsMonsters } from './core/MonsterTypes.js';
import { LevelManager, LEVELS } from './core/Level.js';
import { weatherMul, weatherSpeed, weatherVis } from './core/Weather.js';
import { DreadSequencer } from './audio/DreadSequencer.js';
import { installSecretCodes } from './input/SecretCode.js';
import { VehicleController, findDismountSpot } from './gameplay/Vehicle.js';
import { MultiplayerRoom, roomCode as genRoomCode, initFirebase, deviceUid, uploadBillboardMedia, ensureAuthUid } from './net/firebase.js';
import { AudioManager } from './audio/AudioManager.js';
import { Renderer } from './renderer/Renderer.js';
import { TouchControls } from './input/TouchControls.js';
import { openLayoutEditor } from './input/UILayout.js';
import { binds, rebind, resetBinds, keyLabel } from './input/Bindings.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';

let renderer, player, monsters, audio, clock, state, colliders, touch;
let running = false;
let room = null;
let mission = null, tutorial = null, subs = null, pickOne = null;
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
let level = null;
let deadShown = false;
const claimedPickups = new Map();
const appliedPickups = new Set();
let bag = null;
let pkSyncAcc = 1;

function toast(msg, ms = 3500) {
  const el = document.getElementById('toast');
  if (!el) { console.warn(msg); return; }
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

async function imageToDataUrl(file, max = 768) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.8, url = c.toDataURL('image/jpeg', q);
  while (url.length > 180000 && q > 0.3) url = c.toDataURL('image/jpeg', (q -= 0.1));
  return url;
}

function givePickupItem(pk, id = '') {
  const p = state.data.player;
  const inv = (state.data.inventory ??= { slots: MAX_SLOTS, items: [] });
  if (pk.kind === 'container') {
    const loot = rollLoot(pk.table || 'house', Math.round((pk.x || 0) * 7 + (pk.z || 0) * 13));
    let lost = 0;
    for (const ty of loot) if (!addItem(p, inv, ty)) lost++;
    if (typeof toast === 'function') toast(`Peti: ${loot.join(', ')}${lost ? ` (${lost} tertinggal)` : ''}`);
    return;
  }
  if (pk.kind === 'board') {
    if (!addItem(p, inv, 'parcel')) { toast?.('Tas penuh'); return; }
    toast?.('Paket diterima — antar ke dropoff');
    return;
  }
  if (pk.kind === 'dropoff') {
    if (removeItems(p, inv, 'parcel', 1)) {
      p.money = (p.money || 0) + 40;
      p.rep = (p.rep || 0) + 1;
      toast?.('Paket diterima: +$40');
    }
    return;
  }
  if (pk.kind === 'generator') {
    if (removeItems(p, inv, 'fuel', 1)) toast?.('Generator menyala');
    else toast?.('Butuh fuel');
    return;
  }
  if (pk.type === 'battery') {
    p.battery = Math.min(100, (p.battery ?? 100) + 40);
    return;
  }
  if (pk.type && !addItem(p, inv, pk.type)) toast?.('Tas penuh — item hilang');
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
      saveProfile(profile);
    });
  });

  audio = new AudioManager();
  await audio.init();
  dread = new DreadSequencer(audio);
  const _rawCol = buildColliders();
  colliders = buildSpatialGrid(_rawCol);
  window.__wallsOnly = buildSpatialGrid(_rawCol.filter((c) => c.type === 'wall'));
  if (LEVELS[new URLSearchParams(location.search).get('level')]) applyBackroomsMonsters();
  renderer = new Renderer();
  await renderer.init(canvas);
  const lv = new URLSearchParams(location.search).get('level');
  if (LEVELS[lv]) {
    level = new LevelManager(renderer, lv);
    colliders = level.spatial;
    window.__wallsOnly = level.spatial;
  }

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
    onMonster: () => {
      if (room && !room.isHost) return;
      if (state) state._forceMonsters = !state._forceMonsters;
    },
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
      const isVideo = file.type === 'video/mp4', isImage = file.type.startsWith('image/');
      if (!isVideo && !isImage) { if (st) st.textContent = 'Hanya gambar atau MP4'; return; }
      const type = isVideo ? 'video' : 'image';
      const url = isVideo
        ? (room ? await uploadBillboardMedia(file, code) : URL.createObjectURL(file))
        : await imageToDataUrl(file);
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
    if (sessionStorage.getItem('autoGuest')) {
      sessionStorage.removeItem('autoGuest');
      setTimeout(() => bg?.click(), 50);
    }
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
    tryLandscapeLock({ force: true });
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
  const pj = sessionStorage.getItem('pendingJoin');
  if (!pj) sessionStorage.removeItem('joinTried');
  if (pj) {
    sessionStorage.removeItem('pendingJoin');
    setTimeout(() => {
      document.getElementById('btn-multi')?.click();
      const jc = document.getElementById('join-code');
      if (jc) jc.value = pj;
      document.getElementById('btn-join')?.click();
    }, 200);
  }
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
  state._level = level || null;
  state._doorFx = (d, kind, dx, dz) => {
    if (kind === 'open') {
      setDoor(d, true);
      renderer?.setDoorOpen(d.id, true);
      room?.writeDoor?.(d.id, true);
    } else {
      breakDoor(d, dx, dz);
      room?.writeDoorBroken?.(d.id);
    }
  };
  state._spawnFn = level
    ? (pl) => level.spawn(pl[(Math.random() * pl.length) | 0], 40, 80)
    : null;
  if (level) Object.assign(state.data.player.position, { x: 1.5, y: 1.7, z: 7.5 });
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
        spawn = level
          ? level.spawn(state.data.player.position, 25 + i * 10, 55 + i * 5)
          : randomMonsterSpawn(state.data.player.position, 50 + i * 20, 120 + i * 30);
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
    const gm = modeEl?.value;
    state.data.world.gameMode = ['days', 'mission', 'story'].includes(gm) ? gm : 'endless';
    state.data.world.dayLimit = Math.max(1, parseInt(dayEl?.value || '3', 10) || 3);
    if (room?.isHost) room.cfg = { mode: state.data.world.gameMode, dayLimit: state.data.world.dayLimit };
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

  mission?.dispose(); tutorial?.dispose(); subs?.dispose();
  pickOne?.dispose(); pickOne = null;
  const mDef = MISSIONS[level ? 'backrooms0' : 'world'];
  subs = new Subtitles(document.getElementById('hud'));
  mission = new Mission(mDef, missionIO());
  if (state.data.mission && state.data.mission.id === mDef.id) {
    mission.s = { ...mission._fresh(), ...state.data.mission, done: state.data.mission.done || {}, contrib: {}, ack: {} };
  } else {
    mission.start();
  }
  tutorial = new Tutorial(document.getElementById('hud'));
  renderer?.spawnMissionMarkers?.(mDef.anchors, !!level);
  renderer?.updateMissionMarkers?.(mission.doneIds());
  renderer?.setMissionMarkersVisible?.(mission.active);
  if (level && level.id === 'backrooms0') { const bad = validateAnchors(mDef); if (bad?.length) console.warn('Anchor Backrooms tak terjangkau:', bad); }

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
  touch.onLighterToggle = () => player?.toggleLighter?.();
  touch.onFlashToggle = () => {
    const bat = state.data.player?.battery ?? 100;
    if (!player.flashlightOn && bat <= 0) {
      state.data.player._batWarn = 2;
    } else {
      player.flashlightOn = !player.flashlightOn;
      if (state.data.player) state.data.player.flashlight = player.flashlightOn;
    }
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

function refreshBindLabels() {
  document.querySelectorAll('#bind-list [data-action]').forEach((row) => {
    const btn = row.querySelector('.btn-bind');
    if (btn) btn.textContent = keyLabel(binds[row.dataset.action]);
  });
}

function syncControlsHelp() {
  const touchMode = typeof inputMode === 'function' && inputMode() === 'touch';
  document.getElementById('bind-list')?.classList.toggle('hidden', touchMode);
  document.getElementById('btn-reset-binds')?.classList.toggle('hidden', touchMode);
  document.getElementById('touch-guide')?.classList.toggle('hidden', !touchMode);
}

function addChat(m) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  const d = document.createElement('div');
  d.className = 'chat-line';
  const b = document.createElement('b');
  b.textContent = (m.name || '?') + ': ';
  d.append(b, document.createTextNode(m.text || ''));
  log.appendChild(d);
  while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => d.remove(), 12000);
}
function openChat() {
  if (!room) {
    if (typeof toast === 'function') toast('Chat hanya tersedia di mode Multiplayer');
    // still allow solo local log
  }
  const f = document.getElementById('chat-form');
  const i = document.getElementById('chat-input');
  if (!f || !i) return;
  document.exitPointerLock?.();
  f.classList.remove('hidden');
  i.focus();
}
function closeChat() {
  const f = document.getElementById('chat-form');
  const i = document.getElementById('chat-input');
  if (!f || !i) return;
  i.value = '';
  i.blur();
  f.classList.add('hidden');
  document.getElementById('game-canvas')?.focus();
}
function submitChat() {
  const i = document.getElementById('chat-input');
  const text = (i?.value || '').trim();
  if (text) {
    const name = profile.displayName || 'Player';
    if (room) room.sendChat(text, name).catch((e) => console.warn('chat', e));
    else addChat({ name, text });
  }
  closeChat();
}

function enterLobby() {
  sessionStorage.removeItem('joinTried');
  if (room) {
    room.onChat = addChat;
    room.listenDoorsBroken?.((id) => {
      const d = DOORS.find((x) => x.id === id);
      if (d) breakDoor(d, 0, 1, true);
    });
    const modeSel = document.getElementById('sel-mode');
    if (modeSel) {
      modeSel.parentElement?.classList?.toggle('hidden', !room.isHost);
      modeSel.value = room.meta?.mode || 'classic';
      modeSel.onchange = () => room.setMode(modeSel.value);
    }
    room.listenDoors?.((id, open) => {
      const d = DOORS.find((x) => x.id === id);
      if (d) setDoor(d, open);
      renderer?.setDoorOpen(id, open);
    });
  }
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
  // pickOne wired after setupLocalGame below

  if (running || startingMulti || !room) return;
  startingMulti = true;
  room.onUpdate = null;
  try {
    mode = 'multi';
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('loading-screen').classList.remove('hidden');
    await setupLocalGame(false);
    pickOne = room.meta?.mode === 'pickone' ? new PickOne({ room, state, controllers: () => monsters }) : null;
    if (pickOne && room.isHost) pickOne.hostBegin();
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

const cctv = {
  on: false, hp: 0,
  enter(tv) {
    const def = BUILDING_DEFS.find((b) => b.id === tv.house);
    if (!def || !renderer) return;
    const cams = [...camsFor(def)];
    if (tv.cam) cams.push(tv.cam);
    renderer.enterCCTV(cams);
    state.data.player.cctv = true;
    this.on = true;
    this.hp = state.data.player.health;
    if (!this.el) {
      this.el = Object.assign(document.createElement('div'), { className: 'cctv' });
      this.el.addEventListener('click', (e) => {
        const a = e.target.closest('button')?.dataset.a;
        if (!a) return;
        if (a === 'prev') { renderer.cycleCCTV(-1); this.draw(); }
        else if (a === 'next') { renderer.cycleCCTV(1); this.draw(); }
        else if (a === 'exit') this.exit();
      });
    }
    document.body.appendChild(this.el);
    this.draw();
  },
  exit() {
    renderer?.exitCCTV();
    if (state?.data?.player) state.data.player.cctv = false;
    this.on = false;
    this.el?.remove();
  },
  draw() {
    const c = renderer?.cctv;
    if (!c || !this.el) return;
    const hint = (typeof inputMode === 'function' && inputMode() === 'touch')
      ? '' : '<small>A/D ganti kamera · E atau Esc keluar</small>';
    this.el.innerHTML =
      `<b>● REC</b> CAM ${c.i + 1}/${c.cams.length} — ${c.cams[c.i].name}${hint}` +
      `<div class="cctv-ui">` +
      `<button type="button" data-a="prev" aria-label="Kamera sebelumnya">◀</button>` +
      `<button type="button" data-a="exit">✕ KELUAR</button>` +
      `<button type="button" data-a="next" aria-label="Kamera berikutnya">▶</button>` +
      `</div>`;
  },
};
let typedSecret = '';
window.addEventListener('keydown', (e) => {
  if (e.key.length === 1) typedSecret = (typedSecret + e.key.toLowerCase()).slice(-8);
  if (!cctv.on) return;
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') { renderer.cycleCCTV(-1); cctv.draw(); }
  if (e.code === 'KeyD' || e.code === 'ArrowRight') { renderer.cycleCCTV(1); cctv.draw(); }
  if (e.code === 'Escape') cctv.exit();
});

function tryUse() {
  const p = state?.data?.player;
  if (!p || !player) return false;
  if (!player.keys.has(binds.interact)) { player._useLatch = false; return false; }
  if (player._useLatch || p.ridingVehicleId || p.isDowned) return false;
  if (document.getElementById('billboard-panel')?.classList.contains('open')) return false;
  if (/(tru|monst)e$/.test(typedSecret)) return false;
  player._useLatch = true;
  if (cctv.on) { cctv.exit(); return true; }
  const { x, z } = p.position;
  // Door first (before TV / vehicle) — range 3.5 m
  let best = null, bd = 3.5;
  for (const dd of DOORS) {
    if (dd.broken) continue;
    const dist = Math.hypot(dd.x - x, dd.z - z);
    if (dist < bd) { bd = dist; best = dd; }
  }
  if (best) {
    if (pickOne?.isMonster()) { pickOne.doorBreach(best.id); return true; }
    setDoor(best, !best.open);
    renderer?.setDoorOpen(best.id, best.open);
    room?.writeDoor?.(best.id, best.open);
    if (typeof toast === 'function') toast(best.open ? 'Pintu terbuka' : 'Pintu tertutup', 1200);
    return true;
  }
  const tv = renderer?.tvSpots?.find((s) => Math.hypot(s.x - x, s.z - z) < 1.8);
  if (tv) { cctv.enter(tv); return true; }
  return false;
}


const net = () => (mode === 'multi' && room ? room : null);

function missionIO() {
  const P = () => state.data.player;
  const me = () => ({ x: P().position.x, z: P().position.z, yaw: P().rotation.yaw, alive: P().alive !== false });
  return {
    uid: () => net()?.uid || 'local',
    isHost: () => !net() || net().isHost,
    enabled: () => ['mission', 'story'].includes(state.data.world.gameMode) || !!net()?.remoteMission,
    story: () => state.data.world.gameMode === 'story',
    say: (lines) => subs?.say(lines),
    interactDown: () => player?.keys?.has(binds.interact),
    local: me,
    players: () => {
      const uid = net()?.uid || 'local';
      const others = Object.entries(net()?.remotePlayers || {})
        .filter(([u]) => u !== uid)
        .map(([u, p]) => ({ uid: u, x: p.x, z: p.z, alive: p.alive !== false }));
      return [{ uid, ...me() }, ...others];
    },
    inv: () => state.data.inventory,
    consume: (t) => removeItems(P(), state.data.inventory, t, 1),
    loot: (item, from) => {
      let best = null, bd = Infinity;
      for (const pk of Object.values(state.data.pickups || {})) {
        if (pk.taken || !(pk.type === item || pk.kind === 'container')) continue;
        const d = Math.hypot(pk.x - from.x, pk.z - from.z);
        if (d < bd) { bd = d; best = pk; }
      }
      return best;
    },
    remote: () => net()?.remoteMission || null,
    acts: () => net()?.remoteMissionActs || {},
    send: (a) => net()?.sendMissionAct(a),
    publish: (s) => net()?.writeMission(s),
    toast: (msg, ms) => { if (typeof toast === 'function') toast(msg, ms); },
    onStep: (st) => {
      if (st.surge) {
        state._forceMonsters = true;
        if (typeof toast === 'function') toast('Listrik menyala. Monster mendengarnya!', 5000);
      }
    },
    onComplete: () => {
      const wait = state.data.world.gameMode === 'story' ? 9000 : 0;
      setTimeout(() => {
        if (state.data.progress.gameOver) return;
        Object.assign(state.data.progress, { gameOver: true, win: true, escaped: true });
      }, wait);
      if (state.data.world.gameMode === 'story') {
        try { localStorage.setItem(`asap_story_${mission.def.id}`, '1'); } catch (e) { /* */ }
      }
    },
  };
}

function tutorialCtx() {
  const pp = state.data.player.position;
  let md = Infinity;
  for (const m of state.data.monsters || []) {
    if (m.active === false) continue;
    md = Math.min(md, Math.hypot(m.position.x - pp.x, m.position.z - pp.z));
  }
  const nearLoot = Object.values(state.data.pickups || {})
    .some((pk) => !pk.taken && Math.hypot(pk.x - pp.x, pk.z - pp.z) < 8);
  return {
    pos: pp, monsterDist: md, nearLoot,
    flash: !!(player?.flashlightOn || state.data.player?.flashlight),
    dark: !!level || (state.data.world.timeOfDay ?? 0) >= 0.42,
    touch: typeof inputMode === 'function' && inputMode() === 'touch',
  };
}

function pickupReady(pk) {
  if (pk.kind === 'generator') return false;
  if (pk.kind === 'dropoff') return countOf(state.data.inventory, 'parcel') > 0;
  return true;
}


function breakDoor(d, dx = 0, dz = 1, instant = false) {
  if (!d || d.broken) return;
  d.broken = true;
  setDoor(d, true);
  renderer?.breakDoor(d.id, dx, dz, instant);
}

function tickDoorBash() {
  for (const mm of state.data.monsters) {
    const b = mm.active !== false ? mm.breach : null;
    if (b) renderer?.doorFx(b.id, b.style, b.ph);
  }
}

const currentMap = () => {
  const l = new URLSearchParams(location.search).get('level');
  return (typeof LEVELS !== 'undefined' && LEVELS[l]) ? l : 'world';
};
function switchMap(id) {
  const u = new URL(location.href);
  if (id === 'world') u.searchParams.delete('level'); else u.searchParams.set('level', id);
  if (profile?.provider !== 'google') sessionStorage.setItem('autoGuest', '1');
  location.href = u.toString();
}

function wireUI(canvas) {
  if (wireUI._uiWired) return;
  wireUI._uiWired = true;
  const ms = document.getElementById('map-select');
  if (ms) {
    ms.value = currentMap();
    ms.addEventListener('change', () => switchMap(ms.value));
  }
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
      tryLandscapeLock({ force: true });
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
      tryLandscapeLock({ force: true });
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

  let settingsFromGame = false;
  document.getElementById('btn-hud-settings')?.addEventListener('click', () => {
    document.exitPointerLock?.();
    settingsFromGame = true;
    if (typeof touch !== 'undefined' && touch) touch.hide();
    document.getElementById('btn-settings').click();
  });

  window.addEventListener('keydown', (e) => {
    const i = document.getElementById('chat-input');
    if (e.code === 'KeyB' && running && state) {
      const panel = document.getElementById('bag-panel');
      if (panel) {
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
          document.exitPointerLock?.();
          const inv = state.data.inventory;
          const p = state.data.player;
          panel.textContent = '';
          const w = invWeight(inv).toFixed(1);
          panel.appendChild(Object.assign(document.createElement('div'), {
            textContent: `Tas ${inv.items.length}/${MAX_SLOTS} · ${w}/${MAX_WEIGHT} kg · $${p.money || 0}`,
          }));
          const counts = {};
          for (const it of inv.items) counts[it.type] = (counts[it.type] || 0) + 1;
          for (const [ty, n] of Object.entries(counts)) {
            const row = document.createElement('div');
            row.textContent = `${ty} ×${n}`;
            if (ITEMS[ty]?.use) {
              const b = document.createElement('button');
              b.textContent = 'Pakai';
              b.onclick = () => { player.consume(ty); };
              row.appendChild(b);
            }
            panel.appendChild(row);
          }
          for (const [id, r] of Object.entries(RECIPES)) {
            const b = document.createElement('button');
            b.textContent = `Craft ${id}`;
            b.onclick = () => {
              if (!canCraft(inv, r, id)) return toast?.('Bahan kurang');
              for (const [ty, n] of Object.entries(r.in)) removeItems(p, inv, ty, n);
              addItem(p, inv, id, true);
              toast?.(`Crafted ${id}`);
            };
            panel.appendChild(b);
          }
        }
      }
    }
    if (e.code === 'Enter' && running && i && document.activeElement !== i) {
      e.preventDefault();
      openChat();
    }
  });
  document.getElementById('btn-chat')?.addEventListener('click', openChat);
  document.getElementById('btn-ui-layout')?.addEventListener('click', () => {
    openLayoutEditor({
      touch,
      TouchControls,
      root: document.getElementById('ui-root') || document.body,
    });
  });
  document.getElementById('chat-cancel')?.addEventListener('click', closeChat);
  document.getElementById('chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitChat();
  });
  document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeChat();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    if (!settingsFromGame) document.getElementById('menu-screen').classList.add('hidden');
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
    if (settingsFromGame) {
      settingsFromGame = false;
      document.getElementById('game-canvas')?.focus();
      if (typeof touch !== 'undefined' && touch && inputMode() === 'touch') touch.show();
      return;
    }
    document.getElementById('menu-screen').classList.remove('hidden');
  });

  // Input mode select
  document.getElementById('input-mode-select')?.addEventListener('change', (e) => {
    setInputPref(e.target.value);
    syncControlsHelp();
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
      rebind(a, () => refreshBindLabels());
    });
  });
  document.getElementById('btn-reset-binds')?.addEventListener('click', () => {
    resetBinds();
    refreshBindLabels();
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
          room.level = currentMap();
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
      room.level = currentMap();
      await room.join();
      const { ref, update } = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js');
      const { getDb } = await import('./net/firebase.js');
      await update(ref(getDb(), `rooms/${code}/players/${room.uid}`), {
        name: profile.displayName,
      });
      enterLobby();
    } catch (e) {
      room = null;
      if (e.mapMismatch && (e.mapMismatch === 'world' || (typeof LEVELS !== 'undefined' && LEVELS[e.mapMismatch])) && !sessionStorage.getItem('joinTried')) {
        sessionStorage.setItem('joinTried', '1');
        sessionStorage.setItem('pendingJoin', code);
        if (profile?.provider !== 'google') sessionStorage.setItem('autoGuest', '1');
        const u = new URL(location.href);
        if (e.mapMismatch === 'world') u.searchParams.delete('level');
        else u.searchParams.set('level', e.mapMismatch);
        location.href = u.toString();
        return;
      }
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
    if (room && mode === 'multi' && !room.gameStatus?.gameOver) {
      await room.respawnSelf();
      const p = state.data.player;
      Object.assign(p, { alive: true, isDowned: false, health: 100, downedTimer: 0, sanity: 100 });
      p.position.x = 0; p.position.y = 1.7; p.position.z = 8;
      state.data.progress.gameOver = false;
      document.getElementById('gameover-screen')?.classList.add('hidden');
      document.getElementById('hud')?.classList.remove('hidden');
      if (touch && inputMode() === 'touch') touch.show();
      document.getElementById('game-canvas')?.focus();
      deadShown = false;
      startLoop();
      return;
    }
    document.getElementById('gameover-screen').classList.add('hidden');
    running = false;
    hideTouch();
    await leaveRoom();
    mode = 'solo';
    await setupLocalGame(false);
    pickOne = room.meta?.mode === 'pickone' ? new PickOne({ room, state, controllers: () => monsters }) : null;
    if (pickOne && room.isHost) pickOne.hostBegin();
    await audio.resume();
    document.getElementById('room-hud').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('game-canvas').focus();
    startLoop();
  });
  document.getElementById('btn-menu').addEventListener('click', async () => {
    running = false;
    audio?.stopMusic?.(1);
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
  document.getElementById('vol-music')?.addEventListener('input', (e) => {
    audio.setMusicVolume(Number(e.target.value));
  });
}

function showGameOver(win, keepRunning = false) {
  const rb = document.getElementById('btn-restart');
  if (rb) rb.textContent = (mode === 'multi' && room && !room.gameStatus?.gameOver) ? 'RESPAWN' : 'RESTART';

  if (!keepRunning) running = false;
  hideTouch();
  document.exitPointerLock?.();
  audio?.setRain?.(false);
  audio?.setSanityFilter?.(0);
  if (!keepRunning) audio?.stopMusic?.(2);
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

function spawnDefaultVehicles() {
  if (!state) return;
  if ((state.data.vehicles || []).length > 0 || vehicleControllers.length > 0) return;
  // Near player spawn (0, 8) on the main road
  const spots = [
    { type: 'motor', x: 4, z: 10 },
    { type: 'mobil', x: -6, z: 12 },
  ];
  for (const s of spots) {
    const v = new VehicleController(s.type, { x: s.x, y: 0, z: s.z });
    v.ownerUid = room?.uid || deviceUid();
    vehicleControllers.push(v);
  }
  state.data.vehicles = vehicleControllers;
  if (renderer) renderer.syncVehicles(vehicleControllers);
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
  v.ownerUid = room?.uid || deviceUid();
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
      if (room) room.writeVehicle(v);
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
    if (d < 3.5) {
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
  window.__mon = () => (state?.data?.monsters || []).map((m, i) => {
    const R = (typeof ROSTER !== 'undefined' ? ROSTER : ['shadow','smily','boiled','siren']);
    return `${R[i] || i}: ${m.active ? m.aiState : 'off'}`;
  });
  tryLandscapeLock();
  try { audio.resume?.(); audio.playMusic?.(3); } catch (e) { /* */ }
  let locKey = '', locEl = null;
  function step() {
    if (!running) return;
    const dt = Math.min(0.05, clock.tick()); // clamp: avoid spiral on lag spikes
    const now = performance.now() / 1000;
    const isAuthority = mode === 'solo' || (room && room.isHost);

    player.update(dt);
    const used = tryUse();
    if (!used) tryVehicleInteract();
    tickDoorBash(dt);
    pickOne?.tick(dt);
    if (cctv.on) {
      const pl = state.data.player;
      if (pl.health < cctv.hp - 0.5 || pl.isDowned) cctv.exit();
      else cctv.hp = pl.health;
    }
    level?.update(state.data.player.position, dt, state.data.player, audio);
    try {
      const sc = LANDMARKS.summoningCircle, pl = state.data.player;
      if (sc && Math.hypot(pl.position.x - sc.x, pl.position.z - sc.z) < 7)
        pl.sanity = Math.max(0, (pl.sanity ?? 100) - 3 * dt);
    } catch (e) { /* */ }

    // Vehicle physics (local driver or host)
    const myUid = room?.uid || deviceUid();
    for (const v of vehicleControllers) {
      const isDriver = v.driverUid === myUid
        || (state.data.player.ridingVehicleId === v.id && state.data.player.ridingRole === 'driver');
      if (isDriver) {
        if (!v.driverUid) v.driverUid = myUid;
        if (room?.remotePlayers) {
          v.passengerUids = Object.entries(room.remotePlayers)
            .filter(([u, rp]) => rp.ridingVehicleId === v.id && rp.ridingRole !== 'driver' && u !== myUid)
            .map(([u]) => u);
          // include local self if passenger somehow - skip
        }
        v.driveUpdate(dt, player.keys, colliders, state, audio, v.driverUid || myUid);
        v.checkMonsterHits(state.data.monsters, now, (dmg) => {
          const pl = state.data.player;
          if (pl.isDowned) {
            pl.alive = false;
            state.data.progress.deaths += 1;
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
        if (rv.driver === myUid) continue; // penumpang tetap terima update posisi
        let v = vehicleControllers.find((x) => x.id === id);
        if (!v) {
          v = new VehicleController(rv.type || 'motor', { x: rv.x, y: rv.y, z: rv.z }, id);
          v.remote = true;
          vehicleControllers.push(v);
        }
        {
          const kv = 1 - Math.exp(-14 * dt);
          if (Math.hypot(rv.x - v.position.x, rv.z - v.position.z) > 8) {
            v.position.x = rv.x; v.position.z = rv.z;
          } else {
            v.position.x += (rv.x - v.position.x) * kv;
            v.position.z += (rv.z - v.position.z) * kv;
          }
          v.position.y = rv.y || 0;
        }
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
        m.attackCooldown = r.attackCooldown;
        m.breach = r.door ? { id: r.door, ph: r.dph || 0, style: r.dst || 'smash' } : null;
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
    if (room?.isHost && !state.data.player.alive && !state.data.progress.gameOver && !deadShown) {
      deadShown = true;
      showGameOver(false, true);
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
        // Any client may write vehicles they drive / own (not remote copies)
        for (const v of vehicleControllers) {
          if (v.remote) continue;
          if (
            v.driverUid === room.uid ||
            (!v.driverUid && (v.ownerUid === room.uid || (room.isHost && !v.ownerUid)))
          ) {
            if (room?.remotePlayers) {
          v.passengerUids = Object.entries(room.remotePlayers)
            .filter(([u, rp]) => rp.ridingVehicleId === v.id && rp.ridingRole !== 'driver')
            .map(([u]) => u);
        }
        room.writeVehicle(v);
          }
        }
        if (room.isHost) {
          room.writeMonsters(state.data.monsters);
          room.writeGame(state.data.progress, state.data.world.weather);
        }
        const evs = state.data.world.activeSoundEvents || [];
        const mine = evs.filter((e) => !e.net);
        const newest = mine[mine.length - 1];
        if (newest && newest.id !== lastSentSoundId) {
          lastSentSoundId = newest.id;
          room.writeSounds?.(mine.slice(-6));
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
    const bf = document.getElementById('battery-fill');
    const bb = document.getElementById('battery-bar');
    const bat = state.data.player.battery ?? 100;
    if (bf) bf.style.width = `${Math.max(0, Math.min(100, bat))}%`;
    if (bb) bb.classList.toggle('low', bat < 20);
    const bw = document.getElementById('battery-warn');
    if (bw) bw.classList.toggle('hidden', !(state.data.player._batWarn > 0));

    const eye = player.eyePosition;
    const yaw = state.data.player.rotation.yaw;
    audio.setListenerPosition(eye.x, eye.y, eye.z, -Math.sin(yaw), -Math.cos(yaw));
    // --- Day cycle (loops). Endless or win after N days. ---
    const gs = room?.gameStatus;
    if (gs?.dayLimit && room && !room.isHost) {
      state.data.world.gameMode = gs.mode;
      state.data.world.dayLimit = gs.dayLimit;
    }
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
      updateSchedule(state, plist, level ? 0.6 : dayProgress, dayIndex, !!room || !!level);
    }
    // Street lamps (deterministic, no network)
    if (renderer?.updateLamps) {
      state._lampSites = renderer.lampSites;
      renderer.updateLamps(state.data.world.elapsed, dayProgress, state.data.player.position.x, state.data.player.position.z, dt);
    }
    renderer?.updateTVLights?.(
      state.data.player.position.x,
      state.data.player.position.z,
      dt
    );
    state.data.world.daysSurvived = dayIndex;
    state.data.progress.daysReached = dayIndex;
    state.data.world.timeOfDay = dayProgress;
    const lights = lightingForProgress(dayProgress);
    if (!level && renderer.applyDayLighting) renderer.applyDayLighting(lights);
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
      !level && (state.data.world.gameMode || 'endless') === 'days' &&
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
      const wr = weatherCtrl.update(dt, now, state.data.world, renderer, audio, { follow: true });
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
      worldDirector = new WorldDirector(renderer.scene, pacing, audio);
    }
    {
      let mDist = 99, chasing = false;
      for (const m of state.data.monsters || []) {
        if (m.active === false) continue;
        const d = Math.hypot(m.position.x - state.data.player.position.x, m.position.z - state.data.player.position.z);
        if (d < mDist) mDist = d;
        if (m.aiState === 'CHASE' || m.aiState === 'ATTACK') chasing = true;
      }
      pacing.update(dt, { monsterDist: mDist, chasing, sanity: state.data.player.sanity ?? 100 });
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
    mission?.update(dt);
    subs?.update(dt);
    if (mission?.s && state?.data) {
      const sig = `${mission.s.step}|${mission.s.count}|${Object.keys(mission.s.done || {}).join()}|${mission.s.complete}`;
      if (sig !== mission._sig) {
        mission._sig = sig;
        state.data.mission = {
          id: mission.def.id, v: mission.s.v, step: mission.s.step, count: mission.s.count,
          done: { ...(mission.s.done || {}) }, complete: !!mission.s.complete, story: !!mission.s.story,
        };
        renderer?.updateMissionMarkers?.(mission.doneIds());
      }
      renderer?.setMissionMarkersVisible?.(mission.active);
    }
    tutorial?.update(dt, tutorialCtx());

    (function tickPickups() {
      const pickups = state.data.pickups || {};
      const pp = state.data.player.position;
      const near = (pk, x, z, r) => Math.hypot(pk.x - x, pk.z - z) < r;
      if (mode === 'solo' || room?.isHost) {
        let dirty = false;
        for (const pk of Object.values(pickups)) {
          if (pk.taken || !pickupReady(pk) || !near(pk, pp.x, pp.z, 1.8)) continue;
          pk.taken = true;
          pk.takenBy = room?.uid || 'local';
          givePickupItem(pk);
          dirty = true;
        }
        if (room?.isHost) {
          for (const [uid, c] of Object.entries(room.remoteClaims || {})) {
            const pk = pickups[c.pickupId];
            const rp = room.remotePlayers[uid];
            if (!pk || pk.taken || pk.kind === 'generator' || !rp || !near(pk, rp.x, rp.z, 3)) continue;
            pk.taken = true;
            pk.takenBy = uid;
            dirty = true;
          }
          if (dirty) room.writePickups(pickups);
        }
      } else if (room) {
        const t = performance.now();
        for (const [id, pk] of Object.entries(room.remotePickups || {})) {
          if (!pk.taken && pickupReady(pk) && near(pk, pp.x, pp.z, 1.8) && t - (claimedPickups.get(id) || 0) > 2000) {
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
    const isDarkOutside = !inside && !state.data.player.flashlight && !state.data.player.lighter && phase !== 'afternoon';
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
    const lk = inside ? inside.type : '';
    if (lk !== locKey) {
      locKey = lk;
      locEl ??= document.getElementById('location-hint');
      if (locEl) {
        if (lk) { locEl.textContent = lk === 'building' ? 'Gedung' : 'Rumah'; locEl.classList.remove('hidden'); }
        else locEl.classList.add('hidden');
      }
    }
    if ((pkSyncAcc = (pkSyncAcc || 0) + dt) > 0.25) {
      pkSyncAcc = 0;
      renderer?.syncPickups?.(state.data.pickups);
    }
    renderer.render(state.data, eye, yaw, state.data.player.rotation.pitch, dt);
  }

  let errStreak = 0;
  function frame() {
    if (!running) return;
    try {
      step();
      errStreak = 0;
    } catch (e) {
      if (errStreak++ < 3) console.error('frame error', e);
      if (errStreak > 180) {
        running = false;
        try { toast('Terjadi error. Muat ulang halaman.'); } catch (_) { /* */ }
        return;
      }
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
