// OR1 drive check: hold the throttle for 3 s of simulated time through window.__or and check the truck drove off
// the grid and stayed upright; then steer right, fire a nitro and take the jump ramp.
//   node scripts/drive-check.mjs [url]          (npm run dev first)
// Uses simulated time (window.__or.simTime), so a slow SwiftShader frame rate doesn't change the result.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const url = (process.argv[2] ?? process.env.GAME_URL ?? 'http://localhost:5199').replace(/\/$/, '');
const MIN_DISTANCE = 15;
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
fs.mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let ok = true;
const fail = (msg) => {
  ok = false;
  console.log(`FAIL: ${msg}`);
};
const truck = () => page.evaluate(() => window.__or.truck());
/** Hold an input for `s` simulated seconds, sampling the truck; returns the samples. */
async function hold(input, s) {
  const t0 = await page.evaluate((i) => (window.__or.setInput(i), window.__or.simTime), input);
  const samples = [];
  for (;;) {
    const st = await page.evaluate(() => ({ t: window.__or.simTime, ...window.__or.truck() }));
    samples.push(st);
    if (st.t - t0 >= s) break;
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => window.__or.setInput({}));
  return samples;
}
const fmt = (p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;

try {
  await page.goto(`${url}/?scene=test&debug`);
  await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });

  // 1. Full throttle for 3 s.
  const a = await truck();
  const run = await hold({ throttle: 1 }, 3);
  const b = run.at(-1);
  const dist = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
  const minUp = Math.min(...run.map((s) => s.up.y));
  console.log(`throttle 3 s: ${fmt(a.pos)} → ${fmt(b.pos)} = ${dist.toFixed(1)} m, speed ${b.speed.toFixed(1)} m/s, min up.y ${minUp.toFixed(2)}, heading ${((b.heading * 180) / Math.PI).toFixed(0)}°`);
  if (dist < MIN_DISTANCE) fail(`the truck moved only ${dist.toFixed(1)} m (want > ${MIN_DISTANCE})`);
  if (b.pos.x <= a.pos.x) fail('the truck did not drive forward (east, +x) from the grid');
  if (minUp < 0.7) fail(`the truck tipped (min up.y ${minUp.toFixed(2)})`);
  if (b.resets !== a.resets) fail('the truck was auto-reset (flipped)');
  await page.screenshot({ path: 'test-results/drive-throttle.png' });

  // 2. Steer right while driving: heading east, a right turn swings the nose south (+z), i.e. the heading falls.
  const turn = await hold({ throttle: 0.7, steer: 1 }, 0.8);
  const c = turn.at(-1);
  const dh = Math.atan2(Math.sin(c.heading - b.heading), Math.cos(c.heading - b.heading));
  console.log(`steer right 0.8 s: heading ${((b.heading * 180) / Math.PI).toFixed(0)}° → ${((c.heading * 180) / Math.PI).toFixed(0)}°`);
  if (!(dh < -0.2)) fail(`steer right did not turn right (heading change ${dh.toFixed(2)} rad)`);

  // 3. Nitro + jump: line up before the ramp, floor it with a nitro, expect air time and a clean landing.
  await page.evaluate(() => window.__or.place(-20, 23, Math.PI / 2));
  await hold({}, 0.8);
  const { nitros: n0, resets: r0 } = await truck();
  const jump = await hold({ throttle: 1, nitro: true }, 3.2);
  const air = Math.max(...jump.map((s) => s.airTime));
  const top = Math.max(...jump.map((s) => s.speed));
  const end = jump.at(-1);
  const jumpUp = Math.min(...jump.map((s) => s.up.y));
  console.log(`ramp: top speed ${top.toFixed(1)} m/s, nitros ${n0} → ${end.nitros}, longest air ${air.toFixed(2)} s, min up.y ${jumpUp.toFixed(2)}, landed at ${fmt(end.pos)} up.y ${end.up.y.toFixed(2)}`);
  if (end.nitros !== n0 - 1) fail('the nitro press did not use exactly one nitro');
  if (air < 0.25) fail(`no real air off the ramp (${air.toFixed(2)} s)`);
  if (jumpUp < 0.5 || end.resets !== r0) fail('the truck tumbled on the jump');
  await page.screenshot({ path: 'test-results/drive-jump.png' });
} catch (e) {
  fail(e.message);
}
for (const e of errors) fail(`page error: ${e}`);
await browser.close();
console.log(ok ? 'drive-check OK' : 'drive-check FAILED');
process.exit(ok ? 0 : 1);
