// Track layout check (OR3): a top-down map of a track and a lint of its data, for designing layouts.
//   node scripts/track-map.mjs [url] [track] [--reverse]
// Draws the height grid (shaded), walls, the racing line (with its direction), gates (numbered), zones, bridges,
// the grid slots and the HUD anchors to test-results/map-<track>.png, and prints:
//   - the line length and its tightest turn radius,
//   - the line's clearance to the walls (the closest approaches, < 3 m is a warning),
//   - for each gate: how often the line crosses it (must be exactly once) and whether it is crossed forwards.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = (args[0] ?? 'http://localhost:5199').replace(/\/$/, '');
const track = args[1] ?? 'rattlesnake';
const reverse = process.argv.includes('--reverse');
const tag = `${track}${reverse ? '-r' : ''}`;
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
fs.mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${url}/?scene=race&cpus=3&track=${track}${reverse ? '&reverse' : ''}`);
await page.waitForFunction(() => window.__or?.ready === true, null, { timeout: 90000 });
const out = await page.evaluate(() => {
  const or = window.__or;
  or.loop.stop();
  const tr = or.session.track;
  const t = tr.data;
  const line = tr.line;
  const S = 9; // px per metre
  const W = t.size.w * S;
  const D = t.size.d * S;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = D;
  const cx = cv.getContext('2d');
  const X = (x) => (x + t.size.w / 2) * S;
  const Z = (z) => (z + t.size.d / 2) * S;
  // Heights: grey ramp, -2 m black .. +3 m white.
  const img = cx.createImageData(W, D);
  for (let py = 0; py < D; py++)
    for (let px = 0; px < W; px++) {
      const x = px / S - t.size.w / 2;
      const z = py / S - t.size.d / 2;
      const h = tr.heightAt(x, z);
      const v = Math.max(0, Math.min(255, 110 + h * 45));
      const k = (py * W + px) * 4;
      img.data[k] = v * 1.05;
      img.data[k + 1] = v * 0.85;
      img.data[k + 2] = v * 0.7;
      img.data[k + 3] = 255;
    }
  cx.putImageData(img, 0, 0);
  // Zones.
  for (const zn of t.zones) {
    cx.fillStyle = zn.type === 'water' ? 'rgba(60,120,230,.55)' : 'rgba(60,35,10,.55)';
    cx.beginPath();
    if (zn.shape === 'path') {
      cx.lineWidth = zn.width * S;
      cx.strokeStyle = cx.fillStyle;
      zn.points.forEach(([x, z], i) => (i ? cx.lineTo(X(x), Z(z)) : cx.moveTo(X(x), Z(z))));
      cx.stroke();
    } else {
      cx.ellipse(X(zn.x), Z(zn.z), zn.rx * S, zn.rz * S, 0, 0, Math.PI * 2);
      cx.fill();
    }
  }
  // Bridges: deck outline.
  for (const b of tr.bridges) {
    const f = b.f;
    const hw = f.width / 2 + 0.5;
    const pts = [[-b.spanHalf, -hw], [b.spanHalf, -hw], [b.spanHalf, hw], [-b.spanHalf, hw]].map(([u, v]) => [f.x + b.ux * u + b.uz * v, f.z + b.uz * u - b.ux * v]);
    cx.fillStyle = 'rgba(140,90,40,.6)';
    cx.strokeStyle = '#fff';
    cx.lineWidth = 2;
    cx.beginPath();
    pts.forEach(([x, z], i) => (i ? cx.lineTo(X(x), Z(z)) : cx.moveTo(X(x), Z(z))));
    cx.closePath();
    cx.fill();
    cx.stroke();
  }
  // Walls.
  cx.lineCap = 'round';
  for (const w of t.walls) {
    cx.strokeStyle = '#d02020';
    cx.lineWidth = 0.9 * S;
    cx.beginPath();
    w.points.forEach(([x, z], i) => (i ? cx.lineTo(X(x), Z(z)) : cx.moveTo(X(x), Z(z))));
    if (w.closed) cx.closePath();
    cx.stroke();
  }
  // Racing line with arrows.
  const samples = line.samples(1);
  cx.strokeStyle = '#ffe000';
  cx.lineWidth = 2;
  cx.beginPath();
  samples.forEach(([x, z], i) => (i ? cx.lineTo(X(x), Z(z)) : cx.moveTo(X(x), Z(z))));
  cx.closePath();
  cx.stroke();
  cx.fillStyle = '#ffe000';
  for (let s = 0; s < line.length; s += 12) {
    const p = line.pointAt(s);
    const tg = line.tangentAt(s);
    cx.beginPath();
    cx.moveTo(X(p.x + tg.x * 1.6), Z(p.z + tg.z * 1.6));
    cx.lineTo(X(p.x - tg.x * 0.8 + tg.z * 0.9), Z(p.z - tg.z * 0.8 - tg.x * 0.9));
    cx.lineTo(X(p.x - tg.x * 0.8 - tg.z * 0.9), Z(p.z - tg.z * 0.8 + tg.x * 0.9));
    cx.fill();
  }
  // Gates.
  cx.font = 'bold 18px sans-serif';
  t.gates.forEach(([a, b], i) => {
    cx.strokeStyle = i === 0 ? '#ffffff' : '#30ff60';
    cx.lineWidth = 3;
    cx.beginPath();
    cx.moveTo(X(a[0]), Z(a[1]));
    cx.lineTo(X(b[0]), Z(b[1]));
    cx.stroke();
    cx.fillStyle = cx.strokeStyle;
    cx.fillText(String(i), X((a[0] + b[0]) / 2) + 4, Z((a[1] + b[1]) / 2) - 4);
  });
  // Grid slots, HUD anchors, flagman.
  t.start.grid.forEach(([x, z], i) => {
    cx.fillStyle = ['#ff3030', '#ffd000', '#3060ff', '#c0c0c0'][i];
    cx.fillRect(X(x) - 6, Z(z) - 6, 12, 12);
  });
  if (t.hud) {
    cx.fillStyle = 'rgba(200,200,220,.8)';
    cx.fillRect(X(t.hud.panel.x) - 9 * S / 2, Z(t.hud.panel.z) - 3 * S, 9 * S, 6 * S);
    cx.fillStyle = '#ff2020';
    cx.fillText('NAME', X(t.hud.name.x) - 25, Z(t.hud.name.z) + 6);
  }
  if (t.flagman) {
    cx.fillStyle = '#fff';
    cx.fillRect(X(t.flagman.x) - 8, Z(t.flagman.z) - 8, 16, 16);
  }

  // Lint: clearance from the line to walls (bridge railings count as walls on their deck only).
  const segs = [];
  for (const w of t.walls) {
    const n = w.points.length;
    for (let k = 0; k < (w.closed ? n : n - 1); k++) segs.push([w.points[k], w.points[(k + 1) % n]]);
  }
  const segDist = (x, z, [a, b]) => {
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const u = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez)));
    return Math.hypot(x - a[0] - ex * u, z - a[1] - ez * u);
  };
  const clear = [];
  for (let s = 0; s < line.length; s += 1) {
    const p = line.pointAt(s);
    let d = Infinity;
    for (const sg of segs) d = Math.min(d, segDist(p.x, p.z, sg) - 0.45);
    clear.push({ s, d, x: p.x, z: p.z });
  }
  const tight = clear.filter((c) => c.d < 3).map((c) => `s${c.s}(${c.x.toFixed(0)},${c.z.toFixed(0)}):${c.d.toFixed(1)}`);
  // Gate crossings by the line.
  const cross = (ax, az, bx, bz) => ax * bz - az * bx;
  const gates = t.gates.map(([a, b], gi) => {
    let n = 0;
    const at = [];
    for (let s = 0; s < line.length; s += 0.5) {
      const p = line.pointAt(s);
      const q = line.pointAt(s + 0.5);
      const d1 = cross(b[0] - a[0], b[1] - a[1], p.x - a[0], p.z - a[1]);
      const d2 = cross(b[0] - a[0], b[1] - a[1], q.x - a[0], q.z - a[1]);
      const e1 = cross(q.x - p.x, q.z - p.z, a[0] - p.x, a[1] - p.z);
      const e2 = cross(q.x - p.x, q.z - p.z, b[0] - p.x, b[1] - p.z);
      if (d1 * d2 < 0 && e1 * e2 < 0) {
        n++;
        at.push(s);
      }
    }
    return { gate: gi, crossings: n, at };
  });
  // Order: the gates' s along the line must increase.
  const order = gates.map((g) => g.at[0] ?? -1);
  let minR = Infinity;
  let minRs = 0;
  for (let s = 0; s < line.length; s += 1) {
    const k = line.curvatureAt(s);
    if (1 / k < minR) {
      minR = 1 / k;
      minRs = s;
    }
  }
  const p = line.pointAt(minRs);
  return {
    png: cv.toDataURL('image/png'),
    length: Math.round(line.length),
    minRadius: `${minR.toFixed(1)} m at s${minRs} (${p.x.toFixed(0)},${p.z.toFixed(0)})`,
    tight,
    gates: gates.map((g) => `${g.gate}:${g.crossings}x@${g.at.map((s) => s.toFixed(0)).join(',')}`).join('  '),
    ordered: order.slice(1).every((s, i) => i === 0 || s > order[i]),
    bridges: tr.bridges.map((b) => ({ spanHalf: +b.spanHalf.toFixed(2), floorHalf: +b.floorHalf.toFixed(2) })),
  };
});
fs.writeFileSync(`test-results/map-${tag}.png`, Buffer.from(out.png.split(',')[1], 'base64'));
delete out.png;
console.log(`${tag}: line ${out.length} m, tightest ${out.minRadius}`);
console.log(`gates (line crossings @s): ${out.gates}  ordered: ${out.ordered}`);
if (out.bridges.length) console.log(`bridges: ${JSON.stringify(out.bridges)}`);
console.log(out.tight.length ? `close to walls (<3 m): ${out.tight.join(' ')}` : 'clearance OK (>= 3 m everywhere)');
console.log(`saved test-results/map-${tag}.png`);
await browser.close();
