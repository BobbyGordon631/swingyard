// "Yardlings" - Swingyard's original low-poly athletes, built entirely from primitives.
// Squat bean body, faceted head with two horn-ears and a dark visor with glowing eyes.
import * as THREE from 'three';

export const PLAYER_COLORS = [0xff6b4a, 0x2ec4b6, 0xffd166, 0x9b5de5];
export const PLAYER_CSS = ['#ff6b4a', '#2ec4b6', '#ffd166', '#9b5de5'];

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.02, ...extra });

// Shared geometry: every Yardling is built from the same handful of shapes (fewer GPU uploads when a
// game with a crowd of characters starts). Marked shared so disposeScene() leaves them alone.
const GEO = {};
function geo(key, make) {
  if (!GEO[key]) {
    GEO[key] = make();
    GEO[key].userData.shared = true;
  }
  return GEO[key];
}

export function createCharacter(color = PLAYER_COLORS[0]) {
  const group = new THREE.Group();
  // Everything hangs off an inner rig: games move and turn `group` (and swing the arms); the idle and
  // reaction animation (animateYardlings) bobs and leans `rig`, so the two never fight.
  const rig = new THREE.Group();
  group.add(rig);
  const main = flat(color);
  const dark = flat(0x1b2440);
  const cream = flat(0xfdf1d6);
  const glow = new THREE.MeshBasicMaterial({ color: 0xbff8ff });
  const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff9d8a, transparent: true, opacity: 0.55, depthWrite: false });

  // Legs + feet
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(geo('leg', () => new THREE.CylinderGeometry(0.075, 0.065, 0.36, 14)), dark);
    leg.position.set(side * 0.13, 0.2, 0);
    // Rounded sneakers rather than boxes.
    const foot = new THREE.Mesh(geo('foot', () => new THREE.CapsuleGeometry(0.075, 0.12, 4, 12).rotateX(Math.PI / 2)), cream);
    foot.position.set(side * 0.13, 0.06, -0.05);
    foot.scale.set(1.05, 0.75, 1);
    rig.add(leg, foot);
  }

  // Body
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.3, 8, 24), main);
  body.position.y = 0.72;
  body.scale.set(1, 1, 0.82);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), cream);
  belly.position.set(0, 0.66, -0.12);
  belly.scale.set(0.9, 1, 0.5);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 10, 28), cream);
  scarf.position.y = 1.02;
  scarf.rotation.x = Math.PI / 2;
  rig.add(body, belly, scarf);

  // Head (faces -z, toward the action). Big and round, so it reads from across a court.
  const head = new THREE.Group();
  head.position.y = 1.3;
  const skull = new THREE.Mesh(geo('skull', () => new THREE.SphereGeometry(0.27, 32, 24)), main);
  skull.scale.set(1.08, 0.92, 1);
  // A rounded visor that wraps the face, with soft pill-shaped eyes that blink and squint.
  const visor = new THREE.Mesh(geo('visor', () => new THREE.CapsuleGeometry(0.075, 0.24, 6, 16).rotateZ(Math.PI / 2)), dark);
  visor.position.set(0, 0.02, -0.215);
  visor.scale.set(1, 1, 0.75);
  head.add(skull, visor);
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(geo('eye', () => new THREE.CapsuleGeometry(0.026, 0.03, 4, 10)), glow);
    eye.position.set(side * 0.09, 0.022, -0.27);
    eye.scale.z = 0.4;
    const cheek = new THREE.Mesh(geo('cheek', () => new THREE.CircleGeometry(0.045, 16)), cheekMat);
    cheek.position.set(side * 0.16, -0.09, -0.235);
    cheek.rotation.set(0, Math.PI + side * 0.6, 0);
    const horn = new THREE.Mesh(geo('horn', () => new THREE.ConeGeometry(0.08, 0.24, 14)), cream);
    horn.position.set(side * 0.17, 0.26, 0.02);
    horn.rotation.z = -side * 0.35;
    head.add(eye, cheek, horn);
    eyes.push(eye);
  }
  rig.add(head);

  // Arms hang from shoulder pivots; rotation.x swings them (positive = forward toward -z).
  const makeArm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.31, 0.95, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.34, 6, 14), main);
    arm.position.y = -0.2;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), cream);
    hand.position.y = -0.44;
    pivot.add(arm, hand);
    rig.add(pivot);
    return pivot;
  };
  const armR = makeArm(1);
  const armL = makeArm(-1);
  armL.rotation.z = -0.15;
  armR.rotation.z = 0.15;

  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material !== cheekMat) o.castShadow = true;
    if (o.geometry.userData.shared) o.userData.shared = true; // disposeScene() keeps shared geometry
  });

  const char = {
    group, rig, head, body, armR, armL, eyes, handOffsetY: -0.5,
    anim: { phase: Math.random() * 10, blink: 1 + Math.random() * 3, blinkT: 0, react: null },
  };
  group.userData.yardling = char;
  return char;
}

// ------------------------------------------------------------------ life
// Idle life (breathing, blinking) and reactions (cheer, sad, hit, wave) for every Yardling in a scene.
// main.js calls animateYardlings() after the game's own update, so reactions win over a game's arm
// poses while they play, and hand the arms back afterwards.

const REACT_LEN = { cheer: 1.8, sad: 1.8, hit: 0.35, wave: 1.4, pump: 0.9 };

/** Play a reaction: 'cheer' (jump, arms up), 'pump' (quick fist pump), 'sad' (slump), 'hit' (recoil), 'wave'. */
export function react(char, kind, seconds = REACT_LEN[kind] || 1.5) {
  if (!char || !char.anim) return;
  const a = char.anim;
  const keep = a.react && a.react.kind === kind ? a.react : null;
  a.react = {
    kind,
    t: keep ? Math.min(keep.t, 0.15) : 0,
    len: seconds,
    // What the arms were before (if the game stops posing them, we put them back).
    base: keep ? keep.base : [char.armR.rotation.x, char.armR.rotation.z, char.armL.rotation.x, char.armL.rotation.z],
    wrote: null,
  };
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function poseArm(arm, idx, r, env, x, z) {
  // If the game wrote the arm since our last frame, blend from its pose; otherwise from the saved one.
  const wrote = r.wrote;
  const gameX = wrote && Math.abs(arm.rotation.x - wrote[idx]) > 1e-5 ? arm.rotation.x : r.base[idx];
  const gameZ = wrote && Math.abs(arm.rotation.z - wrote[idx + 1]) > 1e-5 ? arm.rotation.z : r.base[idx + 1];
  arm.rotation.x = gameX + (x - gameX) * env;
  arm.rotation.z = gameZ + (z - gameZ) * env;
}

function animateOne(c, dt, time) {
  const a = c.anim;
  // Breathing: a slow squash of the body (bigger when cheering).
  const br = Math.sin(time * 2.1 + a.phase);
  c.body.scale.set(1 - br * 0.008, 1 + br * 0.018, 0.82);
  // Blinking every few seconds.
  a.blink -= dt;
  let eyeY = 1;
  if (a.blink < 0) {
    a.blinkT += dt;
    eyeY = a.blinkT < 0.07 ? 1 - a.blinkT / 0.07 : a.blinkT < 0.14 ? (a.blinkT - 0.07) / 0.07 : 1;
    eyeY = Math.max(0.12, eyeY);
    if (a.blinkT >= 0.14) {
      a.blink = 1.8 + Math.random() * 3.5;
      a.blinkT = 0;
    }
  }

  const r = a.react;
  let rigY = 0;
  let rigX = 0;
  let rigZ = 0;
  let headX = 0;
  if (r) {
    r.t += dt;
    const env = smooth(r.t / 0.12) * smooth((r.len - r.t) / 0.3);
    const t = r.t;
    if (r.kind === 'cheer') {
      // Hop on the spot with both arms up, waving.
      rigY = Math.abs(Math.sin(t * 8.5)) * 0.22 * env;
      poseArm(c.armR, 0, r, env, 2.85 + Math.sin(t * 14) * 0.25, 0.5);
      poseArm(c.armL, 2, r, env, 2.85 + Math.sin(t * 14 + 1.5) * 0.25, -0.5);
      eyeY = Math.min(eyeY, 1 - 0.6 * env); // happy squint
      headX = 0.18 * env;
    } else if (r.kind === 'pump') {
      const k = Math.sin(Math.min(1, t / 0.25) * Math.PI * 0.5);
      poseArm(c.armR, 0, r, env, 2.2 + Math.sin(t * 16) * 0.35 * k, 0.15);
      rigY = Math.abs(Math.sin(t * 7)) * 0.08 * env;
      eyeY = Math.min(eyeY, 1 - 0.5 * env);
    } else if (r.kind === 'sad') {
      // Slump forward, head down, arms hanging, a slow sigh.
      rigX = -0.16 * env;
      headX = -0.42 * env;
      rigZ = Math.sin(t * 2) * 0.05 * env;
      poseArm(c.armR, 0, r, env, -0.05, 0.08);
      poseArm(c.armL, 2, r, env, -0.05, -0.08);
      eyeY = Math.min(eyeY, 1 - 0.55 * env);
    } else if (r.kind === 'hit') {
      // Snap back and recover.
      const k = Math.exp(-t * 12) * (1 - Math.exp(-t * 60));
      rigX = 0.35 * k;
      headX = 0.35 * k;
      eyeY = Math.min(eyeY, 1 - 0.85 * smooth(1 - t / r.len));
    } else if (r.kind === 'wave') {
      poseArm(c.armR, 0, r, env, 2.7, 0.35 + Math.sin(t * 12) * 0.45);
      headX = 0.08 * env;
    }
    r.wrote = [c.armR.rotation.x, c.armR.rotation.z, c.armL.rotation.x, c.armL.rotation.z];
    if (r.t >= r.len) {
      // Hand the arms back exactly as they were (unless the game is posing them itself).
      if (r.wrote[0] === c.armR.rotation.x) {
        c.armR.rotation.x = r.base[0];
        c.armR.rotation.z = r.base[1];
      }
      if (r.wrote[2] === c.armL.rotation.x) {
        c.armL.rotation.x = r.base[2];
        c.armL.rotation.z = r.base[3];
      }
      a.react = null;
    }
  }
  c.rig.position.y = rigY;
  c.rig.rotation.x = rigX;
  c.rig.rotation.z = rigZ;
  c.head.rotation.x = headX;
  c.eyes[0].scale.y = eyeY;
  c.eyes[1].scale.y = eyeY;
}

/** Animate every Yardling in `scene` (found once a second, so characters added later are picked up). */
export function animateYardlings(scene, dt, time) {
  if (!scene) return;
  const ud = scene.userData;
  if (!ud.yardlings || (ud._yardScan -= dt) < 0) {
    const list = [];
    scene.traverse((o) => {
      if (o.userData.yardling) list.push(o.userData.yardling);
    });
    ud.yardlings = list;
    ud._yardScan = 1;
  }
  for (const c of ud.yardlings) if (c.group.visible) animateOne(c, dt, time);
}

/**
 * Give a character some gear. Hand-held things continue down the arm (local -y from the hand),
 * so swinging the arm swings the prop.
 */
export function addProp(char, kind, color = 0xfdf1d6) {
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.6, ...extra });
  const g = new THREE.Group();
  g.position.y = -0.46;
  let arm = char.armR;
  if (kind === 'racket') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.3, 6), mat(0x1d2b4f));
    handle.position.y = -0.15;
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 5, 12), mat(color));
    head.position.y = -0.45;
    head.scale.set(0.85, 1.15, 1);
    const strings = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    strings.position.y = -0.45;
    strings.scale.set(0.85, 1.15, 1);
    g.add(handle, head, strings);
  } else if (kind === 'bat') {
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, 0.85, 7), mat(0xd9a45b));
    bat.position.y = -0.42;
    g.add(bat);
  } else if (kind === 'club') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 5), mat(0x9aa7bd));
    shaft.position.y = -0.37;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.14), mat(0x1d2b4f));
    head.position.set(0, -0.75, -0.05);
    g.add(shaft, head);
  } else if (kind === 'sword') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.03), mat(color, { roughness: 0.3 }));
    blade.position.y = -0.55;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.06), mat(0x1d2b4f));
    guard.position.y = -0.06;
    g.add(blade, guard);
  } else if (kind === 'gloves') {
    for (const a of [char.armR, char.armL]) {
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.3 }));
      glove.position.y = -0.46;
      glove.castShadow = true;
      a.add(glove);
    }
    return null;
  } else if (kind === 'bow') {
    arm = char.armL;
    const limb = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.018, 5, 14, Math.PI * 0.9), mat(0x8a5a2b));
    limb.rotation.set(0, Math.PI / 2, Math.PI * 0.55);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.08, 4), mat(0xffffff));
    string.position.z = 0.09;
    string.rotation.x = Math.PI / 2;
    g.rotation.x = Math.PI / 2;
    g.add(limb, string);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  arm.add(g);
  return g;
}
