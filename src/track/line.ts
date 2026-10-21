// The racing line: a closed centripetal Catmull-Rom spline through the track's `line` points, resampled every
// STEP metres so distance along it (s) is uniform. CPU drivers steer at a point ahead on it, pickups spawn on it and
// race positions compare progress along it.
import type { XZ } from './types';

const STEP = 0.5;

export interface LineProjection {
  /** Distance along the line (0..length). */
  s: number;
  /** Distance from the line (m). */
  dist: number;
  /** Signed sideways offset: positive to the left of the driving direction. */
  lateral: number;
}

export class RacingLine {
  readonly length: number;
  /** Samples: x, z per point, every STEP metres. */
  private readonly px: Float32Array;
  private readonly pz: Float32Array;
  private readonly n: number;

  constructor(points: XZ[]) {
    // Dense Catmull-Rom (centripetal, alpha 0.5), then resample by arc length.
    const dense: XZ[] = [];
    const m = points.length;
    for (let i = 0; i < m; i++) {
      const p0 = points[(i - 1 + m) % m];
      const p1 = points[i];
      const p2 = points[(i + 1) % m];
      const p3 = points[(i + 2) % m];
      const segs = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.25));
      for (let k = 0; k < segs; k++) dense.push(catmullRom(p0, p1, p2, p3, k / segs));
    }
    dense.push(dense[0]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = cum[cum.length - 1];
    this.n = Math.floor(total / STEP);
    this.length = this.n * STEP;
    this.px = new Float32Array(this.n);
    this.pz = new Float32Array(this.n);
    let j = 0;
    for (let k = 0; k < this.n; k++) {
      const s = (k * STEP * total) / this.length;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      this.px[k] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t;
      this.pz[k] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t;
    }
  }

  wrap(s: number) {
    return ((s % this.length) + this.length) % this.length;
  }

  /** Signed shortest distance from a to b along the loop (-length/2..length/2). */
  delta(a: number, b: number) {
    let d = this.wrap(b - a);
    if (d > this.length / 2) d -= this.length;
    return d;
  }

  pointAt(s: number): { x: number; z: number } {
    const f = this.wrap(s) / STEP;
    const i = Math.floor(f) % this.n;
    const k = (i + 1) % this.n;
    const t = f - Math.floor(f);
    return { x: this.px[i] + (this.px[k] - this.px[i]) * t, z: this.pz[i] + (this.pz[k] - this.pz[i]) * t };
  }

  /** Unit tangent (driving direction) at s. */
  tangentAt(s: number): { x: number; z: number } {
    const a = this.pointAt(s - STEP);
    const b = this.pointAt(s + STEP);
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }

  /** Heading (yaw, 0 = +z) of the line at s. */
  headingAt(s: number) {
    const t = this.tangentAt(s);
    return Math.atan2(t.x, t.z);
  }

  /** Turn rate of the line (rad/m) at s, measured over ±2 m. */
  curvatureAt(s: number) {
    const a = this.headingAt(s - 2);
    const b = this.headingAt(s + 2);
    return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) / 4;
  }

  /** Largest curvature over [s, s + ahead]. */
  maxCurvature(s: number, ahead: number) {
    let k = 0;
    for (let d = 0; d <= ahead; d += 1.5) k = Math.max(k, this.curvatureAt(s + d));
    return k;
  }

  /**
   * Nearest point on the line. With a hint (the last known s) only a window around it is searched, so a truck on
   * one pass of a serpentine never snaps to the parallel pass next door.
   */
  project(x: number, z: number, hint?: number, window = 40): LineProjection {
    let best = -1;
    let bestD = Infinity;
    const scan = (from: number, count: number) => {
      for (let c = 0; c < count; c++) {
        const k = (((from + c) % this.n) + this.n) % this.n;
        const d = (this.px[k] - x) ** 2 + (this.pz[k] - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
    };
    if (hint !== undefined) {
      const w = Math.round(window / STEP);
      scan(Math.round(this.wrap(hint) / STEP) - w, w * 2 + 1);
    }
    if (best < 0 || bestD > 18 * 18) scan(0, this.n);
    const s = best * STEP;
    const t = this.tangentAt(s);
    const dx = x - this.px[best];
    const dz = z - this.pz[best];
    // Left of the direction (tx, tz) in this frame (x east, z south, seen from above) is (tz, -tx).
    return { s, dist: Math.sqrt(bestD), lateral: dx * t.z - dz * t.x };
  }

  /** Points every `step` metres (for drawing and debugging). */
  samples(step = 2): XZ[] {
    const out: XZ[] = [];
    for (let s = 0; s < this.length; s += step) {
      const p = this.pointAt(s);
      out.push([p.x, p.z]);
    }
    return out;
  }
}

function catmullRom(p0: XZ, p1: XZ, p2: XZ, p3: XZ, t: number): XZ {
  const d = (a: XZ, b: XZ) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: XZ, b: XZ, ta: number, tb: number): XZ => {
    const w = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}
