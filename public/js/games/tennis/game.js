// Tennis, first person. Your racket follows the phone 1:1 (the phone is the handle, the screen is the
// strings), your player runs to the ball by itself, and the ball is real physics: drag, spin, a
// spin-dependent bounce. Where the ball goes comes from the racket face and the racket's speed when
// it meets the ball. CONFIG.tennis.assist pulls near misses back toward the court.
//
// Serving: flick the phone up to toss the ball, then swing up and through as it drops into reach.
// Without an orientation sensor (or on the keyboard) hitting falls back to timing: swing as the
// ball arrives (early = cross-court, late = down the line).
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { createCharacter, addProp } from '../../characters.js';
import { BaseGame, outdoorScene, blobShadow, patch, flatMat, addTree, addGrandstand, addBanner, renderViews, makeTrail, lerp, clamp, rand, ease, DIFFICULTY } from '../common.js';
import { TennisMatch } from './scoring.js';
import { COURT, BALL_R, stepAir, bounce, predictLanding, predictPath, solveShot, serviceBox, inBox, spinFor } from './physics.js';

const { LEN, WID, NET } = COURT;
const SUBSTEPS = 6;

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
    this.crowd = [
      addGrandstand(scene, { x: -10.5, z: 0, rotY: Math.PI / 2, width: 26, rows: 6 }),
      addGrandstand(scene, { x: 10.5, z: 0, rotY: -Math.PI / 2, width: 26, rows: 6 }),
      addGrandstand(scene, { x: 0, z: -19.5, rotY: 0, width: 18, rows: 5 }),
      addGrandstand(scene, { x: 0, z: 19.5, rotY: Math.PI, width: 18, rows: 5 }),
    ];
    this.hype = 0.3;
    for (const z of [-17.4, 17.4]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(14, 1.0, 0.3), flatMat(0x1f5fae));
      board.position.set(0, 0.5, z);
      scene.add(board);
      addBanner(scene, 'SWINGYARD  OPEN', { x: 0, y: 0.5, z: z + (z < 0 ? 0.16 : -0.16), rotY: z < 0 ? 0 : Math.PI, width: 9, height: 0.8, bg: '#1f5fae' });
    }

    this.sides = [0, 1].map((i) => {
      const sign = i === 0 ? 1 : -1;
      const char = createCharacter(this.color(i));
      const prop = addProp(char, 'racket', 0xffffff);
      char.group.rotation.y = i === 0 ? 0 : Math.PI;
      scene.add(char.group);
      const s = { i, sign, x: 0, z: sign * (LEN / 2 + 0.6), char, prop, swingT: 9, plan: null, pending: null, cooldown: 0, head: null, prevHead: null, closest: 9 };
      if (this.isHuman(i)) s.fp = this._firstPersonRacket(i);
      return s;
    });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.5, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe8ff3a, roughness: 0.6 }));
    this.ballMesh.castShadow = true;
    this.ballShadow = blobShadow(0.07, 0.35);
    scene.add(this.ballMesh, this.ballShadow);
    this.trail = makeTrail(scene, { color: 0xf4ff9a, size: BALL_R * 1.3, spacing: 0.18, opacity: 0.35 });
    this.cams = [0, 1].map(() => {
      const c = new THREE.PerspectiveCamera(72, 1, 0.03, 900);
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
    // Serve, timing fallback (keyboard, or a phone whose racket missed but the swing was close).
    if (this.state === 'toss' && this.match.server === i && this.stateT > 0.3 && b.p.y > 1.7) {
      if (oneToOne && s.closest > this.cfg.hitRadius * 1.8) return; // the racket was nowhere near it
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
    if (oneToOne && s.closest > this.cfg.hitRadius * 1.8 && tt < 0) return;
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
    this.sfx.pop(clamp(Math.hypot(vr.x, vr.y, vr.z) / 25, 0.2, 1));
    this.vibrate(side, 45);
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
    if (h.mishit && s.closest > this.cfg.hitRadius * 1.8) return; // the racket was nowhere near it
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

  _aiHit(s) {
    const a = this.ai;
    const b = this.ball;
    const other = this.sides[1 - s.i];
    this.sfx.pop(0.5);
    s.swingT = 0;
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
    const V = 1.42 - pick.p.y;
    const F = 0.3;
    const L = Math.sqrt(Math.max(0.04, reach * reach - V * V - F * F));
    const rs = s.sign; // +x is side 0's right
    const fore = pick.p.x - rs * (0.22 + L);
    const back = pick.p.x - rs * 0.22 + rs * L;
    const forehand = Math.abs(fore - s.x) <= Math.abs(back - s.x) + 0.6;
    s.target = { x: forehand ? fore : back, z: pick.p.z + s.sign * F };
    s.plan = { at: this.time + pick.t, p: pick.p, forehand };
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
    this.banner(reason ? `${reason}! ${text}` : text, 2, result === 'point' ? 'small' : '');
    if (result !== 'point') this.sfx.spare();
    else this.sfx.good();
    this.hype = 1.5;
    if (this.isHuman(winner)) this.vibrate(winner, [50, 40, 50]);
    this._hud();
    this.after(2.3, () => {
      if (this.match.winner === null) return this._startPoint();
      const w = this.match.winner;
      const line = (i) => this.match.setScores.map((s) => s[i]).join(' ');
      this.finish(
        [w, 1 - w].map((i) => ({ name: names[i], css: this.css(i), score: line(i) })),
        { unit: this.match.setScores.length > 1 ? 'sets' : 'games', title: `${names[w]} wins!` },
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
    const sh = { x: s.x + 0.22 * f, y: 1.42, z: s.z };
    const a = this.cfg.armLength * 0.85;
    const hand = { x: sh.x + point.x * a, y: sh.y + point.y * a - 0.08, z: sh.z + point.z * a };
    const r = this.cfg.racketLength * 0.75;
    const head = { x: hand.x + point.x * r, y: hand.y + point.y * r, z: hand.z + point.z * r };
    return { sh, hand, head, point, right, normal, real: p.real };
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
      const h = this._headFor(s);
      s.prevHead = s.head || h.head;
      s.head = h.head;
      s.frame = h;
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
              const vel = { x: (s.head.x - s.prevHead.x) / dt, y: (s.head.y - s.prevHead.y) / dt, z: (s.head.z - s.prevHead.z) / dt };
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
      g.position.set(s.x, Math.abs(Math.sin(this.time * 9)) * (dist > 0.3 && this.state === 'rally' ? 0.06 : 0), s.z);
      if (s.fp && s.frame && s.frame.real) {
        // Other player's view of a 1:1 racket: aim the arm along the phone.
        const p = s.frame.point;
        s.char.armR.rotation.x = clamp(1.2 + Math.asin(clamp(p.y, -1, 1)), -1, 3);
        s.char.armR.rotation.z = clamp(-p.x * s.sign * 1.2, -1.4, 1.4);
      } else {
        s.char.armR.rotation.x = s.swingT < 0.28 ? lerp(-1.1, 2.3, s.swingT / 0.28) : lerp(s.char.armR.rotation.x, 0.5, ease(dt, 9));
        s.char.armR.rotation.z = 0.5;
      }
      if (s.fp) this._placeFp(s);
    }

    this.ballMesh.position.set(b.p.x, b.p.y, b.p.z);
    this.ballShadow.position.set(b.p.x, 0.02, b.p.z);
    if ((this.state === 'rally' || this.state === 'point') && Math.hypot(b.v.x, b.v.y, b.v.z) > 9) this.trail.push(b.p.x, b.p.y, b.p.z);
    else this.trail.fade();
    this._cameras(dt);
  }

  _placeFp(s) {
    const { group, arm } = s.fp;
    const h = s.frame && s.frame.real ? s.frame : this._headFor(s);
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(h.right.x, h.right.y, h.right.z),
      new THREE.Vector3(h.point.x, h.point.y, h.point.z),
      new THREE.Vector3(h.normal.x, h.normal.y, h.normal.z),
    );
    group.quaternion.setFromRotationMatrix(m);
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
      cam.position.set(s.x, 1.62, s.z + s.sign * 0.32);
      const opp = new THREE.Vector3(0, 0.7, -s.sign * (LEN / 2));
      const ballV = new THREE.Vector3(b.p.x, b.p.y, b.p.z);
      // Your head follows the ball a little, like it would.
      const want = opp.lerp(ballV, this.state === 'toss' && this.match.server === s.i ? 0.85 : 0.35);
      cam.userData.look.lerp(want, ease(dt, 5));
      cam.lookAt(cam.userData.look);
    }
  }

  render(renderer, W, H) {
    const humans = [0, 1].filter((i) => this.isHuman(i));
    const show = (i) => () => {
      for (const s of this.sides) {
        s.char.group.visible = s.i !== i;
        if (s.fp) {
          s.fp.group.visible = true;
          s.fp.arm.visible = s.i === i;
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
