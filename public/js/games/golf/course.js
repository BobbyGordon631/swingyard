// Golf course data and ball physics. Pure JS, no DOM (unit tested in Node).
// Ground coordinates in metres: +x right, -z "up the hole". The tee is at the origin.

export const CLUBS = [
  { name: 'Driver', carry: 220, loft: 14 },
  { name: '3 Wood', carry: 190, loft: 17 },
  { name: '5 Iron', carry: 160, loft: 24 },
  { name: '8 Iron', carry: 125, loft: 32 },
  { name: 'Wedge', carry: 80, loft: 44 },
  { name: 'Putter', carry: 0, loft: 0 },
];
export const PUTTER = CLUBS.length - 1;

export const HOLES = [
  { par: 3, pin: [8, -150], path: [[0, -8], [8, -150]], width: 28, greenR: 13, sand: [[-13, -141, 7], [25, -158, 6]], water: [] },
  { par: 4, pin: [-30, -300], path: [[0, -8], [10, -170], [-30, -300]], width: 36, greenR: 14, sand: [[30, -186, 9], [-49, -293, 7]], water: [[-26, -212, 15]] },
  { par: 5, pin: [20, -430], path: [[0, -8], [-25, -160], [15, -300], [20, -430]], width: 38, greenR: 15, sand: [[-47, -166, 9], [40, -305, 10], [1, -424, 5]], water: [[36, -222, 16]] },
];

const G = 9.81;
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

function distToSegment(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return dist(px, pz, ax + dx * t, az + dz * t);
}

/** What the ball is sitting on: 'ob' | 'water' | 'sand' | 'green' | 'fairway' | 'rough'. */
export function lieAt(hole, x, z) {
  if (Math.abs(x) > 130 || z > 40 || z < hole.pin[1] - 70) return 'ob';
  for (const [wx, wz, r] of hole.water) if (dist(x, z, wx, wz) <= r) return 'water';
  for (const [sx, sz, r] of hole.sand) if (dist(x, z, sx, sz) <= r) return 'sand';
  if (dist(x, z, hole.pin[0], hole.pin[1]) <= hole.greenR) return 'green';
  if (dist(x, z, 0, 0) <= 5) return 'fairway'; // tee box
  for (let i = 0; i < hole.path.length - 1; i++) {
    if (distToSegment(x, z, hole.path[i], hole.path[i + 1]) <= hole.width / 2) return 'fairway';
  }
  return 'rough';
}

export const distanceToPin = (hole, pos) => dist(pos[0], pos[1], hole.pin[0], hole.pin[1]);
/** Aim angle (radians) pointing from pos at the pin. 0 = straight up the hole (-z), positive = right. */
export const angleToPin = (hole, pos) => Math.atan2(hole.pin[0] - pos[0], -(hole.pin[1] - pos[1]));

/** The shortest club that can still reach `d` metres from this lie. */
export function suggestClub(d, lie) {
  if (lie === 'green') return PUTTER;
  const factor = LIE_POWER[lie] ?? 1;
  for (let i = PUTTER - 1; i >= 0; i--) if (CLUBS[i].carry * factor >= d) return i;
  return 0;
}

const LIE_POWER = { rough: 0.85, sand: 0.6 };
const ROLL = { fairway: [0.32, 5], green: [0.22, 2.2], rough: [0.12, 12] }; // [speed kept on landing, deceleration]

/**
 * Simulate a full shot.
 * @param {object} o
 * @param {object} o.hole
 * @param {[number, number]} o.pos   start [x, z]
 * @param {number} o.aim             radians, 0 = -z, positive = right
 * @param {number} o.club            index into CLUBS (not the putter)
 * @param {number} o.power           0..1
 * @param {number} o.spin            -1..1, positive curves right (slice), negative left (hook)
 * @param {{x:number, z:number}} o.wind  m/s
 * @param {{curveAccel:number, windEffect:number}} o.cfg
 * @returns {{points:{x,y,z}[], end:[number,number], lie:string, carry:number, holed:boolean, penalty:boolean}}
 */
export function simulateShot({ hole, pos, aim, club, power, spin = 0, wind = { x: 0, z: 0 }, cfg }) {
  const c = CLUBS[club];
  const startLie = lieAt(hole, pos[0], pos[1]);
  const carryTarget = c.carry * Math.max(0.08, Math.min(1, power)) * (LIE_POWER[startLie] ?? 1);
  const loft = (c.loft * Math.PI) / 180;
  const v0 = Math.sqrt((carryTarget * G) / Math.sin(2 * loft));
  const dx = Math.sin(aim);
  const dz = -Math.cos(aim);
  let x = pos[0];
  let z = pos[1];
  let y = 0;
  let vx = dx * v0 * Math.cos(loft);
  let vz = dz * v0 * Math.cos(loft);
  let vy = v0 * Math.sin(loft);
  const points = [{ x, y, z }];
  const dt = 0.02;
  // In the air: gravity, wind push, and sideways curve from spin (right of travel = (-dz, dx)).
  const ax = wind.x * cfg.windEffect + -dz * spin * cfg.curveAccel;
  const az = wind.z * cfg.windEffect + dx * spin * cfg.curveAccel;
  do {
    vx += ax * dt;
    vz += az * dt;
    vy -= G * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    points.push({ x, y: Math.max(0, y), z });
  } while (y > 0 && points.length < 3000);
  const carry = dist(x, z, pos[0], pos[1]);

  // On the ground: roll until friction stops it.
  let lie = lieAt(hole, x, z);
  let holed = false;
  if (ROLL[lie]) {
    let speed = Math.hypot(vx, vz);
    const ux = vx / speed;
    const uz = vz / speed;
    speed *= ROLL[lie][0];
    while (speed > 0.2) {
      x += ux * speed * dt;
      z += uz * speed * dt;
      lie = lieAt(hole, x, z);
      points.push({ x, y: 0, z });
      if (!ROLL[lie]) break;
      if (lie === 'green' && distanceToPin(hole, [x, z]) < 0.3 && speed < 6) {
        holed = true;
        break;
      }
      speed -= ROLL[lie][1] * dt;
    }
  }
  return { points, end: [x, z], lie, carry, holed, penalty: lie === 'water' || lie === 'ob' };
}

/**
 * Simulate a putt. Full power rolls cfg.puttMax metres on the green.
 * @returns {{points:{x,y,z}[], end:[number,number], lie:string, holed:boolean}}
 */
export function simulatePutt({ hole, pos, aim, power, cfg }) {
  const decel = 1.6;
  const d = Math.max(0.3, power * cfg.puttMax);
  let speed = Math.sqrt(2 * decel * d);
  const ux = Math.sin(aim);
  const uz = -Math.cos(aim);
  let [x, z] = pos;
  const dt = 0.01;
  const points = [{ x, y: 0, z }];
  let holed = false;
  let lie = 'green';
  while (speed > 0.05) {
    x += ux * speed * dt;
    z += uz * speed * dt;
    points.push({ x, y: 0, z });
    lie = lieAt(hole, x, z);
    if (distanceToPin(hole, [x, z]) < 0.17 && speed < 3.2) {
      holed = true;
      break;
    }
    speed -= (lie === 'green' ? decel : 9) * dt;
    if (lie === 'water' || lie === 'sand' || lie === 'ob') break;
  }
  return { points, end: [x, z], lie, holed, penalty: lie === 'water' || lie === 'ob' };
}

export function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  return { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' }[d] ?? `${d > 0 ? '+' : ''}${d}`;
}
