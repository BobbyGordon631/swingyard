// Archery: hold the trigger to draw, tilt to aim, let go to shoot. Watch the wind.
// Three ends of three arrows at 20, 35 and 50 metres.
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { createCharacter, addProp, react } from '../../characters.js';
import { BaseGame, outdoorScene, blobShadow, flatMat, addTree, lerp, clamp, rand, ease } from '../common.js';

const TARGET_R = 0.61;
const CENTER_Y = 1.3;

/** Points for an arrow landing r metres from the centre (10 rings on a 122 cm face). */
export function ringScore(r) {
  return r > TARGET_R ? 0 : Math.max(1, 10 - Math.floor(r / (TARGET_R / 10)));
}

/** Where the arrow lands relative to the centre, given aim point, draw (0-1), wind (m/s across) and distance. */
export function impactPoint({ aimX, aimY, draw, windX, distance }) {
  return {
    x: aimX + windX * distance * 0.0025, // crosswind drift grows with distance
    y: aimY - (1 - draw) * distance * 0.03, // a short draw drops low
  };
}

export class ArcheryGame extends BaseGame {
  constructor(o) {
    super(o, 'Archery');
    this.cfg = CONFIG.archery;
    this.players = Array.from({ length: this.playerCount }, (_, i) => ({ i, ends: [] }));
    this.end = 0;
    this.cur = -1;
    this.arrows = [];
    this._build();
    this._nextArcher();
  }

  _build() {
    const { scene, camera } = outdoorScene({ ground: 0x7ccf78, fov: 40, fog: [80, 300] });
    this.scene = scene;
    this.camera = camera;
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(6, 70), new THREE.MeshStandardMaterial({ color: 0x8fe08a, roughness: 1 }));
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.01, -30);
    scene.add(lane);
    for (let i = 0; i < 12; i++) {
      addTree(scene, -9 - (i % 3) * 3, -6 - i * 6, 1.6 + (i % 2) * 0.5);
      addTree(scene, 9 + (i % 3) * 3, -4 - i * 6, 1.6 + ((i + 1) % 2) * 0.5);
    }
    // Target: coloured rings on a stand.
    const t = (this.target = new THREE.Group());
    const colors = [0xffffff, 0xffffff, 0x222831, 0x222831, 0x3fa9f5, 0x3fa9f5, 0xe63946, 0xe63946, 0xffd166, 0xffd166];
    colors.forEach((c, k) => {
      const ring = new THREE.Mesh(new THREE.CircleGeometry(TARGET_R * (1 - k / 10), 32), new THREE.MeshBasicMaterial({ color: c }));
      ring.position.z = 0.001 * (k + 1);
      t.add(ring);
    });
    const back = new THREE.Mesh(new THREE.CylinderGeometry(TARGET_R + 0.08, TARGET_R + 0.08, 0.12, 24), flatMat(0xd9a45b));
    back.rotation.x = Math.PI / 2;
    back.position.z = -0.07;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, CENTER_Y + 0.4, 0.1), flatMat(0x8a5a2b));
    leg.position.set(0, -(CENTER_Y + 0.4) / 2 + 0.3, -0.2);
    t.add(back, leg);
    scene.add(t);
    this.chars = this.players.map((p) => {
      const c = createCharacter(this.color(p.i));
      addProp(c, 'bow');
      c.group.add(blobShadow(0.4));
      c.group.position.set(-0.75, 0, 0.3);
      c.group.rotation.y = -0.5;
      c.group.visible = false;
      scene.add(c.group);
      return c;
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5), flatMat(0x8a5a2b));
    shaft.rotation.x = Math.PI / 2;
    const fletch = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), flatMat(0xff6b4a));
    fletch.rotation.x = -Math.PI / 2;
    fletch.position.z = 0.4;
    this.arrowProto = new THREE.Group();
    this.arrowProto.add(shaft, fletch);
    this.el.center.innerHTML = '<div class="crosshair"></div>';
    this.cross = this.el.center.firstChild;
  }

  get distance() {
    return this.cfg.distances[this.end];
  }

  _nextArcher() {
    this.cur++;
    if (this.cur >= this.players.length) {
      this.cur = 0;
      this.end++;
      if (this.end >= this.cfg.distances.length) return this._end();
    }
    for (const a of this.arrows) this.scene.remove(a);
    this.arrows = [];
    this.players[this.cur].ends[this.end] = [];
    this.chars.forEach((c, i) => (c.group.visible = i === this.cur));
    this.target.position.set(0, CENTER_Y, -this.distance);
    const speed = Math.round(rand(0, this.cfg.windMax) * 10) / 10;
    this.windX = (Math.random() < 0.5 ? -1 : 1) * speed;
    this.banner(`${this.players.length > 1 ? `${this.name(this.cur)} · ` : ''}End ${this.end + 1} · ${this.distance} m`, 1.8, 'small');
    this._nock();
  }

  _nock() {
    this.state = 'aim';
    this.offX = 0; // keyboard arrow-key nudges on top of the pointer
    this.offY = 0;
    this.drawT = 0;
    this._hud();
  }

  _hud() {
    const p = this.players[this.cur];
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    this.el.top.innerHTML = `<div class="scorebox">${this.players
      .map((q) => `<div class="srow"><span class="dot" style="background:${this.css(q.i)}"></span><span class="nm">${this.name(q.i)}</span>${this.cfg.distances.map((_, e) => `<span class="cell${e === this.end && q.i === this.cur ? ' hot' : ' dim'}">${q.ends[e] ? sum(q.ends[e]) : ''}</span>`).join('')}<span class="cell total">${sum(q.ends.flat())}</span></div>`)
      .join('')}</div>
      <div class="scorebox side"><div class="wind"><span class="arrow" style="transform:rotate(${this.windX >= 0 ? 90 : -90}deg)">↑</span><b>${Math.abs(this.windX).toFixed(1)} m/s</b><small>wind</small></div>
      <div class="counts"><div><b>${this.distance} m</b></div><div>Arrow ${Math.min(p.ends[this.end].length + 1, this.cfg.arrowsPerEnd)} of ${this.cfg.arrowsPerEnd}</div><div>${p.ends[this.end].join(' · ') || '&nbsp;'}</div></div></div>`;
    const kb = !this.hasPhone(p.i);
    this.prompt(
      `${this.chip(p.i)} · aim into the wind`,
      kb ? 'Mouse (or arrow keys) aims · hold Space to draw the bow, release to shoot (full draw flies true)' : 'Point the phone at the target · hold the big button to draw, let go to shoot (full draw flies true) · ⟳ Center if it drifts',
    );
    for (const q of this.players) this.status(q.i, q.i === this.cur ? 'Hold to draw, release to shoot' : `${this.name(this.cur)} is shooting`);
  }

  onButton(source, name, down) {
    const p = this.players[this.cur];
    if (!p || name !== 'hold' || !this.canAct(source, p.i) || this.over) return;
    if (down && this.state === 'aim') {
      this.state = 'draw';
      this.drawT = 0;
      this.holder = source;
    } else if (!down && this.state === 'draw' && source === this.holder) {
      const draw = clamp(this.drawT / this.cfg.drawSeconds, 0, 1);
      if (draw < 0.3) {
        this.state = 'aim';
        this.last('Draw the bow further before letting go');
        return;
      }
      this._shoot(draw);
    }
  }

  _shoot(draw) {
    const p = this.players[this.cur];
    const hit = impactPoint({ aimX: this.aimX + this.shakeX, aimY: this.aimY + this.shakeY, draw, windX: this.windX, distance: this.distance });
    const arrow = this.arrowProto.clone();
    this.scene.add(arrow);
    this.arrows.push(arrow);
    this.flight = { arrow, t: 0, T: this.distance / 55, from: new THREE.Vector3(0.15, 1.45, 0), to: new THREE.Vector3(hit.x, CENTER_Y + hit.y, -this.distance + 0.3), hit, draw };
    this.state = 'fly';
    this.sfx.twang();
    this.vibrate(p.i, 40);
  }

  _impact() {
    const p = this.players[this.cur];
    const { hit, draw } = this.flight;
    this.flight = null;
    const r = Math.hypot(hit.x, hit.y);
    const pts = ringScore(r);
    p.ends[this.end].push(pts);
    const c = this.chars[this.cur];
    if (pts > 0) {
      this.sfx.thunk();
      this.feel.hitstop(30 + pts * 4); // the thunk lands with weight
      this.feel.shake(0.05 + pts * 0.012);
    } else this.sfx.miss();
    if (pts === 10) {
      this.sfx.strike();
      this.sfx.sparkle(2);
      this.sfx.crowdCheer(0.75);
      this.vibrate(p.i, [80, 60, 160]);
      this.feel.celebrate('BULLSEYE!', { color: '#ffd166', size: 'big', confetti: 50, sub: '10 points' });
      react(c, 'cheer');
    } else {
      this.banner(pts ? `${pts}` : 'Miss', 1.5, pts >= 9 ? 'big' : '');
      if (pts >= 8) this.sfx.applause(0.25 + (pts - 8) * 0.15);
      else if (pts === 0) {
        this.sfx.crowdGroan(0.35);
        react(c, 'sad');
      }
      if (pts === 9) react(c, 'pump');
    }
    this.last(`Draw ${Math.round(draw * 100)}% · landed ${Math.round(r * 100)} cm from the centre`);
    this.state = 'score';
    this._hud();
    this.after(1.9, () => (p.ends[this.end].length >= this.cfg.arrowsPerEnd ? this._nextArcher() : this._nock()));
  }

  _end() {
    const rows = this.players
      .map((p) => ({ name: this.name(p.i), css: this.css(p.i), score: p.ends.flat().reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.score - a.score);
    const max = this.cfg.distances.length * this.cfg.arrowsPerEnd * 10;
    this.finish(rows, { unit: 'pts', skill: rows.length === 1 ? { kind: 'score', value: rows[0].score, max } : null });
  }

  update(dt) {
    this.tick(dt);
    const p = this.players[this.cur];
    if (!p || this.over) return;
    const D = this.distance;
    this.shakeX = this.shakeY = 0;
    if (this.state === 'aim' || this.state === 'draw') {
      // Point at the target: the phone's direction (the mouse for the keyboard) is the aim point.
      const src = this.src(p.i, true);
      if (src === this.input.keyboard) {
        const k = src.keys;
        this.offX = clamp(this.offX + ((k.right ? 1 : 0) - (k.left ? 1 : 0)) * this.cfg.aimSpeed * dt, -2, 2);
        this.offY = clamp(this.offY + ((k.up ? 1 : 0) - (k.down ? 1 : 0)) * this.cfg.aimSpeed * dt, -1.5, 1.5);
      }
      const a = this.aim(p.i, true);
      const reach = this.cfg.aimReach;
      const tx = clamp(a.x * reach + this.offX, -2.2, 2.2);
      const ty = clamp(a.y * reach * 0.75 + this.offY, -1.2, 1.6);
      this.aimX = this.aimX === undefined ? tx : lerp(this.aimX, tx, ease(dt, 18));
      this.aimY = this.aimY === undefined ? ty : lerp(this.aimY, ty, ease(dt, 18));
      if (this.state === 'draw') {
        this.drawT += dt;
        const tired = Math.max(0, this.drawT - this.cfg.steadySeconds);
        const amp = Math.min(0.35, tired * 0.08) + 0.012;
        this.shakeX = Math.sin(this.time * 9.1) * amp;
        this.shakeY = Math.cos(this.time * 7.3) * amp;
      }
    } else if (this.state === 'fly') {
      const f = this.flight;
      f.t += dt;
      const u = Math.min(1, f.t / f.T);
      f.arrow.position.lerpVectors(f.from, f.to, u);
      f.arrow.position.y += Math.sin(Math.PI * u) * D * 0.012;
      f.arrow.lookAt(f.to.x, f.to.y, f.to.z - 5);
      if (u >= 1) this._impact();
    }
    const draw = this.state === 'draw' ? clamp(this.drawT / this.cfg.drawSeconds, 0, 1) : 0;
    this.meter(this.state === 'draw' ? draw : null);

    // Camera looks where you aim; drawing the bow zooms in.
    const cam = this.camera;
    const zoomed = (2 * Math.atan(2.4 / D) * 180) / Math.PI;
    const wantFov = this.state === 'score' || this.state === 'fly' ? zoomed * 0.8 : lerp(zoomed * 2.6, zoomed, draw);
    cam.fov = lerp(cam.fov, wantFov, ease(dt, 6));
    cam.updateProjectionMatrix();
    cam.position.set(0.15, 1.55, 0.9);
    const lookX = this.state === 'score' || this.state === 'fly' ? 0 : this.aimX + this.shakeX;
    const lookY = this.state === 'score' || this.state === 'fly' ? 0 : this.aimY + this.shakeY;
    this._lx = lerp(this._lx ?? lookX, lookX, ease(dt, 10));
    this._ly = lerp(this._ly ?? lookY, lookY, ease(dt, 10));
    cam.lookAt(this._lx, CENTER_Y + this._ly, -D);
    this.cross.style.opacity = this.state === 'aim' || this.state === 'draw' ? 1 : 0;
    this.cross.style.transform = `scale(${lerp(1.6, 0.7, draw)})`;

    const c = this.chars[this.cur];
    c.armL.rotation.x = 1.55;
    c.armR.rotation.x = lerp(1.5, 0.9, draw);
    c.armR.rotation.z = -0.5 * draw;
  }

  dispose() {
    this.camera.fov = 40;
    super.dispose();
  }
}
