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
    tracks/          one JSON per track + index.ts (registry, getTrack(id, reversed))
    heights.ts       track JSON → height grid (features: ramp, dip, mound, whoops, ridge; infield; base noise)
    line.ts          RacingLine: closed Catmull-Rom spline, arc-length samples, project / pointAt / curvature
    build.ts         grid → ground mesh, water, mud sheen, tyre walls + flags, start line, flagman tower + start
                     lamps, stadium dressing, props, colliders, surface queries
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
| `features[]` | `ramp` (x, z, heading, length, width, height, `planks` to draw boards), `dip`, `mound` (ellipses), `whoops` (bumps across a lane), `ridge` (a raised pink band along a polyline: a hump on every lane it crosses) |
| `walls[]` | polylines of tyres; `walls[0]` is the closed outer wall; open walls get a flag pole at each free end |
| `zones[]` | `water` (ellipse, surface `level`, `drag`) and `mud` (ellipse, `drag`, `grip` multiplier); mud is drawn darker and glossy |
| `start {heading, grid[]}` | grid slots: 0 = the player (pole), then yellow, blue, grey |
| `line[]` | the racing line's control points, forward direction (closed Catmull-Rom) |
| `gates[]` | ordered checkpoint segments wall to wall; gate 0 is the start/finish line (drawn chequered) |
| `hud {panel, name}` | world points of the HUD panel and the track name (an empty spot of the arena) |
| `flagman {x, z, heading}` | the flagman's tower and start lamps beside the line |
| `laps?` | default 4 |
| `reverse {start}` | the reversed variant's grid; the line, the gate order and ramp headings flip automatically (`getTrack(id, true)`, id `<id>-r`) |
| `props[]` | dressing: `tyre_pile`, `barrel`, `hay_bale` (drawn, not collided) |

Adding a track (OR3): write the JSON, register it in `tracks/index.ts`, run
`node scripts/race-check.mjs <url> <id>` (and `--reverse`), and check that lap times land in 14–18 s with
`node scripts/lap-probe.mjs <url> <id>`.

### Track 1: Rattlesnake Run
The first track of the original is a four-pass serpentine: the start/finish on the bottom-left, east along the
bottom lane, west, east, west along the top, then a wide diagonal lane down the left side back to the line, with a
raised ridge crossing every pass, a plank ramp on the bottom lane, moguls in the left pocket and a rough patch in the
bottom-right turn. Ours keeps that topology but not the exact layout: the arena is 85 × 52 m inside the walls (the
truck is 4.5 m, so ~19 truck lengths across, matching the footage's truck-to-arena ratio and lanes of 2.5–3 truck
lengths), the ridge runs the other way and further right, the ramp is further right and lower, the top-right lane
has whoops, the rough patch became mud, a second mud patch sits in the top-left corner and a puddle in the left lane.
The HUD sits in the notch above the top-right lane like the original's. Racing line ≈ 292 m.

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
`ssg.models.json` lists what the game wants (format: the generator's docs/MODELS.md). `npm run assets`
(`scripts/build-assets.mjs`) runs `ssg model apply ssg.models.json --out public/models --json` into `public/models/`
(git-ignored), which downloads only changed exports, removes undeclared ones and writes the index `models.json`.
A cold build of all models takes ~8–11 s; a re-run with no changes downloads nothing. Restart the dev server
afterwards: `__HAS_MODELS__` (vite.config.ts) is decided at server start, so a missing folder never 404s.

| Name | Asset | Notes |
|---|---|---|
| `truck_red/blue/yellow/grey` | `POLYGON_Palm_City/SM_Veh_Pickup_01` + attach `SM_Veh_Pickup_Lift_01` | tint #c62828 / #1e5bc6 / #f2c618 / #8a8f94, `origin: axle-centre`, 1024 px |
| `tire_pile`, `tire_stack` | Apocalypse `SM_Prop_Tire_Pile_01`, BattleRoyale `SM_Prop_TireStack_01` | kind `tyre_pile` (variant by position) |
| `barrel`, `barrel_coloured` | Apocalypse `SM_Prop_Barrel_01`, `SM_Prop_Barrel_Coloured_01` | kind `barrel` |
| `hay_bale` | War `SM_Prop_Hay_Bale_01` | kind `hay_bale` |
| `tire`, `cone`, `barrier` | Apocalypse `SM_Prop_Tire_01`, Palm City `SM_Prop_Cone_01`, `SM_Prop_Barrier_01` | kinds `tyre`, `cone`, `barrier`, ready for new tracks |
| `floodlight` | Apocalypse `SM_Prop_Floodlights_01` (a light-mast trailer) | stadium dressing along the back wall |

Props default to 256 px WebP textures (Synty atlases are flat colour swatches; 256 px looks the same at the race
camera), trucks 1024 px WebP. Tried and dropped: billboards (their sign art does not come through, OR-FB-005), a
stadium light mast (the light-pole pieces are modular parts, OR-FB-007), the Apocalypse tyre wall and a traffic
light for the start tree (see below).

**Trucks** (`race/truck-view.ts`). `loadTruckModels()` loads `truck_<colour>`; `TruckView` draws the GLB inside a
holder scaled so the model's wheelbase (`wheels.fl.pos` → `wheels.rl.pos`, 4.33 m) matches the physics wheelbase
(2.9 m) times `TRUCK_LOOK = 1.12` (OR-FB-002: no target size in the export). The truck is then ~5.1 m long,
2.9 m wide over the tyres, with 0.63 m wheels, against the 4.5 × 1.9 m chassis and 0.5 m raycast wheels. That is
deliberately chunky, like the original's trucks, so they read at the far camera; the look is a little wider than
the collider, so trucks look a touch closer than they bump. The axle-centre origin is placed so the scaled tyres
touch the ground where the raycast wheels do at rest (a bigger model wheel lifts the body rather than sinking).
Each frame the manifest's `wheels` nodes (fl, fr, rl, rr) spin about `axle` from the raycast wheel's rotation, the
`steer: true` ones turn about +y, and each moves by its suspension travel (divided by the holder's scale). The
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

**Bundle**: `dist/` is 11 MB: the JS bundle 5.2 MB (1.9 MB gzipped; mostly Rapier's WASM inlined) and
`dist/models/` 5.9 MB, of which the four trucks are 4 × 1.37 MB (0.66 MB gzipped each, the same geometry four
times, OR-FB-006) and the nine props 0.7 MB. With the default PNG textures the models were 19.6 MB (OR-FB-004).
