// Swing detector. Pure JS, no DOM (unit tested in Node with synthetic sensor data).
//
// Feed it filtered samples: update(tMs, accelMagnitudeG, twistRateDps).
// A swing starts when the magnitude crosses cfg.thresholdG. It is reported as soon as the peak
// has clearly passed (magnitude falls to peakDropRatio of the peak) rather than waiting for the
// arm to come to rest, which takes 100-200 ms off the reaction time. The peak magnitude sets
// power; the mean twist rate around the peak sets spin.
import { clamp } from './filter.js';

/** Map a twist rate (deg/s) to -1..1 with a dead zone. */
export function normalizeTwist(rateDps, cfg) {
  const mag = Math.abs(rateDps);
  if (mag <= cfg.twistDeadzoneDps) return 0;
  const n = (mag - cfg.twistDeadzoneDps) / (cfg.twistMaxDps - cfg.twistDeadzoneDps);
  return Math.sign(rateDps) * clamp(n, 0, 1);
}

/** Map a peak acceleration (g) to power 0..1. */
export function powerFromPeak(peakG, cfg) {
  return clamp((peakG - cfg.minPowerG) / (cfg.maxPowerG - cfg.minPowerG), 0, 1);
}

export class SwingDetector {
  constructor(cfg) {
    this.cfg = cfg;
    this.active = false; // a swing is building and has not been reported yet
    this.tail = false; // reported; waiting for the motion to die down
    this.cooldownUntil = -Infinity;
    this.armed = true; // must drop below the end threshold before a new swing can start
    this.cur = null;
    this.last = null; // most recent reported swing
  }

  /** @returns a swing object when one is recognised on this sample, otherwise null */
  update(t, mag, twistRate = 0) {
    const c = this.cfg;
    const endLevel = c.thresholdG * c.endRatio;
    if (this.tail) {
      if (mag < endLevel) {
        this.tail = false;
        this.armed = true;
        this.cooldownUntil = Math.max(this.cooldownUntil, t + c.cooldownMs * 0.5);
      }
      return null;
    }
    if (!this.active) {
      if (mag < endLevel) this.armed = true;
      if (this.armed && t >= this.cooldownUntil && mag >= c.thresholdG) {
        this.active = true;
        this.armed = false;
        this.cur = { tStart: t, tPeak: t, peakG: mag, samples: [{ t, twistRate }] };
      }
      return null;
    }
    const s = this.cur;
    s.samples.push({ t, twistRate });
    if (mag > s.peakG) {
      s.peakG = mag;
      s.tPeak = t;
    }
    const duration = t - s.tStart;
    if (mag < endLevel || duration >= c.maxDurationMs) return this.finish(t);
    // Early report: the peak is behind us.
    if (duration >= c.minDurationMs && mag <= s.peakG * (c.peakDropRatio ?? 0.8)) {
      const swing = this.finish(t);
      if (swing) this.tail = true;
      return swing;
    }
    return null;
  }

  /** Force the swing in progress to complete now (e.g. the trigger was released mid-swing). */
  finish(t) {
    if (!this.active) return null;
    const c = this.cfg;
    const s = this.cur;
    this.active = false;
    this.cur = null;
    const durationMs = t - s.tStart;
    if (durationMs < c.minDurationMs) return null; // noise spike - no cooldown either
    this.cooldownUntil = t + c.cooldownMs;
    const half = c.twistWindowMs / 2;
    let sum = 0;
    let n = 0;
    for (const p of s.samples) {
      if (Math.abs(p.t - s.tPeak) <= half) {
        sum += p.twistRate;
        n++;
      }
    }
    const twistRate = n ? sum / n : 0;
    const swing = {
      tStart: s.tStart,
      tPeak: s.tPeak,
      tEnd: t,
      durationMs,
      peakG: s.peakG,
      power: powerFromPeak(s.peakG, c),
      twistRate,
      twist: normalizeTwist(twistRate, c),
    };
    this.last = swing;
    return swing;
  }

  reset() {
    this.active = false;
    this.tail = false;
    this.cur = null;
    this.armed = true;
    this.cooldownUntil = -Infinity;
  }
}
