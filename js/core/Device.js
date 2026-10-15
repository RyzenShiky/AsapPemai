export function isTouchDevice() {
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

export function isMobileUA() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

export function isLowEndDevice() {
  const mem = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency || 4;
  if (typeof mem === 'number' && mem <= 4) return true;
  if (cores <= 4 && isTouchDevice()) return true;
  return false;
}

export function recommendGraphics() {
  const touch = isTouchDevice();
  const low = isLowEndDevice();
  return {
    touch,
    lowEnd: low,
    pixelRatioCap: low ? 0.9 : touch ? 1.0 : 1.5,
    shadows: !touch,
    fogDensity: touch ? 0.03 : 0.022,
    foliageScale: low ? 0.3 : touch ? 0.45 : 1.0,
    maxRain: low ? 40 : touch ? 80 : 280,
    antialias: !touch,
    drawDistance: low ? 120 : touch ? 180 : 320,
  };
}

let pref = localStorage.getItem('longway_input') || 'auto';
let last = isMobileUA() ? 'touch' : 'mouse';
let watching = false;
let inputCb = null;

export const inputMode = () => (pref === 'auto' ? last : pref);

export function setInputPref(v) {
  pref = v;
  localStorage.setItem('longway_input', v);
}

/** Single global pointerdown listener — safe to call many times. */
export function watchInput(onChange) {
  inputCb = onChange;
  if (watching) return;
  watching = true;
  addEventListener(
    'pointerdown',
    (e) => {
      const m = e.pointerType === 'touch' ? 'touch' : 'mouse';
      if (m !== last) {
        last = m;
        inputCb?.(inputMode());
      }
    },
    { capture: true, passive: true }
  );
}
