# Off Road

A 3D arcade off-road racer in the browser. Four trucks, one track per screen seen from high above, jumps, whoops,
water and nitros. It is built with three.js and Rapier, and its models come from Synty assets through an
agent-driven asset pipeline: the game asks a command-line tool for game-ready GLB models and never touches the
source assets by hand.

![A race on Rattlesnake Run](docs/screenshots/race-rattlesnake.png)

**Status:** the first track and a full race. Four trucks race four laps of *Rattlesnake Run*, a serpentine stadium
track with a ridge across every lane, a plank jump, whoops, mud and a puddle (also raceable in reverse). Three CPU
drivers follow the racing line, bump you, fire nitros on the straights and pick up money bags and nitro bottles.
A flagman and a lamp tree start the race; the podium pays $100K / $90K / $80K / $70K and keeps the track record.
The trucks are placeholder boxes until the generator's 3D export lands; the season and shop come next (`TODO.md`).

![The results podium](docs/screenshots/race-results.png)

## Controls

| | Keyboard | Gamepad |
|---|---|---|
| Gas | Up / W | RT or A |
| Brake / reverse | Down / S | LT or X |
| Steer | Left, Right / A, D | Left stick or d-pad |
| Nitro | Space or Shift | B, Y or RB |
| Reset (race: back to Get Ready!) | R | Back |
| Race again (results) | Enter | A or Start |
| Debug overlay | F3 | |

## Develop

```sh
npm install
npm run dev          # http://localhost:5199/?scene=race  (a race on track 1; &reverse, &debug, &autopilot)
                     # http://localhost:5199/?scene=test  (one truck on the proving ground)
npm run typecheck
npm run assets       # export the models listed in ssg.models.json into public/models
node scripts/load-check.mjs http://localhost:5199 test   # boots headless, saves test-results/test.png
node scripts/load-check.mjs http://localhost:5199 race   # the race scene, saves test-results/race.png
node scripts/drive-check.mjs http://localhost:5199       # scripted drive: throttle, turn, nitro jump
node scripts/race-check.mjs http://localhost:5199        # a full 4-lap race on autopilot to the results
node scripts/lap-probe.mjs http://localhost:5199         # lap times for feel tuning
node scripts/feel-probe.mjs                              # physics numbers for tuning
node scripts/record.mjs http://localhost:5199 gameplay   # test-results/video/gameplay.mp4
npm run build        # dist/ (relative base, ready for GitHub Pages)
node scripts/deploy-pages.mjs                            # build and push gh-pages
```

Models are generated locally and are not committed: Synty assets can't be redistributed as source files.

## Credits

3D models: Synty Studios POLYGON packs, used under the Synty Store EULA.
Font: Press Start 2P by CodeMan38 (SIL Open Font License), via @fontsource.
