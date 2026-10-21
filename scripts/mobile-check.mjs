// Mobile check: the game on phones and tablets, driven by touch alone (Playwright device emulation, SwiftShader).
//   node scripts/mobile-check.mjs [url] [--device=iphone|pixel|ipad]   (npm run dev first; default http://localhost:5199)
// Per device (iPhone 13 landscape 844×390, Pixel 7 landscape, iPad 1180×820): touch mode on boot, the title by taps
// (DOS look chip on and off, NEW SEASON), the hints (NEXT), the sign-up (tap a truck to join, the letter picker's
// ▲ / ▼ to BOB, OK, ▶ for the next colour, READY, START), the race with the on-screen controls (they show, the camera
// keeps the track clear of them, the HUD panel isn't under a control): steer + gas held with two fingers (the truck
// moves and turns right), a third finger on NITRO (a nitro fires), all fingers up (idle); the II pause menu
// (RESUME); a key press hides the controls and a touch brings them back; autopilot to the finish; a tap on the
// results → the Speed Shop; tap-buy NITRO and TIRES; START NEXT RACE → race 2; portrait → the rotate card and the
// race pauses. Also the render quality (auto: low on the phones, high on the tablet), the manifest and icons.
// Screenshots: test-results/mobile-<device>-<step>.png
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';

const args = process.argv.slice(2);
const url = (args.find((a) => !a.startsWith('--')) ?? process.env.GAME_URL ?? 'http://localhost:5199').replace(/\/$/, '');
const only = args.find((a) => a.startsWith('--device='))?.slice(9);
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
fs.mkdirSync('test-results', { recursive: true });

const pixel = devices['Pixel 7 landscape'];
const iphone = devices['iPhone 13 landscape'];
const DEVICES = {
  // The iPhone 13's landscape screen (844×390); Playwright's preset is the Safari viewport with its bars.
  iphone: { userAgent: iphone.userAgent, viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, quality: 'low' },
  pixel: { userAgent: pixel.userAgent, viewport: pixel.viewport, screen: pixel.screen ?? pixel.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, quality: 'low' },
  // iPad Air / Pro 11" landscape; Chromium's mobile emulation, scale 1 to keep SwiftShader quick.
  ipad: { userAgent: devices['iPad Pro 11 landscape'].userAgent, viewport: { width: 1180, height: 820 }, screen: { width: 1180, height: 820 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, quality: 'high' },
};

let ok = true;
const fail = (msg) => {
  ok = false;
  console.log(`FAIL: ${msg}`);
};
const check = (cond, msg) => (cond ? console.log(`ok   ${msg}`) : fail(msg));

const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function run(name, dev) {
  console.log(`\n== ${name} ${dev.viewport.width}x${dev.viewport.height}`);
  const { quality, ...opts } = dev;
  const context = await browser.newContext(opts);
  // Record vibrations (navigator.vibrate) for the haptics check.
  await context.addInitScript(() => {
    window.__vib = [];
    navigator.vibrate = (p) => (window.__vib.push(p), true);
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const st = () => page.evaluate(() => window.__or.flow.state());
  const shot = async (step) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/mobile-${name}-${step}.png` });
    console.log(`     test-results/mobile-${name}-${step}.png`);
  };
  const waitScreen = (screen, timeout = 60000) => page.waitForFunction((n) => window.__or.flow.state().screen === n, screen, { timeout });
  /** The centre of the first visible element matching `sel` (throws when none). */
  const centre = async (sel) => {
    const box = await page.evaluate((s) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }, sel);
    if (!box) throw new Error(`nothing visible matches ${sel}`);
    return box;
  };
  /** The flow reads taps once per frame: wait until two frames went by (SwiftShader frames are slow). */
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const tap = async (sel) => {
    const c = await centre(sel);
    await page.touchscreen.tap(c.x, c.y);
    await frames();
  };
  const touches = (points) => cdp.send('Input.dispatchTouchEvent', { type: points.length ? 'touchStart' : 'touchEnd', touchPoints: points.map((p) => ({ radiusX: 8, radiusY: 8, force: 1, ...p })) });
  const touchMove = (points) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points.map((p) => ({ radiusX: 8, radiusY: 8, force: 1, ...p })) });

  try {
    await page.goto(`${url}/?scene=title`);
    await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
    await page.evaluate(() => localStorage.removeItem('or.season'));
    await page.reload();
    await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
    await page.waitForFunction(() => !!window.__or.session, null, { timeout: 30000 });

    // Presentation: touch mode, meta tags, manifest, icons, quality.
    const meta = await page.evaluate(async () => {
      const m = await fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json());
      const icons = await Promise.all(m.icons.map((i) => fetch(new URL(i.src, document.baseURI)).then((r) => r.ok)));
      return {
        touch: document.body.classList.contains('or-touch'),
        viewport: document.querySelector('meta[name=viewport]').content,
        apple: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content,
        theme: document.querySelector('meta[name=theme-color]')?.content,
        manifest: m.name,
        icons: icons.every(Boolean) && icons.length >= 2,
        quality: window.__or.quality(),
        scrollable: document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1,
      };
    });
    check(meta.touch, 'boots in touch mode (body.or-touch)');
    check(/viewport-fit=cover/.test(meta.viewport) && /user-scalable=no/.test(meta.viewport), `viewport meta: ${meta.viewport}`);
    check(meta.apple === 'yes' && !!meta.theme, 'apple-mobile-web-app-capable + theme-color');
    check(meta.manifest === 'Off Road' && meta.icons, 'manifest with icons that load');
    check(meta.quality.level === quality, `quality ${meta.quality.setting} → ${meta.quality.level} (${meta.quality.reason}), pixel ratio ${meta.quality.profile.pixelRatio}`);
    check(!meta.scrollable, 'the page does not scroll');
    await shot('1-title');

    // The DOS look chip, on and back off (three taps: 256, 16, off).
    await tap('.or-title [data-tap="title:dos"]');
    check((await page.evaluate(() => window.__or.settings().dos)) === true, 'tap DOS LOOK → on');
    await page.waitForTimeout(400);
    await shot('2-title-dos');
    await tap('.or-title [data-tap="title:dos"]');
    await tap('.or-title [data-tap="title:dos"]');
    check((await page.evaluate(() => window.__or.settings().dos)) === false, 'tap DOS LOOK twice more → off');

    await tap('.or-title [data-tap="title:new"]');
    await waitScreen('hints', 5000);
    check(true, 'tap NEW SEASON → racing hints');
    await shot('3-hints');
    await tap('.or-hints .tbtn.go');
    await waitScreen('register', 5000);
    check(true, 'tap NEXT → sign-up');
    await shot('4-signup');

    // Join on the yellow truck, BOB with the letter picker, then the next colour, READY, START.
    await tap('.or-reg .panel.open[data-colour="yellow"]');
    let s = await st();
    check(s.signup?.length === 1 && s.signup[0].src === 'touch' && s.signup[0].colour === 'yellow', `tap the yellow panel → player 1 joins by touch (${JSON.stringify(s.signup)})`);
    await tap('.or-reg [data-tap="up:0"]');
    for (let i = 0; i < 12; i++) await tap('.or-reg [data-tap="up:1"]');
    for (let i = 0; i < 3; i++) await tap('.or-reg [data-tap="down:2"]');
    s = await st();
    check(s.signup[0].initials === 'BOB', `letter picker ▲ / ▼ → ${s.signup[0].initials}`);
    await shot('5-initials');
    await tap('.or-reg [data-tap="ok"]');
    await tap('.or-reg [data-tap="colour:1"]');
    s = await st();
    check(s.signup[0].step === 'colour' && s.signup[0].colour === 'blue', `OK → colour; ▶ → ${s.signup[0].colour}`);
    await shot('6-colour');
    await tap('.or-reg [data-tap="ok"]');
    s = await st();
    check(s.signup[0].step === 'ready', 'READY');
    await shot('7-ready');
    await tap('.or-reg [data-tap="ok"]');
    s = await st();
    check(s.screen === 'getready' && s.player?.initials === 'BOB' && s.player.colour === 'blue', `START → get ready (${s.player?.initials}, ${s.player?.colour})`);
    await waitScreen('race', 60000);

    // The race: wait for the green light (simulated time), then look at the controls.
    await page.evaluate(() => {
      for (let i = 0; i < 40 && window.__or.raceState().phase !== 'racing'; i++) window.__or.advance(0.25);
    });
    await page.waitForTimeout(400);
    const tc = await page.evaluate(() => {
      const t = window.__or.touch();
      const rect = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
      };
      return { ...t, hud: rect('#or-race-hud .box'), pad: rect('.or-tc .pad'), gas: rect('.or-tc .gas'), brake: rect('.or-tc .brake'), nitro: rect('.or-tc .nitro'), pause: rect('#or-pause-button'), phase: window.__or.raceState().phase };
    });
    check(tc.phase === 'racing', 'the race is on');
    check(tc.visible, `touch controls show (camera fit: ${tc.fit})`);
    const minSide = Math.min(tc.pad.h, tc.gas.w, tc.gas.h, tc.brake.w, tc.brake.h, tc.nitro.w, tc.nitro.h);
    check(minSide >= 64, `buttons are thumb-sized (smallest side ${minSide.toFixed(0)} px)`);
    const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    check(![tc.pad, tc.gas, tc.brake, tc.nitro, tc.pause].some((r) => overlap(r, tc.hud)), 'the HUD panel is clear of every control');
    const inView = (r) => r.l >= 0 && r.t >= 0 && r.r <= dev.viewport.width && r.b <= dev.viewport.height;
    check([tc.pad, tc.gas, tc.brake, tc.nitro, tc.pause].every(inView), 'every control is on screen');
    // The track's walls stay out of the control columns / strip: project the wall bounds.
    const track = await page.evaluate(() => {
      const { THREE } = window.__or;
      const cam = window.__or.camera3d();
      const b = window.__or.session.track.bounds;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
        const p = new THREE.Vector3(x, 0, z).project(cam);
        const sx = ((p.x + 1) / 2) * innerWidth, sy = ((1 - p.y) / 2) * innerHeight;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      return { l: x0, r: x1, t: y0, b: y1 };
    });
    const clear = tc.fit === 'sides' ? track.l >= tc.pad.r - 2 && track.r <= tc.gas.l + 2 : track.b <= Math.min(tc.pad.t, tc.brake.t, tc.gas.t, tc.nitro.t) + 2;
    check(clear, `the track keeps clear of the controls (${tc.fit}; track x ${track.l.toFixed(0)}–${track.r.toFixed(0)}, y ${track.t.toFixed(0)}–${track.b.toFixed(0)})`);
    await shot('8-race');

    // Two fingers: steer right (slide on the pad) + gas. The input is live; advance() steps the physics with it.
    const before = await page.evaluate(() => window.__or.truck());
    const padC = { x: (tc.pad.l + tc.pad.r) / 2, y: (tc.pad.t + tc.pad.b) / 2 };
    const gasC = { x: (tc.gas.l + tc.gas.r) / 2, y: (tc.gas.t + tc.gas.b) / 2 };
    const nitroC = { x: (tc.nitro.l + tc.nitro.r) / 2, y: (tc.nitro.t + tc.nitro.b) / 2 };
    // Gas alone first (the truck pulls away), then a second finger slides right on the steer pad.
    await touches([{ id: 1, ...gasC }]);
    await page.waitForTimeout(120);
    const r0 = await page.evaluate(() => {
      window.__or.advance(1.5);
      return window.__or.truck();
    });
    const moved = Math.hypot(r0.pos.x - before.pos.x, r0.pos.z - before.pos.z);
    check(moved > 8, `the truck drove ${moved.toFixed(1)} m in 1.5 s on touch gas`);
    // Then, set down in open space on the racing line (away from the CPU trucks and their bumps), gas + a second
    // finger sliding right on the steer pad: a right turn.
    await touches([]);
    const r0b = await page.evaluate(() => {
      const pts = window.__or.line().points;
      const others = window.__or.trucks().slice(1).map((t) => t.pos);
      let best = 0, bestD = -1;
      pts.forEach(([x, z], i) => {
        const d = Math.min(...others.map((o) => Math.hypot(o.x - x, o.z - z)));
        if (d > bestD) { bestD = d; best = i; }
      });
      const [x, z] = pts[best];
      const [nx, nz] = pts[(best + 2) % pts.length];
      window.__or.place(x, z, Math.atan2(nx - x, nz - z));
      window.__or.advance(0.4);
      return window.__or.truck();
    });
    await touches([{ id: 1, ...gasC }, { id: 2, ...padC }]);
    await touchMove([{ id: 1, ...gasC }, { id: 2, x: padC.x + tc.pad.w * 0.45, y: padC.y }]);
    await page.waitForTimeout(150);
    let input = (await page.evaluate(() => window.__or.touch())).input;
    check(input.throttle === 1 && input.steer > 0.8 && !input.nitro, `gas + steer held: ${JSON.stringify(input)}`);
    await shot('9-steer-gas');
    const r1 = await page.evaluate(() => {
      window.__or.advance(1);
      return window.__or.truck();
    });
    let turn = r1.heading - r0b.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    // A right turn makes the heading fall (drive-check.mjs).
    check(turn < -0.4, `the truck turned right (${turn.toFixed(2)} rad in 1 s) with the steer pad`);
    // Third finger: nitro (also gas).
    const n0 = (await page.evaluate(() => window.__or.truck())).nitros;
    await touches([{ id: 1, ...gasC }, { id: 2, x: padC.x + tc.pad.w * 0.45, y: padC.y }, { id: 3, ...nitroC }]);
    await page.waitForTimeout(150);
    input = (await page.evaluate(() => window.__or.touch())).input;
    await page.evaluate(() => window.__or.advance(0.3));
    const n1 = (await page.evaluate(() => window.__or.truck())).nitros;
    check(input.nitro && input.throttle === 1 && input.steer > 0.8 && n1 === n0 - 1, `three fingers: steer + gas + nitro (${JSON.stringify(input)}; nitros ${n0} → ${n1})`);
    const vib = await page.evaluate(() => window.__vib);
    check(vib.length > 0, `haptics: the nitro buzzed (navigator.vibrate ${JSON.stringify(vib)})`);
    await shot('10-nitro');
    await touches([]);
    await page.waitForTimeout(150);
    input = (await page.evaluate(() => window.__or.touch())).input;
    check(!input.throttle && !input.steer && !input.nitro && !input.brake, 'all fingers up → idle');
    // Brake / reverse.
    const brakeC = { x: (tc.brake.l + tc.brake.r) / 2, y: (tc.brake.t + tc.brake.b) / 2 };
    await touches([{ id: 4, ...brakeC }]);
    await page.waitForTimeout(120);
    input = (await page.evaluate(() => window.__or.touch())).input;
    await touches([]);
    check(input.brake === 1 && input.throttle === 0, 'BRAKE / REVERSE');

    // Pause and resume.
    await tap('#or-pause-button');
    check((await page.evaluate(() => window.__or.touch().paused)) === true, 'II → paused');
    const c0 = await page.evaluate(() => window.__or.raceState().clock);
    await page.waitForTimeout(700);
    check((await page.evaluate(() => window.__or.raceState().clock)) === c0, 'the race clock stops');
    await shot('11-pause');
    await tap('.or-pause [data-tap="pause:resume"]');
    check((await page.evaluate(() => window.__or.touch().paused)) === false, 'RESUME');

    // A key hides the touch UI; a touch brings it back.
    await page.keyboard.press('ArrowLeft');
    await frames();
    check((await page.evaluate(() => window.__or.touch().visible)) === false, 'a key press hides the touch controls');
    await page.touchscreen.tap(dev.viewport.width / 2, dev.viewport.height / 2);
    await frames();
    check((await page.evaluate(() => window.__or.touch().visible)) === true, 'a touch shows them again');

    // Autopilot to the finish.
    await page.evaluate(() => window.__or.autopilot(true));
    await page.evaluate(() => {
      for (let i = 0; i < 160 && !window.__or.resultsVisible(); i++) window.__or.advance(1);
    });
    await waitScreen('results', 20000);
    await page.waitForTimeout(1200);
    check((await page.evaluate(() => window.__or.touch().visible)) === false, 'results: the controls are gone');
    await shot('12-results');
    await page.touchscreen.tap(dev.viewport.width / 2, dev.viewport.height * 0.3);
    await waitScreen('shop', 5000);
    check(true, 'tap the results → Speed Shop');
    s = await st();
    const cash0 = s.player.cash;
    const nit0 = s.player.nitros;
    await shot('13-shop');
    await tap('.or-shop .tile[data-tap="shop:nitro"]');
    s = await st();
    check(s.player.nitros === nit0 + 1 && s.player.cash === cash0 - 10000, `tap NITRO → ${s.player.nitros} nitros, cash ${s.player.cash}`);
    await tap('.or-shop .tile[data-tap="shop:tires"]');
    s = await st();
    check(s.player.levels.tires === 1, `tap TIRES → level ${s.player.levels.tires}`);
    await shot('14-shop-bought');
    await tap('.or-shop .tile[data-tap="shop:start"]');
    await waitScreen('race', 60000);
    s = await st();
    check(s.race === 1, `START NEXT RACE → race ${s.race + 1}`);
    await page.waitForTimeout(800);
    await shot('15-race2');

    // Portrait: the rotate card, and the race pauses.
    await page.setViewportSize({ width: dev.viewport.height, height: dev.viewport.width });
    await page.waitForTimeout(300);
    await frames();
    const rot = await page.evaluate(() => ({ card: getComputedStyle(document.getElementById('or-rotate')).display, paused: window.__or.touch().paused }));
    check(rot.card === 'flex' && rot.paused, `portrait → rotate card (${rot.card}), race paused (${rot.paused})`);
    await shot('16-portrait');
    await page.setViewportSize(dev.viewport);
    await page.waitForTimeout(300);
    await frames();
    check((await page.evaluate(() => getComputedStyle(document.getElementById('or-rotate')).display)) === 'none', 'landscape again → the card is gone');
    await tap('.or-pause [data-tap="pause:resume"]');
    check((await page.evaluate(() => window.__or.touch().paused)) === false, 'RESUME after rotating back');

    // Auto quality: under 40 fps for 3 s drops to low (SwiftShader is slow enough; the watch is off under webdriver).
    if (quality === 'high') {
      await page.evaluate(() => window.__or.quality({ watchFps: true }));
      await page.waitForFunction(() => window.__or.quality().level === 'low', null, { timeout: 30000 }).catch(() => {});
      const q = await page.evaluate(() => window.__or.quality());
      check(q.level === 'low' && q.profile.pixelRatio === 1, `auto quality drops to low on a slow race (${q.reason})`);
    }
  } catch (e) {
    fail(`${name}: ${e.message}`);
    await page.screenshot({ path: `test-results/mobile-${name}-error.png` }).catch(() => {});
  }
  for (const e of errors) fail(`${name} page error: ${e}`);
  await context.close();
}

for (const [name, dev] of Object.entries(DEVICES)) if (!only || only === name) await run(name, dev);
await browser.close();
console.log(ok ? '\nmobile-check OK' : '\nmobile-check FAILED');
process.exit(ok ? 0 : 1);
