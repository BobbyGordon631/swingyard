# Swingyard

Motion-controlled 3D sports games that run in your browser, with your phone as the controller.
No app install, no Bluetooth: the game shows a QR code, your phone opens a web page and streams
its motion sensors to the game over your Wi-Fi. Play it at **https://kksolve.com/swingyard/**, or run
it on your own computer.

All names, characters, art and sounds are original. Sounds are synthesised live with the Web Audio API.

**Seven sports:** Bowling, Tennis, Baseball, Golf, Boxing, Archery and Swordplay, with a menu, phone lobby,
pause, results screens and a sensor debug overlay. Up to four phones; a computer opponent (Easy / Normal / Hard)
fills in for Tennis, Baseball, Boxing and Swordplay when one person plays. Two-player Tennis, Boxing and
Swordplay are split screen; Baseball is always split (batter's view and pitcher's view) while a pitch is coming.

**Full 3D motion.** The phone streams its orientation as well as its accelerometer and gyroscope, so the game
knows where the phone points and which way it moves in any direction, not just left/right tilt. The racket in
Tennis and the sword in Swordplay follow the phone 1:1; swings are classified by the real direction of travel.

**Big moments feel big.** Clean hits freeze for a few frames (hit-stop) and shake the camera. Knockdowns, ring-outs,
home runs and pins scattering from a full rack play in slow motion. Strikes build up to Double and Turkey calls with
confetti, and bowling cuts to the bowler celebrating. The crowd murmurs, cheers, groans and claps along. The Yardlings
breathe, blink, jump for joy and slump when things go wrong.

**Skill Level.** Every solo game (alone, or one person vs the CPU) moves a Skill Level for that sport. It climbs fast in
your first games and settles as it learns your level. Beat a stronger CPU, or win by more, and it rises faster. The
results screen shows the change and a graph, and 1000 makes you a **Pro**. In Tennis, Baseball and Boxing more fans turn
up to watch as your level grows. Levels are saved in the browser, and each sport card shows yours.

## Play online

Open **https://kksolve.com/swingyard/** on a computer or TV browser. The menu shows a QR code and a
room code; scan the code with your phone (or open `kksolve.com/swingyard/controller.html` and type
the room code), tap **Tap to connect** and allow motion. Up to four phones per room.

Online, the phone talks to the game screen directly over WebRTC (peer to peer). On the same Wi-Fi the
motion data never leaves your network. The free [PeerJS](https://peerjs.com) broker only introduces
the two devices. Phone and computer on the same Wi-Fi works best; over mobile data most networks
connect too, but some carriers block direct connections. If the game screen reloads, it keeps its room
and phones reconnect by themselves.

## Deploying

Every push to `main` runs the tests, builds the static site (`npm run build` → `dist/`) and publishes
it with GitHub Pages (`.github/workflows/pages.yml`). The repository is named `swingyard` under the
account that serves kksolve.com, so Pages publishes it at kksolve.com/swingyard/. Pages paths are
case-sensitive, so the repository name must stay lowercase.

`npm run preview` builds and serves the static site at http://localhost:8080/swingyard/ to try it
before pushing.

## Run it on your own computer (LAN mode)


Requires Node.js 18 or newer.

```sh
npm install && npm start
```

Then open **http://localhost:3000** on the computer. (Chrome or Safari; click the page once to enable sound.)

```sh
npm test    # scoring, swing detector and pin physics tests
```

## Connect a phone

1. Put the phone on the **same Wi-Fi network** as the Mac.
2. Scan the QR code on the menu screen. It opens `https://<your Mac's LAN IP>:3443/controller`.
3. The phone shows a **certificate warning**, because the server uses a self-signed certificate
   (generated automatically into `.cert/` on first start). Accept it:
   - iPhone (Safari): *Show Details* → *visit this website* → *Visit Website*
   - Android (Chrome): *Advanced* → *Proceed to … (unsafe)*
4. Tap **Tap to connect**, and on iPhone tap **Allow** for motion & orientation access.
5. A `P1`–`P4` badge lights up on the game screen. Up to 4 phones can join; the order they join is the player number.

Why HTTPS: browsers only expose motion sensors to secure pages. The traffic never leaves your local network.

## Controls

Hold the phone like a remote, pointing at the screen, and grip it tightly (or use a wrist strap).
The phone has an **arrow pad**, an **A** button, a big **HOLD** button (trigger), a **⟳ Center** button and a
small pause button. Each game shows its controls at the bottom of the screen.

**Pointing:** when a game starts, wherever the phone points counts as "at the screen". If aiming drifts, point at
the TV and tap **⟳ Center**. The line under the phone's status says `3D` when orientation is working
(`tilt only` means the browser didn't grant it; the games still work with tilt).

| | Phone | Keyboard / mouse |
|---|---|---|
| Menus | arrow pad, **A** to choose, HOLD = back | arrow keys, Enter, Esc = back |
| Pause | **II** button | Esc or P |
| Pointing | point the phone | the mouse position |
| Any "swing" | swing the phone | hold Space (a power meter sweeps), release. Arrow keys held at release give the swing a direction |
| **Bowling** | ◀ ▶ pick your board · point at an arrow for the angle · hold HOLD, swing back and through like a real bowl (the bowler's arm follows yours), let go at the bottom of the swing · twist = hook · letting go late lofts the ball | ← → move · mouse = angle · Space · ← → while charging = hook |
| **Tennis** | first person, racket follows the phone: swing it through the ball; the racket face aims, brushing up = topspin · serve: **flick the phone up** to toss, then swing up and through as it drops | ↑ / Enter tosses · release Space as the ball arrives (early = cross-court, late = down the line) |
| **Baseball** | batting: swing as the ball crosses the plate (uppercut = fly ball, chop = grounder) · pitching: point at the zone and swing (faster = faster pitch) · hold **A** = curve, **HOLD** = splitter, both = screwball · ◀ ▶ move on the rubber | Space to swing / throw · Enter picks the pitch · mouse aims the pitch |
| **Golf** | point to aim (◀ ▶ turns further) · **A** changes club · hold HOLD, swing back (the club follows) and through · twist = hook / slice | ← → turn · mouse fine-aims · Enter club · Space |
| **Boxing** | punch forward = straight · across = hook · upward = uppercut · point low = body blow · phone upright or HOLD = guard (pointed down + HOLD = low guard) · lean = slip · point down = duck · **A** = jab · when knocked down, punch to get up | Enter jab · Space punch (← → hook, ↑ uppercut, ↓ body) · hold Space = guard · ← → lean · ↓ duck |
| **Archery** | point at the target · hold HOLD to draw, let go to shoot | mouse (and arrow keys) aim · hold / release Space |
| **Swordplay** | the sword follows the phone · swing in any direction to slash · hold HOLD to guard with the blade across their slash | mouse angles the sword · Space slash (← → ↑ ↓ direction, none = chop) · hold Space = guard |
| Debug overlay | | D (then 0 = keyboard, 1–4 = a phone) |

In turn-based games (Bowling, Golf, Archery) the keyboard can always act for whoever's turn it is. In head-to-head
games (Tennis, Baseball, Boxing, Swordplay) each phone controls its own player and the keyboard controls the first
player who has no phone.

Rules in brief:

- **Bowling** — ten frames, standard scoring, splits circled on the card. Real lane physics:
  - *Oil:* a 40 ft house pattern, heavier in the middle boards than outside (miss room), that breaks down
    along your track and carries down the lane as the game goes on, so you have to move with the lane. The
    oil shows as gloss on the lane.
  - *Ball:* a 15 lb ball with a dense core (RG 2.50 in). Your wrist sets rev rate, axis rotation and tilt.
    It skids through the oil, hooks on the dry back end, then rolls. Release speed comes from how fast your
    arm actually swings (arm speed × arm length + the walk). Loft depends on when you let go.
  - *Pins:* built to the USBC tenpin spec: the 14-station profile, 3 lb 8 oz, centre of gravity 5.781 in,
    radius of gyration² 13.90 in², coefficient of restitution 0.670, and a 2.031 in base with a rounded
    edge, so a pin tips over past ~10°. Ball/pin, pin/pin and pin/deck impacts have proper Coulomb
    friction, and restitution acts on the whole contact velocity (two cannon-es shortcuts are corrected in
    `physics.js`). It matches the USBC pin carry study's high-speed video: a pocket hit sends the ball
    through 1-2-5 and off the deck by the 8 pin. Board 17.5 strikes about 85% of the time, more with a
    steeper entry angle. Light hits leave the corner pin or the 5; high and nose hits leave 4-7 or 2-4-7.
  - *Lane:* USBC geometry: round gutters, square flat gutters beside the deck, kickbacks 60⅛ in apart and
    20½ in high, the pit and cushion.
  - *Pinsetter:* simulated, not animated. The sweep bar and table are solid moving bodies. The table grips
    the standing pins and sets them back exactly where they stood, and the bar rakes the deadwood (gutter
    pins too) into the pit.
  - *HUD:* your board and target arrow, mph and rpm at release, then speed, entry angle and board at the
    pins. The ball's path is drawn on the lane.
- **Tennis** — real scoring (15/30/40, deuce, advantage, tiebreak), sets first to 3 games by default
  (`tennis.gamesPerSet`). Serves must land in the diagonal service box: two faults lose the point. Ball flight
  has drag, Magnus force from spin, and a spin-dependent bounce. Your player runs to the ball automatically.
  `tennis.assist` (0–1) decides how much near misses are pulled back into the court. The camera sits high behind
  your baseline and you watch your Yardling swing the racket. Set `tennis.view: 'first'` for first person.
- **Baseball** — 3 innings, no walks (balls are called but don't count), three strikes, fouls count as strikes
  up to two, and a 10-run mercy rule. Pitches are slower than real so they can be read, and the batter's timing
  window is wide. Fielding is automatic but simulated: the ball flies with drag, every fielder races it, throws
  race the runners, so you get line-outs, gappers to the wall, double plays and sacrifice flies. A tie after
  three innings is a draw.
- **Golf** — 3 holes (par 3, 4, 5) with wind, bunkers, water and putting. A dashed arc shows where a full shot
  (or the keyboard meter's power) will fly; a bobbing arrow marks the hole.
- **Boxing** — three 60-second rounds. Knockdowns get a ten count; punch to get up (it gets harder each time).
  Three knockdowns in a round is a TKO; otherwise the judges decide on damage and knockdowns.
- **Archery** — 3 ends of 3 arrows at 20, 35 and 50 m.
- **Swordplay** — first to 2 rounds; push your opponent off the platform. A guard only blocks when your blade is
  across the slash, and a blocked attacker is left off balance.

## Tuning the motion thresholds

Everything tunable is in one file: [`public/js/config.js`](public/js/config.js). Edit, save, reload the game page.

Press **D** in the game to open the debug overlay. It graphs, for one input source:

- raw and filtered acceleration magnitude, with the swing threshold, end level and full-power level drawn as dashed lines
- the three rotation-rate axes (α, β, γ)
- when the trigger was held (yellow bar) and every detected swing (shaded, labelled with its peak g)
- live values, and the last swing's peak, power %, twist and duration

Common adjustments:

| Symptom | Change |
|---|---|
| Swings aren't detected | lower `swing.thresholdG` (and `bowling.minThrowG`) |
| Small movements count as swings | raise `swing.thresholdG` |
| Full power is too hard / too easy to reach | lower / raise `swing.maxPowerG` |
| Ball hooks the opposite way to your wrist | set `phone.twistInvert: true` |
| Twist does nothing, or reacts to the wrong motion | twist your wrist with the overlay open, see which of α/β/γ moves, set `swing.twistAxis` to it |
| Hook is too sensitive | raise `swing.twistDeadzoneDps` / `swing.twistMaxDps`, or lower `bowling.revMax` |
| Tilting right moves left | set `phone.tiltInvertX: true` |
| Readings look jittery / laggy | lower / raise `filter.accelAlpha` |
| Swings feel late | lower `swing.peakDropRatio` (e.g. 0.7) so swings register sooner, or raise `phone.latencyMs` |
| Swings fire twice or too early | raise `swing.peakDropRatio` toward 0.9 |
| Sword slashes come out mirrored or as the wrong kind | `swing.yawInvert` / `swing.pitchInvert`, or swap `swing.yawAxis` / `swing.pitchAxis` |
| Pointer is jittery / sluggish | lower / raise `orientation.minCutoff`; raise `orientation.beta` if fast moves lag |
| Racket / sword feel a beat behind your hand | raise `orientation.predictMs` (draws them where the phone will be); lower it if fast swings overshoot |
| Pointing needs too big / small a movement | `orientation.yawRange` / `orientation.pitchRange` (degrees to the edge) |
| Tennis: the court looks too small / you can't see your player | `tennis.behindHeight`, `behindBack`, `behindFov`; or `tennis.view: 'first'` |
| Rotation-heavy swings (bat, racket, sword) register late | lower `swing.gyroDpsPerG` |
| Tennis: can't reach the ball with the racket | raise `tennis.hitRadius`; too many shots out: raise `tennis.assist` |
| Tennis: the toss doesn't trigger | lower `tennis.tossThresholdG` |
| Bowling hooks too much / too little | `bowling.revMax`, `bowling.axisMaxDeg`, or the lane: `oilLength`, `muDry` |
| Bowling: ball too fast / slow for your swing | `bowling.armLength` (arm speed → ball speed), `minSpeed` / `maxSpeed` |
| Bowling: lane changes too fast / slow over a game | `bowling.oilAbsorb` (breakdown), `oilCarry` (carrydown) |
| Bowling: outside lines too forgiving / punishing | `bowling.oilOutside` (outside oil relative to the middle), `crownBoards` |
| Bowling: pins carry too easily / not enough | `bowling.pinPinFriction`, `pinPinCOR`, `kickbackCOR`, `ballPinFriction` (the unmeasured values; the USBC pin numbers live in `physics.js`) |
| Boxing guard / duck / body blows trigger at the wrong angles | `boxing.guardPitch`, `duckPitch`, `bodyPitch` |
| Sword blocks too strict / lenient | `sword.blockToleranceDeg` |
| A sport is too hard / easy | each sport has its own section (`tennis`, `baseball`, `golf`, `boxing`, `archery`, `sword`) with speeds, timing windows and the three CPU levels |

## Troubleshooting

- **Phone can't open the page / it times out.** The phone and Mac must be on the same Wi-Fi (not a guest
  network with "client isolation"). If the Mac changes network (for example from a phone hotspot to Wi-Fi) the QR code updates by itself within a few
  seconds while the menu is open — scan the new one, and expect the certificate warning again. macOS may ask to
  allow incoming connections for `node` — allow it (System Settings → Network → Firewall).
- **Certificate warning.** Expected; see step 3 above. It appears once per phone (and again if the Mac's IP changes).
- **iPhone never asks for motion permission, or it was denied.** Close the tab completely and reopen the link, then
  tap *Tap to connect* → *Allow*. If it still doesn't ask, check Settings → Apps → Safari → *Motion & Orientation Access*.
- **Controller says "No motion data".** The browser isn't delivering sensor events: check the permission above, make
  sure the address starts with `https://`, and use Safari on iPhone or Chrome on Android.
- **Swings feel laggy.** The controller's top line shows `link NN ms`, the round trip to the Mac. Under ~30 ms is
  good; over 60 ms means busy Wi-Fi. Use a 5 GHz network, move closer to the router, or turn off the Mac's VPN.
- **Controller says "Reconnecting…".** The socket dropped (phone locked, Wi-Fi blip). It retries every second and
  takes its old player slot back. If it never reconnects on iPhone, reload the page and accept the certificate again.
- **No vibration on iPhone.** Safari on iOS has no vibration API; the controller screen flashes instead.
- **No sound.** Click the game page or press a key once — browsers block audio until then.
- **Port already in use.** `PORT=3001 HTTPS_PORT=3444 npm start`.

## How it's put together

```
server/index.js               Express + ws. HTTP :3000 (game), HTTPS :3443 (controller), self-signed cert,
                              LAN IP detection, QR code, relays phone packets to the game screen
                              (LAN mode)
public/js/net/screenLink.js   the game screen's link to the phones: WebSocket to the server (LAN), or a WebRTC
                              room with player slots, reconnects and a QR code (online / GitHub Pages)
scripts/build-static.mjs      builds the static site into dist/ for GitHub Pages
.github/workflows/pages.yml   test, build and deploy on every push to main
public/controller.html        phone page: motion + orientation permission, 60 Hz sensor stream, arrow pad / A / HOLD / Center / pause,
                              wake lock, room code entry (online)
public/js/config.js           every threshold
public/js/input/              InputSource (the one input interface) + PhoneSource + KeyboardSource + InputManager
public/js/motion/             EMA and One Euro filters, swing detector, orientation (quaternions, recentring, pose)
public/js/games/common.js     shared base class: HUD, player/controller mapping, outdoor scenery
public/js/games/bowling/      scoring.js (rules, splits), physics.js (cannon-es lane, ball, pins), oil.js (pattern), game.js
public/js/games/tennis/       scoring.js (rules), physics.js (drag, spin, bounce, shot solver), game.js
public/js/games/baseball/     rules.js (batted-ball flight, fielding race, base running), game.js
public/js/games/golf/         course.js (holes, lies, ball flight, putting), game.js
public/js/games/boxing/       game.js
public/js/games/archery/      game.js
public/js/games/sword/        game.js
public/js/main.js             menu, lobby, pause, results, render loop
public/js/audio.js            Web Audio sound effects, including the crowd (murmur, cheers, groans, applause)
public/js/characters.js       the low-poly "Yardling" characters, their idle life and reactions
public/js/feel.js             hit-stop, slow motion, camera shake, celebration words and confetti
public/js/skill.js            Skill Level per sport (saved in the browser), with the results-screen graph
public/js/debugOverlay.js     the D-key sensor graph
test/                         node:test suites
```

Every game reads input through `InputSource`: acceleration (g, gravity removed) in phone axes and in TV axes,
acceleration including gravity (for tilt), rotation rate (deg/s), the 3D pose (yaw / pitch / roll, pointing and
screen-normal vectors) and buttons (`hold`, `a`, `pause`, `up`, `down`, `left`, `right`, `center`). Each swing
reports which way the phone travelled (`move`) and which way its far end swept (`tip`). A new device only has to call
`pushSample()` and `setButton()`; filtering and swing detection are shared. The keyboard/mouse fallback works this
way too — it synthesises sensor samples rather than bypassing the detector.

Swing logic: sensor data is low-pass filtered; a swing starts when acceleration magnitude (or fast rotation,
`swing.gyroDpsPerG`) crosses `swing.thresholdG` (2 g) — games get a `swingstart` event at that moment so
animations begin instantly — and its peak sets power; rotation around the phone's long axis sets spin.
Orientation is smoothed with an adaptive (One Euro style) filter: steady when you hold still, no lag when you
move fast. Angular velocity is derived from the orientation itself, so it doesn't depend on how each browser
labels its rotation-rate axes.
