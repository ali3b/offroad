// Audio check: opens ?scene=audio, unlocks audio with a click, triggers every song / sound / scene / engine, then
// renders each song (4 s) and each one-shot offline and checks it is audible and doesn't clip.
//   node scripts/audio-check.mjs [url]
// Without a url it starts its own Vite dev server on port 5286 with a separate cache dir (node_modules/.vite-audio).
// Headless Chromium on SwiftShader: the shared GPU stays free.
import { chromium } from '@playwright/test';

let url = process.argv[2] ?? process.env.GAME_URL;
let server = null;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { port: 5286, strictPort: true, host: '127.0.0.1' }, cacheDir: 'node_modules/.vite-audio', logLevel: 'warn' });
  await server.listen();
  url = 'http://127.0.0.1:5286';
}
url = url.replace(/\/$/, '');

const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let ok = true;
const fail = (msg) => {
  ok = false;
  console.log(`FAIL: ${msg}`);
};

try {
  await page.goto(`${url}/?scene=audio`);
  await page.waitForFunction(() => window.__or?.ready === true && window.__orAudio, null, { timeout: 60000 });
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__orAudio.audio.ctx?.state === 'running', null, { timeout: 10000 });
  console.log('audio context running after a click');

  for (const b of await page.locator('button[data-song]').all()) {
    await b.click();
    await page.waitForTimeout(900);
    const name = await b.getAttribute('data-song');
    const cur = await page.evaluate(() => window.__orAudio.audio.currentSong);
    if (cur !== name) fail(`song button ${name}: currentSong is ${cur}`);
  }
  await page.getByRole('button', { name: 'stop' }).click();
  for (const b of await page.locator('button[data-sfx]').all()) {
    await b.click();
    await page.waitForTimeout(350);
  }
  for (const b of await page.locator('button[data-scene]').all()) {
    await b.click();
    await page.waitForTimeout(400);
  }
  // Engines: all four trucks, sweep rpm and skid.
  for (const t of [1, 2, 3]) await page.click(`button[data-truck="${t}"]`);
  await page.click('#engines');
  for (const v of [0.1, 0.5, 0.9, 0.4]) {
    await page.locator('input[data-key=rpm]').fill(String(v));
    await page.locator('input[data-key=skid]').fill(String(v > 0.8 ? 0.8 : 0));
    await page.waitForTimeout(300);
  }
  await page.click('#engines');
  // Volume persists; M toggles mute.
  await page.locator('input[data-vol=music]').fill('0.5');
  const before = await page.evaluate(() => window.__orAudio.audio.settings.muted);
  await page.keyboard.press('m');
  const after = await page.evaluate(() => ({ muted: window.__orAudio.audio.settings.muted, saved: JSON.parse(localStorage.getItem('or.audio')) }));
  if (after.muted === before) fail('M did not toggle mute');
  if (after.saved?.music !== 0.5 || after.saved?.muted !== after.muted) fail(`or.audio not saved: ${JSON.stringify(after.saved)}`);
  await page.keyboard.press('m');
  console.log(`settings saved: ${JSON.stringify(after.saved)}`);

  const { songs, sfx } = await page.evaluate(() => ({ songs: window.__orAudio.songs, sfx: window.__orAudio.sfx }));
  for (const name of songs) {
    const r = await page.evaluate((n) => window.__orAudio.renderSong(n, 4), name);
    console.log(`song  ${name.padEnd(10)} rms ${r.rms.toFixed(4)} peak ${r.peak.toFixed(3)}`);
    if (!(r.rms > 0.01)) fail(`song ${name} is (nearly) silent: rms ${r.rms}`);
    if (!(r.peak < 1)) fail(`song ${name} clips: peak ${r.peak}`);
  }
  for (const name of sfx) {
    const r = await page.evaluate((n) => window.__orAudio.renderSfx(n, 3.5, { strength: 1 }), name);
    console.log(`sfx   ${name.padEnd(10)} rms ${r.rms.toFixed(4)} peak ${r.peak.toFixed(3)}`);
    if (!(r.rms > 0.002)) fail(`sfx ${name} is (nearly) silent: rms ${r.rms}`);
    if (!(r.peak < 1)) fail(`sfx ${name} clips: peak ${r.peak}`);
  }
} catch (e) {
  fail(e.message);
}
for (const e of errors) fail(`page error: ${e}`);
await browser.close();
await server?.close();
console.log(ok ? 'audio-check OK' : 'audio-check FAILED');
process.exit(ok ? 0 : 1);
