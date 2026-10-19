import { BUILDING_DEFS, containersFor } from './Buildings.js';
export function createInitialState() {
  return {
    player: {
      position: { x: 0, y: 1.7, z: 8 },
      rotation: { yaw: 0, pitch: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      stamina: 100,
      isCrouching: false,
      isRunning: false,
      health: 100,
      sanity: 100,
      alive: true,
      flashlight: false,
      isHiding: false,
      isHoldingBreath: false,
      breath: 100,
      throwables: 2,
      moveState: 'idle',
      isDowned: false,
      downedTimer: 0,
      ridingVehicleId: null,
      ridingRole: null,
      battery: 100,
      hunger: 100,
      thirst: 100,
      lighterFuel: 100,
      money: 0,
      rep: 0,
      medkits: 0,
    },
    vehicles: [],
    monsters: [0, 1, 2, 3].map((i) => ({
      id: 'm' + i,
      position: { x: 0, y: 0, z: 0 },
      active: false,
      rotation: { yaw: Math.PI },
      aiState: 'PATROL',
      memory: {
        lastHeardPosition: null,
        lastHeardTime: 0,
        lastHeardIntensity: 0,
        lastSeenPosition: null,
        lastSeenTime: 0,
        canSeePlayer: false,
        confidence: 0,
        suspicion: 0,
        searchRadius: 14,
        routeRepeats: 0,
      },
      path: [],
    })),
    world: {
      levelId: 'forest_200',
      timeOfDay: 0.55,
      weather: 'clear',
      weatherTimer: 0,
      weatherNextChange: 50,
      /** 'endless' | 'days' */
      gameMode: 'endless',
      /** win after this many full day cycles (only if gameMode === 'days') */
      dayLimit: 3,
      daysSurvived: 0,
      daySeconds: 180,
      elapsed: 0,
      activeSoundEvents: [],
      worldEvents: {
        familyPhoto: { stage: 0 },
        cabinLight: { stage: 0 },
      },
    },
    pickups: {
      // guaranteed batteries per area + medkits
      bat_a: { type: 'battery', x: 12, z: 20, taken: false },
      bat_b: { type: 'battery', x: -45, z: -30, taken: false },
      bat_c: { type: 'battery', x: 60, z: -55, taken: false },
      wat_a: { type: 'water', x: 20, z: -10, taken: false },
      food_a: { type: 'food', x: -30, z: 15, taken: false },
      fuel_a: { type: 'fuel', x: 45, z: 30, taken: false },
      board_a: { kind: 'board', x: 21, z: 22, taken: false },
      gen_a: { kind: 'generator', x: 210, z: -110, taken: false },
      drop_a: { kind: 'dropoff', x: -24, z: 176, taken: false },
      ...containersFor(BUILDING_DEFS),
      med_a: { type: 'medkit', x: -10, z: 40, taken: false },
    },
    lore: { found: {}, flags: {}, choices: {} },
    inventory: { slots: 8, items: [] },
    progress: {
      playTime: 0,
      deaths: 0,
      escaped: false,
      gameOver: false,
      win: false,
      timeUp: false,
      daysReached: 0,
    },
    mission: null,
    version: 5,
  };
}

const SAVE_KEY = 'longway_save_v4';
const LEGACY_KEY = 'longway_save_v3';

const MIGRATIONS = {
  3: (d) => ({
    ...d,
    lore: d.lore || { found: {}, flags: {}, choices: {} },
    inventory: d.inventory || { slots: 8, items: [] },
    player: {
      ...d.player,
      battery: d.player?.battery ?? 100,
      medkits: d.player?.medkits ?? 0,
    },
    version: 4,
  }),
  4: (d) => ({ ...d, mission: d.mission || null, version: 5 }),
};

export class GameState {
  constructor(initial) {
    this.data = initial || createInitialState();
  }

  serialize() {
    return JSON.stringify(this.data);
  }

  static deserialize(json) {
    let d = JSON.parse(json);
    while (MIGRATIONS[d.version]) d = MIGRATIONS[d.version](d);
    return new GameState(d);
  }

  saveLocal() {
    try {
      localStorage.setItem(SAVE_KEY, this.serialize());
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Checkpoint save under a separate key (used on objective complete). */
  saveCheckpoint(key = 'longway_checkpoint') {
    try {
      localStorage.setItem(key, this.serialize());
      return true;
    } catch (e) {
      return false;
    }
  }

  static loadLocal() {
    try {
      let raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        // try legacy
        raw = localStorage.getItem(LEGACY_KEY);
      }
      if (!raw) return null;
      return GameState.deserialize(raw);
    } catch (e) {
      return null;
    }
  }

  static loadCheckpoint(key = 'longway_checkpoint') {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return GameState.deserialize(raw);
    } catch (e) {
      return null;
    }
  }

  static hasSave() {
    return !!localStorage.getItem(SAVE_KEY) || !!localStorage.getItem(LEGACY_KEY);
  }

  static clearSave() {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  }

  getVehicle(id) {
    return (this.data.vehicles || []).find((v) => v.id === id) || null;
  }

  triggerWorldEvent(key, stage) {
    if (!this.data.world.worldEvents) this.data.world.worldEvents = {};
    if (!this.data.world.worldEvents[key]) this.data.world.worldEvents[key] = { stage: 0 };
    this.data.world.worldEvents[key].stage = stage;
    this.data.world.worldEvents[key].changedAt = performance.now();
  }

  emitSound(ev) {
    const full = {
      ...ev,
      id: `snd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: performance.now() / 1000,
    };
    this.data.world.activeSoundEvents.push(full);
    if (this.data.world.activeSoundEvents.length > 64) {
      this.data.world.activeSoundEvents.shift();
    }
    return full;
  }
}
