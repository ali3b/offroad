// Lap-time probe (OR1/OR2 feel tuning): the player's truck alone on autopilot for N laps of a race track, fixed
// steps. Prints lap times, average and top speed, air time, wall hits and a speed trace to compare with the
// reference (laps of 14–18 s at a decent line).
//   node scripts/lap-probe.mjs [url] [track] ['{"topSpeed":25}'] [--reverse]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = (args[0] ?? 'http://localhost:5199').replace(/\/$/, '');
const track = args[1] ?? 'rattlesnake';
const overrides = JSON.parse(args[2] ?? '{}');
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${url}/?scene=race&cpus=0&autopilot&track=${track}${process.argv.includes('--reverse') ? '&reverse' : ''}`);
await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
const out = await page.evaluate((ov) => {
  const or = window.__or;
  or.loop.stop();
  const deep = (t, o) => { for (const [k, v] of Object.entries(o)) typeof v === 'object' ? deep(t[k], v) : (t[k] = v); };
  deep(or.tuning, ov);
  const hits = { wall: 0, ground: 0 };
  or.events.on('impact', (e) => (hits[e.with] = (hits[e.with] ?? 0) + 1));
  let sum = 0, n = 0, top = 0, air = 0;
  const trace = [];
  for (let i = 0; i < 60 * 100; i++) {
    or.advance(1 / 60);
    const r = or.raceState();
    if (r.phase !== 'racing') { if (r.phase === 'results') break; continue; }
    const s = or.truck();
    sum += s.speedAbs; n++;
    top = Math.max(top, s.speedAbs);
    air = Math.max(air, s.airTime);
    if (i % 60 === 0) trace.push(Math.round(s.speedAbs));
  }
  const r = or.raceState();
  return { line: Math.round(or.session.track.line.length), laps: r.trucks[0].lapTimes.map((x) => +x.toFixed(2)), finish: r.trucks[0].finishTime, avg: +(sum / n).toFixed(1), top: +top.toFixed(1), air: +air.toFixed(2), hits, resets: r.trucks[0].resets, trace: trace.join(' ') };
}, overrides);
console.log(JSON.stringify(out));
await browser.close();
