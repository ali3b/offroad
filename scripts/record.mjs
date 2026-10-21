// Records a gameplay video as MP4: one scripted lap of the current track with the player's truck (gas, a nitro on
// the bottom straight into the jump, the whoops, the water, the mound), saved as test-results/video/<name>.mp4.
//   node scripts/record.mjs [url] [name]        (the dev server must be running: npm run dev)
// The lap is driven through window.__or.setInput by a small waypoint autopilot here, so it adapts to the physics.
// GPU WebGL through EGL (the integrated path, like Sidefighter's recorder; SwiftShader runs a few fps and the video
// judders). If EGL can't start WebGL, it falls back to SwiftShader and says so. Playwright's video clock runs slow,
// so the MP4 is cut to the drive and re-timed to wall time.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const url = (process.argv[2] ?? 'http://localhost:5199').replace(/\/$/, '');
const name = process.argv[3] ?? 'gameplay';
const outDir = path.resolve('test-results/video');
const rawDir = path.join(outDir, 'raw');
const W = 1280;
const H = 720;
/** Counter-clockwise lap of the test track: [x, z, nitro here?]. */
const LAP = [
  [-6, 23, true], [20, 23], [44, 20], [46, 0], [44, -22], [20, -24], [0, -23], [-24, -24], [-44, -20], [-46, 0], [-44, 20], [-26, 23],
];

async function launch(mode) {
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const args = mode === 'egl' ? ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch({ env, args });
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: rawDir, size: { width: W, height: H } } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const t0 = Date.now();
  await page.goto(`${url}/?scene=test`);
  const ready = await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 60000 }).then(() => true).catch(() => false);
  return { browser, context, page, errors, ready, startS: (Date.now() - t0) / 1000 };
}

let mode = 'egl';
let rec = await launch(mode);
if (!rec.ready || rec.errors.length) {
  console.log(`EGL WebGL did not start (${rec.errors[0] ?? 'timeout'}); falling back to SwiftShader (the video will be choppy)`);
  await rec.browser.close();
  mode = 'swiftshader';
  rec = await launch(mode);
  if (!rec.ready) throw new Error('the game did not start under SwiftShader either');
}
const { page, context, browser, errors } = rec;
const wait = (ms) => page.waitForTimeout(ms);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

await wait(1500); // the grid, settled
const wall0 = Date.now();
let wp = 0;
const sim0 = await page.evaluate(() => window.__or.simTime);
while (wp < LAP.length) {
  const s = await page.evaluate(() => ({ t: window.__or.simTime, ...window.__or.truck() }));
  const [x, z, nitro] = LAP[wp];
  const dx = x - s.pos.x;
  const dz = z - s.pos.z;
  if (Math.hypot(dx, dz) < 7) {
    wp++;
    continue;
  }
  const diff = wrap(Math.atan2(dx, dz) - s.heading);
  const steer = Math.max(-1, Math.min(1, -diff * 2.2));
  const throttle = Math.abs(diff) > 1.2 && s.speed > 9 ? 0.3 : 1;
  await page.evaluate((i) => window.__or.setInput(i), { throttle, steer, nitro: !!nitro && Math.abs(diff) < 0.3 });
  if (s.t - sim0 > 60) {
    console.log('the lap took over 60 s of game time; stopping');
    break;
  }
  await wait(40);
}
await page.evaluate(() => window.__or.setInput({ brake: 1 }));
await wait(1500);
const wallS = (Date.now() - wall0) / 1000;
const simS = (await page.evaluate(() => window.__or.simTime)) - sim0;
const video = page.video();
await context.close();
await browser.close();
for (const e of errors) console.log(`page error: ${e}`);

const raw = await video.path();
const mp4 = path.join(outDir, `${name}.mp4`);
// Cut the page load, keep the settle + lap + stop, and stretch Playwright's slow video clock to wall time.
const probe = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw]).toString().trim());
const lead = Math.max(0, probe - wallS - 1.5);
const keep = probe - lead;
const factor = (wallS + 1.5) / keep;
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', lead.toFixed(2), '-i', raw, '-vf', `setpts=${factor.toFixed(4)}*(PTS-STARTPTS)`, '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4]);
fs.rmSync(rawDir, { recursive: true, force: true });
console.log(`${mode}: lap ${wp}/${LAP.length} waypoints, ${simS.toFixed(1)} s game time in ${wallS.toFixed(1)} s wall (${(simS / wallS * 100).toFixed(0)}% speed); saved ${path.relative(process.cwd(), mp4)}`);
