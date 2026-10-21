// OR2 race check: a full 4-lap race on a track with the player's truck on autopilot (the same AI as the CPU trucks),
// stepped with window.__or.advance (fixed 60 Hz steps, so SwiftShader's frame rate doesn't matter). Asserts that all
// four trucks finish, laps were counted through the gates in order, and the results screen shows prize money.
//   node scripts/race-check.mjs [url] [track] [--reverse]         (npm run dev first)
// Writes test-results/race-<track>-mid.png and race-<track>-results.png.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = (args[0] ?? process.env.GAME_URL ?? 'http://localhost:5199').replace(/\/$/, '');
const track = args[1] ?? 'rattlesnake';
const reverse = process.argv.includes('--reverse');
const tag = `${track}${reverse ? '-r' : ''}`;
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
  await page.goto(`${url}/?scene=race&track=${track}${reverse ? '&reverse' : ''}&autopilot`);
  await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
  // Count events on the bus (what the audio lane will hear).
  await page.evaluate(() => {
    const c = (window.__orEvents = {});
    for (const t of ['countdown', 'lap', 'finish', 'impact', 'skid', 'splash', 'nitro', 'land', 'pickup', 'phase']) window.__or.events.on(t, () => (c[t] = (c[t] ?? 0) + 1));
  });
  const state = () => page.evaluate(() => window.__or.raceState());
  let s = await state();
  if (s.phase !== 'ready' && s.phase !== 'countdown') fail(`race did not start in "Get Ready!" (phase ${s.phase})`);
  let shotMid = false;
  // Step in 5 s chunks of simulated time until the results are in (max ~6 minutes simulated).
  for (let k = 0; k < 75 && s.phase !== 'results'; k++) {
    s = await page.evaluate(() => (window.__or.advance(5), window.__or.raceState()));
    const line = s.trucks.map((t) => `${t.colour[0]}:L${t.lap}g${t.nextGate}${t.finished ? `F${t.place}` : ''}`).join(' ');
    console.log(`t=${s.clock.toFixed(1).padStart(5)} ${s.phase.padEnd(9)} ${line}  pickups ${s.pickups.length}`);
    if (!shotMid && s.clock > 25) {
      shotMid = true;
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/race-${tag}-mid.png` });
    }
  }
  if (s.phase !== 'results') fail(`no results after ${s.clock.toFixed(0)} s of racing`);
  for (const t of s.trucks) {
    const laps = t.lapTimes.map((x) => x.toFixed(1)).join(' / ');
    console.log(`${t.colour.padEnd(6)} place ${t.place} time ${t.finishTime?.toFixed(2) ?? 'DNF'}  laps ${laps}  nitros ${t.nitros} bags $${t.bags} resets ${t.resets}`);
    if (!t.finished) fail(`${t.colour} did not finish`);
    if (t.lap !== s.laps || t.lapTimes.length !== s.laps) fail(`${t.colour} counted ${t.lap} laps (want ${s.laps})`);
    if (t.lapTimes.some((x) => x < 6)) fail(`${t.colour} has an impossibly short lap (a shortcut?): ${laps}`);
  }
  const places = s.trucks.map((t) => t.place).sort().join('');
  if (places !== '1234') fail(`places are not 1..4 (${places})`);
  const ev = await page.evaluate(() => window.__orEvents);
  console.log(`events: ${JSON.stringify(ev)}`);
  if ((ev.countdown ?? 0) < 4) fail('countdown beeps missing');
  if ((ev.finish ?? 0) !== 4) fail('finish events missing');
  // The results screen: prize money on the plates.
  await page.waitForSelector('#or-results', { timeout: 20000 });
  await page.waitForTimeout(600);
  const text = await page.$eval('#or-results', (e) => e.innerText);
  if (!/\$100,000/.test(text) || !/\$70,000/.test(text)) fail(`results screen lacks prize money: ${text.slice(0, 200)}`);
  if (!/Record/.test(text)) fail('results screen lacks the track record');
  const rec = await page.evaluate(() => localStorage.getItem('or.records'));
  const recs = JSON.parse(rec ?? '{}');
  console.log(`records: ${rec}`);
  if (!Object.keys(recs).some((k) => k.startsWith(track))) fail('no track record saved in localStorage or.records');
  await page.screenshot({ path: `test-results/race-${tag}-results.png` });
  console.log(`saved test-results/race-${tag}-mid.png, race-${tag}-results.png`);
  // Back to the start: Enter restarts with "Get Ready!".
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__or.raceState().phase === 'ready' || window.__or.raceState().phase === 'countdown', null, { timeout: 10000 });
  if (await page.evaluate(() => window.__or.resultsVisible())) fail('results screen still up after restart');
} catch (e) {
  fail(e.message);
}
for (const e of errors) fail(`page error: ${e}`);
await browser.close();
console.log(ok ? 'race-check OK' : 'race-check FAILED');
process.exit(ok ? 0 : 1);
