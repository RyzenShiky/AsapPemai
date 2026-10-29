export const MONSTER_TYPES = {
  shadow: {
    glb: null, h: 2.4, speed: 2.5, radius: 0.55, reach: 1.6, dmg: 34, nightAt: 0.42,
    hearMul: 1.2, sense: { sightRange: 30, fov: 2.0, hear: 1.2 },
    search: 'spiral', weak: 'light', breach: 'phase',
  },
  smily: {
    glb: 'smily_horror_monster.glb', h: 2.4, speed: 2.5, radius: 0.55, reach: 1.6, dmg: 34,
    nightAt: 0.42, face: Math.PI, hearMul: 1.3, sense: { sightRange: 28, fov: 1.9, hear: 1.3 },
    search: 'spiral', weak: 'light', breach: 'open',
  },
  boiled: {
    glb: 'boiled.glb', h: 2.1, speed: 3.1, radius: 0.5, reach: 1.7, dmg: 34, nightAt: 0.45,
    face: Math.PI, procedural: true, hearMul: 1.4, sense: { sightRange: 26, fov: 2.2, hear: 1.4 },
    search: 'sweep', weak: 'silence', breach: 'smash', wallTime: 2.0,
  },
  siren: {
    glb: 'siren.glb', h: 90, speed: 2.4, radius: 11, colRadius: 2.2, reach: 37, dmg: 60,
    nightAt: 0.5, stomp: true,
    face: Math.PI, ignoresTrees: true, hearMul: 1.5, sense: { sightRange: 100, fov: 2.0, hear: 1.8 },
    search: 'sweep', weak: 'silence', breach: 'smash',
  },
  locust: {
    glb: null, h: 3.0, speed: 2.8, radius: 0.6, reach: 2.2, dmg: 40, nightAt: 0.46,
    face: Math.PI, hearMul: 1.2, sense: { sightRange: 30, fov: 1.7, hear: 1.2 },
    search: 'sweep', weak: 'light', breach: 'stab', wallTime: 1.6,
  },
};

export const ROSTER = ['shadow', 'smily', 'boiled', 'siren', 'locust'];
export const MAX_PLAYERS = 6;

export function applyBackroomsMonsters() {
  Object.assign(MONSTER_TYPES.siren, { h: 2.7, radius: 0.5, colRadius: 0.5, reach: 1.9, speed: 2.3, ignoresTrees: false, stomp: false, sense: { sightRange: 20, fov: 1.2, hear: 1.6 } });
  Object.assign(MONSTER_TYPES.locust, { h: 2.6, radius: 0.5, reach: 1.9, speed: 2.5 });
}
