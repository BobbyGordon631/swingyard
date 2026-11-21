// Debug overlay (toggle with D): live graph of the sensor pipeline for one input source.
// Shows raw + filtered acceleration magnitude against the swing threshold, the three
// rotation-rate axes, the trigger button, and every detected swing.
import { CONFIG } from './config.js';

const COLORS = { raw: '#5d6b8a', mag: '#ffd166', alpha: '#ff6b4a', beta: '#2ec4b6', gamma: '#9b5de5' };

export class DebugOverlay {
  constructor(canvas, input) {
    this.canvas = canvas;
    this.input = input;
    this.visible = false;
    this.pinned = null; // source chosen with keys 0-4, otherwise follow the most active one
    this._auto = input.keyboard;
  }

  toggle() {
    this.visible = !this.visible;
    this.canvas.classList.toggle('hidden', !this.visible);
  }

  /** key '0' = keyboard, '1'-'4' = phones, pressing the same key again returns to auto */
  pin(key) {
    const src = key === '0' ? this.input.keyboard : this.input.phones[Number(key) - 1];
    this.pinned = this.pinned === src ? null : src;
  }

  _source(now) {
    if (this.pinned) return this.pinned;
    // Follow whichever source moved or pressed something most recently.
    for (const s of this.input.sources) {
      const active = now - s.lastSampleAt < 500 && (s.mag > 0.4 || s.buttons.hold || s.detector.active);
      if (active && s !== this._auto) {
        if (s !== this.input.keyboard || !(this._auto.connected && this._auto.mag > 0.4)) this._auto = s;
      }
    }
    if (!this._auto.connected) this._auto = this.input.sources.find((s) => s !== this.input.keyboard) || this.input.keyboard;
    return this._auto;
  }

  draw(now) {
    if (!this.visible) return;
    const cv = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) {
      cv.width = W * dpr;
      cv.height = H * dpr;
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,15,32,0.88)';
    g.fillRect(0, 0, W, H);

    const src = this._source(now);
    const sc = CONFIG.swing;
    const span = CONFIG.debug.historyMs;
    const padL = 34;
    const top1 = 46;
    const h1 = (H - top1 - 70) * 0.58;
    const top2 = top1 + h1 + 14;
    const h2 = (H - top1 - 70) * 0.42;
    const tEnd = Math.max(now, src.lastSampleAt);
    const xOf = (t) => padL + ((t - (tEnd - span)) / span) * (W - padL - 8);
    const maxG = Math.max(6, sc.maxPowerG + 1);
    const yG = (v) => top1 + h1 - (Math.min(v, maxG) / maxG) * h1;
    const maxR = Math.max(sc.twistMaxDps * 1.4, 600);
    const yR = (v) => top2 + h2 / 2 - (Math.max(-maxR, Math.min(maxR, v)) / maxR) * (h2 / 2);

    g.font = '11px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';

    // Header
    g.fillStyle = '#fdf6e3';
    g.font = 'bold 12px ui-monospace, Menlo, monospace';
    const age = now - src.lastSampleAt;
    const live = src.connected && age < 500;
    g.fillText(`DEBUG  ${src.label}${this.pinned ? ' (pinned)' : ''}  ${live ? 'live' : src.connected ? 'no data' : 'not connected'}`, 8, 12);
    g.font = '11px ui-monospace, Menlo, monospace';
    g.fillStyle = '#9fb0d0';
    g.fillText('keys: D close · 0 keyboard · 1-4 phone · thresholds in public/js/config.js', 8, 28);

    // Swing regions (behind the lines)
    for (const s of src.swings) {
      if (s.tEnd < tEnd - span) continue;
      g.fillStyle = 'rgba(46,196,182,0.22)';
      g.fillRect(xOf(s.tStart), top1, Math.max(2, xOf(s.tEnd) - xOf(s.tStart)), h1);
      g.fillStyle = '#2ec4b6';
      g.fillText(`${s.peakG.toFixed(1)}g`, xOf(s.tPeak) - 12, Math.max(top1 + 6, yG(s.peakG) - 8));
    }
    if (src.detector.active) {
      g.fillStyle = 'rgba(255,209,102,0.25)';
      g.fillRect(xOf(src.detector.cur.tStart), top1, xOf(tEnd) - xOf(src.detector.cur.tStart), h1);
    }

    // Axes + thresholds
    g.strokeStyle = '#2b3656';
    g.lineWidth = 1;
    g.strokeRect(padL, top1, W - padL - 8, h1);
    g.strokeRect(padL, top2, W - padL - 8, h2);
    g.fillStyle = '#9fb0d0';
    for (let v = 0; v <= maxG; v += 2) g.fillText(`${v}g`, 6, yG(v));
    g.fillText(`${Math.round(maxR)}`, 4, top2 + 6);
    g.fillText('°/s', 8, top2 + h2 / 2);
    const dash = (y, color, label) => {
      g.strokeStyle = color;
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(W - 8, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = color;
      g.fillText(label, W - 8 - g.measureText(label).width - 2, y - 7);
    };
    dash(yG(sc.thresholdG), '#ff6b4a', `swing threshold ${sc.thresholdG}g`);
    dash(yG(sc.thresholdG * sc.endRatio), '#7a4a55', 'end');
    dash(yG(sc.maxPowerG), '#4d6a52', `full power ${sc.maxPowerG}g`);
    dash(yR(sc.twistDeadzoneDps), '#3b4a70', '');
    dash(yR(-sc.twistDeadzoneDps), '#3b4a70', 'twist dead zone');

    const line = (key, color, yFn, width = 1.5) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      let started = false;
      for (const h of src.history) {
        const x = xOf(h.t);
        if (x < padL) continue;
        const y = yFn(h[key]);
        if (started) g.lineTo(x, y);
        else g.moveTo(x, y);
        started = true;
      }
      g.stroke();
    };
    line('rawMag', COLORS.raw, yG, 1);
    line('mag', COLORS.mag, yG, 2);
    line('alpha', COLORS.alpha, yR);
    line('beta', COLORS.beta, yR);
    line('gamma', COLORS.gamma, yR);

    // Trigger bar
    g.fillStyle = '#ffd166';
    for (const h of src.history) {
      if (h.hold && xOf(h.t) >= padL) g.fillRect(xOf(h.t), top1 + h1 + 3, 3, 4);
    }

    // Legend + live values
    let lx = padL;
    const legend = (label, color) => {
      g.fillStyle = color;
      g.fillRect(lx, H - 52, 10, 3);
      g.fillText(label, lx + 14, H - 51);
      lx += g.measureText(label).width + 28;
    };
    legend('|a| raw', COLORS.raw);
    legend('|a| filtered', COLORS.mag);
    legend('rot α', COLORS.alpha);
    legend('rot β', COLORS.beta);
    legend('rot γ', COLORS.gamma);
    legend('trigger', '#ffd166');

    const b = src.buttons;
    g.fillStyle = '#fdf6e3';
    g.fillText(
      `|a| ${src.mag.toFixed(2)}g  twist(${sc.twistAxis}) ${src.twistRate.toFixed(0)}°/s  tilt ${src.tilt.x.toFixed(2)},${src.tilt.y.toFixed(2)}  ` +
        `btn ${b.hold ? 'HOLD ' : ''}${b.a ? 'A ' : ''}${b.pause ? 'PAUSE' : ''}`,
      8,
      H - 32,
    );
    const last = src.swings[src.swings.length - 1];
    g.fillStyle = last ? '#2ec4b6' : '#9fb0d0';
    g.fillText(
      last
        ? `last swing: peak ${last.peakG.toFixed(2)}g  power ${(last.power * 100).toFixed(0)}%  twist ${last.twistRate.toFixed(0)}°/s (${last.twist.toFixed(2)})  ${last.durationMs.toFixed(0)}ms  [${src.swings.length} total]`
        : 'last swing: none yet',
      8,
      H - 14,
    );
  }
}
