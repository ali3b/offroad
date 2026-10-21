// The Rapier world. Rapier's WASM is inlined in the -compat build, so init() needs no file fetch (works on Pages).
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

/** Arcade gravity: a bit stronger than 9.81 so jumps land briskly at this scale, like the original's. */
export const GRAVITY = -14;
export const PHYSICS_DT = 1 / 60;

export async function createWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = PHYSICS_DT;
  return world;
}
