const DEFAULTS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  crouch: 'KeyC',
  flash: 'KeyF',
  hide: 'KeyH',
  throw: 'KeyQ',
  interact: 'KeyE',
  lighter: 'KeyG',
};

export const binds = {
  ...DEFAULTS,
  ...JSON.parse(localStorage.getItem('longway_binds') || '{}'),
};

const save = () => localStorage.setItem('longway_binds', JSON.stringify(binds));

/** Start listening for the next keypress and rebind `action`. Calls done(code). */
export function rebind(action, done) {
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') {
      // Swap if the new key is already used by another action
      for (const a in binds) {
        if (binds[a] === e.code) binds[a] = binds[action];
      }
      binds[action] = e.code;
      save();
    }
    done?.(e.code);
  };
  addEventListener('keydown', handler, { once: true, capture: true });
}

export const resetBinds = () => {
  Object.assign(binds, DEFAULTS);
  save();
};

export function isBound(code) {
  return Object.values(binds).includes(code);
}

const NAMED = {
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  AltLeft: 'Alt', AltRight: 'Alt', Space: 'Spasi', Enter: 'Enter', Tab: 'Tab',
  Backspace: '⌫', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};

/** 'KeyW' -> 'W', 'ShiftLeft' -> 'Shift' */
export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(.+)$/.exec(code))) return 'Num ' + m[1];
  return code;
}
