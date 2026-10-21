// OR3 season check: the whole flow through window.__or.flow on SwiftShader.
//   title → hints → sign-up (default initials, red) → get ready → 3 races on autopilot (results, cash, credits) with
//   the shop between them (buy tires, check the truck's grip multiplier changed, start the next race and check its
//   track and direction against the rotation rule); reload → "Continue season" → the shop with the same cash;
//   then forced finishes for the credit rules: out of credits → CONTINUE? → continue (cash $0, upgrades kept),
//   FREE RACE!, and out of credits again → countdown runs out → GAME OVER → title, save cleared.
//   node scripts/season-check.mjs [url]             (npm run dev first)
// Screenshots: test-results/season-*.png
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const url = (process.argv[2] ?? process.env.GAME_URL ?? 'http://localhost:5199').replace(/\/$/, '');
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
const check = (cond, msg) => (cond ? console.log(`ok   ${msg}`) : fail(msg));

/** The rotation rule, written out independently of the game's code (research: cycles of 2, 3, …, n tracks). */
function expectedRace(n, race) {
  let c = 1;
  let r = race;
  for (;;) {
    const len = Math.min(n, c + 1);
    if (r < len) break;
    r -= len;
    c++;
  }
  const t = r + 1;
  const first = t <= 2 ? 1 : t - 1;
  return { index: r, reversed: (c - first) % 2 === 1 };
}

const st = () => page.evaluate(() => window.__or.flow.state());
const press = (...keys) => page.evaluate((ks) => ks.forEach((k) => window.__or.flow.press(k)), keys);
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/season-${name}.png` });
};
const waitScreen = (name, timeout = 60000) => page.waitForFunction((n) => window.__or.flow.state().screen === n, name, { timeout });
const text = () => page.evaluate(() => window.__or.flow.text());

/** Navigate the shop cursor to an item (layout: nitro accel / tires top / shocks start). */
const TILE = { nitro: 0, accel: 1, tires: 2, top: 3, shocks: 4, start: 5 };
async function shopGo(item) {
  const cur = await page.evaluate(() => window.__or.flow.state().shopCursor);
  const from = TILE[cur];
  const to = TILE[item];
  const keys = [];
  for (let r = Math.floor(from / 2); r !== Math.floor(to / 2); r = (r + 1) % 3) keys.push('down');
  if (from % 2 !== to % 2) keys.push('right');
  await press(...keys);
  const now = await page.evaluate(() => window.__or.flow.state().shopCursor);
  if (now !== item) fail(`shop cursor on ${now}, wanted ${item}`);
}

/** In the race screen: check the track against the rotation and the player's mods against the levels. */
async function checkRace(raceIdx, order) {
  await waitScreen('race');
  const s = await st();
  const exp = expectedRace(order.length, raceIdx);
  const game = await page.evaluate((i) => window.__or.flow.raceFor(i), raceIdx);
  const wantId = order[exp.index];
  const rev = exp.reversed && game.reversed; // a track without a reversed variant is driven forwards
  check(s.track.id === `${wantId}${rev ? '-r' : ''}`, `race ${raceIdx + 1}: ${s.track.id} (rotation wants ${wantId}${exp.reversed ? ' reversed' : ''})`);
  if (exp.reversed && !game.reversed) console.log(`note ${wantId} has no reversed variant`);
  const mods = await page.evaluate(() => window.__or.mods()[0]);
  const lv = s.player.levels;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  check(near(mods.grip, 1 + 0.09 * lv.tires) && near(mods.engine, 1 + 0.07 * lv.accel) && near(mods.topSpeed, 1 + 0.035 * lv.top) && near(mods.damping, 1 + 0.12 * lv.shocks), `race ${raceIdx + 1}: player truck mods follow the levels ${JSON.stringify(lv)} (grip ${mods.grip.toFixed(2)})`);
  return s;
}

/** Drive the race on autopilot to the results; check the money and the credit rule. */
async function autopilotRace(raceIdx, before) {
  await page.evaluate(() => window.__or.autopilot(true));
  let s;
  for (let k = 0; k < 80; k++) {
    s = await page.evaluate(() => (window.__or.advance(5), { flow: window.__or.flow.state(), race: window.__or.raceState() }));
    if (s.flow.screen === 'results') break;
  }
  if (s.flow.screen !== 'results') return fail(`race ${raceIdx + 1}: no results`);
  const res = s.race.results;
  const me = res.find((r) => r.slot === 0);
  const cpuAhead = res.some((r) => r.slot !== 0 && r.place < me.place);
  const p = s.flow.player;
  console.log(`race ${raceIdx + 1}: places ${res.map((r) => `${s.race.trucks[r.slot].colour}:${r.place}`).join(' ')}, won $${me.prize + me.bags}`);
  check(p.cash === before.cash + me.prize + me.bags, `race ${raceIdx + 1}: cash ${before.cash} + ${me.prize} + bags ${me.bags} = ${p.cash}`);
  check(p.credits === (cpuAhead ? Math.max(0, before.credits - 1) : before.credits), `race ${raceIdx + 1}: credits ${before.credits} → ${p.credits} (${cpuAhead ? 'beaten by a CPU' : 'FREE RACE'})`);
  const t = await text();
  check(cpuAhead ? /CREDIT LOST|NO CREDITS LEFT/.test(t) : /FREE RACE!/.test(t), `race ${raceIdx + 1}: results say ${cpuAhead ? 'CREDIT LOST' : 'FREE RACE!'}`);
  check(s.flow.race === raceIdx + 1, `season moved on to race ${s.flow.race + 1}`);
  return s.flow;
}

/** From the results: on to the shop (taking a continue if the credits ran out). */
async function toShop() {
  await press('confirm');
  let s = await st();
  if (s.screen === 'continue') {
    console.log('out of credits: taking the continue');
    await press('confirm');
    s = await st();
    check(s.player.cash === 0 && s.player.credits === 3, 'continue: cash $0, 3 credits');
  }
  check(s.screen === 'shop', `on to the shop (${s.screen})`);
  return s;
}

/** A race ended by force (credit rules): order = slots, winner first. */
async function forcedRace(order) {
  await shopGo('start');
  await press('confirm');
  await waitScreen('race');
  await page.evaluate((o) => (window.__or.flow.forceFinish(o), window.__or.advance(0.1)), order);
  await waitScreen('results', 5000);
  return st();
}

try {
  await page.goto(`${url}/?scene=title`);
  await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
  await page.evaluate(() => localStorage.removeItem('or.season'));
  await page.reload();
  await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
  const order = await page.evaluate(() => window.__or.flow.order());
  console.log(`track order: ${order.join(', ')}`);
  let s = await st();
  check(s.screen === 'title', 'boots to the title');
  await page.waitForFunction(() => !!window.__or.session, null, { timeout: 30000 });
  check(await page.evaluate(() => window.__or.race?.autopilot === true), 'the title runs a demo race on autopilot');
  await shot('title');

  await press('confirm');
  check((await st()).screen === 'hints', 'NEW SEASON → racing hints');
  await shot('hints');
  await press('confirm');
  check((await st()).screen === 'register', 'hints → sign-up');
  await shot('register');
  // Join (start), three initials, then the colour; READY; start the season.
  await press('confirm', 'confirm', 'confirm', 'confirm');
  await shot('register-colour');
  await press('confirm');
  check((await st()).signup?.[0]?.step === 'ready', 'player 1 ready');
  await press('confirm');
  s = await st();
  check(s.screen === 'getready' && s.player.initials === 'ACE' && s.player.colour === 'red', `signed up as ${s.player?.initials} (${s.player?.colour}), GET READY!`);
  check(s.player.cash === 0 && s.player.credits === 3, 'season starts with $0 and 3 credits');
  await shot('getready');

  for (let i = 0; i < 3; i++) {
    const before = (await checkRace(i, order)).player;
    if (i === 0) {
      await page.evaluate(() => window.__or.advance(25));
      await shot('race');
    }
    await autopilotRace(i, before);
    if (i === 0) await shot('results');
    s = await toShop();
    // Buy tires (40K): the cheapest upgrade, always affordable after a race (4th place pays 70K).
    const lvl = s.player.levels.tires;
    const cash = s.player.cash;
    await shopGo('tires');
    await press('confirm');
    s = await st();
    if (cash >= 40000 && lvl < 5) check(s.player.levels.tires === lvl + 1 && s.player.cash === cash - 40000, `bought TIRES level ${lvl + 1} for 40K (cash ${cash} → ${s.player.cash})`);
    if (i === 0) {
      // A nitro too: +1 for 10K.
      const n = s.player.nitros;
      await shopGo('nitro');
      await press('confirm');
      const s2 = await st();
      check(s2.player.nitros === n + 1 && s2.player.cash === s.player.cash - 10000, `bought 1 NITRO for 10K (${n} → ${s2.player.nitros})`);
      await shot('shop');
    }
    if (i < 2) {
      await shopGo('start');
      const next = (await st()).next;
      await press('confirm');
      check((await st()).screen === 'getready', `START NEXT RACE → get ready (${next.name})`);
    }
  }

  // Persistence: reload, "Continue season" is on the title and lands in the shop with the same money.
  const saved = await st();
  await page.reload();
  await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
  const t = await text();
  check(/CONTINUE SEASON/.test(t), 'title offers CONTINUE SEASON after a reload');
  await press('confirm');
  s = await st();
  check(s.screen === 'shop' && s.player.cash === saved.player.cash && s.race === saved.race && s.player.levels.tires === saved.player.levels.tires, `continue season → shop, race ${s.race + 1}, cash ${s.player.cash}`);

  // Credit rules with forced finishes.
  await page.evaluate(() => window.__or.flow.patchPlayer({ credits: 1 }));
  const levels = s.player.levels;
  s = await forcedRace([1, 2, 3, 0]);
  check(s.player.credits === 0 && /NO CREDITS LEFT/.test(await text()), 'last place with 1 credit: no credits left');
  await press('confirm');
  s = await st();
  check(s.screen === 'continue' && /CONTINUE\?/.test(await text()), 'out of credits → CONTINUE?');
  await page.evaluate(() => window.__or.flow.tick(3));
  check((await st()).screen === 'continue', 'still waiting after 3 s of the countdown');
  await shot('continue');
  await press('confirm');
  s = await st();
  check(s.screen === 'shop' && s.player.cash === 0 && s.player.credits === 3 && JSON.stringify(s.player.levels) === JSON.stringify(levels), 'continued: shop, cash $0, 3 credits, upgrades kept');

  s = await forcedRace([0, 3, 1, 2]);
  check(s.player.credits === 3 && /FREE RACE!/.test(await text()), 'won: FREE RACE!, credits stay 3');
  check(s.player.cash === 100000 + (await page.evaluate(() => window.__or.raceState().results[0].bags)), 'won: $100,000 (+ bags) banked');
  await press('confirm');

  await page.evaluate(() => window.__or.flow.patchPlayer({ credits: 1 }));
  s = await forcedRace([3, 2, 1, 0]);
  await press('confirm');
  check((await st()).screen === 'continue', 'out of credits again → CONTINUE?');
  await page.evaluate(() => window.__or.flow.tick(10.5));
  check((await st()).screen === 'gameover', 'countdown ran out → GAME OVER');
  await shot('gameover');
  check((await page.evaluate(() => localStorage.getItem('or.season'))) === null, 'game over clears the saved season');
  await page.evaluate(() => window.__or.flow.tick(7));
  check((await st()).screen === 'title', 'game over → title');
} catch (e) {
  fail(e.stack ?? e.message);
}
for (const e of errors) fail(`page error: ${e}`);
await browser.close();
console.log(ok ? 'season-check OK' : 'season-check FAILED');
process.exit(ok ? 0 : 1);
