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
    },
    vehicles: [],
    monsters: [
      {
        id: 'm0',
        position: { x: 0, y: 0, z: 0 }, // filled on spawn
        active: false,
        rotation: { yaw: Math.PI },
        aiState: 'PATROL',
        memory: {
          lastHeardPosition: null,
          lastHeardTime: 0,
          lastHeardIntensity: 0,
          confidence: 0,
          suspicion: 0,
          searchRadius: 12,
        },
        path: [],
      },
    ],
    world: {
      levelId: 'forest_200',
      timeOfDay: 0.55,
      weather: 'clear',
      weatherTimer: 0,
      weatherNextChange: 50, // 0=midnight … 0.5=noon … 1=next midnight; start late afternoon
      timeLimit: 180, // 3 minutes
      elapsed: 0,
      activeSoundEvents: [],
      worldEvents: {
        familyPhoto: { stage: 0 },
        cabinLight: { stage: 0 },
      },
    },
    progress: {
      playTime: 0,
      deaths: 0,
      escaped: false,
      gameOver: false,
      win: false,
      timeUp: false,
    },
    version: 3,
  };
}

const SAVE_KEY = 'longway_save_v3';

export class GameState {
  constructor(initial) {
    this.data = initial || createInitialState();
  }

  serialize() {
    return JSON.stringify(this.data);
  }

  static deserialize(json) {
    return new GameState(JSON.parse(json));
  }

  saveLocal() {
    try {
      localStorage.setItem(SAVE_KEY, this.serialize());
      return true;
    } catch (e) {
      return false;
    }
  }

  static loadLocal() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return GameState.deserialize(raw);
    } catch (e) {
      return null;
    }
  }

  static hasSave() {
    return !!localStorage.getItem(SAVE_KEY);
  }

  static clearSave() {
    localStorage.removeItem(SAVE_KEY);
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
