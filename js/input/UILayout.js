// Tata letak kontrol sentuh (drag, ukuran, transparansi, preset).
const KEY_PRESET = 'asap_ui_preset';
const KEY_LAYOUT = (n) => 'asap_ui_layout_' + n;

export const LAYOUT_ITEMS = [
  { id: 'touch-joy-base', label: 'Joystick', size: 110, joy: true },
  { id: 'touch-run', label: 'LARI', size: 64 },
  { id: 'touch-crouch', label: 'JONGKOK', size: 64 },
  { id: 'touch-flash', label: 'SENTER', size: 64 },
  { id: 'touch-lighter', label: 'KOREK', size: 64 },
  { id: 'touch-hide', label: 'SEMBUNYI', size: 64 },
  { id: 'touch-throw', label: 'LEMPAR', size: 64 },
  { id: 'touch-revive', label: 'AKSI', size: 64 },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ORIG = new WeakMap();

export const activePreset = () => localStorage.getItem(KEY_PRESET) || '1';

export function loadLayout(preset = activePreset()) {
  try {
    const raw = localStorage.getItem(KEY_LAYOUT(preset));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export function saveLayout(preset, cfg) {
  try {
    localStorage.setItem(KEY_LAYOUT(preset), JSON.stringify(cfg));
    localStorage.setItem(KEY_PRESET, preset);
  } catch (e) { /* privat / penuh */ }
}

export function resetLayoutDom(tc) {
  const els = [tc.joyZone, ...LAYOUT_ITEMS.map((it) => tc.el.querySelector('#' + it.id))];
  for (const el of els) {
    const o = el && ORIG.get(el);
    if (!o) continue;
    if (o.style == null) el.removeAttribute('style'); else el.setAttribute('style', o.style);
    if (o.parent && el.parentNode !== o.parent) o.parent.insertBefore(el, o.next);
    ORIG.delete(el);
  }
  if (tc.knob) tc.knob.removeAttribute('style');
}

function remember(el) {
  if (!ORIG.has(el)) {
    ORIG.set(el, { style: el.getAttribute('style'), parent: el.parentNode, next: el.nextSibling });
  }
}

export function applyLayout(tc, cfg = loadLayout()) {
  if (!cfg) { resetLayoutDom(tc); return; }
  const W = window.innerWidth, H = window.innerHeight;

  for (const it of LAYOUT_ITEMS) {
    const el = tc.el.querySelector('#' + it.id);
    const c = cfg[it.id];
    if (!el || !c) continue;
    remember(el);
    const size = Math.round(it.size * c.s);
    const cx = c.x * W, cy = c.y * H;

    if (it.joy) {
      const zone = tc.joyZone;
      remember(zone);
      const Z = Math.max(size * 3, 240);
      const zl = clamp(cx - Z / 2, 0, Math.max(0, W - Z));
      const zt = clamp(cy - Z / 2, 0, Math.max(0, H - Z));
      Object.assign(zone.style, {
        left: zl + 'px', top: zt + 'px', width: Z + 'px', height: Z + 'px', bottom: 'auto',
      });
      Object.assign(el.style, {
        left: cx - zl - size / 2 + 'px', top: cy - zt - size / 2 + 'px', bottom: 'auto',
        width: size + 'px', height: size + 'px', opacity: String(c.o),
      });
      const k = Math.round(size * 0.44);
      Object.assign(tc.knob.style, { width: k + 'px', height: k + 'px', margin: `${-k / 2}px 0 0 ${-k / 2}px` });
    } else {
      if (el.parentNode !== tc.el) tc.el.appendChild(el);
      Object.assign(el.style, {
        position: 'absolute', left: c.x * 100 + '%', top: c.y * 100 + '%',
        right: 'auto', bottom: 'auto', margin: '0',
        width: size + 'px', height: size + 'px',
        fontSize: Math.max(7, 9 * c.s) + 'px',
        transform: 'translate(-50%, -50%)', opacity: String(c.o),
      });
    }
  }
  tc._syncLayout?.();
}

function snapshotDefaults(tc) {
  resetLayoutDom(tc);
  const out = {};
  for (const it of LAYOUT_ITEMS) {
    const el = tc.el.querySelector('#' + it.id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const w = it.joy ? el.clientWidth : r.width;
    out[it.id] = {
      x: (r.left + r.width / 2) / window.innerWidth,
      y: (r.top + r.height / 2) / window.innerHeight,
      s: clamp(Math.round((w / it.size) * 20) / 20, 0.5, 1.8), o: 1,
    };
  }
  return out;
}

function injectCss() {
  if (document.getElementById('uie-css')) return;
  const s = document.createElement('style');
  s.id = 'uie-css';
  s.textContent = `
  #ui-editor{position:fixed;inset:0;z-index:10000;touch-action:none;
    background:rgba(0,0,0,.45) repeating-linear-gradient(0deg,rgba(255,255,255,.04) 0 1px,transparent 1px 32px),
    repeating-linear-gradient(90deg,rgba(255,255,255,.04) 0 1px,transparent 1px 32px)}
  .uie-panel{position:absolute;top:6px;left:50%;transform:translateX(-50%);width:min(92vw,430px);
    padding:8px 10px;border-radius:8px;background:rgba(14,22,40,.92);border:1px solid #3b5a8a;
    color:#dbe6ff;font:12px system-ui,sans-serif;z-index:2}
  .uie-row{display:flex;gap:6px;align-items:center;margin-bottom:6px}
  .uie-row select{flex:1;min-width:0;padding:5px;background:#0d1730;color:#dbe6ff;border:1px solid #3b5a8a;border-radius:4px;font-size:13px}
  .uie-row button{padding:6px 10px;border-radius:4px;border:1px solid #4a6aa0;background:#1b2f55;color:#dbe6ff;font-size:12px}
  .uie-row button.gold{background:#c9a227;color:#1a1200;border-color:#e6c34a;font-weight:700}
  .uie-row button.red{background:#7a2030;border-color:#b04058}
  .uie-name{font-weight:700;color:#ffd966;margin:2px 0 4px}
  .uie-panel label{display:flex;justify-content:space-between;margin-top:3px}
  .uie-panel input[type=range]{width:100%;margin:2px 0 4px}
  .uie-ghost{position:fixed;box-sizing:border-box;border:2px dashed rgba(255,255,255,.55);border-radius:50%;
    display:flex;align-items:flex-end;justify-content:center;touch-action:none;cursor:grab;z-index:1}
  .uie-ghost span{font:9px system-ui;color:#fff;background:rgba(0,0,0,.6);padding:0 3px;border-radius:3px;transform:translateY(120%);white-space:nowrap}
  .uie-ghost.sel{border:2px solid #ffd966;box-shadow:0 0 10px #ffd966}
  `;
  document.head.appendChild(s);
}

export function openLayoutEditor({ touch, TouchControls, root, onClose }) {
  if (document.getElementById('ui-editor')) return;
  injectCss();

  const temp = !touch;
  const tc = touch || new TouchControls(root || document.body, new Set(), () => {});
  const wasVisible = tc.el.classList.contains('visible');
  tc.show();

  let preset = activePreset();
  let cfg = null;
  let sel = LAYOUT_ITEMS[0].id;
  const ghosts = new Map();

  const ov = document.createElement('div');
  ov.id = 'ui-editor';
  ov.innerHTML = `
    <div class="uie-panel">
      <div class="uie-row">
        <select id="uie-preset">
          <option value="1">Preset 1</option><option value="2">Preset 2</option><option value="3">Preset 3</option>
        </select>
        <button id="uie-reset" type="button">Reset</button>
        <button id="uie-save" type="button" class="gold">Simpan</button>
        <button id="uie-quit" type="button" class="red">Keluar</button>
      </div>
      <div class="uie-name" id="uie-name"></div>
      <label><span>Ukuran</span><b id="uie-s-val"></b></label>
      <input id="uie-s" type="range" min="50" max="180" step="5">
      <label><span>Transparansi</span><b id="uie-o-val"></b></label>
      <input id="uie-o" type="range" min="20" max="100" step="5">
    </div>`;
  document.body.appendChild(ov);
  const $ = (id) => ov.querySelector('#' + id);

  function loadPreset(p) {
    preset = p;
    const saved = loadLayout(p);
    cfg = saved ? { ...snapshotDefaults(tc), ...saved } : snapshotDefaults(tc);
    applyLayout(tc, cfg);
    syncGhosts();
    refreshPanel();
  }

  function refreshPanel() {
    const c = cfg[sel];
    const it = LAYOUT_ITEMS.find((i) => i.id === sel);
    $('uie-name').textContent = it ? it.label : '';
    $('uie-s').value = Math.round(c.s * 100);
    $('uie-o').value = Math.round(c.o * 100);
    $('uie-s-val').textContent = Math.round(c.s * 100) + '%';
    $('uie-o-val').textContent = Math.round(c.o * 100) + '%';
    ghosts.forEach((g, id) => g.classList.toggle('sel', id === sel));
  }

  function syncGhosts() {
    for (const it of LAYOUT_ITEMS) {
      const el = tc.el.querySelector('#' + it.id);
      const g = ghosts.get(it.id);
      if (!el || !g) continue;
      const r = el.getBoundingClientRect();
      Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    }
  }

  for (const it of LAYOUT_ITEMS) {
    const g = document.createElement('div');
    g.className = 'uie-ghost';
    g.innerHTML = `<span>${it.label}</span>`;
    ov.appendChild(g);
    ghosts.set(it.id, g);
    let drag = null;
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sel = it.id;
      const r = g.getBoundingClientRect();
      drag = { dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2) };
      g.setPointerCapture(e.pointerId);
      refreshPanel();
    });
    g.addEventListener('pointermove', (e) => {
      if (!drag) return;
      cfg[it.id].x = clamp((e.clientX - drag.dx) / window.innerWidth, 0.04, 0.96);
      cfg[it.id].y = clamp((e.clientY - drag.dy) / window.innerHeight, 0.06, 0.94);
      applyLayout(tc, cfg);
      syncGhosts();
    });
    const end = () => { drag = null; };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
  }

  $('uie-s').addEventListener('input', (e) => {
    cfg[sel].s = Number(e.target.value) / 100;
    applyLayout(tc, cfg); syncGhosts(); refreshPanel();
  });
  $('uie-o').addEventListener('input', (e) => {
    cfg[sel].o = Number(e.target.value) / 100;
    applyLayout(tc, cfg); refreshPanel();
  });
  $('uie-preset').addEventListener('change', (e) => loadPreset(e.target.value));
  $('uie-reset').addEventListener('click', () => {
    cfg = snapshotDefaults(tc);
    localStorage.removeItem(KEY_LAYOUT(preset));
    applyLayout(tc, cfg); syncGhosts(); refreshPanel();
  });

  const onResize = () => { applyLayout(tc, cfg); syncGhosts(); };
  window.addEventListener('resize', onResize);

  function close(save) {
    window.removeEventListener('resize', onResize);
    if (save) saveLayout(preset, cfg);
    ov.remove();
    if (temp) tc.destroy?.();
    else {
      applyLayout(tc, loadLayout());
      if (!wasVisible) tc.hide();
    }
    onClose?.(save);
  }
  $('uie-save').addEventListener('click', () => close(true));
  $('uie-quit').addEventListener('click', () => close(false));

  $('uie-preset').value = preset;
  loadPreset(preset);
}
