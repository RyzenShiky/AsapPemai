/**
 * Landscape lock + manual rotation only (no auto CSS flip).
 */
const ROT_KEY = 'longway_screen_rot_manual';
try { localStorage.removeItem('longway_screen_rot'); } catch (e) { /* */ }

export function isTouchDevice() {
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent)
  );
}

export function isLandscape() {
  if (window.matchMedia) return window.matchMedia('(orientation: landscape)').matches;
  return window.innerWidth >= window.innerHeight;
}
export function isPortrait() { return !isLandscape(); }

export function getScreenRotation() {
  let n = 0;
  try { n = parseInt(localStorage.getItem(ROT_KEY) || '0', 10); } catch (e) { /* */ }
  return [0, 90, 180, 270].includes(n) ? n : 0;
}
export function setScreenRotation(deg) {
  const d = ((deg % 360) + 360) % 360;
  try { localStorage.setItem(ROT_KEY, String(d)); } catch (e) { /* */ }
  applyScreenRotation(d);
  return d;
}
export function cycleScreenRotation() { return setScreenRotation((getScreenRotation() + 90) % 360); }

let _applied = null;
export function applyScreenRotation(deg = getScreenRotation()) {
  if (deg === _applied) return;
  _applied = deg;
  const app = document.getElementById('app');
  document.body.classList.remove('rot-0', 'rot-90', 'rot-180', 'rot-270');
  document.body.classList.add('rot-' + deg);
  if (!app) return;
  app.style.transform = deg ? 'rotate(' + deg + 'deg)' : '';
  if (deg === 90 || deg === 270) {
    Object.assign(app.style, {
      width: '100vh', height: '100vw', transformOrigin: 'center center', position: 'fixed',
      left: '50%', top: '50%', marginLeft: 'calc(-50vh)', marginTop: 'calc(-50vw)',
    });
  } else if (deg === 180) {
    Object.assign(app.style, {
      width: '100%', height: '100%', left: '0', top: '0', marginLeft: '0', marginTop: '0',
      position: 'relative', transformOrigin: 'center center',
    });
  } else {
    Object.assign(app.style, {
      width: '', height: '', left: '', top: '', marginLeft: '', marginTop: '', position: '', transformOrigin: '',
    });
  }
}

export function onOrientationChange(cb) {
  let t = 0;
  const info = () => ({
    landscape: isLandscape(),
    width: window.innerWidth,
    height: window.innerHeight,
    angle: screen.orientation?.angle ?? 0,
  });
  const fire = () => { clearTimeout(t); t = setTimeout(() => cb(info()), 150); };
  window.addEventListener('resize', fire);
  window.addEventListener('orientationchange', fire);
  screen.orientation?.addEventListener?.('change', fire);
  cb(info());
  return () => {
    clearTimeout(t);
    window.removeEventListener('resize', fire);
    window.removeEventListener('orientationchange', fire);
    screen.orientation?.removeEventListener?.('change', fire);
  };
}

export function updateRotateHint() {
  const hint = document.getElementById('rotate-hint');
  const rot = getScreenRotation();
  const rotated = rot === 90 || rot === 270;
  if (hint) {
    const show = isTouchDevice() && isPortrait() && !rotated;
    hint.style.display = show ? 'flex' : 'none';
    hint.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
  document.body.classList.toggle('is-landscape', isLandscape() || rotated);
  document.body.classList.toggle('is-portrait', isPortrait() && !rotated);
  document.body.classList.toggle('is-touch', isTouchDevice());
  applyScreenRotation(rot);
}

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
let _inflight = null, _lastTry = 0, _tries = 0;

export function tryLandscapeLock({ force = false } = {}) {
  if (!isTouchDevice()) return Promise.resolve(false);
  const o = screen.orientation;
  if (!o || typeof o.lock !== 'function') return Promise.resolve(false);
  if (_inflight) return _inflight;
  const now = Date.now();
  if (!force && (now - _lastTry < 4000 || _tries >= 3)) return Promise.resolve(false);
  _lastTry = now;
  _tries++;
  const lock = async () => {
    for (const mode of ['landscape', 'landscape-primary']) {
      try { await withTimeout(o.lock(mode), 1500); return true; } catch (e) { /* */ }
    }
    return false;
  };
  _inflight = (async () => {
    try {
      if (await lock()) return true;
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        await withTimeout(el.requestFullscreen(), 2000);
        return await lock();
      }
    } catch (e) { /* */ }
    return false;
  })();
  const done = () => { _inflight = null; };
  _inflight.then(done, done);
  return _inflight;
}

export function autoSyncFromDevice() { return getScreenRotation(); }

export function installLandscapeAutoLock() {
  applyScreenRotation(getScreenRotation());
  if (!isTouchDevice()) return () => {};
  const run = () => { tryLandscapeLock().then(() => updateRotateHint()); };
  const opts = { once: true, passive: true };
  document.addEventListener('click', run, opts);
  document.addEventListener('touchend', run, opts);
  return () => {
    document.removeEventListener('click', run, opts);
    document.removeEventListener('touchend', run, opts);
  };
}
