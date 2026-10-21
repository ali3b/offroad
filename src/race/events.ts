// The game's event bus. The race and the trucks emit what happened; the audio lane (src/audio/**) and any other
// listener subscribe with `events.on(type, fn)`. Emitting never throws: a listener's error is logged and skipped.
//
// Truck indices are race slots: the humans first (season: players 1..3; standalone: slot 0), then the CPU trucks
// (see race/roster.ts, game/season.ts lineup()). `engine.player` is true for every human truck.

export interface GameEvents {
  /** Every rendered frame, per truck: engine load for an engine sound. rpm 0..1 (idle..redline). */
  engine: { truck: number; rpm: number; throttle: number; speed: number; nitro: boolean; player: boolean };
  /** A hit: a wall, another truck, or the ground on a hard landing. strength ≈ 0..1 (1 = a big crash). */
  impact: { truck: number; with: 'wall' | 'truck' | 'ground'; strength: number; x: number; z: number };
  /** A truck sliding on dirt (sent while it slides, ~10 Hz). intensity 0..1. */
  skid: { truck: number; intensity: number };
  /** Driving through water or mud (sent on entry and ~5 Hz while in it). */
  splash: { truck: number; kind: 'water' | 'mud'; strength: number };
  /** A nitro burst fired. */
  nitro: { truck: number; left: number };
  /** A jump ended. */
  land: { truck: number; airTime: number };
  /** Countdown beeps: 3, 2, 1, then 0 = GO. */
  countdown: { n: number };
  /** Started lap `lap` (2..laps); lapTime is the lap just finished (s). */
  lap: { truck: number; lap: number; lapTime: number };
  /** A truck crossed the line after the last lap. */
  finish: { truck: number; place: number; time: number };
  /** A money bag or nitro bottle picked up. */
  pickup: { truck: number; kind: 'money' | 'nitro'; value: number };
  /** Race flow: 'ready' (Get Ready!), 'countdown', 'racing', 'results'. */
  phase: { phase: 'ready' | 'countdown' | 'racing' | 'results' };
  /** The game's screen changed (game/flow.ts). A standalone ?scene=race never sends these. */
  screen: { name: ScreenName };
}

/** The flow's screens: the attract loop (title, hints), sign-up, get ready, the race and its results, the shop,
 *  continue and game over. */
export type ScreenName = 'title' | 'hints' | 'register' | 'getready' | 'race' | 'results' | 'shop' | 'continue' | 'gameover';

type Handler<T> = (e: T) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, e: E[K]) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as Handler<E[K]>)(e);
      } catch (err) {
        console.warn(`event handler for "${String(type)}" failed`, err);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}

export const events = new EventBus<GameEvents>();
