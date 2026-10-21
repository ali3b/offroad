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

/** Collision groups (Rapier packs membership in the high 16 bits, the filter in the low 16). */
export const GROUP = {
  /** Ground and walls. */
  STATIC: (0x0001 << 16) | 0xffff,
  /** Truck chassis: collide with everything (walls, ground, each other). */
  TRUCK: (0x0002 << 16) | 0xffff,
  /** Wheel rays: hit only the ground and walls, never another truck's roof. */
  WHEEL_RAY: (0x0004 << 16) | 0x0001,
};
