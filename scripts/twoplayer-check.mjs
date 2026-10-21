// OR4 local multiplayer check, on SwiftShader:
//   an old v1 one-player save is migrated (CONTINUE SEASON → the shop, v2, whole keyboard);
//   sign-up with real key presses: player 1 joins with W (WASD side), player 2 with Up (arrows side) and types
//   initials; race 1: W drives only player 1's truck, Up only player 2's, setInput(…, 1) drives player 2's; then
//   both on autopilot to the results (each human banks their own prize + bags, credits by the CPU rule);
//   the shop in turn (player 2's keys can't touch player 1's turn and back), separate cash and upgrades, the next
//   race's truck mods per human; forced finishes: a credit lost by one human only; player 2 out of credits →
//   CONTINUE? for player 2 alone → gives up → their colour becomes a CPU truck; player 1 alone → countdown → GAME OVER.
//   node scripts/twoplayer-check.mjs [url]      (npm run dev first)
// Screenshots: test-results/twoplayer-*.png
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

const st = () => page.evaluate(() => window.__or.flow.state());
const press = (...keys) => page.evaluate((ks) => ks.forEach((k) => window.__or.flow.press(k)), keys);
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/twoplayer-${name}.png` });
};
const waitScreen = (name, timeout = 60000) => page.waitForFunction((n) => window.__or.flow.state().screen === n, name, { timeout });
const text = () => page.evaluate(() => window.__or.flow.text());
const boot = async () => page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
/** A real key press, then wait for the menus to have drained it (one rendered frame). */
async function key(...codes) {
  for (const c of codes) {
    await page.keyboard.press(c);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
}

const TILE = { nitro: 0, accel: 1, tires: 2, top: 3, shocks: 4, start: 5 };
/** Shop cursor to an item with test presses (as `player`). */
async function shopGo(item, player) {
  const cur = (await st()).shopCursor;
  const from = TILE[cur];
  const to = TILE[item];
  const keys = [];
  for (let r = Math.floor(from / 2); r !== Math.floor(to / 2); r = (r + 1) % 3) keys.push('down');
  if (from % 2 !== to % 2) keys.push('right');
  await page.evaluate(([ks, p]) => ks.forEach((k) => window.__or.flow.press({ key: k, player: p })), [keys, player]);
  const now = (await st()).shopCursor;
  if (now !== item) fail(`shop cursor on ${now}, wanted ${item}`);
}
/** Every human through the shop to the next race. */
async function shopStartAll() {
  const n = (await st()).players.length;
  for (let p = 0; p < n; p++) {
    await shopGo('start', p);
    await page.evaluate((pl) => window.__or.flow.press({ key: 'confirm', player: pl }), p);
  }
  await waitScreen('race');
}
async function forced(order) {
  await page.evaluate((o) => (window.__or.flow.forceFinish(o), window.__or.advance(0.1)), order);
  await waitScreen('results', 5000);
  return st();
}

try {
  // ---- v1 save migration -------------------------------------------------------------------------------------
  await page.goto(`${url}/?scene=title`);
  await boot();
  const lv0 = { accel: 0, tires: 0, shocks: 0, top: 0 };
  const v1 = {
    v: 1,
    race: 3,
    players: [{ initials: 'OLD', colour: 'yellow', cash: 123000, credits: 2, levels: { ...lv0, tires: 2 }, nitros: 17 }],
    cpus: ['red', 'blue', 'grey'].map((colour) => ({ colour, cash: 0, levels: lv0, nitros: 10 })),
    last: { track: 'coyote', outcomes: [{ free: false, creditLost: true, credits: 2, out: false }], places: [2, 1, 3, 4] },
  };
  await page.evaluate((s) => localStorage.setItem('or.season', JSON.stringify(s)), v1);
  await page.reload();
  await boot();
  check(/CONTINUE SEASON/.test(await text()) && /OLD/.test(await text()), 'a v1 save shows CONTINUE SEASON (OLD)');
  await press('confirm');
  let s = await st();
  const season = await page.evaluate(() => window.__or.flow.season());
  check(s.screen === 'shop' && season.v === 2 && s.players.length === 1 && s.players[0].keys === 'solo' && s.players[0].cash === 123000 && s.players[0].levels.tires === 2, 'v1 save migrated to v2: shop, 1 player, whole keyboard, cash and upgrades kept');

  // ---- sign-up with real keys --------------------------------------------------------------------------------
  await page.evaluate(() => localStorage.removeItem('or.season'));
  await page.reload();
  await boot();
  await press('confirm');
  check((await st()).screen === 'hints', 'NEW SEASON → hints');
  await press('confirm');
  check((await st()).screen === 'register', 'hints → sign-up');
  await key('KeyW');
  s = await st();
  check(s.signup?.length === 1 && s.signup[0].src === 'wasd' && s.signup[0].colour === 'red', `W joins player 1 on the WASD side (${JSON.stringify(s.signup)})`);
  await key('ShiftLeft', 'ShiftLeft', 'ShiftLeft', 'ShiftLeft');
  s = await st();
  check(s.signup[0].step === 'ready' && s.signup[0].initials === 'ACE', 'player 1: initials ACE, colour red, READY (Left Shift)');
  await key('ArrowUp');
  s = await st();
  check(s.signup.length === 2 && s.signup[1].src === 'arrows' && s.signup[1].colour === 'yellow', 'Up joins player 2 on the arrows side (yellow)');
  // D is player 1's (ready: ignored), not a letter for player 2; B O B are typed into player 2's initials.
  await key('KeyD', 'KeyB', 'KeyO', 'KeyB', 'Enter', 'ArrowRight');
  s = await st();
  check(s.signup[1].initials === 'BOB' && s.signup[1].step === 'colour' && s.signup[1].colour === 'blue', `player 2 typed BOB and moved to the free blue panel (${JSON.stringify(s.signup[1])})`);
  check(s.signup[0].colour === 'red' && s.signup[0].step === 'ready', 'player 1 untouched by player 2’s keys');
  await key('Enter');
  await shot('signup');
  s = await st();
  check(s.signup.every((c) => c.step === 'ready') && /ALL SET/.test(await text()), 'both READY: ALL SET! PRESS START TO RACE');
  await key('Enter');
  await waitScreen('getready', 10000);
  s = await st();
  check(s.players.map((p) => `${p.initials}:${p.colour}:${p.keys}`).join(' ') === 'ACE:red:wasd BOB:blue:arrows', `season: ${s.players.map((p) => `${p.initials} ${p.colour} ${p.keys}`).join(', ')}`);
  check(s.cpus.map((c) => c.colour).join() === 'yellow,grey', 'the unjoined yellow and grey race as CPU trucks');
  await shot('getready');

  // ---- race 1: each human drives their own truck --------------------------------------------------------------
  await waitScreen('race');
  const rs = await page.evaluate(() => window.__or.raceState());
  check(rs.trucks.map((t) => `${t.colour}:${t.human}`).join(' ') === 'red:true blue:true yellow:false grey:false', `line-up ${rs.trucks.map((t) => `${t.colour}${t.human ? '(human)' : ''}`).join(' ')}`);
  await page.evaluate(() => window.__or.advance(5.2));
  check((await page.evaluate(() => window.__or.raceState().phase)) === 'racing', 'green light');
  const pos = () => page.evaluate(() => window.__or.trucks().map((t) => t.pos));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  // The trucks' applied inputs while a key is held (distance alone is noisy: the CPU trucks shove the humans).
  const throttles = () => page.evaluate(() => window.__or.session.racers.slice(0, 2).map((r) => r.truck.input.throttle));
  const drive = async (code, secs = 1.5) => {
    const a = await pos();
    await page.keyboard.down(code);
    await page.evaluate((t) => window.__or.advance(t), secs);
    const th = await throttles();
    await page.keyboard.up(code);
    const b = await pos();
    return { th, d: [dist(a[0], b[0]), dist(a[1], b[1])] };
  };
  let dr = await drive('KeyW');
  check(dr.th[0] === 1 && dr.th[1] === 0 && dr.d[0] > 4, `W: player 1's throttle ${dr.th[0]}, player 2's ${dr.th[1]} (player 1 drove ${dr.d[0].toFixed(1)} m)`);
  dr = await drive('ArrowUp');
  check(dr.th[0] === 0 && dr.th[1] === 1 && dr.d[1] > 4, `Up: player 2's throttle ${dr.th[1]}, player 1's ${dr.th[0]} (player 2 drove ${dr.d[1].toFixed(1)} m)`);
  await page.keyboard.down('KeyD');
  await page.keyboard.down('ArrowLeft');
  await page.evaluate(() => window.__or.advance(0.2));
  const steer = await page.evaluate(() => window.__or.session.racers.slice(0, 2).map((r) => r.truck.input.steer));
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ArrowLeft');
  check(steer[0] === 1 && steer[1] === -1, `D steers player 1 right, Left steers player 2 left (${steer.join(', ')})`);
  const flags = await page.evaluate(() => {
    const seen = {};
    const off = window.__or.events.on('engine', (e) => (seen[e.truck] = e.player));
    window.__or.session.render();
    off();
    return seen;
  });
  check(flags[0] === true && flags[1] === true && flags[2] === false && flags[3] === false, `engine events: both humans at player level ${JSON.stringify(flags)}`);
  {
    const a = await pos();
    const th = await page.evaluate(() => {
      window.__or.setInput({ throttle: 1 }, 1);
      window.__or.advance(1.5);
      const t = window.__or.session.racers.slice(0, 2).map((r) => r.truck.input.throttle);
      window.__or.setInput(null, 1);
      return t;
    });
    const b = await pos();
    check(th[0] === 0 && th[1] === 1 && dist(a[1], b[1]) > 4, `setInput(…, 1) drives player 2's truck only (${dist(a[1], b[1]).toFixed(1)} m)`);
  }
  await page.evaluate(() => window.__or.advance(4));
  await shot('race');
  await page.evaluate(() => window.__or.autopilot(true));
  let r;
  for (let k = 0; k < 90; k++) {
    r = await page.evaluate(() => (window.__or.advance(5), { flow: window.__or.flow.state(), race: window.__or.raceState() }));
    if (r.flow.screen === 'results') break;
  }
  if (r.flow.screen !== 'results') throw new Error('race 1: no results');
  const res = r.race.results;
  console.log(`race 1: places ${res.map((x) => `${r.race.trucks[x.slot].colour}:${x.place}`).join(' ')}`);
  for (const h of [0, 1]) {
    const me = res.find((x) => x.slot === h);
    const cpuAhead = res.some((x) => x.slot >= 2 && x.place < me.place);
    const p = r.flow.players[h];
    check(p.cash === me.prize + me.bags, `race 1: ${p.initials} banked ${me.prize} + bags ${me.bags} = ${p.cash}`);
    check(p.credits === (cpuAhead ? 2 : 3), `race 1: ${p.initials} credits ${p.credits} (${cpuAhead ? 'beaten by a CPU' : 'FREE RACE'})`);
  }
  const rt = await text();
  check(/ACE/.test(rt) && /BOB/.test(rt) && (rt.match(/Credits/g) ?? []).length >= 2, 'results show a summary per human');
  await shot('results');

  // ---- the shop, in turn --------------------------------------------------------------------------------------
  await press('confirm');
  s = await st();
  if (s.screen === 'continue') {
    await press('confirm', 'confirm');
    s = await st();
  }
  check(s.screen === 'shop' && s.shopTurn === 0, 'player 1 shops first');
  const cash0 = s.players.map((p) => p.cash);
  await key('ArrowDown');
  check((await st()).shopCursor === 'nitro', "player 2's arrows don't move player 1's cursor");
  await key('KeyS', 'ShiftLeft');
  s = await st();
  check(s.shopCursor === 'tires' && s.players[0].levels.tires === 1 && s.players[0].cash === cash0[0] - 40000 && s.players[1].cash === cash0[1] && s.players[1].levels.tires === 0, 'player 1 bought TIRES with their own cash (S, Left Shift)');
  await shot('shop-p1');
  await key('KeyS', 'KeyD', 'ShiftLeft');
  s = await st();
  check(s.screen === 'shop' && s.shopTurn === 1 && s.shopCursor === 'nitro', "START NEXT RACE passes the shop to player 2");
  await key('KeyS');
  check((await st()).shopCursor === 'nitro', "player 1's keys don't move player 2's cursor");
  await key('ArrowDown', 'ArrowDown', 'Enter');
  s = await st();
  check(s.players[1].levels.shocks === 1 && s.players[1].cash === cash0[1] - 60000 && s.players[0].levels.shocks === 0 && s.players[0].cash === cash0[0] - 40000, 'player 2 bought SHOCKS with their own cash');
  await shot('shop-p2');
  await key('ArrowRight', 'Enter');
  await waitScreen('getready', 10000);
  await waitScreen('race');
  const mods = await page.evaluate(() => window.__or.mods());
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  check(near(mods[0].grip, 1.09) && near(mods[0].damping, 1) && near(mods[1].grip, 1) && near(mods[1].damping, 1.12), `race 2 truck mods per human: P1 grip ${mods[0].grip.toFixed(2)}, P2 damping ${mods[1].damping.toFixed(2)}`);

  // ---- credits per human ------------------------------------------------------------------------------------------
  const before = (await st()).players.map((p) => p.credits);
  s = await forced([0, 2, 1, 3]);
  check(s.players[0].credits === before[0] && s.players[1].credits === before[1] - 1, `ACE 1st (FREE RACE), BOB behind a CPU (credit lost): ${before.join('/')} → ${s.players.map((p) => p.credits).join('/')}`);
  check(s.last.outcomes[0].free && s.last.outcomes[1].creditLost, 'outcomes: FREE RACE / CREDIT LOST');
  await press('confirm');
  await shopStartAll();
  const b2 = (await st()).players.map((p) => p.credits);
  s = await forced([1, 0, 2, 3]);
  check(s.players[0].credits === b2[0] && s.players[1].credits === b2[1], 'beaten only by the other human: no credit lost');
  await press('confirm');
  await shopStartAll();

  // ---- player 2 out of credits: CONTINUE? for them alone, then drops to CPU ---------------------------------------
  await page.evaluate(() => window.__or.flow.patchPlayer({ credits: 1 }, 1));
  const p2levels = (await st()).players[1].levels;
  s = await forced([0, 2, 3, 1]);
  check(s.players[1].credits === 0 && s.players[0].credits > 0, 'BOB out of credits, ACE not');
  await press('confirm');
  s = await st();
  check(s.screen === 'continue' && Object.keys(s.continue.left).join() === '1', 'CONTINUE? countdown for player 2 only');
  await page.evaluate(() => window.__or.flow.tick(2));
  await shot('continue');
  await page.evaluate(() => window.__or.flow.press({ key: 'back', player: 1 }));
  s = await st();
  check(s.screen === 'shop' && s.players.length === 1 && s.players[0].initials === 'ACE' && s.players[0].keys === 'solo', 'player 2 gave up: ACE shops alone with the whole keyboard');
  const blue = s.cpus.find((c) => c.colour === 'blue');
  check(!!blue && JSON.stringify(blue.levels) === JSON.stringify(p2levels), "blue races on as a CPU truck with player 2's upgrades");
  await shopStartAll();
  const rs2 = await page.evaluate(() => window.__or.raceState());
  check(rs2.trucks.filter((t) => t.human).length === 1 && rs2.trucks.map((t) => t.colour).join() === 'red,yellow,blue,grey', `next race: 1 human, ${rs2.trucks.map((t) => `${t.colour}${t.human ? '(human)' : ''}`).join(' ')}`);

  // ---- the last human out → GAME OVER ------------------------------------------------------------------------------
  await page.evaluate(() => window.__or.flow.patchPlayer({ credits: 1 }));
  await forced([3, 2, 1, 0]);
  await press('confirm');
  check((await st()).screen === 'continue', 'ACE out of credits → CONTINUE?');
  await page.evaluate(() => window.__or.flow.tick(10.5));
  check((await st()).screen === 'gameover', 'countdown ran out → GAME OVER');
  check((await page.evaluate(() => localStorage.getItem('or.season'))) === null, 'save cleared');
} catch (e) {
  fail(e.stack ?? e.message);
}
for (const e of errors) fail(`page error: ${e}`);
await browser.close();
console.log(ok ? 'twoplayer-check OK' : 'twoplayer-check FAILED');
process.exit(ok ? 0 : 1);
