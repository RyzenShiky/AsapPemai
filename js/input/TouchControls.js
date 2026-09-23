/**
 * Multi-touch: joystick + look + action buttons can run simultaneously.
 * Each finger is tracked by touch.identifier so one finger on joy
 * does not steal look, and buttons don't block either zone.
 */
export class TouchControls {
  constructor(rootEl, keys, onLook) {
    this.keys = keys;
    this.onLook = onLook;
    this.active = false;
    this.onFlashToggle = null;

    this._joyId = null;
    this._lookId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._lookLast = { x: 0, y: 0 };
    this._maxRadius = 48;

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
    this.onHide = null;
    this.onThrowBtn = null;

    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);

    // Capture on whole control layer so multi-touch is consistent
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

  /** Recalc joystick radius after rotate/resize */
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

    press(
      this.btnRun,
      () => setKey('ShiftLeft', true),
      () => setKey('ShiftLeft', false)
    );

    // Crouch = toggle
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

    this.btnHide.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.onHide) this.onHide();
    }, { passive: false });
    this.btnThrow.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.onThrowBtn) this.onThrowBtn();
    }, { passive: false });
    this.btnRevive.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.keys.add('KeyE');
      this.btnRevive.classList.add('active');
    }, { passive: false });
    this.btnRevive.addEventListener('touchend', () => {
      this.keys.delete('KeyE');
      this.btnRevive.classList.remove('active');
    });
    this.btnFlash.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.btnFlash.classList.toggle('active');
        if (typeof this.onFlashToggle === 'function') this.onFlashToggle();
      },
      { passive: false }
    );
  }

  _targetZone(x, y) {
    // Buttons first (small hit area)
    for (const btn of [this.btnRun, this.btnCrouch, this.btnFlash]) {
      const r = btn.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return 'btn';
    }
    const jr = this.joyZone.getBoundingClientRect();
    if (x >= jr.left && x <= jr.right && y >= jr.top && y <= jr.bottom) return 'joy';
    const lr = this.lookZone.getBoundingClientRect();
    if (x >= lr.left && x <= lr.right && y >= lr.top && y <= lr.bottom) return 'look';
    // Fallback: left half joy, right half look
    return x < window.innerWidth * 0.42 ? 'joy' : 'look';
  }

  _onStart(e) {
    if (!this.active) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const zone = this._targetZone(t.clientX, t.clientY);
      if (zone === 'btn') continue; // handled by button listeners

      if (zone === 'joy' && this._joyId == null) {
        this._joyId = t.identifier;
        const r = this.base.getBoundingClientRect();
        this._joyOrigin.x = r.left + r.width / 2;
        this._joyOrigin.y = r.top + r.height / 2;
        this._syncLayout();
        this._updateJoy(t.clientX, t.clientY);
      } else if (zone === 'look' && this._lookId == null) {
        this._lookId = t.identifier;
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
      } else if (zone === 'joy' && this._joyId == null) {
        this._joyId = t.identifier;
      } else if (this._lookId == null && zone !== 'joy') {
        this._lookId = t.identifier;
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
      }
    }
  }

  _onMove(e) {
    if (!this.active) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        this._updateJoy(t.clientX, t.clientY);
      } else if (t.identifier === this._lookId) {
        const dx = t.clientX - this._lookLast.x;
        const dy = t.clientY - this._lookLast.y;
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
        if (this.onLook) this.onLook(dx, dy);
      }
    }
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
    const dead = 0.22;

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
