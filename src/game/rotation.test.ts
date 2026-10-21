import { describe, expect, it } from 'vitest';
import { raceAt } from './rotation';

/** The rotation as text, e.g. "1 2 | 1r 2r 3 | …", for the first `cycles` cycles. */
function table(n: number, races: number) {
  const out: string[][] = [];
  for (let r = 0; r < races; r++) {
    const s = raceAt(n, r);
    (out[s.cycle - 1] ??= []).push(`${s.index + 1}${s.reversed ? 'r' : ''}`);
  }
  return out.map((c) => c.join(' '));
}

describe('season rotation', () => {
  it('matches the original pattern with 8 tracks', () => {
    // 2+3+4+5+6+7+8 ramp-up races, then two full 8-track cycles.
    const t = table(8, 35 + 16);
    expect(t).toEqual([
      '1 2',
      '1r 2r 3',
      '1 2 3r 4',
      '1r 2r 3 4r 5',
      '1 2 3r 4 5r 6',
      '1r 2r 3 4r 5 6r 7',
      '1 2 3r 4 5r 6 7r 8',
      '1r 2r 3 4r 5 6r 7 8r',
      '1 2 3r 4 5r 6 7r 8',
    ]);
  });

  it('brings track 8 in at race 35 (1-based)', () => {
    const first8 = Array.from({ length: 60 }, (_, r) => raceAt(8, r)).findIndex((s) => s.index === 7);
    expect(first8 + 1).toBe(35);
  });

  it('jumps straight to far-off races', () => {
    for (const r of [35, 100, 999]) {
      // Walk there race by race and compare.
      let c = 1;
      let pos = 0;
      for (let k = 0; k < r; k++) {
        pos++;
        if (pos >= Math.min(8, c + 1)) {
          pos = 0;
          c++;
        }
      }
      const s = raceAt(8, r);
      expect([s.cycle, s.index]).toEqual([c, pos]);
    }
  });

  it('works with fewer tracks (the registry before all 8 land)', () => {
    expect(table(1, 4)).toEqual(['1', '1r', '1', '1r']);
    expect(table(2, 6)).toEqual(['1 2', '1r 2r', '1 2']);
    expect(table(3, 2 + 3 + 3 + 3)).toEqual(['1 2', '1r 2r 3', '1 2 3r', '1r 2r 3']);
  });
});
