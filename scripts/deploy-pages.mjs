// Builds the game and publishes dist/ to the gh-pages branch of `origin` (GitHub Pages).
//   node scripts/deploy-pages.mjs            build and force-push gh-pages
//   node scripts/deploy-pages.mjs --no-push  build dist/ only (check it: npx vite preview, or any static server)
// dist/ holds:
//   - the game (vite build; base './' so it runs from ali3b.github.io/offroad/), with public/models copied in by vite.
//     The models are generated locally by `npm run assets` and are git-ignored in the source branch (Synty EULA: no
//     source assets); the Pages build carries only the game-ready GLBs the game loads.
//   - videos/: the trailer, the short and the GIF from scripts/trailer.mjs (test-results/video, never in master)
//   - gallery.html: the trailer and the screenshots (docs/screenshots, as JPEGs) in the DOS style
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });
/** The Pages branch should stay well under GitHub's soft limits. */
const MAX_MB = 100;

if (!existsSync(path.join(root, 'public/models/models.json'))) {
  console.error('deploy: no public/models/models.json; run `npm run assets` first (the Pages build needs the real models)');
  process.exit(1);
}
run('npm run build');
writeFileSync(path.join(dist, '.nojekyll'), '');
if (!existsSync(path.join(dist, 'models/models.json'))) throw new Error('deploy: vite did not copy public/models into dist/models');

// Videos (git-ignored; made by scripts/trailer.mjs).
const videoSrc = path.join(root, 'test-results/video');
const videos = ['offroad-trailer.mp4', 'offroad-short.mp4', 'offroad.gif'];
mkdirSync(path.join(dist, 'videos'), { recursive: true });
for (const v of videos) {
  const f = path.join(videoSrc, v);
  if (existsSync(f)) copyFileSync(f, path.join(dist, 'videos', v));
  else console.warn(`deploy: no ${path.relative(root, f)} (run node scripts/trailer.mjs); the gallery's video will be missing`);
}

// The gallery: screenshots as JPEGs (a fraction of the PNGs' size), the font, the page.
const SCREENS = [
  ['title', 'The title screen over the demo race'],
  ['race-rattlesnake', '<b>Rattlesnake Run</b>: four trucks, four laps'],
  ['race-results', 'The podium: prize money, times and the track record'],
  ['shop', 'The Speed Shop between races'],
  ['dos-look', 'F2: the DOS look, 256 colours'],
  ['race-rattlesnake-reverse', 'Every track also runs in reverse'],
];
const TRACKS = [
  ['rattlesnake', 'Rattlesnake Run', 'a four-pass serpentine with a ridge across every lane, a plank jump, whoops and mud'],
  ['coyote', 'Coyote Canyon', 'long straights, a banked lane, puddles, a plank ramp and a jump over a pool'],
  ['boneyard', 'Bone Yard', 'a figure-8 whose connector crosses a deep water pit on a bridge; bone-pile moguls'],
  ['drycreek', 'Dry Creek Spiral', 'a spiral that exits over its own inner ring on a bridge, with a creek across two lanes'],
  ['twister', 'Twister Flats', 'an open figure-8 whose crossing is a jump over a water channel between two berms'],
  ['buzzard', 'Buzzard Bend', 'a bow-tie figure-8 whose diagonals cross on a striped plank bridge'],
  ['thunder', 'Thunder Ridge', 'one long ridge across four columns, a jump under bunting at every crossing'],
  ['mesa', 'Mesa Mayhem', 'a snake around a zig-zag island, a mesa to fly off, tabletops and giant drums'],
];
const shotDir = path.join(dist, 'screenshots');
mkdirSync(shotDir, { recursive: true });
const shot = (name) => {
  const src = path.join(root, 'docs/screenshots', `${name}.png`);
  const out = path.join(shotDir, `${name}.jpg`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-q:v', '3', out]);
  return `screenshots/${name}.jpg`;
};
const figure = (img, alt, caption) => `<figure><a href="${img}"><img src="${img}" alt="${alt}" loading="lazy" width="1280" height="720" /></a><figcaption>${caption}</figcaption></figure>`;
const screens = SCREENS.map(([n, c]) => figure(shot(n), c.replace(/<[^>]+>/g, ''), c)).join('\n          ');
const tracks = TRACKS.map(([id, name, text]) => figure(shot(`track-${id}`), name, `<b>${name}</b>: ${text}.`)).join('\n          ');
mkdirSync(path.join(dist, 'fonts'), { recursive: true });
copyFileSync(path.join(root, 'node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2'), path.join(dist, 'fonts/press-start-2p-latin-400-normal.woff2'));
const page = readFileSync(path.join(root, 'scripts/pages/gallery.html'), 'utf8').replace('<!--SCREENS-->', screens).replace('<!--TRACKS-->', tracks);
writeFileSync(path.join(dist, 'gallery.html'), page);

// Size check.
const du = (d) => readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? du(path.join(d, e.name)) : statSync(path.join(d, e.name)).size), 0);
const mb = (b) => (b / 1e6).toFixed(1);
console.log(`deploy: dist ${mb(du(dist))} MB (models ${mb(du(path.join(dist, 'models')))} MB, videos ${mb(du(path.join(dist, 'videos')))} MB, screenshots ${mb(du(shotDir))} MB)`);
if (du(dist) > MAX_MB * 1e6) throw new Error(`deploy: dist is over ${MAX_MB} MB`);

if (process.argv.includes('--no-push')) process.exit(0);
let remote = '';
try {
  remote = execSync('git remote get-url origin', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  /* no origin */
}
if (!remote) {
  console.log('deploy: no `origin` remote; dist/ is built but nothing was pushed. Add the GitHub remote and run again.');
  process.exit(0);
}
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
rmSync(path.join(dist, '.git'), { recursive: true, force: true });
run('git init -q -b gh-pages', dist);
run('git add -A', dist);
run(`git commit -q -m "Pages build from ${sha}"`, dist);
run(`git push -q -f ${remote} gh-pages`, dist);
rmSync(path.join(dist, '.git'), { recursive: true, force: true });
console.log(`deploy: pushed gh-pages to ${remote}`);
