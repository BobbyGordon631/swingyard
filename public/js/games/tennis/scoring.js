// Tennis scoring: points (0/15/30/40, deuce, advantage), games, sets, tiebreaks, serve rotation.
// Pure JS, no DOM (unit tested in Node).

const NAMES = ['0', '15', '30', '40'];

export class TennisMatch {
  /**
   * @param {object} o
   * @param {number} [o.gamesPerSet=6]  games needed to win a set (win by two; tiebreak at gamesPerSet-all)
   * @param {number} [o.setsToWin=2]    sets needed to win the match (2 = best of three)
   * @param {number} [o.tiebreakTo=7]   points needed to win a tiebreak (win by two)
   */
  constructor({ gamesPerSet = 6, setsToWin = 2, tiebreakTo = 7 } = {}) {
    this.gamesPerSet = gamesPerSet;
    this.setsToWin = setsToWin;
    this.tiebreakTo = tiebreakTo;
    this.points = [0, 0];
    this.games = [0, 0];
    this.sets = [0, 0];
    this.setScores = []; // completed sets, e.g. [[6, 4], [7, 6]]
    this.server = 0;
    this.tiebreak = false;
    this.winner = null;
    this._tbFirstServer = 0;
  }

  /**
   * Record a point for player 0 or 1.
   * @returns {'point'|'game'|'set'|'match'} the biggest thing that just finished
   */
  point(w) {
    if (this.winner !== null) throw new Error('Match is already over');
    if (w !== 0 && w !== 1) throw new Error('winner must be 0 or 1');
    const l = 1 - w;
    this.points[w]++;
    const target = this.tiebreak ? this.tiebreakTo : 4;
    if (this.points[w] >= target && this.points[w] - this.points[l] >= 2) return this._game(w);
    if (this.tiebreak) {
      // Tiebreak serve order: A serves 1 point, then B, B, A, A, ...
      const n = this.points[0] + this.points[1];
      const other = 1 - this._tbFirstServer;
      this.server = Math.floor((n + 1) / 2) % 2 === 0 ? this._tbFirstServer : other;
    }
    return 'point';
  }

  _game(w) {
    const l = 1 - w;
    const wasTiebreak = this.tiebreak;
    this.points = [0, 0];
    this.games[w]++;
    const n = this.gamesPerSet;
    const setWon = wasTiebreak || (this.games[w] >= n && this.games[w] - this.games[l] >= 2);
    // Serve passes to the other player after every game; after a tiebreak, to whoever received first.
    this.server = wasTiebreak ? 1 - this._tbFirstServer : 1 - this.server;
    this.tiebreak = false;
    if (!setWon) {
      if (this.games[0] === n && this.games[1] === n) {
        this.tiebreak = true;
        this._tbFirstServer = this.server;
      }
      return 'game';
    }
    this.setScores.push([...this.games]);
    this.games = [0, 0];
    this.sets[w]++;
    if (this.sets[w] >= this.setsToWin) {
      this.winner = w;
      return 'match';
    }
    return 'set';
  }

  /** The umpire's call for the current game, server's score first: "30–15", "Deuce", "Advantage Player 1". */
  call(names = ['Player 1', 'Player 2']) {
    const s = this.server;
    const r = 1 - s;
    const [ps, pr] = [this.points[s], this.points[r]];
    if (this.tiebreak) return `Tiebreak ${ps}–${pr}`;
    if (ps >= 3 && pr >= 3) {
      if (ps === pr) return 'Deuce';
      return `Advantage ${names[ps > pr ? s : r]}`;
    }
    if (ps === 0 && pr === 0) return 'Love all';
    if (ps === pr) return `${NAMES[ps]} all`;
    return `${NAMES[ps]}–${NAMES[pr]}`.replaceAll(/\b0\b/g, 'Love');
  }

  /** Short point labels for a scoreboard, per player: ['40', 'Ad'] etc. */
  pointLabels() {
    const [a, b] = this.points;
    if (this.tiebreak) return [String(a), String(b)];
    if (a >= 3 && b >= 3) {
      if (a === b) return ['40', '40'];
      return a > b ? ['Ad', ''] : ['', 'Ad'];
    }
    return [NAMES[a], NAMES[b]];
  }
}
