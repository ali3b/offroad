// Track data: one JSON file per track (src/track/<id>.json). Coordinates are metres on the ground plane:
// x to the right of the screen (east), z towards the camera (south), y up. A heading is a yaw in radians where
// 0 faces +z and +π/2 faces +x (three.js / Rapier rotation about +y).

export type XZ = [number, number];

export interface RampFeature {
  type: 'ramp';
  x: number;
  z: number;
  /** Direction the truck drives up the ramp. */
  heading: number;
  length: number;
  width: number;
  height: number;
}

export interface DipFeature {
  type: 'dip';
  x: number;
  z: number;
  rx: number;
  rz: number;
  depth: number;
}

export interface MoundFeature {
  type: 'mound';
  x: number;
  z: number;
  rx: number;
  rz: number;
  height: number;
}

/** A run of bumps across the lane ("whoops"), crests perpendicular to the heading. */
export interface WhoopsFeature {
  type: 'whoops';
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
  wavelength: number;
  amp: number;
}

export type Feature = RampFeature | DipFeature | MoundFeature | WhoopsFeature;

export interface Wall {
  kind: 'tyres' | 'barrier';
  closed: boolean;
  points: XZ[];
}

export interface WaterZone {
  type: 'water';
  shape: 'ellipse';
  x: number;
  z: number;
  rx: number;
  rz: number;
  /** Water surface height (m). */
  level: number;
  /** Velocity drag (1/s) while the truck is in the water. */
  drag: number;
}

export type Zone = WaterZone;

export interface TrackData {
  id: string;
  name: string;
  size: { w: number; d: number };
  /** Heightfield cell size (m). */
  res: number;
  baseNoise: { amp: number; freq: number };
  infield: { points: XZ[]; raise: number };
  features: Feature[];
  walls: Wall[];
  zones: Zone[];
  start: { heading: number; grid: XZ[] };
}
