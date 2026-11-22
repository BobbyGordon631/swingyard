// Shared plumbing for the sports: HUD skeleton, player/controller mapping, outdoor scenery.
import * as THREE from 'three';
import { PLAYER_COLORS, PLAYER_CSS, react } from '../characters.js';
import { feel } from '../feel.js';
import { PRO_LEVEL } from '../skill.js';

export { feel, react };

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const ease = (dt, rate) => 1 - Math.exp(-dt * rate);
export const rand = (a, b) => a + Math.random() * (b - a);
export const CPU_COLOR = 0x8793ab;
export const CPU_CSS = '#aab4c8';
export const DIFFICULTY = ['Easy', 'Normal', 'Hard'];

export const flatMat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

// ------------------------------------------------------------------ look
let RENDERER = null;
let ENV = null;
/** main.js hands over the renderer so scenes can build image-based lighting. */
export function setRenderer(r) {
  RENDERER = r;
}

/**
 * Soft image-based lighting: a blurred sky/ground gradient with a bright sun, so shiny things (balls, pins,
 * swords, rackets) pick up believable reflections and everything gets gentle bounce light. Built once.
 */
export function envMap() {
  if (ENV || !RENDERER) return ENV;
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const col = [];
  const top = new THREE.Color(0x6fb8ff);
  const hor = new THREE.Color(0xf4f9ff);
  const gnd = new THREE.Color(0x7d9a74);
  const c = new THREE.Color();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.6));
    else c.copy(hor).lerp(gnd, Math.min(1, -y * 4));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85).multiplyScalar(12) }));
  sun.position.set(4, 7, 5);
  env.add(sun);
  const pmrem = new THREE.PMREMGenerator(RENDERER);
  ENV = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  geo.dispose();
  return ENV;
}

/** A gradient sky dome (zenith -> horizon) that the fog fades into. */
export function skyDome(scene, { top = 0x5aa9f0, horizon = 0xcdeaff, radius = 850 } = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main() { float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55)); gl_FragColor = vec4(c, 1.0); }',
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.onBeforeRender = (r, sc, cam) => dome.position.copy(cam.position);
  scene.add(dome);
  return dome;
}

let GRASS = null;
/** Fine, tiling speckle so big ground planes aren't a flat colour (multiplies the material colour). */
export function grassTexture() {
  if (GRASS) return GRASS;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 2600; i++) {
    const v = Math.round(205 + rnd() * 50);
    g.fillStyle = `rgb(${v},${v},${v})`;
    const x = rnd() * 256;
    const y = rnd() * 256;
    g.fillRect(x, y, 1 + rnd() * 2, 2 + rnd() * 4);
  }
  GRASS = new THREE.CanvasTexture(cv);
  GRASS.wrapS = GRASS.wrapT = THREE.RepeatWrapping;
  GRASS.colorSpace = THREE.SRGBColorSpace;
  GRASS.anisotropy = 8;
  GRASS.userData.shared = true;
  return GRASS;
}

/** Bright outdoor scene: gradient sky, sun with soft shadows, textured ground, drifting clouds. */
export function outdoorScene({ sky = 0x9fdcff, ground = 0x7ccf78, size = 500, fog = [60, 260], fov = 45, shadow = 18 } = {}) {
  const scene = new THREE.Scene();
  const horizon = new THREE.Color(sky).lerp(new THREE.Color(0xffffff), 0.35);
  scene.background = horizon.clone();
  scene.fog = new THREE.Fog(horizon, fog[0], fog[1]);
  skyDome(scene, { top: new THREE.Color(sky).multiplyScalar(0.78).getHex(), horizon: horizon.getHex() });
  scene.environment = envMap();
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa8c8a0, 1.0));
  const sun = new THREE.DirectionalLight(0xfff4dc, 2.1);
  sun.position.set(8, 16, 10);
  scene.add(sun, sun.target);
  if (shadow) softShadows(sun, shadow);
  const tex = grassTexture().clone();
  tex.userData = {}; // the clone is ours to free; the canvas image stays shared
  tex.repeat.set(size / 6, size / 6);
  tex.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: ground, roughness: 1, map: tex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  floor.userData.ground = true;
  scene.add(floor);
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, fog: false, roughness: 1, emissive: 0xdfeaf5, emissiveIntensity: 0.55, flatShading: true });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 9; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      const r = 6 + ((i + j) % 3) * 2;
      puff.scale.set(r, r * 0.6, r);
      puff.position.set(j * 6.5 - 9, (j % 2) * 2.5, (j % 3) * 2);
      cloud.add(puff);
    }
    const a = (i / 9) * Math.PI * 2 + 0.4;
    cloud.position.set(Math.cos(a) * 200, 60 + (i % 3) * 14, Math.sin(a) * 200);
    scene.add(cloud);
  }
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 900);
  return { scene, camera, sun, floor };
}

/** Keep a sun's shadow box centred on the action (x, z). */
export function followSun(sun, x, z) {
  sun.position.set(x + 8, 16, z + 10);
  sun.target.position.set(x, 0, z);
}

/**
 * A short comet trail behind a fast ball (fades by shrinking). push() as the ball moves; points are
 * spaced by distance, so it looks the same at any frame rate.
 */
export function makeTrail(scene, { color = 0xffffff, n = 16, size = 0.05, spacing = 0.12, opacity = 0.4 } = {}) {
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), n);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  const pts = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const draw = () => {
    for (let i = 0; i < pts.length; i++) {
      const k = 1 - i / n;
      mesh.setMatrixAt(i, m.compose(v.set(pts[i][0], pts[i][1], pts[i][2]), q, sc.setScalar(size * k)));
    }
    mesh.count = pts.length;
    mesh.instanceMatrix.needsUpdate = true;
  };
  return {
    mesh,
    push(x, y, z) {
      const last = pts[0];
      if (last && Math.hypot(x - last[0], y - last[1], z - last[2]) < spacing) return;
      pts.unshift([x, y, z]);
      if (pts.length > n) pts.pop();
      draw();
    },
    /** Let the tail catch up and vanish. */
    fade() {
      if (!pts.length) return;
      pts.pop();
      draw();
    },
    clear() {
      pts.length = 0;
      mesh.count = 0;
    },
  };
}

export function blobShadow(radius, opacity = 0.25) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.01;
  return m;
}

const TREE = {};
export function addTree(scene, x, z, scale = 1) {
  if (!TREE.trunk) {
    TREE.trunk = new THREE.CylinderGeometry(0.18, 0.24, 1.2, 6);
    TREE.top = new THREE.ConeGeometry(1.1, 2.8, 7);
    TREE.top2 = new THREE.ConeGeometry(0.8, 2.0, 7);
  }
  // Materials are per scene (they get disposed with it); geometry is shared.
  const mats = ((scene.userData ||= {}).treeMats ||= [flatMat(0x8a5a2b), flatMat(0x3fae6a), flatMat(0x2e9d6a)]);
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(TREE.trunk, mats[0]);
  trunk.position.y = 0.6;
  const leaf = mats[1 + (Math.round(x * 7 + z * 3) & 1)];
  const top = new THREE.Mesh(TREE.top, leaf);
  top.position.y = 2.3;
  const top2 = new THREE.Mesh(TREE.top2, leaf);
  top2.position.y = 3.4;
  tree.add(trunk, top, top2);
  tree.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.userData.shared = true;
    }
  });
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  scene.add(tree);
  return tree;
}

/** A flat coloured patch lying on the ground (courts, greens, bunkers...). */
export function patch(scene, geometry, color, y = 0.01, x = 0, z = 0) {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

/** Make a directional light cast soft shadows over a square of `half` metres around the origin. */
export function softShadows(light, half) {
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.radius = 4;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.03;
  Object.assign(light.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 80 });
  light.shadow.camera.updateProjectionMatrix();
}

const CROWD_SHIRTS = [0xff6b4a, 0x2ec4b6, 0xffd166, 0x9b5de5, 0x4d96ff, 0xff8fab, 0x8ac926, 0xf4f1de, 0xf28482];
const CROWD_HEADS = [0xffe0bd, 0xf1c27d, 0xc68642, 0x8d5524, 0xffcd94];

/**
 * A tiered grandstand full of spectators. Everyone is drawn with two instanced meshes, so a
 * few hundred people cost almost nothing.
 * @returns {{update(time:number, excitement?:number):void}} call update() to make the crowd bob
 */
/** How full the stands are for a skill level: a handful of fans at first, a packed house for a Pro. */
export function crowdFill(level = PRO_LEVEL) {
  return clamp(0.2 + (0.8 * level) / PRO_LEVEL, 0.2, 1);
}

export function addGrandstand(scene, { x = 0, z = 0, rotY = 0, width = 16, rows = 5, base = 0, color = 0xe6edf7, fill = 1 }) {
  const stand = new THREE.Group();
  stand.position.set(x, base, z);
  stand.rotation.y = rotY;
  const stepMat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const seats = [];
  for (let k = 0; k < rows; k++) {
    const h = (k + 1) * 0.55;
    const step = new THREE.Mesh(new THREE.BoxGeometry(width, h, 0.9), stepMat);
    step.position.set(0, h / 2, -k * 0.9);
    step.receiveShadow = true;
    stand.add(step);
    const n = Math.floor(width / 0.62);
    for (let i = 0; i < n; i++) {
      const hv = Math.sin(i * 12.9898 + k * 78.233 + x) * 43758.5453;
      // Empty seats: a few when full; most when the crowd hasn't heard of you yet (front rows fill first).
      if (hv - Math.floor(hv) > 0.86 * fill * (1.15 - (0.3 * k) / rows)) continue;
      seats.push(new THREE.Vector3((i - (n - 1) / 2) * 0.62 + (k % 2) * 0.2, h + 0.33, -k * 0.9));
    }
  }
  scene.add(stand);
  // Everyone bobs in the vertex shader (per-person phase attribute), so a stadium full of fans costs
  // no CPU per frame.
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0.4 } };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uExcite = uniforms.uExcite;
    sh.vertexShader = 'attribute float aPhase;\nuniform float uTime;\nuniform float uExcite;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  float bob = max(0.0, sin(uTime * (5.0 + mod(aPhase, 5.0)) + aPhase * 1.7)) * 0.07 * uExcite;\n  transformed.y += bob + max(0.0, uExcite - 1.2) * 0.12 * max(0.0, sin(uTime * 9.0 + aPhase));',
    );
  };
  mat.customProgramCacheKey = () => 'crowd-bob';
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(seats.map((_, i) => i)), 1);
  const bodyGeo = new THREE.CapsuleGeometry(0.19, 0.26, 4, 10);
  const headGeo = new THREE.SphereGeometry(0.16, 12, 9);
  bodyGeo.setAttribute('aPhase', phase);
  headGeo.setAttribute('aPhase', phase);
  const body = new THREE.InstancedMesh(bodyGeo, mat, seats.length);
  const head = new THREE.InstancedMesh(headGeo, mat, seats.length);
  const c = new THREE.Color();
  const m = new THREE.Matrix4();
  seats.forEach((st, i) => {
    body.setColorAt(i, c.setHex(CROWD_SHIRTS[(i * 7 + (i >> 3)) % CROWD_SHIRTS.length]));
    head.setColorAt(i, c.setHex(CROWD_HEADS[(i * 5 + (i >> 2)) % CROWD_HEADS.length]));
    body.setMatrixAt(i, m.makeTranslation(st.x, st.y, st.z));
    head.setMatrixAt(i, m.makeTranslation(st.x, st.y + 0.42, st.z));
  });
  stand.add(body, head);
  return {
    update: (time, excitement = 0.4) => {
      uniforms.uTime.value = time;
      uniforms.uExcite.value += (excitement - uniforms.uExcite.value) * 0.2;
    },
  };
}

/** A flat sign with text on it (banners, scoreboards). */
export function addBanner(scene, text, { x = 0, y = 3, z = 0, rotY = 0, width = 8, height = 1.1, bg = '#ff6b4a', fg = '#ffffff' }) {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = Math.round((1024 * height) / width);
  const g = cv.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg;
  g.font = `900 ${Math.round(cv.height * 0.6)}px ui-rounded, 'Avenir Next', system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cv.width / 2, cv.height / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  scene.add(mesh);
  return mesh;
}

export class BaseGame {
  /** opts: { input, sfx, hud, playerCount, difficulty (0-2), onFinish } */
  constructor(opts, title) {
    this.input = opts.input;
    this.sfx = opts.sfx;
    this.hud = opts.hud;
    this.onFinish = opts.onFinish;
    this.playerCount = opts.playerCount;
    this.difficulty = opts.difficulty ?? 1;
    this.skill = opts.skill ?? PRO_LEVEL; // the solo player's Skill Level in this sport (sizes the crowd)
    this.feel = feel;
    this.title = title;
    this.time = 0;
    this.over = false;
    this._bannerT = 0;
    this._after = [];
    this.hud.innerHTML = `
      <div class="top"></div>
      <div class="banner"></div>
      <div class="center"></div>
      <div class="prompt">
        <div class="who"></div>
        <div class="how"></div>
        <div class="meter hidden"><i></i></div>
        <div class="last"></div>
      </div>`;
    const q = (s) => this.hud.querySelector(s);
    this.el = { top: q('.top'), banner: q('.banner'), center: q('.center'), who: q('.who'), how: q('.how'), meter: q('.meter'), fill: q('.meter i'), last: q('.last') };
  }

  // ---- players ----
  isHuman(i) {
    return i < this.playerCount;
  }
  name(i) {
    return this.isHuman(i) ? `Player ${i + 1}` : 'CPU';
  }
  css(i) {
    return this.isHuman(i) ? PLAYER_CSS[i] : CPU_CSS;
  }
  color(i) {
    return this.isHuman(i) ? PLAYER_COLORS[i] : CPU_COLOR;
  }
  chip(i) {
    return `<b class="chip" style="background:${this.css(i)}">${this.name(i)}</b>`;
  }
  /** Which player a source controls when everyone plays at once: a phone = its slot,
   *  the keyboard = the first human without a phone (or player 1). */
  owner(source) {
    if (source.slot !== undefined) return source.slot;
    for (let i = 0; i < this.playerCount; i++) if (!this.input.phones[i].connected) return i;
    return 0;
  }
  /** Turn-based games: the keyboard may always act for whoever's turn it is. */
  canAct(source, i) {
    return source === this.input.keyboard || source.slot === i;
  }
  sourcesOf(i, turnBased = false) {
    const out = [];
    const phone = this.input.phones[i];
    if (phone && phone.connected) out.push(phone);
    if (turnBased || this.owner(this.input.keyboard) === i) out.push(this.input.keyboard);
    return out;
  }
  tilt(i, turnBased = false) {
    let x = 0;
    let y = 0;
    for (const s of this.sourcesOf(i, turnBased)) {
      x += s.tilt.x;
      y += s.tilt.y;
    }
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }
  /** The source that steers player i: their phone if it is connected, else the keyboard (if it may). */
  src(i, turnBased = false) {
    const phone = this.input.phones[i];
    if (phone && phone.connected) return phone;
    if (turnBased || this.owner(this.input.keyboard) === i) return this.input.keyboard;
    return null;
  }
  /** Pointer for player i, -1..1 (where the phone points; the mouse for the keyboard). */
  aim(i, turnBased = false) {
    const s = this.src(i, turnBased);
    return s ? s.aim : { x: 0, y: 0 };
  }
  /** 3D pose for player i: { pose:{yaw,pitch,roll}, basis:{point,right,normal}, real:boolean }. */
  pose(i, turnBased = false) {
    const s = this.src(i, turnBased);
    if (!s) return { pose: { yaw: 0, pitch: 0, roll: 0 }, basis: { point: { x: 0, y: 0, z: -1 }, right: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } }, real: false };
    // Extrapolated to this very moment: phones report at ~60 Hz, the screen may run at 120.
    return { pose: s.pose, basis: s.predictedBasis(performance.now()), real: s.hasOrientation };
  }
  held(i, button, turnBased = false) {
    return this.sourcesOf(i, turnBased).some((s) => s.buttons[button]);
  }
  hasPhone(i) {
    return !!this.input.phones[i]?.connected;
  }
  vibrate(i, pattern) {
    if (this.hasPhone(i)) this.input.phones[i].vibrate(pattern);
  }
  status(i, text) {
    if (this.hasPhone(i)) this.input.phones[i].setStatus(text);
  }

  // ---- HUD ----
  banner(text, seconds = 1.6, cls = '') {
    this.el.banner.textContent = text;
    this.el.banner.className = `banner show ${cls}`;
    this._bannerT = seconds;
  }
  prompt(who, how = '') {
    this.el.who.innerHTML = who;
    this.el.how.textContent = how;
  }
  last(text) {
    this.el.last.textContent = text;
  }
  meter(value) {
    this.el.meter.classList.toggle('hidden', value == null);
    if (value != null) this.el.fill.style.width = `${Math.round(clamp(value, 0, 1) * 100)}%`;
  }
  /** Run fn after `seconds` of game time (pauses with the game). */
  after(seconds, fn) {
    this._after.push({ t: this.time + seconds, fn });
  }
  tick(dt) {
    this.time += dt;
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) this.el.banner.classList.remove('show');
    }
    for (let i = this._after.length - 1; i >= 0; i--) {
      if (this._after[i].t <= this.time) this._after.splice(i, 1)[0].fn();
    }
  }
  /**
   * skill: how the solo player did, for their Skill Level (see skill.js):
   *   { kind: 'versus', outcome: 1 | 0.5 | 0, margin: 0..1 }  or  { kind: 'score', perf }
   */
  finish(rows, { unit = 'pts', title, skill } = {}) {
    if (this.over) return;
    this.over = true;
    this.sfx.fanfare();
    this.onFinish({ sport: this.title, unit, rows, title, skill: skill && { difficulty: this.difficulty, ...skill } });
  }

  /** Head-to-head result for player 0 against player 1 (the CPU in solo games), for the Skill Level. */
  versus(winner, margin = 0.5) {
    return { kind: 'versus', outcome: winner === null || winner < 0 ? 0.5 : winner === 0 ? 1 : 0, margin };
  }

  /** The crowd and the characters react to a moment. kind: 'great' | 'good' | 'bad'; who = winner's character. */
  moment(kind, { winner = null, loser = null, intensity = 0.7 } = {}) {
    if (kind === 'great' || kind === 'good') {
      this.sfx.crowdCheer(kind === 'great' ? Math.max(0.8, intensity) : intensity * 0.7);
      if (winner) react(winner, kind === 'great' ? 'cheer' : 'pump');
      if (loser) react(loser, 'sad');
    } else {
      this.sfx.crowdGroan(intensity);
      if (loser) react(loser, 'sad');
      if (winner) react(winner, 'pump');
    }
  }
  onButton() {}
  onSwing() {}
  onSwingStart() {}
  dispose() {
    this.hud.innerHTML = '';
    for (const phone of this.input.phones) phone.setStatus('');
    disposeScene(this.scene);
  }
}

/**
 * Draw several cameras into rectangles of the canvas (split screen).
 * views: [{ camera, x, y, w, h, before? }] with x/y/w/h as fractions of the canvas (y from the
 * bottom). `before()` runs just before that view is drawn (e.g. to make that player see-through).
 */
export function renderViews(renderer, scene, W, H, views) {
  renderer.setScissorTest(true);
  for (const v of views) {
    const x = Math.round(v.x * W);
    const y = Math.round(v.y * H);
    const w = Math.round(v.w * W);
    const h = Math.round(v.h * H);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    const aspect = w / h;
    if (v.camera.aspect !== aspect) {
      v.camera.aspect = aspect;
      v.camera.updateProjectionMatrix();
    }
    if (v.before) v.before();
    renderer.render(scene, v.camera);
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
}

/** Make every mesh under `obj` see-through (your own player in a behind-the-back camera). */
export function ghost(obj, opacity = 0.35) {
  const mats = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    mats.push(o.material);
  });
  /** setGhost(true) = see-through, false = solid. */
  return (on) => {
    for (const m of mats) {
      m.transparent = on;
      m.opacity = on ? opacity : 1;
      m.depthWrite = !on;
    }
  };
}

/** Free a scene's GPU resources (except shared geometry / textures used by every game). */
export function disposeScene(scene) {
  scene?.traverse((o) => {
    if (o.geometry && !o.userData.shared) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map && !m.map.userData.shared) m.map.dispose();
        m.dispose();
      }
    }
  });
}
