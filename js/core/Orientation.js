/**
 * Landscape lock + manual screen rotation (for devices that report upside-down).
 */

const ROT_KEY = 'longway_screen_rot';

export function isTouchDevice() {
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent)
  );
}

export function isLandscape() {
  if (screen.orientation?.type) {
    return screen.orientation.type.startsWith('landscape');
  }
  if (window.matchMedia) {
    return window.matchMedia('(orientation: landscape)').matches;
  }
  return window.innerWidth >= window.innerHeight;
}

export function isPortrait() {
  return !isLandscape();
}

export function getScreenRotation() {
  const n = parseInt(localStorage.getItem(ROT_KEY) || '0', 10);
  return [0, 90, 180, 270].includes(n) ? n : 0;
}

export function setScreenRotation(deg) {
  const d = ((deg % 360) + 360) % 360;
  localStorage.setItem(ROT_KEY, String(d));
  applyScreenRotation(d);
  return d;
}

export function cycleScreenRotation() {
  const next = (getScreenRotation() + 90) % 360;
  return setScreenRotation(next);
}

export function applyScreenRotation(deg = getScreenRotation()) {
  const app = document.getElementById('app');
  const hint = document.getElementById('rotate-hint');
  document.body.classList.remove('rot-0', 'rot-90', 'rot-180', 'rot-270');
  document.body.classList.add('rot-' + deg);
  if (app) {
    app.style.transform = deg ? 'rotate(' + deg + 'deg)' : '';
    // When rotated 90/270, swap visual viewport sizing
    if (deg === 90 || deg === 270) {
      app.style.width = '100vh';
      app.style.height = '100vw';
      app.style.transformOrigin = 'center center';
      app.style.position = 'fixed';
      app.style.left = '50%';
      app.style.top = '50%';
      app.style.marginLeft = 'calc(-50vh)';
      app.style.marginTop = 'calc(-50vw)';
    } else if (deg === 180) {
      app.style.width = '100%';
      app.style.height = '100%';
      app.style.left = '0';
      app.style.top = '0';
      app.style.marginLeft = '0';
      app.style.marginTop = '0';
      app.style.position = 'relative';
      app.style.transformOrigin = 'center center';
    } else {
      app.style.width = '';
      app.style.height = '';
      app.style.left = '';
      app.style.top = '';
      app.style.marginLeft = '';
      app.style.marginTop = '';
      app.style.position = '';
      app.style.transformOrigin = '';
    }
  }
  // Keep rotate-hint readable (counter-rotate label only if needed)
  if (hint) {
    hint.style.transform = '';
  }
}

export function onOrientationChange(cb) {
  const fire = () => {
    cb({
      landscape: isLandscape(),
      width: window.innerWidth,
      height: window.innerHeight,
      angle: screen.orientation?.angle ?? 0,
    });
  };
  window.addEventListener('resize', fire);
  window.addEventListener('orientationchange', fire);
  if (screen.orientation?.addEventListener) {
    screen.orientation.addEventListener('change', fire);
  }
  fire();
  return () => {
    window.removeEventListener('resize', fire);
    window.removeEventListener('orientationchange', fire);
  };
}

export function updateRotateHint() {
  const hint = document.getElementById('rotate-hint');
  if (!hint) return;
  // Manual rotation can make "portrait" still usable — only force overlay if
  // true portrait AND user has not applied a 90/270 correction.
  const rot = getScreenRotation();
  const force = isTouchDevice() && isPortrait() && rot !== 90 && rot !== 270;
  hint.style.display = force ? 'flex' : 'none';
  hint.setAttribute('aria-hidden', force ? 'false' : 'true');
  document.body.classList.toggle('is-landscape', isLandscape() || rot === 90 || rot === 270);
  document.body.classList.toggle('is-portrait', isPortrait() && rot !== 90 && rot !== 270);
  document.body.classList.toggle('is-touch', isTouchDevice());
  applyScreenRotation(rot);
}

export async function tryLandscapeLock() {
  if (!isTouchDevice()) return false;
  const o = screen.orientation;
  if (!o || typeof o.lock !== 'function') return false;
  const tryLock = async (mode) => {
    try {
      await o.lock(mode);
      return true;
    } catch (e) {
      return false;
    }
  };
  if (await tryLock('landscape')) return true;
  if (await tryLock('landscape-primary')) return true;
  if (await tryLock('landscape-secondary')) return true;
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      if (await tryLock('landscape')) return true;
      if (await tryLock('landscape-primary')) return true;
    }
  } catch (e) {
    /* denied */
  }
  return false;
}

/** Map device angle → CSS rotate so "upside down landscape" is corrected. */
export function autoSyncFromDevice() {
  // Only auto when user hasn't chosen a manual override this session
  if (window.__longwayManualRot) return getScreenRotation();
  const angle = screen.orientation?.angle;
  if (typeof angle !== 'number') return getScreenRotation();
  // 180 = upside-down landscape / portrait — flip CSS
  let want = 0;
  if (angle === 180) want = 180;
  else if (angle === 90) want = 0; // normal landscape-primary
  else if (angle === 270) want = 0; // landscape-secondary (CSS lock handles)
  else if (angle === 0 && isPortrait()) want = 0;
  return setScreenRotation(want);
}

export function installLandscapeAutoLock() {
  if (!isTouchDevice()) {
    applyScreenRotation(getScreenRotation());
    return () => {};
  }
  applyScreenRotation(getScreenRotation());
  autoSyncFromDevice();
  const run = () => {
    tryLandscapeLock().then(() => updateRotateHint());
  };
  run();
  const once = () => run();
  document.addEventListener('pointerdown', once, { passive: true });
  document.addEventListener('touchstart', once, { passive: true });
  document.addEventListener('click', once, { passive: true });
  onOrientationChange(() => {
    autoSyncFromDevice();
    updateRotateHint();
    if (isPortrait()) setTimeout(() => tryLandscapeLock(), 400);
  });
  return () => {
    document.removeEventListener('pointerdown', once);
    document.removeEventListener('touchstart', once);
    document.removeEventListener('click', once);
  };
}
