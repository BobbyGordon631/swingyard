// Full 3D phone orientation. Pure JS, no DOM (unit tested in Node).
//
// The phone sends its deviceorientation angles (alpha, beta, gamma). Those describe the rotation
// from the phone's own axes (x = right edge, y = top edge, z = out of the screen) to an earth
// frame (X east, Y north, Z up):  R = Rz(alpha) · Rx(beta) · Ry(gamma).
//
// Games want a frame tied to the TV instead, the same one three.js uses:
//   x = right, y = up, z = toward the player (so "toward the screen" is -z).
// recenter() records which compass heading the phone's top edge points at while the player aims
// at the screen; from then on every vector is rotated so that heading becomes -z.
//
// With the phone held like a remote (screen up, top edge toward the TV):
//   pose.yaw   + = pointing right        pose.pitch + = pointing up
//   pose.roll  + = right edge rolled down (clockwise as seen from behind)
import { euroBlend } from './filter.js';

const D2R = Math.PI / 180;

export const quat = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });

export function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export const qConj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function qNormalize(q) {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/** Rotate vector v by unit quaternion q. */
export function qRotate(q, v) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

export function qSlerp(a, b, t) {
  let { x, y, z, w } = b;
  let cos = a.x * x + a.y * y + a.z * z + a.w * w;
  if (cos < 0) {
    cos = -cos;
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  if (cos > 0.9995) return qNormalize({ x: a.x + (x - a.x) * t, y: a.y + (y - a.y) * t, z: a.z + (z - a.z) * t, w: a.w + (w - a.w) * t });
  const th = Math.acos(cos);
  const s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s;
  const kb = Math.sin(t * th) / s;
  return { x: a.x * ka + x * kb, y: a.y * ka + y * kb, z: a.z * ka + z * kb, w: a.w * ka + w * kb };
}

export function qAxisAngle(ax, ay, az, angle) {
  const s = Math.sin(angle / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) };
}

/** Rotation (device -> earth) from deviceorientation angles in degrees. */
export function quatFromDeviceOrientation(alpha, beta, gamma) {
  const qz = qAxisAngle(0, 0, 1, (alpha || 0) * D2R);
  const qx = qAxisAngle(1, 0, 0, (beta || 0) * D2R);
  const qy = qAxisAngle(0, 1, 0, (gamma || 0) * D2R);
  return qMul(qMul(qz, qx), qy);
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v) => {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};

/** yaw / pitch / roll of a pointing direction + right vector, all in the game frame. */
export function poseFromBasis(point, right) {
  const yaw = Math.atan2(point.x, -point.z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, point.y)));
  // Reference "level right" for this pointing direction (falls back near straight up/down).
  let hr = cross(point, { x: 0, y: 1, z: 0 });
  if (Math.hypot(hr.x, hr.y, hr.z) < 0.15) hr = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  hr = norm(hr);
  const refUp = cross(hr, point);
  const roll = Math.atan2(-dot(right, refUp), dot(right, hr));
  return { yaw, pitch, roll };
}

/** The inverse: basis vectors for a yaw / pitch / roll (used when there is no orientation sensor). */
export function basisFromPose(yaw, pitch, roll) {
  const cp = Math.cos(pitch);
  const point = { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  const hr = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const up = cross(hr, point);
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const right = { x: hr.x * c - up.x * s, y: hr.y * c - up.y * s, z: hr.z * c - up.z * s };
  const normal = norm(cross(right, point));
  return { point, right, normal };
}

export class OrientationTracker {
  /** cfg: CONFIG.orientation */
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.has = false;
    this.q = null; // smoothed, device -> earth
    this.raw = null;
    this.yaw0 = 0; // earth heading that maps to "toward the screen"
    this.centered = false;
    this._c = 1;
    this._s = 0;
    this.omega = { x: 0, y: 0, z: 0 }; // game frame, rad/s
    this.speed = 0; // |omega|, rad/s
    this.basis = basisFromPose(0, 0, 0);
    this.pose = { yaw: 0, pitch: 0, roll: 0 };
    this._lastChange = null;
  }

  /** qEarth: device -> earth rotation (unit quaternion). t in ms. */
  update(qEarth, t) {
    const raw = qNormalize(qEarth);
    if (!this.has) {
      this.has = true;
      this.q = raw;
      this.raw = raw;
      this._lastChange = { q: raw, t };
      if (!this.centered) this.recenter();
      this._derive();
      return;
    }
    // Angular velocity from successive orientations (independent of how each browser labels the
    // rotationRate axes). Only measured when the orientation actually changed.
    const lc = this._lastChange;
    const changed = raw.x !== lc.q.x || raw.y !== lc.q.y || raw.z !== lc.q.z || raw.w !== lc.q.w;
    if (changed) {
      const dt = Math.max(0.004, (t - lc.t) / 1000);
      let d = qMul(raw, qConj(lc.q)); // earth-frame rotation from the last orientation to this one
      if (d.w < 0) d = { x: -d.x, y: -d.y, z: -d.z, w: -d.w };
      const s = Math.hypot(d.x, d.y, d.z);
      const angle = 2 * Math.atan2(s, d.w);
      const w = s > 1e-9 ? this._toGame({ x: (d.x / s) * (angle / dt), y: (d.y / s) * (angle / dt), z: (d.z / s) * (angle / dt) }) : { x: 0, y: 0, z: 0 };
      const k = this.cfg.omegaAlpha;
      this.omega.x += k * (w.x - this.omega.x);
      this.omega.y += k * (w.y - this.omega.y);
      this.omega.z += k * (w.z - this.omega.z);
      this._lastChange = { q: raw, t };
    } else if (t - lc.t > 80) {
      this.omega.x *= 0.5;
      this.omega.y *= 0.5;
      this.omega.z *= 0.5;
    }
    this.speed = Math.hypot(this.omega.x, this.omega.y, this.omega.z);
    // Adaptive smoothing: heavy when still (no jitter), almost none during a fast swing (no lag).
    const dtS = Math.max(0.001, (t - (this._t ?? t - 16)) / 1000);
    const a = euroBlend(dtS, this.speed, this.cfg.minCutoff, this.cfg.beta);
    this.q = qSlerp(this.q, raw, a);
    this.raw = raw;
    this._t = t;
    this._derive();
  }

  /**
   * The basis rotated forward by the current angular velocity for `dtS` seconds: where the phone is
   * now (between samples) or will be a moment from now. Makes 1:1 objects move every frame on fast
   * screens and hides some of the Wi-Fi delay.
   */
  predict(dtS) {
    const w = this.omega;
    const speed = this.speed;
    if (!this.has || speed < 0.05 || dtS <= 0) return this.basis;
    const ang = Math.min(speed * dtS, 0.6);
    const k = { x: w.x / speed, y: w.y / speed, z: w.z / speed };
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const rot = (v) => {
      const kv = k.x * v.x + k.y * v.y + k.z * v.z;
      const cx = k.y * v.z - k.z * v.y;
      const cy = k.z * v.x - k.x * v.z;
      const cz = k.x * v.y - k.y * v.x;
      return { x: v.x * c + cx * s + k.x * kv * (1 - c), y: v.y * c + cy * s + k.y * kv * (1 - c), z: v.z * c + cz * s + k.z * kv * (1 - c) };
    };
    const b = this.basis;
    return { point: rot(b.point), right: rot(b.right), normal: rot(b.normal) };
  }

  /** Make the current pointing direction "straight at the screen". */
  recenter() {
    if (!this.q) {
      this.centered = false;
      return;
    }
    const p = qRotate(this.q, { x: 0, y: 1, z: 0 });
    let h = Math.atan2(p.x, p.y);
    if (Math.hypot(p.x, p.y) < 0.2) {
      // Pointing nearly straight up or down: use the screen's facing instead.
      const n = qRotate(this.q, { x: 0, y: 0, z: 1 });
      h = Math.atan2(-n.x * Math.sign(p.z || 1), -n.y * Math.sign(p.z || 1));
    }
    this.yaw0 = h;
    this._c = Math.cos(h);
    this._s = Math.sin(h);
    this.centered = true;
    this._derive();
  }

  /** Earth-frame vector -> game frame. */
  _toGame(v) {
    const x = v.x * this._c - v.y * this._s;
    const y = v.x * this._s + v.y * this._c;
    return { x, y: v.z, z: -y };
  }

  /** Device-frame vector (e.g. acceleration) -> game frame, using the smoothed orientation. */
  deviceToGame(v) {
    return this._toGame(qRotate(this.q, v));
  }

  _derive() {
    const point = this.deviceToGame({ x: 0, y: 1, z: 0 });
    const right = this.deviceToGame({ x: 1, y: 0, z: 0 });
    const normal = this.deviceToGame({ x: 0, y: 0, z: 1 });
    this.basis = { point, right, normal };
    this.pose = poseFromBasis(point, right);
  }
}
