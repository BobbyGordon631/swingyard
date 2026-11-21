import test from 'node:test';
import assert from 'node:assert/strict';
import { TennisMatch } from '../public/js/games/tennis/scoring.js';

const feed = (m, seq) => [...seq].map((c) => m.point(Number(c)));
const winGames = (m, w, n) => {
  for (let g = 0; g < n; g++) feed(m, String(w).repeat(4));
};

test('a love game: 15, 30, 40, game', () => {
  const m = new TennisMatch();
  assert.equal(m.call(), 'Love all');
  assert.equal(m.point(0), 'point');
  assert.equal(m.call(), '15–Love');
  m.point(0);
  assert.equal(m.call(), '30–Love');
  m.point(0);
  assert.deepEqual(m.pointLabels(), ['40', '0']);
  assert.equal(m.point(0), 'game');
  assert.deepEqual(m.games, [1, 0]);
  assert.deepEqual(m.points, [0, 0]);
});

test('calls give the server score first', () => {
  const m = new TennisMatch();
  feed(m, '1'); // receiver wins the first point
  assert.equal(m.call(), 'Love–15');
  feed(m, '0');
  assert.equal(m.call(), '15 all');
  feed(m, '1111'.slice(0, 3)); // receiver takes the game
  assert.equal(m.server, 1);
  feed(m, '1');
  assert.equal(m.call(), '15–Love'); // player 2 now serves and leads
});

test('deuce and advantage: must win by two', () => {
  const m = new TennisMatch();
  feed(m, '000111');
  assert.equal(m.call(), 'Deuce');
  assert.equal(m.point(0), 'point');
  assert.equal(m.call(), 'Advantage Player 1');
  assert.deepEqual(m.pointLabels(), ['Ad', '']);
  m.point(1);
  assert.equal(m.call(), 'Deuce');
  m.point(1);
  assert.equal(m.call(['Ann', 'Bo']), 'Advantage Bo');
  assert.equal(m.point(1), 'game');
  assert.deepEqual(m.games, [0, 1]);
});

test('serve alternates every game', () => {
  const m = new TennisMatch();
  const servers = [];
  for (let g = 0; g < 5; g++) {
    servers.push(m.server);
    winGames(m, 0, 1);
  }
  assert.deepEqual(servers, [0, 1, 0, 1, 0]);
});

test('a set needs six games and a two-game lead', () => {
  const m = new TennisMatch();
  winGames(m, 0, 5);
  winGames(m, 1, 5);
  assert.deepEqual(m.games, [5, 5]);
  winGames(m, 0, 1);
  assert.deepEqual(m.games, [6, 5]); // not over yet
  assert.deepEqual(m.sets, [0, 0]);
  winGames(m, 0, 1);
  assert.deepEqual(m.setScores, [[7, 5]]);
  assert.deepEqual(m.sets, [1, 0]);
  assert.deepEqual(m.games, [0, 0]);
});

test('6-0 set and a straight-sets match', () => {
  const m = new TennisMatch({ setsToWin: 2 });
  winGames(m, 1, 5);
  assert.equal(m.point(1), 'point');
  feed(m, '11');
  assert.equal(m.point(1), 'set');
  winGames(m, 1, 5);
  feed(m, '111');
  assert.equal(m.point(1), 'match');
  assert.equal(m.winner, 1);
  assert.deepEqual(m.setScores, [[0, 6], [0, 6]]);
  assert.throws(() => m.point(0), /over/);
});

test('tiebreak at 6-6: first to seven by two, set recorded 7-6', () => {
  const m = new TennisMatch({ setsToWin: 1 });
  for (let i = 0; i < 6; i++) {
    winGames(m, 0, 1);
    winGames(m, 1, 1);
  }
  assert.deepEqual(m.games, [6, 6]);
  assert.ok(m.tiebreak);
  feed(m, '000000111111'); // 6-6 in the tiebreak
  assert.equal(m.call(), 'Tiebreak 6–6');
  assert.equal(m.point(0), 'point'); // 7-6, not enough
  assert.equal(m.point(1), 'point'); // 7-7
  m.point(1);
  assert.equal(m.point(1), 'match');
  assert.deepEqual(m.setScores, [[6, 7]]);
  assert.equal(m.winner, 1);
});

test('tiebreak serve order is A, B, B, A, A, B, B and the next set starts with B', () => {
  const m = new TennisMatch({ setsToWin: 2 });
  for (let i = 0; i < 6; i++) {
    winGames(m, 0, 1);
    winGames(m, 1, 1);
  }
  const first = m.server;
  assert.equal(first, 0); // twelve games played, so the original server is up again
  const order = [m.server];
  for (const w of [0, 1, 0, 1, 0, 1]) {
    m.point(w);
    order.push(m.server);
  }
  assert.deepEqual(order, [0, 1, 1, 0, 0, 1, 1]);
  feed(m, '0000'); // 7-3
  assert.deepEqual(m.sets, [1, 0]);
  assert.equal(m.server, 1 - first);
});

test('short sets (the in-game default) follow the same rules', () => {
  const m = new TennisMatch({ gamesPerSet: 3, setsToWin: 1 });
  winGames(m, 0, 2);
  winGames(m, 1, 2);
  winGames(m, 0, 1);
  assert.equal(m.winner, null); // 3-2 is not a two-game lead
  winGames(m, 1, 1);
  assert.ok(m.tiebreak); // 3-3
  feed(m, '0000000');
  assert.equal(m.winner, 0);
  assert.deepEqual(m.setScores, [[4, 3]]);
});

test('random matches always terminate with a consistent result', () => {
  let seed = 9;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 200; i++) {
    const m = new TennisMatch({ setsToWin: 2 });
    let n = 0;
    while (m.winner === null && n++ < 5000) m.point(rnd() < 0.5 ? 0 : 1);
    assert.notEqual(m.winner, null);
    assert.equal(m.sets[m.winner], 2);
    assert.equal(m.setScores.length, m.sets[0] + m.sets[1]);
    for (const [a, b] of m.setScores) assert.ok(Math.max(a, b) >= 6 && Math.max(a, b) <= 7);
  }
});
