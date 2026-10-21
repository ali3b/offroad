# Off Road: design

Internal notes. The game recreates the layouts and feel of the 1989 original top-down off-road racer as closely as
possible, in real 3D, with our own names, art and music. Public text says only "Off Road" (see CLAUDE.md).

## Architecture

```
src/
  main.ts            boot: renderer, Rapier world, scene from ?scene=, camera fit, loop, HUD, window.__or
  engine/
    renderer.ts      WebGLRenderer (sRGB, PCF soft shadows), scene, hemisphere + low sun
    camera.ts        the fixed whole-track camera (CAMERA: pitch, fov, HUD margin) and fitFixedCamera()
    loop.ts          fixed 60 Hz physics step with an accumulator (max 6 steps/frame), render per rAF, advance()
    input.ts         keyboard + Gamepad API → TruckInput
  physics/
    world.ts         RAPIER.init(), World (gravity -14), PHYSICS_DT
    heightfield.ts   height grid → Rapier heightfield collider; wall polylines → cuboid colliders
    vehicle.ts       Truck: DynamicRayCastVehicleController + arcade assists; TUNING
  track/
    types.ts         the track JSON schema
    <id>.json        track data (test.json: the proving ground)
    heights.ts       track JSON → height grid (features: ramp, dip, mound, whoops; infield raise; base noise)
    build.ts         grid → ground mesh (vertex colours), water, tyre walls, start line, colliders, zone queries
  race/
    session.ts       one track + the player's truck (OR2: CPU trucks, laps, start lights, results)
    truck-view.ts    the truck's look (placeholder box until the generator's GLB)
  ui/
    hud.ts           top strip, one panel per truck colour (DOM overlay)
    debug.ts         F3 overlay
```

### Boot and scenes
`main.ts` reads `?scene=` (default `test`; unknown scenes throw so the load check fails loudly) and `?track=`
(default `test`). `?debug` opens the F3 overlay. When everything is built it runs 1 s of physics so the truck settles
on its springs, starts the loop and sets `window.__or.ready`.

### Loop
Physics always steps at 1/60 s. A render frame runs as many steps as the elapsed time needs, at most 6; beyond that
the game slows down rather than spiralling (SwiftShader runs ~6–8 fps, so headless tests see slow motion). Tests
measure simulated time (`__or.simTime`) or call `__or.advance(seconds)` to step synchronously.

### Camera
The original shows a whole track on one screen from a high 3/4 view with almost no perspective. We use a
perspective camera with a narrow vertical FOV (18°) pitched 58° below the horizon, looking north (-z), placed by
`fitFixedCamera()`: a binary search on the distance until the track's wall bounds fit below the HUD strip
(`CAMERA.hudTop`), then the aim is nudged so the box is centred. It re-fits on resize. The camera never moves
during a race. research/ORIGINAL.md (local) should confirm pitch and framing against footage.

### Track data → world
A track is one JSON (`src/track/types.ts`): size, cell size (0.5 m), base noise, an infield polygon (raised grass),
height features, wall polylines, zones (water) and the start grid. `heights.ts` evaluates it into one height grid
that feeds both the Rapier heightfield and the ground mesh, so visuals and physics agree; the load check raycasts the
collider at 60 points and fails if it differs from the grid by > 0.2 m (catches a transposed field: Rapier wants a
column-major matrix with rows along z). Walls are cuboids per segment, sunk 2 m under the lowest ground and 1.3 m
above the highest, with restitution 0.45 for the original's bouncy wall hits. Zones are queried per step
(water: velocity drag).

### Truck physics (OR1)
- Rapier `DynamicRayCastVehicleController` on a 1200 kg box chassis (1.9 × 0.84 × 4.5 m, centre of mass 0.45 m
  low, roll/pitch inertia boosted). Forward axis +z (`setIndexForwardAxis = 2`), up +y.
- Four raycast wheels (radius 0.5, rest 0.55, travel 0.45): stiffness 34, compression 3.2, relaxation 4.2. 4WD
  engine force with a quadratic taper to the top speed (21 m/s, nitro 29), brakes, reverse when nearly stopped.
- Arcade assists after `updateVehicle()` and before `world.step()`, as direct velocity edits (mass-independent, easy
  to tune):
  - lateral grip boost: bleed sideways velocity at `lateralGrip`/s scaled by wheels on the ground, so slides fade
    instead of snapping;
  - yaw assist: pull the yaw rate towards `steer × yawRate` (zero with no input, which is the yaw damping);
  - upright stabilizer: rotate up towards the averaged contact normal (ground) or world up (air);
  - air control: steer spins, gas/brake pitch; tumbling is damped;
  - flip recovery: tipped past up.y 0.25 for 1.4 s → put back on its wheels in place.
- Measured (feel-probe, SwiftShader, fixed steps): 0→15 m/s in about 2 s, braking 17→0 in about 2.6 s,
  about 90°/s at 12 m/s full lock with ~1.8 m/s of slide, 0.75–1.1 s of air off the 1.7 m ramp, no tumbles over the
  whoops. Not yet compared with footage.
- Gate (plan): if this can't match the original's feel, switch to a custom 2.5D arcade model over the same heightfield
  (the track and camera code don't change).

### HUD
A DOM strip over the canvas with one panel per truck colour (red P1, blue, yellow, grey), each with lap, cash and the
nitro count, matching the original's per-truck scoreboard. Exact layout to be checked against research/ORIGINAL.md (local).

### Test handle `window.__or`
`ready`, `scene`, `simTime`, `truck()` (pos, speed, heading, up, contacts, suspension, airborne, airTime, nitros,
inWater, resets), `setInput(partial | null)`, `reset()`, `place(x, z, heading)`, `advance(s)`, `debug(on)`,
`groundCheck()`, `heightAt(x, z)`, plus `tuning`, `camera`, `loop`, `session` and `THREE` for live tuning.

## Models (from the generator)
`ssg.models.json` lists what the game wants (format: generator TODO "3D models + Off Road" contract): the lifted pickup
`POLYGON_Palm_City/SM_Veh_Pickup_Lift_01` in 4 tints with `origin: axle-centre`, and props (Apocalypse tyre wall,
tyre pile and barrels, War hay bale, Palm City traffic light for the start lamps, a barrier). `npm run assets` runs
`ssg model apply` into `public/models/` (git-ignored). The truck view will read the manifest's `wheels` block (node,
radius, axle, steer) to drive the wheel nodes from the raycast vehicle, and the `collider.box` to size the chassis.
