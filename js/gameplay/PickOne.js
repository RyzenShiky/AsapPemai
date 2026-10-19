import { ROSTER } from '../core/MonsterTypes.js';
import { DOORS } from '../core/Buildings.js';

export const PICK = {
  MIN_PLAYERS: 3,
  LOAD_GRACE_MS: 7000,
  SPIN_MS: 5500,
  CHOOSE_MS: 15000,
  HIDE_MS: 60000,
  HUNT_MS: 300000,
  MONSTER_SPEED_MUL: 1.12,
  ATTACK_CD_MS: 900,
};

const LABEL = { shadow: 'Shadow', smily: 'Smily', boiled: 'Boiled One', siren: 'Siren Head', locust: 'Locust' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const big = (t) => `<div style="font-size:clamp(28px,6vw,64px);font-weight:700;letter-spacing:.06em">${t}</div>`;
const small = (t) => `<div style="font-size:clamp(14px,2.4vw,22px);opacity:.85;margin-top:8px">${t}</div>`;
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class PickOne {
  constructor({ room, state, controllers }) {
    this.room = room;
    this.state = state;
    this.controllers = controllers;
    this._phase = null;
    this._lock = null;
    this._lastAct = 0;
    this._actSeen = -1;
    this._advKey = null;
    this._ended = false;
    state._pickOneOn = true;
    this._buildUI();
    this._onDown = (e) => {
      if (e.button === 0 && this.isMonster() && this.pk?.phase === 'hunt') this.attack();
    };
    addEventListener('mousedown', this._onDown);
  }

  get pk() { return this.room.remotePick || null; }
  now() { return this.room.serverNow(); }
  name(uid) { return this.room.remotePlayers?.[uid]?.name || 'Player'; }

  isMonster() {
    const p = this.pk;
    return !!p && p.target === this.room.uid && (p.phase === 'hide' || p.phase === 'hunt');
  }

  async hostBegin() {
    const r = this.room;
    if (!r.isHost) return;
    const uids = Object.keys(r.remotePlayers || {});
    if (uids.length < PICK.MIN_PLAYERS) return;
    await r.clearPick();
    const t0 = this.now() + PICK.LOAD_GRACE_MS;
    await r.writePick({
      phase: 'spin',
      order: shuffle([...uids]),
      target: uids[(Math.random() * uids.length) | 0],
      at: t0,
      until: t0 + PICK.SPIN_MS,
    });
  }

  _advance(pk, patch) {
    if (this._advKey === pk.t) return;
    this._advKey = pk.t;
    this.room.writePick({ ...pk, ...patch }).catch(() => { this._advKey = null; });
  }

  _alive(pk) {
    return Object.entries(this.room.remotePlayers || {}).filter(([u, p]) => u !== pk.target && p.alive !== false).length;
  }

  _hostTick(pk, now) {
    const r = this.room;
    switch (pk.phase) {
      case 'spin':
        if (now >= pk.until) this._advance(pk, { phase: 'choose', until: now + PICK.CHOOSE_MS });
        break;
      case 'choose': {
        const c = r.remotePickChoice?.[pk.target];
        if (c || now >= pk.until) {
          const random = !c || !ROSTER.includes(c.type);
          const type = random ? ROSTER[(Math.random() * ROSTER.length) | 0] : c.type;
          this._advance(pk, { phase: 'hide', type, random, until: now + PICK.HIDE_MS });
        }
        break;
      }
      case 'hide':
        if (now >= pk.until) this._advance(pk, { phase: 'hunt', until: now + PICK.HUNT_MS });
        break;
      case 'hunt':
        this._hunt(pk, now);
        break;
      case 'over':
        if (!this._ended) {
          this._ended = true;
          const prog = this.state.data.progress;
          prog.gameOver = true;
          prog.win = !!pk.hidersWin;
          for (const m of this.state.data.monsters) { m.possessed = false; m.active = false; }
        }
        break;
    }
  }

  _end(pk, hidersWin, text) {
    this._advance(pk, { phase: 'over', hidersWin, text });
  }

  _hunt(pk, now) {
    const r = this.room, st = this.state, mons = st.data.monsters;
    const idx = ROSTER.indexOf(pk.type);
    const m = mons[idx];
    if (!m) return;
    let src;
    if (pk.target === r.uid) {
      const p = st.data.player;
      src = { x: p.position.x, z: p.position.z, y: p.position.y - 1.7, yaw: p.rotation.yaw };
    } else {
      const p = r.remotePlayers[pk.target];
      if (!p) return this._end(pk, true, 'Monster keluar dari game. Yang bersembunyi selamat!');
      src = { x: p.x, z: p.z, y: p.footY ?? p.y - 1.7, yaw: p.yaw || 0 };
    }

    const moved = Math.hypot(src.x - m.position.x, src.z - m.position.z);
    m.possessed = true;
    m.active = true;
    m.position.x = src.x;
    m.position.z = src.z;
    m.position.y = Math.max(0, src.y);
    m.rotation.yaw = src.yaw;
    m.aiState = moved > 0.02 ? 'CHASE' : 'PATROL';
    m.memory.suspicion = 0;
    mons.forEach((o, i) => { if (i !== idx) { o.active = false; o.possessed = false; } });

    const ctl = this.controllers()[idx];
    const act = r.remotePickAct?.[pk.target];
    if (act && act.n !== this._actSeen) {
      this._actSeen = act.n;
      if (ctl && act.k === 'atk' && ctl.attackCooldown <= 0) {
        m.aiState = 'CHASE';
        ctl._tryAttack(m);
        if (ctl.attackCooldown <= 0) ctl.attackCooldown = 1;
      } else if (ctl && act.k === 'door' && !ctl._br) {
        const d = DOORS.find((x) => x.id === act.id);
        if (d && !d.open && !d.broken && Math.hypot(d.x - m.position.x, d.z - m.position.z) < 3.5) {
          if (typeof ctl._breachStart === 'function') ctl._breachStart(m, d);
          else {
            d.broken = true;
            d.open = true;
            st._doorFx?.(d, 'break', 0, 1);
          }
        }
      }
    }

    if (this._alive(pk) === 0) return this._end(pk, false, 'Semua pemain tertangkap. Monster menang!');
    if (now >= pk.until) return this._end(pk, true, 'Waktu habis. Yang bersembunyi selamat!');
  }

  attack() {
    const t = performance.now();
    if (t - this._lastAct < PICK.ATTACK_CD_MS) return;
    this._lastAct = t;
    this.room.writePickAct('atk');
  }

  doorBreach(id) {
    this.room.writePickAct('door', id);
  }

  _clientTick(pk) {
    const p = this.state.data.player;
    const mine = pk.target === this.room.uid;
    const idx = ROSTER.indexOf(pk.type);
    for (const m of this.state.data.monsters) m.hideFromSelf = false;
    if (mine && idx >= 0 && (pk.phase === 'hide' || pk.phase === 'hunt')) {
      const m = this.state.data.monsters[idx];
      if (m) m.hideFromSelf = true;
    }
    if (mine && pk.phase === 'hide') {
      this._lock ||= { x: p.position.x, z: p.position.z };
      p.position.x = this._lock.x;
      p.position.z = this._lock.z;
      p.isRunning = false;
    } else {
      this._lock = null;
    }
    p._speedMul = mine && pk.phase === 'hunt' ? PICK.MONSTER_SPEED_MUL : 1;
    if (pk.phase !== this._phase) {
      this._phase = pk.phase;
      if (pk.phase === 'choose' && mine) document.exitPointerLock?.();
    }
  }

  tick() {
    const pk = this.pk, st = this.state;
    st._pickMonsterUid = pk && ['hide', 'hunt', 'over'].includes(pk.phase) ? pk.target : null;
    if (!pk) { this._render(null); return; }
    const now = this.now();
    this._clientTick(pk);
    if (this.room.isHost) this._hostTick(pk, now);
    this._render(pk, now);
  }

  _buildUI() {
    const el = document.createElement('div');
    el.id = 'pick-ui';
    el.style.cssText = 'position:fixed;inset:0;z-index:60;pointer-events:none;color:#eee;display:none;font-family:inherit';
    el.innerHTML =
      '<div data-k="cover" style="position:absolute;inset:0;background:#000;opacity:0;transition:opacity .4s"></div>' +
      '<div data-k="main" style="position:absolute;left:0;right:0;top:12%;text-align:center;text-shadow:0 2px 12px #000"></div>' +
      '<div data-k="choices" style="position:absolute;left:0;right:0;top:40%;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;pointer-events:auto"></div>' +
      '<button data-k="atk" style="display:none;position:absolute;right:6%;bottom:18%;width:92px;height:92px;border-radius:50%;border:2px solid #b22;background:#400a;color:#fff;font-size:15px;pointer-events:auto">SERANG</button>';
    document.body.appendChild(el);
    this.$ = {};
    el.querySelectorAll('[data-k]').forEach((n) => { this.$[n.dataset.k] = n; });
    this.$.root = el;
    this.$.atk.addEventListener('pointerdown', (e) => { e.preventDefault(); this.attack(); });
  }

  _render(pk, now) {
    const u = this.$;
    if (!pk) { u.root.style.display = 'none'; return; }
    u.root.style.display = 'block';
    const mine = pk.target === this.room.uid;
    const left = (pk.until ?? 0) - now;
    let html = '', cover = 0, atk = false, choices = null;

    switch (pk.phase) {
      case 'spin': {
        const t = now - pk.at;
        if (t < 0) {
          html = big('Bersiap…') + small(`Pengundian monster dimulai ${Math.ceil(-t / 1000)} dtk lagi`);
          break;
        }
        const p = Math.min(1, t / PICK.SPIN_MS);
        const n = pk.order.length;
        const steps = n * 6 + pk.order.indexOf(pk.target);
        const shown = p < 1 ? pk.order[Math.floor((1 - Math.pow(1 - p, 3)) * steps) % n] : pk.target;
        html = big(esc(this.name(shown))) +
          small(p < 1 ? 'Memilih siapa yang jadi monster…' : mine ? 'KAMU JADI MONSTER!' : `${esc(this.name(pk.target))} jadi monster!`);
        break;
      }
      case 'choose':
        if (mine) {
          html = big('Pilih monstermu') + small(`Sisa ${Math.ceil(left / 1000)} dtk, atau biarkan acak`);
          choices = [...ROSTER.map((t) => [t, LABEL[t] || t]), ['random', '🎲 ACAK']];
        } else {
          html = big(`${esc(this.name(pk.target))} memilih monster…`) + small(`${Math.ceil(left / 1000)}`);
        }
        break;
      case 'hide':
        if (mine) {
          cover = 1;
          html = big(`Kamu: ${LABEL[pk.type] || esc(pk.type)}${pk.random ? ' 🎲' : ''}`) + small(`Mereka sedang bersembunyi… ${mmss(left)}`);
        } else {
          html = big('SEMBUNYI!') + small(`Monster dilepas dalam ${mmss(left)}`);
        }
        break;
      case 'hunt':
        html = small(mine
          ? `Mangsa tersisa: ${this._alive(pk)} • ${mmss(left)} • E dekat pintu = bobol`
          : `Bertahan hidup: ${mmss(left)} • Monster: ${LABEL[pk.type] || esc(pk.type)}`);
        atk = mine;
        break;
      case 'over':
        html = big(pk.hidersWin ? 'PEMAIN SELAMAT' : 'MONSTER MENANG') + small(esc(pk.text || ''));
        break;
    }

    if (u._html !== html) { u.main.innerHTML = html; u._html = html; }
    u.cover.style.opacity = cover;
    u.atk.style.display = atk ? 'block' : 'none';
    const ck = choices ? choices.map((c) => c[0]).join() : '';
    if (u._ck !== ck) {
      u._ck = ck;
      u.choices.innerHTML = '';
      (choices || []).forEach(([k, label]) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'padding:14px 20px;font-size:18px;background:#1b1b1bcc;color:#fff;border:1px solid #777;border-radius:8px;cursor:pointer';
        b.onclick = () => this.room.writePickChoice(k);
        u.choices.appendChild(b);
      });
    }
  }

  dispose() {
    removeEventListener('mousedown', this._onDown);
    this.$?.root?.remove();
    this.state._pickOneOn = false;
    this.state._pickMonsterUid = null;
    const p = this.state.data.player;
    if (p) p._speedMul = 1;
    for (const m of this.state.data.monsters) { m.hideFromSelf = false; m.possessed = false; }
  }
}
