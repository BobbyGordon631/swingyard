// Headless pin physics checks: the same simulation the game runs, stepped without rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../public/js/config.js';
import { BowlingPhysics, DIM, pinHomes } from '../public/js/games/bowling/physics.js';

function roll(physics, shot) {
  const before = physics.countStanding();
  physics.launch(shot);
  let steps = 0;
  while (physics.state !== 'done' && steps++ < 60 * 40) physics.step(1 / 60);
  assert.equal(physics.state, 'done', 'simulation should settle');
  return before - physics.countStanding();
}

test('rack: ten pins in a triangle, all standing and at rest', () => {
  const homes = pinHomes();
  assert.equal(homes.length, 10);
  assert.deepEqual(homes[0], [0, -DIM.laneLength]);
  const physics = new BowlingPhysics(CONFIG.bowling);
  for (let i = 0; i < 240; i++) physics.step(1 / 60);
  assert.equal(physics.countStanding(), 10);
});

test('a fast ball down the middle knocks down a good part of the rack', () => {
  const physics = new BowlingPhysics(CONFIG.bowling);
  const down = roll(physics, { x: 0, speed: 8.5, spin: 0 });
  assert.ok(down >= 4 && down <= 10, `knocked down ${down}`);
});

test('a ball off the edge is a gutter ball', () => {
  const physics = new BowlingPhysics(CONFIG.bowling);
  const down = roll(physics, { x: 0.3, speed: 7, spin: 0, angle: 0.05 });
  assert.ok(physics.events.some((e) => e.type === 'gutter'));
  assert.equal(down, 0);
});

test('spin hooks the ball in the direction of the twist: skid, hook, then roll', () => {
  const runTo = (spin, speed = 8.5) => {
    const physics = new BowlingPhysics(CONFIG.bowling);
    physics.launch({ x: 0, speed, spin });
    const phases = new Set();
    let skidUntil = 0;
    while (physics.ball.position.z > -(DIM.laneLength - 0.5)) {
      physics.step(1 / 60);
      phases.add(physics.phase);
      if (physics.phase === 'skid') skidUntil = -physics.ball.position.z;
    }
    return { x: physics.ball.position.x, phases, skidUntil, v: physics.ball.velocity };
  };
  const straight = runTo(0);
  assert.ok(Math.abs(straight.x) < 0.01);
  const right = runTo(0.5);
  const left = runTo(-0.5);
  assert.ok(right.x > 0.2 && right.x < 0.75, `half hook moved ${right.x} m`);
  assert.ok(Math.abs(right.x + left.x) < 0.01);
  assert.ok(runTo(0.25).x < right.x); // less twist, less hook
  // It skids through the oil, hooks on the dry back end, and is rolling by the pins.
  assert.ok(right.skidUntil > 6 && right.skidUntil < CONFIG.bowling.oilLength + 1, `skid until ${right.skidUntil} m`);
  assert.ok(right.phases.has('hook') && right.phases.has('roll'));
  // Faster balls hook less (less time on the dry boards).
  assert.ok(runTo(0.5, 9.4).x < runTo(0.5, 7).x);
});

// Bring a ball into a given arrival board by solving for the launch angle (real bowlers play an
// angle out and let the hook bring the ball back).
function aimFor(target, { x, spin, speed }) {
  const arrive = (angle) => {
    const physics = new BowlingPhysics(CONFIG.bowling);
    physics.launch({ x, speed, spin, angle });
    while (physics.ball.position.z > -(DIM.laneLength - 0.25) && physics.ballInPlay) physics.step(1 / 60);
    return physics.ball.position.x;
  };
  let lo = -0.08;
  let hi = 0.08;
  for (let k = 0; k < 20; k++) {
    const m = (lo + hi) / 2;
    if (arrive(m) > target) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}
const POCKET = -0.065; // board 17.5 on the side a +x hook enters (the 1-2 pocket)

test('a hook into the pocket strikes; light and high hits leave the classic pins', () => {
  const shot = { x: 0.28, spin: 1, speed: 8.5 }; // a strong hook, played out and back
  const result = (target, seed) => {
    const physics = new BowlingPhysics(CONFIG.bowling, { seed });
    roll(physics, { ...shot, angle: aimFor(target, shot) });
    return physics.standingPins();
  };
  let strikes = 0;
  for (const seed of [1, 2, 3]) if (result(POCKET, seed).length === 0) strikes++;
  assert.ok(strikes >= 2, `${strikes} pocket strikes of 3`);
  // Dead on the nose or high: the head pin takes the 5 before the ball can, and pins on the far
  // side of the rack are left (4-7, 2-4-7...).
  const nose = result(0, 1);
  assert.ok(nose.length >= 2 && nose.includes(7), `nose hit left ${nose}`);
  const high = result(-0.02, 1);
  assert.ok(high.length > 0, `high hit left ${high}`);
  const light = result(-0.11, 1);
  assert.ok(light.length <= 3, `light hit left ${light}`); // light hits sometimes carry, as they do for real
});

test('a lofted ball lands past the foul line and the ball ends in the pit', () => {
  const physics = new BowlingPhysics(CONFIG.bowling);
  physics.launch({ x: 0.3, speed: 8, spin: 0, loft: 0.08 });
  let landedAt = null;
  let pit = false;
  let n = 0;
  while (physics.state === 'rolling' && n++ < 60 * 10) {
    physics.step(1 / 60);
    for (const e of physics.events) {
      if (e.type === 'land' && landedAt === null) landedAt = -physics.ball.position.z;
      if (e.type === 'pit') pit = true;
    }
  }
  assert.ok(landedAt > 0.3 && landedAt < 1.5, `landed ${landedAt} m past the foul line`);
  assert.ok(pit, 'ball should drop into the pit');
});

test('oil: heavier in the middle, dry back end; outside lines hook more', () => {
  const physics = new BowlingPhysics(CONFIG.bowling);
  const oil = physics.oil;
  assert.ok(oil.at(0, 5) > 0.95);
  assert.ok(oil.at(-0.45, 5) < 0.5, 'outside boards carry less oil');
  assert.ok(oil.at(0, 16) < 0.02, 'back end is dry');
  assert.ok(oil.mu(0, 5) < oil.mu(-0.45, 5) && oil.mu(-0.45, 5) < oil.mu(0, 16));
  const hook = (x) => {
    const p = new BowlingPhysics(CONFIG.bowling);
    p.launch({ x, speed: 8, spin: 0.6 });
    while (p.ball.position.z > -(DIM.laneLength - 0.3)) p.step(1 / 60);
    return p.ball.position.x - x;
  };
  assert.ok(hook(-0.4) > hook(-0.1) + 0.05, 'a ball played outside meets drier boards and hooks more');
});

test('lane transition: the same shot hooks more as the track breaks down; fresh oil resets it', () => {
  const physics = new BowlingPhysics(CONFIG.bowling);
  const shot = { x: 0.12, speed: 8, spin: 1, angle: -0.02 };
  const arrival = () => {
    physics.resetRack();
    physics.launch(shot);
    let x = null;
    while (physics.ballInPlay) {
      physics.step(1 / 60);
      if (x === null && physics.ball.position.z < -(DIM.laneLength - 0.25)) x = physics.ball.position.x;
    }
    return x;
  };
  const first = arrival();
  for (let i = 0; i < 20; i++) arrival();
  const later = arrival();
  assert.ok(later > first + 0.02, `track broke down: ${first} -> ${later}`);
  physics.resetOil();
  assert.ok(Math.abs(arrival() - first) < 0.005);
});

test('the ball loses a realistic amount of speed on the way down the lane', () => {
  const physics = new BowlingPhysics(CONFIG.bowling);
  physics.launch({ x: 0, speed: 8, spin: 0.5 });
  while (physics.ball.position.z > -(DIM.laneLength - 0.5)) physics.step(1 / 60);
  const v = Math.hypot(physics.ball.velocity.x, physics.ball.velocity.z);
  assert.ok(v > 6 && v < 7.6, `arrived at ${v} m/s`);
});

test('second ball: fallen pins are cleared, standing pins stay; a full reset restores ten', () => {
  const physics = new BowlingPhysics(CONFIG.bowling);
  const first = roll(physics, { x: 0.33, speed: 7, spin: 0 }); // clip the right side
  assert.ok(first >= 1 && first <= 9, `first ball ${first}`);
  physics.clearDowned();
  assert.equal(physics.countStanding(), 10 - first);
  assert.equal(physics.pins.filter((p) => !p.removed).length, 10 - first);
  const second = roll(physics, { x: -0.1, speed: 8, spin: 0 });
  assert.ok(first + second <= 10);
  physics.resetRack();
  assert.equal(physics.countStanding(), 10);
});

test('splits: head pin down and a gap between the pins left', async () => {
  const { isSplit } = await import('../public/js/games/bowling/scoring.js');
  assert.ok(isSplit([7, 10]));
  assert.ok(isSplit([4, 6, 7, 10]));
  assert.ok(isSplit([2, 7])); // a "baby split"
  assert.ok(!isSplit([4, 5]));
  assert.ok(!isSplit([1, 7])); // head pin standing: not a split
  assert.ok(!isSplit([10]));
});

test('pins: USBC tipping point; a pocket hit drives the ball through 1-2-5 and off by the 8 pin', async () => {
  const CANNON = await import('cannon-es');
  // A pin tips over at atan(base radius / centre of gravity height), about 10 degrees.
  const tilt = (deg) => {
    const physics = new BowlingPhysics(CONFIG.bowling);
    for (const p of physics.pins) if (p.index) physics._removePin(p);
    const b = physics.pins[0].body;
    b.wakeUp();
    const th = (deg * Math.PI) / 180;
    const rb = (2.031 / 2) * 0.0254;
    const h = DIM.pinComHeight;
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), th);
    b.position.set(0, rb * Math.sin(th) + h * Math.cos(th) + 0.0005, -DIM.laneLength - rb + rb * Math.cos(th) - h * Math.sin(th));
    for (let i = 0; i < 720; i++) physics.step(1 / 240);
    return physics.isStanding(physics.pins[0]);
  };
  assert.ok(tilt(9));
  assert.ok(!tilt(11));
  // Pocket: the ball itself takes out 1, 2 and 5 and leaves the deck between the 8 pin spot and
  // the middle (USBC pin carry study high-speed video: 1-2-5-8, exiting just inside the 8 spot).
  const shot = { x: 0.28, spin: 1, speed: 8.5 };
  const physics = new BowlingPhysics(CONFIG.bowling, { seed: 3 });
  physics.launch({ ...shot, angle: aimFor(POCKET, shot) });
  const touched = new Set();
  let n = 0;
  while (physics.state !== 'done' && n++ < 240 * 15) {
    physics.step(1 / 240);
    for (const e of physics.events) if (e.type === 'ballpin') touched.add(e.pin);
    physics.events.length = 0;
  }
  for (const p of [1, 2, 5]) assert.ok(touched.has(p), `ball touched ${[...touched]}`);
  assert.ok(physics.exit.x > -0.2 && physics.exit.x < 0.06, `ball left the deck at x=${physics.exit.x}`);
});

test('pinsetter: standing pins go back exactly where they stood, deadwood goes to the pit', () => {
  const physics = new BowlingPhysics(CONFIG.bowling);
  roll(physics, { x: 0.3, speed: 7.5, spin: 0 });
  const before = physics.pins.filter((p) => physics.isStanding(p)).map((p) => [p.index, p.body.position.x, p.body.position.z]);
  assert.ok(before.length > 0 && before.length < 10);
  physics.startCycle(false);
  let n = 0;
  while (physics.state === 'cycle' && n++ < 240 * 6) physics.step(1 / 240);
  for (let i = 0; i < 240; i++) physics.step(1 / 240);
  assert.equal(physics.state, 'idle');
  assert.equal(physics.countStanding(), before.length);
  assert.equal(physics.pins.filter((p) => !p.removed).length, before.length, 'deadwood removed');
  for (const [i, x, z] of before) {
    const b = physics.pins[i].body;
    assert.ok(Math.hypot(b.position.x - x, b.position.z - z) < 0.003, `pin ${i + 1} moved`);
  }
  physics.startCycle(true);
  n = 0;
  while (physics.state === 'cycle' && n++ < 240 * 6) physics.step(1 / 240);
  for (let i = 0; i < 240; i++) physics.step(1 / 240);
  assert.equal(physics.countStanding(), 10);
});
