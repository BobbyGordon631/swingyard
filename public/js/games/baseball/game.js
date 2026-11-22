// Baseball: split screen while the pitch is on its way (batter's view on the left, pitcher's view on
// the right), then a third-person camera on whichever fielder gets to the ball.
//
// Batting: swing as the ball crosses the plate. Timing sets where it goes (early = pulled), swing
// speed sets how hard, an uppercut lifts it, a chop keeps it on the ground.
// Pitching: swing to throw - swing speed = pitch speed, where you point = where it goes.
//   Fastball: just swing · Curveball: hold A · Splitter: hold the big button · Screwball: hold both
//   Arrow pad left/right moves along the rubber. Twisting your wrist adds extra break.
// Three innings, no walks, a mercy rule, and automatic fielding that really races the ball.
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { createCharacter, addProp, react as charReact } from '../../characters.js';
import { BaseGame, outdoorScene, blobShadow, patch, flatMat, addGrandstand, addBanner, renderViews, makeTrail, followSun, crowdFill, ghost, lerp, clamp, rand, ease } from '../common.js';
import { advance, walk, battedBall, fieldPlay, BASES, MOUND, FENCE, POSITIONS } from './rules.js';

const PITCHES = {
  fast: { name: 'Fastball', speed: 1.0, brk: [0, 0.06] },
  curve: { name: 'Curveball', speed: 0.78, brk: [0.38, -0.62] },
  split: { name: 'Splitter', speed: 0.86, brk: [0, -0.78] },
  screw: { name: 'Screwball', speed: 0.8, brk: [-0.45, -0.38] },
};
const KB_ORDER = ['fast', 'curve', 'split', 'screw'];
const PLATE_Z = 0;
const CATCH_Z = 1.25;
// The batter's box (right-handed batter, left of the plate from the catcher's view) and the bat.
const BATTER_X = -0.85;
const BATTER_Z = 0.2;
const BAT_REACH = 1.11; // shoulder to the bat's sweet spot
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const STANCE = new THREE.Vector3(-0.25, 0.85, 0.45).normalize(); // bat up behind the head (world)
const R_SHOULDER = new THREE.Vector3(0.31, 0.95, 0);
const L_SHOULDER = new THREE.Vector3(-0.31, 0.95, 0);
const _bs = new THREE.Vector3();
const _bc = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _bd = new THREE.Vector3();
const _bl = new THREE.Vector3();
const _bh = new THREE.Vector3();
const _bq = new THREE.Quaternion();
const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const HOME = [0, 0];
const BASE_RING = [HOME, ...BASES.slice(0, 3), HOME]; // home -> 1st -> 2nd -> 3rd -> home

export class BaseballGame extends BaseGame {
  constructor(o) {
    super(o, 'Baseball');
    this.cfg = CONFIG.baseball;
    this.ai = this.cfg.ai[this.difficulty];
    this.innings = this.cfg.innings;
    this.inning = 0;
    this.half = 0; // 0 = top (team 0 bats), 1 = bottom
    this.score = [0, 0];
    this.line = [[], []];
    this.kbPitch = 0;
    this.pitcherX = 0;
    this.hype = 0.35;
    this._build();
    this._startHalf();
  }

  get batting() {
    return this.half;
  }
  get pitching() {
    return 1 - this.half;
  }

  // ------------------------------------------------------------ scene
  _build() {
    const { scene, camera, sun } = outdoorScene({ ground: 0x5fbf63, fov: 44, fog: [140, 420], shadow: 26 });
    this.scene = scene;
    this.sun = sun;
    this.camPlay = camera;
    this.camera = camera;
    this.camBat = new THREE.PerspectiveCamera(46, 1, 0.1, 900); // wide enough for the whole batter in half a screen
    this.camPitch = new THREE.PerspectiveCamera(40, 1, 0.1, 900);

    const dirt = patch(scene, new THREE.PlaneGeometry(30, 30), 0xd9a871, 0.01, 0, -19.4);
    dirt.rotation.z = Math.PI / 4;
    const grass = patch(scene, new THREE.PlaneGeometry(21, 21), 0x74cf74, 0.015, 0, -19.4);
    grass.rotation.z = Math.PI / 4;
    patch(scene, new THREE.CircleGeometry(4, 24), 0xd9a871, 0.02, 0, 0);
    patch(scene, new THREE.CircleGeometry(2.6, 20), 0xd9a871, 0.02, 0, -MOUND);
    // Mown stripes in the outfield
    for (let i = 0; i < 9; i++) {
      const stripe = patch(scene, new THREE.PlaneGeometry(7, 140), i % 2 ? 0x63c467 : 0x58b85d, 0.005, -28 + i * 7, -60);
      stripe.rotation.z = 0;
    }
    for (const [x, z] of [...BASES.slice(0, 3), HOME]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), flatMat(0xffffff));
      base.position.set(x, 0.04, z);
      base.rotation.y = Math.PI / 4;
      scene.add(base);
    }
    for (const s of [-1, 1]) {
      const foul = patch(scene, new THREE.PlaneGeometry(0.12, 104), 0xffffff, 0.022, s * 36.8, -36.8);
      foul.rotation.z = (s * Math.PI) / 4;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 14, 8), flatMat(0xffd166));
      pole.position.set(s * FENCE * Math.SQRT1_2, 7, -FENCE * Math.SQRT1_2);
      scene.add(pole);
    }
    // Outfield wall
    const segs = 22;
    for (let i = 0; i < segs; i++) {
      const a = -Math.PI / 4 + ((i + 0.5) / segs) * (Math.PI / 2);
      const w = (FENCE * (Math.PI / 2)) / segs + 0.3;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3, 0.4), flatMat(i % 2 ? 0x2a7de1 : 0x2468bd));
      wall.position.set(Math.sin(a) * (FENCE + 0.4), 1.5, -Math.cos(a) * (FENCE + 0.4));
      wall.rotation.y = -a;
      scene.add(wall);
    }
    // Backstop
    const backstop = new THREE.Mesh(new THREE.BoxGeometry(22, 3, 0.3), flatMat(0x2468bd));
    backstop.position.set(0, 1.5, 12);
    scene.add(backstop);

    // ---- The crowd: bleachers in the outfield, stands down both lines and behind home plate ----
    // (fuller as your Skill Level grows)
    const fill = crowdFill(this.skill);
    this.crowd = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 4 + ((i + 0.5) / 10) * (Math.PI / 2);
      const R = FENCE + 6;
      this.crowd.push(addGrandstand(scene, { x: Math.sin(a) * R, z: -Math.cos(a) * R, rotY: -a, width: 17, rows: 9, color: 0xdfe8f3, fill }));
    }
    for (const side of [-1, 1]) {
      for (const d of [22, 46, 70]) {
        const ux = side * Math.SQRT1_2;
        const uz = -Math.SQRT1_2;
        const nx = side * Math.SQRT1_2;
        const nz = Math.SQRT1_2;
        this.crowd.push(addGrandstand(scene, { x: ux * d + nx * 13, z: uz * d + nz * 13, rotY: side > 0 ? -2.356 : 2.356, width: 23, rows: 8, color: 0xe6edf7, fill }));
      }
    }
    this.crowd.push(addGrandstand(scene, { x: 0, z: 15, rotY: Math.PI, width: 30, rows: 10, color: 0xe6edf7, fill }));
    for (const side of [-1, 1]) this.crowd.push(addGrandstand(scene, { x: side * 19, z: 9, rotY: Math.PI + side * 0.7, width: 14, rows: 9, fill }));
    addBanner(scene, 'SWINGYARD  PARK', { x: 0, y: 9, z: -FENCE - 18, width: 26, height: 4, bg: '#1f5fae' });

    // Strike zone outline (batter's view)
    this.zone = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.6, 0.8)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    this.zone.position.set(0, 0.85, PLATE_Z);
    scene.add(this.zone);

    const mk = (prop, color = 0xffffff) => {
      const c = createCharacter(color);
      if (prop) addProp(c, prop);
      c.group.add(blobShadow(0.4));
      scene.add(c.group);
      return c;
    };
    this.batter = mk('bat');
    this.fielders = POSITIONS.map(([, x, z]) => {
      const c = mk();
      c.home = new THREE.Vector3(x, 0, z);
      c.group.position.copy(c.home);
      c.group.rotation.y = Math.PI;
      return c;
    });
    this.pitcher = this.fielders[0];
    this.catcher = this.fielders[1];
    // In the batter's view the catcher crouches right in front of the camera: draw them see-through there.
    this.ghostCatcher = ghost(this.catcher.group, 0.25);
    this.umpire = mk(null, 0x2b3550);
    this.umpire.group.position.set(1.7, 0, CATCH_Z + 0.9); // off to the side, out of the batter's view
    this.umpire.group.rotation.y = Math.PI;
    this.runners = Array.from({ length: 4 }, () => {
      const c = mk();
      c.group.visible = false;
      return c;
    });

    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
    this.ballShadow = blobShadow(0.12, 0.3);
    scene.add(this.ballMesh, this.ballShadow);
    this.trail = makeTrail(scene, { color: 0xffffff, size: 0.06, spacing: 0.25, opacity: 0.3 });
    this.ball = new THREE.Vector3(0, 1.6, -MOUND);
    this.swingT = 9;
    this.throwT = 9;
    this._lookPlay = new THREE.Vector3(0, 1, -30);

    // Split-screen labels
    const tag = (cls) => {
      const el = document.createElement('div');
      el.className = `split-tag ${cls}`;
      this.hud.append(el);
      return el;
    };
    this.tagL = tag('left');
    this.tagR = tag('right');
    this.divider = document.createElement('div');
    this.divider.className = 'split-divider';
    this.hud.prepend(this.divider); // behind the scoreboard
  }

  // ------------------------------------------------------------- flow
  _startHalf() {
    this.outs = 0;
    this.bases = [false, false, false];
    this.line[this.batting][this.inning] = 0;
    const set = (c, team) => c.body.material.color.setHex(this.color(team));
    set(this.batter, this.batting);
    for (const f of this.fielders) set(f, this.pitching);
    for (const r of this.runners) set(r, this.batting);
    this.banner(`${this.half ? 'Bottom' : 'Top'} of inning ${this.inning + 1} — ${this.name(this.batting)} batting`, 2.2, 'small');
    this._newBatter();
  }

  _newBatter() {
    this.balls = 0;
    this.strikes = 0;
    this._ready();
  }

  _ready() {
    if (this.over) return;
    this.state = 'ready';
    this.readyT = 0;
    this.pitch = null;
    this.play = null;
    this.split = true;
    this.ball.set(this.pitcherX + 0.35, 1.2, -MOUND);
    for (const f of this.fielders) {
      f.group.position.copy(f.home);
      f.group.rotation.set(0, Math.PI, 0);
      f.armR.rotation.x = 0.1;
    }
    this.pitcher.group.position.x = this.pitcherX;
    this._placeRunners();
    this._hud();
  }

  /** Runners standing on their bases between pitches. */
  _placeRunners() {
    this.runners.forEach((r, i) => {
      const on = i < 3 && this.bases[i];
      r.group.visible = on;
      if (on) r.group.position.set(BASES[i][0] * 0.94, 0, BASES[i][1] * 0.94 + 0.6);
    });
  }

  _pitchType(source) {
    if (source === this.input.keyboard) return KB_ORDER[this.kbPitch];
    const a = source.buttons.a;
    const h = source.buttons.hold;
    return a && h ? 'screw' : a ? 'curve' : h ? 'split' : 'fast';
  }

  _hud() {
    const dots = (n, max, color) => Array.from({ length: max }, (_, i) => `<i style="background:${i < n ? color : '#d5e0f2'}"></i>`).join('');
    const cells = (t) => Array.from({ length: this.innings }, (_, i) => `<span class="cell${i === this.inning && t === this.batting ? ' hot' : ''}">${this.line[t][i] ?? ''}</span>`).join('');
    const walks = this.cfg.walks;
    this.el.top.innerHTML = `<div class="scorebox">
      ${[0, 1].map((t) => `<div class="srow"><span class="dot" style="background:${this.css(t)}"></span><span class="nm">${this.name(t)}</span>${cells(t)}<span class="cell total">${this.score[t]}</span></div>`).join('')}
      </div>
      <div class="scorebox side">
        <div class="diamond">${[1, 2, 0].map((b) => `<i class="b${b}${this.bases[b] ? ' on' : ''}"></i>`).join('')}</div>
        <div class="counts">${walks ? `<div>B <span class="dots">${dots(this.balls, 3, '#2ec4b6')}</span></div>` : ''}<div>S <span class="dots">${dots(this.strikes, 2, '#ffb020')}</span></div><div>O <span class="dots">${dots(this.outs, 2, '#ff6b4a')}</span></div></div>
      </div>`;
    const hb = this.isHuman(this.batting);
    const hp = this.isHuman(this.pitching);
    let how = 'Watch the CPU…';
    if (this.state === 'ready' || this.state === 'pitch' || this.state === 'windup') {
      const batKb = !this.hasPhone(this.batting);
      const pitKb = !this.hasPhone(this.pitching);
      const bat = batKb ? 'Batting: hold Space, release as the ball reaches the plate (↑ held = uppercut)' : 'Batting: swing as the ball crosses the plate · uppercut lifts it';
      const pit = pitKb
        ? `Pitching: ${PITCHES[KB_ORDER[this.kbPitch]].name} (Enter changes) · mouse aims · hold and release Space`
        : 'Pitching: point at the zone and swing · hold A = curve, big button = splitter, both = screwball · ◀ ▶ move';
      how = hb && hp ? `${pit}  |  ${bat}` : hb ? bat : hp ? pit : how;
    }
    this.prompt(`${this.chip(this.batting)} at bat · ${walks ? `${this.balls}–` : ''}${this.strikes} strike${this.strikes === 1 ? '' : 's'} · ${this.outs} out`, how);
    this.tagL.innerHTML = `<b>BATTING</b> ${this.chip(this.batting)}`;
    const pName = this.pitch ? this.pitch.type.name : this.hasPhone(this.pitching) || !this.isHuman(this.pitching) ? 'pick with buttons' : PITCHES[KB_ORDER[this.kbPitch]].name;
    this.tagR.innerHTML = `<b>PITCHING</b> ${this.chip(this.pitching)} <span class="dim">${pName}</span>`;
    for (const t of [0, 1]) this.status(t, t === this.batting ? 'Batting: swing!' : 'Pitching: point + swing');
  }

  onButton(source, name, down) {
    if (!down || this.over) return;
    const team = this.owner(source);
    if (team !== this.pitching || !this.isHuman(team) || this.state !== 'ready') return;
    if (name === 'a' && source === this.input.keyboard) {
      this.kbPitch = (this.kbPitch + 1) % KB_ORDER.length;
      this.sfx.move();
      this._hud();
    } else if (name === 'left' || name === 'right') {
      this.pitcherX = clamp(this.pitcherX + (name === 'left' ? -0.3 : 0.3), -0.6, 0.6);
      this.pitcher.group.position.x = this.pitcherX;
      this.sfx.move();
    }
  }

  onSwingStart(source, info) {
    const team = this.owner(source);
    if (team > 1 || !this.isHuman(team) || this.over) return;
    // The bat starts moving the instant the phone does; the pitcher locks in where they pointed.
    if (team === this.batting && this.state === 'pitch' && !this.pitch.swung) {
      this.swingT = 0;
      // The body's swing aims to reach the plate as the ball does (re-timed when the swing peaks).
      const p = this.pitch;
      this.batSwing = { at: this.time + Math.max(0.12, (1 - p.u) * p.T) };
    }
    if (team === this.pitching && this.state === 'ready') this._aimLock = { x: source.aim.x, y: source.aim.y, type: this._pitchType(source) };
  }

  onSwing(source, swing) {
    const team = this.owner(source);
    if (team > 1 || !this.isHuman(team) || this.over) return;
    if (this.state === 'ready' && team === this.pitching && this.readyT > 0.7) {
      const lock = this._aimLock || { x: source.aim.x, y: source.aim.y, type: this._pitchType(source) };
      this._aimLock = null;
      const wild = 0.05 + swing.power * 0.09;
      const locX = clamp(lock.x * 0.55, -0.7, 0.7) + rand(-wild, wild);
      const locY = clamp(0.88 + lock.y * 0.55, 0.25, 1.6) + rand(-wild, wild);
      this._throw(PITCHES[lock.type], swing.power, locX, locY, swing.twist);
    } else if (this.state === 'pitch' && team === this.batting && !this.pitch.swung) {
      const p = this.pitch;
      p.swung = true;
      if (this.swingT > 0.3) this.swingT = 0;
      this.sfx.whoosh(swing.power);
      // Seconds between the swing's peak and the ball crossing the plate (negative = early).
      const errS = -((1 - p.u) * p.T + (performance.now() - swing.tPeak) / 1000);
      const tCross = this.time + (1 - p.u) * p.T;
      if (Math.abs(errS) <= this.cfg.batWindowS && Math.abs(p.end.x) < 0.75 && p.end.y > 0.2 && p.end.y < 1.65) {
        const lift = clamp((swing.move?.y ?? 0) * 2.2, -1, 1);
        p.contact = { err: errS / this.cfg.batWindowS, power: swing.power, lift };
        // Good timing: the bat meets the ball as it crosses the plate (or right now, if just late).
        this.batSwing = { at: Math.max(this.time + 0.02, tCross), hit: true };
        if (p.u >= 1) this._contact();
      } else {
        // A miss: the swing goes through where you swung, ahead of or behind the ball.
        this.batSwing = { at: this.time + 0.06, hit: false };
      }
      const when = Math.abs(errS) < 0.03 ? 'right on time' : errS < 0 ? `${Math.round(-errS * 1000)} ms early` : `${Math.round(errS * 1000)} ms late`;
      this.last(`Swing ${when} · power ${Math.round(swing.power * 100)}%`);
    }
  }

  _throw(type, power, locX, locY, twist = 0) {
    const speed = lerp(this.cfg.pitchMinSpeed, this.cfg.pitchMaxSpeed, power) * type.speed;
    const start = new THREE.Vector3(this.pitcherX + 0.35, 1.85, -MOUND + 1.0);
    const end = new THREE.Vector3(locX, locY, PLATE_Z);
    const brk = new THREE.Vector3(type.brk[0] + twist * 0.3, type.brk[1], 0);
    this.pitch = {
      type, speed, T: start.distanceTo(end) / speed, u: 0, swung: false, contact: null, resolved: false, start, end, brk,
      strike: Math.abs(locX) <= 0.33 && locY >= 0.45 && locY <= 1.25,
    };
    this.state = 'pitch';
    this.throwT = 0;
    this.sfx.whoosh(power);
    this.vibrate(this.pitching, 30);
    if (!this.isHuman(this.batting)) {
      const p = this.pitch;
      const speedN = (speed - this.cfg.pitchMinSpeed * 0.66) / (this.cfg.pitchMaxSpeed - this.cfg.pitchMinSpeed * 0.66);
      p.aiSwing = Math.random() < (p.strike ? 0.8 : 0.25);
      const chance = this.ai.contact - 0.22 * speedN - (type === PITCHES.fast ? 0 : 0.08) - (p.strike ? 0 : 0.25) - Math.abs(twist) * 0.08;
      if (p.aiSwing && Math.random() < chance) p.contact = { err: rand(-0.75, 0.75), power: rand(0.35, 0.6 + this.difficulty * 0.2), lift: rand(-0.4, 0.8) };
    }
    this._hud();
    this.last(`${type.name} · ${Math.round(speed * 3.6)} km/h`);
  }

  _contact() {
    const p = this.pitch;
    if (p.resolved) return;
    p.resolved = true;
    // Pin the swing to this instant and to where the ball is now, so the bat is on the ball in this frame.
    if (this.batSwing) this.batSwing.at = this.time;
    this._lastCross = this.ball.clone();
    const react = this.isHuman(this.pitching) ? this.cfg.ai[1].react : this.ai.react;
    const hit = battedBall({ ...p.contact, inZone: p.strike });
    const res = fieldPlay({ hit, react, fielderSpeed: this.cfg.fielderSpeed, runnerSpeed: this.cfg.runnerSpeed, throwSpeed: this.cfg.throwSpeed, bases: this.bases, outs: this.outs });
    this.sfx.crack();
    this.vibrate(this.batting, 70);
    // Square contact crunches; a home run leaves the bat in slow motion.
    const solid = clamp((hit.speed - 20) / 25, 0, 1);
    this.feel.hitstop(30 + 60 * solid);
    this.feel.shake(0.1 + 0.35 * solid);
    if (res.kind === 'homer') {
      this.feel.slowmo(1.1, 0.35);
      this.sfx.crowdOoh(0.8);
    } else if (solid > 0.6) this.sfx.crowdOoh(0.5);
    this.hype = 1;
    this.last(`${Math.round(hit.speed * 3.6)} km/h off the bat · ${Math.round(hit.launch)}° launch`);
    this._startPlay(res);
  }

  // ------------------------------------------------------------- the play
  _startPlay(res) {
    this.state = 'play';
    this.split = false;
    const runners = [];
    const before = [...this.bases];
    const batterEnd = res.kind === 'homer' ? 4 : res.kind === 'foul' ? 0 : res.bases || 1;
    const outRunner = res.kind === 'out';
    // batter
    runners.push({ char: this.batter, from: 0, to: res.kind === 'foul' ? 0 : batterEnd, start: 0.7, speed: res.kind === 'homer' ? 5.5 : this.cfg.runnerSpeed, outAt: outRunner ? Math.min(res.endT - 0.4, res.throwT ?? res.fieldT) : null });
    // runners already on base
    for (let b = 0; b < 3; b++) {
      if (!before[b]) continue;
      let to = b + 1;
      if (res.kind === 'homer') to = 4;
      else if (res.kind === 'foul') to = b + 1;
      else if (res.kind !== 'out') to = Math.min(4, b + 1 + res.bases);
      else if (res.caught) to = res.sacFly && b === 2 ? 4 : b + 1;
      else to = b + 2;
      const outAt = res.text === 'Double play!' && b === 0 ? res.throwT : null;
      runners.push({ char: this.runners[b], from: b + 1, to: res.kind === 'foul' ? b + 1 : to, start: res.caught ? res.fieldT : 0.3, speed: res.kind === 'homer' ? 5.5 : this.cfg.runnerSpeed, outAt });
    }
    this.play = { res, t: 0, runners, done: false };
    this.batter.group.visible = true;
  }

  _ballAt(t) {
    const { res } = this.play;
    const air = res.air;
    const lastAir = air[air.length - 1];
    if (t <= lastAir.t || (!res.ground.length && !res.caught && res.fielder < 0)) {
      const f = Math.min(air.length - 1, t / 0.02);
      const i = Math.floor(f);
      const a = air[i];
      const b = air[Math.min(air.length - 1, i + 1)];
      return this.ball.set(lerp(a.x, b.x, f - i), lerp(a.y, b.y, f - i), lerp(a.z, b.z, f - i));
    }
    if (res.ground.length && t <= res.fieldT) {
      const g = res.ground;
      const f = clamp((t - g[0].t) / 0.02, 0, g.length - 1);
      const i = Math.floor(f);
      const a = g[i];
      const b = g[Math.min(g.length - 1, i + 1)];
      return this.ball.set(lerp(a.x, b.x, f - i), 0.07, lerp(a.z, b.z, f - i));
    }
    const fl = this.fielders[res.fielder];
    if (res.throwTo === null || res.throwT === null) return this.ball.set(fl.group.position.x, 1.2, fl.group.position.z);
    const deep = Math.hypot(res.fieldAt.x, res.fieldAt.z) > 45;
    const releaseT = res.fieldT + (deep ? 1.0 : 0.45);
    if (t < releaseT) return this.ball.set(fl.group.position.x, 1.3, fl.group.position.z);
    const u = clamp((t - releaseT) / Math.max(0.1, res.throwT - releaseT), 0, 1);
    const tgt = BASES[res.throwTo];
    const d = Math.hypot(tgt[0] - res.fieldAt.x, tgt[1] - res.fieldAt.z);
    return this.ball.set(lerp(res.fieldAt.x, tgt[0], u), 1.5 + Math.sin(Math.PI * u) * d * 0.06, lerp(res.fieldAt.z, tgt[1], u));
  }

  /** Position along the base path after running `s` metres from base `from` (0 = home). */
  _pathPos(from, to, s, out) {
    let left = s;
    for (let b = from; b < to; b++) {
      const a = BASE_RING[b];
      const c = BASE_RING[b + 1];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (left <= L) return out.set(lerp(a[0], c[0], left / L), 0, lerp(a[1], c[1], left / L));
      left -= L;
    }
    const e = BASE_RING[to];
    return out.set(e[0], 0, e[1]);
  }

  _updatePlay(dt) {
    const pl = this.play;
    pl.t += dt;
    const t = pl.t;
    const res = pl.res;
    this._ballAt(t);
    // Fielders: the one making the play runs to the ball, everyone else turns to watch it.
    this.fielders.forEach((f, i) => {
      const g = f.group;
      if (i === res.fielder) {
        const tgt = new THREE.Vector3(res.fieldAt.x, 0, res.fieldAt.z);
        const go = clamp((t - (this.isHuman(this.pitching) ? this.cfg.ai[1].react : this.ai.react)) * this.cfg.fielderSpeed, 0, f.home.distanceTo(tgt));
        const dir = tgt.clone().sub(f.home);
        const len = dir.length() || 1;
        g.position.copy(f.home).addScaledVector(dir, go / len);
        if (t > res.fieldT && res.throwTo !== null) g.lookAt(BASES[res.throwTo][0], 0, BASES[res.throwTo][1]);
        else g.lookAt(this.ball.x, 0, this.ball.z);
        g.rotateY(Math.PI);
        f.armR.rotation.x = t > res.fieldT ? (res.throwTo !== null && t < res.throwT ? lerp(-2.4, 1.6, clamp((t - res.fieldT) / 0.5, 0, 1)) : 1.2) : 0.3;
      } else {
        g.lookAt(this.ball.x, 0, this.ball.z);
        g.rotateY(Math.PI);
      }
      g.position.y = Math.abs(Math.sin(t * 10 + i)) * (i === res.fielder && t < res.fieldT ? 0.08 : 0);
    });
    // Runners
    for (const r of pl.runners) {
      const g = r.char.group;
      if (r.outAt !== null && t > r.outAt + 0.3) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      const s = Math.max(0, t - r.start) * r.speed;
      this._pathPos(r.from, r.to, s, g.position);
      const total = (r.to - r.from) * 27.43;
      if (s < total) {
        const ahead = this._pathPos(r.from, r.to, s + 0.5, new THREE.Vector3());
        g.lookAt(ahead.x, 0, ahead.z);
        g.rotateY(Math.PI);
        g.position.y = Math.abs(Math.sin(t * 12)) * 0.08;
      }
      if (r.to >= 4 && s >= total) g.visible = false; // scored
    }
    if (t > res.endT + 0.5 && !pl.done) {
      pl.done = true;
      this._resolvePlay(res);
    }
  }

  _resolvePlay(res) {
    const walkOff = () => this.half === 1 && this.inning === this.innings - 1 && this.score[1] > this.score[0];
    if (res.kind === 'foul') {
      if (this.strikes < 2) this.strikes++;
      return this._call('Foul ball', () => this._ready());
    }
    if (res.kind === 'out') {
      const outsBefore = this.outs;
      this.outs += res.outsMade;
      let runs = 0;
      if (this.outs < 3) {
        if (res.text === 'Double play!') {
          runs = this.bases[2] ? 1 : 0;
          this.bases = [false, false, this.bases[1]];
        } else if (res.caught) {
          if (res.sacFly) {
            runs = 1;
            this.bases[2] = false;
          }
        } else {
          runs = this.bases[2] ? 1 : 0;
          this.bases = [false, this.bases[0], this.bases[1]];
        }
      }
      this._runs(runs);
      this.sfx.miss();
      void outsBefore;
      if (this.outs >= 3) return this._call(`${res.text} · three outs`, () => this._nextHalf());
      if (this._mercy() || walkOff()) return this._call(res.text, () => this._end());
      return this._call(runs ? `${res.text} · a run scores` : res.text, () => this._newBatter());
    }
    const adv = advance(this.bases, res.bases);
    this.bases = adv.bases;
    this._runs(adv.runs);
    if (res.kind === 'homer') {
      this.sfx.strike();
      this.sfx.crowdCheer(1);
      this.sfx.sparkle(2);
      this.feel.celebrate('HOME RUN!', { color: this.css(this.batting), size: 'huge', confetti: this.isHuman(this.batting) ? 110 : 0 });
      charReact(this.batter, 'cheer', 2);
      charReact(this.pitcher, 'sad', 2);
    } else {
      this.sfx.good();
      this.sfx.crowdCheer(adv.runs ? 0.7 : 0.45);
      charReact(this.batter, 'pump');
    }
    this.hype = 1.6;
    const text = adv.runs ? `${res.text} ${adv.runs} run${adv.runs > 1 ? 's' : ''} score${adv.runs > 1 ? '' : 's'}` : res.text;
    this._call(text, () => (walkOff() || this._mercy() ? this._end() : this._newBatter()), res.kind === 'homer' ? 'big' : '');
  }

  _mercy() {
    return Math.abs(this.score[0] - this.score[1]) >= this.cfg.mercyRuns;
  }

  _call(text, fn, cls = 'small') {
    this.state = 'call';
    this.banner(text, 1.5, cls);
    this.after(1.7, fn);
  }

  _noContact() {
    const p = this.pitch;
    p.resolved = true;
    if (p.swung || p.aiSwing) return this._strike('Strike — swing and a miss');
    if (p.strike) return this._strike('Strike!');
    if (!this.cfg.walks) return this._call('Ball', () => this._ready());
    this.balls++;
    if (this.balls >= 4) {
      const w = walk(this.bases);
      this.bases = w.bases;
      this._runs(w.runs);
      return this._call('Ball four — take your base', () => this._newBatter());
    }
    this._call('Ball', () => this._ready());
  }

  _strike(text) {
    this.strikes++;
    if (this.strikes >= 3) {
      this.sfx.denied();
      this.feel.celebrate('STRIKE OUT!', { color: this.css(this.pitching), size: 'mid', seconds: 1.5 });
      if (this.isHuman(this.pitching)) this.sfx.crowdCheer(0.6);
      else this.sfx.crowdGroan(0.6);
      charReact(this.batter, 'sad');
      charReact(this.pitcher, 'pump');
      this.outs++;
      if (this.outs >= 3) return this._call('Strike three — three outs', () => this._nextHalf());
      return this._call('Strike three — out!', () => this._newBatter());
    }
    this._call(text, () => this._ready());
  }

  _runs(n) {
    if (!n) return;
    this.score[this.batting] += n;
    this.line[this.batting][this.inning] += n;
    this.sfx.cheer();
    this.hype = 1.8;
    this.vibrate(this.batting, [60, 40, 120]);
  }

  _nextHalf() {
    if (this._mercy()) return this._end();
    if (this.half === 0) {
      this.half = 1;
      if (this.inning === this.innings - 1 && this.score[1] > this.score[0]) return this._end();
    } else {
      this.half = 0;
      this.inning++;
      if (this.inning >= this.innings) return this._end();
    }
    this._startHalf();
  }

  _end() {
    this.inning = Math.min(this.inning, this.innings - 1);
    this._hud();
    const tie = this.score[0] === this.score[1];
    const order = this.score[1] > this.score[0] ? [1, 0] : [0, 1];
    const mercy = this._mercy() ? ' (mercy rule)' : '';
    this.finish(
      order.map((t) => ({ name: this.name(t), css: this.css(t), score: this.score[t] })),
      { unit: 'runs', title: tie ? "It's a tie!" : `${this.name(order[0])} wins${mercy}!`, skill: this.versus(tie ? null : order[0], clamp(Math.abs(this.score[0] - this.score[1]) / 6, 0, 1)) },
    );
  }

  // ----------------------------------------------------------- update
  update(dt) {
    this.tick(dt);
    this.swingT += dt;
    this.throwT += dt;
    this.hype = Math.max(0.35, this.hype - dt * 0.5);
    for (const c of this.crowd) c.update(this.time, this.hype);

    if (this.state === 'ready') {
      this.readyT += dt;
      if (!this.isHuman(this.pitching) && this.readyT > 1.2) {
        this.state = 'windup';
        this.windT = 0;
      }
    } else if (this.state === 'windup') {
      this.windT += dt;
      if (this.windT >= this.cfg.windupS) {
        const r = Math.random();
        const type = r < 0.5 ? PITCHES.fast : r < 0.7 ? PITCHES.curve : r < 0.85 ? PITCHES.split : PITCHES.screw;
        const strike = Math.random() < 0.7;
        this._throw(type, clamp(this.ai.pitch + rand(-0.15, 0.15), 0, 1), strike ? rand(-0.28, 0.28) : (Math.random() < 0.5 ? -1 : 1) * rand(0.42, 0.65), strike ? rand(0.55, 1.15) : rand(0.4, 1.5), rand(-0.3, 0.3));
      }
    } else if (this.state === 'pitch') {
      const p = this.pitch;
      p.u += dt / p.T;
      const u = p.u;
      if (u <= 1) this.ball.copy(p.start).lerp(p.end.clone().sub(p.brk), u).addScaledVector(p.brk, u * u);
      else this.ball.set(p.end.x * 0.6, lerp(p.end.y, 0.8, clamp((u - 1) * 3, 0, 1)), lerp(PLATE_Z, CATCH_Z, clamp((u - 1) * p.T / 0.12, 0, 1)));
      if (!p.resolved && p.aiSwing && u > 1 - 0.2 / p.T && this.swingT > 1) {
        this.swingT = 0;
        // The CPU swings so the bat arrives with the ball (a hit) or just off it (a miss).
        this.batSwing = { at: this.time + (1 - u) * p.T + (p.contact ? 0 : rand(-0.09, 0.09)), hit: !!p.contact };
      }
      if (u >= 1 && !p.resolved) {
        if (p.contact) this._contact();
        else if (u >= 1 + 0.25 / p.T) {
          this.sfx.thunk(); // into the catcher's mitt
          this._noContact();
        }
      }
    } else if (this.state === 'play' || (this.state === 'call' && this.play)) {
      if (this.play) this._updatePlay(dt);
    }

    // ---- poses ----
    this.ballMesh.position.copy(this.ball);
    this.ballShadow.position.set(this.ball.x, 0.03, this.ball.z);
    if (this.state === 'pitch' || (this.state === 'play' && this.ball.y > 0.3)) this.trail.push(this.ball.x, this.ball.y, this.ball.z);
    else this.trail.fade();
    const inPlay = this.state === 'play' || (this.state === 'call' && this.play);
    // The swing follows through from the batter's box for a moment before they set off for first.
    if (!inPlay || (this.play && this.play.t < 0.55)) this._batPose(dt);
    else {
      // Running the bases: drop the batting stance.
      this.batter.rig.rotation.y = 0;
      this.batter.armR.scale.y = 1;
      this.batter.armL.scale.y = 1;
    }
    const pa = this.pitcher.armR;
    if (this.state === 'windup') {
      const w = this.windT / this.cfg.windupS;
      this.pitcher.group.rotation.y = Math.PI + Math.sin(w * Math.PI) * 0.9;
      pa.rotation.x = lerp(0.2, -2.6, w);
    } else if (!inPlay) {
      this.pitcher.group.rotation.y = Math.PI;
      pa.rotation.x = this.throwT < 0.25 ? lerp(-2.6, 1.6, this.throwT / 0.25) : this.state === 'ready' ? lerp(pa.rotation.x, -0.4, ease(dt, 6)) : 0.3;
    }
    this.catcher.group.position.set(0, -0.32, CATCH_Z);
    this.catcher.group.rotation.y = Math.PI * 2;
    this.catcher.armR.rotation.x = 1.4;
    this.zone.visible = this.split;

    // ---- cameras ----
    // Behind the catcher, over their head, shifted toward the batter and aimed between batter and mound,
    // so the whole batter (and their swing) is in the half-screen along with the pitch on its way.
    this.camBat.position.set(0.05, 2.05, 4.5);
    this.camBat.lookAt(-0.45, 1.0, -MOUND);
    this.camPitch.position.set(this.pitcherX + 1.0, 2.4, -MOUND - 4.8);
    this.camPitch.lookAt(0, 0.9, 0);
    if (inPlay) {
      const res = this.play.res;
      const cam = this.camPlay;
      let want;
      let look;
      if (res.fielder >= 0) {
        // Third person behind the fielder making the play, looking at the ball.
        const f = this.fielders[res.fielder].group.position;
        const away = (this._camAway ||= new THREE.Vector3()).set(f.x - this.ball.x, 0, f.z - this.ball.z);
        if (away.lengthSq() < 4) away.set(f.x, 0, f.z);
        away.normalize();
        want = (this._camWant ||= new THREE.Vector3()).set(f.x + away.x * 7, 3.6, f.z + away.z * 7);
        look = (this._camLook ||= new THREE.Vector3()).set(lerp(f.x, this.ball.x, 0.5), Math.max(1, this.ball.y * 0.6), lerp(f.z, this.ball.z, 0.5));
      } else {
        want = (this._camWant ||= new THREE.Vector3()).set(this.ball.x * 0.4, 14 + this.ball.y * 0.4, 22 + this.ball.z * 0.15);
        look = this.ball;
      }
      const k = ease(dt, 3);
      if (this.play.t < dt * 1.5) cam.position.copy(want);
      cam.position.lerp(want, k);
      this._lookPlay.lerp(look, ease(dt, 6));
      cam.lookAt(this._lookPlay);
    }
    // Shadows follow the action: the infield between pitches, the ball while it is in play.
    if (this.split) followSun(this.sun, 0, -9);
    else followSun(this.sun, this.ball.x, this.ball.z);
    this.tagL.classList.toggle('hidden', !this.split);
    this.tagR.classList.toggle('hidden', !this.split);
    this.divider.classList.toggle('hidden', !this.split);
  }

  /**
   * The batter. With a phone (3D orientation) the bat follows it 1:1, and in the last instant before the
   * plate an assist swings it onto the ball so a hit is the bat really meeting the ball. Otherwise (CPU,
   * keyboard) a stroke is animated so the bat's sweet spot reaches the ball exactly as it crosses the plate:
   * stance → load → accelerating swing → follow-through wrapping round → back to the stance.
   * Two hands on the bat: the left arm always reaches for the right hand.
   */
  _batPose(dt) {
    const ch = this.batter;
    ch.group.position.set(BATTER_X, 0, BATTER_Z);
    ch.group.rotation.y = -Math.PI / 2; // facing the plate (+x); the pitcher is on their left
    const p = this.state === 'pitch' ? this.pitch : null;
    // Right shoulder in the world (the batter's right is toward the catcher, +z).
    _bs.set(BATTER_X, 0.95, BATTER_Z + 0.31);
    // Where bat and ball meet: the plate crossing, or the middle of the zone between pitches.
    if (p) this._lastCross = p.end;
    _bc.copy(p ? p.end : this._lastCross || _bz.set(0, 0.85, PLATE_Z)).sub(_bs);
    const dist = _bc.length();
    _bc.normalize();
    const tCross = p ? this.time + (1 - p.u) * p.T : Infinity;
    const pose = this.isHuman(this.batting) ? this.pose(this.batting) : null;
    let reach = 1;
    let rate = 40;
    let turn = 0;
    if (pose && pose.real) {
      // 1:1: the phone is the bat (TV frame = world frame here: the screen is toward the pitcher).
      const pt = pose.basis.point;
      _bd.set(pt.x, pt.y, pt.z);
      if (p && !p.resolved) {
        const tt = tCross - this.time;
        const hot = p.contact ? 1 : this.swingT < 0.35 ? 0.55 : 0;
        const w = hot * smoothstep(1 - Math.abs(tt) / 0.12);
        if (w > 0) {
          _bd.lerp(_bc, w).normalize();
          reach = lerp(1, clamp(dist / BAT_REACH, 0.7, 1.3), w);
        }
      }
      rate = 60;
      // Hips follow the bat round.
      turn = clamp(Math.atan2(_bd.z, _bd.x) - Math.atan2(_bc.z, _bc.x), -1.2, 1.2) * -0.3;
    } else {
      const sw = this.batSwing;
      const u = sw ? this.time - sw.at : 9;
      let alpha = null; // swing angle around the body: -2 loaded, 0 at the ball, +1.8 wrapped round
      let up = 0;
      let blend = 1;
      if (u < -0.15) alpha = null;
      else if (u < 0) {
        const k = (u + 0.15) / 0.15;
        alpha = -2.0 * (1 - k * k);
        up = 0.7 * (1 - k) * (1 - k);
        reach = lerp(1, clamp(dist / BAT_REACH, 0.7, 1.3), k);
      } else if (u < 0.3) {
        const k = u / 0.3;
        alpha = 1.8 * (1 - (1 - k) * (1 - k));
        up = 0.5 * k;
        reach = lerp(clamp(dist / BAT_REACH, 0.7, 1.3), 1, k);
      } else if (u < 0.85) {
        alpha = 1.8;
        up = 0.5;
        blend = smoothstep(1 - (u - 0.45) / 0.4);
      }
      if (alpha === null) _bd.copy(STANCE);
      else {
        _bd.copy(_bc).applyAxisAngle(UP, alpha);
        _bd.y += up;
        _bd.normalize();
        if (blend < 1) _bd.lerp(STANCE, 1 - blend).normalize();
        turn = -alpha * 0.28 * blend;
      }
    }
    // Torso turn, then the arm in the batter's own frame (world -> local for a body turned -90 degrees,
    // then undo the torso turn, since the arms ride on it).
    ch.rig.rotation.y = lerp(ch.rig.rotation.y, turn, ease(dt, 18));
    _bl.set(_bd.z, _bd.y, -_bd.x).applyAxisAngle(UP, -ch.rig.rotation.y);
    _bq.setFromUnitVectors(DOWN, _bl);
    ch.armR.quaternion.slerp(_bq, ease(dt, rate));
    ch.armR.scale.y = lerp(ch.armR.scale.y, reach, ease(dt, 20));
    // Left hand on the bat, just above the right: reach the left arm to where the right hand is.
    _bh.set(0, -0.44 * ch.armR.scale.y, 0).applyQuaternion(ch.armR.quaternion).add(R_SHOULDER);
    _bh.sub(L_SHOULDER);
    const lLen = _bh.length() || 1;
    ch.armL.quaternion.setFromUnitVectors(DOWN, _bh.multiplyScalar(1 / lLen));
    ch.armL.scale.y = clamp(lLen / 0.44, 0.5, 1.6);
  }

  render(renderer, W, H) {
    if (this.split) {
      renderViews(renderer, this.scene, W, H, [
        { camera: this.camBat, x: 0, y: 0, w: 0.5, h: 1, before: () => this.ghostCatcher(true) },
        { camera: this.camPitch, x: 0.5, y: 0, w: 0.5, h: 1, before: () => this.ghostCatcher(false) },
      ]);
    } else {
      renderViews(renderer, this.scene, W, H, [{ camera: this.camPlay, x: 0, y: 0, w: 1, h: 1 }]);
    }
  }
}
