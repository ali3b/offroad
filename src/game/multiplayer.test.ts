// Local multiplayer (OR4): 2–3 humans with their own cash, credits, upgrades and nitros; drop-to-CPU; the v1 → v2
// save migration; the pad lending order.
import { describe, expect, it } from 'vitest';
import { buy, START_CREDITS, STOCK_LEVELS, takeContinue } from './economy';
import { dropToCpu, entriesFor, lineup, migrateSeason, modsBySlot, newSeason, nitrosBySlot, outPlayers, settleRace, SEASON_VERSION } from './season';
import { padsFor } from '../engine/input';
import type { RacerResult } from '../race/race';

const res = (places: number[], bags = [0, 0, 0, 0]): RacerResult[] =>
  places.map((place, slot) => ({ slot, place, time: 60 + place, prize: [100_000, 90_000, 80_000, 70_000][place - 1], bags: bags[slot], lapTimes: [], best: null, avg: null }));

const two = () =>
  newSeason([
    { initials: 'ACE', colour: 'blue' },
    { initials: 'JET', colour: 'red' },
  ]);

describe('a 2-player season', () => {
  it('puts both humans first in the line-up, CPU drivers in the free colours', () => {
    const s = two();
    expect(lineup(s).map((l) => `${l.kind}:${l.colour}`)).toEqual(['player:blue', 'player:red', 'cpu:yellow', 'cpu:grey']);
    const e = entriesFor(s);
    expect(e.slice(0, 2).map((x) => [x.nick, x.human])).toEqual([
      ['ACE', true],
      ['JET', true],
    ]);
    expect(e[2]).toMatchObject({ nick: 'BUCKSHOT', colour: 'yellow' });
    expect(e[2].human).toBeFalsy();
  });

  it('splits the keyboard: WASD, arrows (a lone player keeps both)', () => {
    expect(two().players.map((p) => p.keys)).toEqual(['wasd', 'arrows']);
    expect(newSeason([{ initials: 'ACE', colour: 'red' }]).players[0].keys).toBe('solo');
    const three = newSeason([
      { initials: 'A', colour: 'red' },
      { initials: 'B', colour: 'yellow' },
      { initials: 'C', colour: 'blue' },
    ]);
    expect(three.players.map((p) => p.keys)).toEqual(['wasd', 'arrows', null]);
    expect(three.cpus.map((c) => c.colour)).toEqual(['grey']);
  });

  it('banks each human their own prize, bags and nitros', () => {
    let s = two();
    s = settleRace(s, res([2, 4, 1, 3], [10_000, 20_000, 0, 0]), [20, 11, 3, 4], 'rattlesnake');
    expect(s.players[0]).toMatchObject({ cash: 90_000 + 10_000, nitros: 20 });
    expect(s.players[1]).toMatchObject({ cash: 70_000 + 20_000, nitros: 11 });
    expect(nitrosBySlot(s)).toEqual([20, 11, 10, 10]);
  });

  it('takes a credit only from a human beaten by a CPU truck', () => {
    let s = two();
    // ACE 1st, the yellow CPU 2nd, JET 3rd: JET loses a credit, ACE races free.
    s = settleRace(s, res([1, 3, 2, 4]), [25, 25, 0, 0], 't');
    expect(s.players.map((p) => p.credits)).toEqual([START_CREDITS, START_CREDITS - 1]);
    expect(s.last!.outcomes.map((o) => [o.free, o.creditLost])).toEqual([
      [true, false],
      [false, true],
    ]);
    // JET 1st, ACE 2nd, CPUs behind: a human ahead costs nothing, both race free.
    s = settleRace(s, res([2, 1, 3, 4]), [25, 25, 0, 0], 't');
    expect(s.players.map((p) => p.credits)).toEqual([START_CREDITS, START_CREDITS - 1]);
    expect(s.last!.outcomes.every((o) => o.free)).toBe(true);
  });

  it('keeps upgrades per human (shop and truck mods)', () => {
    const s = two();
    s.players[0].cash = s.players[1].cash = 100_000;
    const a = buy(s.players[0], 'tires');
    const b = buy(s.players[1], 'shocks');
    if (!a.ok || !b.ok) throw new Error('should buy');
    s.players[0] = a.garage;
    s.players[1] = b.garage;
    expect(s.players[0]).toMatchObject({ cash: 60_000, levels: { tires: 1, shocks: 0 }, keys: 'wasd', initials: 'ACE' });
    expect(s.players[1]).toMatchObject({ cash: 40_000, levels: { tires: 0, shocks: 1 }, keys: 'arrows', initials: 'JET' });
    const m = modsBySlot(s);
    expect(m[0].grip).toBeCloseTo(1.09);
    expect(m[0].damping).toBe(1);
    expect(m[1].grip).toBe(1);
    expect(m[1].damping).toBeCloseTo(1.12);
  });

  it('lists the humans out of credits; a continue is per human', () => {
    const s = two();
    s.players[1].credits = 0;
    s.players[1].cash = 55_000;
    expect(outPlayers(s)).toEqual([1]);
    const c = takeContinue(s.players[1]);
    expect(c).toMatchObject({ credits: START_CREDITS, cash: 0, initials: 'JET' });
    expect(s.players[0].credits).toBe(START_CREDITS);
  });
});

describe('dropping to CPU', () => {
  it("hands the colour to its CPU driver with the truck's upgrades and cash", () => {
    const s = two();
    s.players[0].levels = { ...STOCK_LEVELS, accel: 2 };
    s.players[0].cash = 30_000;
    s.last = { track: 't', outcomes: [{ free: false, creditLost: true, credits: 0, out: true }, { free: true, creditLost: false, credits: 3, out: false }], places: [4, 1, 2, 3] };
    const d = dropToCpu(s, 0);
    expect(d.players.map((p) => p.initials)).toEqual(['JET']);
    // The lone human left gets the whole keyboard back.
    expect(d.players[0].keys).toBe('solo');
    expect(d.cpus.map((c) => c.colour)).toEqual(['yellow', 'blue', 'grey']);
    expect(d.cpus[1]).toMatchObject({ colour: 'blue', cash: 30_000, levels: { accel: 2 } });
    expect(d.last!.outcomes).toHaveLength(1);
    expect(lineup(d).map((l) => `${l.kind}:${l.colour}`)).toEqual(['player:red', 'cpu:yellow', 'cpu:blue', 'cpu:grey']);
    expect(entriesFor(d)[2]).toMatchObject({ nick: 'ROWDY', colour: 'blue' });
    // The original is untouched.
    expect(s.players).toHaveLength(2);
  });

  it('can leave nobody (the flow then ends the season)', () => {
    const d = dropToCpu(newSeason([{ initials: 'ACE', colour: 'red' }]), 0);
    expect(d.players).toHaveLength(0);
    expect(d.cpus.map((c) => c.colour)).toEqual(['red', 'yellow', 'blue', 'grey']);
  });
});

describe('save migration', () => {
  const v1 = {
    v: 1,
    race: 4,
    players: [{ initials: 'ACE', colour: 'yellow', cash: 123_000, credits: 2, levels: { accel: 1, tires: 2, shocks: 0, top: 0 }, nitros: 17 }],
    cpus: [
      { colour: 'red', cash: 0, levels: { ...STOCK_LEVELS }, nitros: 10 },
      { colour: 'blue', cash: 0, levels: { ...STOCK_LEVELS }, nitros: 10 },
      { colour: 'grey', cash: 0, levels: { ...STOCK_LEVELS }, nitros: 10 },
    ],
    last: { track: 'coyote', outcomes: [{ free: false, creditLost: true, credits: 2, out: false }], places: [2, 1, 3, 4] },
  };

  it('turns a v1 one-player save into v2 with the whole keyboard', () => {
    const s = migrateSeason(structuredClone(v1))!;
    expect(s.v).toBe(SEASON_VERSION);
    expect(s.players[0]).toMatchObject({ initials: 'ACE', colour: 'yellow', cash: 123_000, credits: 2, nitros: 17, keys: 'solo', levels: { tires: 2 } });
    expect(s.race).toBe(4);
    expect(s.last?.track).toBe('coyote');
    expect(lineup(s).map((l) => l.colour)).toEqual(['yellow', 'red', 'blue', 'grey']);
  });

  it('keeps a v2 save and refuses junk', () => {
    const s = two();
    expect(migrateSeason(structuredClone(s))).toEqual(s);
    expect(migrateSeason(null)).toBeNull();
    expect(migrateSeason({ v: 3, race: 0, players: [{}], cpus: [] })).toBeNull();
    expect(migrateSeason({ ...v1, players: [] })).toBeNull();
  });
});

describe('pads', () => {
  it('a joined pad stays its player’s; the others are lent in join order', () => {
    const controls = [
      { keys: 'wasd' as const, pad: null },
      { keys: 'arrows' as const, pad: null },
      { keys: null, pad: 2 },
    ];
    expect(padsFor(controls, [0, 1, 2])).toEqual([0, 1, 2]);
    expect(padsFor(controls, [2, 3])).toEqual([3, null, 2]);
    expect(padsFor(controls, [])).toEqual([null, null, 2]);
  });
});
