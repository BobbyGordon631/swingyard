// Bowling lane physics (cannon-es). No DOM or rendering here, so it also runs in Node tests.
// Coordinates: metres. Foul line at z = 0, ball travels toward -z, head pin at z = -laneLength.
//
// Sources for the numbers below:
//   USBC Equipment Specifications Manual - tenpin dimensions (14 stations), weight 3 lb 8 oz,
//     centre of gravity 5.781 in, radius of gyration squared 13.90 in^2, coefficient of
//     restitution 0.670, base flat diameter 2.031 in with a 5/32 in rounded edge; kickbacks
//     60 1/8 in apart and 20 1/2 in high from 15 in ahead of the head pin; flat gutters beside the
//     deck square-bottomed and 3 1/2 in deep at the back row; pin deck ends 2 ft 10 3/16 in behind
//     the head pin; cushion at least 25 in behind the deck; pinsetter table may not reach the
//     pins until 3 s after the ball reaches the pit, and returns standing pins to where they stood.
//   USBC Pin Carry Study (Bowl Expo 2009) - high speed video of strikes: the ball takes out
//     1-3-5-9 (1-2-5-8 from the other side) and exits the deck beside the 9 (8) pin spot; pins hit
//     the pin deck, kickbacks and flat gutters in roughly a 45 / 38 / 17 split; flat gutter COR
//     0.37-0.66.
//   Ji et al. 2022 (arXiv 2210.06753) / Banerjee 2014 - ball/lane friction ~0.04 oiled, ~0.2 dry.
//
// The ball is not steered. It is released with a velocity and a spin (rev rate, axis rotation and
// axis tilt) and the lane does the rest:
//   skid  - on the oil friction is tiny, the ball slides and slowly picks up roll
//   hook  - on the drier back end friction at the contact patch turns side spin into sideways motion
//   roll  - once the contact patch stops slipping the ball rolls on its new line
// Friction at the contact patch is applied here (cannon's own ball/lane friction is off) so the
// ball's linear and angular velocity stay consistent; the ball has a dense core (RG 2.50 in).
//
// Two cannon-es shortcuts are corrected for realistic pin action:
//   - friction: cannon caps the friction *impulse* per step at mu*m*g (a force), about 1/STEP
//     times too strong. Resting friction is rescaled, and impact friction (ball/pin, pin/pin,
//     pin/deck) is applied separately as a proper Coulomb impulse (at most mu x normal impulse).
//   - restitution: cannon applies the coefficient of restitution to the linear part of the contact
//     velocity only, so a pin struck away from its centre of mass (almost every hit) rebounds
//     wrongly. The contact equation is patched to apply Newton's law to the full contact velocity.
//
// The pinsetter is part of the simulation: the sweep bar and the setting table are moving
// (kinematic) bodies that really push the deadwood into the pit and lift the standing pins.
import * as CANNON from 'cannon-es';
import { LaneOil } from './oil.js';

const IN = 0.0254;

export const DIM = {
  laneLength: 18.288, // foul line to head pin (60 ft)
  laneWidth: 1.0541, // 41.5 in, 39 boards
  gutterWidth: 0.235, // 9.25 in
  gutterDepth: 1.875 * IN, // round gutters beside the lane
  flatGutterDepth: 3.5 * IN, // square gutters beside the pin deck
  pinSpacing: 12 * IN, // centre to centre
  pinHeight: 15 * IN,
  pinRadius: (4.766 / 2) * IN, // widest point (the belly)
  pinComHeight: 5.781 * IN,
  pinMass: 1.588, // 3 lb 8 oz
  pinRG2: 13.9 * IN * IN, // radius of gyration squared about the centre of gravity
  ballRadius: 0.1085, // 8.5 in diameter
  ballMass: 6.8, // 15 lb
  ballRG: 2.5 * IN, // radius of gyration (a uniform sphere would be 2.70 in)
  deckEnd: (2 * 12 + 10.1875) * IN, // head pin to the end of the pin deck
  pitDepth: 0.35,
  kickbackFrom: 15 * IN, // kickbacks start this far in front of the head pin
  kickbackX: (60.125 / 2) * IN, // inner face of each kickback from the lane centre
  kickbackHeight: 20.5 * IN,
  cushionGap: 0.72, // deck end to the pit cushion (spec: at least 25 in)
};

/** USBC tenpin profile: [height above the base, diameter], inches. */
export const PIN_PROFILE = [
  [0, 2.031], [0.156, 2.343], [0.75, 2.828], [2.25, 3.906], [3.375, 4.51], [4.5, 4.766], [5.875, 4.563],
  [7.25, 3.703], [8.625, 2.472], [9.375, 1.965], [10, 1.797], [10.875, 1.87], [11.75, 2.094], [12.625, 2.406], [13.5, 2.547],
];
const PIN_HEAD_R = 1.273 * IN; // the top is a uniform arc of this radius
const PIN_HEAD_Y = DIM.pinHeight - PIN_HEAD_R;

/** Pin radius (m) at height h (m) above its base. */
export function pinRadiusAt(h) {
  const hi = h / IN;
  if (hi >= 13.5) {
    const dy = h - PIN_HEAD_Y;
    return Math.sqrt(Math.max(0, PIN_HEAD_R * PIN_HEAD_R - dy * dy));
  }
  for (let i = 1; i < PIN_PROFILE.length; i++) {
    const [h1, d1] = PIN_PROFILE[i];
    if (hi <= h1) {
      const [h0, d0] = PIN_PROFILE[i - 1];
      const t = (hi - h0) / (h1 - h0);
      // Smooth (cosine) blend between stations so the shape has no corners.
      const s = (1 - Math.cos(Math.PI * t)) / 2;
      return ((d0 + (d1 - d0) * s) / 2) * IN;
    }
  }
  return 0;
}

const GROUP_STATIC = 1;
const GROUP_PIN = 2;
const GROUP_BALL = 4;
const GROUP_MACHINE = 8;
export const STEP = 1 / 240;
const G = 9.81;
const D2R = Math.PI / 180;
const UP = new CANNON.Vec3(0, 1, 0);
const tmp = new CANNON.Vec3();
const R = DIM.ballRadius;
const K_BALL = (DIM.ballRG * DIM.ballRG) / (R * R); // I / (m r^2)
export const PIT_Z = -(DIM.laneLength + DIM.deckEnd);

// ---------------------------------------------------------------- cannon-es restitution fix
{
  const rixn = new CANNON.Vec3();
  const rjxn = new CANNON.Vec3();
  const pen = new CANNON.Vec3();
  CANNON.ContactEquation.prototype.computeB = function computeB(h) {
    const bi = this.bi;
    const bj = this.bj;
    const ri = this.ri;
    const rj = this.rj;
    const n = this.ni;
    ri.cross(n, rixn);
    rj.cross(n, rjxn);
    const GA = this.jacobianElementA;
    const GB = this.jacobianElementB;
    n.negate(GA.spatial);
    rixn.negate(GA.rotational);
    GB.spatial.copy(n);
    GB.rotational.copy(rjxn);
    pen.copy(bj.position);
    pen.vadd(rj, pen);
    pen.vsub(bi.position, pen);
    pen.vsub(ri, pen);
    const g = n.dot(pen);
    // Newton's law of restitution on the whole relative velocity at the contact point
    // (translation and rotation), not just the translational part.
    const vrel = bj.velocity.dot(n) - bi.velocity.dot(n) + bj.angularVelocity.dot(rjxn) - bi.angularVelocity.dot(rixn);
    const GW = (this.restitution + 1) * vrel;
    return -g * this.a - GW * this.b - h * this.computeGiMf();
  };
}

/** Home positions of pins 1-10 as [x, z]. */
export function pinHomes() {
  const out = [];
  const rowDepth = DIM.pinSpacing * Math.sin(Math.PI / 3);
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      out.push([(i - row / 2) * DIM.pinSpacing, -(DIM.laneLength + row * rowDepth)]);
    }
  }
  return out;
}

// Pin collision shape: a ring of small spheres for the base (the 5/32 in rounded edge of a 2.031 in
// flat - the edge it tips over on), then a dense chain of spheres following the USBC profile (each
// sphere as wide as the pin at its height, spaced closely so the surface is smooth), and the head.
const BASE_EDGE_R = (5 / 32) * IN;
const BASE_RING = { n: 10, ringR: (2.031 / 2) * IN, r: BASE_EDGE_R };
function pinSpheres() {
  const out = [];
  for (let h = 0.016; h < PIN_HEAD_Y - 0.01; h += 0.019) {
    // A sphere may not reach below the base, or the pin would stand on it instead of its base.
    const r = Math.min(pinRadiusAt(h) * 0.995, h - 0.0008);
    out.push([r, h]);
  }
  out.push([PIN_HEAD_R, PIN_HEAD_Y]);
  return out;
}
const PIN_SPHERES = pinSpheres();

/** Small deterministic RNG (so tests are repeatable); mulberry32. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pinsetter cycle timeline (seconds from the start of the cycle).
export const CYCLE = {
  sweepDown: 0.3, // sweep bar drops to guard the deck
  grab: 0.65, // table down on the standing pins, grips them
  lifted: 0.95, // ...and lifts them clear
  rakeEnd: 2.15, // sweep rakes the deadwood back into the pit
  returnEnd: 2.55, // sweep back to the guard position
  set: 2.95, // table lowers the pins (or a new rack) onto the deck and lets go
  tableUp: 3.2,
  end: 3.45, // sweep bar back up
};
export const SWEEP_FRONT = -(DIM.laneLength - 0.3);
export const SWEEP_UP = 0.95; // bar bottom height when parked inside the masking unit
export const TABLE_UP = 0.95; // table underside when parked
export const TABLE_Z = -(DIM.laneLength + 0.4);
const SWEEP_BACK = PIT_Z - 0.04;
const TABLE_GRIP = DIM.pinHeight - 0.036; // table underside when gripping (pin heads in its pockets)
const LIFT = 0.34;
const smooth = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const lerp = (a, b, t) => a + (b - a) * t;

export class BowlingPhysics {
  /**
   * @param cfg CONFIG.bowling
   * @param {object} [o]
   * @param {number} [o.seed] seed for the small random spotting errors of the pinsetter
   */
  constructor(cfg, { seed = 1 } = {}) {
    this.cfg = cfg;
    this.rand = rng(seed);
    this.oil = new LaneOil(cfg, DIM.laneWidth, DIM.laneLength + DIM.deckEnd);
    this.events = []; // { type, v } drained by the game for sound / haptics
    this.state = 'idle'; // idle | rolling | settling | done | cycle
    this.inGutter = false;
    this.ballInPlay = false;
    this.airborne = false;
    this.reachedPins = false;
    this.spin = 0;
    this.phase = 'skid'; // skid | hook | roll (for the HUD / tests)
    this.track = []; // ball path [x, z] samples for this roll
    this.hookPoint = null;
    this.cycle = null; // pinsetter cycle in progress
    this._acc = 0;
    this._rollTime = 0;
    this._settleTime = 0;
    this._pitTime = 0;
    this._impacts = [];

    const world = (this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -G, 0),
      frictionGravity: new CANNON.Vec3(0, -G * STEP, 0),
    }));
    world.allowSleep = true;
    world.solver.iterations = 30;
    world.solver.tolerance = 1e-9;
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.broadphase.axisIndex = 2;

    const mat = (name) => new CANNON.Material(name);
    const laneMat = mat('lane');
    const gutterMat = mat('gutter');
    const pinMat = mat('pin');
    const baseMat = mat('pinBase');
    const ballMat = mat('ball');
    const kickMat = mat('kickback');
    const softMat = mat('soft'); // pit cushion and curtain
    const machineMat = mat('machine');
    this._mats = { pin: pinMat, base: baseMat };
    // Stiff contacts (hard maple, phenolic and Surlyn-coated pins barely deform).
    const cm = (a, b, friction, restitution) =>
      world.addContactMaterial(
        new CANNON.ContactMaterial(a, b, { friction, restitution, contactEquationStiffness: 5e8, contactEquationRelaxation: 3, frictionEquationStiffness: 5e8 }),
      );
    for (const p of [pinMat, baseMat]) {
      const base = p === baseMat;
      cm(p, laneMat, base ? 0.2 : 0.2, base ? 0.2 : 0.35); // pins slide on the deck (centres sell anti-slide treatments)
      cm(p, gutterMat, 0.25, 0.5); // flat gutter COR 0.37-0.66
      cm(p, kickMat, 0.2, cfg.kickbackCOR ?? 0.55); // kickback plates throw pins back across the deck
      cm(p, softMat, 0.6, 0.05); // the cushion stops pins dead
      cm(p, machineMat, 0.3, 0.05);
      cm(p, ballMat, 0.12, cfg.ballPinCOR ?? 0.67); // USBC pin COR 0.670
      cm(p, pinMat, 0.12, cfg.pinPinCOR ?? 0.6);
      cm(p, baseMat, 0.12, cfg.pinPinCOR ?? 0.6);
    }
    cm(ballMat, laneMat, 0, 0);
    cm(ballMat, gutterMat, 0, 0.1);
    cm(ballMat, kickMat, 0, 0.3);
    cm(ballMat, softMat, 0.6, 0.05);
    this.mu = { ballPin: cfg.ballPinFriction, pinPin: cfg.pinPinFriction, deck: 0.15, gutter: 0.2, kickback: 0.2, soft: 0.6 };

    const statics = { collisionFilterGroup: GROUP_STATIC, collisionFilterMask: GROUP_PIN | GROUP_BALL };
    const box = (m, hx, hy, hz, x, y, z) => {
      // Shape materials too: cannon only uses per-shape materials when both shapes have one.
      const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
      shape.material = m;
      const b = new CANNON.Body({ mass: 0, material: m, shape, ...statics });
      b.position.set(x, y, z);
      world.addBody(b);
      return b;
    };
    const W2 = DIM.laneWidth / 2;
    const GW = DIM.gutterWidth;
    const L = DIM.laneLength;
    const kickZ = -(L - DIM.kickbackFrom);
    // Lane and pin deck (top at y = 0), from behind the foul line to the pit.
    const laneLen = -PIT_Z + 2;
    box(laneMat, W2, 0.2, laneLen / 2, 0, -0.2, 2 - laneLen / 2);
    for (const side of [-1, 1]) {
      const gx = side * (W2 + GW / 2);
      // Round gutters beside the lane: the ball's centre sits as low in the curved channel as on
      // this flat bottom. Beside the deck: square flat gutters, deeper.
      const roundLen = 2 - kickZ;
      box(gutterMat, GW / 2, 0.2, roundLen / 2, gx, -0.2 - DIM.gutterDepth, 2 - roundLen / 2);
      const flatLen = kickZ - (PIT_Z - 0.05);
      box(gutterMat, GW / 2, 0.2, flatLen / 2, gx, -0.2 - DIM.flatGutterDepth, kickZ - flatLen / 2);
      // Capping beside the lane, then the kickbacks beside the deck.
      const kx = side * (DIM.kickbackX + 0.035);
      box(kickMat, 0.035, 0.08, roundLen / 2, kx, 0.03, 2 - roundLen / 2);
      const kLen = kickZ - (PIT_Z - DIM.cushionGap);
      const kh = DIM.kickbackHeight + DIM.flatGutterDepth;
      box(kickMat, 0.035, kh / 2, kLen / 2, kx, DIM.kickbackHeight - kh / 2, kickZ - kLen / 2);
    }
    // The pit: a padded floor below the deck, the cushion and curtain behind it.
    const pitLen = DIM.cushionGap + 0.1;
    box(softMat, 1.3, 0.1, pitLen / 2, 0, -DIM.pitDepth - 0.1, PIT_Z - pitLen / 2);
    box(softMat, 1.3, 0.8, 0.05, 0, 0.3, PIT_Z - DIM.cushionGap - 0.05);

    const ballShape = new CANNON.Sphere(R);
    ballShape.material = ballMat;
    this.ball = new CANNON.Body({
      mass: DIM.ballMass,
      material: ballMat,
      shape: ballShape,
      linearDamping: 0,
      angularDamping: 0,
      allowSleep: false,
      collisionFilterGroup: GROUP_BALL,
      collisionFilterMask: GROUP_STATIC | GROUP_PIN,
    });
    const I = DIM.ballMass * DIM.ballRG * DIM.ballRG;
    this.ball.inertia.set(I, I, I);
    this.ball.invInertia.set(1 / I, 1 / I, 1 / I);
    this.ball.updateInertiaWorld(true);

    // Pins. Inertia from the USBC radius of gyration (wood core with voids: a little more than a
    // solid pin of the same shape); about the long axis from the profile.
    const Ixx = DIM.pinMass * DIM.pinRG2;
    const Iyy = 0.002;
    this.pins = pinHomes().map(([x, z], index) => {
      const body = new CANNON.Body({
        mass: DIM.pinMass,
        material: pinMat,
        linearDamping: 0.01,
        angularDamping: 0.02,
        allowSleep: true,
        sleepSpeedLimit: 0.05,
        sleepTimeLimit: 0.4,
        collisionFilterGroup: GROUP_PIN,
        collisionFilterMask: GROUP_STATIC | GROUP_PIN | GROUP_BALL | GROUP_MACHINE,
      });
      const { n, ringR, r } = BASE_RING;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const s = new CANNON.Sphere(r);
        s.material = baseMat;
        body.addShape(s, new CANNON.Vec3(Math.cos(a) * ringR, r - DIM.pinComHeight, Math.sin(a) * ringR));
      }
      for (const [sr, y] of PIN_SPHERES) {
        const s = new CANNON.Sphere(sr);
        s.material = pinMat;
        body.addShape(s, new CANNON.Vec3(0, y - DIM.pinComHeight, 0));
      }
      body.inertia.set(Ixx, Iyy, Ixx);
      body.invInertia.set(1 / Ixx, 1 / Iyy, 1 / Ixx);
      body.updateInertiaWorld(true);
      const pin = { index, body, home: { x, z }, spot: { x, z }, removed: true, hit: false, held: false };
      body.addEventListener('collide', (e) => this._onPinCollide(pin, e));
      return pin;
    });

    // Pinsetter machine: kinematic bodies that only touch pins.
    const machine = { collisionFilterGroup: GROUP_MACHINE, collisionFilterMask: GROUP_PIN, type: CANNON.Body.KINEMATIC, mass: 0, material: machineMat };
    this.sweep = new CANNON.Body(machine);
    const barH = 0.11;
    const addBox = (body, hx, hy, hz, x, y, z) => {
      const s = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
      s.material = machineMat;
      body.addShape(s, new CANNON.Vec3(x, y, z));
    };
    // Origin = underside of the bar over the deck. It spans kickback to kickback and reaches down
    // into the flat gutters too.
    addBox(this.sweep, W2, barH / 2, 0.0175, 0, barH / 2, 0);
    for (const side of [-1, 1]) {
      const depth = DIM.flatGutterDepth - 0.004;
      addBox(this.sweep, GW / 2 - 0.002, (barH + depth) / 2, 0.0175, side * (W2 + GW / 2), (barH - depth) / 2, 0);
    }
    this.sweep.position.set(0, SWEEP_UP, SWEEP_FRONT);
    this.table = new CANNON.Body(machine);
    addBox(this.table, W2 - 0.02, 0.025, 0.56, 0, 0.025, 0); // origin = underside
    this.table.position.set(0, TABLE_UP, TABLE_Z);
    world.addBody(this.sweep);
    world.addBody(this.table);

    this.resetRack();
  }

  // ------------------------------------------------------------------ collisions
  _onPinCollide(pin, e) {
    const other = e.body;
    const c = e.contact;
    const isBall = other === this.ball;
    const isPin = other.collisionFilterGroup === GROUP_PIN;
    const bi = c.bi;
    const bj = c.bj;
    // Relative velocity at the contact before the solver runs (j relative to i, along ni).
    const vrel = this._contactVel(bi, bj, c.ri, c.rj);
    const vn = vrel.x * c.ni.x + vrel.y * c.ni.y + vrel.z * c.ni.z;
    const v = Math.abs(vn);
    pin.hit = pin.hit || isBall || isPin;
    const name = other.material && other.material.name;
    if (name === 'machine') return;
    // pin/pin contacts are reported to both pins: handle once
    if (isPin && pin.body.id > other.id) return;
    const mu = isBall ? this.mu.ballPin : isPin ? this.mu.pinPin : this.mu[name === 'lane' ? 'deck' : name] ?? 0.25;
    this._impacts.push({ bi, bj, ni: c.ni.clone(), ri: c.ri.clone(), rj: c.rj.clone(), vn, mu });
    if (v < 0.4) return;
    if (isBall) this.events.push({ type: 'ballpin', v, pin: pin.index + 1 });
    else if (isPin) this.events.push({ type: 'pinpin', v, pin: pin.index + 1 });
    else if (name === 'kickback') this.events.push({ type: 'pinwall', v });
    else if (name === 'gutter') this.events.push({ type: 'pingutter', v });
    else if (v > 0.8) this.events.push({ type: 'pinfloor', v });
  }

  _contactVel(bi, bj, ri, rj) {
    const wi = bi.angularVelocity;
    const wj = bj.angularVelocity;
    return {
      x: bj.velocity.x + (wj.y * rj.z - wj.z * rj.y) - bi.velocity.x - (wi.y * ri.z - wi.z * ri.y),
      y: bj.velocity.y + (wj.z * rj.x - wj.x * rj.z) - bi.velocity.y - (wi.z * ri.x - wi.x * ri.z),
      z: bj.velocity.z + (wj.x * rj.y - wj.y * rj.x) - bi.velocity.z - (wi.x * ri.y - wi.y * ri.x),
    };
  }

  /** 1 / effective mass of the pair along direction d at the contact points. */
  _invMassAlong(bi, bj, ri, rj, d) {
    let k = 0;
    for (const [b, r] of [[bi, ri], [bj, rj]]) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      k += b.invMass;
      const rc = new CANNON.Vec3(r.y * d.z - r.z * d.y, r.z * d.x - r.x * d.z, r.x * d.y - r.y * d.x);
      const iw = new CANNON.Vec3();
      b.invInertiaWorld.vmult(rc, iw);
      k += rc.x * iw.x + rc.y * iw.y + rc.z * iw.z;
    }
    return k;
  }

  /**
   * Coulomb friction for the impacts of the last step: the tangential impulse is at most mu times
   * the normal impulse the solver applied, and never more than it takes to stop the sliding.
   */
  _impactFriction() {
    for (const im of this._impacts) {
      const { bi, bj, ni, ri, rj } = im;
      const kn = this._invMassAlong(bi, bj, ri, rj, ni);
      if (kn <= 0) continue;
      const v = this._contactVel(bi, bj, ri, rj);
      const vn = v.x * ni.x + v.y * ni.y + v.z * ni.z;
      const jn = Math.max(0, vn - im.vn) / kn;
      if (jn <= 0) continue;
      const t = new CANNON.Vec3(v.x - vn * ni.x, v.y - vn * ni.y, v.z - vn * ni.z);
      const vt = t.length();
      if (vt < 1e-3) continue;
      t.scale(1 / vt, t);
      const jt = Math.min(im.mu * jn, vt / this._invMassAlong(bi, bj, ri, rj, t));
      if (bj.type === CANNON.Body.DYNAMIC) bj.applyImpulse(new CANNON.Vec3(-t.x * jt, -t.y * jt, -t.z * jt), rj);
      if (bi.type === CANNON.Body.DYNAMIC) bi.applyImpulse(new CANNON.Vec3(t.x * jt, t.y * jt, t.z * jt), ri);
    }
    this._impacts.length = 0;
  }

  // ------------------------------------------------------------------ rack
  _setPinDynamic(pin) {
    const b = pin.body;
    b.type = CANNON.Body.DYNAMIC;
    b.collisionFilterMask = GROUP_STATIC | GROUP_PIN | GROUP_BALL | GROUP_MACHINE;
    pin.held = false;
  }

  _setPinHeld(pin) {
    const b = pin.body;
    if (pin.removed) {
      this.world.addBody(b);
      pin.removed = false;
    }
    b.type = CANNON.Body.KINEMATIC;
    b.collisionFilterMask = GROUP_PIN; // held pins can still nudge deadwood, nothing else
    b.wakeUp();
    pin.held = true;
  }

  /** Put a pin upright at (x, z), at rest. */
  _place(pin, x, z, yaw = this.rand() * Math.PI * 2) {
    const b = pin.body;
    if (pin.removed) {
      this.world.addBody(b);
      pin.removed = false;
    }
    this._setPinDynamic(pin);
    b.position.set(x, DIM.pinComHeight, z);
    b.quaternion.setFromAxisAngle(UP, yaw);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.force.setZero();
    b.torque.setZero();
    b.sleep();
    pin.spot = { x, z };
    pin.hit = false;
  }

  /** A fresh spot near a pin's home: the pinsetter sets pins within a couple of millimetres. */
  _jittered(pin) {
    const j = this.cfg.spotJitter ?? 0;
    return [pin.home.x + (this.rand() - 0.5) * 2 * j, pin.home.z + (this.rand() - 0.5) * 2 * j];
  }

  _removePin(pin) {
    if (pin.removed) return;
    this._setPinDynamic(pin);
    this.world.removeBody(pin.body);
    pin.removed = true;
  }

  _parkMachine() {
    this.sweep.position.set(0, SWEEP_UP, SWEEP_FRONT);
    this.sweep.velocity.setZero();
    this.table.position.set(0, TABLE_UP, TABLE_Z);
    this.table.velocity.setZero();
  }

  /** Full rack of ten pins, instantly. */
  resetRack() {
    this._removeBall();
    this.cycle = null;
    this._parkMachine();
    for (const pin of this.pins) this._place(pin, ...this._jittered(pin));
    this.state = 'idle';
  }

  /**
   * Instantly: sweep away fallen pins; standing pins are set back down upright where they stand
   * (a pinsetter must return each pin to where the previous ball moved it).
   */
  clearDowned() {
    this._removeBall();
    this.cycle = null;
    this._parkMachine();
    for (const pin of this.pins) {
      if (this.isStanding(pin)) this._place(pin, pin.body.position.x, pin.body.position.z, this._yaw(pin));
      else this._removePin(pin);
    }
    this.state = 'idle';
  }

  _yaw(pin) {
    const q = pin.body.quaternion;
    return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
  }

  /**
   * Run the pinsetter: full = sweep everything and set a new rack, otherwise pick up the standing
   * pins, sweep the deadwood and set the standing pins back down where they were.
   */
  startCycle(full) {
    this._removeBall();
    const held = full ? [] : this.pins.filter((p) => this.isStanding(p));
    for (const pin of this.pins) if (!pin.removed) pin.body.wakeUp();
    // Pins about to be gripped must not be pushed by the table coming down onto them.
    for (const pin of held) pin.body.collisionFilterMask = GROUP_STATIC | GROUP_PIN | GROUP_BALL;
    this.cycle = {
      t: 0,
      full,
      held: new Set(held),
      grab: new Map(held.map((p) => [p, { x: p.body.position.x, z: p.body.position.z, yaw: this._yaw(p), q: p.body.quaternion.clone() }])),
      gripped: false,
      setStarted: false,
      released: false,
    };
    this.state = 'cycle';
    this.events.length = 0;
  }

  /** Move a kinematic body toward a target so it arrives this step (velocity drives the contacts). */
  _drive(body, x, y, z) {
    body.velocity.set((x - body.position.x) / STEP, (y - body.position.y) / STEP, (z - body.position.z) / STEP);
  }

  _cycleTick() {
    const c = this.cycle;
    const C = CYCLE;
    c.t += STEP;
    const t = c.t + STEP; // where the machine must be at the end of this step
    // Sweep bar: down, rake back, return, up.
    const sweepY = t < C.sweepDown ? lerp(SWEEP_UP, 0.004, smooth(t / C.sweepDown)) : t < C.tableUp ? 0.004 : lerp(0.004, SWEEP_UP, smooth((t - C.tableUp) / (C.end - C.tableUp)));
    let sweepZ = SWEEP_FRONT;
    if (t >= C.lifted && t < C.rakeEnd) sweepZ = lerp(SWEEP_FRONT, SWEEP_BACK, smooth((t - C.lifted) / (C.rakeEnd - C.lifted)));
    else if (t >= C.rakeEnd && t < C.returnEnd) sweepZ = lerp(SWEEP_BACK, SWEEP_FRONT, smooth((t - C.rakeEnd) / (C.returnEnd - C.rakeEnd)));
    this._drive(this.sweep, 0, sweepY, sweepZ);
    // Table: down to grip the standing pins and lift them clear (if there are any); otherwise it
    // waits up top and comes down to carrying height with the new rack once the sweep is back.
    // Then it lowers the pins onto the deck, lets go and goes back up.
    const hasHeld = c.held.size > 0 && !c.full;
    const carry = TABLE_GRIP + LIFT;
    let tableY;
    if (t < C.sweepDown) tableY = TABLE_UP;
    else if (hasHeld && t < C.grab) tableY = lerp(TABLE_UP, TABLE_GRIP, smooth((t - C.sweepDown) / (C.grab - C.sweepDown)));
    else if (hasHeld && t < C.lifted) tableY = lerp(TABLE_GRIP, carry, smooth((t - C.grab) / (C.lifted - C.grab)));
    else if (hasHeld && t < C.returnEnd) tableY = carry;
    else if (t < C.rakeEnd) tableY = TABLE_UP;
    else if (t < C.returnEnd) tableY = lerp(TABLE_UP, carry, smooth((t - C.rakeEnd) / (C.returnEnd - C.rakeEnd)));
    else if (t < C.set) tableY = lerp(carry, TABLE_GRIP, smooth((t - C.returnEnd) / (C.set - C.returnEnd)));
    else tableY = lerp(TABLE_GRIP, TABLE_UP, smooth((t - C.set) / (C.tableUp - C.set)));
    this._drive(this.table, 0, tableY, TABLE_Z);
    const lift = tableY - TABLE_GRIP; // height of gripped pins above the deck

    // Grip the standing pins.
    if (!c.gripped && c.t >= C.grab) {
      c.gripped = true;
      for (const pin of c.held) this._setPinHeld(pin);
    }
    // Once the sweep is back, everything that was not picked up is gone (in the pit); for a full
    // rack the table now brings ten new pins down.
    if (!c.setStarted && c.t >= C.returnEnd) {
      c.setStarted = true;
      for (const pin of this.pins) {
        if (c.held.has(pin)) continue;
        if (c.full) {
          const [x, z] = this._jittered(pin);
          this._setPinHeld(pin);
          c.held.add(pin);
          c.grab.set(pin, { x, z, yaw: this.rand() * Math.PI * 2, q: null });
          pin.body.position.set(x, DIM.pinComHeight + lift, z);
        } else this._removePin(pin);
      }
    }
    // Gripped pins ride with the table, straightening as they go up.
    if (c.gripped && !c.released) {
      for (const pin of c.held) {
        const g = c.grab.get(pin);
        const b = pin.body;
        const up = new CANNON.Quaternion().setFromAxisAngle(UP, g.yaw);
        if (g.q) {
          const k = smooth((c.t - C.grab) / (C.lifted - C.grab));
          g.q.slerp(up, k, b.quaternion);
        } else b.quaternion.copy(up);
        this._drive(b, g.x, DIM.pinComHeight + Math.max(0, lift), g.z);
        b.angularVelocity.setZero();
      }
    }
    if (!c.released && c.t >= C.set) {
      c.released = true;
      for (const pin of c.held) {
        const g = c.grab.get(pin);
        this._place(pin, g.x, g.z, g.yaw);
      }
    }
    if (c.t >= C.end) {
      this._parkMachine();
      this.cycle = null;
      this.state = 'idle';
    }
  }

  /** Fresh oil (a new game). */
  resetOil() {
    this.oil.reset();
  }

  /** Standing means upright and still on the pin deck; a pin moved off its spot still counts. */
  isStanding(pin) {
    if (pin.removed) return false;
    const b = pin.body;
    b.quaternion.vmult(UP, tmp);
    return (
      tmp.y > 0.9 && // within ~25 degrees of upright
      Math.abs(b.position.y - DIM.pinComHeight) < 0.03 &&
      Math.abs(b.position.x) < DIM.laneWidth / 2 + 0.02 &&
      b.position.z > PIT_Z
    );
  }

  countStanding() {
    let n = 0;
    for (const pin of this.pins) if (this.isStanding(pin)) n++;
    return n;
  }

  /** Pin numbers (1-10) still standing. */
  standingPins() {
    return this.pins.filter((p) => this.isStanding(p)).map((p) => p.index + 1);
  }

  // ------------------------------------------------------------------ ball
  /**
   * @param {object} o
   * @param {number} o.x       release position across the lane (m, 0 = centre)
   * @param {number} o.speed   m/s
   * @param {number} o.spin    -1..1, positive hooks toward +x (more = more revs and more axis rotation)
   * @param {number} [o.angle] radians, positive aims toward +x
   * @param {number} [o.revs]  rad/s, overrides the rev rate implied by spin
   * @param {number} [o.loft]  m the ball is above the lane when it leaves the hand (default cfg.loft)
   */
  launch({ x, speed, spin = 0, angle = 0, revs, loft }) {
    const b = this.ball;
    const c = this.cfg;
    this._removeBall();
    const h = loft ?? c.loft ?? 0;
    b.position.set(x, R + h, 0);
    b.quaternion.set(0, 0, 0, 1);
    const dx = Math.sin(angle);
    const dz = -Math.cos(angle);
    b.velocity.set(dx * speed, h > 0 ? -0.25 : 0, dz * speed);
    // Spin: rev rate, with the axis rotated from end-over-end toward the direction of travel and
    // tilted up from horizontal. Only the horizontal part of the spin acts on the lane.
    const s = Math.max(-1, Math.min(1, spin));
    const a = Math.abs(s);
    const rate = revs ?? c.revMin + (c.revMax - c.revMin) * a;
    const th = a * c.axisMaxDeg * D2R;
    const tilt = (c.tiltMinDeg + (c.tiltMaxDeg - c.tiltMinDeg) * a) * D2R;
    const side = Math.sign(s);
    const hz = rate * Math.cos(tilt);
    const fx = dz; // forward-roll axis = up x direction of travel
    const fz = -dx;
    b.angularVelocity.set(
      hz * (Math.cos(th) * fx + Math.sin(th) * side * dx),
      -side * rate * Math.sin(tilt),
      hz * (Math.cos(th) * fz + Math.sin(th) * side * dz),
    );
    b.collisionFilterMask = GROUP_STATIC | GROUP_PIN;
    this.world.addBody(b);
    this.ballInPlay = true;
    this.inGutter = false;
    this.airborne = h > 0;
    this.reachedPins = false;
    this.spin = s;
    this.phase = 'skid';
    this.track = [[x, 0]];
    this.hookPoint = null;
    this.exit = null;
    this.release = { x, speed, spin: s, angle, revs: rate, axisDeg: th / D2R, tiltDeg: tilt / D2R };
    this.state = 'rolling';
    this._rollTime = 0;
    this._settleTime = 0;
    this._pitTime = 0;
    this.events.length = 0;
    for (const pin of this.pins) pin.hit = false;
  }

  _removeBall() {
    if (this.ballInPlay) this.world.removeBody(this.ball);
    this.ballInPlay = false;
    this.inGutter = false;
    this.oil.endBall();
  }

  /** Advance by dt seconds of real time (fixed 240 Hz internal steps). */
  step(dt) {
    this._acc = Math.min(this._acc + dt, STEP * 16);
    while (this._acc >= STEP) {
      this._acc -= STEP;
      this._tick();
    }
  }

  /** Friction at the ball's contact patch: skid -> hook -> roll. */
  _laneFriction() {
    const b = this.ball;
    const c = this.cfg;
    const p = b.position;
    const onLane = Math.abs(p.x) <= DIM.laneWidth / 2 && p.z > PIT_Z;
    const deckGutter = p.z < -(DIM.laneLength - DIM.kickbackFrom);
    const floorY = onLane ? R : R - (deckGutter ? DIM.flatGutterDepth : DIM.gutterDepth);
    if (p.z < PIT_Z || p.y > floorY + 0.004) {
      this.airborne = true;
      return;
    }
    if (this.airborne) {
      this.airborne = false;
      this.events.push({ type: 'land', v: Math.abs(b.velocity.y) + 0.5 });
    }
    const d = -p.z;
    const mu = onLane ? this.oil.mu(p.x, d) : c.muGutter;
    const v = b.velocity;
    const w = b.angularVelocity;
    const sx = v.x + w.z * R; // velocity of the point touching the lane
    const sz = v.z - w.x * R;
    const slip = Math.hypot(sx, sz);
    if (slip > 1e-4) {
      // Friction can at most bring the slip to zero this step: slip changes (1 + 1/k) times as
      // fast as the ball's velocity does.
      const aMag = Math.min(mu * G, slip / ((1 + 1 / K_BALL) * STEP));
      const ax = (-sx / slip) * aMag;
      const az = (-sz / slip) * aMag;
      v.x += ax * STEP;
      v.z += az * STEP;
      w.x += (-az / (K_BALL * R)) * STEP;
      w.z += (ax / (K_BALL * R)) * STEP;
      const dry = c.muDry - (c.muDry - c.muOil) * 0.45;
      this.phase = slip < 0.06 ? 'roll' : mu > dry ? 'hook' : 'skid';
    } else this.phase = 'roll';
    const sp = Math.hypot(v.x, v.z);
    if (sp > 1e-3) {
      const dec = Math.min(sp, c.rollingResistance * G * STEP);
      v.x -= (v.x / sp) * dec;
      v.z -= (v.z / sp) * dec;
    }
    if (onLane) this.oil.wipe(p.x, d, sp * STEP);
  }

  _tick() {
    if (this.state === 'rolling') {
      const b = this.ball;
      const p = b.position;
      this._rollTime += STEP;
      if (!this.reachedPins && p.z < -(DIM.laneLength - 0.35)) this.reachedPins = true;
      if (!this.inGutter && !this.reachedPins && Math.abs(p.x) > DIM.laneWidth / 2 + 0.01) {
        // Off the lane before the pins: a gutter ball. It can no longer touch the pins.
        this.inGutter = true;
        b.collisionFilterMask = GROUP_STATIC;
        this.events.push({ type: 'gutter', v: b.velocity.length() });
      }
      this._laneFriction();
      if (this.spin !== 0 && !this.inGutter && p.z > -DIM.laneLength) {
        const out = -Math.sign(this.spin) * p.x;
        if (!this.hookPoint || out > -Math.sign(this.spin) * this.hookPoint[0]) this.hookPoint = [p.x, p.z];
      }
      if (this._rollTime % 0.04 < STEP && p.z > PIT_Z - 0.3) this.track.push([p.x, p.z]);
      if (p.z < PIT_Z) {
        if (!this._pitTime) {
          this.events.push({ type: 'pit', v: b.velocity.length() });
          this.exit = { x: p.x, deg: Math.atan2(b.velocity.x, -b.velocity.z) / D2R };
        }
        this._pitTime += STEP;
      }
      const stalled = this._rollTime > 1 && b.velocity.length() < 0.25;
      if (this._pitTime > 0.6 || p.y < -DIM.pitDepth + 0.05 || stalled || this._rollTime > 15) {
        this._removeBall();
        this.state = 'settling';
      }
    } else if (this.state === 'settling') {
      this._settleTime += STEP;
      if (this._settleTime > 0.8 && (this._pinsQuiet() || this._settleTime > 5)) this.state = 'done';
    } else if (this.state === 'cycle') {
      this._cycleTick();
    }
    this.world.step(STEP);
    if (this._impacts.length) this._impactFriction();
    {
      // Kinematic bodies are driven afresh every step.
      this.sweep.velocity.setZero();
      this.table.velocity.setZero();
      for (const pin of this.pins) if (pin.held) pin.body.velocity.setZero();
    }
  }

  _pinsQuiet() {
    for (const pin of this.pins) {
      if (pin.removed) continue;
      const b = pin.body;
      if (b.sleepState === CANNON.Body.SLEEPING) continue;
      if (b.position.y < -0.2) continue; // in the pit: no longer matters
      if (b.velocity.lengthSquared() > 0.01 || b.angularVelocity.lengthSquared() > 0.09) return false;
    }
    return true;
  }
}
