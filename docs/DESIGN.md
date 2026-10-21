# Off Road: design

Internal notes. The game recreates the layouts and feel of the 1989 original top-down off-road racer as closely as
possible, in real 3D, with our own names, art and music. Public text says only "Off Road" (see CLAUDE.md).

## Architecture

```
src/
  main.ts            boot: renderer, RAPIER.init, truck models, audio bridge, then the Flow on ?scene=
  game/
    flow.ts          the screen flow (title → hints → sign-up → get ready → race → results → shop / continue),
                     the one Loop, window.__or handles that follow the current scene
    race-scene.ts    one track on screen: its own three.js scene + Rapier world, Session, Race, HUD, results, camera
    season.ts        season state (players, CPU trucks, cash, credits, levels, nitros), line-up, rotation lookup,
                     settleRace(), the or.season save
    economy.ts       prices, levels, upgrade → TruckMods, buy(), CPU shopping, credits / FREE RACE / continue
    rotation.ts      raceAt(n, race): the cycle rotation (pure)
    *.test.ts        vitest unit tests (npm test)
  engine/
    renderer.ts      WebGLRenderer (sRGB, PCF soft shadows), scene, hemisphere + low sun
    camera.ts        the fixed whole-track camera (CAMERA: pitch, fov, margins) and fitFixedCamera()
    loop.ts          fixed 60 Hz physics step with an accumulator (max 6 steps/frame), render per rAF, advance()
    input.ts         keyboard + Gamepad API → TruckInput; confirm (Enter / pad A) for menus
    retro.ts         the DOS look (F2): low-res render target, palette + dither, scanlines; or.settings
  physics/
    world.ts         RAPIER.init(), World (gravity -14), PHYSICS_DT, collision GROUPs
    heightfield.ts   height grid → Rapier heightfield collider; wall polylines → cuboid colliders (an invisible fence)
    vehicle.ts       Truck: DynamicRayCastVehicleController + arcade assists; TUNING; surfaces (dirt, water, mud)
  track/
    types.ts         the track JSON schema ("Track format" below)
    tracks/          one JSON per track + index.ts (registry, TRACK_ORDER, getTrack(id, reversed))
    heights.ts       track JSON → height grid (features: ramp, dip, mound, whoops, ridge, bank, plateau; bridges cut
                     and fill after the sum; infield; base noise)
    line.ts          RacingLine: closed Catmull-Rom spline, arc-length samples, project / pointAt / curvature
    build.ts         grid → ground mesh (per-track palette), water (ellipses, creek ribbons), mud sheen, tyre walls +
                     flags, bridge decks + railings, start line, flagman tower + start lamps, stadium dressing, props
                     (bunting, solid drums), colliders, surface queries, levelAt (deck or ground)
    props-view.ts    swaps the placeholder props for instanced prop GLBs (PROP_MODELS table) + floodlights
  race/
    session.ts       the world + track + 1–4 trucks and views, effects, physics → game events
    race.ts          the race flow: Get Ready → lamps → race (gates, laps) → finish → results, records, pickups
    ai.ts            AiDriver: racing-line lookahead steering, speed plan, nitro, unstuck/reverse, rescue
    roster.ts        the four trucks (colours, our driver names, skills), start nitros, prize money
    pickups.ts       money bags and nitro bottles on the racing line, escalating values
    events.ts        the game event bus (audio subscribes here)
    models.ts        public/models/models.json (ssg model apply) when present: modelIndex(), loadModel(name)
    truck-view.ts    the truck's look: the generator's GLB with manifest-driven wheels, or the box placeholder
    characters.ts    the generator's Synty characters: Character (clone + mixer, play by clip), bakePose()
    crowd.ts         the grandstand fans: a few skinned, the rest baked poses instanced; cheers on the event bus
  fx/
    particles.ts     pooled instanced billboards: dust, water splash, mud spray, nitro smoke
    skids.ts         skid-mark decals: a ring buffer of instanced ground segments that fade out
  ui/
    pixel.ts         the bundled pixel font (Press Start 2P) and a style helper
    race-hud.ts      the one-panel race HUD, the track name, centre banners, floating pickup texts
    results.ts       the podium / results screen (season: FREE RACE! / CREDIT LOST, credits, the shop prompt)
    podium-view.ts   the results screen's 3D podium: its own small canvas, drivers, trucks, trophy
    toast.ts         a short message at the top (F2's DOS look setting)
    debug.ts         F3 overlay
    screens/         full-screen menus: common (DOS look, panels, icons), title, hints, register (+ get ready),
                     shop, continue (+ game over), track-thumb (a 2D map of a track from its JSON)
```

### Boot and scenes
`main.ts` reads `?scene=` (unknown scenes throw so the load check fails loudly) and hands over to `game/flow.ts`:
- `title` (default when there's no `?scene`): the title / attract screen and the season (see "Season and flow").
- `shop`: the Speed Shop straight away, on the saved season or a fresh one (`&cash=` default 250000, `&race=`
  default 1, `&colour=`); for checks.
- `test`: the player's truck alone on `?track=` (default `test`, the proving ground). R resets.
- `race`: a 4-truck race on `?track=` (default `rattlesnake`). `&reverse` drives the reversed variant, `&cpus=0..3`
  races fewer CPU trucks (tuning), `&autopilot` lets the AI drive the player's truck (tests, demos).
- `podium`: the results screen with made-up results and no race behind it, for the podium screenshot
  (`&order=2,0,1,3`: slots from 1st to 4th). `load-check.mjs … podium` saves `test-results/podium.png`.

`?debug` opens the F3 overlay. Every race scene runs a little physics when it's built (0.5 s; 1 s on the proving
ground) so the trucks settle on their springs; the loop starts and `window.__or.ready` is set once the first scene
or screen is up.

### Loop
Physics always steps at 1/60 s. A render frame runs as many steps as the elapsed time needs, at most 6; beyond that
the game slows down rather than spiralling (SwiftShader runs ~6–8 fps, so headless tests see slow motion). Tests
measure simulated time (`__or.simTime`) or call `__or.advance(seconds)` to step synchronously.

### Camera
The original shows a whole track on one screen from a high 3/4 view with almost no perspective. We use a
perspective camera with a narrow vertical FOV (18°) pitched 58° below the horizon, looking north (-z), placed by
`fitFixedCamera()`: a binary search on the distance until the track's wall bounds (plus the HUD anchors) fit the
window with small margins, then the aim is nudged so the box is centred. It re-fits on resize. The camera never
moves during a race. The original's view is about 60–65° down with mild perspective (research notes), so 58° with
an 18° FOV is close; the arena fills the width of a 16:9 window like the original fills its 4:3 one.

### Track data → world
A track is one JSON (`src/track/tracks/<id>.json`, schema in `src/track/types.ts`, format below). `heights.ts`
evaluates it into one height grid that feeds both the Rapier heightfield and the ground mesh, so visuals and physics
agree; the load check raycasts the collider at 60 points and fails if it differs from the grid by > 0.2 m (catches a
transposed field: Rapier wants a column-major matrix with rows along z; the sample points sit just off the cell
lines because Rapier's heightfield ray cast can miss exactly on a triangle edge). Walls are cuboids per segment,
sunk 2 m under the lowest ground and 4.5 m above the highest (the tyres are drawn 1.3 m tall; the rest is an
invisible fence so no truck ever leaves the arena), with restitution 0.45 for the original's bouncy wall hits. Zones
are queried per step: water and mud apply horizontal drag; mud also cuts the lateral grip assist.

### Track format
All coordinates are metres: x east (screen right), z south (towards the camera), y up. Headings are yaws where 0
faces +z (south) and π/2 faces +x (east).

| Field | Meaning |
|---|---|
| `id`, `name` | registry id and the name shown beside the HUD (our own names) |
| `size {w, d}`, `res` | heightfield extent (centred on 0,0) and cell size (0.5 m) |
| `baseNoise {amp, freq}` | gentle rolling of the whole floor |
| `infield?` | optional raised grass polygon |
| `features[]` | `ramp` (x, z, heading, length, width, height, `planks` to draw boards), `dip`, `mound` (ellipses), `whoops` (bumps across a lane), `ridge` (a raised pink band along a polyline: a hump on every lane it crosses; a negative height digs a channel, e.g. a creek bed), `bank` (the ground tilts across a band along a polyline, up to `height` on `side` +1 = left of its direction / -1 = right; it rolls off past the raised edge and fades out past the ends), `plateau` (a flat-topped polygon, sides sloping over `slope` m: tabletops, mesas), `bridge` (below) |
| `walls[]` | polylines of tyres; `walls[0]` is the closed outer wall; open walls get a flag pole at each free end |
| `zones[]` | `water` (surface `level`, `drag`) and `mud` (`drag`, `grip` multiplier), each an `ellipse` (x, z, rx, rz) or a `path` (`points`, `width`: a band along a polyline, e.g. a creek); mud is drawn darker and glossy |
| `start {heading, grid[]}` | grid slots: 0 = the player (pole), then yellow, blue, grey; keep them off slopes (trucks roll before the green light) |
| `line[]` | the racing line's control points, forward direction (closed Catmull-Rom); hairpins drive best as real arcs (a few points on a circle), not a cusp |
| `gates[]` | ordered checkpoint segments wall to wall; gate 0 is the start/finish line (drawn chequered); a gate must not lie across the other level or lane at a crossing |
| `hud {panel, name}` | world points of the HUD panel and the track name (an empty spot of the arena) |
| `flagman {x, z, heading}` | the flagman's tower and start lamps beside the line |
| `laps?` | default 4 |
| `reverse {start}` | the reversed variant's grid; the line, the gate order and ramp headings flip automatically (`getTrack(id, true)`, id `<id>-r`) |
| `props[]` | dressing: `tyre_pile`, `barrel`, `hay_bale`, `cone` (drawn, not collided), `bunting` (pennants on two poles, `len` m across `rot`, standing on the highest ground under it: marks a jump), `drum` (a 3 m banded drum, solid) |
| `palette?` | the track's accent colours: `dirt`, `dirtDark`, `dirtLight`, `ridge`, `wallA` / `wallB` (the tyre paint bands, bridge stripes), `flag`, `backWall`, `accent` (barrels) |

**Bridges (crossings).** A heightfield has one height per point, so a crossover is a `bridge` feature plus its own
collider: `{type: 'bridge', x, z, heading, width, height, ramp, under: {heading, width, depth, ramp}}`. (x, z) is
where the two lanes' centrelines cross; `heading` is the upper lane's direction, `under.heading` the lower lane's.
`heights.ts` first fills an embankment along the upper lane (flat at `height` over the deck span plus a metre, then
`ramp`-long approaches, sides falling over 2.5 m), then cuts the lower lane's cutting through it (floor at
`-under.depth` under the whole deck, `under.ramp`-long slopes out, near-vertical walls 0.7 m wide). `build.ts` adds
the deck: a cuboid collider flush with the embankment top, spanning the cutting where it crosses the deck's full
width (`spanHalf` = half the cutting width / sin(crossing angle) + the deck's half-width · cot + 0.8 m), drawn as a
plank slab with striped sides, and two railings (walls from just under the deck to 1.6 m above it, so they never
reach the lane below). Height + depth − 0.4 m slab must leave ≥ 2.8 m clearance (a truck's chassis tops out about
1.7 m above its wheels' ground). The lanes' tyre walls meet at the four corners where the edge lines cross (the upper
lane's walls end at the cutting's edge, the lower lane's at the embankment). Trucks on the deck never touch the lane
below: the wheels ride the deck collider, and `Session.unstack` ignores trucks more than 2.4 m apart in height.
`Track.levelAt(x, z, heading)` returns the deck height on a deck footprint when the heading runs along the deck
(else the ground), and is used to place trucks on the grid, rescued trucks, and pickups on the right level. A
**jump crossing** (Twister Flats) needs no bridge: the lower route runs in a channel (a negative `ridge` with water)
between two low berms (`ridge`s) that launch the upper route over it.

Adding a track (OR3): write the JSON, register it in `tracks/index.ts` (and `TRACK_ORDER`), then
- `node scripts/track-map.mjs <url> <id> [--reverse]`: a top-down map (heights, walls, line with arrows, gates,
  zones, decks, grid, HUD) to `test-results/map-<id>.png`, plus the line length, its tightest radius, every spot
  where the line passes < 3 m from a wall, and each gate's crossings by the line (exactly one each, in order);
- `node scripts/hit-probe.mjs <url> <id> [--reverse] [--alone] [--trace]`: a race on fixed steps that prints the
  wall hits by 5 m cell, every rescue with where it happened, lap times and resets (`--trace` logs the player's
  truck once a second: where laps go wrong);
- `node scripts/race-check.mjs <url> <id>` (and `--reverse`) and `node scripts/load-check.mjs <url> race
  track=<id> [reverse]`; lap times of 13–18 s (`node scripts/lap-probe.mjs <url> <id>`).

### Track 1: Rattlesnake Run
The first track of the original is a four-pass serpentine: the start/finish on the bottom-left, east along the
bottom lane, west, east, west along the top, then a wide diagonal lane down the left side back to the line, with a
raised ridge crossing every pass, a plank ramp on the bottom lane, moguls in the left pocket and a rough patch in the
bottom-right turn. Ours keeps that topology but not the exact layout: the arena is 85 × 52 m inside the walls (the
truck is 4.5 m, so ~19 truck lengths across, matching the footage's truck-to-arena ratio and lanes of 2.5–3 truck
lengths), the ridge runs the other way and further right, the ramp is further right and lower, the top-right lane
has whoops, the rough patch became mud, a second mud patch sits in the top-left corner and a puddle in the left lane.
The HUD sits in the notch above the top-right lane like the original's. Racing line ≈ 292 m.

### Tracks 2–8 (OR3)
Each keeps the topology and signature features of the 1989 original's track in the same season slot, with our own
layout, proportions, feature placement, names and colours. Season order (`TRACK_ORDER`): Rattlesnake Run, Coyote
Canyon, Bone Yard, Dry Creek Spiral, Twister Flats, Buzzard Bend, Thunder Ridge, Mesa Mayhem. Winning times are from
`race-check` (4 trucks, player on autopilot), forward / reversed.

| Track | Character (original) | Ours | Line | Winner |
|---|---|---|---|---|
| Coyote Canyon | long straights: a serpentine beside a broad banked lane | 4 long E–W passes and a banked left lane (pink, outer side raised), a narrow island under the HUD; two puddles on the top straight, a plank ramp mid-pass, a kicker over a pool, whoops on the start straight; orange/cream walls | 296 m | 69–71 / 68–70 s |
| Bone Yard | stacked passes that cross in a central pit with water | figure-8 through stacked passes: the N–S connector crosses a deep water pit (the E–W pass) on a bridge; staggered "bone pile" moguls on the top pass, a tabletop beside the pit, whoops and mud on the left lane; bone/black walls | 230 m | 64–65 / 62–63 s |
| Dry Creek Spiral | spiral in and out, a creek across two lanes, a banked hill, a dark pit | a square spiral (outer ring, inner ring, centre lane) that exits over the inner ring on a bridge; a creek channel with water crosses the top lane and the centre lane into a pond; a banked top-left corner, a dark pit corner, a washboard; blue/white walls | 262 m | 69–75 / 72–74 s |
| Twister Flats | open figure-8, an X in the open centre, three puddles | an upright "8" with arc hairpins and four small islands; the open crossing is a jump: the SW diagonal runs in a water channel between two pink berms that launch the NW diagonal over it; corner puddles, a banked top straight, moguls; purple/white walls | 293 m | 65–67 / 65–68 s |
| Buzzard Bend | figure-8 with an X crossing under a striped block | a sideways bow-tie: two triangular loops whose diagonals cross on a striped plank bridge (the other diagonal in a cutting below); a pink plateau, a plank jump, banked corners, moguls; green/white walls | 246 m | 57–61 / 62–63 s |
| Thunder Ridge | a huge diagonal ridge, every crossing a jump with bunting | four N–S columns and a return lane; one long pink ridge crosses every column (four jumps a lap, bunting over each), plank ramps, a moguls pen with the HUD; yellow/black walls | 208 m | 62–68 / 62–67 s |
| Mesa Mayhem | open arena around a zig-zag island, drums, ledges | a zig-zag island with teeth from the top and bottom walls (the line snakes), a 2 m mesa on the right loop to climb and fly off, two tabletops on the start straight, four solid giant drums, a walled bay for the HUD; red/lilac walls | 190 m | 55–58 / 55–59 s |

The two serpentines (Rattlesnake Run, Coyote Canyon) and the spiral are a little slower (winners up to ~72–75 s in
traffic) than the 53–71 s band; everything else lands inside it. CPU resets are rare (0–1 per race).

### Truck physics (OR1)
- Rapier `DynamicRayCastVehicleController` on a 1200 kg box chassis (1.9 × 0.84 × 4.5 m, centre of mass 0.45 m
  low, roll/pitch inertia boosted). Forward axis +z (`setIndexForwardAxis = 2`), up +y. Wheel rays only see the
  ground and walls (collision groups), never another truck's roof.
- Four raycast wheels (radius 0.5, rest 0.55, travel 0.45): stiffness 34, compression 3.2, relaxation 4.2. 4WD
  engine force 5200 N per wheel with a quadratic taper to the top speed (25 m/s, nitro 32), brakes 60, reverse when
  nearly stopped. `Truck.power` scales force and top speed (the grey boss runs 1.05). `Truck.mods` (`TruckMods`,
set with `setMods()`) carries the shop upgrades as multipliers on engine force, top speed, grip, suspension
stiffness and damping and the upright recovery ("Season and flow" has the table).
- Arcade assists after `updateVehicle()` and before `world.step()`, as direct velocity edits (mass-independent, easy
  to tune):
  - lateral grip boost: bleed sideways velocity at `lateralGrip` (4)/s × surface grip × wheels on the ground;
  - yaw assist: pull the yaw rate towards `steer × yawRate` (3 rad/s; zero with no input, which is the yaw damping);
  - upright stabilizer: rotate up towards the averaged contact normal (ground) or world up (air);
  - air control: steer spins, gas/brake pitch; tumbling is damped;
  - flip recovery: tipped past up.y 0.25 for 1.4 s → put back on its wheels in place.
- Surfaces: water (drag 1.3, grip 0.8) and mud (drag 0.75–0.85, grip 0.45–0.5) from the track's zones.

#### Feel against the reference (OR1 gate)
The footage gives lap times, not speeds: 4-lap finishes of 53–71 s, so a lap is 13–18 s, on tracks ~19 truck
lengths wide. Jumps are short hops ("one to two truck lengths"), trucks bounce over bumps and slide in turns, and
walls bounce them back. Measured with `scripts/lap-probe.mjs` (autopilot, alone, fixed steps) and
`scripts/feel-probe.mjs`:

| | Target (footage) | Measured |
|---|---|---|
| Lap, decent line (Rattlesnake Run) | 14–18 s | 16.0–17.2 s (autopilot alone); CPU trucks 16–19 s in traffic |
| 4-lap finish | 53–71 s | 66–70 s winner, 70–80 s last |
| Top speed / nitro | fast for the arena | 25 / 32 m/s (straights are short, so they're rarely reached) |
| Acceleration | strong from standstill | 0→14 m/s in 1 s, 0→20 m/s in 2 s |
| Turn rate | quick, rotational, slides | ~95°/s at 12 m/s full lock with ~1.5 m/s of slide; tight hairpins at ~11 m/s |
| Hang time | short hops | plank ramp ≤ 0.65 s, ridge humps 0.2–0.35 s (the proving ground's 1.7 m ramp ≈ 0.9 s) |
| Whoops | visible bounce, no tumbles | up to 0.18 s of air, min up.y 0.96, no resets |
| Wall bumps | bouncy | restitution 0.45, the truck bounces off and keeps going |

**Gate decision: keep the Rapier raycast vehicle.** With the arcade assists it hits the lap-time window and the
handling traits (slides, hops, bounces, shoves) without a custom 2.5D model; truck-to-truck bumping comes for free
from Rapier contacts. Revisit only if OR3's upgrades (tires, shocks) can't be expressed as TUNING changes.

### Race flow (`race/race.ts`)
- **Get Ready!** (1.8 s): trucks held on the grid, the flagman's flag down.
- **Countdown** (3 s): one red lamp a second on the start tree beside the flagman's tower, a `countdown` event per
  beep (3, 2, 1); the flag goes up.
- **Race**: green lamp, `countdown {n: 0}`, the flagman waves; the clock runs. Laps are counted by the ordered gates:
  a truck must cross gate 1, 2, … in order (forward side only) before crossing gate 0 counts a lap, so no shortcut
  can count. The first crossing of gate 0 (just after the grid) starts lap 1; lap 1's time includes the short run
  from the grid, like the race clock. 4 laps.
- **Finish**: places in crossing order; finished trucks drive a gentle cool-down. The race ends when all four are
  in, or 25 s after the player finishes (stragglers ranked by progress), or after 300 s.
- **Results**: the podium screen: the player's finish time and the track record, then a plate per truck with
  place, prize (100K / 90K / 80K / 70K) plus money bags, driver, time, average and best lap. In a standalone race
  Enter / pad A restarts with Get Ready!; in the season it goes on to the shop. The record (fastest finish by anyone) is kept in localStorage `or.records`
  (`{ "<trackId>": { time, who } }`, reversed variants as `<id>-r`).
- **Nitros**: 25 for the player, 10 per CPU truck; leftovers carry into the next race (page session; in the season
  the player's are saved with the season and the CPU trucks start each race with 10).
- **Pickups**: about one drop per lap (every ~13–18 s) on a random spot of the racing line ≥ 15 m from every truck,
  money or nitro; values escalate per kind as they're collected (10K → 20K → 30K, 1 → 2 nitros). Any truck can
  collect them; a floating text shows the value.

### CPU drivers (`race/ai.ts`, `race/roster.ts`)
- Steering at a point `lookahead + 0.42·v` metres ahead on the racing line, offset by a slow per-driver wander so the
  pack spreads over the lane; a per-driver reaction lag (`sloppiness`) makes humanly-random mistakes.
- Speed plan: the slowest of `sqrt(vc² + 2·8·d)` over the next 10 + 1.6·v metres, with the corner speed
  `vc = sqrt(cornerGrip / κ)` from the line's curvature, capped at `pace × topSpeed`.
- Nitro on straights (low curvature over the next 28 m) with a per-driver chance and a cool-down.
- Rubber band (mild): pace × (1 − 0.0015 × metres ahead of the player), clamped to 0.94..1.05.
- Unstuck: throttle with no speed for 0.9 s, or nose-in to a wall (a ray from the nose) → reverse for ~1 s with the
  steering flipped so the nose swings towards the line. No progress for 6 s, or > 14 m off the line → put back on
  the line (also when a truck is outside the outer wall).
- Skills: yellow BUCKSHOT Billy Kade (pace 0.90), blue ROWDY Rita Vance (0.93), grey STEEL Hank Dorsey (1.0, power
  1.05: the boss); red DUSTY Dot Marlow (0.915) races when the player picks another colour. The player's autopilot
  is 0.97.

### Events (`race/events.ts`)
A typed bus the audio lane subscribes to (`events.on(type, fn)`): `engine` (per truck per frame: rpm 0..1, throttle,
speed, nitro), `impact` (wall / truck / ground, strength 0..1, from Rapier contact-force events), `skid`, `splash`
(water / mud), `nitro`, `land`, `countdown` (3, 2, 1, 0 = GO), `lap`, `finish`, `pickup`, `phase`, and the flow's
`screen` (see "Season and flow").

### Effects
- `fx/particles.ts`: one instanced billboard mesh (InstancedBufferGeometry + a tiny shader, one draw call), up to
  1200 particles simulated per physics step: dust puffs behind the rear wheels on dirt (rate with speed and slides),
  white spray in water, dark mud flecks in mud, a white nitro puff, a dust ring on hard landings.
- `fx/skids.ts`: a ring buffer of 2400 ground segments drawn as instanced quads built in the vertex shader from
  their two ends; each wheel extends its trail while sliding (> 2.2 m/s sideways) or braking hard, fading over 22 s.

### HUD (`ui/race-hud.ts`)
The original's layout: ONE small grey panel placed over an empty spot of each track (the JSON's `hud.panel`,
projected from the world each resize), a dark tab with the race timer (0.1 s), and LAP / NITRO rows of four colour
cells (red, yellow, blue, grey). The track name sits beside it (`hud.name`) in red italic with a black outline.
No positions and no money during the race; money shows on the results screen. Centre banners (GET READY!, 3, 2, 1,
GO!, "1ST PLACE!") and floating pickup texts in the same pixel font (Press Start 2P, OFL, bundled via
@fontsource).

### Test handle `window.__or`
`ready`, `scene`, `simTime`, `truck()` / `trucks()` (pos, speed, heading, up, contacts, suspension, airborne,
airTime, nitros, inWater, surface, slip, resets), `raceState()` (phase, clock, per-truck lap / next gate / place /
lap times / nitros / bags / progress, results, record, pickups), `autopilot(on)`, `restart()`,
`resultsVisible()`, `setInput(partial | null)`, `reset()`, `place(x, z, heading)`, `advance(s)`, `debug(on)`,
`groundCheck()`, `heightAt(x, z)`, `line()`, `mods()` (each truck's upgrade multipliers), plus `tuning`, `camera`,
`loop`, `session`, `race`, `events`, `models`, `THREE` and `RAPIER` for live tuning. `session` / `race` follow the
current scene (null on a menu screen). `flow`: `state()` (screen, race index, next race, player cash / credits /
levels / nitros, last outcome, shop cursor), `press(key | {letter})`, `tick(s)` (menu clocks), `forceFinish(order)`,
`patchPlayer(patch)`, `season()`, `order()`, `raceFor(i)`, `text()`.

### Checks
- `scripts/load-check.mjs <url> test|race`: boots the scene, no errors, ground ↔ grid, trucks on four wheels.
- `scripts/drive-check.mjs`: throttle, right turn, nitro jump on the proving ground.
- `scripts/race-check.mjs <url> [track] [--reverse]`: a full 4-lap race with the player on autopilot via
  `advance()`; all four finish, laps counted, events fired, results show prize money and a saved record; Enter
  restarts. Screenshots `test-results/race-<track>-mid.png` and `-results.png`.
- `scripts/season-check.mjs <url>`: the season through `__or.flow`: title (demo race on autopilot) → hints →
  sign-up with the default initials → 3 autopilot races (track and direction against the rotation rule written out
  in the script, cash = prize + bags, credits by the rule, FREE RACE / CREDIT LOST on the podium) with the shop
  between them (buy tires and a nitro, check the next race's grip multiplier), a reload → CONTINUE SEASON with the
  same cash, then forced finishes: out of credits → CONTINUE? → continue (cash $0, 3 credits, upgrades kept),
  FREE RACE!, out of credits → countdown out → GAME OVER → title with the save gone. `test-results/season-*.png`.
- `npm test`: vitest unit tests of the rotation (the 8-track table, track 8 at race 35, fewer tracks), the shop,
  credits, continue, CPU shopping and `settleRace`.
- `scripts/load-check.mjs <url> title|shop`: the title (ground check on the demo race) and the shop (menus only).
- `scripts/lap-probe.mjs <url> [track] [tuning JSON]`: lap times and speeds alone, for tuning.
- `scripts/feel-probe.mjs`: acceleration, braking, turn rate, jump and whoops numbers on the proving ground.

## Season and flow (OR3, OR4 title)

### Screens (`game/flow.ts`, `ui/screens/`)
```
title (attract) → hints → sign-up → get ready → race → results ┬→ shop → get ready → race → …
      ↑                                                         └→ continue? ─┬→ shop
      └──────────────────────────────── game over ←───────────────────────────┘ (countdown ran out / Esc)
```
- **Title / attract**: our "OFF ROAD" logo (Press Start 2P with a stacked hard-shadow extrusion, tilted, in the
  late-80s DOS style), "STADIUM 4X4 TRUCK RACING", a menu (CONTINUE SEASON when `or.season` exists, NEW SEASON), a
  blinking PRESS START, our credits and "© 2026 Off Road contributors". Behind it a demo race: every truck on the
  AI, a random direction, the next track in the order each time; no HUD, banners or records, and silent apart from
  the title song. Left idle for 16 s the screen cycles to the racing hints for 10 s (an arcade attract loop).
- **Racing hints**: the rules in our own words (laps, FREE RACE, credits, prize money and bags, what each upgrade
  does, continues) and the controls.
- **Sign-up**: three colour panels (red, yellow, blue) like the original's join screen. Player 1 enters three
  initials arcade style (up/down cycles A–Z and space, left/right moves, typing A–Z also works; default "ACE", or
  the last season's), then picks a colour by moving the card between the panels. The other panels show the CPU
  driver who takes that colour. The original also asked for a birth date and a country; we skip both.
  Up to 3 players by design: `SeasonState.players` is an array (1..3, distinct colours, never grey), the line-up puts
  humans in the first slots, results and credits are per player. Only slot 0 takes input in a race for now (OR4 adds
  local 2-player).
- **Get ready**: the player's panel with GET READY!, the race number and a map of the track while the race builds
  (at least 1.6 s); the race then starts with its own GET READY! / lamps.
- **Results**: the podium as before, plus FREE RACE! (green) or CREDIT LOST / NO CREDITS LEFT (red), the cash and
  the credits; Enter / (A) → the shop, or CONTINUE? when the credits are gone.
- **Speed Shop**: the player's colour panel turns into the shop (CREDITS, CASH, six tiles: NITRO 10K, ACCEL. 80K,
  TIRES 40K, TOP SPD 100K, SHOCKS 60K with five-box level bars, nitro with a gauge and the count, and START NEXT RACE
  with a top-down map of the next track and its name, "(R)" when reversed). The other two panels show the CPU
  drivers' levels and cash; the grey boss's levels run along the bottom. Arrows move over the 2×3 grid, Enter buys
  or starts; Esc twice saves and quits to the title.
- **Continue?**: the player's panel with a 9 → 0 countdown (real seconds). Enter / (A) continues: credits back to 3,
  cash to $0, upgrades and nitros kept. Esc or the countdown running out → GAME OVER (6 s or a press) → the title;
  the save is deleted.

Menus read input once per frame (`engine/input.ts` `drainMenu()`: keyboard arrows/WASD, Enter/Space, Esc/Backspace,
letters; every pad's d-pad/stick, A/Start, B/Back, edge-triggered). Key presses made during a race are dropped on
every screen change (`clearPressed()`), so a held arrow or a stray Enter never acts on the next screen. In a season
race R does nothing (no restarts to farm prize money); the standalone `?scene=race` keeps R and Enter-to-restart.

Each race gets a fresh `RaceScene` (its own three.js scene and Rapier world); the old one is disposed (truck views
detached, track/effect geometry, materials and textures disposed, world freed). The renderer is shared. The shop,
hints, sign-up and continue screens are DOM only (no 3D running).

### Rules and economy (`game/economy.ts`)
| | Value | Note |
|---|---|---|
| Prize money | 100K / 90K / 80K / 70K by place, plus the money bags picked up | the original's table |
| Start | $0, 3 credits, 25 nitros (CPU trucks 10 each race) | the original's home versions differ (2 or 3 credits); we use 3 |
| Credit | −1 when any CPU truck finishes ahead of the player | a human ahead doesn't count |
| FREE RACE! | every CPU truck finished behind the player | no credit used |
| Out of credits | CONTINUE? 9 s: credits back to 3, cash to $0, upgrades kept | else game over |
| Prices | Nitro 10K, Acceleration 80K, Tires 40K, Shocks 60K, Top Speed 100K, the same at every level | |
| Levels | 5 per upgrade (stock = 0); nitro has no levels, at most 99 carried | |
| Nitro per buy | **1** | a pickup gives 1–2, so 10K for one burst keeps nitro a choice against upgrades |
| Nitros | the player's carry over from race to race (saved); CPU trucks start each race with 10 | |

**What the upgrades do** (`modsFor(levels)` → `TruckMods`, multipliers on TUNING applied per truck by
`Truck.setMods()`; `Truck.power` stays the boss's engine factor on top):

| Upgrade | Per level | At 5 | Applied to |
|---|---|---|---|
| Acceleration | engine force +7 % | 1.35 | engine force (the taper to top speed stays) |
| Top Speed | top speed +3.5 % | 1.175 (25 → 29.4 m/s, nitro 32 → 37.6) | `top` in the engine taper, `topSpeed()` (the AI's pace) |
| Tires | grip +9 % | 1.45 | lateral grip assist, wheel friction slip, yaw rate × (1 + 0.25·(grip − 1)); the AI trusts √grip more corner grip |
| Shocks | damping +12 %, stiffness +3 %, recovery +12 % | 1.6 / 1.15 / 1.6 | suspension compression + relaxation, stiffness, upright stabilizer and air tumble damping (landing recovery) |

**CPU trucks** bank their prize money too and go shopping after every race (`cpuShop`: the lowest upgrade first,
ties in the order tires, shocks, accel, top, while the cash lasts), and their pace (share of top speed) rises by
1 % every 3 races, at most +4 % (`cpuPaceBonus`). So the field gets faster through the season on top of the rubber
band; the boss keeps its 1.05 power.

### Track rotation (`game/rotation.ts`)
The original's home-version pattern: cycle 1 is tracks 1–2; every later cycle replays the earlier tracks and adds
the next one; a track flips direction each time it comes round (track t first appears in cycle
first(t) = t ≤ 2 ? 1 : t − 1, forwards, and is reversed in cycle c when c − first(t) is odd). Once all n tracks are
in, every cycle has them all and the alternation goes on forever (no ending, like the original).
```
cycle 1: 1  2            cycle 4: 1r 2r 3  4r 5
cycle 2: 1r 2r 3         …
cycle 3: 1  2  3r 4      cycle 8: 1r 2r 3  4r 5  6r 7  8r   (track 8 first at race 35)
```
`raceAt(n, race)` works for any n ≥ 1. The order is the track registry's `TRACK_ORDER` (tracks 1..8, added by the
tracks lane) when it exists; until then every registered track with a racing line (today: Rattlesnake Run alone,
which then alternates forward / reversed). A track without a `reverse` variant is driven forwards.

### Save (`localStorage`)
- `or.settings`: `{ dos: boolean, palette: 256 | 16 | 0 }`, the DOS look (engine/retro.ts); default off.
- `or.season`: `{ v: 1, race, players: [{ initials, colour, cash, credits, levels, nitros }], cpus: [{ colour,
  cash, levels, nitros }], last: { track, outcomes, places } }`, written after every race, purchase and continue;
  deleted on game over. CONTINUE SEASON on the title reopens it at the shop (or at CONTINUE? with no credits).
- `or.records`: the per-track records as before; the record holder is the player's initials now (the demo race
  and forced test finishes never set one).

### Audio
`GameEvents.screen { name }` (title, hints, register, getready, race, results, shop, continue, gameover) goes through
`audio/bridge.ts`: title / hints / sign-up → the `title` song (not restarted between them), shop → `shop`, continue
and game over → silence; race and podium music still follow the race phases (each race start picks the next race
song). While the attract screens are up the bridge drops the demo race's engines, skids, hits and phase music.

## Models (from the generator)
`ssg.models.json` lists what the game wants (format: the generator's docs/MODELS.md). `npm run assets`
(`scripts/build-assets.mjs`) runs `ssg model apply ssg.models.json --out public/models --json` into `public/models/`
(git-ignored), which downloads only changed exports, removes undeclared ones and writes the index `models.json`.
A cold build of all models takes ~8–11 s; a re-run with no changes downloads nothing. Restart the dev server
afterwards: `__HAS_MODELS__` (vite.config.ts) is decided at server start, so a missing folder never 404s.

| Name | Asset | Notes |
|---|---|---|
| `truck_red/blue/yellow/grey` | `POLYGON_Palm_City/SM_Veh_Pickup_01` + attach `SM_Veh_Pickup_Lift_01` | tint #c62828 / #1e5bc6 / #f2c618 / #8a8f94, `origin: axle-centre`, `fit: { length: 4.5 }`, 1024 px |
| `tire_pile`, `tire_stack` | Apocalypse `SM_Prop_Tire_Pile_01`, BattleRoyale `SM_Prop_TireStack_01` | kind `tyre_pile` (variant by position) |
| `barrel`, `barrel_coloured` | Apocalypse `SM_Prop_Barrel_01`, `SM_Prop_Barrel_Coloured_01` | kind `barrel` |
| `hay_bale` | War `SM_Prop_Hay_Bale_01` | kind `hay_bale` |
| `tire`, `cone`, `barrier` | Apocalypse `SM_Prop_Tire_01`, Palm City `SM_Prop_Cone_01`, `SM_Prop_Barrier_01` | kinds `tyre`, `cone`, `barrier`, ready for new tracks |
| `floodlight` | Apocalypse `SM_Prop_Floodlights_01` (a light-mast trailer) | stadium dressing along the back wall |
| `driver_red/yellow/blue/grey` | City Characters `SK_Character_Biker`, BattleRoyale `Character_RedneckMale_01`, Apocalypse `SK_Chr_Mechanic_Female_01`, City Characters `SK_Character_Roadworker` | podium drivers; clips idle, victory, three waves, slumped (see Presentation) |
| `fan_a/b/c` | City Characters `SK_Character_SummerGirl`, `SK_Character_Jock`, `SK_Character_HipsterGuy` | grandstand crowd; clips idle and two waves |
| `trophy` | Icons `SM_Icon_Trophy_01` | the winner's cup on the podium |

Props default to 256 px WebP textures (Synty atlases are flat colour swatches; 256 px looks the same at the race
camera), trucks 1024 px WebP. Tried and dropped: billboards (their sign art does not come through, OR-FB-005), a
stadium light mast (the light-pole pieces are modular parts, OR-FB-007), the Apocalypse tyre wall and a traffic
light for the start tree (see below).

**Trucks** (`race/truck-view.ts`). `loadTruckModels()` loads `truck_<colour>`. The specs ask the exporter for
`fit: { length: 4.5 }`, the physics chassis length, so the GLB arrives at the game's size: 4.5 m long, 2.53 m wide
over the tyres, a 2.85 m wheelbase (physics 2.9 m) and 0.55 m wheels. `TruckView` draws it in a holder scaled by
`TRUCK_LOOK = 1.12`, a style choice: the original draws its trucks chunky so they read at the far camera. The look is
a little wider than the 1.9 m collider, so trucks look a touch closer than they bump. The axle-centre origin is
placed so the scaled tyres touch the ground where the raycast wheels do at rest (a bigger model wheel lifts the body
rather than sinking). (Before OR-FB-002 was fixed the game measured the manifest's wheelbase and rescaled the GLB.)
Each frame the manifest's `wheels` nodes (fl, fr, rl, rr) spin about `axle` from the raycast wheel's rotation, the
`steer: true` ones turn about +y, and each moves by its suspension travel (converted to the node's parent scale, which includes the export's fit). The
pickup's bed liner is black, so from behind a truck's colour shows mainly on the cab, and the grey reads warm under
the low sun. Without models the box truck is drawn.

**Props** (`track/props-view.ts`). `dressTrack(track)` runs from the Session constructor (fire and forget). It maps
each track JSON `props` entry's `kind` to model names through `PROP_MODELS`, adds floodlight trailers along the back
wall, builds one `InstancedMesh` per GLB mesh per model with every placement, and then hides the build.ts
placeholders it replaced (kinds not in the table keep theirs). Props are drawn at `PROP_LOOK = 1.4` (floodlights
1.2 × that) to match the 1 m wall tyres and the chunky trucks.

**Tyre walls stay procedural.** The walls are a tyre per metre × 3 rows in one InstancedMesh (1 draw call) painted in the
original's red and white bands. The Synty tyre wall is a 4.3 m run of bare black tyres, 0.7 m tall: it would need
~100 instances per track, could not carry the bands and would not match the 1.3 m wall height. The lamp tree on the
flagman tower also stays procedural: the race lights its three lamps, and a GLB traffic light has no lamp parts.

**Cost** (Rattlesnake race, 4 trucks, SwiftShader at 1280×720; counted from the scene, main pass):

| | draw calls | triangles | fps (SwiftShader) |
|---|---|---|---|
| placeholders (box trucks) | 112 | 131k | 5.1 |
| generator models | 103 | 211k | 4.4 |

Each truck is 16.7k triangles in 14 meshes (doors, glass, wheels, lift kit); props are one mesh each, one draw call
per model however many are placed. SwiftShader is CPU-bound and runs ~5 fps either way (the checks use
`advance()`); on a real GPU the scene is well inside budget.

**Bundle** (before the OR4 characters: `dist/` is now 15 MB with 9.2 MB of models, the 7 characters + trophy
adding 3.5 MB): `dist/` was 11 MB: the JS bundle 5.2 MB (1.9 MB gzipped; mostly Rapier's WASM inlined) and
`dist/models/` 5.9 MB, of which the four trucks are 4 × 1.37 MB (0.66 MB gzipped each, the same geometry four
times, OR-FB-006) and the nine props 0.7 MB. With the default PNG textures the models were 19.6 MB (OR-FB-004).

## Presentation (OR4)

### Podium (`ui/podium-view.ts`)
With models, the results screen's flat pixel drivers become a 3D scene in a 922 × 300 canvas between the times box
and the plates. It has its own `WebGLRenderer` (one context, made on first use and kept; `alpha` so the screen's
checker shows round a disc of arena dirt) and its own `requestAnimationFrame` loop while the screen is up. Three
steps (gold, silver, bronze; the number drawn on a canvas texture with the face's aspect) stand in plate order
2nd, 1st, 3rd, with 4th on the ground to the right, 3.6 m apart, and the camera's fov is set from the canvas aspect
so the four columns land over the four plates. Each driver stands in front of their truck (the same TruckView,
parked at `TruckView.groundLift`, turned a little), both at `TRUCK_LOOK`.

| place | clip | |
|---|---|---|
| 1st | `MartialArts_Victory` once, then `POLY_IDL_Wave_Double_Loop` | holds the trophy (`trophy`, `SM_Icon_Trophy_01` × 1.7) in `hand_r`, kept upright |
| 2nd | `POLY_IDL_Wave_Large_Loop` | |
| 3rd | `POLY_IDL_Wave_Small_Loop` | (no clap clip, OR-FB-009) |
| 4th | `POLY_IDL_Posture_Slumped_Loop` | |

Drivers by truck colour (`driver_<colour>` in ssg.models.json): red `SK_Character_Biker` (City Characters),
yellow `Character_RedneckMale_01` (BattleRoyale), blue `SK_Chr_Mechanic_Female_01` (Apocalypse), grey
`SK_Character_Roadworker` (City Characters, hi-vis). Every driver carries all six clips (any of them can finish
anywhere), 0.5–0.7 MB each. `main.ts` preloads them after boot. The trophy follows the hand bone's world
position rather than being parented to it, so it never takes the bone's axes. `window.__or.podium()` gives
`stop()`, `tick(dt)` (step the clips by hand for frame captures) and `info` (draw calls, triangles).

### Crowd (`race/crowd.ts`)
build.ts names its grandstand group `grandstand` and its box crowd `crowd` (the hook); the Session's `Crowd`
hides the boxes once the fans have loaded and stands a fan on every other box spot (44 on the four benches).
Three fan models (`fan_a/b/c`: City Characters SummerGirl, Jock, HipsterGuy with `POLY_IDL_Base`,
`POLY_IDL_Wave_Double_Loop`, `POLY_IDL_Wave_Large_Loop`) at `FAN_LOOK = 1.05`:
- 6 fans along the front rows are skinned `Character`s with their own mixer (idle; when cheering a two-arm or a
  large wave, cross-faded).
- The other 38 are baked poses (`bakePose`, OR-FB-012): each fan model is posed with a mixer three times (idle,
  two frames of the two-arm wave) and its skinned vertices are transformed once on the CPU into a static mesh. One
  InstancedMesh per fan model per pose; while cheering, each fan flips between the two wave frames at its own
  phase (~4 Hz) and hops a little, and the matrices are re-packed so each mesh draws only the fans in its pose.
- Cheers: `finish` (any truck, 4 s) and `land` with `airTime ≥ 0.5 s` (2.5 s), from the event bus; a new cheer
  extends the current one. `window.__or.crowd()` gives `cheer(s)`, `cheering`, `drawCalls()`, `ready`.
- The baked geometry is cached for the page; RaceScene.dispose detaches the crowd before it frees the scene.

**Cost** (Rattlesnake race, 4 trucks, SwiftShader 1280×720, both passes: main + shadow map):

| | draw calls | triangles | fps (SwiftShader) |
|---|---|---|---|
| box crowd (88 boxes) | 204 | 366k | 4 |
| fans, idle (3 instanced + 6 skinned per pass) | 220 | 562k | 4 |
| fans, cheering (6 instanced + 6 skinned per pass) | 226 | 562k | 4 |

The fans add 16–22 draw calls and ~98k triangles per pass (Synty characters are ~1.8–2.6k triangles and
`simplify` does not reduce them, OR-FB-011). SwiftShader is CPU-bound at ~4–5 fps either way.

### DOS look (`engine/retro.ts`)
Off by default. F2 cycles off → 256 colours → 16 colours → off (a toast says which); the title menu has a
`DOS LOOK:` line doing the same. Saved in `or.settings`. When on, `RaceScene.render` draws through `retro.render`:
the scene goes into a 200-row HalfFloat render target (width from the window's aspect, ~356 at 16:9), then a
full-screen quad samples it with nearest filtering, converts to sRGB, quantises (256: 3-3-2 bits per channel with
4×4 Bayer dither; 16: the nearest EGA colour, luma-weighted, with a lighter dither), darkens the lower third of each
low-res row as a scanline and adds a slight vignette. The DOM HUD stays sharp, like the original's text. The podium
canvas follows the setting at a third of its resolution with `image-rendering: pixelated`.
