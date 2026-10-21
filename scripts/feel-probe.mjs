// Feel probe (OR1 tuning): runs scripted manoeuvres with window.__or.advance (fixed steps, no rendering wait) and
// prints numbers to compare against the reference footage: 0→top speed, braking, turning, jump air time.
//   node scripts/feel-probe.mjs [url] ['{"engineForce":3300}']     (optional TUNING overrides as JSON)
import { chromium } from '@playwright/test';

const url = (process.argv[2] ?? 'http://localhost:5199').replace(/\/$/, '');
const overrides = JSON.parse(process.argv[3] ?? '{}');
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${url}/?scene=test`);
await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
const out = await page.evaluate((ov) => {
  const or = window.__or;
  or.loop.stop();
  const deep = (t, o) => { for (const [k, v] of Object.entries(o)) typeof v === 'object' ? deep(t[k], v) : (t[k] = v); };
  deep(or.tuning, ov);
  const r = (x) => Math.round(x * 100) / 100;
  const res = {};
  // Straight-line acceleration along the bottom straight (from rest), sampled every 0.5 s.
  or.place(-50, 23, Math.PI / 2); or.setInput({}); or.advance(1);
  or.setInput({ throttle: 1 });
  const acc = [];
  for (let i = 0; i < 8; i++) { or.advance(0.5); acc.push(r(or.truck().speed)); }
  res.accel = acc;
  // Braking from that speed to a stop.
  or.setInput({ brake: 1 });
  let t = 0; while (or.truck().speed > 0.5 && t < 6) { or.advance(1 / 60); t += 1 / 60; }
  res.brakeToStop = r(t);
  // Turning at speed: 12 m/s heading west near the outer wall on the top straight, full left lock (towards the
  // infield) for 0.6 s: degrees turned, speed kept, sideways slide.
  or.place(30, -29, -Math.PI / 2); or.setInput({}); or.advance(0.8);
  or.session.truck.body.setLinvel({ x: -12, y: 0, z: 0 }, true);
  or.setInput({ throttle: 0.6, steer: -1 });
  const h0 = or.truck().heading; or.advance(0.6);
  const s1 = or.truck();
  res.turn = { degrees: r(((s1.heading - h0) * 180) / Math.PI), speed: r(s1.speed), slideMps: r(Math.sqrt(Math.max(0, s1.speedAbs ** 2 - s1.speed ** 2))) };
  // Jump: from the grid, full throttle at the ramp.
  or.place(-24, 23, Math.PI / 2); or.setInput({}); or.advance(0.8);
  or.setInput({ throttle: 1 });
  let air = 0, best = 0, minUp = 1, maxY = 0;
  for (let i = 0; i < 300; i++) { or.advance(1 / 60); const s = or.truck(); best = Math.max(best, s.airTime); minUp = Math.min(minUp, s.up.y); maxY = Math.max(maxY, s.pos.y); air = s.airTime; }
  res.jump = { air: r(best), peakY: r(maxY), minUp: r(minUp), end: or.truck().pos };
  // Whoops: drive north over the right-hand bumps.
  or.place(46, 14, Math.PI); or.setInput({}); or.advance(0.8); or.setInput({ throttle: 1 });
  let wUp = 1, wAir = 0;
  for (let i = 0; i < 240; i++) { or.advance(1 / 60); const s = or.truck(); wUp = Math.min(wUp, s.up.y); wAir = Math.max(wAir, s.airTime); }
  res.whoops = { minUp: r(wUp), maxAir: r(wAir), endZ: r(or.truck().pos.z), resets: or.truck().resets };
  // Water: through the dip on the top straight heading west.
  or.place(16, -23, -Math.PI / 2); or.setInput({}); or.advance(0.8); or.setInput({ throttle: 1 });
  let minWater = 99;
  for (let i = 0; i < 240; i++) { or.advance(1 / 60); const s = or.truck(); if (s.inWater) minWater = Math.min(minWater, s.speed); }
  res.water = { minSpeedInWater: r(minWater), endX: r(or.truck().pos.x) };
  return res;
}, overrides);
console.log(JSON.stringify(out, null, 1));
await browser.close();
