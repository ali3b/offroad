# Off Road: a 3D arcade off-road racer built through Synty Sprite Generator

A three.js + Rapier recreation of the 1989 top-down off-road racer: four trucks, one fixed screen per track, jumps,
water and mud, nitros, a cash-and-upgrades season. Every model comes from Synty Sprite Generator
(`~/projects/synty-sprite-generator`). Like Solitary Strike and Sidefighter, this game exists to prove the
generator (here: its 3D model export) and to find its gaps. The loop is in the generator's `docs/GAME-LOOP.md`; the
plan is `~/.claude/plans/distributed-twirling-lark.md`. Milestones are in `TODO.md`, architecture in
`docs/DESIGN.md`.

## Rules
- Use the generator **only** through its interfaces:
  - the CLI: `node /home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs …` (`--help` on any command)
  - the `synty-sprites` MCP tools (`.mcp.json`, which allows writes into this repo only)
- **Never** edit, import or copy code from the generator repo, and never read its database or `data/` folder
  directly. If you can't get something through the CLI or MCP, that's a finding: write it in `FEEDBACK.md`.
- Every model the game uses is declared in `ssg.models.json` and rebuilt by `npm run assets`
  (`scripts/build-assets.mjs` → `ssg model apply`). `public/models/` is generated output: never hand-edit it, never
  commit it (Synty EULA: no redistribution of source assets).
- A workaround in the game (hand-made data, code that fixes up an export) needs a FEEDBACK entry
  (`OR-FB-NNN`). Mark the code `// OR-FB-NNN` so it can be removed once the generator is fixed.
- Asset builds are heavy: run one at a time, and never while a generator walk or another game's build is running.
- The GPU (GTX 1060) is shared with the desktop. Headless checks use SwiftShader (`--use-angle=swiftshader`);
  only `scripts/record.mjs` uses the GPU (EGL) for smooth video.
- **Legal naming:** everything public (README, title screen, page titles, package.json, commit messages, Pages) says
  only "Off Road". Never name the original game, its publisher, developer or endorsing driver, and never call this a
  "remake". Internal design notes may say "the 1989 original". Track names, art and music are our own.

## Controls
- Arrows or WASD: up = gas, down = brake/reverse, left/right = steer. Space or Shift = nitro. R = reset to the grid.
- Gamepad: RT or A = gas, LT or X = brake/reverse, left stick or d-pad = steer, B / Y / RB = nitro, Back = reset.
- F3 = debug overlay (speed, wheel contacts, suspension, air time, fps). `?debug` opens it on load.

## Scenes and URL params
- `?scene=test` (default): the player's truck alone on the test track. `?track=<id>` picks a track JSON.
- `?scene=race&track=<id>` (default `rattlesnake`): a 4-truck, 4-lap race. `&reverse` = the reversed variant,
  `&cpus=0..3` fewer CPU trucks, `&autopilot` = the AI drives the player's truck.
- Tracks are JSON in `src/track/tracks/` (format in docs/DESIGN.md "Track format"), registered in `index.ts`
  (`TRACK_ORDER` = the 8 race tracks in season order). Design them with `scripts/track-map.mjs` and
  `scripts/hit-probe.mjs`.
- Game events for audio: `src/race/events.ts` (`events.on('impact', …)`).

## Checks before you finish a milestone
- `npm run typecheck`
- `npm run dev` (port 5199), then
  - `node scripts/load-check.mjs http://localhost:5199 test`: no page/console errors, the heightfield matches the
    height grid, the truck sits on four wheels; writes `test-results/test.png`.
  - `node scripts/load-check.mjs http://localhost:5199 race [track=<id>] [reverse]`: the same for the race scene.
  - `node scripts/drive-check.mjs http://localhost:5199`: throttle 3 s (moves > 15 m, upright), a right turn, a
    nitro jump off the ramp; writes `test-results/drive-*.png`.
  - `node scripts/race-check.mjs http://localhost:5199 [track] [--reverse]`: a full 4-lap race on autopilot; all
    four trucks finish, laps counted by the gates, results with prize money; writes `test-results/race-*.png`.
- Look at the screenshots. Tick the milestone in `TODO.md`, update `FEEDBACK.md`, and commit in this repo.
- Release: `node scripts/record.mjs http://localhost:5199 <name>` → `test-results/video/<name>.mp4`;
  `node scripts/deploy-pages.mjs` → gh-pages.

## Reference material
`research/` (git-ignored) holds `ORIGINAL.md`, the study of the 1989 original: rules, economy, track sketches, screens and HUD. It names the original, so it never goes into git or onto Pages. Use our own names in code and public text.
