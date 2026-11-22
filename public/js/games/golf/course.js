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

// ---- Ball physics ----
// A real golf ball in air: quadratic drag, and lift from backspin (more spin, more lift, on the shorter
// clubs). k = 0.5 * rho * C * A / m, with rho 1.225 kg/m^3, A = pi * 0.02134^2 m^2, m = 0.04593 kg.
const K_AIR = (0.5 * 1.225 * Math.PI * 0.02134 * 0.02134) / 0.04593;
const CD = 0.25;
const liftFor = (loftDeg) => 0.13 + (loftDeg - 10) * 0.004; // CL: ~0.15 for a driver, ~0.27 for a wedge

// Landing on each surface: e = coefficient of restitution (how much of the downward speed comes back up),
// mu = friction during the impact (how much forward speed the turf takes away), roll = rolling deceleration
// (m/s^2) once it stops bouncing. Soft greens and rough grab the ball; sand swallows it; water and
// out of bounds stop it dead.
export const SURFACE = {
  fairway: { e: 0.38, mu: 0.4, roll: 1.6 },
  green: { e: 0.28, mu: 0.48, roll: 0.9 },
  rough: { e: 0.2, mu: 0.6, roll: 5 },
  sand: { e: 0.04, mu: 0.95, roll: 30 },
};
const BOUNCE_MIN = 1.0; // m/s: below this the ball stops hopping and rolls

/**
 * Fly a ball from (x, 0, z) with velocity v until it comes back down to the ground.
 * Pushes points every dt; returns the landing state (interpolated to y = 0).
 */
function fly(s, { ax = 0, az = 0, cl = 0, dt = 0.02, points, maxSteps = 3000 }) {
  let { x, y, z, vx, vy, vz } = s;
  for (let n = 0; n < maxSteps; n++) {
    const sp = Math.hypot(vx, vy, vz) || 1e-9;
    const vh = Math.hypot(vx, vz) || 1e-9;
    // Drag opposes motion; lift is perpendicular to it, in the vertical plane, upward.
    const kd = K_AIR * CD * sp;
    const kl = K_AIR * cl * sp;
    const lx = (-vy * vx) / vh;
    const lz = (-vy * vz) / vh;
    vx += (ax - kd * vx + kl * lx) * dt;
    vz += (az - kd * vz + kl * lz) * dt;
    vy += (-G - kd * vy + kl * vh) * dt;
    const py = y;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (y <= 0 && vy < 0) {
      // Back up to the exact touchdown.
      const f = py / (py - y || 1);
      x -= vx * dt * (1 - f);
      z -= vz * dt * (1 - f);
      y = 0;
      points?.push({ x, y: 0, z });
      return { x, y, z, vx, vy, vz };
    }
    points?.push({ x, y, z });
  }
  return { x, y: 0, z, vx, vy: 0, vz };
}

// Launch speed that carries `carry` metres at this loft (in still air, no curve). Carry rises with speed,
// so a bisection finds it; cached, since the aim preview asks every frame.
const V0_CACHE = new Map();
function launchSpeed(loftDeg, carry) {
  const key = `${loftDeg}|${carry.toFixed(1)}`;
  if (V0_CACHE.has(key)) return V0_CACHE.get(key);
  const loft = (loftDeg * Math.PI) / 180;
  const cl = liftFor(loftDeg);
  let lo = 3;
  let hi = 140;
  for (let i = 0; i < 26; i++) {
    const v = (lo + hi) / 2;
    const end = fly({ x: 0, y: 0, z: 0, vx: 0, vy: v * Math.sin(loft), vz: -v * Math.cos(loft) }, { cl, dt: 0.02 }); // same step as the real flight, so the carry matches
    if (-end.z < carry) lo = v;
    else hi = v;
  }
  const v0 = (lo + hi) / 2;
  if (V0_CACHE.size > 4000) V0_CACHE.clear();
  V0_CACHE.set(key, v0);
  return v0;
}

/**
 * After touchdown: bounce (restitution + turf friction) until the hops die out, then roll to a stop.
 * Stops at once in water / out of bounds / sand plugs. Returns the final state.
 */
function bounceAndRoll(hole, s, points, dt = 0.02) {
  let { x, z, vx, vy, vz } = s;
  let lie = lieAt(hole, x, z);
  for (let hops = 0; hops < 12; hops++) {
    const surf = SURFACE[lie];
    if (!surf) return { x, z, lie, holed: false }; // water / out of bounds: it stays where it went in
    // A ball dropping onto the cup itself goes in.
    if (lie === 'green' && distanceToPin(hole, [x, z]) < 0.08 && Math.hypot(vx, vz) < 4) return { x: hole.pin[0], z: hole.pin[1], lie, holed: true };
    const vin = -vy; // downward speed into the ground
    const vh = Math.hypot(vx, vz);
    // Friction impulse during the impact (Coulomb, limited so it can't reverse the ball).
    const dv = Math.min(vh, surf.mu * (1 + surf.e) * vin);
    const k = vh > 1e-6 ? (vh - dv) / vh : 0;
    vx *= k;
    vz *= k;
    vy = surf.e * vin;
    if (vy < BOUNCE_MIN) break;
    const land = fly({ x, y: 0, z, vx, vy, vz }, { cl: 0, dt, points });
    ({ x, z, vx, vy, vz } = land);
    lie = lieAt(hole, x, z);
  }
  // Rolling: constant rolling resistance for the surface underfoot.
  let speed = Math.hypot(vx, vz);
  const ux = speed > 1e-6 ? vx / speed : 0;
  const uz = speed > 1e-6 ? vz / speed : 0;
  while (speed > 0.15 && SURFACE[lie]) {
    x += ux * speed * dt;
    z += uz * speed * dt;
    lie = lieAt(hole, x, z);
    points.push({ x, y: 0, z });
    if (!SURFACE[lie]) break;
    if (lie === 'green' && distanceToPin(hole, [x, z]) < 0.3 && speed < 6) return { x, z, lie, holed: true };
    speed -= SURFACE[lie].roll * dt;
  }
  return { x, z, lie, holed: false };
}

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
  const v0 = launchSpeed(c.loft, carryTarget);
  const dx = Math.sin(aim);
  const dz = -Math.cos(aim);
  const points = [{ x: pos[0], y: 0, z: pos[1] }];
  // In the air: gravity, drag, backspin lift, wind push, and sideways curve from spin (right of travel = (-dz, dx)).
  const ax = wind.x * cfg.windEffect + -dz * spin * cfg.curveAccel;
  const az = wind.z * cfg.windEffect + dx * spin * cfg.curveAccel;
  const launch = { x: pos[0], y: 0, z: pos[1], vx: dx * v0 * Math.cos(loft), vy: v0 * Math.sin(loft), vz: dz * v0 * Math.cos(loft) };
  const land = fly(launch, { ax, az, cl: liftFor(c.loft), points });
  const carry = dist(land.x, land.z, pos[0], pos[1]);
  // On the ground: it bounces, then rolls, as the surface allows.
  const end = bounceAndRoll(hole, land, points);
  return { points, end: [end.x, end.z], lie: end.lie, carry, holed: end.holed, penalty: end.lie === 'water' || end.lie === 'ob' };
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
