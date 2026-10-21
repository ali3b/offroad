// Smoke check: the game boots a scene with no page or console errors and saves test-results/<scene>.png.
//   node scripts/load-check.mjs [url] [scene] [param ...]  (npm run dev first; default http://localhost:5199 test)
//   extra params go onto the query, e.g. `race track=coyote reverse` → ?scene=race&track=coyote&reverse and
//   test-results/race-coyote-reverse.png
// Scenes: test, race (truck + ground checks), title (the demo race behind the logo: ground check), shop/podium (menus).
// The game's own default (no ?scene) is the title; this check keeps `test` as its default.
// Headless Chromium on SwiftShader (software GL): the shared GPU stays free.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const url = (process.argv[2] ?? process.env.GAME_URL ?? 'http://localhost:5199').replace(/\/$/, '');
const scene = process.argv[3] ?? 'test';
const extra = process.argv.slice(4);
const query = extra.map((p) => `&${p}`).join('');
const shot = [scene, ...extra.map((p) => p.replace(/^track=/, '').replace(/[^\w-]+/g, '-'))].join('-');
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

try {
  await page.goto(`${url}/?scene=${encodeURIComponent(scene)}${query}`);
  await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
  // A few real frames so the HUD and shadows are drawn.
  await page.waitForFunction(() => window.__or.loop.steps > 120, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const has3d = await page.evaluate(() => !!window.__or.session);
  const parked = scene === 'test' || scene === 'race';
  if (has3d) {
    const info = await page.evaluate(() => ({ truck: window.__or.truck(), ground: window.__or.groundCheck(), fps: window.__or.loop.fps }));
    console.log(`${scene}: truck ${JSON.stringify(info.truck.pos)} contacts ${info.truck.contacts.map(Number).join('')} up.y ${info.truck.up.y.toFixed(3)}; ground error ${info.ground.toFixed(3)} m; ${info.fps.toFixed(0)} fps`);
    if (!(info.ground < 0.2)) fail(`the physics heightfield does not match the height grid (max error ${info.ground} m)`);
    // Only a parked truck must sit on four wheels (the title's demo race is driving).
    if (parked && info.truck.contacts.filter(Boolean).length < 4) fail('the parked truck is not on all four wheels');
    if (parked && info.truck.up.y < 0.95) fail('the parked truck is not upright');
  } else if (parked) fail('no race scene');
  else console.log(`${scene}: menu screen "${await page.evaluate(() => window.__or.flow.state().screen)}"`);
  await page.screenshot({ path: `test-results/${shot}.png` });
  console.log(`saved test-results/${shot}.png`);
} catch (e) {
  fail(e.message);
}
for (const e of errors) fail(`page error: ${e}`);
await browser.close();
console.log(ok ? 'load-check OK' : 'load-check FAILED');
process.exit(ok ? 0 : 1);
