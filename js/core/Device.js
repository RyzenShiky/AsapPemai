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

export function recommendGraphics() {
  const touch = isTouchDevice();
  return {
    touch,
    pixelRatioCap: touch ? 1.25 : 1.75,
    shadows: !touch,
    fogDensity: touch ? 0.024 : 0.022,
  };
}
