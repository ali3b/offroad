// Builds every model declared in ssg.models.json through the Synty Sprite Generator CLI (never its code):
//   npm run assets
// runs `ssg model apply ssg.models.json --out public/models --json`, which exports each model as a GLB plus its
// .model.json manifest and writes public/models/models.json (incremental: only changed specs are downloaded).
// The CLI prints a line per model on stderr and, with --json, a summary on stdout:
//   { dir, index, models: [{ name, id, action: 'written'|'updated'|'unchanged', cached, glb, manifest }] }
// Without an `ssg model` command (an old generator) it prints a notice and exits 0; the game then draws placeholder
// trucks and props.
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
if (!json?.models) {
  console.log(r.stdout);
} else {
  const by = {};
  for (const m of json.models) by[m.action] = (by[m.action] ?? 0) + 1;
  const kb = json.models.reduce((n, m) => n + (fs.existsSync(path.join(out, m.glb)) ? fs.statSync(path.join(out, m.glb)).size : 0), 0) / 1024;
  console.log(`assets: ${json.models.length} models (${Object.entries(by).map(([a, n]) => `${n} ${a}`).join(', ')}), ${(kb / 1024).toFixed(1)} MB of GLBs`);
}
console.log(`assets: built into ${path.relative(root, out)}/`);
