// All sound is synthesised with the Web Audio API - no audio files.
// Browsers only allow audio after a click or key press on the page, so call unlock() from one.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._noise = null;
    this._roll = null;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this._noise = this.ctx.createBuffer(1, len, len);
        const data = this._noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  tone({ freq, to = null, type = 'sine', dur = 0.15, gain = 0.2, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, gain = 0.2, type = 'bandpass', freq = 1000, to = null, q = 1, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ---- UI ----
  move() {
    this.tone({ freq: 520, to: 640, type: 'triangle', dur: 0.07, gain: 0.12 });
  }
  confirm() {
    this.tone({ freq: 523, type: 'triangle', dur: 0.1, gain: 0.16 });
    this.tone({ freq: 784, type: 'triangle', dur: 0.16, gain: 0.16, delay: 0.08 });
  }
  back() {
    this.tone({ freq: 440, to: 300, type: 'triangle', dur: 0.14, gain: 0.14 });
  }
  denied() {
    this.tone({ freq: 160, type: 'square', dur: 0.12, gain: 0.08 });
    this.tone({ freq: 130, type: 'square', dur: 0.16, gain: 0.08, delay: 0.1 });
  }
  join() {
    [392, 523, 659].forEach((f, i) => this.tone({ freq: f, type: 'sine', dur: 0.14, gain: 0.15, delay: i * 0.07 }));
  }

  // ---- Bowling ----
  whoosh(power = 0.5) {
    this.noise({ dur: 0.25, gain: 0.08 + power * 0.12, freq: 500, to: 1800 + power * 1500, q: 0.8 });
  }
  thud() {
    this.tone({ freq: 110, to: 50, dur: 0.22, gain: 0.35 });
    this.noise({ dur: 0.08, gain: 0.15, type: 'lowpass', freq: 400 });
  }
  rollStart() {
    if (!this.ready || this._roll) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this._roll = { src, f, g };
  }
  /** speed 0..1, hollow = true for the gutter */
  rollUpdate(speed, hollow = false) {
    if (!this._roll) return;
    const t = this.ctx.currentTime;
    this._roll.g.gain.setTargetAtTime(0.25 + speed * 0.5, t, 0.05);
    this._roll.f.frequency.setTargetAtTime((hollow ? 420 : 140) + speed * 160, t, 0.05);
  }
  rollStop() {
    if (!this._roll) return;
    const { src, g } = this._roll;
    this._roll = null;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0, t, 0.06);
    src.stop(t + 0.4);
  }
  /** intensity 0..1 */
  pinHit(intensity = 0.5) {
    const i = Math.min(1, Math.max(0.1, intensity));
    this.noise({ dur: 0.07 + i * 0.05, gain: 0.25 * i + 0.05, type: 'highpass', freq: 1800, q: 0.5 });
    this.tone({ freq: 700 + Math.random() * 700, to: 320, type: 'triangle', dur: 0.09, gain: 0.22 * i + 0.04 });
  }
  /** The ball dropping into the pit cushion. */
  pit() {
    this.tone({ freq: 70, to: 40, dur: 0.25, gain: 0.25 });
    this.noise({ dur: 0.18, gain: 0.12, type: 'lowpass', freq: 260 });
  }
  /** Pinsetter cycle: sweep bar clunk, motor whirr, table thunk. */
  pinsetter() {
    this.noise({ dur: 0.12, gain: 0.1, type: 'bandpass', freq: 600, q: 2 });
    this.noise({ dur: 1.5, gain: 0.05, type: 'bandpass', freq: 240, to: 380, q: 3, delay: 0.15 });
    this.tone({ freq: 95, to: 60, dur: 0.15, gain: 0.12, delay: 0.3 });
    this.tone({ freq: 120, to: 70, dur: 0.15, gain: 0.12, delay: 1.5 });
    this.noise({ dur: 0.1, gain: 0.08, type: 'bandpass', freq: 900, q: 2, delay: 1.55 });
  }
  gutter() {
    this.tone({ freq: 180, to: 70, type: 'sawtooth', dur: 0.3, gain: 0.12 });
    this.noise({ dur: 0.2, gain: 0.15, type: 'lowpass', freq: 500 });
  }
  strike() {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      this.tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.2, delay: i * 0.08 }),
    );
    this.noise({ dur: 0.6, gain: 0.06, type: 'highpass', freq: 5000, delay: 0.4 });
  }
  spare() {
    [523, 784, 1047].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.2, gain: 0.18, delay: i * 0.1 }));
  }
  miss() {
    this.tone({ freq: 330, to: 220, type: 'sine', dur: 0.3, gain: 0.14 });
  }
  // ---- Other sports ----
  pop(power = 0.5) {
    this.tone({ freq: 300 + power * 200, to: 140, type: 'triangle', dur: 0.09, gain: 0.3 });
    this.noise({ dur: 0.05, gain: 0.18, type: 'bandpass', freq: 1800, q: 1 });
  }
  crack() {
    this.noise({ dur: 0.07, gain: 0.5, type: 'highpass', freq: 1200, q: 0.5 });
    this.tone({ freq: 900, to: 260, type: 'square', dur: 0.08, gain: 0.2 });
  }
  bounce() {
    this.tone({ freq: 240, to: 120, type: 'sine', dur: 0.08, gain: 0.2 });
  }
  punch(power = 0.5) {
    this.tone({ freq: 150, to: 50, dur: 0.16, gain: 0.3 + power * 0.25 });
    this.noise({ dur: 0.09, gain: 0.2 + power * 0.2, type: 'lowpass', freq: 900 });
  }
  clang() {
    this.tone({ freq: 1250, type: 'square', dur: 0.2, gain: 0.1 });
    this.tone({ freq: 1870, type: 'triangle', dur: 0.28, gain: 0.12 });
    this.noise({ dur: 0.05, gain: 0.2, type: 'highpass', freq: 4000 });
  }
  thunk() {
    this.tone({ freq: 200, to: 80, type: 'triangle', dur: 0.14, gain: 0.35 });
    this.noise({ dur: 0.05, gain: 0.25, type: 'bandpass', freq: 700, q: 1 });
  }
  twang() {
    this.tone({ freq: 220, to: 330, type: 'sawtooth', dur: 0.18, gain: 0.12 });
    this.noise({ dur: 0.3, gain: 0.08, freq: 2500, to: 600, q: 0.8 });
  }
  splash() {
    this.noise({ dur: 0.5, gain: 0.3, type: 'bandpass', freq: 1400, to: 300, q: 0.6 });
  }
  cheer() {
    this.noise({ dur: 1.4, gain: 0.14, type: 'bandpass', freq: 1100, to: 1700, q: 0.4 });
    this.noise({ dur: 1.2, gain: 0.08, type: 'highpass', freq: 3000, delay: 0.1 });
  }
  whistle() {
    this.tone({ freq: 2100, to: 2300, type: 'sine', dur: 0.25, gain: 0.12 });
  }
  bell() {
    [0, 0.22, 0.44].forEach((d) => this.tone({ freq: 1320, type: 'triangle', dur: 0.4, gain: 0.18, delay: d }));
  }
  good() {
    this.tone({ freq: 660, type: 'triangle', dur: 0.1, gain: 0.16 });
    this.tone({ freq: 990, type: 'triangle', dur: 0.18, gain: 0.16, delay: 0.09 });
  }
  fanfare() {
    const notes = [392, 523, 659, 784, 659, 784, 1047];
    notes.forEach((f, i) => {
      this.tone({ freq: f, type: 'triangle', dur: i === notes.length - 1 ? 0.6 : 0.16, gain: 0.2, delay: i * 0.13 });
      this.tone({ freq: f / 2, type: 'sine', dur: 0.16, gain: 0.12, delay: i * 0.13 });
    });
  }
}
