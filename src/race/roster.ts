// The four trucks of a race, in the original's HUD order (red, yellow, blue, grey). Slot 0 is the player; the grey
// truck is always the CPU "boss". Driver names are our own.
export interface Skill {
  /** Share of the truck's top speed the driver aims for on straights. */
  pace: number;
  /** Cornering grip the driver trusts (m/s² of lateral acceleration). */
  cornerGrip: number;
  /** Base lookahead (m) along the racing line; grows with speed. */
  lookahead: number;
  /** How far (m) the driver strays from the line, wandering slowly. */
  wobble: number;
  /** Chance per straight to fire a nitro. */
  nitroChance: number;
  /** Seconds of reaction lag before a correction (makes "humanly random" mistakes). */
  sloppiness: number;
}

export interface Entry {
  colour: 'red' | 'yellow' | 'blue' | 'grey';
  hex: string;
  /** Nickname and name, shown on the podium plates. */
  nick: string;
  name: string;
  skill: Skill;
  /** Engine factor (Truck.power): the boss truck is a little stronger. */
  power?: number;
  /** A human driver (season: the player's initials are the nick). */
  human?: boolean;
}

export type Colour = Entry['colour'];
/** The HUD and grid colour order. */
export const COLOURS: Colour[] = ['red', 'yellow', 'blue', 'grey'];
/** Colours a human can pick (grey is always the CPU boss). */
export const PLAYER_COLOURS: Colour[] = ['red', 'yellow', 'blue'];
export const HEX: Record<Colour, string> = { red: '#d42a26', yellow: '#e8c020', blue: '#2f5fd8', grey: '#9aa0a8' };

export const ROSTER: Entry[] = [
  { colour: 'red', hex: '#d42a26', nick: 'PLAYER 1', name: 'You', skill: { pace: 0.97, cornerGrip: 17, lookahead: 5, wobble: 0.3, nitroChance: 0.55, sloppiness: 0 } },
  { colour: 'yellow', hex: '#e8c020', nick: 'BUCKSHOT', name: 'Billy Kade', skill: { pace: 0.9, cornerGrip: 14.5, lookahead: 5.5, wobble: 1.3, nitroChance: 0.35, sloppiness: 0.12 } },
  { colour: 'blue', hex: '#2f5fd8', nick: 'ROWDY', name: 'Rita Vance', skill: { pace: 0.93, cornerGrip: 15.5, lookahead: 5, wobble: 1.0, nitroChance: 0.45, sloppiness: 0.08 } },
  { colour: 'grey', hex: '#9aa0a8', nick: 'STEEL', name: 'Hank Dorsey', skill: { pace: 1.0, cornerGrip: 18.5, lookahead: 5, wobble: 0.4, nitroChance: 0.6, sloppiness: 0 }, power: 1.05 },
];

/** The CPU driver for each colour (season: the colours no human took). Red only races when a player picks another colour. */
export const CPU_DRIVERS: Record<Colour, Entry> = {
  red: { colour: 'red', hex: HEX.red, nick: 'DUSTY', name: 'Dot Marlow', skill: { pace: 0.915, cornerGrip: 15, lookahead: 5.2, wobble: 1.1, nitroChance: 0.4, sloppiness: 0.1 } },
  yellow: ROSTER[1],
  blue: ROSTER[2],
  grey: ROSTER[3],
};

/** Starting nitros: the player 25, each CPU truck 10 (unused ones carry over to the next race). */
export const START_NITROS = { player: 25, cpu: 10 };

/** Prize money by finishing place. */
export const PRIZES = [100_000, 90_000, 80_000, 70_000];
