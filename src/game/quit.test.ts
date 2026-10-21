// QUIT TO TITLE during a season race counts as last place for every human: credit lost, no prize, no bags.
import { describe, expect, it } from 'vitest';
import { START_CREDITS } from './economy';
import { newSeason, outPlayers, settleQuit } from './season';

describe('quitting a season race', () => {
  it('puts a lone human last: credit lost, no prize, the season moves on', () => {
    const s = newSeason([{ initials: 'ACE', colour: 'red' }]);
    s.players[0].cash = 50_000;
    const q = settleQuit(s, [2, 5, 5, 5], 'rattlesnake');
    expect(q.players[0]).toMatchObject({ cash: 50_000, credits: START_CREDITS - 1, nitros: 2 });
    expect(q.last).toMatchObject({ track: 'rattlesnake', places: [4, 1, 2, 3] });
    expect(q.last!.outcomes[0]).toMatchObject({ creditLost: true, free: false });
    expect(q.race).toBe(1);
    expect(q.cpus.reduce((a, c) => a + c.cash, 0)).toBe(0);
  });

  it('puts every human behind every CPU truck', () => {
    const s = newSeason([
      { initials: 'ACE', colour: 'blue' },
      { initials: 'JET', colour: 'red' },
    ]);
    const q = settleQuit(s, [4, 4, 5, 5], 'buzzard');
    expect(q.last!.places).toEqual([3, 4, 1, 2]);
    expect(q.players.map((p) => [p.cash, p.credits])).toEqual([
      [0, START_CREDITS - 1],
      [0, START_CREDITS - 1],
    ]);
  });

  it('runs a human with one credit out of credits', () => {
    const s = newSeason([{ initials: 'ACE', colour: 'red' }]);
    s.players[0].credits = 1;
    const q = settleQuit(s, [3, 5, 5, 5], 'rattlesnake');
    expect(q.last!.outcomes[0]).toMatchObject({ out: true, credits: 0 });
    expect(outPlayers(q)).toEqual([0]);
  });
});
