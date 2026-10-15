export const MONSTER_TYPES = {
  shadow: {
    glb: null,
    h: 2.4,
    speed: 2.5,
    radius: 0.55,
    reach: 1.6,
    dmg: 34,
    nightAt: 0.66,
  },
  smily: {
    glb: 'smily_horror_monster.glb',
    h: 2.4,
    speed: 2.5,
    radius: 0.55,
    reach: 1.6,
    dmg: 34,
    nightAt: 0.66,
    face: Math.PI,
  },
  boiled: {
    glb: 'boiled.glb',
    h: 2.1,
    speed: 3.1,
    radius: 0.5,
    reach: 1.7,
    dmg: 34,
    nightAt: 0.7,
    face: Math.PI,
    procedural: true,
  },
  siren: {
    glb: 'siren.glb',
    h: 9.5,
    speed: 2.0,
    radius: 1.6,
    reach: 4.6,
    dmg: 60,
    nightAt: 0.76,
    face: Math.PI,
    ignoresTrees: true,
    hearMul: 1.5,
  },
};

/** Fixed order m0..m3 — must be identical on every client. */
export const ROSTER = ['shadow', 'smily', 'boiled', 'siren'];

export const MAX_PLAYERS = 6;
