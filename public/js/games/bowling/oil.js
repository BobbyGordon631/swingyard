// Lane conditioner (oil). Pure JS, no DOM or physics engine, so it runs in Node tests.
//
// A real lane is oiled in a pattern, not evenly. On a typical "house shot":
//   - oil runs about 40 ft from the foul line and then the back end is dry;
//   - there is much more oil in the middle boards (the "crown") than on the outside boards, so a
//     ball that drifts outside grabs the drier boards and hooks back. That is the "miss room"
//     that makes a house shot forgiving.
// Every ball also changes the lane: it soaks up oil along its track (breakdown, so the track
// hooks earlier as a game goes on) and drags some of it further down the lane (carrydown, so
// the back end gets slicker). Lanes are re-oiled when a new game starts.
//
// The grid holds relative oil volume per board (39 boards) per foot of lane: 1 = the full amount
// in the middle of the pattern, 0 = dry wood.

export const BOARDS = 39;
export const ROW = 0.3048; // 1 ft

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class LaneOil {
  /**
   * @param cfg CONFIG.bowling (oilLength, oilTaper, oilOutside, crownBoards, muOil, muDry,
   *            oilAbsorb, oilCarry, oilDeposit)
   */
  constructor(cfg, laneWidth, laneLength) {
    this.cfg = cfg;
    this.width = laneWidth;
    this.bw = laneWidth / BOARDS;
    this.rows = Math.ceil(laneLength / ROW) + 4; // a little past the pin deck
    this.grid = new Float32Array(BOARDS * this.rows);
    this.carried = 0; // oil on the ball's track, waiting to be laid down again
    this.version = 0; // bumped on every change, so the renderer knows to redraw
    this.reset();
  }

  /** Fresh oil: the pattern as it comes out of the lane machine. */
  reset() {
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < BOARDS; i++) this.grid[j * BOARDS + i] = this.pattern(i, j * ROW);
    }
    this.carried = 0;
    this.version++;
  }

  /** Oil volume of the fresh pattern on board index i (0 = left edge) at d metres from the foul line. */
  pattern(i, d) {
    const c = this.cfg;
    const fromCentre = Math.abs(i - (BOARDS - 1) / 2); // in boards
    const half = c.crownBoards / 2;
    // 1 across the crown, easing down to oilOutside at the edge boards.
    const cross = 1 - (1 - c.oilOutside) * smoothstep(half, half + 6, fromCentre);
    // Outside boards are oiled a little shorter than the middle, as lane machines do.
    const len = c.oilLength * (0.88 + 0.12 * cross);
    const along = 1 - smoothstep(len - c.oilTaper / 2, len + c.oilTaper / 2, d);
    return cross * along;
  }

  /** Board coordinates of lane position x (m, 0 = centre). */
  _fi(x) {
    return (x + this.width / 2) / this.bw - 0.5;
  }

  /** Relative oil volume at (x, d), bilinear between board centres and foot marks. */
  at(x, d) {
    const fi = Math.min(BOARDS - 1, Math.max(0, this._fi(x)));
    const fj = Math.min(this.rows - 1, Math.max(0, d / ROW));
    const i0 = Math.min(BOARDS - 2, Math.floor(fi));
    const j0 = Math.min(this.rows - 2, Math.floor(fj));
    const ti = fi - i0;
    const tj = fj - j0;
    const g = this.grid;
    const a = g[j0 * BOARDS + i0] * (1 - ti) + g[j0 * BOARDS + i0 + 1] * ti;
    const b = g[(j0 + 1) * BOARDS + i0] * (1 - ti) + g[(j0 + 1) * BOARDS + i0 + 1] * ti;
    return a * (1 - tj) + b * tj;
  }

  /**
   * Ball/lane friction coefficient at (x, d). A thin film already lubricates well, so friction
   * falls quickly with the first bit of oil and then levels off.
   */
  mu(x, d) {
    const c = this.cfg;
    const o = Math.max(0, this.at(x, d));
    const k = 3;
    const f = Math.min(1, (1 - Math.exp(-k * o)) / (1 - Math.exp(-k)));
    return c.muDry + (c.muOil - c.muDry) * f;
  }

  /**
   * The ball rolled `ds` metres over (x, d): it soaks up a little oil from its track and lays some
   * of what it carries back down (carrydown).
   */
  wipe(x, d, ds) {
    const c = this.cfg;
    const fi = this._fi(x);
    const j = Math.round(d / ROW);
    if (j < 0 || j >= this.rows || ds <= 0) return;
    const frac = ds / ROW;
    // The track (with flare) is about two boards wide.
    const i0 = Math.floor(fi);
    const t = fi - i0;
    let picked = 0;
    for (const [i, w] of [[i0 - 1, 0.5 * (1 - t)], [i0, 1 - 0.5 * t], [i0 + 1, 0.5 + 0.5 * t], [i0 + 2, 0.5 * t]]) {
      if (i < 0 || i >= BOARDS) continue;
      const k = j * BOARDS + i;
      const take = this.grid[k] * c.oilAbsorb * frac * w * 0.5;
      const give = this.carried * c.oilDeposit * frac * w * 0.5;
      this.grid[k] += give - take;
      picked += take;
      this.carried -= give;
    }
    this.carried = Math.max(0, this.carried + picked * c.oilCarry);
    this.version++;
  }

  /** The ball has left the lane: whatever oil it still carries goes with it. */
  endBall() {
    this.carried = 0;
  }
}

/** Lane board number (1-39) under x, counted from the right gutter as bowlers do. */
export function boardAt(x, laneWidth) {
  const bw = laneWidth / BOARDS;
  return Math.min(BOARDS, Math.max(1, Math.round(20 - x / bw)));
}
