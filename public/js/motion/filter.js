// Exponential moving average low-pass filters. Pure JS, no DOM (unit tested in Node).

export class Ema {
  constructor(alpha) {
    this.alpha = alpha;
    this.value = null;
  }
  update(x) {
    this.value = this.value === null ? x : this.value + this.alpha * (x - this.value);
    return this.value;
  }
  reset() {
    this.value = null;
  }
}

export class Vec3Ema {
  constructor(alpha) {
    this.alpha = alpha;
    this.value = null;
  }
  update(v) {
    if (this.value === null) {
      this.value = { x: v.x, y: v.y, z: v.z };
    } else {
      const a = this.alpha;
      const o = this.value;
      o.x += a * (v.x - o.x);
      o.y += a * (v.y - o.y);
      o.z += a * (v.z - o.z);
    }
    return this.value;
  }
  reset() {
    this.value = null;
  }
}

export const magnitude = (v) => Math.hypot(v.x, v.y, v.z);
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// One Euro filter (Casiez et al. 2012): a low-pass whose cutoff rises with speed, so slow
// movements are smoothed heavily (no jitter) while fast ones pass with little lag.
const euroAlpha = (dt, cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuro {
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  update(x, tMs) {
    if (this.value === null) {
      this.value = x;
      this.t = tMs;
      return x;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    this.dx += euroAlpha(dt, this.dCutoff) * ((x - this.value) / dt - this.dx);
    this.value += euroAlpha(dt, this.minCutoff + this.beta * Math.abs(this.dx)) * (x - this.value);
    return this.value;
  }
  reset() {
    this.value = null;
    this.dx = 0;
    this.t = 0;
  }
}

/** One Euro filter for {x,y,z}; the speed term uses the length of the derivative vector. */
export class OneEuroVec3 {
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  update(v, tMs) {
    if (this.value === null) {
      this.value = { x: v.x, y: v.y, z: v.z };
      this.t = tMs;
      return this.value;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const o = this.value;
    const ad = euroAlpha(dt, this.dCutoff);
    const d = this.d;
    d.x += ad * ((v.x - o.x) / dt - d.x);
    d.y += ad * ((v.y - o.y) / dt - d.y);
    d.z += ad * ((v.z - o.z) / dt - d.z);
    const a = euroAlpha(dt, this.minCutoff + this.beta * Math.hypot(d.x, d.y, d.z));
    o.x += a * (v.x - o.x);
    o.y += a * (v.y - o.y);
    o.z += a * (v.z - o.z);
    return o;
  }
  reset() {
    this.value = null;
    this.d = { x: 0, y: 0, z: 0 };
    this.t = 0;
  }
}

/** Alpha for an adaptive blend toward a new value given speed (used for quaternion smoothing). */
export function euroBlend(dtS, speed, minCutoff, beta) {
  return euroAlpha(Math.max(1e-3, dtS), minCutoff + beta * speed);
}
