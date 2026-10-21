// A small top-down map of a track drawn from its JSON on a 2D canvas (no WebGL): dirt inside the outer wall, the
// infield, water and mud, ramps, inner walls as tyre lines, the racing line with direction arrows and the chequered
// start line. Used by the shop's "Start Next Race" tile and the Get Ready screen.
import type { TrackData, XZ } from '../../track/types';

export function trackThumb(t: TrackData, w = 220, h = 140): HTMLCanvasElement {
  // Drawn at 2× so it stays crisp when the tile scales it up.
  const c = document.createElement('canvas');
  c.width = w * 2;
  c.height = h * 2;
  c.className = 'or-thumb';
  c.style.aspectRatio = `${w} / ${h}`;
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(2, 2);
  const outer = t.walls[0].points;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of outer) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const pad = 6;
  const s = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (z1 - z0));
  const ox = (w - (x1 - x0) * s) / 2;
  const oz = (h - (z1 - z0) * s) / 2;
  const P = (x: number, z: number): [number, number] => [ox + (x - x0) * s, oz + (z - z0) * s];
  const path = (pts: XZ[], close: boolean) => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
    if (close) g.closePath();
  };
  const ellipse = (e: { x: number; z: number; rx: number; rz: number; rot?: number }) => {
    g.beginPath();
    g.ellipse(...P(e.x, e.z), e.rx * s, e.rz * s, e.rot ?? 0, 0, Math.PI * 2);
  };

  g.fillStyle = '#3a2a1c';
  g.fillRect(0, 0, w, h);
  path(outer, true);
  g.fillStyle = '#b57336';
  g.fill();
  if (t.infield) {
    path(t.infield.points, true);
    g.fillStyle = '#6f7f35';
    g.fill();
  }
  for (const f of t.features) {
    if (f.type === 'ridge') {
      path(f.points, false);
      g.strokeStyle = '#d6a088';
      g.lineWidth = Math.max(2, f.width * s);
      g.stroke();
    } else if (f.type === 'ramp') {
      g.save();
      g.translate(...P(f.x, f.z));
      // Heading 0 faces +z (down the map).
      g.rotate(-f.heading);
      g.fillStyle = '#5e3d22';
      g.fillRect((-f.width / 2) * s, (-f.length / 2) * s, f.width * s, f.length * s);
      g.restore();
    } else if (f.type === 'mound' || f.type === 'dip') {
      ellipse(f);
      g.fillStyle = f.type === 'mound' ? '#c98a4c' : '#7f4a22';
      g.fill();
    }
  }
  for (const z of t.zones) {
    const colour = z.type === 'water' ? '#4f8fc4' : '#553519';
    if ('points' in z) {
      // A creek or channel: a band along a polyline.
      path(z.points, false);
      g.strokeStyle = colour;
      g.lineWidth = Math.max(2, z.width * s);
      g.stroke();
    } else {
      ellipse(z);
      g.fillStyle = colour;
      g.fill();
    }
  }
  // Walls: the outer one thick, inner ones as tyre lines.
  g.lineJoin = 'round';
  g.lineCap = 'round';
  t.walls.forEach((wall, i) => {
    path(wall.points, i === 0 || wall.closed);
    g.strokeStyle = '#151210';
    g.lineWidth = i === 0 ? 4 : 3;
    g.stroke();
  });
  // Racing line with direction ticks.
  if (t.line && t.line.length > 2) {
    g.setLineDash([3, 4]);
    path(t.line, true);
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.lineWidth = 1.5;
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#ffe14a';
    const n = t.line.length;
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 6))) {
      const [ax, az] = P(...t.line[i]);
      const [bx, bz] = P(...t.line[(i + 1) % n]);
      const a = Math.atan2(bz - az, bx - ax);
      g.save();
      g.translate((ax + bx) / 2, (az + bz) / 2);
      g.rotate(a);
      g.beginPath();
      g.moveTo(5, 0);
      g.lineTo(-3, -3.5);
      g.lineTo(-3, 3.5);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
  if (t.gates?.length) {
    const [a, b] = t.gates[0];
    const [ax, az] = P(...a);
    const [bx, bz] = P(...b);
    g.lineWidth = 4;
    g.strokeStyle = '#fff';
    g.beginPath();
    g.moveTo(ax, az);
    g.lineTo(bx, bz);
    g.stroke();
    g.setLineDash([2, 2]);
    g.strokeStyle = '#000';
    g.stroke();
    g.setLineDash([]);
  }
  return c;
}
