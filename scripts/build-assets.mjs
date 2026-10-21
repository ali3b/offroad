// Builds every model declared in ssg.models.json through the Synty Sprite Generator CLI (never its code):
//   npm run assets
// runs `ssg model apply ssg.models.json --out public/models --json`, which exports each model as a GLB plus its
// .model.json manifest and writes public/models/models.json (incremental: only changed specs are rebuilt).
// Until the generator ships `ssg model` (TODO "3D models + Off Road", M2) this prints a notice and exits 0, and the
// game draws placeholder trucks and props (OR-FB-001).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSG = process.env.SSG_BIN ?? '/home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs';
const spec = path.join(root, 'ssg.models.json');
const out = path.join(root, 'public/models');

if (!fs.existsSync(SSG)) {
  console.log(`assets: the ssg CLI is not at ${SSG} (set SSG_BIN). Skipping; the game uses placeholders.`);
  process.exit(0);
}
// An unknown command makes the CLI print its top-level help, so look for `model` in the command list.
const help = spawnSync(process.execPath, [SSG, '--help'], { encoding: 'utf8' });
if (!/^\s+model\b/m.test(help.stdout ?? '')) {
  console.log('assets: this generator has no `ssg model` command yet (3D model export is being built).');
  console.log(`assets: ${JSON.parse(fs.readFileSync(spec, 'utf8')).models.length} models are declared in ssg.models.json; nothing was built.`);
  console.log('assets: the game runs on placeholder trucks and props until then (FEEDBACK.md OR-FB-001).');
  process.exit(0);
}
fs.mkdirSync(out, { recursive: true });
const r = spawnSync(process.execPath, [SSG, 'model', 'apply', spec, '--out', out, '--json'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
let json = null;
try {
  json = JSON.parse(r.stdout);
} catch {
  /* not JSON */
}
if (r.status !== 0) {
  console.error(`assets: ssg model apply failed (exit ${r.status})`);
  console.error(json ? JSON.stringify(json, null, 2) : r.stdout);
  process.exit(1);
}
console.log(json ? JSON.stringify(json, null, 2) : r.stdout);
console.log(`assets: built into ${path.relative(root, out)}/`);
