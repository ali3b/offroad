// The PWA / home-screen icons: public/icons/icon.svg (our 32×32 pixel art) rendered to PNGs with nearest-neighbour
// scaling: icon-192.png, icon-512.png, apple-touch-icon.png (180, no transparency) and a maskable 512 with padding.
//   node scripts/make-icons.mjs
// The PNGs are committed (public/icons/), so this only runs after the SVG changes.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const svg = fs.readFileSync('public/icons/icon.svg', 'utf8');
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new'] });
const page = await browser.newPage();
const shots = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
  // Maskable: the art inside the 80 % safe zone, the background colour to the edges.
  { file: 'icon-maskable-512.png', size: 512, pad: 52 },
];
for (const s of shots) {
  const inner = s.size - s.pad * 2;
  await page.setViewportSize({ width: s.size, height: s.size });
  await page.setContent(`<html><body style="margin:0;background:#0c2f4a">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${inner}" height="${inner}"
      style="position:absolute;left:${s.pad}px;top:${s.pad}px;image-rendering:pixelated"></body></html>`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `public/icons/${s.file}`, omitBackground: false });
  console.log(`public/icons/${s.file}`);
}
await browser.close();
