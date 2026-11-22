// Every tunable threshold lives here. Edit, save, reload the game page.
// Press D in the game to open the debug overlay and watch these values live.
//
// Units: acceleration in g (1 g = 9.81 m/s^2), rotation in degrees per second,
// time in milliseconds unless the name says otherwise.

export const CONFIG = {
  // ---- Sensor smoothing ----
  filter: {
    accelAlpha: 0.6, // swing acceleration (EMA weight of the newest sample: 1 = raw)
    rotAlpha: 0.4, // rotation rate
    // Tilt uses a One Euro filter: smooth when you hold still, almost no lag when you move fast.
    tiltMinCutoff: 1.2, // Hz; lower = smoother when still
    tiltBeta: 0.6, // how quickly the smoothing backs off as you move
    gravityAlpha: 0.05, // gravity estimate, only used if the phone does not report gravity-free acceleration
  },

  // ---- Full 3D orientation (yaw / pitch / roll, from the phone's orientation sensor) ----
  orientation: {
    minCutoff: 1.6, // Hz; smoothing when still (lower = steadier pointer)
    beta: 0.9, // smoothing falls away as the phone turns faster (rad/s)
    omegaAlpha: 0.55, // smoothing of the angular velocity estimate
    // Rackets and swords are drawn where the phone will be this many ms from now (extrapolated from how
    // fast it is turning). Hides Wi-Fi delay; too high and fast swings overshoot. 0 = off.
    predictMs: 28,
    yawRange: 32, // degrees left/right of centre that map to the edge of the pointer range
    pitchRange: 24, // degrees up/down of centre that map to the edge of the pointer range
  },

  // ---- Swing detection ----
  swing: {
    thresholdG: 2.0, // a swing starts when filtered |acceleration| rises above this
    // Fast wrist rotation also counts toward a swing (bats, rackets, swords start with the wrist),
    // which makes swings register sooner. This many deg/s counts like 1 g.
    gyroDpsPerG: 260,
    endRatio: 0.6, // ...and ends when it falls below thresholdG * endRatio
    minDurationMs: 30, // shorter spikes are treated as noise (taps, bumps)
    maxDurationMs: 700, // a swing is force-ended after this long
    cooldownMs: 250, // ignore new swings for this long after one ends
    peakDropRatio: 0.8, // a swing is reported once acceleration falls to this fraction of its peak
    minPowerG: 2.0, // peak g that maps to power 0
    maxPowerG: 5.5, // peak g that maps to power 1 (lower this if full power feels too hard)
    // Wrist twist = rotation rate around the phone's long axis.
    twistAxis: 'beta',
    twistWindowMs: 120, // twist is averaged over this window around the swing peak / release
    twistDeadzoneDps: 60, // below this the shot is straight
    twistMaxDps: 500, // this much twist = full spin
    // Used only when the phone has no orientation sensor: slash direction from the raw rotation rate.
    yawAxis: 'gamma',
    pitchAxis: 'alpha',
    yawInvert: false,
    pitchInvert: false,
  },

  // ---- Phone specifics ----
  phone: {
    latencyMs: 0, // extra milliseconds to subtract from phone timestamps if swings still feel late
    invertIOS: true, // iOS reports acceleration with the opposite sign to Android; normalise it
    tiltInvertX: false, // flip if tilting right moves things left
    twistInvert: false, // flip if the ball hooks the opposite way to your wrist
  },

  // ---- Menus (arrow pad on the phone or arrow keys; A / Enter confirms; HOLD / Esc goes back) ----
  menu: {
    repeatDelayMs: 380, // hold an arrow this long before it starts repeating
    repeatMs: 130,
  },

  // ---- Keyboard + mouse fallback (generates synthetic sensor data through the same pipeline) ----
  keyboard: {
    tiltG: 0.6, // arrow keys tilt this far
    chargePeriodMs: 1800, // hold Space: power meter sweeps 0 -> 1 -> 0 over this time
    minSwingG: 2.3,
    maxSwingG: 5.6,
    swingMs: 190,
    twistDps: 500,
    mouseGPerPxMs: 1.6,
    mouseTwistDpsPerPxMs: 300,
  },

  // ---- Bowling ----
  bowling: {
    minThrowG: 1.3, // on release, a recent peak below this cancels the throw (no accidental drops)
    releaseWindowMs: 450,
    minSpeed: 6.0, // ball speed (m/s) at power 0 (about 13 mph)
    maxSpeed: 9.4, // ball speed (m/s) at power 1 (about 21 mph)
    // Ball/lane physics: the ball skids on the oiled front part of the lane, hooks when it reaches
    // the dry back end, then rolls. Friction coefficients are real-world values.
    // The oil pattern (a "house shot"): heavier in the middle boards than outside.
    oilLength: 12.2, // metres of oil from the foul line (a 40 ft pattern)
    oilTaper: 2.0, // metres over which the oil fades out
    crownBoards: 20, // width of the heavily oiled middle (boards 10-30)
    oilOutside: 0.3, // oil on the outside boards relative to the middle
    muOil: 0.02, // reactive resin ball on fully oiled wood (published values 0.01-0.04)
    muDry: 0.21, // ...and on the dry back end
    muGutter: 0.15,
    rollingResistance: 0.006, // fraction of g
    // Lane transition: each ball soaks up oil along its track and carries some down the lane.
    oilAbsorb: 0.03, // fraction of the oil under the track the ball picks up per pass
    oilCarry: 0.25, // fraction of that it lays back down further along (carrydown)
    oilDeposit: 0.12, // per foot, fraction of the carried oil laid down
    // Release
    loft: 0.05, // m above the lane when the ball leaves the hand (lands ~0.5 m past the foul line)
    revMin: 22, // rad/s of spin with no wrist twist (about 210 rpm)
    revMax: 44, // rad/s at full twist (about 420 rpm, a strong two-handed / cranker release)
    axisMaxDeg: 55, // axis rotation at full twist (0 = end-over-end, 90 = spinning sideways)
    tiltMinDeg: 6, // axis tilt: spinning-top component, makes the ball skid further
    tiltMaxDeg: 10,
    // Impacts (pin numbers from the USBC spec are in physics.js). Not published: ball/pin friction
    // is low because the ball's surface is oily by the time it reaches the pins; pin/pin values are
    // for Surlyn-coated pins. Tuned so strike rate rises with entry angle and is ~85% on board 17.5,
    // as in the USBC pin carry study.
    ballPinFriction: 0.05,
    pinPinFriction: 0.2,
    ballPinCOR: 0.67, // USBC pin spec: 0.670 (0.605-0.735)
    pinPinCOR: 0.55,
    kickbackCOR: 0.55,
    spotJitter: 0.002, // m the pinsetter may set a pin off its spot
    // Speed from the arm swing: the hand moves at (arm angular speed x arm length) plus the
    // walking speed of the approach. Blended with the swing strength measured by the accelerometer.
    armLength: 0.68,
    approachSpeed: 1.5,
    moveSpeed: 0.7, // m/s the bowler walks sideways while an arrow is held
    angleRange: 5, // degrees of throwing angle at the edge of the pointer range
    swingLineDeg: 2, // up to this many degrees added from the sideways direction of your arm swing
    aimRange: 0.46, // max distance from lane centre (m); the lane is 1.05 m wide
  },

  // ---- Tennis (racket follows the phone) ----
  tennis: {
    // 'behind' = the camera sits high behind your baseline and you see your player swing (the classic
    // living-room tennis view); 'first' = first person, through your player's eyes.
    view: 'behind',
    behindHeight: 8, // m above the court
    behindBack: 9.5, // m behind your player (or the baseline, whichever is further back)
    behindFov: 48, // degrees, vertical
    gamesPerSet: 3,
    setsToWin: 1,
    // Racket: the head is this far from the shoulder; contact is checked against the moving racket.
    armLength: 0.55,
    racketLength: 0.62,
    hitRadius: 0.22, // m from the strings' centre (head ~0.14 + ball); the reach assist brings the racket to the ball
    racketCOR: 0.42, // apparent coefficient of restitution of a hand-held racket
    assist: 0.65, // 0 = pure physics, 1 = shots always land in court (direction still yours)
    tossThresholdG: 1.1, // flick the phone upward this hard to toss the ball
    serveWindowS: 0.45, // you may hit the toss this long either side of the top of its flight
    // Keyboard / no-orientation fallback timing window
    swingEarlyS: 0.38,
    swingLateS: 0.12,
    idealLeadS: 0.13,
    playerSpeed: 6.5, // m/s auto-run
    ai: [
      { speed: 4.6, shot: 18, error: 0.14, placement: 0.25, spin: 0.2 },
      { speed: 5.8, shot: 23, error: 0.07, placement: 0.55, spin: 0.45 },
      { speed: 7.2, shot: 28, error: 0.03, placement: 0.9, spin: 0.7 },
    ],
  },

  // ---- Baseball ----
  baseball: {
    innings: 3,
    mercyRuns: 10, // the game ends when a team leads by this many after a full inning
    pitchMinSpeed: 15, // m/s at power 0 - slow enough to read
    pitchMaxSpeed: 26, // m/s at power 1
    windupS: 1.1, // pitcher's wind-up: your warning to get ready
    batWindowS: 0.22, // swing within this of the ball crossing the plate to make contact
    runnerSpeed: 7.4, // m/s
    fielderSpeed: 6.4,
    walks: false, // no walks: only strikes count, as in classic arcade baseball
    throwSpeed: 30,
    // AI levels: batting contact chance, pitching power, fielders' reaction time (s)
    ai: [
      { contact: 0.42, pitch: 0.3, react: 0.55 },
      { contact: 0.58, pitch: 0.55, react: 0.4 },
      { contact: 0.72, pitch: 0.8, react: 0.28 },
    ],
  },

  // ---- Golf ----
  golf: {
    aimRange: 22, // degrees the pointer can turn the shot either way
    aimSpeed: 0.7, // rad/s the arrow pad turns the aim
    curveAccel: 1.0, // sideways m/s^2 at full twist (hook / slice); flights with drag and lift last ~6 s
    windEffect: 0.07, // m/s^2 of push per m/s of wind
    puttMax: 24,
    maxOverPar: 4,
    flightSpeed: 1.25, // replay speed of the ball flight
  },

  // ---- Boxing ----
  boxing: {
    rounds: 3,
    roundSeconds: 60,
    damage: { jab: 5, straight: 7, hook: 9, uppercut: 11 }, // at power 0; x2.2 at full power
    bodyFactor: 0.75, // body blows do less damage but get under a high guard
    guardPitch: 50, // degrees: hold the phone up past this (like gloves in front of your face) to guard
    duckPitch: -45, // point the phone down past this without punching to duck
    bodyPitch: -14, // punching with the phone pointed below this is a body blow
    dodgeTiltG: 0.32, // lean the phone past this to slip left / right
    buttonJabPower: 0.35,
    getUpMashes: [5, 8, 12], // swings needed to get up after the 1st, 2nd, 3rd knockdown
    ai: [
      { think: 1.6, windup: 0.6, defend: 0.18, power: 0.35, getUp: 0.85 },
      { think: 1.1, windup: 0.45, defend: 0.38, power: 0.55, getUp: 0.75 },
      { think: 0.75, windup: 0.34, defend: 0.58, power: 0.75, getUp: 0.65 },
    ],
  },

  // ---- Archery ----
  archery: {
    distances: [20, 35, 50],
    arrowsPerEnd: 3,
    aimReach: 1.6, // metres either side of the target centre the pointer reaches
    aimSpeed: 0.9, // keyboard arrows: metres per second
    drawSeconds: 1.1,
    steadySeconds: 3.5,
    windMax: 6,
  },

  // ---- Swordplay ----
  sword: {
    roundsToWin: 2,
    arenaHalf: 3.2,
    push: 0.45, // metres a clean hit drives the opponent back at power 0 (x2.2 at full power)
    minSlashDps: 280, // the blade must move at least this fast to count as a slash
    blockToleranceDeg: 38, // a guard blocks when your blade is within this of perpendicular to the slash
    blockStunS: 0.9, // a blocked attacker is off balance this long
    ai: [
      { think: 1.6, windup: 0.75, block: 0.25, power: 0.35 },
      { think: 1.1, windup: 0.55, block: 0.45, power: 0.55 },
      { think: 0.72, windup: 0.4, block: 0.65, power: 0.75 },
    ],
  },

  debug: {
    historyMs: 5000,
  },
};
