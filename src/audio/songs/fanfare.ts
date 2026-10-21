// Podium sting, "Top Step": D major, 132 bpm, 4 bars, no loop. Two brass voices in thirds/sixths, bass, toms and
// crashes; ends on a held D.
import type { Song } from '../sequencer';
import { bass, brass } from './patches';
import { bars } from './util';

export const fanfare: Song = {
  title: 'Top Step',
  bpm: 132,
  stepsPerBeat: 4,
  loop: false,
  channels: {
    hi: { patch: brass, pan: 0.2 },
    lo: { patch: brass, pan: -0.2, gain: 0.85 },
    bass: { patch: bass },
    drums: { patch: 'drums', gain: 0.85 },
  },
  patterns: {
    sting: {
      hi: bars('D5:2 D5 D5 A5:6 F#5:2 A5:4', 'G5:2 G5 G5 B5:6 A5:2 G5:4', 'F#5:2 E5:2 F#5:2 A5:2 D6!:8', 'D6:12 -:4'),
      lo: bars('A4:2 A4 A4 F#5:6 D5:2 F#5:4', 'D5:2 D5 D5 G5:6 F#5:2 D5:4', 'D5:2 C#5:2 D5:2 F#5:2 A5!:8', 'A5:12 -:4'),
      bass: bars('D3:4 A2:4 D3:4 A2:4', 'G2:4 D3:4 G2:4 B2:4', 'A2:4 A2:4 A2:4 C#3:4', 'D2:12 -:4'),
      drums: bars('kc - - - t - t - k - - - t - t -', 'kc - - - m - m - k - - - m - m -', 'kc - - - k - - - t t t t m m m m', 'kc! - - - - - - - - - - - - - - -'),
    },
  },
  order: ['sting'],
};
