// Skill Level: one number per sport that climbs as you get better, saved in this browser.
//
// Head-to-head sports (vs the CPU) rate like chess: beating a strong CPU is worth a lot, losing to an
// easy one costs a lot, and a big margin counts for more. Score sports (bowling, golf, archery) turn
// your score into a performance number and move your level part of the way toward it. 1000 = Pro.
//
// Only solo games are rated (one person, alone or vs the CPU): with several people on one screen
// there is no way to know who is who between sessions. Pure JS apart from localStorage (tested in Node).

export const PRO_LEVEL = 1000;
const KEY = 'swingyard-skill-v1';
const HISTORY = 40;
// The CPU's own skill level at Easy / Normal / Hard.
export const CPU_LEVEL = [250, 600, 950];

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function store() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function loadAll(storage = store()) {
  try {
    return JSON.parse(storage?.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function getSkill(sport, storage = store()) {
  const s = loadAll(storage)[sport];
  return s ? { level: s.level, games: s.games || 0, history: s.history || [s.level], pro: !!s.pro } : { level: 0, games: 0, history: [], pro: false };
}

/**
 * Turn a solo score into a performance level for the score sports.
 * bowling: total pins · golf: strokes relative to par · archery: total points (out of 90 by default)
 */
export function performanceFor(sport, value, { max = 90 } = {}) {
  if (sport === 'bowling') return (value - 50) * 5; // 100 -> 250, 200 -> 750, 250 -> 1000, 300 -> 1250
  if (sport === 'golf') return 900 - value * 120; // even par -> 900, two under -> 1140, +4 -> 420
  if (sport === 'archery') return ((value / max) * 90 - 30) * 18; // 60/90 -> 540, 85/90 -> 990
  return value;
}

/**
 * How much a result moves the level.
 * result: { kind: 'versus', outcome: 1 | 0.5 | 0, margin: 0..1, difficulty: 0..2 }
 *       | { kind: 'score', perf }
 */
export function skillDelta(level, games, result) {
  if (result.kind === 'versus') {
    const cpu = CPU_LEVEL[result.difficulty ?? 1];
    const expected = 1 / (1 + Math.pow(10, (cpu - level) / 400));
    const k = games < 5 ? 110 : 70; // the first few games settle you in quickly
    const margin = result.outcome === 0.5 ? 0 : clamp(result.margin ?? 0.5, 0, 1);
    return Math.round(k * (result.outcome - expected) * (0.7 + 0.6 * margin));
  }
  const rate = games < 5 ? 0.45 : 0.22;
  return Math.round(clamp((result.perf - level) * rate, -70, 110));
}

/** Rate a finished solo game and save it. Returns what the results screen shows. */
export function recordSkill(sport, result, storage = store()) {
  const all = loadAll(storage);
  const prev = all[sport] || { level: 0, games: 0, history: [], pro: false };
  const before = prev.level;
  const delta = skillDelta(before, prev.games || 0, result);
  const after = Math.max(0, before + delta);
  const history = [...(prev.history?.length ? prev.history : [before]), after].slice(-HISTORY);
  const newPro = !prev.pro && after >= PRO_LEVEL;
  all[sport] = { level: after, games: (prev.games || 0) + 1, history, pro: prev.pro || after >= PRO_LEVEL };
  try {
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {}
  return { sport, before, after, delta: after - before, history, pro: all[sport].pro, newPro };
}

/** A small line chart of the level history, as an SVG string (the results screen). */
export function skillGraphSvg(history, { w = 320, h = 90, color = '#ff6b4a' } = {}) {
  const pts = history.length > 1 ? history : [history[0] || 0, history[0] || 0];
  const top = Math.max(PRO_LEVEL * 1.1, ...pts) * 1.02;
  const x = (i) => 6 + (i / (pts.length - 1)) * (w - 12);
  const y = (v) => h - 6 - (v / top) * (h - 12);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${h - 6}L${x(0).toFixed(1)},${h - 6}Z`;
  const pro = y(PRO_LEVEL).toFixed(1);
  const last = pts.length - 1;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="skill-graph" aria-hidden="true">
    <line x1="6" x2="${w - 6}" y1="${pro}" y2="${pro}" stroke="#ffd166" stroke-width="2" stroke-dasharray="5 4"/>
    <text x="${w - 8}" y="${Number(pro) - 4}" text-anchor="end" font-size="11" font-weight="800" fill="#c99a1e">PRO</text>
    <path d="${area}" fill="${color}" opacity="0.15"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last).toFixed(1)}" cy="${y(pts[last]).toFixed(1)}" r="5" fill="#fff" stroke="${color}" stroke-width="3"/>
  </svg>`;
}
