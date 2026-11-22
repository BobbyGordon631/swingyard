import test from 'node:test';
import assert from 'node:assert/strict';
import { recordSkill, getSkill, skillDelta, performanceFor, skillGraphSvg, PRO_LEVEL, CPU_LEVEL } from '../public/js/skill.js';

/** An in-memory stand-in for localStorage. */
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('a new player starts at 0 with no games', () => {
  const s = memoryStorage();
  assert.deepEqual(getSkill('tennis', s), { level: 0, games: 0, history: [], pro: false });
});

test('beating the CPU raises the level; losing never goes below 0', () => {
  const s = memoryStorage();
  const win = recordSkill('tennis', { kind: 'versus', outcome: 1, margin: 0.5, difficulty: 1 }, s);
  assert.ok(win.delta > 0);
  assert.equal(win.before, 0);
  assert.equal(getSkill('tennis', s).level, win.after);
  for (let i = 0; i < 20; i++) recordSkill('tennis', { kind: 'versus', outcome: 0, margin: 1, difficulty: 0 }, s);
  assert.equal(getSkill('tennis', s).level, 0);
});

test('beating a harder CPU is worth more, and a bigger margin is worth more', () => {
  const easy = skillDelta(500, 10, { kind: 'versus', outcome: 1, margin: 0.5, difficulty: 0 });
  const hard = skillDelta(500, 10, { kind: 'versus', outcome: 1, margin: 0.5, difficulty: 2 });
  assert.ok(hard > easy);
  const close = skillDelta(500, 10, { kind: 'versus', outcome: 1, margin: 0, difficulty: 1 });
  const rout = skillDelta(500, 10, { kind: 'versus', outcome: 1, margin: 1, difficulty: 1 });
  assert.ok(rout > close);
});

test('a draw against an equal CPU barely moves the level', () => {
  assert.equal(skillDelta(CPU_LEVEL[1], 10, { kind: 'versus', outcome: 0.5, difficulty: 1 }), 0);
});

test('score sports move toward the performance, faster in the first games', () => {
  const perf = performanceFor('bowling', 200); // 750
  assert.equal(perf, 750);
  const early = skillDelta(300, 0, { kind: 'score', perf });
  const later = skillDelta(300, 10, { kind: 'score', perf });
  assert.ok(early > later && later > 0);
  assert.ok(skillDelta(900, 10, { kind: 'score', perf }) < 0);
  // Golf: fewer strokes over par is better.
  assert.ok(performanceFor('golf', -2) > performanceFor('golf', 0));
  assert.ok(performanceFor('golf', 0) > performanceFor('golf', 4));
  // Archery: a perfect round is above Pro.
  assert.ok(performanceFor('archery', 90, { max: 90 }) > PRO_LEVEL);
});

test('crossing 1000 makes you a Pro once, and history is kept', () => {
  const s = memoryStorage();
  let r;
  for (let i = 0; i < 60 && !(r && r.pro); i++) r = recordSkill('bowling', { kind: 'score', perf: 1300 }, s);
  assert.ok(r.pro && r.newPro && r.after >= PRO_LEVEL);
  const next = recordSkill('bowling', { kind: 'score', perf: 1300 }, s);
  assert.ok(next.pro && !next.newPro);
  assert.ok(next.history.length >= 2 && next.history.length <= 40);
  assert.equal(next.history[next.history.length - 1], next.after);
});

test('the graph is an SVG with a Pro line', () => {
  const svg = skillGraphSvg([0, 120, 300]);
  assert.match(svg, /^<svg/);
  assert.match(svg, /PRO/);
});

test('works without any storage (private browsing)', () => {
  const r = recordSkill('golf', { kind: 'score', perf: 500 }, null);
  assert.ok(r.after > 0);
});
