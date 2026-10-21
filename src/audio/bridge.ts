// Maps the game's event bus (src/race/events.ts) onto the audio contract (./types.ts) and attaches the audio system.
// Pan comes from each truck's screen x, which only the scene knows, so main.ts passes `screenX`.

import type { EventBus, GameEvents } from '../race/events';
import { attachAudio } from './index';
import type { AudioBus, AudioEvents } from './types';

type Fn = (e: never) => void;

export function bridgeAudio(game: EventBus<GameEvents>, screenX: (truck: number) => number) {
  const subs = new Map<keyof AudioEvents, Set<Fn>>();
  const send = <K extends keyof AudioEvents>(type: K, e: AudioEvents[K]) => {
    for (const fn of subs.get(type) ?? []) (fn as (e: AudioEvents[K]) => void)(e);
  };
  const bus: AudioBus = {
    on(type, fn) {
      let set = subs.get(type);
      if (!set) subs.set(type, (set = new Set()));
      set.add(fn as Fn);
    },
  };
  attachAudio(bus);

  game.on('engine', (e) => send('engine', { truck: e.truck, rpm: e.rpm, throttle: e.throttle, x: screenX(e.truck) }));
  game.on('impact', (e) => {
    // Ground hits are landings; the land event already covers them.
    if (e.with !== 'ground') send('impact', { strength: e.strength, with: e.with, x: screenX(e.truck) });
  });
  game.on('skid', (e) => send('skid', { truck: e.truck, amount: e.intensity, x: screenX(e.truck) }));
  game.on('splash', (e) => send('splash', { x: screenX(e.truck) }));
  game.on('nitro', (e) => send('nitro', { truck: e.truck, x: screenX(e.truck) }));
  // About a second of air is a big landing.
  game.on('land', (e) => send('land', { strength: Math.min(1, e.airTime / 1), x: screenX(e.truck) }));
  game.on('countdown', (e) => (e.n > 0 ? send('countdown', { n: e.n }) : send('go', undefined)));
  game.on('lap', (e) => send('lap', { truck: e.truck, lap: e.lap }));
  game.on('finish', (e) => send('finish', { truck: e.truck, place: e.place }));
  game.on('pickup', (e) => send('pickup', { kind: e.kind }));
  game.on('phase', (e) => {
    if (e.phase === 'ready') send('scene', { name: 'race' });
    else if (e.phase === 'results') send('scene', { name: 'podium' });
  });
}
