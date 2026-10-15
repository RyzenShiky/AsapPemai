/** Item definitions — every item has a function and a cost. */
export const SOUND = {
  walk: [0.38, 18],
  run: [0.9, 38],
  crouch: [0.12, 9],
  door: [0.6, 24],
  drop: [0.7, 28],
  vehicle: [0.95, 60],
  radio: [0.45, 20],
};

export const ITEMS = {
  battery: {
    stack: 3,
    use: (p) => {
      p.battery = Math.min(100, (p.battery ?? 100) + 40);
    },
  },
  medkit: {
    stack: 1,
    useTime: 3.0,
    use: (p) => {
      p.health = Math.min(100, (p.health ?? 100) + 40);
    },
  },
  key: { stack: 1, opens: 'gate_a' },
  crowbar: { stack: 1, opens: 'door_*', noise: SOUND.drop },
  radio: {
    stack: 1,
    use: (p, state) => {
      state?.emitSound({
        position: { ...p.position },
        intensity: SOUND.radio[0],
        radius: SOUND.radio[1],
        type: 'radio',
      });
    },
  },
};

export const CLUES = [
  { id: 'note_01', type: 'note', pos: [34, -12], text: 'Jangan ikut suara di hutan…', requires: null },
  { id: 'tape_02', type: 'tape', pos: [-60, 40], audio: 'tape02', requires: { flag: 'generatorOn' } },
  { id: 'photo_03', type: 'photo', pos: [10, 88], requires: { clue: 'note_01' } },
];

export function canOpenClue(c, lore) {
  if (!c.requires) return true;
  if (c.requires.flag) return !!lore.flags[c.requires.flag];
  if (c.requires.clue) return !!lore.found[c.requires.clue];
  return true;
}

export function resolveEnding(lore) {
  const k = Object.keys(lore.found || {}).length;
  if (lore.choices?.freedSurvivor && k >= 6) return 'redemption';
  if (k >= 6) return 'truth';
  return lore.choices?.leftSurvivor ? 'abandon' : 'escape';
}

export const OBJECTIVES = [
  {
    id: 'restorePower',
    paths: [
      { id: 'fuse', needs: ['fuse'] },
      { id: 'gen', needs: ['fuel', 'battery'], noise: { intensity: 0.8, radius: 45 } },
    ],
  },
];

/** Hide-spot safety base factors. */
export const SPOTS = { locker: 0.85, bed: 0.65, bush: 0.5, room: 0.4 };
