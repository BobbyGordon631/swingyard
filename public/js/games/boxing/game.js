// Boxing. The camera sits behind your (see-through) boxer. Punch the way you would:
//   straight  - punch forward (left or right hand from which side you punch on)
//   hook      - swing across (a sweep to the left is a right hook)
//   uppercut  - punch upward
//   body blow - any punch with the phone pointed low
// Defend: hold the phone upright in front of your face (or hold the big button) = high guard,
// guard with the phone pointed down = low guard, lean the phone left/right to slip, point it
// down without punching to duck (an uppercut catches a ducking boxer).
// Knockdowns get a ten count: punch (swing) to get back up. Three knockdowns in a round is a TKO.
// Three rounds, then the judges decide.
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { createCharacter, addProp, react } from '../../characters.js';
import { BaseGame, softShadows, addGrandstand, addBanner, renderViews, ghost, envMap, crowdFill, lerp, clamp, rand } from '../common.js';

const D2R = Math.PI / 180;
const TYPES = ['jab', 'straight', 'hook', 'uppercut'];

export class BoxingGame extends BaseGame {
  constructor(o) {
    super(o, 'Boxing');
    this.cfg = CONFIG.boxing;
    this.ai = this.cfg.ai[this.difficulty];
    this.round = 1;
    this.clock = this.cfg.roundSeconds;
    this.phase = 'fight'; // fight | down | break | over
    this._build();
    this.banner('Round 1 — Fight!', 1.6, 'big');
    this.sfx.bell();
    this._hud();
  }

  _build() {
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x1d2742);
    scene.fog = new THREE.Fog(0x1d2742, 24, 60);
    scene.environment = envMap();
    scene.environmentIntensity = 0.35;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x41506e, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 12, 4);
    softShadows(key, 6);
    scene.add(key);
    const smooth = (color, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });

    const hall = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), smooth(0x2a3552, 0.95));
    hall.rotation.x = -Math.PI / 2;
    hall.position.y = -0.9;
    hall.receiveShadow = true;
    scene.add(hall);
    // Ring
    const apron = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.9, 7.6), smooth(0xffffff));
    apron.position.y = -0.45;
    apron.receiveShadow = true;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(7.7, 0.6, 7.7), smooth(0x2a7de1));
    skirt.position.y = -0.55;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = '#eef3f7';
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = '#c9dbe7';
    g.lineWidth = 22;
    g.beginPath();
    g.arc(256, 256, 190, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#d7e6ef';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 46 : 110;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(256 + Math.cos(a) * r, 256 + Math.sin(a) * r);
    }
    g.fill();
    const emblem = new THREE.CanvasTexture(cv);
    emblem.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshStandardMaterial({ map: emblem, roughness: 0.8 }));
    mat.rotation.x = -Math.PI / 2;
    mat.position.y = 0.01;
    mat.receiveShadow = true;
    scene.add(apron, skirt, mat);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.7, 14), smooth(0xf4f7fb, 0.4));
      post.position.set(sx * 3.4, 0.85, sz * 3.4);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.0, 0.34), smooth(sx * sz > 0 ? 0xe63946 : 0x2a7de1, 0.5));
      pad.position.set(sx * 3.32, 1.0, sz * 3.32);
      pad.rotation.y = Math.PI / 4;
      scene.add(post, pad);
    }
    const ropeColors = [0x2a7de1, 0xffffff, 0xe63946];
    for (let h = 0; h < 3; h++) {
      for (const [x, z, rot] of [[0, -3.4, 0], [0, 3.4, 0], [-3.4, 0, 1], [3.4, 0, 1]]) {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6.8, 8), smooth(ropeColors[h], 0.5));
        rope.position.set(x, 0.55 + h * 0.4, z);
        rope.rotation.z = Math.PI / 2;
        rope.rotation.y = (rot * Math.PI) / 2;
        scene.add(rope);
      }
    }
    // Overhead lights
    for (const x of [-2, 2]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 1.4), new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
      lamp.position.set(x, 7, 0);
      scene.add(lamp);
    }
    const fill = crowdFill(this.skill); // the arena fills up as your Skill Level grows
    this.crowd = [
      addGrandstand(scene, { x: 0, z: -6.6, rotY: 0, width: 22, rows: 9, base: -0.9, color: 0x3a4766, fill }),
      addGrandstand(scene, { x: 0, z: 6.6, rotY: Math.PI, width: 22, rows: 9, base: -0.9, color: 0x3a4766, fill }),
      addGrandstand(scene, { x: -6.6, z: 0, rotY: Math.PI / 2, width: 18, rows: 9, base: -0.9, color: 0x3a4766, fill }),
      addGrandstand(scene, { x: 6.6, z: 0, rotY: -Math.PI / 2, width: 18, rows: 9, base: -0.9, color: 0x3a4766, fill }),
    ];
    this.hype = 0.4;
    addBanner(scene, 'SWINGYARD  BOXING', { x: 0, y: 6, z: -14, width: 12, height: 1.6, bg: '#ff6b4a' });
    addBanner(scene, 'SWINGYARD  BOXING', { x: 0, y: 6, z: 14, rotY: Math.PI, width: 12, height: 1.6, bg: '#2a7de1' });

    this.f = [0, 1].map((i) => {
      const char = createCharacter(this.color(i));
      addProp(char, 'gloves', i === 0 ? 0xe63946 : 0x1d6fd6);
      scene.add(char.group);
      const setGhost = ghost(char.group, 0.3);
      return {
        i, sign: i === 0 ? 1 : -1, hp: 100, char, setGhost,
        lean: 0, duck: 0, guard: null, act: null, stun: 0, cool: 0, flash: 0, hand: 0,
        down: false, kdRound: 0, kdTotal: 0, dealt: 0, mash: 0,
        think: 1.5, dodgeT: 0, dodgeDir: 0, duckT: 0, guardT: 0, guardKind: 'high', recoil: 0,
      };
    });
    this.ref = createCharacter(0x2b3550);
    this.ref.group.position.set(2.4, 0, -2.4); // in the background, out of the way of the camera
    this.ref.group.rotation.y = -Math.PI / 2;
    scene.add(this.ref.group);
    this.cams = [0, 1].map(() => new THREE.PerspectiveCamera(55, 1, 0.05, 200));
    this.camera = this.cams[0];
  }

  _hud() {
    const pips = (n) => Array.from({ length: 3 }, (_, k) => `<i style="background:${k < n ? '#ff6b4a' : '#d5e0f2'}"></i>`).join('');
    const bar = (f) => `<div class="hp"><span class="nm">${this.name(f.i)} <span class="dots">${pips(f.kdRound)}</span></span><div class="bar"><i style="width:${Math.max(0, f.hp)}%;background:${this.css(f.i)}"></i></div></div>`;
    this.el.top.innerHTML = `<div class="scorebox wide">${bar(this.f[0])}<div class="clock">${this.phase === 'break' ? '—' : Math.ceil(Math.max(0, this.clock))}<small style="display:block;font-size:11px;color:var(--dim)">R${this.round}/${this.cfg.rounds}</small></div>${bar(this.f[1])}</div>`;
    if (!this._prompted) {
      this._prompted = true;
      const kb = !this.hasPhone(this.owner(this.input.keyboard) === 0 ? 0 : 1) || (this.playerCount === 1 && !this.hasPhone(0));
      this.prompt(
        `${this.chip(0)} vs ${this.chip(1)}`,
        kb
          ? 'Enter: jab · release Space to punch (hold ← → = hook, ↑ = uppercut, ↓ = body) · hold Space = guard · ← → lean · ↓ duck'
          : 'Punch forward = straight · across = hook · upward = uppercut · point low = body blow · phone upright or HOLD = guard · lean to slip · point down to duck',
      );
      for (const i of [0, 1]) this.status(i, 'Punch! Upright = guard, lean = slip');
    }
  }

  _say(text) {
    this.el.center.textContent = text;
    this.el.center.className = 'center pulse';
    void this.el.center.offsetWidth;
    this.el.center.className = 'center pulse show';
  }

  // ------------------------------------------------------------ input
  _canPunch(f) {
    return this.phase === 'fight' && !f.act && f.stun <= 0 && f.cool <= 0 && !f.down && f.recoil <= 0;
  }

  _punch(f, type, power, target, hand, windup) {
    if (!this._canPunch(f)) return false;
    f.hand = hand ?? 1 - f.hand;
    f.act = { type, power, target, t: 0, windup, travel: type === 'jab' ? 0.1 : type === 'hook' ? 0.17 : 0.14, hit: false };
    return true;
  }

  onSwing(source, swing) {
    const i = this.owner(source);
    if (i > 1 || !this.isHuman(i)) return;
    const f = this.f[i];
    if (f.down) {
      // Punching the air to get back up before the count reaches ten.
      f.mash++;
      this.vibrate(i, 30);
      return;
    }
    if (source.buttons.hold && source !== this.input.keyboard) return; // gloves up
    const m = swing.move || { x: 0, y: 0, z: -1 };
    const fwd = -m.z;
    let type = 'straight';
    let hand = Math.abs(m.x) > 0.25 ? (m.x > 0 ? 1 : 0) : undefined; // 0 = left, 1 = right
    if (m.y > 0.55 && m.y > fwd) type = 'uppercut';
    else if (Math.abs(m.x) > 0.6 && Math.abs(m.x) > fwd * 0.9) {
      type = 'hook';
      hand = m.x < 0 ? 1 : 0; // sweeping left = right hook
    }
    const kb = source === this.input.keyboard;
    const low = kb ? m.y < -0.5 : swing.pose.pitch < this.cfg.bodyPitch * D2R;
    if (low && type !== 'uppercut') type = type === 'hook' ? 'hook' : 'straight';
    if (this._punch(f, type, swing.power, low ? 'body' : 'head', hand, 0.04)) this._aiReact(1 - i, type, low ? 'body' : 'head');
  }

  onButton(source, name, down) {
    const i = this.owner(source);
    if (i > 1 || !this.isHuman(i) || name !== 'a' || !down) return;
    if (this._punch(this.f[i], 'jab', this.cfg.buttonJabPower, 'head', 0, 0.03)) this._aiReact(1 - i, 'jab', 'head');
  }

  _aiReact(i, type, target) {
    const f = this.f[i];
    if (this.isHuman(i) || f.act || f.stun > 0 || f.down || Math.random() > this.ai.defend) return;
    const r = Math.random();
    if (target === 'body') {
      if (r < 0.6) {
        f.guardT = 0.6;
        f.guardKind = 'low';
      } else {
        f.dodgeT = 0.5;
        f.dodgeDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else if (type === 'hook') {
      if (r < 0.5) f.duckT = 0.55;
      else {
        f.guardT = 0.6;
        f.guardKind = 'high';
      }
    } else if (type === 'uppercut') {
      f.dodgeT = 0.5;
      f.dodgeDir = Math.random() < 0.5 ? -1 : 1;
    } else if (r < 0.5) {
      f.dodgeT = 0.5;
      f.dodgeDir = Math.random() < 0.5 ? -1 : 1;
    } else {
      f.guardT = 0.6;
      f.guardKind = 'high';
    }
  }

  // ------------------------------------------------------------ hits
  _land(att) {
    const def = this.f[1 - att.i];
    const a = att.act;
    const c = this.cfg;
    if (def.down) return;
    let dmg = c.damage[a.type] * (1 + 1.2 * a.power) * (a.target === 'body' ? c.bodyFactor : 1);
    // Slips and ducks
    const leaning = Math.abs(def.lean) > 0.55;
    const ducking = def.duck > 0.6;
    if (a.target === 'head') {
      if (ducking && a.type !== 'uppercut') return this._miss(att, 'Ducked!');
      if (leaning && a.type !== 'hook') return this._miss(att, 'Slipped!');
      if (leaning && a.type === 'hook') {
        // A hook from the attacker's right comes in on the defender's left: leaning right avoids it.
        const from = a.hand === 1 ? -1 : 1; // side of the defender it arrives on (defender's view)
        if (Math.sign(def.lean) === -from) return this._miss(att, 'Slipped!');
        dmg *= 1.3; // leaned into it
      }
      if (ducking && a.type === 'uppercut') dmg *= 1.4;
    } else if (leaning) return this._miss(att, 'Slipped!');
    // Guards
    const blocked = def.guard && ((def.guard === 'high' && a.target === 'head' && a.type !== 'uppercut') || (def.guard === 'low' && a.target === 'body'));
    if (blocked) {
      dmg *= 0.12;
      att.recoil = 0.3; // punching into gloves knocks you back a touch
      this.sfx.thud();
      this._say('Blocked');
      this.vibrate(att.i, 30);
    } else {
      if (def.guard === 'high' && a.type === 'uppercut') dmg *= 0.6; // splits the gloves
      if (def.act && !def.act.hit) {
        dmg *= 1.5;
        def.act = null;
        this._say('Counter!');
      } else this._say(a.type === 'uppercut' ? 'Uppercut!' : a.type === 'hook' ? 'Hook!' : a.target === 'body' ? 'Body!' : '');
      def.stun = a.type === 'uppercut' ? 0.5 : 0.3;
      def.flash = 0.2;
      def.snap = 0.25;
      // The crunch of a clean punch: freeze a few frames, jolt the camera, the crowd reacts.
      const heavy = clamp(a.power + (a.type === 'uppercut' || a.type === 'hook' ? 0.25 : 0), 0, 1);
      this.feel.hitstop(35 + 55 * heavy);
      this.feel.shake(0.12 + 0.4 * heavy);
      react(def.char, 'hit');
      if (heavy > 0.65) this.sfx.crowdOoh(heavy * 0.7);
      this.sfx.punch(a.power);
      this.hype = 1.6;
      this.vibrate(def.i, a.type === 'uppercut' ? [60, 30, 90] : 80);
      this.vibrate(att.i, 40);
    }
    def.hp -= dmg;
    att.dealt += dmg;
    this._hud();
    if (def.hp <= 0) this._knockdown(def, att);
  }

  _miss(att, text) {
    att.cool = 0.35; // a whiff leaves you open
    this.sfx.whoosh(0.3);
    this._say(text);
  }

  _knockdown(def, att) {
    def.hp = 0;
    def.down = true;
    def.act = null;
    def.kdRound++;
    def.kdTotal++;
    def.mash = 0;
    def.fall = 0;
    this.phase = 'down';
    this.count = 0;
    this.countT = 0;
    this.hype = 2;
    this.sfx.cheer();
    this.sfx.crowdCheer(1);
    // Knockdowns happen in slow motion with a white flash, like a broadcast replay.
    this.feel.slowmo(1.3, 0.25);
    this.feel.flash(0.5);
    this.feel.shake(0.7);
    this.feel.celebrate('DOWN!', { color: '#ff6b4a', size: 'huge', seconds: 1.6 });
    react(att.char, 'cheer');
    this._hud();
    if (def.kdRound >= 3) {
      this.after(1.6, () => this._end(att.i, 'TKO'));
      this.phase = 'over';
      return;
    }
    const need = this.cfg.getUpMashes[Math.min(2, def.kdTotal - 1)];
    def.need = need;
    if (!this.isHuman(def.i)) def.cpuUpAt = Math.random() < this.ai.getUp ** def.kdTotal ? Math.floor(rand(3, 8)) : 99;
    else this.status(def.i, `Get up! Swing ${need} times`);
  }

  _getUp(f) {
    f.down = false;
    f.hp = [55, 40, 25][Math.min(2, f.kdTotal - 1)];
    f.stun = 0.6;
    this.phase = 'fight';
    this.el.center.textContent = '';
    this.banner('Fight!', 1, 'small');
    this.sfx.bell();
    this._hud();
  }

  _end(winner, how) {
    if (this._ending) return;
    this._ending = true;
    this.phase = 'over';
    this.sfx.bell();
    const loser = 1 - winner;
    const title = how === 'draw' ? 'Draw!' : `${this.name(winner)} wins by ${how === 'KO' ? 'knockout' : how === 'TKO' ? 'TKO' : 'decision'}!`;
    if (how === 'KO' || how === 'TKO') {
      this.feel.celebrate(how === 'KO' ? 'K.O.!' : 'T.K.O.!', { color: this.css(winner), size: 'huge', confetti: this.isHuman(winner) ? 100 : 0, sub: `${this.name(winner)} wins` });
      this.sfx.crowdCheer(1);
    } else {
      this.banner(how === 'draw' ? 'DRAW' : 'Decision', 2.2, 'big');
      this.sfx.applause(0.8);
    }
    if (how !== 'draw') {
      react(this.f[winner].char, 'cheer', 2.4);
      if (!this.f[loser].down) react(this.f[loser].char, 'sad', 2.4);
    }
    // Skill margin: a stoppage is a clear win; on points, how lopsided the damage was.
    const d = this.f.map((f) => f.dealt);
    const margin = how === 'KO' || how === 'TKO' ? 1 : clamp((2 * Math.abs(d[0] - d[1])) / Math.max(1, d[0] + d[1]), 0, 1);
    this.after(2.4, () => {
      const order = how === 'draw' ? [0, 1] : [winner, loser];
      this.finish(order.map((i) => ({ name: this.name(i), css: this.css(i), score: Math.round(this.f[i].dealt) })), { unit: 'damage dealt', title, skill: this.versus(how === 'draw' ? null : winner, margin) });
    });
  }

  _endRound() {
    if (this.round >= this.cfg.rounds) {
      const pts = this.f.map((f) => f.dealt + 15 * this.f[1 - f.i].kdTotal);
      if (Math.abs(pts[0] - pts[1]) < 1) return this._end(0, 'draw');
      return this._end(pts[0] > pts[1] ? 0 : 1, 'decision');
    }
    this.phase = 'break';
    this.sfx.bell();
    this.banner(`End of round ${this.round}`, 2, 'small');
    this._hud();
    this.after(3, () => {
      this.round++;
      this.clock = this.cfg.roundSeconds;
      for (const f of this.f) {
        f.hp = Math.min(100, f.hp + 15);
        f.kdRound = 0;
        f.act = null;
      }
      this.phase = 'fight';
      this.banner(`Round ${this.round} — Fight!`, 1.6, 'big');
      this.sfx.bell();
      this._hud();
    });
  }

  // ------------------------------------------------------------ update
  update(dt) {
    this.tick(dt);
    this.hype = Math.max(0.35, this.hype - dt * 0.9);
    for (const stand of this.crowd) stand.update(this.time, this.hype);

    if (this.phase === 'fight') {
      this.clock -= dt;
      if (Math.ceil(this.clock) !== this._shown) {
        this._shown = Math.ceil(this.clock);
        this._hud();
      }
      if (this.clock <= 0) this._endRound();
    } else if (this.phase === 'down') {
      const def = this.f.find((f) => f.down);
      this.countT += dt;
      if (this.countT > 1) {
        this.countT -= 1;
        this.count++;
        this._say(String(this.count));
        this.sfx.thud();
        if (this.count >= 10) {
          this._end(1 - def.i, 'KO');
        } else if (!this.isHuman(def.i) && this.count >= def.cpuUpAt) this._getUp(def);
      }
      if (def && this.isHuman(def.i) && def.mash >= def.need && this.phase === 'down') this._getUp(def);
    }

    for (const f of this.f) {
      f.stun -= dt;
      f.cool -= dt;
      f.flash -= dt;
      f.recoil -= dt;
      f.snap = (f.snap || 0) - dt;
      let dodge = 0;
      let duck = 0;
      f.guard = null;
      if (this.phase === 'fight' && !f.down) {
        if (this.isHuman(f.i)) {
          const src = this.src(f.i);
          const kb = src === this.input.keyboard;
          const t = this.tilt(f.i).x;
          dodge = Math.abs(t) > this.cfg.dodgeTiltG ? Math.sign(t) : 0;
          const pitch = src ? src.pose.pitch : 0;
          const real = src && src.hasOrientation;
          const holding = this.held(f.i, 'hold');
          if (!f.act) {
            if (holding || (real && pitch > this.cfg.guardPitch * D2R)) f.guard = real && holding && pitch < this.cfg.bodyPitch * D2R ? 'low' : 'high';
            if (kb && src.keys.down && !src.charging) duck = 1;
            else if (real && !holding && pitch < this.cfg.duckPitch * D2R) duck = 1;
          }
        } else {
          f.dodgeT -= dt;
          f.duckT -= dt;
          f.guardT -= dt;
          dodge = f.dodgeT > 0 ? f.dodgeDir : 0;
          duck = f.duckT > 0 ? 1 : 0;
          if (f.guardT > 0 && !f.act) f.guard = f.guardKind;
          f.think -= dt;
          if (f.think <= 0 && this._canPunch(f)) {
            f.think = this.ai.think * rand(0.6, 1.4);
            const r = Math.random();
            if (r < 0.66) {
              const type = TYPES[Math.random() < 0.35 ? 0 : 1 + Math.floor(Math.random() * 3)];
              const target = Math.random() < 0.25 && type !== 'uppercut' ? 'body' : 'head';
              const wind = this.ai.windup + (type === 'hook' || type === 'uppercut' ? 0.14 : 0);
              this._punch(f, type, clamp(this.ai.power + rand(-0.2, 0.2), 0, 1), target, undefined, wind);
              if (type === 'jab' && Math.random() < 0.4) f.think = 0.35; // one-two
            } else if (r < 0.85) {
              f.guardT = 0.9;
              f.guardKind = Math.random() < 0.75 ? 'high' : 'low';
            } else {
              f.dodgeT = 0.5;
              f.dodgeDir = Math.random() < 0.5 ? -1 : 1;
            }
          }
        }
      }
      const kLean = 1 - Math.exp(-dt * 16);
      f.lean = lerp(f.lean, f.stun > 0 ? 0 : dodge, kLean);
      f.duck = lerp(f.duck, f.stun > 0 ? 0 : duck, kLean);

      const a = f.act;
      if (a) {
        a.t += dt;
        if (!a.hit && a.t >= a.windup + a.travel) {
          a.hit = true;
          this._land(f);
        }
        if (f.act && a.t >= a.windup + a.travel + (a.type === 'hook' ? 0.3 : 0.2)) f.act = null;
      }
      this._pose(f, dt);
    }
    this._ref(dt);
    this._cameras();
  }

  _pose(f, dt) {
    const ch = f.char;
    const g = ch.group;
    const a = f.act;
    // Step in with a punch, rock back when hit.
    const lunge = a ? (a.t < a.windup ? -0.08 : 0.25 * Math.max(0, 1 - (a.t - a.windup) / 0.35)) : 0;
    const fwdTilt = f.i === 0 ? -1 : 1; // rotation.x that tips this boxer toward the opponent
    if (f.down) {
      f.fall = Math.min(1, (f.fall || 0) + dt * 2.5);
      g.position.set(0.3 * f.sign, -0.45 * f.fall, f.sign * (1.05 + 0.6 * f.fall));
      g.rotation.set(-fwdTilt * 1.3 * f.fall, f.i === 0 ? 0 : Math.PI, 0);
    } else {
      f.fall = 0;
      const neutral = this.phase === 'down' ? 0.7 : 0; // the standing boxer backs off during a count
      const side = f.i === 0 ? 1 : -1; // this boxer's right, in world x
      g.position.set(f.lean * 0.45 * side, -0.28 * f.duck, f.sign * (0.82 - lunge + neutral) + (f.stun > 0 ? 0.1 * f.sign : 0));
      g.rotation.set(fwdTilt * 0.35 * f.duck - (f.snap > 0 ? fwdTilt * 0.25 : 0), f.i === 0 ? 0 : Math.PI, -f.lean * 0.4);
    }
    // Arms: guard positions, then the punching arm.
    const guardUp = f.guard === 'high' ? 2.75 : f.guard === 'low' ? 1.3 : 1.85 + Math.sin(this.time * 6 + f.i) * 0.06;
    const arms = [ch.armL, ch.armR];
    arms.forEach((arm, k) => {
      let x = guardUp;
      let z = (k === 0 ? -1 : 1) * (f.guard ? -0.35 : -0.15);
      if (a && k === f.hand) {
        const u = a.t < a.windup ? a.t / a.windup : clamp((a.t - a.windup) / a.travel, 0, 1);
        const out = a.t >= a.windup && a.t < a.windup + a.travel + 0.12;
        if (a.type === 'uppercut') x = a.t < a.windup ? lerp(guardUp, 0.6, u) : lerp(0.8, 2.9, u);
        else if (a.type === 'hook') {
          x = 1.65;
          z = (k === 0 ? -1 : 1) * (a.t < a.windup ? lerp(0.2, 1.0, u) : lerp(1.0, -0.5, u));
        } else x = out ? (a.target === 'body' ? 1.3 : 1.62) : lerp(guardUp, 1.2, u);
      }
      arm.rotation.x = lerp(arm.rotation.x, x, 1 - Math.exp(-dt * (a ? 34 : 14)));
      arm.rotation.z = lerp(arm.rotation.z, z, 1 - Math.exp(-dt * (a ? 34 : 14)));
    });
    ch.body.material.emissive?.setHex(f.flash > 0 ? 0x661111 : 0x000000);
  }

  _ref(dt) {
    const r = this.ref;
    const counting = this.phase === 'down';
    r.armR.rotation.x = counting ? 1.2 + Math.max(0, Math.sin(this.countT * Math.PI)) * 1.2 : lerp(r.armR.rotation.x, 0.1, dt * 6);
    r.group.position.x = lerp(r.group.position.x, counting ? 1.2 : 2.4, 1 - Math.exp(-dt * 3));
  }

  _cameras() {
    for (const f of this.f) {
      const cam = this.cams[f.i];
      const opp = this.f[1 - f.i];
      cam.position.set(f.char.group.position.x * 0.5 + 0.35 * (f.i === 0 ? 1 : -1), 1.85, f.sign * 2.75);
      cam.lookAt(opp.char.group.position.x * 0.5, 1.2, opp.sign * 0.6);
    }
  }

  render(renderer, W, H) {
    const humans = [0, 1].filter((i) => this.isHuman(i));
    const view = (i) => () => this.f.forEach((f) => f.setGhost(f.i === i));
    if (humans.length === 2) {
      renderViews(renderer, this.scene, W, H, [
        { camera: this.cams[0], x: 0, y: 0, w: 0.5, h: 1, before: view(0) },
        { camera: this.cams[1], x: 0.5, y: 0, w: 0.5, h: 1, before: view(1) },
      ]);
    } else {
      renderViews(renderer, this.scene, W, H, [{ camera: this.cams[0], x: 0, y: 0, w: 1, h: 1, before: view(0) }]);
    }
  }
}
