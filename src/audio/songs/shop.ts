// Shop theme, "Trading Post": F major, 96 bpm, lazy swing. Walking bass, electric piano on 2 and 4, a harmonica-ish
// reed lead (sparse in the second half), brushed hats. I-vi-ii-V turnaround then IV.
import type { Song } from '../sequencer';
import { bass, epiano, reed } from './patches';
import { bars, rep } from './util';

const comp = (c: string) => `-:2 ${c} - -:2 ${c} -`;
const CH = {
  F: 'F3+A3+C4+E4',
  Dm: 'D3+F3+A3+C4',
  Gm: 'G3+Bb3+D4+F4',
  C7: 'E3+G3+Bb3+C4',
  Bb: 'Bb3+D4+F4+A4',
};
const KEYS = bars(comp(CH.F), comp(CH.Dm), comp(CH.Gm), comp(CH.C7), comp(CH.F), comp(CH.Bb), comp(CH.C7), comp(CH.F));
const WALK = bars('F2:2 A2:2 C3:2 C#3:2', 'D3:2 C3:2 A2:2 F2:2', 'G2:2 Bb2:2 D3:2 B2:2', 'C3:2 Bb2:2 G2:2 E2:2', 'F2:2 A2:2 C3:2 A2:2', 'Bb2:2 D3:2 F2:2 B2:2', 'C3:2 G2:2 Bb2:2 E2:2', 'F2:2 C3:2 F2:4');
const BRUSH = rep('k h sx h k h sx h', 1);

export const shop: Song = {
  title: 'Trading Post',
  bpm: 96,
  stepsPerBeat: 2,
  swing: 0.3,
  loop: true,
  channels: {
    lead: { patch: reed, pan: 0.15, gain: 0.9 },
    keys: { patch: epiano, pan: -0.25 },
    bass: { patch: bass, gain: 0.9 },
    drums: { patch: 'drums', gain: 0.45 },
  },
  patterns: {
    A: {
      lead: bars('C5:2 A4 C5 F5:3 E5', 'D5:4 A4:2 -:2', 'Bb4 A4 G4:2 D5:3 C5', 'Bb4:2 G4:2 E4:2 C5:2', 'A4:2 C5:2 F5:2 A5:2', 'G5:3 F5 D5:2 Bb4:2', 'C5 D5 E5 G5 Bb5:2 G5:2', 'F5:6 -:2'),
      keys: KEYS,
      bass: WALK,
      drums: BRUSH,
    },
    B: {
      lead: bars('-:8', '-:8', '-:8', '-:4 E5 F5 G5:2', '-:8', '-:8', '-:8', '-:4 A4 C5 D5:2'),
      keys: KEYS,
      bass: WALK,
      drums: BRUSH,
    },
  },
  order: ['A', 'B'],
};
