// Track data → a height grid. The same grid feeds the Rapier heightfield (src/physics/heightfield.ts) and the
// ground mesh (src/track/build.ts), so what you see is what the wheels ride on.
import type { Feature, TrackData, XZ } from './types';

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
