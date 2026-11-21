// Rules and physics for baseball, golf and archery (pure modules, no rendering).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../public/js/config.js';
import { advance, walk, battedBall, flyPath, fieldPlay, POSITIONS } from '../public/js/games/baseball/rules.js';
import { CLUBS, PUTTER, HOLES, lieAt, suggestClub, simulateShot, simulatePutt, angleToPin, distanceToPin, scoreName } from '../public/js/games/golf/course.js';

const seq = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

test('baseball: base running', () => {
  assert.deepEqual(advance([false, false, false], 1), { bases: [true, false, false], runs: 0 });
  assert.deepEqual(advance([true, false, true], 1), { bases: [true, true, false], runs: 1 });
  assert.deepEqual(advance([true, true, false], 2), { bases: [false, true, true], runs: 1 });
  assert.deepEqual(advance([true, true, true], 4), { bases: [false, false, false], runs: 4 }); // grand slam
  assert.deepEqual(advance([false, true, false], 3), { bases: [false, false, true], runs: 1 });
});

test('baseball: walks only force runners', () => {
  assert.deepEqual(walk([false, false, true]), { bases: [true, false, true], runs: 0 });
  assert.deepEqual(walk([true, false, true]), { bases: [true, true, true], runs: 0 });
  assert.deepEqual(walk([true, true, true]), { bases: [true, true, true], runs: 1 });
});

const FIELD = { react: 0.4, fielderSpeed: 6.4, runnerSpeed: 7.4, throwSpeed: 30 };

test('baseball: batted balls - timing sets direction, power and quality set distance', () => {
  const still = () => 0.5; // no random scatter
  const perfect = battedBall({ err: 0, power: 1, rnd: still });
  const weak = battedBall({ err: 0, power: 0.2, rnd: still });
  const late = battedBall({ err: 0.6, power: 1, rnd: still });
  assert.ok(perfect.speed > weak.speed && perfect.speed > late.speed);
  assert.ok(battedBall({ err: -0.5, power: 1, rnd: still }).spray < 0); // early pulls to left field
  assert.ok(late.spray > 0);
  assert.ok(battedBall({ err: 0, power: 1, lift: 1, rnd: still }).launch > battedBall({ err: 0, power: 1, lift: -1, rnd: still }).launch);
  // Flight with drag: a well-struck ball carries far, a hard grounder lands almost at once.
  const carry = (speed, launch) => {
    const p = flyPath({ speed, launch, spray: 0 });
    const e = p[p.length - 1];
    return Math.hypot(e.x, e.z);
  };
  assert.ok(carry(48, 28) > 110 && carry(48, 28) < 135);
  assert.ok(carry(30, 10) < 45);
  assert.ok(carry(40, -5) < 15);
});

test('baseball: fielders really race the ball', () => {
  assert.equal(fieldPlay({ hit: { speed: 49, launch: 28, spray: 5 }, ...FIELD }).kind, 'homer');
  assert.equal(fieldPlay({ hit: { speed: 40, launch: 20, spray: 60 }, ...FIELD }).kind, 'foul');
  // Hit straight at the centre fielder: caught.
  const fly = fieldPlay({ hit: { speed: 38, launch: 30, spray: 0 }, ...FIELD });
  assert.equal(fly.kind, 'out');
  assert.ok(fly.caught);
  assert.equal(POSITIONS[fly.fielder][0], 'CF');
  // A routine grounder to short: thrown out at first; with a runner on first and nobody out, a double play.
  const grounder = { speed: 26, launch: -8, spray: -14 };
  const go = fieldPlay({ hit: grounder, ...FIELD });
  assert.equal(go.kind, 'out');
  assert.equal(go.throwTo, 0);
  assert.equal(fieldPlay({ hit: grounder, ...FIELD, bases: [true, false, false], outs: 0 }).text, 'Double play!');
  // A liner into the left-field corner rolls to the wall: extra bases.
  const corner = fieldPlay({ hit: { speed: 42, launch: 12, spray: -38 }, ...FIELD });
  assert.ok(corner.bases >= 2, `${corner.kind}`);
  // Slower fielders give up more.
  const slow = fieldPlay({ hit: { speed: 36, launch: 16, spray: 12 }, ...FIELD, fielderSpeed: 4, react: 0.9 });
  assert.notEqual(slow.kind, 'out');
});

test('baseball: a deep fly with a runner on third and fewer than two outs is a sacrifice fly', () => {
  const deep = { speed: 38, launch: 30, spray: 0 }; // caught by the centre fielder 70+ m out
  const r = fieldPlay({ hit: deep, ...FIELD, bases: [false, false, true], outs: 1 });
  assert.equal(r.kind, 'out');
  assert.ok(r.sacFly);
  assert.equal(fieldPlay({ hit: deep, ...FIELD, bases: [false, false, true], outs: 2 }).sacFly, false);
});

test('golf: lies', () => {
  const h = HOLES[1];
  assert.equal(lieAt(h, 0, 0), 'fairway');
  assert.equal(lieAt(h, h.pin[0], h.pin[1]), 'green');
  assert.equal(lieAt(h, h.water[0][0], h.water[0][1]), 'water');
  assert.equal(lieAt(h, h.sand[0][0], h.sand[0][1]), 'sand');
  assert.equal(lieAt(h, 100, -100), 'rough');
  assert.equal(lieAt(h, 200, -100), 'ob');
  for (const hole of HOLES) {
    // every hazard sits somewhere the hole actually uses, and the pin is not in one
    assert.equal(lieAt(hole, hole.pin[0], hole.pin[1]), 'green');
    assert.equal(lieAt(hole, hole.path[1][0], hole.path[1][1]) === 'ob', false);
  }
});

test('golf: full-power shots carry about the club distance and roll out', () => {
  const cfg = CONFIG.golf;
  for (let club = 0; club < PUTTER; club++) {
    const r = simulateShot({ hole: HOLES[2], pos: [0, 0], aim: 0, club, power: 1, cfg });
    assert.ok(Math.abs(r.carry - CLUBS[club].carry) < CLUBS[club].carry * 0.03, `${CLUBS[club].name} carried ${r.carry}`);
    assert.ok(Math.abs(r.end[0]) < 0.5, 'no wind, no spin: straight');
  }
  const half = simulateShot({ hole: HOLES[2], pos: [0, 0], aim: 0, club: 0, power: 0.5, cfg });
  assert.ok(half.carry > 100 && half.carry < 120);
});

test('golf: spin curves the ball, wind pushes it, rough costs distance', () => {
  const cfg = CONFIG.golf;
  const shot = (o) => simulateShot({ hole: HOLES[2], pos: [0, 0], aim: 0, club: 2, power: 1, cfg, ...o });
  const slice = shot({ spin: 1 });
  const hook = shot({ spin: -1 });
  assert.ok(slice.end[0] > 8, `slice ended at x=${slice.end[0]}`);
  assert.ok(hook.end[0] < -8);
  assert.ok(shot({ wind: { x: 6, z: 0 } }).end[0] > 4);
  assert.ok(shot({ wind: { x: 0, z: -6 } }).carry > shot({}).carry); // tailwind
  const fromRough = simulateShot({ hole: HOLES[2], pos: [80, -60], aim: 0, club: 2, power: 1, cfg });
  assert.equal(lieAt(HOLES[2], 80, -60), 'rough');
  assert.ok(fromRough.carry < shot({}).carry * 0.9);
});

test('golf: water is a penalty, bunkers stop the ball', () => {
  const cfg = CONFIG.golf;
  const h = HOLES[1];
  const [wx, wz] = h.water[0];
  const pos = [wx, wz + 100];
  const wet = simulateShot({ hole: h, pos, aim: 0, club: 4, power: 1, cfg }); // wedge carries 80... from rough/fairway
  const dry = simulateShot({ hole: h, pos: [wx, wz + 80], aim: 0, club: 4, power: 1, cfg });
  assert.ok(wet.penalty || dry.penalty, 'one of the two lands in the pond');
  const [sx, sz, sr] = h.sand[0];
  const bunker = simulateShot({ hole: h, pos: [sx, sz + 80], aim: 0, club: 4, power: 1, cfg });
  if (bunker.lie === 'sand') assert.ok(Math.hypot(bunker.end[0] - sx, bunker.end[1] - sz) <= sr);
});

test('golf: club suggestions', () => {
  assert.equal(suggestClub(5, 'green'), PUTTER);
  assert.equal(CLUBS[suggestClub(70, 'fairway')].name, 'Wedge');
  assert.equal(CLUBS[suggestClub(150, 'fairway')].name, '5 Iron');
  assert.equal(CLUBS[suggestClub(400, 'fairway')].name, 'Driver');
  assert.notEqual(CLUBS[suggestClub(70, 'sand')].name, 'Wedge'); // sand takes distance off
});

test('golf: putting', () => {
  const cfg = CONFIG.golf;
  const h = HOLES[0];
  const pos = [h.pin[0], h.pin[1] + 6]; // 6 m straight below the hole
  const aim = angleToPin(h, pos);
  assert.ok(Math.abs(aim) < 1e-9);
  const good = simulatePutt({ hole: h, pos, aim, power: 7 / cfg.puttMax, cfg });
  assert.ok(good.holed, 'a firm, straight putt drops');
  const short = simulatePutt({ hole: h, pos, aim, power: 3 / cfg.puttMax, cfg });
  assert.ok(!short.holed);
  assert.ok(Math.abs(distanceToPin(h, short.end) - 3) < 0.2, 'power maps to roll distance');
  const wide = simulatePutt({ hole: h, pos, aim: aim + 0.2, power: 7 / cfg.puttMax, cfg });
  assert.ok(!wide.holed);
  const hot = simulatePutt({ hole: h, pos, aim, power: 1, cfg });
  assert.ok(!hot.holed, 'too fast: rolls over the hole');
});

test('golf: score names', () => {
  assert.equal(scoreName(1, 3), 'Hole in one!');
  assert.equal(scoreName(3, 5), 'Eagle!');
  assert.equal(scoreName(3, 4), 'Birdie!');
  assert.equal(scoreName(4, 4), 'Par');
  assert.equal(scoreName(5, 4), 'Bogey');
  assert.equal(scoreName(8, 4), '+4');
});

test('archery: ring scores and where arrows land', async () => {
  const { ringScore, impactPoint } = await import('../public/js/games/archery/game.js');
  assert.equal(ringScore(0), 10);
  assert.equal(ringScore(0.06), 10);
  assert.equal(ringScore(0.07), 9);
  assert.equal(ringScore(0.6), 1);
  assert.equal(ringScore(0.62), 0);
  assert.deepEqual(impactPoint({ aimX: 0, aimY: 0, draw: 1, windX: 0, distance: 50 }), { x: 0, y: 0 });
  assert.ok(impactPoint({ aimX: 0, aimY: 0, draw: 0.5, windX: 0, distance: 50 }).y < -0.5); // short draw drops
  const near = impactPoint({ aimX: 0, aimY: 0, draw: 1, windX: 4, distance: 20 }).x;
  const far = impactPoint({ aimX: 0, aimY: 0, draw: 1, windX: 4, distance: 50 }).x;
  assert.ok(near > 0 && far > near * 2); // wind matters more at range
  assert.ok(impactPoint({ aimX: 0, aimY: 0, draw: 1, windX: -4, distance: 50 }).x < 0);
});

test('swings report their direction (jab vs hook, slash left/right/down)', async () => {
  const { KeyboardSource } = await import('../public/js/input/keyboardSource.js');
  const swingWith = (keys) => {
    const kb = new KeyboardSource(CONFIG);
    let got = null;
    kb.on('swing', (s) => (got = s));
    let now = 1000;
    for (let i = 0; i < 5; i++) kb.update((now += 16));
    kb.pressTrigger(now);
    for (let i = 0; i < 20; i++) kb.update((now += 16));
    Object.assign(kb.keys, keys);
    kb.releaseTrigger(now);
    for (let i = 0; i < 40; i++) kb.update((now += 16));
    return got;
  };
  const jab = swingWith({});
  assert.equal(jab.axis, 'y');
  assert.ok(Math.abs(jab.yaw) < 30 && Math.abs(jab.pitch) < 30);
  const right = swingWith({ right: true });
  assert.equal(right.axis, 'x');
  assert.ok(right.yaw > 100 && right.twist > 0.5);
  assert.ok(swingWith({ left: true }).yaw < -100);
  const down = swingWith({ down: true });
  assert.ok(down.pitch < -100 && Math.abs(down.yaw) < 30);
  // Direction of travel in TV axes (x right, y up, -z toward the screen)
  assert.ok(jab.move.z < -0.9);
  assert.ok(right.move.x > 0.9);
  assert.ok(swingWith({ up: true }).move.y > 0.9);
  assert.ok(down.move.y < -0.9);
});
