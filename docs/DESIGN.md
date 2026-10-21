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
    season.ts        season state (1–3 players with their keys, CPU trucks, cash, credits, levels, nitros), line-up,
                     rotation lookup, settleRace(), dropToCpu(), the or.season save (v2; migrateSeason() from v1)
    economy.ts       prices, levels, upgrade → TruckMods, buy(), CPU shopping, credits / FREE RACE / continue
    rotation.ts      raceAt(n, race): the cycle rotation (pure)
    *.test.ts        vitest unit tests (npm test)
  engine/
    renderer.ts      WebGLRenderer (sRGB, PCF soft shadows), scene, hemisphere + low sun
    camera.ts        the fixed whole-track camera (CAMERA: pitch, fov, margins) and fitFixedCamera() (into a free rect)
    loop.ts          fixed 60 Hz physics step with an accumulator (max 6 steps/frame), render per rAF, advance()
    input.ts         keyboard + Gamepad API → TruckInput: readInput() (one player), readPlayers(controls) (the keyboard
                     split + pads per player, KEY_SCHEMES), menu presses with their source (drainMenu); the touch
                     input (player 1), menu taps (pushMenu, src 'touch') and the input mode (touch / keys / pad)
    quality.ts       render quality auto / low / high: pixel ratio, antialiasing, shadow map, particles, skinned fans
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
    props-view.ts    swaps the placeholder props for instanced prop GLBs (PROP_MODELS table); instanceModel()
    stadium-view.ts  the stadium from the models: grandstands, VIP box, bleachers, start arch + start light, flagman
                     character, flags, billboards, desert dressing, tumbleweeds; finds the stands' seats
  race/
    session.ts       the world + track + 1–4 trucks and views, effects, physics → game events
    race.ts          the race flow: Get Ready → lamps → race (gates, laps) → finish → results, records, pickups
    ai.ts            AiDriver: racing-line lookahead steering, speed plan, nitro, unstuck/reverse, rescue
    roster.ts        the four trucks (colours, our driver names, skills), start nitros, prize money
    pickups.ts       money bags and nitro bottles on the racing line, escalating values
    events.ts        the game event bus (audio subscribes here)
    models.ts        public/models/models.json (ssg model apply) when present: modelIndex(), loadModel(name) (with the
                     MeshoptDecoder), withVariant() (KHR_materials_variants), loadTruckModels()
    truck-view.ts    the truck's look: the generator's GLB with manifest-driven wheels, or the box placeholder
    characters.ts    the generator's Synty characters: Character (clone + mixer, play by clip), loadPoses()
    crowd.ts         the fans on the stadium's seats: a few skinned, the rest baked poses instanced; seated, they
                     jump up or cheer seated on finishes and big jumps
  fx/
    particles.ts     pooled instanced billboards: dust, water splash, mud spray, nitro smoke
    skids.ts         skid-mark decals: a ring buffer of instanced ground segments that fade out
  ui/
    pixel.ts         the bundled pixel font (Press Start 2P) and a style helper
    race-hud.ts      the one-panel race HUD, the track name, centre banners, floating pickup texts
    results.ts       the podium / results screen (season: FREE RACE! / CREDIT LOST, credits, the shop prompt)
    podium-view.ts   the results screen's 3D podium: its own small canvas, the podium model, drivers, trucks, trophy,
                     confetti
    toast.ts         a short message at the top (F2's DOS look setting)
    touch/           phones and tablets: mobile.ts (body classes, taps → menu presses, no zoom / scroll, the rotate
                     card, fullscreen, haptics), controls.ts (the on-screen race controls), pause.ts (II + PAUSED)
    debug.ts         F3 overlay
    screens/         full-screen menus: common (DOS look, panels, icons), title, hints, register (+ get ready),
                     shop, continue (+ game over), track-thumb (a 2D map of a track from its JSON)
```

### Boot and scenes
`main.ts` reads `?scene=` (unknown scenes throw so the load check fails loudly) and hands over to `game/flow.ts`:
- `title` (default when there's no `?scene`): the title / attract screen and the season (see "Season and flow").
- `shop`: the Speed Shop straight away, on the saved season or a fresh one (`&cash=` default 250000, `&race=`
  default 1, `&colour=`, `&players=1..3`); for checks.
- `register`: the driver sign-up; `&join=wasd,arrows,pad0` has those players joined already (the first one READY),
  for screenshots (`load-check.mjs … register join=wasd,arrows`).
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
moves during a race. With the touch controls up, `RaceScene.resize(reserve)` fits it twice, once keeping the side
columns clear (steer pad left, pedals right) and once a bottom strip, and keeps the bigger track (sides on a ~2:1
phone, the bottom strip on a tablet). The original's view is about 60–65° down with mild perspective (research notes), so 58° with
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
| `props[]` | dressing: `tyre_pile`, `barrel`, `hay_bale`, `cone` (drawn, not collided), `bunting` (pennants on two poles, `len` m across `rot`, standing on the highest ground under it: marks a jump), `drum` (a 3 m banded drum, solid); trackside (outside the walls): `tyre_barrier` (a sponsor tyre barrier), `flags`, `pit_wall`, `pit_box`, `cactus`, `rock` |
| `stadium?` | the stadium around the arena (with models): `vip` (x of the VIP box in the grandstand row, null for none, default 0), `sides` (bleachers outside the side walls, default true), `desert` (share of the desert spots filled, 0.6), `flora` (`cactus` saguaros, `scrub` low cacti/succulents/dead trees, `mixed`), `tumbleweeds` (3), `sand` (the ground colour outside) |
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
  in, or 25 s after the last human finishes (stragglers ranked by progress), or after 300 s.
- **Humans**: `Race.humans` are the slots with `entry.human` (season: the players, always the first slots) or slot 0
  in a standalone race; `Race.step(dt, inputs)` takes one input per human. `autopilot` puts every human on the AI.
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
- Rubber band (mild): pace × (1 − 0.0015 × metres ahead of the leading human), clamped to 0.94..1.05.
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
- Nitro flame (`race/truck-view.ts`): while a nitro burns, two flames out of the back of the truck: the Pro Racer
  flame mesh (`flame`) pointed backwards, drawn with an additive orange material and a white-hot core of our own
  (the export has no FX shader, OR-FB-019), its length and width jittering every frame (about 1.6 m), fading in and
  out over a tenth of a second.
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
lap times / nitros / bags / progress / human, results, record, pickups), `autopilot(on)`, `restart()`,
`resultsVisible()`, `setInput(partial | null, player = 0)`, `controls()` (each human's keys, joined pad, lent pad), `reset()`, `place(x, z, heading)`, `advance(s)`, `debug(on)`,
`groundCheck()`, `heightAt(x, z)`, `line()`, `mods()` (each truck's upgrade multipliers), `quality(o?)` (setting,
level, reason, profile; `{ watchFps: true }` turns on the fps watch that headless runs skip), `touch()` (controls
visible, the input they send, what they reserve, the camera fit, paused), plus `tuning`, `camera`,
`loop`, `session`, `race`, `events`, `models`, `THREE` and `RAPIER` for live tuning. `session` / `race` follow the
current scene (null on a menu screen). `flow`: `state()` (screen, race index, next race, player 1 and `players[]` cash / credits /
levels / nitros / keys, `cpus[]`, last outcome, shop cursor and turn, the sign-up cards, the continue countdowns),
`press(key | {key, letter, src, player})`, `tick(s)` (menu clocks), `forceFinish(order)`, `patchPlayer(patch, player)`,
`season()`, `order()`, `raceFor(i)`, `text()`.

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
- `scripts/twoplayer-check.mjs <url>`: local multiplayer. A v1 save migrates (CONTINUE SEASON → shop, v2); real key
  presses at the sign-up (W joins player 1 on the WASD side, Up joins player 2 on the arrows side and types BOB, both
  READY, Enter starts); in the race W / D drive only player 1's truck, Up / Left only player 2's, `setInput(…, 1)` only
  player 2's; engine events flag both humans; autopilot to the results (each human banks their own prize + bags,
  credits by the CPU rule); the shop in turn with real keys (the other player's keys do nothing), separate cash and
  upgrades and per-human truck mods next race; forced finishes: one human loses a credit, a human ahead costs none;
  player 2 out → CONTINUE? for them alone → gives up → blue races as a CPU truck with their upgrades, player 1 gets the
  whole keyboard; player 1 out → countdown → GAME OVER. `test-results/twoplayer-*.png`.
- `scripts/mobile-check.mjs <url> [--device=iphone|pixel|ipad]`: phones and a tablet (Playwright device emulation:
  844×390 iPhone 13 landscape, Pixel 7 landscape, 1180×820 iPad; hasTouch + isMobile) driven by touch alone: touch
  mode on boot, meta tags, manifest + icons, auto quality (low on the phones, high on the iPad, then low after 3 s
  under 40 fps), the title chips (DOS look on and off), NEW SEASON, the hints' NEXT, the sign-up (tap a panel to
  join, the letter picker to BOB, the colour arrow, READY, START), the race (controls visible and ≥ 64 px, on
  screen, off the HUD panel, the track's walls clear of them; real multi-touch through CDP: gas alone drives, gas +
  a slide on the pad turns right, a third finger fires a nitro and buzzes, all up = idle, BRAKE), II / RESUME, a key
  hides the controls and a touch brings them back, autopilot to the results, a tap → the shop, tap-buy NITRO and
  TIRES, START NEXT RACE → race 2, portrait → the rotate card and a pause. `test-results/mobile-<device>-*.png`.
- `npm test`: vitest unit tests of the rotation (the 8-track table, track 8 at race 35, fewer tracks), the shop,
  credits, continue, CPU shopping and `settleRace`; `multiplayer.test.ts`: 2–3 humans (line-up, keyboard split,
  separate banking, credits per human, upgrades per human), `dropToCpu`, the v1 → v2 save migration, pad lending.
- `scripts/load-check.mjs <url> title|shop`: the title (ground check on the demo race) and the shop (menus only).
- `scripts/lap-probe.mjs <url> [track] [tuning JSON]`: lap times and speeds alone, for tuning.
- `scripts/feel-probe.mjs`: acceleration, braking, turn rate, jump and whoops numbers on the proving ground.
- `scripts/view.mjs <url> <query> <name> <view…>`: close-ups (`px,py,pz>tx,ty,tz`), `race` (the game camera),
  `cheer`, `js:<code>` steps and `perf` (8 s real time: fps, draw calls, triangles; `BREAKDOWN=1` lists triangles
  by mesh) → `test-results/view-<name>-<k>.png`.

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
- **Sign-up**: three colour panels (red, yellow, blue) like the original's join screen, for up to three humans
  (local multiplayer, below). A panel nobody joined says PRESS START TO JOIN over the CPU driver who takes that
  colour otherwise. A player joins with their start key (W / Left Shift / Space: the WASD side; Up / Enter / Right
  Ctrl: the arrows side; (A) on a pad) and gets the first free panel (or last season's colour), enters three initials
  arcade style (up/down cycles A–Z and space, left/right moves; typing A–Z also works on the keyboard; defaults
  ACE / JET / MAX, or last season's), moves the card to a free colour and confirms READY. Once every joined player
  is READY (at least one), a ready player's start key starts the season. Esc steps the last joined player back (or
  leaves the sign-up when nobody joined). The original also asked for a birth date and a country; we skip both.
  `SeasonState.players` is an array (1..3, distinct colours, never grey), the line-up puts humans in the first slots.
- **Get ready**: the player's panel with GET READY!, the race number and a map of the track while the race builds
  (at least 1.6 s); the race then starts with its own GET READY! / lamps.
- **Results**: the podium as before, plus FREE RACE! (green) or CREDIT LOST / NO CREDITS LEFT (red), the cash and
  the credits (with 2+ humans one compact box per human and every human's finish time); Enter / (A) → the shop, or
  CONTINUE? when any human's credits are gone.
- **Speed Shop**: the player's colour panel turns into the shop (CREDITS, CASH, six tiles: NITRO 10K, ACCEL. 80K,
  TIRES 40K, TOP SPD 100K, SHOCKS 60K with five-box level bars, nitro with a gauge and the count, and START NEXT RACE
  with a top-down map of the next track and its name, "(R)" when reversed). The other two panels show the CPU
  drivers' levels and cash; the grey boss's levels run along the bottom. Arrows move over the 2×3 grid, Enter buys
  or starts; Esc twice saves and quits to the title. With 2–3 humans they shop in turn (player 1 first): the
  shopping player's panel is the shop ("PLAYER n XYZ SHOPPING"), the other humans' panels show their truck, levels,
  cash, credits and nitros with NEXT / DONE, and START NEXT RACE hands the shop to the next human (the last one
  starts the race). Only the shopping player's keys / pad act.
- **Continue?**: every human out of credits gets their panel with their own 9 → 0 countdown (real seconds, running
  side by side); the other humans' panels say WAITING. Their start key / (A) continues: credits back to 3, cash to $0,
  upgrades and nitros kept. Esc / (B) or the countdown running out gives up: with other humans left, that colour
  becomes a CPU truck (our CPU driver for the colour, keeping the truck's upgrades and cash; `dropToCpu`) and a lone
  human left gets the whole keyboard back; when nobody is left → GAME OVER (6 s or a press) → the title; the save is
  deleted.

Menus read input once per frame (`engine/input.ts` `drainMenu()`: keyboard arrows/WASD, Enter/Space/Shift/Right Ctrl,
Esc/Backspace, letters; every pad's d-pad/stick, A/Start, B/Back, edge-triggered). Every press carries its source
(`wasd`, `arrows`, `kb` for Esc/Backspace/other letters, `padN`); the flow turns that into the human it belongs to
(`Flow.ownerOf`: their keyboard side or their pad; anyone with one human, for Esc and for tests) and the shop and
continue screens only act on the right player's presses. Key presses made during a race are dropped on
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
| Credit | −1 when any CPU truck finishes ahead of that human | per human; a human ahead doesn't count |
| FREE RACE! | every CPU truck finished behind the player | no credit used |
| Out of credits | CONTINUE? 9 s per human: credits back to 3, cash to $0, upgrades kept | else that colour drops to CPU; game over when no human is left |
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
- `or.settings`: `{ dos: boolean, palette: 256 | 16 | 0, quality: 'auto' | 'low' | 'high', haptics: boolean }`, the
  DOS look (engine/retro.ts; default off), the render quality (engine/quality.ts; default auto) and vibration
  (default on).
- `or.season`: `{ v: 2, race, players: [{ initials, colour, keys, cash, credits, levels, nitros }], cpus: [{ colour,
  cash, levels, nitros }], last: { track, outcomes (per player), places (per slot) } }`, written after every race,
  purchase, continue and drop-out; deleted on game over. `keys` is the player's keyboard side ('solo' alone, 'wasd',
  'arrows', null = pad only); pads aren't saved (lent in join order after a reload). A v1 save (OR3: one player, no
  `keys`) is migrated on load (`migrateSeason`: keys 'solo'). CONTINUE SEASON on the title reopens it at the shop (or
  at CONTINUE? when someone has no credits).
- `or.records`: the per-track records as before; the record holder is the player's initials now (the demo race
  and forced test finishes never set one).

### Audio
Every human truck is a player for the sound: the `engine` event's `player` flag (`Session.isHuman`) and the bridge's
`isPlayer(truck)` mark each human's engine, skids, nitro, laps and finish at player level (`AudioEvents.*.player`;
without it `AudioSystem.playerTruck` decides, as before).
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
| `truck` | `POLYGON_Palm_City/SM_Veh_Pickup_01` + attach `SM_Veh_Pickup_Lift_01` | `variants` red #c62828 / blue #1e5bc6 / yellow #f2c618 / grey #8a8f94 in one GLB, `origin: axle-centre`, `fit: { length: 4.5 }`, 1024 px, meshopt (590 KB) |
| `tire_pile`, `tyre_stack_a/b` | Apocalypse `SM_Prop_Tire_Pile_01`, Pro Racer `SM_Prop_Tyre_Stack_02/04` | kind `tyre_pile` (variant by position) |
| `barrel`, `barrel_coloured`, `hay_bale`, `tire`, `cone`, `barrier` | Apocalypse, War, Palm City props | kinds `barrel`, `hay_bale`, `tyre`, `cone`, `barrier` |
| `tyre_barrier`, `flags_sponsor`, `pit_wall`, `pit_box` | Pro Racer `SM_Prop_Barrier_Tyres_01` (CHUG), `SM_Prop_Flag_04`, `SM_Prop_Pit_Wall_01`, `SM_Prop_Pit_Box_02` | trackside kinds `tyre_barrier`, `flags`, `pit_wall`, `pit_box`; sponsor flags also beside every flagman |
| `grandstand` | Pro Racer `SM_Bld_Grandstand_01` + attach `SM_Bld_Grandstand_Seating_01` | the row behind the back wall (12.5 m sections at 1.1×), 512 px, meshopt; 160 seats each |
| `vip_box`, `bleachers` | Pro Racer `SM_Bld_Grandstand_VIP_01`, `SM_Prop_Bleachers_01` | the VIP section in the row (32 seats); bleachers outside the side walls (64 seats) |
| `start_arch`, `start_light`, `flag_chequered` | Pro Racer `SM_Prop_Gantry_06` (the inflatable CHUG arch), `SM_Prop_Trafficlight_01`, `SM_Prop_Flag_01` | the arch over gate 0 (stretched to the gate), the light on its beam (lamp discs lit by the race), chequered flags at its feet and in the flagman's hand |
| `billboard_skidmark` | Pro Racer `SM_Prop_Billboard_Large_02` | sponsor billboards in the back corners, 1024 px (the A1 SKIDMARK art reads) |
| `cactus_tall/low`, `succulent_a/b`, `dead_tree`, `rock_a/b`, `rock_tall`, `cliff_a/b`, `tumbleweed` | Arid Desert `SM_Env_Cactus_03/01`, `SM_Env_Succulent_04/06`, `SM_Env_Tree_Dead_02`, `SM_Env_Rock_03`, `SM_Env_Rocks_Spikey_01`, `SM_Env_Rock_07`, `SM_Env_Rock_Cliff_03/16`, `SM_Prop_Tumbleweed_01` | desert outside the walls (kinds `cactus`, `rock` too), meshopt; the cards need `alphaTest` (OR-FB-018) |
| `driver_red/yellow/blue/grey` | City Characters `SK_Character_Biker`, BattleRoyale `Character_RedneckMale_01`, Apocalypse `SK_Chr_Mechanic_Female_01`, City Characters `SK_Character_Roadworker` | podium drivers; clips `POLY_IDL_Base`, Emotes `Celebrate_BeatChest`, `Celebrate_Clapping_Polite`, `Happy_FistPump` (qualified `@Masculine` / `@Feminine`), Mixamo `Driver_Trophy`, `Driver_Defeated`; meshopt |
| `flagman` | City Characters `SK_Character_Roadworker` | the flagman on his tower: `POLY_IDL_Base`, Emotes `Happy_ArmsRaised`, Mixamo `Flagman_Wave`; `simplify: 0.6` |
| `fan_a/b/c` | City Characters `SK_Character_SummerGirl`, `SK_Character_Jock`, `SK_Character_HipsterGuy` | the 6 skinned fans: Mixamo `Crowd_Sit_Idle`, `Crowd_Sit_Cheer`, Emotes `Happy_ArmsRaised`; `simplify: 0.5`, meshopt |
| `crowd_a…f` | City Characters SummerGirl, Jock, HipsterGuy, Tourist, PunkGirl, Grandpa | `poses`: `sit` (Crowd_Sit_Idle 1.0 s), `sit_cheer_a/b` (Crowd_Sit_Cheer 0.63 / 0.94 s), `arms_a/b` (Happy_ArmsRaised 0.6 / 1.3 s), `fist_a/b` (Happy_FistPump 0.5 / 1.1 s); `simplify: 0.3` (the exporter keeps ~38%), meshopt |
| `podium`, `trophy` | Pro Racer `SM_Prop_Podium_01`, `SM_Prop_Trophy_01` | the three podium discs at 2× and the winner's cup |
| `flame` | Pro Racer `SM_Flame_Mesh_01` | the nitro flame's shape (the game draws it additive, OR-FB-019) |

Props default to 256 px WebP textures (Synty atlases are flat colour swatches; 256 px looks the same at the race
camera), the truck and the billboards 1024 px WebP (the exporter crops each atlas to the region its UVs use).
Characters, the truck, the crowd poses and the stadium and desert models are `compress: "meshopt"`, so `loadModel`
always sets three.js's `MeshoptDecoder` on its GLTFLoader. Every clip name is qualified by gender, so `manifest.warnings` is empty for every
model (two harmless ones: `crowd_b` keeps 38% of its triangles, not 30%; the pit box's two castors "could not be
mapped" as wheels, OR-FB-023). Tried and dropped: a stadium light mast (the light-pole pieces are modular parts,
OR-FB-007), the Apocalypse tyre wall, the City billboards and the floodlight trailers (the grandstands took the back
wall), Pro Racer's characters (OR-FB-016/017) and crowd cards (OR-FB-019), and Arid Desert's background hills (beyond
the stands, off the top of the screen).

**Vehicles: the lifted pickup stays.** Pro Racer's `SM_Veh_Truck_01` is a race semi-tractor (2.77 × 2.87 × 6.09 m,
a cab over a bare chassis) and `SM_Veh_Rally_01` a hatchback (0.39 m wheels); `SM_Veh_Dirtbike_01` has two wheels.
The previews (`ssg model preview … --frames 4`) settle it: neither has the original's chunky big-wheeled stadium
pickup look that the Palm City pickup on its lift kit gives, so the truck did not change and no race screenshot was
needed to decide.

**Trucks** (`race/truck-view.ts`). The four colours are one GLB, `truck`, with four paint variants
(KHR_materials_variants: the geometry once, a tinted texture and material per variant). `loadTruckModels()` loads it
once and makes each colour with `withVariant(model, colour)`: the docs/MODELS.md recipe (the glTF parser's
`associations` give each mesh's primitive, whose variant mapping names the material to load), applied to a clone of
the scene, so geometry is shared and each variant's material is shared by its clones. The spec asks the exporter for
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
wall with an advert billboard between each pair (pizza, burgers, holiday, donuts in turn, standing just in front of
the wall's face), builds one `InstancedMesh` per GLB mesh per model with every placement, and then hides the build.ts
placeholders it replaced (kinds not in the table keep theirs). Props are drawn at `PROP_LOOK = 1.4` (floodlights
1.2 × that) to match the 1 m wall tyres and the chunky trucks.

**Tyre walls stay procedural.** The walls are a tyre per metre × 3 rows in one InstancedMesh (1 draw call) painted in the
original's red and white bands. The Synty tyre wall is a 4.3 m run of bare black tyres, 0.7 m tall: it would need
~100 instances per track, could not carry the bands and would not match the 1.3 m wall height (Pro Racer's tyre
barriers are 3.5 m sponsor blocks: trackside dressing, not a wall). The start light is the Pro Racer traffic light
on the arch, but its lamps are atlas swatches in one mesh (OR-FB-022), so three procedural lamp discs sit on its lamp
faces and `track.lights.set(n)` lights them (red top to bottom for 3, 2, 1, all green for GO); the procedural lamp
tree stays only for the no-models fallback.

**Stadium** (`track/stadium-view.ts`, `dressStadium(track)` from the Session, async). With models:
- a desert ground plane all round (the track JSON's `stadium.sand`);
- the grandstand row behind the back wall, spanning the arena plus 10 m each side, with the VIP section at
  `stadium.vip`; the back wall is lowered to 1.4 m so the front rows show over it, and the race camera's frame box
  takes in a point 3.5 m up, 7 m behind the walls (`STAND_TOP`), so the top strip of the screen is crowd like the
  original's; build.ts's procedural stand is removed;
- bleachers outside the side walls in the back half (`stadium.sides`);
- the inflatable sponsor arch over gate 0, stretched to the gate's length, the start light on its beam facing the
  camera, chequered flags at its feet, sponsor flags beside the flagman's tower;
- the flagman is the roadworker character on the tower (`flagman`): idle, arms raised in the countdown, `Flagman_Wave`
  at GO, the chequered flag following his right hand (upright, swinging with the wave); build.ts's box man is hidden;
- sponsor billboards (A1 SKIDMARK) in the back corners with cliffs behind them;
- the desert outside the walls on a jittered grid: low cacti and rocks only in the near strip (nothing hides the near
  lane), cacti, succulents, dead trees and rocks on the side strips, by `stadium.flora` and `stadium.desert`, kept
  clear of the flagman, the arch, the bleachers and the track's props; cacti/succulents/tumbleweed get `alphaTest`
  (OR-FB-018); small dressing casts no shadow;
- tumbleweeds (`stadium.tumbleweeds`) rolling east along the near strip with gusts, bouncing, wrapping round
  (instanced, updated per frame by `Session.render`);
- seats: `findSeats(model)` casts rays down through a stand model (in its own frame, cached) and finds the flats
  of its profile; a flat 0.3–0.6 m above the one in front is a seat row with the feet on the lower flat, and a seat
  every 0.62 m where a ray finds that seat height (OR-FB-024). 160 per grandstand section, 32 on the VIP box, 64 per
  bleacher; the crowd gets the ones the race camera frames.

Per track (`stadium` in the JSON): Rattlesnake mixed flora; Coyote Canyon saguaros, the VIP left of centre; Bone
Yard scrub, a pale bone-coloured desert, four tumbleweeds; Dry Creek scrub, a darker desert, the VIP right; Twister
Flats six tumbleweeds; Buzzard Bend and Thunder Ridge saguaros (the VIP left / right); Mesa Mayhem dense scrub on a
red desert. Each also has trackside props in the front half of its side strips (a CHUG tyre barrier, a pit wall and
pit box, sponsor flags), skipped where the flagman stands. Every HUD spot is untouched (the dressing is outside the
walls).

**Cost** (Rattlesnake race, 4 trucks, SwiftShader at 1280×720; counted from the scene, main pass):

| | draw calls | triangles | fps (SwiftShader) |
|---|---|---|---|
| placeholders (box trucks) | 112 | 131k | 5.1 |
| generator models | 103 | 211k | 4.4 |

Each truck is 16.7k triangles in 14 meshes (doors, glass, wheels, lift kit); props are one mesh each, one draw call
per model however many are placed. SwiftShader is CPU-bound and runs ~5 fps either way (the checks use
`advance()`); on a real GPU the scene is well inside budget.

**Bundle** (OR5): `dist/` is 13 MB: the JS bundle 5.4 MB (1.9 MB gzipped; mostly Rapier's WASM inlined) and
`dist/models/` 7.65 MB (7.3 MiB) for 49 models: the six crowd pose sets 2.62 MB (~0.44 MB each, seven poses), the
four drivers 1.76 MB, the desert 0.77 MB, the skinned fans 0.64 MB, the truck 0.59 MB, the trackside and arena props
0.5 MB, the stands 0.25 MB, the flagman 0.19 MB, the billboards 0.16 MB, the start arch/light/flags 0.13 MB, the
podium + cup 0.03 MB and the flame 0.01 MB. Before meshopt on the stadium and desert models the same 49 were 9.5 MB.

| models | GLBs |
|---|---|
| 4 tinted truck GLBs, PNG textures (before OR-FB-004) | 19.6 MB (17 models) |
| 4 tinted trucks (1.37 MB each), 256 px webp props, skinned fans, exporter v5 | 9.63 MB (21 models) |
| the same specs re-exported by exporter v6 (cropped atlases) | 8.63 MB (21 models) |
| one `variants` truck + meshopt, qualified clips, simplified fans, crowd `poses`, billboards | 4.37 MB (25 models) |
| + Pro Racer stadium, Arid Desert, 6 seated crowd sets, flagman, podium (OR5), meshopt on everything static | 7.65 MB (49 models) |

## Presentation (OR4)

### Podium (`ui/podium-view.ts`)
With models, the results screen's flat pixel drivers become a 3D scene in a 922 × 300 canvas between the times box
and the plates. It has its own `WebGLRenderer` (one context, made on first use and kept; `alpha` so the screen's
checker shows round a disc of arena dirt) and its own `requestAnimationFrame` loop while the screen is up. The
podium is Pro Racer's (`podium`, three black discs with a red band, at 2×), centred on the winner's column so its
discs stand in plate order 2nd, 1st, 3rd, 3.6 m apart, with 4th on the ground to the right; each disc's top is found
by a ray cast down at its column and its place number (gold, silver, bronze, Press Start 2P) is a canvas label on its
front. Without the model the procedural steps (gold, silver, bronze boxes) stay. The camera's fov is set from the
canvas aspect so the four columns land over the four plates. Confetti (260 instanced paper squares, six colours)
falls and flutters over the winner, recycled at the top (Pro Racer's confetti is a particle effect, OR-FB-020). Each driver stands in front of their truck (the same TruckView,
parked at `TruckView.groundLift`, turned a little), both at `TRUCK_LOOK`.

| place | clip | |
|---|---|---|
| 1st | Emotes `POLY_EMOT_Celebrate_BeatChest` once, then Mixamo `Driver_Trophy` (both arms overhead) | holds the cup (`trophy`, Pro Racer `SM_Prop_Trophy_01` × 0.95) in `hand_r`, kept upright |
| 2nd | Emotes `POLY_EMOT_Celebrate_Clapping_Polite` | |
| 3rd | Emotes `POLY_EMOT_Happy_FistPump` | |
| 4th | Mixamo `Driver_Defeated` (head down; the Emotes `Sad_Tired` is subtler) | |

Drivers by truck colour (`driver_<colour>` in ssg.models.json): red `SK_Character_Biker` (City Characters),
yellow `Character_RedneckMale_01` (BattleRoyale), blue `SK_Chr_Mechanic_Female_01` (Apocalypse), grey
`SK_Character_Roadworker` (City Characters, hi-vis). Every driver carries all six clips (any of them can finish
anywhere), 0.39–0.46 MB each with meshopt. Pro Racer's racing-suit drivers would suit better (their suits take
`variants`) but export with white skin (OR-FB-016) and their helmets attach at the feet (OR-FB-017). The specs name
the Synty clips with the driver's gender (`POLY_EMOT_Happy_FistPump@Feminine` for the mechanic; the Mixamo uploads
have one version each); the GLB keeps the qualified name, and `findClip` matches the
base name in `CLIPS` to it, so the game code names clips without the qualifier. `main.ts` preloads them after boot. The trophy follows the hand bone's world
position rather than being parented to it, so it never takes the bone's axes. `window.__or.podium()` gives
`stop()`, `tick(dt)` (step the clips by hand for frame captures) and `info` (draw calls, triangles).

### Crowd (`race/crowd.ts`)
The fans sit on the stadium's seats (`StadiumView.seats`, found by `findSeats`, see "Stadium"): the Session hands the
Crowd a promise of them. Of the seats the race camera frames (1384 on Rattlesnake Run), it fills up to 320, scored
by a hash plus a little per row so the front rows are fuller but the back is not empty, at `FAN_LOOK = 1.1` (the
stands are drawn at 1.1 too). Six City Characters (SummerGirl, Jock, HipsterGuy, Tourist, PunkGirl, Grandpa):
- `crowd_a…f` (`poses`): seven static meshes each, one node per pose: `sit` (Mixamo `Crowd_Sit_Idle` at 1.0 s),
  `sit_cheer_a/b` (`Crowd_Sit_Cheer` at 0.63 / 0.94 s: an arm up), `arms_a/b` (Emotes `Happy_ArmsRaised` at 0.6 /
  1.3 s) and `fist_a/b` (`Happy_FistPump` at 0.5 / 1.1 s). All poses share the first pose's origin (the seated
  fan's feet), so a fan stands up in place. `loadPoses()` returns each pose's mesh parts with their matrix in the
  export (the meshopt child carries the dequantising transform). One InstancedMesh per fan model per pose; the
  matrices are re-packed so each mesh draws only the fans in its pose.
- Seated while nothing happens. On a cheer, 45% of the fans jump up (half arms raised, half fist-pumping) and hop a
  little; the rest cheer from their seats; each flips between its two frames at its own phase (~4 Hz).
- `fan_a/b/c` (skinned: `Crowd_Sit_Idle`, `Crowd_Sit_Cheer`, `Happy_ArmsRaised`): 6 fans spread along the front row
  are `Character`s with their own mixer, cross-fading seated → cheering, so the front rows move smoothly between the
  frame-flipping instanced fans.
- `simplify: 0.3` on the pose sets (the exporter keeps 38–40%: ~820 triangles a fan); the crowd casts no shadow.
- Cheers: `finish` (any truck, 4 s) and `land` with `airTime ≥ 0.5 s` (2.5 s), from the event bus; a new cheer
  extends the current one. `window.__or.crowd()` gives `cheer(s)`, `cheering`, `count`, `drawCalls()`, `ready`.
- Without models there are no seats and build.ts's procedural stand keeps its box crowd.
- The pose geometry belongs to the cached model; RaceScene.dispose detaches the crowd before it frees the scene.
- The Mixamo clips (`Crowd_*`, `Driver_*`, `Flagman_Wave`) are in the generator's `_Uploads` pack (ids 3348–3363).

**Cost** (Rattlesnake race, 4 trucks, SwiftShader 1280×720, both passes: main + shadow map; the crowd's own
triangles are per pass):

| | draw calls | triangles | crowd triangles | fps (SwiftShader) |
|---|---|---|---|---|
| box crowd (88 boxes), no billboards | 204 | 366k | | 4 |
| game-baked fans, full detail, idle (before) | 220 | 562k | ~98k | 4 |
| game-baked fans, full detail, cheering (before) | 226 | 562k | ~98k | 4 |
| exported poses + simplify 0.5 + billboards, idle | 232 | 466k | 49.5k | 4.0 |
| exported poses + simplify 0.5 + billboards, cheering | 238 | 466k | 49.5k | 4.0 |
| Pro Racer stadium + desert, 320 seated fans (OR5), idle | 263 | 665k | 263k | 4.0 |
| the same, cheering, mid-race (`view.mjs … perf`) | 301 | 757k | 263k | 4.0 |

The fans now add 9–12 draw calls and ~49k triangles per pass (half of before); the four billboards add ~12 draw
calls. SwiftShader is CPU-bound at ~4 fps either way, so the frame rate does not move there.

With the stadium (OR5) the crowd is 320 fans in view (of 1384 seats the camera frames) at ~820 triangles each, drawn
in the main pass only (`castShadow = false`), as 6 models × 7 poses of instanced meshes (~20 of them non-empty at a
time) plus 6 skinned fans. Seven grandstand sections, the VIP box and eight bleachers are one InstancedMesh per GLB
mesh; the desert is ~15 models, instanced, unshadowed. SwiftShader still measures 4 fps on Rattlesnake Run at
1280×720 (`node scripts/view.mjs <url> scene=race p perf`, 8 s real time); the extra triangles are the crowd's.

### Local multiplayer (`engine/input.ts`, `game/flow.ts`)
Up to three humans like the original (red, yellow, blue; grey is always the CPU boss). They join at the sign-up
(above); colours nobody joins race as CPU drivers with our CPU names. Each human has their own cash, nitros, upgrades
and credits, shops in turn and gets their own CONTINUE? countdown.

| Humans | Keys (`KEY_SCHEMES`) | Pads |
|---|---|---|
| 1 | `solo`: arrows or WASD, Space / Shift = nitro | any pad (`readInput()`) |
| 2–3 | `wasd`: W A S D, Left Shift = nitro · `arrows`: arrows, Right Ctrl / Enter = nitro · the third human: none | a pad a human joined with stays theirs; the other connected pads go to the humans without one in join order (`padsFor`) |

A human's keyboard side is the side they joined with (`PlayerState.keys`, saved); a test sign-up without a source
takes the first free side. `Flow.controls` (one `Control { keys, pad }` per human) follows the season's players;
`readPlayers(controls)` gives one TruckInput per human every step (a pad wins while it's being used, else the keys),
and `Race.step` hands input k to human k's slot. The rubber band follows the leading human; the race's straggler
clock starts when the last human is in; the "1ST PLACE!" banner names the human when there are several.

### DOS look (`engine/retro.ts`)
Off by default. F2 cycles off → 256 colours → 16 colours → off (a toast says which); the title menu has a
`DOS LOOK:` line doing the same. Saved in `or.settings`. When on, `RaceScene.render` draws through `retro.render`:
the scene goes into a 200-row HalfFloat render target (width from the window's aspect, ~356 at 16:9), then a
full-screen quad samples it with nearest filtering, converts to sRGB, quantises (256: 3-3-2 bits per channel with
4×4 Bayer dither; 16: the nearest EGA colour, luma-weighted, with a lighter dither), darkens the lower third of each
low-res row as a scanline and adds a slight vignette. The DOM HUD stays sharp, like the original's text. The podium
canvas follows the setting at a third of its resolution with `image-rendering: pixelated`.

### Touch and mobile (`ui/touch/`, `engine/input.ts`, `engine/quality.ts`)
Phones and tablets play in landscape with touch alone.

**Input mode.** `engine/input.ts` keeps the device used last: `touch` (a finger on the screen; a coarse-pointer
device starts in it), `keys` (any key but F-keys, M and lone modifiers) or `pad` (a pad press or stick). `ui/touch/
mobile.ts` mirrors it as `body.or-touch` (and `or-touchcap` on any touch screen): every screen carries both prompts,
`.kb-only` ("PRESS START") and `.touch-only` ("TAP TO START", on-screen buttons), and CSS shows one set.

**Race controls** (`ui/touch/controls.ts`, shown in a race in touch mode). Two invisible halves take the pointers
(Pointer Events, `touch-action: none`, pointer capture, every pointer tracked, so steer + gas + nitro work at once):
- left: a slide pad drawn bottom-left; steer = finger offset / 46 px (× the size unit) with a 5 px dead zone, from
  the pad's centre when the finger lands on it (an end = full lock, like a ◀ / ▶ button), else from where it landed
  (a floating pad, marked by a small square).
- right: GAS, BRAKE / REVERSE and NITRO; a finger is on whichever it's over as it slides; anywhere else on the right
  half is GAS. NITRO also gives gas (the thumb rolls onto it); BRAKE wins over gas.
- the result goes to `setTouchInput()`: `readInput()` and `readPlayers()` give it to player 1 while it's active.
- sizes scale with `--u` = 100vmin / 390 (1–1.45 px): pedals 88 × 64–136, the pad 156 × 84, all ≥ 64 CSS px, inside
  `env(safe-area-inset-*)`. Wide phones (> 1.9:1) stack the pedals in a column (NITRO, GAS, BRAKE); tablets and 16:9
  screens put them in a low block (GAS tall on the right, NITRO over BRAKE). `reserve()` reports what they cover and
  the camera fits around it (Camera above); the HUD panel and track name follow the camera, and the name slides off
  the panel when they'd overlap.

**Menus by touch.** Elements with `data-tap="<id>"` (and an optional `data-key`) turn a click into a menu press
(`pushMenu({ key, tap })`, src `touch`); `data-repeat` ones fire on press and repeat while held (the initials'
arrows). The flow drains them with the keys and pads, so taps follow the same routing (a tap is player 1's: `Flow.
ownerOf`). Title: tap anywhere = the first item (CONTINUE SEASON or NEW SEASON), the season items and a row of
setting chips (DOS LOOK, QUALITY, SOUND, VIBRATE on touch screens with `navigator.vibrate`), a fullscreen button
(called inside the click: a user gesture; then `screen.orientation.lock('landscape')` where allowed). Hints: tap =
NEXT, BACK. Sign-up: tap an open panel = join on that colour (only as player 1: touch never joins after a keyboard
or pad player), ▲ / ▼ above and below each letter (a tap on a letter selects it), OK, ◀ ▶ or a tap on a free panel
for the colour, READY, START; BACK. Shop: a tile buys (START NEXT RACE starts), SAVE + QUIT twice. Results: a tap
anywhere. Continue: CONTINUE / GIVE UP. Game over: a tap. A standalone race's results restart on a tap.

**Pause** (`ui/touch/pause.ts`): the II button top-left (touch mode), or Esc / P in a race; PAUSED with RESUME,
SOUND on/off and QUIT TO TITLE (the season stays saved at the shop before the race; a standalone race has RESTART).
The flow stops stepping physics and suspends the AudioContext. A race also pauses when the page is hidden or the
device turns to portrait.

**Page.** `index.html`: `viewport-fit=cover, user-scalable=no`, `theme-color`, `apple-mobile-web-app-capable`,
the manifest (`public/manifest.webmanifest`: fullscreen, landscape, our pixel icon in `public/icons/`, drawn as a
32×32 SVG and rendered to PNGs by `scripts/make-icons.mjs`). `html, body` have `touch-action: none` and
`overscroll-behavior: none`; `touchmove` is cancelled outside `[data-scroll]` (the hints), and iOS gesture events
and double taps are cancelled, so nothing scrolls, zooms or pulls to refresh. A "rotate your device" card covers
the page on a touch screen in portrait. Audio unlocks on `pointerdown`, `touchend` or `click` (iOS needs the last
two). Haptics: `navigator.vibrate` on a human truck's nitro (35 ms) and on hard hits (strength ≥ 0.45; a double
buzz above 0.8), in touch mode with the VIBRATE setting on.

**Quality** (`engine/quality.ts`, setting `or.settings.quality`, the title chip, `?quality=`):

| | high | low |
|---|---|---|
| Pixel ratio | device, at most 2 | 1 |
| Antialiasing | on | off (fixed when the renderer is made) |
| Sun shadow map | 2048, PCF soft | 1024, PCF |
| Particles | 1200 | 500 |
| Crowd | baked fans + 6 skinned, animated fans | baked fans only |

Auto starts low on a touch screen whose short side is under 500 px (a phone) and high elsewhere, then drops to low
for the page after a race (or the title's demo race) runs under 40 fps for 3 s (a toast says so). A drop changes
the pixel ratio, the current sun's shadow map and the skinned fans at once; particles follow from the next scene.
Headless browsers (`navigator.webdriver`) skip the fps watch so the checks' screenshots stay comparable; the mobile
check turns it on for the iPad.
