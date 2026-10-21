// The race flow on top of a Session: "Get Ready!" → three red lamps and the flagman → race (laps counted by the
// ordered checkpoint gates, so no shortcuts) → finish → results (prize money, times, the track record) → again.
// CPU trucks drive with AiDriver; the player can be put on autopilot (tests, attract mode).
import { NO_INPUT, type TruckInput } from '../physics/vehicle';
import type { XZ } from '../track/types';
import { AiDriver } from './ai';
import { events } from './events';
import { Pickups } from './pickups';
import { PRIZES, START_NITROS } from './roster';
import type { Session } from './session';

export type Phase = 'ready' | 'countdown' | 'racing' | 'results';

/** Seconds of "Get Ready!", then one lamp a second, green at COUNTDOWN. */
export const READY_TIME = 1.8;
export const COUNTDOWN = 3;
/** After the player finishes, the race ends at the latest this long later (stragglers are ranked by progress). */
const STRAGGLER_TIME = 25;
/** Hard cap on a race (s), whatever happens. */
const MAX_RACE = 300;

export interface RacerResult {
  slot: number;
  place: number;
  /** Finish time (s) or null when ranked by progress at the end (did not finish). */
  time: number | null;
  prize: number;
  bags: number;
  lapTimes: number[];
  best: number | null;
  avg: number | null;
}

export interface RaceRecord {
  time: number;
  who: string;
}

interface RacerState {
  lap: number;
  nextGate: number;
  started: boolean;
  finished: boolean;
  finishTime: number | null;
  place: number;
  lapStart: number;
  lapTimes: number[];
  bags: number;
  ai: AiDriver;
  prev: { x: number; z: number };
}

const RECORDS_KEY = 'or.records';

export function loadRecords(): Record<string, RaceRecord> {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function saveRecords(r: Record<string, RaceRecord>) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(r));
  } catch {
    // Private mode / storage blocked: records just don't persist.
  }
}

/** Unused nitros carry over from race to race (for this page session). */
const carry: number[] = [];

function cross(ax: number, az: number, bx: number, bz: number) {
  return ax * bz - az * bx;
}

/** Does the move p→q cross segment a→b? Returns the side q ends on (+1/-1) or 0 for no crossing. */
function crossing(p: { x: number; z: number }, q: { x: number; z: number }, a: XZ, b: XZ): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const s0 = cross(ex, ez, p.x - a[0], p.z - a[1]);
  const s1 = cross(ex, ez, q.x - a[0], q.z - a[1]);
  if (s0 === 0 || Math.sign(s0) === Math.sign(s1)) return 0;
  // Where along the gate the move crosses.
  const t = s0 / (s0 - s1);
  const x = p.x + (q.x - p.x) * t;
  const z = p.z + (q.z - p.z) * t;
  const u = ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez);
  if (u < -0.05 || u > 1.05) return 0;
  return Math.sign(s1);
}

export class Race {
  phase: Phase = 'ready';
  phaseT = 0;
  /** The race timer (s), from the green light. */
  clock = 0;
  readonly laps: number;
  readonly states: RacerState[];
  readonly gates: [XZ, XZ][];
  /** The side (+1/-1) a truck ends on when it crosses each gate forwards. */
  private gateSide: number[];
  private finishedCount = 0;
  private playerDoneAt: number | null = null;
  pickups: Pickups;
  results: RacerResult[] | null = null;
  record: RaceRecord | null;
  newRecord = false;
  autopilot = false;
  /** Called when a pickup is collected (floating text). */
  onPickup: (text: string, x: number, y: number, z: number, slot: number) => void = () => {};

  constructor(readonly session: Session) {
    const t = session.track;
    if (!t.line || !t.data.gates?.length) throw new Error(`track "${t.data.id}" has no racing line or gates`);
    this.laps = t.data.laps ?? 4;
    this.gates = t.data.gates ?? [];
    const line = t.line;
    this.gateSide = this.gates.map(([a, b]) => {
      const mid = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 };
      const s = line.project(mid.x, mid.z).s;
      const tan = line.tangentAt(s);
      return Math.sign(cross(b[0] - a[0], b[1] - a[1], tan.x, tan.z)) || 1;
    });
    this.states = session.racers.map((r) => ({
      lap: 0,
      nextGate: 0,
      started: false,
      finished: false,
      finishTime: null,
      place: 0,
      lapStart: 0,
      lapTimes: [],
      bags: 0,
      ai: new AiDriver(line, r.entry.skill, r.slot + 1, 0),
      prev: { x: 0, z: 0 },
    }));
    this.pickups = new Pickups(line, t.levelAt, 15);
    session.scene.add(this.pickups.group);
    this.record = loadRecords()[t.data.id] ?? null;
    this.restart();
  }

  get line() {
    return this.session.track.line!;
  }

  /** Back to the grid: "Get Ready!" again. Nitros left over carry into this race. */
  restart() {
    const s = this.session;
    s.reset();
    s.particles.clear();
    this.pickups.clear();
    this.session.scene.remove(this.pickups.group);
    this.pickups = new Pickups(this.line, s.track.levelAt, 15, 7 + Math.floor(Math.random() * 1000));
    this.session.scene.add(this.pickups.group);
    s.racers.forEach((r, i) => {
      r.truck.nitros = carry[i] ?? (i === 0 ? START_NITROS.player : START_NITROS.cpu);
      const st = this.states[i];
      const p = r.truck.body.translation();
      Object.assign(st, { lap: 0, nextGate: 0, started: false, finished: false, finishTime: null, place: 0, lapStart: 0, lapTimes: [], bags: 0, prev: { x: p.x, z: p.z } });
      st.ai = new AiDriver(this.line, r.entry.skill, r.slot + 1, this.line.project(p.x, p.z).s);
      st.ai.reseed(r.slot * 31 + Math.random() * 1000);
    });
    this.finishedCount = 0;
    this.playerDoneAt = null;
    this.results = null;
    this.newRecord = false;
    this.clock = 0;
    this.setPhase('ready');
    s.track.lights.set(0);
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    events.emit('phase', { phase: p });
  }

  /** Race progress (m): laps done × line length + distance past the start line (negative before it). */
  progress(slot: number) {
    const st = this.states[slot];
    const L = this.line.length;
    const s0 = this.line.project(this.gates[0][0][0] / 2 + this.gates[0][1][0] / 2, this.gates[0][0][1] / 2 + this.gates[0][1][1] / 2).s;
    const d = this.line.wrap(st.ai.s - s0);
    if (!st.started) return d > L / 2 ? d - L : 0;
    // Just past the line but the lap not counted yet (gates still pending) reads as the end of the previous lap.
    const into = st.nextGate === 0 && d < L / 4 ? d + L : d;
    return st.lap * L + into;
  }

  /** Current lap shown on the HUD (1..laps). */
  lapShown(slot: number) {
    return Math.min(this.laps, this.states[slot].lap + 1);
  }

  step(dt: number, playerInput: TruckInput) {
    const s = this.session;
    this.phaseT += dt;
    const racing = this.phase === 'racing';
    if (this.phase === 'ready' && this.phaseT >= READY_TIME) {
      this.setPhase('countdown');
      events.emit('countdown', { n: 3 });
      s.track.lights.set(1);
    } else if (this.phase === 'countdown') {
      const n = Math.min(3, 1 + Math.floor(this.phaseT));
      const was = Math.min(3, 1 + Math.floor(this.phaseT - dt));
      if (n !== was) {
        events.emit('countdown', { n: 4 - n });
        s.track.lights.set(n);
      }
      if (this.phaseT >= COUNTDOWN) {
        s.track.lights.set(4);
        events.emit('countdown', { n: 0 });
        this.setPhase('racing');
      }
    }
    if (this.phase === 'racing') this.clock += dt;
    s.track.flagman.pose(this.phase === 'ready' ? 0 : this.phase === 'countdown' ? 1 : this.phase === 'racing' && this.clock < 2 ? 2 : 0, s.time);

    // Inputs: held on the grid until the green light; CPU (and autopilot) from the AI.
    const leaderGap = this.progress(0);
    const inputs = s.racers.map((r, i) => {
      const st = this.states[i];
      if (this.phase === 'ready' || this.phase === 'countdown') return NO_INPUT;
      const ai = i > 0 || this.autopilot || st.finished;
      if (!ai) return playerInput;
      const gap = this.progress(i) - leaderGap;
      const rubber = i === 0 ? 1 : Math.max(0.94, Math.min(1.05, 1 - gap * 0.0015));
      const input = st.ai.drive(r.truck, { rubber, wallAhead: s.wallAhead(r.truck), racing: racing && !st.finished, dt });
      if (st.ai.wantsRescue) this.rescue(i);
      return input;
    });
    // Player's own driving keeps the AI's line position fresh (for positions and rescue).
    if (!this.autopilot && this.phase === 'racing') {
      const p = s.truck.body.translation();
      this.states[0].ai.s = this.line.project(p.x, p.z, this.states[0].ai.s).s;
    }
    s.step(dt, inputs);
    // A truck that somehow left the arena (or fell through) goes back onto the line.
    s.racers.forEach((r, i) => {
      if (s.outside(r.truck)) this.rescue(i);
    });

    if (this.phase === 'racing') {
      this.gatesAndLaps();
      for (const g of this.pickups.step(dt, s.racers.map((r) => r.truck), s.time)) {
        const st = this.states[g.slot];
        if (g.kind === 'money') st.bags += g.value;
        else s.racers[g.slot].truck.nitros += g.value;
        events.emit('pickup', { truck: g.slot, kind: g.kind, value: g.value });
        this.onPickup(g.kind === 'money' ? g.value.toLocaleString('en-US') : `${g.value} NITRO${g.value > 1 ? 'S' : ''}`, g.x, g.y, g.z, g.slot);
      }
      const allDone = this.finishedCount === this.states.length;
      const stragglersOut = this.playerDoneAt !== null && this.clock - this.playerDoneAt > STRAGGLER_TIME;
      if (allDone || stragglersOut || this.clock > MAX_RACE) {
        if (this.phaseT > 0 && this.results === null) this.finishRace();
      }
    } else if (this.phase === 'results') {
      // Trucks roll to a stop after the race; the results overlay is up.
    }
    for (let i = 0; i < s.racers.length; i++) {
      const p = s.racers[i].truck.body.translation();
      this.states[i].prev = { x: p.x, z: p.z };
    }
  }

  /** Put a stuck CPU truck back on the racing line, a little ahead of where it was. */
  rescue(slot: number) {
    const st = this.states[slot];
    const t = this.session.racers[slot].truck;
    const sNew = st.ai.s + 2;
    const p = this.line.pointAt(sNew);
    const heading = this.line.headingAt(sNew);
    t.place({ x: p.x, z: p.z, y: this.session.track.levelAt(p.x, p.z, heading) + 1.3, heading });
    st.ai.s = this.line.wrap(sNew);
    st.ai.wantsRescue = false;
    // Teleporting must not count as crossing a gate.
    st.prev = { x: p.x, z: p.z };
  }

  private gatesAndLaps() {
    const s = this.session;
    s.racers.forEach((r, i) => {
      const st = this.states[i];
      if (st.finished) return;
      const q = r.truck.body.translation();
      const g = st.nextGate;
      const side = crossing(st.prev, q, this.gates[g][0], this.gates[g][1]);
      if (side === 0 || side !== this.gateSide[g]) return;
      if (g !== 0) {
        st.nextGate = (g + 1) % this.gates.length;
        return;
      }
      if (!st.started) {
        st.started = true;
        st.lapStart = this.clock;
        st.nextGate = 1;
        return;
      }
      st.lap++;
      // Lap 1 is timed from the green light (it includes the short run to the line, like the race clock).
      const lapTime = this.clock - (st.lapTimes.length ? st.lapStart : 0);
      st.lapTimes.push(lapTime);
      st.lapStart = this.clock;
      st.nextGate = 1;
      if (st.lap >= this.laps) {
        st.finished = true;
        st.finishTime = this.clock;
        st.place = ++this.finishedCount;
        if (i === 0) this.playerDoneAt = this.clock;
        events.emit('finish', { truck: i, place: st.place, time: this.clock });
      } else events.emit('lap', { truck: i, lap: st.lap + 1, lapTime });
    });
  }

  private finishRace() {
    const s = this.session;
    // Anyone still out is ranked behind the finishers by progress.
    const out = this.states.map((st, i) => ({ st, i })).filter((x) => !x.st.finished);
    out.sort((a, b) => this.progress(b.i) - this.progress(a.i));
    for (const x of out) x.st.place = ++this.finishedCount;
    this.results = this.states.map((st, i) => {
      const best = st.lapTimes.length ? Math.min(...st.lapTimes) : null;
      const avg = st.lapTimes.length ? st.lapTimes.reduce((a, b) => a + b, 0) / st.lapTimes.length : null;
      return { slot: i, place: st.place, time: st.finished ? st.finishTime : null, prize: PRIZES[st.place - 1] ?? 0, bags: st.bags, lapTimes: st.lapTimes, best, avg };
    });
    // Track record: the fastest finish time by anyone, kept in localStorage (or.records).
    const fastest = this.results.filter((r) => r.time !== null).sort((a, b) => a.time! - b.time!)[0];
    if (fastest && (!this.record || fastest.time! < this.record.time)) {
      const e = s.racers[fastest.slot].entry;
      this.record = { time: Math.round(fastest.time! * 100) / 100, who: fastest.slot === 0 ? 'YOU' : e.nick };
      this.newRecord = true;
      const all = loadRecords();
      all[s.track.data.id] = this.record;
      saveRecords(all);
    }
    s.racers.forEach((r, i) => (carry[i] = r.truck.nitros));
    this.setPhase('results');
  }

  /** Race-time snapshot for the test handle. */
  snapshot() {
    return {
      phase: this.phase,
      clock: this.clock,
      laps: this.laps,
      trucks: this.session.racers.map((r, i) => {
        const st = this.states[i];
        const p = r.truck.body.translation();
        return {
          slot: i,
          colour: r.entry.colour,
          lap: st.lap,
          lapShown: this.lapShown(i),
          nextGate: st.nextGate,
          started: st.started,
          finished: st.finished,
          finishTime: st.finishTime,
          place: st.place,
          lapTimes: st.lapTimes,
          nitros: r.truck.nitros,
          bags: st.bags,
          progress: this.progress(i),
          resets: r.truck.resets,
          pos: { x: p.x, y: p.y, z: p.z },
        };
      }),
      results: this.results,
      record: this.record,
      pickups: this.pickups.items.map((it) => ({ kind: it.kind, value: it.value, x: it.x, z: it.z })),
    };
  }
}
