// The alley monitor: over-the-top cartoon celebrations after a strike, spare, split, gutter or miss, like the
// screens above a real bowling lane. Everything is drawn live on a 2D canvas: no images, all original.
//
//   const screen = new AlleyScreen(hudElement, sfx);
//   const seconds = screen.play('strike', { streak: 2 });   // returns how long it runs
//   screen.update(dt);                                       // every frame
//   screen.skip();                                           // stop early
//
// Kinds: 'strike' (picks one of several cartoons; streak 2 = Double, 3 = Turkey, 4+ = a parade, 12 =
// Perfect game), 'spare', 'split', 'gutter', 'miss'.

const W = 960;
const H = 540;
const GROUND = 440;
const INK = '#1f2a44';
const PIN_RED = '#ff4d5e';
const PLAYER = ['#ff6b4a', '#2ec4b6', '#ffd166', '#9b5de5'];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const easeIn = (t) => Math.pow(clamp01(t), 3);
const easeOutBack = (t) => {
  t = clamp01(t);
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ drawing kit
function rays(g, cx, cy, t, n, bg, fg, speed = 0.4) {
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(cx, cy);
  g.rotate(t * speed);
  g.fillStyle = fg;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 1400, a, a + Math.PI / n);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function floor(g, color = '#e9c79a', line = '#d4ab78') {
  g.fillStyle = color;
  g.fillRect(0, GROUND, W, H - GROUND);
  g.strokeStyle = line;
  g.lineWidth = 3;
  for (let x = -40; x < W + 40; x += 48) {
    g.beginPath();
    g.moveTo(x, GROUND);
    g.lineTo(x - 30, H);
    g.stroke();
  }
  g.fillStyle = 'rgba(31,42,68,0.25)';
  g.fillRect(0, GROUND, W, 5);
}

function star(g, x, y, r, color, rot = 0, points = 5) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = Math.max(2, r * 0.12);
  g.strokeStyle = INK;
  g.stroke();
  g.restore();
}

/** Pin outline in pin units: base at y = 0, top at y = -1, about 0.52 wide at the belly. */
function pinPath(g) {
  g.beginPath();
  g.moveTo(-0.15, 0);
  g.bezierCurveTo(-0.3, -0.13, -0.29, -0.48, -0.1, -0.66);
  g.bezierCurveTo(-0.06, -0.71, -0.19, -0.79, -0.15, -0.9);
  g.bezierCurveTo(-0.11, -1.03, 0.11, -1.03, 0.15, -0.9);
  g.bezierCurveTo(0.19, -0.79, 0.06, -0.71, 0.1, -0.66);
  g.bezierCurveTo(0.29, -0.48, 0.3, -0.13, 0.15, 0);
  g.closePath();
}

/**
 * A cartoon pin. (x, y) = the pin's middle; size = height in px.
 * o: { eyes: 'open'|'wide'|'x'|'happy'|'closed'|'look', look: -1..1, mouth: 'smile'|'o'|'grin'|'frown'|'flat'|'whistle',
 *      legs: phase|null, arm: angle|null (a waving arm), sweat: bool, flame: 0..1 }
 */
function pin(g, x, y, size, rot = 0, o = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(size, size);
  g.translate(0, 0.5);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // legs (behind the body)
  if (o.legs != null) {
    g.strokeStyle = INK;
    g.lineWidth = 0.045;
    for (const s of [-1, 1]) {
      const sw = Math.sin(o.legs + (s > 0 ? Math.PI : 0)) * 0.12;
      g.beginPath();
      g.moveTo(s * 0.07, -0.02);
      g.lineTo(s * 0.07 + sw, 0.2);
      g.stroke();
      g.fillStyle = INK;
      g.beginPath();
      g.ellipse(s * 0.07 + sw + 0.03, 0.21, 0.06, 0.03, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (o.flame) {
    const f = o.flame;
    g.fillStyle = '#ffb703';
    g.beginPath();
    g.moveTo(-0.12, 0);
    g.quadraticCurveTo(0, 0.55 * f + Math.random() * 0.1, 0.12, 0);
    g.fill();
    g.fillStyle = '#ff5d3a';
    g.beginPath();
    g.moveTo(-0.07, 0);
    g.quadraticCurveTo(0, 0.32 * f + Math.random() * 0.06, 0.07, 0);
    g.fill();
  }
  pinPath(g);
  g.fillStyle = '#ffffff';
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = '#e8ecf3';
  g.fillRect(0.06, -1.1, 0.3, 1.2); // a little shading down one side
  g.fillStyle = PIN_RED;
  g.fillRect(-0.4, -0.665, 0.8, 0.045);
  g.fillRect(-0.4, -0.6, 0.8, 0.045);
  g.restore();
  pinPath(g);
  g.lineWidth = 0.04;
  g.strokeStyle = INK;
  g.stroke();
  // waving arm
  if (o.arm != null) {
    g.save();
    g.translate(0.2, -0.42);
    g.rotate(o.arm);
    g.strokeStyle = INK;
    g.lineWidth = 0.04;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0.22, 0);
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0.25, 0, 0.045, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }
  // face
  const ey = -0.865;
  const eyes = o.eyes || 'open';
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineWidth = 0.022;
  for (const s of [-1, 1]) {
    const ex = s * 0.055;
    if (eyes === 'open' || eyes === 'look') {
      g.beginPath();
      g.arc(ex + (o.look || 0) * 0.015, ey, 0.026, 0, Math.PI * 2);
      g.fill();
    } else if (eyes === 'wide') {
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(ex, ey, 0.05, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = INK;
      g.beginPath();
      g.arc(ex + (o.look || 0) * 0.02, ey, 0.02, 0, Math.PI * 2);
      g.fill();
    } else if (eyes === 'x') {
      g.beginPath();
      g.moveTo(ex - 0.025, ey - 0.025);
      g.lineTo(ex + 0.025, ey + 0.025);
      g.moveTo(ex + 0.025, ey - 0.025);
      g.lineTo(ex - 0.025, ey + 0.025);
      g.stroke();
    } else if (eyes === 'happy') {
      g.beginPath();
      g.arc(ex, ey + 0.012, 0.025, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(ex - 0.025, ey);
      g.lineTo(ex + 0.025, ey);
      g.stroke();
    }
  }
  const my = -0.79;
  const mouth = o.mouth || 'smile';
  g.beginPath();
  if (mouth === 'smile') g.arc(0, my - 0.02, 0.04, Math.PI * 0.15, Math.PI * 0.85);
  else if (mouth === 'grin') {
    g.arc(0, my - 0.025, 0.055, 0, Math.PI);
    g.closePath();
    g.fillStyle = INK;
    g.fill();
  } else if (mouth === 'o') {
    g.arc(0, my, 0.022, 0, Math.PI * 2);
    g.fillStyle = INK;
    g.fill();
  } else if (mouth === 'whistle') g.arc(0.03, my, 0.014, 0, Math.PI * 2);
  else if (mouth === 'frown') g.arc(0, my + 0.03, 0.035, Math.PI * 1.15, Math.PI * 1.85);
  else {
    g.moveTo(-0.03, my);
    g.lineTo(0.03, my);
  }
  g.stroke();
  if (o.sweat) {
    g.fillStyle = '#7fd3ff';
    g.beginPath();
    g.moveTo(0.17, -0.97);
    g.quadraticCurveTo(0.24, -0.88, 0.17, -0.85);
    g.quadraticCurveTo(0.11, -0.88, 0.17, -0.97);
    g.fill();
  }
  g.restore();
}

/** A bowling ball. o: { color, face: bool, mood: 'grin'|'sad'|'cool'|'oops', shades, holes rotation via rot } */
function ball(g, x, y, r, rot = 0, o = {}) {
  const c = o.color || '#2a7de1';
  g.save();
  g.translate(x, y);
  const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, c);
  grad.addColorStop(1, shade(c, -0.45));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(3, r * 0.07);
  g.strokeStyle = INK;
  g.stroke();
  // finger holes spin with the ball
  g.save();
  g.rotate(rot);
  g.fillStyle = INK;
  for (const [hx, hy, hr] of [[0.22, -0.42, 0.11], [0.46, -0.2, 0.11], [0.3, 0.08, 0.13]]) {
    g.beginPath();
    g.arc(hx * r, hy * r, hr * r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  if (o.face) {
    const mood = o.mood || 'grin';
    if (o.shades || mood === 'cool') {
      g.fillStyle = INK;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(s * r * 0.3, -r * 0.18, r * 0.26, r * 0.17, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillRect(-r * 0.1, -r * 0.24, r * 0.2, r * 0.06);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillRect(-r * 0.45, -r * 0.27, r * 0.12, r * 0.05);
    } else {
      for (const s of [-1, 1]) {
        g.fillStyle = '#fff';
        g.beginPath();
        g.ellipse(s * r * 0.28, -r * 0.18, r * 0.16, r * (mood === 'oops' ? 0.2 : 0.18), 0, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = r * 0.05;
        g.stroke();
        g.fillStyle = INK;
        g.beginPath();
        g.arc(s * r * 0.28 + r * 0.04, -r * (mood === 'sad' ? 0.12 : 0.17), r * 0.07, 0, Math.PI * 2);
        g.fill();
      }
      if (mood === 'sad') {
        g.lineWidth = r * 0.05;
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(s * r * 0.42, -r * 0.42);
          g.lineTo(s * r * 0.14, -r * 0.34);
          g.stroke();
        }
      }
    }
    g.lineWidth = r * 0.07;
    g.strokeStyle = INK;
    g.beginPath();
    if (mood === 'sad') g.arc(0, r * 0.38, r * 0.2, Math.PI * 1.15, Math.PI * 1.85);
    else if (mood === 'oops') {
      g.arc(0, r * 0.25, r * 0.09, 0, Math.PI * 2);
    } else {
      g.arc(0, r * 0.08, r * 0.33, Math.PI * 0.15, Math.PI * 0.85);
    }
    g.stroke();
  }
  g.restore();
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (k < 0 ? v * k : (255 - v) * k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Big bouncing lettering: each letter lands on its own beat. k = seconds since it started. */
function word(g, text, cx, cy, size, k, color = '#ff6b4a', fill = '#ffffff') {
  if (k < 0) return;
  g.save();
  g.font = `italic 900 ${size}px "Arial Black", "Avenir Next", system-ui, sans-serif`;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  let total = g.measureText(text).width;
  if (total > W * 0.88) {
    // Too wide for the screen: shrink to fit.
    size *= (W * 0.88) / total;
    g.font = `italic 900 ${size}px "Arial Black", "Avenir Next", system-ui, sans-serif`;
    total = g.measureText(text).width;
  }
  let x = cx - total / 2;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const w = g.measureText(ch).width;
    const t = clamp01((k - i * 0.045) / 0.38);
    if (t > 0) {
      const s = easeOutBack(t);
      const wob = Math.sin(k * 6 + i * 0.8) * size * 0.02 * clamp01(k - 0.6);
      g.save();
      g.translate(x + w / 2, cy + wob + (1 - s) * size * 0.4);
      g.scale(s, s);
      g.rotate((1 - t) * -0.3);
      g.lineWidth = size * 0.17;
      g.strokeStyle = INK;
      g.fillStyle = color;
      g.fillText(ch, -w / 2, size * 0.09);
      g.strokeText(ch, -w / 2, size * 0.09);
      g.strokeText(ch, -w / 2, 0);
      g.fillStyle = fill;
      g.fillText(ch, -w / 2, 0);
      g.restore();
    }
    x += w;
  }
  g.restore();
}

function bubble(g, x, y, text, size = 34, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
  const w = g.measureText(text).width + size * 0.9;
  const h = size * 1.5;
  g.fillStyle = '#fff';
  g.strokeStyle = INK;
  g.lineWidth = 4;
  g.beginPath();
  if (g.roundRect) g.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  else g.rect(x - w / 2, y - h / 2, w, h); // older browsers
  g.moveTo(x - 8, y + h / 2 - 2);
  g.lineTo(x - 18, y + h / 2 + 16);
  g.lineTo(x + 6, y + h / 2 - 2);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y + 2);
  g.restore();
}

function speedLines(g, x, y, len, n, alpha = 0.7) {
  g.save();
  g.strokeStyle = `rgba(255,255,255,${alpha})`;
  g.lineCap = 'round';
  g.lineWidth = 6;
  for (let i = 0; i < n; i++) {
    const yy = y - 50 + (i / (n - 1 || 1)) * 100;
    g.beginPath();
    g.moveTo(x - 40 - (i % 2) * 30, yy);
    g.lineTo(x - 40 - len - (i % 2) * 30, yy);
    g.stroke();
  }
  g.restore();
}

function turkey(g, x, y, s, phase, o = {}) {
  g.save();
  g.translate(x, y);
  g.scale(o.flip ? -s : s, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // tail fan
  const fan = ['#ff6b4a', '#ffd166', '#2ec4b6', '#9b5de5', '#ff6b4a', '#ffd166', '#2ec4b6'];
  fan.forEach((c, i) => {
    const a = -Math.PI * 0.85 + (i / (fan.length - 1)) * Math.PI * 0.7 + Math.sin(phase * 2 + i) * 0.04;
    g.save();
    g.translate(18, -40);
    g.rotate(a);
    g.fillStyle = c;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(0, -48, 15, 46, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  });
  // legs
  g.strokeStyle = '#f4a020';
  g.lineWidth = 6;
  for (const k of [0, Math.PI]) {
    const sw = Math.sin(phase + k) * 16;
    g.beginPath();
    g.moveTo(-4, -8);
    g.lineTo(-4 + sw, 26);
    g.lineTo(-4 + sw - 12, 28);
    g.stroke();
  }
  // body
  g.fillStyle = '#8a5a2b';
  g.strokeStyle = INK;
  g.lineWidth = 4;
  g.beginPath();
  g.ellipse(0, -30, 40, 34, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#a8743f';
  g.beginPath();
  g.ellipse(-14, -26, 18, 16, 0, 0, Math.PI * 2);
  g.fill();
  // head + neck
  g.fillStyle = '#8a5a2b';
  g.beginPath();
  g.ellipse(-36, -70, 16, 18, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffb703';
  g.beginPath();
  g.moveTo(-50, -72);
  g.lineTo(-66, -66);
  g.lineTo(-50, -63);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#ff4d5e';
  g.beginPath();
  g.ellipse(-52, -56, 5, 10, 0.3, 0, Math.PI * 2);
  g.fill();
  // eye
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(-40, -74, o.scared ? 8 : 6, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(-42, -74, 3, 0, Math.PI * 2);
  g.fill();
  if (o.shades) {
    g.fillStyle = INK;
    g.fillRect(-52, -80, 26, 10);
  }
  g.restore();
}

function crown(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(-60, 30);
  g.lineTo(-70, -30);
  g.lineTo(-35, 0);
  g.lineTo(0, -45);
  g.lineTo(35, 0);
  g.lineTo(70, -30);
  g.lineTo(60, 30);
  g.closePath();
  g.fillStyle = '#ffd166';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke();
  for (const [jx, jy, c] of [[-35, 12, '#ff4d5e'], [0, 10, '#2ec4b6'], [35, 12, '#9b5de5']]) {
    g.fillStyle = c;
    g.beginPath();
    g.arc(jx, jy, 8, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 3;
    g.stroke();
  }
  g.restore();
}

// ------------------------------------------------------------------ particles
function burst(x, y, n, speed, colors, life = 1.2, gravity = 600) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
    const v = speed * rnd(0.5, 1);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, c: colors[i % colors.length], r: rnd(4, 9), g: gravity, rot: rnd(0, 6), spin: rnd(-8, 8) };
  });
}
function stepParticles(ps, dt) {
  for (const p of ps) {
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    p.rot += p.spin * dt;
  }
}
function drawParticles(g, ps, kind = 'dot') {
  for (const p of ps) {
    if (p.life <= 0) continue;
    g.globalAlpha = clamp01(p.life / (p.max * 0.4));
    if (kind === 'star') star(g, p.x, p.y, p.r * 1.6, p.c, p.rot);
    else if (kind === 'confetti') {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.c;
      g.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8);
      g.restore();
    } else if (kind === 'feather') {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.c;
      g.strokeStyle = INK;
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(0, 0, p.r * 0.7, p.r * 2.2, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
    } else {
      g.fillStyle = p.c;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

/** Ten pins in a triangle, seen from the front (back row higher and smaller). */
function rack(cx, baseY, size) {
  const rows = [[4, 0.78, -120], [3, 0.86, -80], [2, 0.93, -40], [1, 1, 0]];
  const out = [];
  for (const [n, k, dy] of rows) {
    for (let i = 0; i < n; i++) out.push({ x: cx + (i - (n - 1) / 2) * size * 0.62 * k, y: baseY + dy * (size / 110) - size * 0.5 * k, s: size * k });
  }
  return out;
}

const CONFETTI = ['#ff6b4a', '#2ec4b6', '#ffd166', '#9b5de5', '#4d96ff', '#ffffff'];

// ------------------------------------------------------------------ the cartoons
// Each: { dur, init(st), draw(g, t, dt, st), cues: [[t, sound]] }. st = per-play state.

const STRIKES = [
  // The express: a ball in shades thunders in on a fire trail; the rack explodes.
  {
    name: 'express',
    dur: 2.7,
    init(st) {
      st.pins = rack(700, GROUND, 120).map((p) => ({ ...p, vx: rnd(150, 900), vy: rnd(-1300, -600), r: 0, spin: rnd(-14, 14) }));
      st.fx = [];
    },
    cues: [[0.05, 'rumble'], [0.78, 'crash']],
    draw(g, t, dt, st) {
      rays(g, 700, 300, t, 18, '#4d96ff', '#5ea4ff');
      floor(g);
      const hit = 0.78;
      const bx = t < hit ? lerp(-120, 600, easeIn(t / hit) * 0.6 + (t / hit) * 0.4) : lerp(600, 1200, (t - hit) * 1.2);
      if (t >= hit && !st.boom) {
        st.boom = true;
        st.fx = burst(640, 360, 22, 900, ['#ffd166', '#ffffff', '#ff6b4a'], 0.9, 300);
        st.flash = 1;
      }
      for (const p of st.pins) {
        if (t >= hit) {
          p.vy += 2400 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.r += p.spin * dt;
        }
        const nervous = t > 0.35 && t < hit;
        pin(g, p.x + (nervous ? Math.sin(t * 60 + p.x) * 2 : 0), p.y, p.s, p.r, { eyes: t >= hit ? 'x' : nervous ? 'wide' : 'open', look: -1, mouth: t >= hit ? 'o' : nervous ? 'o' : 'smile', sweat: nervous });
      }
      // fire trail + speed lines
      if (bx < 1100) {
        for (let i = 0; i < 9; i++) {
          const fx = bx - 40 - i * 26;
          const fr = 46 - i * 4 + Math.sin(t * 40 + i) * 5;
          g.fillStyle = i % 2 ? '#ffb703' : '#ff5d3a';
          g.globalAlpha = 1 - i / 10;
          g.beginPath();
          g.arc(fx, GROUND - 52 + Math.sin(t * 30 + i * 2) * 6, Math.max(4, fr), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
        speedLines(g, bx, GROUND - 60, 160, 5);
        ball(g, bx, GROUND - 58, 58, t * 14, { color: '#ff6b4a', face: true, mood: 'cool' });
      }
      stepParticles(st.fx, dt);
      drawParticles(g, st.fx, 'star');
      if (st.flash > 0) {
        g.fillStyle = `rgba(255,255,255,${st.flash})`;
        g.fillRect(0, 0, W, H);
        st.flash -= dt * 4;
      }
      word(g, st.title, W / 2, 150, 130, t - 0.95, st.color);
    },
  },
  // Pin panic: the pins spot the ball, sprout legs and run for it. One doesn't make it.
  {
    name: 'panic',
    dur: 2.9,
    init(st) {
      st.pins = Array.from({ length: 10 }, (_, i) => ({ x0: 430 + i * 50, x: 430 + i * 50, y: GROUND - 60, dir: i < 7 ? 1 : 1, jump: i % 3 === 1, speed: rnd(500, 900), delay: rnd(0, 0.25), out: false }));
      st.slow = st.pins[3];
      st.slow.trip = true;
      st.fx = [];
    },
    cues: [[0.05, 'rumble'], [0.55, 'boing'], [1.45, 'bonk']],
    draw(g, t, dt, st) {
      rays(g, W / 2, 300, t, 16, '#2ec4b6', '#43cfc2', 0.25);
      floor(g);
      const bx = lerp(-100, 1150, t / 2.6);
      for (const [i, p] of st.pins.entries()) {
        const seen = t > 0.45 + i * 0.02;
        const runT = t - 0.75 - p.delay;
        let x = p.x0;
        let y = p.y;
        let rot = 0;
        let legs = null;
        if (p.trip) {
          if (runT > 0) {
            legs = runT * 22;
            x = p.x0 + Math.min(runT, 0.35) * 260;
            if (runT > 0.35) {
              rot = Math.min(1.5, (runT - 0.35) * 9); // trips flat on its face
              y = p.y + Math.min(1, (runT - 0.35) * 6) * 30;
            }
          }
          if (bx > x - 40 && !p.bonked) {
            p.bonked = true;
            p.vx = 700;
            p.vy = -1200;
            st.fx = burst(x, y, 10, 500, ['#ffd166', '#fff'], 0.6, 200);
          }
          if (p.bonked) {
            p.bx = (p.bx ?? x) + p.vx * dt;
            p.by = (p.by ?? y) + (p.vy += 2400 * dt) * dt;
            p.br = (p.br ?? rot) + 12 * dt;
            x = p.bx;
            y = p.by;
            rot = p.br;
          }
        } else if (runT > 0) {
          legs = runT * 26;
          x = p.x0 + runT * p.speed;
          if (p.jump) y = p.y - Math.abs(Math.sin(runT * 9)) * 70;
        }
        if (x > W + 100 || y > H + 200) continue;
        pin(g, x, y, 110, rot, { eyes: p.bonked ? 'x' : seen ? 'wide' : 'open', look: -1, mouth: seen ? 'o' : 'smile', legs, sweat: seen && !p.bonked });
        if (seen && t < 0.95) bubble(g, x, y - 100, '!', 30, clamp01((t - 0.45) * 6));
      }
      speedLines(g, bx, GROUND - 52, 120, 3, 0.5);
      ball(g, bx, GROUND - 50, 50, t * 12, { color: '#9b5de5', face: true, mood: 'grin' });
      stepParticles(st.fx, dt);
      drawParticles(g, st.fx, 'star');
      word(g, st.title, W / 2, 150, 130, t - 1.25, st.color);
    },
  },
  // Lift-off: the hit lights a fuse under every pin; they blast off and burst into fireworks.
  {
    name: 'rocket',
    dur: 3.0,
    init(st) {
      st.pins = rack(W / 2, GROUND, 105).map((p, i) => ({ ...p, t0: 0.6 + i * 0.07, vx: rnd(-160, 160), boom: false }));
      st.fx = [];
      st.smoke = [];
      st.stars = Array.from({ length: 70 }, () => ({ x: rnd(0, W), y: rnd(0, GROUND - 40), r: rnd(1, 3) }));
    },
    cues: [[0.45, 'crash'], [0.7, 'whoosh'], [1.3, 'pop'], [1.6, 'pop'], [1.9, 'pop']],
    draw(g, t, dt, st) {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#141b3a');
      sky.addColorStop(1, '#3b3f8f');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      for (const s of st.stars) {
        g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 5 + s.x);
        g.fillRect(s.x, s.y, s.r, s.r);
      }
      g.globalAlpha = 1;
      floor(g, '#565c9e', '#4a4f8c');
      const bx = lerp(-80, W / 2 - 30, easeOut(t / 0.45));
      if (t < 0.6) ball(g, bx, GROUND - 46, 46, t * 14, { color: '#ffd166', face: true, mood: 'grin' });
      for (const p of st.pins) {
        const u = t - p.t0;
        let y = p.y;
        let x = p.x;
        if (u > 0) {
          y = p.y - u * u * 900 - u * 200;
          x = p.x + p.vx * u;
          if (Math.random() < 0.6) st.smoke.push({ x: x + rnd(-6, 6), y: y + p.s * 0.55, r: rnd(8, 16), life: 0.7 });
          if (!p.boom && y < 140 + (p.x % 90)) {
            p.boom = true;
            st.fx.push(...burst(x, y, 26, 420, CONFETTI, 1.3, 120));
          }
        }
        if (!p.boom) pin(g, x, y, p.s, Math.sin(u * 20) * 0.05 * (u > 0), { eyes: u > 0 ? 'happy' : t > 0.45 ? 'wide' : 'open', mouth: u > 0 ? 'grin' : 'o', flame: u > 0 ? 1 : 0 });
      }
      for (const s of st.smoke) {
        s.life -= dt;
        s.r += dt * 30;
        s.y += dt * 20;
        if (s.life <= 0) continue;
        g.fillStyle = `rgba(220,225,240,${s.life * 0.6})`;
        g.beginPath();
        g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        g.fill();
      }
      st.smoke = st.smoke.filter((s) => s.life > 0);
      stepParticles(st.fx, dt);
      drawParticles(g, st.fx, 'star');
      word(g, st.title, W / 2, 270, 130, t - 1.35, st.color, '#fff8d6');
    },
  },
  // Comic-book KA-BOOM: a jagged blast, pins spinning out in all directions, the ball doing a victory spin.
  {
    name: 'kaboom',
    dur: 2.6,
    init(st) {
      st.pins = Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 + rnd(-0.2, 0.2);
        return { a, v: rnd(500, 800), spin: rnd(-10, 10) };
      });
    },
    cues: [[0.25, 'crash'], [0.3, 'boom']],
    draw(g, t, dt, st) {
      // halftone dots
      g.fillStyle = '#ffd166';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffbf3c';
      for (let y = 0; y < H; y += 22) for (let x = (y / 22) % 2 ? 11 : 0; x < W; x += 22) {
        g.beginPath();
        g.arc(x, y, 5 + 3 * Math.sin(t * 3 + x * 0.01 + y * 0.01), 0, Math.PI * 2);
        g.fill();
      }
      const k = easeOutBack((t - 0.25) / 0.35);
      if (t > 0.25) {
        g.save();
        g.translate(W / 2, H / 2 + 20);
        g.scale(k, k);
        g.rotate(Math.sin(t * 3) * 0.04);
        g.beginPath();
        for (let i = 0; i < 28; i++) {
          const r = i % 2 ? 150 : 250 + (i % 4) * 18;
          const a = (i / 28) * Math.PI * 2;
          g.lineTo(Math.cos(a) * r * 1.4, Math.sin(a) * r);
        }
        g.closePath();
        g.fillStyle = '#ff4d5e';
        g.fill();
        g.lineWidth = 10;
        g.strokeStyle = INK;
        g.stroke();
        g.restore();
        word(g, 'KA-BOOM', W / 2, H / 2 + 10, 92, t - 0.3, '#ffd166', '#ffffff');
      }
      for (const p of st.pins) {
        const u = Math.max(0, t - 0.25);
        const r = p.v * u;
        if (t < 0.25) continue;
        pin(g, W / 2 + Math.cos(p.a) * r * 1.3, H / 2 + Math.sin(p.a) * r + 600 * u * u, 90, p.spin * u, { eyes: 'x', mouth: 'o' });
      }
      if (t < 0.3) ball(g, lerp(-80, W / 2, easeIn(t / 0.25)), H / 2 + 60, 55, t * 20, { color: '#2a7de1', face: true, mood: 'grin' });
      else if (t > 1.0) {
        const u = t - 1.0;
        ball(g, W / 2, lerp(H + 80, 430, easeOutBack(u / 0.4)), 60, u * 9, { color: '#2a7de1', face: true, mood: 'cool' });
      }
      word(g, st.title, W / 2, 110, 120, t - 1.0, st.color);
    },
  },
];

const ANIMS = {
  // Two balls roll in from either side and bump, sparkles everywhere.
  double: {
    dur: 2.7,
    init(st) {
      st.fx = [];
    },
    cues: [[0.05, 'rumble'], [0.62, 'clack'], [0.7, 'sparkle']],
    draw(g, t, dt, st) {
      rays(g, W / 2, 320, t, 20, '#ff6b4a', '#ff8160');
      floor(g);
      const meet = 0.62;
      const u = clamp01(t / meet);
      let lx = lerp(-80, W / 2 - 62, easeIn(u) * 0.5 + u * 0.5);
      let rx = lerp(W + 80, W / 2 + 62, easeIn(u) * 0.5 + u * 0.5);
      let hop = 0;
      if (t > meet) {
        const v = t - meet;
        if (!st.bumped) {
          st.bumped = true;
          st.fx = burst(W / 2, GROUND - 80, 24, 700, ['#ffd166', '#fff', '#2ec4b6'], 1.1, 400);
        }
        const back = Math.sin(Math.min(v, 0.25) / 0.25 * Math.PI) * 30;
        lx -= back;
        rx += back;
        hop = Math.abs(Math.sin(v * 7)) * 60 * Math.max(0, 1 - v / 1.8);
      }
      ball(g, lx, GROUND - 62 - hop, 62, t * 10, { color: '#ff6b4a', face: true, mood: t > meet ? 'grin' : 'cool' });
      ball(g, rx, GROUND - 62 - hop, 62, -t * 10, { color: '#2ec4b6', face: true, mood: t > meet ? 'grin' : 'cool' });
      stepParticles(st.fx, dt);
      drawParticles(g, st.fx, 'star');
      word(g, st.title, W / 2, 150, 140, t - 0.75, st.color);
    },
  },
  // A turkey runs for its life with a bowling ball on its tail; it hops on and rides it away.
  turkey: {
    dur: 3.0,
    init(st) {
      st.fx = [];
    },
    cues: [[0.15, 'gobble'], [0.05, 'rumble'], [1.05, 'boing'], [1.25, 'gobble']],
    draw(g, t, dt, st) {
      rays(g, W / 2, 300, t, 16, '#ffd166', '#ffdd85', 0.3);
      floor(g);
      const tx = lerp(W + 120, -200, t / 2.7);
      const bx = tx + 260 - Math.min(t, 1.0) * 230;
      let ty = GROUND - 30;
      let riding = false;
      if (t > 1.0 && t < 1.25) ty = GROUND - 30 - Math.sin(((t - 1.0) / 0.25) * Math.PI * 0.5) * 120;
      if (t >= 1.25) {
        riding = true;
        ty = GROUND - 108 - Math.abs(Math.sin(t * 8)) * 8;
      }
      if (Math.random() < (riding ? 0.15 : 0.5)) st.fx.push(...burst(tx + 30, ty - 50, 1, 160, ['#ff6b4a', '#ffd166', '#2ec4b6', '#9b5de5'], 1.6, 150));
      ball(g, riding ? tx + 10 : bx, GROUND - 52, 52, -t * 14, { color: '#2a7de1', face: true, mood: riding ? 'grin' : 'cool' });
      turkey(g, tx, ty, 1.15, riding ? 0 : t * 28, { scared: !riding, shades: riding });
      if (t < 0.9) bubble(g, tx - 30, ty - 160, 'GOBBLE!', 26);
      stepParticles(st.fx, dt);
      drawParticles(g, st.fx, 'feather');
      word(g, st.title, W / 2, 140, 140, t - 1.3, st.color, '#fff');
    },
  },
  // Four or more in a row: a turkey parade, one turkey per strike.
  parade: {
    dur: 3.2,
    init(st) {
      st.fx = burst(W / 2, -40, 70, 500, CONFETTI, 3, 220);
    },
    cues: [[0.1, 'gobble'], [0.4, 'sparkle'], [1.0, 'gobble']],
    draw(g, t, dt, st) {
      rays(g, W / 2, 260, t, 22, '#9b5de5', '#a874ea', 0.35);
      floor(g);
      const n = Math.min(st.streak, 9);
      for (let i = 0; i < n; i++) {
        const x = lerp(W + 100, -400, t / 3.0) + i * 105;
        const hop = Math.abs(Math.sin(t * 8 + i)) * 18;
        turkey(g, x, GROUND - 28 - hop, 0.75, t * 18 + i, { shades: i === 0 });
      }
      stepParticles(st.fx, dt);
      drawParticles(g, st.fx, 'confetti');
      word(g, st.title, W / 2, 150, st.title.length > 9 ? 110 : 140, t - 0.4, st.color, '#fff');
    },
  },
  // Twelve strikes: the crown comes down, fireworks go up.
  perfect: {
    dur: 3.6,
    init(st) {
      st.fx = [];
    },
    cues: [[0.2, 'sparkle'], [0.9, 'pop'], [1.2, 'pop'], [1.5, 'pop'], [1.8, 'pop']],
    draw(g, t, dt, st) {
      rays(g, W / 2, 330, t, 24, '#ffb703', '#ffd166', 0.3);
      floor(g, '#f2d39e', '#e2bd80');
      if (t > 0.8 && Math.random() < 0.08) st.fx.push(...burst(rnd(150, W - 150), rnd(80, 240), 28, 380, CONFETTI, 1.3, 100));
      const by = GROUND - 80;
      ball(g, W / 2, by - Math.abs(Math.sin(t * 4)) * 10 * clamp01(t - 1.3), 80, Math.sin(t) * 0.3, { color: '#ff6b4a', face: true, mood: 'grin' });
      crown(g, W / 2, lerp(-120, by - 100, easeOutBack((t - 0.3) / 0.7)), 1.1);
      stepParticles(st.fx, dt);
      drawParticles(g, st.fx, 'star');
      word(g, 'PERFECT', W / 2, 105, 120, t - 1.0, '#ff4d5e');
      word(g, 'GAME!', W / 2, 220, 120, t - 1.35, '#ff4d5e');
    },
  },
  // One pin left, whistling to itself. The ball tiptoes up behind it...
  spare: {
    dur: 2.7,
    init(st) {
      st.fx = [];
      st.notes = [];
    },
    cues: [[0.1, 'whistle'], [1.15, 'bonk'], [1.25, 'sparkle']],
    draw(g, t, dt, st) {
      rays(g, W / 2, 300, t, 16, '#2ec4b6', '#47d1c4', 0.2);
      floor(g);
      const px0 = 720;
      const hit = 1.15;
      // tiptoe: small hops, slowing as it gets close
      const bx = t < hit ? lerp(-60, px0 - 80, easeOut(t / hit) * 0.85 + (t / hit) * 0.15) : px0 - 80 + (t - hit) * 300;
      const tip = t < hit ? Math.abs(Math.sin(t * 14)) * 14 : 0;
      ball(g, bx, GROUND - 48 - tip, 48, t * 6, { color: '#ff6b4a', face: true, mood: 'grin' });
      if (t < hit) {
        if (Math.random() < 0.05) st.notes.push({ x: px0 + 20, y: GROUND - 150, life: 1.2 });
        const turned = t > 0.95;
        pin(g, px0, GROUND - 62, 125, Math.sin(t * 3) * 0.04, { eyes: turned ? 'wide' : 'closed', look: -1, mouth: turned ? 'o' : 'whistle', sweat: turned });
      } else {
        if (!st.hit) {
          st.hit = true;
          st.vx = 760;
          st.vy = -1250;
          st.px = px0;
          st.py = GROUND - 62;
          st.r = 0;
          st.fx = burst(px0 - 30, GROUND - 70, 18, 650, ['#ffd166', '#fff'], 0.9, 300);
        }
        st.vy += 2400 * dt;
        st.px += st.vx * dt;
        st.py += st.vy * dt;
        st.r += 13 * dt;
        pin(g, st.px, st.py, 125, st.r, { eyes: 'x', mouth: 'o' });
      }
      g.font = '900 40px system-ui';
      for (const n of st.notes) {
        n.life -= dt;
        n.y -= 60 * dt;
        n.x += Math.sin(n.life * 6) * 1.5;
        if (n.life <= 0) continue;
        g.globalAlpha = clamp01(n.life);
        g.fillStyle = INK;
        g.fillText('♪', n.x, n.y);
      }
      g.globalAlpha = 1;
      stepParticles(st.fx, dt);
      drawParticles(g, st.fx, 'star');
      word(g, st.title, W / 2, 150, 140, t - 1.3, st.color);
    },
  },
  // Two pins on two cliffs with a canyon between them. A tumbleweed rolls past.
  split: {
    dur: 2.6,
    init() {},
    cues: [[0.3, 'wind'], [1.2, 'wind']],
    draw(g, t, dt, st) {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#ffb35c');
      sky.addColorStop(1, '#ffe2a8');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffd166';
      g.beginPath();
      g.arc(W / 2, 330, 90, 0, Math.PI * 2);
      g.fill();
      // cliffs
      g.fillStyle = '#c96f3b';
      g.strokeStyle = INK;
      g.lineWidth = 5;
      for (const side of [-1, 1]) {
        g.beginPath();
        const edge = W / 2 + side * 150;
        g.moveTo(side < 0 ? 0 : W, H);
        g.lineTo(side < 0 ? 0 : W, 330);
        g.lineTo(edge, 330);
        g.lineTo(edge - side * 30, H);
        g.closePath();
        g.fill();
        g.stroke();
      }
      const lean = Math.sin(t * 3) * 0.06;
      pin(g, W / 2 - 230, 270, 120, lean, { eyes: 'open', look: 1, mouth: 'frown', arm: -0.6 + Math.sin(t * 9) * 0.6 });
      g.save();
      g.translate(W / 2 + 230, 270);
      g.scale(-1, 1);
      pin(g, 0, 0, 120, lean, { eyes: 'open', look: 1, mouth: 'frown', arm: -0.6 + Math.sin(t * 9 + 1) * 0.6 });
      g.restore();
      // tumbleweed bouncing along the canyon floor
      const tx = lerp(-80, W + 80, t / 2.4);
      const ty = 470 - Math.abs(Math.sin(t * 6)) * 40;
      g.save();
      g.translate(tx, ty);
      g.rotate(t * 8);
      g.strokeStyle = '#8a5a2b';
      g.lineWidth = 4;
      for (let i = 0; i < 7; i++) {
        g.beginPath();
        g.ellipse(0, 0, 28, 12, (i / 7) * Math.PI, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      // wind
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        const x = ((t * 500 + i * 340) % (W + 300)) - 150;
        g.beginPath();
        g.moveTo(x, 120 + i * 50);
        g.bezierCurveTo(x + 60, 100 + i * 50, x + 120, 140 + i * 50, x + 180, 120 + i * 50);
        g.stroke();
      }
      word(g, st.title, W / 2, 130, 140, t - 0.4, '#c96f3b', '#fff3d6');
    },
  },
  // Into the gutter it goes. The pins at the end find this very funny.
  gutter: {
    dur: 2.6,
    init() {},
    cues: [[0.75, 'plop'], [0.95, 'sadTrombone']],
    draw(g, t, dt, st) {
      rays(g, W / 2, 300, t, 14, '#8793ab', '#97a2b8', 0.15);
      floor(g);
      // the gutter channel at the front
      g.fillStyle = '#5d6b89';
      g.fillRect(0, GROUND + 10, W, 40);
      g.strokeStyle = INK;
      g.lineWidth = 4;
      g.strokeRect(-5, GROUND + 10, W + 10, 40);
      // pins at the far right, laughing once the ball drops
      const laugh = t > 0.95;
      for (let i = 0; i < 4; i++) {
        const x = 650 + i * 70;
        const bounce = laugh ? Math.abs(Math.sin(t * 14 + i)) * 12 : 0;
        pin(g, x, GROUND - 60 - bounce, 110, laugh ? Math.sin(t * 10 + i) * 0.12 : 0, { eyes: laugh ? 'happy' : 'open', look: -1, mouth: laugh ? 'grin' : 'smile' });
      }
      if (laugh) {
        bubble(g, 760, 210, 'HA HA!', 30, clamp01((t - 0.95) * 5));
        if (t > 1.3) bubble(g, 880, 160, 'HEE!', 24, clamp01((t - 1.3) * 5));
      }
      // the ball veers and drops into the channel
      let bx;
      let by;
      if (t < 0.7) {
        bx = lerp(-60, 330, t / 0.7);
        by = GROUND - 46 + easeIn(t / 0.7) * 30;
      } else {
        const u = t - 0.7;
        bx = 330 + u * 240;
        by = Math.min(GROUND + 30, GROUND - 16 + u * u * 1200);
      }
      ball(g, bx, by, 46, t * 8, { color: '#2a7de1', face: true, mood: t > 0.7 ? 'sad' : 'oops' });
      word(g, st.title, W / 2, 140, 120, t - 1.0, '#8793ab');
    },
  },
  // All ten still up, and very pleased with themselves.
  miss: {
    dur: 2.3,
    init() {},
    cues: [[0.2, 'boing']],
    draw(g, t, dt, st) {
      rays(g, W / 2, 300, t, 14, '#8793ab', '#97a2b8', 0.15);
      floor(g);
      for (const [i, p] of rack(W / 2, GROUND, 120).entries()) {
        const bounce = Math.abs(Math.sin(t * 12 + i * 0.7)) * 14;
        pin(g, p.x, p.y - bounce, p.s, Math.sin(t * 8 + i) * 0.1, { eyes: 'happy', mouth: 'grin' });
      }
      bubble(g, 300, 200, 'MISSED US!', 28, clamp01((t - 0.3) * 5));
      word(g, st.title, W / 2, 120, 130, t - 0.6, '#8793ab');
    },
  },
};

// Sounds the cartoons can cue (all synthesised; see audio.js).
function cueSound(sfx, name) {
  if (!sfx) return;
  const map = {
    rumble: () => sfx.whoosh(0.8),
    crash: () => sfx.pinHit(1),
    boom: () => sfx.thud(),
    whoosh: () => sfx.whoosh(1),
    pop: () => sfx.pop(0.8),
    clack: () => sfx.crack(),
    sparkle: () => sfx.sparkle(2),
    bonk: () => sfx.thunk(),
    boing: () => sfx.boing?.(),
    gobble: () => sfx.gobble?.(),
    whistle: () => sfx.tweet?.(),
    wind: () => sfx.wind?.(),
    plop: () => sfx.gutter(),
    sadTrombone: () => sfx.sadTrombone?.(),
  };
  map[name]?.();
}

export const STREAK_NAMES = ['STRIKE!', 'DOUBLE!', 'TURKEY!', 'HAMBONE!', 'FIVE-BAGGER!', 'SIX-PACK!'];
export const streakTitle = (n) => (n >= 12 ? 'PERFECT GAME!' : STREAK_NAMES[n - 1] || `${n} IN A ROW!`);

export class AlleyScreen {
  constructor(parent, sfx) {
    this.sfx = sfx;
    this.el = document.createElement('div');
    this.el.className = 'alley-screen';
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.el.append(this.canvas);
    parent.append(this.el);
    this.g = this.canvas.getContext('2d');
    this.anim = null;
    this._lastStrike = -1;
  }

  /** Start a cartoon. Returns its length in seconds. */
  play(kind, { streak = 1, player = 0 } = {}) {
    let anim;
    const st = { streak, color: PLAYER[player] || PLAYER[0] };
    if (kind === 'strike') {
      if (streak >= 12) anim = ANIMS.perfect;
      else if (streak >= 4) anim = ANIMS.parade;
      else if (streak === 3) anim = ANIMS.turkey;
      else if (streak === 2) anim = ANIMS.double;
      else {
        // A different cartoon from last time.
        let i = Math.floor(Math.random() * STRIKES.length);
        if (i === this._lastStrike) i = (i + 1) % STRIKES.length;
        this._lastStrike = i;
        anim = STRIKES[i];
      }
      st.title = streakTitle(streak);
    } else {
      anim = ANIMS[kind];
      st.title = { spare: 'SPARE!', split: 'SPLIT!', gutter: 'GUTTER BALL', miss: 'MISS!' }[kind];
    }
    if (!anim) return 0;
    anim.init(st);
    this.anim = { a: anim, st, t: 0, cues: [...anim.cues].sort((x, y) => x[0] - y[0]) };
    this.el.classList.remove('out');
    this.el.classList.add('show');
    return anim.dur;
  }

  get playing() {
    return !!this.anim;
  }

  skip() {
    if (!this.anim) return;
    this.anim = null;
    this.el.classList.remove('show');
  }

  update(dt) {
    const A = this.anim;
    if (!A) return;
    A.t += Math.min(dt, 0.05);
    while (A.cues.length && A.cues[0][0] <= A.t) cueSound(this.sfx, A.cues.shift()[1]);
    const g = this.g;
    g.save();
    // A little screen shake on the big moments is part of the animation itself.
    A.a.draw(g, A.t, Math.min(dt, 0.05), A.st);
    g.restore();
    if (A.t >= A.a.dur) {
      this.anim = null;
      this.el.classList.remove('show');
    }
  }

  dispose() {
    this.anim = null;
    this.el.remove();
  }
}
