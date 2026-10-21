// The season: who races (1..3 humans, local multiplayer; CPU trucks fill the other colours, grey is always the CPU
// boss), each human's own cash, credits, upgrades and nitros, which race is next, and the save in localStorage
// `or.season` (v2; a v1 one-player save is migrated on load). Pure apart from the storage helpers at the bottom.
import * as registry from '../track/tracks';
import type { TrackData } from '../track/types';
import { COLOURS, CPU_DRIVERS, HEX, START_NITROS, type Colour, type Entry } from '../race/roster';
import type { RacerResult } from '../race/race';
import type { TruckMods } from '../physics/vehicle';
import { cpuPaceBonus, cpuShop, creditOutcome, modsFor, START_CREDITS, STOCK_LEVELS, type CreditOutcome, type Garage } from './economy';
import { raceAt, type RotationSlot } from './rotation';
import type { KeyScheme } from '../engine/input';

export const MAX_PLAYERS = 3;

export interface PlayerState extends Garage {
  initials: string;
  colour: Colour;
  credits: number;
  /** Keyboard layout ('solo' when racing alone; null = pad only). Pads are lent per page session, not saved. */
  keys: KeyScheme | null;
}

export interface CpuState extends Garage {
  colour: Colour;
}

export const SEASON_VERSION = 2;

export interface SeasonState {
  v: typeof SEASON_VERSION;
  /** 0-based index of the next race in the rotation. */
  race: number;
  players: PlayerState[];
  cpus: CpuState[];
  /** The last race's outcome per player index (results: FREE RACE / credit lost); places per slot. */
  last?: { track: string; outcomes: CreditOutcome[]; places: number[] };
}

/** One truck of the next race: slot order = players first (slot 0 = player 1 on pole), then the CPU trucks. */
export type LineupSlot = { kind: 'player'; index: number; colour: Colour } | { kind: 'cpu'; index: number; colour: Colour };

/** Default keyboard layouts by the number of humans: alone = both key sets; then WASD, arrows, pad only. */
export function defaultKeys(n: number, i: number): KeyScheme | null {
  if (n === 1) return 'solo';
  return (['wasd', 'arrows', null] as const)[i] ?? null;
}

export function newSeason(players: { initials: string; colour: Colour; keys?: KeyScheme | null }[]): SeasonState {
  if (players.length < 1 || players.length > MAX_PLAYERS) throw new Error(`1..${MAX_PLAYERS} players`);
  const taken = new Set(players.map((p) => p.colour));
  if (taken.size !== players.length || taken.has('grey')) throw new Error('players need distinct colours (not grey)');
  return {
    v: SEASON_VERSION,
    race: 0,
    players: players.map((p, i) => ({
      initials: p.initials,
      colour: p.colour,
      cash: 0,
      credits: START_CREDITS,
      levels: { ...STOCK_LEVELS },
      nitros: START_NITROS.player,
      keys: p.keys !== undefined ? p.keys : defaultKeys(players.length, i),
    })),
    cpus: COLOURS.filter((c) => !taken.has(c)).map((colour) => ({ colour, cash: 0, levels: { ...STOCK_LEVELS }, nitros: START_NITROS.cpu })),
  };
}

/** Humans with no credits left after the last race (CONTINUE? each, with their own countdown). */
export function outPlayers(s: SeasonState): number[] {
  return s.players.flatMap((p, i) => (p.credits <= 0 ? [i] : []));
}

/**
 * A human gives up (no continue): their colour becomes a CPU driver (our CPU name for that colour) who keeps the
 * truck's upgrades and cash. A lone human left gets the whole keyboard back ('solo'). The season may end up with no
 * humans: the caller ends it (game over).
 */
export function dropToCpu(s: SeasonState, player: number): SeasonState {
  const next: SeasonState = structuredClone(s);
  const [p] = next.players.splice(player, 1);
  if (!p) return next;
  next.cpus.push({ colour: p.colour, cash: p.cash, levels: { ...p.levels }, nitros: START_NITROS.cpu });
  next.cpus.sort((a, b) => COLOURS.indexOf(a.colour) - COLOURS.indexOf(b.colour));
  if (next.players.length === 1) next.players[0].keys = 'solo';
  if (next.last) next.last = { ...next.last, outcomes: next.last.outcomes.filter((_, i) => i !== player) };
  return next;
}

export function lineup(s: SeasonState): LineupSlot[] {
  return [
    ...s.players.map((p, index) => ({ kind: 'player' as const, index, colour: p.colour })),
    ...s.cpus.map((c, index) => ({ kind: 'cpu' as const, index, colour: c.colour })),
  ];
}

/** Session entries for the next race: the players' trucks under their initials, the CPU drivers a little quicker each cycle. */
export function entriesFor(s: SeasonState): Entry[] {
  const bonus = cpuPaceBonus(s.race);
  return lineup(s).map((l) => {
    if (l.kind === 'player') {
      const p = s.players[l.index];
      return { colour: p.colour, hex: HEX[p.colour], nick: p.initials, name: `Player ${l.index + 1}`, human: true, skill: { pace: 0.97, cornerGrip: 17, lookahead: 5, wobble: 0.3, nitroChance: 0.55, sloppiness: 0 } };
    }
    const d = CPU_DRIVERS[l.colour];
    return { ...d, skill: { ...d.skill, pace: d.skill.pace + bonus } };
  });
}

export function garageOf(s: SeasonState, l: LineupSlot): Garage {
  return l.kind === 'player' ? s.players[l.index] : s.cpus[l.index];
}

/** Upgrade multipliers per slot. */
export function modsBySlot(s: SeasonState): TruckMods[] {
  return lineup(s).map((l) => modsFor(garageOf(s, l).levels));
}

/** Nitros per slot at the start of the next race (players carry theirs; CPU trucks get a fresh START_NITROS.cpu). */
export function nitrosBySlot(s: SeasonState): number[] {
  return lineup(s).map((l) => (l.kind === 'player' ? s.players[l.index].nitros : START_NITROS.cpu));
}

/**
 * Bank a race: prize + bags to every truck's cash, the players' nitros carry over, the CPU trucks go shopping, the
 * credits move (beaten by a CPU = −1, beat them all = FREE RACE), and the season moves on to the next race.
 */
export function settleRace(s: SeasonState, results: RacerResult[], nitrosLeft: number[], trackId: string): SeasonState {
  const lu = lineup(s);
  const next: SeasonState = structuredClone(s);
  const places = lu.map((_, slot) => results.find((r) => r.slot === slot)?.place ?? lu.length);
  const cpu = lu.map((l) => l.kind === 'cpu');
  const outcomes: CreditOutcome[] = [];
  lu.forEach((l, slot) => {
    const r = results.find((x) => x.slot === slot);
    const won = r ? r.prize + r.bags : 0;
    if (l.kind === 'player') {
      const p = next.players[l.index];
      p.cash += won;
      p.nitros = nitrosLeft[slot] ?? p.nitros;
      const o = creditOutcome(places, cpu, slot, p.credits);
      p.credits = o.credits;
      outcomes[l.index] = o;
    } else {
      const c = next.cpus[l.index];
      c.cash += won;
      next.cpus[l.index] = cpuShop(c);
    }
  });
  next.race++;
  next.last = { track: trackId, outcomes, places };
  return next;
}

/**
 * QUIT TO TITLE during a season race: it counts as finishing last for every human (quitters behind every CPU truck,
 * so a credit is lost) with no prize and no money bags. The CPU trucks take the places ahead in line-up order with
 * no winnings either; the season moves on as after any race. Nitros already spent stay spent.
 */
export function settleQuit(s: SeasonState, nitrosLeft: number[], trackId: string): SeasonState {
  const lu = lineup(s);
  const order = [...lu.filter((l) => l.kind === 'cpu'), ...lu.filter((l) => l.kind === 'player')].map((l) => lu.indexOf(l));
  const results: RacerResult[] = order.map((slot, i) => ({ slot, place: i + 1, time: null, prize: 0, bags: 0, lapTimes: [], best: null, avg: null }));
  return settleRace(s, results, nitrosLeft, trackId);
}

// ---- The track order -----------------------------------------------------------------------------------------

const TRACK_ORDER_KEY = 'TRACK_ORDER';

/**
 * The season's track order: the registry's TRACK_ORDER (tracks 1..8) when it has one, else every registered track
 * with a racing line (the proving ground has none), in registry order.
 */
export function trackOrder(): string[] {
  const reg = registry as unknown as Record<string, unknown>;
  const order = reg[TRACK_ORDER_KEY];
  const raceable = (id: string) => !!registry.TRACKS[id]?.line && !!registry.TRACKS[id]?.gates?.length;
  if (Array.isArray(order)) {
    const ids = (order as string[]).filter(raceable);
    if (ids.length) return ids;
  }
  return Object.keys(registry.TRACKS).filter(raceable);
}

export interface NextRace {
  id: string;
  reversed: boolean;
  data: TrackData;
  slot: RotationSlot;
  /** Name as shown (with " (R)" when reversed). */
  name: string;
}

/** The season's race at index `race` (a track without a reversed variant is driven forwards). */
export function raceFor(race: number, order = trackOrder()): NextRace {
  const slot = raceAt(order.length, race);
  const id = order[slot.index];
  const reversed = slot.reversed && !!registry.TRACKS[id].reverse;
  const data = registry.getTrack(id, reversed);
  return { id, reversed, data, slot, name: data.name + (reversed ? ' (R)' : '') };
}

// ---- Persistence ----------------------------------------------------------------------------------------------

export const SEASON_KEY = 'or.season';

/**
 * A saved season in the current shape, or null if it isn't one. v1 (OR3: one player, no keyboard layout) → v2: the
 * players get their keyboard layout (alone: 'solo'; else WASD, arrows, pad only by index).
 */
export function migrateSeason(raw: unknown): SeasonState | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.players) || !s.players.length || !Array.isArray(s.cpus) || typeof s.race !== 'number') return null;
  if (s.v === 1) {
    const players = (s.players as Omit<PlayerState, 'keys'>[]).map((p, i, all) => ({ ...p, keys: defaultKeys(all.length, i) }));
    return { ...(s as unknown as SeasonState), v: SEASON_VERSION, players };
  }
  if (s.v === SEASON_VERSION) return s as unknown as SeasonState;
  return null;
}

export function loadSeason(): SeasonState | null {
  try {
    return migrateSeason(JSON.parse(localStorage.getItem(SEASON_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export function saveSeason(s: SeasonState) {
  try {
    localStorage.setItem(SEASON_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the season just doesn't survive a reload.
  }
}

export function clearSeason() {
  try {
    localStorage.removeItem(SEASON_KEY);
  } catch {
    // ignore
  }
}
