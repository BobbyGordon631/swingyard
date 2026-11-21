// Swing detector + input pipeline tests using synthetic sensor traces
// (half-sine acceleration bursts at 60 Hz, similar in shape to a real arm swing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../public/js/config.js';
import { Ema } from '../public/js/motion/filter.js';
import { SwingDetector, normalizeTwist, powerFromPeak } from '../public/js/motion/swingDetector.js';
import { InputSource } from '../public/js/input/inputSource.js';
import { KeyboardSource } from '../public/js/input/keyboardSource.js';

const cfg = CONFIG.swing;
const DT = 1000 / 60;

/** Build a trace: list of { at, peakG, ms, twist } bursts over `totalMs`, plus baseline noise. */
function trace(totalMs, bursts, noise = 0.05) {
  const out = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let t = 0; t <= totalMs; t += DT) {
    let mag = noise * rnd();
    let twist = 0;
    for (const b of bursts) {
      const u = (t - b.at) / b.ms;
      if (u >= 0 && u <= 1) {
        mag += b.peakG * Math.sin(Math.PI * u);
        twist = b.twist || 0;
      }
    }
    out.push({ t, mag, twist });
  }
  return out;
}

function detect(samples, config = cfg) {
  const d = new SwingDetector(config);
  const swings = [];
  for (const s of samples) {
    const swing = d.update(s.t, s.mag, s.twist);
    if (swing) swings.push(swing);
  }
  return swings;
}

test('EMA filter converges and smooths', () => {
  const f = new Ema(0.5);
  assert.equal(f.update(4), 4); // first sample initialises
  assert.equal(f.update(0), 2);
  assert.equal(f.update(0), 1);
  for (let i = 0; i < 40; i++) f.update(3);
  assert.ok(Math.abs(f.value - 3) < 1e-6);
});

test('no swing while resting or moving gently', () => {
  assert.equal(detect(trace(3000, [])).length, 0);
  assert.equal(detect(trace(3000, [{ at: 500, peakG: 1.5, ms: 300 }])).length, 0);
});

test('a single swing is detected once with the right peak', () => {
  const swings = detect(trace(2000, [{ at: 600, peakG: 3.5, ms: 250 }]));
  assert.equal(swings.length, 1);
  const s = swings[0];
  assert.ok(Math.abs(s.peakG - 3.5) < 0.15, `peak ${s.peakG}`);
  assert.ok(Math.abs(s.tPeak - 725) < 2 * DT, `tPeak ${s.tPeak}`);
  assert.ok(s.tStart > 600 && s.tEnd < 900);
});

test('power scales with peak acceleration and is clamped to 0..1', () => {
  const power = (peakG) => detect(trace(1500, [{ at: 300, peakG, ms: 250 }]))[0].power;
  assert.ok(power(2.3) < power(3.5));
  assert.ok(power(3.5) < power(5));
  assert.equal(power(9), 1);
  assert.equal(powerFromPeak(1, cfg), 0);
  assert.equal(powerFromPeak(cfg.minPowerG, cfg), 0);
  assert.equal(powerFromPeak(cfg.maxPowerG, cfg), 1);
});

test('twist around the peak sets spin direction and amount', () => {
  const twistOf = (twist) => detect(trace(1500, [{ at: 300, peakG: 4, ms: 250, twist }]))[0].twist;
  assert.equal(twistOf(0), 0);
  assert.equal(twistOf(30), 0); // inside the dead zone
  assert.ok(twistOf(280) > 0.3 && twistOf(280) < 0.7);
  assert.equal(twistOf(900), 1);
  assert.equal(twistOf(-900), -1);
  assert.equal(normalizeTwist(-cfg.twistMaxDps, cfg), -1);
});

test('two separate swings are both detected', () => {
  const swings = detect(
    trace(3000, [
      { at: 400, peakG: 3, ms: 220 },
      { at: 1600, peakG: 4.5, ms: 220 },
    ]),
  );
  assert.equal(swings.length, 2);
  assert.ok(swings[1].peakG > swings[0].peakG);
});

test('a double-peaked swing counts once (cooldown + re-arm)', () => {
  // Second bump starts 60 ms after the first ends - inside the cooldown.
  const swings = detect(
    trace(2000, [
      { at: 400, peakG: 3.5, ms: 200 },
      { at: 640, peakG: 2.6, ms: 120 },
    ]),
  );
  assert.equal(swings.length, 1);
});

test('very short spikes (taps, bumps) are ignored', () => {
  const samples = trace(1000, []);
  samples[20].mag = 6; // one-sample spike
  assert.equal(detect(samples).length, 0);
});

test('a swing that never drops is force-ended at maxDurationMs', () => {
  const samples = [];
  for (let t = 0; t <= 2000; t += DT) samples.push({ t, mag: t > 200 ? 3 : 0, twist: 0 });
  const swings = detect(samples);
  assert.equal(swings.length, 1); // must fall below the end level before re-arming
  assert.ok(swings[0].durationMs >= cfg.maxDurationMs && swings[0].durationMs < cfg.maxDurationMs + 2 * DT);
});

test('finish() completes a swing in progress', () => {
  const d = new SwingDetector(cfg);
  let t = 0;
  for (; t < 100; t += DT) d.update(t, 0.1, 0);
  for (; t < 200; t += DT) d.update(t, 3.2, 0);
  assert.ok(d.active);
  const swing = d.finish(t);
  assert.ok(swing && Math.abs(swing.peakG - 3.2) < 1e-9);
  assert.ok(!d.active);
  assert.equal(d.finish(t), null);
});

test('InputSource: filters raw samples, emits swing events, reports tilt', () => {
  const src = new InputSource('test', 'Test');
  const swings = [];
  src.on('swing', (s) => swings.push(s));
  for (const s of trace(2000, [{ at: 500, peakG: 4.5, ms: 260, twist: 600 }], 0)) {
    src.pushSample({
      t: s.t,
      accel: { x: 0, y: s.mag, z: 0 },
      accelG: { x: -0.5, y: 0, z: -0.87 }, // right edge tilted down
      rot: { alpha: 0, beta: s.twist, gamma: 0 },
    });
  }
  assert.equal(swings.length, 1);
  // The EMA shaves a little off the raw 4.5 g peak but not much.
  assert.ok(swings[0].peakG > 3.9 && swings[0].peakG <= 4.5, `peak ${swings[0].peakG}`);
  assert.ok(swings[0].twist > 0.8);
  assert.ok(src.tilt.x > 0.45 && src.tilt.x < 0.55);
});

test('InputSource: derives gravity-free acceleration when the phone only reports accelerationIncludingGravity', () => {
  const src = new InputSource('test', 'Test');
  const swings = [];
  src.on('swing', (s) => swings.push(s));
  // 1.5 s at rest so the gravity estimate settles, then a swing.
  for (const s of trace(3000, [{ at: 1800, peakG: 4, ms: 250 }], 0)) {
    src.pushSample({ t: s.t, accel: null, accelG: { x: 0, y: s.mag, z: -1 }, rot: null });
  }
  assert.equal(swings.length, 1);
  assert.ok(swings[0].peakG > 2.8, `peak ${swings[0].peakG}`);
});

test('InputSource: button edges are emitted once', () => {
  const src = new InputSource('test', 'Test');
  const edges = [];
  src.on('button', (name, down) => edges.push(`${name}:${down}`));
  src.setButton('hold', true);
  src.setButton('hold', true);
  src.setButton('hold', false);
  assert.deepEqual(edges, ['hold:true', 'hold:false']);
});

test('KeyboardSource: holding and releasing Space produces a real detected swing', () => {
  const kb = new KeyboardSource(CONFIG);
  const swings = [];
  const edges = [];
  kb.on('swing', (s) => swings.push(s));
  kb.on('button', (name, down) => edges.push({ name, down, peak: kb.recentPeak(CONFIG.bowling.releaseWindowMs) }));
  let now = 1000;
  const frame = () => kb.update((now += 16.7));
  for (let i = 0; i < 10; i++) frame();
  kb.keys.right = true;
  kb.pressTrigger(now);
  for (let i = 0; i < 27; i++) frame(); // ~450 ms = half way up the meter
  assert.ok(kb.buttons.hold);
  assert.ok(kb.charge > 0.4 && kb.charge < 0.6, `charge ${kb.charge}`);
  kb.releaseTrigger(now);
  for (let i = 0; i < 40; i++) frame();
  assert.equal(swings.length, 1);
  assert.ok(swings[0].power > 0.3 && swings[0].power < 0.7, `power ${swings[0].power}`);
  assert.ok(swings[0].twist > 0.9, `twist ${swings[0].twist}`);
  // The trigger is released after the peak, with the peak visible in recent history.
  const release = edges.find((e) => e.name === 'hold' && !e.down);
  assert.ok(release && release.peak >= CONFIG.swing.thresholdG, `peak at release ${release?.peak}`);
  assert.ok(!kb.buttons.hold);
});
