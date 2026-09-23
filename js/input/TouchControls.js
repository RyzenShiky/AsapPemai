/**
 * Multi-touch: joystick (left) + look (right) + action buttons.
 * Look applies immediately with higher sensitivity for responsive camera.
 */
export class TouchControls {
  constructor(rootEl, keys, onLook) {
    this.keys = keys;
    this.onLook = onLook;
    this.active = false;
    this.onFlashToggle = null;
    this.onHide = null;
    this.onThrowBtn = null;

    this._joyId = null;
    this._lookId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._lookLast = { x: 0, y: 0 };
    this._maxRadius = 48;
    // Higher = snappier look (was feeling heavy at ~0.003)
    this.lookScale = 1.65;

    this.el = document.createElement('div');
    this.el.id = 'touch-controls';
    this.el.innerHTML = `
      <div id="touch-joy-zone">
        <div id="touch-joy-base"><div id="touch-joy-knob"></div></div>
      </div>
      <div id="touch-look-zone"></div>
      <div id="touch-actions">
        <button type="button" id="touch-hide" aria-label="Hide">HIDE</button>
        <button type="button" id="touch-throw" aria-label="Throw">THROW</button>
        <button type="button" id="touch-flash" aria-label="Flashlight">LIGHT</button>
        <button type="button" id="touch-crouch" aria-label="Crouch">CROUCH</button>
        <button type="button" id="touch-run" aria-label="Run">RUN</button>
        <button type="button" id="touch-revive" aria-label="Revive">E</button>
      </div>
    `;
    rootEl.appendChild(this.el);

    this.knob = this.el.querySelector('#touch-joy-knob');
    this.base = this.el.querySelector('#touch-joy-base');
    this.joyZone = this.el.querySelector('#touch-joy-zone');
    this.lookZone = this.el.querySelector('#touch-look-zone');
    this.btnRun = this.el.querySelector('#touch-run');
    this.btnCrouch = this.el.querySelector('#touch-crouch');
    this.btnFlash = this.el.querySelector('#touch-flash');
    this.btnHide = this.el.querySelector('#touch-hide');
    this.btnThrow = this.el.querySelector('#touch-throw');
    this.btnRevive = this.el.querySelector('#touch-revive');

    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);

    this.el.addEventListener('touchstart', this._onStart, { passive: false });
    this.el.addEventListener('touchmove', this._onMove, { passive: false });
    this.el.addEventListener('touchend', this._onEnd, { passive: false });
    this.el.addEventListener('touchcancel', this._onEnd, { passive: false });

    this._bindButtons();
  }

  show() {
    this.el.classList.add('visible');
    this.active = true;
    this._syncLayout();
  }

  hide() {
    this.el.classList.remove('visible');
    this.active = false;
    this._releaseAll();
  }

  _syncLayout() {
    const r = this.base.getBoundingClientRect();
    this._maxRadius = Math.max(36, Math.min(r.width, r.height) * 0.42);
  }

  _bindButtons() {
    const setKey = (code, on) => {
      if (on) this.keys.add(code);
      else this.keys.delete(code);
    };

    const press = (btn, down, up) => {
      const start = (e) => {
        e.preventDefault();
        e.stopPropagation();
        down();
        btn.classList.add('active');
      };
      const end = (e) => {
        e.preventDefault();
        e.stopPropagation();
        up();
        btn.classList.remove('active');
      };
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', end, { passive: false });
      btn.addEventListener('touchcancel', end, { passive: false });
    };

    press(this.btnRun, () => setKey('ShiftLeft', true), () => setKey('ShiftLeft', false));

    this.btnCrouch.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.keys.has('KeyC')) {
          this.keys.delete('KeyC');
          this.btnCrouch.classList.remove('active');
        } else {
          this.keys.add('KeyC');
          this.btnCrouch.classList.add('active');
        }
      },
      { passive: false }
    );

    this.btnHide.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onHide) this.onHide();
      },
      { passive: false }
    );
    this.btnThrow.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onThrowBtn) this.onThrowBtn();
      },
      { passive: false }
    );
    this.btnRevive.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.keys.add('KeyE');
        this.btnRevive.classList.add('active');
      },
      { passive: false }
    );
    this.btnRevive.addEventListener('touchend', () => {
      this.keys.delete('KeyE');
      this.btnRevive.classList.remove('active');
    });
    this.btnFlash.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onFlashToggle) this.onFlashToggle();
      },
      { passive: false }
    );
  }

  _touchIn(el, t) {
    const r = el.getBoundingClientRect();
    return t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
  }

  _onStart(e) {
    for (const t of e.changedTouches) {
      if (this._touchIn(this.btnRun, t) || this._touchIn(this.btnCrouch, t) ||
          this._touchIn(this.btnFlash, t) || this._touchIn(this.btnHide, t) ||
          this._touchIn(this.btnThrow, t) || this._touchIn(this.btnRevive, t)) {
        continue;
      }
      if (this._joyId == null && this._touchIn(this.joyZone, t)) {
        e.preventDefault();
        this._joyId = t.identifier;
        const br = this.base.getBoundingClientRect();
        this._joyOrigin.x = br.left + br.width / 2;
        this._joyOrigin.y = br.top + br.height / 2;
        this._updateJoy(t.clientX, t.clientY);
      } else if (this._lookId == null) {
        e.preventDefault();
        this._lookId = t.identifier;
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
      }
    }
  }

  _onMove(e) {
    let needPrevent = false;
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        needPrevent = true;
        this._updateJoy(t.clientX, t.clientY);
      } else if (t.identifier === this._lookId) {
        needPrevent = true;
        const dx = (t.clientX - this._lookLast.x) * this.lookScale;
        const dy = (t.clientY - this._lookLast.y) * this.lookScale;
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
        if (this.onLook && (dx || dy)) this.onLook(dx, dy);
      }
    }
    if (needPrevent) e.preventDefault();
  }

  _onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        this._joyId = null;
        this._clearMoveKeys();
        this.knob.style.transform = 'translate(0px, 0px)';
      }
      if (t.identifier === this._lookId) {
        this._lookId = null;
      }
    }
  }

  _updateJoy(cx, cy) {
    const max = this._maxRadius;
    let dx = cx - this._joyOrigin.x;
    let dy = cy - this._joyOrigin.y;
    const len = Math.hypot(dx, dy) || 1;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / max;
    const ny = dy / max;
    const dead = 0.18;

    this._clearMoveKeys();
    if (ny < -dead) this.keys.add('KeyW');
    if (ny > dead) this.keys.add('KeyS');
    if (nx < -dead) this.keys.add('KeyA');
    if (nx > dead) this.keys.add('KeyD');
  }

  _clearMoveKeys() {
    this.keys.delete('KeyW');
    this.keys.delete('KeyS');
    this.keys.delete('KeyA');
    this.keys.delete('KeyD');
  }

  _releaseAll() {
    this._joyId = null;
    this._lookId = null;
    this._clearMoveKeys();
    this.keys.delete('ShiftLeft');
    this.knob.style.transform = 'translate(0px, 0px)';
    this.btnRun.classList.remove('active');
  }
}
