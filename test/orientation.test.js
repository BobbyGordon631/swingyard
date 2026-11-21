// 3D orientation: device angles -> pointing direction in TV axes, recentring, swing direction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../public/js/config.js';
import { quatFromDeviceOrientation, OrientationTracker, poseFromBasis, basisFromPose } from '../public/js/motion/orientation.js';
import { InputSource } from '../public/js/input/inputSource.js';
import { OneEuro } from '../public/js/motion/filter.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const deg = (r) => (r * 180) / Math.PI;

test('flat phone, top edge forward: pointing straight ahead after recentring', () => {
  const tr = new OrientationTracker(CONFIG.orientation);
  tr.update(quatFromDeviceOrientation(37, 0, 0), 0); // any compass heading
  const { point, normal } = tr.basis;
  assert.ok(close(point.x, 0) && close(point.y, 0) && close(point.z, -1));
  assert.ok(close(normal.y, 1)); // screen up
  assert.ok(close(tr.pose.yaw, 0) && close(tr.pose.pitch, 0) && close(tr.pose.roll, 0));
});

test('turning, raising and rolling the phone shows up as yaw, pitch and roll', () => {
  const settle = (a, b, g) => {
    const tr = new OrientationTracker(CONFIG.orientation);
    tr.update(quatFromDeviceOrientation(0, 0, 0), 0);
    for (let t = 16; t < 3000; t += 16) tr.update(quatFromDeviceOrientation(a, b, g), t);
    return tr.pose;
  };
  // alpha grows counter-clockwise seen from above, so +alpha points left
  assert.ok(close(deg(settle(-30, 0, 0).yaw), 30, 0.5));
  assert.ok(close(deg(settle(0, 40, 0).pitch), 40, 0.5)); // top edge raised
  assert.ok(close(deg(settle(0, 0, 25).roll), 25, 0.5)); // right edge down
  // all the way round: no wrap-around glitches
  assert.ok(close(Math.abs(deg(settle(180, 0, 0).yaw)), 180, 0.5));
});

test('recentre makes the current direction "straight ahead"', () => {
  const tr = new OrientationTracker(CONFIG.orientation);
  tr.update(quatFromDeviceOrientation(0, 0, 0), 0);
  for (let t = 16; t < 2000; t += 16) tr.update(quatFromDeviceOrientation(70, 10, 0), t);
  assert.ok(Math.abs(deg(tr.pose.yaw)) > 60);
  tr.recenter();
  assert.ok(Math.abs(deg(tr.pose.yaw)) < 0.5);
  assert.ok(close(deg(tr.pose.pitch), 10, 0.5)); // pitch is absolute
});

test('angular velocity is measured from the orientation itself', () => {
  const tr = new OrientationTracker(CONFIG.orientation);
  for (let t = 0, a = 0; t < 400; t += 16, a -= 4) tr.update(quatFromDeviceOrientation(a, 0, 0), t); // 250 deg/s to the right
  assert.ok(close(deg(tr.omega.y), -250, 15), `omega ${deg(tr.omega.y)}`); // turning right = negative about +y
});

test('pose <-> basis round trip', () => {
  for (const [y, p, r] of [[0.3, 0.2, -0.4], [-1.2, -0.5, 0.9], [2.5, 0.1, 0]]) {
    const b = basisFromPose(y, p, r);
    const back = poseFromBasis(b.point, b.right);
    assert.ok(close(back.yaw, y, 1e-6) && close(back.pitch, p, 1e-6) && close(back.roll, r, 1e-6));
  }
});

test('InputSource with orientation: acceleration is rotated into TV axes and swings know their direction', () => {
  const src = new InputSource('t', 't', CONFIG);
  let swing = null;
  src.on('swing', (s) => (swing = s));
  // Phone held upright like a sword handle (top edge up, screen toward the player's face is irrelevant):
  // beta = 90 points the top edge up. A push along the phone's +x (its right edge) is a push to the right.
  const o = quatFromDeviceOrientation(0, 90, 0);
  let t = 0;
  const push = (ax) => src.pushSample({ t: (t += 10), accel: { x: ax, y: 0, z: 0 }, accelG: { x: 0, y: 1, z: 0 }, rot: null, orient: o });
  for (let i = 0; i < 10; i++) push(0);
  src.recenter();
  for (const a of [1, 3, 5, 6, 5, 3, 1, 0.2]) push(a);
  for (let i = 0; i < 20; i++) push(0);
  assert.ok(swing, 'swing detected');
  assert.ok(swing.move.x > 0.9, `move ${JSON.stringify(swing.move)}`);
  assert.ok(src.pose.pitch > 1.4); // pointing up
});

test('One Euro filter: steady when still, quick when moving', () => {
  const f = new OneEuro(1, 0.5);
  let t = 0;
  let out = 0;
  for (let i = 0; i < 100; i++) out = f.update(i % 2 ? 0.02 : -0.02, (t += 16)); // jitter
  assert.ok(Math.abs(out) < 0.012);
  for (let i = 0; i < 6; i++) out = f.update(1, (t += 16)); // a quick move
  assert.ok(out > 0.6, `lagged at ${out}`);
});

test('prediction: the pose is extrapolated along the current turn, and not at all when still', () => {
  const tr = new OrientationTracker(CONFIG.orientation);
  for (let t = 0, a = 0; t < 200; t += 16, a -= 4) tr.update(quatFromDeviceOrientation(a, 0, 0), t); // turning right, 250 deg/s
  const yawNow = deg(tr.pose.yaw);
  const p = tr.predict(0.05);
  const yawAhead = deg(poseFromBasis(p.point, p.right).yaw);
  assert.ok(Math.abs(yawAhead - yawNow - 12.5) < 3, `predicted ${yawAhead} vs ${yawNow}`); // 50 ms further along
  const still = new OrientationTracker(CONFIG.orientation);
  for (let t = 0; t < 400; t += 16) still.update(quatFromDeviceOrientation(0, 0, 0), t);
  assert.deepEqual(still.predict(0.05), still.basis);
});
