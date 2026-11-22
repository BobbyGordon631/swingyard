// Phone controller: receives sensor packets relayed by the server.
import { InputSource } from './inputSource.js';
import { quatFromDeviceOrientation } from '../motion/orientation.js';

const G = 9.80665;
export const BUTTON_BITS = { hold: 1, a: 2, pause: 4, up: 8, down: 16, left: 32, right: 64, center: 128 };
export const BTN_HOLD = BUTTON_BITS.hold;
export const BTN_A = BUTTON_BITS.a;
export const BTN_PAUSE = BUTTON_BITS.pause;

const vec = (arr, scale) => (arr ? { x: arr[0] * scale, y: arr[1] * scale, z: arr[2] * scale } : null);

export class PhoneSource extends InputSource {
  constructor(slot, sendToPhone, config) {
    super(`phone${slot}`, `Phone P${slot + 1}`, config);
    this.slot = slot;
    this.ios = false;
    this._send = sendToPhone;
  }

  /**
   * msg: { a:[x,y,z]|null (m/s^2), g:[x,y,z]|null (m/s^2), r:[alpha,beta,gamma]|null (deg/s),
   *        o:[alpha,beta,gamma]|null (deviceorientation, degrees), b:bitmask, ts: phone clock ms }
   */
  handleMessage(msg, now) {
    if (typeof msg.b === 'number' && this._freshButtons(msg.bs)) {
      for (const [name, bit] of Object.entries(BUTTON_BITS)) this.setButton(name, msg.b & bit);
    }
    if (!msg.g && !msg.a) return; // button-only packet
    const sign = this.ios && this.config.phone.invertIOS ? -1 : 1;
    // Wi-Fi delivers packets in uneven bursts. The phone stamps each sample with its own clock;
    // we map that onto ours using the smallest delay seen, so sample spacing (and therefore swing
    // timing and peak detection) reflects when the motion happened, not when the packet arrived.
    let t = now;
    if (typeof msg.ts === 'number') {
      const offset = now - msg.ts;
      this._offset = this._offset === undefined || Math.abs(offset - this._offset) > 2000 ? offset : Math.min(offset, this._offset + 0.02);
      t = Math.max(msg.ts + this._offset - this.config.phone.latencyMs, this.lastSampleAt + 0.01);
      this.jitterMs = (this.jitterMs || 0) * 0.98 + (offset - this._offset) * 0.02;
    }
    this.pushSample({
      t,
      accel: vec(msg.a, sign / G),
      accelG: vec(msg.g, sign / G),
      rot: msg.r ? { alpha: msg.r[0], beta: msg.r[1], gamma: msg.r[2] } : null,
      orient: msg.o ? quatFromDeviceOrientation(msg.o[0], msg.o[1], msg.o[2]) : null,
    });
  }

  /**
   * Button presses arrive on the reliable channel; motion samples (which also carry the button bits) on an
   * unordered one. `bs` counts button changes on the phone, so a late motion packet from before the latest
   * press / release can't undo it. A big jump backwards means the phone page was reloaded.
   */
  _freshButtons(bs) {
    if (typeof bs !== 'number') return true; // an older controller page
    if (this._bs === undefined || bs >= this._bs || this._bs - bs > 50) {
      this._bs = bs;
      return true;
    }
    return false;
  }

  vibrate(pattern) {
    this._send({ t: 'vibrate', p: this.slot, ms: pattern });
  }

  setStatus(text) {
    if (text === this._status) return;
    this._status = text;
    this._send({ t: 'status', p: this.slot, text });
  }

  reset() {
    this._status = null;
    this._offset = undefined;
    this._bs = undefined;
    for (const name of Object.keys(this.buttons)) this.setButton(name, false);
    this.detector.reset();
    this.tracker.reset();
  }
}
