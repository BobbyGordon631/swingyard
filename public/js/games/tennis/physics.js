// Tennis ball flight. Pure JS, no DOM (unit tested in Node).
//
// Gravity, air drag and the Magnus force from spin (topspin dips, slice floats), a bounce where
// spin and friction act at the contact point (topspin kicks forward, slice skids low), and a
// solver that finds the stroke needed to land on a target while clearing the net.
//
// Court coordinates: metres, net along z = 0, player 0's baseline at z = +LEN/2.

export const COURT = { LEN: 23.77, WID: 8.23, NET: 0.95, SERVICE: 6.4 };
export const BALL_R = 0.033;

const G = 9.81;
const DRAG = 0.0197; // 1/m  (Cd 0.55, 57.7 g, 6.7 cm)
const MAGNUS = 0.00105; // acceleration = MAGNUS * (spin x velocity)
const E_Y = 0.75; // vertical coefficient of restitution on a hard court
const MU = 0.55; // ball / court friction
const SPIN_DECAY = 0.25; // per second, in the air

export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Topspin vector (rad/s) for a ball travelling horizontally along (dx, dz); negative rate = slice. */
export function spinFor(dx, dz, rate) {
  const n = Math.hypot(dx, dz) || 1;
  // axis = up x direction of travel: the top of the ball rolls forward
  return { x: (dz / n) * rate, y: 0, z: (-dx / n) * rate };
}

/** Advance a ball { p, v, w } by dt seconds in the air. */
export function stepAir(b, dt) {
  const { v, w } = b;
  const speed = Math.hypot(v.x, v.y, v.z);
  const m = cross(w, v);
  v.x += (-DRAG * speed * v.x + MAGNUS * m.x) * dt;
  v.y += (-G - DRAG * speed * v.y + MAGNUS * m.y) * dt;
  v.z += (-DRAG * speed * v.z + MAGNUS * m.z) * dt;
  b.p.x += v.x * dt;
  b.p.y += v.y * dt;
  b.p.z += v.z * dt;
  const k = 1 - SPIN_DECAY * dt;
  w.x *= k;
  w.y *= k;
  w.z *= k;
}

/** Bounce off the court (call when p.y <= BALL_R and v.y < 0). */
export function bounce(b) {
  const { v, w } = b;
  const R = BALL_R;
  const vyIn = -v.y;
  v.y = vyIn * E_Y;
  b.p.y = R;
  // Slip of the contact point, and a friction impulse that can at most stop the slip
  // (hollow sphere: slip changes 2.5x as fast as the ball's own velocity).
  const sx = v.x + w.z * R;
  const sz = v.z - w.x * R;
  const slip = Math.hypot(sx, sz);
  if (slip > 1e-6) {
    const dv = Math.min(MU * (1 + E_Y) * vyIn, slip / 2.5);
    const dvx = (-sx / slip) * dv;
    const dvz = (-sz / slip) * dv;
    v.x += dvx;
    v.z += dvz;
    w.x += (-dvz * 1.5) / R;
    w.z += (dvx * 1.5) / R;
  }
}

/**
 * Fly a copy of the ball until its first bounce (or until it stops being interesting).
 * @returns {{land:{x,z}|null, t:number, netClear:boolean, crossed:boolean, netHeight:number|null}}
 */
export function predictLanding(ball, dt = 1 / 240) {
  const b = { p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } };
  let t = 0;
  let netHeight = null;
  while (t < 6) {
    const z0 = b.p.z;
    stepAir(b, dt);
    t += dt;
    if (netHeight === null && z0 * b.p.z <= 0 && z0 !== 0) netHeight = b.p.y;
    if (b.p.y <= BALL_R && b.v.y < 0) return { land: { x: b.p.x, z: b.p.z }, t, netClear: netHeight === null || netHeight > COURT.NET + BALL_R, crossed: netHeight !== null, netHeight };
  }
  return { land: null, t, netClear: true, crossed: netHeight !== null, netHeight };
}

/**
 * Path of a ball through its first bounce and on until it has passed `untilZ` (sign-aware) or
 * bounced twice. Used to decide where a player should run. Samples: { t, p, bounced }.
 */
export function predictPath(ball, untilZ, dt = 1 / 120) {
  const b = { p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } };
  const dir = Math.sign(untilZ - b.p.z) || 1;
  const out = [];
  let bounces = 0;
  let t = 0;
  while (t < 6 && bounces < 2 && (b.p.z - untilZ) * dir < 0) {
    stepAir(b, dt);
    t += dt;
    if (b.p.y <= BALL_R && b.v.y < 0) {
      bounce(b);
      bounces++;
    }
    out.push({ t, p: { ...b.p }, v: { ...b.v }, bounced: bounces > 0 });
  }
  return out;
}

/**
 * Find a launch velocity from `from` that lands at `target` with the given spin rate, keeping
 * close to `speed` but clearing the net (by lowering the pace and adding arc if needed).
 * @returns {{v:{x,y,z}, w:{x,y,z}, speed:number}}
 */
export function solveShot({ from, target, speed, spin = 0, netMargin = 0.3 }) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.hypot(dx, dz);
  const ux = dx / d;
  const uz = dz / d;
  const w = spinFor(ux, uz, spin);
  const landDist = (s, elev) => {
    const r = predictLanding({ p: { ...from }, v: { x: ux * Math.cos(elev) * s, y: Math.sin(elev) * s, z: uz * Math.cos(elev) * s }, w: { ...w } }, 1 / 120);
    if (!r.land) return { d: Infinity, net: r.netHeight };
    return { d: (r.land.x - from.x) * ux + (r.land.z - from.z) * uz, net: r.netHeight };
  };
  let s = speed;
  let best = null;
  for (let attempt = 0; attempt < 14; attempt++) {
    // Bisection on elevation: landing distance grows with elevation up to ~40 degrees.
    let lo = -0.45;
    let hi = 0.75;
    if (landDist(s, hi).d < d) {
      s *= 1.12; // cannot reach even with arc: hit harder
      continue;
    }
    for (let k = 0; k < 22; k++) {
      const mid = (lo + hi) / 2;
      if (landDist(s, mid).d < d) lo = mid;
      else hi = mid;
    }
    const elev = (lo + hi) / 2;
    const r = landDist(s, elev);
    best = { elev, s };
    const crossesNet = from.z * target.z < 0;
    if (!crossesNet || r.net === null || r.net > COURT.NET + BALL_R + netMargin) break;
    s *= 0.92; // too flat to clear the net: take pace off for a higher arc
  }
  if (!best) best = { elev: 0.3, s };
  return {
    v: { x: ux * Math.cos(best.elev) * best.s, y: Math.sin(best.elev) * best.s, z: uz * Math.cos(best.elev) * best.s },
    w,
    speed: best.s,
  };
}

/** Which service box a serve must land in: { xMin, xMax, zMin, zMax }. */
export function serviceBox(server, deuceSide) {
  const half = COURT.WID / 2;
  // Server 0 stands at +z and serves toward -z; their deuce court is on their right (+x),
  // so the serve goes cross-court to the receiver's deuce box at -x. Server 1 is mirrored.
  const toward = server === 0 ? -1 : 1;
  const xSign = (server === 0 ? -1 : 1) * (deuceSide ? 1 : -1);
  const xs = [0, xSign * half].sort((a, b) => a - b);
  const zs = [0, toward * COURT.SERVICE].sort((a, b) => a - b);
  return { xMin: xs[0], xMax: xs[1], zMin: zs[0], zMax: zs[1] };
}

export const inBox = (box, x, z, slack = 0.05) => x >= box.xMin - slack && x <= box.xMax + slack && z >= box.zMin - slack && z <= box.zMax + slack;
