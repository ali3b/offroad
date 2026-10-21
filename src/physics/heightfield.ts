// Height grid → Rapier heightfield collider, plus static wall colliders from the track's wall polylines.
import { GROUP, RAPIER } from './world';
import type { HeightGrid } from '../track/heights';
import { sampleHeight } from '../track/heights';
import type { Wall } from '../track/types';

/** Wall collider height above the ground and its thickness (m). */
export const WALL_HEIGHT = 1.3;
export const WALL_THICKNESS = 0.9;

export function addHeightfield(world: RAPIER.World, g: HeightGrid): RAPIER.Collider {
  // Rapier wants a column-major (nrows+1) × (ncols+1) matrix with rows along z and columns along x:
  // heights[i + j·(nz+1)] for row i (z) and column j (x). Our grid is row-major by z, so transpose.
  const rows = g.nz + 1;
  const cols = g.nx + 1;
  const heights = new Float32Array(rows * cols);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) heights[i + j * rows] = g.h[i * cols + j];
  const desc = RAPIER.ColliderDesc.heightfield(g.nz, g.nx, heights, { x: g.w, y: 1, z: g.d })
    .setFriction(0.9)
    .setRestitution(0.05)
    .setCollisionGroups(GROUP.STATIC);
  return world.createCollider(desc);
}

/** One cuboid per wall segment, sunk well into the ground so a truck can't slip under it on a crest. */
export function addWalls(world: RAPIER.World, g: HeightGrid, walls: Wall[]): RAPIER.Collider[] {
  const out: RAPIER.Collider[] = [];
  for (const wall of walls) {
    const n = wall.points.length;
    const segs = wall.closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const [ax, az] = wall.points[k];
      const [bx, bz] = wall.points[(k + 1) % n];
      const len = Math.hypot(bx - ax, bz - az);
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      let top = -Infinity;
      let bottom = Infinity;
      for (let s = 0; s <= 8; s++) {
        const y = sampleHeight(g, ax + ((bx - ax) * s) / 8, az + ((bz - az) * s) / 8);
        top = Math.max(top, y);
        bottom = Math.min(bottom, y);
      }
      const y0 = bottom - 2;
      const y1 = top + WALL_HEIGHT;
      const yaw = Math.atan2(bx - ax, bz - az);
      const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      // Half a thickness of overlap at the joints so corners have no gaps.
      const desc = RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, (y1 - y0) / 2, len / 2 + WALL_THICKNESS / 2)
        .setTranslation(mx, (y0 + y1) / 2, mz)
        .setRotation(q)
        .setFriction(0.2)
        .setRestitution(0.45)
        .setCollisionGroups(GROUP.STATIC);
      out.push(world.createCollider(desc));
    }
  }
  return out;
}
