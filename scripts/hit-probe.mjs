// Where do trucks hit walls and get rescued? A full 4-truck race on autopilot (fixed steps); prints wall impacts
// and rescues by spot (5 m cells), lap times and resets per truck. For tuning a track's layout (OR3).
//   node scripts/hit-probe.mjs [url] [track] [--reverse] [--alone]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = (args[0] ?? 'http://localhost:5199').replace(/\/$/, '');
const track = args[1] ?? 'rattlesnake';
const rev = process.argv.includes('--reverse');
const alone = process.argv.includes('--alone');
const trace = process.argv.includes('--trace');
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${url}/?scene=race&autopilot&track=${track}${rev ? '&reverse' : ''}${alone ? '&cpus=0' : ''}`);
await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
const out = await page.evaluate((trace) => {
  const or = window.__or;
  or.loop.stop();
  const cell = (x, z) => `${Math.round(x / 5) * 5},${Math.round(z / 5) * 5}`;
  const hits = {};
  or.events.on('impact', (e) => {
    if (e.with !== 'wall' || e.strength < 0.2) return;
    const k = cell(e.x, e.z);
    hits[k] = (hits[k] ?? 0) + 1;
  });
  const rescues = [];
  const race = or.race;
  const orig = race.rescue.bind(race);
  race.rescue = (slot) => {
    const p = or.session.racers[slot].truck.body.translation();
    rescues.push(`${['r', 'y', 'b', 'g'][slot]}@${cell(p.x, p.z)} t${race.clock.toFixed(0)}`);
    orig(slot);
  };
  const log = [];
  for (let i = 0; i < 60 * 300; i++) {
    or.advance(1 / 60);
    if (or.raceState().phase === 'results') break;
    if (trace && i % 60 === 0 && i < 60 * 60) {
      const t = or.trucks()[0];
      const r = or.raceState().trucks[0];
      log.push(`t${race.clock.toFixed(0)} (${t.pos.x.toFixed(1)},${t.pos.y.toFixed(1)},${t.pos.z.toFixed(1)}) v${t.speedAbs.toFixed(1)} L${r.lap}g${r.nextGate}`);
    }
  }
  const r = or.raceState();
  return {
    trucks: r.trucks.map((t) => `${t.colour[0]} P${t.place} ${t.finishTime?.toFixed(1) ?? 'DNF'} [${t.lapTimes.map((x) => x.toFixed(1)).join(' ')}] resets ${t.resets}`),
    hits: Object.entries(hits).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join('  '),
    rescues,
    log,
  };
}, trace);
if (out.log.length) console.log(out.log.join('\n'));
console.log(`${track}${rev ? '-r' : ''}`);
for (const t of out.trucks) console.log('  ' + t);
console.log('  wall hits: ' + out.hits);
console.log('  rescues: ' + (out.rescues.join(', ') || 'none'));
await browser.close();
