// Builds the game and publishes dist/ to the gh-pages branch of `origin` (GitHub Pages).
//   node scripts/deploy-pages.mjs            build and force-push gh-pages
//   node scripts/deploy-pages.mjs --no-push  build dist/ only (check it with: npx vite preview)
// Models (public/models) are generated locally by `npm run assets` and are not in the source branch (Synty EULA);
// the built output carries the game-ready GLBs the game needs.
import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });

if (!existsSync(path.join(root, 'public/models/models.json'))) console.warn('no public/models/models.json: the build uses placeholder trucks (run `npm run assets` once the generator can export models)');
run('npm run build');
writeFileSync(path.join(dist, '.nojekyll'), '');

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
