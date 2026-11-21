// Keyboard + mouse fallback. It does not bypass anything: it synthesises acceleration and
// rotation samples and pushes them through the same filter + swing detector as a phone.
//
//   Arrow keys        the phone's arrow pad (menus) and tilt. While Space is held: twist / direction
//                     for the next swing
//   Mouse position    the pointer (what pointing the phone does): aiming, sword angle...
//   Space (hold)      trigger. A power meter sweeps while held; releasing performs a swing
//                     of that strength and then lets go of the trigger
//   Mouse             hold the left button on the game view, flick, release (speed = power,
//                     sideways speed = twist)
//   Enter or X        A button
//   Esc or P          pause
import { InputSource } from './inputSource.js';

const STEP_MS = 8; // synthetic sample period (~120 Hz) so slow frames never miss a swing peak

export class KeyboardSource extends InputSource {
  constructor(config) {
    super('keyboard', 'Keyboard', config);
    this.connected = true;
    this._tiltF.minCutoff = 6; // keys are already clean; keep taps responsive
    this.pointer = { x: 0, y: 0 }; // mouse position over the game view, -1..1
    this.keys = { left: false, right: false, up: false, down: false };
    this.charging = false;
    this.charge = 0; // 0..1 power meter while Space is held
    this._chargeStart = 0;
    this._burst = null;
    this._mouseDown = false;
    this._mouseRelease = false;
    this._mouseDx = 0;
    this._mouseDy = 0;
    this._lastUpdate = null;
  }

  /** Bind DOM events. `mouseTarget` is the element where mouse flicks count (the 3D canvas). */
  attach(win, mouseTarget) {
    const keyMap = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    win.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (keyMap[e.code]) {
        this.keys[keyMap[e.code]] = true;
        this.setButton(keyMap[e.code], true);
        e.preventDefault();
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.pressTrigger(performance.now());
      } else if (e.code === 'Enter' || e.code === 'KeyX') {
        e.preventDefault();
        if (!e.repeat) this.setButton('a', true);
      } else if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!e.repeat) this.setButton('pause', true);
      }
    });
    win.addEventListener('keyup', (e) => {
      if (keyMap[e.code]) {
        this.keys[keyMap[e.code]] = false;
        this.setButton(keyMap[e.code], false);
      }
      else if (e.code === 'Space') this.releaseTrigger(performance.now());
      else if (e.code === 'Enter' || e.code === 'KeyX') this.setButton('a', false);
      else if (e.code === 'Escape' || e.code === 'KeyP') this.setButton('pause', false);
    });
    win.addEventListener('blur', () => {
      for (const k of Object.keys(this.keys)) {
        this.keys[k] = false;
        this.setButton(k, false);
      }
      this.setButton('a', false);
      this.setButton('pause', false);
      if (this.charging) this.releaseTrigger(performance.now());
      if (this._mouseDown) this._mouseRelease = true;
    });
    mouseTarget.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.charging || this._burst) return;
      this._mouseDown = true;
      this._mouseDx = this._mouseDy = 0;
      this.setButton('hold', true);
    });
    win.addEventListener('mousemove', (e) => {
      const r = mouseTarget.getBoundingClientRect();
      if (!this._mouseDown) {
        this.pointer.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
        this.pointer.y = Math.max(-1, Math.min(1, 1 - ((e.clientY - r.top) / r.height) * 2));
        return;
      }
      this._mouseDx += e.movementX;
      this._mouseDy += e.movementY;
    });
    win.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this._mouseDown) this._mouseRelease = true; // applied after this frame's samples
    });
  }

  _fallbackAim() {
    this.aim.x = this.pointer.x;
    this.aim.y = this.pointer.y;
  }

  pressTrigger(now) {
    if (this.charging || this._burst || this._mouseDown) return;
    this.charging = true;
    this.charge = 0;
    this._chargeStart = now;
    this.setButton('hold', true);
  }

  releaseTrigger(now) {
    if (!this.charging) return;
    const kb = this.config.keyboard;
    this._updateCharge(now);
    this.charging = false;
    this._burst = {
      t0: now,
      peakG: kb.minSwingG + (kb.maxSwingG - kb.minSwingG) * this.charge,
      twistDir: (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0),
      vertDir: (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0),
    };
  }

  _updateCharge(now) {
    const phase = (((now - this._chargeStart) / this.config.keyboard.chargePeriodMs) % 1 + 1) % 1;
    this.charge = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  }

  update(now) {
    const kb = this.config.keyboard;
    if (this._lastUpdate === null || now - this._lastUpdate > 250) this._lastUpdate = now - STEP_MS;
    const frameMs = Math.max(1, now - this._lastUpdate);
    if (this.charging) this._updateCharge(now);

    // Mouse flick velocity for this frame (px / ms).
    const mvx = this._mouseDx / frameMs;
    const mvy = this._mouseDy / frameMs;
    this._mouseDx = this._mouseDy = 0;

    for (let t = this._lastUpdate + STEP_MS; t <= now; t += STEP_MS) {
      this._lastUpdate = t;
      const accel = { x: 0, y: 0, z: 0 };
      const rot = { alpha: 0, beta: 0, gamma: 0 };
      const tiltX = ((this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0)) * kb.tiltG;
      const tiltY = ((this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0)) * kb.tiltG;

      if (this._burst) {
        const u = (t - this._burst.t0) / kb.swingMs;
        if (u >= 1) {
          this._burst = null;
          this.setButton('hold', false);
        } else {
          // Arrow keys held at release give the swing a direction: sideways = hook / side slash,
          // up or down = vertical slash, none = a straight jab along the "phone".
          const b = this._burst;
          const g = b.peakG * Math.sin(Math.PI * Math.max(0, u));
          if (b.twistDir) accel.x = g * b.twistDir;
          else if (b.vertDir) accel.z = g * b.vertDir;
          else accel.y = g;
          const sc = this.config.swing;
          rot[sc.twistAxis] = b.twistDir * kb.twistDps;
          rot[sc.yawAxis] += b.twistDir * kb.twistDps * (sc.yawInvert ? -1 : 1);
          rot[sc.pitchAxis] += b.vertDir * kb.twistDps * (sc.pitchInvert ? -1 : 1);
        }
      } else if (this._mouseDown) {
        accel.x = mvx * kb.mouseGPerPxMs;
        accel.y = -mvy * kb.mouseGPerPxMs;
        rot[this.config.swing.twistAxis] = mvx * kb.mouseTwistDpsPerPxMs;
      }

      this.pushSample({
        t,
        accel,
        accelG: { x: -tiltX, y: -tiltY, z: -Math.sqrt(Math.max(0, 1 - tiltX * tiltX - tiltY * tiltY)) },
        rot,
      });

      // Let go of the trigger just after the peak of the synthetic swing.
      if (this._burst && (t - this._burst.t0) / kb.swingMs >= 0.65) this.setButton('hold', false);
    }

    if (this._mouseRelease) {
      this._mouseRelease = false;
      this._mouseDown = false;
      this.setButton('hold', false);
    }
  }
}
