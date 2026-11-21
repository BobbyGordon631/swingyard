// Tennis ball physics: spin, bounce, the stroke solver and service boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURT, BALL_R, solveShot, predictLanding, spinFor, bounce, serviceBox, inBox } from '../public/js/games/tennis/physics.js';

const from = { x: 0.8, y: 0.95, z: 12 };

test('topspin dips, slice floats', () => {
  const base = { p: { ...from }, v: { x: 0, y: 5, z: -25 } };
  const land = (rate) => predictLanding({ ...base, w: spinFor(0, -1, rate) }).land.z;
  assert.ok(land(250) > land(0) && land(0) > land(-150)); // z decreases away from the hitter
});

test('the solver lands the ball on target and over the net', () => {
  for (const [speed, spin] of [[18, 0], [28, 200], [40, 300], [16, -120]]) {
    const s = solveShot({ from, target: { x: -2.5, z: -9 }, speed, spin });
    const r = predictLanding({ p: { ...from }, v: s.v, w: s.w });
    assert.ok(Math.hypot(r.land.x + 2.5, r.land.z + 9) < 0.3, `missed by ${Math.hypot(r.land.x + 2.5, r.land.z + 9)}`);
    assert.ok(r.netHeight > COURT.NET + BALL_R);
  }
});

test('a topspin ball kicks forward off the court, a slice ball skids slower', () => {
  const after = (rate) => {
    const b = { p: { x: 0, y: BALL_R, z: -6 }, v: { x: 0, y: -6, z: -20 }, w: spinFor(0, -1, rate) };
    bounce(b);
    return -b.v.z;
  };
  assert.ok(after(250) > after(0) && after(0) >= after(-150)); // flat and slice both slide the whole contact here
});

test('serves go cross-court into the right box', () => {
  const deuce0 = serviceBox(0, true);
  assert.ok(inBox(deuce0, -2, -4) && !inBox(deuce0, 2, -4) && !inBox(deuce0, -2, -7));
  const ad0 = serviceBox(0, false);
  assert.ok(inBox(ad0, 2, -4));
  const deuce1 = serviceBox(1, true);
  assert.ok(inBox(deuce1, 2, 4) && !inBox(deuce1, -2, 4));
  const s = solveShot({ from: { x: 0.7, y: 2.7, z: 12.2 }, target: { x: -2, z: -5.6 }, speed: 45, spin: 60, netMargin: 0.06 });
  const r = predictLanding({ p: { x: 0.7, y: 2.7, z: 12.2 }, v: s.v, w: s.w });
  assert.ok(inBox(deuce0, r.land.x, r.land.z) && r.netClear);
});
