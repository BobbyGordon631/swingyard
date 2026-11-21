// "Yardlings" - Swingyard's original low-poly athletes, built entirely from primitives.
// Squat bean body, faceted head with two horn-ears and a dark visor with glowing eyes.
import * as THREE from 'three';

export const PLAYER_COLORS = [0xff6b4a, 0x2ec4b6, 0xffd166, 0x9b5de5];
export const PLAYER_CSS = ['#ff6b4a', '#2ec4b6', '#ffd166', '#9b5de5'];

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.02, ...extra });

export function createCharacter(color = PLAYER_COLORS[0]) {
  const group = new THREE.Group();
  const main = flat(color);
  const dark = flat(0x1b2440);
  const cream = flat(0xfdf1d6);
  const glow = new THREE.MeshBasicMaterial({ color: 0xbff8ff });

  // Legs + feet
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.36, 14), dark);
    leg.position.set(side * 0.13, 0.2, 0);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.26), cream);
    foot.position.set(side * 0.13, 0.04, -0.04);
    group.add(leg, foot);
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
  group.add(body, belly, scarf);

  // Head (faces -z, toward the action)
  const head = new THREE.Group();
  head.position.y = 1.3;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 28, 20), main);
  skull.scale.set(1.08, 0.92, 1);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.1), dark);
  visor.position.set(0, 0.02, -0.22);
  head.add(skull, visor);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), glow);
    eye.position.set(side * 0.09, 0.02, -0.275);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 14), cream);
    horn.position.set(side * 0.17, 0.26, 0.02);
    horn.rotation.z = -side * 0.35;
    head.add(eye, horn);
  }
  group.add(head);

  // Arms hang from shoulder pivots; rotation.x swings them (positive = forward toward -z).
  const makeArm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.31, 0.95, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.34, 6, 14), main);
    arm.position.y = -0.2;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), cream);
    hand.position.y = -0.44;
    pivot.add(arm, hand);
    group.add(pivot);
    return pivot;
  };
  const armR = makeArm(1);
  const armL = makeArm(-1);
  armL.rotation.z = -0.15;
  armR.rotation.z = 0.15;

  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  return { group, head, body, armR, armL, handOffsetY: -0.5 };
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
