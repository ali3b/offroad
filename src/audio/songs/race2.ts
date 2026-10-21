// Race loop 2, "Gravel Run": G major, 172 bpm, straight 8ths, train beat. Two-step root-fifth bass, rolling
// banjo-style pluck arpeggios, brass lead; verse (8 bars) then a minor-tinged bridge (8 bars).
import type { Song } from '../sequencer';
import { bass, brass, pluck } from './patches';
import { bars, tr } from './util';

const two = (r: string) => `${r}:2 ${tr(r, -5)}:2 ${r}:2 ${tr(r, -5)}:2`;
const roll = (r: string, minor = false) => {
  const third = minor ? 3 : 4;
  return [0, third, 7, 12, third, 7, 12, 7].map((i) => tr(r, i)).join(' ');
};

const TRAIN = 'kh h sh h kh kh sh h';
const FILL = 'kh h sh h m m t s!';

const VERSE = ['G', 'G', 'C', 'G', 'D', 'C', 'G', 'D'];
const BRIDGE = ['Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D'];
const BASS: Record<string, string> = { G: 'G2', C: 'C3', D: 'D3', Em: 'E3' };
const bassOf = (c: string) => two(BASS[c]);
const rollOf = (c: string) => roll(`${c.replace('m', '')}4`, c.endsWith('m'));

export const race2: Song = {
  title: 'Gravel Run',
  bpm: 172,
  stepsPerBeat: 2,
  loop: true,
  channels: {
    lead: { patch: brass, pan: -0.1 },
    banjo: { patch: pluck, pan: 0.35 },
    bass: { patch: bass },
    drums: { patch: 'drums', gain: 0.8 },
  },
  patterns: {
    verse: {
      lead: bars('D5:2 B4 D5 G5:2 F#5 E5', 'D5:4 B4:2 A4:2', 'G4 A4 C5:2 E5:2 G5:2', 'F#5 G5 D5:4 -:2', 'A4 B4 D5:2 F#5:2 A5:2', 'G5:2 E5:2 C5:2 E5:2', 'D5:2 B4:2 G4 A4 B4:2', 'A4:6 -:2'),
      banjo: VERSE.map(rollOf).join(' | '),
      bass: VERSE.map(bassOf).join(' | '),
      drums: bars(TRAIN.replace('kh', 'kc'), TRAIN, TRAIN, FILL, TRAIN, TRAIN, TRAIN, FILL),
    },
    bridge: {
      lead: bars('B4:2 E5:2 G5:2 E5:2', 'C5:2 E5:2 G5:4', 'B4:2 D5:2 G5:2 B5:2', 'A5:4 F#5:2 D5:2', 'E5 F#5 G5:2 B5:2 G5:2', 'E5 G5 C6:4 B5:2', 'B5:2 A5 G5 D5:2 B4:2', 'A4:2 D5:2 F#5:2 A5:2'),
      banjo: BRIDGE.map(rollOf).join(' | '),
      bass: BRIDGE.map(bassOf).join(' | '),
      drums: bars(TRAIN.replace('kh', 'kc'), TRAIN, TRAIN, TRAIN, TRAIN, TRAIN, FILL, 'kc h sh h s s s! s!'),
    },
  },
  order: ['verse', 'verse', 'bridge'],
};
