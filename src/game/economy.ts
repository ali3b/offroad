// The season economy, pure (no DOM, no physics): shop prices and levels, what an upgrade does to the truck
// (TruckMods multipliers), prize money, credits, FREE RACE and continues. Unit-tested in economy.test.ts.
import type { TruckMods } from '../physics/vehicle';

export type Upgrade = 'accel' | 'tires' | 'shocks' | 'top';
export type ShopItem = Upgrade | 'nitro';

/** The four levelled upgrades in shop order (the tiles read: Acceleration, Tires, Top Speed, Shocks). */
export const UPGRADES: Upgrade[] = ['accel', 'tires', 'top', 'shocks'];

/** Price per purchase, fixed at every level (the original's labels never change). */
export const PRICES: Record<ShopItem, number> = { nitro: 10_000, accel: 80_000, tires: 40_000, shocks: 60_000, top: 100_000 };
/** Levels per upgrade (stock = 0). */
export const MAX_LEVEL = 5;
/** Nitros per 10K purchase: one burst for 10K (a money bag is worth 1–3 nitros, a prize 7–10). */
export const NITRO_PER_BUY = 1;
/** Most nitros a truck can carry (the HUD cell shows two digits). */
export const MAX_NITROS = 99;
/** Credits at the start of a season and after a continue. */
export const START_CREDITS = 3;
/** Prize money by finishing place (plus the money bags the truck picked up): race/roster.ts. */
export { PRIZES } from '../race/roster';
/** Seconds the CONTINUE? countdown runs (9 → 0). */
export const CONTINUE_SECONDS = 9;

export type Levels = Record<Upgrade, number>;
export const STOCK_LEVELS: Readonly<Levels> = { accel: 0, tires: 0, shocks: 0, top: 0 };

/**
 * What the upgrade levels do to the truck (multipliers on TUNING, see physics/vehicle.ts):
 * - Acceleration: engine force +7 % a level (1.35 at 5).
 * - Top Speed: top speed +3.5 % a level (25 → 29.4 m/s at 5; nitro 32 → 37.6).
 * - Tires: lateral grip and wheel friction +9 % a level (1.45 at 5), a little more yaw rate ("tighter turning").
 * - Shocks: damping +12 % and stiffness +3 % a level (less bounce over bumps), upright/landing recovery +12 %.
 */
export function modsFor(l: Levels): TruckMods {
  return {
    engine: 1 + 0.07 * l.accel,
    topSpeed: 1 + 0.035 * l.top,
    grip: 1 + 0.09 * l.tires,
    stiffness: 1 + 0.03 * l.shocks,
    damping: 1 + 0.12 * l.shocks,
    recovery: 1 + 0.12 * l.shocks,
  };
}

export interface Garage {
  cash: number;
  levels: Levels;
  nitros: number;
}

export type BuyCheck = 'ok' | 'cash' | 'max';

export function canBuy(g: Garage, item: ShopItem): BuyCheck {
  if (item === 'nitro' ? g.nitros >= MAX_NITROS : g.levels[item] >= MAX_LEVEL) return 'max';
  if (g.cash < PRICES[item]) return 'cash';
  return 'ok';
}

/** Buy one of `item`: a new garage, or the reason it can't be bought. */
export function buy<G extends Garage>(g: G, item: ShopItem): { ok: true; garage: G } | { ok: false; reason: 'cash' | 'max' } {
  const c = canBuy(g, item);
  if (c !== 'ok') return { ok: false, reason: c };
  const next = { ...g, cash: g.cash - PRICES[item], levels: { ...g.levels } };
  if (item === 'nitro') next.nitros = Math.min(MAX_NITROS, g.nitros + NITRO_PER_BUY);
  else next.levels[item]++;
  return { ok: true, garage: next };
}

/**
 * The CPU trucks' shopping between races (so the field gets faster through the season): spend the winnings on the
 * lowest upgrade first (ties in the order tires, shocks, accel, top: cheap handling before speed) while the cash
 * lasts. Deterministic.
 */
export function cpuShop<G extends Garage>(g: G): G {
  const order: Upgrade[] = ['tires', 'shocks', 'accel', 'top'];
  let cur = g;
  for (;;) {
    const open = order.filter((u) => cur.levels[u] < MAX_LEVEL);
    if (!open.length) return cur;
    const low = Math.min(...open.map((u) => cur.levels[u]));
    const pick = open.find((u) => cur.levels[u] === low)!;
    const r = buy(cur, pick);
    if (!r.ok) return cur;
    cur = r.garage;
  }
}

/** Extra CPU pace (share of top speed) as the season goes on: +1 % every 3 races, at most +4 %. */
export function cpuPaceBonus(raceIndex: number) {
  return Math.min(0.04, Math.floor(raceIndex / 3) * 0.01);
}

export interface CreditOutcome {
  /** Every CPU truck finished behind this player: the race was free. */
  free: boolean;
  /** At least one CPU truck beat this player: one credit gone. */
  creditLost: boolean;
  /** Credits left after this race. */
  credits: number;
  /** No credits left: CONTINUE? (or game over). */
  out: boolean;
}

/**
 * Credits after a race for the human in `slot`. `places[s]` is truck s's finishing place (1..4); `cpu[s]` says
 * whether slot s is a CPU truck. Beaten by any CPU truck = lose a credit; beat them all = FREE RACE!
 */
export function creditOutcome(places: number[], cpu: boolean[], slot: number, credits: number): CreditOutcome {
  const mine = places[slot];
  const cpuPlaces = places.filter((_, s) => cpu[s]);
  const creditLost = cpuPlaces.some((p) => p < mine);
  const free = !creditLost && cpuPlaces.length > 0;
  const left = creditLost ? Math.max(0, credits - 1) : credits;
  return { free, creditLost, credits: left, out: left <= 0 };
}

/** Taking a continue: the credits refill, the cash goes back to $0, the upgrades and nitros stay. */
export function takeContinue<G extends Garage & { credits: number }>(p: G): G {
  return { ...p, cash: 0, credits: START_CREDITS };
}

/** "$70,000" */
export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
/** "80K" */
export const priceLabel = (n: number) => `${Math.round(n / 1000)}K`;
