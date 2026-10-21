// Helpers for writing pattern strings.
import { midiToNote, noteToMidi } from '../sequencer';

export const tr = (note: string, semis: number) => midiToNote(noteToMidi(note) + semis);

const Q: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  '6': [0, 4, 7, 9],
  '5': [0, 7, 12],
};
/** A chord token: chord('A3', 'maj') = 'A3+C#4+E4'. */
export const chord = (root: string, q: keyof typeof Q = 'maj') => Q[q].map((i) => tr(root, i)).join('+');

export const rep = (s: string, n: number) => Array(n).fill(s).join(' ');
export const bars = (...b: string[]) => b.join(' | ');
