// Game feel: the small things that make a hit feel like a hit.
//
//   feel.hitstop(ms)          freeze the game for a few frames on a big impact (the "crunch")
//   feel.slowmo(s, scale)     drop into slow motion for a dramatic moment (pins flying, a knockout)
//   feel.shake(amount)        camera shake; amounts add up and decay ("trauma", squared for feel)
//   feel.celebrate(text, o)   a big bouncing word on screen, with optional confetti
//   feel.flash()              a quick white flash (knockouts, home runs)
//
// main.js scales the game's dt through feel.step() and wraps every render in apply()/restore(),
// so games only ever call the four verbs above. Nothing here allocates per frame.

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

class Feel {
  constructor() {
    this.reset();
    this._root = null;
  }

  reset() {
    this._stop = 0; // seconds of hit-stop left (real time)
    this._slowT = 0; // seconds of slow motion left (real time)
    this._slowLen = 0;
    this._slowScale = 1;
    this.scale = 1; // current game-time scale
    this.trauma = 0;
    this._t = 0;
    this._saved = [];
    if (this._root) this._root.innerHTML = '';
  }

  /** Where celebration words and confetti go (a full-screen layer above the HUD). */
  mount(el) {
    this._root = el;
  }

  hitstop(ms = 60) {
    this._stop = Math.max(this._stop, ms / 1000);
  }

  slowmo(seconds = 1, scale = 0.3) {
    this._slowT = Math.max(this._slowT, seconds);
    this._slowLen = Math.max(this._slowLen, seconds);
    this._slowScale = Math.min(this._slowScale === 1 ? scale : this._slowScale, scale);
  }

  shake(amount = 0.3) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Real dt in, game dt out. */
  step(dt) {
    this._t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    if (this._stop > 0) {
      this._stop -= dt;
      this.scale = 0;
      return 0;
    }
    if (this._slowT > 0) {
      this._slowT -= dt;
      // Ease in fast, hold, ease back out over the last 30 %, so it never snaps.
      const left = this._slowT / this._slowLen;
      const k = left < 0.3 ? left / 0.3 : 1;
      this.scale = 1 + (this._slowScale - 1) * (k * k * (3 - 2 * k));
      if (this._slowT <= 0) {
        this._slowScale = 1;
        this._slowLen = 0;
        this.scale = 1;
      }
      return dt * this.scale;
    }
    this.scale = 1;
    return dt;
  }

  /** Offset the cameras for this frame's shake. Call restore() after rendering. */
  apply(cameras) {
    this._saved.length = 0;
    const s = this.trauma * this.trauma;
    if (s < 1e-4) return;
    const t = this._t * 38;
    // Smooth pseudo-noise (sum of incommensurate sines) instead of white noise: shakes, doesn't jitter.
    const nx = Math.sin(t * 1.0) * 0.6 + Math.sin(t * 2.31 + 1.7) * 0.4;
    const ny = Math.sin(t * 1.13 + 4.1) * 0.6 + Math.sin(t * 2.71 + 0.3) * 0.4;
    const nr = Math.sin(t * 0.87 + 2.2) * 0.6 + Math.sin(t * 1.93 + 5.1) * 0.4;
    for (const cam of cameras) {
      if (!cam) continue;
      this._saved.push(cam, cam.position.x, cam.position.y, cam.rotation.z);
      cam.position.x += nx * s * 0.12;
      cam.position.y += ny * s * 0.09;
      cam.rotation.z += nr * s * 0.035;
      cam.updateMatrixWorld();
    }
  }

  restore() {
    const v = this._saved;
    for (let i = 0; i < v.length; i += 4) {
      const cam = v[i];
      cam.position.x = v[i + 1];
      cam.position.y = v[i + 2];
      cam.rotation.z = v[i + 3];
      cam.updateMatrixWorld();
    }
    v.length = 0;
  }

  /**
   * A big word that bounces onto the screen and floats away.
   * opts: { color, size: 'huge'|'big'|'mid', confetti: number of pieces, sub: smaller second line, seconds }
   */
  celebrate(text, { color = '#ff6b4a', size = 'big', confetti = 0, sub = '', seconds = 1.9 } = {}) {
    if (!this._root) return;
    const el = document.createElement('div');
    el.className = `pop-word ${size}`;
    el.style.setProperty('--c', color);
    el.style.setProperty('--life', `${seconds}s`);
    // Each letter lands on its own beat, like a cheer.
    const letters = [...text].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
    el.innerHTML = `<div class="word">${letters}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    this._root.append(el);
    setTimeout(() => el.remove(), seconds * 1000 + 200);
    if (confetti) this.confetti(confetti);
  }

  confetti(n = 60) {
    if (!this._root) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['#ff6b4a', '#2ec4b6', '#ffd166', '#9b5de5', '#4d96ff', '#ffffff'];
    let html = '';
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 100;
      const dx = (Math.random() - 0.5) * 30;
      const d = 1.6 + Math.random() * 1.4;
      const delay = Math.random() * 0.35;
      const rot = Math.round(Math.random() * 720 - 360);
      const w = 6 + Math.random() * 8;
      html += `<i style="left:${x}%;--dx:${dx}vw;--rot:${rot}deg;width:${w}px;height:${w * 0.45}px;background:${colors[i % colors.length]};animation-duration:${d}s;animation-delay:${delay}s"></i>`;
    }
    box.innerHTML = html;
    this._root.append(box);
    setTimeout(() => box.remove(), 3400);
  }

  flash(strength = 0.6) {
    if (!this._root) return;
    const el = document.createElement('div');
    el.className = 'flash';
    el.style.opacity = String(strength);
    this._root.append(el);
    setTimeout(() => el.remove(), 400);
  }
}

export const feel = new Feel();
