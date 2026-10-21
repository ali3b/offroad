// The season's track rotation, true to the original's home versions: races come in cycles; cycle 1 is tracks 1–2,
// every later cycle replays the earlier tracks and adds the next one; each track flips direction every time it comes
// round. Once all tracks are in, every cycle has them all and the pattern keeps alternating forever.
//
//   cycle 1: 1  2
//   cycle 2: 1r 2r 3
//   cycle 3: 1  2  3r 4          … track t first appears in cycle first(t) = (t ≤ 2 ? 1 : t − 1), driven forwards,
//   cycle 4: 1r 2r 3  4r 5         and is reversed in cycle c when c − first(t) is odd.
//
// Pure: works for any number of tracks n ≥ 1 (with n = 1 the one track alternates forward / reversed).

export interface RotationSlot {
  /** 0-based index into the track order. */
  index: number;
  reversed: boolean;
  /** 1-based cycle and position in it (for the shop's "RACE n" line). */
  cycle: number;
  pos: number;
}

/** Number of tracks in cycle c (1-based) with n tracks in the order. */
export const cycleLength = (n: number, c: number) => Math.min(n, c + 1);

/** First cycle (1-based) that has track number t (1-based). */
export const firstCycle = (t: number) => (t <= 2 ? 1 : t - 1);

/** The race at 0-based season index `race` with `n` tracks in the order. */
export function raceAt(n: number, race: number): RotationSlot {
  if (n < 1) throw new Error('no tracks in the rotation');
  let c = 1;
  let r = Math.max(0, Math.floor(race));
  // Ramp-up cycles grow by one; from cycle n−1 on every cycle has all n tracks (jump there in one go).
  while (cycleLength(n, c) < n) {
    const len = cycleLength(n, c);
    if (r < len) break;
    r -= len;
    c++;
  }
  if (cycleLength(n, c) === n && r >= n) {
    c += Math.floor(r / n);
    r %= n;
  }
  const t = r + 1;
  return { index: r, reversed: (c - firstCycle(t)) % 2 === 1, cycle: c, pos: r + 1 };
}
