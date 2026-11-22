// Swordplay duel on a platform over the water. Your sword follows the phone 1:1 (the phone's long
// axis is the blade). Slash in any direction - the direction you actually swing is the direction of
// the cut. Hold the big button to guard: a guard only stops a slash if your blade is roughly
// perpendicular to it (an upright blade stops a sideways slash, a flat blade stops a chop).
// Blocking a slash knocks the attacker off balance - punish them. Clean hits drive your opponent
// back; push them off the edge to win the round.
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { createCharacter, react } from '../../characters.js';
import { BaseGame, outdoorScene, flatMat, renderViews, ghost, lerp, clamp, rand } from '../common.js';

const GAP = 0.95; // each fighter stands this far from the midpoint between them
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _sh = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _reach = new THREE.Vector3();
const _local = new THREE.Vector3();
const _q = new THREE.Quaternion();
const D2R = Math.PI / 180;
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => a * D2R);

/** World x/y-plane angle <-> a fighter's own view (fighter 1 faces the other way: x is mirrored). */
const toOwn = (f, ang) => (f.i === 0 ? ang : Math.PI - ang);

/** Smallest angle between two undirected lines, 0..90 degrees. */
export function lineAngle(a, b) {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d / D2R;
}

export class SwordGame extends BaseGame {
  constructor(o) {
    super(o, 'Swordplay');
    this.cfg = CONFIG.sword;
    this.ai = this.cfg.ai[this.difficulty];
    this.wins = [0, 0];
    this.round = 0;
    this._build();
    this._startRound();
  }

  _build() {
    const { scene, camera, floor } = outdoorScene({ ground: 0x3aa6ec, sky: 0xaee4ff, fov: 50, shadow: 7 });
    this.scene = scene;
    this.camera = camera;
    floor.position.y = -2.2; // the water: glossy, reflecting the sky
    floor.material.map = null;
    floor.material.roughness = 0.12;
    floor.material.metalness = 0.1;
    floor.material.needsUpdate = true;
    const H = this.cfg.arenaHalf + 0.3;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.0, H * 2), flatMat(0xf4f7fb));
    deck.position.y = -1.0;
    deck.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.03, H * 2 - 0.4), flatMat(0xffd166));
    top.position.y = 0.01;
    top.receiveShadow = true;
    scene.add(deck, top);
    for (const z of [-H + 0.2, H - 0.2]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.04, 0.12), new THREE.MeshBasicMaterial({ color: 0xff6b4a }));
      edge.position.set(0, 0.03, z);
      scene.add(edge);
    }
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 4, 10), flatMat(0xdfe9f6));
        post.position.set(sx * 1.4, -3.2, -H + 0.8 + k * ((H * 2 - 1.6) / 3));
        scene.add(post);
      }
    }
    const bladeMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.3 });
    this.f = [0, 1].map((i) => {
      const char = createCharacter(this.color(i));
      scene.add(char.group);
      // The sword lives in the world (not on the arm) so it can follow the phone exactly.
      const sword = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.025), bladeMat(0xeef4fb));
      blade.position.y = 0.58;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.06), bladeMat(this.color(i)));
      guard.position.y = 0.1;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 8), bladeMat(0x1d2b4f));
      sword.add(blade, guard, grip);
      sword.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      scene.add(sword);
      const setGhost = ghost(char.group, 0.3);
      return { i, sign: i === 0 ? 1 : -1, char, sword, setGhost, act: null, stun: 0, cool: 0, guard: false, stance: 90 * D2R, think: 1.4, guardT: 0, fall: 0, dir: new THREE.Vector3(0, 0.5, -1) };
    });
    this.cams = [0, 1].map(() => new THREE.PerspectiveCamera(52, 1, 0.05, 900));
    this.camera = this.cams[0];
  }

  _startRound() {
    this.shift = 0; // + = the fight has moved toward player 2's edge
    this.round++;
    this.live = true;
    for (const f of this.f) Object.assign(f, { act: null, stun: 0, cool: 0.6, guard: false, fall: 0, guardT: 0 });
    this.banner(`Round ${this.round}`, 1.4);
    this.sfx.whistle();
    this._hud();
  }

  _hud() {
    const pips = (n) => Array.from({ length: this.cfg.roundsToWin }, (_, k) => `<i style="background:${k < n ? '#ffb020' : '#d5e0f2'}"></i>`).join('');
    const edge = this.cfg.arenaHalf - GAP;
    const pos = clamp(0.5 + this.shift / (2 * edge), 0, 1);
    const row = (f) => `<div class="hp"><span class="nm">${this.name(f.i)} <span class="dots">${pips(this.wins[f.i])}</span></span></div>`;
    this.el.top.innerHTML = `<div class="scorebox wide">${row(this.f[0])}<div class="clock sm" style="width:120px"><div class="bar thin"><i style="width:${Math.round(pos * 100)}%;background:${this.css(0)}"></i></div>edge</div>${row(this.f[1])}</div>`;
    if (!this._prompted) {
      this._prompted = true;
      const kb = !this.hasPhone(this.owner(this.input.keyboard));
      this.prompt(
        `${this.chip(0)} vs ${this.chip(1)} · first to ${this.cfg.roundsToWin}`,
        kb
          ? 'The mouse angles your sword · Space: slash (← → sideways, ↑ ↓ up / down, none = chop) · hold Space to guard: blade across their slash'
          : 'Your sword follows the phone · swing in any direction to slash · hold the big button to guard, blade across their slash · ⟳ Center if it drifts',
      );
      for (const i of [0, 1]) this.status(i, 'Slash any way · HOLD = guard');
    }
  }

  _say(text) {
    this.el.center.textContent = text;
    this.el.center.className = 'center pulse';
    void this.el.center.offsetWidth;
    this.el.center.className = 'center pulse show';
  }

  /** World-space blade direction of fighter f (the way the sword points). */
  _bladeDir(f) {
    const right = new THREE.Vector3(f.i === 0 ? 1 : -1, 0, 0);
    const fwd = new THREE.Vector3(0, 0, -f.sign);
    const up = new THREE.Vector3(0, 1, 0);
    const a = f.act;
    if (this.isHuman(f.i) && (!a || this.src(f.i)?.hasOrientation)) {
      const p = this.pose(f.i).basis.point;
      const v = new THREE.Vector3(p.x * (f.i === 0 ? 1 : -1), p.y, p.z * (f.i === 0 ? 1 : -1));
      // Keep the blade in front of you even if the phone points backwards for a moment.
      if (v.dot(fwd) < -0.2) v.addScaledVector(fwd, -v.dot(fwd) - 0.2);
      return v.normalize();
    }
    let ang = f.stance; // own view
    let reach = 0.8;
    if (a) {
      // Wind up on the far side of the cut, then sweep through.
      const u = a.t < a.windup ? -a.t / a.windup : -1 + 2 * clamp((a.t - a.windup) / 0.16, 0, 1);
      const own = toOwn(f, a.ang);
      const off = new THREE.Vector3().addScaledVector(right, Math.cos(own) * u).addScaledVector(up, Math.sin(own) * u);
      return fwd.clone().multiplyScalar(0.7).add(off.multiplyScalar(0.95)).add(up.clone().multiplyScalar(0.15)).normalize();
    }
    if (f.stun > 0) ang = 100 * D2R + Math.sin(this.time * 20) * 0.3;
    if (!f.guard) reach = 0.45;
    return fwd.clone().multiplyScalar(0.6).add(right.clone().multiplyScalar(Math.cos(ang) * reach)).add(up.clone().multiplyScalar(Math.sin(ang) * reach + 0.2)).normalize();
  }

  /** Blade line angle in the x/y plane (seen from player 1's side). */
  _bladeAngle(f) {
    const d = this._bladeDir(f);
    return Math.atan2(d.y, d.x);
  }

  _slash(f, power, ang, windup) {
    if (!this.live || f.act || f.stun > 0 || f.cool > 0 || f.fall) return false;
    f.act = { ang, power, t: 0, windup, hit: false };
    return true;
  }

  onSwing(source, swing) {
    const i = this.owner(source);
    if (i > 1 || !this.isHuman(i)) return;
    const f = this.f[i];
    if (source.buttons.hold && source !== this.input.keyboard) return; // guarding
    const kb = source === this.input.keyboard;
    if (!kb && source.hasOrientation && swing.omegaDps < this.cfg.minSlashDps) return; // a twitch, not a cut
    const tip = swing.tip || swing.move;
    const flip = i === 0 ? 1 : -1;
    let ang = Math.atan2(tip.y, tip.x * flip); // world x/y plane
    if (kb && Math.abs(tip.x) < 0.3 && Math.abs(tip.y) < 0.3) ang = -90 * D2R; // plain Space = overhead chop
    if (this._slash(f, swing.power, ang, kb || !source.hasOrientation ? 0.08 : 0)) {
      this.sfx.whoosh(swing.power);
      const d = this.f[1 - i];
      if (!this.isHuman(d.i) && !d.act && d.stun <= 0 && Math.random() < this.ai.block) {
        d.guardT = 0.7;
        d.stance = toOwn(d, ang) + Math.PI / 2 + rand(-0.15, 0.15); // the right answer: across the cut
      }
    }
  }

  _land(att) {
    const def = this.f[1 - att.i];
    const a = att.act;
    const across = lineAngle(this._bladeAngle(def), a.ang);
    if (def.guard && Math.abs(90 - across) <= this.cfg.blockToleranceDeg) {
      this.sfx.clang();
      this._say('Blocked!');
      this.feel.hitstop(70); // blades meet: a hard stop
      this.feel.shake(0.25);
      this.sfx.crowdOoh(0.4);
      att.stun = this.cfg.blockStunS; // knocked off balance: an opening
      att.act = null;
      this.vibrate(att.i, [40, 30, 40]);
      this.vibrate(def.i, 40);
      return;
    }
    if (def.guard) this._say('Wrong angle!');
    const push = this.cfg.push * (1 + 1.2 * a.power) * (def.stun > 0 ? 1.6 : 1) * (def.act && !def.act.hit ? 1.3 : 1);
    if (def.act && !def.act.hit) def.act = null;
    this.shift += att.sign * push;
    def.stun = Math.max(def.stun, 0.35);
    def.hitT = 0.25;
    this.feel.hitstop(35 + 50 * a.power);
    this.feel.shake(0.15 + 0.3 * a.power);
    react(def.char, 'hit');
    this.sfx.punch(a.power);
    if (!def.guard) this._say(push > this.cfg.push * 1.8 ? 'Big hit!' : 'Hit!');
    this.vibrate(def.i, 100);
    this.vibrate(att.i, 40);
    this._hud();
    const edge = this.cfg.arenaHalf - GAP;
    if (Math.abs(this.shift) > edge) this._ringOut(this.shift > 0 ? 1 : 0);
  }

  _ringOut(loser) {
    if (!this.live) return;
    this.live = false;
    const winner = 1 - loser;
    this.f[loser].fall = 0.001;
    this.wins[winner]++;
    this.after(0.5, () => this.sfx.splash());
    // Over the edge in slow motion.
    this.feel.slowmo(1.2, 0.3);
    this.feel.shake(0.5);
    const matchWon = this.wins[winner] >= this.cfg.roundsToWin;
    this.feel.celebrate('RING OUT!', { color: this.css(winner), size: 'big', sub: `${this.name(winner)} takes the round`, confetti: matchWon && this.isHuman(winner) ? 100 : 0 });
    this.sfx.crowdCheer(matchWon ? 1 : 0.8);
    react(this.f[winner].char, 'cheer', 2.2);
    this._hud();
    this.after(2.6, () => {
      if (this.wins[winner] >= this.cfg.roundsToWin) {
        const margin = clamp((this.wins[winner] - this.wins[loser]) / this.cfg.roundsToWin, 0, 1);
        this.finish([winner, loser].map((i) => ({ name: this.name(i), css: this.css(i), score: this.wins[i] })), { unit: 'rounds', title: `${this.name(winner)} wins!`, skill: this.versus(winner, margin) });
      } else this._startRound();
    });
  }

  update(dt) {
    this.tick(dt);
    for (const f of this.f) {
      f.stun -= dt;
      f.cool -= dt;
      f.hitT = (f.hitT || 0) - dt;
      const human = this.isHuman(f.i);
      if (!this.live) f.guard = false;
      else if (human) f.guard = this.held(f.i, 'hold') && !f.act && f.stun <= 0;
      else {
        f.guardT -= dt;
        f.guard = f.guardT > 0 && !f.act && f.stun <= 0;
        f.think -= dt;
        if (f.think <= 0 && !f.act && f.stun <= 0) {
          f.think = this.ai.think * rand(0.6, 1.4);
          const r = Math.random();
          if (r < 0.62) {
            if (this._slash(f, clamp(this.ai.power + rand(-0.2, 0.2), 0, 1), ANGLES[Math.floor(Math.random() * ANGLES.length)], this.ai.windup)) this.sfx.whoosh(0.4);
          } else if (r < 0.85) {
            f.guardT = 1.1;
            f.stance = ANGLES[Math.floor(Math.random() * 4)] + Math.PI / 2;
          }
        }
        // An opponent who is off balance gets punished quickly.
        const opp = this.f[1 - f.i];
        if (opp.stun > 0.3 && !f.act && f.stun <= 0 && f.think > 0.25) f.think = 0.2;
      }

      const a = f.act;
      if (a) {
        a.t += dt;
        if (!a.hit && a.t >= a.windup + 0.12) {
          a.hit = true;
          this._land(f);
        }
        if (f.act && a.t >= a.windup + 0.4) f.act = null;
      }

      // ---- pose ----
      const ch = f.char;
      const g = ch.group;
      if (f.fall) f.fall += dt;
      const z = -this.shift + f.sign * GAP + (f.fall ? f.sign * f.fall * 1.6 : 0);
      g.position.set(f.stun > 0 ? rand(-0.03, 0.03) : 0, f.fall ? -f.fall * f.fall * 7 : 0, lerp(g.position.z, z, 1 - Math.exp(-dt * 14)));
      const back = f.hitT > 0 ? 0.25 : 0;
      g.rotation.set(f.sign * (f.fall ? Math.min(1.4, f.fall * 3) : back), f.i === 0 ? 0 : Math.PI, 0); // tip backwards
      // Sword at the hand, pointing along the blade direction; the arm reaches toward it.
      const dir = this._bladeDir(f);
      f.dir.lerp(dir, human && this.src(f.i)?.hasOrientation ? 1 : 1 - Math.exp(-dt * 30)).normalize();
      g.updateMatrixWorld();
      // (Scratch vectors: this runs for both fighters every frame.)
      const shoulder = _sh.set(0.31, 0.95, 0).applyMatrix4(g.matrixWorld);
      const fwd = _fwd.set(0, 0, -f.sign);
      const reachDir = _reach.copy(f.dir).multiplyScalar(0.55).addScaledVector(fwd, 0.45).normalize();
      f.sword.position.copy(shoulder).addScaledVector(reachDir, 0.42);
      f.sword.quaternion.setFromUnitVectors(UP, f.dir);
      const local = _local.copy(reachDir).applyQuaternion(_q.copy(g.quaternion).invert());
      ch.armR.quaternion.setFromUnitVectors(DOWN, local);
      ch.armL.rotation.set(0.4, 0, -0.15);
    }

    for (const f of this.f) {
      const cam = this.cams[f.i];
      const opp = this.f[1 - f.i];
      const side = f.i === 0 ? 1 : -1;
      const fz = f.char.group.position.z;
      cam.position.set(0.75 * side, 2.05, fz + f.sign * 2.5);
      cam.lookAt(0, 1.1, lerp(fz, opp.char.group.position.z, 0.6));
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
