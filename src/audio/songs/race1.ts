// Race loop 1, "Mud Boogie": E, 152 bpm, shuffled 8ths. A 12-bar boogie: walking boogie bass, offbeat 7th-chord
// stabs on electric piano, twangy lead playing a hook (chorus 1) and an answering line (chorus 2), shuffle beat.
import type { Song } from '../sequencer';
import { bass, epiano, twang } from './patches';
import { bars, chord, rep, tr } from './util';

const boogie = (r: string) => [0, 4, 7, 9, 10, 9, 7, 4].map((i) => tr(r, i)).join(' ');
const stab = (r: string) => rep(`- ${chord(r, '7')}`, 4);
const FORM = ['E2', 'E2', 'E2', 'E2', 'A2', 'A2', 'E2', 'E2', 'B2', 'A2', 'E2', 'B2'];

const SHUF = 'kh h sh h kh h sh h';
const FILL = 'kh h sh h k m t s!';

const hook = 'B4 D5 E5:2 - G4 G#4:2';
const hookA = 'E5 G5 A5:2 - C5 C#5:2';

export const race1: Song = {
  title: 'Mud Boogie',
  bpm: 152,
  stepsPerBeat: 2,
  swing: 0.33,
  loop: true,
  channels: {
    lead: { patch: twang, pan: 0.15 },
    keys: { patch: epiano, pan: -0.3 },
    bass: { patch: bass },
    drums: { patch: 'drums', gain: 0.85 },
  },
  patterns: {
    one: {
      lead: bars(hook, 'E5:3 D5 B4:2 G4 G#4', hook, 'E5:2 G5 E5 D5 B4 -:2', hookA, 'A5:3 G5 E5:2 C5 C#5', hook, 'E5:6 -:2', 'F#5 A5 B5:4 A5 F#5', 'E5 G5 A5:4 G5 E5', 'B4 D5 E5:2 G#4:2 B4:2', 'B4 A4 G#4 F#4 D#4:2 B3:2'),
      keys: FORM.map((r) => stab(tr(r, 12))).join(' | '),
      bass: FORM.map(boogie).join(' | '),
      drums: bars(SHUF.replace('kh', 'kc'), SHUF, SHUF, FILL, SHUF, SHUF, SHUF, FILL, SHUF, SHUF, SHUF, FILL),
    },
    two: {
      lead: bars('G#5:2 B5:2 G#5 E5 -:2', 'D5 E5 G5 G#5 E5:4', 'G#5:2 B5:2 G#5 E5 -:2', 'B4 D5 E5 G5 G#5:4', 'C#6:2 E6:2 C#6 A5 -:2', 'G5 A5 C6 C#6 A5:4', 'G#5:2 B5:2 G#5 E5 -:2', 'E5 G5 E5 D5 B4:4', 'D#5:2 F#5:2 B5:4', 'C#5:2 E5:2 A5:4', 'G#5 F#5 E5 D5 B4:2 G#4:2', 'B4:2 D#5:2 F#5:2 A5:2'),
      keys: FORM.map((r) => stab(tr(r, 12))).join(' | '),
      bass: FORM.map(boogie).join(' | '),
      drums: bars(SHUF.replace('kh', 'kc'), SHUF, SHUF, SHUF, SHUF, SHUF, SHUF, FILL, SHUF, SHUF, FILL, 'kc h sh h k s s! s!'),
    },
  },
  order: ['one', 'two'],
};
