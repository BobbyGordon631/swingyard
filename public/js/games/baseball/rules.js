// Baseball rules and batted-ball simulation. Pure JS, no DOM (unit tested in Node).
//
// Field coordinates (metres): home plate at the origin, the batter faces -z (toward the pitcher),
// first base is on the +x side. Spray angle 0 = straight to centre field, + = toward right field.
//
// A batted ball is simulated (gravity + air drag), and every fielder actually races it: the play is
// decided by who can get there first and whether a throw beats the runner, not by a dice roll.

export const BASE_PATH = 27.43; // 90 ft
export const BASES = [
  [19.4, -19.4], // first
  [0, -38.8], // second
  [-19.4, -19.4], // third
  [0, 0], // home
];
export const MOUND = 18.4;
export const FENCE = 100; // m to the outfield wall
export const FENCE_HEIGHT = 3;
export const FOUL_DEG = 45;
// Defensive positions: pitcher, catcher, 1B, 2B, SS, 3B, LF, CF, RF
export const POSITIONS = [
  ['P', 0, -17.6],
  ['C', 0, 1.3],
  ['1B', 17, -24],
  ['2B', 8.5, -35],
  ['SS', -8.5, -35],
  ['3B', -17, -24],
  ['LF', -29, -64],
  ['CF', 0, -76],
  ['RF', 29, -64],
];

const G = 9.81;
const DRAG = 0.0052; // 1/m: drag acceleration = DRAG * v^2 (a real baseball is ~0.005-0.006)
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Everyone (batter included) advances `n` bases. bases = [first, second, third] occupied flags. */
export function advance(bases, n) {
  const next = [false, false, false];
  let runs = 0;
  const move = (from) => {
    const to = from + n; // from: -1 = batter, 0 = first ...
    if (to >= 3) runs++;
    else next[to] = true;
  };
  for (let i = 2; i >= 0; i--) if (bases[i]) move(i);
  move(-1);
  return { bases: next, runs };
}

/** A walk only moves runners who are forced. */
export function walk(bases) {
  const next = [...bases];
  let runs = 0;
  if (!next[0]) next[0] = true;
  else if (!next[1]) next[1] = true;
  else if (!next[2]) next[2] = true;
  else runs = 1;
  return { bases: next, runs };
}

/**
 * Turn bat-on-ball contact into a batted ball.
 * @param {object} o
 * @param {number} o.err     timing error, -1 (very early) .. 1 (very late), 0 = perfect
 * @param {number} o.power   swing power 0..1
 * @param {number} [o.lift]  -1 (chopping down) .. 1 (uppercut): pushes the launch angle
 * @param {boolean} [o.inZone]  pitches outside the zone are harder to square up
 * @param {() => number} [o.rnd]
 * @returns {{speed:number, launch:number, spray:number, quality:number}} m/s, degrees, degrees
 */
export function battedBall({ err, power, lift = 0, inZone = true, rnd = Math.random }) {
  const q = 1 - Math.min(1, Math.abs(err)) ** 1.25;
  const spray = err * 52; // early = pulled to left field
  const scatter = (rnd() - 0.5) * 2 * (10 + 28 * (1 - q));
  const launch = Math.max(-25, Math.min(75, 14 + 16 * lift + scatter));
  const speed = (19 + 30 * power) * (0.45 + 0.55 * q) * (inZone ? 1 : 0.85);
  return { speed, launch, spray, quality: q };
}

/** Air flight from the plate. Returns samples { t, x, y, z } until the ball lands (y <= 0). */
export function flyPath({ speed, launch, spray }, dt = 0.02) {
  const la = (launch * Math.PI) / 180;
  const sp = (spray * Math.PI) / 180;
  const h = Math.cos(la) * speed;
  let vx = Math.sin(sp) * h;
  let vz = -Math.cos(sp) * h;
  let vy = Math.sin(la) * speed;
  let x = 0;
  let y = 0.9;
  let z = -0.4;
  let t = 0;
  const pts = [{ t, x, y, z }];
  while (t < 12) {
    const v = Math.hypot(vx, vy, vz);
    const k = DRAG * v;
    vx -= k * vx * dt;
    vy -= (G + k * vy) * dt;
    vz -= k * vz * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    t += dt;
    if (y <= 0) {
      pts.push({ t, x, y: 0, z, vx, vz, vy });
      break;
    }
    pts.push({ t, x, y, z });
  }
  return pts;
}

/** Bounce and roll after landing at `p` (with velocity). Stops at the wall. */
export function groundPath(p, dt = 0.02) {
  let speed = Math.hypot(p.vx, p.vz) * (p.vy < -8 ? 0.6 : 0.8);
  const ux = p.vx / (Math.hypot(p.vx, p.vz) || 1);
  const uz = p.vz / (Math.hypot(p.vx, p.vz) || 1);
  let { x, z, t } = p;
  const pts = [];
  while (speed > 0.3 && t < 20) {
    const infield = dist(x, z, 0, -MOUND) < 30;
    speed -= (infield ? 5 : 2.6) * dt;
    x += ux * speed * dt;
    z += uz * speed * dt;
    t += dt;
    if (Math.hypot(x, z) >= FENCE - 0.5) {
      const k = (FENCE - 0.5) / Math.hypot(x, z);
      x *= k;
      z *= k;
      pts.push({ t, x, y: 0, z });
      break;
    }
    pts.push({ t, x, y: 0, z });
  }
  if (!pts.length) pts.push({ t, x, y: 0, z });
  return pts;
}

/**
 * Play out a batted ball against the defence.
 * @param {object} o
 * @param {{speed,launch,spray}} o.hit
 * @param {number[][]} [o.fielders]  [x, z] for each position (defaults to POSITIONS)
 * @param {number} o.react           fielders' reaction time, s
 * @param {number} o.fielderSpeed    m/s
 * @param {number} o.runnerSpeed     m/s
 * @param {number} o.throwSpeed      m/s
 * @param {boolean[]} [o.bases]      occupied [first, second, third]
 * @param {number} [o.outs]
 * @returns {object} { kind: 'foul'|'homer'|'out'|'single'|'double'|'triple', text, bases (for hits), outsMade,
 *   air, ground, fielder (index), fieldT, fieldAt {x,z,y}, throwTo (base index or null), throwT, caught, endT, sacFly }
 */
export function fieldPlay({ hit, fielders = POSITIONS.map((p) => [p[1], p[2]]), react, fielderSpeed, runnerSpeed, throwSpeed, bases = [false, false, false], outs = 0 }) {
  const air = flyPath(hit);
  const land = air[air.length - 1];
  const out = (o) => ({ air, ground: [], fielder: -1, fieldT: land.t, fieldAt: land, throwTo: null, throwT: null, caught: false, outsMade: 0, bases: 0, sacFly: false, ...o, endT: o.endT ?? land.t });
  if (Math.abs(hit.spray) > FOUL_DEG) return out({ kind: 'foul', text: 'Foul ball' });

  // Over the wall?
  let wallAt = -1;
  for (let i = 1; i < air.length; i++) {
    if (Math.hypot(air[i].x, air[i].z) >= FENCE) {
      wallAt = i;
      break;
    }
  }
  if (wallAt > 0 && air[wallAt].y >= FENCE_HEIGHT) return out({ kind: 'homer', text: 'HOME RUN!', bases: 4, air: air.slice(0, wallAt + 8), endT: air[wallAt].t + 1 });
  const flight = wallAt > 0 ? air.slice(0, wallAt + 1) : air;

  const reach = (i, x, z) => react + dist(fielders[i][0], fielders[i][1], x, z) / fielderSpeed;
  const apex = Math.max(...flight.map((p) => p.y));

  // Caught in the air?
  if (apex > 1.2) {
    let best = null;
    for (let i = 0; i < fielders.length; i++) {
      for (const p of flight) {
        if (p.t < 0.2 || p.y > 2.5 || Math.hypot(p.x, p.z) > FENCE - 0.5) continue;
        if (reach(i, p.x, p.z) + 0.15 <= p.t) {
          if (!best || p.t < best.t) best = { i, t: p.t, p };
          break;
        }
      }
    }
    if (best) {
      const deep = Math.hypot(best.p.x, best.p.z);
      const sacFly = bases[2] && outs < 2 && deep > 60;
      const text = hit.launch > 22 ? (deep > 60 ? 'Fly out' : 'Pop out') : 'Line out';
      return out({ kind: 'out', text: sacFly ? `${text} — sacrifice fly` : text, outsMade: 1, fielder: best.i, fieldT: best.t, fieldAt: best.p, caught: true, air: flight.filter((p) => p.t <= best.t), endT: best.t + 1, sacFly });
    }
  }

  // On the ground: bounce, roll, and the first fielder to the ball picks it up.
  const last = flight[flight.length - 1];
  const rollFrom = wallAt > 0 ? { ...last, vx: -last.x * 0.05, vz: -last.z * 0.05, vy: -1 } : last;
  const ground = groundPath(rollFrom);
  let field = null;
  for (let i = 0; i < fielders.length; i++) {
    for (const p of ground) {
      if (reach(i, p.x, p.z) <= p.t) {
        if (!field || p.t < field.t) field = { i, t: p.t, p };
        break;
      }
    }
  }
  if (!field) {
    const end = ground[ground.length - 1];
    let bi = 0;
    for (let i = 1; i < fielders.length; i++) if (reach(i, end.x, end.z) < reach(bi, end.x, end.z)) bi = i;
    field = { i: bi, t: Math.max(end.t, reach(bi, end.x, end.z)), p: end };
  }
  const groundTrim = ground.filter((p) => p.t <= field.t);
  const deepField = Math.hypot(field.p.x, field.p.z) > 45;
  const transfer = deepField ? 1.0 : 0.45; // outfielders have to pick it up, set and crow-hop
  const throwTime = (d) => (d / throwSpeed) * (d > 40 ? 1.3 : 1); // long throws arc (or go through a cut-off man)
  const ballAt = (b) => field.t + transfer + throwTime(dist(field.p.x, field.p.z, BASES[b][0], BASES[b][1]));
  const runnerAt = (k) => 0.7 + (k * BASE_PATH) / runnerSpeed + Math.max(0, k - 1) * 0.15;
  const res = { ground: groundTrim, fielder: field.i, fieldT: field.t, fieldAt: field.p };

  if (!deepField && ballAt(0) < runnerAt(1)) {
    // Double play: runner forced from first, and the ball beats both runners.
    const toSecond = ballAt(1);
    const relay = toSecond + 0.45 + dist(BASES[1][0], BASES[1][1], BASES[0][0], BASES[0][1]) / throwSpeed;
    if (bases[0] && outs < 2 && toSecond < BASE_PATH / runnerSpeed + 0.4 && relay < runnerAt(1)) {
      return out({ ...res, kind: 'out', text: 'Double play!', outsMade: 2, throwTo: 1, throwT: toSecond, endT: relay + 0.5 });
    }
    return out({ ...res, kind: 'out', text: field.i <= 1 ? 'Out at first' : 'Ground out', outsMade: 1, throwTo: 0, throwT: ballAt(0), endT: ballAt(0) + 0.6 });
  }
  let k = 1;
  while (k < 3 && runnerAt(k + 1) < ballAt(k) + 0.15) k++; // the fielder still has to make the tag
  const kind = ['single', 'double', 'triple'][k - 1];
  const deep = Math.hypot(field.p.x, field.p.z) > 42;
  const text = k === 1 ? (deep ? 'Single!' : 'Infield single!') : k === 2 ? 'Double!' : 'Triple!';
  return out({ ...res, kind, text, bases: k, throwTo: k - 1, throwT: ballAt(k - 1), endT: Math.max(ballAt(k - 1), runnerAt(k)) + 0.5 });
}

export const basesFor = (kind) => ({ single: 1, double: 2, triple: 3, homer: 4 })[kind] || 0;
