export const MONSTER_TYPES = {
  shadow: {
    glb: null,
    h: 2.4,
    speed: 2.5,
    radius: 0.55,
    reach: 1.6,
    dmg: 34,
    nightAt: 0.42,
    hearMul: 1.2,
    sense: { sightRange: 30, fov: 2.0, hear: 1.2 },
    search: 'spiral',
    weak: 'light',
  },
  smily: {
    glb: 'smily_horror_monster.glb',
    h: 2.4,
    speed: 2.5,
    radius: 0.55,
    reach: 1.6,
    dmg: 34,
    nightAt: 0.42,
    face: Math.PI,
    hearMul: 1.3,
    sense: { sightRange: 28, fov: 1.9, hear: 1.3 },
    search: 'spiral',
    weak: 'light',
  },
  boiled: {
    glb: 'boiled.glb',
    h: 2.1,
    speed: 3.1,
    radius: 0.5,
    reach: 1.7,
    dmg: 34,
    nightAt: 0.45,
    face: Math.PI,
    procedural: true,
    hearMul: 1.4,
    sense: { sightRange: 26, fov: 2.2, hear: 1.4 },
    search: 'sweep',
    weak: 'silence',
  },
  siren: {
    glb: 'siren.glb',
    h: 9.5,
    speed: 2.0,
    radius: 1.6,
    reach: 4.6,
    dmg: 60,
    nightAt: 0.50,
    face: Math.PI,
    ignoresTrees: true,
    hearMul: 1.5,
    sense: { sightRange: 20, fov: 1.2, hear: 1.6 },
    search: 'sweep',
    weak: 'silence',
  },
};

export const ROSTER = ['shadow', 'smily', 'boiled', 'siren'];
export const MAX_PLAYERS = 6;

/** Backrooms: shrink Siren to fit 2.8 m ceiling. Call before renderer.init(). */
export function applyBackroomsMonsters() {
  Object.assign(MONSTER_TYPES.siren, {
    h: 2.7, radius: 0.5, reach: 1.9, speed: 2.3, ignoresTrees: false,
  });
}
