# Off Road: design

Internal notes. The game recreates the layouts and feel of the 1989 original top-down off-road racer as closely as
possible, in real 3D, with our own names, art and music. Public text says only "Off Road" (see CLAUDE.md).

## Architecture

```
src/
  main.ts            boot: renderer, Rapier world, scene from ?scene=, camera fit, loop, HUD, window.__or
  engine/
    renderer.ts      WebGLRenderer (sRGB, PCF soft shadows), scene, hemisphere + low sun
    camera.ts        the fixed whole-track camera (CAMERA: pitch, fov, margins) and fitFixedCamera()
    loop.ts          fixed 60 Hz physics step with an accumulator (max 6 steps/frame), render per rAF, advance()
    input.ts         keyboard + Gamepad API → TruckInput; confirm (Enter / pad A) for menus
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
  race/
    session.ts       the world + track + 1–4 trucks and views, effects, physics → game events
    race.ts          the race flow: Get Ready → lamps → race (gates, laps) → finish → results, records, pickups
    ai.ts            AiDriver: racing-line lookahead steering, speed plan, nitro, unstuck/reverse, rescue
    roster.ts        the four trucks (colours, our driver names, skills), start nitros, prize money
    pickups.ts       money bags and nitro bottles on the racing line, escalating values
    events.ts        the game event bus (audio subscribes here)
    models.ts        loads public/models/models.json (ssg model apply) when present
    truck-view.ts    the truck's look: the generator's GLB with manifest-driven wheels, or the box placeholder
  fx/
    particles.ts     pooled instanced billboards: dust, water splash, mud spray, nitro smoke
    skids.ts         skid-mark decals: a ring buffer of instanced ground segments that fade out
  ui/
    pixel.ts         the bundled pixel font (Press Start 2P) and a style helper
    race-hud.ts      the one-panel race HUD, the track name, centre banners, floating pickup texts
    results.ts       the podium / results screen
    debug.ts         F3 overlay
```

### Boot and scenes
`main.ts` reads `?scene=` (unknown scenes throw so the load check fails loudly):
- `test` (default): the player's truck alone on `?track=` (default `test`, the proving ground). R resets.
- `race`: a 4-truck race on `?track=` (default `rattlesnake`). `&reverse` drives the reversed variant, `&cpus=0..3`
  races fewer CPU trucks (tuning), `&autopilot` lets the AI drive the player's truck (tests, demos).

`?debug` opens the F3 overlay. When everything is built it runs a little physics so the trucks settle on their
springs, starts the loop and sets `window.__or.ready`.

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
  nearly stopped. `Truck.power` scales force and top speed (the grey boss runs 1.05; OR3's shop upgrades).
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
  place, prize (100K / 90K / 80K / 70K) plus money bags, driver, time, average and best lap. Enter / pad A
  restarts with Get Ready!. The record (fastest finish by anyone) is kept in localStorage `or.records`
  (`{ "<trackId>": { time, who } }`, reversed variants as `<id>-r`).
- **Nitros**: 25 for the player, 10 per CPU truck; leftovers carry into the next race (page session).
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
  1.05: the boss). The player's autopilot is 0.97.

### Events (`race/events.ts`)
A typed bus the audio lane subscribes to (`events.on(type, fn)`): `engine` (per truck per frame: rpm 0..1, throttle,
speed, nitro), `impact` (wall / truck / ground, strength 0..1, from Rapier contact-force events), `skid`, `splash`
(water / mud), `nitro`, `land`, `countdown` (3, 2, 1, 0 = GO), `lap`, `finish`, `pickup`, `phase`.

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
`groundCheck()`, `heightAt(x, z)`, `line()`, plus `tuning`, `camera`, `loop`, `session`, `race`, `events`, `models`,
`THREE` and `RAPIER` for live tuning.

### Checks
- `scripts/load-check.mjs <url> test|race`: boots the scene, no errors, ground ↔ grid, trucks on four wheels.
- `scripts/drive-check.mjs`: throttle, right turn, nitro jump on the proving ground.
- `scripts/race-check.mjs <url> [track] [--reverse]`: a full 4-lap race with the player on autopilot via
  `advance()`; all four finish, laps counted, events fired, results show prize money and a saved record; Enter
  restarts. Screenshots `test-results/race-<track>-mid.png` and `-results.png`.
- `scripts/lap-probe.mjs <url> [track] [tuning JSON]`: lap times and speeds alone, for tuning.
- `scripts/feel-probe.mjs`: acceleration, braking, turn rate, jump and whoops numbers on the proving ground.

## Models (from the generator)
`ssg.models.json` lists what the game wants (format: generator TODO "3D models + Off Road" contract): the lifted pickup
`POLYGON_Palm_City/SM_Veh_Pickup_Lift_01` in 4 tints with `origin: axle-centre`, and props (Apocalypse tyre wall,
tyre pile and barrels, War hay bale, Palm City traffic light for the start lamps, a barrier). `npm run assets` runs
`ssg model apply` into `public/models/` (git-ignored), which writes the index `models.json` (shape: the generator's
docs/MODELS.md). `race/models.ts` loads `truck_<colour>` from it when the file existed at dev-server/build start
(`__HAS_MODELS__` in vite.config.ts, so a missing folder never 404s; restart the dev server after `npm run assets`).
`TruckView` then draws the GLB for the truck's tint, scaled so its length matches the 4.5 m chassis (OR-FB-002), its
axle-centre origin placed on the wheel centres at rest, and turns the manifest's `wheels` nodes (fl, fr, rl, rr):
spin about `axle` from the raycast wheel's rotation, steer the `steer: true` ones about +y, and move each by its
suspension travel. Without models it draws the box truck. (Tested with a synthetic models.json + GLBs; the real
export is pending OR-FB-001.)
