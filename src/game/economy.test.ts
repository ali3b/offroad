import { describe, expect, it } from 'vitest';
import { buy, canBuy, cpuPaceBonus, cpuShop, creditOutcome, MAX_LEVEL, modsFor, NITRO_PER_BUY, PRICES, START_CREDITS, STOCK_LEVELS, takeContinue } from './economy';
import { entriesFor, lineup, modsBySlot, newSeason, nitrosBySlot, raceFor, settleRace, trackOrder } from './season';
import type { RacerResult } from '../race/race';

const garage = (cash: number) => ({ cash, levels: { ...STOCK_LEVELS }, nitros: 25 });

describe('shop', () => {
  it('charges the fixed prices and raises the level', () => {
    const r = buy(garage(100_000), 'tires');
    expect(r.ok && r.garage.cash).toBe(60_000);
    expect(r.ok && r.garage.levels.tires).toBe(1);
  });
  it('sells nitro by the bottle', () => {
    const r = buy(garage(10_000), 'nitro');
    expect(r.ok && r.garage.nitros).toBe(25 + NITRO_PER_BUY);
    expect(r.ok && r.garage.cash).toBe(0);
  });
  it('refuses without the cash or past level 5', () => {
    expect(canBuy(garage(PRICES.top - 1), 'top')).toBe('cash');
    const maxed = { ...garage(1e9), levels: { ...STOCK_LEVELS, shocks: MAX_LEVEL } };
    expect(canBuy(maxed, 'shocks')).toBe('max');
    expect(buy(maxed, 'shocks')).toEqual({ ok: false, reason: 'max' });
  });
  it('does not mutate the garage it was given', () => {
    const g = garage(80_000);
    buy(g, 'accel');
    expect(g).toEqual(garage(80_000));
  });
});

describe('upgrade effects', () => {
  it('is stock at level 0 and grows per level', () => {
    expect(modsFor(STOCK_LEVELS)).toEqual({ engine: 1, topSpeed: 1, grip: 1, stiffness: 1, damping: 1, recovery: 1 });
    const m = modsFor({ accel: 5, tires: 5, shocks: 5, top: 5 });
    expect(m.engine).toBeCloseTo(1.35);
    expect(m.grip).toBeCloseTo(1.45);
    expect(m.topSpeed).toBeCloseTo(1.175);
    expect(m.damping).toBeCloseTo(1.6);
    expect(m.recovery).toBeCloseTo(1.6);
  });
});

describe('credits', () => {
  const cpu = [false, true, true, true];
  it('beat every CPU truck: FREE RACE, no credit lost', () => {
    expect(creditOutcome([1, 2, 3, 4], cpu, 0, 3)).toEqual({ free: true, creditLost: false, credits: 3, out: false });
  });
  it('beaten by any CPU truck: one credit gone', () => {
    expect(creditOutcome([2, 1, 3, 4], cpu, 0, 3)).toMatchObject({ free: false, creditLost: true, credits: 2, out: false });
    expect(creditOutcome([4, 1, 2, 3], cpu, 0, 1)).toMatchObject({ creditLost: true, credits: 0, out: true });
  });
  it('a human ahead does not cost a credit', () => {
    expect(creditOutcome([2, 1, 3, 4], [false, false, true, true], 0, 3)).toMatchObject({ creditLost: false, free: true });
  });
  it('continue: credits refill, cash to $0, upgrades kept', () => {
    const p = { ...garage(250_000), credits: 0, levels: { ...STOCK_LEVELS, tires: 2 } };
    expect(takeContinue(p)).toMatchObject({ cash: 0, credits: START_CREDITS, levels: { tires: 2 }, nitros: 25 });
  });
});

describe('CPU trucks', () => {
  it('spend their winnings on the lowest upgrade first', () => {
    const g = cpuShop(garage(100_000 + 60_000));
    expect(g.levels).toEqual({ accel: 0, tires: 1, shocks: 1, top: 0 });
    expect(g.cash).toBe(60_000);
  });
  it('get a little quicker every 3 races, capped', () => {
    expect(cpuPaceBonus(0)).toBe(0);
    expect(cpuPaceBonus(3)).toBeCloseTo(0.01);
    expect(cpuPaceBonus(300)).toBeCloseTo(0.04);
  });
});

describe('season', () => {
  const res = (places: number[], bags = [0, 0, 0, 0]): RacerResult[] =>
    places.map((place, slot) => ({ slot, place, time: 60 + place, prize: [100_000, 90_000, 80_000, 70_000][place - 1], bags: bags[slot], lapTimes: [], best: null, avg: null }));

  it('fills the other colours with CPU trucks, grey last', () => {
    const s = newSeason([{ initials: 'ACE', colour: 'yellow' }]);
    expect(lineup(s).map((l) => `${l.kind}:${l.colour}`)).toEqual(['player:yellow', 'cpu:red', 'cpu:blue', 'cpu:grey']);
    expect(entriesFor(s)[0]).toMatchObject({ nick: 'ACE', human: true, colour: 'yellow' });
    expect(s.players[0]).toMatchObject({ cash: 0, credits: START_CREDITS, nitros: 25 });
  });

  it('banks the prize and bags, carries nitros, moves credits and the race on', () => {
    let s = newSeason([{ initials: 'ACE', colour: 'red' }]);
    s = settleRace(s, res([3, 1, 2, 4], [20_000, 0, 0, 0]), [21, 4, 5, 6], 'rattlesnake');
    expect(s.players[0]).toMatchObject({ cash: 100_000, nitros: 21, credits: 2 });
    expect(s.race).toBe(1);
    expect(s.last?.outcomes[0]).toMatchObject({ creditLost: true });
    // CPU winners went shopping.
    expect(s.cpus[0].levels.tires + s.cpus[0].levels.shocks).toBeGreaterThan(0);
    expect(nitrosBySlot(s)).toEqual([21, 10, 10, 10]);
    s = settleRace(s, res([1, 2, 3, 4]), [19, 0, 0, 0], 'rattlesnake-r');
    expect(s.players[0]).toMatchObject({ cash: 200_000, credits: 2 });
    expect(s.last?.outcomes[0].free).toBe(true);
  });

  it('applies the upgrades as truck mods per slot', () => {
    const s = newSeason([{ initials: 'ACE', colour: 'red' }]);
    s.players[0].levels.tires = 2;
    expect(modsBySlot(s)[0].grip).toBeCloseTo(1.18);
    expect(modsBySlot(s)[1].grip).toBe(1);
  });

  it('runs the registry tracks through the rotation', () => {
    const order = trackOrder();
    expect(order.length).toBeGreaterThan(0);
    expect(order).not.toContain('test');
    const r0 = raceFor(0, order);
    expect(r0).toMatchObject({ id: order[0], reversed: false });
    // Race 2 (0-based) is cycle 2's first: track 1 reversed.
    expect(raceFor(order.length === 1 ? 1 : 2, order)).toMatchObject({ id: order[0], reversed: true });
  });
});
