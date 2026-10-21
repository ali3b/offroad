// Title theme, "Dust Devil": A major, 116 bpm straight 16ths. Brass melody over chugging rhythm guitar, root-fifth
// bass, organ pad and a rock beat. Intro (2 bars) → A (4) → B (4) → A → B, looping.
import type { Song } from '../sequencer';
import { bass, brass, chug, organ } from './patches';
import { bars, chord, rep } from './util';

const rf = (r: string, f: string, lead: string) => `${r}:3 -:1 ${f}:3 -:1 ${r}:3 -:1 ${f}:2 ${lead}:2`;
const ch5 = (r: string) => rep(`${chord(r, '5')}:1 -:1`, 8);

const BEAT = 'kh - h - sh - h - k - kh - sh - h o';

export const title: Song = {
  title: 'Dust Devil',
  bpm: 116,
  stepsPerBeat: 4,
  loop: true,
  channels: {
    lead: { patch: brass, pan: 0.1 },
    gtr: { patch: chug, pan: -0.35 },
    bass: { patch: bass },
    pad: { patch: organ, pan: 0.3 },
    drums: { patch: 'drums', gain: 0.8 },
  },
  patterns: {
    intro: {
      lead: bars('-:16', '-:8 E4:2 G#4:2 B4:4'),
      gtr: bars(`${chord('A3', '5')}:16`, `${chord('E3', '5')}:16`),
      bass: bars('A2:16', 'E2:8 E2:2 G#2:2 B2:4'),
      drums: bars('kc - - - - - - - kc - - - - - - -', 'k - - - t - t - m - m - sx - s s'),
    },
    A: {
      lead: bars('E4:2 A4:2 C#5:4 B4:2 A4:2 E4:4', 'F#4:2 A4:2 D5:6 C#5:2 B4:4', 'C#5:2 E5:2 E5:2 C#5:2 A4:4 B4:2 C#5:2', 'B4:8 -:2 G#4:2 A4:2 B4:2'),
      gtr: bars(ch5('A2'), ch5('D3'), ch5('A2'), ch5('E2')),
      bass: bars(rf('A2', 'E2', 'G#2'), rf('D2', 'A2', 'C#3'), rf('A2', 'E2', 'G#2'), rf('E2', 'B2', 'D#3')),
      pad: bars(`${chord('A3')}:16`, `${chord('D3')}:16`, `${chord('A3')}:16`, `${chord('E3')}:16`),
      drums: bars(BEAT.replace('kh', 'kc'), BEAT, BEAT, BEAT),
    },
    B: {
      lead: bars('C#5:4 F#5:4 E5:2 C#5:2 A4:4', 'D5:4 F#5:2 E5:2 D5:4 A4:4', 'B4:2 C#5:2 D5:2 E5:2 G#4:4 B4:4', 'E5:12 -:4'),
      gtr: bars(ch5('F#2'), ch5('D3'), ch5('E2'), ch5('E2')),
      bass: bars(rf('F#2', 'C#3', 'E2'), rf('D2', 'A2', 'C#3'), rf('E2', 'B2', 'D#3'), 'E2:3 -:1 E2:3 -:1 E2:2 G#2:2 B2:2 D3:2'),
      pad: bars(`${chord('F#3', 'min')}:16`, `${chord('D3')}:16`, `${chord('E3')}:16`, `${chord('E3', '7')}:16`),
      drums: bars(BEAT, BEAT, BEAT, 'kh - h - sh - h - k - s - m - t s'),
    },
  },
  order: ['intro', 'A', 'B', 'A', 'B'],
};
