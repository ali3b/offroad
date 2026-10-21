// Close-up screenshots of a scene for looking at the dressing: boots a scene, then aims the camera at each view.
//   node scripts/view.mjs <url> <query> <name> <view> [<view> ...]
//   a view is "px,py,pz>tx,ty,tz" (camera position > target) or "race" (the game's own camera);
//   `cheer` as a view makes the crowd cheer first; `js:<code>` runs code in the page (e.g. hold nitro and advance). Writes test-results/view-<name>-<k>.png.
// e.g. node scripts/view.mjs http://localhost:5199 "scene=race&track=coyote" stand "0,12,-8>0,4,-34"
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [url = 'http://localhost:5199', query = 'scene=race', name = 'view', ...views] = process.argv.slice(2);
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
fs.mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
page.on('console', (m) => m.text().startsWith('stadium:') && console.log(m.text()));
await page.goto(`${url.replace(/\/$/, '')}/?${query}`);
await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
await page.waitForFunction(() => window.__or.loop.steps > 60, null, { timeout: 30000 });
await page.evaluate(async () => {
  await window.__or.session?.stadium;
  await window.__or.session?.crowd.ready;
});
await page.waitForTimeout(800);
let k = 0;
for (const v of views.length ? views : ['race']) {
  if (v.startsWith('js:')) {
    // e.g. "js:__or.setInput({throttle:1,nitro:true});__or.advance(1.2)"
    await page.evaluate(v.slice(3));
    continue;
  }
  if (v === 'perf') {
    // Real-time frames for 8 s at the race camera: fps (the loop's own average) and the last frame's cost.
    await page.evaluate(() => window.__or.autopilot?.(true));
    await page.waitForTimeout(8000);
    console.log('perf', JSON.stringify(await page.evaluate(() => ({ fps: +window.__or.loop.fps.toFixed(1), ...window.__or.renderInfo() }))));
    continue;
  }
  if (v === 'cheer') {
    await page.evaluate(() => window.__or.session.crowd.cheer(30));
    continue;
  }
  if (v !== 'race') {
    const [p, t] = v.split('>').map((s) => s.split(',').map(Number));
    await page.evaluate(([p, t]) => {
      const c = window.__or.camera3d();
      c.fov = 30;
      c.position.set(...p);
      c.lookAt(...t);
      c.updateProjectionMatrix();
    }, [p, t]);
  }
  await page.waitForTimeout(700);
  const file = `test-results/view-${name}-${k++}.png`;
  await page.screenshot({ path: file });
  console.log('saved', file);
}
const info = await page.evaluate(() => ({ fans: window.__or.session?.crowd.count, ...window.__or.renderInfo() }));
console.log(JSON.stringify(info));
if (process.env.BREAKDOWN) {
  const rows = await page.evaluate(() => {
    const out = {};
    window.__or.session.track.group.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const g = o.geometry;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      const n = o.isInstancedMesh ? o.count : 1;
      const key = (o.name || o.parent?.name || '?').split(':')[0];
      out[key] = (out[key] ?? 0) + tris * n;
    });
    return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${Math.round(v / 1000)}k`).join('  ');
  });
  console.log(rows);
}
await browser.close();
