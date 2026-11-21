// Ten-pin bowling scoring. Pure JS, no DOM (unit tested in Node).
// A game is just the flat list of rolls (pins knocked down per ball).

/**
 * Split rolls into 10 frames.
 * @returns {{rolls:number[], marks:string[], score:number|null, cumulative:number|null, complete:boolean}[]}
 *   score/cumulative stay null until the bonus balls for a strike/spare have been thrown.
 */
export function computeFrames(rolls) {
  const frames = [];
  let i = 0;
  let running = 0;
  let scorable = true;
  for (let f = 0; f < 10; f++) {
    const fr = { rolls: [], marks: [], score: null, cumulative: null, complete: false };
    if (f < 9) {
      if (i < rolls.length) {
        const a = rolls[i];
        if (a === 10) {
          fr.rolls = [10];
          fr.marks = ['X'];
          fr.complete = true;
          if (i + 2 < rolls.length) fr.score = 10 + rolls[i + 1] + rolls[i + 2];
          i += 1;
        } else {
          fr.rolls = [a];
          fr.marks = [mark(a)];
          if (i + 1 < rolls.length) {
            const b = rolls[i + 1];
            fr.rolls.push(b);
            fr.complete = true;
            if (a + b === 10) {
              fr.marks.push('/');
              if (i + 2 < rolls.length) fr.score = 10 + rolls[i + 2];
            } else {
              fr.marks.push(mark(b));
              fr.score = a + b;
            }
          }
          i += 2;
        }
      }
    } else {
      const [a, b, c] = rolls.slice(i, i + 3);
      if (a !== undefined) {
        fr.rolls.push(a);
        fr.marks.push(a === 10 ? 'X' : mark(a));
      }
      if (b !== undefined) {
        fr.rolls.push(b);
        fr.marks.push(a === 10 ? (b === 10 ? 'X' : mark(b)) : a + b === 10 ? '/' : mark(b));
        const bonus = a === 10 || a + b === 10;
        if (!bonus) {
          fr.complete = true;
          fr.score = a + b;
        } else if (c !== undefined) {
          fr.rolls.push(c);
          const freshRack = a + b === 10 || b === 10; // spare, or two strikes
          fr.marks.push(freshRack ? (c === 10 ? 'X' : mark(c)) : b + c === 10 ? '/' : mark(c));
          fr.complete = true;
          fr.score = a + b + c;
        }
      }
    }
    if (fr.score !== null && scorable) {
      running += fr.score;
      fr.cumulative = running;
    } else {
      scorable = false;
    }
    frames.push(fr);
  }
  return frames;
}

function mark(pins) {
  return pins === 0 ? '-' : String(pins);
}

/**
 * What happens next for this list of rolls.
 * @returns {{done:boolean, frame:number, ball:number, pinsUp:number}}
 *   frame 0-9, ball 0-2 within the frame, pinsUp = pins standing before the next ball.
 */
export function nextRoll(rolls) {
  const frames = computeFrames(rolls);
  const f = frames.findIndex((fr) => !fr.complete);
  if (f === -1) return { done: true, frame: 9, ball: 0, pinsUp: 0 };
  const r = frames[f].rolls;
  let pinsUp = 10;
  if (f < 9) {
    if (r.length === 1) pinsUp = 10 - r[0];
  } else if (r.length === 1) {
    pinsUp = r[0] === 10 ? 10 : 10 - r[0];
  } else if (r.length === 2) {
    pinsUp = r[0] === 10 && r[1] < 10 ? 10 - r[1] : 10;
  }
  return { done: false, frame: f, ball: r.length, pinsUp };
}

/** Total of every frame that can be scored so far. */
export function totalScore(rolls) {
  let total = 0;
  for (const fr of computeFrames(rolls)) if (fr.cumulative !== null) total = fr.cumulative;
  return total;
}

export class Scorecard {
  constructor() {
    this.rolls = [];
  }
  /** Record a ball. Throws if the pin count is impossible. */
  roll(pins) {
    const next = nextRoll(this.rolls);
    if (next.done) throw new Error('Game is already complete');
    if (!Number.isInteger(pins) || pins < 0 || pins > next.pinsUp) {
      throw new Error(`Invalid roll ${pins}: ${next.pinsUp} pins standing`);
    }
    this.rolls.push(pins);
    return this;
  }
  get frames() {
    return computeFrames(this.rolls);
  }
  get next() {
    return nextRoll(this.rolls);
  }
  get complete() {
    return nextRoll(this.rolls).done;
  }
  get total() {
    return totalScore(this.rolls);
  }
}

// Pins that touch in the rack (centre to centre one pin spacing apart).
const ADJACENT = [
  [1, 2], [1, 3], [2, 3], [2, 4], [2, 5], [3, 5], [3, 6], [4, 5], [5, 6],
  [4, 7], [4, 8], [5, 8], [5, 9], [6, 9], [6, 10], [7, 8], [8, 9], [9, 10],
];

/**
 * A split: after the first ball the head pin is down and the pins left standing are in two or
 * more groups with a gap between them (7-10, 4-6, 2-7, ...).
 * @param {number[]} standing pin numbers 1-10
 */
export function isSplit(standing) {
  if (standing.length < 2 || standing.includes(1)) return false;
  const left = new Set(standing);
  const seen = new Set([standing[0]]);
  const queue = [standing[0]];
  while (queue.length) {
    const p = queue.pop();
    for (const [a, b] of ADJACENT) {
      const q = a === p ? b : b === p ? a : 0;
      if (q && left.has(q) && !seen.has(q)) {
        seen.add(q);
        queue.push(q);
      }
    }
  }
  return seen.size < left.size;
}
