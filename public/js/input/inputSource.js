// The one input interface every game talks to.
//
// An InputSource is anything that can produce:
//   - an acceleration vector            (g, gravity removed)        -> source.accel (phone axes)
//                                                                    source.aWorld (TV axes)
//   - acceleration including gravity    (g)                         -> source.accelG / source.tilt
//   - a rotation rate                   (deg/s)                     -> source.rot, source.omegaDps
//   - a full 3D orientation             (optional)                  -> source.pose, source.basis, source.aim
//   - buttons  { hold, a, pause, up, down, left, right, center }    -> source.buttons
//
// "TV axes" (the game frame) are three.js axes after recentring: x = right, y = up, z = toward
// the player, so the screen is at -z.
//
// Implementations (PhoneSource, KeyboardSource, anything added later) only need to call
// pushSample() and setButton(). Filtering, orientation, swing detection and the debug history
// all happen here, so every source behaves the same way.
//
// Events:  'swingstart' (info)         - a swing just began (start animations here)
//          'swing' (swing)             - a completed swing, see _emitSwing for its fields
//          'button' (name, down)       - button edges
// Pure JS, no DOM (unit tested in Node).
import { CONFIG } from '../config.js';
import { Vec3Ema, OneEuroVec3, magnitude, clamp } from '../motion/filter.js';
import { SwingDetector, normalizeTwist } from '../motion/swingDetector.js';
import { OrientationTracker, basisFromPose } from '../motion/orientation.js';

export class Emitter {
  constructor() {
    this._handlers = new Map();
  }
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this._handlers.get(type)?.delete(fn);
  }
  emit(type, ...args) {
    const set = this._handlers.get(type);
    if (set) for (const fn of [...set]) fn(...args);
  }
}

const ZERO = () => ({ x: 0, y: 0, z: 0 });
const D2R = Math.PI / 180;
export const BUTTONS = ['hold', 'a', 'pause', 'up', 'down', 'left', 'right', 'center'];

export class InputSource extends Emitter {
  constructor(id, label, config = CONFIG) {
    super();
    this.id = id;
    this.label = label;
    this.config = config;
    this.connected = false;
    this.buttons = Object.fromEntries(BUTTONS.map((b) => [b, false]));
    this.accel = ZERO(); // filtered, gravity removed, g, phone axes
    this.aWorld = ZERO(); // the same in TV axes
    this.accelG = ZERO(); // smoothed, including gravity, g
    this.rot = { alpha: 0, beta: 0, gamma: 0 }; // filtered, deg/s
    this.omegaDps = 0; // |rotation rate|, deg/s (the same whatever the axis labels)
    this.mag = 0; // |accel|
    this.rawMag = 0;
    this.drive = 0; // what the swing detector sees: max(|accel|, |rotation| / gyroDpsPerG)
    this.twistRate = 0;
    this.tilt = { x: 0, y: 0 }; // -1..1, +x = tilted right, +y = tilted forward
    this.aim = { x: 0, y: 0 }; // -1..1 pointer: where the phone points (or tilt / mouse as a fallback)
    this.pose = { yaw: 0, pitch: 0, roll: 0 }; // radians, TV axes
    this.basis = basisFromPose(0, 0, 0); // { point, right, normal } unit vectors, TV axes
    this.lastSampleAt = -Infinity;
    this.sampleCount = 0;
    this.history = []; // { t, rawMag, mag, alpha, beta, gamma, hold }
    this.swings = [];
    this._accelF = new Vec3Ema(config.filter.accelAlpha);
    this._rotF = new Vec3Ema(config.filter.rotAlpha);
    this._tiltF = new OneEuroVec3(config.filter.tiltMinCutoff, config.filter.tiltBeta);
    this._gravF = new Vec3Ema(config.filter.gravityAlpha);
    this._aBuf = []; // recent TV-axis acceleration, for working out which way a swing moved
    this.tracker = new OrientationTracker(config.orientation);
    this.detector = new SwingDetector(config.swing);
  }

  /** True when this source reports a real 3D orientation (phones with an orientation sensor). */
  get hasOrientation() {
    return this.tracker.has;
  }

  /**
   * @param {object} s
   * @param {number} s.t                       timestamp, ms
   * @param {{x,y,z}|null} s.accel             acceleration without gravity, g (null if unavailable)
   * @param {{x,y,z}|null} s.accelG            acceleration including gravity, g
   * @param {{alpha,beta,gamma}|null} s.rot    rotation rate, deg/s
   * @param {{x,y,z,w}|null} [s.orient]        device -> earth rotation (see motion/orientation.js)
   */
  pushSample(s) {
    const cfg = this.config;
    const t = s.t;
    const accelG = s.accelG || ZERO();
    let accel = s.accel;
    if (!accel) {
      const g = this._gravF.update(accelG);
      accel = { x: accelG.x - g.x, y: accelG.y - g.y, z: accelG.z - g.z };
    }
    const rot = s.rot || { alpha: 0, beta: 0, gamma: 0 };
    if (s.orient) this.tracker.update(s.orient, t);

    const a = this._accelF.update(accel);
    this.accel.x = a.x;
    this.accel.y = a.y;
    this.accel.z = a.z;
    this.rawMag = magnitude(accel);
    this.mag = magnitude(a);
    const w = this.tracker.has ? this.tracker.deviceToGame(a) : { x: a.x, y: a.z, z: -a.y }; // no sensor: assume remote grip
    this.aWorld.x = w.x;
    this.aWorld.y = w.y;
    this.aWorld.z = w.z;

    const r = this._rotF.update({ x: rot.alpha || 0, y: rot.beta || 0, z: rot.gamma || 0 });
    this.rot.alpha = r.x;
    this.rot.beta = r.y;
    this.rot.gamma = r.z;
    this.omegaDps = Math.hypot(r.x, r.y, r.z);
    this.twistRate = (this.rot[cfg.swing.twistAxis] || 0) * (cfg.phone.twistInvert ? -1 : 1);

    const g = this._tiltF.update(accelG, t);
    this.accelG.x = g.x;
    this.accelG.y = g.y;
    this.accelG.z = g.z;
    this.tilt.x = clamp(-g.x, -1, 1) * (cfg.phone.tiltInvertX ? -1 : 1);
    this.tilt.y = clamp(-g.y, -1, 1);
    this._updatePose();

    this.lastSampleAt = t;
    this.sampleCount++;
    this.history.push({ t, rawMag: this.rawMag, mag: this.mag, alpha: this.rot.alpha, beta: this.rot.beta, gamma: this.rot.gamma, hold: this.buttons.hold });
    const cutoff = t - cfg.debug.historyMs;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
    this._aBuf.push({ t, x: w.x, y: w.y, z: w.z, m: this.mag });
    while (this._aBuf.length && this._aBuf[0].t < t - 800) this._aBuf.shift();

    this.drive = Math.max(this.mag, this.omegaDps / (cfg.swing.gyroDpsPerG || Infinity));
    const wasActive = this.detector.active;
    const swing = this.detector.update(t, this.drive, this.twistRate);
    if (this.detector.active) {
      const cur = this.detector.cur;
      if (cur !== this._swCur) {
        this._swCur = cur;
        this._sw = { n: 0, alpha: 0, beta: 0, gamma: 0, peak: -1, vec: ZERO(), om: ZERO(), omPeak: 0, accPeak: 0, pose: { ...this.pose }, basis: this.basis };
      }
      const sw = this._sw;
      sw.n++;
      sw.alpha += this.rot.alpha;
      sw.beta += this.rot.beta;
      sw.gamma += this.rot.gamma;
      const om = this.tracker.omega;
      sw.om.x += om.x;
      sw.om.y += om.y;
      sw.om.z += om.z;
      sw.omPeak = Math.max(sw.omPeak, this.omegaDps);
      sw.accPeak = Math.max(sw.accPeak, this.mag);
      if (this.drive >= sw.peak) {
        sw.peak = this.drive;
        sw.vec = { x: a.x, y: a.y, z: a.z };
        sw.pose = { ...this.pose };
        sw.basis = this.basis;
      }
      if (!wasActive) this.emit('swingstart', { t, source: this, pose: { ...this.pose } });
    }
    if (swing) this._emitSwing(swing);
  }

  /** Pointer + pose. With an orientation sensor: where the phone points. Otherwise tilt (or the mouse). */
  _updatePose() {
    const oc = this.config.orientation;
    if (this.tracker.has) {
      this.pose = this.tracker.pose;
      this.basis = this.tracker.basis;
      this.aim.x = clamp(this.pose.yaw / (oc.yawRange * D2R), -1, 1);
      this.aim.y = clamp(this.pose.pitch / (oc.pitchRange * D2R), -1, 1);
      return;
    }
    this._fallbackAim();
    this.pose = {
      yaw: this.aim.x * oc.yawRange * D2R,
      pitch: this.aim.y * oc.pitchRange * D2R,
      roll: Math.asin(clamp(this.tilt.x, -1, 1)),
    };
    this.basis = basisFromPose(this.pose.yaw, this.pose.pitch, this.pose.roll);
  }

  _fallbackAim() {
    this.aim.x = clamp(this.tilt.x / 0.5, -1, 1);
    this.aim.y = clamp(-this.tilt.y / 0.5, -1, 1);
  }

  /**
   * The phone's basis extrapolated to `now` (ms, performance.now clock) plus CONFIG.orientation.predictMs:
   * smooth 1:1 motion between 60 Hz sensor samples, with a little latency hidden.
   */
  predictedBasis(now) {
    if (!this.tracker.has) return this.basis;
    const ahead = Math.min(Math.max(0, now - this.lastSampleAt), 60) + (this.config.orientation.predictMs || 0);
    return this.tracker.predict(ahead / 1000);
  }

  /** Treat the current pointing direction as "straight at the screen". */
  recenter() {
    this.tracker.recenter();
    this._updatePose();
  }

  setButton(name, down) {
    down = !!down;
    if (this.buttons[name] === down) return;
    this.buttons[name] = down;
    if (name === 'center' && down) this.recenter();
    this.emit('button', name, down);
  }

  /** Force-complete a swing in progress (returns it, or null). */
  finishSwing(t) {
    const swing = this.detector.finish(t);
    if (swing) this._emitSwing(swing);
    return swing;
  }

  /**
   * Swing fields (on top of SwingDetector's tStart / tPeak / tEnd / peakG / power / twist):
   *   move      unit vector, TV axes: which way the phone travelled (integrated acceleration)
   *   moveSpeed m/s, rough speed of the hand
   *   tip       unit vector, TV axes: which way the far end of the phone (a blade, a racket head)
   *             was sweeping. Uses the orientation sensor; falls back to `move`.
   *   omegaDps  peak rotation speed, deg/s
   *   pose      { yaw, pitch, roll } at the swing's peak;  basis likewise
   *   axis      'y' (along the phone, e.g. a jab), 'x' or 'z' - legacy, phone axes
   *   yaw / pitch  legacy slash rates
   */
  _emitSwing(swing) {
    const sw = this._sw || { n: 0, alpha: 0, beta: 0, gamma: 0, vec: { x: 0, y: 1, z: 0 }, om: ZERO(), omPeak: 0, accPeak: 0, pose: { ...this.pose }, basis: this.basis };
    const n = sw.n || 1;
    const sc = this.config.swing;
    swing.rot = { alpha: sw.alpha / n, beta: sw.beta / n, gamma: sw.gamma / n };
    const m = Math.hypot(sw.vec.x, sw.vec.y, sw.vec.z) || 1;
    swing.dir = { x: sw.vec.x / m, y: sw.vec.y / m, z: sw.vec.z / m };
    const ax = Math.abs(swing.dir.x);
    const ay = Math.abs(swing.dir.y);
    const az = Math.abs(swing.dir.z);
    swing.axis = ay >= ax && ay >= az ? 'y' : ax >= az ? 'x' : 'z';
    swing.yaw = (swing.rot[sc.yawAxis] || 0) * (sc.yawInvert ? -1 : 1);
    swing.pitch = (swing.rot[sc.pitchAxis] || 0) * (sc.pitchInvert ? -1 : 1);
    swing.omegaDps = sw.omPeak;
    swing.pose = sw.pose;
    swing.basis = sw.basis;

    // Direction of travel: integrate TV-axis acceleration from just before the swing began.
    const buf = this._aBuf;
    let i = buf.length - 1;
    while (i > 0 && buf[i].t > swing.tStart) i--;
    while (i > 0 && buf[i - 1].m > 0.45 && swing.tStart - buf[i - 1].t < 260) i--;
    const v = ZERO();
    for (let k = i + 1; k < buf.length && buf[k].t <= swing.tEnd + 1; k++) {
      const dt = (buf[k].t - buf[k - 1].t) / 1000;
      v.x += buf[k].x * dt;
      v.y += buf[k].y * dt;
      v.z += buf[k].z * dt;
    }
    const vm = Math.hypot(v.x, v.y, v.z);
    swing.moveSpeed = vm * 9.81;
    swing.move = vm > 1e-6 ? { x: v.x / vm, y: v.y / vm, z: v.z / vm } : { x: 0, y: 0, z: -1 };

    // Sweep of the phone's far end = angular velocity x pointing direction.
    let tip = swing.move;
    if (this.tracker.has) {
      const o = { x: sw.om.x / n, y: sw.om.y / n, z: sw.om.z / n };
      const p = sw.basis.point;
      const c = { x: o.y * p.z - o.z * p.y, y: o.z * p.x - o.x * p.z, z: o.x * p.y - o.y * p.x };
      const cm = Math.hypot(c.x, c.y, c.z);
      if (cm > 0.5) tip = { x: c.x / cm, y: c.y / cm, z: c.z / cm };
    }
    swing.tip = tip;

    this._sw = null;
    this._swCur = null;
    this.swings.push(swing);
    if (this.swings.length > 20) this.swings.shift();
    this.emit('swing', swing);
  }

  /** Highest filtered |accel| in the last windowMs. */
  recentPeak(windowMs, now = this.lastSampleAt) {
    let peak = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (h.t < now - windowMs) break;
      if (h.mag > peak) peak = h.mag;
    }
    return peak;
  }

  /** Mean twist rate (deg/s) over the last windowMs. */
  recentTwistRate(windowMs, now = this.lastSampleAt) {
    const axis = this.config.swing.twistAxis;
    let sum = 0;
    let n = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (h.t < now - windowMs) break;
      sum += h[axis] || 0;
      n++;
    }
    return (n ? sum / n : 0) * (this.config.phone.twistInvert ? -1 : 1);
  }

  recentTwist(windowMs, now) {
    return normalizeTwist(this.recentTwistRate(windowMs, now), this.config.swing);
  }

  /** Mean TV-axis acceleration direction over the last windowMs (unit vector, or null if still). */
  recentMove(windowMs, now = this.lastSampleAt) {
    const v = ZERO();
    const buf = this._aBuf;
    for (let k = buf.length - 1; k > 0 && buf[k].t >= now - windowMs; k--) {
      const dt = (buf[k].t - buf[k - 1].t) / 1000;
      v.x += buf[k].x * dt;
      v.y += buf[k].y * dt;
      v.z += buf[k].z * dt;
    }
    const m = Math.hypot(v.x, v.y, v.z);
    return m > 0.02 ? { x: v.x / m, y: v.y / m, z: v.z / m, speed: m * 9.81 } : null;
  }

  vibrate(_pattern) {}
  setStatus(_text) {}
  update(_now) {}
}
