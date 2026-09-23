/**
 * Force landscape on phones/tablets where the browser allows it.
 * Browsers only honor orientation.lock after a user gesture and often
 * only in fullscreen / installed PWA — we still try hard and keep a
 * full-screen rotate overlay when portrait.
 */

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
  // matchMedia is more reliable than width>height during rotate animation
  if (window.matchMedia) {
    return window.matchMedia('(orientation: landscape)').matches;
  }
  return window.innerWidth >= window.innerHeight;
}

export function isPortrait() {
  return !isLandscape();
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
  if (window.matchMedia) {
    try {
      window.matchMedia('(orientation: landscape)').addEventListener('change', fire);
    } catch (e) {
      /* older Safari */
    }
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
  const force = isTouchDevice() && isPortrait();
  hint.style.display = force ? 'flex' : 'none';
  hint.setAttribute('aria-hidden', force ? 'false' : 'true');
  document.body.classList.toggle('is-landscape', isLandscape());
  document.body.classList.toggle('is-portrait', isPortrait());
  document.body.classList.toggle('is-touch', isTouchDevice());
}

/**
 * Request landscape lock. Must be called from a user gesture when possible.
 * Tries: landscape → landscape-primary → fullscreen then lock.
 */
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

  // Some Android browsers only allow lock in fullscreen
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      if (await tryLock('landscape')) return true;
      if (await tryLock('landscape-primary')) return true;
    }
  } catch (e) {
    /* user denied fullscreen */
  }
  return false;
}

/** Bind first-tap lock on the whole document (once). */
export function installLandscapeAutoLock() {
  if (!isTouchDevice()) return () => {};

  const run = () => {
    tryLandscapeLock().then(() => updateRotateHint());
  };

  // Immediate attempt (may fail without gesture)
  run();

  const once = () => {
    run();
  };
  document.addEventListener('pointerdown', once, { passive: true });
  document.addEventListener('touchstart', once, { passive: true });
  document.addEventListener('click', once, { passive: true });

  // If user rotates back to portrait, re-prompt lock on next interaction
  onOrientationChange(() => {
    updateRotateHint();
    if (isPortrait()) {
      // soft retry after rotate settles
      setTimeout(() => tryLandscapeLock(), 400);
    }
  });

  return () => {
    document.removeEventListener('pointerdown', once);
    document.removeEventListener('touchstart', once);
    document.removeEventListener('click', once);
  };
}
