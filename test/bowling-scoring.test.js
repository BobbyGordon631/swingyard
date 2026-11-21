import test from 'node:test';
import assert from 'node:assert/strict';
import { Scorecard, computeFrames, nextRoll, totalScore } from '../public/js/games/bowling/scoring.js';

const play = (rolls) => {
  const card = new Scorecard();
  for (const r of rolls) card.roll(r);
  return card;
};
const cumulative = (rolls) => computeFrames(rolls).map((f) => f.cumulative);

test('gutter game scores 0', () => {
  const card = play(Array(20).fill(0));
  assert.equal(card.total, 0);
  assert.ok(card.complete);
});

test('all ones scores 20', () => {
  assert.equal(play(Array(20).fill(1)).total, 20);
});

test('perfect game scores 300 in 12 rolls', () => {
  const card = play(Array(12).fill(10));
  assert.equal(card.total, 300);
  assert.ok(card.complete);
  assert.deepEqual(cumulative(card.rolls), [30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  assert.deepEqual(card.frames[9].marks, ['X', 'X', 'X']);
});

test('all spares (5,5) with a final 5 scores 150', () => {
  const card = play(Array(21).fill(5));
  assert.equal(card.total, 150);
  assert.ok(card.complete);
});

test('nine-miss game scores 90', () => {
  assert.equal(play(Array(10).fill([9, 0]).flat()).total, 90);
});

test('spare bonus is the next ball only', () => {
  assert.equal(totalScore([7, 3, 4, 2]), 14 + 6);
});

test('strike bonus is the next two balls', () => {
  assert.equal(totalScore([10, 3, 4]), 17 + 7);
});

test('known mixed game scores 133', () => {
  // Classic worked example: 1,4 | 4,5 | 6,/ | 5,/ | X | 0,1 | 7,/ | 6,/ | X | 2,/,6
  const rolls = [1, 4, 4, 5, 6, 4, 5, 5, 10, 0, 1, 7, 3, 6, 4, 10, 2, 8, 6];
  const card = play(rolls);
  assert.deepEqual(cumulative(rolls), [5, 14, 29, 49, 60, 61, 77, 97, 117, 133]);
  assert.equal(card.total, 133);
  assert.ok(card.complete);
});

test('frame scores stay pending until bonus balls are thrown', () => {
  assert.deepEqual(cumulative([10]).slice(0, 2), [null, null]);
  assert.deepEqual(cumulative([10, 10]).slice(0, 2), [null, null]);
  assert.deepEqual(cumulative([10, 10, 4]).slice(0, 3), [24, null, null]);
  assert.deepEqual(cumulative([10, 10, 4, 2]).slice(0, 3), [24, 40, 46]);
  assert.deepEqual(cumulative([6, 4]).slice(0, 1), [null]);
  assert.deepEqual(cumulative([6, 4, 3]).slice(0, 2), [13, null]);
  assert.equal(totalScore([10, 10, 4]), 24);
});

test('marks: strike, spare, miss', () => {
  const frames = computeFrames([10, 7, 3, 0, 0, 0, 10]);
  assert.deepEqual(frames[0].marks, ['X']);
  assert.deepEqual(frames[1].marks, ['7', '/']);
  assert.deepEqual(frames[2].marks, ['-', '-']);
  assert.deepEqual(frames[3].marks, ['-', '/']); // 0 then 10 is a spare, not a strike
});

test('nextRoll tracks frame, ball and standing pins', () => {
  assert.deepEqual(nextRoll([]), { done: false, frame: 0, ball: 0, pinsUp: 10 });
  assert.deepEqual(nextRoll([3]), { done: false, frame: 0, ball: 1, pinsUp: 7 });
  assert.deepEqual(nextRoll([3, 4]), { done: false, frame: 1, ball: 0, pinsUp: 10 });
  assert.deepEqual(nextRoll([10]), { done: false, frame: 1, ball: 0, pinsUp: 10 });
});

test('tenth frame: open frame ends after two balls', () => {
  const card = play([...Array(18).fill(0), 3, 4]);
  assert.ok(card.complete);
  assert.equal(card.total, 7);
  assert.throws(() => card.roll(1), /complete/);
});

test('tenth frame: spare earns one bonus ball on a fresh rack', () => {
  const rolls = [...Array(18).fill(0), 6, 4];
  assert.deepEqual(nextRoll(rolls), { done: false, frame: 9, ball: 2, pinsUp: 10 });
  const card = play([...rolls, 10]);
  assert.ok(card.complete);
  assert.equal(card.total, 20);
  assert.deepEqual(card.frames[9].marks, ['6', '/', 'X']);
});

test('tenth frame: strike then non-strike leaves the remaining pins', () => {
  const rolls = [...Array(18).fill(0), 10];
  assert.deepEqual(nextRoll(rolls), { done: false, frame: 9, ball: 1, pinsUp: 10 });
  assert.deepEqual(nextRoll([...rolls, 6]), { done: false, frame: 9, ball: 2, pinsUp: 4 });
  const card = play([...rolls, 6, 4]);
  assert.equal(card.total, 20);
  assert.deepEqual(card.frames[9].marks, ['X', '6', '/']);
  assert.throws(() => play([...rolls, 6, 5]), /Invalid roll/);
});

test('tenth frame: two strikes give a fresh rack for the third ball', () => {
  const rolls = [...Array(18).fill(0), 10, 10];
  assert.deepEqual(nextRoll(rolls), { done: false, frame: 9, ball: 2, pinsUp: 10 });
  assert.equal(play([...rolls, 7]).total, 27);
});

test('rejects impossible rolls', () => {
  assert.throws(() => play([11]), /Invalid roll/);
  assert.throws(() => play([-1]), /Invalid roll/);
  assert.throws(() => play([6, 5]), /Invalid roll/);
  assert.throws(() => play([2.5]), /Invalid roll/);
});

test('random legal games never exceed 300 and always finish in 12-21 rolls', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let g = 0; g < 500; g++) {
    const card = new Scorecard();
    while (!card.complete) card.roll(Math.floor(rnd() * (card.next.pinsUp + 1)));
    assert.ok(card.rolls.length >= 12 && card.rolls.length <= 21);
    assert.ok(card.total >= 0 && card.total <= 300);
    const frames = card.frames;
    assert.equal(frames[9].cumulative, card.total);
    assert.equal(frames.reduce((s, f) => s + f.score, 0), card.total);
  }
});
