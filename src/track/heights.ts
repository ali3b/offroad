// Track data → a height grid. The same grid feeds the Rapier heightfield (src/physics/heightfield.ts) and the
// ground mesh (src/track/build.ts), so what you see is what the wheels ride on.
import type { BridgeFeature, Feature, TrackData, XZ } from './types';

export interface HeightGrid {
  /** Cells along x and z; the grid has (nx + 1) × (nz + 1) samples. */
  nx: number;
  nz: number;
  res: number;
  w: number;
  d: number;
  /** Row-major by z: h[i * (nx + 1) + j] is the sample at x = -w/2 + j·res, z = -d/2 + i·res. */
  h: Float32Array;
  /** 0..1 per sample: how much of the infield (grass) it is, for colouring. */
  infield: Float32Array;
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Signed distance to a polygon (negative inside). */
export function polygonDistance(x: number, z: number, pts: XZ[]): number {
  let d = Infinity;
  let inside = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside ? -d : d;
}

/** Distance from a point to a polyline. */
export function polylineDistance(x: number, z: number, pts: XZ[]): number {
  let d = Infinity;
  for (let a = 0; a < pts.length - 1; a++) {
    const [ax, az] = pts[a];
    const [bx, bz] = pts[a + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d;
}

/**
 * Distance to a polyline, the signed sideways offset from its nearest segment (+ = left of its direction) and how far
 * the point lies beyond the polyline's ends (0 alongside it).
 */
export function polylineOffset(x: number, z: number, pts: XZ[]): { d: number; lateral: number; beyond: number } {
  let best = Infinity;
  let lateral = 0;
  let beyond = 0;
  for (let a = 0; a < pts.length - 1; a++) {
    const [ax, az] = pts[a];
    const [bx, bz] = pts[a + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez;
    const l = Math.sqrt(l2);
    const raw = ((x - ax) * ex + (z - az) * ez) / l2;
    const t = Math.max(0, Math.min(1, raw));
    const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
    if (d < best) {
      best = d;
      // Left of (ex, ez) seen from above (x east, z south) is (ez, -ex).
      lateral = ((x - ax) * ez - (z - az) * ex) / l;
      beyond = a === 0 && raw < 0 ? -raw * l : a === pts.length - 2 && raw > 1 ? (raw - 1) * l : 0;
    }
  }
  return { d: best, lateral, beyond };
}

/** A bridge's frame: the deck runs along (ux, uz) for ±spanHalf, the cutting along (wx, wz) under it. */
export interface BridgeFrame {
  f: BridgeFeature;
  ux: number;
  uz: number;
  wx: number;
  wz: number;
  /** Half the deck's length: covers the cutting where it crosses the deck's full width, plus a bearing on each side. */
  spanHalf: number;
  /** Half the cutting's flat floor length along the lower lane (under the whole deck). */
  floorHalf: number;
}

export function bridgeFrame(f: BridgeFeature): BridgeFrame {
  const a = f.heading - f.under.heading;
  const sa = Math.max(0.3, Math.abs(Math.sin(a)));
  const ta = Math.abs(Math.cos(a)) / sa;
  return {
    f,
    ux: Math.sin(f.heading),
    uz: Math.cos(f.heading),
    wx: Math.sin(f.under.heading),
    wz: Math.cos(f.under.heading),
    spanHalf: f.under.width / 2 / sa + (f.width / 2 + 0.5) * ta + 0.8,
    floorHalf: (f.width / 2 + 1) / sa + (f.under.width / 2) * ta + 0.5,
  };
}

/** Local coordinates of a point in a bridge's frame: u along the deck, v across it, u2 along the cutting, v2 across. */
export function bridgeLocal(b: BridgeFrame, x: number, z: number) {
  const dx = x - b.f.x;
  const dz = z - b.f.z;
  return { u: dx * b.ux + dz * b.uz, v: dx * b.uz - dz * b.ux, u2: dx * b.wx + dz * b.wz, v2: dx * b.wz - dz * b.wx };
}

/** The ground under and around a bridge: the embankment and ramps of the upper lane, cut by the lower lane. */
export function applyBridge(b: BridgeFrame, x: number, z: number, h: number): number {
  const f = b.f;
  const { u, v, u2, v2 } = bridgeLocal(b, x, z);
  // Embankment: flat at the deck height out to a metre past the deck, then the ramps; its sides fall over 2.5 m.
  const flat = b.spanHalf + 1;
  const along = Math.abs(u) <= flat ? 1 : 1 - smooth((Math.abs(u) - flat) / f.ramp);
  const across = 1 - smooth((Math.abs(v) - f.width / 2 - 1) / 2.5);
  if (along > 0 && across > 0) h = Math.max(h, f.height * along * across);
  // Cutting: the lower lane's floor at -depth under the deck, sloping up over `under.ramp`; its walls are steep.
  const side = 1 - smooth((Math.abs(v2) - f.under.width / 2) / 0.7);
  if (side > 0) {
    const fl = Math.abs(u2) <= b.floorHalf ? 1 : 1 - smooth((Math.abs(u2) - b.floorHalf) / f.under.ramp);
    if (fl > 0) {
      const cut = Math.min(h, h * (1 - fl) - f.under.depth * fl);
      h = h * (1 - side) + cut * side;
    }
  }
  return h;
}

/** True when (x, z) lies on a bridge deck's footprint (with `margin` metres to spare). */
export function onDeck(b: BridgeFrame, x: number, z: number, margin = 0): boolean {
  const { u, v } = bridgeLocal(b, x, z);
  return Math.abs(u) <= b.spanHalf + margin && Math.abs(v) <= b.f.width / 2 + 0.5 + margin;
}

export function featureHeight(f: Feature, x: number, z: number): number {
  switch (f.type) {
    case 'ridge': {
      // A smooth hump across the band: flat-ish top, rounded shoulders.
      const r = polylineDistance(x, z, f.points) / (f.width / 2);
      return r >= 1 ? 0 : f.height * (1 - smooth(r));
    }
    case 'ramp': {
      // u along the heading from the ramp's foot, v across it. The ramp rises to `height` and ends in a sharp drop.
      const s = Math.sin(f.heading);
      const c = Math.cos(f.heading);
      const dx = x - f.x;
      const dz = z - f.z;
      const u = dx * s + dz * c + f.length / 2;
      const v = Math.abs(dx * c - dz * s);
      if (u < 0 || u > f.length + 0.6) return 0;
      const rise = u <= f.length ? Math.pow(u / f.length, 1.25) : 1 - (u - f.length) / 0.6;
      const side = 1 - smooth((v - f.width / 2) / 1.2);
      return f.height * rise * side;
    }
    case 'dip': {
      const r = Math.hypot((x - f.x) / f.rx, (z - f.z) / f.rz);
      return r >= 1.35 ? 0 : -f.depth * (1 - smooth(r / 1.35));
    }
    case 'mound': {
      const r = Math.hypot((x - f.x) / f.rx, (z - f.z) / f.rz);
      return r >= 1 ? 0 : f.height * (1 - smooth(r));
    }
    case 'bank': {
      // Signed offset across the band (+ = left of the polyline's direction), tilted up towards `side`.
      // Rises across the band towards the raised side, then rolls off over 2.5 m beyond it; fades out past the ends.
      const { lateral, beyond } = polylineOffset(x, z, f.points);
      const l = lateral * f.side;
      if (l < -f.width / 2 || beyond > 4) return 0;
      const across = l <= f.width / 2 ? smooth(l / f.width + 0.5) : 1 - smooth((l - f.width / 2) / 2.5);
      return f.height * across * (1 - smooth(beyond / 4));
    }
    case 'plateau': {
      const d = polygonDistance(x, z, f.points);
      return d <= 0 ? f.height : f.height * (1 - smooth(d / f.slope));
    }
    case 'bridge':
      // Applied after the sum of the other features (applyBridge): it cuts and fills rather than adds.
      return 0;
    case 'whoops': {
      const s = Math.sin(f.heading);
      const c = Math.cos(f.heading);
      const dx = x - f.x;
      const dz = z - f.z;
      const u = dx * s + dz * c;
      const v = Math.abs(dx * c - dz * s);
      if (Math.abs(u) > f.length / 2 || v > f.width / 2 + 1) return 0;
      const ends = smooth((f.length / 2 - Math.abs(u)) / 1.5) * (1 - smooth((v - f.width / 2 + 1) / 2));
      return f.amp * 0.5 * (1 - Math.cos((2 * Math.PI * (u + f.length / 2)) / f.wavelength)) * ends;
    }
  }
}

export function buildHeights(t: TrackData): HeightGrid {
  const nx = Math.round(t.size.w / t.res);
  const nz = Math.round(t.size.d / t.res);
  const h = new Float32Array((nx + 1) * (nz + 1));
  const infield = new Float32Array(h.length);
  const { amp, freq } = t.baseNoise;
  const bridges = t.features.filter((f): f is BridgeFeature => f.type === 'bridge').map(bridgeFrame);
  for (let i = 0; i <= nz; i++) {
    const z = -t.size.d / 2 + i * t.res;
    for (let j = 0; j <= nx; j++) {
      const x = -t.size.w / 2 + j * t.res;
      // Rolling ground: a few incommensurate sines (deterministic, no seed needed).
      let y =
        amp *
        (0.55 * Math.sin(x * freq + 0.7) * Math.cos(z * freq * 1.3 - 0.4) +
          0.3 * Math.sin((x + z) * freq * 2.1 + 1.9) +
          0.15 * Math.cos((x - 2 * z) * freq * 3.7));
      for (const f of t.features) y += featureHeight(f, x, z);
      for (const b of bridges) y = applyBridge(b, x, z, y);
      const inf = t.infield ? 1 - smooth((polygonDistance(x, z, t.infield.points) + 1) / 2.5) : 0;
      if (t.infield) y += t.infield.raise * inf;
      h[i * (nx + 1) + j] = y;
      infield[i * (nx + 1) + j] = inf;
    }
  }
  return { nx, nz, res: t.res, w: t.size.w, d: t.size.d, h, infield };
}

/** Bilinear height at a world point (clamped to the grid). */
export function sampleHeight(g: HeightGrid, x: number, z: number): number {
  const fj = Math.min(g.nx - 1e-6, Math.max(0, (x + g.w / 2) / g.res));
  const fi = Math.min(g.nz - 1e-6, Math.max(0, (z + g.d / 2) / g.res));
  const j = Math.floor(fj);
  const i = Math.floor(fi);
  const tx = fj - j;
  const tz = fi - i;
  const r = g.nx + 1;
  const a = g.h[i * r + j];
  const b = g.h[i * r + j + 1];
  const c = g.h[(i + 1) * r + j];
  const d = g.h[(i + 1) * r + j + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
