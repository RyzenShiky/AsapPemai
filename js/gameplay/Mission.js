import { countOf } from './Items.js';
import { binds, keyLabel } from '../input/Bindings.js';
import { cellPath } from '../core/Level.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const CELL = 4.8;
const cc = (i, j, r = 2.2) => ({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, r });

export const MISSIONS = {
  world: {
    id: 'westwood_last_signal', version: 1, title: 'Sinyal Terakhir', compass: true,
    anchors: {
      generator: { x: 210, z: -110, r: 6, label: 'Generator (Power Station)' },
      extract: { x: 0, z: 8, r: 12, label: 'Titik evakuasi' },
    },
    story: {
      intro: [
        'Mobil kalian mogok di jalan masuk Westwood. Kota ini dikosongkan semalam.',
        'Radio menyala sendiri. Satu suara, diulang-ulang: "Ini Rani, Stasiun Listrik. Siapa pun... nyalakan generator."',
        'Tanpa listrik, pemancar darurat mati. Tanpa pemancar, tidak ada yang tahu kalian di sini.',
      ],
      start: { power: ['Cari bensin. Generator ada di luar pintu barat Stasiun Listrik, sisi timur kota.'],
        escape: ['Kembali ke jalan tempat mobil kalian. Semua harus sampai.'] },
      done: { power: ['Generator menyala. Lampu stasiun hidup, dan sesuatu di dalam kabut menoleh ke arah suaranya.',
        'Rani: "Kalian terlalu keras... pulang ke jalan. Sekarang."'] },
      ending: ['Pemancar menyala. Satu pesan terkirim: "Kami masih di sini."',
        'Di ujung siaran, Rani berbisik: "Jangan percaya pintu yang tidak ada di peta."',
        'Episode 2 terbuka: No Way Back.'],
    },
    steps: [
      { id: 'power', kind: 'deposit', anchor: 'generator', item: 'fuel', required: 2,
        title: 'Nyalakan generator', prompt: 'Isi bensin',
        find: 'Cari bensin di peti, rumah, atau tepi jalan. Butuh 2 untuk tim.',
        hint: 'Bawa bensin ke generator di sisi timur peta.' },
      { id: 'escape', kind: 'gather', anchor: 'extract', surge: true,
        title: 'Kembali ke titik evakuasi',
        hint: 'Suara generator memancing monster. Kumpulkan seluruh tim di jalan dekat titik awal.' },
    ],
  },
  backrooms0: {
    id: 'backrooms_no_way_back', version: 1, title: 'No Way Back', compass: false,
    anchors: { p1: cc(9, 6), p2: cc(-8, 14), p3: cc(16, -7), exit: cc(-18, -12, 3) },
    story: {
      intro: [
        'Pintu stasiun menutup di belakang kalian. Lorong kuning, dengung lampu, tidak ada jendela.',
        'Dari speaker langit-langit: "Hidupkan semua panel. Pintu keluar hanya muncul kalau listrik penuh."',
      ],
      start: { panels: ['Cari panel dengan lampu berkedip. Bagi tugas dengan timmu.'],
        exit: ['Listrik penuh. Di suatu tempat sebuah pintu terbuka, dan sesuatu terbangun karenanya.'] },
      logs: {
        p1: ['Catatan panel 1: "Hari 3. Kabut mengikuti suara mesin. Rani."'],
        p2: ['Catatan panel 2: "Hari 5. Pintu stasiun tidak pernah mengarah ke tempat yang sama dua kali."'],
        p3: ['Catatan panel 3: "Hari 6. Kalau kamu membaca ini, aku berhasil keluar. Ikuti dengung yang makin rendah."'],
      },
      ending: ['Cahaya fajar menembus pintu. Westwood, jalan yang sama, mobil yang sama.',
        'Di dashboard ada catatan tulisan tangan Rani. Tanggalnya besok.'],
    },
    steps: [
      { id: 'panels', kind: 'activate', anchors: ['p1', 'p2', 'p3'], prompt: 'Aktifkan panel',
        title: 'Pulihkan 3 panel listrik', hint: 'Cari panel dengan lampu berkedip. Bagi tugas dengan timmu.' },
      { id: 'exit', kind: 'gather', anchor: 'exit', surge: true,
        title: 'Temukan pintu keluar', hint: 'Listrik kembali dan sesuatu terbangun. Semua harus sampai di pintu.' },
    ],
  },
};

export function validateAnchors(def, from = { x: 5, z: 8 }) {
  const bad = [];
  for (const [id, a] of Object.entries(def.anchors)) {
    const p = cellPath(from, a, 3000);
    const last = p?.[p.length - 1];
    if (!last || dist(last, a) > 0.01) bad.push(id);
  }
  return bad;
}

export class Subtitles {
  constructor(hud) {
    this.el = document.createElement('div');
    this.el.id = 'story-sub';
    this.el.className = 'hidden';
    (hud || document.body).append(this.el);
    this.q = [];
    this.t = 0;
  }
  say(lines) { for (const l of lines || []) this.q.push(l); }
  update(dt) {
    if (this.t > 0) {
      this.t -= dt;
      if (this.t > 0) return;
      if (!this.q.length) this.el.classList.add('hidden');
    }
    const n = this.q.shift();
    if (!n) return;
    this.el.textContent = n;
    this.el.classList.remove('hidden');
    this.t = Math.max(3, n.length * 0.055);
  }
  dispose() { this.el.remove(); }
}

class MissionUI {
  constructor(hud) {
    this.root = document.createElement('div');
    this.root.id = 'mission-hud';
    this.root.className = 'hidden';
    this.root.innerHTML = '<div class="m-kicker"></div><div class="m-title"></div><div class="m-text"></div>'
      + '<div class="m-bar"><i></i></div><div class="m-foot"><span class="m-arrow">▲</span><span class="m-dist"></span></div>';
    this.prompt = document.createElement('div');
    this.prompt.id = 'mission-prompt';
    this.prompt.className = 'hidden';
    (hud || document.body).append(this.root, this.prompt);
    this.q = (s) => this.root.querySelector(s);
  }
  set(v) {
    this.root.classList.remove('hidden');
    this.q('.m-kicker').textContent = v.kicker;
    this.q('.m-title').textContent = v.title;
    this.q('.m-text').textContent = v.text;
    this.q('.m-bar i').style.width = `${Math.round(v.pct * 100)}%`;
    this.q('.m-dist').textContent = v.dist ?? '';
    const ar = this.q('.m-arrow');
    ar.style.visibility = v.deg == null ? 'hidden' : 'visible';
    if (v.deg != null) ar.style.transform = `rotate(${v.deg}deg)`;
    this.prompt.textContent = v.prompt || '';
    this.prompt.classList.toggle('hidden', !v.prompt);
  }
  hide() { this.root.classList.add('hidden'); this.prompt.classList.add('hidden'); }
  dispose() { this.root.remove(); this.prompt.remove(); }
}

export class Mission {
  constructor(def, io) {
    this.def = def;
    this.io = io;
    this.s = this._fresh();
    this.pending = null;
    this._owned = false;
    this._eLatch = false;
    this._gAcc = 0;
    this._rAcc = 0;
    this.ui = new MissionUI(document.getElementById('hud'));
  }

  _fresh() {
    return { v: this.def.version, step: 0, count: 0, done: {}, contrib: {}, ack: {}, complete: false, story: !!this.io.story?.(), rev: Date.now() };
  }
  get active() { return this.io.isHost() ? this.io.enabled() : !!this.io.remote(); }
  step() { return this.def.steps[this.s.step] || null; }
  _need(st) { return st.kind === 'deposit' ? st.required : st.kind === 'activate' ? st.anchors.length : 1; }
  _say(lines) { if (this.s.story && lines?.length) this.io.say?.(lines); }
  _narrate(prevId, nextId) {
    const st = this.def.story;
    this._say(st?.done?.[prevId]);
    this._say(st?.start?.[nextId]);
  }
  doneIds() {
    const ids = {};
    this.def.steps.forEach((st, i) => {
      if (i < this.s.step || this.s.complete) (st.anchors || [st.anchor]).forEach((a) => { if (a) ids[a] = 1; });
    });
    Object.keys(this.s.done || {}).forEach((a) => { ids[a] = 1; });
    return ids;
  }
  _commit() { this.s.rev++; this.io.publish(this.s); }

  start() {
    this.s = this._fresh();
    this.pending = null;
    this._owned = this.io.isHost();
    if (!this._owned) this.s.rev = 0;
    if (this._owned && this.active) {
      this.io.publish(this.s);
      this._intro = true;
      this._say([...(this.def.story?.intro || []), ...(this.def.story?.start?.[this.def.steps[0].id] || [])]);
    }
  }

  update(dt) {
    if (!this.active) { this.ui.hide(); return; }
    if (this.io.isHost()) this._hostTick(dt); else this._clientTick();
    this._input();
    this._rAcc += dt;
    if (this._rAcc >= 0.2) { this._rAcc = 0; this._render(); }
  }

  _hostTick(dt) {
    if (!this._owned) {
      const r = this.io.remote();
      if (r && r.v === this.def.version) this._adopt(r, false);
      this._owned = true;
    }
    let changed = false;
    for (const [uid, a] of Object.entries(this.io.acts())) {
      if (uid === this.io.uid() || !a) continue;
      if (a.n <= (this.s.ack[uid]?.n ?? 0)) continue;
      const p = this.io.players().find((q) => q.uid === uid);
      this.s.ack[uid] = { n: a.n, ok: this._apply(uid, a.target, p) };
      changed = true;
    }
    this._gAcc += dt;
    if (!this.s.complete && this._gAcc >= 0.25) {
      this._gAcc = 0;
      if (this._gatherDone()) { this.s.complete = true; changed = true; this._say(this.def.story?.ending); this.io.onComplete(); }
    }
    if (changed) this._commit();
  }

  _apply(uid, target, p) {
    const st = this.step(), a = this.def.anchors[target];
    if (!st || this.s.complete || !a || !p?.alive || dist(p, a) > a.r + 3) return false;
    const need = this._need(st);
    if (st.kind === 'deposit') {
      if (st.anchor !== target || this.s.count >= need) return false;
    } else if (st.kind === 'activate') {
      if (!st.anchors.includes(target) || this.s.done[target]) return false;
      this.s.done[target] = uid;
    } else return false;
    this.s.count++;
    this.s.contrib[uid] = (this.s.contrib[uid] || 0) + 1;
    if (this.s.count >= need) this._advance();
    return true;
  }

  _advance() {
    const prevId = this.step()?.id;
    this.s.step++;
    this.s.count = 0;
    this.s.done = {};
    const st = this.step();
    this._narrate(prevId, st?.id);
    if (st) this.io.onStep(st);
  }

  _gatherDone() {
    const st = this.step();
    if (!st || st.kind !== 'gather') return false;
    const a = this.def.anchors[st.anchor];
    const alive = this.io.players().filter((p) => p.alive);
    return alive.length > 0 && alive.every((p) => dist(p, a) <= a.r);
  }

  _clientTick() {
    const r = this.io.remote();
    if (r && r.v === this.def.version && r.rev !== this.s.rev) this._adopt(r, true);
    if (!this.pending) return;
    const ack = this.s.ack[this.io.uid()];
    if (ack && ack.n === this.pending.n) {
      if (ack.ok && this.pending.item) this.io.consume(this.pending.item);
      if (ack.ok) this._say(this.def.story?.logs?.[this.pending.target]);
      this.pending = null;
    } else if (performance.now() - this.pending.at > 4000) {
      this.pending = null;
      this.io.toast('Host tidak merespons, coba lagi');
    }
  }

  _adopt(r, notify) {
    const prev = this.s.step, wasDone = this.s.complete;
    this.s = { ...r, done: r.done || {}, contrib: r.contrib || {}, ack: r.ack || {} };
    if (!notify) return;
    if (!this._intro && this.s.story) {
      this._intro = true;
      const sts = this.def.steps[this.s.step];
      this._say([...(this.def.story?.intro || []), ...(this.def.story?.start?.[sts?.id] || [])]);
    } else if (this.s.step > prev) {
      const st = this.step();
      this._narrate(this.def.steps[prev]?.id, st?.id);
      if (st) this.io.onStep(st);
    }
    if (this.s.complete && !wasDone) this._say(this.def.story?.ending);
  }

  _input() {
    if (!this.io.interactDown()) { this._eLatch = false; return; }
    if (this._eLatch) return;
    this._eLatch = true;
    const near = this._near();
    if (!near) return;
    if (this.io.isHost()) {
      const uid = this.io.uid();
      if (!this._apply(uid, near.id, { ...this.io.local(), uid })) return;
      if (near.item) this.io.consume(near.item);
      this._say(this.def.story?.logs?.[near.id]);
      this._commit();
    } else if (!this.pending) {
      const n = Date.now();
      this.pending = { n, item: near.item || null, target: near.id, at: performance.now() };
      this.io.send({ n, target: near.id });
    }
  }

  _near() {
    const st = this.step(), me = this.io.local();
    if (!st || this.pending || !me.alive) return null;
    const A = this.def.anchors;
    if (st.kind === 'deposit') {
      const a = A[st.anchor];
      if (this.s.count < st.required && countOf(this.io.inv(), st.item) > 0 && dist(me, a) <= a.r) {
        return { id: st.anchor, item: st.item, prompt: `${st.prompt} (${this.s.count}/${st.required})` };
      }
    } else if (st.kind === 'activate') {
      for (const id of st.anchors) {
        if (!this.s.done[id] && dist(me, A[id]) <= A[id].r) return { id, prompt: st.prompt };
      }
    }
    return null;
  }

  _target() {
    const st = this.step();
    if (!st) return null;
    const A = this.def.anchors, me = this.io.local();
    if (st.kind === 'deposit') {
      if (this.s.count >= st.required) return null;
      return countOf(this.io.inv(), st.item) > 0 ? A[st.anchor] : this.io.loot(st.item, me);
    }
    if (st.kind === 'activate') {
      return st.anchors.filter((id) => !this.s.done[id]).map((id) => A[id])
        .sort((p, q) => dist(me, p) - dist(me, q))[0] || null;
    }
    return A[st.anchor];
  }

  _render() {
    const st = this.step(), n = this.def.steps.length;
    if (this.s.complete || !st) {
      this.ui.set({ kicker: this.def.title, title: 'Misi selesai', text: 'Kalian berhasil keluar.', pct: 1 });
      return;
    }
    const need = this._need(st), me = this.io.local(), tgt = this._target();
    const hasItem = st.kind === 'deposit' && countOf(this.io.inv(), st.item) > 0;
    const text = st.kind === 'deposit' && !hasItem && this.s.count < need ? st.find : st.hint;
    let deg = null, d = null;
    if (tgt) {
      d = `${Math.round(dist(me, tgt))} m`;
      if (this.def.compass) {
        const want = Math.atan2(tgt.x - me.x, tgt.z - me.z);
        const face = Math.atan2(-Math.sin(me.yaw), -Math.cos(me.yaw));
        deg = -wrapPi(want - face) * 180 / Math.PI;
      }
    }
    const near = this._near();
    this.ui.set({
      kicker: `${this.def.title} · ${this.s.step + 1}/${n}`,
      title: need > 1 ? `${st.title} (${this.s.count}/${need})` : st.title,
      text, pct: need > 1 ? this.s.count / need : 0, deg, dist: d,
      prompt: near ? `[${keyLabel(binds.interact)}] ${near.prompt}` : '',
    });
  }

  dispose() { this.ui.dispose(); }
}

const LS_KEY = 'longway_tut_v1';
const load = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } };
const save = (o) => { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) { /* */ } };

export class Tutorial {
  constructor(hud) {
    this.seen = load();
    this.t = 0;
    this.moved = 0;
    this.last = null;
    this.cur = null;
    this.el = document.createElement('div');
    this.el.id = 'tutorial-tip';
    this.el.className = 'hidden';
    (hud || document.body).append(this.el);
  }

  static reset() { save({}); }

  update(dt, c) {
    this.t += dt;
    if (this.last) this.moved += dist(c.pos, this.last);
    this.last = { x: c.pos.x, z: c.pos.z };
    const k = (a) => keyLabel(binds[a]);
    const tips = [
      ['danger', c.monsterDist < 30, `Monster dekat! ${k('hide')} = sembunyi · ${k('throw')} = lempar pengalih`, 6],
      ['flash', c.dark && !c.flash, `Gelap. Tekan ${k('flash')} untuk senter (baterai terbatas)`, 6],
      ['loot', c.nearLoot, 'Dekati barang atau peti untuk mengambilnya. Tas terbatas, pilih yang penting.', 6],
      ['move', this.moved < 8 && this.t < 90,
        c.touch ? 'Gerak: joystick kiri · Lihat: geser layar kanan'
          : `Gerak: ${k('forward')} ${k('left')} ${k('back')} ${k('right')} · Lari: ${k('run')}`, 8],
    ];
    if (this.cur) {
      const tip = tips.find((x) => x[0] === this.cur.id);
      this.cur.age += dt;
      if (tip && tip[1] && this.cur.age < tip[3]) return;
      if (this.cur.age >= 2) { this.seen[this.cur.id] = 1; save(this.seen); }
      this.cur = null;
      this.el.classList.add('hidden');
    }
    const nxt = tips.find((x) => x[1] && !this.seen[x[0]]);
    if (!nxt) return;
    this.cur = { id: nxt[0], age: 0 };
    this.el.textContent = nxt[2];
    this.el.classList.remove('hidden');
  }

  dispose() { this.el.remove(); }
}
