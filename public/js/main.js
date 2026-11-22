// Swingyard shell: renderer, main menu, phone lobby, pause, results, debug overlay.
import * as THREE from 'three';
import { qrDataUrl, baseUrl } from './net/screenLink.js';
import { CONFIG } from './config.js';
import { InputManager } from './input/inputManager.js';
import { Sfx } from './audio.js';
import { DebugOverlay } from './debugOverlay.js';
import { createCharacter, animateYardlings, react, PLAYER_COLORS, PLAYER_CSS } from './characters.js';
import { feel } from './feel.js';
import { getSkill, recordSkill, performanceFor, skillGraphSvg, PRO_LEVEL } from './skill.js';
import { BowlingGame } from './games/bowling/game.js';
import { TennisGame } from './games/tennis/game.js';
import { BaseballGame } from './games/baseball/game.js';
import { GolfGame } from './games/golf/game.js';
import { BoxingGame } from './games/boxing/game.js';
import { ArcheryGame } from './games/archery/game.js';
import { SwordGame } from './games/sword/game.js';
import { setRenderer, envMap, skyDome } from './games/common.js';

// players: [min, max]. cpu: a computer opponent joins when one person plays.
// crowd: how loud the background murmur is (0 = none).
const SPORTS = [
  { id: 'bowling', title: 'Bowling', icon: '🎳', players: [1, 4], crowd: 0.35, create: (o) => new BowlingGame(o) },
  { id: 'tennis', title: 'Tennis', icon: '🎾', players: [1, 2], cpu: true, crowd: 0.45, create: (o) => new TennisGame(o) },
  { id: 'baseball', title: 'Baseball', icon: '⚾', players: [1, 2], cpu: true, crowd: 0.6, create: (o) => new BaseballGame(o) },
  { id: 'golf', title: 'Golf', icon: '⛳', players: [1, 4], crowd: 0.08, create: (o) => new GolfGame(o) },
  { id: 'boxing', title: 'Boxing', icon: '🥊', players: [1, 2], cpu: true, crowd: 0.7, create: (o) => new BoxingGame(o) },
  { id: 'archery', title: 'Archery', icon: '🏹', players: [1, 4], crowd: 0.12, create: (o) => new ArcheryGame(o) },
  { id: 'sword', title: 'Swordplay', icon: '⚔️', players: [1, 2], cpu: true, crowd: 0.4, create: (o) => new SwordGame(o) },
];
const LEVELS = ['Easy', 'Normal', 'Hard'];

const $ = (sel) => document.querySelector(sel);
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(2, window.devicePixelRatio || 1);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Filmic-but-faithful tone mapping: bright highlights roll off instead of clipping, colours stay true.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
setRenderer(renderer);

const input = new InputManager(CONFIG);
const sfx = new Sfx();
const debug = new DebugOverlay($('#debug'), input);
feel.mount($('#fx'));
const soundHint = $('#soundhint');

const app = {
  screen: 'menu', // menu | game | paused | results
  step: 'sport', // menu: sport | players | level
  sport: 0,
  players: 1,
  level: 1,
  game: null,
  choice: 0,
  choices: [],
  shownAt: 0,
};

// ----------------------------------------------------------------- d-pad nav
// Menus are driven by the phone's arrow pad (or the arrow keys). A press moves once; holding
// an arrow repeats after a short delay.
const DIRS = ['up', 'down', 'left', 'right'];
class PadNav {
  constructor() {
    this.held = new Map(); // "sourceId:dir" -> { since, last }
  }
  press(source, dir, now) {
    this.held.set(`${source.id}:${dir}`, { source, dir, since: now, last: now });
  }
  release(source, dir) {
    this.held.delete(`${source.id}:${dir}`);
  }
  /** Directions that should auto-repeat this frame. */
  repeats(now) {
    const { repeatDelayMs, repeatMs } = CONFIG.menu;
    const out = [];
    for (const h of this.held.values()) {
      if (!h.source.buttons[h.dir]) continue;
      if (now - h.since > repeatDelayMs && now - h.last > repeatMs) {
        h.last = now;
        out.push(h.dir);
      }
    }
    return out;
  }
  clear() {
    this.held.clear();
  }
}
const nav = new PadNav();

// ------------------------------------------------------------- menu scene
function buildMenuScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcdeaff);
  scene.fog = new THREE.Fog(0xcdeaff, 22, 60);
  skyDome(scene, { top: 0x5aa9f0, horizon: 0xcdeaff, radius: 90 });
  scene.environment = envMap();
  scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fc59a, 1.1));
  const sunLight = new THREE.DirectionalLight(0xfff2cc, 2.2);
  sunLight.position.set(-4, 6, 5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.radius = 4;
  sunLight.shadow.bias = -0.0005;
  Object.assign(sunLight.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
  scene.add(sunLight);

  const flat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });
  const island = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 2.6, 0.7, 9), flat(0x7ad27a));
  island.position.y = -0.35;
  island.receiveShadow = true;
  const rock = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.4, 9), flat(0xd1ad86));
  rock.position.y = -1.9;
  rock.rotation.x = Math.PI;
  scene.add(island, rock);
  for (let i = 0; i < 7; i++) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(3 + (i % 3), 3 + (i % 4), 5), flat(i % 2 ? 0x8fd69a : 0x7ccb8a));
    hill.position.set(-16 + i * 5.5, -1.2, -16 - (i % 3) * 2);
    scene.add(hill);
  }
  for (let i = 0; i < 4; i++) {
    const a = 2.5 + i * 0.95;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 5), flat(0x8a5a2b));
    trunk.position.y = 0.25;
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0, 6), flat(i % 2 ? 0x2ec4b6 : 0x3fae6a));
    top.position.y = 0.95;
    tree.add(trunk, top);
    tree.position.set(Math.cos(a) * 2.8, 0, Math.sin(a) * 2.8 - 0.4);
    scene.add(tree);
  }
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const clouds = [];
  for (let i = 0; i < 5; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + ((i + j) % 3) * 0.3, 0), cloudMat);
      puff.position.set(j * 1.2 - 1.2, (j % 2) * 0.3, 0);
      puff.scale.y = 0.55;
      cloud.add(puff);
    }
    cloud.position.set(-22 + i * 10, 8 + (i % 3) * 1.4, -24 - (i % 2) * 4);
    scene.add(cloud);
    clouds.push(cloud);
  }
  const chars = PLAYER_COLORS.map((color, i) => {
    const c = createCharacter(color);
    c.group.position.set(-1.35 + i * 0.9, 0, 0.9 - Math.abs(i - 1.5) * 0.25);
    c.group.rotation.y = Math.PI + (1.5 - i) * 0.18; // face the camera
    scene.add(c.group);
    return c;
  });
  return { scene, camera, chars, clouds };
}
const menuScene = buildMenuScene();

// ------------------------------------------------------------------ menu
const sportCards = SPORTS.map((s, i) => {
  const el = document.createElement('button');
  el.className = 'card';
  const [min, max] = s.players;
  el.innerHTML = `<div class="icon">${s.icon}</div><div class="title">${s.title}</div><div class="sub">${min === max ? min : `${min}–${max}`} players</div><div class="skill-chip"></div>`;
  el.addEventListener('click', () => {
    app.step = 'sport';
    app.sport = i;
    menuConfirm();
  });
  $('#sport-cards').append(el);
  return el;
});

/** The options for the current setup step, as [label, value] pairs. */
function stepOptions() {
  const s = SPORTS[app.sport];
  if (app.step === 'players') {
    const out = [];
    for (let n = s.players[0]; n <= s.players[1]; n++) out.push([s.cpu && n === 1 ? '1 vs CPU' : `${n}`, n]);
    return out;
  }
  if (app.step === 'level') return LEVELS.map((l, i) => [l, i]);
  return [];
}

/** Each card shows your Skill Level in that sport (once you have played it solo). */
function renderSkillChips() {
  SPORTS.forEach((s, i) => {
    const sk = getSkill(s.id);
    const chip = sportCards[i].querySelector('.skill-chip');
    chip.innerHTML = sk.games ? `${sk.pro ? '<b class="pro">PRO</b> ' : ''}Skill ${sk.level}` : '';
  });
}

function renderMenu() {
  const s = SPORTS[app.sport];
  const configuring = app.step !== 'sport';
  sportCards.forEach((el, i) => el.classList.toggle('selected', i === app.sport));
  $('#menu').classList.toggle('configuring', configuring);
  $('#setup').classList.toggle('hidden', !configuring);
  if (configuring) {
    $('#setup-title').textContent = app.step === 'players' ? `${s.title} · players` : `${s.title} · CPU level`;
    const current = app.step === 'players' ? app.players : app.level;
    const box = $('#setup-pills');
    box.innerHTML = '';
    for (const [label, value] of stepOptions()) {
      const el = document.createElement('button');
      el.className = `pill${value === current ? ' selected' : ''}`;
      el.textContent = label;
      el.addEventListener('click', () => {
        if (app.step === 'players') app.players = value;
        else app.level = value;
        menuConfirm();
      });
      box.append(el);
    }
  }
  $('#menu-hint').textContent = configuring
    ? 'Arrow pad / arrow keys to change · A / Enter to continue · big button / Esc to go back'
    : 'Arrow pad / arrow keys to choose · A / Enter to select · D shows the sensor debug view';
}

const COLS = 4; // sport cards per row

function menuMove(name) {
  const dir = name === 'up' || name === 'left' ? -1 : 1;
  if (app.step === 'sport') {
    if (name === 'left' || name === 'right') app.sport = (app.sport + dir + SPORTS.length) % SPORTS.length;
    else {
      const next = app.sport + dir * COLS;
      if (next < 0 || next >= SPORTS.length) return;
      app.sport = next;
    }
  } else {
    const values = stepOptions().map((o) => o[1]);
    const key = app.step === 'players' ? 'players' : 'level';
    const idx = Math.min(values.length - 1, Math.max(0, values.indexOf(app[key]) + dir));
    app[key] = values[idx];
  }
  sfx.move();
  renderMenu();
}

function menuConfirm() {
  const s = SPORTS[app.sport];
  sfx.confirm();
  if (app.step === 'sport') {
    // Default to the number of phones connected, within what the sport allows.
    const phones = input.phones.filter((p) => p.connected).length;
    app.players = Math.min(s.players[1], Math.max(s.players[0], phones || 1));
    app.step = 'players';
  } else if (app.step === 'players' && s.cpu && app.players === 1) {
    app.step = 'level';
  } else {
    return startGame();
  }
  renderMenu();
}

function menuBack() {
  if (app.step === 'sport') return;
  app.step = app.step === 'level' ? 'players' : 'sport';
  sfx.back();
  renderMenu();
}

function showMenu() {
  if (app.game) {
    app.game.dispose();
    app.game = null;
  }
  app.screen = 'menu';
  app.step = 'sport';
  app.shownAt = performance.now();
  app.cams = [];
  feel.reset();
  sfx.crowdBed(0);
  renderSkillChips();
  nav.clear();
  $('#menu').classList.remove('hidden');
  $('#lobby').classList.remove('hidden');
  $('#phones').classList.add('hidden');
  $('#pause').classList.add('hidden');
  $('#results').classList.add('hidden');
  for (const p of input.phones) p.setStatus('Menu: arrows + A');
  renderMenu();
}

function startGame() {
  if (app.game) app.game.dispose();
  $('#menu').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#results').classList.add('hidden');
  $('#pause').classList.add('hidden');
  $('#phones').classList.remove('hidden');
  input.recenterAll(); // you just pressed A pointing at the TV: that is "straight ahead"
  feel.reset();
  const sport = SPORTS[app.sport];
  // Solo: your Skill Level decides how many people turn up to watch. Multiplayer: a full house.
  const skill = app.players === 1 ? getSkill(sport.id).level : PRO_LEVEL;
  app.game = sport.create({
    input,
    sfx,
    hud: $('#hud'),
    playerCount: app.players,
    difficulty: app.level,
    skill,
    onFinish: showResults,
  });
  app.cams = [...new Set([app.game.camera, ...(app.game.cams || []), app.game.camBat, app.game.camPitch, app.game.camPlay].filter(Boolean))];
  app.gameTime = 0;
  sfx.crowdBed(sport.crowd * (0.5 + 0.5 * Math.min(1, skill / PRO_LEVEL)));
  // Compile every shader now, so nothing stutters the first time a ball, banner or effect appears.
  app.game.warm = () => warmUp(app.game); // games call this after building new things (a new golf hole)
  warmUp(app.game);
  fadeIn();
  app.screen = 'game';
}

/** A quick fade from white so cutting into a game (and its one-off loading frame) feels soft. */
function fadeIn() {
  const el = $('#fade');
  el.classList.remove('out');
  el.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.remove('on');
    el.classList.add('out');
  }));
}

function warmUp(game) {
  // The GPU driver finishes building a shader pipeline the first time something is actually drawn, so
  // compiling is not enough: draw one throw-away frame with everything visible (it is replaced before
  // the screen updates), through the game's own render path so split-screen / see-through variants
  // are built too. Without this, the first ball trail or the first pin hit can stall a frame.
  try {
    const cams = new Set([game.camera, ...(game.cams || []), game.camBat, game.camPitch, game.camPlay].filter(Boolean));
    const restore = [];
    game.scene.traverse((o) => {
      if (!o.visible) {
        restore.push(() => (o.visible = false));
        o.visible = true;
      }
      if (o.isInstancedMesh && o.count === 0) {
        restore.push(() => (o.count = 0));
        o.count = 1;
      }
    });
    for (const cam of cams) renderer.compile(game.scene, cam);
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (game.render) game.render(renderer, W, H);
    for (const cam of cams) renderer.render(game.scene, cam);
    for (const r of restore) r();
  } catch (err) {
    console.warn('shader warm-up skipped', err);
  }
}

// ------------------------------------------------------- pause / results
function openChoices(rootSel, labels, actions) {
  const box = $(`${rootSel} .choices`);
  box.innerHTML = '';
  app.choices = labels.map((label, i) => {
    const el = document.createElement('button');
    el.className = 'choice';
    el.textContent = label;
    el.addEventListener('click', () => actions[i]());
    box.append(el);
    return { el, run: actions[i] };
  });
  app.choice = 0;
  app.shownAt = performance.now();
  nav.clear();
  renderChoices();
  $(rootSel).classList.remove('hidden');
}
function renderChoices() {
  app.choices.forEach((c, i) => c.el.classList.toggle('selected', i === app.choice));
}

function pauseGame() {
  if (app.screen !== 'game') return;
  app.screen = 'paused';
  sfx.rollStop();
  sfx.back();
  openChoices('#pause', ['Resume', 'Quit to menu'], [resumeGame, showMenu]);
}
function resumeGame() {
  if (app.screen !== 'paused') return;
  $('#pause').classList.add('hidden');
  app.screen = 'game';
  sfx.confirm();
}

function showResults(res) {
  app.screen = 'results';
  const top = res.rows[0];
  const tie = res.rows.length > 1 && res.rows[1].score === top.score;
  $('#results-title').textContent = res.title || (res.rows.length === 1 ? `${res.sport} — final score` : tie ? "It's a tie!" : `${top.name} wins!`);
  let place = 0;
  $('#results-rows').innerHTML = res.rows
    .map((r, i) => {
      if (i === 0 || r.score !== res.rows[i - 1].score) place = i + 1;
      return `<div class="result-row${place === 1 ? ' winner' : ''}" style="--pc:${r.css}">
        <div class="place">${place}</div><div>${r.name}</div><div class="score">${r.score} ${res.unit}</div></div>`;
    })
    .join('');
  for (const p of input.phones) p.setStatus('Game over');
  input.vibrateAll([60, 50, 60]);
  showSkill(res);
  openChoices('#results', ['Play again', 'Main menu'], [startGame, showMenu]);
  // A win gets a little party.
  const humanWon = !tie && res.rows.length > 1 && !/^CPU/.test(top.name);
  if (humanWon || res.rows.length === 1) feel.confetti(humanWon ? 90 : 40);
  sfx.crowdCheer(humanWon ? 0.9 : 0.5);
}

/** Rate a solo game and show the Skill Level change, counting up from the old value. */
let skillAnim = 0;
function showSkill(res) {
  const box = $('#results-skill');
  cancelAnimationFrame(skillAnim);
  const sport = SPORTS[app.sport];
  if (!res.skill || app.players !== 1) {
    box.classList.add('hidden');
    return;
  }
  const result = res.skill.kind === 'score' ? { kind: 'score', perf: performanceFor(sport.id, res.skill.value, res.skill) } : res.skill;
  const r = recordSkill(sport.id, result);
  const up = r.delta >= 0;
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="skill-head">
      <span class="skill-label">${sport.title} Skill Level</span>
      <span class="skill-num">${r.before}</span>
      <span class="skill-delta ${up ? 'up' : 'down'}">${up ? '▲ +' : '▼ '}${r.delta}</span>
      ${r.pro ? '<span class="skill-pro">PRO</span>' : ''}
    </div>
    ${skillGraphSvg(r.history, { color: up ? '#2ec4b6' : '#ff6b4a' })}
    ${r.newPro ? '<div class="skill-newpro">You reached Pro!</div>' : ''}`;
  const num = box.querySelector('.skill-num');
  const t0 = performance.now() + 450;
  const step = () => {
    const k = Math.min(1, Math.max(0, (performance.now() - t0) / 1100));
    num.textContent = Math.round(r.before + (r.after - r.before) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) skillAnim = requestAnimationFrame(step);
    else {
      num.classList.add('bump');
      sfx.levelUp(up);
      if (r.newPro) {
        feel.celebrate('PRO!', { color: '#ffd166', size: 'huge', confetti: 140, sub: `${sport.title} Skill Level ${r.after}` });
        sfx.fanfare();
      }
    }
  };
  skillAnim = requestAnimationFrame(step);
}

// ------------------------------------------------------------------ input
function choiceMove(name) {
  const dir = name === 'up' || name === 'left' ? -1 : 1;
  app.choice = Math.min(app.choices.length - 1, Math.max(0, app.choice + dir));
  sfx.move();
  renderChoices();
}

function navigate(name) {
  if (app.screen === 'menu') menuMove(name);
  else if (app.screen === 'paused' || app.screen === 'results') choiceMove(name);
}

input.on('button', (source, name, down) => {
  sfx.unlock();
  if (DIRS.includes(name) && app.screen !== 'game') {
    if (down) {
      nav.press(source, name, performance.now());
      navigate(name);
    } else nav.release(source, name);
    return;
  }
  if (app.screen === 'game') {
    if (name === 'pause') {
      if (down) pauseGame();
    } else app.game.onButton(source, name, down);
    return;
  }
  if (!down) return;
  const settled = performance.now() - app.shownAt > 500; // ignore presses carried over from the previous screen
  if (app.screen === 'menu') {
    if (name === 'a') menuConfirm();
    else if (name === 'hold' || name === 'pause') menuBack();
  } else if (app.screen === 'paused') {
    if (name === 'pause') resumeGame();
    else if (name === 'a' && settled) app.choices[app.choice].run();
  } else if (app.screen === 'results') {
    if (name === 'a' && settled) app.choices[app.choice].run();
  }
});
input.on('swing', (source, swing) => {
  if (app.screen === 'game' && app.game.onSwing) app.game.onSwing(source, swing);
});
input.on('swingstart', (source, info) => {
  if (app.screen === 'game' && app.game.onSwingStart) app.game.onSwingStart(source, info);
});

input.on('join', (phone) => {
  sfx.join();
  toast(`Player ${phone.slot + 1}'s phone connected`);
  phone.vibrate(60);
  if (app.screen === 'menu') react(menuScene.chars[phone.slot], 'wave'); // say hello
  if (app.screen === 'menu') phone.setStatus('Menu: arrows + A');
  renderBadges();
});
input.on('leave', (phone) => {
  toast(`Player ${phone.slot + 1}'s phone disconnected`);
  renderBadges();
});

function renderBadges() {
  const html = input.phones
    .map((p, i) => `<div class="badge${p.connected ? ' on' : ''}" style="--pc:${PLAYER_CSS[i]}">P${i + 1}</div>`)
    .join('');
  $('#badges').innerHTML = html;
  $('#phones').innerHTML = html;
}

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

window.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (e.code === 'KeyD') debug.toggle();
  else if (debug.visible && /^Digit[0-4]$/.test(e.code)) debug.pin(e.code.slice(5));
});
window.addEventListener('pointerdown', () => sfx.unlock());

// ------------------------------------------------------------------ lobby
// LAN mode: the server tells us its Wi-Fi address (it can change, so it is polled while the menu
// is open). Online mode: the QR code opens the phone page for this screen's room.
let lobbyUrl;
const LAN_STEPS = ['Join the same Wi-Fi as this computer', 'Scan the code and accept the certificate warning', 'Tap <b>Connect</b> and allow motion'];
const ONLINE_STEPS = ['Scan the code with your phone (same Wi-Fi works best)', 'Or open the address below and type the room code', 'Tap <b>Connect</b> and allow motion'];
function showLobby(url, steps, extra = '') {
  $('#lobby-steps').innerHTML = steps.map((s) => `<li>${s}</li>`).join('');
  if (url === lobbyUrl && !extra) return;
  lobbyUrl = url;
  $('#qr-wrap').classList.toggle('hidden', !url);
  if (url) $('#qr').src = qrDataUrl(url) || '';
  $('#controller-url').innerHTML = extra || (url ? url : '');
}
async function loadLobby() {
  const link = input.link;
  if (!link) return;
  if (link.mode === 'online') {
    if (link.error && !link.online) showLobby(null, ONLINE_STEPS, link.error);
    else if (!link.online) showLobby(null, ONLINE_STEPS, 'Opening a room…');
    else {
      const short = `${baseUrl()}controller.html`;
      showLobby(link.controllerUrl, ONLINE_STEPS, `Room <b class="room-code">${link.room}</b><br>${short.replace(/^https?:\/\//, '')}`);
    }
    return;
  }
  try {
    const info = await (await fetch('api/info', { cache: 'no-store' })).json();
    if (info.controllerUrl) showLobby(info.controllerUrl, LAN_STEPS);
    else showLobby(null, LAN_STEPS, 'No Wi-Fi address found. Connect this computer to Wi-Fi - this will update by itself.');
  } catch {
    lobbyUrl = undefined;
    $('#controller-url').textContent = 'Could not reach the server. Is `npm start` still running?';
  }
}
input.on('room', () => loadLobby());
setInterval(() => {
  if (app.screen === 'menu' && input.link?.mode === 'lan') loadLobby();
}, 4000);

// ------------------------------------------------------------------- loop
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
const gaps = [];
let lastDropAt = -Infinity;
let lastScaleAt = last + 3000;
const MAX_PR = Math.min(2, window.devicePixelRatio || 1);
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  // Keep the frame rate up. Count frames that missed the display's refresh; if more than 10% of the last
  // ~2.5 s were late, render fewer pixels. Only go back up after a long clean stretch, so it never
  // flip-flops (every change reallocates the framebuffers, which is itself a hitch).
  const gap = now - last;
  gaps.push(gap);
  if (gaps.length > 240) gaps.shift();
  if (now - lastScaleAt > 2500 && gaps.length >= 120 && document.visibilityState === 'visible') {
    const sorted = [...gaps].sort((x, y) => x - y);
    const refresh = sorted[Math.floor(sorted.length * 0.25)]; // typical good frame
    const late = gaps.filter((g) => g > refresh * 1.6 && g > 12).length / gaps.length;
    lastScaleAt = now;
    if (late > 0.1 && pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      lastDropAt = now;
      renderer.setPixelRatio(pixelRatio);
      resize();
      gaps.length = 0;
    } else if (late < 0.01 && pixelRatio < MAX_PR && now - lastDropAt > 20000) {
      pixelRatio = Math.min(MAX_PR, pixelRatio + 0.25);
      lastDropAt = now; // wait another 20 s before stepping up again
      renderer.setPixelRatio(pixelRatio);
      resize();
      gaps.length = 0;
    }
  }
  last = now;
  input.update(now);

  if (app.screen !== 'game') for (const dir of nav.repeats(now)) navigate(dir);
  if (app.game && app.screen !== 'paused') {
    // Hit-stop freezes the game for a few frames; slow motion stretches a big moment.
    const gdt = feel.step(dt);
    if (gdt > 0) {
      app.game.update(gdt);
      app.gameTime += gdt;
      animateYardlings(app.game.scene, gdt, app.gameTime);
    }
  }

  let scene, camera;
  if (app.game) {
    scene = app.game.scene;
    camera = app.game.camera;
  } else {
    const t = now / 1000;
    scene = menuScene.scene;
    camera = menuScene.camera;
    camera.position.set(Math.sin(t * 0.15) * 0.4 - 0.4, 2.2, 9.5);
    camera.lookAt(-0.4, 2.9, 0);
    for (const cloud of menuScene.clouds) {
      cloud.position.x += dt * 0.25;
      if (cloud.position.x > 28) cloud.position.x = -28;
    }
    const maxPlayers = SPORTS[app.sport].players[1];
    menuScene.chars.forEach((c, i) => {
      c.group.visible = app.step === 'sport' ? i < maxPlayers : i < app.players;
      c.group.position.y = Math.abs(Math.sin(t * 2.2 + i * 1.3)) * (input.phones[i].connected ? 0.16 : 0.04);
      if (!c.anim.react) {
        c.armR.rotation.x = input.phones[i].connected ? 2.6 + Math.sin(t * 7 + i) * 0.35 : 0.1;
        c.armL.rotation.x = Math.sin(t * 1.5 + i) * 0.15;
      }
    });
    animateYardlings(menuScene.scene, dt, t);
  }
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (app.game) feel.apply(app.cams);
  if (app.game && app.game.render) {
    // Games that draw more than one view (split screen) render themselves.
    app.game.render(renderer, W, H);
  } else {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    const aspect = W / H;
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  }
  if (app.game) feel.restore();
  debug.draw(now);
  const ready = sfx.ready;
  if (ready !== app.soundReady) {
    app.soundReady = ready;
    soundHint.classList.toggle('hidden', ready);
  }
}

input.attach(window, canvas);
renderBadges();
loadLobby();
showMenu();
requestAnimationFrame(frame);

// Handy for poking at things from the browser console (and for automated checks).
window.swingyard = { app, input, sfx, CONFIG, SPORTS, renderer };
