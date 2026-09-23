/**
 * Keyboard easter-egg buffer: "true" | "motor" | "mobil"
 */
export function installSecretCodes(handlers) {
  let buffer = '';
  const onKey = (e) => {
    if (e.key.length !== 1) return;
    buffer = (buffer + e.key).slice(-12);
    const low = buffer.toLowerCase();
    if (low.endsWith('true')) {
      handlers.onTrue?.();
      buffer = '';
    } else if (low.endsWith('motor')) {
      handlers.onMotor?.();
      buffer = '';
    } else if (low.endsWith('mobil')) {
      handlers.onMobil?.();
      buffer = '';
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
