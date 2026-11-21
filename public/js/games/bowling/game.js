// Bowling: rendering, turn flow and input handling. Physics lives in physics.js, the oil pattern in
// oil.js, scoring in scoring.js.
//
// A turn plays out the way a real one does: line up on the approach (feet on a board, eyes on an
// arrow), hold the ball, walk your four steps while you swing, let go at the foul line. With a
// phone the bowler's arm follows your real arm, the release speed comes from how fast your arm
// actually swings, a late release lofts the ball and a wrist twist puts revs and axis rotation on
// it. Then the pinsetter sweeps the deadwood and re-sets the pins.
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { powerFromPeak, normalizeTwist } from '../../motion/swingDetector.js';
import { clamp } from '../../motion/filter.js';
import { createCharacter, PLAYER_COLORS, PLAYER_CSS } from '../../characters.js';
import { envMap } from '../common.js';
import { BowlingPhysics, DIM, pinHomes, PIT_Z, SWEEP_FRONT, pinRadiusAt } from './physics.js';
import { boardAt, BOARDS } from './oil.js';
import { Scorecard, isSplit } from './scoring.js';

const L = DIM.laneLength;
const W = DIM.laneWidth;
const GW = DIM.gutterWidth;
const LANE_PITCH = W + GW * 2 + 0.5;
const LANE_LEN = L + DIM.deckEnd;
const ARROWS_AT = 4.6; // m (15 ft): where bowlers aim
const STANCE_Z = 1.3; // where the bowler stands on the approach
const SLIDE_Z = 0.22; // where the slide ends, just behind the foul line
const WALK_S = 0.95; // four steps
const HAND_X = 0.34; // right hand's offset from the body centre
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (dt, rate) => 1 - Math.exp(-dt * rate);
const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const D2R = Math.PI / 180;

export class BowlingGame {
  /**
   * @param {object} o
   * @param {import('../../input/inputManager.js').InputManager} o.input
   * @param {import('../../audio.js').Sfx} o.sfx
   * @param {HTMLElement} o.hud
   * @param {number} o.playerCount
   * @param {(results:object)=>void} o.onFinish
   */
  constructor({ input, sfx, hud, playerCount, onFinish }) {
    this.input = input;
    this.sfx = sfx;
    this.hud = hud;
    this.onFinish = onFinish;
    this.cfg = CONFIG.bowling;
    this.players = Array.from({ length: playerCount }, (_, i) => ({
      index: i,
      name: `Player ${i + 1}`,
      color: PLAYER_COLORS[i],
      css: PLAYER_CSS[i],
      card: new Scorecard(),
      splits: new Set(), // frames whose first ball left a split
    }));
    this.physics = new BowlingPhysics(this.cfg, { seed: (Math.random() * 1e9) | 0 });
    this.cur = 0;
    this.frame = 0;
    this.state = 'aim'; // aim | windup | rolling | result | sweep | over
    this.stateT = 0;
    this.aimX = 0;
    this.aimAngle = 0; // radians, + = toward +x
    this.holder = null;
    this.holdStart = 0;
    this.throwT = 99;
    this.walkT = 0;
    this.arm = 0.1; // bowler's right arm angle (rad, + = forward)
    this.armAtRelease = 0;
    this.armSamples = []; // { t, w } arm swing speed during the approach (rad/s)
    this.pinsBefore = 10;
    this.firstImpact = false;
    this.lastThrow = null;
    this.bannerT = 0;
    this.releaseOffset = new THREE.Vector3();
    this.releaseBlend = 0;
    this.sweepAnim = null;
    this._oilVersion = -1;

    this._buildScene();
    this._buildHud();
    this._startTurn(true);
  }

  // ------------------------------------------------------------------ scene
  _buildScene() {
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0xbfe6ff);
    scene.fog = new THREE.Fog(0xbfe6ff, 22, 60);
    scene.environment = envMap();
    scene.environmentIntensity = 0.6;
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 80);
    this.camera.position.set(0.3, 2.25, STANCE_Z + 3.3);
    this._look = new THREE.Vector3(0, 0.4, -L * 0.6);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c6dd, 1.5));
    const key = new THREE.DirectionalLight(0xfff4e0, 1.5);
    key.position.set(3, 8, 6);
    scene.add(key);
    const deckLight = new THREE.DirectionalLight(0xffffff, 1.2);
    deckLight.position.set(1.2, 5, -L + 2.5);
    deckLight.target.position.set(0, 0, -L - 0.5);
    deckLight.castShadow = true;
    deckLight.shadow.mapSize.set(1024, 1024);
    deckLight.shadow.bias = -0.0005;
    Object.assign(deckLight.shadow.camera, { left: -1.6, right: 1.6, top: 2.2, bottom: -2.2, near: 0.5, far: 12 });
    scene.add(deckLight, deckLight.target);
    // A soft light on the approach so the bowler and the ball in hand cast a shadow too.
    const approachLight = new THREE.DirectionalLight(0xffffff, 0.6);
    approachLight.position.set(1.5, 6, 4);
    approachLight.target.position.set(0, 0, 0.8);
    approachLight.castShadow = true;
    approachLight.shadow.mapSize.set(1024, 1024);
    Object.assign(approachLight.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -2.5, near: 1, far: 12 });
    scene.add(approachLight, approachLight.target);

    // Carpet
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(40, 60), new THREE.MeshStandardMaterial({ color: 0xdfe9f6, roughness: 1 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, -0.07, -10);
    scene.add(carpet);

    // Lane: maple and pine boards under a clear coat. The oil shows as a glossier sheen on the
    // front of the lane and, as the game goes on, a duller track where balls have soaked it up.
    const laneTex = this._laneTexture();
    this.glossTex = this._glossTexture();
    const laneMat = new THREE.MeshPhysicalMaterial({
      map: laneTex,
      roughness: 0.42,
      clearcoat: 1,
      clearcoatRoughness: 1,
      clearcoatRoughnessMap: this.glossTex,
    });
    const otherLaneMat = new THREE.MeshPhysicalMaterial({ map: laneTex, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08 });
    const approachMat = new THREE.MeshStandardMaterial({ map: this._approachTexture(), roughness: 0.45 });
    const gutterMat = new THREE.MeshStandardMaterial({ color: 0x6f7f9e, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide });
    const dividerMat = new THREE.MeshStandardMaterial({ color: 0xf7fafe, roughness: 0.7, flatShading: true });
    const kickMat = new THREE.MeshStandardMaterial({ color: 0x3b2f2a, roughness: 0.7 });
    const pinGeo = this._pinGeometry();
    const pinMat = new THREE.MeshPhysicalMaterial({ color: 0xfffbf0, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xff6b4a, roughness: 0.5 });
    const bandH = 0.0095;
    const bandGeo = (y) => new THREE.CylinderGeometry(pinRadiusAt(y + bandH / 2) + 0.0007, pinRadiusAt(y - bandH / 2) + 0.0007, bandH, 28);
    const bandGeos = [0.249, 0.267].map(bandGeo);
    const makePin = () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(pinGeo, pinMat);
      body.position.y = -DIM.pinComHeight;
      body.castShadow = true;
      for (const [k, y] of [0.249, 0.267].entries()) {
        const band = new THREE.Mesh(bandGeos[k], bandMat);
        band.position.y = y - DIM.pinComHeight;
        g.add(band);
      }
      g.add(body);
      return g;
    };
    const gutterGeo = this._gutterGeometry();

    for (const lane of [-2, -1, 0, 1, 2]) {
      const x0 = lane * LANE_PITCH;
      const surface = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, LANE_LEN), lane === 0 ? laneMat : otherLaneMat);
      surface.position.set(x0, -0.05, -LANE_LEN / 2);
      surface.receiveShadow = true;
      const approach = new THREE.Mesh(new THREE.BoxGeometry(LANE_PITCH, 0.1, 6), approachMat);
      approach.position.set(x0, -0.05, 3);
      approach.receiveShadow = true;
      const foul = new THREE.Mesh(new THREE.BoxGeometry(W + GW * 2, 0.012, 0.025), new THREE.MeshStandardMaterial({ color: 0x1d2b4f }));
      foul.position.set(x0, 0.001, 0.0125);
      scene.add(surface, approach, foul);
      const kz0 = -(L - DIM.kickbackFrom);
      for (const side of [-1, 1]) {
        const gutter = new THREE.Mesh(gutterGeo, gutterMat);
        gutter.position.set(x0 + side * (W / 2 + GW / 2), 0, 0);
        gutter.receiveShadow = true;
        scene.add(gutter);
        // Flat gutters beside the deck: square channels, deeper
        const flatLen = kz0 - PIT_Z;
        const flat = new THREE.Mesh(new THREE.BoxGeometry(GW, 0.02, flatLen), gutterMat);
        flat.position.set(x0 + side * (W / 2 + GW / 2), -DIM.flatGutterDepth - 0.01, kz0 - flatLen / 2);
        flat.receiveShadow = true;
        scene.add(flat);
        // Kickbacks: the side walls along the pin deck (60 1/8 in apart, 20 1/2 in high)
        const kLen = kz0 - (PIT_Z - DIM.cushionGap);
        const kh = DIM.kickbackHeight + DIM.flatGutterDepth;
        const kick = new THREE.Mesh(new THREE.BoxGeometry(0.07, kh, kLen), kickMat);
        kick.position.set(x0 + side * (DIM.kickbackX + 0.035), DIM.kickbackHeight - kh / 2, kz0 - kLen / 2);
        kick.receiveShadow = true;
        scene.add(kick);
      }
      const divider = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, -SWEEP_FRONT), dividerMat);
      divider.position.set(x0 + LANE_PITCH / 2, -0.03, SWEEP_FRONT / 2);
      scene.add(divider);
      // The pit behind each deck
      const pit = new THREE.Mesh(new THREE.BoxGeometry(W + GW * 2, 0.02, 0.8), new THREE.MeshBasicMaterial({ color: 0x0d1220 }));
      pit.position.set(x0, -DIM.pitDepth, PIT_Z - 0.4);
      scene.add(pit);
      if (lane !== 0) {
        for (const [x, z] of pinHomes()) {
          const pin = makePin();
          pin.position.set(x0 + x, DIM.pinComHeight, z);
          scene.add(pin);
        }
      }
    }

    // Pin deck surround: the masking hood over the front of the deck (it hides the pinsetter),
    // neon trim, and a dark curtain behind the pit.
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_PITCH * 5 + 2, 1.5, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }),
    );
    hood.position.set(0, 1.55, -L + 0.2);
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(LANE_PITCH * 5 + 2, 3, 0.1), new THREE.MeshStandardMaterial({ color: 0x1b2440, roughness: 1 }));
    curtain.position.set(0, 0.8, PIT_Z - 0.85);
    scene.add(hood, curtain);
    const neon = (color, y, h) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(LANE_PITCH * 5 + 2, h, 0.04), new THREE.MeshBasicMaterial({ color }));
      strip.position.set(0, y, -L + 0.37);
      scene.add(strip);
    };
    neon(0xff6b4a, 0.86, 0.05);
    neon(0x2ec4b6, 2.2, 0.05);
    // Hood decoration: a row of simple shapes in the game palette.
    const shapes = [new THREE.CircleGeometry(0.22, 3), new THREE.CircleGeometry(0.2, 16), new THREE.CircleGeometry(0.22, 4)];
    const palette = [0xff6b4a, 0xffd166, 0x2ec4b6, 0x9b5de5];
    for (let i = -9; i <= 9; i++) {
      const m = new THREE.Mesh(shapes[(i + 90) % 3], new THREE.MeshBasicMaterial({ color: palette[(i + 80) % 4] }));
      m.position.set(i * 0.62, 1.55, -L + 0.36);
      m.rotation.z = i * 0.7;
      scene.add(m);
    }
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 40), new THREE.MeshStandardMaterial({ color: 0xf2f7fd, roughness: 1 }));
      wall.position.set(side * (LANE_PITCH * 2.5 + 0.6), 3, -8);
      scene.add(wall);
      for (const lx of [-1, 1]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.025, 0.012, -SWEEP_FRONT),
          new THREE.MeshBasicMaterial({ color: lx * side > 0 ? 0x2ec4b6 : 0xff6b4a }),
        );
        rail.position.set(side * LANE_PITCH * 0.5 + lx * 0.15, 0.057, SWEEP_FRONT / 2);
        scene.add(rail);
      }
    }

    // Ball return between this lane and the next.
    const retMat = new THREE.MeshPhysicalMaterial({ color: 0x2ec4b6, roughness: 0.35, clearcoat: 0.6 });
    const ret = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 1.5), retMat);
    base.position.y = 0.16;
    const hoodR = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), retMat);
    hoodR.scale.set(0.75, 1.1, 1);
    hoodR.position.set(0, 0.3, -0.55);
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.9), new THREE.MeshStandardMaterial({ color: 0x1d2b4f, roughness: 0.5 }));
    rack.position.set(0, 0.34, 0.2);
    ret.add(base, hoodR, rack);
    const spareBalls = [0x9b5de5, 0xffd166];
    spareBalls.forEach((c, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(DIM.ballRadius, 32, 20), new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }));
      b.position.set(0, 0.36 + DIM.ballRadius, 0.05 + i * 0.24);
      b.castShadow = true;
      ret.add(b);
    });
    ret.position.set(LANE_PITCH / 2, 0, 2.6);
    ret.traverse((o) => o.isMesh && (o.castShadow = true));
    scene.add(ret);

    // Daylight: a row of tall windows down each side wall and pale ceiling beams.
    const glass = new THREE.MeshBasicMaterial({ color: 0xe9f8ff });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    for (let i = 0; i < 7; i++) {
      const z = 3 - i * 4.2;
      for (const side of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), glass);
        win.position.set(side * (LANE_PITCH * 2.5 + 0.44), 2.6, z);
        win.rotation.y = (-side * Math.PI) / 2;
        scene.add(win);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(LANE_PITCH * 5 + 2, 0.25, 0.35), beamMat);
      beam.position.set(0, 5.6, z);
      scene.add(beam);
    }

    // Pinsetter: the sweep bar (guards the deck, then rakes the deadwood into the pit) and the
    // setting table (lifts standing pins, lowers new ones).
    const machineMat = new THREE.MeshStandardMaterial({ color: 0x3a4560, roughness: 0.45, metalness: 0.5 });
    this.sweep = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(W, 0.11, 0.035), machineMat);
    bar.position.y = 0.055; // group origin = underside of the bar, as in the physics
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W, 0.025, 0.037), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    stripe.position.y = 0.075;
    this.sweep.add(bar, stripe);
    for (const side of [-1, 1]) {
      // The ends reach down into the flat gutters so gutter pins are swept too.
      const depth = DIM.flatGutterDepth - 0.004;
      const end = new THREE.Mesh(new THREE.BoxGeometry(GW - 0.004, 0.11 + depth, 0.035), machineMat);
      end.position.set(side * (W / 2 + GW / 2), (0.11 - depth) / 2, 0);
      this.sweep.add(end);
    }
    this.table = new THREE.Group();
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.05, 1.12), machineMat);
    tableTop.position.y = 0.025; // group origin = underside
    this.table.add(tableTop);
    this.sweep.traverse((o) => o.isMesh && (o.castShadow = true));
    this.table.traverse((o) => o.isMesh && (o.castShadow = true));
    this._syncMachine();
    scene.add(this.sweep, this.table);

    // Live pins
    this.pinMeshes = this.physics.pins.map(() => {
      const pin = makePin();
      scene.add(pin);
      return pin;
    });

    // Ball (shared mesh: in the bowler's hand, then rolling)
    // Polished reactive-resin ball with a swirl, a smooth mirror-like clear coat and finger holes.
    this.ballMat = new THREE.MeshPhysicalMaterial({ map: this._ballTexture(), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(DIM.ballRadius, 48, 32), this.ballMat);
    this.ballMesh.castShadow = true;
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x0e1528 });
    for (const [x, y] of [[-0.022, 0.03], [0.022, 0.03], [0, -0.035]]) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(x === 0 ? 0.016 : 0.012, 14), holeMat);
      const n = new THREE.Vector3(x, y, DIM.ballRadius).normalize();
      hole.position.copy(n).multiplyScalar(DIM.ballRadius + 0.001);
      hole.lookAt(n.clone().multiplyScalar(2));
      this.ballMesh.add(hole);
    }
    scene.add(this.ballMesh);
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(DIM.ballRadius * 1.1, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    scene.add(this.ballShadow);

    // Aim guide: from the feet to the arrows, like a bowler's mental target line.
    this.guide = new THREE.Mesh(
      new THREE.PlaneGeometry(0.025, ARROWS_AT),
      new THREE.MeshBasicMaterial({ color: 0x1d2b4f, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    const tip = new THREE.Mesh(new THREE.CircleGeometry(0.06, 3), this.guide.material);
    tip.position.y = ARROWS_AT / 2;
    tip.rotation.z = Math.PI / 2;
    this.guide.add(tip);
    scene.add(this.guide);
    // The ball's path, drawn as it rolls: watch it skid, hook and roll.
    this.trail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xff6b4a, transparent: true, opacity: 0.55 }),
    );
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    // Bowlers (one per player; only the active one is shown)
    this.chars = this.players.map((p) => {
      const c = createCharacter(p.color);
      c.group.scale.setScalar(0.9);
      c.group.visible = false;
      c.shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.34, 16),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
      );
      c.shadow.rotation.x = -Math.PI / 2;
      c.shadow.position.y = 0.003;
      c.group.add(c.shadow);
      scene.add(c.group);
      return c;
    });
    this._updateGloss();
  }

  /** Canvas row (0 = pin end) for a distance from the foul line, on a lane image `h` tall. */
  _rowAt(h, metresFromFoul) {
    return h * (1 - metresFromFoul / LANE_LEN);
  }

  _laneTexture() {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 4096;
    const g = cv.getContext('2d');
    const bw = cv.width / BOARDS;
    const yAt = (d) => this._rowAt(cv.height, d);
    // Maple on the heads (first 16 ft) and the pin deck, pine in between.
    const headsEnd = yAt(4.88);
    const deckStart = yAt(L - 0.6);
    for (let i = 0; i < BOARDS; i++) {
      const n = Math.sin(i * 12.9898) * 43758.5453;
      const shade = 0.93 + 0.07 * (n - Math.floor(n));
      g.fillStyle = `rgb(${Math.round(240 * shade)},${Math.round(196 * shade)},${Math.round(132 * shade)})`;
      g.fillRect(i * bw, 0, bw + 1, cv.height);
      g.fillStyle = `rgba(214,160,96,${0.25 + 0.15 * shade})`; // pine is a touch darker and warmer
      g.fillRect(i * bw, deckStart, bw + 1, headsEnd - deckStart);
      g.fillStyle = 'rgba(90,50,20,0.22)';
      g.fillRect(i * bw, 0, 1, cv.height);
    }
    // Dovetail seams where the maple heads meet the pine.
    g.strokeStyle = 'rgba(90,50,20,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < BOARDS; i++) {
      const y = headsEnd + ((i * 7) % 5) * 6;
      g.moveTo(i * bw, y);
      g.lineTo((i + 1) * bw, y);
    }
    g.stroke();
    g.fillStyle = '#7a3b1d';
    const xOfBoard = (b) => cv.width / 2 + (20 - b) * bw; // board numbers count from the right
    // Targeting arrows every 5 boards, in a V (the middle arrow is furthest down the lane).
    for (let k = -3; k <= 3; k++) {
      const x = xOfBoard(20 + 5 * k);
      const y = yAt(ARROWS_AT + 0.25 - Math.abs(k) * 0.3);
      g.beginPath();
      g.moveTo(x, y - 40);
      g.lineTo(x - 9, y + 14);
      g.lineTo(x + 9, y + 14);
      g.fill();
    }
    // Guide dots at 7 ft, range finders at 34-40 ft.
    for (const b of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37]) {
      g.beginPath();
      g.arc(xOfBoard(b), yAt(2.13), 4, 0, Math.PI * 2);
      g.fill();
    }
    for (const b of [10, 30]) g.fillRect(xOfBoard(b) - 2, yAt(12.2), 4, yAt(10.4) - yAt(12.2));
    // Pin spots on the deck
    for (const [x, z] of pinHomes()) {
      g.beginPath();
      g.arc(cv.width / 2 + (x / W) * cv.width, yAt(-z), 5, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  _approachTexture() {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 512;
    const g = cv.getContext('2d');
    const bw = cv.width / (BOARDS + 18);
    for (let i = 0; i < BOARDS + 18; i++) {
      const n = Math.sin(i * 7.31) * 9137.13;
      const shade = 0.92 + 0.08 * (n - Math.floor(n));
      g.fillStyle = `rgb(${Math.round(242 * shade)},${Math.round(204 * shade)},${Math.round(146 * shade)})`;
      g.fillRect(i * bw, 0, bw + 1, cv.height);
      g.fillStyle = 'rgba(90,50,20,0.18)';
      g.fillRect(i * bw, 0, 1, cv.height);
    }
    // Stance dots at 12 and 15 ft behind the foul line.
    g.fillStyle = '#7a3b1d';
    for (const yy of [0.62, 0.86]) {
      for (const b of [3, 5, 8, 11, 14, 20, 26, 29, 32, 35, 37]) {
        g.beginPath();
        g.arc(cv.width / 2 + (20 - b) * bw, cv.height * yy, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _glossTexture() {
    const cv = document.createElement('canvas');
    cv.width = BOARDS;
    cv.height = 96;
    this._glossCanvas = cv;
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  /** Redraw the clear-coat roughness from the oil: oiled = mirror-like, dry = satin. */
  _updateGloss() {
    const oil = this.physics.oil;
    if (oil.version === this._oilVersion) return;
    this._oilVersion = oil.version;
    const cv = this._glossCanvas;
    const g = cv.getContext('2d');
    const img = g.createImageData(cv.width, cv.height);
    for (let y = 0; y < cv.height; y++) {
      const d = LANE_LEN * (1 - (y + 0.5) / cv.height);
      for (let i = 0; i < BOARDS; i++) {
        const x = -W / 2 + (i + 0.5) * (W / BOARDS);
        const o = clamp(oil.at(x, d), 0, 1.2);
        const rough = 0.03 + 0.32 * Math.exp(-3 * o);
        const v = Math.round(clamp(rough, 0, 1) * 255);
        const k = (y * cv.width + i) * 4;
        img.data[k] = v;
        img.data[k + 1] = v;
        img.data[k + 2] = v;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.glossTex.needsUpdate = true;
  }

  _ballTexture() {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, cv.width, cv.height);
    // Swirls in a lighter tint (the ball colour multiplies it), so each player's ball looks like
    // pearl reactive resin, and the spin is easy to see.
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = `rgba(${150 + rnd() * 60},${150 + rnd() * 60},${170 + rnd() * 60},0.45)`;
      g.lineWidth = 6 + rnd() * 18;
      g.beginPath();
      let x = rnd() * cv.width;
      let y = rnd() * cv.height;
      g.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        const nx = x + (rnd() - 0.5) * 220;
        const ny = y + (rnd() - 0.5) * 120;
        g.quadraticCurveTo(x + (rnd() - 0.5) * 160, y + (rnd() - 0.5) * 120, nx, ny);
        x = nx;
        y = ny;
      }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  _gutterGeometry() {
    // A shallow round channel: 9.25 in wide, 1.875 in deep (an arc of a 0.168 m radius circle).
    const depth = DIM.gutterDepth;
    const half = GW / 2;
    const R = (half * half + depth * depth) / (2 * depth);
    const a = Math.asin(half / R);
    const shape = new THREE.Shape();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = -a + (2 * a * i) / n;
      const x = R * Math.sin(t);
      const y = -depth + R - R * Math.cos(t);
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    for (let i = n; i >= 0; i--) {
      const t = -a + (2 * a * i) / n;
      shape.lineTo((R + 0.01) * Math.sin(t), -depth + R - (R + 0.01) * Math.cos(t));
    }
    // Round gutters run beside the lane; beside the deck they become square flat gutters.
    const len = L - DIM.kickbackFrom;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 1 });
    geo.translate(0, 0, -len);
    return geo;
  }

  _pinGeometry() {
    // The USBC tenpin profile (14 measured stations and the 1.273 in head arc), finely sampled.
    const pts = [new THREE.Vector2(0, 0)];
    const n = 96;
    for (let i = 0; i <= n; i++) {
      const h = (i / n) * DIM.pinHeight;
      pts.push(new THREE.Vector2(i === n ? 0 : pinRadiusAt(h), h));
    }
    return new THREE.LatheGeometry(pts, 36);
  }

  // -------------------------------------------------------------------- HUD
  _buildHud() {
    this.hud.innerHTML = `
      <div class="bowl-board"></div>
      <div class="banner" id="bowl-banner"></div>
      <div class="prompt">
        <div class="who"></div>
        <div class="how"></div>
        <div class="meter hidden"><i></i></div>
        <div class="last"></div>
      </div>`;
    this.el = {
      board: this.hud.querySelector('.bowl-board'),
      banner: this.hud.querySelector('.banner'),
      who: this.hud.querySelector('.who'),
      how: this.hud.querySelector('.how'),
      meter: this.hud.querySelector('.meter'),
      meterFill: this.hud.querySelector('.meter i'),
      last: this.hud.querySelector('.last'),
    };
    this._renderBoard();
  }

  _renderBoard() {
    const rows = this.players.map((p) => {
      const frames = p.card.frames;
      const next = p.card.next;
      const cells = frames
        .map((fr, f) => {
          const slots = f === 9 ? 3 : 2;
          const marks = f < 9 && fr.marks[0] === 'X' ? ['', 'X'] : fr.marks;
          let boxes = '';
          for (let i = 0; i < slots; i++) {
            const split = i === 0 && p.splits.has(f) && marks[0] !== 'X';
            boxes += `<span${split ? ' class="split"' : ''}>${marks[i] ?? ''}</span>`;
          }
          const active = p.index === this.cur && this.state !== 'over' && !next.done && next.frame === f;
          return `<div class="frame${f === 9 ? ' tenth' : ''}${active ? ' active' : ''}"><div class="marks">${boxes}</div><div class="cum">${fr.cumulative ?? ''}</div></div>`;
        })
        .join('');
      return `<div class="row${p.index === this.cur ? ' current' : ''}" style="--pc:${p.css}">
        <div class="name">P${p.index + 1}</div>${cells}<div class="total">${p.card.total}</div></div>`;
    });
    this.el.board.innerHTML = rows.join('');
  }

  _banner(text, seconds = 1.8, cls = '') {
    this.el.banner.textContent = text;
    this.el.banner.className = `banner show ${cls}`;
    this.bannerT = seconds;
  }

  _phoneFor(i) {
    const phone = this.input.phones[i];
    return phone && phone.connected ? phone : null;
  }

  _prompt() {
    const p = this.players[this.cur];
    const phone = this._phoneFor(p.index);
    const next = p.card.next;
    this.el.who.innerHTML =
      this.state === 'result' || this.state === 'sweep'
        ? `<b class="chip" style="background:${p.css}">${p.name}</b> · ${p.card.total} pts`
        : `<b class="chip" style="background:${p.css}">${p.name}</b> · Frame ${Math.min(this.frame, 9) + 1} · Ball ${next.ball + 1}`;
    let how = '';
    if (this.state === 'aim') {
      how = phone
        ? '◀ ▶ pick your board · point to aim at an arrow · hold the big button and bowl: walk, swing back, let go as your arm comes through · twist your wrist to hook'
        : '← → pick your board · the mouse aims · hold Space to swing back, release to bowl · hold ← or → while charging to hook';
    } else if (this.state === 'windup') {
      how = phone ? 'Swing back… and through — let go of the button at the bottom of the swing!' : 'Release Space to bowl';
    }
    this.el.how.textContent = how;
  }

  _aimText() {
    const stand = boardAt(this.aimX, W);
    const target = boardAt(this.aimX + Math.tan(this.aimAngle) * ARROWS_AT, W);
    return `Standing on board ${stand} · target board ${target} at the arrows`;
  }

  // ------------------------------------------------------------- turn flow
  _startTurn(newPlayer) {
    const p = this.players[this.cur];
    this.state = 'aim';
    this.stateT = 0;
    this.holder = null;
    this.firstImpact = false;
    this.walkT = 0;
    this.throwT = 99;
    this.arm = 0.1;
    this.pinsBefore = this.physics.countStanding();
    if (newPlayer) {
      this._banner(this.players.length > 1 ? `${p.name} — Frame ${this.frame + 1}` : `Frame ${this.frame + 1}`, 1.3, 'small');
    }
    this.ballMat.color.setHex(p.color);
    this.chars.forEach((c, i) => (c.group.visible = i === this.cur));
    this._renderBoard();
    this._prompt();
  }

  onButton(source, name, down) {
    if (name !== 'hold' || !this.input.isFor(source, this.cur)) return;
    if (down && this.state === 'aim' && this.stateT > 0.25) {
      this.lockedAngle = this.aimAngle; // the arm swing moves the phone; keep the line you chose
      this.state = 'windup';
      this.stateT = 0;
      this.walkT = 0;
      this.holder = source;
      this.holdStart = source.lastSampleAt;
      this.armSamples.length = 0;
      this._prompt();
    } else if (!down && this.state === 'windup' && source === this.holder) {
      this._release(source);
    }
  }

  /** Fastest arm swing in the last moments before release (rad/s), or 0 without a phone gyro. */
  _armSpeed(now) {
    let w = 0;
    for (const s of this.armSamples) if (s.t >= now - 350) w = Math.max(w, s.w);
    return w;
  }

  _release(source) {
    const bc = this.cfg;
    const sc = CONFIG.swing;
    const now = source.lastSampleAt;
    // Swing strength: the swing in progress, or one that just ended, or (weak throws) the recent peak.
    let swing = source.finishSwing(now);
    if (!swing) {
      const last = source.detector.last;
      if (last && last.tEnd >= this.holdStart && now - last.tEnd <= bc.releaseWindowMs) swing = last;
    }
    const peak = Math.max(swing ? swing.peakG : 0, source.recentPeak(Math.min(bc.releaseWindowMs, now - this.holdStart)));
    if (peak < bc.minThrowG) {
      this.state = 'aim';
      this.stateT = 0;
      this.walkT = 0;
      this.sfx.denied();
      this._prompt();
      this.el.last.textContent = `No swing detected (peak ${peak.toFixed(1)}g) — swing your arm back and through, then let go`;
      return;
    }
    const power = powerFromPeak(peak, sc);
    // Wrist twist at release (or during the swing, whichever was stronger) sets the hook.
    let twistRate = source.recentTwistRate(sc.twistWindowMs, now);
    if (swing && Math.abs(swing.twistRate) > Math.abs(twistRate)) twistRate = swing.twistRate;
    const spin = normalizeTwist(twistRate, sc);
    let speed = lerp(bc.minSpeed, bc.maxSpeed, power);
    let loft = bc.loft;
    let angle = this.lockedAngle ?? this.aimAngle;
    const isPhone = source !== this.input.keyboard;
    if (isPhone) {
      // Real pendulum physics: hand speed = arm angular speed x arm length, plus the walk.
      const w = this._armSpeed(performance.now());
      if (w > 1) speed = lerp(speed, bc.approachSpeed + w * bc.armLength, 0.6);
      // Letting go late, with the arm already swinging up, lofts the ball further down the lane.
      if (source.hasOrientation) loft = clamp(0.03 + 0.25 * Math.max(0, this.arm - 0.35), 0.02, 0.32);
      // The sideways direction of the arm swing nudges the line a little, as it does for real.
      const mv = (swing && swing.move) || source.recentMove(200, now);
      if (mv && mv.z < -0.3) angle += clamp(Math.atan2(mv.x, -mv.z) * 0.15, -1, 1) * bc.swingLineDeg * D2R;
    }
    speed = clamp(speed, bc.minSpeed * 0.85, bc.maxSpeed);

    // The ball leaves from the hand: blend the drawn ball from there onto its physics start.
    const c = this.chars[this.cur];
    this.physics.launch({ x: this.aimX, speed, spin, angle, loft });
    if (c && this.ballMesh.visible) {
      const pb = this.physics.ball.position;
      this.releaseOffset.set(this.ballMesh.position.x - pb.x, this.ballMesh.position.y - pb.y, this.ballMesh.position.z - pb.z);
      this.releaseBlend = 1;
    }
    this.armAtRelease = this.arm;
    this.entry = null;
    this.lastGutter = false;
    const rel = this.physics.release;
    this.lastThrow = { power, spin, speed, peak };
    this.state = 'rolling';
    this.stateT = 0;
    this.throwT = 0;
    this.sfx.whoosh(power);
    this.sfx.rollStart();
    source.vibrate(40);
    const hook = spin === 0 ? 'straight' : `hook ${spin > 0 ? '→' : '←'} ${Math.round(Math.abs(spin) * 100)}%`;
    const rpm = Math.round((rel.revs * 60) / (2 * Math.PI));
    this.el.last.textContent = `${(speed * 2.237).toFixed(1)} mph · ${rpm} rpm · ${hook} · board ${boardAt(this.aimX, W)}`;
    this.lastThrow.text = this.el.last.textContent;
    this._prompt();
  }

  _ballDone() {
    const p = this.players[this.cur];
    const before = p.card.next;
    const standing = this.physics.standingPins();
    const down = clamp(this.pinsBefore - standing.length, 0, before.pinsUp);
    const gutter = this.lastGutter;
    const firstBall = before.pinsUp === 10;
    p.card.roll(down);
    this.state = 'result';
    this.stateT = 0;
    this.sfx.rollStop();
    this._updateGloss();
    const holder = this.holder;
    const split = firstBall && down < 10 && isSplit(standing);
    if (split) p.splits.add(before.frame);
    if (down === 10 && firstBall) {
      this._banner('STRIKE!', 2.2, 'big');
      this.sfx.strike();
      holder?.vibrate([80, 60, 80, 60, 220]);
    } else if (down === before.pinsUp) {
      this._banner('SPARE!', 2.2, 'big');
      this.sfx.spare();
      holder?.vibrate([80, 60, 160]);
    } else if (down === 0) {
      this._banner(gutter ? 'Gutter ball' : 'Miss', 1.8);
      this.sfx.miss();
    } else if (split) {
      this._banner(`${standing.join('-')} split`, 2);
    } else {
      this._banner(`${down} pin${down === 1 ? '' : 's'}`, 1.8);
    }
    if (standing.length && down < before.pinsUp) this.el.last.textContent = `${this.el.last.textContent} · left ${standing.join('-')}`;
    this._renderBoard();
    this._prompt();
  }

  _advance() {
    const p = this.players[this.cur];
    const next = p.card.next;
    let newPlayer = false;
    if (next.done || next.frame !== this.frame) {
      newPlayer = true;
      this.cur++;
      if (this.cur >= this.players.length) {
        this.cur = 0;
        this.frame++;
      }
      if (this.frame >= 10) {
        this._finish();
        return;
      }
    }
    const full = newPlayer || next.pinsUp === 10;
    this._startSweep(full, newPlayer);
  }

  _finish() {
    this.state = 'over';
    this.cur = -1;
    this._renderBoard();
    this.sfx.fanfare();
    const rows = this.players
      .map((p) => ({ player: p.index, name: p.name, css: p.css, score: p.card.total }))
      .sort((a, b) => b.score - a.score);
    this.onFinish({ sport: 'Bowling', unit: 'pts', rows });
  }

  // ------------------------------------------------------------ pinsetter
  /**
   * Run the pinsetter. It is simulated, not animated: the sweep bar and the table are solid
   * moving bodies in the physics world, so the bar really rakes the deadwood into the pit and the
   * table really lifts the standing pins and sets them back where they stood.
   */
  _startSweep(full, newPlayer) {
    this.physics.startCycle(full);
    this.sweepAnim = { newPlayer };
    this.state = 'sweep';
    this.stateT = 0;
    this.sfx.pinsetter();
  }

  _updateSweep() {
    if (this.physics.state !== 'cycle') {
      const { newPlayer } = this.sweepAnim;
      this.sweepAnim = null;
      this._startTurn(newPlayer);
    }
  }

  _syncMachine() {
    const ph = this.physics;
    this.sweep.position.copy(ph.sweep.position);
    this.table.position.copy(ph.table.position);
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    this.stateT += dt;
    this.throwT += dt;
    const ph = this.physics;
    const bc = this.cfg;

    if (this.state === 'aim') {
      let dir = 0;
      for (const s of this.input.sourcesFor(this.cur)) dir += (s.buttons.right ? 1 : 0) - (s.buttons.left ? 1 : 0);
      // Step one board at a time feel: slow at first, faster when held.
      this.aimX = clamp(this.aimX + Math.sign(dir) * bc.moveSpeed * dt, -bc.aimRange, bc.aimRange);
      // Angle: where the phone points (the mouse for the keyboard).
      const src = this._phoneFor(this.cur) || this.input.keyboard;
      const want = src.aim.x * bc.angleRange * D2R;
      this.aimAngle += (want - this.aimAngle) * ease(dt, 10);
      if (this.stateT > 0.3) this.el.last.textContent = this._aimText();
    } else if (this.state === 'windup') {
      this.walkT += dt;
      const src = this.holder;
      if (src && src !== this.input.keyboard && src.tracker && src.tracker.has) {
        this.armSamples.push({ t: performance.now(), w: Math.abs(src.tracker.omega.x) });
        if (this.armSamples.length > 90) this.armSamples.shift();
      } else if (src && src !== this.input.keyboard) {
        this.armSamples.push({ t: performance.now(), w: (src.omegaDps || 0) * D2R * 0.8 });
        if (this.armSamples.length > 90) this.armSamples.shift();
      }
    }

    ph.step(dt);

    if (this.state === 'rolling') {
      for (const e of ph.events) {
        if (e.type === 'gutter') {
          this.lastGutter = true;
          this.sfx.gutter();
        } else if (e.type === 'land') {
          this.sfx.thud();
          this.holder?.vibrate(25);
        } else if (e.type === 'pit') {
          this.sfx.pit();
        } else if (e.type === 'pinfloor') {
          this.sfx.pinHit(e.v / 14);
        } else {
          this.sfx.pinHit(e.v / (e.type === 'ballpin' ? 8 : e.type === 'pinwall' ? 6 : 5));
          if (e.type === 'ballpin' && !this.firstImpact) {
            this.firstImpact = true;
            this.holder?.vibrate(90);
          }
        }
      }
      ph.events.length = 0;
      if (ph.ballInPlay) {
        this.sfx.rollUpdate(clamp(ph.ball.velocity.length() / 10, 0, 1), ph.inGutter);
        if (!this.entry && !ph.inGutter && ph.ball.position.z < -(L - 0.3)) {
          const v = ph.ball.velocity;
          this.entry = { deg: Math.atan2(v.x, -v.z) / D2R, mph: Math.hypot(v.x, v.z) * 2.237, board: boardAt(ph.ball.position.x, W) };
          this.el.last.textContent = `${this.lastThrow.text} → at the pins ${this.entry.mph.toFixed(1)} mph, ${Math.abs(this.entry.deg).toFixed(1)}° entry on board ${this.entry.board}`;
        }
      } else this.sfx.rollStop();
      if (ph.state === 'done') this._ballDone();
    } else if (this.state === 'result') {
      ph.events.length = 0;
      if (this.stateT > 1.4) this._advance();
    } else if (this.state === 'sweep') {
      ph.events.length = 0;
      this._updateSweep();
    }

    // Banner timer
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.el.banner.classList.remove('show');
    }
    // Keyboard power meter
    const kb = this.input.keyboard;
    const showMeter = this.state === 'windup' && this.holder === kb && kb.charging;
    this.el.meter.classList.toggle('hidden', !showMeter);
    if (showMeter) this.el.meterFill.style.width = `${Math.round(kb.charge * 100)}%`;

    // Tell each phone whose turn it is (cheap: only sent when the text changes).
    if (this.state !== 'over') {
      const p = this.players[this.cur];
      for (const phone of this.input.phones) {
        if (!phone.connected) continue;
        phone.setStatus(phone.slot === this.cur ? 'Your turn!' : phone.slot < this.players.length ? `${p.name} is bowling` : 'Watching this game');
      }
    }

    this._syncVisuals(dt);
  }

  /** The bowler's arm angle this frame: your real arm with a phone, a scripted swing otherwise. */
  _armTarget() {
    const src = this.holder;
    if (this.state === 'windup') {
      if (src && src !== this.input.keyboard && src.hasOrientation) {
        // Holding the phone like the ball, its pointing pitch follows the arm: down/back on the
        // backswing, forward and up through the release.
        const b = src.predictedBasis(performance.now());
        return clamp(Math.asin(clamp(b.point.y, -1, 1)), -1.7, 2.2);
      }
      if (src === this.input.keyboard) return lerp(0.1, -1.5, src.charge ?? Math.min(1, this.stateT / 0.6));
      return lerp(0.1, -1.3, Math.min(1, this.stateT / 0.45));
    }
    if (this.state === 'rolling' || this.state === 'result') {
      // Follow-through: carry on up from wherever the arm was at release, then settle.
      if (this.throwT < 0.25) return lerp(this.armAtRelease, 2.0, smooth(this.throwT / 0.25));
      if (this.throwT < 1.4) return lerp(2.0, 1.5, smooth((this.throwT - 0.25) / 1.15));
      return 1.5;
    }
    return 0.1 + Math.sin(performance.now() / 600) * 0.04;
  }

  _syncVisuals(dt) {
    const ph = this.physics;
    ph.pins.forEach((pin, i) => {
      const m = this.pinMeshes[i];
      m.visible = !pin.removed && pin.body.position.y > -DIM.pitDepth + 0.02;
      if (pin.removed) return;
      m.position.copy(pin.body.position);
      m.quaternion.copy(pin.body.quaternion);
    });
    this._syncMachine();

    // Bowler: stance, four-step approach with the swing, slide and follow-through.
    const c = this.chars[this.cur];
    const holding = this.state === 'aim' || this.state === 'windup';
    if (c) {
      let z = STANCE_Z;
      let bob = 0;
      let lean = 0;
      let drop = 0;
      if (this.state === 'windup' || this.state === 'rolling' || this.state === 'result') {
        const k = this.state === 'windup' ? this.walkT / WALK_S : 1;
        z = lerp(STANCE_Z, SLIDE_Z, smooth(k));
        if (k < 1) bob = Math.abs(Math.sin(k * Math.PI * 4)) * 0.035;
        lean = k < 0.75 ? -0.08 : lerp(-0.08, -0.3, smooth((k - 0.75) / 0.25));
        drop = k < 0.75 ? 0 : lerp(0, 0.1, smooth((k - 0.75) / 0.25));
        if (this.state !== 'windup') {
          lean = lerp(-0.3, 0, smooth((this.throwT - 0.6) / 0.8));
          drop = lerp(0.1, 0, smooth((this.throwT - 0.6) / 0.8));
        }
      }
      c.group.position.set(this.aimX - HAND_X, bob - drop, z);
      this._charZ = z;
      c.group.rotation.x = lean;
      const want = this._armTarget();
      // The phone drives the arm directly (it is already smoothed and predicted); scripted swings ease.
      const direct = this.state === 'windup' && this.holder && this.holder !== this.input.keyboard && this.holder.hasOrientation;
      this.arm = direct ? want : lerp(this.arm, want, ease(dt, 18));
      c.armR.rotation.x = this.arm;
      c.armL.rotation.x = -this.arm * 0.3 + (this.state === 'windup' ? 0.35 : 0);
      c.armL.rotation.z = -0.15 - (this.state === 'windup' ? 0.5 : 0); // balance arm out to the side
      c.head.position.y = 1.3 + Math.sin(performance.now() / 500) * 0.008;
    }

    // Ball: in hand, or wherever the physics says (blended out of the hand just after release)
    const b = this.ballMesh;
    if (ph.ballInPlay) {
      const bp = ph.ball.position;
      this.releaseBlend = Math.max(0, this.releaseBlend - dt / 0.1);
      const k = smooth(this.releaseBlend);
      b.visible = bp.y > -DIM.pitDepth + 0.05;
      b.position.set(bp.x + this.releaseOffset.x * k, bp.y + this.releaseOffset.y * k, bp.z + this.releaseOffset.z * k);
      b.quaternion.copy(ph.ball.quaternion); // the real spin: skid, hook and roll are visible
      const onDeck = bp.z > PIT_Z;
      const floorY = Math.abs(bp.x) <= W / 2 ? 0 : -DIM.gutterDepth;
      this.ballShadow.visible = onDeck;
      this.ballShadow.position.set(bp.x, floorY + 0.004, bp.z);
      const h = Math.max(0, bp.y - DIM.ballRadius - floorY);
      this.ballShadow.material.opacity = 0.3 / (1 + h * 8);
    } else if (holding && c) {
      b.visible = true;
      c.group.updateMatrixWorld();
      b.position.set(0, c.handOffsetY - DIM.ballRadius * 0.6, 0);
      c.armR.localToWorld(b.position);
      b.position.y = Math.max(b.position.y, DIM.ballRadius);
      b.quaternion.identity();
      this.ballShadow.visible = false;
    } else {
      b.visible = false;
      this.ballShadow.visible = false;
    }

    this.guide.visible = this.state === 'aim';
    const ang = this.aimAngle;
    this.guide.rotation.set(-Math.PI / 2, 0, -ang);
    this.guide.position.set(this.aimX + Math.sin(ang) * (ARROWS_AT / 2), 0.004, -Math.cos(ang) * (ARROWS_AT / 2));
    const track = ph.track;
    this.trail.visible = (this.state === 'rolling' || this.state === 'result') && track.length > 1;
    if (this.trail.visible && track.length !== this._trailN) {
      this._trailN = track.length;
      this.trail.geometry.dispose();
      this.trail.geometry = new THREE.BufferGeometry().setFromPoints(track.map(([x, z]) => new THREE.Vector3(x, 0.006, z)));
    }

    // Camera: behind the bowler on the approach, then down the lane with the ball, then on the deck.
    const cam = this.camera;
    let tx, ty, tz, lx, ly, lz;
    if (this.state === 'rolling' || this.state === 'result' || this.state === 'sweep') {
      const bz = ph.ballInPlay ? ph.ball.position.z : -L;
      tz = Math.max(bz + 3.4, -(L - 3.6));
      tx = (ph.ballInPlay ? ph.ball.position.x : 0) * 0.3;
      // Low "pin cam" as the ball arrives: just under the hood, level with the deck.
      ty = lerp(1.15, 0.9, smooth((-bz - (L - 6)) / 4));
      lx = 0;
      ly = 0.2;
      lz = Math.max(Math.min(bz - 4, -(L - 2)), -(L + 0.4));
      if (this.throwT < 0.5) {
        // Hold on the release for a moment before chasing the ball.
        const k = smooth(this.throwT / 0.5);
        tz = lerp((this._charZ ?? SLIDE_Z) + 3.3, tz, k);
        ty = lerp(2.25, ty, k);
      }
    } else {
      // Straight behind and above the bowler, looking square down the lane (no sideways yaw), so
      // the lane runs up the middle of the screen and the whole swing is visible. It walks up the
      // approach with the bowler.
      const cz = this._charZ ?? STANCE_Z;
      tx = this.aimX + 0.3; // over the bowling (right) shoulder, so the head doesn't block the lane
      ty = 2.25;
      tz = cz + 3.3;
      lx = tx;
      ly = 0.15;
      lz = cz - 11;
    }
    const k = ease(dt, this.state === 'rolling' ? 5 : 3);
    cam.position.set(lerp(cam.position.x, tx, k), lerp(cam.position.y, ty, k), lerp(cam.position.z, tz, k));
    this._look.set(lerp(this._look.x, lx, k), lerp(this._look.y, ly, k), lerp(this._look.z, lz, k));
    cam.lookAt(this._look);
  }

  dispose() {
    this.sfx.rollStop();
    this.hud.innerHTML = '';
    for (const phone of this.input.phones) phone.setStatus('');
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        if (o.material.clearcoatRoughnessMap) o.material.clearcoatRoughnessMap.dispose();
        o.material.dispose();
      }
    });
  }
}
