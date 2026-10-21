// Audio event contract. The race lane's event bus (src/race/events.ts) emits these; attachAudio() listens.
// Until that bus lands, this file is the shape audio expects (reconcile at merge).

/** Truck index 0..3. A human's truck is sent with `player: true` (local multiplayer: 1..3 of them); without the
 *  flag, truck `AudioSystem.playerTruck` (0) is the player. */
export type TruckId = number;

export interface AudioEvents {
  /** Per frame per truck. rpm 0..1 (idle..redline), throttle 0..1, x = screen x normalised to -1 (left) .. 1 (right). */
  engine: { truck: TruckId; rpm: number; throttle: number; x: number; player?: boolean };
  /** Wall or truck hit, strength 0..1. */
  impact: { strength: number; x?: number; with?: 'wall' | 'truck' };
  /** Tyre slip, amount 0..1 (send 0 or stop sending to end it). */
  skid: { truck: TruckId; amount: number; x?: number; player?: boolean };
  splash: { x?: number };
  nitro: { truck: TruckId; x?: number; player?: boolean };
  /** Touchdown after air time, strength 0..1. */
  land: { strength: number; x?: number };
  /** Start lights: 3, 2, 1. */
  countdown: { n: number };
  go: Record<string, never> | undefined;
  lap: { truck: TruckId; lap: number; player?: boolean };
  finish: { truck: TruckId; place: number; player?: boolean };
  pickup: { kind: string };
  /** Scene change: 'title' | 'race' | 'podium' | 'shop' | anything else (silence). */
  scene: { name: string };
}

export type AudioEventType = keyof AudioEvents;

/** The minimal bus audio needs: subscribe by event type. */
export interface AudioBus {
  on<K extends AudioEventType>(type: K, fn: (e: AudioEvents[K]) => void): unknown;
}

/** Saved in localStorage `or.audio`. Volumes 0..1. */
export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}
