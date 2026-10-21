// The release trailer: real-time takes of the game WITH its sound, cut into a ~115 s trailer, a ~25 s short and a
// README GIF.
//   node scripts/trailer.mjs [url]              record every take, then cut (the dev server must be running)
//   node scripts/trailer.mjs [url] --cut-only   re-cut from the takes already in test-results/video/takes
//   node scripts/trailer.mjs [url] --take=main  re-record one take (main | buzzard | thunder | twister | drycreek | dos | mobile);
//                                               then --cut-only.  --keep-raw keeps Playwright's raw webm files.
// Output: test-results/video/offroad-trailer.mp4, offroad-short.mp4, offroad.gif (git-ignored; Pages carries them).
//
// Each take is one browser context with Playwright's video, on the GPU through EGL like Sidefighter's recorder
// (headless EGL lands on the GTX 1060 here: run nothing else heavy on the GPU meanwhile; SwiftShader is the fallback,
// said out loud). Playwright's video has no sound, so the page
// records the game's own mix: window.__or.audio.captureStream() (the master after the limiter) into a MediaRecorder
// (webm/opus), handed back as base64. Sync: the page flashes a full-screen magenta frame when the audio recorder
// starts and again at the end; the flashes are found in the raw video, which maps the video's (slow) clock onto
// wall time, and the audio is placed by its recorder's start time against the first flash, less the output latency
// measured from the countdown beeps (about 75 ms). Game events (countdown,
// jumps, nitros, splashes, bumps, screens) are logged on the same wall clock, and the cut list picks its windows
// from them (the race's best action, the moment a truck crosses each track's feature).
// The 'mobile' take is an emulated phone (iPhone 13 landscape, touch): an autopilot race with fingers on GAS, the
// steer pad following the truck's turns and NITRO taps, so the touch controls show; the cut puts it in a phone
// outline (a PNG drawn by the browser) over a blurred copy of itself: PLAY ON YOUR PHONE.
import { chromium, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const url = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5199').replace(/\/$/, '');
const cutOnly = args.includes('--cut-only');
const onlyTake = args.find((a) => a.startsWith('--take='))?.slice(7);
const W = 1600;
const H = 900;
const FPS = 30;
const outDir = path.resolve('test-results/video');
const takeDir = path.join(outDir, 'takes');
const rawDir = path.join(outDir, 'raw');
const FONT = path.resolve('node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff');
const PLAY_URL = 'https://ali3b.github.io/offroad/';

const ff = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a], { maxBuffer: 1 << 28 });
const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

// ---- recording ---------------------------------------------------------------------------------------------------

/** Track takes: a standalone autopilot race, and the feature the cut wants a truck to cross. */
const TRACK_TAKES = {
  buzzard: { track: 'buzzard', feature: [0, -1], caption: 'BUZZARD BEND', sub: '8 TRACKS, FORWARD AND REVERSED' },
  thunder: { track: 'thunder', feature: [-6.5, 10], caption: 'THUNDER RIDGE', sub: 'A JUMP AT EVERY CROSSING', at: 'tr' },
  twister: { track: 'twister', feature: [0, -2], caption: 'TWISTER FLATS', sub: 'THE JUMP CROSSING' },
  drycreek: { track: 'drycreek', feature: [-5, 9], caption: 'DRY CREEK SPIRAL', sub: 'THE CREEK AND THE BRIDGE' },
};
const TAKES = ['main', ...Object.keys(TRACK_TAKES), 'dos', 'mobile'];
/** The phone take: CSS viewport = the recorded video size (Playwright records CSS pixels, not device pixels). */
const PHONE = { w: 844, h: 390, track: 'rattlesnake' };

let browser;
let mode = 'egl';
async function startBrowser() {
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  // Headless EGL lands on the GTX 1060 here (Mesa's EGL only offers llvmpipe without a display, so no Intel iGPU):
  // one GPU worker at a time, and nothing else heavy on the GPU while the takes run.
  const common = ['--autoplay-policy=no-user-gesture-required'];
  const launch = (m) =>
    chromium.launch({ env, args: [...common, ...(m === 'egl' ? ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
  browser = await launch('egl');
  const p = await browser.newPage();
  const gl = await p.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const d = c?.getExtension('WEBGL_debug_renderer_info');
    return c ? String(c.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : c.RENDERER)) : null;
  });
  await p.close();
  if (!gl || /swiftshader|llvmpipe/i.test(gl)) {
    console.log(`EGL gave no GPU WebGL (${gl ?? 'none'}); falling back to SwiftShader: the takes will judder`);
    await browser.close();
    mode = 'swiftshader';
    browser = await launch(mode);
  } else console.log(`WebGL renderer: ${gl}`);
}

/** In-page: the event log on the flash clock, the flash itself, the audio recorder. */
function pageKit() {
  const kit = (window.__trailer = { log: [], t0: 0, chunks: [], rec: null, recStart: 0 });
  const now = () => performance.now() - kit.t0;
  kit.mark = (type, data = {}) => kit.log.push({ t: now() / 1000, type, ...data });
  kit.flash = () =>
    new Promise((res) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;background:#f0f;z-index:2147483647';
      document.body.appendChild(d);
      requestAnimationFrame(() => {
        // The first frame with the flash on screen (the next rAF comes after it was painted).
        const t = performance.now();
        setTimeout(() => {
          d.remove();
          res(t);
        }, 300);
      });
    });
  kit.start = async () => {
    const stream = window.__or.audio.captureStream();
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
    rec.ondataavailable = (e) => e.data.size && kit.chunks.push(e.data);
    const started = new Promise((r) => (rec.onstart = () => r(performance.now())));
    rec.start(1000);
    kit.rec = rec;
    const [flashT, recT] = await Promise.all([kit.flash(), started]);
    kit.t0 = flashT;
    kit.recStart = (recT - flashT) / 1000;
    const ev = window.__or.events;
    ev.on('countdown', (e) => kit.mark('countdown', { n: e.n }));
    ev.on('land', (e) => e.airTime > 0.25 && kit.mark('land', { truck: e.truck, air: e.airTime }));
    ev.on('nitro', (e) => kit.mark('nitro', { truck: e.truck }));
    ev.on('splash', (e) => kit.mark('splash', { truck: e.truck, kind: e.kind }));
    ev.on('impact', (e) => e.with === 'truck' && e.strength > 0.15 && kit.mark('bump', { truck: e.truck, s: e.strength }));
    ev.on('finish', (e) => kit.mark('finish', { truck: e.truck, place: e.place }));
    ev.on('phase', (e) => kit.mark('phase', { phase: e.phase }));
    ev.on('screen', (e) => kit.mark('screen', { name: e.name }));
    kit.posTimer = setInterval(() => {
      try {
        const ts = window.__or.trucks();
        kit.mark('pos', { p: ts.map((s) => [+s.pos.x.toFixed(1), +s.pos.z.toFixed(1)]) });
      } catch {
        /* no race on screen */
      }
    }, 100);
    return kit.recStart;
  };
  kit.stop = async () => {
    clearInterval(kit.posTimer);
    const end = (await kit.flash()) - kit.t0;
    await new Promise((r) => {
      kit.rec.onstop = r;
      kit.rec.stop();
    });
    const blob = new Blob(kit.chunks, { type: 'audio/webm' });
    const b64 = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result).split(',')[1]);
      fr.readAsDataURL(blob);
    });
    return { end: end / 1000, audio: b64, log: kit.log };
  };
}

async function recordTake(name) {
  fs.mkdirSync(rawDir, { recursive: true });
  const phone = name === 'mobile';
  const context = await browser.newContext(
    phone
      ? { userAgent: devices['iPhone 13 landscape'].userAgent, viewport: { width: PHONE.w, height: PHONE.h }, screen: { width: PHONE.w, height: PHONE.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, recordVideo: { dir: rawDir, size: { width: PHONE.w, height: PHONE.h } } }
      : { viewport: { width: W, height: H }, recordVideo: { dir: rawDir, size: { width: W, height: H } } },
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const tt = TRACK_TAKES[name];
  const q = name === 'main' ? '/' : name === 'dos' ? '/?scene=race&track=mesa&autopilot' : phone ? `/?scene=race&track=${PHONE.track}&autopilot` : `/?scene=race&track=${tt.track}&autopilot`;
  await page.goto(url + q); // a fresh context: no saved season or settings
  await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
  await page.evaluate(pageKit);
  // A real key press unlocks the AudioContext (on the phone a tap: a key would hide the touch controls).
  if (phone) await page.touchscreen.tap(PHONE.w / 2, PHONE.h / 2);
  else await page.keyboard.press('Control');
  await page.waitForTimeout(500);
  const recStart = await page.evaluate(() => window.__trailer.start());
  const wait = (ms) => page.waitForTimeout(ms);
  const mark = (type, data) => page.evaluate(([t, d]) => window.__trailer.mark(t, d), [type, data]);
  const screen = () => page.evaluate(() => window.__or.flow?.state().screen);
  const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

  if (name === 'main') {
    await wait(7500); // the logo over the demo race
    await mark('cue', { at: 'enter' });
    await page.keyboard.press('Enter'); // New season → the racing hints
    await until(() => window.__or.flow.state().screen === 'hints');
    await wait(2500);
    await page.keyboard.press('Enter');
    await until(() => window.__or.flow.state().screen === 'register');
    await mark('cue', { at: 'register' });
    await wait(1000);
    await page.keyboard.press('Enter'); // join (the arrows player's panel)
    await wait(700);
    for (const k of ['KeyA', 'KeyC', 'KeyE']) {
      await page.keyboard.press(k);
      await wait(550);
    }
    await page.keyboard.press('Enter'); // on to the colour
    await wait(900);
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) {
      await page.keyboard.press(k);
      await wait(650);
    }
    await mark('cue', { at: 'signed' });
    await page.keyboard.press('Enter'); // yellow: READY
    await wait(900);
    await page.keyboard.press('Enter'); // ALL SET: start the season
    await until(() => window.__or.flow.state().screen === 'race', null, 30000);
    await page.evaluate(() => window.__or.autopilot(true));
    await until(() => window.__or.flow.state().screen === 'results', null, 240000);
    await wait(11000); // the podium
    await mark('cue', { at: 'shop' });
    await page.keyboard.press('Enter');
    await until(() => window.__or.flow.state().screen === 'shop');
    await wait(1800);
    await page.keyboard.press('ArrowDown'); // tires
    await wait(900);
    await page.keyboard.press('Enter');
    await mark('cue', { at: 'buy' });
    await wait(1600);
    await page.keyboard.press('ArrowRight'); // top speed
    await wait(900);
    await page.keyboard.press('Enter');
    await wait(2500);
  } else if (phone) {
    // The autopilot drives; the fingers show it: GAS held, the steer pad sliding with the truck's turns, NITRO taps.
    await until(() => window.__trailer.log.some((e) => e.type === 'countdown' && e.n === 0), null, 30000);
    const cdp = await context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ radiusX: 8, radiusY: 8, force: 1, ...p })) });
    const rc = await page.evaluate(() => Object.fromEntries(['pad', 'gas', 'nitro'].map((k) => {
      const r = document.querySelector(`.or-tc .${k}`).getBoundingClientRect();
      return [k, { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }];
    })));
    const gas = { id: 1, x: rc.gas.x, y: rc.gas.y };
    const pad = (s) => ({ id: 2, x: rc.pad.x + s * rc.pad.w * 0.42, y: rc.pad.y });
    await touch('touchStart', [gas]);
    await wait(250);
    await touch('touchStart', [gas, pad(0)]);
    let last = await page.evaluate(() => window.__or.truck().heading);
    let steer = 0;
    const t0 = Date.now();
    for (let i = 0; Date.now() - t0 < 16000; i++) {
      await wait(120);
      const h = await page.evaluate(() => window.__or.truck().heading);
      const d = Math.atan2(Math.sin(h - last), Math.cos(h - last));
      last = h;
      // A right turn makes the heading fall: the thumb slides right. Smoothed so it glides rather than jumps.
      steer += (Math.max(-1, Math.min(1, -d * 6)) - steer) * 0.5;
      const fingers = [gas, pad(steer)];
      if (i % 30 === 12) await touch('touchStart', [...fingers, { id: 3, x: rc.nitro.x, y: rc.nitro.y }]);
      else if (i % 30 === 15) await touch('touchMove', fingers); // the NITRO finger lifts (CDP diffs the points)
      else await touch('touchMove', i % 30 > 12 && i % 30 < 15 ? [...fingers, { id: 3, x: rc.nitro.x, y: rc.nitro.y }] : fingers);
    }
    await touch('touchEnd', []);
  } else {
    // A standalone autopilot race: the grid, the countdown, ~35 s of racing.
    await until(() => window.__trailer.log.some((e) => e.type === 'countdown' && e.n === 0), null, 30000);
    if (name === 'dos') {
      await wait(4000);
      await mark('cue', { at: 'dos256' });
      await page.keyboard.press('F2');
      await wait(5000);
      await mark('cue', { at: 'dos16' });
      await page.keyboard.press('F2');
      await wait(5000);
    } else await wait(34000);
  }
  const out = await page.evaluate(() => window.__trailer.stop());
  const video = page.video();
  await context.close();
  const raw = await video.path();
  for (const e of errors) console.log(`  page error (${name}): ${e}`);
  normalise(name, raw, out, recStart);
}

/** The pts (s) of the flash frames in a raw video: [first flash, last flash]. */
function findFlashes(raw) {
  const txt = execFileSync('ffmpeg', ['-v', 'error', '-i', raw, '-vf', 'scale=160:90,signalstats,metadata=print:file=-', '-f', 'null', '-'], { maxBuffer: 1 << 28 }).toString();
  const white = [];
  let pts = null;
  let umin = 0;
  for (const line of txt.split('\n')) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) pts = Number(m[1]);
    const u = line.match(/UMIN=([\d.]+)/);
    if (u) umin = Number(u[1]);
    const v = line.match(/VMIN=([\d.]+)/);
    // A flash frame is magenta edge to edge (the game and a blank page never are).
    if (v && pts !== null && umin > 185 && Number(v[1]) > 195) white.push(pts);
  }
  if (white.length < 2) throw new Error(`flashes not found in ${raw}`);
  // Each flash may span a few frames: the first frame of the first run and of the last run.
  const runs = white.filter((t, i) => i === 0 || t - white[i - 1] > 1);
  if (runs.length < 2) throw new Error(`end flash not found in ${raw} (white frames at ${white.map((t) => t.toFixed(2)).join(' ')})`);
  return [runs[0], runs[runs.length - 1]];
}

/**
 * How late the countdown beeps (A4, 440 Hz) sound after their countdown events: Goertzel energy at 440 Hz on the
 * recorded audio, the onset nearest each "3, 2, 1" event; the median, or null without beeps.
 */
function beepLag(webm, log, recStart) {
  const sr = 8000;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', webm, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(buf.buffer, buf.byteOffset, buf.length >> 2);
  const win = 80;
  const k = 2 * Math.cos((2 * Math.PI * 440) / sr);
  const e = [];
  for (let i = 0; i + win < x.length; i += win) {
    let s1 = 0;
    let s2 = 0;
    for (let j = i; j < i + win; j++) {
      const s0 = x[j] + k * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    e.push(Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / win);
  }
  const lags = [];
  for (const c of ev(log, 'countdown', (c) => c.n > 0)) {
    const at = c.t - recStart; // the event on the audio file's clock
    const from = Math.max(1, Math.floor(((at - 0.1) * sr) / win));
    const to = Math.min(e.length - 1, Math.ceil(((at + 0.4) * sr) / win));
    const floor = Math.min(...e.slice(from - 1, to));
    const peak = Math.max(...e.slice(from, to));
    if (peak < floor * 4 + 1e-3) continue;
    for (let i = from; i < to; i++) {
      if (e[i] > floor + (peak - floor) * 0.5) {
        lags.push((i * win) / sr - at);
        break;
      }
    }
  }
  if (!lags.length) return null;
  lags.sort((a, b) => a - b);
  return lags[lags.length >> 1];
}

/** Raw video + audio → takes/<name>.mp4 on the wall clock (t = 0 at the first flash) and takes/<name>.json (log). */
function normalise(name, raw, out, recStart) {
  fs.mkdirSync(takeDir, { recursive: true });
  const webm = path.join(takeDir, `${name}.audio.webm`);
  fs.writeFileSync(webm, Buffer.from(out.audio, 'base64'));
  const [v1, v2] = findFlashes(raw);
  const scale = out.end / (v2 - v1);
  // The output latency: the countdown beeps land a little after the frame that shows the number.
  const lag = beepLag(webm, out.log, recStart);
  recStart -= lag ?? 0.06;
  // Audio: its first sample is at recStart on the flash clock (usually a few ms before or after the flash).
  const aFilter = recStart >= 0 ? `adelay=${Math.round(recStart * 1000)}:all=1` : `atrim=start=${(-recStart).toFixed(3)},asetpts=PTS-STARTPTS`;
  const mp4 = path.join(takeDir, `${name}.mp4`);
  ff('-ss', v1.toFixed(3), '-i', raw, '-i', webm, '-filter_complex', `[0:v]setpts=${scale.toFixed(5)}*(PTS-STARTPTS),fps=${FPS}[v];[1:a]${aFilter},aresample=48000[a]`,
    '-map', '[v]', '-map', '[a]', '-t', out.end.toFixed(3), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', mp4);
  fs.writeFileSync(path.join(takeDir, `${name}.json`), JSON.stringify({ end: out.end, recStart, beepLag: lag, videoScale: scale, mode, log: out.log }));
  console.log(`  take ${name}: ${out.end.toFixed(1)} s wall, raw video ${(v2 - v1).toFixed(1)} s between the flashes (×${scale.toFixed(3)}), audio offset ${(recStart * 1000).toFixed(0)} ms (beep lag ${lag === null ? 'not measured' : `${(lag * 1000).toFixed(0)} ms`})`);
}

// ---- the cut -----------------------------------------------------------------------------------------------------

const load = (name) => JSON.parse(fs.readFileSync(path.join(takeDir, `${name}.json`), 'utf8'));
const ev = (log, type, pred = () => true) => log.filter((e) => e.type === type && pred(e));

/** The start of the best `len`-second window in [from, to] by action: jumps, nitros, splashes, bumps. */
function bestWindow(log, from, to, len) {
  const w = { land: 3, nitro: 2, splash: 0.5, bump: 2 };
  const hits = log.filter((e) => w[e.type]).map((e) => [e.t, w[e.type] * (e.type === 'land' ? Math.min(2, e.air * 2) : 1)]);
  let best = from;
  let bestScore = -1;
  for (let s = from; s + len <= to; s += 0.25) {
    const sc = hits.filter(([t]) => t >= s + 0.5 && t <= s + len - 0.5).reduce((a, [, v]) => a + v, 0);
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return best;
}

/** The start of a `len`-second window where the most trucks pass within `r` m of the feature. */
function featureWindow(log, feature, from, len, r = 6) {
  const passes = ev(log, 'pos').flatMap((e) => e.p.filter(([x, z]) => Math.hypot(x - feature[0], z - feature[1]) < r).map(() => e.t));
  const end = Math.max(...log.map((e) => e.t));
  let best = from;
  let bestScore = -1;
  for (let s = from; s + len <= end; s += 0.25) {
    const sc = passes.filter((t) => t >= s + 1.5 && t <= s + len - 1.5).length;
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return best;
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/%/g, '\\%').replace(/,/g, '\\,');
/**
 * A caption in the DOS panel look (yellow on navy, hard shadow), in a corner the segment keeps clear of the HUD and
 * the track name: 'bl' (default), 'tl', 'tr'.
 */
function captionFilter(text, sub, dur, at = 'bl') {
  const fade = `alpha='if(lt(t,0.25),t/0.25,if(gt(t,${(dur - 0.3).toFixed(2)}),max(0,(${dur.toFixed(2)}-t)/0.3),1))'`;
  const x = at === 'tr' ? 'w-text_w-48' : '48';
  const [y1, y2] = at === 'bl' ? [sub ? 'h-124' : 'h-84', 'h-72'] : ['36', '84'];
  const f = [];
  if (text) f.push(`drawtext=fontfile='${FONT}':text='${esc(text)}':fontsize=26:fontcolor=#ffd23c:x=${x}:y=${y1}:box=1:boxcolor=#0b2340@0.9:boxborderw=14:shadowcolor=#000000:shadowx=3:shadowy=3:${fade}`);
  if (sub) f.push(`drawtext=fontfile='${FONT}':text='${esc(sub)}':fontsize=17:fontcolor=#ffffff:x=${x}:y=${y2}:box=1:boxcolor=#0b2340@0.9:boxborderw=10:${fade}`);
  return f.join(',');
}

/** One segment of a take → a uniform clip (1600×900, 30 fps, AAC 48 kHz stereo) with a caption and audio fades. */
function clip(out, take, start, dur, text, sub, at) {
  const src = path.join(takeDir, `${take}.mp4`);
  const cap = captionFilter(text, sub, dur, at);
  const vf = `scale=${W}:${H}:flags=lanczos,setsar=1${cap ? `,${cap}` : ''},format=yuv420p`;
  // Menus are quieter than races: level each clip, then fade its ends so the cuts don't click.
  const af = `loudnorm=I=-17:TP=-1.5:LRA=9,afade=t=in:d=0.12,afade=t=out:st=${(dur - 0.2).toFixed(2)}:d=0.2,aformat=sample_rates=48000:channel_layouts=stereo`;
  ff('-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', src, '-vf', vf, '-af', af, '-ar', '48000', '-r', String(FPS), '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-c:a', 'aac', '-b:a', '192k', out);
}

/** The end card: a dimmed, blurred race frame, OFF ROAD, the pipeline line and the play URL; music under it. */
function endCard(out, dur, bgTake, bgAt, audioTake, audioAt) {
  const t = (s, size, color, y) => `drawtext=fontfile='${FONT}':text='${esc(s)}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}:shadowcolor=#000000:shadowx=${Math.max(2, size / 12)}:shadowy=${Math.max(2, size / 12)}`;
  const vf = [
    `scale=${W}:${H}`, 'boxblur=12:2', 'eq=brightness=-0.22:saturation=0.7', 'setsar=1',
    t('OFF ROAD', 120, '#ffd23c', 250),
    t('A 3D ARCADE OFF-ROAD RACER', 26, '#ffffff', 420),
    t('BUILT WITH AN AGENT-DRIVEN SYNTY ASSET PIPELINE', 22, '#9fd8ff', 480),
    t('PLAY IN YOUR BROWSER', 24, '#ffffff', 600),
    t(PLAY_URL, 30, '#ffd23c', 648),
    `fade=t=in:d=0.5,fade=t=out:st=${(dur - 0.6).toFixed(2)}:d=0.6`, 'format=yuv420p',
  ].join(',');
  ff('-ss', bgAt.toFixed(3), '-i', path.join(takeDir, `${bgTake}.mp4`), '-ss', audioAt.toFixed(3), '-i', path.join(takeDir, `${audioTake}.mp4`),
    '-filter_complex', `[0:v]trim=duration=0.04,setpts=PTS-STARTPTS,loop=loop=-1:size=1,trim=duration=${dur},${vf}[v];[1:a]atrim=duration=${dur},asetpts=PTS-STARTPTS,loudnorm=I=-17:TP=-1.5:LRA=9,afade=t=in:d=0.3,afade=t=out:st=${(dur - 1.2).toFixed(2)}:d=1.2,aformat=sample_rates=48000:channel_layouts=stereo[a]`,
    '-map', '[v]', '-map', '[a]', '-t', String(dur), '-ar', '48000', '-r', String(FPS), '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-c:a', 'aac', '-b:a', '192k', out);
}

/** The phone outline: a rounded body with a transparent screen, side buttons and a camera dot (drawn by the browser). */
const PH = { screenW: 1280, bezel: 30, pad: 30 };
PH.screenH = Math.round((PH.screenW * PHONE.h) / PHONE.w);
PH.x = Math.round((W - PH.screenW) / 2);
PH.y = H - PH.screenH - PH.bezel - 26;
async function phoneFrame(file) {
  const bw = PH.screenW + 2 * PH.bezel;
  const bh = PH.screenH + 2 * PH.bezel;
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const b = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: bw + 2 * PH.pad, height: bh + 2 * PH.pad } });
  await p.setContent(`<html><body style="margin:0;background:transparent">
    <div style="position:absolute;left:${PH.pad}px;top:${PH.pad}px;width:${PH.screenW}px;height:${PH.screenH}px;border:${PH.bezel}px solid #16171c;border-radius:${PH.bezel + 44}px;box-shadow:0 0 0 3px #4a4e5a,0 0 0 5px #0a0a0c,0 18px 40px rgba(0,0,0,.55),inset 0 0 0 2px #000"></div>
    <div style="position:absolute;left:${PH.pad + 11}px;top:${PH.pad + bh / 2 - 7}px;width:14px;height:14px;border-radius:50%;background:#050608;box-shadow:inset 0 0 0 3px #1f2330"></div>
    ${[[220, 90], [340, 60], [420, 60]].map(([x, w]) => `<div style="position:absolute;left:${PH.pad + x}px;top:${PH.pad - 8}px;width:${w}px;height:6px;border-radius:3px 3px 0 0;background:#3a3e48"></div>`).join('')}
  </body></html>`, { waitUntil: 'domcontentloaded' });
  await p.screenshot({ path: file, omitBackground: true });
  await b.close();
}

/** A stretch of the phone take inside the phone outline, over a blurred, darkened copy of itself; a centred caption. */
function phoneClip(out, start, dur, frame, text, sub) {
  const src = path.join(takeDir, 'mobile.mp4');
  const fade = `alpha='if(lt(t,0.25),t/0.25,if(gt(t,${(dur - 0.3).toFixed(2)}),max(0,(${dur.toFixed(2)}-t)/0.3),1))'`;
  const cap = [
    text && `drawtext=fontfile='${FONT}':text='${esc(text)}':fontsize=34:fontcolor=#ffd23c:x=(w-text_w)/2:y=44:box=1:boxcolor=#0b2340@0.9:boxborderw=14:shadowcolor=#000000:shadowx=3:shadowy=3:${fade}`,
    sub && `drawtext=fontfile='${FONT}':text='${esc(sub)}':fontsize=17:fontcolor=#ffffff:x=(w-text_w)/2:y=104:box=1:boxcolor=#0b2340@0.9:boxborderw=10:${fade}`,
  ].filter(Boolean).join(',');
  const fc = [
    `[0:v]split[a][b]`,
    `[a]scale=-2:${H},crop=${W}:${H},boxblur=18:2,eq=brightness=-0.28:saturation=0.6,setsar=1[bg]`,
    `[b]scale=${PH.screenW}:${PH.screenH}:flags=lanczos,setsar=1[fg]`,
    `[bg][fg]overlay=${PH.x}:${PH.y}[s]`,
    `[s][1:v]overlay=${PH.x - PH.bezel - PH.pad}:${PH.y - PH.bezel - PH.pad}${cap ? `,${cap}` : ''},format=yuv420p[v]`,
    `[0:a]loudnorm=I=-17:TP=-1.5:LRA=9,afade=t=in:d=0.12,afade=t=out:st=${(dur - 0.2).toFixed(2)}:d=0.2,aformat=sample_rates=48000:channel_layouts=stereo[a2]`,
  ].join(';');
  ff('-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', src, '-i', frame, '-filter_complex', fc, '-map', '[v]', '-map', '[a2]', '-t', dur.toFixed(3), '-ar', '48000', '-r', String(FPS),
    '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-c:a', 'aac', '-b:a', '192k', out);
}

function concat(clips, out, crf, maxrate) {
  const list = path.join(outDir, 'parts', `${path.basename(out)}.txt`);
  fs.writeFileSync(list, clips.map((c) => `file '${c}'`).join('\n'));
  ff('-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-maxrate', maxrate, '-bufsize', '12M', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out);
}

async function cut() {
  const parts = path.join(outDir, 'parts');
  fs.rmSync(parts, { recursive: true, force: true });
  fs.mkdirSync(parts, { recursive: true });
  const frame = path.join(parts, 'phone-frame.png');
  await phoneFrame(frame);
  const mob = load('mobile').log;
  const mobGo = ev(mob, 'countdown', (e) => e.n === 0)[0]?.t ?? 4;
  const mobAt = bestWindow(mob, mobGo + 1.5, Math.min(mobGo + 16, Math.max(...mob.map((e) => e.t))), 6);
  console.log(`cut: mobile window ${mobAt.toFixed(1)} (GO ${mobGo.toFixed(1)})`);
  const main = load('main').log;
  const cue = (at) => ev(main, 'cue', (e) => e.at === at)[0].t;
  // The season race (the title's demo race sends countdowns and finishes too).
  const signed = cue('signed');
  const go = ev(main, 'countdown', (e) => e.n === 0 && e.t > signed)[0].t;
  const three = ev(main, 'countdown', (e) => e.n === 3 && e.t > signed)[0]?.t ?? go - 3;
  const results = ev(main, 'screen', (e) => e.name === 'results')[0].t;
  const firstFinish = ev(main, 'finish', (e) => e.t > go)[0]?.t ?? results - 3;
  const shop = ev(main, 'screen', (e) => e.name === 'shop')[0].t;
  const raceAction = bestWindow(main, go + 14, firstFinish - 22, 16);
  console.log(`cut: title 0-${cue('enter').toFixed(1)}, countdown ${three.toFixed(1)}, GO ${go.toFixed(1)}, action ${raceAction.toFixed(1)}, 1st finish ${firstFinish.toFixed(1)}, results ${results.toFixed(1)}, shop ${shop.toFixed(1)}`);

  const segs = [];
  const add = (key, ...a) => {
    const f = path.join(parts, `${String(segs.length).padStart(2, '0')}-${key}.mp4`);
    clip(f, ...a);
    segs.push({ key, f, dur: a[2] });
  };
  add('title', 'main', 1.2, 6.2); // the logo says it
  add('signup', 'main', cue('register') - 0.1, cue('signed') - cue('register') + 1.3, 'SIGN UP', 'YOUR INITIALS, YOUR TRUCK');
  add('start', 'main', three - 1.6, go - three + 7.5, 'RATTLESNAKE RUN', 'FOUR TRUCKS, FOUR LAPS');
  add('action', 'main', raceAction, 16, 'JUMPS, MUD, WATER, NITROS', 'AND A LOT OF BUMPING');
  add('finish', 'main', firstFinish - 2.5, 4.8, 'FOUR LAPS LATER');
  add('podium', 'main', results + 0.3, 8, 'THE PODIUM', 'PRIZE MONEY AND THE TRACK RECORD');
  add('shop', 'main', shop - 0.2, 7.2, 'THE SPEED SHOP', 'NITRO, ACCEL, TIRES, SHOCKS, TOP SPEED', 'tr');
  for (const [name, tt] of Object.entries(TRACK_TAKES)) {
    const log = load(name).log;
    const g = ev(log, 'countdown', (e) => e.n === 0)[0]?.t ?? 4;
    const s = featureWindow(log, tt.feature, g + 1, 9);
    console.log(`cut: ${name} window ${s.toFixed(1)} (GO ${g.toFixed(1)})`);
    add(name, name, s, 9, tt.caption, tt.sub, tt.at);
  }
  const dos = load('dos').log;
  const d256 = ev(dos, 'cue', (e) => e.at === 'dos256')[0].t;
  add('dos', 'dos', d256 - 1.2, 10.4, 'F2: THE DOS LOOK', '256 COLOURS, 16 COLOURS, SCANLINES');
  const phoneF = path.join(parts, `${String(segs.length).padStart(2, '0')}-phone.mp4`);
  phoneClip(phoneF, mobAt, 6, frame, 'PLAY ON YOUR PHONE', 'TOUCH CONTROLS, ADD IT TO YOUR HOME SCREEN');
  segs.push({ key: 'phone', f: phoneF, dur: 6 });
  const endF = path.join(parts, '99-end.mp4');
  endCard(endF, 7, 'main', raceAction + 6, 'main', 9);
  segs.push({ key: 'end', f: endF, dur: 7 });

  const trailer = path.join(outDir, 'offroad-trailer.mp4');
  concat(segs.map((s) => s.f), trailer, 21, '7M');

  // The short (~25 s): the logo, the start, the action, a podium beat, two track cuts, the end card.
  const short = [];
  const addS = (key, take, start, dur, text, sub, at) => {
    const f = path.join(parts, `short-${String(short.length).padStart(2, '0')}-${key}.mp4`);
    clip(f, take, start, dur, text, sub, at);
    short.push(f);
  };
  addS('title', 'main', 1.2, 2.6);
  addS('start', 'main', go - 1.2, 3.6, 'RATTLESNAKE RUN');
  addS('action', 'main', raceAction + 2, 6, 'JUMPS, MUD, WATER, NITROS');
  addS('podium', 'main', results + 0.8, 3.2, 'THE PODIUM');
  const bz = load('buzzard').log;
  addS('buzzard', 'buzzard', featureWindow(bz, TRACK_TAKES.buzzard.feature, 5, 9) + 2.5, 3.2, 'BUZZARD BEND', '8 TRACKS, FORWARD AND REVERSED');
  addS('dos', 'dos', d256 + 4.4, 2.6, 'F2: THE DOS LOOK');
  const phoneS = path.join(parts, `short-${String(short.length).padStart(2, '0')}-phone.mp4`);
  phoneClip(phoneS, mobAt + 1, 3, frame, 'PLAY ON YOUR PHONE');
  short.push(phoneS);
  const endS = path.join(parts, 'short-99-end.mp4');
  endCard(endS, 4, 'main', raceAction + 6, 'main', 9);
  short.push(endS);
  const shortF = path.join(outDir, 'offroad-short.mp4');
  concat(short, shortF, 22, '6M');

  // The README GIF: the short's game footage without the end card, 640 wide, 12 fps, one palette.
  const gif = path.join(outDir, 'offroad.gif');
  const gifLen = short.slice(0, -1).reduce((a, f) => a + probe(f), 0);
  const gifOnce = (w, fps) => {
    ff('-t', gifLen.toFixed(2), '-i', shortF, '-filter_complex', `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, gif);
    return fs.statSync(gif).size;
  };
  let size = gifOnce(640, 12);
  if (size > 8e6) size = gifOnce(560, 10);
  if (size > 8e6) size = gifOnce(480, 10);

  for (const f of [trailer, shortF, gif]) console.log(`${path.relative(process.cwd(), f)}: ${probe(f).toFixed(1)} s, ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`);
}

// ---- main --------------------------------------------------------------------------------------------------------

if (!cutOnly) {
  await startBrowser();
  for (const name of onlyTake ? [onlyTake] : TAKES) {
    console.log(`recording ${name}…`);
    await recordTake(name);
  }
  await browser.close();
  if (!args.includes('--keep-raw')) fs.rmSync(rawDir, { recursive: true, force: true });
  console.log(`recorded on ${mode}`);
}
if (!onlyTake || cutOnly) await cut();
