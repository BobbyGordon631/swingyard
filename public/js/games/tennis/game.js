// Tennis. The camera sits high behind your baseline (CONFIG.tennis.view = 'behind', the classic
// living-room tennis view) or in your eyes ('first'). Your racket follows the phone 1:1 (the phone is the
// handle, the screen is the strings), your player runs to the ball by itself, and the ball is real
// physics: drag, spin, a spin-dependent bounce. Where the ball goes comes from the racket face and the
// racket's speed when it meets the ball. CONFIG.tennis.assist pulls near misses back toward the court.
//
// Serving: flick the phone up to toss the ball, then swing up and through as it drops into reach.
// Without an orientation sensor (or on the keyboard) hitting falls back to timing: swing as the
// ball arrives (early = cross-court, late = down the line).
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { createCharacter, addProp, react } from '../../characters.js';
import { BaseGame, outdoorScene, blobShadow, patch, flatMat, addTree, addGrandstand, addBanner, renderViews, makeTrail, crowdFill, lerp, clamp, rand, ease, DIFFICULTY } from '../common.js';
import { TennisMatch } from './scoring.js';
import { COURT, BALL_R, stepAir, bounce, predictLanding, predictPath, solveShot, serviceBox, inBox, spinFor } from './physics.js';

const { LEN, WID, NET } = COURT;
const SUBSTEPS = 6;
// A phone swing that only just missed the ball (racket within this many hit radii) still connects, off the frame.
const FALLBACK = 1.35;
// Reach assist: as the ball arrives, the 1:1 racket (and the body with it) slides up to this far toward it, so
// the strings really meet the ball. Wii-style forgiveness without the ball teleporting to the racket.
const ASSIST_MAX = 0.55;
const ASSIST_GAIN = 0.85;
const ASSIST_WINDOW = 0.4; // s either side of the planned contact
// Players are drawn a little larger than life so they read from the camera behind the baseline, and the
// racket's shoulder is the character's own shoulder, so the 1:1 racket sits in the Yardling's hand.
const SC = 1.3;
const SH_X = 0.31 * SC;
const SH_Y = 0.95 * SC;
const ARM_LEN = 0.44 * SC; // shoulder to hand on the scaled character
// Scratch objects, so the per-frame code allocates nothing.
const DOWN = new THREE.Vector3(0, -1, 0);
const _arm = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _sw = new THREE.Vector3();
const _rd = new THREE.Vector3();
const _c = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class TennisGame extends BaseGame {
  constructor(o) {
    super(o, 'Tennis');
    this.cfg = CONFIG.tennis;
    this.match = new TennisMatch({ gamesPerSet: this.cfg.gamesPerSet, setsToWin: this.cfg.setsToWin });
    this.ai = this.cfg.ai[this.difficulty];
    this.ball = { p: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 }, live: false, hitter: -1, bounces: 0, serve: false };
    this.faults = 0;
    this._build();
    this._startPoint();
  }

  // ------------------------------------------------------------ scene
  _build() {
    const { scene, camera } = outdoorScene({ ground: 0x6fc46d, fov: 72, shadow: 17 });
    this.scene = scene;
    camera.near = 0.03;
    camera.updateProjectionMatrix();
    this.camera = camera;
    patch(scene, new THREE.PlaneGeometry(WID + 11, LEN + 14), 0x4f9e5a, 0.005);
    patch(scene, new THREE.PlaneGeometry(WID + 2.74, LEN), 0x3a86c8, 0.008);
    patch(scene, new THREE.PlaneGeometry(WID, LEN), 0x3f8fd6, 0.01);
    const line = (w, l, x, z) => patch(scene, new THREE.PlaneGeometry(w, l), 0xffffff, 0.015, x, z);
    line(WID + 0.1, 0.1, 0, LEN / 2);
    line(WID + 0.1, 0.1, 0, -LEN / 2);
    line(0.1, LEN, WID / 2, 0);
    line(0.1, LEN, -WID / 2, 0);
    line(WID, 0.08, 0, COURT.SERVICE);
    line(WID, 0.08, 0, -COURT.SERVICE);
    line(0.08, COURT.SERVICE * 2, 0, 0);
    line(0.08, 0.3, 0, LEN / 2 - 0.15);
    line(0.08, 0.3, 0, -LEN / 2 + 0.15);
    const netMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(WID + 1.8, NET), netMat);
    net.position.y = NET / 2;
    const tape = new THREE.Mesh(new THREE.BoxGeometry(WID + 1.8, 0.06, 0.05), flatMat(0xffffff));
    tape.position.y = NET;
    scene.add(net, tape);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, NET + 0.1, 8), flatMat(0x1d2b4f));
      post.position.set(sx * (WID / 2 + 0.9), NET / 2, 0);
      scene.add(post);
      for (let i = 0; i < 6; i++) addTree(scene, sx * (21 + (i % 2) * 3), -22 + i * 8, 1.7 + (i % 3) * 0.3);
    }
    for (let i = 0; i < 7; i++) {
      addTree(scene, -15 + i * 5, -29 - (i % 2) * 3, 1.8);
      addTree(scene, -15 + i * 5, 29 + (i % 2) * 3, 1.8);
    }
    const fill = crowdFill(this.skill); // more fans as your Skill Level grows
    this.crowd = [
      addGrandstand(scene, { x: -10.5, z: 0, rotY: Math.PI / 2, width: 26, rows: 6, fill }),
      addGrandstand(scene, { x: 10.5, z: 0, rotY: -Math.PI / 2, width: 26, rows: 6, fill }),
      addGrandstand(scene, { x: 0, z: -19.5, rotY: 0, width: 18, rows: 5, fill }),
      addGrandstand(scene, { x: 0, z: 19.5, rotY: Math.PI, width: 18, rows: 5, fill }),
    ];
    this.hype = 0.3;
    for (const z of [-17.4, 17.4]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(14, 1.0, 0.3), flatMat(0x1f5fae));
      board.position.set(0, 0.5, z);
      scene.add(board);
      addBanner(scene, 'SWINGYARD  OPEN', { x: 0, y: 0.5, z: z + (z < 0 ? 0.16 : -0.16), rotY: z < 0 ? 0 : Math.PI, width: 9, height: 0.8, bg: '#1f5fae' });
    }

    this.behind = this.cfg.view !== 'first';
    this.sides = [0, 1].map((i) => {
      const sign = i === 0 ? 1 : -1;
      const char = createCharacter(this.color(i));
      char.group.scale.setScalar(SC);
      const prop = addProp(char, 'racket', 0xffffff);
      char.group.rotation.y = i === 0 ? 0 : Math.PI;
      scene.add(char.group);
      const s = { i, sign, x: 0, z: sign * (LEN / 2 + 0.6), char, prop, swingT: 9, plan: null, pending: null, cooldown: 0, head: null, prevHead: null, closest: 9, assist: new THREE.Vector3(), stroke: null };
      if (this.isHuman(i)) s.fp = this._firstPersonRacket(i);
      return s;
    });
    // From behind the baseline the ball is far away: draw it bigger (and glowing a touch) so it always
    // reads, with a dark shadow underneath that tells you where it is over the court.
    const ballScale = this.behind ? 2.4 : 1.5;
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * ballScale, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe8ff3a, roughness: 0.6, emissive: 0x4a5a00, emissiveIntensity: this.behind ? 0.6 : 0 }));
    this.ballMesh.castShadow = true;
    this.ballShadow = blobShadow(this.behind ? 0.1 : 0.07, this.behind ? 0.45 : 0.35);
    scene.add(this.ballMesh, this.ballShadow);
    this.trail = makeTrail(scene, { color: 0xf4ff9a, size: BALL_R * (this.behind ? 2 : 1.3), spacing: 0.18, opacity: 0.35 });
    this.cams = [0, 1].map(() => {
      const c = new THREE.PerspectiveCamera(this.behind ? this.cfg.behindFov : 72, 1, 0.03, 900);
      c.userData.look = new THREE.Vector3(0, 1, 0);
      return c;
    });
    this.camera = this.cams[0];
  }

  /** The racket (and a forearm) you see in first person. Its origin is the hand; +y runs to the head. */
  _firstPersonRacket(i) {
    const g = new THREE.Group();
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, ...o });
    const L = this.cfg.racketLength;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, L * 0.42, 10), mat(0x1d2b4f));
    handle.position.y = L * 0.21;
    const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, L * 0.2, 6), mat(this.color(i)));
    throat.position.y = L * 0.5;
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 8, 28), mat(this.color(i)));
    head.position.y = L * 0.75;
    head.scale.set(0.82, 1.15, 1);
    head.rotation.x = Math.PI / 2;
    const strings = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    strings.position.y = L * 0.75;
    strings.scale.set(0.82, 1.15, 1);
    strings.rotation.x = Math.PI / 2;
    // Head lies in the plane spanned by the phone's right edge and long axis; strings face the screen normal (+z local).
    head.rotation.set(0, 0, 0);
    strings.rotation.set(0, 0, 0);
    g.add(handle, throat, head, strings);
    // Just a glove on the grip: a full forearm this close to the camera fills the screen.
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), mat(this.color(i)));
    this.scene.add(g, arm);
    return { group: g, arm };
  }

  // ------------------------------------------------------------ flow
  get deuceSide() {
    const m = this.match;
    return (m.points[0] + m.points[1]) % 2 === 0;
  }

  _startPoint() {
    const m = this.match;
    const srv = this.sides[m.server];
    const rcv = this.sides[1 - m.server];
    this.box = serviceBox(m.server, this.deuceSide);
    srv.x = (this.deuceSide ? 1 : -1) * 0.75 * srv.sign;
    srv.z = srv.sign * (LEN / 2 + 0.3);
    rcv.x = ((this.box.xMin + this.box.xMax) / 2) * 1.25;
    rcv.z = rcv.sign * (LEN / 2 + 0.8);
    for (const s of this.sides) {
      s.plan = null;
      s.pending = null;
      s.target = { x: s.x, z: s.z };
    }
    this.state = 'serve';
    this.stateT = 0;
    this.tossY = 0;
    this.ball.live = false;
    this.ball.hitter = -1;
    this.ball.serve = false;
    this._hud();
  }

  _hud() {
    const m = this.match;
    const pts = m.pointLabels();
    const names = [this.name(0), this.name(1)];
    this.el.top.innerHTML = `<div class="scorebox">${[0, 1]
      .map(
        (i) => `<div class="srow"><span class="dot" style="background:${this.css(i)}"></span><span class="nm">${names[i]}${m.server === i ? ' •' : ''}</span>
        ${m.setScores.map((s) => `<span class="cell dim">${s[i]}</span>`).join('')}<span class="cell">${m.games[i]}</span><span class="cell hot">${pts[i]}</span></div>`,
      )
      .join('')}</div>`;
    const srv = m.server;
    const serving = this.state === 'serve' || this.state === 'toss';
    const second = this.faults === 1 ? ' · second serve' : '';
    const who = serving ? `${this.chip(srv)} to serve${second} · ${m.call(names)}` : m.call(names);
    let how = '';
    const me = serving ? srv : this.owner(this.input.keyboard);
    if (this.isHuman(me) || !serving) {
      const s = this.src(serving ? srv : 0);
      const oneToOne = s && s.hasOrientation;
      how = serving
        ? oneToOne
          ? 'Flick the phone up to toss · swing up and through as it drops into reach (or A to toss)'
          : 'Press ↑ / Enter to toss · hold Space and release as the ball drops to serve'
        : oneToOne
          ? 'Your racket follows the phone: swing it through the ball · the racket face aims the shot · brush up for topspin'
          : 'Release Space as the ball arrives · early = cross-court, late = down the line · hold ← → for slice / topspin';
    }
    this.prompt(who, how);
    for (const i of [0, 1]) this.status(i, serving ? (srv === i ? 'Flick up to toss, then swing!' : 'Get ready') : 'Swing through the ball');
  }

  // ------------------------------------------------------------ input
  onButton(source, name, down) {
    if (!down || this.over) return;
    const srv = this.match.server;
    if (this.state === 'serve' && this.owner(source) === srv && this.isHuman(srv) && (name === 'a' || name === 'up')) this._toss(srv, 5.2);
  }

  onSwing(source, swing) {
    const i = this.owner(source);
    if (i > 1 || !this.isHuman(i) || this.over) return;
    const s = this.sides[i];
    s.swingT = 0;
    this.sfx.whoosh(swing.power);
    const b = this.ball;
    const oneToOne = source.hasOrientation;
    // Keyboard / no orientation: your swing starts the body's stroke (it lands on the ball at contact if
    // the timing was right, or whiffs in the air if not).
    if (!oneToOne && this.state !== 'toss') {
      const tt = s.plan && b.live && b.hitter !== i ? s.plan.at - this.time : null;
      const at = tt !== null && tt > -this.cfg.swingLateS && tt < this.cfg.swingEarlyS ? this.time + Math.max(0.05, tt) : this.time + 0.12;
      s.stroke = s.stroke && tt !== null ? { ...s.stroke, at, commit: true } : { at, p: { x: s.x + s.sign * 0.9, y: 1.0, z: s.z - s.sign * 0.3 }, forehand: true, commit: true };
    }
    // Serve, timing fallback (keyboard, or a phone whose racket missed but only just).
    if (this.state === 'toss' && this.match.server === i && this.stateT > 0.3 && b.p.y > 1.7) {
      if (oneToOne && s.closest > this.cfg.hitRadius * FALLBACK) return; // the racket was nowhere near it
      const q = clamp(1 - Math.abs(b.p.y - 2.55) / 1.1, 0.2, 1);
      const aimX = oneToOne ? clamp(swing.pose.yaw / 0.5, -1, 1) : swing.twist;
      this._serve(s, swing.power, aimX, q);
      return;
    }
    if (this.state !== 'rally' || !b.live || b.hitter === i || !s.plan) return;
    const c = this.cfg;
    const tt = s.plan.at - this.time; // seconds until the ball reaches the contact point
    const lead = tt + (performance.now() - swing.tPeak) / 1000;
    if (lead < -c.swingLateS || lead > c.swingEarlyS) return;
    if (oneToOne && s.closest > this.cfg.hitRadius * FALLBACK && tt < 0) return;
    const timing = lead >= c.idealLeadS ? (lead - c.idealLeadS) / (c.swingEarlyS - c.idealLeadS) : (lead - c.idealLeadS) / (c.idealLeadS + c.swingLateS);
    s.pending = { at: this.time + Math.max(0, tt), timing: clamp(timing, -1, 1), power: swing.power, twist: swing.twist, mishit: oneToOne };
  }

  _toss(i, vy) {
    const s = this.sides[i];
    this.state = 'toss';
    this.stateT = 0;
    const b = this.ball;
    b.p = { x: s.x + 0.35 * s.sign, y: 1.4, z: s.z - 0.35 * s.sign };
    b.v = { x: 0, y: vy, z: -0.25 * s.sign };
    b.w = { x: 0, y: 0, z: 0 };
    s.closest = 9;
    this.sfx.pop(0.15);
    this._hud();
  }

  // ------------------------------------------------------------ strokes
  _region(side, serve) {
    if (serve) return this.box;
    const opp = -this.sides[side].sign;
    const zs = [opp * 1.6, opp * (LEN / 2 - 0.35)].sort((a, b) => a - b);
    return { xMin: -WID / 2 + 0.3, xMax: WID / 2 - 0.3, zMin: zs[0], zMax: zs[1] };
  }

  /** Physics result -> (assisted) target -> solved stroke. */
  _launch(side, vOut, w, { serve = false, assist = this.cfg.assist } = {}) {
    const b = this.ball;
    const s = this.sides[side];
    const speed = clamp(Math.hypot(vOut.x, vOut.y, vOut.z), 9, 55);
    const pred = predictLanding({ p: { ...b.p }, v: { ...vOut }, w: { ...w } });
    const R = this._region(side, serve);
    let target;
    if (pred.land && pred.crossed && pred.netClear) target = { ...pred.land };
    else {
      // It would have gone into the net (or not reached it): aim along the same line instead.
      const h = Math.hypot(vOut.x, vOut.z) || 1;
      const depth = Math.abs(b.p.z) + 6.5;
      target = { x: b.p.x + (vOut.x / h) * depth, z: b.p.z + (vOut.z / h) * depth };
      if (Math.sign(target.z) === s.sign) target.z = -s.sign * 4;
    }
    const clampT = { x: clamp(target.x, R.xMin, R.xMax), z: clamp(target.z, R.zMin, R.zMax) };
    const tgt = { x: lerp(target.x, clampT.x, assist), z: lerp(target.z, clampT.z, assist) };
    const dir = { x: tgt.x - b.p.x, z: tgt.z - b.p.z };
    const top = spinFor(dir.x, dir.z, 1);
    const rate = clamp(w.x * top.x + w.z * top.z, -180, 320);
    const sol = assist > 0 ? solveShot({ from: { ...b.p }, target: tgt, speed, spin: rate, netMargin: serve ? 0.08 : 0.25 }) : { v: vOut, w };
    b.v = { ...sol.v };
    b.w = { ...sol.w };
    Object.assign(b, { live: true, hitter: side, bounces: 0, serve });
    this.state = 'rally';
    s.swingT = 0;
    this.hype = Math.max(this.hype, 0.6);
    this._plan(1 - side);
    return rate;
  }

  /** A ball meeting a moving racket: restitution along the face normal, grip along it (-> spin). */
  _racketHit(side, headVel, normal, quality = 1) {
    const b = this.ball;
    const s = this.sides[side];
    const fwd = { x: 0, y: 0, z: -s.sign };
    let n = normal;
    if (n.x * fwd.x + n.y * fwd.y + n.z * fwd.z < 0) n = { x: -n.x, y: -n.y, z: -n.z }; // either side of the strings
    const vr = headVel;
    const rel = { x: b.v.x - vr.x, y: b.v.y - vr.y, z: b.v.z - vr.z };
    const vn = Math.min(0, rel.x * n.x + rel.y * n.y + rel.z * n.z);
    const t = { x: rel.x - vn * n.x, y: rel.y - vn * n.y, z: rel.z - vn * n.z };
    const e = this.cfg.racketCOR * quality;
    const grip = 0.45;
    const vOut = {
      x: vr.x + t.x * (1 - grip) - e * vn * n.x,
      y: vr.y + t.y * (1 - grip) - e * vn * n.y,
      z: vr.z + t.z * (1 - grip) - e * vn * n.z,
    };
    const k = (grip * 1.5) / BALL_R;
    const w = { x: (n.y * t.z - n.z * t.y) * k, y: 0, z: (n.x * t.y - n.y * t.x) * k };
    const swingSpeed = Math.hypot(vr.x, vr.y, vr.z);
    this.sfx.pop(clamp(swingSpeed / 25, 0.2, 1));
    this.vibrate(side, 45);
    // A big swing thumps the camera and gets an "ooh" from the stands.
    if (swingSpeed > 14) {
      this.feel.shake(clamp((swingSpeed - 14) / 20, 0.1, 0.4));
      if (swingSpeed > 20) this.sfx.crowdOoh(0.4);
    }
    const serve = this.state === 'toss';
    const rate = this._launch(side, vOut, w, { serve });
    const kmh = Math.round(Math.hypot(this.ball.v.x, this.ball.v.y, this.ball.v.z) * 3.6);
    this.last(`${this.name(side)}: ${kmh} km/h · racket ${Math.round(Math.hypot(vr.x, vr.y, vr.z) * 3.6)} km/h${rate > 60 ? ' · topspin' : rate < -40 ? ' · slice' : ''}`);
  }

  _serve(s, power, aimX, quality) {
    const b = this.ball;
    const box = this.box;
    const cx = (box.xMin + box.xMax) / 2;
    const half = (box.xMax - box.xMin) / 2;
    const scatter = (1 - quality) * 1.4 + power * 0.5;
    const deep = box.zMin < 0 ? box.zMin + 0.7 : box.zMax - 0.7;
    const tgt = { x: cx + aimX * half * 0.85 + rand(-scatter, scatter), z: deep + rand(-scatter, scatter) * 0.8 };
    const sol = solveShot({ from: { ...b.p }, target: tgt, speed: 24 + 26 * power, spin: 40 + 120 * (1 - power), netMargin: 0.06 });
    b.v = sol.v;
    b.w = sol.w;
    Object.assign(b, { live: true, hitter: s.i, bounces: 0, serve: true });
    s.serveT = 0; // drives the serve animation
    this.state = 'rally';
    s.swingT = 0;
    this.sfx.pop(power);
    this.vibrate(s.i, 45);
    this._plan(1 - s.i);
    this.last(`Serve ${Math.round(sol.speed * 3.6)} km/h`);
    this._hud();
  }

  _timingHit(s) {
    const h = s.pending;
    s.pending = null;
    const b = this.ball;
    if (!b.live || b.hitter === s.i || Math.hypot(b.p.x - s.x, b.p.z - s.z) > 2.6 || b.p.y > 3) return;
    if (h.mishit && s.closest > this.cfg.hitRadius * FALLBACK) return; // the racket was nowhere near it
    this._anchorStroke(s);
    const mis = h.mishit ? 0.75 : 1;
    const tx = -s.sign * h.timing * (WID / 2) * 1.1 + (h.mishit ? rand(-1.2, 1.2) : 0);
    const depth = 7 + h.power * 4;
    const tgt = { x: tx, z: -s.sign * depth };
    const sol = solveShot({ from: { ...b.p }, target: tgt, speed: (16 + 18 * h.power) * mis, spin: h.twist * 220 });
    b.v = sol.v;
    b.w = sol.w;
    Object.assign(b, { live: true, hitter: s.i, bounces: 0, serve: false });
    s.swingT = 0;
    this.sfx.pop(h.power);
    this.vibrate(s.i, 50);
    this._plan(1 - s.i);
    const dir = Math.abs(h.timing) < 0.25 ? 'straight' : h.timing > 0 ? 'early' : 'late';
    this.last(`${this.name(s.i)}: ${h.mishit ? 'off the frame · ' : ''}${dir} · ${Math.round(sol.speed * 3.6)} km/h`);
  }

  /** At the moment of a real hit, pin the stroke to now and to where the ball actually is, so the racket is on it. */
  _anchorStroke(s) {
    if (!s.stroke) return;
    s.stroke.at = this.time;
    s.stroke.p = { ...this.ball.p };
    s.stroke.commit = true;
  }

  _aiHit(s) {
    const a = this.ai;
    const b = this.ball;
    const other = this.sides[1 - s.i];
    this.sfx.pop(0.5);
    s.swingT = 0;
    this._anchorStroke(s);
    let tgt;
    let speed = a.shot + rand(-2, 3);
    if (Math.random() < a.error) {
      const r = Math.random();
      tgt = r < 0.4 ? { x: rand(-2, 2), z: -s.sign * 0.4 } : r < 0.75 ? { x: (Math.random() < 0.5 ? -1 : 1) * (WID / 2 + rand(0.3, 1.4)), z: -s.sign * 9 } : { x: rand(-2, 2), z: -s.sign * (LEN / 2 + rand(0.4, 1.8)) };
      if (r < 0.4) speed *= 1.2;
    } else {
      const away = other.x > 0 ? -1 : 1;
      tgt = { x: lerp(rand(-2.6, 2.6), away * 3.3, a.placement * rand(0.4, 1)), z: -s.sign * rand(7, 11) };
    }
    const sol = solveShot({ from: { ...b.p }, target: tgt, speed, spin: a.spin * rand(80, 300) });
    b.v = sol.v;
    b.w = sol.w;
    Object.assign(b, { live: true, hitter: s.i, bounces: 0, serve: false });
    this._plan(1 - s.i);
  }

  /** Work out where side i should meet the incoming ball, and run there. */
  _plan(i) {
    const s = this.sides[i];
    s.plan = null;
    s.pending = null;
    s.closest = 9;
    const b = this.ball;
    const path = predictPath(b, s.sign * (LEN / 2 + 5));
    const landing = predictLanding(b);
    const out = landing.land && !(Math.abs(landing.land.x) <= WID / 2 + 0.05 && Math.abs(landing.land.z) <= LEN / 2 + 0.05 && Math.sign(landing.land.z) === s.sign);
    if (!this.isHuman(i) && out && landing.netClear) return; // the CPU lets it go
    let pick = null;
    for (const q of path) {
      if (Math.sign(q.p.z) !== s.sign) continue;
      if (b.serve && !q.bounced) continue;
      if (q.bounced && q.p.y <= 1.25 && q.v.y < 0) {
        pick = q;
        break;
      }
    }
    if (!pick) pick = path.filter((q) => Math.sign(q.p.z) === s.sign && q.bounced).sort((a, c) => a.p.y - c.p.y)[0] || path[path.length - 1];
    if (!pick) return;
    // Stand so the contact point sits at arm + racket length from the right shoulder.
    const reach = this.cfg.armLength * 0.85 + this.cfg.racketLength * 0.7;
    const V = SH_Y - pick.p.y;
    const F = 0.3;
    const L = Math.sqrt(Math.max(0.04, reach * reach - V * V - F * F));
    const rs = s.sign; // +x is side 0's right
    const fore = pick.p.x - rs * (SH_X + L);
    const back = pick.p.x - rs * SH_X + rs * L;
    const forehand = Math.abs(fore - s.x) <= Math.abs(back - s.x) + 0.6;
    s.target = { x: forehand ? fore : back, z: pick.p.z + s.sign * F };
    s.plan = { at: this.time + pick.t, p: pick.p, forehand };
    // The stroke the body animates toward: the CPU always swings at it; a human (keyboard) swing commits it.
    s.stroke = { at: s.plan.at, p: { ...pick.p }, forehand, commit: !this.isHuman(i) };
  }

  // ------------------------------------------------------------ points
  _endPoint(winner, reason) {
    if (this.state === 'point') return;
    this.state = 'point';
    this.ball.live = false;
    this.faults = 0;
    const names = [this.name(0), this.name(1)];
    const result = this.match.point(winner);
    const text =
      result === 'match' ? `Game, set and match — ${names[winner]}`
      : result === 'set' ? `Set — ${names[winner]}`
      : result === 'game' ? `Game — ${names[winner]}`
      : this.match.call(names);
    const wc = this.sides[winner].char;
    const lc = this.sides[1 - winner].char;
    if (result === 'point') {
      this.banner(reason ? `${reason}! ${text}` : text, 2, 'small');
      this.sfx.good();
    } else {
      // Games, sets and the match get the big bouncing call.
      const word = result === 'match' ? 'MATCH!' : result === 'set' ? 'SET!' : 'GAME!';
      this.feel.celebrate(word, { color: this.css(winner), size: result === 'game' ? 'mid' : 'big', sub: text, confetti: result === 'match' && this.isHuman(winner) ? 120 : 0, seconds: 2.1 });
      this.sfx.spare();
      this.sfx.sparkle(result === 'match' ? 3 : result === 'set' ? 2 : 0);
    }
    if (result === 'match') this.feel.slowmo(1.4, 0.3); // let the last ball hang in the air
    // The crowd is on the human's side (and claps politely for a CPU winner).
    const humanWon = this.isHuman(winner);
    const big = result !== 'point';
    if (humanWon) this.moment(big ? 'great' : 'good', { winner: wc, loser: this.isHuman(1 - winner) ? lc : null, intensity: big ? 0.9 : 0.55 });
    else {
      this.sfx.applause(big ? 0.4 : 0.2);
      if (reason) this.sfx.crowdGroan(0.45);
      react(lc, 'sad');
      react(wc, big ? 'cheer' : 'pump');
    }
    this.hype = 1.5;
    if (this.isHuman(winner)) this.vibrate(winner, [50, 40, 50]);
    this._hud();
    this.after(result === 'match' ? 2.8 : 2.3, () => {
      if (this.match.winner === null) return this._startPoint();
      const w = this.match.winner;
      const line = (i) => this.match.setScores.map((s) => s[i]).join(' ');
      // Skill margin: how many more games you won than lost, over the whole match.
      const games = this.match.setScores.reduce((acc, s) => [acc[0] + s[0], acc[1] + s[1]], [0, 0]);
      const margin = clamp(Math.abs(games[0] - games[1]) / (this.cfg.gamesPerSet * Math.max(1, this.match.setScores.length)), 0, 1);
      this.finish(
        [w, 1 - w].map((i) => ({ name: names[i], css: this.css(i), score: line(i) })),
        { unit: this.match.setScores.length > 1 ? 'sets' : 'games', title: `${names[w]} wins!`, skill: this.versus(w, margin) },
      );
    });
  }

  _fault(reason) {
    if (this.state === 'point') return;
    this.faults++;
    if (this.faults >= 2) return this._endPoint(1 - this.match.server, `${reason} — double fault`);
    this.state = 'point';
    this.ball.live = false;
    this.banner(`${reason} — fault`, 1.4, 'small');
    this.sfx.miss();
    this.after(1.6, () => this._startPoint());
  }

  // ---------------------------------------------------------- update
  _headFor(s) {
    // Right shoulder -> hand -> racket head, from the phone's pointing direction (rotated for side 1).
    const p = this.pose(s.i);
    const f = s.sign;
    const rot = (v) => ({ x: v.x * f, y: v.y, z: v.z * f });
    const point = rot(p.basis.point);
    const right = rot(p.basis.right);
    const normal = rot(p.basis.normal);
    const A = s.assist; // the reach assist moves the whole arm (and body) toward the ball
    const sh = { x: s.x + SH_X * f + A.x, y: SH_Y + A.y, z: s.z + A.z };
    const a = this.cfg.armLength * 0.85;
    const hand = { x: sh.x + point.x * a, y: sh.y + point.y * a - 0.08, z: sh.z + point.z * a };
    const r = this.cfg.racketLength * 0.75;
    const head = { x: hand.x + point.x * r, y: hand.y + point.y * r, z: hand.z + point.z * r };
    return { sh, hand, head, point, right, normal, real: p.real };
  }

  /**
   * Reach assist for a 1:1 racket. Within ASSIST_WINDOW of the planned contact, slide the arm (and the body,
   * which carries it) toward where the ball will be, by most of the distance between it and the strings as
   * you are pointing them now. Your aim and swing still decide everything: point the racket roughly at the
   * ball and swing, and the strings genuinely meet it. Outside the window the assist relaxes back to zero.
   */
  _updateAssist(s, dt) {
    const A = s.assist;
    const b = this.ball;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let rate = 6;
    const myToss = this.state === 'toss' && this.match.server === s.i && b.p.y > 1.6;
    const incoming = this.state === 'rally' && b.live && b.hitter !== s.i && s.plan;
    if ((myToss || incoming) && s.frame && s.frame.real) {
      let w;
      let px;
      let py;
      let pz;
      if (myToss) {
        w = b.v.y < 0 ? 1 : 0.5;
        px = b.p.x;
        py = b.p.y;
        pz = b.p.z;
      } else {
        const tt = s.plan.at - this.time;
        const k = clamp(1 - Math.abs(tt) / ASSIST_WINDOW, 0, 1);
        w = k * k * (3 - 2 * k);
        // Far out: where the ball will be at contact; close in: where it is now.
        const f = clamp(tt / 0.15, 0, 1);
        px = lerp(b.p.x, s.plan.p.x, f);
        py = lerp(b.p.y, s.plan.p.y, f);
        pz = lerp(b.p.z, s.plan.p.z, f);
      }
      // The strings' centre as aimed now, without any assist.
      const h = s.frame.head;
      tx = (px - (h.x - A.x)) * ASSIST_GAIN * w;
      ty = (py - (h.y - A.y)) * ASSIST_GAIN * w;
      tz = (pz - (h.z - A.z)) * ASSIST_GAIN * w;
      const len = Math.hypot(tx, ty, tz);
      if (len > ASSIST_MAX) {
        tx *= ASSIST_MAX / len;
        ty *= ASSIST_MAX / len;
        tz *= ASSIST_MAX / len;
      }
      ty = Math.max(ty, -0.45); // crouch at most this far
      rate = 16;
    }
    const k = ease(dt, rate);
    A.x += (tx - A.x) * k;
    A.y += (ty - A.y) * k;
    A.z += (tz - A.z) * k;
  }

  update(dt) {
    this.tick(dt);
    this.stateT += dt;
    this.hype = Math.max(0.3, this.hype - dt * 0.6);
    for (const stand of this.crowd) stand.update(this.time, this.hype);
    const b = this.ball;
    const c = this.cfg;
    const srvSide = this.sides[this.match.server];

    // ---- serve: ball in hand, waiting for the toss ----
    if (this.state === 'serve') {
      b.p = { x: srvSide.x - 0.3 * srvSide.sign, y: 1.05, z: srvSide.z - 0.2 * srvSide.sign };
      const src = this.src(srvSide.i);
      if (this.isHuman(srvSide.i) && src && this.stateT > 0.5 && src.aWorld.y > c.tossThresholdG) {
        this._toss(srvSide.i, clamp(3.8 + (src.aWorld.y - c.tossThresholdG) * 1.6, 4.2, 6.4));
      } else if (!this.isHuman(srvSide.i) && this.stateT > 1.1) this._toss(srvSide.i, 5.4);
    }

    // ---- racket heads (1:1) ----
    for (const s of this.sides) {
      if (!s.fp) continue;
      this._updateAssist(s, dt);
      const h = this._headFor(s);
      s.prevHead = s.head || h.head;
      s.head = h.head;
      s.frame = h;
      // The same without the assist: the racket's own motion (your swing), for its speed at contact.
      s.prevRaw = s.raw || { x: h.head.x - s.assist.x, y: h.head.y - s.assist.y, z: h.head.z - s.assist.z };
      s.raw = { x: h.head.x - s.assist.x, y: h.head.y - s.assist.y, z: h.head.z - s.assist.z };
    }

    // ---- ball (sub-stepped so a fast racket cannot pass through it) ----
    const ballMoving = this.state === 'toss' || this.state === 'rally' || this.state === 'point';
    if (ballMoving) {
      const h = dt / SUBSTEPS;
      for (let k = 1; k <= SUBSTEPS && ballMoving; k++) {
        const z0 = b.p.z;
        if (this.state === 'toss') {
          b.v.y -= 9.81 * h;
          b.p.x += b.v.x * h;
          b.p.y += b.v.y * h;
          b.p.z += b.v.z * h;
        } else stepAir(b, h);
        // Net
        if ((this.state === 'rally') && z0 * b.p.z < 0 && b.p.y < NET + BALL_R * 0.5) {
          b.p.z = z0 > 0 ? 0.05 : -0.05;
          b.v = { x: b.v.x * 0.1, y: 0, z: -b.v.z * 0.1 };
          if (b.serve) this._fault('Net');
          else this._endPoint(1 - b.hitter, 'Net');
        }
        // Racket contact
        if (this.state === 'rally' || this.state === 'toss') {
          for (const s of this.sides) {
            if (!s.fp || !s.frame.real || b.hitter === s.i) continue;
            if (this.state === 'toss' && this.match.server !== s.i) continue;
            if (this.state === 'rally' && (b.serve ? b.bounces < 1 : false)) continue;
            if (this.state === 'rally' && b.v.z * s.sign <= 0 && b.bounces === 0) continue;
            const u = k / SUBSTEPS;
            const hx = lerp(s.prevHead.x, s.head.x, u);
            const hy = lerp(s.prevHead.y, s.head.y, u);
            const hz = lerp(s.prevHead.z, s.head.z, u);
            const d = Math.hypot(b.p.x - hx, b.p.y - hy, b.p.z - hz);
            s.closest = Math.min(s.closest, d);
            if (d < c.hitRadius) {
              const vel = { x: (s.raw.x - s.prevRaw.x) / dt, y: (s.raw.y - s.prevRaw.y) / dt, z: (s.raw.z - s.prevRaw.z) / dt };
              const vm = Math.hypot(vel.x, vel.y, vel.z);
              if (vm > 45) for (const key of ['x', 'y', 'z']) vel[key] *= 45 / vm;
              const sweet = clamp(1 - d / c.hitRadius, 0, 1);
              this._racketHit(s.i, vel, s.frame.normal, 0.75 + 0.25 * sweet);
              break;
            }
          }
        }
        // Bounce
        if (b.p.y <= BALL_R && b.v.y < 0) {
          if (this.state === 'toss') {
            b.p.y = BALL_R;
            b.v = { x: 0, y: 0, z: 0 };
          } else {
            const x = b.p.x;
            const z = b.p.z;
            bounce(b);
            if (Math.abs(b.v.y) > 0.8) this.sfx.bounce();
            b.bounces++;
            if (this.state === 'rally') {
              const hitterSide = b.hitter;
              const sideOfBounce = z > 0 ? 0 : 1;
              if (b.serve && b.bounces === 1) {
                if (!inBox(this.box, x, z)) this._fault('Out');
                else b.serve = 'in';
              } else if (b.bounces === 1) {
                const inCourt = Math.abs(x) <= WID / 2 + 0.05 && Math.abs(z) <= LEN / 2 + 0.05;
                if (!inCourt || sideOfBounce === hitterSide) this._endPoint(1 - hitterSide, 'Out');
              } else if (b.bounces >= 2) this._endPoint(hitterSide, b.serve === 'in' ? 'Ace' : '');
            }
          }
        }
      }
      if (this.state === 'toss' && this.stateT > 0.5 && b.p.y < 1.0) {
        // Let a toss drop without swinging: catch it and try again.
        this.state = 'serve';
        this.stateT = 0.2;
      }
      if (this.state === 'rally' && (Math.abs(b.p.z) > LEN / 2 + 9 || Math.abs(b.p.x) > 16)) this._endPoint(b.bounces >= 1 ? b.hitter : 1 - b.hitter, b.bounces >= 1 ? '' : 'Out');
    }
    if (this.state === 'toss' && !this.isHuman(srvSide.i) && b.v.y < 0 && b.p.y < 2.75) {
      this._serve(srvSide, clamp(this.ai.shot / 30 + rand(-0.1, 0.1), 0, 1), rand(-0.8, 0.8), 0.85);
    }

    // ---- players run, CPU hits, timing hits resolve ----
    for (const s of this.sides) {
      s.cooldown -= dt;
      s.swingT += dt;
      if (s.serveT !== undefined) s.serveT += dt;
      if (s.plan && this.state === 'rally' && b.live && b.hitter !== s.i) {
        if (!this.isHuman(s.i) && this.time >= s.plan.at - 0.01) {
          const near = Math.hypot(b.p.x - s.x - s.sign * 0.8, b.p.z - s.z) < 2.4 && b.p.y < 3;
          s.plan = null;
          if (near) this._aiHit(s);
        }
      }
      if (s.pending && this.time >= s.pending.at) this._timingHit(s);
      const speed = this.isHuman(s.i) ? c.playerSpeed : this.ai.speed;
      const tgt = s.target || { x: s.x, z: s.z };
      if (this.state === 'serve' || this.state === 'toss') tgt.z = s.z;
      const dx = tgt.x - s.x;
      const dz = tgt.z - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.02 && this.state !== 'serve' && this.state !== 'toss') {
        const step = Math.min(dist, speed * dt);
        s.x += (dx / dist) * step;
        s.z += (dz / dist) * step;
      }
      if (this.state === 'point' && dist < 0.05) s.target = { x: s.x * 0.5, z: s.sign * (LEN / 2 + 0.6) };
      // pose
      const g = s.char.group;
      const run = Math.abs(Math.sin(this.time * 9)) * (dist > 0.3 && this.state === 'rally' ? 0.06 : 0);
      const oneToOne = !!(s.fp && s.frame && s.frame.real);
      if (oneToOne) {
        // The body goes where the reach assist takes the arm (a lunge / crouch toward the ball).
        const A = s.assist;
        g.position.set(s.x + A.x, run + Math.min(0, A.y) * 0.8, s.z + A.z);
        // Reach the Yardling's arm from its shoulder to the 1:1 racket's grip, so the racket is in its hand.
        // (Into the character's own frame: side 1 is turned round, and the whole body is scaled by SC.)
        const h = s.frame;
        _arm.set((h.hand.x - h.sh.x) * s.sign, h.hand.y - h.sh.y - Math.min(0, A.y) * 0.2, (h.hand.z - h.sh.z) * s.sign);
        const len = _arm.length() || 1;
        s.char.armR.quaternion.setFromUnitVectors(DOWN, _arm.multiplyScalar(1 / len));
        s.char.armR.scale.y = clamp(len / ARM_LEN, 0.6, 1.4);
        s.char.rig.rotation.y = 0;
      } else {
        g.position.set(s.x, run, s.z);
        this._strokePose(s, dt);
      }
      // One racket per player: the 1:1 racket when the phone drives it, else the one in the hand.
      s.prop.visible = !oneToOne;
      s.oneToOne = oneToOne;
      if (s.fp) this._placeFp(s);
    }

    this.ballMesh.position.set(b.p.x, b.p.y, b.p.z);
    this.ballShadow.position.set(b.p.x, 0.02, b.p.z);
    if ((this.state === 'rally' || this.state === 'point') && Math.hypot(b.v.x, b.v.y, b.v.z) > 9) this.trail.push(b.p.x, b.p.y, b.p.z);
    else this.trail.fade();
    this._cameras(dt);
  }

  /**
   * The CPU's (and keyboard player's) stroke, animated so the racket head lands exactly on the ball at the
   * moment of contact: ready stance → backswing with a shoulder turn as the ball comes → an accelerating
   * swing through the contact point → follow-through finishing high → back to ready. The arm is aimed by
   * direction (like the 1:1 racket), so the racket in the hand reaches the planned contact point.
   */
  _strokePose(s, dt) {
    const ch = s.char;
    const f = s.sign;
    const st = s.stroke;
    // Everything below is in the character's own frame (side 1 is turned round).
    let blend = 0; // 0 = ready stance, 1 = on the stroke path
    let alpha = 0; // swing angle around the body: <0 backswing, 0 contact, >0 follow-through
    let lift = 0; // extra upward finish
    let reach = 1;
    if (this.state === 'toss' && this.match.server === s.i) {
      // Serve: racket up behind the head while the ball goes up.
      _sw.set(0.25, 0.75, 0.6).normalize();
      blend = -1;
    } else if (s.serveT !== undefined && s.serveT < 0.6) {
      blend = -1;
    }
    if (blend === 0 && st) {
      const u = this.time - st.at;
      if (u < -0.6) blend = 0;
      else if (u < -0.2 || (!st.commit && u < 0.3)) {
        // Backswing: turn the shoulders and take the racket back as the ball comes.
        const k = smoothstep((u + 0.6) / 0.4);
        blend = k;
        alpha = -1.5 * k;
      } else if (!st.commit) {
        blend = smoothstep(1 - (u - 0.3) / 0.4);
        alpha = -1.5;
      } else if (u < 0) {
        // The swing: accelerating into the ball.
        const k = (u + 0.2) / 0.2;
        blend = 1;
        alpha = -1.5 * (1 - k * k);
      } else if (u < 0.28) {
        // Follow-through: decelerating across the body, finishing high.
        const k = u / 0.28;
        blend = 1;
        alpha = 1.9 * (1 - (1 - k) * (1 - k));
        lift = 0.55 * k;
      } else if (u < 0.85) {
        blend = smoothstep(1 - (u - 0.45) / 0.4);
        alpha = 1.9;
        lift = 0.55;
      }
    }
    // Ready stance: racket in front, head up a little.
    _rd.set(0.45, -0.35, -0.82).normalize();
    let dir;
    if (blend === -1) {
      // Serve: from behind the head, over the top and down across the body after the hit.
      const t = s.serveT ?? 9;
      if (this.state === 'toss' && this.match.server === s.i) dir = _sw;
      else if (t < 0.1) dir = _tmp.set(0.25, 0.75, 0.6).lerp(_tmp2.set(0.2, 0.85, -0.5), t / 0.1).normalize();
      else if (t < 0.35) dir = _tmp.set(0.2, 0.85, -0.5).lerp(_tmp2.set(-0.45, -0.6, -0.55), (t - 0.1) / 0.25).normalize();
      else dir = _tmp.set(-0.45, -0.6, -0.55).lerp(_rd, smoothstep((t - 0.35) / 0.25)).normalize();
    } else if (blend > 0) {
      // Where the ball will be, from this shoulder, in this body's frame.
      const shx = s.x + SH_X * f;
      // In the last instant before contact, aim at the ball itself (frames don't land exactly on the plan).
      const b = this.ball;
      const near = b.live && b.hitter !== s.i && st.commit ? smoothstep(1 - Math.abs(this.time - st.at) / 0.12) : 0;
      _c.set((lerp(st.p.x, b.p.x, near) - shx) * f, lerp(st.p.y, b.p.y, near) - SH_Y, (lerp(st.p.z, b.p.z, near) - s.z) * f);
      reach = _c.length() / (0.91 * SC); // the prop racket's strings sit 0.91 (scaled) from the shoulder
      _c.normalize();
      // Swing around the vertical: forehand swings back toward +z, backhand mirrored.
      const beta = (st.forehand ? 1 : -1) * alpha;
      _c.applyAxisAngle(UP, beta);
      _c.y = clamp(_c.y + lift, -0.95, 0.95);
      _c.normalize();
      dir = _tmp.copy(_rd).lerp(_c, blend).normalize();
      reach = lerp(1, clamp(reach, 0.65, 1.3), blend);
    } else dir = _rd;
    // A shoulder turn that follows the swing (the arm direction is corrected for it below).
    const turn = blend > 0 ? (st.forehand ? 1 : -1) * alpha * 0.28 * blend : 0;
    ch.rig.rotation.y = lerp(ch.rig.rotation.y, turn, ease(dt, 20));
    _tmp2.copy(dir).applyAxisAngle(UP, -ch.rig.rotation.y);
    // Smooth the arm toward its target pose (fast enough not to lag the swing, slow enough to never pop).
    _q1.setFromUnitVectors(DOWN, _tmp2);
    ch.armR.quaternion.slerp(_q1, ease(dt, blend > 0.9 || blend === -1 ? 40 : 14));
    ch.armR.scale.y = lerp(ch.armR.scale.y, reach, ease(dt, 20));
    // The free arm balances the swing.
    const b01 = Math.max(0, blend);
    ch.armL.rotation.x = lerp(ch.armL.rotation.x, blend === -1 ? 2.4 : 0.7 + 0.5 * b01 * (alpha < 0 ? 1 : 0.2), ease(dt, 10)); // serve: the tossing arm points up
    ch.armL.rotation.z = lerp(ch.armL.rotation.z, -0.35 - 0.3 * b01, ease(dt, 10));
  }

  _placeFp(s) {
    const { group, arm } = s.fp;
    const h = s.frame && s.frame.real ? s.frame : this._headFor(s);
    _m4.makeBasis(_bx.set(h.right.x, h.right.y, h.right.z), _by.set(h.point.x, h.point.y, h.point.z), _bz.set(h.normal.x, h.normal.y, h.normal.z));
    group.quaternion.setFromRotationMatrix(_m4);
    group.position.set(h.hand.x, h.hand.y, h.hand.z);
    if (!h.real) {
      // No orientation sensor: a canned swing so the racket still looks alive.
      const t = s.swingT < 0.3 ? s.swingT / 0.3 : 1;
      group.rotateZ(lerp(1.2, -1.4, t) * s.sign * -1);
    }
    arm.position.set(h.hand.x, h.hand.y, h.hand.z);
  }

  _cameras(dt) {
    const b = this.ball;
    for (const s of this.sides) {
      const cam = this.cams[s.i];
      const myToss = this.state === 'toss' && this.match.server === s.i;
      if (this.behind) {
        // High behind your baseline, the whole court in view, your player in the lower middle. The camera
        // drifts with you (not locked on, so running doesn't swing the world around) and tips up a
        // little to follow your toss.
        const ud = cam.userData;
        const c = this.cfg;
        if (ud.x === undefined) ud.x = s.x;
        ud.x = lerp(ud.x, s.x * 0.6, ease(dt, 2.5));
        const back = Math.max(Math.abs(s.z), LEN / 2) + c.behindBack;
        cam.position.set(ud.x, c.behindHeight, s.sign * back);
        // Aim at your side of the net, so your player stands in the lower third, clear of the HUD.
        _v1.set(ud.x * 0.5, myToss ? 1.4 : 0, s.sign * 8);
        ud.look.lerp(_v1, ease(dt, 4));
        cam.lookAt(ud.look);
        continue;
      }
      cam.position.set(s.x, 1.62, s.z + s.sign * 0.32);
      _v1.set(0, 0.7, -s.sign * (LEN / 2));
      _v2.set(b.p.x, b.p.y, b.p.z);
      // Your head follows the ball a little, like it would.
      _v1.lerp(_v2, myToss ? 0.85 : 0.35);
      cam.userData.look.lerp(_v1, ease(dt, 5));
      cam.lookAt(cam.userData.look);
    }
  }

  render(renderer, W, H) {
    const humans = [0, 1].filter((i) => this.isHuman(i));
    const show = (i) => () => {
      for (const s of this.sides) {
        // First person hides your own body (you'd be inside it) and shows a glove on the grip instead.
        s.char.group.visible = this.behind || s.i !== i;
        if (s.fp) {
          s.fp.group.visible = this.behind ? !!s.oneToOne : true;
          s.fp.arm.visible = !this.behind && s.i === i;
        }
      }
    };
    if (humans.length === 2) {
      renderViews(renderer, this.scene, W, H, [
        { camera: this.cams[0], x: 0, y: 0, w: 0.5, h: 1, before: show(0) },
        { camera: this.cams[1], x: 0.5, y: 0, w: 0.5, h: 1, before: show(1) },
      ]);
    } else {
      renderViews(renderer, this.scene, W, H, [{ camera: this.cams[humans[0] ?? 0], x: 0, y: 0, w: 1, h: 1, before: show(humans[0] ?? 0) }]);
    }
  }
}

export const tennisInfo = { difficultyNames: DIFFICULTY };
