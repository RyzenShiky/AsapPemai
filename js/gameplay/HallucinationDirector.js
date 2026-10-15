/**
 * Hallucination director — NEVER emits real sounds, never touches monster memory,
 * never deals damage. BPM / distance indicators stay honest.
 */
function pickWeighted(table) {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = Math.random() * total;
  for (const [name, w] of table) {
    r -= w;
    if (r <= 0) return name;
  }
  return table[0][0];
}

const TABLE = {
  shaken: [['falseStep', 1]],
  low: [['falseStep', 3], ['figure', 2]],
  critical: [['figure', 3], ['falseStep', 2], ['fakeClue', 1]],
};

function behind(p, d = 8) {
  const yaw = p.rotation?.yaw || 0;
  return {
    x: p.position.x + Math.sin(yaw) * d,
    y: p.position.y || 1.5,
    z: p.position.z + Math.cos(yaw) * d,
  };
}

function aheadOf(p, d = 20, lateral = 0) {
  const yaw = p.rotation?.yaw || 0;
  return {
    x: p.position.x - Math.sin(yaw) * d + Math.cos(yaw) * lateral,
    y: 0,
    z: p.position.z - Math.cos(yaw) * d + Math.sin(yaw) * lateral,
  };
}

export class HallucinationDirector {
  constructor(audio, renderer) {
    this.audio = audio;
    this.renderer = renderer;
    this.t = 8 + Math.random() * 10;
    this._ghosts = [];
  }

  update(dt, tier, player, cam) {
    for (let i = this._ghosts.length - 1; i >= 0; i--) {
      const g = this._ghosts[i];
      g.life -= dt;
      const d = Math.hypot(
        (cam?.position?.x ?? player.position.x) - g.x,
        (cam?.position?.z ?? player.position.z) - g.z
      );
      if (g.life <= 0 || d < (g.vanishIfWithin || 6)) {
        if (g.mesh && this.renderer?.scene) this.renderer.scene.remove(g.mesh);
        this._ghosts.splice(i, 1);
      }
    }

    if ((this.t -= dt) > 0 || !TABLE[tier]) return;
    this.t = (tier === 'critical' ? 12 : 25) * (0.7 + Math.random() * 0.6);
    const kind = pickWeighted(TABLE[tier]);
    if (typeof this[kind] === 'function') this[kind](player, cam);
  }

  figure(p) {
    const pos = aheadOf(p, 18 + Math.random() * 8, (Math.random() - 0.5) * 1.2);
    if (this.renderer?.spawnGhost) {
      const mesh = this.renderer.spawnGhost(pos);
      this._ghosts.push({ ...pos, life: 4, vanishIfWithin: 6, mesh });
    }
  }

  falseStep(p) {
    if (!this.audio?.playFootstep) return;
    const b = behind(p, 7 + Math.random() * 4);
    this.audio.playFootstep(b.x, b.y, b.z, 0.45, 'grass');
  }

  fakeClue() {
    const el = document.getElementById('whisper-caption');
    if (!el) return;
    el.textContent = '…sesuatu bergerak di sudut mata…';
    el.classList.remove('hidden');
    setTimeout(() => {
      el.classList.add('hidden');
      el.textContent = '';
    }, 2200);
  }

  reset() {
    for (const g of this._ghosts) {
      if (g.mesh && this.renderer?.scene) this.renderer.scene.remove(g.mesh);
    }
    this._ghosts = [];
    this.t = 8;
  }
}
