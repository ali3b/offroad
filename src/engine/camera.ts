// The fixed whole-track camera. The original shows each track on one screen from a high 3/4 angle with very little
// perspective; a narrow-FOV perspective camera far away gives that look while keeping real 3D for jumps and dust.
import * as THREE from 'three';

export const CAMERA = {
  /** Degrees below the horizon. */
  pitch: 58,
  /** Vertical field of view (deg): narrow, so the far wall is barely smaller than the near one. */
  fov: 18,
  /** Screen fraction kept clear at the top for the HUD strip, and margins elsewhere (NDC units, 2 = full). */
  hudTop: 0.02,
  margin: 0.03,
};

/**
 * Place `cam` so the box `bounds` (the track incl. its walls) fills the view below the HUD strip.
 * Binary-searches the distance along the view direction, then nudges the aim to centre the box.
 */
export function fitFixedCamera(cam: THREE.PerspectiveCamera, bounds: THREE.Box3, aspect: number) {
  cam.fov = CAMERA.fov;
  cam.aspect = aspect;
  cam.near = 1;
  cam.far = 2000;
  const pitch = THREE.MathUtils.degToRad(CAMERA.pitch);
  // Looking north (-z) and down.
  const dir = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
  const centre = bounds.getCenter(new THREE.Vector3());
  const corners: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const top = 1 - CAMERA.hudTop;
  const m = 1 - CAMERA.margin;
  const aim = centre.clone();
  const p = new THREE.Vector3();
  const place = (dist: number) => {
    cam.position.copy(aim).addScaledVector(dir, -dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(aim);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      p.copy(c).project(cam);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, x1, y0, y1 };
  };
  let dist = 100;
  for (let pass = 0; pass < 4; pass++) {
    let lo = 10, hi = 2000;
    for (let k = 0; k < 40; k++) {
      dist = (lo + hi) / 2;
      const r = place(dist);
      const fits = r.x0 >= -m && r.x1 <= m && r.y0 >= -m && r.y1 <= top - CAMERA.margin;
      if (fits) hi = dist; else lo = dist;
    }
    dist = hi;
    // Centre the projected box in the free area by moving the aim in screen space (camera right/up on the ground).
    const r = place(dist);
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2 - (top - 1) / 2;
    const right = new THREE.Vector3(1, 0, 0);
    const upOnGround = new THREE.Vector3(0, 0, -1);
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist;
    aim.addScaledVector(right, cx * halfH * aspect).addScaledVector(upOnGround, (cy * halfH) / Math.sin(pitch));
  }
  place(dist);
  return { distance: dist, aim };
}
