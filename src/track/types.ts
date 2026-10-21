// Track data: one JSON file per track (src/track/tracks/<id>.json, registered in src/track/tracks/index.ts).
// Coordinates are metres on the ground plane: x to the right of the screen (east), z towards the camera (south),
// y up. A heading is a yaw in radians where 0 faces +z and +π/2 faces +x (three.js / Rapier rotation about +y).
// The format is documented in docs/DESIGN.md ("Track format").

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
  /** Draw it as a plank ramp (dark boards across the lane). */
  planks?: boolean;
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

/** A raised band of earth along a polyline (a hump on every lane it crosses), drawn sun-bleached pink. */
export interface RidgeFeature {
  type: 'ridge';
  points: XZ[];
  /** Full width of the band at its foot (m). */
  width: number;
  height: number;
}

/**
 * A banked lane: the ground tilts across a band along a polyline, rising to `height` on one side (`side` +1 = the
 * left of the polyline's direction, -1 = the right) and staying at 0 on the other.
 */
export interface BankFeature {
  type: 'bank';
  points: XZ[];
  width: number;
  height: number;
  side: 1 | -1;
}

/** A flat-topped tableland over a polygon, its sides sloping down over `slope` metres outside the polygon. */
export interface PlateauFeature {
  type: 'plateau';
  points: XZ[];
  height: number;
  slope: number;
}

/**
 * A crossover: the upper lane climbs an embankment (`ramp` m each side) onto a deck at `height` that spans the lower
 * lane, which runs underneath in a cutting `under.depth` deep. The deck is its own collider (the heightfield below it
 * is the cutting), with railings on both edges; trucks on the deck never touch the lane below. `x, z` is where the
 * two lanes' centrelines cross, `heading` the upper lane's direction, `under.heading` the lower lane's.
 */
export interface BridgeFeature {
  type: 'bridge';
  x: number;
  z: number;
  heading: number;
  /** Deck (upper lane) width between the railings. */
  width: number;
  /** Deck top height (m above the arena floor). */
  height: number;
  /** Length of each approach ramp. */
  ramp: number;
  under: {
    heading: number;
    /** Width of the cutting (the lower lane) under the deck. */
    width: number;
    depth: number;
    /** Length of each slope down into the cutting, measured from the deck's edge. */
    ramp: number;
  };
}

export type Feature = RampFeature | DipFeature | MoundFeature | WhoopsFeature | RidgeFeature | BankFeature | PlateauFeature | BridgeFeature;

export interface Wall {
  kind: 'tyres' | 'barrier';
  closed: boolean;
  points: XZ[];
}

/** An ellipse (x, z, rx, rz), or a band of `width` along a polyline (`points`, e.g. a creek). */
type ZoneShape =
  | { shape: 'ellipse'; x: number; z: number; rx: number; rz: number }
  | { shape: 'path'; points: XZ[]; width: number };

export type WaterZone = ZoneShape & {
  type: 'water';
  /** Water surface height (m). */
  level: number;
  /** Velocity drag (1/s) while the truck is in the water. */
  drag: number;
};

/** Mud: drag and less grip, drawn as a darker, wet-looking patch that follows the ground. */
export type MudZone = ZoneShape & {
  type: 'mud';
  drag: number;
  /** Multiplier on the lateral grip assist (1 = dry). */
  grip: number;
};

export type Zone = WaterZone | MudZone;

/** A screen element placed over an empty spot of the arena (world point, projected each frame). */
export interface Anchor {
  x: number;
  z: number;
}

export interface StartData {
  heading: number;
  /** Grid slots in order: slot 0 is the player (pole), then the CPU trucks. */
  grid: XZ[];
}

export interface TrackData {
  id: string;
  name: string;
  size: { w: number; d: number };
  /** Heightfield cell size (m). */
  res: number;
  baseNoise: { amp: number; freq: number };
  /** Optional raised grass infield. */
  infield?: { points: XZ[]; raise: number };
  features: Feature[];
  /** walls[0] is the outer wall (closed); open polylines get a flag pole at each free end. */
  walls: Wall[];
  zones: Zone[];
  start: StartData;
  /** Closed racing line in the forward direction (control points of a Catmull-Rom spline). */
  line?: XZ[];
  /** Ordered checkpoint gates (wall to wall). Gate 0 is the start/finish line. */
  gates?: [XZ, XZ][];
  /** Where the race HUD panel and the track name sit (an empty spot of the arena). */
  hud?: { panel: Anchor; name: Anchor };
  /** The flagman's tower next to the start line. */
  flagman?: Anchor & { heading: number };
  laps?: number;
  /** The reversed variant: the line and gates are driven backwards; it needs its own grid. */
  reverse?: { start: StartData };
  /** Static dressing (tyre piles, barrels, hay bales, cones): drawn, not collided. */
  props?: { kind: 'tyre_pile' | 'barrel' | 'hay_bale' | 'cone'; x: number; z: number; rot?: number }[];
  /** The track's own colours (CSS colours); anything left out keeps the default sandy arena. */
  palette?: Palette;
}

export interface Palette {
  dirt?: string;
  dirtDark?: string;
  dirtLight?: string;
  /** Raised ridges, plateaus and banks. */
  ridge?: string;
  /** The tyre walls' two paint bands. */
  wallA?: string;
  wallB?: string;
  /** Flags on the free wall ends and bridge bunting. */
  flag?: string;
  /** The stadium's back wall. */
  backWall?: string;
  /** Barrels and cones. */
  accent?: string;
}
