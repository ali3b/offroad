# Off Road TODO

The game's own milestone list, expanded from the plan (`~/.claude/plans/distributed-twirling-lark.md`, "Game
phases"). Each milestone ends with typecheck, the load check and drive check plus screenshots, FEEDBACK entries
written, and a commit. Gaps in the generator go to `FEEDBACK.md` (OR-FB-NNN); the orchestrator triages them into the
generator's TODO ("3D models + Off Road", "Inbox: from Off Road").

## OR0 · Research, packs, skeleton
- [x] `research/ORIGINAL.md` (local only, git-ignored: it names the original) from a study of DOS longplay footage of the 1989 original:
  - [ ] the 8 tracks' layouts as top-down sketches (jumps, water, mud, hills, start line, racing direction)
  - [ ] the screen flow (title → select → race → results → shop) and the HUD layout
  - [ ] laps per race, the prize money table, upgrade prices and levels (Acceleration, Tires, Shocks, Top Speed at
        5 levels each, plus nitros), pickups (nitro, cash), CPU behaviour, the difficulty curve over 99 races, continues
  - [ ] the camera angle and projection measured from screenshots (compare with `src/engine/camera.ts` CAMERA)
- [x] Pack gap list: the Synty packs that would fill grandstands/crowd, desert dressing, race furniture (the user
      decides what to buy); stand-ins until then (benches + characters, tyre walls, traffic lights as start lamps)
- [x] Repo skeleton: Vite 5.4.11 + TS 5.6.3 + three 0.186.1 + Rapier (`@dimforge/rapier3d-compat` 0.21.0),
      dev port 5199, `CLAUDE.md`, `.mcp.json`, `ssg.models.json`, `FEEDBACK.md`, `docs/DESIGN.md`, `README.md`
- [x] Boot (`src/main.ts`, `?scene=`), renderer, fixed whole-track camera at a high 3/4 angle, fixed 60 Hz loop
- [x] Test track as a heightfield (rolling ground, a jump ramp, a water dip, whoops, a mound) inside tyre walls
- [x] `scripts/load-check.mjs` (SwiftShader, no errors, heightfield ↔ grid check, `test-results/<scene>.png`)
- [x] `scripts/build-assets.mjs` (`ssg model apply`; a notice until the command exists, OR-FB-001)
- [x] `scripts/deploy-pages.mjs` (gh-pages + .nojekyll; skips the push without an origin) and `scripts/record.mjs`
- [ ] GitHub repo `ali3b/offroad` (public) + first push + Pages live (orchestrator: auth)

## OR1 · The truck (gate: feel)
- [x] Placeholder box truck on Rapier `DynamicRayCastVehicleController`: 4 raycast wheels, suspension, 4WD
      throttle, brake/reverse, speed-scaled steering
- [x] Arcade assists: lateral grip boost, yaw-rate assist/damping, upright stabilizer, air control, flip recovery
- [x] Nitro burst (6 per race for now), water drag
- [x] Keyboard (arrows/WASD, Space/Shift) + Gamepad API; F3 debug overlay (speed, wheel contacts, suspension)
- [x] `window.__or` test handle; `scripts/drive-check.mjs` (throttle 3 s moves > 15 m upright, right turn, nitro
      jump); `scripts/feel-probe.mjs` (0→top, braking, turn rate, air time)
- [ ] The player truck exported through `ssg model apply` (lifted pickup, 4 tints, origin axle-centre); wheels
      driven from the manifest `wheels` block (blocked on the generator's M1/M2, OR-FB-001)
- [x] Feel tuned against the reference footage (research/ORIGINAL.md): top speed vs. track size, turn rate, jump hang time,
      bounce over whoops, wall bumps (laps 16–17 s on track 1; table in docs/DESIGN.md; `scripts/lap-probe.mjs`)
- [x] Gate decision recorded in `docs/DESIGN.md`: keep the Rapier raycast vehicle (with the arcade assists)

## OR2 · Track 1 + a full race → first public release
- [x] Track 1 from research/ORIGINAL.md: heightmap + track JSON (spline/racing line, walls, ramps, water/mud zones, checkpoints,
      props placed from the generator's models): "Rattlesnake Run" (+ reversed), data-driven format in
      `src/track/tracks/` documented in docs/DESIGN.md; props are placeholders until the export (OR-FB-001)
- [x] 3 CPU trucks following racing lines with rubber-banding; truck-to-truck bumping (Rapier contacts); unstuck /
      reverse off walls / rescue onto the line; the grey boss truck
- [x] Start lights (lamp tree + flagman tower), Get Ready!, 4 laps by ordered gates, lap counter (positions only on
      the results screen, like the original)
- [x] Nitro and money pickups (about one a lap, escalating values)
- [x] Dust, mud and splash particles; skid marks (pooled instanced quads)
- [x] The original's HUD layout filled in (one panel per track spot: timer, laps and nitros per truck; no positions
      or cash during the race); results/podium screen with prize money, times and the track record (`or.records`)
- [x] Load check races a full CPU race to the results (`scripts/race-check.mjs`, autopilot player; load-check `race`)
- [x] Game event bus (`src/race/events.ts`) for the audio lane
- [x] Truck view loads `public/models/models.json` (GLB per tint, manifest wheels) with the box-truck fallback
      (tested with synthetic GLBs; real export pending OR-FB-001, scale OR-FB-002)
- [ ] Release: screenshots in the README (done), a gameplay video (`record.mjs`), Pages deploy (orchestrator)

## OR3 · Season and shop
- [ ] All 8 tracks
- [x] The money and upgrade shop; upgrades change TUNING (acceleration, tires = grip, shocks = suspension, top speed)
      (Speed Shop screen, `TruckMods` per truck via `Truck.setMods`, prices / levels / nitro-per-buy in docs/DESIGN.md)
- [x] Race progression with rising CPU difficulty, continues, high scores saved locally (the cycle rotation with
      reversed variants from `TRACK_ORDER`, CPU trucks shop with their winnings + pace bonus, 3 credits, FREE RACE,
      CONTINUE? 9 s → cash $0, game over; `or.season` save + CONTINUE SEASON; per-track `or.records`;
      `scripts/season-check.mjs`, vitest unit tests)
- [ ] Video + Pages deploy

## OR4 · Presentation
- [x] Title / attract mode with a demo race (our DOS-style logo, the demo race behind it, hints in the attract loop,
      racing hints, driver sign-up with initials + colour, get ready; title is the default scene)
- [ ] Podium with animated drivers (a multi-clip character GLB from the generator)
- [ ] A crowd in the stands; our own chiptune-style music; engine, skid and crash sounds
- [ ] Local 2-player (keyboard + pad)
- [ ] Settings screen with a CRT / pixel option for the DOS look

## OR5 · Polish and story
- [ ] Performance passes (instancing, shadow budget), gamepad polish
- [ ] A gallery page and the chapter-per-milestone documentary treatment like the other games
