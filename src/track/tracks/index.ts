// The track registry. Each track is one JSON file (format: ../types.ts, docs/DESIGN.md "Track format").
import type { TrackData } from '../types';
import test from './test.json';
import rattlesnake from './rattlesnake.json';
import coyote from './coyote.json';
import boneyard from './boneyard.json';
import drycreek from './drycreek.json';
import twister from './twister.json';
import buzzard from './buzzard.json';
import thunder from './thunder.json';
import mesa from './mesa.json';

export const TRACKS: Record<string, TrackData> = {
  test: test as TrackData,
  rattlesnake: rattlesnake as TrackData,
  coyote: coyote as TrackData,
  boneyard: boneyard as TrackData,
  drycreek: drycreek as TrackData,
  twister: twister as TrackData,
  buzzard: buzzard as TrackData,
  thunder: thunder as TrackData,
  mesa: mesa as TrackData,
};

/** The eight race tracks in season order (the order they join the rotation). */
export const TRACK_ORDER: string[] = ['rattlesnake', 'coyote', 'boneyard', 'drycreek', 'twister', 'buzzard', 'thunder', 'mesa'];

/** The track for `id`, driven backwards when `reversed` (the line and gates flip; ramps face the other way). */
export function getTrack(id: string, reversed = false): TrackData {
  const t = TRACKS[id];
  if (!t) throw new Error(`unknown track "${id}" (have: ${Object.keys(TRACKS).join(', ')})`);
  if (!reversed) return t;
  if (!t.reverse) throw new Error(`track "${id}" has no reversed variant`);
  const flip = (h: number) => h + Math.PI;
  return {
    ...t,
    id: `${t.id}-r`,
    start: t.reverse.start,
    features: t.features.map((f) => (f.type === 'ramp' ? { ...f, heading: flip(f.heading) } : f)),
    line: t.line ? [...t.line].reverse() : undefined,
    // Gate 0 stays the finish line; the others are crossed in the opposite order.
    gates: t.gates ? [t.gates[0], ...t.gates.slice(1).reverse()] : undefined,
  };
}
