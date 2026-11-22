// Golf: three holes of stroke play. Hold the trigger and swing; strength fills the power meter,
// wrist twist hooks or slices, wind pushes the ball, and on the green you putt.
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { createCharacter, addProp, react } from '../../characters.js';
import { BaseGame, outdoorScene, blobShadow, patch, flatMat, addTree, followSun, lerp, clamp, rand, ease } from '../common.js';
import { CLUBS, PUTTER, HOLES, lieAt, distanceToPin, angleToPin, suggestClub, simulateShot, simulatePutt, scoreName } from './course.js';

const LIE_NAME = { fairway: 'Fairway', rough: 'Rough', sand: 'Bunker', green: 'Green', water: 'Water', ob: 'Out of bounds' };

export class GolfGame extends BaseGame {
  constructor(o) {
    super(o, 'Golf');
    this.cfg = CONFIG.golf;
    this.players = Array.from({ length: this.playerCount }, (_, i) => ({ i, scores: [], strokes: 0, pos: [0, 0] }));
    const { scene, camera, sun } = outdoorScene({ ground: 0x4fa85a, fov: 48, fog: [120, 520], shadow: 30 });
    this.scene = scene;
    this.sun = sun;
    this.camera = camera;
    this._look = new THREE.Vector3();
    this.ballMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    this.ballShadow = blobShadow(0.14, 0.3);
    this.aimLine = patch(scene, new THREE.PlaneGeometry(0.12, 1), 0xffffff, 0.06);
    this.aimLine.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 24), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    scene.add(this.ballMesh, this.ballShadow, this.ring);
    // Predicted flight (dashed) and the path the ball actually took (solid).
    this.arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 1.6, gapSize: 1.1, transparent: true, opacity: 0.9, depthWrite: false }));
    this.arc.frustumCulled = false;
    // The flight trail: one fixed buffer, filled in place as the ball flies (no per-frame geometry).
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4096 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 }));
    this.trail.frustumCulled = false;
    scene.add(this.arc, this.trail);
    // A big bobbing arrow over the hole, drawn on top of everything so you can always find it.
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff3d6e, depthTest: false, transparent: true, opacity: 0.95 });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 });
    this.holeArrow = new THREE.Group();
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 20), arrowMat);
    head.rotation.x = Math.PI;
    head.position.y = 0.45;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 14), arrowMat);
    shaft.position.y = 1.4;
    const rim = new THREE.Mesh(new THREE.ConeGeometry(0.66, 1.06, 20), rimMat);
    rim.rotation.x = Math.PI;
    rim.position.y = 0.43;
    rim.renderOrder = 998;
    head.renderOrder = shaft.renderOrder = 999;
    this.holeArrow.add(rim, head, shaft);
    scene.add(this.holeArrow);
    this.chars = this.players.map((p) => {
      const c = createCharacter(this.color(p.i));
      addProp(c, 'club');
      c.group.add(blobShadow(0.4));
      c.group.visible = false;
      scene.add(c.group);
      return c;
    });
    this.holeIndex = -1;
    this._tmpV = new THREE.Vector3();
    this.baseAim = 0;
    this.swingT = 9;
    this.holdAt = -9;
    this._nextHole();
  }

  // --------------------------------------------------------- course
  _buildHole(hole) {
    if (this.holeGroup) {
      this.scene.remove(this.holeGroup);
      this.holeGroup.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    const g = (this.holeGroup = new THREE.Group());
    const disc = (x, z, r, color, y) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      g.add(m);
    };
    for (let i = 0; i < hole.path.length - 1; i++) {
      const [ax, az] = hole.path[i];
      const [bx, bz] = hole.path[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 7);
      for (let k = 0; k <= n; k++) disc(lerp(ax, bx, k / n), lerp(az, bz, k / n), hole.width / 2, 0x7ad27a, 0.02);
    }
    disc(0, 0, 5, 0x8fe08a, 0.03);
    for (const [x, z, r] of hole.water) disc(x, z, r, 0x3fa9f5, 0.04);
    for (const [x, z, r] of hole.sand) disc(x, z, r, 0xf2dfa7, 0.045);
    disc(hole.pin[0], hole.pin[1], hole.greenR, 0xa6ee9a, 0.05);
    disc(hole.pin[0], hole.pin[1], 0.22, 0x1d2b4f, 0.06);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5), flatMat(0xffffff));
    pole.position.set(hole.pin[0], 1.6, hole.pin[1]);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 3), flatMat(0xff6b4a));
    flag.position.set(hole.pin[0] + 0.5, 2.8, hole.pin[1]);
    flag.rotation.z = -Math.PI / 2;
    g.add(pole, flag);
    // Trees in the rough (seeded so every hole looks the same each time).
    let seed = 7 + this.holeIndex * 131;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const sub = { add: (t) => g.add(t) };
    for (let i = 0; i < 90; i++) {
      const x = (rnd() - 0.5) * 230;
      const z = 30 + rnd() * (hole.pin[1] - 90);
      let clear = lieAt(hole, x, z) === 'rough';
      for (let k = 0; clear && k < hole.path.length - 1; k++) {
        const [ax, az] = hole.path[k];
        const [bx, bz] = hole.path[k + 1];
        for (let t = 0; t <= 1; t += 0.1) if (Math.hypot(x - lerp(ax, bx, t), z - lerp(az, bz, t)) < hole.width / 2 + 7) clear = false;
      }
      if (clear) addTree(sub, x, z, 2.2 + rnd() * 1.6);
    }
    this.scene.add(g);
    if (this.holeIndex > 0) this.warm?.(); // build the new hole's shaders now, not mid-swing
  }

  _nextHole() {
    this.holeIndex++;
    if (this.holeIndex >= HOLES.length) return this._end();
    this.hole = HOLES[this.holeIndex];
    this._buildHole(this.hole);
    const a = rand(0, Math.PI * 2);
    const speed = Math.round(rand(0, 7));
    this.wind = { x: Math.sin(a) * speed, z: -Math.cos(a) * speed, speed, angle: a };
    for (const p of this.players) {
      p.pos = [0, 0];
      p.strokes = 0;
    }
    this.cur = -1;
    this.banner(`Hole ${this.holeIndex + 1} · Par ${this.hole.par}`, 2.2);
    this._nextPlayer();
  }

  _nextPlayer() {
    this.cur++;
    if (this.cur >= this.players.length) return this.after(0.4, () => this._nextHole());
    this.chars.forEach((c, i) => (c.group.visible = i === this.cur));
    this._address();
  }

  _address() {
    const p = this.players[this.cur];
    this.state = 'aim';
    this.lie = lieAt(this.hole, p.pos[0], p.pos[1]);
    this.dist = distanceToPin(this.hole, p.pos);
    this.club = suggestClub(this.dist, this.lie);
    this.baseAim = angleToPin(this.hole, p.pos);
    this.aimAng = this.baseAim;
    this.aimLocked = false;
    this._arcKey = '';
    this.trail.visible = false;
    this.ballPos = new THREE.Vector3(p.pos[0], 0.11, p.pos[1]);
    this.meter(null);
    this._hud();
  }

  _hud() {
    const p = this.players[this.cur];
    if (!p) return;
    const h = this.hole;
    const putting = this.club === PUTTER;
    const club = CLUBS[this.club];
    const reach = putting ? this.cfg.puttMax : club.carry * ({ rough: 0.85, sand: 0.6 }[this.lie] ?? 1);
    const need = clamp(Math.round((this.dist / reach) * 100), 1, 999);
    // Wind arrow relative to where you are aiming (up = tailwind).
    const rel = ((this.wind.angle - this.aimAng) * 180) / Math.PI;
    this.el.top.innerHTML = `<div class="scorebox">
        <div class="srow"><span class="nm big">Hole ${this.holeIndex + 1}</span><span class="cell dim">Par ${h.par}</span><span class="cell hot">Stroke ${p.strokes + 1}</span></div>
        ${this.players.map((q) => `<div class="srow"><span class="dot" style="background:${this.css(q.i)}"></span><span class="nm">${this.name(q.i)}</span>${q.scores.map((s) => `<span class="cell dim">${s}</span>`).join('')}<span class="cell total">${q.scores.reduce((a, b) => a + b, 0) + (q.scores.length <= this.holeIndex && q.i === this.cur ? q.strokes : 0)}</span></div>`).join('')}
      </div>
      <div class="scorebox side">
        <div class="wind"><span class="arrow" style="transform:rotate(${rel}deg)">↑</span><b>${this.wind.speed} m/s</b><small>wind</small></div>
        <div class="counts"><div><b>${this.dist < 30 ? this.dist.toFixed(1) : Math.round(this.dist)} m</b> to pin</div><div>${LIE_NAME[this.lie]}</div><div><b>${club.name}</b>${putting ? '' : ` · ${Math.round(reach)} m`}</div></div>
      </div>`;
    const kb = !this.hasPhone(p.i);
    this.prompt(
      `${this.chip(p.i)} · ${putting ? 'putting' : club.name} · about ${need > 100 ? '100%+' : `${need}%`} power needed`,
      kb
        ? `← → turn · mouse fine-aims · ${putting ? '' : 'Enter changes club · '}hold Space to fill the meter, release to swing · hold ← → while charging to ${putting ? 'push it' : 'hook / slice'}`
        : `Point to aim (◀ ▶ turns further) · ${putting ? '' : 'A changes club · '}hold the big button, swing back and through — faster = further · twist = hook / slice`,
    );
    for (const q of this.players) this.status(q.i, q.i === this.cur ? `${club.name}: hold + swing` : `${this.name(this.cur)} is playing`);
  }

  onButton(source, name, down) {
    const p = this.players[this.cur];
    if (!p || !this.canAct(source, p.i)) return;
    if (name === 'hold') {
      this.holdAt = this.time; // pressed or released just now
      if (down && this.state === 'aim') this.aimLocked = true; // the swing moves the phone: keep the aim
      if (!down) this.after(0.7, () => {
        if (this.state === 'aim' && !this.held(p.i, 'hold', true)) this.aimLocked = false;
      });
    }
    if (name === 'a' && down && this.state === 'aim' && this.lie !== 'green') {
      this.club = (this.club + 1) % PUTTER;
      this.sfx.move();
      this._hud();
    }
  }

  onSwing(source, swing) {
    const p = this.players[this.cur];
    if (!p || this.state !== 'aim' || !this.canAct(source, p.i) || this.over) return;
    // Only swings made with the trigger held count, so practice swings are free.
    if (!source.buttons.hold && this.time - this.holdAt > 0.6) return;
    const putting = this.club === PUTTER;
    const args = { hole: this.hole, pos: p.pos, aim: this.aimAng, power: swing.power, cfg: this.cfg };
    const res = putting
      ? simulatePutt({ ...args, aim: this.aimAng + swing.twist * 0.06 })
      : simulateShot({ ...args, club: this.club, spin: swing.twist, wind: this.wind });
    p.strokes++;
    this.shot = { res, i: 0, t: 0, putting, from: [...p.pos] };
    this.arc.visible = false;
    this.trail.visible = !putting;
    this.state = 'flight';
    this.swingT = 0;
    this.meter(swing.power);
    this.sfx.whoosh(swing.power);
    if (putting) this.sfx.bounce();
    else {
      this.sfx.pop(swing.power);
      // A flushed drive: a beat of hit-stop at impact.
      if (swing.power > 0.75) {
        this.feel.hitstop(40);
        this.feel.shake(0.15);
      }
    }
    this.vibrate(p.i, 50);
    const curve = swing.twist === 0 ? 'straight' : `${swing.twist > 0 ? 'slice →' : '← hook'} ${Math.round(Math.abs(swing.twist) * 100)}%`;
    this.last(`Power ${Math.round(swing.power * 100)}% · ${curve}${putting ? '' : ` · carry ${Math.round(res.carry)} m`}`);
  }

  _setLine(line, pts) {
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts.length > 1 ? pts : [pts[0] || new THREE.Vector3(), pts[0] || new THREE.Vector3()]);
    if (line.material.isLineDashedMaterial) line.computeLineDistances();
  }

  /** Dashed arc of where the ball would go at this power (no hook / slice), plus its landing spot. */
  _preview(p, putting, power) {
    if (putting) {
      this._landAt = null;
      return;
    }
    const key = `${this.aimAng.toFixed(3)}|${this.club}|${power.toFixed(2)}|${p.pos.join(',')}`;
    if (key === this._arcKey) return;
    this._arcKey = key;
    const res = simulateShot({ hole: this.hole, pos: p.pos, aim: this.aimAng, club: this.club, power, spin: 0, wind: this.wind, cfg: this.cfg });
    const air = [];
    for (const q of res.points) {
      air.push(new THREE.Vector3(q.x, q.y + 0.15, q.z));
      if (q.y <= 0 && air.length > 2) break;
    }
    this._setLine(this.arc, air);
    const land = air[air.length - 1];
    this._landAt = { x: land.x, z: land.z };
  }

  _landed() {
    const p = this.players[this.cur];
    const { res, from, putting } = this.shot;
    this.shot = null;
    const par = this.hole.par;
    const holeOut = (text, cls) => {
      p.scores.push(p.strokes);
      this.banner(text, 2.2, cls);
      this._hud();
      this.state = 'done';
      this.after(2.4, () => this._nextPlayer());
    };
    const c = this.chars[this.cur];
    if (res.holed) {
      this.sfx[p.strokes <= par ? 'strike' : 'good']();
      this.vibrate(p.i, [80, 60, 160]);
      const name = scoreName(p.strokes, par);
      if (p.strokes <= par) {
        // Under par gets the big call, confetti and a roar from the gallery; par gets warm applause.
        const under = par - p.strokes;
        this.feel.celebrate(`${name.toUpperCase()}${name.endsWith('!') ? '' : '!'}`, { color: under ? '#ffd166' : '#2ec4b6', size: under ? 'huge' : 'big', confetti: under ? 60 + under * 40 : 0 });
        this.sfx.sparkle(under + 1);
        if (under) this.sfx.crowdCheer(0.7 + under * 0.15);
        else this.sfx.applause(0.6);
        react(c, under ? 'cheer' : 'pump', 2);
        p.scores.push(p.strokes);
        this._hud();
        this.state = 'done';
        this.after(2.4, () => this._nextPlayer());
        return;
      }
      this.sfx.applause(0.3);
      if (p.strokes > par + 1) react(c, 'sad');
      return holeOut(name, '');
    }
    if (res.penalty) {
      p.strokes++;
      p.pos = from;
      this.sfx[res.lie === 'water' ? 'splash' : 'miss']();
      this.sfx.crowdGroan(0.4);
      react(c, 'sad');
      this.banner(`${LIE_NAME[res.lie]} — one stroke penalty`, 1.8, 'small');
    } else {
      p.pos = res.end;
      const d = distanceToPin(this.hole, p.pos);
      if (res.lie === 'green' && d < 0.5) {
        p.strokes++; // close enough to tap in
        this.sfx.good();
        return holeOut(`Tap-in · ${scoreName(p.strokes, par)}`, '');
      }
      if (res.lie === 'sand') {
        this.banner('Bunker', 1.2, 'small');
        this.sfx.crowdOoh(0.3);
      } else if (res.lie === 'green' && !putting) {
        this.banner('On the green', 1.2, 'small');
        this.sfx.applause(d < 3 ? 0.6 : 0.3); // stuck it close: a bigger hand
        if (d < 3) react(c, 'pump');
      }
    }
    if (p.strokes >= par + this.cfg.maxOverPar) {
      p.strokes = par + this.cfg.maxOverPar;
      return holeOut('Picked up', 'small');
    }
    this.state = 'wait';
    this.after(res.penalty ? 1.9 : 1.0, () => this._address());
  }

  _end() {
    const pars = HOLES.reduce((a, h) => a + h.par, 0);
    const rows = this.players
      .map((p) => {
        const total = p.scores.reduce((a, b) => a + b, 0);
        const rel = total - pars;
        return { name: this.name(p.i), css: this.css(p.i), total, score: `${total} (${rel === 0 ? 'E' : rel > 0 ? `+${rel}` : rel})` };
      })
      .sort((a, b) => a.total - b.total);
    const skill = rows.length === 1 ? { kind: 'score', value: rows[0].total - pars } : null; // strokes over par
    this.finish(rows, { unit: 'strokes', title: rows.length > 1 ? (rows[0].total === rows[1].total ? "It's a tie!" : `${rows[0].name} wins!`) : 'Golf — final score', skill });
  }

  // --------------------------------------------------------- update
  update(dt) {
    this.tick(dt);
    this.swingT += dt;
    const p = this.players[this.cur];
    if (!p || this.over) return;
    const putting = this.club === PUTTER;

    if (this.state === 'aim') {
      const fine = putting ? 0.3 : 1;
      let dir = 0;
      for (const s of this.sourcesOf(p.i, true)) dir += (s.buttons.right ? 1 : 0) - (s.buttons.left ? 1 : 0);
      this.baseAim += Math.sign(dir) * this.cfg.aimSpeed * fine * dt;
      if (!this.aimLocked) {
        const want = this.baseAim + ((this.aim(p.i, true).x * this.cfg.aimRange * Math.PI) / 180) * fine;
        this.aimAng += (want - this.aimAng) * ease(dt, 8);
      }
      const kb = this.input.keyboard;
      if (kb.charging) this.meter(kb.charge);
      this._preview(p, putting, kb.charging ? kb.charge : 1);
    } else if (this.state === 'flight') {
      // Interpolate between simulation samples so the ball glides instead of stepping.
      const s = this.shot;
      s.t += dt * (s.putting ? 1 : this.cfg.flightSpeed);
      const pts = s.res.points;
      const step = s.putting ? 0.01 : 0.02;
      const f = Math.min(pts.length - 1, s.t / step);
      const i0 = Math.floor(f);
      const i1 = Math.min(pts.length - 1, i0 + 1);
      const u = f - i0;
      const a = pts[i0];
      const b = pts[i1];
      this.ballPos.set(lerp(a.x, b.x, u), lerp(a.y, b.y, u) + 0.11, lerp(a.z, b.z, u));
      if (!s.putting && i0 !== s.drawn) {
        s.drawn = i0;
        const attr = this.trail.geometry.attributes.position;
        const n = Math.min(i0 + 1, attr.count);
        for (let k = 0; k < n; k++) attr.setXYZ(k, pts[k].x, pts[k].y + 0.11, pts[k].z);
        attr.needsUpdate = true;
        this.trail.geometry.setDrawRange(0, n);
      }
      if (f >= pts.length - 1) this._landed();
    }

    // visuals
    const hp = this.hole.pin;
    const camDist = this.camera.position.distanceTo(this._tmpV.set(hp[0], 4, hp[1]));
    const sc = clamp(camDist * 0.028, 0.6, 9);
    this.holeArrow.scale.setScalar(sc);
    this.holeArrow.position.set(hp[0], 3.6 + sc * (0.4 + 0.25 * Math.sin(this.time * 3)), hp[1]);
    this.holeArrow.rotation.y = this.time * 1.4;
    const dx = Math.sin(this.aimAng);
    const dz = -Math.cos(this.aimAng);
    this.ballMesh.position.copy(this.ballPos);
    this.ballShadow.position.set(this.ballPos.x, 0.07, this.ballPos.z);
    const c = this.chars[this.cur];
    c.group.position.set(p.pos[0] + dz * 0.75, 0, p.pos[1] - dx * 0.75);
    c.group.rotation.y = -this.aimAng - Math.PI / 2;
    c.armR.rotation.z = 0;
    // While the trigger is held the club follows the phone (back swing); otherwise a canned swing.
    const pz = this.pose(p.i, true);
    let armTarget = this.held(p.i, 'hold', true) ? (pz.real ? clamp(-(pz.pose.pitch + 1.0) * 1.3, -2.6, 0.4) : -1.6) : 0.25;
    if (this.swingT < 0.3) armTarget = lerp(-2.2, 2.0, this.swingT / 0.3);
    c.armR.rotation.x = this.swingT < 0.3 ? armTarget : lerp(c.armR.rotation.x, armTarget, ease(dt, 14));

    const aiming = this.state === 'aim';
    const len = putting ? Math.min(this.dist + 1.5, 12) : 45;
    this.aimLine.visible = aiming;
    this.aimLine.scale.set(putting ? 0.5 : 1, len, 1);
    this.aimLine.position.set(p.pos[0] + dx * (len / 2 + 0.4), 0.07, p.pos[1] + dz * (len / 2 + 0.4));
    this.aimLine.rotation.z = -this.aimAng;
    this.ring.visible = aiming && !putting && !!this._landAt;
    this.arc.visible = aiming && !putting;
    if (this.ring.visible) {
      this.ring.position.set(this._landAt.x, 0.08, this._landAt.z);
      this.ring.scale.setScalar(1 + CLUBS[this.club].carry / 90);
    }

    const cam = this.camera;
    const flying = this.state === 'flight' && !this.shot?.putting;
    const back = putting ? 4.2 : flying ? 11 : 7.5;
    const up = putting ? 1.9 : flying ? 4 + this.ballPos.y * 0.25 : 3;
    followSun(this.sun, lerp(this.ballPos.x, this.camera.position.x, 0.3), lerp(this.ballPos.z, this.camera.position.z, 0.3));
    // Critically damped follow: the camera trails smoothly instead of snapping between shots.
    const k = ease(dt, flying ? 2.2 : 3.5);
    const kl = ease(dt, flying ? 6 : 4);
    cam.position.set(lerp(cam.position.x, this.ballPos.x - dx * back, k), lerp(cam.position.y, up, k), lerp(cam.position.z, this.ballPos.z - dz * back, k));
    const ahead = putting ? 6 : flying ? 2 : 30;
    this._look.set(lerp(this._look.x, this.ballPos.x + dx * ahead, kl), lerp(this._look.y, flying ? this.ballPos.y * 0.75 : 0.6, kl), lerp(this._look.z, this.ballPos.z + dz * ahead, kl));
    cam.lookAt(this._look);
  }
}
